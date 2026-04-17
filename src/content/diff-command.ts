import { RUNTIME_ROOT } from "../constants.js";

const DIFF_SKILL_FOLDER = "flow-diff";
const DIFF_SKILL_NAME = "flow-diff";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function snapshotPath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.snapshot.json`;
}

export function diffCommandContract(): string {
  return `# /cc-diff

## Purpose

Show a visual before/after diff map for flow-state progression.

## HARD-GATE

- Compare against \`${snapshotPath()}\` first; do not overwrite baseline before rendering.
- If no snapshot exists, initialize baseline and report "baseline created" explicitly.

## Algorithm

1. Read current state from \`${flowStatePath()}\`.
2. Read baseline from \`${snapshotPath()}\` (if missing -> create baseline from current state and stop).
3. Compute deltas:
   - stage transition (\`from -> to\`)
   - completed stage additions/removals
   - skipped stage additions/removals
   - stale stage additions/removals
   - current-stage gate \`passed\` and \`blocked\` changes
4. Render a compact diff map (added \`+\`, removed \`-\`, changed \`->\`).
5. Persist current state back to \`${snapshotPath()}\` as new baseline with \`capturedAt\`.

## Diff Map Format

\`\`\`
cclaw flow diff
  stage: design -> spec
  completed: +design
  stale: -design
  gates(spec): +spec_contract_complete  -spec_open_questions_closed
  blocked(spec): +spec_trace_matrix_missing
\`\`\`

## Primary skill

**${RUNTIME_ROOT}/skills/${DIFF_SKILL_FOLDER}/SKILL.md**
`;
}

export function diffCommandSkillMarkdown(): string {
  return `---
name: ${DIFF_SKILL_NAME}
description: "Compare current flow-state against saved snapshot and render gate/stage deltas."
---

# /cc-diff

## HARD-GATE

Never lose baseline visibility: render deltas before writing a new snapshot.

## Protocol

1. Read \`${flowStatePath()}\`.
2. Read \`${snapshotPath()}\`.
3. If snapshot missing:
   - write baseline snapshot from current state,
   - print \`flow diff baseline created\`,
   - stop.
4. Build deltas for stage, completed/skipped/stale sets, and current-stage gate arrays.
5. Print a compact diff map with explicit \`+\`, \`-\`, and \`->\` markers.
6. Write updated snapshot with:
   - \`capturedAt\` (ISO)
   - \`state\` (full current flow-state object)

## Validation

- Diff output must be deterministic for identical states ("no changes").
- Snapshot file stays valid JSON after every run.
- Do not suppress removed values; removals are first-class evidence.
`;
}
