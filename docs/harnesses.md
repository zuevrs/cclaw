# Harness Integration Matrix

Generated from `src/harness-adapters.ts` capabilities and hook event mappings.

## Capability tiers

| Harness | ID | Tier | Native dispatch | Fallback | Hook surface | Structured ask | Playbook |
|---|---|---|---|---|---|---|---|
| Claude Code | `claude` | `tier1` (full native automation) | full | native | full | AskUserQuestion | `references/harnesses/claude-playbook.md` |
| Cursor | `cursor` | `tier2` (partial automation with waivers) | generic | generic-dispatch | full | AskQuestion | `references/harnesses/cursor-playbook.md` |
| OpenCode | `opencode` | `tier2` (partial automation with waivers) | partial | role-switch | plugin | plain-text | `references/harnesses/opencode-playbook.md` |
| OpenAI Codex | `codex` | `tier2` (partial automation with waivers) | none | role-switch | limited | plain-text | `references/harnesses/codex-playbook.md` |

Fallback legend:

- `native` — first-class named subagent dispatch (Claude).
- `generic-dispatch` — generic Task dispatcher mapped to cclaw roles (Cursor).
- `role-switch` — in-session role announce + delegation-log entry with evidenceRefs (OpenCode, Codex).
- `waiver` — no parity path; reserved for harnesses that cannot role-switch (none shipped).

## Semantic hook event coverage

| Event | Claude | Cursor | OpenCode | Codex |
|---|---|---|---|---|
| `session_rehydrate` | SessionStart matcher startup|resume|clear|compact | sessionStart/sessionResume/sessionClear/sessionCompact | plugin event handlers + transform rehydration | SessionStart matcher startup|resume |
| `pre_tool_prompt_guard` | PreToolUse -> prompt-guard.sh | preToolUse -> prompt-guard.sh | plugin tool.execute.before -> prompt-guard.sh | PreToolUse matcher Bash -> prompt-guard.sh (plus UserPromptSubmit for non-Bash prompts) |
| `pre_tool_workflow_guard` | PreToolUse -> workflow-guard.sh | preToolUse -> workflow-guard.sh | plugin tool.execute.before -> workflow-guard.sh | PreToolUse matcher Bash -> workflow-guard.sh (Bash-only) |
| `post_tool_context_monitor` | PostToolUse -> context-monitor.sh | postToolUse -> context-monitor.sh | plugin tool.execute.after -> context-monitor.sh | PostToolUse matcher Bash -> context-monitor.sh (Bash-only) |
| `stop_checkpoint` | Stop -> stop-checkpoint.sh | stop -> stop-checkpoint.sh | plugin session.idle -> stop-checkpoint.sh | Stop -> stop-checkpoint.sh |
| `precompact_digest` | PreCompact -> pre-compact.sh | sessionCompact -> pre-compact.sh | plugin session.cleared/session.resumed hooks | missing |

## Interpretation

- `tier1`: full native delegation + structured asks + full hook surface.
- `tier2`: usable flow with capability gaps; mandatory delegation can require waivers.
- `tier3`: manual-only fallback; no native automation guarantees.

## Shared command contract

All harnesses receive the same utility commands:

- `/cc` - flow entry and resume
- `/cc-next` - stage progression
- `/cc-ideate` - discovery mode for ranked repo-improvement backlog
- `/cc-view` - read-only router for status/tree/diff
- `/cc-learn` - knowledge capture/lookup
- `/cc-ops` - operations router for feature/tdd-log/retro/compound/archive/rewind

Read-only subcommands:
- `/cc-view status` - visual flow snapshot
- `/cc-view tree` - deep flow tree (stages, artifacts, stale markers)
- `/cc-view diff` - before/after flow-state diff map

Operations subcommands:
- `/cc-ops feature ...` - git-worktree feature isolation and routing
- `/cc-ops tdd-log ...` - explicit RED/GREEN/REFACTOR evidence log
- `/cc-ops retro` - mandatory retrospective gate before archive
- `/cc-ops compound` - lift repeated learnings into durable rules/skills
- `/cc-ops archive` - archive active run from harness flow
- `/cc-ops rewind ...` - rewind flow and invalidate downstream stages
- `/cc-ops rewind --ack ...` - clear stale stage markers after redo

Stage order remains canonical:
`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship`

## Install surfaces

Always generated:

- `.cclaw/commands/*.md`
- `.cclaw/skills/*/SKILL.md`
- `.cclaw/references/**`
- `.cclaw/state/*.json|*.jsonl`
- `AGENTS.md` managed block

Harness-specific additions:

- `claude`: `.claude/commands/cc*.md`, `.claude/hooks/hooks.json`
- `cursor`: `.cursor/commands/cc*.md`, `.cursor/hooks.json`, `.cursor/rules/cclaw-workflow.mdc`
- `opencode`: `.opencode/commands/cc*.md`, `.opencode/plugins/cclaw-plugin.mjs`, opencode plugin registration
- `codex`: `.agents/skills/cc/SKILL.md`, `.agents/skills/cc-next/SKILL.md`, `.agents/skills/cc-ideate/SKILL.md`, `.agents/skills/cc-view/SKILL.md`, `.agents/skills/cc-ops/SKILL.md`, `.codex/hooks.json` (Codex CLI reads `.agents/skills/` for custom skills and consumes `.codex/hooks.json` on v0.114+ when `[features] codex_hooks = true` is set in `~/.codex/config.toml`. `.codex/commands/` and the legacy `.agents/skills/cclaw-cc*/` layout from v0.39.x are auto-cleaned on sync.)

## Runtime observability

- `.cclaw/state/harness-gaps.json` captures per-harness capability gaps for the active config.
- `cclaw doctor` validates shim, hook, and lifecycle surfaces against this capability model.

