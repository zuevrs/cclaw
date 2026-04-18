import { RUNTIME_ROOT } from "../constants.js";

const ARCHIVE_SKILL_FOLDER = "flow-archive";
const ARCHIVE_SKILL_NAME = "flow-archive";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

function runsPath(): string {
  return `${RUNTIME_ROOT}/runs`;
}

function activeArtifactsPath(): string {
  return `${RUNTIME_ROOT}/artifacts`;
}

export function archiveCommandContract(): string {
  return `# /cc-ops archive

## Purpose

Finalize the active cclaw run: move artifacts to \`${runsPath()}/<archive-id>\`,
snapshot state, write a manifest, and reset runtime for the next run.

Auto-triggered by \`/cc-next\` when \`closeout.shipSubstate === "ready_to_archive"\`.
Direct invocation from a harness command is supported but rarely needed.

## HARD-GATE

- Do not archive with \`closeout.shipSubstate !== "ready_to_archive"\`.
- Do not archive a shipped run when \`retro.completedAt\` is missing and
  \`closeout.retroSkipped !== true\`.
- Never hand-move files between \`${activeArtifactsPath()}\` and \`${runsPath()}\`.
  Always run the archive runtime command so the snapshot+manifest stay
  atomic.

## Inputs

\`/cc-ops archive [--name=<slug>]\`

(Legacy flags \`--skip-retro --retro-reason=<text>\` still exist for CLI
invocations; in-harness the skip path is driven by \`closeout.retroSkipped\`
set during retro.)

## Algorithm

1. Read \`${flowStatePath()}\`.
2. Verify \`closeout.shipSubstate === "ready_to_archive"\`. If not, report
   \`closeout not ready (state=<substate>) | run: /cc-next\` and stop.
3. Build archive command:
   - base: \`npx cclaw archive\`,
   - optional: \`--name=<slug>\`,
   - legacy override: \`--skip-retro --retro-reason=<text>\` (only when user
     explicitly wants the CLI skip path).
4. Execute the archive command in project root.
5. On success, flow-state is reset to the initial stage for the default
   track; \`closeout.shipSubstate\` returns to \`"idle"\` on reset.
6. Surface:
   - archive id/path,
   - reset stage,
   - knowledge curation hint when \`activeEntryCount >= softThreshold\`.

## Output format

\`\`\`
cclaw archive
  status: archived
  run: <archive-id>
  path: .cclaw/runs/<archive-id>
  next: /cc <new-idea>
\`\`\`

## Primary skill

**${RUNTIME_ROOT}/skills/${ARCHIVE_SKILL_FOLDER}/SKILL.md**
`;
}

export function archiveCommandSkillMarkdown(): string {
  return `---
name: ${ARCHIVE_SKILL_NAME}
description: "Finalize the active cclaw run. Auto-triggered by /cc-next when shipSubstate=ready_to_archive."
---

# /cc-ops archive

## HARD-GATE

Never simulate archive by hand-editing runtime files. Always execute the
archive runtime command so state snapshots and manifest generation stay
atomic. Never bypass the substate check — if retro/compound haven't
advanced the substate to \`ready_to_archive\`, stop and surface the
mismatch.

## Protocol

1. Read \`${flowStatePath()}\`:
   - if \`closeout.shipSubstate !== "ready_to_archive"\`, stop and route
     the user back to \`/cc-next\` (it will resume at the correct step),
   - sanity-check: \`completedStages\` must include \`"ship"\`,
   - sanity-check: \`retro.completedAt\` is set **or**
     \`closeout.retroSkipped === true\` with a reason.
2. Build shell command:
   - \`npx cclaw archive\`,
   - append \`--name=<slug>\` when provided,
   - append legacy \`--skip-retro --retro-reason=<text>\` only when the user
     explicitly requests the CLI skip path (normally not needed — skip is
     captured in \`closeout\` during retro).
3. Run command from repo root.
4. Relay key lines from output:
   - archive destination under \`${runsPath()}\`,
   - flow reset confirmation,
   - knowledge curation recommendation if \`activeEntryCount >= 50\`.

## Resume semantics

Archive is idempotent on a per-run basis. If a previous session ran
archive successfully, the active artifacts directory is empty and
\`closeout.shipSubstate\` is \`"idle"\`; \`/cc-next\` will simply report
"Flow complete" or prompt for a new \`/cc\` input.

## Validation

- \`${runsPath()}\` contains a new archive folder for this run.
- \`${activeArtifactsPath()}\` is reset for the next run.
- \`${flowStatePath()}\` is valid JSON and points to the initial stage.
- \`closeout.shipSubstate === "idle"\` after reset.
`;
}
