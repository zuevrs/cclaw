import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath } from "../../artifact-paths.js";
import {
  appendDelegation,
  checkMandatoryDelegations,
  readDelegationEvents,
  readDelegationLedger
} from "../../delegation.js";
import {
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "../../gate-evidence.js";
import { extractMarkdownSectionBody, learningsParseFailureHumanSummary, parseLearningsSection } from "../../artifact-linter.js";
import {
  getAvailableTransitions,
  getTransitionGuards,
  type FlowState,
  type StageGateState
} from "../../flow-state.js";
import { appendKnowledge } from "../../knowledge-store.js";
import { readFlowState, writeFlowState } from "../../runs.js";
import { TRACK_STAGES, type FlowStage, type FlowTrack } from "../../types.js";
import { stageSchema } from "../../content/stage-schema.js";
import { extractReviewLoopEnvelopeFromArtifact } from "../../content/review-loop.js";
import { unique } from "./helpers.js";
import {
  AUTO_REVIEW_LOOP_GATE_BY_STAGE,
  reviewLoopArtifactFixHint,
  reviewLoopEnvelopeExample,
  validateGateEvidenceShape
} from "./review-loop.js";
import type { AdvanceStageArgs } from "./parsers.js";
import { ensureProactiveDelegationTrace } from "./proactive-delegation-trace.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}


interface InternalValidationReport {
  ok: boolean;
  stage: FlowStage;
  delegation: {
    satisfied: boolean;
    missing: string[];
    waived: string[];
    missingEvidence: string[];
    missingDispatchProof: string[];
    legacyInferredCompletions: string[];
    corruptEventLines: number[];
    staleWorkers: string[];
    expectedMode: string;
    /** Wave 24: true when mandatoryAgentsFor returned [] for the run's track / taskClass. */
    skippedByTrack: boolean;
  };
  gates: {
    ok: boolean;
    complete: boolean;
    issues: string[];
    missingRequired: string[];
    missingTriggeredConditional: string[];
  };
  completedStages: {
    ok: boolean;
    issues: string[];
  };
}

function resolveSuccessorTransition(
  stage: FlowStage,
  track: FlowState["track"],
  transitionTargets: FlowStage[],
  satisfiedGuards: Set<string>,
  selectedTransitionGuards: Set<string>
): FlowStage | null {
  const natural = transitionTargets[0] ?? null;
  const specialTargets = transitionTargets.filter((target) => target !== natural);

  for (const target of specialTargets) {
    const guards = getTransitionGuards(stage, target, track);
    if (guards.length === 0) continue;
    const selectedSpecial = guards.some((guard) => selectedTransitionGuards.has(guard));
    if (!selectedSpecial) continue;
    if (guards.every((guard) => satisfiedGuards.has(guard))) {
      return target;
    }
  }

  if (natural) {
    const guards = getTransitionGuards(stage, natural, track);
    if (guards.every((guard) => satisfiedGuards.has(guard))) {
      return natural;
    }
  }

  for (const target of specialTargets) {
    const guards = getTransitionGuards(stage, target, track);
    if (guards.every((guard) => satisfiedGuards.has(guard))) {
      return target;
    }
  }

  return natural;
}

function nextInteractionHints(
  flowState: FlowState,
  args: AdvanceStageArgs,
  successor: FlowStage | null
): FlowState["interactionHints"] {
  const hints: NonNullable<FlowState["interactionHints"]> = { ...(flowState.interactionHints ?? {}) };
  delete hints[args.stage];
  if (successor) {
    if (args.skipQuestions) {
      hints[successor] = {
        skipQuestions: true,
        sourceStage: args.stage,
        recordedAt: new Date().toISOString()
      };
    } else {
      delete hints[successor];
    }
  }
  return hints;
}

/**
 * Wave 24 entry point — auto-hydrate evidence for an auto-hydratable
 * gate that the agent already included in --passed but for which they
 * forgot to provide --evidence-json. Returns silently when no
 * hydration is possible (no auto-hydratable gate, no artifact, no
 * envelope, etc.).
 *
 * Wave 25 (v6.1.0) layered `tryAutoHydrateAndSelectReviewLoopGate` on
 * top of this so the gate is also auto-included in selectedGateIds
 * when the artifact yields a valid envelope. Together the two helpers
 * remove the contradiction the user reported in Wave 24:
 *   - "omit this gate from --evidence-json so stage-complete can
 *      auto-hydrate it" → "missing --evidence-json entries for passed
 *      gates: design_diagram_freshness".
 */
export async function hydrateReviewLoopEvidenceFromArtifact(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"],
  selectedGateIds: string[],
  evidenceByGate: Record<string, string>
): Promise<void> {
  const gateId = AUTO_REVIEW_LOOP_GATE_BY_STAGE[stage];
  if (!gateId) return;
  if (!selectedGateIds.includes(gateId)) return;
  const reviewStage = stage === "scope" || stage === "design" ? stage : null;
  if (!reviewStage) return;

  const existing = evidenceByGate[gateId];
  if (typeof existing === "string" && existing.trim().length > 0) {
    return;
  }

  const resolved = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  let raw = "";
  try {
    raw = await fs.readFile(resolved.absPath, "utf8");
  } catch {
    return;
  }
  const envelope = extractReviewLoopEnvelopeFromArtifact(raw, reviewStage, resolved.relPath);
  if (!envelope) return;
  evidenceByGate[gateId] = JSON.stringify(envelope);
}

/**
 * Wave 25 (v6.1.0) — auto-include an auto-hydratable review-loop gate
 * in `selectedGateIds` when:
 *   - The stage has an auto-hydratable gate registered via
 *     `AUTO_REVIEW_LOOP_GATE_BY_STAGE` (currently `design`).
 *   - The artifact yields a valid review-loop envelope via
 *     `extractReviewLoopEnvelopeFromArtifact`.
 *   - The gate is required for the active track.
 *   - The agent has NOT passed the gate yet (so we don't double-add).
 *
 * Returns the (possibly extended) array of selected gate IDs and
 * mutates `evidenceByGate` to include the hydrated envelope.
 *
 * Together with `hydrateReviewLoopEvidenceFromArtifact` this makes the
 * flow consistent: if the artifact contains the envelope, the agent
 * neither has to include the gate in --passed nor pass --evidence-json
 * for it. If the artifact does NOT contain the envelope, the agent
 * gets a clear error pointing at the artifact section to add (via
 * `reviewLoopArtifactFixHint`).
 */
export async function tryAutoHydrateAndSelectReviewLoopGate(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"],
  requiredGateIds: string[],
  selectedGateIds: string[],
  evidenceByGate: Record<string, string>
): Promise<string[]> {
  const gateId = AUTO_REVIEW_LOOP_GATE_BY_STAGE[stage];
  if (!gateId) return selectedGateIds;
  const reviewStage = stage === "scope" || stage === "design" ? stage : null;
  if (!reviewStage) return selectedGateIds;
  if (!requiredGateIds.includes(gateId)) return selectedGateIds;
  if (selectedGateIds.includes(gateId)) {
    // Already selected — fall through to the existing hydration helper
    // for the manual --evidence-json path.
    await hydrateReviewLoopEvidenceFromArtifact(
      projectRoot,
      stage,
      track,
      selectedGateIds,
      evidenceByGate
    );
    return selectedGateIds;
  }

  const existing = evidenceByGate[gateId];
  if (typeof existing === "string" && existing.trim().length > 0) {
    return [...selectedGateIds, gateId];
  }

  const resolved = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  let raw = "";
  try {
    raw = await fs.readFile(resolved.absPath, "utf8");
  } catch {
    return selectedGateIds;
  }
  const envelope = extractReviewLoopEnvelopeFromArtifact(raw, reviewStage, resolved.relPath);
  if (!envelope) return selectedGateIds;
  evidenceByGate[gateId] = JSON.stringify(envelope);
  return [...selectedGateIds, gateId];
}

export async function buildValidationReport(
  projectRoot: string,
  flowState: FlowState,
  options: { allowBlockedReviewRoute?: boolean; extraStageFlags?: string[] } = {}
): Promise<InternalValidationReport> {
  // Wave 24 follow-up (v6.1.1): forward `flowState.taskClass` so the
  // bugfix-skip lights up via the `cclaw advance-stage` path. The
  // delegation helper now has its own fallback (it reads `flowState`
  // internally), but threading the value here keeps the call site
  // self-documenting and survives any future refactor that drops the
  // implicit fallback.
  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage, {
    taskClass: flowState.taskClass ?? undefined
  });
  const gates = await verifyCurrentStageGateEvidence(projectRoot, flowState, {
    extraStageFlags: options.extraStageFlags
  });
  const completedStages = verifyCompletedStagesGateClosure(flowState);
  const blockedReviewRouteComplete = options.allowBlockedReviewRoute === true
    && flowState.currentStage === "review"
    && typeof flowState.guardEvidence.review_verdict_blocked === "string"
    && flowState.guardEvidence.review_verdict_blocked.trim().length > 0
    && !flowState.stageGateCatalog.review.passed.includes("review_criticals_resolved");
  const ok = delegation.satisfied && gates.ok && (gates.complete || blockedReviewRouteComplete) && completedStages.ok;

  return {
    ok,
    stage: flowState.currentStage,
    delegation: {
      satisfied: delegation.satisfied,
      missing: delegation.missing,
      waived: delegation.waived,
      missingEvidence: delegation.missingEvidence,
      missingDispatchProof: delegation.missingDispatchProof,
      legacyInferredCompletions: delegation.legacyInferredCompletions,
      corruptEventLines: delegation.corruptEventLines,
      staleWorkers: delegation.staleWorkers,
      expectedMode: delegation.expectedMode,
      skippedByTrack: delegation.skippedByTrack
    },
    gates: {
      ok: gates.ok,
      complete: gates.complete,
      issues: gates.issues,
      missingRequired: gates.missingRequired,
      missingTriggeredConditional: gates.missingTriggeredConditional
    },
    completedStages: {
      ok: completedStages.ok,
      issues: completedStages.issues
    }
  };
}

