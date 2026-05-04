import type { StageSchemaInput, StageSchemaV2Input } from "./schema-types.js";
import type { FlowTrack } from "../../types.js";
import { renderTrackTerminology, trackRenderContext } from "../track-render-context.js";

// ---------------------------------------------------------------------------
// TDD — RED → GREEN → REFACTOR cycle (merged test + build)
// ---------------------------------------------------------------------------

export const TDD: StageSchemaV2Input = {
  schemaShape: "v2",
  stage: "tdd",
  complexityTier: "standard",
  skillFolder: "tdd",
  skillName: "tdd",
  skillDescription: "Full vertical-slice TDD cycle: discover existing tests and system impact, then RED (failing tests), GREEN (minimal implementation), REFACTOR (cleanup). One source item at a time with strict traceability.",
  philosophy: {
    hardGate: "Do NOT merge, ship, or skip review. Follow RED → GREEN → REFACTOR strictly for each plan slice. Do NOT write implementation code before RED tests exist. Do NOT write RED tests before discovering relevant existing tests and impacted contracts. Do NOT skip the REFACTOR step.",
    ironLaw: "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST — THE RED FAILURE IS THE SPEC.",
    purpose: "Implement features through the TDD cycle: write failing tests, make them pass with minimal code, then refactor.",
    whenToUse: [
      "After plan confirmation",
      "For every behavior change in scope",
      "Before review stage"
    ],
    whenNotToUse: [
      "Plan approval is still pending WAIT_FOR_CONFIRM",
      "The change is docs-only and does not alter behavior",
      "The stage intent is review/ship sign-off rather than implementation"
    ],
    commonRationalizations: [
      "Writing code before failing test",
      "Partial test runs presented as GREEN",
      "Skipping evidence capture",
      "Undocumented refactor changes",
      "No full-suite GREEN evidence",
      "Multiple tasks implemented in one pass without justification",
      "Skipping test discovery and duplicating an existing test pattern blindly",
      "Ignoring callbacks, state transitions, interfaces, or contract surfaces affected by the slice",
      "Collapsing RED/GREEN/REFACTOR into one unreviewable checkpoint"
    ]
  },
  executionModel: {
    checklist: [
      "**Wave dispatch — discovery hardened (v6.14.2):** Before routing, your FIRST tool call after entering TDD MUST be `node .cclaw/cli.mjs internal wave-status --json` (or the harness equivalent `npx cclaw-cli internal wave-status --json`). Do NOT page through `05-plan.md` to find the managed block — the helper reads the managed `<!-- parallel-exec-managed-start -->` block deterministically and prints `{ waves, nextDispatch.readyToDispatch, warnings }`. Open `05-plan.md` only AFTER `wave-status` names a slice that needs context. Multi-ready waves: one AskQuestion (launch wave vs single-slice); then RED checkpoint (when `tddCheckpointMode: \"global-red\"`) or per-lane stream (when `tddCheckpointMode: \"per-slice\"`, the v6.14+ default), parallel GREEN+DOC with worktree-first flags, per-lane REFACTOR. Resume partial waves by parallelizing remaining members only (see top-of-skill `## Wave Batch Mode`).",
      "**Stream-style wave dispatch (v6.14.0):** After `wave-status` resolves the next dispatch, route accordingly. Per-lane stream: each lane runs RED→GREEN→REFACTOR independently as soon as its `dependsOn` closes — no global RED checkpoint between Phase A and Phase B. The linter enforces RED-before-GREEN per slice via `tdd_slice_red_completed_before_green`; cross-lane interleaving is allowed. **Legacy `global-red` mode** is preserved for projects with `legacyContinuation: true` and any project that explicitly sets `flow-state.json::tddCheckpointMode: \"global-red\"` (rule `tdd_red_checkpoint_violation` still fires there). Multi-ready waves still get one AskQuestion (launch wave vs single-slice); then per-lane GREEN+DOC dispatch with worktree-first flags. Integration-overseer fires only on cross-slice trigger (see `integrationCheckRequired()` heuristic).",
      "**Controller dispatch ordering (v6.14.1 — record BEFORE dispatch).** For every `Task` subagent the controller spawns, record `scheduled` then `launched` ledger events via `node .cclaw/hooks/delegation-record.mjs --status=scheduled ...` and `--status=launched ...` **BEFORE** the `Task(...)` call (one message: ledger writes first, then the matching `Task` calls). Workers self-record `acknowledged` and `completed`; controller back-fill is reserved for `--repair` recovery only. Pass `--span-id`, `--lane-id`, `--claim-token`, `--lease-until` through to the worker so its own helper invocations reuse them.",
      "**Wave closure — integration-overseer decision (v6.14.1).** When every dispatched lane has a `phase=green status=completed` event AND per-lane REFACTOR coverage is satisfied (separate phase event OR `refactorOutcome` folded into GREEN), call `integrationCheckRequired(events, fanInAudits)` from `src/delegation.ts`. (1) `required: true` → dispatch `integration-overseer` as before. (2) `required: false` → emit the audit row via `node .cclaw/hooks/delegation-record.mjs --audit-kind=cclaw_integration_overseer_skipped --audit-reason=\"<reasons>\" --slice-ids=\"S-1,S-2\" --json` and SKIP the dispatch. Linter advisory `tdd_integration_overseer_skipped_audit_missing` flags a wave that closes without either an overseer dispatch or this audit row.",
      "**Inline DOC opt-in (v6.14.1 — single-slice non-deep waves).** Default remains parallel `slice-documenter --phase doc` dispatched alongside `slice-implementer --phase green`. For single-slice waves where `flow-state.json::discoveryMode != \"deep\"`, the controller MAY skip the parallel documenter and instead invoke `slice-implementer --finalize-doc --slice S-<id> --paths <artifacts-dir>/tdd-slices/S-<id>.md` synchronously after GREEN. Multi-slice waves and any `discoveryMode=deep` run keep parallel slice-documenter mandatory.",
      "**Stale active-span recovery (v6.14.1).** If `delegation-record` rejects a new `--status=scheduled` with `dispatch_active_span_collision` or `dispatch_duplicate` and the conflicting span has a `completed` event in `delegation-events.jsonl`, the fold is correct (`computeActiveSubagents` excludes terminal spans) and the rejection is from a different live span on the same `(stage, agent)` pair — pass `--allow-parallel` deliberately, quote the conflicting `spanId` in the turn output, and proceed. If you cannot identify the conflicting active span, STOP and report — do not blanket-add `--allow-parallel` to silence the helper.",
      "Select vertical slice — the active wave plan (or single ready slice) defines work. Do not ask \"which slice next?\" when the plan already resolves it. Before starting, read `.cclaw/state/ralph-loop.json` (`loopIteration`, `acClosed[]`, `redOpenSlices[]`) so you skip cycles already closed. If `redOpenSlices[]` is non-empty, repair or explicitly park those slices before opening a new RED.",
      "Map to acceptance criterion — identify the specific spec criterion this test proves.",
      "Discover the test surface — inspect existing tests, fixtures, helpers, test commands, and nearby assertions before authoring RED. Reuse the local test style unless the slice genuinely needs a new pattern.",
      "Run a system-wide impact check — name callbacks, state transitions, interfaces, schemas, CLI/config/API contracts, persistence, or event boundaries that this slice can affect. Add RED coverage for each affected public contract or record why it is out of scope.",
      "Source/test preflight — before production edits, classify planned paths using test-path patterns; verify the RED touches a test path and the GREEN touches only source paths needed for the failing behavior.",
      "Use the mandatory `test-author` delegation for RED — after discovery and impact check, dispatch with `--slice S-<id> --phase red`. Produce failing behavior tests only (no production edits) and let the harness record the dispatch via the generated `delegation-record` hook. Set `CCLAW_ACTIVE_AGENT=tdd-red` when the harness supports phase labels.",
      "RED: do NOT hand-edit `## Watched-RED Proof`, `## Vertical Slice Cycle`, or `## RED Evidence` markdown tables. The linter auto-renders them from `delegation-events.jsonl` slice phase rows; manual edits inside the auto-render markers are overwritten on the next lint.",
      "Dispatch the `slice-implementer` for GREEN with `--slice S-<id> --phase green` and explicit `--paths` so the file-overlap scheduler can auto-allow parallel slices. When `flow-state.json::worktreeExecutionMode` is `worktree-first`, **mandatory** flags on every GREEN delegation-record row: `--claim-token=<opaque> --lane-id=<lane> --lease-until=<iso8601>`. Attach an evidence ref so the Vertical Slice Cycle row is well-formed. Set `CCLAW_ACTIVE_AGENT=tdd-green` when the harness supports phase labels.",
      "GREEN: Run full suite — execute ALL tests, not just the ones you wrote. The full suite must be GREEN.",
      "GREEN: Verify no regressions — if any existing test breaks, fix the regression before proceeding.",
      "Run verification-before-completion discipline for the slice — capture a fresh test command, explicit PASS/FAIL status, and a config-aware ref (commit SHA when VCS is present/required, or no-vcs attestation when allowed).",
      "REFACTOR (v6.14.0+ — three forms): (1) re-dispatch `slice-implementer` with `--phase refactor` after GREEN; (2) re-dispatch with `--phase refactor-deferred --refactor-rationale \"<why>\"` to close without a separate pass; (3) **fold REFACTOR into GREEN** by adding `--refactor-outcome=inline|deferred [--refactor-rationale=\"<why>\"]` on the same `slice-implementer --phase green` `--status=completed` write. Form (3) is the v6.14.0 default for new projects; the linter accepts all three as REFACTOR coverage. Form (1) is the only legal form when BOTH `legacyContinuation: true` AND `flow-state.json::tddCheckpointMode: \"global-red\"` are set (legacy hox-shape projects); other projects may use any form. Set `CCLAW_ACTIVE_AGENT=tdd-refactor` when the harness supports phase labels.",
      "DOC (v6.14.0+ softened, v6.14.1 inline-opt-in): in `discoveryMode=deep` runs DOC remains mandatory — dispatch `slice-documenter --slice S-<id> --phase doc --paths <artifacts-dir>/tdd-slices/S-<id>.md` IN PARALLEL with `slice-implementer --phase green` for the same slice (ONE message with TWO concurrent Task calls). The documenter only writes `tdd-slices/S-<id>.md`, so its `--paths` are disjoint from the implementer's production paths and the file-overlap scheduler auto-allows parallel dispatch. **In `lean` and `guided` modes DOC is advisory** (linter `tdd_slice_documenter_missing` becomes `required: false`); the controller MAY either keep parallel `slice-documenter` dispatch (default — preserves the documenter's isolated context) OR, **for single-slice non-deep waves**, call `slice-implementer --finalize-doc --slice S-<id> --paths <artifacts-dir>/tdd-slices/S-<id>.md` inline after GREEN completes. Multi-slice waves keep parallel `slice-documenter` regardless of mode. **Provisional-then-finalize still applies for parallel dispatch:** append a provisional row/section in `tdd-slices/S-<id>.md` at dispatch time, then finalize after the matching `phase=green` event records evidence.",
      "**slice-documenter writes per-slice prose** (test discovery, system-wide impact check, RED/GREEN/REFACTOR notes, acceptance mapping, failure analysis) into `tdd-slices/S-<id>.md`. Controller does NOT touch this content. When logging a `green` row, attach the closed acceptance-criterion IDs in `acIds` so Ralph Loop status counts them.",
      "Annotate traceability — link to the active track's source: plan task ID + spec criterion on standard/medium, or spec acceptance item / bug reproduction slice on quick.",
      "**Boundary with review (do NOT escalate single-slice findings to whole-diff review).** `tdd.Per-Slice Review` OWNS severity-classified findings WITHIN one slice (correctness, edge cases, regression). `review` OWNS whole-diff Layer 1 (spec compliance) plus Layer 2 (cross-slice integration, security sweep, dependency/version audit, observability). When a single-slice finding genuinely needs whole-diff escalation, surface it in `06-tdd.md > Per-Slice Review` first; review will cite it (not re-classify) and the cross-artifact-duplication linter requires matching severity/disposition.",
      "Per-Slice Review (conditional) — if the slice meets any trigger (touchCount >= filesChangedThreshold, touchPaths match touchTriggers, or highRisk=true), append a `## Per-Slice Review` entry for this slice before moving on (see the dedicated section below).",
      "Repeat for each slice — when not in multi-slice wave mode, return to wave-plan discovery; otherwise continue the active wave until members close.",
    ],
    interactionProtocol: [
      "Pick one vertical slice at a time **only when** the merged wave plan leaves a single scheduler-ready slice or the operator chose single-slice mode. Parallel implementers are allowed when lanes touch non-overlapping files (the file-overlap scheduler auto-allows parallel when `--paths` are disjoint). **Integration-overseer is conditional in v6.14.0** (see `flow-state.json::integrationOverseerMode`): with the default `\"conditional\"` it dispatches only when `integrationCheckRequired()` returns `required: true` (shared import boundaries between closed slices, any slice with `riskTier=high`, or a recorded `cclaw_fanin_conflict`). When the heuristic returns `required: false`, record an audit `cclaw_integration_overseer_skipped` (via `delegation-record --audit-kind=cclaw_integration_overseer_skipped --audit-reason=\"<reasons>\"`) and let the linter emit advisory `tdd_integration_overseer_skipped_by_disjoint_paths`. Projects with `legacyContinuation: true` or explicit `\"always\"` keep the v6.13.x mandatory dispatch.",
      "Slice implementers are sequential only when the plan serializes work; prefer wave-parallel GREEN+DOC when the Parallel Execution Plan marks multiple ready members.",
      "Controller owns orchestration. **v6.14.1 — record BEFORE dispatch:** every controller `Task` dispatch is preceded by two `delegation-record` writes (`--status=scheduled` then `--status=launched`); workers self-record `--status=acknowledged` on entry and `--status=completed` on exit. Never dispatch first and back-fill — that order breaks the active-span check and forces `--allow-parallel` workarounds. For each slice S-<id>, dispatch in order: (1) `test-author --slice S-<id> --phase red` (RED-only, no production edits), (2) `slice-implementer --slice S-<id> --phase green --paths <comma-separated>` for GREEN, (3) re-dispatch `--phase refactor` or `--phase refactor-deferred --refactor-rationale \"<why>\"` to close REFACTOR. Each dispatch records a row in `delegation-events.jsonl` and the linter auto-derives the Watched-RED + Vertical Slice Cycle tables — do NOT hand-edit those tables.",
      "Before writing RED tests, discover relevant existing tests and commands so the new test extends the suite instead of fighting it.",
      "Before implementation, perform a system-wide impact check across callbacks, state, interfaces, schemas, and external contracts touched by the slice.",
      "Slice-documenter (mandatory v6.12.0, regardless of `discoveryMode`): in PARALLEL with `slice-implementer --phase green`, dispatch `slice-documenter --slice S-<id> --phase doc` whose only `claimedPaths` is `<artifacts-dir>/tdd-slices/S-<id>.md`. The two dispatches run concurrently because their paths are disjoint. The documenter writes per-slice prose so the main `06-tdd.md` stays thin. Controller MUST NOT author per-slice prose; controller MUST NOT author GREEN production code (use `slice-implementer`).",
      "Run source/test preflight using configured TDD path patterns where feasible; if path classification is impossible (generated files, non-file side effect), record why.",
      "Write behavior-focused tests before changing implementation (RED).",
      "Capture and store failing output as RED evidence.",
      "Apply minimal change to satisfy RED tests (GREEN).",
      "Run full suite, not partial checks, for GREEN validation.",
      "Before declaring the slice complete, run a fresh verification check and record command + PASS/FAIL plus commit SHA or no-vcs/config override evidence.",
      "Refactor without changing behavior and document rationale (REFACTOR).",
      "Use incremental RED/GREEN/REFACTOR commits when the repository workflow and working tree make that appropriate; otherwise record the checkpoint boundaries in the artifact.",
      "Stop if regressions appear and fix before proceeding.",
      "If a test passes unexpectedly, investigate: does the behavior already exist, or is the test wrong?",
      "**Per-Slice Review point (conditional).** Check every slice against the triggers before declaring it DONE. Triggers: `touchCount >= filesChangedThreshold`, any `touchPaths` match a `touchTriggers` glob, or the plan row declares `highRisk: true`. On a trigger, run two passes on the slice alone — (1) Spec-Compliance: trace RED/GREEN/REFACTOR evidence back to its plan task + spec criterion, noting edge cases the tests skip; (2) Quality: diff-scan for naming, error handling, dead code, simpler alternatives. Record both under `## Per-Slice Review` in `06-tdd.md`, naming the trigger that fired. Dispatch the `reviewer` subagent natively when available (log `fulfillmentMode: \"isolated\"`); otherwise fulfil via in-session role switch (`fulfillmentMode: \"role-switch\"`). Never fabricate an isolated pass from memory.",
      "Investigation discipline: follow the shared `## Investigation Discipline` block — `Watched-RED Proof` and `RED Evidence` rows must cite test paths and command logs, not pasted source bodies; delegate `test-author` with paths and refs only.",
      "Behavior anchor: see the shared `## Behavior anchor` block in this skill — the bad/good pair anchors how `RED Evidence` must contain a falsifiable assertion (no tautologies)."
    ],
    process: [
      "Select one vertical slice and map it to acceptance criterion(s).",
      "Discover existing tests, fixtures, helpers, and exact test commands for the affected area.",
      "Check system-wide impact across callbacks, state transitions, interfaces, schemas, and external contracts.",
      "Record execution posture and checkpoint plan for RED/GREEN/REFACTOR commits or deferred commits.",
      "Use `test-author` in RED intent and produce failing test(s) for the expected reason (RED).",
      "Run tests and capture failure output.",
      "Use `test-author` in GREEN intent and implement the smallest change needed for GREEN.",
      "Run full tests and build checks.",
      "Run a fresh verification-before-completion check and capture command + PASS/FAIL plus a commit SHA when `.git` is present; otherwise record explicit no-vcs reason plus content/artifact hash.",
      "Run the REFACTOR intent preserving behavior.",
      "Record RED, GREEN, and REFACTOR evidence in artifact.",
      "Annotate traceability to plan task and spec criterion; on per-slice triggers, append a Per-Slice Review entry before closing the slice."
    ],
    requiredGates: [
      { id: "tdd_test_discovery_complete", description: "Relevant existing tests, fixtures, helpers, and runnable commands were discovered before RED tests were written." },
      { id: "tdd_impact_check_complete", description: "Callbacks, state transitions, interfaces, schemas, and contracts affected by the slice were checked before implementation." },
      { id: "tdd_red_test_written", description: "Failing tests exist before implementation changes." },
      { id: "tdd_green_full_suite", description: "Full relevant suite passes in GREEN state." },
      { id: "tdd_refactor_completed", description: "Refactor pass completed with behavior preservation verified." },
      { id: "tdd_verified_before_complete", description: "Fresh verification evidence includes test command, explicit pass/fail status, and a durable ref: commit SHA when `.git` is present or explicit no-VCS attestation + hash when not." },
      { id: "tdd_iron_law_acknowledged", description: "Iron Law acknowledgement is explicit (`Acknowledged: yes`) before implementation proceeds." },
      { id: "tdd_watched_red_observed", description: "Watched-RED Proof records at least one observed failing test with ISO timestamp evidence." },
      { id: "tdd_slice_cycle_complete", description: "Vertical Slice Cycle records RED, GREEN, and REFACTOR phases per active slice." },
      { id: "tdd_traceable_to_plan", description: "Change traceability to plan slice is explicit." },
      { id: "tdd_docs_drift_check", description: "When public API/config/CLI surfaces change, docs drift is addressed via a completed doc-updater pass." }
    ],
    requiredEvidence: [
      "Artifact updated at `.cclaw/artifacts/06-tdd.md` with System-Wide Impact Check, Acceptance & Failure Map, REFACTOR Notes, Iron Law Acknowledgement, Verification Ladder, and Learnings.",
      "Relevant existing test files, helpers, fixtures, and exact commands identified before RED.",
      "Callbacks, state transitions, interfaces, schemas, and contracts checked for impact before implementation.",
      "Execution posture and vertical-slice RED/GREEN/REFACTOR checkpoint plan recorded, including commit boundaries when the repo workflow supports them.",
      "RED observability: a `phase=red` event in `delegation-events.jsonl` for each slice with non-empty evidenceRefs (test path, span ref, or pasted-output pointer). **`flow-state.json::tddCutoverSliceId` is a HISTORICAL boundary set by `cclaw-cli sync` at upgrade time; it is NOT a pointer to the active slice and the controller MUST NOT dispatch new work for that slice id on its basis.** Slices created at or before the cutover marker may retain legacy `## Watched-RED Proof` / `## RED Evidence` markdown tables; slices created after the cutover marker MUST use phase events + slice-documenter doc, and legacy table writes are surfaced by the advisory `tdd_legacy_section_writes_after_cutover` rule. To find the ACTIVE slice, run `cclaw-cli internal wave-status --json` (Fix 1, v6.14.2) — never derive it from `tddCutoverSliceId`.",
      "GREEN observability: a `phase=green` event in `delegation-events.jsonl` per slice whose `completedTs` >= the matching `phase=red` `completedTs`, authored by `slice-implementer` (linter rule `tdd_slice_implementer_missing` blocks the gate otherwise), and whose evidenceRefs name the failing-now-passing test. Pre-cutover slices may keep legacy `## GREEN Evidence` markdown.",
      "REFACTOR observability: per slice, a `phase=refactor` event OR a `phase=refactor-deferred` event whose evidenceRefs / refactor rationale captures why refactor was deferred.",
      "Per slice, a `phase=doc` event from `slice-documenter` whose evidenceRefs name `<artifacts-dir>/tdd-slices/S-<id>.md`. Mandatory regardless of `discoveryMode` (v6.12.0 Phase R). Linter rule `tdd_slice_documenter_missing` blocks the gate when missing.",
      "Fresh verification evidence recorded with command, PASS/FAIL status, and commit SHA or no-VCS reason plus content/artifact hash before completion.",
      "Iron Law Acknowledgement section explicitly states `Acknowledged: yes`.",
      "Acceptance mapping documented.",
      "Failure reason analysis recorded.",
      "Refactor rationale captured.",
      "Traceability to task identifier is documented."
    ],
    inputs: ["approved plan slice", "spec acceptance criterion", "test harness configuration", "coding standards and constraints"],
    requiredContext: ["plan artifact", "spec artifact", "existing test patterns", "affected contracts and state boundaries"],
    blockers: [
      "test discovery skipped before RED",
      "system-wide impact check missing for callbacks/state/interfaces/contracts",
      "tests pass before behavior change (RED failure missing)",
      "full suite not green",
      "behavior changed during refactor",
      "no evidence recorded",
      "RED/GREEN blocked — classify with the managed taxonomy `NO_SOURCE_CONTEXT`, `NO_TEST_SURFACE`, `NO_IMPLEMENTABLE_SLICE`, `RED_NOT_EXPRESSIBLE`, or `NO_VCS_MODE` and capture blockedBecause, missingInputs, recommendedRoute, nextCommand, resumeCriteria, and the repair path: RED needs a failing test surface, GREEN needs full-suite pass evidence, REFACTOR needs behavior-preservation evidence.",
      "no-VCS workspace without explicit no-vcs reason and content/artifact hash"
    ],
    exitCriteria: [
      "test discovery and system-wide impact check are recorded",
      "RED evidence exists and is traceable",
      "GREEN evidence captured with full suite pass",
      "REFACTOR evidence captured",
      "required gates marked satisfied",
      "traceability annotated"
    ],
    platformNotes: [
      "Record the **exact** test command run (`npm test -- path/to/file`, `pytest path/to/file`, `go test ./...`) so RED/GREEN evidence is reproducible on any OS. Do not paraphrase to a shorter alias.",
      "Line-ending drift (CRLF vs LF) can turn a passing test red on Windows if the repo mixes styles. When a GREEN flip happens only after whitespace normalization, record it as a refactor note, not a hidden fix.",
      "When invoking a test file path from Windows PowerShell, use forward slashes (`npm test -- tests/foo.test.ts`) — backslashes trip globbing on `cross-env` and similar wrappers.",
      "Flaky tests that only fail on one OS must be marked as such in the TDD artifact (OS + runner + one failing output snippet) — do not retry until green without evidence."
    ]
  },
  artifactRules: {
    artifactFile: "06-tdd.md",
    completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
    crossStageTrace: {
      readsFrom: [".cclaw/artifacts/05-plan.md", ".cclaw/artifacts/04-spec.md", ".cclaw/artifacts/03-design-<slug>.md"],
      writesTo: [".cclaw/artifacts/06-tdd.md"],
      traceabilityRule: "Every RED test traces to a plan task. Every GREEN change traces to a RED test. Every plan task traces to a spec criterion. Design decisions inform test strategy. Evidence chain must be unbroken."
    },
    artifactValidation: [
      { section: "Upstream Handoff", required: false, validationRule: "Summarizes plan/spec/design decisions, constraints, open questions, and explicit drift before RED work." },
      { section: "Test Discovery", required: false, validationRule: "Overall narrative for how the stage discovered the existing test surface. Per-slice details live under `tdd-slices/S-<id>.md` from v6.11.0; the `## Test Discovery` heading is optional/advisory." },
      { section: "System-Wide Impact Check", required: true, validationRule: "Before implementation: names affected callbacks, state transitions, interfaces, schemas, public APIs/config/CLI, persistence, or event contracts, with coverage or explicit out-of-scope notes." },
      { section: "RED Evidence", required: true, validationRule: "Failing test output per slice. From v6.11.0 this section is auto-satisfied by a `phase=red` event in `delegation-events.jsonl` with non-empty evidenceRefs; the markdown block remains required as a legacy fallback when phase events are absent." },
      { section: "Acceptance & Failure Map", required: false, validationRule: "Each slice row carries Source ID, AC ID, expected behavior, and a RED-link (delegation spanId or evidence path). From v6.11.0 the column is auto-derivable from `phase=red` events." },
      { section: "GREEN Evidence", required: true, validationRule: "Full suite pass output. From v6.11.0 this section is auto-satisfied by a `phase=green` event in `delegation-events.jsonl` with non-empty evidenceRefs; the markdown block remains required as a legacy fallback when phase events are absent." },
      { section: "REFACTOR Notes", required: true, validationRule: "What changed, why, behavior preservation confirmed." },
      { section: "Traceability", required: true, validationRule: "Plan task ID and spec criterion linked." },
      { section: "Iron Law Acknowledgement", required: true, validationRule: "Must include `Acknowledged: yes` and list exceptions (or `None`)." },
      { section: "Watched-RED Proof", required: false, validationRule: "From v6.11.0 the Watched-RED summary is auto-rendered from `delegation-events.jsonl` slice phase events (see auto-start: tdd-slice-summary marker). Legacy markdown tables continue to validate via the fallback path." },
      { section: "Vertical Slice Cycle", required: false, validationRule: "From v6.11.0 the Vertical Slice Cycle table is auto-rendered between `auto-start: tdd-slice-summary` markers. Legacy markdown tables continue to validate via the fallback path." },
      { section: "Verification Ladder", required: true, validationRule: "Per-slice verification tier (static, command, behavioral, human) with evidence captured for the highest tier reached this turn. Must include command + PASS/FAIL + commit SHA when VCS is present, or explicit no-vcs reason plus content/artifact hash/config override." },
      { section: "TDD Blocker Taxonomy", required: false, validationRule: "When blocked, classify as NO_SOURCE_CONTEXT, NO_TEST_SURFACE, NO_IMPLEMENTABLE_SLICE, RED_NOT_EXPRESSIBLE, or NO_VCS_MODE; include blockedBecause, missingInputs, recommendedRoute, nextCommand, and resumeCriteria." },
      { section: "Coverage Targets", required: false, validationRule: "If present: per-module or per-code-type coverage thresholds with current values and measurement commands." },
      { section: "Test Pyramid Shape", required: false, validationRule: "If present: per-slice count of Small/Medium/Large tests added, to let reviewers verify the suite is not drifting top-heavy." },
      { section: "Mock Preference Order", required: false, validationRule: "When mocks/spies appear in Test Discovery or RED Evidence, prefer Real > Fake > Stub > Mock. Mock-heavy slices should include explicit boundary justification (for example network/fs/time/external trust boundaries)." },
      { section: "Prove-It Reproduction", required: false, validationRule: "Required for bug-fix slices: original failing reproduction test (RED without fix), passing output with fix (GREEN), and a note confirming the test fails again if the fix is reverted." },
      { section: "Per-Slice Review", required: false, validationRule: "Per triggered slice, a two-part record — Spec-Compliance (slice <-> plan task <-> spec criterion trace plus edge-case notes) and Quality (diff-focused review of naming, error handling, dead code, simpler alternatives). Each entry names the trigger (touchCount, touchPaths glob, or highRisk) and the delegation fulfillmentMode (`isolated` when a reviewer subagent was dispatched natively; `role-switch` when fulfilled in-session). Slices that did not meet any trigger may list `not triggered` instead of a full pass." }
    ]
  },
  reviewLens: {
    outputs: ["failing test set", "passing implementation", "refactor evidence", "review-ready change set"],
    reviewSections: [
      {
        title: "RED Evidence Audit",
        evaluationPoints: [
          "Did every slice discover relevant existing tests, helpers, fixtures, and commands before adding RED coverage?",
          "Does the system-wide impact check cover callbacks, state transitions, interfaces, schemas, and public contracts touched by the slice?",
          "Does every slice have a captured failing test output?",
          "Does each failure reason match the expected missing behavior (not a typo or config error)?",
          "Were tests written BEFORE any production code for that slice?",
          "Does each RED test assert observable behavior, not implementation details?",
          "Is there a test for each acceptance criterion mapped in the plan?"
        ],
        stopGate: true
      },
      {
        title: "GREEN/REFACTOR Audit",
        evaluationPoints: [
          "Does GREEN evidence show a FULL suite pass (not partial)?",
          "Is the GREEN implementation minimal — no features beyond what RED tests require?",
          "Do checkpoint notes or commits keep RED, GREEN, and REFACTOR reviewable according to the repository git workflow?",
          "Does the REFACTOR step preserve all existing behavior (no new failures)?",
          "Are REFACTOR notes documented with rationale?",
          "Is traceability complete: every change links to plan task ID and spec criterion?"
        ],
        stopGate: true
      },
      {
        title: "Test Pyramid + Size Audit",
        evaluationPoints: [
          "Is the tests-added count skewed toward Small (unit) tests, with Medium and Large used only when a real boundary justifies the cost?",
          "Does every newly added test declare a size class (Small / Medium / Large) — either inline in the test file or in the TDD artifact table?",
          "Are Large tests reserved for genuine end-to-end user journeys (not substitutes for unit coverage)?",
          "Has the slice avoided using Medium/Large tests to paper over testability problems that should be fixed at the design layer?"
        ],
        stopGate: false
      },
      {
        title: "Prove-It Reproduction (bug-fix slices)",
        evaluationPoints: [
          "Does the artifact identify this slice as a bug fix, and if so, include a reproduction test checked in alongside the fix?",
          "Is there captured RED evidence from running the reproduction WITHOUT the fix applied?",
          "Is there captured GREEN evidence from the same reproduction AFTER the fix was applied?",
          "Is there a note confirming the reproduction test fails again if the fix is reverted (or equivalent evidence that the test is actually pinned to this fix)?"
        ],
        stopGate: false
      },
      {
        title: "Per-Slice Review Audit (conditional)",
        evaluationPoints: [
          "Does every triggered slice (touchCount >= threshold, touchPaths match, or highRisk=true) carry a Per-Slice Review entry with BOTH a Spec-Compliance pass (plan task <-> spec criterion + edge-case notes) AND a Quality pass (diff-level naming/errors/dead code/simpler alternatives)?",
          "Is the delegation `fulfillmentMode` recorded (`isolated` for a dispatched reviewer subagent, `role-switch` for an in-session pass) and does it match an entry in `.cclaw/state/delegation-log.json`?",
          "Are there zero missed triggered slices when triggers fired?"
        ],
        stopGate: false
      },
      {
        title: "State-over-Interaction + Beyoncé Coverage",
        evaluationPoints: [
          "Do assertions target observable state (return values, persisted data, HTTP responses, logs) rather than which internal helpers were called?",
          "Are mocks/spies used only at true trust boundaries (network, filesystem, time, external services), not for module-internal collaborators?",
          "For every public surface touched in this slice (exported API, CLI flag, config key, env var, exit code, schema field) — does at least one test observe it?",
          "If a bug or review finding revealed an uncovered surface, was a test added alongside the fix, not just the code change?",
          "Are interaction-style assertions (e.g. `toHaveBeenCalledWith` without a state assertion) justified by an explicit boundary comment, or flagged for follow-up?"
        ],
        stopGate: false
      }
    ]
  },
  next: "review",
  batchExecutionAllowed: true
};

