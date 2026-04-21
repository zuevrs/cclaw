import { RUNTIME_ROOT } from "../constants.js";

const START_SKILL_FOLDER = "flow-start";
const START_SKILL_NAME = "flow-start";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

/**
 * Command contract for /cc — the unified entry point.
 * No args → behaves like /cc-next (resume or start the flow at its first stage).
 * With prompt → classifies the idea, selects a track, and starts the first
 * stage of that track (brainstorm for medium/standard, spec for quick).
 */
export function startCommandContract(): string {
  const flowPath = flowStatePath();
  return `# /cc

## Purpose

**The unified entry point for the cclaw flow.**

- \`/cc\` (no arguments) → behaves exactly like \`/cc-next\`: reads flow state and resumes the current stage, or starts brainstorm if the flow is fresh.
- \`/cc <prompt>\` (with an idea/description) → saves the prompt as idea context and starts the first stage of the resolved track.

This is the **recommended way to start** working with cclaw. Use \`/cc-next\` for subsequent stage progression.

## HARD-GATE

- **Do not** skip reading \`${flowPath}\` — always check current state before acting.
- **Do not** start implementation stages directly from \`/cc <prompt>\` — always begin at the first stage of the resolved track (brainstorm for medium/standard, spec for quick).
- **Do not** start a stage pipeline for a task that is not a software change (pure question, non-software task, conversation).

## Algorithm

### With prompt (\`/cc <text>\`)

1. **Phase 0 — Task classification.** Before any stage routing, classify the prompt:

   | Class | Signals | Action |
   |---|---|---|
   | **non-software** | legal text / docs / marketing copy / meeting notes / therapy-style conversation | Respond directly, do NOT open a stage, do NOT mutate flow state. |
   | **pure-question** | "how does X work?", "explain Y", "what are the trade-offs of Z?" | Answer directly, do NOT open a stage. |
   | **trivial** | typo, one-liner, rename, config tweak, copy change, version bump with zero behavior change | Fast-path: skip \`brainstorm\` and \`scope\`, seed \`00-idea.md\`, move straight to \`design\` or \`spec\` depending on whether an interface change is involved. |
   | **software — bug fix with repro** | regression / hotfix / named symptom + repro steps | Fast-path: set track to \`quick\`, seed \`04-spec.md\` with the reproduction, enter \`tdd\` with a RED reproduction test first. |
   | **software — medium** | additive feature following existing architecture | medium track (\`brainstorm → spec → plan → tdd → review → ship\`). |
   | **software — standard** | feature, refactor, migration, integration, architecture change | Full 8-stage flow starting at \`brainstorm\`. |

   Record the chosen class in \`.cclaw/artifacts/00-idea.md\` on the \`Class:\` line. Do NOT silently treat a non-software task as software.

2. **Phase 1 — Origin-document discovery.** Before asking the user for context, scan for existing requirements/plan artifacts and merge them into initial context:
   - \`.cclaw/artifacts/00-idea.md\` if it already exists (resumed flow).
   - Common origin locations: \`docs/prd/**\`, \`docs/rfcs/**\`, \`docs/adr/**\`, \`docs/design/**\`, \`specs/**\`, \`prd/**\`, \`rfc/**\`, \`design/**\`, root-level \`PRD.md\` / \`SPEC.md\` / \`DESIGN.md\` / \`REQUIREMENTS.md\` / \`ROADMAP.md\`.
   - Summarize each discovered doc in \`00-idea.md\` under a \`Discovered context\` section with path + 1-line summary.
   - If an origin doc contradicts the prompt, surface the conflict to the user before routing.

3. **Phase 2 — Tech-stack + version detection.** Sniff the repo for stack + language versions and record under \`Stack:\`:
   - Node: \`package.json\` \`engines\` / \`volta\` / \`packageManager\` / \`devDependencies\`.
   - Python: \`pyproject.toml\` / \`requirements*.txt\` / \`.python-version\`.
   - Go: \`go.mod\` (module + Go version).
   - Rust: \`Cargo.toml\` (\`[package]\` + \`rust-version\`).
   - Java/Kotlin: \`pom.xml\` / \`build.gradle*\` + toolchain version.
   - Containers: \`Dockerfile\`, \`docker-compose*.yml\`.
   - CI: \`.github/workflows\`, \`.gitlab-ci.yml\`.
   Skip detection quietly if no markers are found — do NOT invent a stack.

4. Read \`${flowPath}\`.
5. If flow already has completed stages, warn the user that starting a new tracked flow will reset progress. Ask for confirmation before proceeding.
6. **Track heuristic** — classify the idea text and **recommend** a track (the user can override before any state mutation):
   - First, load \`${RUNTIME_ROOT}/config.yaml\`. If \`trackHeuristics\` is defined, apply those per-track vocabulary hints (\`fallback\`, \`tracks.<id>.{triggers,veto}\`) on top of the built-in defaults. Evaluation order is always \`standard -> medium -> quick\` (narrow-to-broad).
   - **quick** (\`spec → tdd → review → ship\`) — single-purpose work where the spec is essentially already known.
     Triggers (case-insensitive substring or close variant): \`bug\`, \`bugfix\`, \`fix\`, \`hotfix\`, \`patch\`, \`typo\`, \`regression\`, \`copy change\`, \`rename\`, \`bump\`, \`upgrade dep\`, \`config tweak\`, \`docs only\`, \`comment\`, \`lint\`, \`format\`, \`small\`, \`tiny\`, \`one-liner\`, \`revert\`.
   - **medium** (\`brainstorm → spec → plan → tdd → review → ship\`) — additive work that fits existing architecture and still needs product framing.
     Triggers: \`add endpoint\`, \`add field\`, \`extend existing\`, \`wire integration\`, \`small migration\`, \`new screen following existing patterns\`.
   - **standard** (full 8 stages — default fallback) — anything that introduces a new capability with architecture uncertainty, touches many modules, or has unclear scope.
     Triggers: \`new feature\`, \`refactor\`, \`migration\`, \`platform\`, \`architecture\`, \`schema\`, \`integrate\`, \`workflow\`, \`onboarding\`, or any prompt that does not match quick/medium confidently.
   - When triggers conflict, prefer **standard** over **medium**, and **medium** over **quick**.
7. Present the recommendation as a single decision with explicit options:
   > \`Recommended track: <quick|medium|standard>\` because \`<one-line reason citing matched triggers>\`.
   > Override? (A) keep \`<recommended>\`  (B) switch track  (C) cancel.
   If the harness's native ask tool is available (\`AskUserQuestion\` / \`AskQuestion\` / \`question\` / \`request_user_input\`), send exactly ONE question; on schema error, fall back to a plain-text lettered list.
8. Persist the chosen track to \`${flowPath}\` (\`track\` field). Compute \`skippedStages\` from the track and write that too. Use the **first stage of the chosen track** as \`currentStage\` (quick → \`spec\`, medium/standard → \`brainstorm\`, trivial fast-path → \`design\` or \`spec\` per Phase 0).
9. Write the prompt to \`.cclaw/artifacts/00-idea.md\` with the following header lines: \`Class:\` (from Phase 0), \`Track:\` (chosen track + matched heuristic), \`Stack:\` (from Phase 2 detection, or \`unknown\`), and a \`Discovered context\` section if Phase 1 found origin docs.
10. Load the **first-stage skill for the chosen track** and its command file:
    - quick → \`.cclaw/skills/specification-authoring/SKILL.md\` + \`.cclaw/commands/spec.md\`
    - medium/standard → \`.cclaw/skills/brainstorming/SKILL.md\` + \`.cclaw/commands/brainstorm.md\`
    - trivial fast-path → design or spec skill per Phase 0 decision.
11. Execute that stage with the prompt + Phase 1/Phase 2 context as initial input.

### Reclassification on discovery

If during any stage the agent discovers evidence that contradicts the initial Phase 0 / track decision (e.g. a supposedly \`trivial\` change turns out to require schema migration, a \`quick\` bug fix turns out to need design discussion, an origin doc reveals scope 3× larger than the prompt), STOP and re-classify:

1. Surface the new evidence in plain text.
2. Propose the updated \`Class\` + \`Track\` with a one-line reason.
3. Use the Decision Protocol to let the user accept, override, or cancel.
4. On acceptance: update \`00-idea.md\` with a \`Reclassification:\` entry (old → new, reason, ISO timestamp) and update \`flow-state.json\` accordingly — do NOT rewrite prior artifacts, they stay as history.

### Without prompt (\`/cc\`)

1. Read \`${flowPath}\`.
2. If flow state is missing → run \`cclaw init\` guidance and stop.
3. Behave exactly like \`/cc-next\`: check current stage gates, resume if incomplete, advance if complete.

## Headless mode

When called by another skill or subagent in machine mode, emit exactly one
JSON envelope (no prose) and stop:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"brainstorm","payload":{"command":"/cc","track":"standard","action":"start_or_resume"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`cclaw internal envelope-validate --stdin\`

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
description: "Unified entry point for the cclaw flow. No args = resume/next. With prompt = classify, pick track, start its first stage."
---

# /cc — Flow Entry Point

## Overview

\`/cc\` is the **starting command** for cclaw. It intelligently routes:

- **No arguments** → acts as \`/cc-next\` (resume current stage or advance to next)
- **With a prompt** → classifies the task, picks a track (quick/medium/standard), and starts the **first stage of that track** (not always brainstorm — e.g. the \`quick\` track starts at \`spec\`)

## HARD-GATE

Do **not** silently discard an existing flow when the user provides a prompt. If completed stages exist, inform and confirm before resetting.

## Protocol

### Path A: \`/cc <prompt>\`

1. **Task classification (Phase 0).** Decide whether the prompt is \`software-standard\`, \`software-trivial\`, \`software-bugfix\`, \`pure-question\`, or \`non-software\`. Non-software and pure-question exit immediately — answer directly, do not open a stage.
2. **Origin-document discovery (Phase 1).** Scan for \`docs/prd/**\`, \`docs/rfcs/**\`, \`docs/adr/**\`, \`docs/design/**\`, \`specs/**\`, root-level \`PRD.md\` / \`SPEC.md\` / \`DESIGN.md\` / \`REQUIREMENTS.md\`. Summarize any hits in \`00-idea.md\` under \`Discovered context\`. Surface conflicts with the prompt before routing.
3. **Stack detection (Phase 2).** Inspect \`package.json\` engines, \`pyproject.toml\`, \`go.mod\`, \`Cargo.toml\`, \`pom.xml\`, \`build.gradle*\`, \`Dockerfile\`, \`docker-compose*.yml\`, and CI configs. Record stack + versions on the \`Stack:\` line. Do not invent stack details.
4. Read \`${flowPath}\`.
5. If \`completedStages\` is non-empty:
   - Inform: "You have an active flow at stage **{currentStage}** with {N} completed stages. Starting a new tracked flow will reset progress."
   - Ask: "Continue with reset? (A) Yes, start fresh (B) No, resume current flow"
   - If (B) → switch to Path B behavior.
6. **Classify the idea** using the heuristic below and present a single track recommendation. Wait for explicit confirmation or override before mutating any state.
   - If \`${RUNTIME_ROOT}/config.yaml\` defines \`trackHeuristics\`, apply those vocabulary hints (\`fallback\`, \`tracks.<id>.{triggers,veto}\`) on top of built-in defaults. Evaluation order is fixed: \`standard -> medium -> quick\`. (Honest note: this is advisory prose; the LLM applies it, not a Node-level router.)

   **Track heuristic** (lowercase substring match against the user prompt):

   | Track | Triggers | Use when |
   |---|---|---|
   | \`quick\` | \`bug\`, \`bugfix\`, \`fix\`, \`hotfix\`, \`patch\`, \`typo\`, \`regression\`, \`rename\`, \`bump\`, \`upgrade dep\`, \`docs only\`, \`comment\`, \`lint\`, \`format\`, \`small\`, \`tiny\`, \`one-liner\`, \`revert\`, \`copy change\` | Single-purpose, spec is essentially known, low blast radius |
   | \`medium\` | \`add endpoint\`, \`add field\`, \`extend existing\`, \`wire integration\`, \`small migration\`, \`new screen following existing pattern\` | Additive work with existing architecture |
   | \`standard\` | \`new feature\`, \`refactor\`, \`migration\`, \`platform\`, \`architecture\`, \`schema\`, \`integrate\`, \`workflow\`, \`onboarding\` (or no confident quick/medium match) | New or uncertain multi-module work |

   - On conflict, prefer \`standard\` over \`medium\`, and \`medium\` over \`quick\`.
   - Always state the recommendation as a one-line reason citing matched triggers.
7. Persist the chosen track in \`${flowPath}\` (\`track\` + \`skippedStages\`). Set \`currentStage\` to the first stage of the chosen track (\`quick\` → \`spec\`, \`medium\`/ \`standard\` → \`brainstorm\`, trivial fast-path → \`design\` or \`spec\`). Reset gate catalog.
8. Write \`${RUNTIME_ROOT}/artifacts/00-idea.md\` with the user's prompt plus header lines: \`Class:\`, \`Track:\`, \`Stack:\`, and a \`Discovered context\` section from Phase 1.
9. Load and execute the **first stage skill of the chosen track** (\`brainstorming\` for medium/standard, \`specification-authoring\` for quick) plus its matching command file.

### Reclassification on discovery

If mid-stage evidence contradicts the initial Class/Track decision (the "trivial" change needs a migration, the "quick" bug fix needs architecture work, an origin doc multiplies scope), STOP and re-classify using the Decision Protocol. Record \`Reclassification:\` in \`00-idea.md\` with old/new class and a one-line reason. Do NOT rewrite prior artifacts — they stay as history.

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

Both commands read the same \`flow-state.json\`. The difference is that \`/cc <prompt>\` resolves class + track and starts that track's first stage, while \`/cc\` and \`/cc-next\` follow the current state.
`;
}
