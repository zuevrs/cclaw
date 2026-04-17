import { RUNTIME_ROOT } from "../constants.js";

const REWIND_SKILL_FOLDER = "flow-rewind";
const REWIND_SKILL_NAME = "flow-rewind";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function artifactsPath(): string {
  return `${RUNTIME_ROOT}/artifacts`;
}

function rewindLogPath(): string {
  return `${RUNTIME_ROOT}/state/rewind-log.jsonl`;
}

export function rewindCommandContract(): string {
  return `# /cc-ops rewind

## Purpose

Rewind active flow to an earlier stage, or acknowledge stale markers after
intentional rework.

## HARD-GATE

- Never rewind without preserving downstream artifact history.
- Mark downstream stages as stale; do not leave completedStages pointing to invalidated work.
- Record a rewind reason in \`${rewindLogPath()}\`.

## Inputs

\`/cc-ops rewind <target-stage> [reason]\`
or
\`/cc-ops rewind --ack <stage>\`

## Algorithm

### rewind mode
1. Read \`${flowStatePath()}\` and current track.
2. Validate \`target-stage\` belongs to the active track and is not ahead of current stage.
3. Compute downstream stages to invalidate (all stages after target that were completed or current).
4. Archive downstream artifacts into \`${artifactsPath()}/_rewind-archive/<rewind-id>/\`.
5. Rename active downstream artifacts to \`*.stale.md\`.
6. Update flow-state:
   - \`currentStage = target-stage\`
   - trim \`completedStages\` to stages before target-stage
   - clear gate evidence/catalog for target-stage and downstream
   - mark downstream entries in \`staleStages\`
   - append \`rewinds[]\` record
7. Append JSON line to \`${rewindLogPath()}\`.

### acknowledge mode (\`--ack\`)
1. Read \`${flowStatePath()}\`.
2. If \`staleStages.<stage>\` is missing, report no-op.
3. Remove \`staleStages.<stage>\`.
4. Write updated flow-state.
5. Print remaining stale stages (if any).

## Output

- In rewind mode:
  - rewind id
  - from -> to stage
  - invalidated stages list
  - number of stale artifacts
- In acknowledge mode:
  - acknowledged stage
  - remaining stale stages

## Primary skill

**${RUNTIME_ROOT}/skills/${REWIND_SKILL_FOLDER}/SKILL.md**
`;
}

export function rewindCommandSkillMarkdown(): string {
  return `---
name: ${REWIND_SKILL_NAME}
description: "Rewind active flow stage safely and acknowledge stale invalidations."
---

# /cc-ops rewind

## HARD-GATE

Rewind is an atomic state transition. Never leave flow-state half-updated (for example currentStage changed but stale markers/artifact archive missing).

## Protocol

### rewind
1. Validate target stage belongs to current track and is upstream.
2. Archive downstream artifacts under \`${artifactsPath()}/_rewind-archive/<rewind-id>/\`.
3. Mark downstream artifacts as stale (\`*.stale.md\`).
4. Reset downstream gate catalog and guard evidence.
5. Record \`rewinds[]\` and \`staleStages\` in flow-state.
6. Append rewind entry into \`${rewindLogPath()}\`.

### rewind --ack <stage>
1. Load flow-state stale map.
2. Remove exactly one stale stage marker.
3. Report remaining stale stages.

## Validation checklist

- \`${flowStatePath()}\` remains valid JSON.
- \`currentStage\` equals requested rewind target.
- invalidated stages are absent from \`completedStages\`.
- archived copies exist for each moved artifact.
`;
}
