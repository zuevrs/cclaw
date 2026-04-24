# Changelog

## 0.48.35

Second pass on the OpenCode plugin guard-UX fix. 0.48.34 covered the
obvious cases (read-only bypass, graceful degradation, killswitch,
actionable error), but a real-world `/cc` session still hit three
remaining failure modes:

1. `strictness: advisory` in `.cclaw/config.yaml` was ignored by the
   plugin — guard non-zero exits still threw.
2. OpenCode's `question` / `AskUserQuestion` tool (and friends) were
   not on the safe-tool whitelist, so track-selection prompts were
   blocked mid-flow.
3. Hook-runtime infrastructure failures (unrelated CLI help in
   stderr, crashes, missing binaries) were surfaced to the user as
   policy blocks with the yargs help text showing up as the "Reason".

### Fixed

- Plugin now reads the same strictness knob as the hook runtime
  (`CCLAW_STRICTNESS` env → `strictness:` key in
  `.cclaw/config.yaml` → library default `advisory`). In advisory
  mode — which is the default — guard refusals are logged as
  `advisory:` lines in `.cclaw/logs/opencode-plugin.log` and the tool
  call proceeds. Only `strictness: strict` ever throws.
- Safe-tool whitelist now exempts question / ask / `AskUserQuestion`
  / `ask_user_question` / `request_user_input` / prompt, think /
  thinking, todo / `TodoRead` / `TodoWrite` (with `find` added
  alongside ls/list). These tools cannot mutate project state or
  execute arbitrary code, so running guards on them was overhead at
  best and a blocker at worst.
- Hook infrastructure failures are no longer treated as policy
  blocks. A non-zero hook exit whose stderr looks like yargs help
  (`Usage:` / `Options:` / `-- name  [string]` lines), a Node crash
  fingerprint (`Cannot find module`, `(Reference|Syntax|Type|Range)Error`,
  `at file:line:col`, `node:internal`), a "command not found" shell
  message, or empty output now logs an `infra:` line and lets the
  tool through regardless of strictness. Strict mode still blocks on
  cleanly-structured guard refusals.
- Strict-mode block error now also points at switching to
  `strictness: advisory` in `.cclaw/config.yaml` as a recovery path
  alongside `CCLAW_DISABLE=1`.

### Changed

- `tests/unit/hooks-lifecycle.test.ts` grows three coverage cases
  (advisory-default log-only path, extended whitelist bypass across 9
  tool-name variants, infra-noise bypass under strict config) and
  the existing strict-block test now emits a short refusal reason so
  it still exercises the thrown path after the infra-noise
  heuristic tightened.

## 0.48.34

OpenCode guard UX fix. A user hitting a freshly-installed cclaw project
in OpenCode previously saw every tool call — including innocuous
`read`/`glob`/`grep` — blocked by the cryptic error
`cclaw OpenCode guard blocked tool.execute.before (prompt/workflow
guard non-zero exit).`, with `console.error` stderr spam overlapping
the TUI render. The failure mode was the same whether the guards had
legitimately refused a mutation, the hook runtime was missing, the
script crashed, or cclaw wasn't initialized in the project at all.
This release reshapes the plugin so users can actually use OpenCode.

### Fixed

- Read-only tools (`read`, `glob`, `grep`, `list`, `view`, `webfetch`,
  `websearch`) now bypass the prompt/workflow guard chain — they
  cannot mutate state or execute arbitrary code, so the guard spawn
  was pure overhead and a single point of failure for the whole
  session.
- Projects without `.cclaw/state/flow-state.json` or
  `.cclaw/hooks/run-hook.mjs` are treated as "cclaw not initialized"
  and no longer block tool calls; a one-shot advisory is recorded in
  the plugin log instead of throwing.
- Hot-path `console.error` calls in `runHookScript` and the event
  dispatcher are replaced with file-based logging to
  `.cclaw/logs/opencode-plugin.log` — eliminates the overlapping-text
  TUI artifact that made failing sessions unreadable.
