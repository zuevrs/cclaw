import { RUNTIME_ROOT } from "../constants.js";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function delegationLogPath(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

function retroArtifactPath(): string {
  return `${RUNTIME_ROOT}/artifacts/09-retro.md`;
}

export function diffSubcommandMarkdown(): string {
  return `# /cc-view diff

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