interface HarvestLearningsResult {
  ok: boolean;
  markerWritten: boolean;
  parsedEntries: number;
  appendedEntries: number;
  skippedDuplicates: number;
  details: string;
}

const LEARNINGS_HARVEST_MARKER_PREFIX = "<!-- cclaw:learnings-harvested:";

export function withLearningsHarvestMarker(
  artifactMarkdown: string,
  appendedEntries: number,
  skippedDuplicates: number
): string {
  const suffix = artifactMarkdown.endsWith("\n") ? "" : "\n";
  return `${artifactMarkdown}${suffix}${LEARNINGS_HARVEST_MARKER_PREFIX}${new Date().toISOString()} appended=${appendedEntries} skipped=${skippedDuplicates} -->\n`;
}

export async function harvestStageLearnings(
  projectRoot: string,
  stage: FlowStage,
  track: FlowState["track"]
): Promise<HarvestLearningsResult> {
  const resolvedArtifact = await resolveArtifactPath(stage, {
    projectRoot,
    track,
    intent: "read"
  });
  const artifactPath = resolvedArtifact.absPath;
  let raw = "";
  try {
    raw = await fs.readFile(artifactPath, "utf8");
  } catch (err) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: `Unable to read artifact for learnings harvest (${artifactPath}): ${
        err instanceof Error ? err.message : String(err)
      }`
    };
  }

  if (raw.includes(LEARNINGS_HARVEST_MARKER_PREFIX)) {
    return {
      ok: true,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: "Learnings already harvested for this artifact."
    };
  }

  const learningsBody = extractMarkdownSectionBody(raw, "Learnings");
  if (learningsBody === null) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: 'Artifact is missing required "## Learnings" section.'
    };
  }

  const parsed = parseLearningsSection(learningsBody);
  if (!parsed.ok) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: 0,
      appendedEntries: 0,
      skippedDuplicates: 0,
      details: learningsParseFailureHumanSummary(resolvedArtifact.relPath, parsed.errors)
    };
  }

  const appendResult = await appendKnowledge(projectRoot, parsed.entries, {
    stage,
    originStage: stage,
    project: path.basename(projectRoot)
  });
  if (appendResult.invalid > 0) {
    return {
      ok: false,
      markerWritten: false,
      parsedEntries: parsed.entries.length,
      appendedEntries: appendResult.appended,
      skippedDuplicates: appendResult.skippedDuplicates,
      details: `Learnings append failed schema checks: ${appendResult.errors.join(" | ")}`
    };
  }

  const withMarker = withLearningsHarvestMarker(
    raw,
    appendResult.appended,
    appendResult.skippedDuplicates
  );
  await fs.writeFile(artifactPath, withMarker, "utf8");

  return {
    ok: true,
    markerWritten: true,
    parsedEntries: parsed.entries.length,
    appendedEntries: appendResult.appended,
    skippedDuplicates: appendResult.skippedDuplicates,
    details: parsed.none
      ? "Learnings section marked none; harvest marker recorded."
      : `Harvested ${appendResult.appended} learning entr${appendResult.appended === 1 ? "y" : "ies"} (${appendResult.skippedDuplicates} duplicate skipped).`
  };
}

