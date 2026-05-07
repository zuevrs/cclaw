# Example AGENTS.md routing block (v8)

`cclaw init` / `cclaw sync` writes the following routing block into the project's `AGENTS.md` (or harness equivalent). The generated block in a real project is authoritative; this file exists so readers can see what the harness will read.

## Instruction priority

1. User message in the current turn.
2. Active `plan.md` for the current slug, including AC frontmatter.
3. The `/cc` orchestrator markdown.
4. Iron Laws (Karpathy four principles).
5. Specialist markdown for whichever specialist is currently invoked.
6. Training priors.

## Commands

| Command | Purpose |
| --- | --- |
| `/cc <task>` | Entry point. Routes trivial / small-medium / large-risky and runs plan / build / review / ship. |
| `/cc-cancel` | Stop the active run. Moves active artifacts to `.cclaw/cancelled/<slug>/`. |
| `/cc-idea` | Append a one-paragraph entry to `.cclaw/ideas.md`. Does **not** create a slug or modify flow-state. |

## Stage order

`plan → build → review → ship`. After ship, compound runs automatically and active artifacts move to `.cclaw/shipped/<slug>/`.

The mandatory gate is **AC traceability**: ship is blocked unless every AC in flow-state has a real commit SHA. The orchestrator uses `.cclaw/hooks/commit-helper.mjs` to enforce this atomically per AC.

## Specialists (on demand only)

`brainstormer` / `architect` / `planner` for discovery; `reviewer` / `security-reviewer` for review; `slice-builder` for build and post-review fixes. The orchestrator proposes them only for large/risky tasks; small tasks run inline.
