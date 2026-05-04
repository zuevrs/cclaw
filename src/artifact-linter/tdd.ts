import fs from "node:fs/promises";
import path from "node:path";
import {
  integrationCheckRequired,
  loadTddReadySlicePool,
  readDelegationLedger,
  readDelegationEvents,
  selectReadySlices
} from "../delegation.js";
import type { DelegationEntry, DelegationEvent } from "../delegation.js";
import {
  mergeParallelWaveDefinitions,
  parseParallelExecutionPlanWaves,
  parseWavePlanDirectory
} from "../internal/plan-split-waves.js";
import {
  type LintFinding,
  type StageLintContext,
  evaluateInvestigationTrace,
  sectionBodyByName
} from "./shared.js";

const SLICE_SUMMARY_START = "<!-- auto-start: tdd-slice-summary -->";
const SLICE_SUMMARY_END = "<!-- auto-end: tdd-slice-summary -->";
const SLICES_INDEX_START = "<!-- auto-start: slices-index -->";
const SLICES_INDEX_END = "<!-- auto-end: slices-index -->";

/**
 * v6.11.0 — TDD stage linter.
 *
 * Source-of-truth ladder, in order of precedence:
 *
 * 1. **Phase events** in `delegation-events.jsonl` for the active run
 *    (`stage=tdd`, `sliceId=S-N`, `phase=red|green|refactor|refactor-deferred|doc`).
 *    When at least one slice carries any phase event, the linter
 *    auto-derives Watched-RED / Vertical Slice Cycle from the events
 *    and writes a rendered summary block between auto-render markers
 *    in `06-tdd.md`. Markdown table content is no longer required.
 * 2. **Legacy markdown tables** (Watched-RED Proof + Vertical Slice
 *    Cycle) — used as a fallback when the events ledger has no slice
 *    phase rows for the active run. Existing v6.10 and earlier
 *    artifacts continue to validate via this path.
 * 3. **Sharded slice files** under `<artifacts-dir>/tdd-slices/S-*.md`.
 *    Per-slice prose lives there. The main `06-tdd.md` is auto-indexed
 *    via `## Slices Index`.
 */
