# Changelog

## 6.14.2 — Controller discipline (wave-status discovery, cutover semantics, legacy amnesty, GREEN evidence freshness, mode-field writers)

Real-world hox `/cc` runs on top of v6.14.1 surfaced four concrete failure modes that the v6.14.0/v6.14.1 stream-mode runtime + skill text could not catch on their own:

1. **Wave-plan blindness** — the controller correctly detected stream mode but had no deterministic primitive to find the next ready wave; it would page through 1400-line `05-plan.md` artifacts and stall when the managed `<!-- parallel-exec-managed-start -->` block scrolled off-context.
2. **`tddCutoverSliceId` misread** — the controller treated `flow-state.json::tddCutoverSliceId` as a pointer to the active slice and re-dispatched RED/GREEN/DOC for a slice that closed under v6.12 markdown.
3. **Worktree-first lane-metadata noise** — legacy hox-shape projects under `legacyContinuation: true` carry pre-worktree slice closures that fail `tdd_slice_lane_metadata_missing`, `tdd_slice_claim_token_missing`, and `tdd_lease_expired_unreclaimed` indefinitely; the v6.13 cutover was per-slice numeric and did not cleanly bound legacy-shape closures from new work. `tdd.cohesion_contract_missing` likewise blocked legacy hox-shape projects with no real cross-slice cohesion contract authored.
4. **GREEN evidence "fast-greens"** — the runtime accepted any string in `evidenceRefs[0]` on `slice-implementer --phase green --status=completed`, so workers could close a slice with stale evidence (or a one-line claim) without the test re-running between `acknowledged` and `completed`.

v6.14.2 closes all four with runtime + skill text + linter changes, plus three bonus mode-field writers so legacy-continuation projects can opt in/out of stream-mode defaults without hand-editing `flow-state.json` (which now hard-blocks via the SHA256 sidecar).

### Fix 1 — Wave-plan discovery primitive

- **`src/internal/wave-status.ts` (new)** + **`runWaveStatusCommand`** — `cclaw-cli internal wave-status [--json|--human]` reads the managed `<!-- parallel-exec-managed-start -->` block plus `wave-plans/wave-NN.md`, projects the active run's terminal slice closures (`refactor`, `refactor-deferred`, `resolve-conflict`, GREEN with `refactorOutcome` fold-inline), and returns a deterministic `{ activeRunId, currentStage, tddCutoverSliceId, tddWorktreeCutoverSliceId, legacyContinuation, waves[], nextDispatch, warnings[] }` report. `nextDispatch.mode` is `wave-fanout` (≥ 2 ready members), `single-slice` (1 ready), or `none`. Surfaces `wave_plan_managed_block_missing` / `wave_plan_parse_error` / `wave_plan_merge_conflict` warnings instead of silently returning empty.
- **TDD skill text** (`src/content/stages/tdd.ts`) — adds row 1 of the checklist: **"Wave dispatch — discovery hardened (v6.14.2): your FIRST tool call after entering TDD MUST be `cclaw-cli internal wave-status --json`"** with the explicit instruction that `05-plan.md` is opened *only* after `wave-status` names a slice that needs context. Existing v6.14.0 stream-style + v6.14.1 controller-discipline rows are preserved verbatim.
- **`src/internal/advance-stage.ts`** — registers `wave-status` (and the four other new subcommands) as known dispatch targets and surfaces them in the usage block.

### Fix 2 — `tddCutoverSliceId` semantics + advisory linter

- **TDD skill text** (`src/content/stages/tdd.ts`) — `requiredEvidence[5]` rewritten so `flow-state.json::tddCutoverSliceId` is named explicitly as a *historical boundary* set by `cclaw-cli sync`, NOT a pointer to the active slice. Includes the imperative "to find the active slice, run `cclaw-cli internal wave-status --json` (Fix 1, v6.14.2) — never derive it from `tddCutoverSliceId`."
- **`tdd_cutover_misread_warning` advisory** in `src/artifact-linter/tdd.ts::evaluateCutoverMisread` — fires when (a) the active run scheduled new RED/GREEN/DOC work for the slice id stored in `tddCutoverSliceId`, AND (b) that slice has already closed (terminal `refactor`/`refactor-deferred`/`resolve-conflict` row recorded for the same id, possibly under a prior run). `required: false` — never blocks `stage-complete`; clears the moment the controller pivots away.

### Fix 3 — Legacy worktree exemption + soft cohesion-contract + stub writer

- **`flow-state.json::tddWorktreeCutoverSliceId`** — new optional field defining the legacy-worktree-first amnesty boundary. Auto-stamped on `cclaw-cli sync` for `legacyContinuation: true` projects already in `worktree-first` mode but missing the boundary: scans the active-run delegation ledger for the highest slice id that *never* recorded worktree-first metadata (claim token / lane id / lease) on any of its phase rows; falls back to `tddCutoverSliceId` when no such slice is found. New `applyV6142WorktreeCutoverIfNeeded` in `src/install.ts`.
- **Softened legacy gates** in `src/artifact-linter/tdd.ts` — `tdd_slice_lane_metadata_missing`, `tdd_slice_claim_token_missing`, and `tdd_lease_expired_unreclaimed` are now exempted (and emit `_legacy_exempt` advisories instead) for slices that (1) sit at or below the `tddWorktreeCutoverSliceId` (or `tddCutoverSliceId` fallback) AND (2) never recorded any worktree-first metadata, OR for `tdd_lease_expired_unreclaimed` specifically: the slice closed before the lease expired. Fresh worktree-first projects (no `legacyContinuation`) continue to enforce all three rules globally.
- **`tdd.cohesion_contract_missing`** — softened to `required: false` under `legacyContinuation: true`; the rule remains mandatory for fresh projects. Suggestion text now points at the new stub writer.
- **`cclaw-cli internal cohesion-contract --stub [--force] [--reason="<short>"]`** — new writer at `src/internal/cohesion-contract-stub.ts`. Generates minimal `cohesion-contract.md` + `cohesion-contract.json` with `status.verdict: "advisory_legacy"` and the active-run slice ids prefilled, so legacy projects can clear the advisory without hand-authoring the document. Refuses to overwrite existing files unless `--force` is passed.

### Fix 4 — GREEN evidence freshness contract

- **Hook validation in `delegationRecordScript()`** (`src/content/hooks.ts`) — for `slice-implementer --phase=green --status=completed` events with a matching `phase=red` row in the active run, the hook enforces three new contracts on `evidenceRefs[0]`:
    1. **`green_evidence_red_test_mismatch`** — the value must contain the basename/stem of the RED span's first evidenceRef (substring, case-insensitive).
    2. **`green_evidence_passing_assertion_missing`** — the value must contain a recognized passing-runner line: `=> N passed; 0 failed`, `N passed; 0 failed`, `test result: ok` (cargo), `N passed in 0.42s` (pytest), or `ok pkg 0.12s` (go test).
    3. **`green_evidence_too_fresh`** — `completedTs - ackTs` must be ≥ `flow-state.json::tddGreenMinElapsedMs` (default 4000 ms; configurable via the new field).
- **Escape clause** — pass BOTH `--allow-fast-green --green-mode=observational` to skip all three checks for legitimate observational GREEN spans (cross-slice handoff, no-op verification). Both flags required; either alone is rejected by structural validation.
- **`flow-state.ts`** — adds `tddGreenMinElapsedMs?: number` and `DEFAULT_TDD_GREEN_MIN_ELAPSED_MS = 4000`; `effectiveTddGreenMinElapsedMs` reader handles invalid inputs.
- **TDD worker self-record contract** in `src/content/core-agents.ts` — `tddWorkerSelfRecordContract(...)` bumped from `(v6.14.1)` to `(v6.14.2)` with the freshness contract spelled out inline; the rendered agent markdown for `test-author`, `slice-implementer`, `slice-documenter`, and `integration-overseer` now names every reject code and the `--allow-fast-green --green-mode=observational` escape.
- **`src/content/hooks.ts` usage banner** — documents `--allow-fast-green` and `--green-mode=observational` so `--help` users see the contract.

### Bonus — Mode-field writer commands

Three new internal subcommands so legacy-continuation projects can opt out of stream-mode defaults without hand-editing `flow-state.json` (the SHA256 sidecar enforcement introduced in v6.14.0 makes manual edits a hard failure):

- **`cclaw-cli internal set-checkpoint-mode <per-slice|global-red> [--reason="<short>"]`** (`src/internal/set-checkpoint-mode.ts`) — writes `flow-state.json::tddCheckpointMode` and refreshes the SHA256 sidecar atomically. Reason is slugified into the `writerSubsystem` audit field.
- **`cclaw-cli internal set-integration-overseer-mode <conditional|always> [--reason="<short>"]`** (`src/internal/set-integration-overseer-mode.ts`) — writes `flow-state.json::integrationOverseerMode` and refreshes the sidecar.
- **`sync` auto-stamp migration** (`src/install.ts::applyV614DefaultsIfNeeded`) — projects with `legacyContinuation: true` and missing `tddCheckpointMode` / `integrationOverseerMode` are now stamped to **`per-slice`** / **`conditional`** (the v6.14 stream-mode defaults). v6.14.1 stamped these to `global-red` / `always` to preserve legacy hox behavior; v6.14.2 flips that default because legacy projects upgrading past v6.14.1 are intended to land on stream mode. Use the new writer commands above to opt back into `global-red` / `always` if you specifically need v6.13.x semantics.

### Migration notes for hox-shape projects

Run `npx cclaw-cli@6.14.2 upgrade` then `npx cclaw-cli sync`. After sync, expect the following in `flow-state.json`:

- `packageVersion: "6.14.2"`
- `tddCheckpointMode: "per-slice"` (auto-stamped if previously absent under `legacyContinuation: true`)
- `integrationOverseerMode: "conditional"` (auto-stamped if previously absent)
- `tddWorktreeCutoverSliceId: "<highest pre-worktree slice id>"` (auto-stamped for `worktree-first` legacy projects)
- `legacyContinuation: true` preserved; `worktreeExecutionMode: "worktree-first"` preserved.

`stage-complete tdd --json` will no longer fail with `tdd_slice_lane_metadata_missing` / `tdd_slice_claim_token_missing` / `tdd_lease_expired_unreclaimed` for slices closed before the cutover; remaining gate findings should be limited to the legitimate "TDD not yet complete — pending waves W-NN/W-MM" shape.

To revert to v6.14.1-style mandatory integration-overseer or `global-red` checkpoint:

```bash
npx cclaw-cli internal set-integration-overseer-mode always --reason="prefer mandatory dispatch"
npx cclaw-cli internal set-checkpoint-mode global-red --reason="prefer global RED checkpoint"
```

To clear `tdd.cohesion_contract_missing` advisory without hand-authoring a contract:

```bash
npx cclaw-cli internal cohesion-contract --stub --reason="legacy hox-shape project"
```

### Tests added

- **`tests/unit/v6-14-2-features.test.ts` (21 tests)** — wave-status helper (basic / closed-slice projection / missing managed block / cutover warning), Fix 1 + Fix 2 skill text checks, `tdd_cutover_misread_warning` advisory, both new mode-writer commands (parser + runner + sidecar refresh + internal command surface), `cohesion-contract --stub` (parser + writer + force semantics), GREEN evidence freshness contract (mismatch / missing-runner / too-fresh / observational escape), slice-implementer agent markdown documents the freshness contract.
- **`tests/e2e/tdd-auto-derive.test.ts` + `tests/e2e/slice-documenter-parallel.test.ts`** — updated to set `tddGreenMinElapsedMs: 0` in seeded `flow-state.json` and to provide passing-runner lines in `evidenceRefs[0]` so the freshness contract sees a realistic shape.
- **`tests/unit/tdd-controller-discipline.test.ts`** — version-regex relaxed from `(v6\.14\.1)` to `(v6\.14\.\d+)` so the v6.14.x stream stays green across patch bumps.

## 6.13.1 — Skill-text wave dispatch + mandatory worktree-first GREEN metadata

Follow-up to v6.13.0: real `/cc` runs could stay on the v6.12 single-slice ritual because the controller prioritized routing questions over the managed `## Parallel Execution Plan`, treated lane flags as optional hints, and wave detection only watched `wave-plans/wave-NN.md`. This release unifies wave sources, fixes plan parsing for markdown-bold bullets (`**Members:**`, `**dependsOn:**`, etc.), rewrites TDD/flow-start skill text, adds linters for ignored waves and missing GREEN lane metadata, and surfaces a sync hint when worktree-first mode sees a multi-member parallel plan.

### Phase A — Wave plan source unification

- **`parseParallelExecutionPlanWaves` + `extractMembersListFromLine`** (`src/internal/plan-split-waves.ts`) — Parses the managed Parallel Execution Plan block in `05-plan.md` (between `parallel-exec-managed` markers) with correct `**Members:**` line semantics; **`mergeParallelWaveDefinitions`** keeps Parallel Execution Plan primary and `wave-plans/` secondary with slice-level conflict errors.
- **`loadTddReadySlicePool` / `selectReadySlices`** (`src/delegation.ts`) — Consumes the merged manifest for scheduling-ready slices.

### Phase B — Skill-text rewrite

- **TDD skill** (`src/content/stages/tdd.ts`, `src/content/skills.ts`) — Rule 1: load Parallel Execution Plan + `wave-plans/` before routing; one AskQuestion when wave vs single-slice is a real choice; mandatory `--claim-token` / `--lane-id` / `--lease-until` on GREEN when `worktree-first`; provisional-then-finalize slice-documenter behavior spelled out.
- **`delegation-record` hook** (`src/content/hooks.ts`) — Fast `exit 2` with `dispatch_lane_metadata_missing` when worktree-first GREEN rows omit lane metadata.

### Phase C — Flow-start / `/cc` surface

- **`startCommandContract` / `startCommandSkillMarkdown`** (`src/content/start-command.ts`) — TDD resume path loads the Parallel Execution Plan and `wave-plans/` before slice routing; wave dispatch resume for partially closed waves.

### Phase D — Linter rules

- **`tdd_wave_plan_ignored`** (`src/artifact-linter/tdd.ts`) — Fires when an open wave has 2+ scheduler-ready slices but recent delegation tail shows `slice-implementer` for only one slice; lists missed members.
- **`tdd_slice_lane_metadata_missing`** — Fires under `worktree-first` when completed GREEN lacks `claimToken`, `ownerLaneId`, or `leasedUntil`.

### Phase E — Install / sync

- **`maybeLogParallelWaveDispatchHint`** (`src/install.ts`) — On sync/upgrade, prints a one-line hint when the active flow is `worktree-first` and the merged parallel plan has a multi-member wave. Existing `legacyContinuation` flows are not auto-flipped; operators use `cclaw internal set-worktree-mode` explicitly.

### Phase F — Tests

- **`tests/unit/parallel-exec-plan-parser.test.ts`** — Managed block parsing, duplicates, merge.
- **`tests/unit/tdd-wave-plan-ignored-linter.test.ts`**, **`tests/unit/tdd-slice-lane-metadata-linter.test.ts`** — New rule coverage.
- **`tests/e2e/start-command-wave-detection.test.ts`** — Start contract references wave plan + routing gate.
- **Updates** to `tests/e2e/tdd-wave-checkpoint.test.ts`, `tests/unit/plan-split-waves.test.ts`, and **`parseImplementationUnitParallelFields`** bold-bullet fix so `**dependsOn:**` / `**claimedPaths:**` lines parse like emitted plan templates.

## 6.13.0 — Worktree-First Multi-Slice Parallel TDD

Phases 0–7 ship conflict-aware planning, git-backed worktree lanes with claim/lease metadata, a DAG-ready `selectReadySlices` helper, deterministic `git apply --3way` fan-in at TDD stage-complete (never `-X ours/theirs`), `cclaw_fanin_*` audit rows, hardened TDD linters for worktree-first mode, `cclaw internal set-worktree-mode`, and `sync` migration that sets `legacyContinuation` when `05-plan.md` predates v6.13 parallel bullets. Phase 8 (sunset) is explicitly deferred to v6.14.

### Phase 0 — Spec + plan stage upgrades

- **`04-spec.md` template + `spec` stage** — Acceptance Criteria gain `parallelSafe` and `touchSurface` columns for slice planning. Advisory `spec_acs_not_sliceable` in `src/artifact-linter/spec.ts` when those columns are missing on standard expectations.
- **Plan artifacts** — Implementation units require `id`, `dependsOn`, `claimedPaths`, `parallelizable`, `riskTier`, optional `lane`; `plan-split-waves` builds conflict-aware waves (topo-sort + disjoint `claimedPaths`, default cap 5) and managed `## Parallel Execution Plan` blocks. New plan linter rules: `plan_units_missing_dependsOn`, `plan_units_missing_claimedPaths`, `plan_units_missing_parallel_metadata`, advisory `plan_no_parallel_lanes_detected`, degrading to advisory under `legacyContinuation` for existing units only.

### Phase 1 — Control plane (claims / leases)

- **`DelegationEntry`** extended with `claimToken`, `ownerLaneId`, `leasedUntil`, `leaseState`, `dependsOn`, `integrationState`, `resolve-conflict` phase; `DispatchClaimInvalidError` for mismatched terminal claims; `reclaimExpiredDelegationClaims` writes `cclaw_slice_lease_expired` audits.
- **`flow-state.json`** — optional `worktreeExecutionMode` (`single-tree` | `worktree-first`) and `legacyContinuation`; omitted mode stays `single-tree` via `effectiveWorktreeExecutionMode`; fresh runs from `start-flow` default `worktree-first`.
- **Hooks** — `delegation-record` accepts `--claim-token`, `--lane-id`, `--lease-until`, `--depends-on`, `--integration-state`.

### Phase 2 — Worktree lane manager

- **`src/worktree-types.ts`**, **`src/worktree-manager.ts`** — `createLane`, `verifyLaneClean`, `attachLane` / `detachLane`, `cleanupLane`, `pruneStaleLanes` under `.cclaw/worktrees/` with `cclaw/lane/<sliceId>-*` branches; submodule-safe cleanup; worktrees ignored as managed-generated noise in `managed-resources`.

### Phase 3 — Multi-slice scheduler

- **`selectReadySlices`** in `src/delegation.ts` — pure scheduler over `ReadySliceUnit[]` with legacy `parallelizable` filtering; numeric `U-*` ordering via `compareCanonicalUnitIds`.
- **`parseImplementationUnitParallelFields(..., { legacyParallelDefaultSerial })`** — defaults missing `parallelizable` bullets to `false` under legacy continuation.
- **TDD skill / stage text** — Wave Batch Mode v6.13+ describes RED checkpoint, parallel fan-out, per-lane refactor, deterministic fan-in; slice-documenter may stay provisional until GREEN.

### Phase 4 — Deterministic fan-in + resolver hints

- **`src/integration-fanin.ts`** — `fanInLane` uses merge-base when `baseRef` omitted, restores prior branch on apply failure; `runTddDeterministicFanInBeforeAdvance` merges lanes before leaving TDD; `recordCclawFanInAudit` / `readDelegationEvents().fanInAudits`; `buildResolveConflictDispatchHint`.
- **`advance-stage`** — after validation, before persisting state when leaving TDD, runs fan-in + `verifyTddWorktreeFanInClosure`.
- **`verifyTddWorktreeFanInClosure`** in `src/gate-evidence.ts` — lane-backed closed slices require `cclaw_fanin_applied`.

