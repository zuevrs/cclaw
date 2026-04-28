import { CCLAW_VERSION, RUNTIME_ROOT, SHIP_FINALIZATION_MODES } from "../constants.js";
import { FLOW_STAGES, type FlowStage } from "../types.js";

interface StateContract {
  schemaVersion: 1;
  contractId: string;
  stage: FlowStage;
  derivedMarkdownPath: string;
  requiredTopLevelFields: string[];
  taxonomies: Record<string, string[]>;
}

const REQUIRED_TOP_LEVEL_FIELDS: Record<FlowStage, string[]> = {
  brainstorm: ["stage", "selectedDirection", "approachTier", "approaches", "approval", "nextStageHandoff"],
  scope: ["stage", "scopeMode", "requirements", "lockedDecisions", "scopeSummary", "nextStageHandoff"],
  design: ["stage", "architecture", "dataFlow", "failureModes", "requirementRefs", "decisionRefs"],
  spec: ["stage", "acceptanceCriteria", "requirementRefs", "designDecisionRefs"],
  plan: ["stage", "tasks", "acceptanceCriteriaRefs", "requirementRefs", "decisionRefs", "verificationCommands"],
  tdd: ["stage", "redEvidence", "greenEvidence", "acceptanceCriteriaRefs", "verificationCommands"],
  review: ["stage", "finalVerdict", "findings", "acceptanceCriteriaRefs", "requirementRefs", "verificationCommands"],
  ship: ["stage", "finalizationMode", "verificationSummary", "releaseNotesDraft"]
};

const STAGE_TAXONOMIES: Record<FlowStage, Record<string, string[]>> = {
  brainstorm: {
    approachTier: ["Lightweight", "Standard", "Deep", "lite", "standard", "deep"],
    approachRole: ["baseline", "challenger", "wild-card"],
    approachUpside: ["low", "modest", "high", "higher"]
  },
  scope: {
    scopeMode: ["SCOPE EXPANSION", "SELECTIVE EXPANSION", "HOLD SCOPE", "SCOPE REDUCTION"],
    priority: ["P0", "P1", "P2", "P3", "DROPPED"]
  },
  design: {
    diagramTier: ["lightweight", "standard", "deep"],
    edgeKind: ["sync", "async", "failure", "degraded"]
  },
  spec: {
    priority: ["P0", "P1", "P2", "P3", "DROPPED"]
  },
  plan: {
    taskStatus: ["pending", "in_progress", "blocked", "done", "dropped"]
  },
  tdd: {
    cycleState: ["RED", "GREEN", "REFACTOR", "BLOCKED"]
  },
  review: {
    finalVerdict: ["APPROVED", "APPROVED_WITH_CONCERNS", "BLOCKED"],
    findingSeverity: ["Critical", "High", "Medium", "Low", "Info"]
  },
  ship: {
    finalizationMode: [...SHIP_FINALIZATION_MODES]
  }
};

function stateContract(stage: FlowStage): StateContract {
  const stageIndex = FLOW_STAGES.indexOf(stage) + 1;
  const stageNumber = String(stageIndex).padStart(2, "0");
  return {
    schemaVersion: 1,
    contractId: `cclaw-${stage}-state`,
    stage,
    derivedMarkdownPath: `${RUNTIME_ROOT}/artifacts/${stageNumber}-${stage}.md`,
    requiredTopLevelFields: REQUIRED_TOP_LEVEL_FIELDS[stage],
    taxonomies: STAGE_TAXONOMIES[stage]
  };
}

export const STATE_CONTRACTS: Record<string, string> = Object.fromEntries(
  FLOW_STAGES.map((stage) => [
    `${stage}.json`,
    `${JSON.stringify({
      ...stateContract(stage),
      generatedBy: "cclaw",
      cclawVersion: CCLAW_VERSION
    }, null, 2)}\n`
  ])
);
