# Harness Integration Matrix

Generated from `src/harness-adapters.ts` capabilities and hook event mappings. For the end-to-end subagent dispatch model, proof sequence, controller/worker responsibilities, and future roadmap, see [`docs/subagent-flow.md`](./subagent-flow.md).

## Capability tiers

| Harness | ID | Tier | declaredSupport | runtimeLaunch | Fallback | proofRequired | proofSource | Hook surface | Structured ask |
|---|---|---|---|---|---|---|---|---|---|
| Claude Code | `claude` | `tier1` (full native automation) | full | native Task launch | native | spanId+dispatchId or workerRunId+ACK | `.cclaw/state/delegation-events.jsonl` + ledger | full | AskUserQuestion |
| Cursor | `cursor` | `tier2` (supported with fallback paths) | generic | generic Task/Subagent role prompt | generic-dispatch | spanId+dispatchId/evidenceRefs | events + artifact evidenceRefs | full | AskQuestion |
| OpenCode | `opencode` | `tier2` hooks, native dispatch declared | full | prompt-level launch via Task / `@agent` against `.opencode/agents` | native | spanId+dispatchId+ackTs+completedTs | `.opencode/agents/<agent>.md` + events | plugin | question |
| OpenAI Codex | `codex` | `tier2` hooks, native dispatch declared | full | prompt-level request to spawn `.codex/agents` custom agents | native | spanId+dispatchId+ackTs+completedTs | `.codex/agents/<agent>.toml` + events | limited | request_user_input |


## Per-Harness Lifecycle Recipe

| Harness | Surface | Agent definition path | fulfillmentMode | Lifecycle |
|---|---|---|---|---|
| `claude` | `claude-task` | `.claude/agents/<agent-name>.md` | isolated | scheduled -> launched -> acknowledged -> completed (reuse `<span-id>` + `<dispatch-id>`; `--ack-ts=<iso-ts>` for completed isolated/generic) |
| `cursor` | `cursor-task` | `.cclaw/agents/<agent-name>.md` | generic-dispatch | scheduled -> launched -> acknowledged -> completed (reuse `<span-id>` + `<dispatch-id>`; `--ack-ts=<iso-ts>` for completed isolated/generic) |
| `opencode` | `opencode-agent` | `.opencode/agents/<agent-name>.md` | isolated | scheduled -> launched -> acknowledged -> completed (reuse `<span-id>` + `<dispatch-id>`; `--ack-ts=<iso-ts>` for completed isolated/generic) |
| `codex` | `codex-agent` | `.codex/agents/<agent-name>.toml` | isolated | scheduled -> launched -> acknowledged -> completed (reuse `<span-id>` + `<dispatch-id>`; `--ack-ts=<iso-ts>` for completed isolated/generic) |

Neutral placeholder tokens only: `<agent-name>`, `<stage>`, `<run-id>`, `<span-id>`, `<dispatch-id>`, `<agent-def-path>`, `<iso-ts>`, `<artifact-anchor>`. See `docs/quality-gates.md` for stage-by-stage gate mapping.

The four shipped harnesses (`claude`, `cursor`, `opencode`, `codex`) each ship with a canonical primary surface in the table above. Repair hints: `npx cclaw-cli sync` safely regenerates shims/plugins/agents; Codex also needs `[features] codex_hooks = true`; OpenCode needs `opencode.json(.c)` plugin registration; role-switch completions require evidenceRefs. The remaining enum values `generic-task`, `role-switch`, and `manual` are documented in the dispatch-surface table below and are available to any harness as fallback paths when the primary surface is unavailable.

**claude**:

    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=scheduled --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=launched --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --launched-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=acknowledged --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --ack-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=completed --dispatch-surface=claude-task --agent-definition-path=.claude/agents/<agent-name>.md --completed-ts=<iso-ts> --json

**cursor**:

    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=scheduled --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=launched --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --launched-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=acknowledged --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --ack-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=completed --dispatch-surface=cursor-task --agent-definition-path=.cclaw/agents/<agent-name>.md --completed-ts=<iso-ts> --evidence-ref=<artifact-anchor> --json

**opencode**:

    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=scheduled --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=launched --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --launched-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=acknowledged --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --ack-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=completed --dispatch-surface=opencode-agent --agent-definition-path=.opencode/agents/<agent-name>.md --completed-ts=<iso-ts> --json

**codex**:

    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=scheduled --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=launched --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --launched-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=acknowledged --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --ack-ts=<iso-ts> --json
    node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent-name> --mode=mandatory --span-id=<span-id> --dispatch-id=<dispatch-id> --status=completed --dispatch-surface=codex-agent --agent-definition-path=.codex/agents/<agent-name>.toml --completed-ts=<iso-ts> --json

### Dispatch surfaces (`--dispatch-surface` enum)

Generated from `src/delegation.ts::DELEGATION_DISPATCH_SURFACES` and `DELEGATION_DISPATCH_SURFACE_PATH_PREFIXES`. Any surface not in this table is rejected by `.cclaw/hooks/delegation-record.mjs` with a non-zero exit. The deprecated `task` surface is **not** in this enum.

