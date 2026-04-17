import { RUNTIME_ROOT } from "../constants.js";

const TREE_SKILL_FOLDER = "flow-tree";
const TREE_SKILL_NAME = "flow-tree";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function delegationLogPath(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

function artifactsPath(): string {
  return `${RUNTIME_ROOT}/artifacts`;
}

function rewindLogPath(): string {
  return `${RUNTIME_ROOT}/state/rewind-log.jsonl`;
}

export function treeCommandContract(): string {
  return `# /cc-view tree

## Purpose

Render a visual flow tree for quick orientation across stages, gates, delegations,
stale markers, and artifact presence.

## HARD-GATE

- \`/cc-view tree\` is read-only. Do not mutate flow-state or artifacts.
- Use values from \`${flowStatePath()}\` and \`${delegationLogPath()}\`; never infer missing evidence.

## Algorithm

1. Read \`${flowStatePath()}\`.
2. Read \`${delegationLogPath()}\` (if missing, treat current-stage delegations as pending).
3. Detect artifact files in \`${artifactsPath()}\`.
4. Read rewind records from \`${rewindLogPath()}\` when present for stale-stage context.
5. Render the tree using stage order from active track:
   - stage node marker: passed/current/pending/skipped/stale
   - gate summary: \`passed/required\`
   - delegation summary for current stage
   - artifact marker per stage (exists / stale copy / missing)

## Tree Format

\`\`\`
cclaw flow tree (track=<track>, run=<runId>)
├─ [✓] brainstorm  gates 6/6   artifact 01-brainstorm.md
├─ [✓] scope       gates 5/5   artifact 02-scope.md
├─ [▶] design      gates 2/7   artifact 03-design.md
│  ├─ delegations: [✓] planner  [○] reviewer
│  └─ stale: none
├─ [○] spec        gates -     artifact missing
└─ [○] plan        gates -     artifact missing
\`\`\`

Use UTF markers by default, ASCII fallback when terminal cannot render UTF.

## Primary skill

**${RUNTIME_ROOT}/skills/${TREE_SKILL_FOLDER}/SKILL.md**
`;
}

export function treeCommandSkillMarkdown(): string {
  return `---
name: ${TREE_SKILL_NAME}
description: "Render a visual flow tree for stages, gates, delegations, and artifacts."
---

# /cc-view tree

## HARD-GATE

Do not modify state in this command. It is a pure read/render operation.

## Protocol

1. Read \`${flowStatePath()}\` as source of truth.
2. Read \`${delegationLogPath()}\` for current-stage delegation status.
3. Inspect \`${artifactsPath()}\` for per-stage artifact presence and stale copies.
4. Render one compact tree:
   - stage marker: passed/current/pending/skipped/stale
   - gates summary
   - artifact summary
   - delegation branch for current stage
5. If rewind records exist in \`${rewindLogPath()}\`, include latest rewind note in footer.

## Validation

- Output must mention the active \`track\` and \`currentStage\`.
- Exactly one stage is marked current.
- Missing files are reported explicitly; never guessed as complete.
`;
}
