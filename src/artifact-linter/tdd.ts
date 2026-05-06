import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  loadTddReadySlicePool,
  readDelegationLedger,
  readDelegationEvents,
  selectReadySlices
} from "../delegation.js";
import type { DelegationEntry, DelegationEvent } from "../delegation.js";
import { resolveArtifactPath as resolveStageArtifactPath } from "../artifact-paths.js";
import { exists } from "../fs-utils.js";
import {
  mergeParallelWaveDefinitions,
  parseParallelExecutionPlanWaves,
  parseWavePlanDirectory
} from "../internal/plan-split-waves.js";
import { compareSliceIds } from "../util/slice-id.js";
import {
  type LintFinding,
  type StageLintContext,
  extractAcceptanceCriterionIdsFromMarkdown,
  extractH2Sections,
  evaluateInvestigationTrace,
  sectionBodyByName
} from "./shared.js";

const SLICE_SUMMARY_START = "<!-- auto-start: tdd-slice-summary -->";
const SLICE_SUMMARY_END = "<!-- auto-end: tdd-slice-summary -->";
const SLICES_INDEX_START = "<!-- auto-start: slices-index -->";
const SLICES_INDEX_END = "<!-- auto-end: slices-index -->";
const execFileAsync = promisify(execFile);

/**
 * TDD stage linter.
 *
 * Source-of-truth ladder, in order of precedence:
 *
 * 1. **Phase events** in `delegation-events.jsonl` for the active run
 *    (`stage=tdd`, `sliceId=S-N`, `phase=red|green|refactor|refactor-deferred|doc`).
 *    When at least one slice carries any phase event, the linter
 *    auto-derives Watched-RED / Vertical Slice Cycle from the events
 *    and writes a rendered summary block between auto-render markers
 *    in `06-tdd.md`. Markdown table content is no longer required.
 * 2. **Hand-authored markdown tables** (Watched-RED Proof + Vertical
 *    Slice Cycle) — used as a fallback when the events ledger has no
 *    slice phase rows for the active run.
 * 3. **Sharded slice files** under `<artifacts-dir>/tdd-slices/S-*.md`.
 *    Per-slice prose lives there. The main `06-tdd.md` is auto-indexed
 *    via `## Slices Index`.
 */
