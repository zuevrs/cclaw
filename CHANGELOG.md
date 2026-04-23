# Changelog

## Unreleased

### Fixed

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
- Harness integration docs now include explicit parallel-research dispatch
  semantics per harness family (native parallel dispatch vs role-switch).
- README + config reference updated for research artifact flow and the new TDD
  and compound policy knobs.