| Surface | Purpose | Allowed agent-definition-path prefixes |
|---|---|---|
| `claude-task` | Claude Code native Task launch against `.claude/agents/<agent-name>.md`; fulfillmentMode: `isolated`. | `.claude/agents/`, `.cclaw/agents/` |
| `cursor-task` | Cursor generic Task/Subagent dispatch against `.cclaw/agents/<agent-name>.md` with a role prompt; fulfillmentMode: `generic-dispatch`. Requires non-empty `evidenceRefs` on completion. | `.cursor/agents/`, `.cclaw/agents/` |
| `opencode-agent` | OpenCode native subagent (`@<agent-name>` or Task) against `.opencode/agents/<agent-name>.md`; fulfillmentMode: `isolated`. | `.opencode/agents/`, `.cclaw/agents/` |
| `codex-agent` | OpenAI Codex CLI native custom agent against `.codex/agents/<agent-name>.toml`; fulfillmentMode: `isolated`. | `.codex/agents/`, `.cclaw/agents/` |
| `generic-task` | Generic Task dispatch against `.cclaw/agents/<agent-name>.md` for harnesses without a vendor-specific surface; fulfillmentMode: `generic-dispatch`. | `.cclaw/agents/` |
| `role-switch` | In-session role-switch fallback when no isolated dispatch surface is available. No agent-definition-path prefix is enforced; completion requires non-empty `evidenceRefs`. fulfillmentMode: `role-switch`. | (any) |
| `manual` | Out-of-band manual dispatch (e.g. operator hand-off, external ticketing system). The agent-definition-path is intentionally free-form; recorded for audit only. | (any) |


### Legacy ledger upgrade

Pre-v3 ledger entries that lack a recorded `dispatchSurface` are tagged `fulfillmentMode: "legacy-inferred"` on read. Stage-complete blocks completion until those rows are re-recorded with the v3 helper:

    node .cclaw/hooks/delegation-record.mjs \
      --rerecord \
      --span-id=<span-id> \
      --dispatch-id=<dispatch-id> \
      --dispatch-surface=<surface> \
      --agent-definition-path=<agent-def-path> \
      --ack-ts=<iso-ts> \
      --completed-ts=<iso-ts> \
      --json

`--dispatch-surface` must be one of the values listed in the dispatch-surface table above (the enum is generated verbatim from `src/delegation.ts::DELEGATION_DISPATCH_SURFACES`). Surfaces must align with the allowed agent-definition-path prefixes shown alongside each surface; `role-switch` and `manual` accept any path. The deprecated `task` surface is rejected.

## Hook layering

Hook behavior is intentionally split into three layers so docs, generation, and runtime checks stay in sync:

| Layer | Source of truth | Responsibility |
|---|---|---|
| 1) Manifest projection | `src/content/hook-manifest.ts` | Canonical handler/event map per harness. This is the authoring surface for new handlers or reroutes. |
| 2) JSON schema descriptors | `src/hook-schemas/*.json` + `src/hook-schema.ts` descriptor map | Declares required harness-native event arrays and schema version for each harness document. |
| 3) Runtime TS validation | `src/hook-schema.ts::validateHookDocument` + sync hook checks | Validates generated hook JSON shape/required events and reports actionable diagnostics. |

Flow:
1. Manifest defines handler bindings.
2. Hook documents are generated from manifest projections.
3. Schema descriptors + TS validators enforce structure at sync/sync time.

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
4. Append `.cclaw/state/delegation-events.jsonl` for scheduled/launched/acknowledged/completed/failed/waived/stale, then mirror current state in `.cclaw/state/delegation-log.json`. The ledger is current state; the event log is proof/audit.
5. Treat completed role-switch rows without `evidenceRefs` as unresolved; treat native isolated completion without matching `spanId` + `dispatchId`/`workerRunId` + `ackTs` + `completedTs` as fake isolated completion. Native isolated rows are not a role-switch substitute and should reflect a real dispatched worker.

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
- In `strict` mode, Codex additionally runs the generated Node/runtime `verify-current-state` path on `UserPromptSubmit` as a fail-closed check. Advisory mode remains non-blocking, including when the generated local Node entrypoint is missing; sync reports that install drift separately. This strict-only coverage is represented explicitly by the `strict_state_verify` semantic row above.

## Shared command contract

All harnesses receive the same utility commands:

- `/cc` - flow entry and resume
- `/cc` - stage progression and post-ship closeout
- `/cc-ideate` - ideate mode for ranked repo-improvement backlog
- `/cc-view` - read-only router for status/tree/diff

Read-only subcommands:
- `/cc-view status` - visual flow snapshot
- `/cc-view tree` - deep flow tree (stages, artifacts, stale markers)
- `/cc-view diff` - before/after flow-state diff map

Operational work is handled by `/cc`, `/cc-ideate`, `/cc-view`, and `node .cclaw/hooks/stage-complete.mjs <stage>` inside the installed harness runtime. `npx cclaw-cli` is the installer/support surface for init, sync, upgrade, sync, and explicit/manual archive; the normal stage flow must not depend on a runtime `cclaw` binary in PATH.