export async function runAdvanceStage(
  projectRoot: string,
  args: AdvanceStageArgs,
  io: InternalIo
): Promise<number> {
  const flowState = await readFlowState(projectRoot);
  if (flowState.currentStage !== args.stage) {
    io.stderr.write(
      `cclaw internal advance-stage: current stage is "${flowState.currentStage}", not "${args.stage}".\n`
    );
    return 1;
  }

  const schema = stageSchema(args.stage, flowState.track, flowState.discoveryMode, flowState.taskClass ?? null);
  const requiredGateIds = schema.requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  const transitionTargets = getAvailableTransitions(args.stage, flowState.track).map((rule) => rule.to);
  const allowedGateIds = new Set(
    schema.requiredGates.map((gate) => gate.id)
  );
  const transitionGuardIds = new Set(
    transitionTargets
      .flatMap((target) => getTransitionGuards(args.stage, target, flowState.track))
      .filter((guardId) => !allowedGateIds.has(guardId))
  );
  const selectableGateIds = new Set([...allowedGateIds, ...transitionGuardIds]);
  let selectedGateIds =
    args.passedGateIds.length > 0
      ? args.passedGateIds.filter((gateId) => selectableGateIds.has(gateId))
      : requiredGateIds;
  // Wave 25 (v6.1.0): if the active stage has an auto-hydratable
  // review-loop gate (currently `design.design_architecture_locked`)
  // and the artifact already contains a valid review-loop envelope,
  // include the gate in selectedGateIds and hydrate evidence in one
  // step. This removes the Wave 24 contradiction between "omit from
  // --evidence-json so we can auto-hydrate" and "missing
  // --evidence-json entries for passed gates".
  selectedGateIds = await tryAutoHydrateAndSelectReviewLoopGate(
    projectRoot,
    args.stage,
    flowState.track,
    requiredGateIds,
    selectedGateIds,
    args.evidenceByGate
  );
  const selectedGateIdSet = new Set(selectedGateIds);
  const selectedTransitionGuards = selectedGateIds.filter((gateId) => transitionGuardIds.has(gateId));
  const blockedReviewRoute = args.stage === "review" && selectedGateIdSet.has("review_verdict_blocked");
  const requiredForSelectedRoute = blockedReviewRoute
    ? requiredGateIds.filter((gateId) => gateId !== "review_criticals_resolved")
    : requiredGateIds;
  const missingRequired = requiredForSelectedRoute.filter((gateId) => !selectedGateIdSet.has(gateId));
  if (missingRequired.length > 0) {
    const autoHydrateGate = AUTO_REVIEW_LOOP_GATE_BY_STAGE[args.stage];
    const autoHydrateHint =
      autoHydrateGate && missingRequired.includes(autoHydrateGate) && (args.stage === "scope" || args.stage === "design")
        ? ` Auto-hydratable gate "${autoHydrateGate}" was NOT auto-included because the design artifact is missing the review-loop envelope. Add a \`## ${args.stage === "scope" ? "Scope Outside Voice Loop" : "Design Outside Voice Loop"}\` table (example envelope: ${reviewLoopEnvelopeExample(args.stage)}), or pass --evidence-json='{"${autoHydrateGate}": "<envelope-json>"}' alongside --passed=...,${autoHydrateGate}.`
        : "";
    io.stderr.write(
      `cclaw internal advance-stage: required gates not selected as passed: ${missingRequired.join(", ")}.${autoHydrateHint}\n`
    );
    return 1;
  }

  const mandatory = new Set(schema.mandatoryDelegations);
  for (const agent of args.waiveDelegations) {
    if (!mandatory.has(agent)) {
      io.stderr.write(
        `cclaw internal advance-stage: cannot waive "${agent}" for stage "${args.stage}" (not mandatory).\n`
      );
      return 1;
    }
  }

  if (args.waiveDelegations.length > 0) {
    const waiverReason = args.waiverReason?.trim();
    if (!waiverReason) {
      io.stderr.write(
        "cclaw internal advance-stage: --waive-delegation requires an explicit non-empty --waiver-reason.\n"
      );
      return 1;
    }
    for (const agent of args.waiveDelegations) {
      await appendDelegation(projectRoot, {
        stage: args.stage,
        agent,
        mode: "mandatory",
        status: "waived",
        waiverReason,
        runId: flowState.activeRunId,
        fulfillmentMode: "role-switch",
        ts: new Date().toISOString()
      });
    }
  }

  // Wave 25 (v6.1.0): hydration + auto-select happens earlier via
  // `tryAutoHydrateAndSelectReviewLoopGate`. The previous explicit
  // call here was redundant (helper already covered both the
  // already-selected and not-yet-selected paths).

  const catalog = flowState.stageGateCatalog[args.stage];
  const nextPassed = unique([...catalog.passed, ...selectedGateIds]).filter((gateId) =>
    allowedGateIds.has(gateId)
  );
  const nextPassedSet = new Set(nextPassed);
  const nextBlocked = unique(catalog.blocked.filter((gateId) => !nextPassedSet.has(gateId))).filter(
    (gateId) => allowedGateIds.has(gateId)
  );
  const conditional = new Set(catalog.conditional);
  const nextTriggered = unique([
    ...catalog.triggered.filter((gateId) => conditional.has(gateId)),
    ...nextPassed.filter((gateId) => conditional.has(gateId)),
    ...nextBlocked.filter((gateId) => conditional.has(gateId))
  ]);
  const guardEvidenceGateIds = unique([...nextPassed, ...selectedTransitionGuards]);
  const missingGuardEvidence = guardEvidenceGateIds.filter((gateId) => {
    const existing = flowState.guardEvidence[gateId];
    if (typeof existing === "string" && existing.trim().length > 0) {
      return false;
    }
    const provided = args.evidenceByGate[gateId];
    return !(typeof provided === "string" && provided.trim().length > 0);
  });
  if (missingGuardEvidence.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: missing --evidence-json entries for passed gates: ${missingGuardEvidence.join(", ")}.\n`
    );
    return 1;
  }
  const malformedGateEvidence: string[] = [];
  for (const gateId of nextPassed) {
    const provided = args.evidenceByGate[gateId];
    const existing = flowState.guardEvidence[gateId];
    const effectiveEvidence =
      typeof provided === "string" && provided.trim().length > 0
        ? provided
        : typeof existing === "string" && existing.trim().length > 0
          ? existing
          : "";
    const issue = await validateGateEvidenceShape(projectRoot, args.stage, gateId, effectiveEvidence);
    if (issue) {
      malformedGateEvidence.push(`${gateId}: ${issue}${reviewLoopArtifactFixHint(args.stage, gateId)}`);
    }
  }
  if (malformedGateEvidence.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: gate evidence format check failed: ${malformedGateEvidence.join(" | ")}.\n`
    );
    return 1;
  }
  const nextGuardEvidence: Record<string, string> = { ...flowState.guardEvidence };
  for (const gateId of guardEvidenceGateIds) {
    const provided = args.evidenceByGate[gateId];
    if (typeof provided === "string" && provided.trim().length > 0) {
      nextGuardEvidence[gateId] = provided.trim();
    }
  }
  const nextStageCatalog: StageGateState = {
    required: [...catalog.required],
    recommended: [...catalog.recommended],
    conditional: [...catalog.conditional],
    triggered: nextTriggered,
    passed: nextPassed,
    blocked: nextBlocked
  };
  const candidateState: FlowState = {
    ...flowState,
    guardEvidence: nextGuardEvidence,
    stageGateCatalog: {
      ...flowState.stageGateCatalog,
      [args.stage]: nextStageCatalog
    }
  };

  const validation = await buildValidationReport(projectRoot, candidateState, {
    allowBlockedReviewRoute: blockedReviewRoute,
    extraStageFlags: args.skipQuestions ? ["--skip-questions"] : undefined
  });
  if (!validation.ok) {
    const delegationFailureCount =
      validation.delegation.missing.length +
      validation.delegation.missingEvidence.length +
      validation.delegation.missingDispatchProof.length +
      validation.delegation.legacyInferredCompletions.length +
      validation.delegation.corruptEventLines.length +
      validation.delegation.staleWorkers.length;
    const gatesFailureCount = validation.gates.issues.length;
    const closureFailureCount = validation.completedStages.issues.length;
    const failureCounts = {
      delegation: delegationFailureCount,
      gates: gatesFailureCount,
      closure: closureFailureCount
    };
    const ledgerForDiag = await readDelegationLedger(projectRoot).catch(() => ({ entries: [] as Array<{ agent: string; spanId?: string; status: string; runId?: string }> }));
    const eventsForDiag = await readDelegationEvents(projectRoot).catch(() => ({ events: [] as Array<{ agent: string; spanId?: string; status: string; runId?: string }>, corruptLines: [] as number[] }));
    const ledgerEntriesText = await fs.readFile(path.join(projectRoot, ".cclaw/state/delegation-events.jsonl"), "utf8").catch(() => "");
    const corruptSnippets = (() => {
      if (validation.delegation.corruptEventLines.length === 0) return [] as string[];
      const lines = ledgerEntriesText.split(/\r?\n/u);
      return validation.delegation.corruptEventLines.slice(0, 3).map((lineNo) => {
        const line = lines[lineNo - 1] ?? "";
        const sample = line.length > 120 ? `${line.slice(0, 117)}...` : line;
        return `line ${lineNo}: ${sample}`;
      });
    })();
    const dispatchProofDetails = validation.delegation.missingDispatchProof.flatMap((agent) => {
      const rows = ledgerForDiag.entries.filter((entry) => entry.agent === agent && entry.status === "completed");
      return rows.map((row) => `${agent}(spanId=${row.spanId ?? "unknown"})`);
    });
    const nextActions: string[] = [];
    if (validation.delegation.missing.length > 0) {
      nextActions.push(
        `Run mandatory delegation(s) for stage "${args.stage}": ${validation.delegation.missing.join(", ")}. These roles are required by the stage schema before advance. If dispatch is impossible, use the waiver fallback only with a user-visible reason: \`node .cclaw/hooks/stage-complete.mjs ${args.stage} --waive-delegation=${validation.delegation.missing.join(",")} --waiver-reason="<why safe>"\`.`
      );
    }
    if (validation.delegation.missingEvidence.length > 0) {
      nextActions.push(
        `Role-switch fallback completion needs artifact evidenceRefs naming what the role proved; rerun completion with --evidence-ref=<artifact#anchor> or escalate to a real isolated dispatch surface.`
      );
    }
    if (validation.delegation.missingDispatchProof.length > 0) {
      nextActions.push(
        `Isolated completion(s) ${dispatchProofDetails.join(", ") || validation.delegation.missingDispatchProof.join(", ")} lack event-log dispatch proof. The ledger says completed, but .cclaw/state/delegation-events.jsonl must show scheduled -> launched -> acknowledged -> completed with --span-id, --dispatch-id, --dispatch-surface, --agent-definition-path, ackTs, and completedTs before advancing.`
      );
    }
    if (validation.delegation.legacyInferredCompletions.length > 0) {
      nextActions.push(
        `Pre-v3 ledger entries found: ${validation.delegation.legacyInferredCompletions.join(", ")}. Run \`node .cclaw/hooks/delegation-record.mjs --rerecord --span-id=<id> --dispatch-id=<id> --dispatch-surface=<surface> --agent-definition-path=<path>\` to upgrade the row to dispatch-proof shape.`
      );
    }
    if (validation.delegation.corruptEventLines.length > 0) {
      nextActions.push(
        `delegation-events.jsonl has ${validation.delegation.corruptEventLines.length} corrupt line(s) at ${validation.delegation.corruptEventLines.slice(0, 3).join(", ")}${validation.delegation.corruptEventLines.length > 3 ? ", ..." : ""}; remove or fix them before advancing.`
      );
    }
    if (validation.delegation.staleWorkers.length > 0) {
      nextActions.push(
        `Stale scheduled delegations ${validation.delegation.staleWorkers.join(", ")} have no terminal row sharing the same spanId; emit launched/acknowledged/completed (or failed/stale) before advancing.`
      );
    }
    if (validation.gates.issues.length > 0) {
      nextActions.push("Fix the artifact/gate issue shown in gates.issues, then rerun stage-complete.");
    }
    if (validation.completedStages.issues.length > 0) {
      nextActions.push("Repair previously completed stage gate closure before advancing.");
    }
    if (args.json) {
      io.stdout.write(`${JSON.stringify({
        ok: false,
        command: "advance-stage",
        stage: args.stage,
        kind: "validation-failed",
        failureCounts,
        delegation: validation.delegation,
        gates: validation.gates,
        completedStages: validation.completedStages,
        diagnostics: {
          dispatchProofRows: dispatchProofDetails,
          corruptEventSamples: corruptSnippets,
          unawareEvents: eventsForDiag.corruptLines.length
        },
        nextActions
      })}\n`);
    }
    io.stderr.write(
      `cclaw internal advance-stage: validation failed for stage "${args.stage}" (delegation=${failureCounts.delegation}, gates=${failureCounts.gates}, closure=${failureCounts.closure}).\n`
    );
    if (validation.delegation.missing.length > 0) {
      io.stderr.write(`- missing delegations: ${validation.delegation.missing.join(", ")}\n`);
      io.stderr.write(
        `  next action: run the named agent(s) for this stage, or rerun with --waive-delegation=${validation.delegation.missing.join(",")} --waiver-reason="<why safe>" only when the user accepts the safety trade-off.\n`
      );
    }
    if (validation.delegation.missingEvidence.length > 0) {
      io.stderr.write(
        `- role-switch evidence missing: ${validation.delegation.missingEvidence.join(", ")}\n`
      );
      io.stderr.write(
        `  next action: include --evidence-ref=<artifact#anchor> when emitting the completed event so the artifact shows what was reviewed/proved, or escalate to a true isolated dispatch surface.\n`
      );
    }
    if (validation.delegation.missingDispatchProof.length > 0) {
      io.stderr.write(
        `- isolated completion lacks dispatch proof: ${dispatchProofDetails.join(", ") || validation.delegation.missingDispatchProof.join(", ")}\n`
      );
      io.stderr.write(
        `  next action: repair the event log proof by emitting scheduled -> launched -> acknowledged -> completed with --span-id, --dispatch-id, --dispatch-surface, --agent-definition-path, ackTs, and completedTs before advancing.\n`
      );
    }
    if (validation.delegation.legacyInferredCompletions.length > 0) {
      io.stderr.write(
        `- legacy-inferred completions need rerecord: ${validation.delegation.legacyInferredCompletions.join(", ")}\n`
      );
      io.stderr.write(
        `  next action: \`node .cclaw/hooks/delegation-record.mjs --rerecord --span-id=<id> --dispatch-id=<id> --dispatch-surface=<surface> --agent-definition-path=<path>\`.\n`
      );
    }
    if (validation.delegation.corruptEventLines.length > 0) {
      io.stderr.write(
        `- corrupt delegation-events.jsonl line(s): ${validation.delegation.corruptEventLines.slice(0, 3).join(", ")}${validation.delegation.corruptEventLines.length > 3 ? `, ... (+${validation.delegation.corruptEventLines.length - 3})` : ""}\n`
      );
      for (const snippet of corruptSnippets) {
        io.stderr.write(`    sample: ${snippet}\n`);
      }
    }
    if (validation.delegation.staleWorkers.length > 0) {
      io.stderr.write(
        `- stale scheduled delegations: ${validation.delegation.staleWorkers.join(", ")}\n`
      );
      io.stderr.write(
        `  next action: emit a terminal row (completed/failed/stale) for the same span before advancing.\n`
      );
    }
    if (validation.gates.issues.length > 0) {
      io.stderr.write(`- gate issues: ${validation.gates.issues.join(" | ")}\n`);
    }
    if (validation.completedStages.issues.length > 0) {
      io.stderr.write(
        `- completed-stage closure issues: ${validation.completedStages.issues.join(" | ")}\n`
      );
    }
    return 1;
  }

  const proactiveTrace = await ensureProactiveDelegationTrace(projectRoot, args.stage, {
    acceptWaiver: args.acceptProactiveWaiver,
    waiverReason: args.acceptProactiveWaiverReason,
    discoveryMode: flowState.discoveryMode,
    repoSignals: flowState.repoSignals
  });
  if (proactiveTrace.missingRules.length > 0) {
    const missingSummary = proactiveTrace.missingRules
      .map((rule) => `${rule.agent} (when: ${rule.when})`)
      .join(", ");
    const nextAction =
      "Run the proactive delegations listed above, or rerun stage-complete with " +
      "--accept-proactive-waiver [--accept-proactive-waiver-reason=\"<why safe>\"] " +
      "after explicit user approval.";
    if (args.json) {
      io.stdout.write(`${JSON.stringify({
        ok: false,
        command: "advance-stage",
        stage: args.stage,
        kind: "proactive-delegations-missing",
        proactiveDelegations: proactiveTrace.missingRules.map((rule) => ({
          agent: rule.agent,
          when: rule.when,
          skill: rule.skill ?? null
        })),
        nextActions: [nextAction]
      })}\n`);
    }
    io.stderr.write(
      `cclaw internal advance-stage: proactive delegation evidence is missing for stage "${args.stage}": ${missingSummary}.\n`
    );
    io.stderr.write(`  next action: ${nextAction}\n`);
    return 1;
  }

  const learningsHarvest = await harvestStageLearnings(
    projectRoot,
    args.stage,
    flowState.track
  );
  if (!learningsHarvest.ok) {
    io.stderr.write(`cclaw internal advance-stage: ${learningsHarvest.details}\n`);
    return 1;
  }

  const satisfiedGuards = new Set<string>([...nextPassed, ...selectedTransitionGuards]);
  const successor = resolveSuccessorTransition(
    args.stage,
    flowState.track,
    transitionTargets,
    satisfiedGuards,
    new Set(selectedTransitionGuards)
  );
  const completedStages = blockedReviewRoute
    ? flowState.completedStages.filter((finished) => finished !== args.stage)
    : flowState.completedStages.includes(args.stage)
      ? [...flowState.completedStages]
      : [...flowState.completedStages, args.stage];
  let completedStageMeta = flowState.completedStageMeta ?? {};
  if (!blockedReviewRoute && !flowState.completedStages.includes(args.stage)) {
    completedStageMeta = {
      ...completedStageMeta,
      [args.stage]: { completedAt: new Date().toISOString() }
    };
  }
  const interactionHints = nextInteractionHints(flowState, args, successor);
  const finalState: FlowState = {
    ...candidateState,
    completedStages,
    completedStageMeta,
    currentStage: successor ?? args.stage,
    interactionHints
  };

  await writeFlowState(projectRoot, finalState);

  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: true,
      command: "advance-stage",
      stage: args.stage,
      nextStage: successor,
      currentStage: finalState.currentStage,
      completedStages: finalState.completedStages,
      skipQuestionsHint: args.skipQuestions,
      learnings: {
        parsed: learningsHarvest.parsedEntries,
        appended: learningsHarvest.appendedEntries,
        skippedDuplicates: learningsHarvest.skippedDuplicates,
        markerWritten: learningsHarvest.markerWritten,
        details: learningsHarvest.details
      }
    }, null, 2)}\n`);
  }
  return 0;
}
