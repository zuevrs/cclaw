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
  return `After ship completes, the closeout chain ${closeoutChainInline()} runs automatically, driven by ${closeoutSubstateInline()}. Continue through \`/cc\`; do not branch into \`ce:compound\`, a separate operations router, or a one-off closeout command. Ralph Loop may be mentioned only as tdd carry-forward context when it explains the next \`/cc\` move; it is not part of compound/archive routing.`;
}

export function closeoutSubstateProtocolBullets(): string {
  return `When \`currentStage === "ship"\`, route by **${closeoutSubstateInline()}**:
  - \`"idle"\` or missing -> outcome: initialize closeout by setting
    ${closeoutSubstateInline()} = \`"retro_review"\`, then continue \`/cc\`
    into the in-stage retro protocol (draft + one structured accept/edit/skip ask).
  - \`"retro_review"\` -> outcome: finish retro acceptance/edit/skip and advance
    closeout; the draft already exists, so continue it and do not regenerate it.
  - \`"compound_review"\` -> outcome: execute the in-stage compound closeout scan
    (not \`ce:compound\`) and advance toward archive readiness:
    read \`.cclaw/state/compound-readiness.json\` plus the relevant tail of
    \`.cclaw/knowledge.jsonl\`, assess overlap before adding duplicate knowledge,
    separate bug-track learnings (turn into rules/tests/remediation) from
    knowledge-track learnings (durable project/process guidance), and use
    lightweight \`supersedes\` / \`superseded_by\` fields when refreshing stale or
    partially replaced entries. Optionally ask whether to scan Cursor/Claude/Codex
    session transcripts for matching historical learnings; only do it after opt-in.
    Ask **one** structured question (apply / skip) per candidate cluster or a
    single accept-all / skip choice, then advance substate.
  - \`"ready_to_archive"\` -> outcome: continue \`/cc\` so the runtime archive step
    executes, snapshots, and resets active state.
  - \`"archived"\` (transient) -> outcome: report "run archived" and stop (flow complete).`;
}

export function closeoutFlowMapSentence(): string {
  return `The first stage names are the critical path. \`retro\`, \`compound\`, and \`archive\` are post-ship closeout substates under ${closeoutSubstateInline()}, not separate stage schemas or commands. Continue them with \`/cc\`; do not route compound closeout through \`ce:compound\`.`;
}

export function closeoutProtocolBehaviorSentence(): string {
  return `Keep decision, completion, and preamble discipline inline: ask only decision-changing questions, verify gates before advancing, and keep context compact. After \`ship\`, keep using \`/cc\` through ${closeoutChainInline()}; do not route normal closeout through \`ce:compound\` or a separate operations command. In compound closeout, assess overlap before appending knowledge: refresh recurring bug-track learnings as actionable rules/tests, keep knowledge-track learnings as durable process/project guidance, and mark outdated entries with lightweight \`supersedes\` / \`superseded_by\` fields instead of building a new doc system.`;
}