export async function lintTddStage(ctx: StageLintContext): Promise<void> {
  const { projectRoot, discoveryMode, raw, absFile, sections, findings, parsedFrontmatter } = ctx;
  void parsedFrontmatter;

  const artifactsDir = path.dirname(absFile);
  const planPath = path.join(artifactsDir, "05-plan.md");
  let planRaw = "";
  try {
    planRaw = await fs.readFile(planPath, "utf8");
  } catch {
    planRaw = "";
  }

  evaluateInvestigationTrace(ctx, "Watched-RED Proof");

  const delegationLedger = await readDelegationLedger(ctx.projectRoot);
  const activeRunEntries = delegationLedger.entries.filter(
    (entry) => entry.stage === "tdd" && entry.runId === delegationLedger.runId
  );
  const slicesByEvents = groupBySlice(activeRunEntries);
  const eventsActive = slicesByEvents.size > 0;

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
  if (eventsActive) {
    const redResult = evaluateEventsWatchedRed(slicesByEvents);
    findings.push({
      section: "Watched-RED Proof Shape",
      required: true,
      rule: "Watched-RED Proof: when delegation-events.jsonl carries slice phase events, every slice with a phase=red row must include a non-empty evidenceRefs[] (test path, span ref, or pasted-output pointer) and a completedTs.",
      found: redResult.ok,
      details: redResult.details
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
        .filter((_, idx) => idx !== 0)
        .some((cell) => cell.trim().length > 0)
    );
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

  if (eventsActive) {
    const cycleResult = evaluateEventsSliceCycle(slicesByEvents);
    findings.push({
      section: "Vertical Slice Cycle Coverage",
      required: true,
      rule: "Vertical Slice Cycle: every slice with phase events must show RED before GREEN (completedTs monotonic), and a REFACTOR phase event (`refactor` with completedTs OR `refactor-deferred` with non-empty refactorRationale or evidenceRefs).",
      found: cycleResult.ok,
      details: cycleResult.details
    });
    for (const finding of cycleResult.findings) {
      findings.push(finding);
    }
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

  // slice-builder owns DOC inline. For every slice with a phase=green
  // row, require a matching phase=doc event whose evidenceRefs reference
  // `<artifacts-dir>/tdd-slices/S-<id>.md`. Mandatory only on deep
  // discoveryMode; advisory otherwise.
  if (eventsActive) {
    const docResult = evaluateSliceDocCoverage(slicesByEvents);
    if (docResult.missing.length > 0) {
      const required = discoveryMode === "deep";
      findings.push({
        section: "tdd_slice_doc_missing",
        required,
        rule: required
          ? "deep mode: every TDD slice with a phase=green event must also carry a slice-builder `phase=doc` event whose evidenceRefs reference `<artifacts-dir>/tdd-slices/S-<id>.md`."
          : "lean/guided modes: the slice-builder `phase=doc` event is advisory; the doc step may be folded into the GREEN span. Required only for deep mode.",
        found: false,
        details:
          `Slices missing per-slice DOC coverage: ${docResult.missing.join(", ")}. ` +
          (required
            ? "Have the slice-builder emit a `--phase doc` row referencing `tdd-slices/S-<id>.md` after GREEN."
            : "Either emit a `--phase doc` row referencing `tdd-slices/S-<id>.md` or fold the doc write into GREEN.")
      });
    }
  }

  // slice-builder must own GREEN. For each slice with a phase=red row
  // carrying non-empty evidenceRefs, require a matching phase=green event
  // whose `agent === "slice-builder"`. Catches "controller wrote GREEN
  // itself" backslides.
  if (eventsActive) {
    const implResult = evaluateSliceBuilderCoverage(slicesByEvents);
    if (implResult.missing.length > 0) {
      findings.push({
        section: "tdd_slice_builder_missing",
        required: true,
        rule: "Every TDD slice that recorded a phase=red event with non-empty evidenceRefs must reach phase=green via `slice-builder`. Controller writing GREEN production code itself is forbidden.",
        found: false,
        details: `Slices missing slice-builder-owned GREEN coverage: ${implResult.missing.join(", ")}. Dispatch slice-builder --slice <id> --phase green --paths <comma-separated production paths>.`
      });
    }
  }

  // Per-slice RED-before-GREEN only (no global-red wave barrier in the linter).
  if (eventsActive) {
    const perSliceResult = evaluatePerSliceRedBeforeGreen(slicesByEvents);
    if (!perSliceResult.ok) {
      findings.push({
        section: "tdd_slice_red_completed_before_green",
        required: true,
        rule: "Each slice's phase=green completedTs must be >= the same slice's last phase=red completedTs. Lanes run independently within a wave.",
        found: false,
        details: perSliceResult.details
      });
    }
  }

  const { events: jsonlEvents } = await readDelegationEvents(projectRoot);
  const runEvents = jsonlEvents.filter((e) => e.runId === delegationLedger.runId);

  if (eventsActive && planRaw.length > 0) {
    const ignoredWave = await evaluateWavePlanDispatchIgnored({
      artifactsDir,
      planMarkdown: planRaw,
      runEvents,
      runId: delegationLedger.runId,
      slices: slicesByEvents
    });
    if (ignoredWave) {
      findings.push(ignoredWave);
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

  const completedSliceBuilders = activeRunEntries.filter(
    (entry) => entry.agent === "slice-builder" && entry.status === "completed"
  );
  const fanOutDetected = completedSliceBuilders.length > 1;

  if (fanOutDetected) {
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
      rule: "When the delegation ledger has >1 completed slice-builder rows for the active TDD run, require `.cclaw/artifacts/cohesion-contract.md` and a parseable `.cclaw/artifacts/cohesion-contract.json` sidecar.",
      found: cohesionContractFound,
      details: cohesionContractFound
        ? `Fan-out detected (${completedSliceBuilders.length} completed slice-builder rows); cohesion contract markdown+JSON sidecar are present and parseable.`
        : `${cohesionErrors.join(" ")} Use \`cclaw-cli internal cohesion-contract --stub\` only as a scaffold; the gate expects real cohesion data for fan-out waves.`
    });

    const completedOverseerRows = activeRunEntries.filter(
      (entry) => entry.agent === "integration-overseer" && entry.status === "completed"
    );
    const overseerStatusInEvidence = completedOverseerRows.some((entry) => {
      const refs = Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs.join(" ") : "";
      return /\b(?:PASS_WITH_GAPS|PASS)\b/u.test(refs);
    });
    const overseerStatusInArtifact = /\bintegration-overseer\b[\s\S]{0,200}\b(?:PASS_WITH_GAPS|PASS)\b/iu.test(raw);
    const integrationOverseerFound =
      completedOverseerRows.length > 0 &&
      (overseerStatusInEvidence || overseerStatusInArtifact);

    const skippedAuditRowCount = await countIntegrationOverseerSkippedAudits(
      projectRoot,
      delegationLedger.runId
    );
    const skippedAuditRowFound = skippedAuditRowCount > 0;

    // Advisory: when fan-out is detected (2+ completed slice-builders) and
    // no `integration-overseer` was dispatched at all (no scheduled or
    // completed row for the active run), AND no
    // `cclaw_integration_overseer_skipped` audit row exists, the controller
    // should call `integrationCheckRequired()` and emit a
    // `cclaw_integration_overseer_skipped` audit row so the decision stays
    // traceable.
    const overseerDispatched = activeRunEntries.some(
      (entry) => entry.agent === "integration-overseer"
    );
    if (!overseerDispatched && !skippedAuditRowFound) {
      findings.push({
        section: "tdd_integration_overseer_skipped_audit_missing",
        required: false,
        rule: "When a wave with 2+ closed slices closes without any integration-overseer dispatch, the controller should call `integrationCheckRequired()` and emit a `cclaw_integration_overseer_skipped` audit row so the decision is traceable. Advisory — never blocks stage-complete.",
        found: false,
        details:
          `Fan-out detected (${completedSliceBuilders.length} completed slice-builder rows) but no integration-overseer dispatch row OR cclaw_integration_overseer_skipped audit row exists for active run. ` +
          "Remediation: emit `node .cclaw/hooks/delegation-record.mjs --audit-kind=cclaw_integration_overseer_skipped --audit-reason=\"<reasons>\" --slice-ids=\"<S-1,S-2,...>\"` after wave closure."
      });
    }

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

  // Phase S — sharded slice files. Validate per-slice file presence
  // and required headings. `tdd-slices/` is optional; missing folder
  // simply means main-only mode (legacy fallback).
  const slicesDir = path.join(artifactsDir, "tdd-slices");
  const sliceFiles = await listSliceFiles(slicesDir);
  const specAcceptanceIds = await readSpecAcceptanceCriteriaIds(projectRoot, ctx.track);
  const specAcceptanceSet = new Set(specAcceptanceIds);
  const slicesMissingCloses: string[] = [];
  const slicesWithUnknownAcs: string[] = [];
  let checkedSliceCards = 0;
  for (const sliceFile of sliceFiles) {
    const sliceId = sliceFile.sliceId;
    const requiredForSlice =
      slicesByEvents.has(sliceId) &&
      slicesByEvents.get(sliceId)!.some((entry) => entry.phase === "doc");
    let content = "";
    try {
      content = await fs.readFile(sliceFile.absPath, "utf8");
    } catch {
      content = "";
    }
    const issues: string[] = [];
    if (!new RegExp(`^#\\s+Slice\\s+${escapeForRegex(sliceId)}\\b`, "mu").test(content) &&
        !/^#\s+Slice\b/mu.test(content)) {
      issues.push("missing `# Slice <id>` heading");
    }
    if (!/^##\s+Plan unit\b/imu.test(content)) {
      issues.push("missing `## Plan unit` section");
    }
    if (!/^##\s+REFACTOR notes\b/imu.test(content)) {
      issues.push("missing `## REFACTOR notes` section");
    }
    if (!/^##\s+Learnings\b/imu.test(content)) {
      issues.push("missing `## Learnings` section");
    }
    checkedSliceCards += 1;
    const closesIds = extractSliceCardClosedAcceptanceCriteria(content);
    if (closesIds.length === 0) {
      slicesMissingCloses.push(sliceId);
    } else if (specAcceptanceSet.size > 0) {
      const unknown = closesIds.filter((acId) => !specAcceptanceSet.has(acId));
      if (unknown.length > 0) {
        slicesWithUnknownAcs.push(`${sliceId}: ${unknown.join(", ")}`);
      }
    }
    findings.push({
      section: `tdd_slice_file:${sliceId}`,
      required: requiredForSlice,
      rule: "Sharded slice file must include `# Slice <id>`, `## Plan unit`, `## REFACTOR notes`, and `## Learnings` headings.",
      found: issues.length === 0,
      details: issues.length === 0
        ? `tdd-slices/${path.basename(sliceFile.absPath)} has all required headings.`
        : `tdd-slices/${path.basename(sliceFile.absPath)}: ${issues.join(", ")}.`
    });
  }

  const closesRequired = checkedSliceCards > 0;
  const closesGatePassed = !closesRequired
    ? true
    : slicesMissingCloses.length === 0 &&
      slicesWithUnknownAcs.length === 0;
  findings.push({
    section: "tdd_slice_closes_ac",
    required: true,
    rule: "Every `tdd-slices/S-<id>.md` card must include `Closes: AC-N` links (comma-separated allowed) that reference real spec AC ids.",
    found: closesGatePassed,
    details: !closesRequired
      ? "No `tdd-slices/S-*.md` slice cards found yet; `Closes: AC-N` check is idle."
      : slicesMissingCloses.length > 0
        ? `Slice card(s) missing \`Closes: AC-N\`: ${slicesMissingCloses.join(", ")}.`
        : slicesWithUnknownAcs.length > 0
          ? `Slice card(s) reference unknown AC ids: ${slicesWithUnknownAcs.join(" | ")}.`
          : specAcceptanceSet.size === 0
            ? `All ${checkedSliceCards} slice card(s) include Closes links; spec AC list unavailable for strict ID cross-check.`
            : `All ${checkedSliceCards} slice card(s) include valid Closes links to spec AC ids.`
  });

  const orphanCheck = await evaluateSliceNoOrphanChanges(projectRoot, activeRunEntries);
  findings.push({
    section: "slice_no_orphan_changes",
    required: true,
    rule: "On slice phase=doc, there must be no staged/unstaged changes outside the slice `claimedPaths` (worktree root when present, otherwise project root).",
    found: orphanCheck.ok,
    details: orphanCheck.details
  });

  // Auto-render the slice summary inside `06-tdd.md` between markers.
  // Idempotent — content outside the markers is preserved. Skipped
  // entirely when there is nothing to render, so legacy artifacts (no
  // phase events, no sharded files) stay byte-for-byte unchanged.
  if (eventsActive || sliceFiles.length > 0) {
    try {
      await renderTddSliceSummary({
        mainArtifactPath: absFile,
        slicesByEvents,
        sliceFiles,
        renderSummary: eventsActive,
        renderIndex: sliceFiles.length > 0
      });
    } catch {
      // best-effort render — never block the gate.
    }
  }
}

interface SliceFileInfo {
  sliceId: string;
  absPath: string;
}

/**
 * count `cclaw_integration_overseer_skipped` audit rows in
 * `delegation-events.jsonl` for a given runId. The audit row is not a
 * `DelegationEvent` (no agent/status), so `readDelegationEvents`
 * filters it out; we re-scan the raw file with a narrow JSON match.
 *
 * Best-effort: missing file or parse errors return 0.
 */
async function countIntegrationOverseerSkippedAudits(
  projectRoot: string,
  runId: string
): Promise<number> {
  const filePath = path.join(
    projectRoot,
    ".cclaw/state/delegation-events.jsonl"
  );
  let raw = "";
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return 0;
  }
  let count = 0;
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
    const obj = parsed as Record<string, unknown>;
    if (obj.event !== "cclaw_integration_overseer_skipped") continue;
    if (typeof obj.runId === "string" && obj.runId !== runId) continue;
    count += 1;
  }
  return count;
}

async function listSliceFiles(slicesDir: string): Promise<SliceFileInfo[]> {
  let entries: string[] = [];
  try {
    entries = await fs.readdir(slicesDir);
  } catch {
    return [];
  }
  const files: SliceFileInfo[] = [];
  for (const name of entries) {
    const match = /^(S-[A-Za-z0-9._-]+)\.md$/u.exec(name);
    if (!match) continue;
    files.push({ sliceId: match[1]!, absPath: path.join(slicesDir, name) });
  }
  files.sort((a, b) => compareSliceIds(a.sliceId, b.sliceId));
  return files;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function normalizePathLike(value: string): string {
  const slashes = value.replace(/\\/gu, "/");
  const withoutDot = slashes.replace(/^\.\//u, "");
  return withoutDot.replace(/\/+$/u, "");
}

function parsePorcelainPaths(raw: string): string[] {
  const out: string[] = [];
  for (const line of raw.split(/\r?\n/gu)) {
    const trimmed = line.trimEnd();
    if (trimmed.length < 4) continue;
    const status = trimmed.slice(0, 2);
    if (status === "??") {
      const p = normalizePathLike(trimmed.slice(3).trim());
      if (p.length > 0) out.push(p);
      continue;
    }
    let p = trimmed.slice(3).trim();
    const renameIdx = p.indexOf(" -> ");
    if (renameIdx >= 0) {
      p = p.slice(renameIdx + 4);
    }
    p = normalizePathLike(p.replace(/^"/u, "").replace(/"$/u, ""));
    if (p.length > 0) out.push(p);
  }
  return [...new Set(out)];
}

async function gitChangedPaths(cwd: string): Promise<string[]> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain", "-uall"], { cwd });
  return parsePorcelainPaths(stdout);
}

function matchesClaimedPath(changedPath: string, claimedPaths: string[]): boolean {
  const changed = normalizePathLike(changedPath);
  return claimedPaths.some((rawClaimed) => {
    const claimed = normalizePathLike(rawClaimed);
    if (claimed.length === 0) return false;
    if (changed === claimed) return true;
    return changed.startsWith(`${claimed}/`);
  });
}

function extractSliceCardClosedAcceptanceCriteria(content: string): string[] {
  const ids = new Set<string>();
  for (const match of content.matchAll(/^\s*(?:[-*]\s*)?closes\s*:\s*(.+)$/gimu)) {
    const tail = match[1] ?? "";
    for (const id of extractAcceptanceCriterionIdsFromMarkdown(tail)) {
      ids.add(id);
    }
  }
  return [...ids];
}

async function readSpecAcceptanceCriteriaIds(
  projectRoot: string,
  track: StageLintContext["track"]
): Promise<string[]> {
  const specArtifact = await resolveStageArtifactPath("spec", {
    projectRoot,
    track,
    intent: "read"
  });
  if (!(await exists(specArtifact.absPath))) {
    return [];
  }
  try {
    const specRaw = await fs.readFile(specArtifact.absPath, "utf8");
    const specSections = extractH2Sections(specRaw);
    const acceptanceBody = sectionBodyByName(specSections, "Acceptance Criteria") ?? specRaw;
    return extractAcceptanceCriterionIdsFromMarkdown(acceptanceBody);
  } catch {
    return [];
  }
}

function resolveClaimedPathsForDocRow(row: DelegationEntry, allRows: DelegationEntry[]): string[] {
  const fromRow = Array.isArray(row.claimedPaths) ? row.claimedPaths : [];
  if (fromRow.length > 0) {
    return [...new Set(fromRow.map((value) => normalizePathLike(value)).filter((value) => value.length > 0))];
  }
  const fromSpan = allRows
    .filter((entry) =>
      entry.spanId === row.spanId &&
      Array.isArray(entry.claimedPaths) &&
      entry.claimedPaths.length > 0
    )
    .flatMap((entry) => entry.claimedPaths as string[]);
  return [...new Set(fromSpan.map((value) => normalizePathLike(value)).filter((value) => value.length > 0))];
}

async function resolveWorktreeCwdForDocRow(
  projectRoot: string,
  row: DelegationEntry,
  allRows: DelegationEntry[]
): Promise<string> {
  const candidates = [
    typeof row.worktreePath === "string" ? row.worktreePath.trim() : "",
    ...allRows
      .filter((entry) => entry.spanId === row.spanId)
      .map((entry) => (typeof entry.worktreePath === "string" ? entry.worktreePath.trim() : ""))
  ].filter((value) => value.length > 0);
  for (const candidateRaw of candidates) {
    const candidateAbs = path.isAbsolute(candidateRaw)
      ? candidateRaw
      : path.join(projectRoot, candidateRaw);
    if (await exists(candidateAbs)) {
      return candidateAbs;
    }
  }
  return projectRoot;
}

interface SliceNoOrphanChangesResult {
  ok: boolean;
  details: string;
}

export async function evaluateSliceNoOrphanChanges(
  projectRoot: string,
  rows: DelegationEntry[]
): Promise<SliceNoOrphanChangesResult> {
  if (!(await exists(path.join(projectRoot, ".git")))) {
    return {
      ok: true,
      details: "No .git directory detected; orphan-change check skipped."
    };
  }
  const docRows = rows.filter(
    (entry) =>
      entry.stage === "tdd" &&
      entry.agent === "slice-builder" &&
      entry.status === "completed" &&
      entry.phase === "doc"
  );
  if (docRows.length === 0) {
    return {
      ok: true,
      details: "No completed phase=doc rows found for the active run."
    };
  }

  const missingClaimedPaths: string[] = [];
  const driftRows: string[] = [];
  for (const row of docRows) {
    const claimedPaths = resolveClaimedPathsForDocRow(row, rows);
    const rowKey = `${row.sliceId ?? "unknown-slice"}@${row.spanId ?? "unknown-span"}`;
    if (claimedPaths.length === 0) {
      missingClaimedPaths.push(rowKey);
      continue;
    }
    const cwd = await resolveWorktreeCwdForDocRow(projectRoot, row, rows);
    const changedPaths = await gitChangedPaths(cwd);
    const driftPaths = changedPaths.filter((changedPath) => !matchesClaimedPath(changedPath, claimedPaths));
    if (driftPaths.length > 0) {
      driftRows.push(`${rowKey}: ${driftPaths.join(", ")}`);
    }
  }

  if (missingClaimedPaths.length > 0 || driftRows.length > 0) {
    const parts: string[] = [];
    if (missingClaimedPaths.length > 0) {
      parts.push(`doc row(s) missing claimedPaths: ${missingClaimedPaths.join(", ")}`);
    }
    if (driftRows.length > 0) {
      parts.push(`orphan working-tree changes detected: ${driftRows.join(" | ")}`);
    }
    return { ok: false, details: parts.join(". ") };
  }

  return {
    ok: true,
    details: `Checked ${docRows.length} doc row(s); no orphan changes escaped claimedPaths.`
  };
}

function groupBySlice(entries: DelegationEntry[]): Map<string, DelegationEntry[]> {
  const grouped = new Map<string, DelegationEntry[]>();
  for (const entry of entries) {
    if (typeof entry.sliceId !== "string" || entry.sliceId.length === 0) continue;
    if (typeof entry.phase !== "string" || entry.phase.length === 0) continue;
    if (entry.status !== "completed") continue;
    const list = grouped.get(entry.sliceId) ?? [];
    list.push(entry);
    grouped.set(entry.sliceId, list);
  }
  return grouped;
}

/** Group completed phase rows for a slice by `spanId` (falls back to a single legacy bucket). */
function groupSliceRowsBySpanId(rows: DelegationEntry[]): Map<string, DelegationEntry[]> {
  const grouped = new Map<string, DelegationEntry[]>();
  for (const entry of rows) {
    const spanKey =
      typeof entry.spanId === "string" && entry.spanId.length > 0 ? entry.spanId : "__missing-span__";
    const list = grouped.get(spanKey) ?? [];
    list.push(entry);
    grouped.set(spanKey, list);
  }
  return grouped;
}

function maxPhaseTimestampForSpan(rows: DelegationEntry[]): string {
  let max = "";
  for (const entry of rows) {
    const ts = entry.completedTs ?? entry.endTs ?? entry.ts ?? "";
    if (typeof ts === "string" && ts.length > 0 && ts > max) max = ts;
  }
  return max;
}

/**
 * Validate RED→GREEN→REFACTOR (incl. green `refactorOutcome`) monotonicity for one slice-builder span.
 * `rows` must contain only entries for that span.
 */
function evaluateSingleSpanSliceCycle(
  sliceId: string,
  spanId: string,
  rows: DelegationEntry[]
): {
  ok: boolean;
  errors: string[];
  findings: LintFinding[];
} {
  const errors: string[] = [];
  const findings: LintFinding[] = [];
  const sec = (slug: string): string => `${slug}:${sliceId}@${spanId}`;

  const reds = rows.filter((entry) => entry.phase === "red");
  const greens = rows.filter((entry) => entry.phase === "green");
  const refactors = rows.filter(
    (entry) => entry.phase === "refactor" || entry.phase === "refactor-deferred"
  );

  const redTs = pickEventTs(reds);
  const greenTs = pickEventTs(greens);

  if (reds.length === 0) {
    errors.push(`${sliceId}: phase=red event missing.`);
    findings.push({
      section: sec("tdd_slice_red_missing"),
      required: true,
      rule: "Each TDD slice with phase events must include a `phase=red` row.",
      found: false,
      details: `${sliceId} (span ${spanId}): no phase=red event recorded for the active run.`
    });
    return { ok: false, errors, findings };
  }
  if (greens.length === 0) {
    errors.push(`${sliceId}: phase=green event missing.`);
    findings.push({
      section: sec("tdd_slice_green_missing"),
      required: true,
      rule: "Each TDD slice with a phase=red event must reach a `phase=green` row before stage-complete.",
      found: false,
      details: `${sliceId} (span ${spanId}): no phase=green event recorded; RED has no matching GREEN.`
    });
    return { ok: false, errors, findings };
  }

  if (greenTs && redTs && greenTs < redTs) {
    errors.push(`${sliceId}: phase=green completedTs (${greenTs}) precedes phase=red (${redTs}).`);
    findings.push({
      section: sec("tdd_slice_phase_order_invalid"),
      required: true,
      rule: "Phase events must be monotonic: phase=green completedTs >= phase=red completedTs.",
      found: false,
      details: `${sliceId} (span ${spanId}): green at ${greenTs} precedes red at ${redTs}.`
    });
    return { ok: false, errors, findings };
  }

  const greenEvidenceRef = greens
    .flatMap((entry) => (Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : []))
    .find((ref) => typeof ref === "string" && ref.trim().length > 0);
  if (!greenEvidenceRef) {
    errors.push(`${sliceId}: phase=green row has empty evidenceRefs.`);
    findings.push({
      section: sec("tdd_slice_evidence_missing"),
      required: true,
      rule: "Each `phase=green` event must record at least one evidenceRef (path to test artifact, span id, or pasted-output pointer).",
      found: false,
      details: `${sliceId} (span ${spanId}): phase=green event missing evidenceRefs.`
    });
    return { ok: false, errors, findings };
  }

  const greenWithOutcome = greens.find(
    (entry) =>
      entry.refactorOutcome &&
      (entry.refactorOutcome.mode === "inline" || entry.refactorOutcome.mode === "deferred")
  );

  if (refactors.length === 0 && !greenWithOutcome) {
    errors.push(`${sliceId}: phase=refactor or phase=refactor-deferred event missing.`);
    findings.push({
      section: sec("tdd_slice_refactor_missing"),
      required: true,
      rule: "Each TDD slice must close with a `phase=refactor` event, a `phase=refactor-deferred` event whose evidenceRefs / refactorRationale captures why refactor was deferred, OR a `phase=green` event carrying `refactorOutcome`.",
      found: false,
      details: `${sliceId} (span ${spanId}): no phase=refactor / phase=refactor-deferred event and no refactorOutcome on phase=green.`
    });
    return { ok: false, errors, findings };
  }

  if (
    greenWithOutcome &&
    greenWithOutcome.refactorOutcome?.mode === "deferred" &&
    !greenWithOutcome.refactorOutcome.rationale &&
    !(
      Array.isArray(greenWithOutcome.evidenceRefs) &&
      greenWithOutcome.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0)
    )
  ) {
    errors.push(`${sliceId}: phase=green refactorOutcome=deferred missing rationale.`);
    findings.push({
      section: sec("tdd_slice_refactor_missing"),
      required: true,
      rule: "phase=green refactorOutcome=deferred requires a rationale (via --refactor-rationale or --evidence-ref).",
      found: false,
      details: `${sliceId} (span ${spanId}): phase=green refactorOutcome.mode=deferred recorded without rationale.`
    });
    return { ok: false, errors, findings };
  }

  const deferred = refactors.find((entry) => entry.phase === "refactor-deferred");
  if (
    refactors.length > 0 &&
    deferred &&
    refactors.every((entry) => entry.phase === "refactor-deferred")
  ) {
    const refs = Array.isArray(deferred.evidenceRefs) ? deferred.evidenceRefs : [];
    const hasRationale = refs.some((ref) => typeof ref === "string" && ref.trim().length > 0);
    if (!hasRationale) {
      errors.push(`${sliceId}: phase=refactor-deferred row needs evidenceRefs containing a rationale.`);
      findings.push({
        section: sec("tdd_slice_refactor_missing"),
        required: true,
        rule: "phase=refactor-deferred must record a rationale via --refactor-rationale or via --evidence-ref pointing at the rationale text.",
        found: false,
        details: `${sliceId} (span ${spanId}): phase=refactor-deferred recorded without rationale evidenceRefs.`
      });
      return { ok: false, errors, findings };
    }
  }

  return { ok: true, errors: [], findings: [] };
}

interface ParsedSliceCycleResult {
  ok: boolean;
  details: string;
}

interface ExpandedSliceCycleResult extends ParsedSliceCycleResult {
  findings: LintFinding[];
}

export function evaluateEventsWatchedRed(
  slices: Map<string, DelegationEntry[]>
): ParsedSliceCycleResult {
  const errors: string[] = [];
  let redCount = 0;
  for (const [sliceId, rows] of slices.entries()) {
    const reds = rows.filter((entry) => entry.phase === "red");
    if (reds.length === 0) continue;
    redCount += 1;
    const issues: string[] = [];
    for (const red of reds) {
      const ts = red.completedTs ?? red.endTs ?? red.ts ?? "";
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u.test(ts)) {
        issues.push("phase=red row missing ISO completedTs");
      }
      if (
        !Array.isArray(red.evidenceRefs) ||
        red.evidenceRefs.filter((ref) => typeof ref === "string" && ref.trim().length > 0).length === 0
      ) {
        issues.push("phase=red row has empty evidenceRefs");
      }
    }
    if (issues.length > 0) {
      errors.push(`${sliceId}: ${issues.join(", ")}`);
    }
  }
  if (redCount === 0) {
    return {
      ok: false,
      details: "Watched-RED Proof: events ledger has slice phase rows but none with phase=red. Dispatch slice-builder --slice <id> --phase red so RED is observable in delegation-events.jsonl."
    };
  }
  if (errors.length > 0) {
    return {
      ok: false,
      details: `Watched-RED slice events missing required fields: ${errors.join(" | ")}.`
    };
  }
  return {
    ok: true,
    details: `${redCount} slice(s) carry phase=red events with ISO completedTs and evidenceRefs.`
  };
}

export function evaluateEventsSliceCycle(
  slices: Map<string, DelegationEntry[]>
): ExpandedSliceCycleResult {
  const errors: string[] = [];
  const findings: LintFinding[] = [];
  for (const [sliceId, rows] of slices.entries()) {
    const bySpan = groupSliceRowsBySpanId(rows);
    type SpanOutcome = {
      spanId: string;
      maxTs: string;
      result: ReturnType<typeof evaluateSingleSpanSliceCycle>;
    };
    const spanOutcomes: SpanOutcome[] = [];
    for (const [spanId, spanRows] of bySpan.entries()) {
      const result = evaluateSingleSpanSliceCycle(sliceId, spanId, spanRows);
      spanOutcomes.push({
        spanId,
        maxTs: maxPhaseTimestampForSpan(spanRows),
        result
      });
    }
    if (spanOutcomes.some((s) => s.result.ok)) {
      continue;
    }
    spanOutcomes.sort((a, b) => (a.maxTs < b.maxTs ? 1 : a.maxTs > b.maxTs ? -1 : 0));
    const chosen = spanOutcomes[0]!;
    errors.push(...chosen.result.errors);
    findings.push(...chosen.result.findings);
  }

  if (errors.length > 0) {
    return {
      ok: false,
      details: errors.join(" "),
      findings
    };
  }
  return {
    ok: true,
    details: `${slices.size} slice(s) show monotonic phase=red -> phase=green -> phase=refactor (deferred-with-rationale accepted); at least one span per slice satisfies the cycle.`,
    findings: []
  };
}

interface DocCoverageResult {
  missing: string[];
}

export function evaluateSliceDocCoverage(
  slices: Map<string, DelegationEntry[]>
): DocCoverageResult {
  const missing: string[] = [];
  for (const [sliceId, rows] of slices.entries()) {
    const hasGreen = rows.some((entry) => entry.phase === "green");
    if (!hasGreen) continue;
    const refsAcrossPhases = rows.flatMap((entry) =>
      Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : []
    );
    const hasSliceFileRef = refsAcrossPhases.some(
      (ref) => typeof ref === "string" && /tdd-slices\/S-[^/]+\.md/u.test(ref)
    );
    if (!hasSliceFileRef) {
      missing.push(sliceId);
    }
  }
  return { missing };
}

interface BuilderCoverageResult {
  missing: string[];
}

/**
 * `slice-builder` must own GREEN. For each slice that recorded a phase=red
 * event with non-empty evidenceRefs, require a phase=green whose agent is
 * `slice-builder`.
 */
export function evaluateSliceBuilderCoverage(
  slices: Map<string, DelegationEntry[]>
): BuilderCoverageResult {
  const missing: string[] = [];
  for (const [sliceId, rows] of slices.entries()) {
    const reds = rows.filter((entry) => entry.phase === "red");
    if (reds.length === 0) continue;
    const hasRedEvidence = reds.some((red) => {
      const refs = Array.isArray(red.evidenceRefs) ? red.evidenceRefs : [];
      return refs.some((ref) => typeof ref === "string" && ref.trim().length > 0);
    });
    if (!hasRedEvidence) continue;
    const greens = rows.filter((entry) => entry.phase === "green");
    const ownedByBuilder = greens.some((entry) => entry.agent === "slice-builder");
    if (!ownedByBuilder) {
      missing.push(sliceId);
    }
  }
  return { missing };
}

interface RedCheckpointResult {
  ok: boolean;
  details: string;
}

function sliceRefactorTerminal(
  sliceId: string,
  slices: Map<string, DelegationEntry[]>
): boolean {
  const rows = slices.get(sliceId);
  if (!rows) return false;
  return rows.some(
    (e) =>
      e.agent === "slice-builder" &&
      (e.phase === "refactor" || e.phase === "refactor-deferred") &&
      (e.status === "completed" || e.status === "failed")
  );
}

/**
 * Detect single-slice dispatch when the merged wave plan requires parallel
 * ready slice-builder fan-out.
 */
export async function evaluateWavePlanDispatchIgnored(params: {
  artifactsDir: string;
  planMarkdown: string;
  runEvents: DelegationEvent[];
  runId: string;
  slices: Map<string, DelegationEntry[]>;
}): Promise<LintFinding | null> {
  let merged;
  try {
    merged = mergeParallelWaveDefinitions(
      parseParallelExecutionPlanWaves(params.planMarkdown),
      await parseWavePlanDirectory(params.artifactsDir)
    );
  } catch {
    return null;
  }
  if (merged.length === 0) return null;

  let pool;
  try {
    pool = await loadTddReadySlicePool(params.planMarkdown, params.artifactsDir, {
      legacyParallelDefaultSerial: false
    });
  } catch {
    return null;
  }
  if (pool.length === 0) return null;

  const completedUnitIds = new Set<string>();
  for (const u of pool) {
    if (sliceRefactorTerminal(u.sliceId, params.slices)) {
      completedUnitIds.add(u.unitId);
    }
  }

  const scoped = params.runEvents.filter((e) => e.runId === params.runId);
  const tail = scoped.slice(-20);
  const builderInTail = new Set<string>();
  for (const e of tail) {
    if (
      e.agent === "slice-builder" &&
      typeof e.sliceId === "string" &&
      e.sliceId.length > 0
    ) {
      builderInTail.add(e.sliceId);
    }
  }
  if (builderInTail.size !== 1) return null;

  for (const wave of merged) {
    const waveSliceSet = new Set(wave.members.map((m) => m.sliceId));
    const wavePool = pool.filter((u) => waveSliceSet.has(u.sliceId));
    if (wavePool.length < 2) continue;

    const waveIncomplete = wave.members.some((m) => !sliceRefactorTerminal(m.sliceId, params.slices));
    if (!waveIncomplete) continue;

    const ready = selectReadySlices(wavePool, {
      cap: Math.max(32, wavePool.length),
      completedUnitIds,
      activePathHolders: []
    });
    if (ready.length < 2) continue;

    const only = [...builderInTail][0]!;
    const missed = ready.map((r) => r.sliceId).filter((s) => s !== only);
    if (missed.length === 0) continue;

    return {
      section: "tdd_wave_plan_ignored",
      required: true,
      rule: "When the Parallel Execution Plan (or wave-plans/) defines an open wave with two or more ready parallelizable slices, the controller must fan out slice-builder Tasks for each ready slice instead of serializing to one slice only.",
      found: false,
      details: `Wave ${wave.waveId}: scheduler-ready members ${ready.map((r) => r.sliceId).join(", ")}; last 20 delegation events show slice workers only for ${only}. Missed parallel dispatch: ${missed.join(", ")}. Remediation: load \`05-plan.md\` (Parallel Execution Plan) and \`wave-plans/\` before routing, launch the wave (AskQuestion only when waveCount>=2 and single-slice is a real alternative), then dispatch workers for every ready slice.`
    };
  }
  return null;
}

/**
 * Global RED checkpoint enforcement (`global-red` mode).
 *
 * The wave protocol requires ALL Phase A REDs to land before ANY Phase B
 * GREEN starts. The rule is enforced on a per-wave basis, where a wave is
 * defined by the managed `## Parallel Execution Plan` block in
 * `05-plan.md` and/or `<artifacts-dir>/wave-plans/wave-NN.md` files. When
 * no wave manifest exists, the linter falls back to a conservative
 * implicit detection: a wave is a contiguous run of `phase=red` events
 * with no other-phase events between them; the rule fires only when the
 * implicit wave has 2+ members.
 *
 * Default mode is `per-slice` (see `evaluatePerSliceRedBeforeGreen`);
 * this checkpoint applies when a project explicitly opts into
 * `global-red`. Exported under both `evaluateGlobalRedCheckpoint`
 * (canonical name) and `evaluateRedCheckpoint` (back-compat alias for
 * existing tests/consumers).
 *
 * @param waveMembers Optional explicit wave manifest. Map key is wave
 * name (e.g. `"W-01"`); value is the set of slice ids in that wave.
 */
export function evaluateGlobalRedCheckpoint(
  slices: Map<string, DelegationEntry[]>,
  waveMembers: Map<string, Set<string>> | null = null
): RedCheckpointResult {
  // Collect all phase events with completedTs.
  type PhaseEvt = { sliceId: string; phase: string; ts: string };
  const events: PhaseEvt[] = [];
  for (const [sliceId, rows] of slices.entries()) {
    for (const entry of rows) {
      const ts = entry.completedTs ?? entry.endTs ?? entry.ts;
      if (typeof ts !== "string" || ts.length === 0) continue;
      if (typeof entry.phase !== "string") continue;
      events.push({ sliceId, phase: entry.phase, ts });
    }
  }
  events.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  // Build the canonical wave list. Explicit manifest wins; otherwise
  // derive implicit waves from contiguous red event blocks.
  const waves: { name: string; members: Set<string> }[] = [];
  if (waveMembers && waveMembers.size > 0) {
    for (const [name, members] of waveMembers.entries()) {
      if (members.size === 0) continue;
      waves.push({ name, members });
    }
  } else {
    let current: Set<string> | null = null;
    let waveIdx = 0;
    for (const evt of events) {
      if (evt.phase === "red") {
        if (current === null) current = new Set<string>();
        current.add(evt.sliceId);
      } else if (current !== null) {
        if (current.size >= 2) {
          waveIdx += 1;
          waves.push({ name: `implicit-${waveIdx}`, members: current });
        }
        current = null;
      }
    }
    if (current !== null && current.size >= 2) {
      waveIdx += 1;
      waves.push({ name: `implicit-${waveIdx}`, members: current });
    }
  }

  if (waves.length === 0) {
    return {
      ok: true,
      details: "RED checkpoint inactive: no wave manifest detected and no implicit wave (2+ contiguous reds) found."
    };
  }

  const violations: string[] = [];
  for (const wave of waves) {
    const memberReds = events.filter((e) => e.phase === "red" && wave.members.has(e.sliceId));
    const memberGreens = events.filter((e) => e.phase === "green" && wave.members.has(e.sliceId));
    if (memberReds.length === 0 || memberGreens.length === 0) continue;
    const lastRedTs = memberReds.reduce((acc, e) => (e.ts > acc ? e.ts : acc), memberReds[0]!.ts);
    for (const g of memberGreens) {
      if (g.ts < lastRedTs) {
        violations.push(
          `${wave.name}: ${g.sliceId} phase=green at ${g.ts} precedes wave's last phase=red completedTs at ${lastRedTs}`
        );
      }
    }
  }

  if (violations.length === 0) {
    return {
      ok: true,
      details: `RED checkpoint holds across ${waves.length} wave(s): all phase=green events follow the last phase=red of their wave.`
    };
  }
  return {
    ok: false,
    details:
      `RED checkpoint violation: ${violations.join("; ")}. ` +
      "When using the global wave barrier, dispatch ALL slice-builder --phase red calls in one message, verify every phase=red event lands with non-empty evidenceRefs, and only then dispatch the GREEN/REFACTOR/DOC fan-out."
  };
}

/**
 * Back-compat alias for `evaluateGlobalRedCheckpoint`. The default mode
 * uses `evaluatePerSliceRedBeforeGreen` instead.
 */
export const evaluateRedCheckpoint = evaluateGlobalRedCheckpoint;

/**
 * Per-slice RED-before-GREEN enforcement (default mode).
 *
 * For each slice with both phase=red and phase=green completed events,
 * fail if any green completedTs precedes the slice's last red completedTs.
 * No global wave barrier — different slices may freely interleave their
 * RED/GREEN/REFACTOR phases.
 */
export function evaluatePerSliceRedBeforeGreen(
  slices: Map<string, DelegationEntry[]>
): RedCheckpointResult {
  const violations: string[] = [];
  for (const [sliceId, rows] of slices.entries()) {
    const reds = rows.filter((entry) => entry.phase === "red");
    const greens = rows.filter((entry) => entry.phase === "green");
    if (reds.length === 0 || greens.length === 0) continue;
    const redTs = reds
      .map((entry) => entry.completedTs ?? entry.endTs ?? entry.ts ?? "")
      .filter((ts) => ts.length > 0)
      .sort();
    const greenTs = greens
      .map((entry) => entry.completedTs ?? entry.endTs ?? entry.ts ?? "")
      .filter((ts) => ts.length > 0)
      .sort();
    if (redTs.length === 0 || greenTs.length === 0) continue;
    const lastRed = redTs[redTs.length - 1]!;
    const earliestGreen = greenTs[0]!;
    if (earliestGreen < lastRed) {
      violations.push(
        `${sliceId}: phase=green completedTs (${earliestGreen}) precedes the slice's last phase=red completedTs (${lastRed})`
      );
    }
  }
  if (violations.length === 0) {
    return {
      ok: true,
      details: `Per-slice RED-before-GREEN holds: ${slices.size} slice(s) checked.`
    };
  }
  return {
    ok: false,
    details:
      `Per-slice RED-before-GREEN violation: ${violations.join("; ")}. ` +
      "Stream-style TDD requires each slice's RED to land before its own GREEN, but cross-lane interleaving is allowed."
  };
}

function pickEventTs(rows: DelegationEntry[]): string | undefined {
  for (const entry of rows) {
    const ts = entry.completedTs ?? entry.endTs ?? entry.ts;
    if (typeof ts === "string" && ts.length > 0) return ts;
  }
  return undefined;
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

interface RenderInput {
  mainArtifactPath: string;
  slicesByEvents: Map<string, DelegationEntry[]>;
  sliceFiles: SliceFileInfo[];
  renderSummary?: boolean;
  renderIndex?: boolean;
}

export async function renderTddSliceSummary(input: RenderInput): Promise<void> {
  let raw: string;
  try {
    raw = await fs.readFile(input.mainArtifactPath, "utf8");
  } catch {
    return;
  }
  let next = raw;
  if (input.renderSummary !== false) {
    const summaryBlock = renderSliceSummaryBlock(input.slicesByEvents);
    next = upsertAutoBlock(next, SLICE_SUMMARY_START, SLICE_SUMMARY_END, summaryBlock);
  }
  if (input.renderIndex !== false) {
    const indexBlock = renderSlicesIndexBlock(input.sliceFiles);
    next = upsertAutoBlock(next, SLICES_INDEX_START, SLICES_INDEX_END, indexBlock);
  }
  if (next !== raw) {
    try {
      await fs.writeFile(input.mainArtifactPath, next, "utf8");
    } catch {
      // best-effort render
    }
  }
}

function renderSliceSummaryBlock(slices: Map<string, DelegationEntry[]>): string {
  if (slices.size === 0) {
    return "## Vertical Slice Cycle\n\n_No slice phase events recorded for the active run._";
  }
  const sortedIds = [...slices.keys()].sort();
  const rows: string[] = [];
  rows.push("## Vertical Slice Cycle");
  rows.push("");
  rows.push("| Slice | RED ts | GREEN ts | REFACTOR | Implementer | Test refs |");
  rows.push("|---|---|---|---|---|---|");
  for (const sliceId of sortedIds) {
    const events = slices.get(sliceId)!;
    const red = events.find((entry) => entry.phase === "red");
    const green = events.find((entry) => entry.phase === "green");
    const refactor = events.find(
      (entry) => entry.phase === "refactor" || entry.phase === "refactor-deferred"
    );
    const redTs = red?.completedTs ?? red?.endTs ?? red?.ts ?? "";
    const greenTs = green?.completedTs ?? green?.endTs ?? green?.ts ?? "";
    let refactorCell: string;
    if (!refactor) {
      refactorCell = "";
    } else if (refactor.phase === "refactor-deferred") {
      const refs = Array.isArray(refactor.evidenceRefs) ? refactor.evidenceRefs : [];
      const rationale = refs.find((ref) => typeof ref === "string" && ref.trim().length > 0) ?? "";
      refactorCell = `deferred because ${rationale}`.trim();
    } else {
      refactorCell = refactor.completedTs ?? refactor.ts ?? "";
    }
    const implementer = green?.agent ?? red?.agent ?? "";
    const refsList = green?.evidenceRefs ?? red?.evidenceRefs ?? [];
    const testRefs = Array.isArray(refsList) ? refsList.join(", ") : "";
    rows.push(
      `| ${sliceId} | ${redTs} | ${greenTs} | ${escapeTableCell(refactorCell)} | ${implementer} | ${escapeTableCell(testRefs)} |`
    );
  }
  return rows.join("\n");
}

function renderSlicesIndexBlock(sliceFiles: SliceFileInfo[]): string {
  if (sliceFiles.length === 0) {
    return "## Slices Index\n\n_No `tdd-slices/S-*.md` files present._";
  }
  const lines: string[] = [];
  lines.push("## Slices Index");
  lines.push("");
  for (const file of sliceFiles) {
    lines.push(`- [${file.sliceId}](tdd-slices/${path.basename(file.absPath)})`);
  }
  return lines.join("\n");
}

function escapeTableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

function upsertAutoBlock(
  raw: string,
  startMarker: string,
  endMarker: string,
  bodyContent: string
): string {
  const startIdx = raw.indexOf(startMarker);
  const endIdx = raw.indexOf(endMarker);
  const replacement = `${startMarker}\n${bodyContent}\n${endMarker}`;
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = raw.slice(0, startIdx);
    const after = raw.slice(endIdx + endMarker.length);
    return `${before}${replacement}${after}`;
  }
  // append to end
  const sep = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${sep}\n${replacement}\n`;
}
