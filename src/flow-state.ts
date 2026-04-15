import { COMMAND_FILE_ORDER } from "./constants.js";
import { buildTransitionRules, orderedStageSchemas, stageGateIds } from "./content/stage-schema.js";
import type { FlowStage, TransitionRule } from "./types.js";

export const TRANSITION_RULES: TransitionRule[] = buildTransitionRules();

export interface StageGateState {
  required: string[];
  passed: string[];
  blocked: string[];
}

export interface FlowState {
  activeRunId: string;
  currentStage: FlowStage;
  completedStages: FlowStage[];
  guardEvidence: Record<string, string>;
  stageGateCatalog: Record<FlowStage, StageGateState>;
}

export function createInitialFlowState(activeRunId = "active"): FlowState {
  const stageGateCatalog = {} as Record<FlowStage, StageGateState>;
  for (const schema of orderedStageSchemas()) {
    stageGateCatalog[schema.stage] = {
      required: stageGateIds(schema.stage),
      passed: [],
      blocked: []
    };
  }

  return {
    activeRunId,
    currentStage: "brainstorm",
    completedStages: [],
    guardEvidence: {},
    stageGateCatalog
  };
}

export function canTransition(from: FlowStage, to: FlowStage): boolean {
  return TRANSITION_RULES.some((rule) => rule.from === from && rule.to === to);
}

export function getTransitionGuards(from: FlowStage, to: FlowStage): string[] {
  const match = TRANSITION_RULES.find((rule) => rule.from === from && rule.to === to);
  return match ? [...match.guards] : [];
}

export function nextStage(stage: FlowStage): FlowStage | null {
  const index = COMMAND_FILE_ORDER.indexOf(stage);
  if (index < 0 || index === COMMAND_FILE_ORDER.length - 1) {
    return null;
  }

  return COMMAND_FILE_ORDER[index + 1];
}

export function previousStage(stage: FlowStage): FlowStage | null {
  const index = COMMAND_FILE_ORDER.indexOf(stage);
  if (index <= 0) {
    return null;
  }

  return COMMAND_FILE_ORDER[index - 1];
}
