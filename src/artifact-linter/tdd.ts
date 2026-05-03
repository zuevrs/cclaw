import fs from "node:fs/promises";
import path from "node:path";
import { readDelegationLedger } from "../delegation.js";
import {
  foldTddSliceLedger,
  readTddSliceLedger,
  type TddSliceLedgerEntry
} from "../tdd-slices.js";
import {
  type StageLintContext,
  evaluateInvestigationTrace,
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

  const sliceLedger = await readTddSliceLedger(projectRoot);
  const sidecarActive = sliceLedger.entries.length > 0;

    evaluateInvestigationTrace(ctx, "Watched-RED Proof");

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
    if (sidecarActive) {
      // v6.10.0 (T2): when 06-tdd-slices.jsonl carries rows, the sidecar is
      // the source of truth for RED observation evidence; the markdown
      // table is auto-derived (or left as a template stub) and must not
      // block stage advance.
      const sidecarResult = evaluateSidecarWatchedRed(sliceLedger.entries);
      findings.push({
        section: "Watched-RED Proof Shape",
        required: true,
        rule: "Watched-RED Proof: when 06-tdd-slices.jsonl is present, every slice row with status >= red must include redObservedAt, testFile, testCommand, and claimedPaths.",
        found: sidecarResult.ok,
        details: sidecarResult.details
      });
    } else if (watchedRedBody === null) {
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

    if (sidecarActive) {
      const cycleResult = evaluateSidecarSliceCycle(sliceLedger.entries);
      findings.push({
        section: "Vertical Slice Cycle Coverage",
        required: true,
        rule: "Vertical Slice Cycle: 06-tdd-slices.jsonl rows must show RED -> GREEN monotonic progression per slice; REFACTOR is satisfied by `refactor-done` (with refactorAt > greenAt) or `refactor-deferred` (with non-empty refactorRationale).",
        found: cycleResult.ok,
        details: cycleResult.details
      });
    } else {
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
        const cycleResult = parseVerticalSliceCycle(sliceCycleBody);
        findings.push({
          section: "Vertical Slice Cycle Coverage",
          required: true,
          rule: "Vertical Slice Cycle must show RED -> GREEN -> REFACTOR monotonic progression per slice (refactor may be deferred with one-line rationale, e.g. `deferred because <reason>`).",
          found: cycleResult.ok,
          details: cycleResult.details
        });
      }
    }

    if (!sidecarActive) {
      // Advisory nudge: stage finished without ever migrating to the sidecar.
      // Detect "filled markdown" by checking whether the Watched-RED Proof
      // table or Vertical Slice Cycle has any populated rows.
      const sliceCycleBodyAdvisory = sectionBodyByName(sections, "Vertical Slice Cycle");
      const watchedRedBodyAdvisory = sectionBodyByName(sections, "Watched-RED Proof");
      const markdownIsAuthored =
        hasPopulatedTableRows(watchedRedBodyAdvisory) ||
        hasPopulatedTableRows(sliceCycleBodyAdvisory);
      if (markdownIsAuthored) {
        findings.push({
          section: "tdd_slice_ledger_missing",
          required: false,
          rule: "When markdown TDD tables are filled, prefer recording slice events via `cclaw-cli internal tdd-slice-record` so 06-tdd-slices.jsonl becomes the source of truth.",
          found: false,
          details:
            "06-tdd-slices.jsonl is empty even though the markdown tables are populated. Migrate this stage's slices to the sidecar with `cclaw-cli internal tdd-slice-record --slice <id> --status <red|green|refactor-done|refactor-deferred> ...`."
        });
      }
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

    const delegationLedger = await readDelegationLedger(projectRoot);
    const activeRunEntries = delegationLedger.entries.filter((entry) =>
      entry.stage === "tdd" && entry.runId === delegationLedger.runId
    );
    const completedSliceImplementers = activeRunEntries.filter((entry) =>
      entry.agent === "slice-implementer" && entry.status === "completed"
    );
    const fanOutDetected = completedSliceImplementers.length > 1;

    if (fanOutDetected) {
      const artifactsDir = path.dirname(absFile);
      const cohesionContractMarkdownPath = path.join(artifactsDir, "cohesion-contract.md");
      const cohesionContractJsonPath = path.join(artifactsDir, "cohesion-contract.json");

      let cohesionContractFound = true;
      const cohesionErrors: string[] = [];
      try {
        const markdown = await fs.readFile(cohesionContractMarkdownPath, "utf8");
        if (!/#\s*Cohesion Contract\b/u.test(markdown)) {
          cohesionContractFound = false;
          cohesionErrors.push("cohesion-contract.md exists but missing `# Cohesion Contract` heading.");
        }
      } catch {
        cohesionContractFound = false;
        cohesionErrors.push("cohesion-contract.md is missing.");
      }

      try {
        const jsonRaw = await fs.readFile(cohesionContractJsonPath, "utf8");
        const parsed: unknown = JSON.parse(jsonRaw);
        const objectLike = parsed !== null && typeof parsed === "object" && !Array.isArray(parsed);
        const parsedRecord = objectLike ? parsed as Record<string, unknown> : null;
        const hasRequiredShape =
          parsedRecord !== null &&
          Array.isArray(parsedRecord.sharedTypes) &&
          Array.isArray(parsedRecord.touchpoints) &&
          Array.isArray(parsedRecord.slices) &&
          parsedRecord.status !== undefined &&
          typeof parsedRecord.status === "object" &&
          parsedRecord.status !== null;
        if (!hasRequiredShape) {
          cohesionContractFound = false;
          cohesionErrors.push(
            "cohesion-contract.json must parse and include `sharedTypes[]`, `touchpoints[]`, `slices[]`, and `status`."
          );
        }
      } catch {
        cohesionContractFound = false;
        cohesionErrors.push("cohesion-contract.json is missing or invalid JSON.");
      }

      findings.push({
        section: "tdd.cohesion_contract_missing",
        required: true,
        rule: "When delegation ledger has >1 completed slice-implementer rows for active TDD run, require `.cclaw/artifacts/cohesion-contract.md` and parseable `.cclaw/artifacts/cohesion-contract.json` sidecar.",
        found: cohesionContractFound,
        details: cohesionContractFound
          ? `Fan-out detected (${completedSliceImplementers.length} completed slice-implementer rows); cohesion contract markdown+JSON sidecar are present and parseable.`
          : cohesionErrors.join(" ")
      });

      const completedOverseerRows = activeRunEntries.filter((entry) =>
        entry.agent === "integration-overseer" && entry.status === "completed"
      );
      const overseerStatusInEvidence = completedOverseerRows.some((entry) => {
        const refs = Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs.join(" ") : "";
        return /\b(?:PASS_WITH_GAPS|PASS)\b/u.test(refs);
      });
      const overseerStatusInArtifact = /\bintegration-overseer\b[\s\S]{0,200}\b(?:PASS_WITH_GAPS|PASS)\b/iu.test(raw);
      const integrationOverseerFound =
        completedOverseerRows.length > 0 &&
        (overseerStatusInEvidence || overseerStatusInArtifact);

      findings.push({
        section: "tdd.integration_overseer_missing",
        required: true,
        rule: "When fan-out is detected, require completed `integration-overseer` evidence with PASS or PASS_WITH_GAPS.",
        found: integrationOverseerFound,
        details: integrationOverseerFound
          ? "integration-overseer completion recorded with PASS/PASS_WITH_GAPS evidence."
          : completedOverseerRows.length === 0
            ? "Fan-out detected but no completed integration-overseer delegation row exists for active run."
            : "integration-overseer completion exists, but PASS/PASS_WITH_GAPS evidence is missing in delegation evidenceRefs and artifact text."
      });
    }

    {
      const verificationBody =
        sectionBodyByName(sections, "Verification Ladder") ??
        sectionBodyByName(sections, "Verification Status") ??
        sectionBodyByName(sections, "Verification");
      const ladderResult = evaluateVerificationLadder(verificationBody);
      findings.push({
        section: "tdd_verification_pending",
        required: true,
        rule: "Verification Ladder rows must not remain `pending`; promote each row to `passed`, `n/a`, `failed`, `skipped`, or `deferred` (with rationale) before stage-complete.",
        found: ladderResult.ok,
        details: ladderResult.details
      });
    }
}

interface ParsedSliceCycleResult {
  ok: boolean;
  details: string;
}

/**
 * v6.10.0 (T2) — sidecar-aware Watched-RED check. Validates that every
 * slice currently recorded in `06-tdd-slices.jsonl` (folded latest-row
 * per `sliceId`) has the structural evidence the markdown table would
 * have required: RED observation timestamp, test file, test command,
 * and at least one claimed path.
 */
export function evaluateSidecarWatchedRed(
  rawEntries: TddSliceLedgerEntry[]
): ParsedSliceCycleResult {
  if (rawEntries.length === 0) {
    return {
      ok: false,
      details: "Sidecar 06-tdd-slices.jsonl is empty; record at least one slice via `cclaw-cli internal tdd-slice-record`."
    };
  }
  const folded = foldTddSliceLedger(rawEntries);
  const errors: string[] = [];
  for (const entry of folded) {
    const issues: string[] = [];
    if (!entry.redObservedAt || entry.redObservedAt.trim().length === 0) {
      issues.push("missing redObservedAt");
    } else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(entry.redObservedAt)) {
      issues.push("redObservedAt is not an ISO timestamp");
    }
    if (!entry.testFile || entry.testFile.length === 0) {
      issues.push("missing testFile");
    }
    if (!entry.testCommand || entry.testCommand.length === 0) {
      issues.push("missing testCommand");
    }
    if (!Array.isArray(entry.claimedPaths) || entry.claimedPaths.length === 0) {
      issues.push("missing claimedPaths");
    }
    if (issues.length > 0) {
      errors.push(`${entry.sliceId}: ${issues.join(", ")}`);
    }
  }
  if (errors.length > 0) {
    return {
      ok: false,
      details: `Sidecar slice rows missing RED evidence fields: ${errors.join(" | ")}.`
    };
  }
  return {
    ok: true,
    details: `Sidecar 06-tdd-slices.jsonl has ${folded.length} slice row(s) with required RED evidence fields.`
  };
}

