import { FLOW_STAGES, type FlowStage } from "../../types.js";
import {
  isFlowTrack,
  type FlowState
} from "../../flow-state.js";
import {
  emptyGateState,
  isFlowStageValue,
  parseGuardEvidence,
  parseStringList,
  unique
} from "./helpers.js";

export function parseCandidateGateCatalog(
  value: unknown,
  fallback: FlowState["stageGateCatalog"]
): FlowState["stageGateCatalog"] {
  const next = {} as FlowState["stageGateCatalog"];
  for (const stage of FLOW_STAGES) {
    // Guard against stale on-disk flow-state files that persisted a partial
    // stageGateCatalog (missing a stage key). Previously `fallback[stage]`
    // could be undefined and the spread below would throw at runtime.
    const base = fallback[stage] ?? emptyGateState();
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered: [...base.triggered],
      passed: [...base.passed],
      blocked: [...base.blocked]
    };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }
  const rawCatalog = value as Record<string, unknown>;
  for (const stage of FLOW_STAGES) {
    const rawStage = rawCatalog[stage];
    if (!rawStage || typeof rawStage !== "object" || Array.isArray(rawStage)) {
      continue;
    }
    const typed = rawStage as Record<string, unknown>;
    const base = fallback[stage] ?? emptyGateState();
    const allowed = new Set([...base.required, ...base.recommended, ...base.conditional]);
    const conditional = new Set(base.conditional);
    const passed = unique(parseStringList(typed.passed)).filter((gateId) =>
      allowed.has(gateId)
    );
    const blocked = unique(parseStringList(typed.blocked)).filter((gateId) =>
      allowed.has(gateId)
    );
    const triggered = unique([
      ...parseStringList(typed.triggered).filter((gateId) => conditional.has(gateId)),
      ...passed.filter((gateId) => conditional.has(gateId)),
      ...blocked.filter((gateId) => conditional.has(gateId))
    ]);
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered,
      passed,
      blocked
    };
  }
  return next;
}

export function coerceCandidateFlowState(raw: unknown, fallback: FlowState): FlowState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fallback;
  }
  const typed = raw as Record<string, unknown>;
  const track = isFlowTrack(typed.track) ? typed.track : fallback.track;
  const currentStage = isFlowStageValue(typed.currentStage)
    ? typed.currentStage
    : fallback.currentStage;
  const completedStages = unique(
    parseStringList(typed.completedStages).filter((stage): stage is FlowStage =>
      isFlowStageValue(stage)
    )
  );
  const skippedStagesRaw = parseStringList(typed.skippedStages).filter((stage): stage is FlowStage =>
    isFlowStageValue(stage)
  );
  const skippedStages = skippedStagesRaw.length > 0 ? skippedStagesRaw : fallback.skippedStages;

  // When the candidate payload omits `guardEvidence` entirely we must keep
  // the on-disk fallback — otherwise a partial update (e.g. a tooling call
  // that only passes stage + passedGateIds) would silently wipe every
  // previously recorded evidence string and fail the next
  // `verifyCurrentStageGateEvidence` check.
  const candidateEvidence = parseGuardEvidence(typed.guardEvidence);
  const guardEvidence =
    typed.guardEvidence === undefined
      ? { ...fallback.guardEvidence }
      : candidateEvidence;

  return {
    ...fallback,
    currentStage,
    completedStages,
    track,
    skippedStages,
    guardEvidence,
    stageGateCatalog: parseCandidateGateCatalog(
      typed.stageGateCatalog,
      fallback.stageGateCatalog
    )
  };
}