### Phase 5 — Linter / gates hardening

- **TDD linter** — `tdd_slice_claim_token_missing`, `tdd_slice_worktree_metadata_missing` (worktree-first), `tdd_fanin_conflict_unresolved` (delegation `integrationState` + `cclaw_fanin_conflict` audits), `tdd_lease_expired_unreclaimed`.

### Phase 6 — Rollout

- **`cclaw internal set-worktree-mode --mode=single-tree|worktree-first`** — `src/internal/set-worktree-mode.ts`.
- **Tests** — `select-ready-slices.test.ts`, `plan-v613-metadata.test.ts`, `fanin-audit.test.ts` (fan-in audits + closure).

### Phase 7 — Legacy continuation (hox)

- **`applyPlanLegacyContinuationIfNeeded`** in `src/install.ts` — when `05-plan.md` lacks v6.13 bullets on any unit, inserts legacy banner + empty Parallel Execution Plan stub and sets `flow-state.legacyContinuation` when state exists; plan linter degradation per Phase 0.

### Follow-ups (v6.13.1 candidates)

- Narrow `git clean` / conflict recovery UX if users report partial apply residue beyond `git checkout -- .`.
- E2e exercises that run full `git worktree` fan-in in CI (optional `git` skip patterns).

## 6.12.0 — TDD Velocity Honest (Decouple from discoveryMode + Mandatory Roles + Wave Checkpoint + Auto-cutover)

Follow-up to v6.11.0 that closes the back doors observed on a fresh hox flow run (slice S-11 went GREEN with no `--phase` events, no `slice-implementer` dispatch, no `slice-documenter`, and 12+ hand-edited per-slice sections in `06-tdd.md`). v6.12.0 makes that path impossible by promoting `slice-implementer` and `slice-documenter` to mandatory regardless of `discoveryMode`, adding three new linter rules (`tdd_slice_documenter_missing` decoupled from `deep`, `tdd_slice_implementer_missing`, `tdd_red_checkpoint_violation`) plus an advisory backslide rule (`tdd_legacy_section_writes_after_cutover`), rewriting the TDD skill to teach the per-slice ritual + wave batch mode imperatively, and shipping a one-shot `cclaw-cli sync` auto-cutover that pins legacy projects to a `tddCutoverSliceId` boundary so existing slices keep validating while new ones must use the new protocol.

### Phase R — Decouple slice-documenter from discoveryMode

- **Rule renamed `tdd_slice_documenter_missing_for_deep` → `tdd_slice_documenter_missing`** in `src/artifact-linter/tdd.ts`. The `discoveryMode === "deep"` branch is removed; the rule is now `required: true` on lean / guided / deep alike. `discoveryMode` keeps its meaning as the early-stage shaping knob (brainstorm / scope / design); TDD parallelism is uniform across all modes.
- **`src/content/stages/tdd.ts` Required Evidence** — the conditional bullet (`On discoveryMode=deep: per slice, a phase=doc event ...`) is replaced with a flat bullet that requires the `phase=doc` event regardless of mode. Brainstorm / scope / design skill files are untouched.

### Phase M — Mandatory slice-implementer + slice-documenter

- **`STAGE_AUTO_SUBAGENT_DISPATCH.tdd`** in `src/content/stage-schema.ts` — `slice-implementer` is promoted from `mode: "proactive"` to `mode: "mandatory"` ("Always for GREEN and REFACTOR phases. Controller MUST NOT write production code itself."). A new `slice-documenter` row is added at `mode: "mandatory"` ("Always in PARALLEL with `slice-implementer --phase green` for the same slice."). `defaultReturnSchemaForAgent` and `dispatchClassForRow` learn the new agent so worker payloads validate.
- **`StageSubagentName`** in `src/content/stages/schema-types.ts` gains the `"slice-documenter"` member.
- **New linter rule `tdd_slice_implementer_missing`** (`src/artifact-linter/tdd.ts::evaluateSliceImplementerCoverage`) — for every slice with a `phase=red` event carrying non-empty `evidenceRefs`, a matching `phase=green` event whose `agent === "slice-implementer"` is required. Catches "controller wrote GREEN itself", the most common backslide observed before v6.12.0.

### Phase Ritual — Per-Slice Ritual block + Checklist 14 rewrite

- **New top-of-skill `## Per-Slice Ritual (v6.12.0+)` block** rendered by `tddTopOfSkillBlock` in `src/content/skills.ts`, injected immediately after the `<EXTREMELY-IMPORTANT>` Iron Law and before `## Quick Start`. Imperative voice, literal `Task(...)` commands, explicit FORBIDDEN list (controller writing GREEN, controller writing per-slice prose, hand-editing auto-render blocks). One-line delegation-record signature.
- **Checklist step 14** in `src/content/stages/tdd.ts` is rewritten from "Record evidence — capture test discovery, system-wide impact check, RED failure, GREEN output, REFACTOR notes in the TDD artifact" to "**slice-documenter writes per-slice prose** (test discovery, system-wide impact check, RED/GREEN/REFACTOR notes, acceptance mapping, failure analysis) into `tdd-slices/S-<id>.md`. Controller does NOT touch this content." The DOC parallel-dispatch instruction is updated to mandatory in lockstep.
- **`watchedFailProofBlock`** in `src/content/skills.ts` is rewritten to describe the three-dispatch ritual and reaffirm that `slice-implementer` and `slice-documenter` are mandatory regardless of `discoveryMode`.
- **TDD `BEHAVIOR_ANCHORS` entry** in `src/content/examples.ts` is expanded from a Watched-RED-only example to a full slice cycle Bad/Good with mandatory parallel GREEN+DOC dispatch.

### Phase W — Wave Batch Mode + RED checkpoint

- **New top-of-skill `## Wave Batch Mode (v6.12.0+)` block** in `src/content/skills.ts`. Trigger: any `<artifacts-dir>/wave-plans/wave-NN.md` exists, OR 2+ slices have disjoint `claimedPaths`. Phase A — RED checkpoint (one message, all `test-author --phase red`); Phase B — GREEN+DOC fan-out (one message, paired implementer+documenter Tasks per slice); fan-in via `integration-overseer`. Cap = 5 `slice-implementer` lanes (10 subagents counting paired documenters) per `MAX_PARALLEL_SLICE_IMPLEMENTERS`.
- **New linter rule `tdd_red_checkpoint_violation`** (`src/artifact-linter/tdd.ts::evaluateRedCheckpoint`) — for every wave (explicit `wave-plans/wave-NN.md` manifest if present, otherwise implicit-wave fallback for 2+ contiguous reds), a `phase=green` event with `completedTs` BEFORE the wave's last `phase=red` `completedTs` is a `required: true` blocker. Sequential single-slice runs (red→green→red→green) form size-1 implicit waves and never fire.

### Phase L — Cutover backslide advisory

- **New advisory `tdd_legacy_section_writes_after_cutover`** (`src/artifact-linter/tdd.ts::evaluateLegacySectionBackslide`) — reads `flow-state.json::tddCutoverSliceId` (e.g. `"S-10"`) and surfaces an advisory `required: false` finding when slice ids `> cutover` appear in legacy per-slice sections of `06-tdd.md` (Test Discovery / RED Evidence / GREEN Evidence / Watched-RED Proof / Vertical Slice Cycle / Per-Slice Review / Failure Analysis / Acceptance Mapping). Post-cutover prose belongs in `tdd-slices/S-<id>.md`.

### Phase A — `cclaw-cli sync` auto-cutover for existing TDD flows

- **`FlowState.tddCutoverSliceId?: string`** added to `src/flow-state.ts`. `src/run-persistence.ts::coerceFlowState` rehydrates the field via a new `coerceTddCutoverSliceId` validator (canonical `S-<digits>` shape only).
- **New `applyTddCutoverIfNeeded`** in `src/install.ts` — when `cclaw-cli sync` (or `upgrade`) detects an `06-tdd.md` artifact without auto-render markers but with observable slice activity (`S-N` referenced ≥3 times), it inserts a one-line cutover banner, the v6.11.0 `<!-- auto-start: slices-index -->` and `<!-- auto-start: tdd-slice-summary -->` marker skeleton, mkdir's `tdd-slices/`, and stamps the highest legacy slice id into `flow-state.json::tddCutoverSliceId`. Idempotent: re-running sync is byte-stable once markers are present.

### Migration notes

- **Existing TDD flows mid-stage (hox-style)** — run `npx cclaw-cli@6.12.0 upgrade && npx cclaw-cli@6.12.0 sync`. The cutover marker pins legacy slices (≤ `tddCutoverSliceId`) so they keep validating via the legacy markdown table fallback. New slices (> `tddCutoverSliceId`) MUST use the new protocol: per-slice phase events, `slice-implementer` for GREEN/REFACTOR, `slice-documenter` for `phase=doc` writing into `tdd-slices/S-<id>.md`.
- **Breaking** — controllers that wrote GREEN themselves are now blocked by `tdd_slice_implementer_missing` (required: true). Mitigated by the cutover marker for legacy slices on existing projects, but new projects and new slices on existing projects must dispatch `slice-implementer` for every GREEN.
- **Breaking** — `tdd_slice_documenter_missing` is now required on lean / guided / deep. Previous v6.11.0 advisory behavior on non-deep modes is removed.
- **`flow-state.json::tddCutoverSliceId`** is additive and optional; existing files without the field continue to load. The field is canonical only when `S-<digits>` (e.g. `"S-10"`); other shapes are dropped on coerce.

### Tests

- **`tests/unit/tdd-slice-documenter-mandatory.test.ts`** — `tdd_slice_documenter_missing` is required on lean / guided / deep, and clears when `slice-documenter` records `phase=doc`.
- **`tests/unit/tdd-slice-implementer-mandatory.test.ts`** — `evaluateSliceImplementerCoverage` unit cases (controller-authored green flagged, slice-implementer-authored green accepted, empty-evidence reds ignored) plus a linter integration test that emits `tdd_slice_implementer_missing` when the controller writes GREEN itself.
- **`tests/unit/tdd-cutover-backslide-detection.test.ts`** — `tdd_legacy_section_writes_after_cutover` advisory emits when post-cutover slice ids appear in legacy sections, stays silent without a marker, stays silent when all slice ids are ≤ cutover.
- **`tests/unit/tdd-red-checkpoint-validation.test.ts`** — `evaluateRedCheckpoint` happy + unhappy paths for both implicit-wave and explicit-wave-manifest modes; sequential single-slice runs do not fire.
- **`tests/e2e/tdd-wave-checkpoint.test.ts`** — three slices, explicit `wave-plans/wave-01.md` manifest declaring W-01 membership, controller jumps S-1 to GREEN before S-3's RED → linter blocks with `tdd_red_checkpoint_violation`. Clean wave (all reds, then all greens) returns no finding.
- **`tests/e2e/sync-tdd-cutover.test.ts`** — fixture has legacy 06-tdd.md with S-1..S-10, `cclaw-cli sync` inserts banner + markers + `tdd-slices/` + `flow-state.tddCutoverSliceId="S-10"`, second sync is byte-stable, no-activity artifacts skip cleanly.
- **`tests/e2e/tdd-mandatory-roles-end-to-end.test.ts`** — full happy path for two slices: Phase A (test-author/RED for both) → Phase B (slice-implementer/GREEN + slice-documenter/DOC, paired per slice) → REFACTOR. Linter accepts the artifact: no `tdd_slice_implementer_missing`, no `tdd_slice_documenter_missing`, no `tdd_red_checkpoint_violation`.
- **Skill size budget** in `tests/unit/skill-size.test.ts` bumped 480 → 520 lines for the TDD-only top-of-skill ritual + wave batch mode blocks. Other stages unchanged.

## 6.11.0 — TDD Honest Velocity (Rollback + Auto-derive + Slice-documenter + Sharded Files)

Four-phase release that rolls back the v6.10.0 sidecar (Phase T1+T2) as architecturally wrong and replaces it with a delegation-events driven flow. The TDD linter now reads `.cclaw/state/delegation-events.jsonl` slice phase rows as the source of truth for Watched-RED Proof and Vertical Slice Cycle, auto-renders both blocks into `06-tdd.md`, supports a parallel `slice-documenter` agent for per-slice prose, and accepts sharded `tdd-slices/S-<id>.md` files alongside the thinned main artifact.

### Phase R — v6.10.0 sidecar rollback

- **Removed `cclaw-cli internal tdd-slice-record`** — the sub-command, its parser, and the entire `src/tdd-slices.ts` module (`TddSliceLedgerEntry`, `appendSliceEntry`, `readTddSliceLedger`, `foldTddSliceLedger`, lock paths) are gone. The dispatcher in `src/internal/advance-stage.ts` no longer references the sidecar.
- **Linter sidecar branch removed** — `lintTddStage` no longer reads `06-tdd-slices.jsonl` or emits the `tdd_slice_ledger_missing` advisory.
- **Sidecar tests removed** — `tests/unit/tdd-slice-record.test.ts`, `tests/unit/tdd-linter-sidecar.test.ts`, and `tests/e2e/tdd-sidecar.test.ts` are deleted. They are replaced by Phase D / Phase C / Phase S coverage below.
- **Runtime cleanup of `06-tdd-slices.jsonl`** — `src/install.ts` adds `06-tdd-slices.jsonl` to a new `DEPRECATED_ARTIFACT_FILES` list so `cclaw-cli sync` removes the file from existing installs (mirrors how `tdd-cycle-log.jsonl` was retired in v6.9.0).

#### Phase R — Migration notes

- **The v6.10.0 sidecar (`06-tdd-slices.jsonl`) is deprecated and removed by `cclaw-cli sync`.** No production users exist (it was opt-in for a single release). Running the next `sync` cleans the file; the slice phase data lives in `delegation-events.jsonl` from now on.
- **`cclaw-cli internal tdd-slice-record` is removed.** Replace any per-slice `--status` calls with controller dispatches: `test-author --slice S-N --phase red`, `slice-implementer --slice S-N --phase green`, then `--phase refactor` or `--phase refactor-deferred --refactor-rationale "<why>"`. The harness-generated `delegation-record` hook accepts the new flags (`--slice`, `--phase`, `--refactor-rationale`) and writes the slice phase event for you.

### Phase D — Auto-derive document sections

- **`DelegationEntry` gains optional `sliceId` and `phase` fields (D1)** — `src/delegation.ts` extends the entry with `sliceId?: string` and `phase?: "red" | "green" | "refactor" | "refactor-deferred" | "doc"`. `isDelegationEntry` validates both when present. The inline copy inside `src/content/hooks.ts::delegationRecordScript` is updated in lockstep.
- **`delegation-record` hook accepts `--slice`/`--phase`/`--refactor-rationale` (D2)** — generated script validates `--phase` against the enum, requires `--slice` to be a non-empty string, and hard-errors when `--phase=refactor-deferred` is passed without rationale via either `--refactor-rationale` or `--evidence-ref`. Rationale text gets merged into `evidenceRefs[]` so downstream linter logic finds it without a new field.
- **Skill / controller / subagent text refresh (D3)** — `src/content/stages/tdd.ts` checklist + interactionProtocol now describe the slice-tagged dispatch flow; `sliceImplementerEnhancedBody()` and `testAuthorEnhancedBody()` in `src/content/subagents.ts` instruct agents not to hand-edit the auto-rendered tables; `src/content/skills.ts::watchedFailProofBlock()` and the TDD entry in `BEHAVIOR_ANCHORS` (`src/content/examples.ts`) are updated to match.
- **Linter auto-derive in `lintTddStage` (D4)** — `src/artifact-linter/tdd.ts` reads `delegation-events.jsonl`, groups events by `sliceId`, and validates phase invariants (`phase=red` evidenceRefs/completedTs, monotonic `phase=green` after `phase=red`, REFACTOR present via `phase=refactor` or `phase=refactor-deferred` with rationale). When at least one slice carries phase events, the linter auto-renders `## Vertical Slice Cycle` between `<!-- auto-start: tdd-slice-summary -->` markers in `06-tdd.md`. Re-render is idempotent. With no slice phase events, the linter falls back to the legacy markdown table parsers.
- **RED/GREEN evidence validators auto-pass on phase events (D5)** — `validateTddRedEvidence` and `validateTddGreenEvidence` accept a `phaseEventsSatisfied` flag. `resolveTddEvidencePointerContext` in `src/artifact-linter.ts` reads delegation events and sets the flag when the active run has a `phase=red` (or `phase=green`) row with non-empty `evidenceRefs`. The existing `Evidence: <path>` and `Evidence: spanId:<id>` pointer mode (v6.10.0 T3) stays as a secondary fallback.
- **Trimmed `06-tdd.md` template (D6)** — the per-slice `## Watched-RED Proof` and `## Vertical Slice Cycle` tables are removed; auto-render markers (`<!-- auto-start: tdd-slice-summary -->` and `<!-- auto-start: slices-index -->`) are inserted in their place. `## Test Discovery` is now an overall narrative placeholder; per-slice details live in sharded slice files (Phase S). `## RED Evidence` and `## GREEN Evidence` headings remain as legacy-fallback slots: phase events auto-satisfy them, but legacy artifacts with hand-edited tables continue to validate through the original markdown path.

#### Phase D — Migration notes

- **`DelegationEntry.sliceId` and `DelegationEntry.phase` are optional and additive.** Existing ledgers and tools continue to round-trip without change.
- **`06-tdd.md` template lost the per-slice Watched-RED Proof + Vertical Slice Cycle blocks.** Existing artifacts that still have those tables filled in continue to validate via the legacy markdown fallback. Once the controller starts dispatching with `--slice/--phase`, the auto-rendered block becomes the source of truth.
- **The linter now treats `delegation-events.jsonl` as the primary source of truth for TDD slice phases.** `Evidence: <path|spanId:...>` markdown pointers and the legacy markdown tables remain valid fallbacks when no phase events are recorded.

### Phase C — `slice-documenter` parallel subagent

- **New `slice-documenter` agent in `src/content/core-agents.ts` (C1+C4)** — focused single-slice agent. Allowed paths: only `<artifacts-dir>/tdd-slices/S-<id>.md`. Return contract: `{ summaryMd: string, learnings: string[] }`. Definition is materialized to `agents/slice-documenter.md` by `cclaw-cli sync` like every other entry in `CCLAW_AGENTS`.
- **Parallel-with-implementer wiring (C2+C3)** — TDD stage skill (`src/content/stages/tdd.ts`) and shared TDD skill text (`src/content/skills.ts`) instruct the controller to dispatch `slice-documenter --slice S-N --phase doc` IN PARALLEL with `slice-implementer --phase green`. Because the documenter only touches `tdd-slices/S-<id>.md` and the implementer touches production code, the file-overlap scheduler auto-allows the parallel dispatch. `lintTddStage` adds the `tdd_slice_documenter_missing_for_deep` finding: `required: true` only when `discoveryMode=deep`, advisory otherwise.

#### Phase C — Migration notes

- **`slice-documenter` is opt-in.** Standard / lean / guided runs treat the missing `phase=doc` event as advisory; only `discoveryMode=deep` requires per-slice prose. Existing flat `06-tdd.md` flow remains valid for the other modes.

