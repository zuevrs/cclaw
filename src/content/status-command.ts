import { RUNTIME_ROOT } from "../constants.js";

const STATUS_SKILL_NAME = "flow-status";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function delegationLogPath(): string {
  return `${RUNTIME_ROOT}/state/delegation-log.json`;
}

function knowledgePath(): string {
  return `${RUNTIME_ROOT}/knowledge.jsonl`;
}

function retroArtifactPath(): string {
  return `${RUNTIME_ROOT}/artifacts/09-retro.md`;
}

/**
 * Skill body for /cc-view status — read-only status snapshot.
 */
export function statusCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  const delegationPath = delegationLogPath();
  return `---
name: ${STATUS_SKILL_NAME}
description: "Read-only visual snapshot of the cclaw flow with progress bar, gate counts, delegations (fulfillmentMode + evidence), closeout substate, and harness parity row."
---

# /cc-view status — Flow Status Snapshot

## Overview

\`/cc-view status\` is the quickest way to answer "where are we in the flow?" without
advancing or mutating anything. Safe to run at any point. The snapshot reflects:

- progress across stages with per-stage markers,
- gate coverage,
- mandatory delegations with **fulfillmentMode** (isolated / generic-dispatch /
  role-switch / harness-waiver) and evidence gate,
- **closeout substate** after ship (retro → compound → archive),
- **harness parity row** (tier + fallback) for the active harness set.

## HARD-GATE

Do **not** mutate \`${flowPath}\` or \`${delegationPath}\` from this skill. This is
a read-only command.

## Algorithm

1. Read \`${flowPath}\`. If missing → report **BLOCKED: flow state absent** and suggest \`cclaw init\`.
2. Read \`${delegationPath}\`. Missing → treat all mandatory delegations as pending.
3. Render **time in stage** as \`(unknown)\` unless visible conversation or
   artifact handoff context gives a timestamp.
4. Summarize current-stage gate counts from \`passed\`, \`blocked\`, and required gate metadata.
5. Derive harness \`<tier>/<fallback>\` rows from cclaw capability metadata.
6. Read \`${RUNTIME_ROOT}/knowledge.jsonl\`. If missing or empty → knowledge highlights are \`(none recorded)\`. Parse each line as JSON and surface its \`trigger\`/\`action\`.
7. For each gate in \`stageGateCatalog[currentStage].required\`:
   - Satisfied if present in \`passed\` and absent from \`blocked\`.
8. For each mandatory delegation of the current stage, evaluate:
   - \`✓ completed\` when \`status === "completed"\` and (harness is not role-switch
     **or** \`evidenceRefs.length >= 1\`).
   - \`◎ missing-evidence\` when \`status === "completed"\`, harness declares
     \`role-switch\`, and \`evidenceRefs\` is empty or absent.
   - \`○ <status>\` for \`scheduled\` / pending.
   - \`⊘ waived\` when \`status === "waived"\`.
   - \`✗ failed\` when \`status === "failed"\`.
9. Compute **closeout row** when \`currentStage === "ship"\` or
    \`closeout.shipSubstate !== "idle"\`:
    - \`shipSubstate\` verbatim,
    - \`retro=drafted|accepted|skipped|—\` derived from \`closeout.retroDraftedAt\`,
      \`closeout.retroAcceptedAt\`, \`closeout.retroSkipped\`,
    - \`compound=<N promoted>|skipped|—\` from
      \`closeout.compoundPromoted\` / \`closeout.compoundSkipped\`.
10. Build and print the visual status block:
    - stage header
    - one-line progress bar with per-stage markers
    - gate summary
    - delegation rows (per mandatory agent)
    - closeout row (when active)
    - harness row
    - stale stage row
11. Suggest the next action:
    - If current stage has unmet gates → \`/cc-next\` to resume.
    - If closeout substate is non-idle → \`/cc-next\` to continue the chain.
    - If current stage is complete → \`/cc-next\` to advance (or report "Flow complete" if terminal).

## Output Guidelines

- Keep output compact (≤ 40 lines) — status, not narrative.
- Report counts, not full artifact contents.
- If any data source is missing or corrupt, say so explicitly rather than guessing.
- Include \`/cc-view tree\` for deep structure and \`/cc-view diff\` for before/after map in the final line.

## Anti-patterns

- Rebuilding trace-matrix or running doctor from \`/cc-view status\` — those belong to dedicated tools.
- Treating absence of delegation log as "all delegations complete".
- Collapsing \`◎ missing-evidence\` into \`✓ completed\` — role-switch gaps must stay
  visible so the stage cannot advance silently.
- Omitting the closeout row when \`shipSubstate !== "idle"\`; it is the only signal
  that tells the user why \`/cc-next\` is about to run retro/compound/archive.
- Mutating state to "clean up" during a status check.
`;
}