- Guard block errors now name the failing guard, include the last
  ~400 bytes of its stderr as `Reason`, and suggest
  `cclaw doctor` + `CCLAW_DISABLE=1` recovery moves, replacing the
  uniform unactionable block message.

### Added

- `CCLAW_DISABLE=1` env killswitch (also honoured via `CCLAW_GUARDS=off`
  and `CCLAW_STRICTNESS=off|disabled|none`) lets users bypass the
  plugin's guards when they are stuck, without editing the generated
  plugin file. The bypass is logged once to the plugin log.
- `.cclaw/logs/opencode-plugin.log` — timestamped append-only
  diagnostic log for plugin-side hook failures, timeouts, unknown
  events, and the advisory states above. Best-effort; never blocks a
  hook on I/O failure.

### Changed

- Prompt-guard and workflow-guard now run in parallel via
  `Promise.all` on each mutating `tool.execute.before`, halving the
  steady-state guard latency (bounded already by
  `MAX_CONCURRENT_HOOKS = 2`, so no queue change needed).
- Per-hook timeout reduced from 20 s to 5 s. Typical guard runtime is
  well under 500 ms, so 5 s keeps real hooks working while capping the
  worst-case stall at a number a user will still tolerate.
- `tests/unit/hooks-lifecycle.test.ts` gains four coverage cases
  (read-only bypass, uninitialized project, `CCLAW_DISABLE`
  killswitch, actionable error shape) alongside the existing
  non-zero-exit block test.

## 0.48.33

Stage-flow consolidation, cross-platform notes, and inline-hook locality
release. Addresses three flow-quality issues flagged in the user-flow
audit: overlapping parallel instruction lists inside stage skills,
accidental platform-agnostic-by-default stage guidance, and inline JS
bodies buried in the 2000-line `node-hooks.ts` template.

### Changed

- Stage SKILL.md `## Process` now renders a **mermaid flowchart TD**
  derived from `executionModel.process` (or from
  `executionModel.processFlow` when a stage defines a custom
  non-linear graph), replacing the previous dedupe'd top-5 flat list.
  `## Interaction Protocol` keeps its dedupe'd top-5 list but opens with
  an explicit preamble stating the section is *behavioral rules*, not an
  alternative sequence of steps.
- Added optional `StageExecutionModel.processFlow` (custom mermaid body)
  and `StageExecutionModel.platformNotes` (rendered under a new
  `## Platform Notes` section). Bumped the stage-skill line budget from
  350 to 400 to accommodate the mermaid state-machine diagram and
  platform-notes block.
- Filled `platformNotes` for all eight stages with concrete cross-OS
  guidance — path separators, shell quoting, CRLF/LF drift, PowerShell
  vs POSIX env-var syntax, UTC timestamps, and release-flow signing
  differences — so agent-generated instructions stay portable.
- Extracted the inline JS bodies (`computeCompoundReadinessInline`,
  `computeRalphLoopStatusInline`, and shared helpers) out of
  `src/content/node-hooks.ts` into a dedicated
  `src/content/hook-inline-snippets.ts` module. Each snippet carries an
  explicit "mirrors X, parity enforced by Y" header.
  `tests/unit/ralph-loop-parity.test.ts` keeps the parity contract
  intact; `run-hook.mjs` output is byte-identical.

### Fixed

- `spec` checklist now includes the "present acceptance criteria in
  3-5-item batches, pause for ACK" step that previously only lived in
  the `process` duplicate list and would have silently dropped out of
  the rendered skill after the mermaid rewrite.

## 0.48.32

Stage-audit implementation release (Phase 6 completion). This cut finalizes the
remaining opt-in upgrades with config-driven toggles, a reusable seed shelf, and
an optional second-opinion path for review loops.

### Changed

- Replaced env-based scope/design audit toggles with config-driven switches under
  `.cclaw/config.yaml::optInAudits` (`scopePreAudit`, `staleDiagramAudit`) and
  updated lint/runtime tests accordingly.