/**
 * v6.10.0 (T2) — sidecar-aware Vertical Slice Cycle check. Each slice
 * must have a row whose effective status (latest by sliceId) implies a
 * monotonic progression. Once a slice carries `greenAt`, the linter
 * requires `greenAt >= redObservedAt`. `refactor-deferred` requires a
 * non-empty `refactorRationale`. `refactor-done` requires a `refactorAt`
 * that is `>= greenAt`. Slices stuck at `red` are tolerated only when
 * the run is still in TDD; the linter surfaces them as advisory through
 * the watched-RED check above.
 */
export function evaluateSidecarSliceCycle(
  rawEntries: TddSliceLedgerEntry[]
): ParsedSliceCycleResult {
  if (rawEntries.length === 0) {
    return {
      ok: false,
      details: "Sidecar 06-tdd-slices.jsonl is empty; the vertical slice cycle has no rows."
    };
  }
  const folded = foldTddSliceLedger(rawEntries);
  const errors: string[] = [];
  for (const entry of folded) {
    if (entry.greenAt) {
      const redIso = parseTimestampCell(entry.redObservedAt ?? "");
      const greenIso = parseTimestampCell(entry.greenAt);
      if (greenIso === null) {
        errors.push(`${entry.sliceId}: greenAt is not an ISO timestamp.`);
        continue;
      }
      if (redIso !== null && greenIso < redIso) {
        errors.push(
          `${entry.sliceId}: greenAt (${entry.greenAt}) precedes redObservedAt (${entry.redObservedAt}) — order must be monotonic.`
        );
        continue;
      }
    }
    if (entry.status === "refactor-deferred") {
      if (!entry.refactorRationale || entry.refactorRationale.trim().length === 0) {
        errors.push(
          `${entry.sliceId}: status=refactor-deferred requires a non-empty refactorRationale.`
        );
        continue;
      }
    }
    if (entry.status === "refactor-done") {
      const greenIso = parseTimestampCell(entry.greenAt ?? "");
      const refactorIso = parseTimestampCell(entry.refactorAt ?? "");
      if (refactorIso === null) {
        errors.push(`${entry.sliceId}: status=refactor-done requires a refactorAt ISO timestamp.`);
        continue;
      }
      if (greenIso !== null && refactorIso < greenIso) {
        errors.push(
          `${entry.sliceId}: refactorAt (${entry.refactorAt}) precedes greenAt (${entry.greenAt}) — order must be monotonic.`
        );
        continue;
      }
    }
  }
  if (errors.length > 0) {
    return { ok: false, details: errors.join(" ") };
  }
  return {
    ok: true,
    details: `${folded.length} sidecar slice row(s) show monotonic RED -> GREEN -> REFACTOR (deferred-with-rationale accepted).`
  };
}

