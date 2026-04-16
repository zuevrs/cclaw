# Harness Integration Matrix

`cclaw` is installer-first: the CLI bootstraps a stage-based workflow, generates
artifact templates, skills, and subagent definitions, then wires itself into the
coding harnesses the project uses. This document is the authoritative map of
what cclaw installs, where, and how every supported harness is expected to
behave once the shim files are in place.

> **Harness IDs** are passed via `cclaw init --harnesses=<list>` (comma-separated).
> Valid IDs: `claude`, `cursor`, `opencode`, `codex`. Omit the flag to install
> shims for all four.

## TL;DR

| Harness       | Entry command (stage 0) | Stage progression | Hooks surface            | Plugin / rule surface                  | Delegation model              |
| ------------- | ----------------------- | ----------------- | ------------------------ | -------------------------------------- | ----------------------------- |
| Claude Code   | `/cc`                   | `/cc-next`        | `.claude/hooks/hooks.json` | `.claude/commands/cc*.md`              | Task tool + agent personas    |
| Cursor IDE    | `/cc`                   | `/cc-next`        | `.cursor/hooks.json`       | `.cursor/rules/cclaw-workflow.mdc`, `.cursor/commands/cc*.md` | Task tool + agent personas    |
| OpenCode      | `/cc`                   | `/cc-next`        | —                        | `.opencode/plugins/cclaw-plugin.mjs`, `.opencode/commands/cc*.md`, `opencode.json#plugin` | Plugin + agent personas       |
| OpenAI Codex  | `/cc`                   | `/cc-next`        | `.codex/hooks.json`        | `.codex/commands/cc*.md`              | Task tool (where available)   |

Every harness receives the same three utility commands (`cc`, `cc-next`,
`cc-learn`) and the same AGENTS.md managed block so agents discover the flow
from a single source of truth.

## Installation surfaces

When `cclaw init` runs it writes the following files, grouped by ownership.

### Shared (always written regardless of harness selection)

| Path                                   | Purpose                                                   |
| -------------------------------------- | --------------------------------------------------------- |
| `.cclaw/state/flow-state.json`         | Current stage, completed stages, gate catalog, evidence.  |
| `.cclaw/state/delegation-log.json`     | Ledger of specialist agent dispatches per run.            |
| `.cclaw/state/stage-activity.jsonl`    | Append-only record of stage transitions and guard events. |
| `.cclaw/state/checkpoint.json`         | Periodic progress checkpoints for resume.                 |
| `.cclaw/state/suggestion-memory.json`  | Opt-out persistence for proactive suggestions.            |
| `.cclaw/state/context-mode.json`       | Active context-mode (normal / review / ship).             |
| `.cclaw/artifacts/`                    | Stage artifacts (`01-brainstorm.md` … `08-ship.md`).      |
| `.cclaw/runs/`                         | Archived runs with manifest and state snapshot.           |
| `.cclaw/skills/`                       | Stage and utility SKILL.md files consumed by harnesses.   |
| `.cclaw/agents/`                       | Subagent persona definitions (planner, code-reviewer, …). |
| `.cclaw/hooks/workflow-guard.sh`       | Harness-agnostic guard script invoked by hook shims.      |
| `AGENTS.md` (managed block)            | `<!-- cclaw-start -->`…`<!-- cclaw-end -->` activation block. |

### Per-harness shims

`cclaw init --harnesses=<list>` selects which of these are generated. Repeat
installs or `cclaw sync` regenerate them without touching user-authored files.

#### Claude Code (`claude`)