- Added seed shelf support via `src/content/seed-shelf.ts` with collision-safe
  `SEED-YYYY-MM-DD-<slug>.md` naming, `trigger_when` matching, and seed-template
  rendering for deferred high-upside ideas.
- Extended `/cc` startup protocol with a dedicated seed-recall step so matching
  seeds are surfaced before routing when prompt triggers align.
- Added “plant as seed” guidance + template sections across ideate, brainstorm,
  scope, and design artifacts to preserve promising non-selected directions.
- Extended review-loop internals with `createSecondOpinionDispatcher` and merged
  second-opinion scoring/findings behind
  `.cclaw/config.yaml::reviewLoop.externalSecondOpinion.*`.
- Added config schema/docs/tests for `reviewLoop.externalSecondOpinion` (`enabled`,
  `model`, `scoreDeltaThreshold`) and disagreement surfacing when score deltas
  exceed the configured threshold.

## 0.48.31

Phase-0 renderer migration to grouped v2 stage views. This cut switches stage
skill generation to a group-first layout and trims repetitive sections to keep
skill bodies concise.

### Changed

- Updated `stageSkillMarkdown` rendering to consume grouped metadata directly in
  fixed order: `philosophy` -> `executionModel` -> `artifactRules` ->
  `reviewLens`.
- Added explicit `## Complexity Tier` output in stage skills so active tier and
  tier-scoped mandatory delegations are visible at runtime.
- Moved `HARD-GATE` and anti-pattern rendering into the Philosophy block and
  moved outputs/review sections under Review Lens to match v2 schema semantics.
- Removed always-inline Good/Bad and Domain example blocks from stage skills
  while retaining the concise examples pointer section, reducing generated skill
  line counts across all stages while preserving stage instructions.
- Updated flow contract snapshots to match the new stage skill layout.

## 0.48.30

Phase-0 v2 schema migration completion for downstream stages. This cut ports the
remaining legacy stage literals (`spec`, `plan`, `tdd`, `review`, `ship`) to
the grouped `schemaShape: "v2"` format without changing runtime contracts.

### Changed

- Migrated `spec`, `plan`, `tdd`, `review`, and `ship` stage definitions to v2
  grouped sections (`philosophy`, `executionModel`, `artifactRules`,
  `reviewLens`) and added explicit `complexityTier: "standard"` defaults.
- Kept stage behavior/contracts stable by preserving existing content and gate
  metadata while moving fields into grouped sections only.
- Updated TDD quick-track variant generation to transform nested v2 fields
  (checklists, required gates/evidence, traceability, and review sections)
  instead of legacy top-level keys.

## 0.48.29

Phase-0 artifact slug rollout for brainstorm/scope/design. This cut introduces
runtime-aware artifact path resolution with legacy fallback and updates stage
contracts to use slugged artifact patterns.

### Changed

- Added `resolveArtifactPath(stage, context)` in `src/artifact-paths.ts` with:
  topic slugification, collision-safe write naming (`-2`, `-3`, ...), and
  read-time fallback to legacy file names during migration.
- Updated runtime artifact readers (`artifact-linter`, `gate-evidence`,
  `internal/advance-stage`) to resolve stage artifacts via the shared helper
  instead of fixed file names.
- Switched audited stage artifact targets to slug patterns:
  `01-brainstorm-<slug>.md`, `02-scope-<slug>.md`, `03-design-<slug>.md`, and
  propagated the new upstream references to downstream stage traces.
- Replaced strict path-to-stage mapping in `stage-schema` with numeric-prefix
  inference so cross-stage filtering keeps working with slugged file names.
- Added resolver coverage tests (slugification, legacy fallback, collision
  handling) plus integration coverage proving plan lint reads the active
  slugged scope artifact when legacy + new files coexist.

## 0.48.28

