import {
  type StageLintContext,
  sectionBodyByName
} from "./shared.js";

export async function lintTddStage(ctx: StageLintContext): Promise<void> {
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

    // Universal Layer 2.6 structural checks (superpowers TDD + evanflow vertical slices).
    const ironLawBody = sectionBodyByName(sections, "Iron Law Acknowledgement");
    if (ironLawBody === null) {
      findings.push({
        section: "TDD Iron Law Acknowledgement",
        required: true,
        rule: "Iron Law Acknowledgement must affirm `Acknowledged: yes`.",
        found: false,
        details: "No ## heading matching required section \"Iron Law Acknowledgement\"."
      });
    } else {
      const ack = /acknowledged:\s*(yes|true|y)\b/iu.test(ironLawBody);
      findings.push({
        section: "TDD Iron Law Acknowledgement",
        required: true,
        rule: "Iron Law Acknowledgement must affirm `Acknowledged: yes`.",
        found: ack,
        details: ack
          ? "TDD Iron Law acknowledged."
          : "Iron Law Acknowledgement is missing explicit `Acknowledged: yes`."
      });
    }

    const watchedRedBody = sectionBodyByName(sections, "Watched-RED Proof");
    if (watchedRedBody === null) {
      findings.push({
        section: "Watched-RED Proof Shape",
        required: true,
        rule: "Watched-RED Proof must include at least one populated row, and each row must include an ISO timestamp showing when the test was observed failing.",
        found: false,
        details: "No ## heading matching required section \"Watched-RED Proof\"."
      });
    } else {
      const rows = watchedRedBody.split("\n").filter((line) => /^\|/u.test(line));
      const dataRows = rows.length >= 3 ? rows.slice(2) : [];
      const populatedRows = dataRows.filter((row) =>
        row
          .split("|")
          .slice(1, -1)
          .filter((_, idx) => idx !== 0) // skip slice column
          .some((cell) => cell.trim().length > 0)
      );
      // Each populated row must include an ISO timestamp in column 3.
      const isoRegex = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u;
      const validProofRows = populatedRows.filter((row) => isoRegex.test(row));
      const hasPopulatedRows = populatedRows.length > 0;
      const allRowsHaveIso = validProofRows.length === populatedRows.length;
      findings.push({
        section: "Watched-RED Proof Shape",
        required: true,
        rule: "Watched-RED Proof must include at least one populated row, and each row must include an ISO timestamp showing when the test was observed failing.",
        found: hasPopulatedRows && allRowsHaveIso,
        details: !hasPopulatedRows
          ? "Watched-RED Proof has no populated rows; add at least one slice row with observed RED evidence."
          : allRowsHaveIso
            ? `All ${populatedRows.length} watched-RED proof row(s) include an ISO timestamp.`
            : `${populatedRows.length - validProofRows.length} watched-RED proof row(s) lack an ISO timestamp.`
      });
    }

    const sliceCycleBody = sectionBodyByName(sections, "Vertical Slice Cycle");
    if (sliceCycleBody === null) {
      findings.push({
        section: "Vertical Slice Cycle Coverage",
        required: true,
        rule: "Vertical Slice Cycle must include RED, GREEN, and REFACTOR per slice (refactor may be deferred with rationale).",
        found: false,
        details: "No ## heading matching required section \"Vertical Slice Cycle\"."
      });
    } else {
      const required = ["RED", "GREEN", "REFACTOR"];
      const missing = required.filter(
        (token) => !new RegExp(token, "u").test(sliceCycleBody)
      );
      findings.push({
        section: "Vertical Slice Cycle Coverage",
        required: true,
        rule: "Vertical Slice Cycle must include RED, GREEN, and REFACTOR per slice (refactor may be deferred with rationale).",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Vertical Slice Cycle references RED/GREEN/REFACTOR."
          : `Vertical Slice Cycle is missing phase token(s): ${missing.join(", ")}.`
      });
    }

    const assertionBody = sectionBodyByName(sections, "Assertion Correctness Notes");
    if (assertionBody !== null) {
      const tableRows = assertionBody.split("\n").filter((line) => /^\|/u.test(line));
      const dataRows = tableRows.length >= 3 ? tableRows.slice(2) : [];
      const ok = dataRows.length === 0 || dataRows.some((row) =>
        row
          .split("|")
          .slice(1, -1)
          .some((cell) => cell.trim().length > 0)
      );
      findings.push({
        section: "Assertion Correctness Notes Shape",
        required: true,
        rule: "Assertion Correctness Notes must include at least one populated row when the slice has new assertions.",
        found: ok,
        details: ok
          ? "Assertion Correctness Notes is populated or absent (single-step slice)."
          : "Assertion Correctness Notes table has no populated rows."
      });
    }

    const testDiscoveryBody = sectionBodyByName(sections, "Test Discovery") ?? "";
    const redEvidenceBody = sectionBodyByName(sections, "RED Evidence") ?? "";
    const mockPreferenceScanBody = `${testDiscoveryBody}\n${redEvidenceBody}`;
    const mockTokenRegex =
      /\b(jest\.mock|vi\.mock|sinon\.stub|mock\.patch|unittest\.mock|magicmock|spyon|tohavebeencalled)\b/iu;
    if (mockTokenRegex.test(mockPreferenceScanBody)) {
      const boundaryJustificationRegex =
        /\b(justified\s+by\s+boundary|boundary:\s*[A-Za-z0-9/_ -]*(network|fs|filesystem|time|clock|external)|network|filesystem|clock|external\s+service)\b/iu;
      const hasBoundaryJustification = boundaryJustificationRegex.test(mockPreferenceScanBody);
      const realPathRegex = /\b(?:src|lib|packages|apps)\/[A-Za-z0-9_./-]+\b/u;
      const hasRealPathHint = realPathRegex.test(mockPreferenceScanBody);
      findings.push({
        section: "Mock Preference Heuristic",
        required: false,
        rule: "When mocks/spies appear in Test Discovery or RED Evidence, prefer Real > Fake > Stub > Mock. Mock-heavy slices need explicit boundary justification (network/fs/time/external).",
        found: hasBoundaryJustification,
        details: hasBoundaryJustification
          ? "Mock usage is explicitly justified by boundary constraints."
          : hasRealPathHint
            ? "Mocks/spies detected while real implementation paths are listed; prefer Real > Fake > Stub > Mock unless a boundary justification is added."
            : "Mocks/spies detected without boundary justification; add explicit trust-boundary rationale or replace with real/fake/stub coverage."
      });
    }
}
