import { RUNTIME_ROOT } from "../constants.js";

import { conversationLanguagePolicyMarkdown } from "./language-policy.js";
const START_SKILL_FOLDER = "flow-start";
const START_SKILL_NAME = "flow-start";

function flowStatePath(): string {
  return `${RUNTIME_ROOT}/state/flow-state.json`;
}

/**
 * Command contract for /cc — the unified entry point.
 * No args → reads existing flow state and progresses it when a tracked flow
 * already exists; missing state/fresh placeholder state blocks with
 * init/start guidance. With prompt → classifies the idea, selects a track, and
 * starts the first stage of that track (brainstorm for medium/standard, spec for quick).
 */
export function startCommandContract(): string {
  const flowPath = flowStatePath();
  return `# /cc

## Purpose

**The unified entry point for the cclaw flow.**

- \`/cc\` (no arguments) → reads existing flow state and resumes/progresses the active flow. If flow state is missing or still a fresh init placeholder, stop and guide the user to run \`/cc <prompt>\` or \`cclaw init\`; do not silently create a brainstorm run.
- \`/cc <prompt>\` (with an idea/description) → saves the prompt as idea context and starts the first stage of the resolved track.

This is the **recommended way to start, resume, and continue** working with cclaw.

## HARD-GATE

${conversationLanguagePolicyMarkdown()}
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
   | **trivial** | typo, one-liner, rename, config tweak, copy change, version bump with zero behavior change | Fast-path: set track to \`quick\`, seed \`00-idea.md\`, and enter \`spec\`. Runtime quick never starts at design. |
   | **software — bug fix with repro** | regression / hotfix / named symptom + repro steps | Fast-path: set track to \`quick\`, enter \`spec\`, and capture a reproduction contract first. TDD later writes the RED reproduction test from that contract. |
   | **software — medium** | additive feature following existing architecture | medium track (\`brainstorm → spec → plan → tdd → review → ship\`). |
   | **software — standard** | feature, refactor, migration, integration, architecture change | Full 8-stage flow starting at \`brainstorm\`. |

   Record the chosen class in \`.cclaw/artifacts/00-idea.md\` on the \`Class:\` line. Do NOT silently treat a non-software task as software.

2. **Phase 0.5 — Seed shelf recall.** Before routing, scan \`${RUNTIME_ROOT}/seeds/SEED-*.md\` and match each seed's \`trigger_when\` tokens against the prompt text (substring match is enough). If any match:
   - Surface up to 3 matches (file + title + one-line action) as \`Seed recalls\`.
   - Ask whether to apply now, keep as reference, or ignore for this run.
   - If applied/reference, append selected seeds to \`00-idea.md\` under \`Discovered context\` so downstream stages keep the trace.

3. **Phase 1 — Origin-document discovery.** Before asking the user for context, scan for existing requirements/plan artifacts and merge them into initial context:
   - \`.cclaw/artifacts/00-idea.md\` if it already exists (resumed flow).
   - Common origin locations: \`docs/prd/**\`, \`docs/rfcs/**\`, \`docs/adr/**\`, \`docs/design/**\`, \`specs/**\`, \`prd/**\`, \`rfc/**\`, \`design/**\`, root-level \`PRD.md\` / \`SPEC.md\` / \`DESIGN.md\` / \`REQUIREMENTS.md\` / \`ROADMAP.md\`.
   - Summarize each discovered doc in \`00-idea.md\` under a \`Discovered context\` section with path + 1-line summary.
   - If an origin doc contradicts the prompt, surface the conflict to the user before routing.

4. **Phase 2 — Tech-stack + version detection.** Sniff the repo for stack + language versions and record under \`Stack:\`:
   - Node: \`package.json\` \`engines\` / \`volta\` / \`packageManager\` / \`devDependencies\`.
   - Python: \`pyproject.toml\` / \`requirements*.txt\` / \`.python-version\`.
   - Go: \`go.mod\` (module + Go version).
   - Rust: \`Cargo.toml\` (\`[package]\` + \`rust-version\`).
   - Java/Kotlin: \`pom.xml\` / \`build.gradle*\` + toolchain version.
   - Containers: \`Dockerfile\`, \`docker-compose*.yml\`.
   - CI: \`.github/workflows\`, \`.gitlab-ci.yml\`.
   Skip detection quietly if no markers are found — do NOT invent a stack.

5. Read \`${flowPath}\`.
6. If flow already has completed stages, warn the user that starting a new tracked flow will reset progress. Ask for confirmation before proceeding. A fresh init placeholder state with \`completedStages: []\`, no passed gates, and no \`00-idea.md\` is **not** an active flow; do not ask the user to resume it.
7. **Track heuristic** — classify the idea text and **recommend** a track (the user can override before any state mutation):
   - First, load \`${RUNTIME_ROOT}/config.yaml\`. If \`trackHeuristics\` is defined, apply those per-track vocabulary hints (\`fallback\`, \`tracks.<id>.{triggers,veto}\`) on top of the built-in defaults. Evaluation order is always \`standard -> medium -> quick\` (narrow-to-broad).
   - **quick** (\`spec → tdd → review → ship\`) — single-purpose work where the spec is essentially already known. Quick skips ceremony, not safety: spec approval, TDD evidence, review, and ship gates remain mandatory.
     Triggers (case-insensitive substring or close variant): \`bug\`, \`bugfix\`, \`fix\`, \`hotfix\`, \`patch\`, \`typo\`, \`regression\`, \`copy change\`, \`rename\`, \`bump\`, \`upgrade dep\`, \`config tweak\`, \`docs only\`, \`comment\`, \`lint\`, \`format\`, \`small\`, \`tiny\`, \`one-liner\`, \`revert\`.
   - **medium** (\`brainstorm → spec → plan → tdd → review → ship\`) — additive work that fits existing architecture and still needs product framing.
     Triggers: \`add endpoint\`, \`add field\`, \`extend existing\`, \`wire integration\`, \`small migration\`, \`new screen following existing patterns\`.
   - **standard** (full 8 stages — default fallback) — anything that introduces a new capability with architecture uncertainty, touches many modules, or has unclear scope.
     Triggers: \`new feature\`, \`refactor\`, \`migration\`, \`platform\`, \`architecture\`, \`schema\`, \`integrate\`, \`workflow\`, \`onboarding\`, or any prompt that does not match quick/medium confidently.
   - When triggers conflict, prefer **standard** over **medium**, and **medium** over **quick**.
   - Report **track selection confidence** as high/medium/low with the matched trigger or fallback reason, plus one sentence explaining what the selected track skips and what safety gates remain. Be explicit that this recommendation is advisory until the user accepts and the managed helper writes state; after that, \`/cc\` follows the configured track.
8. Present one compact **Start framing** summary: class, recommended track, track selection confidence, stack, origin docs, seed recalls, and the recommended next action. Ask a single confirmation question only when there is a destructive reset, a real contradiction, or ambiguous software/non-software classification.
9. Present the recommendation as a single decision with explicit options:
   > \`Recommended track: <quick|medium|standard>\` because \`<one-line reason citing matched triggers>\`.
   > \`Safety retained: <spec/TDD/review/ship gates that still apply>\`.
   > Override? (A) keep \`<recommended>\`  (B) switch track with reason  (C) cancel.
   If the harness's native ask tool is available (\`AskUserQuestion\` / \`AskQuestion\` / \`question\` / \`request_user_input\`), send exactly ONE question; on schema error, fall back to a plain-text lettered list.
10. Start the tracked flow only through the managed helper:
   \`node .cclaw/hooks/start-flow.mjs --track=<quick|medium|standard> --class=<class> --prompt=<prompt> --stack=<stack> --reason=<matched heuristic>\`
   If this helper fails, STOP and report the exact command/output. Do **not** manually edit \`${flowPath}\`.
11. The helper persists \`${flowPath}\`, computes \`skippedStages\`, sets the first stage for the track, resets the gate catalog, and writes \`.cclaw/artifacts/00-idea.md\`.
12. Load the **first-stage skill for the chosen track** and its command file:
    - quick → \`.cclaw/skills/spec/SKILL.md\`
    - medium/standard → \`.cclaw/skills/brainstorm/SKILL.md\`
    - trivial fast-path → quick track spec skill per Phase 0 decision.
13. Execute that stage with the prompt + Phase 1/Phase 2 + seed context as initial input.

### Reclassification on discovery

If during any stage the agent discovers evidence that contradicts the initial Phase 0 / track decision (e.g. a supposedly \`trivial\` change turns out to require schema migration, a \`quick\` bug fix turns out to need design discussion, an origin doc reveals scope 3× larger than the prompt), STOP and re-classify:

1. Surface the new evidence in plain text.
2. Propose the updated \`Class\` + \`Track\` with a one-line reason.
3. Use the Decision Protocol to let the user accept, override, or cancel.
4. On acceptance: run \`node .cclaw/hooks/start-flow.mjs --reclassify --track=<new-track> --class=<new-class> --reason=<why>\`. The helper appends a \`Reclassification:\` entry to \`00-idea.md\` and updates flow state atomically. If it fails, STOP and report the exact output; do NOT manually edit \`flow-state.json\`.

### Without prompt (\`/cc\`)

1. Read \`${flowPath}\`.
2. If flow state is missing → guide the user to run \`cclaw init\` and stop.
3. If flow state is only a fresh init placeholder (\`completedStages: []\`, all \`passed\` arrays empty, and no \`00-idea.md\`) → stop and ask for \`/cc <prompt>\` to start a tracked run. Do not create a brainstorm state implicitly.
4. Otherwise check current stage gates, resume if incomplete, and advance if complete.

## Headless mode

When called by another skill or subagent in machine mode, emit exactly one
JSON envelope (no prose) and stop:

\`\`\`json
{"version":"1","kind":"stage-output","stage":"<currentStage>","payload":{"command":"/cc","track":"<track>","action":"start_or_resume"},"emittedAt":"<ISO-8601>"}
\`\`\`

Validate envelopes with:
\`cclaw internal envelope-validate --stdin\`

## Primary skill

**${RUNTIME_ROOT}/skills/${START_SKILL_FOLDER}/SKILL.md**

## Surface reference

Use the start skill plus \`.cclaw/state/flow-state.json\` for orientation before \`/cc <prompt>\` runs.
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

- **No arguments** → resumes or progresses an existing tracked flow; missing/fresh placeholder state blocks with start guidance
- **With a prompt** → classifies the task, picks a track (quick/medium/standard), and starts the **first stage of that track** (not always brainstorm — e.g. the \`quick\` track starts at \`spec\`)

## HARD-GATE

Do **not** silently discard an existing flow when the user provides a prompt. If completed stages exist, inform and confirm before resetting. A freshly initialized placeholder state with \`completedStages: []\`, no passed gates, and no \`${RUNTIME_ROOT}/artifacts/00-idea.md\` is not an active flow; classify the prompt and start normally.

${conversationLanguagePolicyMarkdown()}
## Protocol

### Path A: \`/cc <prompt>\`

1. **Task classification (Phase 0).** Decide whether the prompt is \`software-standard\`, \`software-trivial\`, \`software-bugfix\`, \`pure-question\`, or \`non-software\`. Non-software and pure-question exit immediately — answer directly, do not open a stage. Bugfixes with a clear repro still start on quick \`spec\`: capture the reproduction contract first, then TDD writes the RED reproduction test from that contract.
2. **Seed shelf recall (Phase 0.5).** Scan \`${RUNTIME_ROOT}/seeds/SEED-*.md\` and match \`trigger_when\` tokens against the prompt text. Surface up to 3 matching seeds with file/title/action and ask whether to apply or ignore. When applied, add them to \`00-idea.md\` under \`Discovered context\`.
3. **Origin-document discovery (Phase 1).** Scan for \`docs/prd/**\`, \`docs/rfcs/**\`, \`docs/adr/**\`, \`docs/design/**\`, \`specs/**\`, root-level \`PRD.md\` / \`SPEC.md\` / \`DESIGN.md\` / \`REQUIREMENTS.md\`. Summarize any hits in \`00-idea.md\` under \`Discovered context\`. Surface conflicts with the prompt before routing.
4. **Stack detection (Phase 2).** Inspect \`package.json\` engines, \`pyproject.toml\`, \`go.mod\`, \`Cargo.toml\`, \`pom.xml\`, \`build.gradle*\`, \`Dockerfile\`, \`docker-compose*.yml\`, and CI configs. Record stack + versions on the \`Stack:\` line. Do not invent stack details.
5. Read \`${flowPath}\`.
6. If \`completedStages\` is non-empty:
   - Inform: "You have an active flow at stage **{currentStage}** with {N} completed stages. Starting a new tracked flow will reset progress."
   - Ask: "Continue with reset? (A) Yes, start fresh (B) No, resume current flow"
   - If (B) → switch to Path B behavior.
   If \`completedStages\` is empty, all gate \`passed\` arrays are empty, and \`${RUNTIME_ROOT}/artifacts/00-idea.md\` is missing, treat it as a fresh init placeholder — do **not** ask whether to continue the current flow.
7. **Classify the idea** using the heuristic below and present one compact Start framing summary (class, track, stack, origin docs, seed recalls, next action). Wait for explicit confirmation or override before mutating any state only when reset/conflict/ambiguity makes it necessary.
   - If \`${RUNTIME_ROOT}/config.yaml\` defines \`trackHeuristics\`, apply those vocabulary hints (\`fallback\`, \`tracks.<id>.{triggers,veto}\`) on top of built-in defaults. Evaluation order is fixed: \`standard -> medium -> quick\`. (Honest note: this is advisory prose; the LLM applies it, not a Node-level router.)

   **Track heuristic** (lowercase substring match against the user prompt):

   | Track | Triggers | Use when |
   |---|---|---|
   | \`quick\` | \`bug\`, \`bugfix\`, \`fix\`, \`hotfix\`, \`patch\`, \`typo\`, \`regression\`, \`rename\`, \`bump\`, \`upgrade dep\`, \`docs only\`, \`comment\`, \`lint\`, \`format\`, \`small\`, \`tiny\`, \`one-liner\`, \`revert\`, \`copy change\` | Single-purpose, spec is essentially known, low blast radius; skips ceremony, not safety |
   | \`medium\` | \`add endpoint\`, \`add field\`, \`extend existing\`, \`wire integration\`, \`small migration\`, \`new screen following existing pattern\` | Additive work with existing architecture |
   | \`standard\` | \`new feature\`, \`refactor\`, \`migration\`, \`platform\`, \`architecture\`, \`schema\`, \`integrate\`, \`workflow\`, \`onboarding\` (or no confident quick/medium match) | New or uncertain multi-module work |

   - On conflict, prefer \`standard\` over \`medium\`, and \`medium\` over \`quick\`.
   - Always state the recommendation as a one-line reason citing matched triggers and a high/medium/low track selection confidence. Clarify that the heuristic is advisory until the managed helper writes state; after that, \`/cc\` follows the selected track. Include override guidance: switch to standard when architecture, schema, migration, security, or unclear scope appears; switch to medium when product framing is needed but architecture is known.
8. Run the managed start helper: \`node .cclaw/hooks/start-flow.mjs --track=<quick|medium|standard> --class=<class> --prompt=<prompt> --stack=<stack> --reason=<matched heuristic>\`. The helper writes \`${flowPath}\`, computes \`skippedStages\`, resets the gate catalog, and writes \`${RUNTIME_ROOT}/artifacts/00-idea.md\`. If it fails, STOP and report the exact command/output; do not manually edit flow state.
9. Load and execute the **first stage skill of the chosen track** (\`brainstorm\` for medium/standard, \`spec\` for quick) plus its matching command file.

### Reclassification on discovery

If mid-stage evidence contradicts the initial Class/Track decision (the "trivial" change needs a migration, the "quick" bug fix needs architecture work, an origin doc multiplies scope), STOP and re-classify using the Decision Protocol. On acceptance, run \`node .cclaw/hooks/start-flow.mjs --reclassify --track=<new-track> --class=<new-class> --reason=<why>\`; the helper records \`Reclassification:\` in \`00-idea.md\` and updates state atomically. Do NOT rewrite prior artifacts or manually edit flow-state.

### Path B: \`/cc\` (no arguments)

Progress the tracked flow only when one exists:

1. Read \`${flowPath}\`.
2. If missing, guide the user to run \`cclaw init\` and stop.
3. If it is only a fresh init placeholder (\`completedStages: []\`, no passed gates, and no \`${RUNTIME_ROOT}/artifacts/00-idea.md\`), stop and ask for \`/cc <prompt>\` to start a tracked run. Do not silently create a brainstorm run.
4. Check gates for \`currentStage\`.
5. If incomplete → load current stage skill and execute.
6. If complete → advance to next stage and execute.
7. If flow is done → report completion.

## Public flow habit

Use \`/cc\` for the happy path:

| Scenario | Command |
|---|---|
| Starting work for the first time | \`/cc\` or \`/cc <idea>\` |
| Resuming in a new session | \`/cc\` |
| Progressing after completing a stage | \`/cc\` |
| Starting with a specific idea | \`/cc <idea>\` |

\`/cc <prompt>\` resolves class + track and starts that track's first stage; \`/cc\` without a prompt follows the current \`flow-state.json\`.
`;
}
