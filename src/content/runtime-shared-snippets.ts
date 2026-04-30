/**
 * Shared runtime snippets interpolated into generated hook/plugin scripts.
 *
 * Keep these string helpers minimal and dependency-free so both runtimes
 * (node hooks and OpenCode plugin) stay in sync without duplicating constants.
 */

export const SHARED_FLOW_AND_KNOWLEDGE_SNIPPETS = `
function summarizeFlowState(rawState) {
  const state =
    rawState && typeof rawState === "object" && !Array.isArray(rawState)
      ? rawState
      : {};
  return {
    stage: typeof state.currentStage === "string" ? state.currentStage : "none",
    completed: Array.isArray(state.completedStages) ? state.completedStages.length : 0,
    activeRunId: typeof state.activeRunId === "string" ? state.activeRunId : "none"
  };
}

function parseKnowledgeDigest(rawKnowledge, currentStage, maxRows = 6) {
  const text = typeof rawKnowledge === "string" ? rawKnowledge : "";
  if (text.trim().length === 0) {
    return { learningsCount: 0, lines: [] };
  }
  const rows = text
    .split(/\\r?\\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  let learningsCount = 0;
  const parsedRows = [];
  for (const line of rows) {
    if (line.startsWith("{")) learningsCount += 1;
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
      parsedRows.push(parsed);
    } catch {
      // ignore malformed knowledge line in digest
    }
  }
  const lines = parsedRows
    .filter((row) => {
      const stage = typeof row.stage === "string" ? row.stage : null;
      return stage === null || stage === currentStage;
    })
    .slice(-maxRows)
    .reverse()
    .map((row) => {
      const confidence = typeof row.confidence === "string" ? row.confidence : "unknown";
      const stage = typeof row.stage === "string" ? row.stage : "global";
      const trigger = typeof row.trigger === "string" ? row.trigger : "trigger";
      const action = typeof row.action === "string" ? row.action : "action";
      return "- [" + confidence + " • " + stage + "] " + trigger + " -> " + action;
    });
  return { learningsCount, lines };
}

function activeArtifactsPathLabel(runtimeRoot) {
  return String(runtimeRoot || ".cclaw") + "/artifacts/";
}
`;

export const SHARED_STAGE_SUPPORT_SNIPPETS = `
const STAGE_IDS = ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"];
const REVIEW_PROMPT_BY_STAGE = {
  brainstorm: "brainstorm-self-review.md",
  scope: "scope-ceo-review.md",
  design: "design-eng-review.md"
};
const REVIEW_PROMPT_FILES = Object.values(REVIEW_PROMPT_BY_STAGE);

function isKnownStageId(stage) {
  return typeof stage === "string" && STAGE_IDS.includes(stage);
}

function reviewPromptFileName(stage) {
  if (!isKnownStageId(stage)) return null;
  const name = REVIEW_PROMPT_BY_STAGE[stage];
  return typeof name === "string" ? name : null;
}
`;
