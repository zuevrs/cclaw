import { RUNTIME_ROOT } from "../constants.js";
import { diffSubcommandMarkdown } from "./diff-command.js";
import { statusSubcommandMarkdown } from "./status-command.js";
import { treeSubcommandMarkdown } from "./tree-command.js";

import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
const VIEW_SKILL_FOLDER = "flow-view";
const VIEW_SKILL_NAME = "flow-view";

export function viewCommandContract(): string {
  return `# /cc-view

## Purpose

Unified read-only command surface for flow visibility.

Subcommands:
- \`/cc-view\` or \`/cc-view status\` -> status snapshot
- \`/cc-view tree\` -> structural flow tree
- \`/cc-view diff\` -> read-only git delta map

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
- \`/cc-view\` is strictly read-only at wrapper level.
- Do not mutate flow-state or derived state from any subcommand.

## Routing

1. Parse subcommand (default \`status\`).
2. Route:
   - \`status\` -> use the **Status Subcommand** section in \`${RUNTIME_ROOT}/skills/${VIEW_SKILL_FOLDER}/SKILL.md\`
   - \`tree\` -> use the **Tree Subcommand** section in \`${RUNTIME_ROOT}/skills/${VIEW_SKILL_FOLDER}/SKILL.md\`
   - \`diff\` -> use the **Diff Subcommand** section in \`${RUNTIME_ROOT}/skills/${VIEW_SKILL_FOLDER}/SKILL.md\`
3. Unknown subcommand -> print supported values and stop.

## Headless mode

For machine orchestration, emit one JSON envelope:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"non-flow","payload":{"command":"/cc-view","subcommand":"status","summary":"<short>"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`cclaw internal envelope-validate --stdin\`

## Primary skill

**${RUNTIME_ROOT}/skills/${VIEW_SKILL_FOLDER}/SKILL.md**
`;
}

export function viewCommandSkillMarkdown(): string {
  const status = statusSubcommandMarkdown();
  const tree = treeSubcommandMarkdown();
  const diff = diffSubcommandMarkdown();
  return `---
name: ${VIEW_SKILL_NAME}
description: "Unified read-only view skill for status/tree/diff flow visibility commands."
---

# /cc-view

## HARD-GATE

Wrapper is read-only and dispatch-only. It must not mutate flow state directly.

## Protocol

1. Parse optional subcommand token:
   - missing -> \`status\`
   - \`status\` -> run **Status Subcommand** below
   - \`tree\` -> run **Tree Subcommand** below
   - \`diff\` -> run **Diff Subcommand** below
2. Execute only the chosen subcommand section.
3. Return concise output and suggest \`/cc-view <subcommand>\` variants for navigation.

## Status Subcommand

${status}

## Tree Subcommand

${tree}

## Diff Subcommand

${diff}
`;
}

