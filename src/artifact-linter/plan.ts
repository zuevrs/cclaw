import {
  type StageLintContext,
  evaluateInvestigationTrace,
  evaluateLayeredDocumentReviewStatus,
  extractAcceptanceCriterionIdsFromMarkdown,
  extractAuthoredBody,
  extractH2Sections,
  headingPresent,
  sectionBodyByName,
  collectPatternHits,
  PLACEHOLDER_PATTERNS,
  extractDecisionIds,
  SCOPE_REDUCTION_PATTERNS
} from "./shared.js";
import { resolveArtifactPath as resolveStageArtifactPath } from "../artifact-paths.js";
import { exists } from "../fs-utils.js";
import { FORBIDDEN_PLACEHOLDER_TOKENS, CONFIDENCE_FINDING_REGEX_SOURCE } from "../content/skills.js";
import fs from "node:fs/promises";
import path from "node:path";
import {
  PLAN_SPLIT_SMALL_PLAN_THRESHOLD,
  parseImplementationUnits,
  parseImplementationUnitParallelFields
} from "../internal/plan-split-waves.js";

const PARALLEL_EXEC_MANAGED_START = "<!-- parallel-exec-managed-start -->";
const PARALLEL_EXEC_MANAGED_END = "<!-- parallel-exec-managed-end -->";
const TASK_ID_PATTERN = /\bT-\d{3}[a-z]?(?:\.\d{1,3})?\b/giu;
const ACCEPTANCE_ID_PATTERN = /\bAC-\d+\b/giu;
const PLAN_LANE_WHITELIST = new Set([
  "production",
  "test",
  "docs",
  "infra",
  "scaffold",
  "migration"
]);

interface ParallelWaveRowMeta {
  sliceId: string;
  unit: string;
  claimedPaths: string[];
  parallelizable: boolean | null;
  lane: string | null;
}

interface ParallelWaveMeta {
  waveId: string;
  rows: ParallelWaveRowMeta[];
  notes: string[];
}

/**
 * Extract every distinct T-NNN[a-z]?(.NNN)? id from a markdown body.
 *
 * Used by the `plan_parallel_exec_full_coverage` linter to compute the
 * authored task set (from `## Task List`) vs. the wave-claimed task set
 * (from inside `<!-- parallel-exec-managed-start -->`).
 */
function extractTaskIds(body: string): Set<string> {
  const ids = new Set<string>();
  for (const match of body.matchAll(TASK_ID_PATTERN)) {
    ids.add(match[0]);
  }
  return ids;
}

function extractAcceptanceTaskLinks(body: string): Array<{ acId: string; taskId: string }> {
  const links: Array<{ acId: string; taskId: string }> = [];
  for (const line of body.split(/\r?\n/u)) {
    const acIds = [...line.matchAll(ACCEPTANCE_ID_PATTERN)].map((match) =>
      match[0]!.toUpperCase()
    );
    const taskIds = [...line.matchAll(TASK_ID_PATTERN)].map((match) => match[0]!);
    if (acIds.length === 0 || taskIds.length === 0) continue;
    for (const acId of acIds) {
      for (const taskId of taskIds) {
        links.push({ acId, taskId });
      }
    }
  }
  return links;
}

/**
 * Return the body between the parallel-exec managed comment markers, or
 * an empty string if the block is absent. The TDD wave parser uses the
 * same delimiters; keeping the regex local avoids cross-package import
 * cycles in the linter.
 */
function extractParallelExecManagedBody(planMarkdown: string): string {
  const startIdx = planMarkdown.indexOf(PARALLEL_EXEC_MANAGED_START);
  const endIdx = planMarkdown.indexOf(PARALLEL_EXEC_MANAGED_END);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
    return "";
  }
  return planMarkdown.slice(startIdx + PARALLEL_EXEC_MANAGED_START.length, endIdx);
}

function normalizePathToken(raw: string): string {
  return raw.trim().replace(/^`|`$/gu, "").replace(/^\.\/+/u, "");
}

function parsePipeRow(trimmedLine: string): string[] {
  const inner = trimmedLine.replace(/^\|/u, "").replace(/\|\s*$/u, "");
  return inner.split("|").map((cell) => cell.trim());
}

