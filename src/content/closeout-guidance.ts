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
  return `After ship completes, the closeout chain ${closeoutChainInline()} runs automatically, driven by ${closeoutSubstateInline()}. Continue through \`/cc-next\`; do not branch into a separate operations router.`;
}

export function closeoutFlowMapSentence(): string {
  return `The first stage names are the critical path. \`retro\`, \`compound\`, and \`archive\` are post-ship closeout substates under ${closeoutSubstateInline()}, not separate stage schemas or commands. Continue them with \`/cc-next\`.`;
}

export function closeoutProtocolBehaviorSentence(): string {
  return `Keep decision, completion, and preamble discipline inline: ask only decision-changing questions, verify gates before advancing, and keep context compact. After \`ship\`, keep using \`/cc-next\` through ${closeoutChainInline()}; do not route normal closeout through a separate operations command.`;
}
