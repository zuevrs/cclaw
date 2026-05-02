import {
  type StageLintContext,
  checkCriticPredictionsContract,
  evaluateQaLogFloor,
  sectionBodyByHeadingPrefix,
  sectionBodyByName,
  extractCanonicalScopeMode,
  getMarkdownTableRows
} from "./shared.js";
import {
  readDelegationLedger,
  recordExpansionStrategistSkippedByTrack
} from "../delegation.js";
import { shouldDemoteArtifactValidationByTrack } from "../content/stage-schema.js";
import { readFlowState } from "../run-persistence.js";

export async function lintScopeStage(ctx: StageLintContext): Promise<void> {
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
    activeStageFlags,
    taskClass
  } = ctx;

    const lockedDecisionsBody = sectionBodyByHeadingPrefix(sections, "Locked Decisions") ?? "";
    const scopeSummaryBody = sectionBodyByName(sections, "Scope Summary") ?? "";
    const selectedScopeMode = extractCanonicalScopeMode(scopeSummaryBody);
    const qaLogBody = sectionBodyByName(sections, "Q&A Log");
    const qaLogRows = qaLogBody ? getMarkdownTableRows(qaLogBody) : [];
    const qaLogOk = qaLogBody !== null && qaLogRows.length > 0;
    findings.push({
      section: "qa_log_missing",
      required: false,
      rule: "[P2] qa_log_missing — Q&A Log empty — confirm you actually had a dialogue with the user, not a draft from memory.",
      found: qaLogOk,
      details: qaLogOk
        ? `Q&A Log contains ${qaLogRows.length} data row(s).`
        : qaLogBody === null
          ? "Missing `## Q&A Log` section."
          : "Q&A Log is present but has zero data rows."
    });

    {
      const skipQuestions = activeStageFlags.includes("--skip-questions");
      const floor = evaluateQaLogFloor(qaLogBody, track, "scope", { discoveryMode: ctx.discoveryMode, skipQuestions });
      findings.push({
        section: "qa_log_unconverged",
        required: !floor.skipQuestionsAdvisory,
        rule: "[P1] qa_log_unconverged — Q&A Log has not converged for this stage. Continue elicitation until every forcing-question topic id is tagged with `[topic:<id>]` on at least one row, the last 2 rows produce no decision-changing impact (Ralph-Loop), or an explicit user stop-signal row is appended.",
        found: floor.ok,
        details: floor.details
      });
    }

    const strategistRequired =
      selectedScopeMode === "SCOPE EXPANSION" || selectedScopeMode === "SELECTIVE EXPANSION";
    if (strategistRequired) {
      // Wave 25 (v6.1.0) — for `track === "quick"` (lite-tier) or
      // `taskClass === "software-bugfix"`, the Expansion Strategist
      // delegation requirement is dropped entirely. The user's
      // 3-file static landing page hit this gate without any
      // discovery scope — pure ceremony for trivial work. Standard
      // tracks remain unchanged.
      const skipByTrack = shouldDemoteArtifactValidationByTrack(track, taskClass);
      if (skipByTrack) {
        findings.push({
          section: "Product Discovery Delegation (Strategist Mode)",
          required: false,
          rule: "When Scope Summary selects SCOPE EXPANSION or SELECTIVE EXPANSION, a completed `product-discovery` delegation for the active run with non-empty evidenceRefs is required.",
          found: true,
          details:
            `Product-discovery delegation requirement skipped for track="${track}"` +
            (taskClass ? `, taskClass="${taskClass}"` : "") +
            ` (Wave 25: lite-tier escape; selectedMode=${selectedScopeMode}).`
        });
        // Best-effort audit; we read the flow-state runId here
        // because StageLintContext does not surface it directly.
        try {
          const flowState = await readFlowState(projectRoot);
          const runId = flowState.activeRunId ?? null;
          if (runId) {
            await recordExpansionStrategistSkippedByTrack(projectRoot, {
              track,
              taskClass: taskClass ?? null,
              runId,
              selectedScopeMode
            }).catch(() => {});
          }
        } catch {
          // Audit is best-effort; never block scope linting.
        }
      } else {
        const delegationLedger = await readDelegationLedger(projectRoot);
        const discoveryRows = delegationLedger.entries.filter(
          (entry) =>
            entry.stage === "scope" &&
            entry.agent === "product-discovery" &&
            entry.runId === delegationLedger.runId &&
            entry.status === "completed"
        );
        const hasCompleted = discoveryRows.length > 0;
        const hasEvidence = discoveryRows.some(
          (entry) => Array.isArray(entry.evidenceRefs) && entry.evidenceRefs.length > 0
        );
        findings.push({
          section: "Product Discovery Delegation (Strategist Mode)",
          required: true,
          rule: "When Scope Summary selects SCOPE EXPANSION or SELECTIVE EXPANSION, a completed `product-discovery` delegation for the active run with non-empty evidenceRefs is required.",
          found: hasCompleted && hasEvidence,
          details: !hasCompleted
            ? `Scope mode ${selectedScopeMode} requires a completed product-discovery delegation row for active run ${delegationLedger.runId}. In SELECTIVE EXPANSION / SCOPE EXPANSION, run product-discovery (mode=proactive) BEFORE stage-complete.`
            : hasEvidence
              ? `product-discovery delegation satisfied for mode ${selectedScopeMode}.`
              : "product-discovery delegation exists but evidenceRefs is empty; add at least one artifact/code evidence reference."
        });
      }
    }

    const criticPredictions = checkCriticPredictionsContract(sections);
    if (criticPredictions !== null) {
      findings.push({
        section: "critic.predictions_missing",
        required: false,
        rule: "[P2] critic.predictions_missing — pre-commitment predictions block missing or empty",
        found: criticPredictions.found,
        details: criticPredictions.details
      });
    }

    if (sectionBodyByHeadingPrefix(sections, "Locked Decisions") !== null) {
      // D-XX IDs are the stable contract. The legacy LD#<sha8> hash anchor
      // check was removed in Wave 22 (v4.0.0) — it caused agents to spam
      // shell hash commands when shifting decision rows around, and provided
      // no signal beyond the D-XX uniqueness check below.
      const listDecisionLines = lockedDecisionsBody
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => /^[-*]\s+\S/u.test(line));
      const tableDecisionRows = getMarkdownTableRows(lockedDecisionsBody);
      const tableDecisionLines = tableDecisionRows.map((row) => row.join(" | "));
      const decisionLines = [...listDecisionLines, ...tableDecisionLines];
      const orphanDecisionLines = decisionLines.filter((line) => !/\bD-\d+\b/u.test(line));
      const rowDecisionIds = [
        ...listDecisionLines.map((line) => /\bD-\d+\b/u.exec(line)?.[0]),
        ...tableDecisionRows.map((row) => /\bD-\d+\b/u.exec(row[0] ?? "")?.[0])
      ].filter((id): id is string => typeof id === "string");
      const duplicateIds: string[] = (() => {
        const counts = new Map<string, number>();
        for (const id of rowDecisionIds) counts.set(id, (counts.get(id) ?? 0) + 1);
        return [...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id);
      })();
      const issues: string[] = [];
      if (rowDecisionIds.length === 0 && decisionLines.length === 0) {
        issues.push("section is empty");
      }
      if (orphanDecisionLines.length > 0) {
        const examples = orphanDecisionLines
          .slice(0, 3)
          .map((line) => `\`${line.slice(0, 120)}\``)
          .join(", ");
        issues.push(
          `${orphanDecisionLines.length} decision row(s) missing a D-XX ID${examples.length > 0 ? `: ${examples}` : ""}`
        );
      }
      if (duplicateIds.length > 0) {
        issues.push(`duplicate IDs: ${duplicateIds.join(", ")}`);
      }
      findings.push({
        section: "Locked Decisions ID Integrity",
        required: false,
        rule: "Locked Decisions section must list each decision with a unique stable D-XX ID. (D-XX IDs replaced the legacy LD#<sha8> hash anchors in Wave 22.)",
        found: issues.length === 0,
        details:
          issues.length === 0
            ? `${rowDecisionIds.length} decision ID(s) recorded with no duplicates.`
            : issues.join("; ")
      });
    }

    // Wave 23 (v5.0.0): scope no longer owns architecture-tier alternatives
    // (`## Implementation Alternatives` was removed from the scope template
    // and stage schema). Design OWNS the architecture-tier decision via
    // `## Architecture Decision Record (ADR)` and `## Engineering Lock`.
    // The legacy linter rule `Implementation Alternatives Recommendation`
    // was removed in Wave 23 — if a legacy artifact still has the section,
    // it is now treated as informational only.
}