function headerIndexByName(cells: string[]): Map<string, number> {
  const map = new Map<string, number>();
  for (let i = 0; i < cells.length; i += 1) {
    const key = cells[i]!.toLowerCase().replace(/[^a-z0-9]/gu, "");
    if (key.length > 0 && !map.has(key)) {
      map.set(key, i);
    }
  }
  return map;
}

function parseParallelWaveTableMetadata(planMarkdown: string): ParallelWaveMeta[] {
  const body = extractParallelExecManagedBody(planMarkdown);
  if (body.trim().length === 0) return [];
  const lines = body.split(/\r?\n/u);
  const out: ParallelWaveMeta[] = [];
  let current: ParallelWaveMeta | null = null;
  let headerIdx: Map<string, number> | null = null;

  const flush = (): void => {
    if (current) out.push(current);
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const waveMatch = /^###\s+Wave\s+(?:W-)?(\d+)\b/iu.exec(trimmed);
    if (waveMatch) {
      flush();
      current = {
        waveId: `W-${waveMatch[1]!.padStart(2, "0")}`,
        rows: [],
        notes: []
      };
      headerIdx = null;
      continue;
    }
    if (!current) continue;
    current.notes.push(trimmed);
    if (!trimmed.startsWith("|")) continue;
    const cells = parsePipeRow(trimmed);
    if (cells.length === 0) continue;
    const first = cells[0]!.toLowerCase();
    const isHeader = first === "sliceid" || first === "slice id";
    if (isHeader) {
      headerIdx = headerIndexByName(cells);
      continue;
    }
    if (cells.every((cell) => /^:?-{3,}:?$/u.test(cell))) {
      continue;
    }
    const sliceCell = cells[0]!;
    if (!/^S-\d+$/iu.test(sliceCell)) continue;
    const idx = headerIdx ?? new Map<string, number>();
    const unitIdx = idx.get("unit") ?? idx.get("taskid") ?? 1;
    const pathsIdx = idx.get("claimedpaths");
    const parallelizableIdx = idx.get("parallelizable");
    const laneIdx = idx.get("lane");
    const rawPaths = pathsIdx !== undefined ? (cells[pathsIdx] ?? "") : "";
    const claimedPaths = rawPaths.length === 0
      ? []
      : rawPaths
        .split(",")
        .map((p) => normalizePathToken(p))
        .filter((p) => p.length > 0);
    const rawParallel = parallelizableIdx !== undefined ? (cells[parallelizableIdx] ?? "").toLowerCase() : "";
    let parallelizable: boolean | null = null;
    if (rawParallel === "true" || rawParallel === "yes") parallelizable = true;
    if (rawParallel === "false" || rawParallel === "no") parallelizable = false;
    const laneRaw = laneIdx !== undefined ? (cells[laneIdx] ?? "").trim().toLowerCase() : "";
    current.rows.push({
      sliceId: sliceCell.toUpperCase(),
      unit: (cells[unitIdx] ?? "").trim(),
      claimedPaths,
      parallelizable,
      lane: laneRaw.length > 0 ? laneRaw : null
    });
  }
  flush();
  return out;
}

function waveHasSequentialModeHint(wave: ParallelWaveMeta): boolean {
  const noteText = wave.notes.join("\n").toLowerCase();
  return /mode\s*:\s*sequential/iu.test(noteText) || /\bsequential\b/iu.test(noteText) || /\bserial\b/iu.test(noteText);
}

