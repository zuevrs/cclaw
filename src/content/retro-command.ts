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

Mandatory retrospective gate before archive once ship is complete.

## HARD-GATE

- Do not mark retro complete without writing \`${retroArtifactPath()}\`.
- Do not finish retro without appending at least one \`type=compound\` entry into \`${knowledgePath()}\`.

## Algorithm

1. Read \`${flowStatePath()}\`; confirm ship stage is complete for current run.
2. Synthesize retrospective artifact \`${retroArtifactPath()}\` with:
   - what slowed this run
   - what accelerated this run
   - concrete repeatable rule for next run
3. Append >=1 strict-schema JSONL entry to \`${knowledgePath()}\` with:
   - \`type: "compound"\`
   - \`stage: "ship"\` or \`"retro"\`
4. Update flow-state \`retro\` block:
   - \`required: true\`
   - \`completedAt: <ISO>\`
   - \`compoundEntries: <count>\`
5. Report completion summary and remind user that \`/cc-ops compound\` (optional) can lift repeated learnings before \`/cc-ops archive\`.

## Primary skill

**${RUNTIME_ROOT}/skills/${RETRO_SKILL_FOLDER}/SKILL.md**
`;
}

export function retroCommandSkillMarkdown(): string {
  return `---
name: ${RETRO_SKILL_NAME}
description: "Run mandatory retrospective and record compound knowledge before archive."
---

# /cc-ops retro

## HARD-GATE

Archive must remain blocked until retro artifact exists and compound knowledge was appended.

## Protocol

1. Confirm ship completion from \`${flowStatePath()}\`.
2. Create/update \`${retroArtifactPath()}\` with concise retrospective sections:
   - outcomes
   - bottlenecks
   - reusable acceleration patterns
3. Append at least one \`compound\` knowledge entry into \`${knowledgePath()}\`.
4. Update \`flow-state.json.retro\` with completion timestamp + compound count.
5. Print explicit completion line:
   - \`retro gate: complete\`
   - \`compound entries added: <N>\`
   - \`next: /cc-ops compound (optional) -> /cc-ops archive\`

## Validation

- \`${retroArtifactPath()}\` exists and is non-empty.
- \`${knowledgePath()}\` contains >=1 valid \`compound\` line.
- \`retro.completedAt\` is set in flow-state.
`;
}
