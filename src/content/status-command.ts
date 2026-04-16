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
  return `${RUNTIME_ROOT}/knowledge.md`;
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

/**
 * Command contract for /cc-status — a read-only snapshot command.
 * Does not mutate state. Always safe to run.
 */
export function statusCommandContract(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPath();
  return `# /cc-status

## Purpose

**Read-only snapshot of the cclaw run.** Shows track, current stage, completed stages,
gate coverage, mandatory delegations, and the top 3 knowledge highlights.

This command **never mutates state**. Use it at session start to orient, or at any
time to answer "where are we?" without advancing the flow.

## HARD-GATE

- **Do not** use \`/cc-status\` output to infer gate completion for decisions — cite
  artifact evidence via \`/cc-next\` when advancing.
- **Do not** mutate \`${flowPath}\` or delegation log from this command.

## Algorithm

1. Read **\`${flowPath}\`** — capture \`track\`, \`currentStage\`, \`completedStages\`,
   \`skippedStages\`, and per-stage gate catalog.
2. Read **\`${delegationPath}\`** — count delegated / completed / waived / pending entries
   for the current stage's \`mandatoryDelegations\`.
3. Read **\`${contextModePath()}\`** — surface \`activeMode\` (default if missing).
4. Compute **time in current stage** from the most recent stage-entry signal:
   - Prefer \`${checkpointPath()}\`'s \`timestamp\` when its \`stage\` matches \`currentStage\`.
   - Otherwise scan \`${stageActivityPath()}\` from the end for the first entry whose \`stage\` matches \`currentStage\` and use its \`ts\`.
   - Compute the duration as \`now - signalTimestamp\` and render compactly: \`<X>m\`, \`<X>h<Y>m\`, or \`<X>d<Y>h\`.
   - If no signal exists, render \`(unknown)\`.
5. Read the top of **\`${knowledgePath}\`** — surface up to 3 most recent entries
   (by trailing timestamp or source marker).
6. Emit the status block described below. Do **not** load any stage skill.

## Status Block Format

\`\`\`
cclaw status
  track:            <quick|standard>
  current stage:    <stage>     (<N>/<total> in track)
  time in stage:    <Xd Yh | Yh Zm | Zm | unknown>
  context mode:     <activeMode>     (default | execution | review | incident | …)
  completed stages: <list or "none">
  skipped stages:   <list or "none">

  gates:
    passed:   <count> of <required>
    blocked:  <count>
    unmet:    <list of gate ids>

  delegations (current stage):
    required:  <list>
    completed: <list>
    pending:   <list>

  knowledge highlights:
    - <latest entry summary line>
    - <second entry summary line>
    - <third entry summary line>

  next action:
    /cc-next  (advance or resume current stage)
\`\`\`

## Anti-patterns

- Inventing gate status without reading \`${flowPath}\`.
- Reporting delegations as satisfied when the log says \`pending\`.
- Advancing the stage from \`/cc-status\` — progression belongs to \`/cc-next\`.

## Primary skill

**${RUNTIME_ROOT}/skills/${STATUS_SKILL_FOLDER}/SKILL.md**
`;
}

/**
 * Skill body for /cc-status — read-only status snapshot.
 */
export function statusCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPath();
  return `---
name: ${STATUS_SKILL_NAME}
description: "Read-only snapshot of the cclaw flow: track, stage, gate coverage, delegations, knowledge highlights. Never mutates state."
---

# /cc-status — Flow Status Snapshot

## Overview

\`/cc-status\` is the quickest way to answer "where are we in the flow?" without
advancing or mutating anything. Safe to run at any point.

## HARD-GATE

Do **not** mutate \`${flowPath}\` or \`${delegationPath}\` from this skill. This is
a read-only command.

## Algorithm

1. Read \`${flowPath}\`. If missing → report **BLOCKED: flow state absent** and suggest \`cclaw init\`.
2. Read \`${delegationPath}\`. Missing → treat all mandatory delegations as pending.
3. Read \`${contextModePath()}\` for \`activeMode\`. Missing → render \`activeMode = default\`.
4. Compute **time in stage**:
   - Prefer \`${checkpointPath()}\` when \`stage === currentStage\` and \`timestamp\` parses as ISO 8601.
   - Else scan \`${stageActivityPath()}\` from tail for the most recent entry whose \`stage === currentStage\`; use its \`ts\`.
   - Render \`<X>d<Y>h\`, \`<X>h<Y>m\`, \`<X>m\`, or \`(unknown)\`.
5. Read \`${RUNTIME_ROOT}/knowledge.md\`. If missing or empty → knowledge highlights are \`(none recorded)\`.
6. For each gate in \`stageGateCatalog[currentStage].required\`:
   - Satisfied if present in \`passed\` and absent from \`blocked\`.
7. Build and print the status block (see command contract for layout).
8. Suggest the next action:
   - If current stage has unmet gates → \`/cc-next\` to resume.
   - If current stage is complete → \`/cc-next\` to advance (or report "Flow complete" if terminal).

## Output Guidelines

- Keep output compact (≤ 25 lines) — status, not narrative.
- Report counts, not full artifact contents.
- If any data source is missing or corrupt, say so explicitly rather than guessing.

## Anti-patterns

- Rebuilding trace-matrix or running doctor from \`/cc-status\` — those belong to dedicated tools.
- Treating absence of delegation log as "all delegations complete".
- Mutating state to "clean up" during a status check.
`;
}