export async function lintPlanStage(ctx: StageLintContext): Promise<void> {
  const {
    projectRoot,
    track,
    raw,
    absFile,
    sections,
    findings,
    parsedFrontmatter,
    brainstormShortCircuitBody,
    brainstormShortCircuitActivated,
    staleDiagramAuditEnabled,
    isTrivialOverride
  } = ctx;

    evaluateInvestigationTrace(ctx, "Implementation Units");

    const strictPlanGuards =
      parsedFrontmatter.hasFrontmatter ||
      headingPresent(sections, "Plan Quality Scan") ||
      headingPresent(sections, "Locked Decision Coverage");
    const taskListBody = sectionBodyByName(sections, "Task List") ?? raw;
    const placeholderHits = collectPatternHits(taskListBody, PLACEHOLDER_PATTERNS);
    findings.push({
      section: "Plan Quality Scan: Placeholders",
      required: strictPlanGuards,
      rule: "Task List must not contain placeholders (TODO/TBD/FIXME/<fill-in>/<your-*-here>/xxx/ellipsis).",
      found: placeholderHits.length === 0,
      details:
        placeholderHits.length === 0
          ? "No placeholder tokens detected in Task List."
          : `Detected placeholder token(s) in Task List: ${placeholderHits.join(", ")}.`
    });

    const scopeArtifact = await resolveStageArtifactPath("scope", {
      projectRoot,
      track,
      intent: "read"
    });
    const scopeRaw = (await exists(scopeArtifact.absPath))
      ? await fs.readFile(scopeArtifact.absPath, "utf8")
      : "";
    const scopeDecisionIds = extractDecisionIds(scopeRaw);
    const missingDecisionRefs = scopeDecisionIds.filter((id) => !raw.includes(id));
    findings.push({
      section: "Locked Decision Traceability",
      required: strictPlanGuards && scopeDecisionIds.length > 0,
      rule: "Every locked decision ID (D-XX) in scope must be referenced in plan.",
      found: missingDecisionRefs.length === 0,
      details:
        scopeDecisionIds.length === 0
          ? "No D-XX IDs found in scope artifact; traceability check skipped."
          : missingDecisionRefs.length === 0
            ? `All ${scopeDecisionIds.length} scope decision IDs are referenced in plan.`
            : `Missing scope decision reference(s) in plan: ${missingDecisionRefs.join(", ")}.`
    });

    const reductionHits = collectPatternHits(taskListBody, SCOPE_REDUCTION_PATTERNS);
    findings.push({
      section: "Plan Quality Scan: Scope Reduction",
      required: strictPlanGuards && scopeDecisionIds.length > 0,
      rule: "Task List must not include scope-reduction language when locked decisions exist.",
      found: reductionHits.length === 0,
      details:
        scopeDecisionIds.length === 0
          ? "No locked decisions found in scope artifact; scope-reduction scan is advisory."
          : reductionHits.length === 0
            ? "No scope-reduction phrases detected in Task List."
            : `Detected scope-reduction phrase(s) in Task List: ${reductionHits.join(", ")}.`
    });

    const authoredTaskIds = extractTaskIds(taskListBody);
    const acceptanceMappingBody = sectionBodyByName(sections, "Acceptance Mapping") ?? "";
    const acTaskLinks = [
      ...extractAcceptanceTaskLinks(taskListBody),
      ...extractAcceptanceTaskLinks(acceptanceMappingBody)
    ];
    const mappedTaskToAcs = new Map<string, Set<string>>();
    const mappedAcToTasks = new Map<string, Set<string>>();
    for (const link of acTaskLinks) {
      const taskSet = mappedTaskToAcs.get(link.taskId) ?? new Set<string>();
      taskSet.add(link.acId);
      mappedTaskToAcs.set(link.taskId, taskSet);

      const acSet = mappedAcToTasks.get(link.acId) ?? new Set<string>();
      acSet.add(link.taskId);
      mappedAcToTasks.set(link.acId, acSet);
    }
    const tasksMissingAc = [...authoredTaskIds].filter((taskId) => !mappedTaskToAcs.has(taskId));

    let specAcIds: string[] = [];
    const specArtifact = await resolveStageArtifactPath("spec", {
      projectRoot,
      track,
      intent: "read"
    });
    if (await exists(specArtifact.absPath)) {
      try {
        const specRaw = await fs.readFile(specArtifact.absPath, "utf8");
        const specSections = extractH2Sections(specRaw);
        const acceptanceBody = sectionBodyByName(specSections, "Acceptance Criteria") ?? specRaw;
        specAcIds = extractAcceptanceCriterionIdsFromMarkdown(acceptanceBody);
      } catch {
        specAcIds = [];
      }
    }
    const acsMissingTask = specAcIds.filter((acId) => !mappedAcToTasks.has(acId));
    const mappingFound = authoredTaskIds.size > 0 &&
      tasksMissingAc.length === 0 &&
      acsMissingTask.length === 0;
    findings.push({
      section: "plan_acceptance_mapped",
      required: authoredTaskIds.size > 0,
      rule: "Every T-NNN task must reference >=1 AC-N, and every AC-N from spec must be referenced by >=1 plan task.",
      found: mappingFound,
      details: authoredTaskIds.size === 0
        ? "Task List has no T-NNN ids; acceptance mapping check skipped."
        : tasksMissingAc.length > 0
          ? `Task(s) missing AC mapping: ${tasksMissingAc.join(", ")}. Add AC-N references in Task List or Acceptance Mapping.`
          : acsMissingTask.length > 0
            ? `Spec AC(s) missing task coverage: ${acsMissingTask.join(", ")}.`
            : specAcIds.length === 0
              ? `Mapped ${authoredTaskIds.size} task(s) to AC ids; spec artifact AC list is empty or unavailable.`
              : `Mapped ${authoredTaskIds.size} task(s) across ${specAcIds.length} spec AC(s).`
    });

    // Universal Layer 2.5 structural checks (superpowers writing-plans + ce-plan).
    // Plan-wide placeholder scan (broader than Task List) using the
    // FORBIDDEN_PLACEHOLDER_TOKENS list shared with the cross-cutting block.
    const planHeaderBody = sectionBodyByName(sections, "Plan Header");
    if (planHeaderBody !== null) {
      const required = ["Goal:", "Architecture:", "Tech Stack:"];
      const missing = required.filter(
        (token) => !new RegExp(token.replace(":", "\\s*:"), "iu").test(planHeaderBody)
      );
      findings.push({
        section: "Plan Header Coverage",
        required: true,
        rule: "Plan Header must include Goal, Architecture, and Tech Stack lines.",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Plan Header covers Goal/Architecture/Tech Stack."
          : `Plan Header is missing field(s): ${missing.join(", ")}.`
      });
    }

    const unitBlocks = raw.match(/###\s+Implementation Unit\s+U-\d+/giu) ?? [];
    if (unitBlocks.length > 0) {
      const requiredKeys = ["Goal:", "Files", "Approach:", "Test scenarios:", "Verification:"];
      const blockBodies = raw.split(/(?=###\s+Implementation Unit\s+U-\d+)/iu).slice(1);
      const validBlocks = blockBodies.filter((block) =>
        requiredKeys.every((key) =>
          new RegExp(key.replace(":", "\\s*:"), "iu").test(block)
        )
      );
      findings.push({
        section: "Implementation Unit Shape",
        required: true,
        rule: "Each `### Implementation Unit U-<n>` must include Goal, Files, Approach, Test scenarios, Verification.",
        found: validBlocks.length === unitBlocks.length,
        details: validBlocks.length === unitBlocks.length
          ? `All ${unitBlocks.length} implementation unit(s) include the required fields.`
          : `${unitBlocks.length - validBlocks.length} implementation unit(s) are missing required fields.`
      });
    }

    const allPlaceholderTokens = FORBIDDEN_PLACEHOLDER_TOKENS.map((token) =>
      token.toLowerCase()
    );
    const authoredBody = extractAuthoredBody(raw);
    const lowerRaw = authoredBody.toLowerCase();
    const planWidePlaceholderHits = allPlaceholderTokens.filter((token) =>
      lowerRaw.includes(token)
    );
    // Strip the "## NO PLACEHOLDERS Rule" section (which lists tokens) and
    // any acknowledgement text from the scan to avoid false positives where
    // the plan deliberately references the rule by name.
    const placeholderRuleSection = sectionBodyByName(sections, "NO PLACEHOLDERS Rule");
    const ruleScanBody = (placeholderRuleSection ?? "").toLowerCase();
    const ruleAcceptedHits = ruleScanBody.length > 0
      ? allPlaceholderTokens.filter((token) => ruleScanBody.includes(token))
      : [];
    const filteredPlanHits = planWidePlaceholderHits.filter((token) => {
      // If the only occurrence is in the rule section, ignore it.
      if (!ruleAcceptedHits.includes(token)) return true;
      const occurrencesElsewhere = lowerRaw.split(token).length - 1
        - (ruleScanBody.split(token).length - 1);
      return occurrencesElsewhere > 0;
    });
    findings.push({
      section: "Plan-wide Placeholder Scan",
      required: false,
      rule: "Plan should not contain forbidden placeholder tokens outside the NO PLACEHOLDERS rule section.",
      found: filteredPlanHits.length === 0,
      details: filteredPlanHits.length === 0
        ? "No forbidden placeholder tokens detected outside the rule section."
        : `Detected forbidden token(s) elsewhere in plan: ${filteredPlanHits.join(", ")}.`
    });

    // advisory `plan_too_large_no_waves`. Fires when a
    // standard-track plan has more than the wave-split threshold of
    // implementation units AND the wave-plans/ directory is empty.
    // Linter advisories never block stage-complete (`required: false`),
    // so the agent gets a nudge to run `cclaw-cli internal plan-split-waves`
    // without the plan stage failing.
    try {
      const planUnits = parseImplementationUnits(raw);
      if (planUnits.length > PLAN_SPLIT_SMALL_PLAN_THRESHOLD) {
        const artifactsDir = path.dirname(absFile);
        const wavePlansDir = path.join(artifactsDir, "wave-plans");
        let wavePlansHasContent = false;
        try {
          const dirEntries = await fs.readdir(wavePlansDir);
          wavePlansHasContent = dirEntries.some((name) => /^wave-\d+\.md$/u.test(name));
        } catch {
          wavePlansHasContent = false;
        }
        if (!wavePlansHasContent) {
          findings.push({
            section: "plan_too_large_no_waves",
            required: false,
            rule: "Plans with > 50 implementation units benefit from being split into manageable waves via `cclaw-cli internal plan-split-waves`.",
            found: false,
            details:
              `Plan has ${planUnits.length} implementation unit(s) (threshold ${PLAN_SPLIT_SMALL_PLAN_THRESHOLD}) and no wave-plans/ directory yet. ` +
              "Run `cclaw-cli internal plan-split-waves` to break this plan into manageable waves; the linter is advisory only and will not block stage-complete."
          });
        }
      }
    } catch {
      // Parser errors should never block the linter — the advisory is
      // purely a nudge.
    }

    const handoffBody = sectionBodyByName(sections, "Execution Handoff");
    if (handoffBody !== null) {
      const ok = /(subagent-driven|inline executor)/iu.test(handoffBody);
      findings.push({
        section: "Execution Handoff Posture",
        required: true,
        rule: "Execution Handoff must declare a posture (Subagent-Driven or Inline executor).",
        found: ok,
        details: ok
          ? "Execution Handoff posture declared."
          : "Execution Handoff is missing a posture declaration (Subagent-Driven or Inline executor)."
      });
    }

    const planCalibratedBody = sectionBodyByName(sections, "Calibrated Findings");
    if (planCalibratedBody !== null) {
      const isEmpty = /none this stage|none\b/iu.test(planCalibratedBody);
      const findingRegex = new RegExp(CONFIDENCE_FINDING_REGEX_SOURCE, "iu");
      const validRows = planCalibratedBody
        .split("\n")
        .filter((line) => /^[-*]\s+\[/u.test(line.trim()))
        .filter((line) => findingRegex.test(line));
      const ok = isEmpty || validRows.length >= 1;
      findings.push({
        section: "Plan Calibrated Finding Format",
        required: false,
        rule: "Calibrated Findings should either declare `None this stage` or include at least one line in `[P1|P2|P3] (confidence: <n>/10) <path>[:<line>] — <description>` format.",
        found: ok,
        details: isEmpty
          ? "No calibrated findings recorded for this plan stage."
          : ok
            ? `Detected ${validRows.length} calibrated plan finding(s).`
            : "No calibrated findings detected in canonical format."
      });
    }

    const regressionIronBody = sectionBodyByName(sections, "Regression Iron Rule");
    if (regressionIronBody !== null) {
      const acknowledged = /iron\s+rule\s+acknowledged\s*:\s*yes\b/iu.test(regressionIronBody);
      findings.push({
        section: "Plan Regression Iron Rule Acknowledgement",
        required: false,
        rule: "Regression Iron Rule should include `Iron rule acknowledged: yes`.",
        found: acknowledged,
        details: acknowledged
          ? "Regression Iron Rule is explicitly acknowledged."
          : "Regression Iron Rule section is present but missing `Iron rule acknowledged: yes`."
      });
    }

    const layeredDocumentReview = evaluateLayeredDocumentReviewStatus(
      sections,
      CONFIDENCE_FINDING_REGEX_SOURCE
    );
    if (layeredDocumentReview !== null) {
      findings.push({
        section: "Document Reviewer Structured Findings",
        required: true,
        rule: "When Layered review references coherence-reviewer/scope-guardian-reviewer/feasibility-reviewer, include explicit reviewer status plus calibrated finding lines.",
        found: layeredDocumentReview.missingStructured.length === 0,
        details: layeredDocumentReview.missingStructured.length === 0
          ? `Structured findings present for reviewers: ${layeredDocumentReview.triggeredReviewers.join(", ")}.`
          : `Missing status or calibrated findings for: ${layeredDocumentReview.missingStructured.join(", ")}.`
      });
      findings.push({
        section: "document-review.fail_without_waiver",
        required: true,
        rule: "[P1] document-review.fail_without_waiver — reviewer FAIL/PARTIAL requires fix evidence or explicit waiver.",
        found: layeredDocumentReview.failOrPartialWithoutWaiver.length === 0,
        details: layeredDocumentReview.failOrPartialWithoutWaiver.length === 0
          ? "No unwaived FAIL/PARTIAL reviewer statuses detected."
          : `Unwaived FAIL/PARTIAL statuses: ${layeredDocumentReview.failOrPartialWithoutWaiver.join(", ")}.`
      });
    }

    const planUnits = parseImplementationUnits(raw);
    const parallelMetaApplies =
      strictPlanGuards && planUnits.length > 0;
    if (parallelMetaApplies) {
      const metaRulesRequired = true;
      const missingDepends: string[] = [];
      const missingPaths: string[] = [];
      const missingParallelMeta: string[] = [];
      for (const unit of planUnits) {
        const id = unit.id;
        if (!/\bdependsOn\s*:/iu.test(unit.body)) {
          missingDepends.push(id);
        }
        if (!/\bclaimedPaths\s*:/iu.test(unit.body)) {
          missingPaths.push(id);
        }
        if (!/\bparallelizable\s*:/iu.test(unit.body) || !/\briskTier\s*:/iu.test(unit.body)) {
          missingParallelMeta.push(id);
        }
      }
      findings.push({
        section: "plan_units_missing_dependsOn",
        required: metaRulesRequired,
        rule: "Every implementation unit must declare `dependsOn:` — use comma-separated unit ids or `none`.",
        found: missingDepends.length === 0,
        details:
          missingDepends.length === 0
            ? "All implementation units declare dependsOn."
            : `Missing dependsOn on: ${missingDepends.join(", ")}. Remediation: add a bullet \`- **dependsOn:** U-2, U-3\` or \`- **dependsOn:** none\`.`
      });
      findings.push({
        section: "plan_units_missing_claimedPaths",
        required: metaRulesRequired,
        rule: "Every implementation unit must declare explicit `claimedPaths:` predictions for parallel scheduling.",
        found: missingPaths.length === 0,
        details:
          missingPaths.length === 0
            ? "All implementation units declare claimedPaths."
            : `Missing claimedPaths on: ${missingPaths.join(", ")}. Remediation: add \`- **claimedPaths:** path/a, path/b\` (repo-relative globs or files).`
      });
      findings.push({
        section: "plan_units_missing_parallel_metadata",
        required: metaRulesRequired,
        rule: "Every implementation unit must declare `parallelizable:` and `riskTier:` (low|standard|high).",
        found: missingParallelMeta.length === 0,
        details:
          missingParallelMeta.length === 0
            ? "All implementation units carry parallelizable + riskTier."
            : `Missing parallel metadata on: ${missingParallelMeta.join(
              ", "
            )}. Remediation: add \`- **parallelizable:** true|false\` and \`- **riskTier:** low|standard|high\`.`
      });
      const parallelizableCount = planUnits.filter(
        (u) => parseImplementationUnitParallelFields(u).parallelizable
      ).length;
      const advisorySerial = parallelizableCount === 0 && planUnits.length > 1;
      findings.push({
        section: "plan_no_parallel_lanes_detected",
        required: false,
        rule: "When multiple independent units exist, consider marking at least one `parallelizable: true` with disjoint claimedPaths.",
        found: !advisorySerial,
        details: advisorySerial
          ? "All units are marked parallelizable false; scheduler will serialize. If surfaces are independent, opt units into parallelism explicitly."
          : "Parallel-ready units detected or plan is single-unit."
      });
    }

    // plan_parallel_exec_full_coverage + atomic wave metadata checks.
    // Every T-NNN task listed in the
    // plan's Task List must be assigned to a slice inside the
    // <!-- parallel-exec-managed-start --> block. Without this, TDD
    // cannot fan out work the plan never authored as waves; the previous
    // failure mode was `stage-complete tdd` succeeding when only the
    // first batch of tasks had been wave-assigned.
    //
    // Spike rows (`S-N`) live in the same Task List but are excluded
    // because they are wall-clock spikes that produce evidence files
    // and are not part of the regular slice fan-out. A task is also
    // excluded when it appears under a `## Deferred Tasks` (or
    // `## Backlog`) heading inside the plan with an explicit reason.
    if (strictPlanGuards) {
      const taskListSection = sectionBodyByName(sections, "Task List") ?? "";
      const authoredTaskIds = extractTaskIds(taskListSection);

      // Collect deferred / backlog task ids so they don't trigger the
      // "uncovered" finding. Both heading variants are accepted.
      const deferredBody =
        (sectionBodyByName(sections, "Deferred Tasks") ?? "") +
        "\n" +
        (sectionBodyByName(sections, "Backlog") ?? "");
      const deferredIds = extractTaskIds(deferredBody);

      const parallelExecBody = extractParallelExecManagedBody(raw);
      const claimedIds = extractTaskIds(parallelExecBody);

      const uncovered: string[] = [];
      for (const id of authoredTaskIds) {
        if (claimedIds.has(id)) continue;
        if (deferredIds.has(id)) continue;
        uncovered.push(id);
      }
      uncovered.sort();

      const blockPresent = parallelExecBody.length > 0;
      const taskListPresent = authoredTaskIds.size > 0;

      findings.push({
        section: "plan_parallel_exec_full_coverage",
        required: taskListPresent,
        rule:
          "Every T-NNN task in `## Task List` must be assigned to at least one slice inside the `<!-- parallel-exec-managed-start -->` block (or moved to an explicit `## Deferred Tasks` / `## Backlog` section). TDD cannot fan out waves the plan never authored.",
        found: taskListPresent && blockPresent && uncovered.length === 0,
        details: !taskListPresent
          ? "Task List section is empty or missing T-NNN ids; full-coverage check skipped."
          : !blockPresent
            ? "`<!-- parallel-exec-managed-start -->` block is missing or empty. Author the Parallel Execution Plan with W-02..W-N covering every task before plan-final-approval."
            : uncovered.length === 0
              ? `Parallel Execution Plan covers all ${authoredTaskIds.size} authored task id(s); ${deferredIds.size} task id(s) are explicitly deferred.`
              : `Uncovered task id(s) — author waves for: ${uncovered.slice(0, 25).join(", ")}${uncovered.length > 25 ? `, … (${uncovered.length - 25} more)` : ""}. Either add slices for them inside <!-- parallel-exec-managed-start --> or move them under \`## Deferred Tasks\` with a reason.`
      });

      const waveMeta = parseParallelWaveTableMetadata(raw);
      const pathConflicts: string[] = [];
      for (const wave of waveMeta) {
        const rows = wave.rows;
        for (let i = 0; i < rows.length; i += 1) {
          for (let j = i + 1; j < rows.length; j += 1) {
            const left = rows[i]!;
            const right = rows[j]!;
            const rightPathSet = new Set(right.claimedPaths);
            const overlap = left.claimedPaths.filter((p) => rightPathSet.has(p));
            if (overlap.length === 0) continue;
            pathConflicts.push(
              `${wave.waveId} ${left.sliceId}<->${right.sliceId} overlap: ${overlap.join(", ")}`
            );
          }
        }
      }
      findings.push({
        section: "plan_wave_paths_disjoint",
        required: taskListPresent,
        rule:
          "Slices within the same wave must keep `claimedPaths` disjoint so TDD can safely fan out parallel slice-builders.",
        found: taskListPresent && blockPresent && pathConflicts.length === 0,
        details: !taskListPresent
          ? "Task List section is empty or missing T-NNN ids; disjoint-path wave check skipped."
          : !blockPresent
            ? "`<!-- parallel-exec-managed-start -->` block is missing or empty; cannot validate wave path disjointness."
            : pathConflicts.length === 0
              ? "All parsed same-wave slice rows have disjoint claimedPaths."
              : `Overlapping claimedPaths detected: ${pathConflicts.slice(0, 12).join(" | ")}${pathConflicts.length > 12 ? ` | … (${pathConflicts.length - 12} more)` : ""}.`
      });

      const invalidLanes: string[] = [];
      for (const wave of waveMeta) {
        for (const row of wave.rows) {
          if (!row.lane) continue;
          if (!PLAN_LANE_WHITELIST.has(row.lane)) {
            invalidLanes.push(`${wave.waveId}/${row.sliceId}:${row.lane}`);
          }
        }
      }
      findings.push({
        section: "plan_lane_meaningful",
        required: false,
        rule:
          "When a lane is declared, it must be one of: production, test, docs, infra, scaffold, migration.",
        found: invalidLanes.length === 0,
        details: invalidLanes.length === 0
          ? "All declared lane values are either omitted or in the approved lane whitelist."
          : `Invalid lane value(s): ${invalidLanes.join(", ")}. Remove lane or use a whitelisted value.`
      });

      const inconsistentParallelizable: string[] = [];
      for (const wave of waveMeta) {
        const hasSerialSlice = wave.rows.some((row) => row.parallelizable === false);
        if (!hasSerialSlice) continue;
        if (!waveHasSequentialModeHint(wave)) {
          const serialSlices = wave.rows
            .filter((row) => row.parallelizable === false)
            .map((row) => row.sliceId)
            .join(", ");
          inconsistentParallelizable.push(`${wave.waveId} [${serialSlices}]`);
        }
      }
      findings.push({
        section: "plan_parallelizable_consistency",
        required: false,
        rule:
          "Waves containing `parallelizable: false` slices should be explicitly marked sequential in wave notes/mode.",
        found: inconsistentParallelizable.length === 0,
        details: inconsistentParallelizable.length === 0
          ? "No serial slices were found outside a sequentially-labeled wave context."
          : `Serial slice(s) found without sequential wave mode hints in: ${inconsistentParallelizable.join(", ")}. Add a wave mode/note indicating sequential execution.`
      });

      const mermaidBlocks = raw.match(/```mermaid[\s\S]*?```/giu) ?? [];
      const hasParallelExecMermaid = mermaidBlocks.some((block) =>
        /(flowchart|gantt)/iu.test(block) && /\bW-\d+\b/iu.test(block) && /\bS-\d+\b/iu.test(block)
      );
      findings.push({
        section: "plan_parallel_exec_mermaid_present",
        required: false,
        rule:
          "Plan should include a mermaid flowchart/gantt for parallel waves and slice dependencies to make fanout shape visually reviewable.",
        found: hasParallelExecMermaid,
        details: hasParallelExecMermaid
          ? "Mermaid visualization for parallel execution waves is present."
          : "No mermaid parallel-execution visualization found (advisory). Add a ` ```mermaid ` flowchart or gantt with W-* and S-* nodes."
      });
    }
}
