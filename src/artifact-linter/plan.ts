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
    isTrivialOverride,
    legacyContinuation
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

    // v6.10.0 (P4) — advisory `plan_too_large_no_waves`. Fires when a
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
      const metaRulesRequired = !legacyContinuation;
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
        rule: "Every implementation unit must declare `dependsOn:` (v6.13.0) — use comma-separated unit ids or `none`.",
        found: missingDepends.length === 0,
        details:
          missingDepends.length === 0
            ? "All implementation units declare dependsOn."
            : `Missing dependsOn on: ${missingDepends.join(", ")}. Remediation: add a bullet \`- **dependsOn:** U-2, U-3\` or \`- **dependsOn:** none\`.`
      });
      findings.push({
        section: "plan_units_missing_claimedPaths",
        required: metaRulesRequired,
        rule: "Every implementation unit must declare explicit `claimedPaths:` predictions for parallel scheduling (v6.13.0).",
        found: missingPaths.length === 0,
        details:
          missingPaths.length === 0
            ? "All implementation units declare claimedPaths."
            : `Missing claimedPaths on: ${missingPaths.join(", ")}. Remediation: add \`- **claimedPaths:** path/a, path/b\` (repo-relative globs or files).`
      });
      findings.push({
        section: "plan_units_missing_parallel_metadata",
        required: metaRulesRequired,
        rule: "Every implementation unit must declare `parallelizable:` and `riskTier:` (low|standard|high) (v6.13.0).",
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
}