Critical-path stage order remains canonical:
`brainstorm -> scope -> design -> spec -> plan -> tdd -> review -> ship`

Every track then closes out through:
`retro -> compound -> archive`

## Stage -> skill folder mapping

| Stage | Skill folder |
|---|---|
| `brainstorm` | `brainstorm` |
| `scope` | `scope` |
| `design` | `design` |
| `spec` | `spec` |
| `plan` | `plan` |
| `tdd` | `tdd` |
| `review` | `review` |
| `ship` | `ship` |

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
- `opencode`: `.opencode/commands/cc*.md`, `.opencode/plugins/cclaw-plugin.mjs`, opencode plugin registration with `permission.question: "allow"`; set `OPENCODE_ENABLE_QUESTION_TOOL=1` for ACP clients so structured asks can route through question tooling. Sync/runtime checks validate the config permission and warn when the environment hint is absent.
- `codex`: `.agents/skills/cc/SKILL.md`, `.agents/skills/cc-ideate/SKILL.md`, `.agents/skills/cc-view/SKILL.md`, `.codex/hooks.json` (Codex CLI reads `.agents/skills/` for custom skills and consumes `.codex/hooks.json` on v0.114+ when `[features] codex_hooks = true` is set in `~/.codex/config.toml`. `.codex/commands/` and the legacy `.agents/skills/cclaw-cc*/` layout from v0.39.x are auto-cleaned on sync.)

## Runtime observability

- `npx cclaw-cli sync` validates shim, hook, and lifecycle surfaces against this capability model.
- `/cc-view status` and `/cc-view tree` surface the same harness tier/fallback facts from the generated runtime metadata.

## Delegation Proof Model

Runtime state is split deliberately:

- `.cclaw/state/delegation-log.json` is the compact current ledger used by stage gates and `/cc-view` summaries.
- `.cclaw/state/delegation-events.jsonl` is append-only audit proof for `scheduled`, `launched`, `acknowledged`, `completed`, `failed`, `waived`, and `stale` lifecycle transitions.
- `.cclaw/state/subagents.json` is a lightweight active-worker tracker for status/tree/sync reports.
- `.cclaw/hooks/delegation-record.mjs` is the generated helper for lifecycle rows/events. It validates required fields and emits JSON diagnostics with `--json`.

Isolated completion requires `spanId`, `dispatchId` or `workerRunId`, `dispatchSurface`, `agentDefinitionPath`, `ackTs`, `launchedTs`, and `completedTs`. Cursor/generic dispatch and role-switch also require evidence refs when artifact evidence is the proof source. Legacy inferred completions remain readable, but sync reports them as warnings because they predate event-log proof.

## Reference Audit Appendix

Status meanings: `deep` = read for transferable implementation contract; `targeted` = inspected the relevant files only; `skimmed` = searched/read enough to classify; `not relevant` = intentionally excluded from implementation influence.

| Reference path under `<repo-relative references dir>` | Status | Findings preserved |
|---|---|---|
| `evanklem-evanflow/skills/evanflow-coder-overseer/SKILL.md` | deep | Contract-first coder/overseer loop, reviewer reads code rather than worker narrative, and integration overseer pattern map cleanly onto cclaw subagent guidance. |
| `evanklem-evanflow/agents/evanflow-coder.md` | targeted | Worker role is narrow: implement the pasted contract, avoid broad orchestration, and return evidence for overseer verification. |
| `evanklem-evanflow/agents/evanflow-overseer.md` | targeted | Overseer validates actual code and acceptance evidence before controller marks work complete. |
| `oh-my-codex/src/agents/native-config.ts` | deep | Native agent config shape supports explicit metadata/model/tool posture; cclaw should validate generated `.codex/agents/*.toml` shape instead of trusting file presence. |
| `oh-my-codex/src/team/state/events.ts` and `src/team/state/workers.ts` | targeted | Append-only events plus worker state are useful as separate audit/current-state layers; cclaw mirrors that with `delegation-events.jsonl` and `subagents.json`. |
| `oh-my-openagent/src/tools/delegate-task/tools.ts` | deep | Delegation should have an explicit dispatch surface and mode instead of relying on a prose claim that an agent was launched. |
| `oh-my-openagent/src/tools/delegate-task/subagent-resolver.ts` | targeted | Agent discovery should be checked by sync so missing/corrupt generated agent definitions are visible before dispatch. |
| `oh-my-openagent/src/tools/delegate-task/prompt-builder.ts` | targeted | Prompt builders should include exact invocation/return contracts; cclaw generated worker prompts now carry ACK/result schemas. |
| `giancarloerra-socraticode/**` | skimmed | Useful for workflow/e2e and graph-oriented contract testing, but not a subagent dispatch implementation reference; no runtime pattern imported. |
| unrelated large reference trees not named above | not relevant | Searched/skipped because they did not contain flow/subagent/harness dispatch patterns relevant to this plan. |

