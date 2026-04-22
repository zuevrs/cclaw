import { RUNTIME_ROOT } from "../constants.js";

/**
 * Relative path used by skills/commands to cite the consolidated flow map.
 * Stable contract — changing this value is a breaking change for doctor
 * policies and meta-skill links.
 */
export const FLOW_MAP_REL_PATH = `${RUNTIME_ROOT}/references/flow-map.md`;

/**
 * Canonical one-page overview of cclaw's user-facing surface.
 *
 * Purpose: give the model (and any curious human) a single file that
 * answers "what does cclaw expose, where does my current stage fit, and
 * which files drive progress?" without forcing a walk of the 8 stage
 * skills plus the 4 router skills plus the meta-skill.
 *
 * Design rules:
 * - Keep it under ~150 lines; it is a map, not a manual.
 * - Only cite files that already exist under `.cclaw/`.
 * - Do not duplicate protocol text (decision/completion/ethos live in
 *   `.cclaw/references/protocols/`). Link, don't inline.
 * - Do not introduce new gates or hard rules here — flow-map is
 *   descriptive, not prescriptive.
 */
export function flowMapMarkdown(): string {
  return `# cclaw Flow Map

One-page surface reference. Use this when you need the shape of cclaw
without reading every skill — the stage quick-map, the user-facing
slash commands, the Ralph Loop signal, and the key state files.

For enforcement details, load the matching stage skill or command
contract. For protocols (decision/completion/ethos) see
\`${RUNTIME_ROOT}/references/protocols/\`.

## Stages (8)

| # | Stage | Goal | Primary artifact |
|---|---|---|---|
| 1 | brainstorm | Explore options and constraints | \`.cclaw/artifacts/00-idea.md\` (+ \`01-brainstorm.md\`) |
| 2 | scope | Freeze scope (in/out, assumptions) | \`.cclaw/artifacts/02-scope.md\` |
| 3 | design | Pick the shape of the change | \`.cclaw/artifacts/03-design.md\` |
| 4 | spec | Turn design into testable acceptance criteria | \`.cclaw/artifacts/04-spec.md\` |
| 5 | plan | Decompose spec into executable slices | \`.cclaw/artifacts/05-plan.md\` |
| 6 | tdd | Drive each slice through RED → GREEN → REFACTOR (Ralph Loop) | \`.cclaw/artifacts/06-tdd.md\` + \`.cclaw/state/tdd-cycle-log.jsonl\` |
| 7 | review | Cross-check correctness, spec coverage, and ethos | \`.cclaw/artifacts/07-review.md\` |
| 8 | ship | Close out: retro, compound, archive | \`.cclaw/artifacts/08-ship.md\` (+ \`09-retro.md\`) |

Track shortcuts (set in \`.cclaw/state/flow-state.json\`):

- \`quick\` — spec → tdd → review → ship
- \`medium\` — brainstorm → spec → plan → tdd → review → ship
- \`standard\` — all 8 stages (default)

## User-facing slash commands

| Command | Role | Notes |
|---|---|---|
| \`/cc\` | Entry point. No args = resume. With prompt = classify + start. | Writes \`00-idea.md\` and picks the track. |
| \`/cc-next\` | Advance or resume the current stage based on gates. | Soft nudge from Ralph Loop during \`tdd\`. |
| \`/cc-ideate\` | Repo-improvement discovery, separate from product flow. | Produces ideas, not stage artifacts. |
| \`/cc-view [status\\|tree\\|diff]\` | Read-only router. Never mutates flow state. | \`diff\` refreshes the snapshot baseline by design. |
| \`/cc-ops [feature\\|tdd-log\\|retro\\|compound\\|archive\\|rewind]\` | Operations router for post-flow and side-channel actions. | Mutations are scoped to each subcommand. |

Subcommand dispatch lives in \`${RUNTIME_ROOT}/commands/\` and the
matching \`${RUNTIME_ROOT}/skills/flow-*/SKILL.md\`. The meta-skill
(\`${RUNTIME_ROOT}/skills/using-cclaw/SKILL.md\`) decides which router to
use before any substantive work.

## Ralph Loop (TDD progress signal)

When \`currentStage === "tdd"\`, SessionStart writes
\`${RUNTIME_ROOT}/state/ralph-loop.json\` from the TDD cycle log. Fields
worth acting on:

- \`loopIteration\` — how many RED → GREEN cycles already landed.
- \`redOpenSlices\` — slices with an unsatisfied RED. Non-empty means do
  **not** advance to review.
- \`acClosed\` — distinct acceptance-criterion IDs closed by a GREEN row
  (requires \`acIds\` on the green log entry via \`/cc-ops tdd-log\`).
- \`sliceCount\` — total distinct plan slices ever touched.

Ralph Loop is a signal, not a gate. Stage advancement still runs
through the normal \`flow-state.json\` gate catalog.

## Compound readiness (auto-promotion signal)

SessionStart also refreshes
\`${RUNTIME_ROOT}/state/compound-readiness.json\` from \`knowledge.jsonl\`.
The file lists clusters whose summed \`frequency\` reaches
\`compound.recurrenceThreshold\` (default 3) or whose severity is
\`critical\` (override). It surfaces a one-line nudge in the session
digest only during \`review\` and \`ship\`, where lift-to-rule is in
scope; earlier stages refresh the file silently. Promotion itself stays
manual via \`/cc-ops compound\` so the signal never blocks flow.

## Key state files

| Path | What it holds |
|---|---|
| \`${RUNTIME_ROOT}/state/flow-state.json\` | Track, currentStage, completedStages, gate catalog, closeout substate. |
| \`${RUNTIME_ROOT}/state/delegation-log.json\` | Per-stage mandatory agent status + fulfillmentMode + evidenceRefs. |
| \`${RUNTIME_ROOT}/state/tdd-cycle-log.jsonl\` | Append-only RED/GREEN/REFACTOR entries (source of Ralph Loop). |
| \`${RUNTIME_ROOT}/state/ralph-loop.json\` | Derived Ralph Loop status (TDD-only). |
| \`${RUNTIME_ROOT}/state/compound-readiness.json\` | Derived compound-promotion readiness (refreshed each SessionStart). |
| \`${RUNTIME_ROOT}/state/stage-activity.jsonl\` | Append-only stage-enter/exit and gate-pass signals. |
| \`${RUNTIME_ROOT}/state/checkpoint.json\` | Latest session checkpoint (stage + timestamp). |
| \`${RUNTIME_ROOT}/state/context-mode.json\` | Active context mode (\`default\`, \`headless\`, ...). |
| \`${RUNTIME_ROOT}/state/harness-gaps.json\` | Per-harness tier, subagent fallback, playbook path (schemaVersion 2). |
| \`${RUNTIME_ROOT}/knowledge.jsonl\` | Append-only learnings; surfaced to sessions via digest. |

## Strictness and hooks

Hook-driven guards respect the \`strictness\` field in
\`${RUNTIME_ROOT}/config.yaml\`:

- \`advisory\` (default) — hooks warn but never block tool calls.
- \`strict\` — hooks block tool calls that violate their scope.

Override per-session with \`CCLAW_STRICTNESS=advisory|strict\`.

Hook wiring itself comes from a **single manifest** (\`src/content/hook-manifest.ts\`):
the per-harness documents at \`.claude/hooks/hooks.json\`, \`.cursor/hooks.json\`,
\`.codex/hooks.json\` are all derived from it. Inspect the live bindings with
\`cclaw internal hook-manifest\` (add \`--json\` for machine-readable output).

## When in doubt

1. Read \`${RUNTIME_ROOT}/state/flow-state.json\` to know where you are.
2. Load the matching stage skill only if you are about to do
   substantive work (see \`using-cclaw\` meta-skill).
3. Prefer \`/cc-next\` for progression. \`/cc-view\` for visibility.
   \`/cc-ops\` for side-channel operations.
`;
}
