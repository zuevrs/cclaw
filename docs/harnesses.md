# Harness Integration Matrix

Generated from `src/harness-adapters.ts` capabilities and hook event mappings.

## Capability tiers

| Harness | ID | Tier | Native dispatch | Fallback | Hook surface | Structured ask |
|---|---|---|---|---|---|---|
| Claude Code | `claude` | `tier1` (full native automation) | full | native | full | AskUserQuestion |
| Cursor | `cursor` | `tier2` (partial automation with waivers) | generic | generic-dispatch | full | AskQuestion |
| OpenCode | `opencode` | `tier2` (partial automation with waivers) | partial | role-switch | plugin | question |
| OpenAI Codex | `codex` | `tier2` (partial automation with waivers) | none | role-switch | limited | request_user_input |

Fallback legend:

- `native` — first-class named subagent dispatch (Claude).
- `generic-dispatch` — generic Task dispatcher mapped to cclaw roles (Cursor).
- `role-switch` — in-session role announce + delegation-log entry with evidenceRefs (OpenCode, Codex).
- `waiver` — no parity path; reserved for harnesses that cannot role-switch (none shipped).

## Parallel research dispatch semantics

Design-stage research fleet uses the same parity model:

- **Claude / Cursor**: dispatch all four research lenses in one turn
  (stack, features, architecture, pitfalls) and synthesize into
  `.cclaw/artifacts/02a-research.md`.
- **OpenCode / Codex**: execute the same four lenses via sequential
  role-switch, each with explicit announce -> execute -> evidence trail.
  This preserves auditability when native parallel dispatch is unavailable.

## Semantic hook event coverage

| Event | Claude | Cursor | OpenCode | Codex |
|---|---|---|---|---|
| `session_rehydrate` | SessionStart matcher startup|resume|clear|compact | sessionStart/sessionResume/sessionClear/sessionCompact | plugin event handlers + transform rehydration | SessionStart matcher startup|resume |
| `pre_tool_prompt_guard` | PreToolUse -> prompt-guard | preToolUse -> prompt-guard | plugin tool.execute.before -> prompt-guard | PreToolUse matcher Bash -> prompt-guard (plus UserPromptSubmit for non-Bash prompts) |
| `pre_tool_workflow_guard` | PreToolUse -> workflow-guard | preToolUse -> workflow-guard | plugin tool.execute.before -> workflow-guard | PreToolUse matcher Bash -> workflow-guard (Bash-only) |
| `post_tool_context_monitor` | PostToolUse -> context-monitor | postToolUse -> context-monitor | plugin tool.execute.after -> context-monitor | PostToolUse matcher Bash -> context-monitor (Bash-only) |
| `stop_handoff` | Stop -> stop-handoff | stop -> stop-handoff | plugin session.idle -> stop-handoff | Stop -> stop-handoff |
| `precompact_compat` | PreCompact -> pre-compact | sessionCompact -> pre-compact | plugin session.compacted -> pre-compact | missing |

## Hook event casing

Hook keys are intentionally harness-native and must not be normalized:

| Harness | ID | Event key casing |
|---|---|---|
| Claude Code | `claude` | PascalCase (`SessionStart`, `PreToolUse`) |
| Cursor | `cursor` | camelCase (`sessionStart`, `preToolUse`) |
| OpenCode | `opencode` | camelCase (`sessionStart`, `preToolUse`) |
| OpenAI Codex | `codex` | PascalCase (`SessionStart`, `PreToolUse`) |

Use the exact event names from each harness schema. Treating all hooks as one
shared casing silently breaks generated wiring.

## Interpretation

- `tier1`: full native delegation + structured asks + full hook surface.
- `tier2`: usable flow with capability gaps; mandatory delegation can require waivers.
- Codex-specific ceiling: `PreToolUse` can only intercept `Bash`. Direct
  `Write`/`Edit` to `.cclaw/state/flow-state.json` cannot be hard-blocked
  at hook level, so the canonical path is
  `node .cclaw/hooks/stage-complete.mjs <stage>` plus the non-blocking
  `UserPromptSubmit` state nudge.
- In `strict` mode, Codex additionally runs `cclaw internal verify-current-state`
  on `UserPromptSubmit` as a fail-closed check (advisory mode remains non-blocking).

## Shared command contract

All harnesses receive the same utility commands:

- `/cc` - flow entry and resume
- `/cc-next` - stage progression and post-ship closeout
- `/cc-ideate` - ideate mode for ranked repo-improvement backlog
- `/cc-view` - read-only router for status/tree/diff

Read-only subcommands:
- `/cc-view status` - visual flow snapshot
- `/cc-view tree` - deep flow tree (stages, artifacts, stale markers)
- `/cc-view diff` - before/after flow-state diff map

Operational work is handled by `/cc-next` and the CLI (`cclaw archive`, `cclaw internal ...`) rather than a separate slash-command router. Normal post-ship closeout stays on `/cc-next`; `cclaw archive` is the explicit/manual archive path and the runtime used when closeout reaches `ready_to_archive`.

Critical-path stage order remains canonical:
`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship`

Every track then closes out through:
`retro -> compound -> archive`

## Stage -> skill folder mapping

| Stage | Skill folder |
|---|---|
| `brainstorm` | `brainstorming` |
| `scope` | `scope-shaping` |
| `design` | `engineering-design-lock` |
| `spec` | `specification-authoring` |
| `plan` | `planning-and-task-breakdown` |
| `tdd` | `test-driven-development` |
| `review` | `two-layer-review` |
| `ship` | `shipping-and-handoff` |

This map is generated from `src/constants.ts::STAGE_TO_SKILL_FOLDER` so
skill-path naming stays explicit and stable even when stage ids differ from
folder names.

## Install surfaces

Always generated:

- `.cclaw/commands/*.md`
- `.cclaw/skills/*/SKILL.md`
- `.cclaw/state/*.json|*.jsonl`
- `AGENTS.md` managed block

Harness-specific additions:

- `claude`: `.claude/commands/cc*.md`, `.claude/hooks/hooks.json`
- `cursor`: `.cursor/commands/cc*.md`, `.cursor/hooks.json`, `.cursor/rules/cclaw-workflow.mdc`
- `opencode`: `.opencode/commands/cc*.md`, `.opencode/plugins/cclaw-plugin.mjs`, opencode plugin registration (`permission.question: "allow"` + `OPENCODE_ENABLE_QUESTION_TOOL=1` so structured asks can route through ACP question tooling)
- `codex`: `.agents/skills/cc/SKILL.md`, `.agents/skills/cc-next/SKILL.md`, `.agents/skills/cc-ideate/SKILL.md`, `.agents/skills/cc-view/SKILL.md`, `.codex/hooks.json` (Codex CLI reads `.agents/skills/` for custom skills and consumes `.codex/hooks.json` on v0.114+ when `[features] codex_hooks = true` is set in `~/.codex/config.toml`. `.codex/commands/` and the legacy `.agents/skills/cclaw-cc*/` layout from v0.39.x are auto-cleaned on sync.)

## Runtime observability

- `cclaw doctor` validates shim, hook, and lifecycle surfaces against this capability model.
- `/cc-view status` and `/cc-view tree` surface the same harness tier/fallback facts from the generated runtime metadata.

