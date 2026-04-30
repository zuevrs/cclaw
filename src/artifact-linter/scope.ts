import {
  type StageLintContext,
  checkCriticPredictionsContract,
  sectionBodyByHeadingPrefix,
  sectionBodyByName,
  extractCanonicalScopeMode,
  sectionBodyByAnyName,
  collectPatternHits,
  SCOPE_REDUCTION_PATTERNS,
  validateLockedDecisionAnchors,
  getMarkdownTableRows
} from "./shared.js";
import { readDelegationLedger } from "../delegation.js";

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
    isTrivialOverride
  } = ctx;

    const lockedDecisionsBody = sectionBodyByHeadingPrefix(sections, "Locked Decisions") ?? "";
    const scopeSummaryBody = sectionBodyByName(sections, "Scope Summary") ?? "";
    const selectedScopeMode = extractCanonicalScopeMode(scopeSummaryBody);
    const strictScopeGuards =
      parsedFrontmatter.hasFrontmatter ||
      sectionBodyByHeadingPrefix(sections, "Locked Decisions") !== null;
    const scopeSections = [
      sectionBodyByAnyName(sections, ["In Scope / Out of Scope", "In Scope", "Out of Scope"]) ?? "",
      sectionBodyByName(sections, "Scope Summary") ?? "",
      lockedDecisionsBody
    ].join("\n");
    const qaLogBody = sectionBodyByName(sections, "Q&A Log");
    const qaLogRows = qaLogBody ? getMarkdownTableRows(qaLogBody) : [];
    const qaLogOk = qaLogBody !== null && qaLogRows.length > 0;
    findings.push({
      section: "qa_log_missing",
      required: false,
      rule: "[P3] qa_log_missing — Q&A Log empty — confirm you actually had a dialogue with the user, not a draft from memory.",
      found: qaLogOk,
      details: qaLogOk
        ? `Q&A Log contains ${qaLogRows.length} data row(s).`
        : qaLogBody === null
          ? "Missing `## Q&A Log` section."
          : "Q&A Log is present but has zero data rows."
    });

    const strategistRequired =
      selectedScopeMode === "SCOPE EXPANSION" || selectedScopeMode === "SELECTIVE EXPANSION";
    if (strategistRequired) {
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
        section: "Expansion Strategist Delegation",
        required: true,
        rule: "When Scope Summary selects SCOPE EXPANSION or SELECTIVE EXPANSION, a completed `product-discovery` delegation for the active run with non-empty evidenceRefs is required.",
        found: hasCompleted && hasEvidence,
        details: !hasCompleted
          ? `Scope mode ${selectedScopeMode} requires a completed product-discovery delegation row for active run ${delegationLedger.runId}.`
          : hasEvidence
            ? `product-discovery delegation satisfied for mode ${selectedScopeMode}.`
            : "product-discovery delegation exists but evidenceRefs is empty; add at least one artifact/code evidence reference."
      });
    }

    const criticPredictions = checkCriticPredictionsContract(sections);
    if (criticPredictions !== null) {
      findings.push({
        section: "critic.predictions_missing",
        required: true,
        rule: "[P2] critic.predictions_missing — pre-commitment predictions block missing or empty",
        found: criticPredictions.found,
        details: criticPredictions.details
      });
    }

    const reductionHits = collectPatternHits(scopeSections, SCOPE_REDUCTION_PATTERNS);
    findings.push({
      section: "No Scope Reduction Language",
      required: strictScopeGuards,
      rule: "Scope boundary sections must not use reduction placeholders (`v1`, `for now`, `later`, `temporary`, `placeholder`).",
      found: reductionHits.length === 0,
      details:
        reductionHits.length === 0
          ? "No scope-reduction phrases detected in scope boundary sections."
          : `Detected scope-reduction phrase(s): ${reductionHits.join(", ")}.`
    });

    if (sectionBodyByHeadingPrefix(sections, "Locked Decisions") !== null) {
      const anchorValidation = validateLockedDecisionAnchors(lockedDecisionsBody);
      findings.push({
        section: "Locked Decisions Hash Integrity",
        required: true,
        rule: "Locked Decisions section must list unique LD#<sha8> content-derived anchors.",
        found: anchorValidation.ok,
        details: anchorValidation.details
      });

      // Legacy D-XX rows remain advisory for older artifacts, but new templates
      // use LD#hash anchors. This check keeps D-XX duplicates visible without
      // making old artifacts the primary contract.
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
        rule: "Locked Decisions section must list each decision with a unique stable D-XX ID.",
        found: issues.length === 0,
        details:
          issues.length === 0
            ? `${rowDecisionIds.length} decision ID(s) recorded with no duplicates.`
            : issues.join("; ")
      });
    }

    // Universal Layer 2.2 structural checks (gstack plan-ceo-review). All
    // present-only — they validate shape when the section exists.
    const altsBody = sectionBodyByName(sections, "Implementation Alternatives");
    if (altsBody !== null) {
      const recommendation = /^RECOMMENDATION:\s*(.+)$/imu.test(altsBody);
      findings.push({
        section: "Implementation Alternatives Recommendation",
        required: true,
        rule: "Implementation Alternatives must conclude with a `RECOMMENDATION:` line citing the chosen option and rationale.",
        found: recommendation,
        details: recommendation
          ? "Recommendation marker present."
          : "Missing or empty `RECOMMENDATION:` line under Implementation Alternatives."
      });
    }
}