### Phase S — Sharded slice files

- **`tdd-slices/S-<id>.md` convention (S1+S2+S3)** — `src/content/templates.ts` adds a `tddSliceFileTemplate(sliceId)` helper with the canonical structure: `# Slice S-N`, `## Plan unit`, `## Acceptance criteria`, `## Why this slice`, `## What was tested`, `## What was implemented`, `## REFACTOR notes`, `## Learnings`. The main `06-tdd.md` template stays thin and exposes a `<!-- auto-start: slices-index -->` block that the linter populates with links to present slice files.
- **Linter multi-file support (S4)** — `lintTddStage` globs `<artifacts-dir>/tdd-slices/S-*.md`, validates required headings (`# Slice`, `## Plan unit`, `## REFACTOR notes`, `## Learnings`) per file, and emits `tdd_slice_file:<id>` findings (`required: true` only for slices that have a `phase=doc` event; advisory otherwise). The `## Slices Index` block is auto-rendered idempotently between markers and skipped entirely when no slice files exist.
- **`tdd-render` CLI (S5) — skipped.** The linter already auto-renders the slice summary directly into `06-tdd.md` on every lint pass, so the optional `cclaw-cli internal tdd-render` derived-view CLI was unnecessary for the live source of truth and was deferred. If a `06-tdd-rendered.md` artifact becomes useful later it can be added without touching the v6.11.0 contract.

#### Phase S — Migration notes

- **`tdd-slices/` is optional.** Existing flat `06-tdd.md` flow keeps working; the directory is only required when `slice-documenter` runs (mandatory on `discoveryMode=deep`, advisory otherwise). When the directory is absent or empty, the main `## Slices Index` auto-block stays untouched.

### Tests

- **New unit suite `tests/unit/tdd-events-derive.test.ts`** — covers events-only path (no markdown tables), idempotent auto-render, phase-order monotonicity, refactor-deferred rationale, legacy markdown fallback, RED/GREEN auto-pass on phase events, slice-documenter coverage on `discoveryMode=deep`, and `DelegationEntry.sliceId/phase` round-trip.
- **New e2e suite `tests/e2e/tdd-auto-derive.test.ts`** — drives the inline `delegation-record.mjs` script for three slices via `--slice/--phase`, asserts the linter renders `## Vertical Slice Cycle` populated with all three slices and accepts the artifact without filling markdown tables.
- **New e2e suite `tests/e2e/slice-documenter-parallel.test.ts`** — runs the full `scheduled → launched → acknowledged → completed` lifecycle for parallel `slice-implementer` (production code) and `slice-documenter` (`tdd-slices/S-1.md`) on the same slice. Confirms the file-overlap scheduler auto-promotes `allowParallel` without `--allow-parallel`, both lifecycles end up in `delegation-events.jsonl` and `delegation-log.json`, the linter passes on `discoveryMode=deep`, and `--phase=refactor-deferred` without rationale or evidence-ref blocks the dispatch.
- **New e2e suite `tests/e2e/sharded-slice-files.test.ts`** — three `tdd-slices/S-1.md`, `S-2.md`, `S-3.md` files lint clean and auto-render the `## Slices Index` block (idempotent on re-render). A second test confirms the linter blocks when a slice file referenced by a `phase=doc` event omits the required `## Plan unit`, `## REFACTOR notes`, or `## Learnings` headings (`tdd_slice_file:S-1` blocking finding).

## 6.10.0 — TDD Velocity (Sidecar + Parallel Scheduler + Wave Split)

Two-phase release that thins TDD documentation overhead and unlocks deliberate parallel slice execution. Phase T moves per-slice RED/GREEN/REFACTOR truth from the markdown tables in `06-tdd.md` into a structured append-only sidecar, recorded by a new internal CLI. The linter becomes sidecar-aware: when the sidecar is populated the markdown tables are auto-derived views; when it is empty the legacy markdown rules continue to fire. Phase P introduces a file-overlap scheduler and a fan-out cap so multiple `slice-implementer` subagents can run safely in parallel, plus a new `plan-split-waves` CLI to break large plans into manageable wave files.

### Phase T — TDD Documentation Thinning

- **`06-tdd-slices.jsonl` slice ledger sidecar (T1)** — new file under `<artifacts-dir>/06-tdd-slices.jsonl`. Each row carries `runId`, `sliceId`, `status` (`red|green|refactor-deferred|refactor-done`), `testFile`, `testCommand`, `claimedPaths`, optional `redObservedAt`/`greenAt`/`refactorAt` ISO timestamps, optional `redOutputRef`/`greenOutputRef`/`refactorRationale`, optional `acceptanceCriterionId`/`planUnitId`, and `schemaVersion: 1`. Implemented in `src/tdd-slices.ts` with `appendSliceEntry`, `readTddSliceLedger`, `foldTddSliceLedger`, and the new internal CLI sub-command `cclaw-cli internal tdd-slice-record`. Atomic append under `withDirectoryLock` plus a row-equivalence dedup makes retries idempotent. Status transitions inherit `testFile`/`testCommand`/`claimedPaths` from prior rows so `green`/`refactor-*` calls stay terse.
- **Linter sidecar awareness in `src/artifact-linter/tdd.ts` (T2)** — `lintTddStage` reads the sidecar before evaluating `Watched-RED Proof Shape` and `Vertical Slice Cycle Coverage`. With sidecar rows, validation runs against the JSONL: every entry with status ≥ `red` must carry `redObservedAt`, `testFile`, `testCommand`, `claimedPaths`; `green` must satisfy `greenAt ≥ redObservedAt`; `refactor-deferred` requires a non-empty `refactorRationale`; `refactor-done` requires `refactorAt ≥ greenAt`. With no sidecar rows, the legacy markdown table parsers stay in charge. A new advisory `tdd_slice_ledger_missing` (`required: false`) fires when the markdown tables are filled but the sidecar is empty, nudging the agent toward the new CLI without blocking the gate.
- **RED/GREEN evidence pointer mode (T3)** — `validateTddRedEvidence` and `validateTddGreenEvidence` accept a `TddEvidencePointerOptions` bag. When the markdown body carries `Evidence: <relative-or-abs-path>` or `Evidence: spanId:<id>` and the path resolves on disk or the spanId matches a `delegation-events.jsonl` row, the validator short-circuits without requiring pasted stdout. Sidecar `redOutputRef`/`greenOutputRef` auto-satisfy the markdown evidence rule even without an explicit pointer. The pointer resolver lives in `src/artifact-linter.ts::resolveTddEvidencePointerContext` so per-rule async work runs once.
- **Per-slice Execution Posture removed from `06-tdd.md` (T4)** — the per-slice checkpoint block was a duplicate of the plan-stage Execution Posture and the new sidecar; only the plan-stage block remains. Schema (`src/content/stages/tdd.ts`) and template (`src/content/templates.ts`) updated in lockstep.
- **`Acceptance Mapping` + `Failure Analysis` merged into `Acceptance & Failure Map` (T5)** — `06-tdd.md` now ships a single `## Acceptance & Failure Map` table with columns `Slice | Source ID | AC ID | Expected behavior | RED-link`. The RED-link column accepts a delegation `spanId:<id>`, an `<artifacts-dir>/<file>` path, or a sidecar `redOutputRef`. Schema entry switched to `Acceptance & Failure Map` (`required: false` standard, `required: true` quick), with the validation rule rewritten accordingly. Template, examples, and reference patterns updated to match.
- **Skill text + behavior anchor refresh (T6)** — `sliceImplementerEnhancedBody()` and `testAuthorEnhancedBody()` in `src/content/subagents.ts` now instruct the agent to call `cclaw-cli internal tdd-slice-record` after RED/GREEN/REFACTOR transitions instead of editing the Watched-RED / Vertical Slice Cycle markdown tables. `src/content/stages/tdd.ts` checklist mirrors the change. `src/content/skills.ts::watchedFailProofBlock()` adds a one-line directive to use the sidecar from v6.10.0 onward. The TDD entry in `BEHAVIOR_ANCHORS` (`src/content/examples.ts`) now contrasts manual table editing (bad) with the CLI invocation (good).

#### Phase T — Migration notes

- **Markdown tables remain optional and lint as before.** Existing TDD artifacts that still use the Watched-RED Proof / Vertical Slice Cycle / RED Evidence / GREEN Evidence markdown tables continue to pass the linter. The sidecar is opt-in: until you write rows via `cclaw-cli internal tdd-slice-record`, nothing changes for legacy runs.
- **Migration is opt-in.** A one-shot importer (`tdd-slices-import` from existing markdown tables) is **not** part of this release; it is deferred to v6.11. To migrate a stage, dispatch `cclaw-cli internal tdd-slice-record --slice <id> --status <red|green|refactor-done|refactor-deferred> ...` per slice and accept that the markdown tables become auto-derived. The advisory `tdd_slice_ledger_missing` will surface as a non-blocking finding while you migrate.
- **`Acceptance Mapping` and `Failure Analysis` headings are no longer schema rows in TDD.** Plans that included them before will keep the prose; the merged `Acceptance & Failure Map` is now the only schema-recognized name. Quick-track TDD upgrades the merged section to `required: true`.

### Phase P — Parallel Scheduling

- **File-overlap scheduler (P1)** — `DelegationEntry` gains an optional `claimedPaths: string[]` field (kept in sync with the inline copy in `src/content/hooks.ts::delegationRecordScript`). `validateFileOverlap` in `src/delegation.ts` runs before the legacy duplicate-dispatch guard for `slice-implementer` rows on the TDD stage: disjoint paths auto-set `allowParallel: true` so the new row bypasses `DispatchDuplicateError`; overlapping paths throw the new `DispatchOverlapError` with the conflicting paths and the existing spanId. The hook script accepts `--paths=<comma-separated>` and persists `claimedPaths` on the row. Plan parser already requires the `Files` field per Implementation Unit, so per-unit paths surface naturally.
- **Max active fan-out cap (P2)** — `MAX_PARALLEL_SLICE_IMPLEMENTERS = 5` in `src/delegation.ts`, with override via `process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS` (parsed integer, validated `>= 1`). The hook script accepts `--override-cap=N` for one-shot bypass. `validateFanOutCap` throws the new `DispatchCapError` when the active `slice-implementer` count would exceed the cap. The hook script contains an inline mirror of the same logic so the dispatch-record subprocess enforces the cap before writing.
- **`cclaw-cli internal plan-split-waves` (P3)** — `src/internal/plan-split-waves.ts` reads `<artifacts-dir>/05-plan.md`, parses `## Implementation Units`, and splits into `<artifacts-dir>/wave-plans/wave-NN.md` files. Flags: `--wave-size=<N>` (default 25), `--dry-run`, `--force`, `--json`. Plans with fewer than 50 units no-op with a JSON outcome `smallPlanNoOp: true`. Each wave file carries a `Source: 05-plan.md units U-X..U-Y` header. The plan artifact gains a managed `## Wave Plans` section between `<!-- wave-split-managed-start -->` / `<!-- wave-split-managed-end -->` markers; subsequent runs replace only the managed block and preserve all other content.
- **`plan_too_large_no_waves` advisory (P4)** — `lintPlanStage` emits this `required: false` finding when the plan has more than 50 implementation units AND `<artifacts-dir>/wave-plans/` is empty (or contains no `wave-NN.md`). The advisory text suggests running `plan-split-waves`; it never blocks stage-complete.

#### Phase P — Migration notes

- **`Files:` per-unit field is optional.** Existing plans without `Files: <a>, <b>` lines (or the legacy `- **Files (repo-relative; never absolute):**` block) continue to lint as today; the file-overlap scheduler simply has no `claimedPaths` to compare and the legacy duplicate-dispatch guard takes over.
- **Slice-implementer fan-out is now capped at 5.** The cap matches evanflow's parallel limit. To raise it for a single dispatch pass `--override-cap=N` to `delegation-record`; to raise it globally for the run, set `CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS=10` (any integer ≥ 1) in the parent environment. Disjoint `claimedPaths` are still required regardless of the cap.
- **New CLI subcommand: `plan-split-waves`.** `cclaw-cli internal plan-split-waves --wave-size=25 --dry-run` previews the split without writing. The first non-dry-run invocation creates `wave-plans/` and adds the managed Wave Plans block to the plan; subsequent invocations refresh that block in place.

## 6.9.0 — Runtime Honesty (Purge + R7 Fix + Schema + Skill Align + TDD Hardening)

Five-phase release tightening the gap between what the runtime promises in skills/docs and what it actually does at execution time. Phase A removes large blocks of orphaned code so the runtime can no longer crash through unreachable paths. Phase B fixes the R7 regressions where stale ledger rows blocked fresh dispatches and `subagents.json` showed terminal spans as still active. Phase C repairs schema drift in `flow-state.json` and `early-loop.json`. Phase D re-aligns skill copy with the new runtime behavior (iron laws actually loaded, parallel-implementer rules stated explicitly, "Ralph-Loop" terminology disambiguated). Phase E hardens the TDD linter so claims about RED→GREEN→REFACTOR ordering, investigation evidence, layered review structure, supply-chain drift, and verification status are all checked rather than implied.

### Phase A — Dead-code Purge

- **`src/content/node-hooks.ts`** — `main()` only ever dispatches `session-start` and `stop-handoff` after Wave 22; all other handlers (`handlePromptGuard`, `handleWorkflowGuard`, `handlePreToolPipeline`, `handlePromptPipeline`, `handleContextMonitor`, `handleVerifyCurrentState`, `handlePreCompact`) and their helpers (`hasFailingRedEvidenceForPath`, `reviewCoverageComplete`, `strictLawSet`, `lawIsStrict`, `isTestPayload`, `isProductionPath`, path-matching utilities, and the orphaned `appendJsonLine`) have been removed. `mapHookNameToCodexEvent` and `parseHookKind` are trimmed to the surviving names. The hook-name array near the top of the file is reduced to `["session-start", "stop-handoff"]`.
- **`scheduleSessionDigestRefresh` removed** — the forked-child digest-refresh path was crashing on usage and is no longer invoked from `handleSessionStart`. The associated `session-start-refresh` hook event was unreachable; both the implementation and the dispatch entry are gone.
- **`src/install.ts`** — `managedGitRuntimeScript`, `managedGitRelayHook`, `syncManagedGitHooks`, and the `MANAGED_GIT_*` constants are removed. `init`/`sync`/`uninstall` no longer install `.cclaw/git-hooks/*`. A new `cleanupLegacyManagedGitHookRelays` helper purges the legacy directory on existing installs so they self-heal on the next `cclaw-cli sync`.
- **`src/gate-evidence.ts` `tdd-cycle-log.jsonl` block removed** — the substring-based JSONL order check is gone. The corresponding `parseTddCycleLog` / `validateTddCycleOrder` imports are dropped. The `tdd-cycle-log.jsonl` file (and the `tdd-cycle-log` skill folder) are added to `DEPRECATED_STATE_FILES` / `DEPRECATED_SKILL_FOLDERS_FULL` so existing installs purge them on sync.
- **Hook profile honored at `main()`** — `isHookDisabled` / `CCLAW_HOOK_PROFILE` / `CCLAW_DISABLED_HOOKS` are now consulted before dispatching `session-start` / `stop-handoff`. Disabled hooks exit `0` quietly. `tests/unit/node-hook-runtime.test.ts` exercises env-disable, profile-minimal, and config-disabled paths.

#### Phase A — Migration notes

- **Removed runtime hooks**: `prompt-guard`, `workflow-guard`, `pre-tool-pipeline`, `prompt-pipeline`, `context-monitor`, `verify-current-state`, `pre-compact`, and `session-start-refresh` are no longer dispatched. Harness configs (Codex / Claude / Cursor) that referenced these events should be regenerated; the runtime now only emits `SessionStart` and `Stop`. `docs/harnesses.md` reflects the trimmed event coverage.
- **Removed managed git hooks**: `.cclaw/git-hooks/*` is no longer installed. Existing checkouts will have these files removed on the next `cclaw-cli sync` via `cleanupLegacyManagedGitHookRelays`.

### Phase B — R7 Regression Fixes

- **`findActiveSpanForPair` strict `runId` matching** — `src/delegation.ts` no longer treats entries with empty/missing `runId` as belonging to the current run. The previous `entry.runId && entry.runId !== runId` filter let pre-runId legacy rows pollute the per-run fold, producing spurious `dispatch_duplicate` errors when starting a fresh `slice-implementer` cycle. The inline copy in `src/content/hooks.ts::delegationRecordScript` is updated in lockstep (the "keep in sync" comment still applies).
- **`writeSubagentTracker` runs under the `appendDelegation` lock for every status** — terminal events (`completed`, `stale`) now re-fold the tracker inside the same directory lock, so `subagents.json::active` cannot lag the ledger after a `scheduled → launched → completed` lifecycle.
- **New e2e: `tests/e2e/flow-tdd-cycles.test.ts`** — runs five sequential `slice-implementer` cycles for the same agent without `--supersede` or `--allow-parallel`. Every cycle covers `scheduled → launched → acknowledged → completed`, and the test asserts the ledger ends with 20 rows and `subagents.json::active` empty between cycles.
- **New unit cases in `tests/unit/dispatch-dedup.test.ts`** — synthetic ledger reproduces the R7 hox: a `run-1` `slice-implementer` lifecycle with empty/missing `runId` does NOT block a fresh `run-2` dispatch. A second case asserts `subagents.json` shows an empty `active` array after the full lifecycle for the same span.

#### Phase B — Migration notes

- Legacy ledgers with empty `runId` rows continue to read fine (treated as not-belonging-to-current-run on dispatch dedup); no rewrite is required. Operators who hit `dispatch_duplicate` on a fresh run after a 6.8.x install can now retry without manual ledger surgery.

### Phase C — Schema Repair

- **Hard-error on writing `early-loop` rows without `runId`** — `src/early-loop.ts` no longer falls back to `"active"` for missing `runId`; the CLI/hook surface now refuses to write a row without a real run identifier. Reads of legacy `.cclaw/state/early-loop-log.jsonl` files emit a structured warning and skip the row instead of bricking the read path.
- **`cclaw-cli internal flow-state-repair --early-loop`** — re-derives `state/early-loop.json` from `early-loop-log.jsonl` rather than trusting the on-disk file, normalizing it to the canonical `EarlyLoopStatus` shape. Unit-test coverage feeds it a hand-written legacy file from the R7 hox scenario and asserts the canonical fields are restored.
- **`completedStageMeta` retro-migration** — `repairFlowStateGuard` now invokes `backfillCompletedStageMeta` so any stage in `completedStages` that's missing from `completedStageMeta` is populated with `{ completedAt: <artifact mtime or now> }`. Brainstorm specifically gets a `completedStageMeta` entry on advancement going forward; the repair path is the safety net for runs created on older builds.
- **`qaLogFloor.blocking` pushes a structured `gates.issues` entry** — `src/gate-evidence.ts` no longer relies on the `qa_log_unconverged` linter rule alone to block; when the floor itself is blocking it emits a dedicated entry into `gates.issues`, making the harness signal source-of-truth. The linter rule remains as detail/fallback.

#### Phase C — Migration notes