function hasPopulatedTableRows(body: string | null): boolean {
  if (body === null) return false;
  const tableLines = body.split("\n").filter((line) => /^\|/u.test(line));
  if (tableLines.length < 3) return false;
  const dataRows = tableLines.slice(2);
  for (const row of dataRows) {
    const cells = row
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    // Skip cells that are entirely placeholder slice IDs (S-1 default).
    const meaningful = cells.filter((cell, idx) => idx !== 0 && cell.length > 0);
    if (meaningful.length > 0) return true;
  }
  return false;
}

export function parseVerticalSliceCycle(body: string): ParsedSliceCycleResult {
  const tableLines = body.split("\n").filter((line) => /^\|/u.test(line));
  if (tableLines.length < 3) {
    return {
      ok: false,
      details: "Vertical Slice Cycle table must have a header, separator, and at least one slice row."
    };
  }
  const headerCells = splitMarkdownRow(tableLines[0]).map((cell) => cell.toLowerCase());
  const findIdx = (token: string): number =>
    headerCells.findIndex((cell) => cell.includes(token));
  const sliceIdx = findIdx("slice");
  const redIdx = findIdx("red");
  const greenIdx = findIdx("green");
  const refactorIdx = findIdx("refactor");
  if (sliceIdx < 0 || redIdx < 0 || greenIdx < 0 || refactorIdx < 0) {
    return {
      ok: false,
      details: "Vertical Slice Cycle header must include Slice, RED, GREEN, and REFACTOR columns."
    };
  }

  const dataRows = tableLines.slice(2);
  const populated = dataRows.filter((row) => splitMarkdownRow(row).some((cell) => cell.length > 0));
  if (populated.length === 0) {
    return {
      ok: false,
      details: "Vertical Slice Cycle has no populated slice rows."
    };
  }

  const errors: string[] = [];
  for (const row of populated) {
    const cells = splitMarkdownRow(row);
    const slice = cells[sliceIdx] ?? "";
    const red = cells[redIdx] ?? "";
    const green = cells[greenIdx] ?? "";
    const refactor = cells[refactorIdx] ?? "";
    const label = slice.length > 0 ? slice : `row ${populated.indexOf(row) + 1}`;

    const redTs = parseTimestampCell(red);
    const greenTs = parseTimestampCell(green);
    if (red.length === 0) {
      errors.push(`${label}: RED ts is empty.`);
      continue;
    }
    if (green.length === 0) {
      errors.push(`${label}: GREEN ts is empty.`);
      continue;
    }
    if (redTs === null) {
      errors.push(`${label}: RED ts \`${red}\` is not an ISO timestamp.`);
      continue;
    }
    if (greenTs === null) {
      errors.push(`${label}: GREEN ts \`${green}\` is not an ISO timestamp.`);
      continue;
    }
    if (greenTs < redTs) {
      errors.push(`${label}: GREEN (${green}) precedes RED (${red}) — order must be monotonic.`);
      continue;
    }

    if (refactor.length === 0) {
      errors.push(`${label}: REFACTOR cell is empty; provide a timestamp or \`deferred because <reason>\`.`);
      continue;
    }
    if (isDeferredOrNotNeeded(refactor)) {
      const rationale = extractDeferRationale(refactor);
      if (rationale.length === 0) {
        errors.push(
          `${label}: REFACTOR marked deferred/not-needed but rationale is missing — use \`deferred because <reason>\` or \`not needed because <reason>\`.`
        );
      }
      continue;
    }
    const refactorTs = parseTimestampCell(refactor);
    if (refactorTs === null) {
      errors.push(
        `${label}: REFACTOR cell \`${refactor}\` is not an ISO timestamp and not marked deferred/not-needed with rationale.`
      );
      continue;
    }
    if (refactorTs < greenTs) {
      errors.push(`${label}: REFACTOR (${refactor}) precedes GREEN (${green}) — order must be monotonic.`);
      continue;
    }
  }

  if (errors.length > 0) {
    return { ok: false, details: errors.join(" ") };
  }
  return {
    ok: true,
    details: `${populated.length} slice row(s) show monotonic RED -> GREEN -> REFACTOR (deferred-with-rationale accepted).`
  };
}

