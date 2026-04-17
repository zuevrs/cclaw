import { COMMAND_FILE_ORDER } from "./constants.js";
import {
  buildTransitionRules,
  orderedStageSchemas,
  stageConditionalGateIds,
  stageGateIds,
  stageRecommendedGateIds
} from "./content/stage-schema.js";
import { FLOW_STAGES, FLOW_TRACKS, TRACK_STAGES } from "./types.js";
import type { FlowStage, FlowTrack, TransitionRule } from "./types.js";

export const TRANSITION_RULES: TransitionRule[] = buildTransitionRules();

export interface StageGateState {
  required: string[];
  recommended: string[];
  conditional: string[];
  /** Conditional gates currently considered active for blocking checks. */
  triggered: string[];
  passed: string[];
  blocked: string[];
}

export interface FlowState {
  activeRunId: string;
  currentStage: FlowStage;
  completedStages: FlowStage[];
  guardEvidence: Record<string, string>;
  stageGateCatalog: Record<FlowStage, StageGateState>;
  /** Active flow track (determines which stages are in the critical path for this run). */
  track: FlowTrack;
  /** Stages explicitly skipped for this track (empty for standard; populated for quick). */
  skippedStages: FlowStage[];
}

export interface InitialFlowStateOptions {
  activeRunId?: string;
  track?: FlowTrack;
}

export function isFlowTrack(value: unknown): value is FlowTrack {
  return typeof value === "string" && (FLOW_TRACKS as readonly string[]).includes(value);
}

export function trackStages(track: FlowTrack): FlowStage[] {
  return [...TRACK_STAGES[track]];
}

export function skippedStagesForTrack(track: FlowTrack): FlowStage[] {
  const inTrack = new Set(TRACK_STAGES[track]);
  return FLOW_STAGES.filter((stage) => !inTrack.has(stage));
}

export function firstStageForTrack(track: FlowTrack): FlowStage {
  const stages = TRACK_STAGES[track];
  return stages[0] ?? "brainstorm";
}

export function createInitialFlowState(
  activeRunIdOrOptions: string | InitialFlowStateOptions = "active",
  maybeTrack?: FlowTrack
): FlowState {
  const options: InitialFlowStateOptions =
    typeof activeRunIdOrOptions === "string"
      ? { activeRunId: activeRunIdOrOptions, track: maybeTrack }
      : activeRunIdOrOptions;

  const activeRunId = options.activeRunId ?? "active";
  const track: FlowTrack = options.track ?? "standard";
  const skippedStages = skippedStagesForTrack(track);

  const stageGateCatalog = {} as Record<FlowStage, StageGateState>;
  for (const schema of orderedStageSchemas()) {
    stageGateCatalog[schema.stage] = {
      required: stageGateIds(schema.stage),
      recommended: stageRecommendedGateIds(schema.stage),
      conditional: stageConditionalGateIds(schema.stage),
      triggered: [],
      passed: [],
      blocked: []
    };
  }

  return {
    activeRunId,
    currentStage: firstStageForTrack(track),
    completedStages: [],
    guardEvidence: {},
    stageGateCatalog,
    track,
    skippedStages
  };
}

export function canTransition(from: FlowStage, to: FlowStage): boolean {
  return TRANSITION_RULES.some((rule) => rule.from === from && rule.to === to);
}

export function getTransitionGuards(from: FlowStage, to: FlowStage): string[] {
  const match = TRANSITION_RULES.find((rule) => rule.from === from && rule.to === to);
  return match ? [...match.guards] : [];
}

export function nextStage(stage: FlowStage, track: FlowTrack = "standard"): FlowStage | null {
  const ordered = TRACK_STAGES[track];
  const index = ordered.indexOf(stage);
  if (index < 0) {
    const fallback = COMMAND_FILE_ORDER.indexOf(stage);
    if (fallback < 0 || fallback === COMMAND_FILE_ORDER.length - 1) {
      return null;
    }
    return COMMAND_FILE_ORDER[fallback + 1];
  }
  if (index === ordered.length - 1) {
    return null;
  }
  return ordered[index + 1];
}

export function previousStage(stage: FlowStage, track: FlowTrack = "standard"): FlowStage | null {
  const ordered = TRACK_STAGES[track];
  const index = ordered.indexOf(stage);
  if (index === 0) {
    return null;
  }
  if (index < 0) {
    const fallback = COMMAND_FILE_ORDER.indexOf(stage);
    if (fallback <= 0) {
      return null;
    }
    return COMMAND_FILE_ORDER[fallback - 1];
  }
  return ordered[index - 1];
}
