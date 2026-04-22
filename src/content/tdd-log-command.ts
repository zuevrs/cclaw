import { RUNTIME_ROOT } from "../constants.js";

const TDD_LOG_SKILL_FOLDER = "tdd-cycle-log";
const TDD_LOG_SKILL_NAME = "tdd-cycle-log";

function logPath(): string {
  return `${RUNTIME_ROOT}/state/tdd-cycle-log.jsonl`;
}

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

export function tddLogCommandContract(): string {
  return `# /cc-ops tdd-log

## Purpose

Record explicit RED/GREEN/REFACTOR evidence used by workflow guard and doctor checks.

## HARD-GATE

- Every implementation write in tdd must be preceded by a logged RED event.
- Use append-only JSONL at \`${logPath()}\`; never rewrite prior lines.

## Subcommands

- \`/cc-ops tdd-log red <slice> <command> [note]\`
- \`/cc-ops tdd-log green <slice> <command> [note]\`
- \`/cc-ops tdd-log refactor <slice> <command> [note]\`
- \`/cc-ops tdd-log show\`

## Log Schema

Each JSON line must include:
- \`ts\` (ISO timestamp)
- \`runId\` (from flow-state)
- \`stage\` (usually \`tdd\`)
- \`slice\` (e.g. \`S-1\`)
- \`phase\` (\`red\` | \`green\` | \`refactor\`)
- \`command\`
- optional: \`files\`, \`exitCode\`, \`note\`, \`acIds\` (array of acceptance
  criterion IDs like \`["AC-1"]\` — GREEN rows use this to drive the Ralph
  Loop status summary at \`.cclaw/state/ralph-loop.json\`).

## Primary skill

**${RUNTIME_ROOT}/skills/${TDD_LOG_SKILL_FOLDER}/SKILL.md**
`;
}

export function tddLogCommandSkillMarkdown(): string {
  return `---
name: ${TDD_LOG_SKILL_NAME}
description: "Append RED/GREEN/REFACTOR entries into tdd-cycle-log.jsonl for guard/doctor enforcement."
---

# /cc-ops tdd-log

## HARD-GATE

Do not fake RED evidence. A \`red\` entry must correspond to a failing test command.

## Protocol

1. Read \`${flowStatePath()}\` and capture \`activeRunId\` + \`currentStage\`.
2. Build JSON entry:
   - \`ts\`: now ISO
   - \`runId\`: activeRunId
   - \`stage\`: currentStage
   - \`slice\`: user-provided slice id
   - \`phase\`: red|green|refactor
   - \`command\`: test command or refactor verification command
   - \`acIds\` (optional, recommended on \`green\`): the acceptance-criterion
     IDs this GREEN row closes (e.g. \`["AC-1","AC-3"]\`). The SessionStart
     hook aggregates distinct \`acIds\` from green rows into \`acClosed\`
     inside \`.cclaw/state/ralph-loop.json\` so \`/cc-next\` can answer
     "is the Ralph Loop done?" without parsing the artifact.
3. Append one line to \`${logPath()}\`.
4. After append, refresh Ralph Loop status with
   \`cclaw internal tdd-loop-status --quiet\` (the SessionStart hook also
   refreshes it, but a manual refresh is safe and idempotent).
5. \`show\`: print the last 20 lines grouped by slice.

## Validation

- File remains valid JSONL (one JSON object per line).
- For each slice, first phase must be \`red\`.
`;
}
