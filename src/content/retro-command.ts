import { RUNTIME_ROOT } from "../constants.js";

const RETRO_SKILL_FOLDER = "flow-retro";
const RETRO_SKILL_NAME = "flow-retro";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function retroArtifactPath(): string {
  return `${RUNTIME_ROOT}/artifacts/09-retro.md`;
}

function knowledgePath(): string {
  return `${RUNTIME_ROOT}/knowledge.jsonl`;
}

export function retroCommandContract(): string {
  return `# /cc-ops retro

## Purpose

Auto-triggered retrospective after ship. \`/cc-next\` drafts \`${retroArtifactPath()}\`
from run artifacts and knowledge, then asks the user exactly ONE structured
question: **edit / accept / skip / rewind_for_fix**. Default = accept.

This command is normally invoked indirectly by \`/cc-next\` when
\`closeout.shipSubstate === "retro_review"\`. Invoking it directly is still
supported for manual re-runs.

## HARD-GATE

- Do not finalize retro without \`${retroArtifactPath()}\` on disk (or an explicit
  \`retroSkipped: true\` in closeout with a one-line reason).
- Do not finalize without appending **at least one** \`type=compound\` entry to
  \`${knowledgePath()}\` (skipped runs set \`compoundEntries: 0\` instead).
- Never advance to compound/archive with \`shipSubstate\` still at
  \`"retro_review"\`.

## Inputs

\`/cc-ops retro\` (no flags). If the user wants to skip, they answer **skip**
in the structured ask; there is no \`--skip\` flag.

## Algorithm

1. Read \`${flowStatePath()}\`; confirm \`completedStages\` contains \`"ship"\`.
2. If \`closeout.shipSubstate !== "retro_review"\`, and \`retro.completedAt\`
   is already set, report "retro already complete" and stop.
3. Draft \`${retroArtifactPath()}\` from available evidence:
   - scan \`.cclaw/artifacts/01..08-*.md\` for decisions, blockers, rewinds,
   - scan \`.cclaw/state/delegation-log.json\` for subagent outcomes,
   - scan \`${knowledgePath()}\` for entries recorded during this run,
   - structure the draft as: Outcomes / Slowed / Accelerated / Repeatable rule.
4. Update \`closeout.retroDraftedAt = <ISO>\` in flow-state.
5. Present **one** structured ask using the harness's native tool
   (\`AskUserQuestion\` on Claude, \`AskQuestion\` on Cursor, \`question\` on
   OpenCode when \`permission.question: "allow"\` is set,
   \`request_user_input\` on Codex in Plan / Collaboration mode; fall back
   to a plain-text lettered list when the tool is hidden or errors):
   - \`accept\` (default) — keep the draft as-is,
   - \`edit\` — user edits \`${retroArtifactPath()}\` in-place, then re-runs \`/cc-next\`,
   - \`skip\` — record \`retroSkipped: true\` + one-line reason, no compound entry required,
   - \`rewind_for_fix\` — route back to \`plan\` / \`tdd\` / \`review\` with a non-empty reason.
6. On **accept**:
   - append >=1 strict-schema JSONL line to \`${knowledgePath()}\` with
     \`type: "compound"\`, \`source: "retro"\`, and \`stage: null\`,
   - set \`retro.required = true\`, \`retro.completedAt = <ISO>\`,
     \`retro.compoundEntries = <count>\`,
   - set \`closeout.retroAcceptedAt = <ISO>\`,
   - set \`closeout.shipSubstate = "compound_review"\`.
7. On **edit**:
   - leave \`shipSubstate = "retro_review"\`,
   - tell user to edit \`${retroArtifactPath()}\` and run \`/cc-next\` again.
8. On **skip**:
   - require a one-line reason; if empty, re-ask once then escalate,
   - set \`closeout.retroSkipped = true\`, \`closeout.retroSkipReason = <text>\`,
     \`closeout.retroAcceptedAt = <ISO>\`,
   - set \`retro.completedAt = <ISO>\` (marks gate satisfied for archive), and
     \`retro.compoundEntries = 0\`,
   - set \`closeout.shipSubstate = "compound_review"\`.
9. On **rewind_for_fix**:
   - require \`targetStage\` in \`{ plan, tdd, review }\`,
   - require a concise rationale (min 20 chars),
   - instruct \`/cc-ops rewind <targetStage> "<reason>"\`,
   - reset closeout progression by setting \`closeout.shipSubstate = "idle"\`.
10. Emit a one-line summary: \`retro: accepted|edited|skipped|rewind_for_fix | next: /cc-next\`.

## Primary skill

**${RUNTIME_ROOT}/skills/${RETRO_SKILL_FOLDER}/SKILL.md**
`;
}

