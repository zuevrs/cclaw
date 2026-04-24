import { RUNTIME_ROOT } from "../constants.js";

const STATUS_SKILL_FOLDER = "flow-status";
const STATUS_SKILL_NAME = "flow-status";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function delegationLogPath(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

function knowledgePath(): string {
  return `${RUNTIME_ROOT}/knowledge.jsonl`;
}

function contextModePath(): string {
  return `${RUNTIME_ROOT}/state/context-mode.json`;
}

function checkpointPath(): string {
  return `${RUNTIME_ROOT}/state/checkpoint.json`;
}

function stageActivityPath(): string {
  return `${RUNTIME_ROOT}/state/stage-activity.jsonl`;
}

function snapshotPath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.snapshot.json`;
}

function retroArtifactPath(): string {
  return `${RUNTIME_ROOT}/artifacts/09-retro.md`;
}

/**
 * Command contract for /cc-view status — a read-only snapshot command.
 * Does not mutate state. Always safe to run.
 */
export function statusCommandContract(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPath();
  return `# /cc-view status

## Purpose

**Read-only visual snapshot of the cclaw run.** Shows progress bar, current stage,
gate coverage, delegation status with fulfillmentMode, closeout substate after
ship, harness parity fallback, stale markers, and top knowledge highlights.

This command **never mutates state**. Use it at session start to orient, or at any
time to answer "where are we?" without advancing the flow.

## HARD-GATE

- **Do not** use \`/cc-view status\` output to infer gate completion for decisions — cite
  artifact evidence via \`/cc-next\` when advancing.
- **Do not** mutate \`${flowPath}\` or delegation log from this command.
- **Do not** rewrite \`${snapshotPath()}\` from this command (use \`/cc-view diff\`).

## Algorithm

1. Read **\`${flowPath}\`** — capture \`track\`, \`currentStage\`, \`completedStages\`,
   \`skippedStages\`, \`staleStages\`, per-stage gate catalog, and **\`closeout\`**
   (shipSubstate + retro/compound flags).
2. Read **\`${delegationPath}\`** — for each mandatory agent of the current stage,
   capture \`status\`, \`fulfillmentMode\`, and whether \`evidenceRefs\` are present.
3. Read **\`${contextModePath()}\`** — surface \`activeMode\` (default if missing).
4. Compute **time in current stage** from the most recent stage-entry signal:
   - Prefer \`${checkpointPath()}\`'s \`timestamp\` when its \`stage\` matches \`currentStage\`.
   - Otherwise scan \`${stageActivityPath()}\` from the end for the first entry whose \`stage\` matches \`currentStage\` and use its \`ts\`.
   - Compute the duration as \`now - signalTimestamp\` and render compactly: \`<X>m\`, \`<X>h<Y>m\`, or \`<X>d<Y>h\`.
   - If no signal exists, render \`(unknown)\`.
5. Optionally read **\`${snapshotPath()}\`** to compute gate delta versus prior baseline:
   - If missing or invalid, render \`delta: (baseline unavailable; run /cc-view diff)\`.
6. Derive harness \`tier\` and fallback from cclaw capability metadata; use \`cclaw doctor --explain\` when details are needed.
7. Read the top of **\`${knowledgePath()}\`** — surface up to 3 most recent entries
   (by trailing timestamp or source marker).
8. Detect **closeout artifacts**: check whether \`${retroArtifactPath()}\` exists on
   disk and annotate the closeout row accordingly.
9. Emit the visual status block described below. Do **not** load any stage skill.

## Visual markers

Default UTF markers: \`✓\` passed, \`▶\` current, \`○\` pending, \`⊘\` skipped, \`⏸\` stale, \`✗\` blocked.  
ASCII fallback (no UTF locale): \`[x]\`, \`[>]\`, \`[ ]\`, \`[-]\`, \`[=]\`, \`[!]\`.

Delegation markers: \`✓\` completed, \`◎\` completed-no-evidence (role-switch
harness; **blocks stage**), \`○\` scheduled/pending, \`⊘\` waived, \`✗\` failed.

## Status Block Format

\`\`\`
cclaw status
  flow:    <track> · run=<runId> · feature=<feature-id>
  stage:   <stage> (<N>/<total>) · time <Xd|XhYm|Xm|unknown> · mode <activeMode>
  bar:     [✓ brainstorm] [✓ scope] [▶ design] [○ spec] [○ plan] [○ tdd] [○ review] [○ ship]
  gates:   now <passed>/<required> · blocked <count> · delta <summary or baseline-unavailable>
  delegations (<expectedMode>):
    - planner      ✓ completed  mode=<isolated|generic-dispatch|role-switch>
    - reviewer     ○ pending
    - test-author  ◎ missing-evidence (role-switch; add evidenceRefs)
  closeout: <shipSubstate> · retro=<drafted|accepted|skipped|—> · compound=<N promoted|skipped|—>
  harness: <id>=<tier>/<fallback>, ...
  stale:   <list or none>
  knowledge:
    - <latest entry summary>
    - <second entry summary>
    - <third entry summary>
  next: /cc-next · /cc-view tree · /cc-view diff
\`\`\`

- Omit the \`closeout:\` row when \`currentStage !== "ship"\` and \`shipSubstate === "idle"\`.
- Omit \`delegations\` line when the current stage has zero mandatory delegations.
- Omit the \`harness\` line only when no installed harness metadata is available.

## Anti-patterns

- Inventing gate status without reading \`${flowPath}\`.
- Reporting delegations as satisfied when the log says \`pending\`.
- Treating a \`completed\` role-switch delegation without \`evidenceRefs\` as green
  — it must surface as \`◎ missing-evidence\`.
- Advancing the stage from \`/cc-view status\` — progression belongs to \`/cc-next\`.
- Hiding the closeout substate after ship; retro/compound/archive progress must
  be visible so \`/cc-next\` resumes at the right step.

## Primary skill

**${RUNTIME_ROOT}/skills/${STATUS_SKILL_FOLDER}/SKILL.md**
`;
}