export async function lintTddStage(ctx: StageLintContext): Promise<void> {
  const {
    projectRoot,
    discoveryMode,
    raw,
    absFile,
    sections,
    findings,
    parsedFrontmatter,
    worktreeExecutionMode,
    legacyContinuation,
    tddCheckpointMode,
    integrationOverseerMode
  } = ctx;
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

  // v6.14.0 Phase 4 — slice-documenter coverage is mandatory only on
  // `discoveryMode === "deep"` runs. lean/guided still emit the finding
  // but as advisory (`required: false`) so the controller can choose to
  // run a tighter inline-doc pass instead. The DOC role still exists;
  // the linter just stops blocking the gate on lean/guided. Reference
  // research report Section 4: "soften slice-documenter mandate".
  if (eventsActive) {
    const docResult = evaluateSliceDocumenterCoverage(slicesByEvents);
    if (docResult.missing.length > 0) {
      const required = discoveryMode === "deep";
      findings.push({
        section: "tdd_slice_documenter_missing",
        required,
        rule: required
          ? "deep mode: every TDD slice with a phase=green event must also carry a slice-documenter `phase=doc` event whose evidenceRefs reference `<artifacts-dir>/tdd-slices/S-<id>.md`."
          : "lean/guided modes (v6.14.0): the slice-documenter `phase=doc` event is advisory; controllers may use slice-implementer --finalize-doc inline instead. Required only for deep mode.",
        found: false,
        details:
          `Slices missing slice-documenter coverage: ${docResult.missing.join(", ")}. ` +
          (required
            ? "Dispatch slice-documenter --slice <id> --phase doc in parallel with slice-implementer --phase green for each slice."
            : "Either dispatch slice-documenter --phase doc or call slice-implementer --finalize-doc inline at GREEN-completion.")
      });
    }
  }

  // v6.12.0 Phase M — slice-implementer must own GREEN. For each slice
  // with a phase=red row carrying non-empty evidenceRefs, require a
  // matching phase=green event whose `agent === "slice-implementer"`.
  // This catches "controller wrote GREEN itself" — the most common
  // backslide we have observed in fresh runs (hox S-11).
  if (eventsActive) {
    const implResult = evaluateSliceImplementerCoverage(slicesByEvents);
    if (implResult.missing.length > 0) {
      findings.push({
        section: "tdd_slice_implementer_missing",
        required: true,
        rule: "Every TDD slice that recorded a phase=red event with non-empty evidenceRefs must reach phase=green via the `slice-implementer` agent. Controller writing GREEN production code itself is forbidden (v6.12.0 Phase M).",
        found: false,
        details: `Slices missing slice-implementer GREEN coverage: ${implResult.missing.join(", ")}. Dispatch slice-implementer --slice <id> --phase green --paths <comma-separated production paths>.`
      });
    }
  }

  // v6.14.0 Phase 1 — RED checkpoint enforcement. The mode is selected
  // by `flow-state.json::tddCheckpointMode`:
  //
  //   - `per-slice` (default for new projects): enforce RED-before-GREEN
  //     per slice only. No global wave barrier; lanes run RED→GREEN as
  //     soon as their dependsOn closes. Rule id:
  //     `tdd_slice_red_completed_before_green`.
  //   - `global-red` (auto-applied for legacyContinuation): enforce the
  //     v6.12 wave-batch barrier — every slice in a wave must complete
  //     phase=red before any slice in the same wave starts phase=green.
  //     Rule id: `tdd_red_checkpoint_violation` (legacy).
  if (eventsActive) {
    if (tddCheckpointMode === "global-red") {
      const waveManifest = await readMergedWaveManifestForCheckpoint(artifactsDir, planRaw);
      const checkpointResult = evaluateGlobalRedCheckpoint(slicesByEvents, waveManifest);
      if (!checkpointResult.ok) {
        findings.push({
          section: "tdd_red_checkpoint_violation",
          required: true,
          rule: "Wave Batch Mode (legacy global-red mode, v6.12.0 Phase W): every slice in a wave must complete phase=red before any slice in the same wave starts phase=green. Detected: a phase=green completedTs precedes the last phase=red completedTs of the same wave.",
          found: false,
          details: checkpointResult.details
        });
      }
    } else {
      const perSliceResult = evaluatePerSliceRedBeforeGreen(slicesByEvents);
      if (!perSliceResult.ok) {
        findings.push({
          section: "tdd_slice_red_completed_before_green",
          required: true,
          rule: "Stream-style TDD (v6.14.0): each slice's phase=green completedTs must be >= the same slice's last phase=red completedTs. No global wave barrier — lanes run independently.",
          found: false,
          details: perSliceResult.details
        });
      }
    }
  }

  // v6.12.0 Phase L — advisory backslide detection. When a cutover is
  // recorded in flow-state, slice-id rows in the legacy per-slice
  // sections of `06-tdd.md` that exceed the cutover boundary should
  // migrate to `tdd-slices/S-<id>.md`. Surface as advisory so it does
  // not block the gate but does keep the controller honest.
  const cutoverFinding = await evaluateLegacySectionBackslide({
    projectRoot,
    raw,
    sections
  });
  if (cutoverFinding) {
    findings.push(cutoverFinding);
  }

  const { events: jsonlEvents, fanInAudits } = await readDelegationEvents(projectRoot);
  const runEvents = jsonlEvents.filter((e) => e.runId === delegationLedger.runId);

  if (eventsActive && planRaw.length > 0) {
    const ignoredWave = await evaluateWavePlanDispatchIgnored({
      artifactsDir,
      planMarkdown: planRaw,
      runEvents,
      runId: delegationLedger.runId,
      slices: slicesByEvents,
      legacyContinuation
    });
    if (ignoredWave) {
      findings.push(ignoredWave);
    }
  }

  if (eventsActive && worktreeExecutionMode === "worktree-first") {
    const terminalPhases = new Set([
      "refactor",
      "refactor-deferred",
      "resolve-conflict"
    ]);
    const missingGreenMeta = new Set<string>();
    for (const ev of runEvents) {
      if (ev.stage !== "tdd" || ev.agent !== "slice-implementer") continue;
      if (ev.status !== "completed" || ev.phase !== "green") continue;
      if (typeof ev.sliceId !== "string") continue;
      const tok = ev.claimToken?.trim() ?? "";
      const lane = ev.ownerLaneId?.trim() ?? "";
      const lease = ev.leasedUntil?.trim() ?? "";
      if (tok.length === 0 || lane.length === 0 || lease.length === 0) {
        missingGreenMeta.add(ev.sliceId);
      }
    }
    if (missingGreenMeta.size > 0) {
      findings.push({
        section: "tdd_slice_lane_metadata_missing",
        required: true,
        rule: "Worktree-first: every completed slice-implementer phase=green row must record claimToken, ownerLaneId (--lane-id), and leasedUntil (--lease-until).",
        found: false,
        details: `Slices missing one or more lane fields on GREEN: ${[...missingGreenMeta].sort().join(", ")}. Remediation: include --claim-token, --lane-id, and --lease-until on every slice-implementer --phase green delegation-record write (schedule through completion); the hook fails fast with dispatch_lane_metadata_missing when they are omitted.`
      });
    }
    const missingClaim = new Set<string>();
    for (const ev of runEvents) {
      if (ev.stage !== "tdd" || ev.agent !== "slice-implementer") continue;
      if (ev.status !== "completed" && ev.status !== "failed") continue;
      if (!ev.phase || !terminalPhases.has(ev.phase)) continue;
      const tok = ev.claimToken?.trim() ?? "";
      if (tok.length === 0 && typeof ev.sliceId === "string") {
        missingClaim.add(ev.sliceId);
      }
    }
    if (missingClaim.size > 0) {
      findings.push({
        section: "tdd_slice_claim_token_missing",
        required: true,
        rule: "Worktree-first: terminal slice-implementer rows (refactor / refactor-deferred / resolve-conflict) must echo --claim-token. Remediation: pass the same --claim-token used on the scheduled row for every completed/failed terminal phase.",
        found: false,
        details: `Slices missing claim token on non-GREEN terminal rows: ${[...missingClaim].join(", ")}.`
      });
    }
    const conflictSlices = [
      ...new Set(
        [
          ...runEvents
            .filter((e) => e.integrationState === "conflict")
            .map((e) => e.sliceId)
            .filter((s): s is string => typeof s === "string"),
          ...fanInAudits
            .filter(
              (a) =>
                a.runId === delegationLedger.runId &&
                a.event === "cclaw_fanin_conflict" &&
                Array.isArray(a.sliceIds)
            )
            .flatMap((a) => a.sliceIds ?? [])
        ].filter((s): s is string => typeof s === "string" && s.length > 0)
      )
    ];
    if (conflictSlices.length > 0) {
      findings.push({
        section: "tdd_fanin_conflict_unresolved",
        required: true,
        rule: "Resolve fan-in conflicts before stage-complete: dispatch slice-implementer --phase resolve-conflict or abandon the slice explicitly.",
        found: false,
        details: `integrationState=conflict for slice(s): ${conflictSlices.join(
          ", "
        )}. Remediation: finish deterministic fan-in or mark integrationState=resolved after manual merge evidence.`
      });
    }
    const now = Date.now();
    const leaseStale = new Set<string>();
    for (const ev of runEvents) {
      if (typeof ev.leasedUntil !== "string") continue;
      const until = Date.parse(ev.leasedUntil);
      if (!Number.isFinite(until) || until >= now) continue;
      if (ev.leaseState === "reclaimed" || ev.leaseState === "released") continue;
      if (typeof ev.sliceId === "string") leaseStale.add(ev.sliceId);
    }
    if (leaseStale.size > 0) {
      findings.push({
        section: "tdd_lease_expired_unreclaimed",
        required: true,
        rule: "Leases past leasedUntil must be reclaimed or released. Remediation: run scheduler reclaim or emit leaseState=reclaimed audit rows after controller action.",
        found: false,
        details: `Expired leases not reclaimed for slice(s): ${[...leaseStale].join(", ")}.`
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

  const completedSliceImplementers = activeRunEntries.filter(
    (entry) => entry.agent === "slice-implementer" && entry.status === "completed"
  );
  const fanOutDetected = completedSliceImplementers.length > 1;

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
      rule: "When delegation ledger has >1 completed slice-implementer rows for active TDD run, require `.cclaw/artifacts/cohesion-contract.md` and parseable `.cclaw/artifacts/cohesion-contract.json` sidecar.",
      found: cohesionContractFound,
      details: cohesionContractFound
        ? `Fan-out detected (${completedSliceImplementers.length} completed slice-implementer rows); cohesion contract markdown+JSON sidecar are present and parseable.`
        : cohesionErrors.join(" ")
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

    // v6.14.0 Phase 3 — conditional integration-overseer dispatch. When
    // `integrationOverseerMode === "conditional"` and
    // `integrationCheckRequired()` returns required=false, the gate is
    // soft (advisory) and an audit-only finding is emitted so the
    // controller can record the deliberate skip in artifacts.
    let overseerVerdict: ReturnType<typeof integrationCheckRequired> | null = null;
    let overseerRequired = true;
    if (integrationOverseerMode === "conditional") {
      const eventsForVerdict = runEvents.length > 0 ? runEvents : [];
      const auditsForVerdict = fanInAudits.filter(
        (a) => a.runId === delegationLedger.runId
      );
      overseerVerdict = integrationCheckRequired(eventsForVerdict, auditsForVerdict);
      overseerRequired = overseerVerdict.required;
      if (!overseerVerdict.required) {
        findings.push({
          section: "tdd_integration_overseer_skipped_by_disjoint_paths",
          required: false,
          rule: "v6.14.0 conditional integration-overseer mode: the heuristic returned `required: false` (disjoint claimedPaths, no high-risk slices, no fan-in conflicts). The controller may skip dispatching `integration-overseer` and emit a `cclaw_integration_overseer_skipped` audit row instead.",
          found: true,
          details: `integrationCheckRequired() reasons: ${overseerVerdict.reasons.join(", ")}. Skip is safe — record an audit row via delegation events for traceability.`
        });
      }
    }

    findings.push({
      section: "tdd.integration_overseer_missing",
      required: overseerRequired,
      rule: overseerRequired
        ? "When fan-out is detected, require completed `integration-overseer` evidence with PASS or PASS_WITH_GAPS."
        : "v6.14.0 conditional integration-overseer mode: integration-overseer dispatch is advisory because `integrationCheckRequired()` returned required=false. Run it anyway if the run touches new boundaries.",
      found: integrationOverseerFound,
      details: integrationOverseerFound
        ? "integration-overseer completion recorded with PASS/PASS_WITH_GAPS evidence."
        : completedOverseerRows.length === 0
          ? overseerRequired
            ? "Fan-out detected but no completed integration-overseer delegation row exists for active run."
            : "Fan-out detected; integration-overseer not dispatched (conditional mode skipped on disjoint paths). Audit-only."
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
  files.sort((a, b) => (a.sliceId < b.sliceId ? -1 : a.sliceId > b.sliceId ? 1 : 0));
  return files;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
      details: "Watched-RED Proof: events ledger has slice phase rows but none with phase=red. Dispatch test-author --slice <id> --phase red so RED is observable in delegation-events.jsonl."
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
        section: `tdd_slice_red_missing:${sliceId}`,
        required: true,
        rule: "Each TDD slice with phase events must include a `phase=red` row.",
        found: false,
        details: `${sliceId}: no phase=red event recorded for the active run.`
      });
      continue;
    }
    if (greens.length === 0) {
      errors.push(`${sliceId}: phase=green event missing.`);
      findings.push({
        section: `tdd_slice_green_missing:${sliceId}`,
        required: true,
        rule: "Each TDD slice with a phase=red event must reach a `phase=green` row before stage-complete.",
        found: false,
        details: `${sliceId}: no phase=green event recorded; RED has no matching GREEN.`
      });
      continue;
    }

    if (greenTs && redTs && greenTs < redTs) {
      errors.push(`${sliceId}: phase=green completedTs (${greenTs}) precedes phase=red (${redTs}).`);
      findings.push({
        section: `tdd_slice_phase_order_invalid:${sliceId}`,
        required: true,
        rule: "Phase events must be monotonic: phase=green completedTs >= phase=red completedTs.",
        found: false,
        details: `${sliceId}: green at ${greenTs} precedes red at ${redTs}.`
      });
      continue;
    }

    const greenEvidenceRef = greens
      .flatMap((entry) =>
        Array.isArray(entry.evidenceRefs) ? entry.evidenceRefs : []
      )
      .find((ref) => typeof ref === "string" && ref.trim().length > 0);
    if (!greenEvidenceRef) {
      errors.push(`${sliceId}: phase=green row has empty evidenceRefs.`);
      findings.push({
        section: `tdd_slice_evidence_missing:${sliceId}`,
        required: true,
        rule: "Each `phase=green` event must record at least one evidenceRef (path to test artifact, span id, or pasted-output pointer).",
        found: false,
        details: `${sliceId}: phase=green event missing evidenceRefs.`
      });
      continue;
    }

    // v6.14.0 — refactorOutcome on phase=green satisfies REFACTOR coverage
    // without a separate phase=refactor / phase=refactor-deferred row.
    // - mode: "inline" → REFACTOR ran inline as part of GREEN.
    // - mode: "deferred" → rationale required (carried in evidenceRefs[0]
    //   by the hook helper so legacy linters keep working).
    const greenWithOutcome = greens.find(
      (entry) => entry.refactorOutcome &&
        (entry.refactorOutcome.mode === "inline" || entry.refactorOutcome.mode === "deferred")
    );

    if (refactors.length === 0 && !greenWithOutcome) {
      errors.push(`${sliceId}: phase=refactor or phase=refactor-deferred event missing.`);
      findings.push({
        section: `tdd_slice_refactor_missing:${sliceId}`,
        required: true,
        rule: "Each TDD slice must close with a `phase=refactor` event, a `phase=refactor-deferred` event whose evidenceRefs / refactorRationale captures why refactor was deferred, OR a `phase=green` event carrying `refactorOutcome` (v6.14.0).",
        found: false,
        details: `${sliceId}: no phase=refactor / phase=refactor-deferred event and no refactorOutcome on phase=green.`
      });
      continue;
    }

    if (
      greenWithOutcome &&
      greenWithOutcome.refactorOutcome?.mode === "deferred" &&
      !greenWithOutcome.refactorOutcome.rationale &&
      !(Array.isArray(greenWithOutcome.evidenceRefs) &&
        greenWithOutcome.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0))
    ) {
      errors.push(`${sliceId}: phase=green refactorOutcome=deferred missing rationale.`);
      findings.push({
        section: `tdd_slice_refactor_missing:${sliceId}`,
        required: true,
        rule: "phase=green refactorOutcome=deferred requires a rationale (via --refactor-rationale or --evidence-ref).",
        found: false,
        details: `${sliceId}: phase=green refactorOutcome.mode=deferred recorded without rationale.`
      });
      continue;
    }

    const deferred = refactors.find((entry) => entry.phase === "refactor-deferred");
    if (
      refactors.length > 0 &&
      deferred &&
      refactors.every((entry) => entry.phase === "refactor-deferred")
    ) {
      const refs = Array.isArray(deferred.evidenceRefs) ? deferred.evidenceRefs : [];
      const hasRationale = refs.some(
        (ref) => typeof ref === "string" && ref.trim().length > 0
      );
      if (!hasRationale) {
        errors.push(`${sliceId}: phase=refactor-deferred row needs evidenceRefs containing a rationale.`);
        findings.push({
          section: `tdd_slice_refactor_missing:${sliceId}`,
          required: true,
          rule: "phase=refactor-deferred must record a rationale via --refactor-rationale or via --evidence-ref pointing at the rationale text.",
          found: false,
          details: `${sliceId}: phase=refactor-deferred recorded without rationale evidenceRefs.`
        });
        continue;
      }
    }
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
    details: `${slices.size} slice(s) show monotonic phase=red -> phase=green -> phase=refactor (deferred-with-rationale accepted).`,
    findings: []
  };
}

interface DocCoverageResult {
  missing: string[];
}

export function evaluateSliceDocumenterCoverage(
  slices: Map<string, DelegationEntry[]>
): DocCoverageResult {
  const missing: string[] = [];
  for (const [sliceId, rows] of slices.entries()) {
    const hasGreen = rows.some((entry) => entry.phase === "green");
    if (!hasGreen) continue;
    const docRow = rows.find((entry) => entry.phase === "doc");
    if (!docRow) {
      missing.push(sliceId);
      continue;
    }
    const refs = Array.isArray(docRow.evidenceRefs) ? docRow.evidenceRefs : [];
    const hasSliceFileRef = refs.some(
      (ref) => typeof ref === "string" && /tdd-slices\/S-[^/]+\.md/u.test(ref)
    );
    if (!hasSliceFileRef) {
      missing.push(sliceId);
    }
  }
  return { missing };
}

interface ImplementerCoverageResult {
  missing: string[];
}

/**
 * v6.12.0 Phase M — slice-implementer must own GREEN. For each slice
 * that recorded a phase=red event with non-empty evidenceRefs, require a
 * phase=green event whose `agent === "slice-implementer"`. Slices whose
 * GREEN event came from a different agent (e.g. controller wrote GREEN
 * itself and recorded a green row under another agent name) are flagged.
 */
export function evaluateSliceImplementerCoverage(
  slices: Map<string, DelegationEntry[]>
): ImplementerCoverageResult {
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
    const ownedByImplementer = greens.some((entry) => entry.agent === "slice-implementer");
    if (!ownedByImplementer) {
      missing.push(sliceId);
    }
  }
  return { missing };
}

