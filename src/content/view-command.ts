import { RUNTIME_ROOT } from "../constants.js";

const VIEW_SKILL_FOLDER = "flow-view";
const VIEW_SKILL_NAME = "flow-view";

export function viewCommandContract(): string {
  return `# /cc-view

## Purpose

Unified read-only command surface for flow visibility.

Subcommands:
- \`/cc-view\` or \`/cc-view status\` -> status snapshot
- \`/cc-view tree\` -> structural flow tree
- \`/cc-view diff\` -> read-only worktree delta map

## HARD-GATE

- \`/cc-view\` is strictly read-only at wrapper level.
- Do not mutate flow-state or derived state from any subcommand.

## Routing

1. Parse subcommand (default \`status\`).
2. Route:
   - \`status\` -> load \`${RUNTIME_ROOT}/skills/flow-status/SKILL.md\`
   - \`tree\` -> load \`${RUNTIME_ROOT}/skills/flow-tree/SKILL.md\`
   - \`diff\` -> load \`${RUNTIME_ROOT}/skills/flow-diff/SKILL.md\`
3. Unknown subcommand -> print supported values and stop.

## Headless mode

For machine orchestration, emit one JSON envelope:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"review","payload":{"command":"/cc-view","subcommand":"status","summary":"<short>"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`cclaw internal envelope-validate --stdin\`

## Primary skill

**${RUNTIME_ROOT}/skills/${VIEW_SKILL_FOLDER}/SKILL.md**
`;
}

export function viewCommandSkillMarkdown(): string {
  return `---
name: ${VIEW_SKILL_NAME}
description: "Unified read-only view router for status/tree/diff flow visibility commands."
---

# /cc-view

## HARD-GATE

Wrapper is read-only and dispatch-only. It must not mutate flow state directly.

## Protocol

1. Parse optional subcommand token:
   - missing -> \`status\`
   - \`status\` -> dispatch to \`${RUNTIME_ROOT}/skills/flow-status/SKILL.md\`
   - \`tree\` -> dispatch to \`${RUNTIME_ROOT}/skills/flow-tree/SKILL.md\`
   - \`diff\` -> dispatch to \`${RUNTIME_ROOT}/skills/flow-diff/SKILL.md\`
2. Execute the target skill.
3. Return concise output and suggest \`/cc-view <subcommand>\` variants for navigation.
`;
}

