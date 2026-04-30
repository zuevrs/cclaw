/**
 * Shared runtime snippets interpolated into generated hook/plugin scripts.
 *
 * Keep these string helpers minimal and dependency-free so both runtimes
 * (node hooks and OpenCode plugin) stay in sync without duplicating constants.
 */

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
