# Harness Integration Matrix

Generated from `src/harness-adapters.ts` capabilities and hook event
mappings. The runtime copy lives at `.cclaw/references/harnesses.md`
after install/upgrade — this doc is the committed mirror.

## Capability tiers

| Harness | ID | Tier | Native dispatch | Fallback | Hook surface | Structured ask | Playbook |
|---|---|---|---|---|---|---|---|
| Claude Code | `claude` | `tier1` (full native automation) | full | `native` | full | AskUserQuestion | `.cclaw/references/harnesses/claude-playbook.md` |
| Cursor | `cursor` | `tier2` (partial automation with waivers) | generic | `generic-dispatch` | full | AskQuestion | `.cclaw/references/harnesses/cursor-playbook.md` |
| OpenCode | `opencode` | `tier2` (partial automation with waivers) | partial | `role-switch` | plugin | plain-text | `.cclaw/references/harnesses/opencode-playbook.md` |
| OpenAI Codex | `codex` | `tier2` (partial automation with waivers) | none | `role-switch` | full | plain-text | `.cclaw/references/harnesses/codex-playbook.md` |

### Fallback legend

- `native` — first-class named subagent dispatch (Claude). Delegation
  entries use `fulfillmentMode: "isolated"`.
- `generic-dispatch` — Task tool with a fixed `subagent_type`
  vocabulary (Cursor). cclaw maps each named agent onto the generic
  dispatcher with a structured role prompt — see the Cursor playbook
  for the role→subagent_type table. Entries use `fulfillmentMode:
  "generic-dispatch"`.
- `role-switch` — in-session role announce + delegation-log row with
  `fulfillmentMode: "role-switch"` and at least one `evidenceRef`
  pointing at the artifact section that captures the output. Applies
  to OpenCode and Codex. Missing evidenceRefs cause `cclaw doctor` to
  report `missingEvidence` and block stage completion.
- `waiver` — no parity path. Reserved for future harnesses that cannot
  role-switch. Currently unused — v0.33 removed the Codex-only silent
  auto-waiver path.

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
- `tier2`: usable flow with capability gaps closed via fallback
  (`generic-dispatch` or `role-switch`). Mandatory delegations still
  block stage completion until evidence is recorded.
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

- `.cclaw/state/harness-gaps.json` (schema v2) captures per-harness
  capability gaps for the active config. Each entry includes
  `subagentFallback`, `playbookPath`, `missingCapabilities`,
  `missingHookEvents`, and a concrete `remediation[]` list.
- `.cclaw/references/harnesses/<harness>-playbook.md` is generated for
  every supported harness on install/upgrade. Stage skills cite these
  paths instead of inlining fallback instructions.
- `cclaw doctor` validates shim, hook, and lifecycle surfaces against
  this capability model, including per-installed-harness playbook
  presence checks (`harness_ref:playbook:<harness>`).

## Delegation fulfillment modes

Each `delegation-log.json` entry may carry a `fulfillmentMode`:

| Mode | Harness examples | Evidence requirement |
|---|---|---|
| `isolated` | claude | None beyond the subagent return message |
| `generic-dispatch` | cursor | `evidenceRefs` recommended, not enforced |
| `role-switch` | opencode, codex | **At least one `evidenceRef` is required** |
| `harness-waiver` | (none shipped) | Carries `waiverReason: "harness_limitation"` |

`cclaw doctor` surfaces the expected fulfillment mode for the active
harness set in the `delegation:mandatory:current_stage` check and flags
role-switch rows that lack evidenceRefs as `missingEvidence`.

