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
- \`/cc-view diff\` -> baseline delta map

## HARD-GATE

- \`/cc-view\` is strictly read-only at wrapper level.
- Do not mutate flow-state unless routing to \`diff\` (which updates snapshot baseline by design).

## Routing

1. Parse subcommand (default \`status\`).
2. Route:
   - \`status\` -> load \`${RUNTIME_ROOT}/commands/status.md\` + \`${RUNTIME_ROOT}/skills/flow-status/SKILL.md\`
   - \`tree\` -> load \`${RUNTIME_ROOT}/commands/tree.md\` + \`${RUNTIME_ROOT}/skills/flow-tree/SKILL.md\`
   - \`diff\` -> load \`${RUNTIME_ROOT}/commands/diff.md\` + \`${RUNTIME_ROOT}/skills/flow-diff/SKILL.md\`
3. Unknown subcommand -> print supported values and stop.

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
   - \`status\` -> dispatch to \`/cc-status\`
   - \`tree\` -> dispatch to \`/cc-tree\`
   - \`diff\` -> dispatch to \`/cc-diff\`
2. Execute the target command contract and skill.
3. Return concise output and suggest \`/cc-view <subcommand>\` variants for navigation.
`;
}

