# Harness Integration Matrix

Generated from `src/harness-adapters.ts` capabilities and hook event mappings.

## Capability tiers

| Harness | ID | Tier | Native dispatch | Fallback | Hook surface | Structured ask |
|---|---|---|---|---|---|---|
| Claude Code | `claude` | `tier1` (full native automation) | full | native | full | AskUserQuestion |
| Cursor | `cursor` | `tier2` (supported with fallback paths) | generic | generic-dispatch | full | AskQuestion |
| OpenCode | `opencode` | `tier1` (native subagents plus plugin hooks) | full | native | plugin | question |
| OpenAI Codex | `codex` | `tier1` for dispatch / `tier2` hooks | full | native | limited | request_user_input |

Fallback legend:

- `native` — first-class named subagent dispatch (Claude).
- `generic-dispatch` — generic Task dispatcher mapped to cclaw roles (Cursor).
- `role-switch` — degraded fallback for a runtime where declared native/generic dispatch is unavailable; explicit role headers, artifact outputs, and non-empty delegation-log evidenceRefs are required.
- `waiver` — no parity path; reserved for harnesses that cannot role-switch (none shipped).

## Stage-Aware Native Dispatch Workflow

OpenCode and Codex receive generated native isolated subagents. Use them before considering role-switch fallback:

1. Use the active stage skill's generated dispatch table as the source of truth.
2. OpenCode: invoke `.opencode/agents/<agent>.md` via Task or `@<agent>`; Codex: ask Codex to spawn `.codex/agents/<agent>.toml` by name, in parallel when lanes are independent.
3. Load `.cclaw/agents/<agent>.md`, execute only that role's stage task, and write outputs into the active stage artifact.
4. Append `.cclaw/state/delegation-log.json` with `fulfillmentMode: "isolated"` for native OpenCode/Codex dispatch (`"role-switch"` plus non-empty `evidenceRefs` only for degraded fallback).
5. Treat completed role-switch rows without `evidenceRefs` as unresolved; native isolated rows are not a role-switch substitute and should reflect a real dispatched worker.

This is staged agent work backed by the harness-native subagent surfaces. Role-switch remains only a degraded fallback when that surface is unavailable in the active runtime.

## Parallel research dispatch semantics

Design-stage research fleet uses the same parity model:

- **Claude / Cursor**: dispatch all four research lenses in one turn
  (stack, features, architecture, pitfalls) and synthesize into
  `.cclaw/artifacts/02a-research.md`.
- **OpenCode / Codex**: dispatch generated native subagents for the same
  four lenses and run independent lanes in parallel where the active runtime
  permits. Use role-switch with evidence only as a degraded fallback.

## Semantic hook event coverage

| Event | Claude | Cursor | OpenCode | Codex |
|---|---|---|---|---|
| `session_rehydrate` | SessionStart matcher startup|resume|clear|compact | sessionStart/sessionResume/sessionClear/sessionCompact | plugin event handlers + transform rehydration | SessionStart matcher startup|resume |
| `pre_tool_prompt_guard` | PreToolUse -> prompt-guard | preToolUse -> prompt-guard | plugin tool.execute.before -> prompt-guard | PreToolUse matcher Bash -> prompt-guard (plus UserPromptSubmit for non-Bash prompts) |
| `pre_tool_workflow_guard` | PreToolUse -> workflow-guard | preToolUse -> workflow-guard | plugin tool.execute.before -> workflow-guard | PreToolUse matcher Bash -> workflow-guard (Bash-only) |
| `post_tool_context_monitor` | PostToolUse -> context-monitor | postToolUse -> context-monitor | plugin tool.execute.after -> context-monitor | PostToolUse matcher Bash -> context-monitor (Bash-only) |
| `stop_handoff` | Stop -> stop-handoff | stop -> stop-handoff | plugin session.idle -> stop-handoff | Stop -> stop-handoff |
| `precompact_compat` | PreCompact -> pre-compact | sessionCompact -> pre-compact | plugin session.compacted -> pre-compact | missing |
| `strict_state_verify` | missing | missing | missing | UserPromptSubmit -> verify-current-state (blocks only in strict mode) |

## Hook lifecycle aliases

The generated Node dispatcher accepts a small compatibility alias set for lifecycle names: `stop` and `stop-checkpoint` route to `stop-handoff`, `precompact` routes to `pre-compact`, and `session-rehydrate` routes to `session-start`. The `pre-compact` handler is intentionally a no-op compatibility marker; rehydration remains the `session-start` responsibility after compact events. Harness JSON should still emit the canonical handler names from `src/content/hook-manifest.ts`.

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
- In `strict` mode, Codex additionally runs the generated Node/runtime `verify-current-state` path on `UserPromptSubmit` as a fail-closed check. Advisory mode remains non-blocking, including when the generated local Node entrypoint is missing; doctor reports that install drift separately. This strict-only coverage is represented explicitly by the `strict_state_verify` semantic row above.

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

Operational work is handled by `/cc`, `/cc-next`, `/cc-ideate`, `/cc-view`, and `node .cclaw/hooks/stage-complete.mjs <stage>` inside the installed harness runtime. `npx cclaw-cli` is the installer/support surface for init, sync, upgrade, doctor, and explicit/manual archive; the normal stage flow must not depend on a runtime `cclaw` binary in PATH.

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
- `opencode`: `.opencode/commands/cc*.md`, `.opencode/plugins/cclaw-plugin.mjs`, opencode plugin registration with `permission.question: "allow"`; set `OPENCODE_ENABLE_QUESTION_TOOL=1` for ACP clients so structured asks can route through question tooling. Doctor validates the config permission and warns when the environment hint is absent.
- `codex`: `.agents/skills/cc/SKILL.md`, `.agents/skills/cc-next/SKILL.md`, `.agents/skills/cc-ideate/SKILL.md`, `.agents/skills/cc-view/SKILL.md`, `.codex/hooks.json` (Codex CLI reads `.agents/skills/` for custom skills and consumes `.codex/hooks.json` on v0.114+ when `[features] codex_hooks = true` is set in `~/.codex/config.toml`. `.codex/commands/` and the legacy `.agents/skills/cclaw-cc*/` layout from v0.39.x are auto-cleaned on sync.)

## Runtime observability

- `npx cclaw-cli doctor` validates shim, hook, and lifecycle surfaces against this capability model.
- `/cc-view status` and `/cc-view tree` surface the same harness tier/fallback facts from the generated runtime metadata.

