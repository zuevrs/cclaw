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
3. **Track heuristic** — classify the idea text and **recommend** a track (the user can override before any state mutation):
   - **quick** (\`spec → tdd → review → ship\`) — single-purpose work where the spec is essentially already known.
     Triggers (case-insensitive substring or close variant): \`bug\`, \`bugfix\`, \`fix\`, \`hotfix\`, \`patch\`, \`typo\`, \`regression\`, \`copy change\`, \`rename\`, \`bump\`, \`upgrade dep\`, \`config tweak\`, \`docs only\`, \`comment\`, \`lint\`, \`format\`, \`small\`, \`tiny\`, \`one-liner\`, \`revert\`.
   - **standard** (full 8 stages — default) — anything that introduces a new capability, touches multiple modules, or has unclear scope.
     Triggers: \`new feature\`, \`add\`, \`build\`, \`design\`, \`refactor\`, \`migration\`, \`platform\`, \`architecture\`, \`endpoint\`, \`schema\`, \`api\`, \`integrate\`, \`workflow\`, \`onboarding\`, or any prompt that does not match quick triggers.
   - When triggers conflict (e.g. "small refactor that touches 5 modules") prefer **standard** — quick is opt-in and only safe when scope is genuinely tiny.
4. Present the recommendation as a single decision with explicit options:
   > \`Recommended track: <quick|standard>\` because \`<one-line reason citing matched triggers>\`.
   > Override? (A) keep \`<recommended>\`  (B) switch to \`<other>\`  (C) cancel.
   If \`AskQuestion\`/\`AskUserQuestion\` is available, send exactly ONE question; on schema error, fall back to plain text.
5. Persist the chosen track to \`${flowPath}\` (\`track\` field). Compute \`skippedStages\` from the track and write that too. Use the **first stage of the chosen track** as \`currentStage\` (quick → \`spec\`, standard → \`brainstorm\`).
6. Write the prompt to \`.cclaw/artifacts/00-idea.md\` as the raw idea capture, and append a \`Track:\` line referencing the chosen track and the matched heuristic.
7. Load the **first-stage skill for the chosen track** and its command file:
   - quick → \`.cclaw/skills/specification-authoring/SKILL.md\` + \`.cclaw/commands/spec.md\`
   - standard → \`.cclaw/skills/brainstorming/SKILL.md\` + \`.cclaw/commands/brainstorm.md\`
8. Execute that stage with the prompt as initial context.

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
3. **Classify the idea** using the heuristic below and present a single track recommendation. Wait for explicit confirmation or override before mutating any state.

   **Track heuristic** (lowercase substring match against the user prompt):

   | Track | Triggers | Use when |
   |---|---|---|
   | \`quick\` | \`bug\`, \`bugfix\`, \`fix\`, \`hotfix\`, \`patch\`, \`typo\`, \`regression\`, \`rename\`, \`bump\`, \`upgrade dep\`, \`docs only\`, \`comment\`, \`lint\`, \`format\`, \`small\`, \`tiny\`, \`one-liner\`, \`revert\`, \`copy change\` | Single-purpose, spec is essentially known, low blast radius |
   | \`standard\` | \`new feature\`, \`add\`, \`build\`, \`design\`, \`refactor\`, \`migration\`, \`platform\`, \`architecture\`, \`endpoint\`, \`schema\`, \`api\`, \`integrate\`, \`workflow\`, \`onboarding\` (or no quick trigger matched) | Anything new, multi-module, or unclear scope |

   - On conflict, prefer \`standard\` (quick is opt-in for genuinely tiny work).
   - Always state the recommendation as a one-line reason citing the matched trigger.
4. Persist the chosen track in \`${flowPath}\` (\`track\` + \`skippedStages\`). Set \`currentStage\` to the first stage of the chosen track (\`quick\` → \`spec\`, \`standard\` → \`brainstorm\`). Reset gate catalog.
5. Write \`${RUNTIME_ROOT}/artifacts/00-idea.md\` with the user's prompt and an explicit \`Track:\` line capturing the heuristic decision.
6. Load and execute the **first stage skill of the chosen track** (\`brainstorming\` for standard, \`specification-authoring\` for quick) plus its matching command file.

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
