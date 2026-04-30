/**
 * Shared wording blocks for Decision Protocol + structured ask fallback.
 *
 * Keep stage/utility prompt surfaces consistent and reduce wording drift.
 */

export const STRUCTURED_ASK_TOOL_LIST_GENERIC =
  "\`AskUserQuestion\` / \`AskQuestion\` / \`question\` / \`request_user_input\`";

export const STRUCTURED_ASK_TOOL_LIST_REVIEW =
  "\`AskUserQuestion\` on Claude, \`AskQuestion\` on Cursor, \`question\` on OpenCode with \`permission.question: \"allow\"\`, \`request_user_input\` on Codex in Plan/Collaboration mode";

export const STRUCTURED_ASK_TOOL_LIST_IDEATE =
  "\`AskUserQuestion\` on Claude, \`AskQuestion\` on Cursor, \`question\` on OpenCode when \`permission.question: \"allow\"\` is set, \`request_user_input\` on Codex in Plan / Collaboration mode";

export function structuredAskFallbackSentence(
  toolList: string = STRUCTURED_ASK_TOOL_LIST_GENERIC
): string {
  return `If the harness's native structured-ask tool is available (${toolList}), send exactly ONE question per call, validate fields against the runtime schema, and on schema error immediately fall back to a plain-text lettered list instead of retrying guessed payloads.`;
}

export function decisionProtocolInstruction(
  subject: string,
  optionsClause: string,
  recommendationClause: string,
  toolList: string = STRUCTURED_ASK_TOOL_LIST_GENERIC
): string {
  return `For ${subject}: use the Decision Protocol — ${optionsClause}. Do NOT use a numeric Completeness rubric; ${recommendationClause}. ${structuredAskFallbackSentence(toolList)}`;
}

export function structuredAskSingleChoiceInstruction(
  subject: string,
  choicesClause: string,
  toolList: string = STRUCTURED_ASK_TOOL_LIST_GENERIC
): string {
  return `For ${subject}: use the native structured-ask tool (${toolList}) only if runtime schema is confirmed; otherwise collect ${choicesClause} with a plain-text single-choice prompt.`;
}

export function ideaStructuredAskToolsWithFallback(): string {
  return `${STRUCTURED_ASK_TOOL_LIST_IDEATE}; fall back to a plain-text lettered list when the tool is hidden or errors`;
}