function splitMarkdownRow(line: string): string[] {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return [];
  const inner = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
  return inner.split("|").map((cell) => cell.trim());
}

function parseTimestampCell(cell: string): number | null {
  const trimmed = cell.replace(/^[`*_\s]+|[`*_\s]+$/gu, "");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(trimmed)) return null;
  const t = Date.parse(trimmed);
  return Number.isFinite(t) ? t : null;
}

function isDeferredOrNotNeeded(cell: string): boolean {
  return /\b(deferred|not[\s-]?needed|n\/?a|skipped)\b/iu.test(cell);
}

function extractDeferRationale(cell: string): string {
  const cleaned = cell.replace(/`/gu, "").trim();
  const match = /(?:deferred|not[\s-]?needed|skipped)\s+(?:because|since|due to|—|-)\s*(.+)/iu.exec(
    cleaned
  );
  if (match !== null && match[1] !== undefined && match[1].trim().length > 0) {
    return match[1].trim();
  }
  // Accept any free-form rationale text following the deferral marker.
  const fallback = cleaned.replace(/^\s*(deferred|not[\s-]?needed|skipped|n\/?a)\b[:\s-]*/iu, "").trim();
  return fallback;
}

interface VerificationLadderResult {
  ok: boolean;
  details: string;
}

export function evaluateVerificationLadder(body: string | null): VerificationLadderResult {
  if (body === null) {
    return {
      ok: true,
      details: "No Verification Ladder section present; rule advisory."
    };
  }
  const tableLines = body.split("\n").filter((line) => /^\|/u.test(line));
  if (tableLines.length < 3) {
    return {
      ok: true,
      details: "Verification Ladder section has no table rows; rule advisory."
    };
  }
  const dataRows = tableLines.slice(2);
  const pendingRows: string[] = [];
  for (const row of dataRows) {
    const cells = splitMarkdownRow(row);
    if (cells.length === 0) continue;
    if (cells.every((cell) => cell.length === 0)) continue;
    const cellsLower = cells.map((cell) => cell.toLowerCase().replace(/`/gu, "").trim());
    const hasPending = cellsLower.some((cell) => /\bpending\b/u.test(cell));
    if (hasPending) {
      const label = cells[0] !== undefined && cells[0].length > 0
        ? cells[0]
        : `row ${dataRows.indexOf(row) + 1}`;
      pendingRows.push(label);
    }
  }
  if (pendingRows.length === 0) {
    return {
      ok: true,
      details: "Verification Ladder has no rows still marked `pending`."
    };
  }
  return {
    ok: false,
    details:
      `Verification Ladder has ${pendingRows.length} row(s) still marked \`pending\`: ${pendingRows.join(", ")}. ` +
      "Promote each to `passed`, `n/a`, `failed`, `skipped`, or `deferred` (with rationale) before stage-complete."
  };
}
