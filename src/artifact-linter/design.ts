// @ts-nocheck
import type { StageLintContext } from "./shared.js";

export async function lintDesignStage(ctx: StageLintContext): Promise<void> {
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
    shared
  } = ctx;
  const {
    resolveDesignDiagramTier,
    DESIGN_DIAGRAM_REQUIREMENTS,
    sectionBodyByName,
    meaningfulLineCount,
    runStaleDiagramAudit,
    markdownFieldRegex,
    CONFIDENCE_FINDING_REGEX_SOURCE
  } = shared as Record<string, any>;

    const tierResolution = await resolveDesignDiagramTier(projectRoot, track, raw);
    const diagramTier = isTrivialOverride
      ? "lightweight"
      : tierResolution.tier;
    const tierSource = isTrivialOverride
      ? `${tierResolution.source}; trivial override forced lightweight`
      : tierResolution.source;
    const hasDiagramMarkers = /<!--\s*diagram:\s*[a-z0-9-]+\s*-->/iu.test(raw);
    const skipDiagramRequirements = isTrivialOverride && !hasDiagramMarkers;
    if (skipDiagramRequirements) {
      findings.push({
        section: "Diagram Requirement: Architecture Diagram",
        required: true,
        rule: "Compact trivial-override slices may omit architecture diagram markers when they intentionally skip diagram work.",
        found: true,
        details: "Diagram requirement skipped: compact trivial-override slice without diagram markers."
      });
    } else {
      for (const requirement of DESIGN_DIAGRAM_REQUIREMENTS[diagramTier]) {
        const sectionBody = sectionBodyByName(sections, requirement.section);
        const hasSection = sectionBody !== null;
        const matchedMarker = requirement.markers.find((marker) => {
          const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
          const markerRegex = new RegExp(`<!--\\s*diagram:\\s*${escapedMarker}\\s*-->`, "iu");
          return sectionBody !== null && markerRegex.test(sectionBody);
        });
        const hasMarker = matchedMarker !== undefined;
        const hasContent = sectionBody !== null && meaningfulLineCount(sectionBody) > 0;
        const found = hasSection && hasMarker && hasContent;
        const markerList = requirement.markers.map((marker) => `<!-- diagram: ${marker} -->`).join(" or ");
        findings.push({
          section: `Diagram Requirement: ${requirement.section}`,
          required: true,
          rule: `Design tier "${diagramTier}" requires "${requirement.section}" with marker ${markerList}. ${requirement.note}`,
          found,
          details: found
            ? `Satisfied (${tierSource}).`
            : !hasSection
              ? `Missing section "${requirement.section}" (${tierSource}).`
              : !hasMarker
                ? `Missing marker (${markerList}) in section "${requirement.section}" (${tierSource}).`
                : `Section "${requirement.section}" has marker but no meaningful content (${tierSource}).`
        });
      }
    }

    if (staleDiagramAuditEnabled) {
      if (isTrivialOverride && !hasDiagramMarkers) {
        findings.push({
          section: "Stale Diagram Drift Check",
          required: true,
          rule: "When stale-diagram audit is enabled, compact trivial-override slices may skip the drift check only if no design diagram markers are present.",
          found: true,
          details: "Stale Diagram Audit skipped: artifact has no diagram markers (compact trivial-override slice)."
        });
      } else {
        const codebaseInvestigation = sectionBodyByName(sections, "Codebase Investigation");
        if (codebaseInvestigation === null) {
          findings.push({
            section: "Stale Diagram Drift Check",
            required: true,
            rule: "When stale-diagram audit is enabled, stale diagram audit requires Codebase Investigation blast-radius files.",
            found: false,
            details: "No ## heading matching required section \"Codebase Investigation\"."
          });
        } else {
          const staleAudit = await runStaleDiagramAudit(
            projectRoot,
            absFile,
            raw,
            codebaseInvestigation
          );
          findings.push({
            section: "Stale Diagram Drift Check",
            required: true,
            rule: "When stale-diagram audit is enabled, blast-radius files must not be newer than current design diagram baseline.",
            found: staleAudit.ok,
            details: staleAudit.details
          });
        }
      }
    }

    // Universal Layer 2.3 structural checks (gstack plan-eng-review). All
    // present-only. Validates regression iron-rule acknowledgment and
    // confidence-calibrated finding format.

    const regressionBody = sectionBodyByName(sections, "Regression Iron Rule");
    if (regressionBody !== null) {
      const ack = markdownFieldRegex("Iron rule acknowledged", "yes|true|y").test(regressionBody);
      findings.push({
        section: "Regression Iron Rule Acknowledgement",
        required: true,
        rule: "Regression Iron Rule section must affirm `Iron rule acknowledged: yes`.",
        found: ack,
        details: ack
          ? "Regression iron rule acknowledged."
          : "Regression Iron Rule is missing explicit `Iron rule acknowledged: yes`."
      });
    }

    const findingsBody = sectionBodyByName(sections, "Calibrated Findings");
    if (findingsBody !== null) {
      const isEmpty = /(^|\n)\s*-\s*None this stage\b/iu.test(findingsBody);
      const findingRegex = new RegExp(CONFIDENCE_FINDING_REGEX_SOURCE, "u");
      const validRows = findingsBody
        .split("\n")
        .filter((line) => /^[-*]\s+\[/u.test(line.trim()))
        .filter((line) => findingRegex.test(line));
      const ok = isEmpty || validRows.length >= 1;
      findings.push({
        section: "Calibrated Finding Format",
        required: true,
        rule: "Calibrated Findings must either declare `None this stage` or contain at least one finding in the form `[P1|P2|P3] (confidence: <n>/10) <path>[:<line>] — <description>`.",
        found: ok,
        details: isEmpty
          ? "No findings recorded for this stage."
          : ok
            ? `Detected ${validRows.length} calibrated finding(s).`
            : "No calibrated findings detected. Use `[P1|P2|P3] (confidence: <n>/10) <repo-path>[:<line>] — <description>`."
      });
    }
}
