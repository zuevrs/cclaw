/**
 * Shared post-ship closeout wording.
 *
 * Keep closeout chain and ship substate language in one place across command
 * contracts, skills, and stage/docs surfaces.
 */

export const CLOSEOUT_CHAIN = "retro -> compound -> archive";
export const CLOSEOUT_SUBSTATE_KEY = "closeout.shipSubstate";

export function closeoutChainInline(): string {
  return `\`${CLOSEOUT_CHAIN}\``;
}

export function closeoutSubstateInline(): string {
  return `\`${CLOSEOUT_SUBSTATE_KEY}\``;
}

export function closeoutNextCommandGuidance(): string {
  return `After ship completes, the closeout chain ${closeoutChainInline()} runs automatically, driven by ${closeoutSubstateInline()}. Continue through \`/cc-next\`; do not branch into \`ce:compound\`, a separate operations router, or a one-off closeout command. Ralph Loop may be mentioned only as tdd carry-forward context when it explains the next \`/cc-next\` move; it is not part of compound/archive routing.`;
}

export function closeoutFlowMapSentence(): string {
  return `The first stage names are the critical path. \`retro\`, \`compound\`, and \`archive\` are post-ship closeout substates under ${closeoutSubstateInline()}, not separate stage schemas or commands. Continue them with \`/cc-next\`; do not route compound closeout through \`ce:compound\`.`;
}

export function closeoutProtocolBehaviorSentence(): string {
  return `Keep decision, completion, and preamble discipline inline: ask only decision-changing questions, verify gates before advancing, and keep context compact. After \`ship\`, keep using \`/cc-next\` through ${closeoutChainInline()}; do not route normal closeout through \`ce:compound\` or a separate operations command. In compound closeout, assess overlap before appending knowledge: refresh recurring bug-track learnings as actionable rules/tests, keep knowledge-track learnings as durable process/project guidance, and mark outdated entries with lightweight \`supersedes\` / \`superseded_by\` fields instead of building a new doc system.`;
}