/**
 * Skill body for /cc-view status — read-only status snapshot.
 */
export function statusCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPath();
  return `---
name: ${STATUS_SKILL_NAME}
description: "Read-only visual snapshot of the cclaw flow with progress bar, gate delta, delegations (fulfillmentMode + evidence), closeout substate, and harness parity row."
---

# /cc-view status — Flow Status Snapshot

## Overview

\`/cc-view status\` is the quickest way to answer "where are we in the flow?" without
advancing or mutating anything. Safe to run at any point. The snapshot reflects:

- progress across stages with per-stage markers,
- gate coverage and delta vs. baseline,
- mandatory delegations with **fulfillmentMode** (isolated / generic-dispatch /
  role-switch / harness-waiver) and evidence gate,
- **closeout substate** after ship (retro → compound → archive),
- **harness parity row** (tier + fallback) for the active harness set.

## HARD-GATE

Do **not** mutate \`${flowPath}\` or \`${delegationPath}\` from this skill. This is
a read-only command. Do **not** update \`${snapshotPath()}\` here.

## Algorithm

1. Read \`${flowPath}\`. If missing → report **BLOCKED: flow state absent** and suggest \`cclaw init\`.
2. Read \`${delegationPath}\`. Missing → treat all mandatory delegations as pending.
3. Read \`${contextModePath()}\` for \`activeMode\`. Missing → render \`activeMode = default\`.
4. Compute **time in stage**:
   - Prefer \`${checkpointPath()}\` when \`stage === currentStage\` and \`timestamp\` parses as ISO 8601.
   - Else scan \`${stageActivityPath()}\` from tail for the most recent entry whose \`stage === currentStage\`; use its \`ts\`.
   - Render \`<X>d<Y>h\`, \`<X>h<Y>m\`, \`<X>m\`, or \`(unknown)\`.
5. Try reading \`${snapshotPath()}\` for gate delta:
   - If available, compare current stage \`passed\` / \`blocked\` sets against baseline.
   - If unavailable, render \`delta: (baseline unavailable; run /cc-view diff)\`.
6. Derive harness \`<tier>/<fallback>\` rows from cclaw capability metadata.
7. Read \`${RUNTIME_ROOT}/knowledge.jsonl\`. If missing or empty → knowledge highlights are \`(none recorded)\`. Parse each line as JSON and surface its \`trigger\`/\`action\`.
8. For each gate in \`stageGateCatalog[currentStage].required\`:
   - Satisfied if present in \`passed\` and absent from \`blocked\`.
9. For each mandatory delegation of the current stage, evaluate:
   - \`✓ completed\` when \`status === "completed"\` and (harness is not role-switch
     **or** \`evidenceRefs.length >= 1\`).
   - \`◎ missing-evidence\` when \`status === "completed"\`, harness declares
     \`role-switch\`, and \`evidenceRefs\` is empty or absent.
   - \`○ <status>\` for \`scheduled\` / pending.
   - \`⊘ waived\` when \`status === "waived"\`.
   - \`✗ failed\` when \`status === "failed"\`.
10. Compute **closeout row** when \`currentStage === "ship"\` or
    \`closeout.shipSubstate !== "idle"\`:
    - \`shipSubstate\` verbatim,
    - \`retro=drafted|accepted|skipped|—\` derived from \`closeout.retroDraftedAt\`,
      \`closeout.retroAcceptedAt\`, \`closeout.retroSkipped\`,
    - \`compound=<N promoted>|skipped|—\` from
      \`closeout.compoundPromoted\` / \`closeout.compoundSkipped\`.
11. Build and print the visual status block:
    - stage header
    - one-line progress bar with per-stage markers
    - gate summary + delta
    - delegation rows (per mandatory agent)
    - closeout row (when active)
    - harness row
    - stale stage row
12. Suggest the next action:
    - If current stage has unmet gates → \`/cc-next\` to resume.
    - If closeout substate is non-idle → \`/cc-next\` to continue the chain.
    - If current stage is complete → \`/cc-next\` to advance (or report "Flow complete" if terminal).

## Output Guidelines

- Keep output compact (≤ 40 lines) — status, not narrative.
- Report counts, not full artifact contents.
- If any data source is missing or corrupt, say so explicitly rather than guessing.
- Include \`/cc-view tree\` for deep structure and \`/cc-view diff\` for before/after map in the final line.

## Anti-patterns

- Rebuilding trace-matrix or running doctor from \`/cc-view status\` — those belong to dedicated tools.
- Treating absence of delegation log as "all delegations complete".
- Collapsing \`◎ missing-evidence\` into \`✓ completed\` — role-switch gaps must stay
  visible so the stage cannot advance silently.
- Omitting the closeout row when \`shipSubstate !== "idle"\`; it is the only signal
  that tells the user why \`/cc-next\` is about to run retro/compound/archive.
- Mutating state to "clean up" during a status check.
`;
}