export function retroCommandSkillMarkdown(): string {
  return `---
name: ${RETRO_SKILL_NAME}
description: "Auto-drafted retrospective with a single structured accept/edit/skip/rewind_for_fix ask. Triggered from /cc-next when shipSubstate=retro_review."
---

# /cc-ops retro

## HARD-GATE

Archive stays blocked until one of:
- retro artifact exists **and** one compound knowledge entry was appended, OR
- retro was explicitly skipped with a one-line reason recorded in closeout.

Do not silently skip. Do not finalize without updating \`flow-state.json\`.

## Protocol

1. Confirm ship completion by reading \`${flowStatePath()}\`.
2. If retro draft does not yet exist, synthesise \`${retroArtifactPath()}\` using:
   - all \`.cclaw/artifacts/*-*.md\` from the active run (stages 01–08),
   - \`.cclaw/state/delegation-log.json\` entries,
   - \`${knowledgePath()}\` entries written during this run.
   Draft sections:
   - **Outcomes** — what was actually shipped.
   - **Slowed** — concrete friction points (cite artifact line or delegation id).
   - **Accelerated** — patterns/decisions that worked and are worth keeping.
   - **Repeatable rule** — one candidate rule/pattern for next run.
   Record \`closeout.retroDraftedAt\`.
3. Ask the user **one** structured question via the harness's native
   ask tool (\`AskUserQuestion\` / \`AskQuestion\` / \`question\` /
   \`request_user_input\`; plain-text lettered list as fallback):

   > Retro draft ready at \`${retroArtifactPath()}\`. How do you want to
   > proceed? (default: accept)
   >
   > - **accept** — keep the draft and continue.
   > - **edit** — I'll edit it, then re-run \`/cc-next\`.
   > - **skip** — no retro this run (requires one-line reason).
   > - **rewind_for_fix** — route back to plan/tdd/review because post-ship issues were found.

4. Apply the state transition for the chosen option:
   - \`accept\` → append \`{ "type": "compound", "source": "retro", "stage": null, ... }\` line
     to \`${knowledgePath()}\`; set \`retro.completedAt\`, \`retro.compoundEntries\`,
     \`closeout.retroAcceptedAt\`; set \`closeout.shipSubstate = "compound_review"\`.
   - \`edit\` → leave \`shipSubstate = "retro_review"\`; announce resume path.
   - \`skip\` → set \`closeout.retroSkipped\`, \`closeout.retroSkipReason\`,
     \`closeout.retroAcceptedAt\`, \`retro.completedAt\`,
     \`retro.compoundEntries = 0\`; set \`closeout.shipSubstate = "compound_review"\`.
   - \`rewind_for_fix\` → require \`targetStage ∈ {plan,tdd,review}\` and
     reason (>=20 chars), then instruct \`/cc-ops rewind <targetStage> "<reason>"\`
     and set \`closeout.shipSubstate = "idle"\` to restart closeout after rework.

5. Print one-line completion summary:
   - \`retro gate: accepted (<N> compound entries)\`
   - \`retro gate: skipped (reason: <text>)\`
   - \`retro gate: editing (re-run /cc-next when ready)\`
   - \`retro gate: rewind_for_fix (target=<stage>)\`

## Resume semantics

A new session with \`closeout.shipSubstate === "retro_review"\` resumes
exactly here. If \`closeout.retroDraftedAt\` is present but
\`retroAcceptedAt\` is missing, re-ask the same structured question without
regenerating the draft.

## Validation

- \`${retroArtifactPath()}\` exists and is non-empty, **or**
  \`closeout.retroSkipped === true\` with a non-empty reason.
- When accepted: \`${knowledgePath()}\` gained a valid \`compound\` line
  and \`retro.compoundEntries > 0\`.
- \`retro.completedAt\` is set.
- \`closeout.shipSubstate\` is \`"compound_review"\` (or still
  \`"retro_review"\` when user picked \`edit\`).
`;
}