- `.claude/commands/cc.md`
- `.claude/commands/cc-next.md`
- `.claude/commands/cc-learn.md`
- `.claude/hooks/hooks.json` — wires the workflow guard into `SessionStart`,
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse` lifecycle events.

#### Cursor IDE (`cursor`)

- `.cursor/commands/cc.md`, `cc-next.md`, `cc-learn.md`
- `.cursor/rules/cclaw-workflow.mdc` — persistent workspace rule pointing the
  Cursor agent at `.cclaw/skills/`.
- `.cursor/hooks.json` — hook wiring equivalent to the Claude Code surface,
  adapted to Cursor's hook schema.

#### OpenCode (`opencode`)

- `.opencode/commands/cc.md`, `cc-next.md`, `cc-learn.md`
- `.opencode/plugins/cclaw-plugin.mjs` — OpenCode plugin that exposes the
  workflow to OpenCode's slash-command and tool surfaces.
- `opencode.json` (or `.jsonc`, or `.opencode/opencode.json(c)`) is patched to
  include the plugin path in its `plugin` array. `cclaw uninstall` removes the
  entry and deletes the file if nothing else remains.

#### OpenAI Codex (`codex`)

- `.codex/commands/cc.md`, `cc-next.md`, `cc-learn.md`
- `.codex/hooks.json` — hook wiring using Codex's hook schema.

## Command contract (identical across harnesses)

All four harnesses expose exactly the same three utility commands:

| Slash         | Role           | Behavior                                                                 |
| ------------- | -------------- | ------------------------------------------------------------------------ |
| `/cc`         | Entry point   | No args resumes the current stage. With a prompt, starts `brainstorm`.    |
| `/cc-next`    | Progression   | Advances to the next stage once the current stage's gates pass.           |
| `/cc-learn`   | Cross-cutting | Captures or reviews project knowledge (`.cclaw/knowledge.md`).            |

Stage order is always: `brainstorm → scope → design → spec → plan → tdd → review → ship`.

## Feature matrix

Legend: ✅ full, 🟡 partial / harness-dependent, ❌ not supported.

### Core workflow

| Capability                                            | claude | cursor | opencode | codex |
| ----------------------------------------------------- | :----: | :----: | :------: | :---: |
| `/cc` resume & `/cc-next` progression                 |   ✅    |   ✅    |    ✅     |  ✅    |
| Managed AGENTS.md activation block                    |   ✅    |   ✅    |    ✅     |  ✅    |
| Stage skill markdown generation                       |   ✅    |   ✅    |    ✅     |  ✅    |
| Stage artifact templates                              |   ✅    |   ✅    |    ✅     |  ✅    |
| Flow-state persistence (`.cclaw/state/flow-state.json`) |  ✅    |   ✅    |    ✅     |  ✅    |
| Delegation ledger                                     |   ✅    |   ✅    |    ✅     |  ✅    |
| Archive + manifest (`cclaw archive`)                  |   ✅    |   ✅    |    ✅     |  ✅    |
| `cclaw doctor` health-checks                          |   ✅    |   ✅    |    ✅     |  ✅    |

### Hooks and lifecycle

| Capability                                  | claude | cursor | opencode | codex |
| ------------------------------------------- | :----: | :----: | :------: | :---: |
| `SessionStart` / session-resume hook        |   ✅    |   ✅    |    🟡*    |  ✅    |
| `UserPromptSubmit` / pre-prompt guard       |   ✅    |   ✅    |    🟡*    |  ✅    |
| `PreToolUse` / `PostToolUse` guard          |   ✅    |   ✅    |    🟡*    |  ✅    |
| Proactive suggestion / stage nudge          |   ✅    |   ✅    |    ✅     |  ✅    |
| Context-mode switcher (`normal/review/ship`) |   ✅    |   ✅    |    ✅     |  ✅    |

`*` OpenCode surfaces these behaviors through the plugin instead of a hooks.json
file; the effective capability is equivalent but the extension point differs.

### Delegation / subagents

| Capability                                                           | claude | cursor | opencode | codex |
| -------------------------------------------------------------------- | :----: | :----: | :------: | :---: |
| Subagent personas under `.cclaw/agents/`                             |   ✅    |   ✅    |    ✅     |  ✅    |
| Automatic dispatch of mandatory agents (`planner`, `test-author`, …) |   ✅    |   ✅    |    ✅     |  🟡    |
| `security-reviewer` mandatory during review                          |   ✅    |   ✅    |    ✅     |  ✅    |
| Delegation log enforcement by `cclaw doctor`                         |   ✅    |   ✅    |    ✅     |  ✅    |
| Native Task tool routing                                             |   ✅    |   ✅    |    🟡     |  🟡    |

`🟡` rows mean cclaw records the expected delegation in its ledger and the
harness's agent persona definitions, but native auto-dispatch depends on the
harness version. Where auto-dispatch is unavailable cclaw expects a
`status: "waived"` entry with `waiverReason: "harness_limitation"` so the
doctor check still passes.

## Lifecycle

### `cclaw init --harnesses=<list>`

1. Ensures `.cclaw/` directory tree and state files.
2. Generates stage skills, commands, and artifact templates.
3. Writes per-harness shim files (see tables above).
4. Patches `opencode.json`'s `plugin` array when `opencode` is selected.
5. Writes / refreshes the managed block in `AGENTS.md`.

### `cclaw sync`

Non-destructive regeneration of the same surfaces. Safe to run after a
`cclaw` version bump. User-authored files outside the cclaw-owned paths are
never touched.

### `cclaw doctor`

Verifies:

- required state files exist and parse,
- `activeRunId` and `currentStage` are set,
- required gates for the current stage have evidence (or `--reconcile-gates`
  recomputes them),
- mandatory delegations for the current stage are completed or explicitly
  waived,
- harness shim files exist when the corresponding harness is declared in state.

Exit code `0` on success, `2` on at least one failing check.

### `cclaw archive [--name=<feature>]`

Moves `.cclaw/artifacts/` into `.cclaw/runs/<date>-<slug>/artifacts/`, snapshots
the entire `.cclaw/state/` directory into `<archive>/state/`, writes an
`archive-manifest.json` (version 1) at the archive root, and resets the active
flow state back to `brainstorm`.

### `cclaw upgrade`

Refreshes every generated file under `.cclaw/`, commands, hooks, and the
AGENTS.md managed block. User artifacts are untouched.

### `cclaw uninstall`

Removes every file cclaw created (hooks, commands, plugin patch, managed
AGENTS.md block). If `AGENTS.md` has no remaining content after the block is
stripped, it is deleted.

## Known gaps and future work

| Area                                                         | Status | Tracking                                     |
| ------------------------------------------------------------ | :----: | -------------------------------------------- |
| Cross-session memory (long-term knowledge persistence)       |   🟡   | `cc-learn` captures per project, not per org |
| Native auto-dispatch on OpenCode and Codex Task tools        |   🟡   | Harness-side work                            |
| Streaming UI updates during long agent runs                  |   🟡   | Harness-side work                            |
| Per-harness test parity in the `init-sync-doctor` suite      |   ✅   | Covered by `tests/integration/init-sync-doctor.test.ts` |
| Mutation testing (`stryker`) across `src/`                   |   ⏳   | Roadmap                                     |

## See also

- `AGENTS.md` — managed activation block inside any repo that ran `cclaw init`.
- `.cclaw/skills/using-cclaw/SKILL.md` — detailed operating procedure for the
  active agent session.
- `src/harness-adapters.ts` — source of truth for per-harness shim paths.
- `src/install.ts` — end-to-end install / sync / uninstall orchestration.