interface RedCheckpointResult {
  ok: boolean;
  details: string;
}

async function readMergedWaveManifestForCheckpoint(
  artifactsDir: string,
  planMarkdown: string
): Promise<Map<string, Set<string>> | null> {
  try {
    const merged = mergeParallelWaveDefinitions(
      parseParallelExecutionPlanWaves(planMarkdown),
      await parseWavePlanDirectory(artifactsDir)
    );
    if (merged.length === 0) return null;
    const map = new Map<string, Set<string>>();
    for (const w of merged) {
      map.set(w.waveId, new Set(w.members.map((m) => m.sliceId)));
    }
    return map.size > 0 ? map : null;
  } catch {
    return null;
  }
}

function sliceRefactorTerminal(
  sliceId: string,
  slices: Map<string, DelegationEntry[]>
): boolean {
  const rows = slices.get(sliceId);
  if (!rows) return false;
  return rows.some(
    (e) =>
      e.agent === "slice-implementer" &&
      (e.phase === "refactor" || e.phase === "refactor-deferred") &&
      (e.status === "completed" || e.status === "failed")
  );
}

/**
 * v6.13.1 — detect single-slice dispatch when the merged wave plan
 * requires parallel ready slice-implementer fan-out.
 */
export async function evaluateWavePlanDispatchIgnored(params: {
  artifactsDir: string;
  planMarkdown: string;
  runEvents: DelegationEvent[];
  runId: string;
  slices: Map<string, DelegationEntry[]>;
  legacyContinuation: boolean;
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
      legacyParallelDefaultSerial: params.legacyContinuation
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
  const implInTail = new Set<string>();
  for (const e of tail) {
    if (e.agent === "slice-implementer" && typeof e.sliceId === "string" && e.sliceId.length > 0) {
      implInTail.add(e.sliceId);
    }
  }
  if (implInTail.size !== 1) return null;

  for (const wave of merged) {
    const waveSliceSet = new Set(wave.members.map((m) => m.sliceId));
    const wavePool = pool.filter((u) => waveSliceSet.has(u.sliceId));
    if (wavePool.length < 2) continue;

    const waveIncomplete = wave.members.some((m) => !sliceRefactorTerminal(m.sliceId, params.slices));
    if (!waveIncomplete) continue;

    const ready = selectReadySlices(wavePool, {
      cap: Math.max(32, wavePool.length),
      completedUnitIds,
      activePathHolders: [],
      legacyContinuation: params.legacyContinuation
    });
    if (ready.length < 2) continue;

    const only = [...implInTail][0]!;
    const missed = ready.map((r) => r.sliceId).filter((s) => s !== only);
    if (missed.length === 0) continue;

    return {
      section: "tdd_wave_plan_ignored",
      required: true,
      rule: "When the Parallel Execution Plan (or wave-plans/) defines an open wave with two or more ready parallelizable slices, the controller must fan out slice-implementer work for each ready slice instead of serializing to one slice only.",
      found: false,
      details: `Wave ${wave.waveId}: scheduler-ready members ${ready.map((r) => r.sliceId).join(", ")}; last 20 delegation events show slice-implementer only for ${only}. Missed parallel dispatch: ${missed.join(", ")}. Remediation: load \`05-plan.md\` (Parallel Execution Plan) and \`wave-plans/\` before routing, launch the wave (AskQuestion only when waveCount>=2 and single-slice is a real alternative), then dispatch GREEN+DOC for every ready slice with mandatory worktree-first flags on GREEN.`
    };
  }
  return null;
}

/**
 * v6.12.0 Phase W (legacy `global-red` mode) — RED checkpoint enforcement.
 * The wave protocol requires ALL Phase A REDs to land before ANY Phase B
 * GREEN starts. The rule is enforced on a per-wave basis, where a wave is
 * defined by the managed `## Parallel Execution Plan` block in
 * `05-plan.md` and/or `<artifacts-dir>/wave-plans/wave-NN.md` files. When
 * no wave manifest exists, the linter falls back to a conservative
 * implicit detection: a wave is a contiguous run of `phase=red` events
 * with no other-phase events between them; the rule fires only when the
 * implicit wave has 2+ members.
 *
 * v6.14.0: this function powers the `global-red` checkpoint mode. New
 * projects default to `per-slice` mode (see
 * `evaluatePerSliceRedBeforeGreen`); `legacyContinuation: true` projects
 * auto-keep this behavior. Exported under both `evaluateGlobalRedCheckpoint`
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
      "Dispatch ALL Phase A test-author --phase red calls in one message, verify every phase=red event lands with non-empty evidenceRefs, and only then dispatch Phase B slice-implementer --phase green + slice-documenter --phase doc fan-out."
  };
}

/**
 * Back-compat alias for `evaluateGlobalRedCheckpoint` (v6.12.0 Phase W
 * behavior). Existing tests/consumers can keep importing
 * `evaluateRedCheckpoint`. The v6.14.0 stream-style mode uses
 * `evaluatePerSliceRedBeforeGreen` instead.
 */
export const evaluateRedCheckpoint = evaluateGlobalRedCheckpoint;

/**
 * v6.14.0 — per-slice RED-before-GREEN enforcement (default mode).
 *
 * For each slice with both phase=red and phase=green completed events,
 * fail if any green completedTs precedes the slice's last red completedTs.
 * No global wave barrier — different slices may freely interleave their
 * RED/GREEN/REFACTOR phases.
 *
 * Note: this is intentionally weaker than `evaluateGlobalRedCheckpoint`
 * because the W-02 measurement on hox showed ~6 minutes of barrier
 * overhead when slices were already disjoint (file-overlap scheduler did
 * the parallelism job). The per-slice rule retains the only invariant
 * that mattered for correctness: no slice goes GREEN before its own
 * RED is observed failing.
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

const LEGACY_PER_SLICE_SECTIONS = [
  "Test Discovery",
  "RED Evidence",
  "GREEN Evidence",
  "Watched-RED Proof",
  "Vertical Slice Cycle",
  "Per-Slice Review",
  "Failure Analysis",
  "Acceptance Mapping"
];

interface LegacyBackslideContext {
  projectRoot: string;
  raw: string;
  sections: StageLintContext["sections"];
}

/**
 * v6.12.0 Phase L — advisory finding when post-cutover slice ids appear
 * in legacy per-slice sections of `06-tdd.md`. Reads
 * `flow-state.json::tddCutoverSliceId` (e.g. `"S-10"`) and scans each
 * legacy section for `S-<N>` references with N > cutover.
 */
async function evaluateLegacySectionBackslide(
  ctx: LegacyBackslideContext
): Promise<LintFinding | null> {
  const cutover = await readTddCutoverSliceId(ctx.projectRoot);
  if (cutover === null) return null;
  const cutoverNum = parseSliceNumber(cutover);
  if (cutoverNum === null) return null;
  const offenders: { section: string; sliceId: string }[] = [];
  for (const sectionName of LEGACY_PER_SLICE_SECTIONS) {
    const body = sectionBodyByName(ctx.sections, sectionName);
    if (body === null) continue;
    const ids = extractSliceIdsFromBody(body);
    for (const id of ids) {
      const num = parseSliceNumber(id);
      if (num === null) continue;
      if (num > cutoverNum) {
        offenders.push({ section: sectionName, sliceId: id });
      }
    }
  }
  if (offenders.length === 0) return null;
  const summary = offenders
    .map((row) => `${row.sliceId} appears in legacy section \`## ${row.section}\``)
    .join("; ");
  return {
    section: "tdd_legacy_section_writes_after_cutover",
    required: false,
    rule: "After v6.12.0 cutover, per-slice prose for slices > cutoverSliceId must live in `tdd-slices/S-<id>.md`, not in legacy `06-tdd.md` sections (Test Discovery, RED Evidence, GREEN Evidence, Watched-RED Proof, Vertical Slice Cycle, Per-Slice Review, Failure Analysis, Acceptance Mapping).",
    found: false,
    details: `${summary}. Move post-cutover slice prose into \`tdd-slices/<id>.md\` and let slice-documenter own the writes.`
  };
}

async function readTddCutoverSliceId(projectRoot: string): Promise<string | null> {
  const flowStatePath = path.join(projectRoot, ".cclaw/state/flow-state.json");
  let raw: string;
  try {
    raw = await fs.readFile(flowStatePath, "utf8");
  } catch {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = (parsed as Record<string, unknown>).tddCutoverSliceId;
  if (typeof value !== "string" || value.length === 0) return null;
  return value;
}

function parseSliceNumber(sliceId: string): number | null {
  const match = /^S-(\d+)\b/u.exec(sliceId);
  if (!match) return null;
  const num = Number.parseInt(match[1]!, 10);
  return Number.isFinite(num) ? num : null;
}

function extractSliceIdsFromBody(body: string): string[] {
  const ids = new Set<string>();
  const regex = /\bS-(\d+)\b/gu;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(body)) !== null) {
    ids.add(`S-${match[1]}`);
  }
  return [...ids];
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
