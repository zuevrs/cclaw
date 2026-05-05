import {
  type StageLintContext,
  evaluateInvestigationTrace,
  evaluateLayeredDocumentReviewStatus,
  extractAuthoredBody,
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

    // plan_parallel_exec_full_coverage: every T-NNN task listed in the
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
    }
}