function tddStageVariantForTrack(track: FlowTrack): StageSchemaV2Input {
  const renderContext = trackRenderContext(track);
  if (renderContext.usesPlanTerminology) {
    return TDD;
  }

  return {
    ...TDD,
    skillDescription: renderTrackTerminology(TDD.skillDescription, renderContext),
    philosophy: {
      ...TDD.philosophy,
      hardGate: renderTrackTerminology(TDD.philosophy.hardGate, renderContext),
      purpose: renderTrackTerminology(TDD.philosophy.purpose, renderContext),
      whenToUse: TDD.philosophy.whenToUse.map((value) => renderTrackTerminology(value, renderContext)),
      whenNotToUse: TDD.philosophy.whenNotToUse.map((value) => renderTrackTerminology(value, renderContext)),
      commonRationalizations: TDD.philosophy.commonRationalizations
        .map((value) => renderTrackTerminology(value, renderContext))
    },
    executionModel: {
      ...TDD.executionModel,
      checklist: TDD.executionModel.checklist.map((value) => renderTrackTerminology(value, renderContext)),
      interactionProtocol: TDD.executionModel.interactionProtocol
        .map((value) => renderTrackTerminology(value, renderContext)),
      process: TDD.executionModel.process.map((value) => renderTrackTerminology(value, renderContext)),
      requiredGates: TDD.executionModel.requiredGates
        .filter((gate) => gate.id !== "tdd_traceable_to_plan")
        .map((gate) => ({
          ...gate,
          description: renderTrackTerminology(gate.description, renderContext)
        })),
      requiredEvidence: TDD.executionModel.requiredEvidence
        .map((value) => renderTrackTerminology(value, renderContext)),
      inputs: TDD.executionModel.inputs.map((value) => renderTrackTerminology(value, renderContext)),
      requiredContext: [renderContext.upstreamArtifactLabel, "existing test patterns", "affected contracts and state boundaries"],
      blockers: TDD.executionModel.blockers.map((value) => renderTrackTerminology(value, renderContext)),
      exitCriteria: TDD.executionModel.exitCriteria.map((value) => renderTrackTerminology(value, renderContext))
    },
    reviewLens: {
      ...TDD.reviewLens,
      reviewSections: TDD.reviewLens.reviewSections.map((section) => ({
        ...section,
        evaluationPoints: section.evaluationPoints
          .map((point) => renderTrackTerminology(point, renderContext))
      }))
    },
    artifactRules: {
      ...TDD.artifactRules,
      crossStageTrace: {
        ...TDD.artifactRules.crossStageTrace,
        readsFrom: [renderContext.upstreamArtifactPath],
        traceabilityRule:
          "Every RED test traces to an acceptance criterion. Every GREEN change traces to a RED test. Evidence chain must be unbroken."
      },
      artifactValidation: TDD.artifactRules.artifactValidation.map((row) => {
        if (row.section === "Acceptance & Failure Map") {
          return {
            ...row,
            required: true,
            validationRule: "Each slice row carries Source ID, AC ID (spec acceptance criterion ID, for example AC-1), expected behavior, and a RED-link (delegation spanId or evidence path). From v6.11.0 a `phase=red` event in `delegation-events.jsonl` with non-empty evidenceRefs satisfies the row."
          };
        }
        if (row.section === "Traceability") {
          return {
            ...row,
            validationRule: "Spec acceptance item IDs and, for bug fixes, reproduction slice IDs are linked to RED/GREEN evidence."
          };
        }
        return {
          ...row,
          validationRule: renderTrackTerminology(row.validationRule, renderContext)
        };
      })
    }
  };
}

export function tddStageForTrack(track: FlowTrack): StageSchemaInput {
  return tddStageVariantForTrack(track);
}
