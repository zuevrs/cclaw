import { RUNTIME_ROOT } from "../constants.js";

const START_SKILL_FOLDER = "flow-start";
const START_SKILL_NAME = "flow-start";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

/**
 * Command contract for /cc — the unified entry point.
 * No args → behaves like /cc-next (resume or start brainstorm).
 * With prompt → starts brainstorm with the given idea.
 */
export function startCommandContract(): string {
  const flowPath = flowStatePath();
  return `# /cc

## Purpose

**The unified entry point for the cclaw flow.**

- \`/cc\` (no arguments) → behaves exactly like \`/cc-next\`: reads flow state and resumes the current stage, or starts brainstorm if the flow is fresh.
- \`/cc <prompt>\` (with an idea/description) → saves the prompt as brainstorm context and begins the brainstorm stage, regardless of current flow state.

This is the **recommended way to start** working with cclaw. Use \`/cc-next\` for subsequent stage progression.

## HARD-GATE

- **Do not** skip reading \`${flowPath}\` — always check current state before acting.
- **Do not** start implementation stages directly from \`/cc <prompt>\` — always begin at brainstorm.

## Algorithm

### With prompt (\`/cc <text>\`)

1. Read \`${flowPath}\`.
2. If flow already has completed stages beyond brainstorm, warn the user that starting a new brainstorm will reset progress. Ask for confirmation before proceeding.
3. Write the prompt to \`.cclaw/artifacts/00-idea.md\` as the raw idea capture.
4. Set \`currentStage: "brainstorm"\` in flow state (reset if needed).
5. Load \`.cclaw/skills/brainstorming/SKILL.md\` and \`.cclaw/commands/brainstorm.md\`.
6. Execute brainstorm with the prompt as initial context.

### Without prompt (\`/cc\`)

1. Read \`${flowPath}\`.
2. If flow state is missing → run \`cclaw init\` guidance and stop.
3. Behave exactly like \`/cc-next\`: check current stage gates, resume if incomplete, advance if complete.

## Primary skill

**${RUNTIME_ROOT}/skills/${START_SKILL_FOLDER}/SKILL.md**
`;
}

/**
 * Skill body for /cc — the unified entry point.
 */
export function startCommandSkillMarkdown(): string {
  const flowPath = flowStatePath();
  return `---
name: ${START_SKILL_NAME}
description: "Unified entry point for the cclaw flow. No args = resume/next. With prompt = start brainstorm with idea."
---

# /cc — Flow Entry Point

## Overview

\`/cc\` is the **starting command** for cclaw. It intelligently routes:

- **No arguments** → acts as \`/cc-next\` (resume current stage or advance to next)
- **With a prompt** → captures the idea and starts brainstorm

## HARD-GATE

Do **not** silently discard an existing flow when the user provides a prompt. If completed stages exist, inform and confirm before resetting.

## Protocol

### Path A: \`/cc <prompt>\`

1. Read \`${flowPath}\`.
2. If \`completedStages\` is non-empty:
   - Inform: "You have an active flow at stage **{currentStage}** with {N} completed stages. Starting a new brainstorm will reset progress."
   - Ask: "Continue with reset? (A) Yes, start fresh (B) No, resume current flow"
   - If (B) → switch to Path B behavior.
3. Write \`${RUNTIME_ROOT}/artifacts/00-idea.md\` with the user's prompt.
4. Update \`${flowPath}\`: set \`currentStage: "brainstorm"\`, clear \`completedStages\`, reset gate catalog.
5. Load and execute: \`${RUNTIME_ROOT}/skills/brainstorming/SKILL.md\` + \`${RUNTIME_ROOT}/commands/brainstorm.md\`.

### Path B: \`/cc\` (no arguments)

Delegate entirely to \`/cc-next\` behavior:

1. Read \`${flowPath}\`.
2. Check gates for \`currentStage\`.
3. If incomplete → load current stage skill and execute.
4. If complete → advance to next stage and execute.
5. If flow is done → report completion.

## When to use \`/cc\` vs \`/cc-next\`

| Scenario | Command |
|---|---|
| Starting work for the first time | \`/cc\` or \`/cc <idea>\` |
| Resuming in a new session | \`/cc\` |
| Progressing after completing a stage | \`/cc-next\` |
| Starting with a specific idea | \`/cc <idea>\` |

Both commands read the same \`flow-state.json\`. The difference is that \`/cc <prompt>\` always targets brainstorm, while \`/cc\` and \`/cc-next\` follow the state.
`;
}
