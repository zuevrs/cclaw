# Harness Integration Matrix

Generated from `src/harness-adapters.ts` capabilities and hook event mappings.

## Capability tiers

| Harness | ID | Tier | Native subagent dispatch | Hook surface | Structured ask |
|---|---|---|---|---|---|
| Claude Code | `claude` | `tier1` (full native automation) | full | full | AskUserQuestion |
| Cursor | `cursor` | `tier2` (partial automation with waivers) | partial | full | AskQuestion |
| OpenCode | `opencode` | `tier2` (partial automation with waivers) | partial | plugin | plain-text |
| OpenAI Codex | `codex` | `tier2` (partial automation with waivers) | none | full | plain-text |

## Semantic hook event coverage

| Event | Claude | Cursor | OpenCode | Codex |
|---|---|---|---|---|
| `session_rehydrate` | SessionStart matcher startup|resume|clear|compact | sessionStart/sessionResume/sessionClear/sessionCompact | plugin event handlers + transform rehydration | SessionStart matcher startup|resume|clear|compact |
| `pre_tool_prompt_guard` | PreToolUse -> prompt-guard.sh | preToolUse -> prompt-guard.sh | plugin tool.execute.before -> prompt-guard.sh | PreToolUse -> prompt-guard.sh |
| `pre_tool_workflow_guard` | PreToolUse -> workflow-guard.sh | preToolUse -> workflow-guard.sh | plugin tool.execute.before -> workflow-guard.sh | PreToolUse -> workflow-guard.sh |
| `post_tool_context_monitor` | PostToolUse -> context-monitor.sh | postToolUse -> context-monitor.sh | plugin tool.execute.after -> context-monitor.sh | PostToolUse -> context-monitor.sh |
| `stop_checkpoint` | Stop -> stop-checkpoint.sh | stop -> stop-checkpoint.sh | plugin session.idle -> stop-checkpoint.sh | Stop -> stop-checkpoint.sh |
| `precompact_digest` | PreCompact -> pre-compact.sh | sessionCompact -> pre-compact.sh | plugin session.cleared/session.resumed hooks | PreCompact -> pre-compact.sh |

## Interpretation

- `tier1`: full native delegation + structured asks + full hook surface.
- `tier2`: usable flow with capability gaps; mandatory delegation can require waivers.
- `tier3`: manual-only fallback; no native automation guarantees.

## Shared command contract

All harnesses receive the same five top-level utility commands:

- `/cc` — flow entry and resume
- `/cc-next` — stage progression
- `/cc-ideate` — repository improvement discovery
- `/cc-view` — read-only flow visibility (status/tree/diff)
- `/cc-ops` — operational router (feature/tdd-log/retro/compound/archive/rewind)

Knowledge capture runs as an internal skill (`.cclaw/skills/learnings/SKILL.md`)
invoked automatically by stage completion protocols — not as a user-typed
slash command. The `cc-learn.md` shim was removed in v0.31; upgrade will clean
up stale copies.

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
- `codex`: `.codex/commands/cc*.md`, `.codex/hooks.json`

## Runtime observability

- `.cclaw/state/harness-gaps.json` captures per-harness capability gaps for the active config.
- `cclaw doctor` validates shim, hook, and lifecycle surfaces against this capability model.

