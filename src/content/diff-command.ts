import { RUNTIME_ROOT } from "../constants.js";

const DIFF_SKILL_FOLDER = "flow-diff";
const DIFF_SKILL_NAME = "flow-diff";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
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

Show a visual change map for flow-state progression without writing a baseline
file. Covers the current stage/gate state plus available worktree deltas for:

- ship **closeout substate** transitions (\`retro_review\` → \`compound_review\` → \`ready_to_archive\`),
- delegation **fulfillmentMode** changes visible in \`git diff\`,
- appearance or removal of the retro artifact \`09-retro.md\`.

## HARD-GATE

- This command is read-only. Do not write \`${flowStatePath()}\`, \`${delegationLogPath()}\`, or any derived snapshot.
- Prefer git/worktree evidence when available; otherwise render the current state summary and say that no baseline is available.

## Algorithm

1. Read current state from \`${flowStatePath()}\` (including \`closeout\`).
2. Read current delegation log from \`${delegationLogPath()}\` (if missing treat as empty).
3. Inspect git diff for \`${flowStatePath()}\`, \`${delegationLogPath()}\`, and \`${retroArtifactPath()}\` when the repo is under git.
4. Compute visible deltas from git output when available:
   - stage transition (\`from -> to\`),
   - completed/skipped/stale stage additions or removals,
   - current-stage gate \`passed\` and \`blocked\` changes,
   - \`closeout.shipSubstate\` transition (\`from -> to\`),
   - \`closeout.retroDraftedAt\` / \`retroAcceptedAt\` / \`retroSkipped\` flips,
   - \`closeout.compoundPromoted\` / \`compoundSkipped\` flips,
   - per-agent \`fulfillmentMode\` changes visible in delegation log diffs,
   - appearance (\`+\`) or disappearance (\`-\`) of \`${retroArtifactPath()}\`.
5. If no git baseline is available, render a current-state summary with
   \`baseline: unavailable (read-only mode)\`.
6. Render a compact diff map (added \`+\`, removed \`-\`, changed \`->\`).

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
description: "Render read-only flow-state, closeout, artifact, and delegation deltas from git/worktree evidence."
---

# /cc-view diff

## HARD-GATE

Never mutate state from \`/cc-view diff\`. It is a read-only inspection command.

## Protocol

1. Read \`${flowStatePath()}\`.
2. Read \`${delegationLogPath()}\` (missing → treat as empty list).
3. Inspect git diff for \`${flowStatePath()}\`, \`${delegationLogPath()}\`, and \`${retroArtifactPath()}\`.
4. Build deltas for:
   - stage, completed/skipped/stale sets,
   - current-stage gate arrays (\`passed\`, \`blocked\`),
   - \`closeout.shipSubstate\` transitions (\`from -> to\`),
   - \`closeout.retroDraftedAt\` / \`retroAcceptedAt\` / \`retroSkipped\` flips,
   - \`closeout.compoundPromoted\` / \`compoundSkipped\` / \`compoundCompletedAt\` flips,
   - per-agent \`fulfillmentMode\` changes visible in delegation diffs,
   - appearance or removal of \`${retroArtifactPath()}\` on disk.
5. If git has no baseline for these files, print \`baseline: unavailable (read-only mode)\`.
6. Print a compact diff map with explicit \`+\`, \`-\`, and \`->\` markers.

## Validation

- Diff output must be deterministic for identical states ("no visible changes").
- The command must not create or update any \`.cclaw/state/*.snapshot*\` file.
- Do not suppress removed values; removals are first-class evidence.
- Closeout diff lines must use the same \`shipSubstate\` vocabulary as the
  state machine (\`idle\` / \`retro_review\` / \`compound_review\` /
  \`ready_to_archive\` / \`archived\`).
`;
}