- **`runId` fallback removed** — older runs that wrote `early-loop-log.jsonl` rows without `runId` are still readable (with structured warnings) but cannot be appended to until repaired. Run `cclaw-cli internal flow-state-repair --early-loop` to re-derive the canonical status file. New writes always require `runId`.
- **Backfill is idempotent** — calling `flow-state-repair` on a healthy install is a no-op; only stages missing from `completedStageMeta` are populated.

### Phase D — Skill / Code Align

- **Iron laws actually loaded into `session-start`** — `handleSessionStart` now appends `ironLawsSkillMarkdown()` from `src/content/iron-laws.ts` to the bootstrap digest, fulfilling the long-standing skill promise that iron laws are visible at session start.
- **`subagents.ts` parallel-implementer rule rewritten** — replaces the old "NEVER parallel implementation subagents" hard rule with the explicit conjunction: parallel implementers are allowed only when (a) lanes touch non-overlapping files, (b) the controller passes `--allow-parallel` on each ledger row, and (c) an `integration-overseer` is dispatched after the parallel lanes and writes cohesion-evidence into the artifact before the gate is marked passed. `src/content/stages/tdd.ts` mirrors the rule into the TDD interaction protocol.
- **"Ralph-Loop" terminology disambiguated** — `src/content/skills-elicitation.ts`, `src/content/stages/brainstorm.ts`, `src/content/stages/scope.ts`, and `src/content/stages/design.ts` now distinguish the **Q&A Ralph Loop** / Elicitation Convergence (used during questioning) from the **Early-Loop / Concern Ledger** (producer-critic concern fold during stage execution). The two were previously conflated in skill copy, leading to confusion when one of them was disabled.
- **Docs sweep** — `docs/harnesses.md` no longer references `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `PreCompact` event coverage or the removed handlers (`prompt guard`, `workflow guard`, `context monitor`, `verify-current-state`); the hook-event-casing table only lists `SessionStart` and `Stop`; the interpretation section explains that workflow discipline is now enforced via iron-laws at session-start rather than pre-tool blocking.

#### Phase D — Migration notes

- Cohesion contract and `--allow-parallel` ledger flag are now load-bearing. Implementer dispatchers that previously serialized "because the rule said no parallel" can now opt into parallel lanes if and only if all three conditions hold; the TDD linter (`tdd.cohesion_contract_missing` + `tdd.integration_overseer_missing`) already enforces the cohesion-contract side.

### Phase E — TDD Hardening

- **`parseVerticalSliceCycle` table parser** — `src/artifact-linter/tdd.ts` replaces the substring `RED`/`GREEN`/`REFACTOR` check with a real Markdown-table parser that validates monotonic `RED ts ≤ GREEN ts ≤ REFACTOR ts` per slice row. REFACTOR may be marked `deferred because <reason>` / `not needed because <reason>` / `n/a <reason>` / `skipped <reason>`; deferral without a rationale fails. Unit tests cover monotonic-OK, GREEN-before-RED rejection, deferred-with-rationale acceptance, and deferred-without-rationale rejection.
- **`extractAuthoredBody` applied inside `evaluateInvestigationTrace`** — the investigation-trace detector strips `<!-- linter-meta --> … <!-- /linter-meta -->` blocks, raw HTML comments, and `linter-rule` fenced blocks before scanning, so template-echoed example paths no longer produce false positives. Regression unit test injects a linter-meta paragraph that mentions `src/example/path.ts` and asserts the rule still fires `found=false` for prose-only authored content.
- **`Document Reviewer Structured Findings` raised to `required: true` in design** — `src/artifact-linter/design.ts` matches `plan.ts:217-225` and `spec.ts:141-148`. When the design Layered review references coherence/scope-guardian/feasibility reviewers, structured status + calibrated finding lines are now mandatory, not advisory.
- **`tdd_docs_drift_check` extended for supply-chain manifests** — `src/internal/detect-supply-chain-changes.ts` is added, scoped to `package.json` `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`, anything under `.github/workflows/**`, and anything under `.cursor/**`. `gate-evidence.ts` calls it alongside `detectPublicApiChanges`; if either trigger fires for the active TDD run and `doc-updater` was not dispatched, the gate is blocked with structured `gates.issues` entries. Unit tests cover deps-add, package.json non-deps edits ignored, workflow edits, `.cursor/**` edits, and a clean-no-change baseline.
- **`tdd_verification_pending` linter rule** — new `required: true` rule in `src/artifact-linter/tdd.ts` scans `## Verification Ladder` (or `Verification Status` / `Verification`) for any row whose cells contain literal `pending`. Rows must be promoted to `passed`, `n/a`, `failed`, `skipped`, or `deferred` (with rationale) before stage-complete. Unit tests cover `pending → block` and `passed → pass`.

#### Phase E — Migration notes

- **`Document Reviewer Structured Findings` raised from `required: false → true` in design** — design artifacts that mention layered-review reviewers but omit calibrated finding lines will now block stage-complete instead of producing an advisory finding. Fix by adding the structured reviewer-status block under `## Layered review` with explicit reviewer status + calibrated findings.
- **New blocking rule `tdd_verification_pending`** — TDD artifacts that leave `pending` cells in the Verification Ladder section will block stage-complete. Promote rows or mark them `n/a`/`deferred` with a one-line rationale.
- **Supply-chain manifest changes now require `doc-updater`** — TDD stages that touch `package.json` dependency keys, GitHub workflows, or `.cursor/**` configs without dispatching a completed `doc-updater` delegation will block stage-complete with `tdd_docs_drift_check`.

## 6.8.0 — Ledger Truth

Round 7 closes three pinpoint trust bugs in the v6.7.0 runtime that were reproducible on a clean install: stale `state/subagents.json` (active filter without per-`spanId` fold), no monotonic-timestamp validation on delegation-record writes, and silent acceptance of duplicate `scheduled` spans for the same `(stage, agent)` pair without a terminal row on the previous span.

### Subagents Fold

- **`computeActiveSubagents(entries)` in `src/delegation.ts`** — new exported helper that folds delegation entries to the latest row per `spanId` (newest of `completedTs ?? ackTs ?? launchedTs ?? endTs ?? startTs ?? ts`) and returns only spans whose latest status is still in `{scheduled, launched, acknowledged}`. Output is ordered by ascending `startTs ?? ts` so existing UI consumers see a stable presentation. `writeSubagentTracker` now calls `computeActiveSubagents` instead of the prior raw-status filter, so `state/subagents.json::active` no longer reports a span that already has a terminal row.
- **Inline-hook mirror** — the `delegation-record.mjs` hook generated from `src/content/hooks.ts` now applies the same fold inline (with a `// keep in sync with computeActiveSubagents in src/delegation.ts` marker) so node-side and inline writers stay coherent.

### Timestamp Validation

- **`validateMonotonicTimestamps(stamped, prior)` + `DelegationTimestampError`** — `appendDelegation` now validates per-row invariants (`startTs ≤ launchedTs ≤ ackTs ≤ completedTs`, equality allowed) and a cross-row invariant that per-span `ts` is non-decreasing. On violation the helper throws `DelegationTimestampError` with `field`, `actual`, `priorBound`. `runInternalCommand` translates the error into `exit 2` and a stderr line prefixed `error: delegation_timestamp_non_monotonic — <field>: <actual> < <bound>`.
- **Inline-hook mirror** — the inline `delegation-record.mjs` runs the same checks against rows already in the on-disk ledger and emits `{ ok: false, error: "delegation_timestamp_non_monotonic", details: { field, actual, bound } }` with `exit 2` when `--json` is set; bare error mode prints the same payload to stderr. Span `startTs` is now inherited from the first row for that `spanId` so user-supplied `--launched-ts`/`--ack-ts`/`--completed-ts` past timestamps remain coherent against the original schedule.

### Dispatch Dedup

- **`findActiveSpanForPair(stage, agent, runId, ledger)` + `DispatchDuplicateError`** — when `appendDelegation` writes a `scheduled` row, it folds prior entries to find any span on the same `(stage, agent)` whose latest status is still active. If one exists with a different `spanId`, the call throws `DispatchDuplicateError` carrying `existingSpanId`, `existingStatus`, `newSpanId`, and `pair`. `runInternalCommand` translates to `exit 2` + `error: dispatch_duplicate`.
- **`--supersede=<prevSpanId>` and `--allow-parallel` flags** — the `delegation-record.mjs` hook now accepts both flags. `--supersede=<prevSpanId>` first writes a synthetic `stale` terminal row for `<prevSpanId>` with `supersededBy=<newSpanId>` (and a matching event-log row) before recording the new scheduled span; passing the wrong id exits 2 with `dispatch_supersede_mismatch`. `--allow-parallel` skips the dedup check and tags the new row with `allowParallel: true`. New optional fields `allowParallel` and `supersededBy` were added to `DelegationEntry`.
- **Skill update** — the harness dispatch contract section in `src/content/skills.ts` now documents the supersede / allow-parallel choice and the two new error codes (`dispatch_duplicate`, `delegation_timestamp_non_monotonic`).

### Tests

- **`tests/unit/delegation-active-fold.test.ts`** — 7 cases covering scheduled→launched→completed (empty active), scheduled→launched (active is the launched row), two independent active spans, scheduled→completed (empty active), `startTs`-ascending stable order, missing `spanId` ignored, and `stale` treated as terminal.
- **`tests/unit/delegation-monotonic.test.ts`** — 6 cases covering `ackTs < launchedTs` rejection, `completedTs == launchedTs` accepted, `completedTs < launchedTs` rejected, all-equal timeline accepted, cross-row regression rejected, coherent multi-row timeline accepted.
- **`tests/unit/dispatch-dedup.test.ts`** — 6 cases covering `findActiveSpanForPair` happy path, terminal-only pair returns null, duplicate `scheduled` throws `DispatchDuplicateError`, `allowParallel` accepted, different-stage same-agent allowed, and the supersede flow leaves only the new span in the tracker.
- **`tests/e2e/hooks-lifecycle.test.ts`** — new e2e suite that spawns the inline `delegation-record.mjs` and asserts: full lifecycle ends with empty `active`, `--ack-ts` earlier than `--launched-ts` produces `delegation_timestamp_non_monotonic`, second scheduled write produces `dispatch_duplicate`, `--supersede=<prev>` rewrites the previous span as `stale` and lists only the new span in `active`, `--allow-parallel` lists both spans with `allowParallel: true`, and `--supersede=<wrongId>` emits `dispatch_supersede_mismatch`.

### Migration

- Legacy `state/subagents.json` files with stuck `scheduled`/`launched` rows for already-terminal spans self-heal on the next `delegation-record` write — the writer rebuilds the tracker via `computeActiveSubagents` over the entire current-run ledger. No manual intervention is required.

## 6.7.0 — Flow Trust And Linter Precision

Round 6 locks down the three sources of silent trust loss in the v6.x runtime: manual `flow-state.json` edits, proactive delegation waivers with no paper trail, and linter noise that either cannibalized templated meta-phrases or re-asked counterfactual forcing questions on simple work. The runtime hard-blocks on flow-state tampering and on waivers without an approval token; the linter now strips its own meta-phrases before scanning and tags each finding as `new`/`repeat:N`/`resolved` across runs.

### Runtime Honesty

- **Flow-state write-guard (`src/run-persistence.ts`)** — every `writeFlowState` / `writeFlowStateGuarded` call now pairs `.cclaw/state/flow-state.json` with a sha256 sidecar at `.cclaw/.flow-state.guard.json` (fields: `sha256`, `writtenAt`, `writerSubsystem`, `runId`). Guarded reads (`readFlowStateGuarded`) and the `verifyFlowStateGuard(projectRoot)` entry point throw `FlowStateGuardMismatchError` when the sidecar disagrees with the on-disk payload; raw `readFlowState` stays unguarded so the existing sanitizer/quarantine paths keep working. Every writer in `src/internal/advance-stage/*` now records its subsystem (`advance-stage`, `start-flow`, `rewind`, …) so mismatch messages surface the last legitimate writer.
- **Hook-level hard-block** — the generated `delegation-record.mjs` and the `node-hooks.ts` runtime (`session-start`, `stop-handoff`) now verify the sha256 sidecar inline before they act; `runInternalCommand` verifies it for `advance-stage`, `start-flow`, `cancel-run`, `rewind`, and the two `verify-*` subcommands. A hand-edited `flow-state.json` fails with exit code `2` and a clear stderr pointing at the repair command.
- **`cclaw-cli internal flow-state-repair --reason=<slug>`** — recomputes the sidecar from the current payload, appends an audit line to `.cclaw/.flow-state-repair.log`, and refuses bare or malformed reasons. Intended only after an intentional manual edit.

### Waiver Provenance

- **`cclaw-cli internal waiver-grant --stage=<stage> --reason=<slug>`** — issues a short-lived `WV-<stage>-<sha8>-<expSlug>` token (default TTL 30 minutes, max 120) persisted to `.cclaw/.waivers.json`. Prints both the token and the canonical `--accept-proactive-waiver=<token>` consumption command. Reasons must be short kebab-case slugs (`architect_unavailable`, `critic_offline`, …).
- **`--accept-proactive-waiver` now requires `=<token>`** — `src/internal/advance-stage/advance.ts` validates the token against `.cclaw/.waivers.json` (matching stage, not expired, not already consumed), moves the record to `consumed[]`, and writes `approvalToken` / `approvalReason` / `approvalIssuedAt` onto the proactive `DelegationEntry`. Bare `--accept-proactive-waiver` exits with code `2` and a human-readable error.
- **Advisory linter finding `waiver_legacy_provenance`** — fires when a stage's proactive waiver has no `approvalToken` (e.g. issued by a pre-6.7 runtime). Never hard-blocks; guides authors toward `waiver-grant` on the next proactive delegation.

### Linter Precision

- **`extractAuthoredBody(rawArtifact)`** — new helper in `src/artifact-linter/shared.ts` that strips `<!-- linter-meta --> ... <!-- /linter-meta -->` paired blocks, remaining HTML comments, and fenced code blocks tagged `` ```linter-rule ``` ``. Surviving line offsets are preserved so regex-based scanners stay stable. The `Plan-wide Placeholder Scan` now calls `extractAuthoredBody` before scanning so the template's own "Scanned tokens: `TODO`, `TBD`, `FIXME`..." phrase no longer self-triggers the rule.
- **Linter-meta markers in templates** — `src/content/templates.ts` wraps the `## Plan Quality Scan` meta-phrase block in `<!-- linter-meta -->` / `<!-- /linter-meta -->` so `extractAuthoredBody` can skip it cleanly. The `tests/e2e/docs-contracts.test.ts` contract now asserts that wrapping is in place.
- **Findings-dedup cache** — new `src/artifact-linter/findings-dedup.ts` fingerprints each finding as `sha8(stage | rule | normalizedDetail)` and persists the per-stage set to `.cclaw/.linter-findings.json`. `lintArtifact` classifies every finding as `{kind: "new"}`, `{kind: "repeat", count}`, or `{kind: "resolved"}` and emits a short header summary (`linter findings (stage=…): N new, N repeat, N resolved.`) on the `LintResult.dedup` field. Normalization stabilizes the digest by masking run-ids, timestamps, hex hashes, and numeric counts.

### Forcing Question Pruning

- **Brainstorm** no longer requires `[topic:do-nothing]`. The forcing-question list is now `pain`, `direct-path`, `operator`, `no-go`; the `What if we do nothing?` premise-check bullet is retired; `Do-nothing consequence` continues to live in the Problem Decision Record.
- **Scope** no longer requires `[topic:rollback]` or `[topic:failure-modes]`. The forcing-question list is now `in-out`, `locked-upstream`. Design's Failure Mode Table remains mandatory and is untouched.
- `src/content/skills-elicitation.ts` and `src/content/templates.ts` are synced; the retired topic IDs are removed from every example row, Q&A log placeholder, and topic-tag catalog.

### Tests

- **`tests/unit/run-persistence-guard.test.ts`**, **`tests/unit/flow-state-repair.test.ts`**, **`tests/e2e/hook-guard.test.ts`** — pin the sidecar write, guard mismatch error shape, repair log format, and hook-level hard-block for `session-start`, `stop-handoff`, `delegation-record`, and `stage-complete`.
- **`tests/unit/waiver-grant.test.ts`** — covers `issueWaiverToken` / `consumeWaiverToken` happy path, wrong-stage refusal, expired refusal, single-use semantics, CLI parser, and the `cclaw-cli internal waiver-grant` dispatcher.
- **`tests/unit/waiver-legacy-provenance.test.ts`** — verifies the advisory finding fires for token-less proactive waivers and stays silent when the waiver carries an `approvalToken`.
- **`tests/unit/extract-authored-body.test.ts`**, **`tests/unit/findings-dedup.test.ts`** — pin stripping semantics for linter-meta blocks, HTML comments, fenced `linter-rule` blocks, fingerprint stability, `new`/`repeat:N`/`resolved` classification, per-stage segregation, and header rendering.
- **`tests/unit/no-counterfactual-forcing.test.ts`** — regression test that asserts `extractForcingQuestions("brainstorm")` no longer contains `do-nothing`, `extractForcingQuestions("scope")` no longer contains `rollback` or `failure-modes`, the generated brainstorm / scope skills never emit `[topic:do-nothing|rollback|failure-modes]`, and the brainstorm skill drops the `What if we do nothing?` premise line.
- **Existing test updates** — `tests/unit/internal-advance-stage.test.ts`, `tests/unit/hooks-lifecycle.test.ts`, `tests/e2e/elicitation-floor.test.ts`, `tests/unit/delegation-record-repair.test.ts`, `tests/unit/qa-log-floor.test.ts` migrated to the new waiver-token contract, the loose `readFlowState`/guarded `readFlowStateGuarded` split, and the pruned brainstorm/scope topic lists.

### Migration

- Legacy waivers without `approvalToken` remain valid and are surfaced as advisory via `waiver_legacy_provenance`. The next successful proactive delegation should use `cclaw-cli internal waiver-grant` + `--accept-proactive-waiver=<token>`.
- Existing projects continue without manual repair. The first legitimate `stage-complete` (or any `writeFlowState`) after upgrade writes the `.cclaw/.flow-state.guard.json` sidecar. Projects without a sidecar are read in "legacy mode" — the first mismatch only fires after the sidecar exists.

## 6.6.0 — Agent Efficiency Round 5

Two coupled, content-only workstreams that bound investigation cost and anchor each stage to a concrete bad → good behavior. Pure prompt + advisory linter — no `FlowState` fields, no CLI flags, no schema fields, no harness changes. Standard / quick / medium tracks behave identically; the new linter rule is `required: false` and never blocks `stage-complete`.

### Skill Content

- **Investigation Discipline ladder** — every elicitation/spec/plan/tdd/review skill now embeds the same four-step ladder (`search → graph/impact → narrow read of 1-3 files → draft`) plus an explicit path-passing rule for delegations and three stop triggers (`> 3 files in one pass`, `loading file content into a delegation prompt instead of paths`, `starting a draft before any trace exists`). Rendered exactly once per of the seven `INVESTIGATION_DISCIPLINE_STAGES`. `ship` is excluded — it consumes the upstream trace, it does not produce one.
- **Behavior anchor block** — every stage skill now carries a single `## Behavior anchor` block with one bad-vs-good pair tied to a real artifact section in that stage's schema. Themes: brainstorm = silent scope creep in framing; scope = invented contract without user-signal trace; design = premature architecture without a codebase trace; spec = claim-without-evidence in acceptance criteria; plan = parallelization claim without disjoint units + interface contract; tdd = tautological assertion; review = drive-by refactor disguised as findings; ship = victory-by-confidence without runnable evidence.

### Templates

- **`INVESTIGATION_DISCIPLINE_BLOCK`** — new shared markdown constant in `src/content/templates.ts` (~25 lines, four ladder steps + path-passing rule + three stop triggers). Wired into `crossCuttingMechanicsBlock` in `src/content/skills.ts` once — the seven stage files reference it through one line in `interactionProtocol`, no prose duplication.
- **`BEHAVIOR_ANCHORS`** — new typed array in `src/content/examples.ts` (one entry per `FlowStage`, 8 total). Each artifact template (`01-brainstorm.md` … `08-ship.md`) now opens with one `> Behavior anchor (bad -> good) — <section>: ...` line rendered via `renderBehaviorAnchorTemplateLine(stage)`, so authors see the calibration the moment they open the template.
- **`behaviorAnchorFor(stage)`** + **`behaviorAnchorBlock(stage)`** — exported helpers used by the shared skill renderer and the unit tests; the rendered `## Behavior anchor` block contains the section anchor, the bad / good pair, and an optional rule hint.

### Linter Coverage

- **`evaluateInvestigationTrace(ctx, sectionName)`** — new advisory rule in `src/artifact-linter/shared.ts` exporting both the linter wrapper and the underlying `checkInvestigationTrace` detector. Empty / placeholder-only sections (template stubs, separator rows, `- None.`, lone ID-only data rows, table headers) are silent. Sections with substantive content but no recognizable file path / ref / `path:` marker / cclaw ID in the first non-empty rows emit a single advisory finding `[P3] investigation_path_first_missing` ("pass paths and refs, not pasted file contents"). The detector accepts typical TS/JS/MD/JSON paths, slash-bearing repo-root prefixes (`src/`, `tests/`, `docs/`, `.cclaw/`, …), `path:line` ranges, GitHub-style refs (`org/repo#123`, `org/repo@sha`), explicit `path:` / `ref:` markers, stable cclaw IDs (`R1`, `D-12`, `AC-3`, `T-4`, `S-2`, `DD-5`, `ADR-1`, `F-1`, …), and backticked path-like tokens.
- **Six stage linters wired** — `evaluateInvestigationTrace` now runs in `src/artifact-linter/{brainstorm,scope}.ts` against `Q&A Log`, `design.ts` against `Codebase Investigation`, `tdd.ts` against `Watched-RED Proof`, `plan.ts` against `Implementation Units`, and `review.ts` against `Changed-File Coverage`. All six calls are advisory only (`required: false`) and never block `stage-complete` or alter existing failure semantics.

### Tests

- **`tests/unit/investigation-discipline-block.test.ts`** — verifies the constant exists, contains exactly four numbered ladder steps, exactly three stop triggers, mentions path-passing, is not duplicated verbatim in any `src/content/stages/*.ts`, renders exactly once in each of the seven investigation-stage skills, and is absent from the `ship` skill.
- **`tests/unit/investigation-trace-evaluator.test.ts`** — exercises both `checkInvestigationTrace` and `evaluateInvestigationTrace` against missing sections, empty sections, placeholder-only template stubs, sections with TS/MD paths, `path:` markers, stable cclaw IDs, GitHub refs, `path:line` ranges, and prose-only content; confirms exactly one advisory `investigation_path_first_missing` finding fires only on the prose-only case.
- **`tests/unit/behavior-anchors.test.ts`** — verifies exactly one anchor per `FlowStage`, ≤ 40 words on each `bad` / `good` side, uniqueness across stages, that each anchor's `section` resolves to a real entry in `stageSchema(stage).artifactRules.artifactValidation`, that every rendered stage skill markdown contains `## Behavior anchor` exactly once with `- Bad:` / `- Good:` markers, and that every artifact template carries the matching one-line anchor pointer exactly once.
- **`tests/e2e/docs-contracts.test.ts`** — extended with two new contract checks: the Investigation Discipline ladder snippet ("Use this ladder before drafting or delegating") plus the path-passing rule render exactly once per of the seven investigation stages and never in `ship`; the `## Behavior anchor` block renders once per of the eight stage skills with both `Bad:` and `Good:` markers.

## 6.5.0 — Flow correctness round 3 (delegation-log lock, quiet success JSON, scope PD clarity)

### Reliability

- **delegation-log.json** — Generated `delegation-record.mjs` now acquires `delegation-log.json.lock` (atomic `mkdir`) with retry/backoff (~3s max), writes via temp file + `rename`, and releases the lock in `finally`. Lock timeout exits `2` with a clear stderr line. `delegation-events.jsonl` stays append-only without locking.

### Contracts

- **Harness Dispatch** — Shared skill text documents the canonical `delegation-record.mjs` flags (`--stage`, `--agent`, `--mode`, `--status`, `--span-id`, dispatch proof fields, optional `ack-ts` / `evidence-ref`, `--json`) plus lifecycle order and `--repair`.
- **Quiet helpers** — With `CCLAW_START_FLOW_QUIET=1` / `CCLAW_STAGE_COMPLETE_QUIET=1`, successful `start-flow` and `stage-complete` still print exactly **one line** of compact JSON on stdout (parseable); pretty-printed output remains when quiet is off.
- **Anti-false-completion** — Stage skills and templates require quoting that single-line success JSON shape; empty stdout is not a success signal for current tooling.
- **Scope expansion** — Linter finding title is `Product Discovery Delegation (Strategist Mode)` with explicit BEFORE `stage-complete` guidance; `docs/quality-gates.md` uses product-discovery (strategist mode) naming.

### Behavior

- **start-flow (quiet)** — Success line includes `ok`, `command`, `track`, `discoveryMode`, `currentStage`, `activeRunId`, `repoSignals` (no pretty-print).
- **stage-complete / advance-stage (quiet)** — Success line uses `command: "stage-complete"` with `stage`, `completedStages`, `currentStage`, and `runId`.
- **Scope stage skill** — Hard checklist gate: SELECTIVE / SCOPE EXPANSION requires completed `product-discovery` with evidence before completion.

## 6.4.0 — Flow UX round 2 (researcher everywhere, post-closure drift, ergonomics)

### Behavior

- **Proactive researcher gate** — brainstorm/scope/design now require a researcher proactive delegation record (or waiver) in **all** `discoveryMode`s (`lean`, `guided`, `deep`). Discretionary proactive lenses still drop off in `lean`/`guided` except rows marked `essentialAcrossModes` (researcher only today). Sparse or empty repos no longer skip this rule.
- **`start-flow` JSON** — successful stdout now echoes `repoSignals` alongside track/discovery metadata.
- **`early-loop` iteration cap** — derived `iteration` is clamped to `maxIterations`; `early-loop-status` applies a final write-time clamp with stderr notice if a corrupted status object slips through.

### Contracts

- **Stage schema typing** — `dependsOnInternalRepoSignals` removed; proactive rows support `essentialAcrossModes` instead. Researcher prompts document external plus internal search scope explicitly.
- **Label vocabulary** — closeout/substate protocol copy uses **no changes** wording for passive retro/compound options; adaptive elicitation documents that **skip** remains a stop-signal phrase in Q&A only.
- **Optional `## Amendments`** — documented convention for dated post-closure edits; linter advisory `stage_artifact_post_closure_mutation` compares artifact `mtime` to `completedStageMeta.completedAt`.

### Reliability

- **Learnings parse errors** — `parseLearningsSection` exposes `errors[]`; stage-complete.stderr and linter Learnings findings present the same multiline bullet list (`Errors:` + indented rows).
- **Flow persistence** — `completedStageMeta` is optional legacy-safe metadata recorded on stage advance; coercion round-trips through `run-persistence.ts`.

## 6.3.0 — Flow UX (start mode, validation summary, repo-aware proactive, repair-span)

### UX

- **`start-flow` + `/cc` contract** — discovery-mode answers are normalized (`trim`, lower-case) with invalid values re-asked; vague one-line prompts on empty repos must confirm `guided` before defaulting to `deep`.
- **`stage-complete` hook USAGE** — documents `--accept-proactive-waiver` and `--accept-proactive-waiver-reason` alongside existing waiver flags.
- **Validation failure banner** — human-readable `advance-stage` validation errors open with `(delegation=N, gates=M, closure=K)` counts; JSON diagnostics include matching `failureCounts`.
- **`delegation-record --repair`** — idempotent append of missing lifecycle phases for an existing `span-id` when audit lines are incomplete (`--repair-reason` required).

### Reliability

- **Repo signals** — `start-flow` records optional `repoSignals` in `flow-state.json` (shallow file scan, cap 200 files, skips `node_modules`/`.git`).
- **Deep-mode proactive `researcher`** — on sparse/empty repos (`fileCount < 5` and no README or package manifest), brainstorm/scope no longer demand a proactive researcher trace; substantive repos unchanged.
- **`--discovery-mode` parsing** — CLI and `coerceDiscoveryMode` accept `Lean`/`Deep`/etc. without falling back to `guided`.

### Contracts

- **Completion honesty** — templates and every stage skill state that a stage completion claim requires `stage-complete` exit 0 in the current turn (quote the success line; no inference from retries).
- **Stage schema** — `researcher` rows for brainstorm/scope carry `dependsOnInternalRepoSignals` for the trace gate logic above.

## 6.2.0 — Start mode unification (`discoveryMode`)

Behavioral redesign of the user-facing start axis around a single `discoveryMode`: **`lean` \| `guided` \| `deep`**. Track remains an internal concern (not exposed as a parallel “start mode” choice).

### Changed

- **Single `discoveryMode` start-mode axis** — one knob for how much discovery scaffolding to run at kickoff (`lean` / `guided` / `deep`).
- **Track stays internal** — pacing/heuristics still use track under the hood; users align on `discoveryMode` only.
- **Early-stage gate simplification** — fewer branching paths and clearer gating in early flow.
- **Q&A convergence contract aligned with runtime** — linter and advance-stage behavior stay consistent on when Q&A is considered converged.
- **Removed lite / standard / deep agent-facing wording in early stages** — replaced with tier-neutral or `discoveryMode`-aligned copy (incl. Approach Tier wording cleanup).

## 6.1.1 — Wave 24/25 Audit Follow-ups

Hotfix release. Auditing Wave 24 (v6.0.0) and Wave 25 (v6.1.0) end-to-end surfaced one real defect that left two shipped features dead in practice. Standard-track runs were never affected — the bug only matters once a flow-state file actually carries a `taskClass` classification.

### Fixed

- **`flow-state.json#taskClass` was silently dropped on persistence.** `coerceFlowState` in `src/run-persistence.ts` (the single read/write coercer used by both `readFlowState` and `writeFlowState`) never copied the `taskClass` field through. Wave 24 declared the field on `FlowState` and wired it into `mandatoryAgentsFor` + `shouldDemoteArtifactValidationByTrack`, but every flow-state round-trip stripped the value, so `flowState.taskClass` was always `undefined` at runtime. Effect: the Wave 24 `software-bugfix` mandatory-delegation skip and the Wave 25 W25-A artifact-validation demotion both fired only in unit tests that called helpers directly. `coerceFlowState` now sanitizes `taskClass` against the `MandatoryDelegationTaskClass` union (plus `null`) and preserves it across reads and writes; unknown values are dropped instead of leaking through.
- **`checkMandatoryDelegations` ignored `flowState.taskClass`.** The helper accepted `options.taskClass` but `buildValidationReport` in `src/internal/advance-stage/advance.ts` (the `cclaw advance-stage` entry point) never forwarded it. Even after the persistence fix above, the gate would have stayed broken. The helper now falls back to `flowState.taskClass` when the caller leaves `options.taskClass` undefined; explicit `null` still suppresses the lookup. `advance.ts` also threads `flowState.taskClass` through explicitly so the call site stays self-documenting.

### Internal

- Regression tests cover all three legs of the round-trip: `coerceFlowState` preserves valid task classes, drops unknown values, and survives both the `writeFlowState` path and a hand-edited `flow-state.json`. Two new `delegation.test.ts` cases verify that `checkMandatoryDelegations` respects `flowState.taskClass` when no override is passed and that an explicit `null` still wins. Total tests: 794 → 799.

## 6.1.0 — Lite-Tier Artifact Escape + Validator Ergonomics

Wave 25. The user ran a real test of the design stage on a 3-file static landing page (lite/quick-tier work, `taskClass=software-standard`, empty repo) and hit ~10 sequential validation failures, each requiring artifact edits or evidence-format guesswork. Wave 24 dropped mandatory _delegation_ gates for lite/quick/bugfix; Wave 25 extends the same escape to mandatory _artifact-validation_ rules, fixes envelope error consistency, and broadens diagram + edge-case detection so trivial work stops paying ceremony cost.

This release is **additive and non-breaking**: every Wave 24 contract is preserved. Standard tracks behave exactly as before.

### Added

- **Lite-tier artifact-validation escape (W25-A).** New `shouldDemoteArtifactValidationByTrack(track, taskClass?)` helper in `src/content/stage-schema.ts` mirrors Wave 24's `mandatoryAgentsFor` predicate — returns `true` for `track === "quick"` OR `taskClass === "software-bugfix"`. When `true`, the artifact linter demotes a curated list of advanced-only `required` findings (`Architecture Diagram`, `Data Flow`, `Stale Diagram Drift Check`, `Expansion Strategist Delegation`) from blocking → advisory. Findings remain in the result so callers can surface them as advisory hints; only `required` flips to `false`.
- **`artifact_validation_demoted_by_track` audit event.** Appended to `.cclaw/runs/active/delegation-events.jsonl` whenever the W25-A demotion fires, capturing `stage`, `track`, `taskClass`, `runId`, and the demoted `sections[]`. `readDelegationEvents` recognizes and skips this audit-only event (no `agent`/`spanId` payload).
- **`expansion_strategist_skipped_by_track` audit event (W25-F).** Appended when the scope-stage Expansion Strategist (`product-discovery`) delegation requirement is dropped for a small-fix lane, capturing `track`, `taskClass`, `runId`, and `selectedScopeMode`. Same audit-only treatment as the other Wave 24/25 audit events.
- **`reviewLoopEnvelopeExample(stage)` helper (W25-B).** Returns a complete, copy-pasteable JSON shape for the design/scope review-loop envelope with `stage` at the TOP level (not inside `payload`). Every `validateReviewLoopGateEvidence` error now embeds this example so agents stop guessing the envelope shape.
- **`tryAutoHydrateAndSelectReviewLoopGate` (W25-B).** When a review-loop gate (`design_diagram_freshness`, etc.) is auto-hydratable from the artifact AND the artifact section is present, the gate auto-passes — agents do NOT need to include it in `--passed` or `--evidence-json`. Resolves the contradiction between "missing --evidence-json entries for passed gates" and "omit this gate from manual evidence so stage-complete can auto-hydrate it".
- **Architecture Diagram multi-format sync/async detection (W25-C).** `DIAGRAM_ARROW_PATTERN` and `hasAsyncDiagramEdge` / `hasSyncDiagramEdge` now accept a wide range of representations: solid `-->`/`->`/`===>`/`--->`/`=>`/`→`/`⟶`/`↦`, dotted/async `-.->`/`-->>`/`~~>`/`- - ->`/`.....>`, plus `sync:`/`async:` cell-prefix labels and `[sync]`/`[async]` bracket labels. New `DIAGRAM_SYNC_ASYNC_ACCEPTED_PATTERNS` ships every accepted form in the error message so agents stop guessing.
- **Architecture Diagram conditional failure-edge enforcement (W25-C).** New `validateArchitectureDiagram(body, { sections })` enforces the failure-edge keyword rule ONLY when the artifact's `## Failure Mode Table` has at least one row OR the diagram body mentions external-dependency keywords (HTTP, DB, queue, cache, …). Static / no-network designs no longer need to invent fake `(timeout)` annotations.
- **Stale Diagram Audit filename parsing (W25-D).** `normalizeCodebaseInvestigationFileRef` strips parenthetical suffixes like ` (new)`, ` (deleted)`, ` (stub)`, ` (n/a)`, ` (renamed)`, ` (placeholder)`, ` (tbd)`, including stacked variants, before `fs.stat`. `(new)` rows are recorded as "new file, no stale diagrams to detect"; `(skip)`/`(deleted)`/`(stub)` rows and rows with a leading `#` or a `skip:` token in the Notes column are skipped entirely. The "could not read blast-radius file(s)" error now appends a one-line hint explaining how to mark new/skipped/deleted files.
- **Interaction Edge Case Matrix `N/A — <reason>` acceptance (W25-E).** The `Handled?` cell now accepts `N/A`, `N/A — reason`, `N/A – reason`, `N/A - reason`, and `N/A: reason` (em-dash, en-dash, hyphen, colon separators). When `N/A` is present, the deferred-item (`D-XX`) requirement is waived; a reason in the `Handled?` cell or a non-empty `Design response` cell satisfies justification. The error message for an unparseable `Handled?` cell now mentions the `N/A — <reason>` escape.
- **Interaction Edge Case Matrix lite-tier no-network demotion (W25-E).** When `shouldDemoteArtifactValidationByTrack` is true AND the design has no `Failure Mode Table` rows AND no external-dependency keywords in the Architecture Diagram body, the four network-dependent mandatory rows (`nav-away-mid-request`, `10K-result dataset`, `background-job abandonment`, `zombie connection`) are demoted to advisory. The `double-click` row stays mandatory. Successful runs annotate the result with the count of advisory rows for traceability.

### Fixed

- **Review-loop envelope auto-hydration contradiction (W25-B).** Fixed the prior agent-facing trap where omitting an auto-hydratable gate from `--passed` triggered "missing --evidence-json entries for passed gates" while including it triggered "omit this gate from manual evidence so stage-complete can auto-hydrate it". Auto-hydratable gates now consistently auto-pass when the artifact contains the matching review-loop envelope.
- **Stale Diagram Audit `fs.stat("index.html (new)")` failure (W25-D).** The audit no longer interprets parenthetical annotation suffixes as part of the filename — agents no longer have to `touch` placeholder files just to silence the audit.
- **Architecture Diagram failure-edge ceremony (W25-C).** A static landing page with no failure paths and no external dependencies no longer requires a fabricated `App -->|timeout| Fallback` arrow.
- **Interaction Edge Case `N/A` rejection (W25-E).** The `Handled?` cell no longer rejects `N/A` for cases that genuinely don't apply (e.g. `nav-away-mid-request` on a static page with no requests).
- **Expansion Strategist requirement on trivial scope (W25-F).** Lite-tier scope-stage runs in `SCOPE EXPANSION` / `SELECTIVE EXPANSION` mode no longer block on a missing `product-discovery` delegation — the requirement is dropped and audited.

### Internal

- `FlowState.taskClass` (Wave 25 plumbing) is now read by the artifact linter and surfaced through `StageLintContext` so per-stage linters (`scope`, `design`, …) can apply the same lite-tier predicate uniformly.
- `ValidateSectionBodyContext` extended with optional `sections` and `liteTier` so per-section validators can opt into cross-section context and lite-tier demotions without re-deriving the predicate.
- `validateArchitectureDiagram` extracted from the inline `validateSectionBody` switch to a dedicated function; `validateInteractionEdgeCaseMatrix` gained an `InteractionEdgeCaseValidationContext` parameter.
- New helpers in `src/delegation.ts`: `recordArtifactValidationDemotedByTrack`, `recordExpansionStrategistSkippedByTrack`. Both extend the Wave 24 `NON_DELEGATION_AUDIT_EVENTS` set so `readDelegationEvents` ignores them.
- `src/artifact-linter/design.ts` now exports `CodebaseInvestigationFileRef`, `normalizeCodebaseInvestigationFileRef`, and `collectCodebaseInvestigationFiles` so the W25-D parser is unit-testable in isolation.

### Test Coverage

Added 4 new unit-test files (42 new tests, suite total 752 → 794):

- `tests/unit/lite-artifact-validation-escape.test.ts` — W25-A predicate parity with `mandatoryAgentsFor`, W25-C multi-format sync/async + conditional failure-edge, W25-E `N/A — reason` and lite-tier no-network demotion.
- `tests/unit/stale-diagram-filename-parsing.test.ts` — W25-D suffix stripping, stacked suffixes, `#` skip, `skip:` notes, dedupe.
- `tests/unit/review-loop-envelope-errors.test.ts` — W25-B canonical envelope shape, error-message JSON example inclusion, top-level-stage hint.
- `tests/unit/expansion-strategist-track-skip.test.ts` — W25-F + W25-A audit-event helpers and `readDelegationEvents` integration.

### Migration

None required. All changes are additive; existing artifacts and standard-track flows behave exactly as in 6.0.0.

## 6.0.0 — Convergence i18n + drop mandatory delegations on lite

Wave 24. Two complementary fixes that unblock real-world flows:

1. **Topic-ID convergence** — Wave 23 extracted forcing-question topics as English keywords, so RU/UA/non-English Q&A logs were always reported "unconverged" even when the user had answered every forcing question. Wave 24 replaces the keyword fallback with mandatory `[topic:<id>]` tags. Convergence is now language-neutral.
2. **Track-aware mandatory delegation drop** — mandatory subagent gates were firing on lite-tier landing-page work and bugfixes, requiring hand-crafted `--waive-delegation` reasons. Wave 24 collapses the mandatory list to `[]` for `track === "quick"` OR `taskClass === "software-bugfix"` and records an audit-trail event.

### Breaking Changes

- **`[topic:<id>]` tag is now MANDATORY in `## Q&A Log` rows that address forcing questions.** The English keyword fallback is gone. The linter scans only for the explicit `[topic:<id>]` tag (case-insensitive id, ASCII-only) — typically stamped in the `Decision impact` cell. Stage forcing-question checklist rows now declare topics as `id: topic; id: topic; ...`. Brainstorm IDs: `pain`, `direct-path`, `do-nothing`, `operator`, `no-go`. Scope IDs: `in-out`, `locked-upstream`, `rollback`, `failure-modes`. Design IDs: `data-flow`, `seams`, `invariants`, `not-refactor`.
- **`extractForcingQuestions(stage)` return type changed.** Now returns `Array<{ id: string; topic: string }>` (`ForcingQuestionTopic[]`) instead of the old `string[]`. The function throws when a forcing-questions checklist row exists but its body does not match the new `id: topic; id: topic; ...` syntax — authors fix the stage definition rather than ship un-coverable topics.
- **`QaLogFloorOptions.forcingQuestions` accepts `ReadonlyArray<ForcingQuestionTopic | string>`** instead of just `string[]`. String entries are treated as raw topic IDs (the topic label defaults to the id).
- **`qa_log_unconverged` finding details now print pending topic IDs as a bracketed list** (e.g. `Forcing topic IDs pending: [pain, do-nothing, operator]`) plus a one-line tag instruction. The long prose explanation is gone.

### Removed

- `topicKeywords` helper, `isTopicAddressedByKeyword` helper, and the `STOP_WORDS` array in `src/artifact-linter/shared.ts`. The linter no longer tokenizes topic strings into English keywords.

### Added

- **`mandatoryAgentsFor(stage, track, taskClass?, complexityTier?)`** in `src/content/stage-schema.ts`. Returns `[]` when `track === "quick"` OR `taskClass === "software-bugfix"`, otherwise delegates to `mandatoryDelegationsForStage`. New `MandatoryDelegationTaskClass` union: `"software-standard" | "software-trivial" | "software-bugfix"`. Callers (`gate-evidence`, advance-stage validator, subagents.ts table generator, completion-parameters block) MUST go through this helper.
- **`parseForcingQuestionsRow(row, context?)`** in `src/artifact-linter/shared.ts`. Pure parser exposed for unit tests; returns `null` when the row is not a forcing-questions header, throws on malformed `id: topic` syntax or invalid kebab-case IDs.
- **`mandatory_delegations_skipped_by_track` audit event** appended to `.cclaw/runs/active/delegation-events.jsonl` when `mandatoryAgentsFor` collapses to `[]` despite the registered list being non-empty. Captures `stage`, `track`, `taskClass`, `runId`, `ts`. `readDelegationEvents` recognizes and skips this audit-only event (it is not a delegation lifecycle event).
- **`checkMandatoryDelegations(...)` return shape gained `skippedByTrack: boolean`.** Callers can render an "auto-skipped (lite track)" badge instead of a missing-delegations finding.
- **Adaptive-elicitation skill** gained a "Topic tagging (MANDATORY for forcing-question rows)" section with a Russian Q&A example demonstrating the `[topic:<id>]` convention.
- **`## Q&A Log` templates** for `01-brainstorm.md`, `02-scope.md`, `03-design.md` show an example row with `[topic:<id>]` and a note that the tag is mandatory for forcing-question rows.
- **Automatic stage delegation table** in `src/content/subagents.ts` now footnotes the track-aware skip: "Mandatory agents are skipped for `track === "quick"` OR `taskClass === "software-bugfix"`."

### Migration

- **Existing `## Q&A Log` artifacts that addressed forcing questions in prose only.** Stamp the matching `[topic:<id>]` tag in the `Decision impact` cell of the answering row, otherwise `qa_log_unconverged` will block `stage-complete`. Multiple tags allowed when one answer covers several topics. Stop-signal rows do NOT need a tag.
- **External tooling that called `extractForcingQuestions(stage)`** and indexed by string. Read `.id` (or `.topic`) from each `ForcingQuestionTopic` instead.
- **Custom callers of `mandatoryDelegationsForStage`.** Switch to `mandatoryAgentsFor(stage, track, taskClass?)` so the lite/bugfix skip is applied uniformly. Direct callers of the registry helper bypass the Wave 24 drop.
- **Harness UI parsers that read `delegation-events.jsonl`.** Either upgrade to the bundled `readDelegationEvents` (which now ignores audit events) or add `mandatory_delegations_skipped_by_track` to your event allow-list. Lines of this type are not delegation lifecycle events and have no `agent` field.

## 5.0.0 — Dedupe stages, Ralph-Loop convergence Q&A, trim review, forward idea evidence

### Breaking Changes

- **`qa_log_below_min` linter rule renamed to `qa_log_unconverged`.** The fixed-count Q&A floor (10 / 5 / 2 substantive rows for standard/medium/quick) is replaced with a Ralph-Loop convergence detector. Stage closes Q&A when ANY of the following hold:
  - All forcing-question topics from the stage's checklist (the `**<Stage> forcing questions (must be covered or explicitly waived)**` row) appear addressed in `## Q&A Log` (substring keyword match in question/answer columns).
  - The last 2 substantive rows have `decision_impact` tagged `skip` / `continue` / `no-change` / `done` (no new decision-changing rows — Ralph-Loop convergence).
  - An explicit user stop-signal row is recorded (`QA_LOG_STOP_SIGNAL_PATTERNS` keep working: `достаточно`, `хватит`, `enough`, `stop-signal`, `move on`, `досить`, `вистачить`, `рухаємось далі`, etc.).
  - `--skip-questions` flag was persisted (downgrades to advisory).
  - The stage exposes no forcing-questions row AND the artifact has at least one substantive row.
- **`CCLAW_ELICITATION_FLOOR=advisory` env override removed.** The Ralph-Loop convergence detector subsumes the use case; `--skip-questions` remains the documented escape hatch.
- **Lite-tier short-circuit removed.** `quick` track no longer relies on a "1 substantive row passes" rule; convergence semantics handle it (no forcing-questions row + 1 row = converged).
- **`min` and `liteShortCircuit` fields on `QaLogFloorResult` / `QaLogFloorSignal` are now legacy.** They always report `0` / `false` for harness UI compatibility. Harness UIs may render `questionBudgetHint(track, stage).recommended` separately as a soft hint.

### Removed — pure stage duplications (variant A "dedupe only")

The 8-stage structure (`brainstorm / scope / design / spec / plan / tdd / review / ship`) is unchanged. Pure duplications between stages are reassigned to a single owner; downstream stages cite via `Upstream Handoff`.

- **Premise → brainstorm-only.** Scope `## Premise Challenge` removed (replaced with optional `## Premise Drift` for new evidence). Scope cites brainstorm's Premise Check via `Upstream Handoff`. The `Premise Challenge` validator and `validatePremiseChallenge` linter helper are gone.
- **Architecture-tier choice → design-only.** Scope `## Implementation Alternatives` removed; scope only locks `## Scope Mode` (HOLD / SELECTIVE / EXPAND / REDUCE). Design owns the architecture tier in `## Architecture Decision Record (ADR)` + `## Engineering Lock`.
- **Out-of-scope → scope-only.** Design `## NOT in scope` removed; design's `Upstream Handoff` cites scope's `## Out of Scope`. Brainstorm's `## Not Doing` (different altitude — product non-goals) stays.
- **Repo audit → scope-only.** Design `## What Already Exists` replaced with `## Blast-radius Diff` (only `git diff` since the scope-artifact baseline SHA, not a full repo audit). Scope owns the full audit in `## Pre-Scope System Audit`.
- **Constraints / Assumptions split.** Scope owns external/regulatory/system/integration constraints in `## Scope Contract`. Spec owns testable assumptions in `## Assumptions Before Finalization` (with validation path + disposition); spec's `## Constraints and Assumptions` is now carry-forward-only.

### Trimmed — `review` / `tdd` overlap

- `tdd.Per-Slice Review` OWNS severity-classified findings WITHIN one slice (correctness, edge cases, regression for that slice).
- `review` OWNS whole-diff Layer 1 (spec compliance) plus Layer 2 cross-slice integration findings (cross-slice correctness, security sweep, dependency/version audit, observability, external-safety).
- Performance + architecture findings are CARRY-FORWARD from `03-design-<slug>.md` (`Performance Budget`, `Architecture Decision Record`); they are NOT re-derived in review.
- New `review.no_cross_artifact_duplication` linter rule (P1, required): when a finding ID (`F-NN`) appears in both `06-tdd.md > Per-Slice Review` and `07-review-army.json`, severity and disposition MUST match. Review may cite tdd findings; never re-classify them.
- The Performance Lens and Architecture Lens entries in `review.reviewLens` become carry-forward summaries that cite design instead of independent specialist passes.

### Added — `/cc-ideate` -> brainstorm evidence forwarding

- `cclaw internal start-flow` accepts new `--from-idea-artifact=<path>` and `--from-idea-candidate=I-<n>` flags. They persist `interactionHints.brainstorm.{fromIdeaArtifact, fromIdeaCandidateId, recordedAt}` into atomic flow-state on session start. `--from-idea-candidate` requires `--from-idea-artifact`.
- `StageInteractionHint` schema gained `fromIdeaArtifact?: string` and `fromIdeaCandidateId?: string`. Both round-trip through `sanitizeInteractionHints`.
- New brainstorm checklist row: **"Idea-evidence carry-forward (when applicable)."** When the hint is set, brainstorm reuses the chosen `I-#` row's `Title / Why-now / Expected impact / Risk / Counter-argument` as the `baseline` Approach + the seed of `## Selected Direction`. Only the higher-upside `challenger` row(s) are newly generated; the divergent + critique + rank work from `/cc-ideate` is not redone.
- New optional `## Idea Evidence Carry-forward` artifact section in `01-brainstorm-<slug>.md`. New brainstorm linter finding `brainstorm.idea_evidence_carry_forward` (P1, required) blocks `stage-complete` when the hint is set but the section is missing or fails to cite the artifact path / candidate id; suppressed entirely when the hint is absent.
- `/cc-ideate` skill Phase 6 ("Start /cc on the top recommendation") and the contract Phase 9 handoff prose now explicitly call out the new start-flow flags so the harness shim cannot drop the candidate evidence on the floor.

### Added — supporting infrastructure

- `extractForcingQuestions(stage)` helper exported from `src/artifact-linter/shared.ts`. Scans the stage's `executionModel.checklist` for the canonical forcing-questions row and tokenizes the comma-separated topics.
- `evaluateQaLogFloor` returns `forcingCovered: string[]`, `forcingPending: string[]`, and `noNewDecisions: boolean` for richer harness diagnostics.
- New `checkReviewTddNoCrossArtifactDuplication` exported from `artifact-linter` for the cross-artifact-duplication guard.

### Migration

- **Linter rule rename.** Any external tooling that grepped for `qa_log_below_min` in `cclaw` output must be updated to match `qa_log_unconverged`.
- **Removed env override.** Replace `CCLAW_ELICITATION_FLOOR=advisory` usages with the documented `--skip-questions` flag (or fold into the convergence path: append a stop-signal row).
- **Scope artifacts.** If your `02-scope-<slug>.md` carries `## Premise Challenge`, `## Implementation Alternatives`, leave them in place — they are no longer linter-required and are simply ignored. New scope artifacts should rely on `## Scope Contract` (with explicit `Constraints` and `Design handoff` bullets) and the optional `## Premise Drift` for new evidence.
- **Design artifacts.** `## NOT in scope` and `## What Already Exists` sections in legacy `03-design-<slug>.md` are no longer linter-required. New design artifacts use `## Blast-radius Diff` (cite the scope-artifact head SHA) and rely on scope for the out-of-scope contract.
- **Spec artifacts.** Migrate constraint statements from `## Constraints and Assumptions` to scope's `## Scope Contract > Constraints`; keep only testable assumptions in spec's `## Assumptions Before Finalization`.
- **Review artifacts.** Performance and architecture findings should now appear as carry-forward citations to `03-design-<slug>.md` rather than independent Layer 2 entries. If a finding ID is shared with tdd Per-Slice Review, severity and disposition MUST match (cross-artifact-duplication linter blocks otherwise).
- **`/cc-ideate` handoff.** Harness shims that translate `/cc <phrase>` into `start-flow` should plumb the originating idea artifact path and candidate id via the new flags. Without the flags, brainstorm still works the old way (no carry-forward enforced).

## 4.0.0 — Enforce adaptive elicitation

### Breaking Changes

- **Elicitation floor is now blocking.** A new `qa_log_below_min` artifact-linter rule blocks `stage-complete` for `brainstorm` / `scope` / `design` whenever `## Q&A Log` has fewer substantive rows than `questionBudgetHint(track, stage).min` (default `min: 10` for `standard`, `5` for `medium`, `2` for `quick`). Escape hatches: a recognized stop-signal row in any cell (RU/EN/UA: `достаточно`, `хватит`, `enough`, `stop-signal`, `move on`, `досить`, `вистачить`, `рухаємось далі`, etc.), `--skip-questions` flag (downgrades to advisory), or `quick` track with at least one substantive row (lite short-circuit).
- **Removed `No Scope Reduction Language` linter rule.** False positives on legitimate `v1.` / `for now` / `later` / `temporary` strings made it actively harmful. Scope reduction intent is now communicated via decision rationale, not pattern matching.
- **Removed `Locked Decisions Hash Integrity` (`LD#hash`) linter rule and the `LD#<sha8>` anchor contract.** Stable `D-XX` IDs replace the brittle hash-anchor scheme everywhere: artifact templates, cross-stage reference checks (`Locked Decision Reference Integrity` finding now keys off `D-XX`), wave carry-forward guidance, plan/spec/review/design prompts. Existing artifacts that still use `LD#hash` anchors will not trip a hash check anymore but should be migrated to `D-XX` for cross-stage traceability.

### Added — adaptive elicitation enforcement

- `adaptive-elicitation/SKILL.md` rewritten with a **Hard floor** anchor, explicit `## Anti-pattern (BAD examples)` section, mandatory one-question-at-a-time rule, and prohibition on running shell hash commands (`shasum`, `sha256sum`, `Get-FileHash`, `certutil`, `md5sum`) or pasting `cclaw` command lines into chat.
- Brainstorm / scope / design stage bodies inverted: **adaptive elicitation comes first, no exceptions, no subagent dispatch before**. Mandatory delegations (`product-discovery`, `critic`, `planner`, `architect`, `test-author`) now declare `runPhase: "post-elicitation"` and run only after the user approves the elicitation outcome. Sequence: Q&A loop → propose draft → user approval → mandatory delegation → `stage-complete`.
- `STAGE_AUTO_SUBAGENT_DISPATCH` schema gained an optional `runPhase: "pre-elicitation" | "post-elicitation" | "any"` field. Materialized stage skills render a new **Run Phase** column and a legend explaining the ordering contract.
- `evaluateQaLogFloor` helper exported from `src/artifact-linter/shared.ts` powers both the linter rule and the `gate-evidence.ts` `qaLogFloor` signal returned to the harness UI.
- `--skip-questions` flag on `advance-stage` is now read by the linter for the **current** stage (via `lintArtifact({ extraStageFlags })`) in addition to being persisted to the next stage's `interactionHints`.

### Added — Cursor zero-install baseline

- New `.cursor/rules/cclaw-guidelines.mdc` is materialized when the Cursor harness is enabled. The rule has `alwaysApply: true` and pins three baselines that survive even if a stage skill never loads:
  1. Q&A floor before drafting (brainstorm / scope / design).
  2. Mandatory subagents run after Q&A approval.
  3. Never echo `cclaw` command lines, `--evidence-json` payloads, or shell hash commands into chat.
- `AGENTS.md` (and `CLAUDE.md`) generated by `harness-adapters.ts` carries the same three-rule baseline so Claude / Codex / OpenCode harnesses receive identical guidance.

### Changed — UX hardening

- `stage-complete.mjs` defaults to quiet success (`CCLAW_STAGE_COMPLETE_QUIET=1`). Agents no longer paste the full helper command line into chat; they read the resulting JSON instead.
- `delegation-record.mjs` gained `--dispatch-surface` flag. Three legal fulfillment surfaces for mandatory delegations: `cursor-task` (harness-native Task tool, sets `fulfillmentMode: "generic-dispatch"`), `role-switch` (announces `## cclaw role-switch:` block, sets `fulfillmentMode: "role-switch"`), or `isolated` (cclaw subagent helper).

### Migration

- Projects with empty `## Q&A Log` in an active brainstorm / scope / design will see `stage-complete` fail until either the Q&A loop continues or an explicit user stop-signal row is recorded. Add a row like `| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |` to bypass.
- Replace any remaining `LD#<sha8>` anchors in scope artifacts with `D-XX` IDs; downstream design / plan / spec / review references must use `D-XX` to satisfy `Locked Decision Reference Integrity`.
- `brainstorm.md` / `scope.md` / `design.md` skill bodies now require Q&A first; agents that previously drafted-then-asked will need to re-read their stage skill on session start.
- Emergency override: `CCLAW_ELICITATION_FLOOR=advisory` env var downgrades `qa_log_below_min` to advisory globally (undocumented safety net; not a feature).

## 3.0.0 — Honest core

### Breaking Changes

- Reduced hook runtime surface from 9 handlers to 2 handlers only: `session-start` and `stop-handoff`.
- Removed all strict/profile/disabled-hook switching: `strictness`, `hookProfile`, `disabledHooks`, `CCLAW_STRICTNESS`, and profile-gated runtime paths no longer exist.
- Removed config knobs and parser support for: `gitHookGuards`, `vcs`, `tdd`, `tddTestGlobs`, `compound`, `earlyLoop`, `defaultTrack`, `languageRulePacks`, `trackHeuristics`, `sliceReview`, `ironLaws`, `optInAudits`, and `reviewLoop`.
- Removed hook artifacts for retired handlers (`prompt-guard.jsonl`, `workflow-guard.jsonl`, `context-monitor.json`, `session-digest.json`, etc.); runtime no longer emits them.
- Removed cclaw-managed git hook relays and language-pack materialization under `.cclaw/rules/lang/*`.

### Changed

- `.cclaw/config.yaml` is now harness-only: user-facing config contains only `harnesses`, while `version` and `flowVersion` are auto-managed stamps.
- `cclaw init` now writes the minimal 3-key config shape and no longer auto-detects/expands advanced config sections.
- Session-start runtime now rehydrates flow/knowledge context only and no longer runs background helper pipelines (`tdd-loop-status`, `early-loop-status`, `compound-readiness`).
- `stop-handoff` keeps safety bypass + max-2 dirty-tree hard-block cap, but no longer depends on strictness/profile toggles.
- Runtime integrity and downstream consumers now use hardened defaults instead of optional config branches for removed knobs.

### Migration

- Any removed key in `.cclaw/config.yaml` now fails fast with:
  - `key X is no longer supported in cclaw 3.0.0; see CHANGELOG.md`
- Remove retired keys and keep only:
  - `version`
  - `flowVersion`
  - `harnesses`

## 2.0.0

### Breaking Changes

- Fresh `cclaw init` no longer materializes `.cclaw/state/flow-state.json`; missing flow-state is now an expected fresh-init condition until a run is explicitly started.
- Hook contract schema bumped to `2` and legacy `pre-compact` compatibility wiring removed from generated hook manifests/schemas.
- Cursor/Codex hook routing now consolidates multiple guard calls into single in-process pipeline handlers (`pre-tool-pipeline`, `prompt-pipeline`).

### Added

- New shared `adaptive-elicitation` skill with harness-native one-question dialogue, stop-signal handling (RU/EN/UA), smart-skip, conditional grilling triggers, stage forcing-question sets, and irreversible override guardrails.
- New `## Q&A Log` contract for brainstorm/scope/design templates, with append-only turn logging guidance.
- New track/stage-aware `questionBudgetHint(track, stage)` guidance source for adaptive elicitation.
- New advisory lint finding `qa_log_missing` for brainstorm/scope/design artifacts when the Q&A dialogue section is missing or empty.
- New internal `--skip-questions` flag for `internal advance-stage`, persisted as successor-stage interaction hint and surfaced in session-start context.
- New session-start digest cache (`.cclaw/state/session-digest.json`) with debounced background refresh flow for ralph/early-loop/compound-readiness status lines.

### Changed

- `start-flow` helper defaults to quiet mode (`CCLAW_START_FLOW_QUIET=1`) to reduce harness chat noise.
- Stage skill guidance now explicitly preserves existing artifact structure (no wholesale template overwrites) and carries forward locked-decision traceability.
- Brainstorm/scope/design stage schemas now reference adaptive elicitation explicitly and include stage-level forcing-question expectations.
- `delegation-record --rerecord` now preserves/propagates `--evidence-ref` reliably across rerecord flows.
- Artifact linting now emits advisory duplicate-H2 findings and expanded Wave-20 regression coverage across hooks, manifests, templates, and stage skill contracts.

## 1.0.0

### Breaking Changes

- Removed legacy agent names with no compatibility aliases: `performance-reviewer`, `compatibility-reviewer`, `observability-reviewer`, `implementer`, `product-manager`, and `product-strategist`.
- Brainstorm/scope product delegation now routes through unified `product-discovery` (`discovery` + `strategist` modes).
- `enhancedAgentBody` overlap was removed; task-delegation guidance is now sourced directly from `core-agents` output.

### Added

- Wave 14 critic uplift: `critic` now follows a multi-perspective protocol with pre-commitment predictions, gap analysis, low-confidence self-audit routing into `openQuestions[]`, realist checks for major findings, and optional adversarial escalation.
- Added `critic-multi-perspective` subagent-context skill and bound critic dispatch rows in brainstorm/scope/design to this skill.
- Wave 15 document review lens: added `coherence-reviewer`, `scope-guardian-reviewer`, and `feasibility-reviewer` specialists plus context skills (`document-coherence-pass`, `document-scope-guard`, `document-feasibility-pass`).
- Extended dispatch matrix with proactive document-review routing across scope/spec/plan/design based on consistency, scope-drift, and feasibility triggers.
- Wave 17 orchestration uplift: added optional `cohesion-contract.md` + `cohesion-contract.json` templates and introduced `integration-overseer` for TDD fan-out reconciliation.
- Wave 18 orchestration uplift: added proactive `divergent-thinker` for brainstorm/scope option-space expansion and materialized the top-level `executing-waves` skill plus `.cclaw/wave-plans/.gitkeep` scaffold.

### Changed

- Added linter enforcement (`critic.predictions_missing`) for brainstorm/scope/design artifacts that include critic findings but omit required prediction validation blocks (`Pre-commitment predictions`, `Validated / Disproven`, `Open Questions`).
- Added layered-review enforcement for document reviewers in plan/spec/design artifacts: structured calibrated findings are required when these reviewers are cited, and FAIL/PARTIAL outcomes require explicit waiver.
- Wave 16A reviewer-lens consolidation: `reviewer` now carries mandatory inline `Lens Coverage` output (Performance/Compatibility/Observability), and review lint enforces this via `[P1] reviewer.lens_coverage_missing`.
- Removed proactive dispatch fan-out for dedicated performance/compatibility/observability reviewers; these lenses are now inline by default with optional deep-dive context skills (`review-perf-lens`, `review-compat-lens`, `review-observability-lens`).
- Wave 16B worker/discovery consolidation: `slice-implementer` now supports `TDD-bound` and `Generic` modes, and product discovery/strategy responsibilities are unified under `product-discovery`.
- TDD lint now enforces fan-out cohesion hygiene: when >1 completed `slice-implementer` rows exist for the active run, `.cclaw/artifacts/cohesion-contract.md` + parseable `.json` sidecar and a PASS/PASS_WITH_GAPS `integration-overseer` evidence row are required (`tdd.cohesion_contract_missing`, `tdd.integration_overseer_missing`).
- Ship-stage dispatch and lint now enforce architect cross-stage verification before finalization (`architect-cross-stage-verification`, `ship.cross_stage_cohesion_missing`, `ship.cross_stage_drift_detected`).
- Brainstorm lint now enforces multi-wave carry-forward drift audits when `.cclaw/wave-plans/` contains 2+ plans (`wave.drift_unaddressed`).

## 0.56.0

### Breaking Changes

- Slimmed the canonical knowledge schema to core fields only for new writes. New `appendKnowledge` / stage `## Learnings` harvest no longer persists legacy metadata keys (`domain`, `origin_run`, `universality`, `maturity`, `supersedes`, `superseded_by`).

### Changed

- Kept read compatibility for historical mixed-schema `.cclaw/knowledge.jsonl` rows while normalizing in-memory entries to the core schema shape.
- Simplified `retro-gate` to closeout-state-driven completion (`(retroAccepted || retroSkipped) && (compoundReviewed || compoundSkipped)`), removing knowledge-window scanning from gate evaluation.
- Expanded shared runtime snippets used by both generated Node hooks and OpenCode plugin (`flow summary`, `knowledge digest parsing`, `active artifacts path`) to reduce duplicated runtime logic.
- Added hook bundle infrastructure: `src/runtime/run-hook.entry.ts`, `build:hook-bundle`, `esbuild` dev dependency, and installer support that prefers bundled `dist/runtime/run-hook.mjs` with safe fallback to generated runtime source.

## 0.55.2

### Changed

- Finalized the artifact-linter split from Wave 12: moved shared helpers/validators into `src/artifact-linter/shared.ts`, moved design-only diagram drift/tier helpers into `src/artifact-linter/design.ts`, removed stage-module `// @ts-nocheck`, and slimmed `src/artifact-linter.ts` into a real orchestrator.
- Finalized the internal advance-stage split from Wave 12: removed `src/internal/advance-stage/core.ts`, turned `src/internal/advance-stage.ts` into the real `runInternalCommand` dispatcher, and moved parser/helper/review-loop/flow-state/runners logic into dedicated modules under `src/internal/advance-stage/`.
- Bumped package runtime version to `0.55.2` so package metadata matches the current changelog series.

## 0.55.1

### Changed

- Renamed plan-stage lint findings to `Plan Quality Scan: Placeholders` and `Plan Quality Scan: Scope Reduction` for consistency with the merged `Plan Quality Scan` template heading.

### Removed

- Removed the unused legacy `VibyConfig` type alias in favor of `CclawConfig`.

## 0.55.0

### Changed

- Simplified stage templates and validation contracts across brainstorm/scope/design/plan/review: merged plan scans into `Plan Quality Scan`, merged review pre-critic framing into `Pre-Critic Self-Review`, and replaced deep design triple-diagram sections with one `Deep Diagram Add-on` section that accepts `state-machine` or `rollback-flowchart` or `deployment-sequence` markers.
- Updated design diagram requirement enforcement to support the merged deep add-on marker contract while preserving standard-tier architecture/data-flow/error-flow requirements.
- Demoted `Vague to Fixed` (spec) and `Assertion Correctness Notes` (tdd) to template-only optional guidance (no schema-level artifact-validation row).
- Unified generated helper runtime bootstrapping: `stage-complete.mjs` now reuses the shared `internalHelperScript()` with a required positional `<stage>` argument.
- Slimmed iron-law skill output to focus full detail on the two runtime hook-enforced laws (`stop-clean-or-handoff`, `review-coverage-complete-before-ship`), while listing remaining laws as stage-owned advisory items.

### Removed

- Removed duplicate `Test Strategy` artifact-validation row in design stage schema.
- Removed retired brainstorm structural checks and template sections for `Forcing Questions`, `Premise List`, and `Anti-Sycophancy Stamp`.
- Removed retired scope sections/checks for `Failure Modes Registry`, `Reversibility Rating`, `Dream State Mapping`, and `Temporal Interrogation`.
- Removed retired design sections/checks for `ASCII Coverage Diagram`, plus orphaned design/review `Learning Capture Hint` blocks.
- Removed orphaned design template sections `Regression Iron Rule` and `Calibrated Findings` (plan retains the canonical versions).
- Removed unused seed-shelf runtime module/test pair (`src/content/seed-shelf.ts`, `tests/unit/seed-shelf.test.ts`) while preserving user-facing `.cclaw/seeds/` guidance in templates.
- Removed diagnostic-only `cclaw internal hook-manifest` command and its unit test surface.

## 0.54.0

### Added

- Added wave-9 TDD evidence enforcement: `Iron Law Acknowledgement`, `Watched-RED Proof`, and `Vertical Slice Cycle` are now required stage gates/sections; template now includes `Per-Slice Review` and `TDD Blocker Taxonomy`; lint adds a `Mock Preference Heuristic` recommendation when mocks/spies appear without explicit trust-boundary justification.
- Added wave-9 spec strengthening: `Spec Self-Review` is now a required gate/section, spec lint emits a `Single-Subsystem Scope` recommendation when `Architecture Modules` grows beyond one coherent subsystem boundary, and a proactive `spec-document-reviewer` specialist is available for plan-readiness review.
- Added wave-9 plan review structure: plan schema/template now supports recommended `Calibrated Findings` and `Regression Iron Rule` sections, with dedicated lint findings for canonical format and acknowledgement.

### Changed

- Promoted `Synthesis Sources`, `Behavior Contract`, and `Architecture Modules` into explicit spec artifact-validation rows (recommended) so schema/docs align with existing lint checks.
- Promoted `Implementation Units` into an explicit plan artifact-validation row (recommended) to match existing shape checks.

### Removed

- Removed spec template sections `Testing Strategy` and `Reviewer Concerns (convergence guard)` as orphaned/duplicative scaffolding.
- Removed plan template sections `High-Level Technical Design` and `Plan Self-Review` in favor of upstream design ownership plus calibrated/iron-rule review sections.
- Removed TDD template sections `Anti-Rationalization Checks` and `Learning Capture Hint` after promoting stronger required evidence sections.

## 0.53.0

### Added

- Added a `product-strategist` specialist and scope-mode enforcement: when scope selects `SCOPE EXPANSION` or `SELECTIVE EXPANSION`, artifact validation now requires a completed active-run `product-strategist` delegation row with non-empty evidence refs.
- Added wave-8 stage structure upgrades: brainstorm now includes a recommended `Embedded Grill` section, and design now includes a recommended compact `Long-Term Trajectory` section plus matching policy needles/templates.

### Changed

- Elevated design diagram freshness discipline: `optInAudits.staleDiagramAudit` is now default-on, design gates include `design_diagram_freshness`, and compact trivial-override slices without diagram markers are explicitly marked as a stale-audit skip instead of a hard failure.

## 0.52.0

### Breaking Changes

- Dropped legacy knowledge-entry compatibility aliases for the pre-cleanup idea source and old origin field. All knowledge rows must use canonical `source: "idea"` and `origin_run`.
- Removed installer cleanup/migration handling for pre-cleanup command/skill aliases from the retired next/idea-era shim set. Projects still carrying those legacy surfaces must run a manual `npx cclaw-cli uninstall && npx cclaw-cli init`.

## 0.51.28

### Fixed

- Made the artifact linter tolerate the actual shipped template shape: structural-field regexes for `Mode Block Token`, `Anti-Sycophancy Acknowledgement`, and `Regression Iron Rule Acknowledgement` now accept optional markdown emphasis (`*`, `**`, `_`) around both the field name and the value. Previously `- **Mode:** STARTUP` (the form the template ships and the agent fills in) failed validation because the regex only allowed plain whitespace between `Mode:` and the token.
- Extended `Approach Tier Classification` to recognize `lite` (alias for `Lightweight`) in addition to `Lightweight`, `Standard`, and `Deep`, so artifacts written verbatim from the `lite | standard | deep` template default are accepted. State-contract `approachTier` taxonomy now lists both spellings for downstream consumers.
- Added explicit placeholder detection for both `Mode Block` and `Approach Tier`: a line that lists ≥2 distinct tokens (the unfilled template placeholder, e.g. `Tier: lite | standard | deep`) now fails with a targeted message instead of silently passing on incidental token presence.

### Added

- Regression fixtures in `tests/unit/quality-gate-fixtures.test.ts` for the actual shipped template shape: bold-form `Mode Block` / `Anti-Sycophancy Stamp` / `Regression Iron Rule` pass; bold-form Mode placeholder fails; `Tier: lite` passes; `Tier: lite | standard | deep` placeholder fails. Earlier fixtures used the unbolded form (`- Mode: ENGINEERING`) which never exercised the runtime template.

## 0.51.27

### Fixed

- Hardened the delegation proof model with ledger schema v3 and a `legacy-inferred` fulfillment mode, so pre-v3 ledger rows are surfaced as `legacyRequiresRerecord` and explicitly upgraded via the `delegation-record.mjs --rerecord` helper instead of silently passing stage-complete.
- Locked the `delegation-record.mjs` helper down: `--dispatch-surface` now strictly validates against the `DELEGATION_DISPATCH_SURFACES` enum (rejecting legacy `task`), `--agent-definition-path` is verified against the harness-specific directory layout, and `--ack-ts` is mandatory for `event=completed` with isolated/generic surfaces.
- Split `stage-complete` diagnostics into granular categories (`missing`, `missingDispatchProof`, `legacyInferredCompletions`, `corruptEventLines`, `staleWorkers`, `waivedWithEvidence`) with per-failure `nextActions`, eliminating opaque "missing delegations" failures.
- Generated per-harness lifecycle recipes (OpenCode / Codex / Cursor / Claude) with the correct dispatch surface, neutral placeholders, and dispatch-surface table dynamically rendered from the runtime enum, keeping `docs/harnesses.md` in sync with `src/delegation.ts`.

### Changed

- Upgraded all eight stage templates (brainstorm → ship) and skills with universal, domain-neutral quality gates: mode selection blocks, premise-challenge / forcing questions, mandatory alternatives with calibrated confidence (1–10), STOP-per-issue protocol, anti-sycophancy framing, NO-PLACEHOLDERS rule, watched-RED proof for TDD, ASCII coverage diagrams for design, vertical-slice TDD with per-cycle refactor, and a 4-option ship gate. No domain-specific terminology (web, CRUD, dashboard, framework names) leaks into agent instructions, templates, or linter rules.
- Promoted reusable cross-cutting building blocks (`stopPerIssueBlock`, `confidenceCalibrationBlock`, `outsideVoiceSlotBlock`, `antiSycophancyBlock`, `noPlaceholdersBlock`, `watchedFailProofBlock`) in `src/content/skills.ts` so each stage skill composes the same mechanics consistently.
- Expanded the artifact linter with structural-only checks for every stage (presence of mode block, alternatives table columns, confidence-finding format, watched-RED evidence, etc.), keeping checks domain-neutral and agnostic to task type.

### Added

- `docs/quality-gates.md` mapping every cclaw section to its source pattern in `gstack`, `superpowers`, and `evanflow`, with diverse non-web examples (CLI utility, library, infra/migration).
- `tests/unit/quality-gate-fixtures.test.ts` with regression coverage for the helper (rejects `task`, validates path, requires `ack-ts`), the linter on diverse non-web task types across all 8 stages, and an end-to-end `--rerecord` flow that upgrades a legacy-inferred row to v3 and clears `legacyRequiresRerecord`.

## 0.51.25

### Fixed

- Added reference-grade subagent execution contracts with expanded specialist routing, worker lifecycle evidence, stricter delegation waivers, vertical-slice TDD guidance, managed recovery paths, and no-VCS verification support.
- Made the README a lighter operating front door with ASCII flow, recovery guidance, and subagent evidence framing, backed by a tracked `docs/scheme-of-work.md` flow contract.
- Added docs/generated contract regressions and refreshed generated guidance so status, recovery, track routing, and reference-pattern expectations stay aligned with runtime behavior.

## 0.51.24

### Fixed

- Upgraded brainstorm, scope, and design into an adaptive reference-grade flow with product/technical discovery, strategic scope contracts, and engineering-lock evidence.
- Strengthened staged specialist agents and review evidence so generated harness guidance requires anchored findings, changed-file coverage, security attestations, and dependency/version checks where relevant.
- Hardened runtime correctness around pre-push range detection, Codex hook readiness/wiring diagnostics, compound-before-archive checks, and knowledge/seed retrieval quality.

## 0.51.23

### Fixed

- Materialized generated stage command shims so stage skills no longer point agents at missing `.cclaw/commands/<stage>.md` files.
- Restored native subagent dispatch surfaces for OpenCode and Codex via generated `.opencode/agents/*.md` and `.codex/agents/*.toml` agent definitions, with role-switch retained only as a degraded fallback.
- Tightened harness delegation, hook/sync diagnostics, quick-track templates, and knowledge metadata regressions so installed runtime guidance matches validation behavior.

## 0.51.22

### Fixed

- Repaired audit-found flow contract gaps across runtime gates, generated templates, hooks, knowledge retrieval, delegation validation, and installer diagnostics.
- Added regressions for quick-track artifact scaffolds, retro/archive evidence validation, TDD refactor ordering, hook lifecycle coverage, init recovery, and canonical knowledge/delegation semantics.

## 0.51.19

### Fixed

- Materialized every subagent dispatch `skill` reference as a generated `.cclaw/skills/<skill>/SKILL.md` context skill, so mandatory/proactive routing no longer points agents at missing or deprecated skill folders.
- Added regression coverage that every dispatch `skill` reference is generated, every referenced agent exists in the core roster, install writes those context skills, and every required artifact validator section appears in that stage's canonical template.

## 0.51.18

### Fixed

- Aligned the brainstorm SKILL guidance and `Self-Review Notes` validation rule with the calibrated review format (`Status: Approved` | `Issues Found`, `Patches applied:`, `Remaining concerns:`); removed the legacy "or - None." shortcut that contradicted the structural validator and caused first-attempt stage-complete failures.
- Added a Context Loading step that points every stage skill at its canonical artifact template (`.cclaw/templates/<NN>-<stage>.md`) so agents draft per-row Approaches tables and the calibrated review block from the start instead of inventing layouts that fail validation.

## 0.51.17

### Fixed

- Relaxed the brainstorm calibrated `Self-Review Notes` validator: it now accepts `Status:` lines with trailing context, treats both inline notes and sub-bullets as valid for `Patches applied:` / `Remaining concerns:`, and reports per-line problems instead of one opaque message. The unfilled placeholder `Status: Approved | Issues Found` is now explicitly rejected with an actionable hint to pick exactly one value.
- Updated the brainstorm artifact template default to `Status: Approved` so freshly drafted artifacts pass validation without manual placeholder cleanup, while review-prompt documentation continues to show both canonical values.

## 0.51.16

### Fixed

- Fixed OpenCode hook execution so generated plugins spawn a real Node executable instead of accidentally re-entering the OpenCode CLI through `process.execPath`.
- Added active stage contracts and calibrated review prompts to session bootstrap context, making stage structure and self-review expectations visible before artifact drafting.
- Improved brainstorm validation feedback for transposed `Approaches` tables and enforced calibrated `Self-Review Notes` format when that section is present.
- Made managed `start-flow` record seed, origin-document, and stack-marker discovery in `00-idea.md`.
- Added automatic delegation-log waivers for untriggered proactive dispatch rows so skipped helper reviews remain auditable.

## 0.51.15

### Fixed

- Added real test-command discovery for verification gates: `tdd_verified_before_complete` and `review_trace_matrix_clean` now check gate evidence against discovered project test commands when available.
- Updated review templates and stage skills to record verification command discovery explicitly.

## 0.51.14

### Fixed

- Added cross-stage reference checks so downstream design/spec/plan/review artifacts must reference every scope `R#` requirement and `LD#hash` locked-decision anchor.
- Updated scope/design/spec/plan templates to use `LD#hash` decision anchors instead of the legacy `D-XX` convention.
- Added structural validation for `LD#<sha8>` locked-decision anchors, including uniqueness and table hash consistency.

## 0.51.13

### Fixed

- Added generated per-stage state contracts under `.cclaw/templates/state-contracts/*.json` with `requiredTopLevelFields`, `taxonomies`, and `derivedMarkdownPath` so machine-readable stage shape is explicit.
- Added calibrated review prompt files for brainstorm self-review, scope CEO review, and design engineering review under `.cclaw/skills/review-prompts/`.
- Added a macOS Node 20 PR-gate job alongside Linux and Windows, and added install smoke coverage for state contracts and review prompts.

## 0.51.12

### Fixed

- Replaced brainstorm challenger detection with structural `Approaches` table validation: `Role` must be `baseline`, `challenger`, or `wild-card`; `Upside` must be `low`, `modest`, `high`, or `higher`; exactly one challenger must have `high` or `higher` upside.
- Added structural `Requirements` priority validation for scope artifacts (`P0`, `P1`, `P2`, `P3`, or `DROPPED`) instead of leaving priority as unchecked prose.
- Updated brainstorm regressions to use canonical `Role`/`Upside` columns, including non-Latin artifact prose with stable machine-readable taxonomy fields.

## 0.51.11

### Fixed

- Removed the generic validation-rule keyword matcher entirely, so artifact prose is no longer checked by copied English/backticked words from schema descriptions.
- Made `Premise Challenge` bullet validation depend only on substantive row content, not question marks or English Q/A phrasing.
- Replaced the Russian-specific Scope Summary regression with a non-Latin-script regression spanning multiple scripts, so the guard protects all natural languages rather than one test case.

## 0.51.10

### Fixed

- Replaced the brittle keyword-grep on `Scope Summary` with structural validation that requires a canonical scope mode token (`SCOPE EXPANSION` / `SELECTIVE EXPANSION` / `HOLD SCOPE` / `SCOPE REDUCTION`) and a track-aware next-stage handoff, so non-English scope artifacts no longer fail validation for missing English keywords.
- Made `Premise Challenge` validation purely structural (≥3 substantive Q/A rows in a table or bullet list); answers may be in any language and the linter no longer requires the literal English question phrasing.
- Tightened `extractRequiredKeywords` to fire only on backticked machine-surface tokens, so descriptive prose in validation rules stops being mis-treated as required keywords.

### Changed

- Strengthened the `brainstorm` execution model and template with reference-grade structure: `Premise Check`, `How Might We` reframing, `Sharpening Questions` (decision-impact column), `Not Doing` list, `Self-Review Notes`, and a stable `Approaches` table with canonical `Role` (`baseline` | `challenger` | `wild-card`) and `Upside` (`low` | `modest` | `high` | `higher`) columns.
- Strengthened the `scope` execution model with an explicit premise + leverage check and mode-specific analysis matched to the chosen gstack mode (SCOPE EXPANSION / SELECTIVE EXPANSION / HOLD SCOPE / SCOPE REDUCTION); template now exposes `Strongest challenges resolved` and `Recommended path` as explicit Scope Summary fields.

## 0.51.3

### Fixed

- Aligned brainstorm artifact templates and generated skill validation guidance with the hidden linter checks for `Approach Reaction`, `Selected Direction`, and `challenger: higher-upside` rows.
- Made brainstorm artifact validation failures include actionable rule/details text instead of only opaque check names such as `Direction Reaction Trace`.
- Reinforced brainstorm interaction guidance so structured question tools ask one decision-changing question at a time instead of bundled multi-question forms.

## 0.51.2

### Fixed

- Fixed `internal advance-stage` and generated `stage-complete.mjs` compatibility with real shell usage by accepting both `--evidence-json=<json>` and `--evidence-json <json>` forms.
- Coerced boolean/object/number gate evidence JSON values into stored evidence strings so copied completion commands do not silently drop non-string evidence.
- Strengthened generated stage completion guidance to stop on helper failures instead of manually editing `flow-state.json`, preserving validation and `## Learnings` harvest.

## 0.51.1

### Fixed

- Made generated `stage-complete.mjs` advance stages through the local Node runtime instead of requiring a runtime `cclaw` binary in `PATH`, preserving gate validation and `## Learnings` harvest.
- Clarified generated prompts and docs so `cclaw-cli` is the installer/support surface while `/cc*` commands and Node hooks are the normal in-session runtime.
- Added a generated Conversation Language Policy so user-facing prose follows the user's language while stable commands, ids, schemas, and artifact headings remain canonical.
- Aligned normal-flow knowledge guidance around artifact-first `## Learnings` capture and reserved direct JSONL writes for explicit manual learning operations.

## 0.51.0

### Fixed

- Made `npx cclaw-cli sync` discoverable in CLI help, always print fixes for
  failing checks, and point recovery docs at existing local files.
- Fixed non-flow headless envelopes for `/cc-idea` and `/cc-view` so they no
  longer masquerade as brainstorm/review stage outputs.
- Made `sync --only` JSON and exit-code semantics scoped to the filtered
  checks while preserving `globalOk` for the full suite.
- Replaced bash-based Node probing in sync with platform-native command
  checks, and made hook wrappers loudly report skipped hooks when `node` is
  missing.

### Changed

- Added digest-first knowledge wording to session/research guidance and
  standardized resume wording on `/cc`.
- Centralized post-ship closeout substate guidance and strengthened
  verification-before-completion wording.
- Added a flow-state schema version for future migrations.
- Improved onboarding with Node 20+, repo-root install guidance, local docs
  pointers, and a static generated `AGENTS.md` block example.

## 0.50.0

Full phase-1 cleanup. This release removes the remaining heavy surfaces
that made a fresh install feel like a framework dump instead of a harness
workflow tool.

### Removed

- Removed the feature/worktree system, including the `feature-system`
  runtime, generated worktree state, and the user-facing feature command
  surface.
- Removed `/cc-ops` and its legacy subcommands. Flow progression and
  closeout now stay on `/cc`; explicit archival/reset stays on
  `cclaw archive`.
- Shrank generated commands to the four real entrypoints: `/cc`,
  `/cc`, `/cc-idea`, and `/cc-view`.
- Stopped scaffolding derived/cache state files on init. Runtime hooks now
  create optional diagnostics only when needed.
- Removed broad default utility skills and kept the generated skill surface
  focused on flow stages, cclaw routing, subagent/parallel dispatch,
  session, learnings, research playbooks, and opt-in language rule packs.
- Removed the internal eval harness, its CLI command, fixtures, docs,
  tests, and the unused `openai` runtime dependency.
- Removed stale generated-reference templates and docs that pointed users
  at `.cclaw/references`, `.cclaw/contexts`, worktrees, or `/cc-ops`.
- Removed the unused internal `knowledge-digest` subcommand and stopped
  materializing `knowledge-digest.md`; session bootstrap reads
  `knowledge.jsonl` directly.
- Removed saved `flow-state.snapshot.json` semantics from `/cc-view diff`.
  The view command is now read-only and uses visible git evidence instead
  of creating derived state.
- Removed the stale `.cclaw/features/**` preview line and remaining
  "active feature" wording from generated guidance after the feature
  system removal.
- Removed feature-system fields from new archive manifests; archives now
  record `runName` instead of `featureName` / `activeFeature`.
- Removed the legacy `/cc-learn` command surface from generated guidance.
  Knowledge work remains available through the `learnings` skill, while
  the visible slash-command surface stays at `/cc`, `/cc`,
  `/cc-idea`, and `/cc-view`.
- Removed an unused TDD batch walkthrough export and the large stage-skill
  golden snapshot file; contract tests now assert behavioral anchors instead
  of pinning generated prose.
- Stopped scaffolding the unused `stage-activity.jsonl` ledger. Fresh installs
  now start with only `flow-state.json` and `iron-laws.json` under
  `.cclaw/state`.
- Removed stale eval GitHub Actions workflows and `.gitignore` exceptions that
  still referenced deleted `.cclaw/evals` fixtures.
- Removed stale ignore/config entries for the deleted `docs/references` and
  `scripts/reference-sync.sh` reference-research surface.
- Consolidated `/cc-view` generated guidance into one `flow-view` skill with
  embedded `status`, `tree`, and `diff` subcommand sections. Sync now removes
  the old `flow-status`, `flow-tree`, and `flow-diff` skill folders.
- Removed obsolete standalone `status`, `tree`, and `diff` command contract
  generators that were only kept alive by tests after `/cc-view` consolidation.
- Converted view subcommand generators into embedded bodies without standalone
  skill frontmatter, matching the single generated `flow-view` surface.
- Replaced generated artifact template frontmatter `feature: <feature-id>` with
  `run: <run-id>` while keeping legacy `feature` frontmatter accepted for
  existing artifacts during migration.

### Changed

- Renamed the generated stop hook from `stop-checkpoint` to `stop-handoff`
  to match the simplified session model. Old managed `stop-checkpoint`
  entries are still recognized during sync cleanup.
- Renamed the stop safety law id to `stop-clean-or-handoff`; existing
  configs using the old checkpoint id are still honored.
- Simplified session bootstrap and stop behavior around artifact handoff
  instead of separate checkpoint/context/suggestion state files.
- Centralized legacy cleanup lists in init/sync so removed surfaces are
  easier to audit without changing upgrade cleanup behavior.
- Renamed pre-compact semantic coverage from digest wording to compatibility
  wording and aligned harness/view docs with `npx cclaw-cli sync`.
- Compact stage skills now fold inputs and required context into the existing
  context-loading block, reducing repeated generated sections while preserving
  the process map, gates, evidence, and artifact validation.
- Downstream stage artifacts now include a lightweight `Upstream Handoff`
  section for carried decisions, constraints, open questions, and drift
  reasons, so agents do not silently rewrite earlier stage choices.
- Knowledge JSONL entries now use `origin_run` instead of feature wording for
  new writes and generated guidance, while older pre-cleanup rows remained
  readable as an input alias at the time of this release.
- Codex legacy skill cleanup now removes any old `cclaw-cc*` folder by prefix
  instead of carrying a hardcoded list of obsolete command names.
- The generated meta-skill, shared stage guidance, `/cc`, and harness shims
  now show the whole flow explicitly: critical-path stages finish with
  `retro -> compound -> archive` through `/cc`.
- TDD dispatch guidance now presents one mandatory `test-author` evidence cycle
  for RED/GREEN/REFACTOR instead of implying three default subagents.
- Stage guidance now starts with a compact drift preamble, treats seed recall as
  reference context by default, and makes brainstorm/scope use lightweight
  compact paths before deeper checklists.
- Design/spec/plan guidance now adopts prompt-level investigator/critic, shadow
  alternative, acceptance mapping, and exact verification-command discipline
  without adding new runtime machinery.
- Review guidance now defaults to one reviewer plus mandatory security-reviewer,
  with adversarial review as a risk-triggered pass instead of ceremony for every
  large-ish diff.
- Generated status/docs/idea guidance now avoids stale waiver and legacy-layout
  wording in the primary user surface.
- Prompt-surface tests now prefer durable behavioral anchors over exact generated
  prose where schema and validator tests already cover the contract.
- Decision Protocol / structured-ask fallback wording is now shared across
  scope/design/review/ship/idea to reduce drift between stage prompts.
- Scope/design outside-voice loop guidance now renders from compact policy helpers
  in `review-loop.ts` instead of repeated prose blocks.
- Post-ship closeout wording is now sourced from shared closeout guidance
  helpers so /cc and meta-skill stay aligned on retro/compound/archive.
- /cc-idea knowledge scan guidance now matches the live knowledge schema
  (`rule|pattern|lesson|compound`, `origin_run`, trigger/action clustering).
- Track-aware render context now drives quick-track wording transforms for TDD/lint metadata, replacing duplicated brittle string-rewrite chains.
- Hook runtime compound-readiness summary now uses a shared inline formatter helper, with added parity coverage to reduce drift against canonical CLI wording.

### Preserved

- `retro -> compound -> archive` remains part of ship closeout through
  `/cc`.
- `cclaw archive` still archives active runs into `.cclaw/archive/`.
- Stage skills still keep decision, completion, verification, and
  closeout discipline, but now inline the needed guidance instead of
  making users chase generated reference files.

## 0.49.0

Dead-weight cut, pass 1. `.cclaw/` was shipping four scaffolded
directories whose content no runtime code ever consumed, no user ever
edited, and no test depended on beyond "file exists". Each added noise
to `ls .cclaw`, `npx cclaw-cli sync`, and `cclaw sync` without moving any
flow decision. This release removes them.

### Removed

- `.cclaw/adapters/manifest.json` — the "harness adapter provenance"
  file was never read outside of the three sync gates that verified
  its own existence. Dropped the file, its three
  `state:adapter_manifest_*` gates, and the init preview line.
- `.cclaw/custom-skills/` — opt-in scaffold for user-authored skills
  with a ~150-line README and a placeholder `example/SKILL.md`. In
  practice users either never opened the folder or put skills under
  `.cclaw/skills/` anyway. No routing layer ever discovered
  `custom-skills/*.md`. Dropped the dir, the install helper, the
  two template strings, and the using-cclaw meta-skill paragraph
  advertising it.
- `.cclaw/worktrees/` **empty scaffold** — the git-worktree feature
  itself (feature-system, using-git-worktrees skill, state/worktrees.json)
  stays in place for now, but init no longer pre-creates an empty
  top-level folder. Full feature removal is out of scope for this
  release.
- `.cclaw/contexts/*.md` — the four static mode guides
  (`default.md`, `execution.md`, `review.md`, `incident.md`) are gone.
  Context mode switching is still a first-class feature (tracked via
  `state/context-mode.json`, surfaced by session hooks, described in
  the `context-engineering` skill), but the mode bodies now live
  inline in the skill rather than as separate files. Session hooks
  already gracefully degrade when `contexts/<mode>.md` is missing
  (`existsSync` check), so users see no behavioral change beyond
  four fewer files per install and four fewer `contexts:mode:*`
  gates in `sync`.

### Why

Each of these folders was individually defensible but collectively
turned a fresh `cclaw init` into a 167-file dump across 15
top-level directories. Comparing against the reference implementations
under `~/Projects/cclaw/docs/references/` (obra-superpowers ships
14 skills / 3 commands; addyosmani-skills ships 21 skills flat;
everyinc-compound ships ~25 files total), cclaw was an order of
magnitude heavier without being an order of magnitude more useful.
This pass removes ~305 LOC of installer code and four user-visible
folders without changing any runtime behavior. Subsequent releases
will apply the same lens to `.cclaw/references/`, `.cclaw/evals/`,
`.cclaw/commands/`, `.cclaw/state/`, and `.cclaw/skills/`.

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
  `npx cclaw-cli sync` + `CCLAW_DISABLE=1` recovery moves, replacing the
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
- Added “plant as seed” guidance + template sections across idea, brainstorm,
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
surface (`/cc-idea`, brainstorm, scope, design) with stronger divergence,
adversarial review loops, and richer design-review coverage.

### Changed

- `/cc-idea` now runs explicit mode classification, frame-based divergent
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
and the `reference:*` sync severity demotion (PR #132). Both
landed on `main` under `0.48.23` but needed a version bump to
reach npm.


### Changed

- Sync/runtime severity for `reference:*` checks (currently the
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
  `npx cclaw-cli sync` can now surface chronic failures).
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
- Single Ralph Loop contract inside `/cc progression contract surfaces`. The
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
  `next-command parity regression tests` asserts the
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
  latent CLI↔hook drift surfaceable via `npx cclaw-cli sync`.
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