Phase-0 schema consolidation follow-up. This cut migrates stage policy anchors
to a lint-metadata sidecar and starts v2 literal adoption in audited stages.

### Changed

- Moved `policyNeedles` out of stage literals and runtime schema fields into a
  dedicated sidecar module at `src/content/stages/_lint-metadata/index.ts`.
- Updated stage command-contract rendering to source anchors from
  `stagePolicyNeedles(...)` backed by lint metadata, preserving command output
  while decoupling policy anchors from runtime stage objects.
- Migrated `brainstorm`, `scope`, and `design` stage literals to
  `schemaShape: "v2"` grouped inputs (`philosophy`, `executionModel`,
  `artifactRules`, `reviewLens`) with normalization in `stageSchema(...)`.
- Updated schema types and tests to support mixed legacy/v2 stage inputs and
  verify policy-needle track transforms through the new metadata source.

## 0.48.27

Phase-0 schema consolidation slice. This release introduces a v2 stage-schema
surface with grouped metadata views and tier-aware mandatory delegation policy.

### Changed

- Added `schemaShape: "v2"` metadata to stage schemas, plus grouped views for
  philosophy, execution model, artifact rules, and review lens fields while
  retaining backward-compatible top-level properties.
- Added first-class `complexityTier` support on `StageSchema` with explicit
  defaults for audited stages (`brainstorm`, `scope`, `design`) and a standard
  fallback for stages that have not opted in yet.
- Added `requiredAtTier` to mandatory auto-subagent policies and updated
  delegation resolution so mandatory requirements can be gated by complexity
  tier without weakening current standard/deep paths.
- Expanded `stage-schema` tests to verify v2 parity, complexity-tier fallback,
  and tier-gated mandatory delegation behavior.

## 0.48.26

Stage-audit implementation release. This cut upgrades the upstream shaping
surface (`/cc-ideate`, brainstorm, scope, design) with stronger divergence,
adversarial review loops, and richer design-review coverage.

### Changed

- `/cc-ideate` now runs explicit mode classification, frame-based divergent
  ideation, adversarial critique, and survivor-only ranking before handoff.
- Brainstorm stage now supports depth tiering, a concrete-requirements
  short-circuit, and a strict propose -> react -> recommend flow with a
  mandatory higher-upside challenger option.
- Scope stage now includes a pre-scope system audit, optional landscape/taste
  calibration, and a bounded outside-voice review loop with quality-score
  tracking.
- Design stage now emphasizes Security/Threat, Observability, and
  Deployment/Rollout lenses; adds Standard+ shadow/error-flow diagram
  expectations; and tightens failure-mode guidance around rescue visibility.
- Design artifact template (`03-design.md`) now matches the upgraded design
  process with sections for shadow/error flow, threat modeling, observability,
  and rollout planning.

## 0.48.24

