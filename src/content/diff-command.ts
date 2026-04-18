import { RUNTIME_ROOT } from "../constants.js";

const DIFF_SKILL_FOLDER = "flow-diff";
const DIFF_SKILL_NAME = "flow-diff";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function snapshotPath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.snapshot.json`;
}

function delegationLogPath(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

function retroArtifactPath(): string {
  return `${RUNTIME_ROOT}/artifacts/09-retro.md`;
}

export function diffCommandContract(): string {
  return `# /cc-view diff

## Purpose

Show a visual before/after diff map for flow-state progression. Covers the core
stage/gate transitions plus:

- ship **closeout substate** transitions (\`retro_review\` → \`compound_review\` → \`ready_to_archive\`),
- delegation **fulfillmentMode** transitions per mandatory agent,
- appearance or removal of the retro artifact \`09-retro.md\`.

## HARD-GATE

- Compare against \`${snapshotPath()}\` first; do not overwrite baseline before rendering.
- If no snapshot exists, initialize baseline and report "baseline created" explicitly.

## Algorithm

1. Read current state from \`${flowStatePath()}\` (including \`closeout\`).
2. Read current delegation log from \`${delegationLogPath()}\` (if missing treat as empty).
3. Read baseline from \`${snapshotPath()}\` (if missing -> create baseline from
   current state **plus** a copy of the current delegation log; report
   \`flow diff baseline created\` and stop).
4. Compute deltas:
   - stage transition (\`from -> to\`),
   - completed stage additions/removals,
   - skipped stage additions/removals,
   - stale stage additions/removals,
   - current-stage gate \`passed\` and \`blocked\` changes,
   - \`closeout.shipSubstate\` transition (\`from -> to\`),
   - \`closeout.retroDraftedAt\` / \`retroAcceptedAt\` / \`retroSkipped\` flips,
   - \`closeout.compoundPromoted\` / \`compoundSkipped\` flips,
   - per-agent \`fulfillmentMode\` transitions from the baseline delegation log,
   - appearance (\`+\`) or disappearance (\`-\`) of \`${retroArtifactPath()}\`.
5. Render a compact diff map (added \`+\`, removed \`-\`, changed \`->\`).
6. Persist current state back to \`${snapshotPath()}\` as new baseline with
   \`capturedAt\` and an embedded \`delegations\` projection
   (\`{ agent, status, fulfillmentMode }[]\`) so fulfillmentMode transitions are
   computable on the next run.

## Diff Map Format

\`\`\`
cclaw flow diff
  stage: design -> spec
  completed: +design
  stale: -design
  gates(spec): +spec_contract_complete  -spec_open_questions_closed
  blocked(spec): +spec_trace_matrix_missing
  closeout: idle -> retro_review
  retro: +drafted (09-retro.md appeared)
  delegations:
    - reviewer: scheduled -> completed (mode=generic-dispatch)
    - test-author: mode=? -> role-switch (evidenceRefs=2)
\`\`\`

- The \`closeout:\` line is omitted when \`shipSubstate\` is unchanged.
- The \`delegations:\` block is omitted when no agent changed status or mode.
- The \`retro:\` line is emitted only on artifact appearance/removal or on a
  \`retroAcceptedAt\` / \`retroSkipped\` flip.

## Primary skill

**${RUNTIME_ROOT}/skills/${DIFF_SKILL_FOLDER}/SKILL.md**
`;
}

export function diffCommandSkillMarkdown(): string {
  return `---
name: ${DIFF_SKILL_NAME}
description: "Compare current flow-state against saved snapshot and render gate/stage/closeout/delegation deltas."
---

# /cc-view diff

## HARD-GATE

Never lose baseline visibility: render deltas before writing a new snapshot.

## Protocol

1. Read \`${flowStatePath()}\`.
2. Read \`${delegationLogPath()}\` (missing → treat as empty list).
3. Read \`${snapshotPath()}\`.
4. If snapshot missing:
   - write baseline snapshot from current state **plus** a
     \`delegations\` projection (\`{ agent, status, fulfillmentMode }[]\`),
   - print \`flow diff baseline created\`,
   - stop.
5. Build deltas for:
   - stage, completed/skipped/stale sets,
   - current-stage gate arrays (\`passed\`, \`blocked\`),
   - \`closeout.shipSubstate\` transitions (\`from -> to\`),
   - \`closeout.retroDraftedAt\` / \`retroAcceptedAt\` / \`retroSkipped\` flips,
   - \`closeout.compoundPromoted\` / \`compoundSkipped\` / \`compoundCompletedAt\` flips,
   - per-agent \`fulfillmentMode\` transitions by matching baseline delegations
     against current delegations on \`agent\` + latest entry,
   - appearance or removal of \`${retroArtifactPath()}\` on disk.
6. Print a compact diff map with explicit \`+\`, \`-\`, and \`->\` markers.
7. Write updated snapshot with:
   - \`capturedAt\` (ISO),
   - \`state\` (full current flow-state object),
   - \`delegations\` projection from the current log.

## Validation

- Diff output must be deterministic for identical states ("no changes").
- Snapshot file stays valid JSON after every run.
- Do not suppress removed values; removals are first-class evidence.
- Closeout diff lines must use the same \`shipSubstate\` vocabulary as the
  state machine (\`idle\` / \`retro_review\` / \`compound_review\` /
  \`ready_to_archive\` / \`archived\`).
`;
}
