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
  return `# /cc-archive

## Purpose

Archive the active cclaw run from inside the harness flow (agent-first finish).

This command removes the user-facing CLI gap: users can stay in \`/cc-*\` flow and
finish with \`/cc-archive\` after ship + retro are complete.

## HARD-GATE

- Do not archive a shipped run when retro is still incomplete.
- Do not manually move files between \`${activeArtifactsPath()}\` and \`${runsPath()}\`.
- Use the archive runtime so state snapshots + manifest stay consistent.

## Inputs

\`/cc-archive [--name=<slug>] [--skip-retro --retro-reason=<text>]\`

## Algorithm

1. Read \`${flowStatePath()}\`.
2. If ship is complete and \`retro.completedAt\` is absent:
   - block with explicit instruction: run \`/cc-retro\` first.
3. Build archive command:
   - base: \`npx cclaw archive\`
   - optional: \`--name=<slug>\`
   - optional override: \`--skip-retro --retro-reason=<text>\`
4. Execute archive command in project root.
5. Surface result:
   - archive id/path,
   - reset stage (brainstorm/spec depending on track default),
   - knowledge curation hint when threshold exceeded.

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
description: "Archive the active cclaw run from harness flow and reset runtime safely."
---

# /cc-archive

## HARD-GATE

Never simulate archive by hand-editing runtime files. Always execute the archive
runtime command so state snapshots and manifest generation stay atomic.

## Protocol

1. Read \`${flowStatePath()}\`:
   - confirm whether ship is completed,
   - check \`retro.completedAt\` for post-ship runs.
2. If ship complete and retro incomplete -> stop and direct user to \`/cc-retro\`.
3. Build shell command:
   - \`npx cclaw archive\`
   - append \`--name=<slug>\` when provided
   - append \`--skip-retro --retro-reason=<text>\` only when user explicitly requests skip
4. Run command from repo root.
5. Relay key lines from output:
   - archive destination under \`${runsPath()}\`
   - flow reset confirmation
   - knowledge curation recommendation

## Validation

- \`${runsPath()}\` contains a new archive folder.
- \`${activeArtifactsPath()}\` is reset for the next run.
- \`${flowStatePath()}\` is valid JSON and points to the initial stage.
`;
}

