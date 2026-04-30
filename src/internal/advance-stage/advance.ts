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
import { extractMarkdownSectionBody, parseLearningsSection } from "../../artifact-linter.js";
import {
  getAvailableTransitions,
  getTransitionGuards,
  type FlowState,
  type StageGateState
} from "../../flow-state.js";
import { appendKnowledge } from "../../knowledge-store.js";
import { readFlowState, writeFlowState } from "../../runs.js";
import { TRACK_STAGES, type FlowStage, type FlowTrack } from "../../types.js";
import {
  stageAutoSubagentDispatch,
  stageSchema,
  type StageAutoSubagentDispatch
} from "../../content/stage-schema.js";
import { extractReviewLoopEnvelopeFromArtifact } from "../../content/review-loop.js";
import { unique } from "./helpers.js";
import {
  AUTO_REVIEW_LOOP_GATE_BY_STAGE,
  reviewLoopArtifactFixHint,
  validateGateEvidenceShape
} from "./review-loop.js";
import type { AdvanceStageArgs } from "./parsers.js";
import { ensureProactiveDelegationTrace } from "./verify.js";
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

interface ProactiveDelegationTraceResult {
  missingRules: StageAutoSubagentDispatch[];
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

export async function buildValidationReport(
  projectRoot: string,
  flowState: FlowState,
  options: { allowBlockedReviewRoute?: boolean } = {}
): Promise<InternalValidationReport> {
  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage);
  const gates = await verifyCurrentStageGateEvidence(projectRoot, flowState);
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
      expectedMode: delegation.expectedMode
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
      details: parsed.details
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

  const schema = stageSchema(args.stage, flowState.track);
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
  const selectedGateIds =
    args.passedGateIds.length > 0
      ? args.passedGateIds.filter((gateId) => selectableGateIds.has(gateId))
      : requiredGateIds;
  const selectedGateIdSet = new Set(selectedGateIds);
  const selectedTransitionGuards = selectedGateIds.filter((gateId) => transitionGuardIds.has(gateId));
  const blockedReviewRoute = args.stage === "review" && selectedGateIdSet.has("review_verdict_blocked");
  const requiredForSelectedRoute = blockedReviewRoute
    ? requiredGateIds.filter((gateId) => gateId !== "review_criticals_resolved")
    : requiredGateIds;
  const missingRequired = requiredForSelectedRoute.filter((gateId) => !selectedGateIdSet.has(gateId));
  if (missingRequired.length > 0) {
    io.stderr.write(
      `cclaw internal advance-stage: required gates not selected as passed: ${missingRequired.join(", ")}.\n`
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

  await hydrateReviewLoopEvidenceFromArtifact(
    projectRoot,
    args.stage,
    flowState.track,
    selectedGateIds,
    args.evidenceByGate
  );

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
    allowBlockedReviewRoute: blockedReviewRoute
  });
  if (!validation.ok) {
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
      `cclaw internal advance-stage: validation failed for stage "${args.stage}".\n`
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
    waiverReason: args.acceptProactiveWaiverReason
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
    io.stderr.write(
      `cclaw internal advance-stage: learnings harvest failed for "${schema.artifactFile}". ${learningsHarvest.details}\n`
    );
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
    ? flowState.completedStages.filter((stage) => stage !== args.stage)
    : flowState.completedStages.includes(args.stage)
      ? [...flowState.completedStages]
      : [...flowState.completedStages, args.stage];
  const interactionHints = nextInteractionHints(flowState, args, successor);
  const finalState: FlowState = {
    ...candidateState,
    completedStages,
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
