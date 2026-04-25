import { RUNTIME_ROOT } from "../constants.js";

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

export function treeSubcommandMarkdown(): string {
  return `# /cc-view tree

## HARD-GATE

Do not modify state in this command. It is a pure read/render operation.

## Protocol

1. Read \`${flowStatePath()}\` as source of truth (including \`closeout\`).
2. Read \`${delegationLogPath()}\` for current-stage delegation status plus
   \`fulfillmentMode\` / \`evidenceRefs\`.
3. Inspect \`${artifactsPath()}\` for per-stage artifact presence and stale copies,
   and for the retro artifact \`09-retro.md\`.
4. Use \`npx cclaw-cli doctor --explain\` for harness capability status when needed.
5. Render one compact tree:
   - stage marker: passed/current/pending/skipped/stale,
   - gates summary,
   - artifact summary,
   - delegation branch for current stage with fulfillmentMode labels,
6. When \`closeout.shipSubstate !== "idle"\` or \`currentStage === "ship"\`, add
   a closeout sub-tree:
   - \`retro:\` line derived from \`closeout.retroDraftedAt\` /
     \`closeout.retroAcceptedAt\` / \`closeout.retroSkipped\` and artifact presence,
   - \`compound:\` line derived from \`closeout.compoundPromoted\` /
     \`closeout.compoundSkipped\` / \`closeout.compoundCompletedAt\`,
   - \`archive:\` line — \`pending\` until \`shipSubstate === "ready_to_archive"\`,
     then \`next\`; the transient \`archived\` substate surfaces only if the
     archive step failed mid-run.
7. Append a \`harnesses:\` branch. For each installed harness derive the tier
   and fallback from cclaw capability metadata; use \`npx cclaw-cli doctor --explain\`
   for remediation details when needed.
8. If rewind records exist in \`${rewindLogPath()}\`, include latest rewind note in footer.

## Validation

- Output must mention the active \`track\` and \`currentStage\`.
- Exactly one stage is marked current.
- Missing files are reported explicitly; never guessed as complete.
- Delegation rows always carry a fulfillmentMode label (or \`mode=?\` when the
  ledger entry is legacy and the mode is inferred).
- Closeout sub-tree is present iff ship is reached; it cannot be omitted while
  \`shipSubstate !== "idle"\`.
`;
}
