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

Render a visual flow tree for quick orientation across stages, gates, delegations
(with fulfillmentMode), ship closeout substate, stale markers, artifact presence,
and per-harness playbook availability.

## HARD-GATE

- \`/cc-view tree\` is read-only. Do not mutate flow-state or artifacts.
- Use values from \`${flowStatePath()}\` and \`${delegationLogPath()}\`; never infer missing evidence.

## Algorithm

1. Read \`${flowStatePath()}\`.
2. Read \`${delegationLogPath()}\` (if missing, treat current-stage delegations as pending).
3. Detect artifact files in \`${artifactsPath()}\` (\`01-brainstorm.md\` …
   \`08-ship.md\` plus \`09-retro.md\`).
4. Read rewind records from \`${rewindLogPath()}\` when present for stale-stage context.
5. Use \`cclaw doctor --explain\` for harness capability status when needed.
6. Render the tree using stage order from active track:
   - stage node marker: passed/current/pending/skipped/stale
   - gate summary: \`passed/required\`
   - delegation summary for current stage (each agent carries its
     \`fulfillmentMode\` label)
   - artifact marker per stage (exists / stale copy / missing)
7. When \`currentStage === "ship"\` or \`closeout.shipSubstate !== "idle"\`,
   append a closeout sub-tree under ship with substate and retro/compound flags.
8. Append a final \`harnesses\` branch summarising tier + fallback +
   playbook-present for each installed harness.

## Tree Format

\`\`\`
cclaw flow tree (track=<track>, run=<runId>)
├─ [✓] brainstorm  gates 6/6   artifact 01-brainstorm.md
├─ [✓] scope       gates 5/5   artifact 02-scope.md
├─ [▶] design      gates 2/7   artifact 03-design.md
│  ├─ delegations:
│  │   ├─ planner   ✓ completed  mode=isolated
│  │   └─ reviewer  ○ pending
│  └─ stale: none
├─ [○] spec        gates -     artifact missing
└─ [○] plan        gates -     artifact missing

closeout (shipSubstate=retro_review):
  ├─ retro:    drafted 09-retro.md · awaiting accept/edit/skip
  ├─ compound: —
  └─ archive:  pending

harnesses:
  ├─ claude    tier=tier1 fallback=native
  ├─ cursor    tier=tier2 fallback=generic-dispatch
  ├─ opencode  tier=tier2 fallback=role-switch
  └─ codex     tier=tier2 fallback=role-switch
\`\`\`

- Closeout sub-tree is **omitted** when \`currentStage !== "ship"\` and
  \`shipSubstate === "idle"\`.
- Delegations sub-branch is omitted when the stage has no mandatory agents.
- Harness capability details come from \`cclaw doctor --explain\`, not generated playbook files.

Use UTF markers by default, ASCII fallback when terminal cannot render UTF.

## Primary skill

**${RUNTIME_ROOT}/skills/${TREE_SKILL_FOLDER}/SKILL.md**
`;
}

export function treeCommandSkillMarkdown(): string {
  return `---
name: ${TREE_SKILL_NAME}
description: "Render a visual flow tree for stages, gates, delegations (fulfillmentMode), ship closeout substate, artifacts, and harness status."
---

# /cc-view tree

## HARD-GATE

Do not modify state in this command. It is a pure read/render operation.

## Protocol

1. Read \`${flowStatePath()}\` as source of truth (including \`closeout\`).
2. Read \`${delegationLogPath()}\` for current-stage delegation status plus
   \`fulfillmentMode\` / \`evidenceRefs\`.
3. Inspect \`${artifactsPath()}\` for per-stage artifact presence and stale copies,
   and for the retro artifact \`09-retro.md\`.
4. Use \`cclaw doctor --explain\` for harness capability status when needed.
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
   and fallback from cclaw capability metadata; use \`cclaw doctor --explain\`
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
