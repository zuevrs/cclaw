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
gate coverage, delegation status, stale markers, and top knowledge highlights.

This command **never mutates state**. Use it at session start to orient, or at any
time to answer "where are we?" without advancing the flow.

## HARD-GATE

- **Do not** use \`/cc-view status\` output to infer gate completion for decisions — cite
  artifact evidence via \`/cc-next\` when advancing.
- **Do not** mutate \`${flowPath}\` or delegation log from this command.
- **Do not** rewrite \`${snapshotPath()}\` from this command (use \`/cc-view diff\`).

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
5. Optionally read **\`${snapshotPath()}\`** to compute gate delta versus prior baseline:
   - If missing or invalid, render \`delta: (baseline unavailable; run /cc-view diff)\`.
6. Read the top of **\`${knowledgePath}\`** — surface up to 3 most recent entries
   (by trailing timestamp or source marker).
7. Emit the visual status block described below. Do **not** load any stage skill.

## Visual markers

Default UTF markers: \`✓\` passed, \`▶\` current, \`○\` pending, \`⊘\` skipped, \`⏸\` stale, \`✗\` blocked.  
ASCII fallback (no UTF locale): \`[x]\`, \`[>]\`, \`[ ]\`, \`[-]\`, \`[=]\`, \`[!]\`.

## Status Block Format

\`\`\`
cclaw status
  flow:   <track> · run=<runId> · feature=<feature-id>
  stage:  <stage> (<N>/<total>) · time <Xd|XhYm|Xm|unknown> · mode <activeMode>
  bar:    [✓ brainstorm] [✓ scope] [▶ design] [○ spec] [○ plan] [○ tdd] [○ review] [○ ship]
  gates:  now <passed>/<required> · blocked <count> · delta <summary or baseline-unavailable>
  delegations: [✓ <role>] [○ <role>] ...
  stale:  <list or none>
  knowledge:
    - <latest entry summary>
    - <second entry summary>
    - <third entry summary>
  next: /cc-next · /cc-view tree · /cc-view diff
\`\`\`

## Anti-patterns

- Inventing gate status without reading \`${flowPath}\`.
- Reporting delegations as satisfied when the log says \`pending\`.
- Advancing the stage from \`/cc-view status\` — progression belongs to \`/cc-next\`.
- Hiding stale stages; stale markers must be surfaced directly in the status line.

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
description: "Read-only visual snapshot of the cclaw flow with progress bar, gate delta, delegations, and stale markers."
---

# /cc-view status — Flow Status Snapshot

## Overview

\`/cc-view status\` is the quickest way to answer "where are we in the flow?" without
advancing or mutating anything. Safe to run at any point.

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
6. Read \`${RUNTIME_ROOT}/knowledge.jsonl\`. If missing or empty → knowledge highlights are \`(none recorded)\`. Parse each line as JSON and surface its \`trigger\`/\`action\`.
7. For each gate in \`stageGateCatalog[currentStage].required\`:
   - Satisfied if present in \`passed\` and absent from \`blocked\`.
8. Build and print the visual status block:
   - stage header
   - one-line progress bar with per-stage markers
   - gate summary + delta
   - delegation row
   - stale stage row
9. Suggest the next action:
   - If current stage has unmet gates → \`/cc-next\` to resume.
   - If current stage is complete → \`/cc-next\` to advance (or report "Flow complete" if terminal).

## Output Guidelines

- Keep output compact (≤ 30 lines) — status, not narrative.
- Report counts, not full artifact contents.
- If any data source is missing or corrupt, say so explicitly rather than guessing.
- Include \`/cc-view tree\` for deep structure and \`/cc-view diff\` for before/after map in the final line.

## Anti-patterns

- Rebuilding trace-matrix or running doctor from \`/cc-view status\` — those belong to dedicated tools.
- Treating absence of delegation log as "all delegations complete".
- Mutating state to "clean up" during a status check.
`;
}
