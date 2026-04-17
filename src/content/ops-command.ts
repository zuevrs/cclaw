import { RUNTIME_ROOT } from "../constants.js";

const OPS_SKILL_FOLDER = "flow-ops";
const OPS_SKILL_NAME = "flow-ops";

export function opsCommandContract(): string {
  return `# /cc-ops

## Purpose

Unified operational command surface for non-stage flow actions.

Subcommands:
- \`feature\` -> \`/cc-feature\`
- \`tdd-log\` -> \`/cc-tdd-log\`
- \`retro\` -> \`/cc-retro\`
- \`archive\` -> \`/cc-archive\`
- \`rewind\` -> \`/cc-rewind\`
- \`rewind-ack\` -> \`/cc-rewind-ack\`

## HARD-GATE

- \`/cc-ops\` is a routing wrapper; execute only one target subcommand per call.
- Preserve target command safety contracts (retro gate, archive gate, rewind atomicity, etc.).

## Routing

1. Parse required subcommand token.
2. Dispatch:
   - \`feature\` -> \`${RUNTIME_ROOT}/commands/feature.md\`
   - \`tdd-log\` -> \`${RUNTIME_ROOT}/commands/tdd-log.md\`
   - \`retro\` -> \`${RUNTIME_ROOT}/commands/retro.md\`
   - \`archive\` -> \`${RUNTIME_ROOT}/commands/archive.md\`
   - \`rewind\` -> \`${RUNTIME_ROOT}/commands/rewind.md\`
   - \`rewind-ack\` -> \`${RUNTIME_ROOT}/commands/rewind-ack.md\`
3. Unknown subcommand -> print supported values and stop.

## Primary skill

**${RUNTIME_ROOT}/skills/${OPS_SKILL_FOLDER}/SKILL.md**
`;
}

export function opsCommandSkillMarkdown(): string {
  return `---
name: ${OPS_SKILL_NAME}
description: "Unified operational router for feature/tdd-log/retro/archive/rewind commands."
---

# /cc-ops

## HARD-GATE

This wrapper only dispatches. It must not apply state mutations itself.

## Protocol

1. Require a subcommand (\`feature|tdd-log|retro|archive|rewind|rewind-ack\`).
2. Route to the matching command contract + skill pair.
3. Preserve pass-through args after the subcommand (e.g. \`/cc-ops rewind design\`).
4. Echo which subcommand was dispatched for auditability.
`;
}