Roll-up of the lock-aware knowledge read + diagnostics (PR #131)
and the `reference:*` doctor severity demotion (PR #132). Both
landed on `main` under `0.48.23` but needed a version bump to
reach npm.


### Changed

- Doctor severity for `reference:*` checks (currently the
  `flow-map.md` section anchors, including
  `reference:flow_map:compound_readiness`) is demoted from
  `error` to `warning`. These docs document the surface rather
  than gate it; a missing section means the generated overview
  is out of date, not that a runtime contract is broken. The
  remediation hint still points at `cclaw sync`, so CI surfaces
  drift without hard-failing.

### Fixed

- SessionStart now reads `knowledge.jsonl` while holding the
  **same** mutex CLI writers use in `appendKnowledge`
  (`.cclaw/state/.knowledge.lock`). Closes a latent race where a
  concurrent `/cc-ops knowledge` append could produce a partial
  snapshot visible to the digest / compound-readiness computations.
- SessionStart's ralph-loop and compound-readiness error handlers
  no longer silently swallow exceptions — failures are now recorded
  as breadcrumbs in `.cclaw/state/hook-errors.jsonl` (still
  soft-fail so hooks never block on a malformed derived state, but
  `cclaw doctor` can now surface chronic failures).
- Directory locks (`withDirectoryLock` / the hook-inline variant)
  now fail fast with a clear "Lock path exists but is not a
  directory" error when the configured lock path is occupied by
  a non-directory instead of burning the entire retry budget.
  This stabilizes the session-start breadcrumb test on Windows,
  where `fs.mkdir(path)` against a file returns `EEXIST` (same
  as a held lock) and the old code could loop for seconds before
  giving up.

- Compound-readiness is now computed consistently across CLI and
  runtime. Previously `cclaw internal compound-readiness` honored
  `config.compound.recurrenceThreshold` while the SessionStart hook
  hard-coded `threshold = 3`, so the two paths could report different
  `readyCount` values on the same knowledge file. The hook now
  inherits the configured threshold at install time
  (`nodeHookRuntimeScript({ compoundRecurrenceThreshold })`), and both
  paths also apply the documented **small-project relaxation**
  (`<5` archived runs → effective threshold = `min(base, 2)`) that
  had previously existed only in the `/cc-ops compound` skill
  instructions. The derived status now includes `baseThreshold`,
  `archivedRunsCount`, and `smallProjectRelaxationApplied` so
  consumers can tell which rule fired. Schema bumped to `2`.
- `cclaw internal compound-readiness --threshold` now rejects
  non-integer values (`2abc`, `2.9`, `""`, negative) with a loud
  error instead of silently truncating via `parseInt`.
- `runCompoundReadinessCommand` now surfaces a stderr warning when
  `readConfig` fails instead of swallowing the error. The command
  also reads knowledge lock-aware by default so an in-flight
  `appendKnowledge` cannot produce a partial snapshot.
- SessionStart reads `knowledge.jsonl` exactly once per invocation
  and shares the raw content between the digest and the
  compound-readiness recomputation, eliminating the redundant
  second read on large knowledge logs.
- `lastUpdatedAt` in `compound-readiness.json` is now normalized
  identically in canonical and inline paths (milliseconds stripped),
  removing spurious diff noise.
- Parity tests (`tests/unit/ralph-loop-parity.test.ts`) extended to
  cover the new schema fields and the small-project relaxation.
- Atomic write on Windows: `fs.rename` sometimes fails transiently with
  `EPERM`/`EBUSY`/`EACCES` when the target file is briefly held open by
  antivirus, indexer, or a sibling hook process. Both the CLI-side
  `writeFileSafe` (`src/fs-utils.ts`) and the inline hook
  `writeFileAtomic` (`src/content/node-hooks.ts`) now retry up to 6
  times with ~10–70ms backoff before falling back to a non-atomic
  copy+unlink (still safe because callers hold a directory lock).
  Closes the Windows CI regression surfaced by
  `tests/unit/hook-atomic-writes.test.ts`.
- `parseTddCycleLog` now accepts an `issues` sink and a `strict` flag.
  In strict mode (used by `cclaw internal tdd-red-evidence` and
  validation paths), rows missing `runId`, `stage`, or `slice` are
  rejected instead of silently back-filling `runId=active,
  stage=tdd, slice=S-unknown`, which used to glue unrelated lines
  into the current run. Soft mode keeps the legacy defaults but
  can now surface per-line reasons (JSON parse failure, invalid
  phase, missing fields) via the issues array.
- `cclaw internal tdd-red-evidence` now requires a scoped `runId`.
  If neither `--runId` nor `flowState.activeRunId` is available,
  the command fails loud with a clear error instead of silently
  matching across all historical runs. Closes a false-positive
  path where a past failing RED for the same file could satisfy
  the guard on the current run.
- Unified TDD path-matcher across the CLI (`tdd-red-evidence`),
  the library (`src/tdd-cycle.ts`), and the runtime hook
  (`node-hooks.ts`). A new `normalizeTddPath` + `pathMatchesTarget`
  pair lives in `tdd-cycle.ts`; the inline hook mirrors the same
  rules and now matches `endsWith('/'+target)` instead of strict
  equality. Fixes a blind spot where the hook silently failed to
  find matching RED evidence when the recorded file path carried
  a repo-root prefix.
- Slice-aware workflow guard: when a TDD production write has no
  explicit path info, the fallback now consults the canonical
  Ralph Loop status (`computeRalphLoopStatusInline`) and blocks
  unless at least one slice has an OPEN RED. Previously a flat
  red/green tally could unlock writes for a new slice just because
  an older slice had balanced out.
- Single Ralph Loop contract inside `src/content/next-command.ts`. The
  command contract and the skill document previously carried two
  different paragraphs — one called Ralph Loop a "soft nudge, not a
  gate", the other said "Advance only when every planned slice is in
  `acClosed` and `redOpenSlices` is empty" (hard-gating language). Both
  sections now render the SAME canonical snippet
  (`ralphLoopContractSnippet()` / `RALPH_LOOP_CONTRACT_MARKER`) stating
  the resolved policy: Ralph Loop is a progress indicator + soft
  pre-advance nudge; hard gate enforcement flows through
  `flow-state.json` gates via `stage-complete.mjs`. A new
  behavior-backed parity test in
  `tests/e2e/next-command-ralph-loop-contract.test.ts` asserts the
  canonical paragraph appears byte-identical in both places, that no
  hard-gating wording is used against ralph-loop fields, and that the
  legacy wording is gone.
- Runtime hooks (`run-hook.mjs`) now write JSON state atomically (temp
  file + rename, with EXDEV fallback) and serialize concurrent writes
  to the same file via per-file directory locks. This closes a class
  of torn-write and interleaved-JSONL races that could leave
  `ralph-loop.json`, `compound-readiness.json`, `checkpoint.json`,
  and `stage-activity.jsonl` in partial states under parallel session
  events.
- `readFlowState()` in the hook runtime now records a breadcrumb to
  `.cclaw/state/hook-errors.jsonl` when `flow-state.json` exists but
  fails JSON.parse, instead of silently falling back to `{}`. Makes
  latent CLI↔hook drift surfaceable via `cclaw doctor`.
- `archiveRun()` now holds both the archive lock and the flow-state
  lock for the entire archive window. Internal `writeFlowState`
  calls pass `skipLock: true` so no nested-lock deadlock occurs. This
  eliminates lost-update races where a concurrent stage mutation
  between archive snapshot and reset would be silently clobbered.

### Added

- Hook manifest as single source of truth (`src/content/hook-manifest.ts`).
  The per-harness JSON documents (`.claude/hooks/hooks.json`,
  `.cursor/hooks.json`, `.codex/hooks.json`) and the semantic coverage
  table in `hook-events.ts` are now derived from one declarative manifest.
  New diagnostic: `cclaw internal hook-manifest [--harness <id>] [--json]`.
- Parity tests (`tests/unit/ralph-loop-parity.test.ts`) that seed a
  fixed TDD-cycle log / knowledge file and assert the inline
  implementations in the generated `run-hook.mjs` produce the same
  `ralph-loop.json` / `compound-readiness.json` as the canonical
  `computeRalphLoopStatus` and `computeCompoundReadiness` in core.
- Path-aware TDD guard routing via `tdd.testPathPatterns` and
  `tdd.productionPathPatterns`, including strict-mode blocking with the
  explicit message "Write a failing test first" when production edits happen
  before RED.
- Compound recurrence tuning via `compound.recurrenceThreshold` with
  small-project threshold relaxation (`<5` archived runs) and a
  `severity: critical` single-hit promotion override.
- Design-stage example snippet for the parallel research fleet workflow in
  `src/content/examples.ts`.

### Changed

- Compound command/skill contracts now document qualification source
  (`recurrence` vs `critical_override`) for every promoted cluster.
