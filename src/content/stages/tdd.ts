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
  skillFolder: "test-driven-development",
  skillName: "test-driven-development",
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
      "Select vertical slice — pick one source item from the active track (plan task on standard/medium, spec AC or bug reproduction slice on quick). Do not batch multiple tasks. Before starting, read `.cclaw/state/ralph-loop.json` (`loopIteration`, `acClosed[]`, `redOpenSlices[]`) so you skip cycles already closed. If `redOpenSlices[]` is non-empty, repair or explicitly park those slices before opening a new RED.",
      "Map to acceptance criterion — identify the specific spec criterion this test proves.",
      "Discover the test surface — inspect existing tests, fixtures, helpers, test commands, and nearby assertions before authoring RED. Reuse the local test style unless the slice genuinely needs a new pattern.",
      "Run a system-wide impact check — name callbacks, state transitions, interfaces, schemas, CLI/config/API contracts, persistence, or event boundaries that this slice can affect. Add RED coverage for each affected public contract or record why it is out of scope.",
      "Source/test preflight — before production edits, classify planned paths using `.cclaw/config.yaml::tdd.testPathPatterns` and `tdd.productionPathPatterns` when present; verify the RED touches a test path and the GREEN touches only source paths needed for the failing behavior.",
      "Set execution posture — record whether this slice is sequential, batch-safe, or blocked; when the existing git workflow permits small commits, checkpoint after RED, GREEN, and REFACTOR (or record why commits are deferred).",
      "Use the mandatory `test-author` delegation for RED — after discovery and impact check, produce failing behavior tests and RED evidence only (no production edits). Set `CCLAW_ACTIVE_AGENT=tdd-red` when the harness supports phase labels.",
      "RED: Capture failure output — copy the exact failure output as RED evidence. Record in artifact.",
      "Continue the same `test-author` delegation intent for GREEN — minimal implementation plus full-suite GREEN evidence. Set `CCLAW_ACTIVE_AGENT=tdd-green` when the harness supports phase labels.",
      "GREEN: Run full suite — execute ALL tests, not just the ones you wrote. The full suite must be GREEN.",
      "GREEN: Verify no regressions — if any existing test breaks, fix the regression before proceeding.",
      "Run verification-before-completion discipline for the slice — capture a fresh test command, explicit PASS/FAIL status, and a config-aware ref (commit SHA when VCS is present/required, or no-vcs attestation when allowed).",
      "REFACTOR: continue the `test-author` evidence cycle (or a dedicated refactor mode when available) to improve code quality without behavior changes. Set `CCLAW_ACTIVE_AGENT=tdd-refactor` when the harness supports phase labels.",
      "Record evidence — capture test discovery, system-wide impact check, RED failure, GREEN output, and REFACTOR notes in the TDD artifact. When logging a `green` row, attach the closed acceptance-criterion IDs in `acIds` so Ralph Loop status counts them.",
      "Annotate traceability — link to the active track's source: plan task ID + spec criterion on standard/medium, or spec acceptance item / bug reproduction slice on quick.",
      "Per-Slice Review (conditional) — if `.cclaw/config.yaml::sliceReview.enabled` is true and the slice meets any trigger (touchCount >= filesChangedThreshold, touchPaths match touchTriggers, or highRisk=true), append a `## Per-Slice Review` entry for this slice before moving on (see the dedicated section below).",
      "Repeat for each slice — return to step 1 for the next plan slice."
    ],
    interactionProtocol: [
      "Pick one vertical slice at a time: source item, RED test, GREEN implementation, REFACTOR, and verification evidence move together.",
      "Controller owns orchestration; one mandatory `test-author` delegation carries phase-specific RED -> GREEN -> REFACTOR evidence instead of spawning separate workers by default.",
      "Before writing RED tests, discover relevant existing tests and commands so the new test extends the suite instead of fighting it.",
      "Before implementation, perform a system-wide impact check across callbacks, state, interfaces, schemas, and external contracts touched by the slice.",
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
      "**Per-Slice Review point (conditional, opt-in).** When `.cclaw/config.yaml::sliceReview.enabled` is true, check every slice against the triggers before declaring it DONE. Triggers: `touchCount >= filesChangedThreshold`, any `touchPaths` match a `touchTriggers` glob, or the plan row declares `highRisk: true`. On a trigger, run two passes on the slice alone — (1) Spec-Compliance: trace RED/GREEN/REFACTOR evidence back to its plan task + spec criterion, noting edge cases the tests skip; (2) Quality: diff-scan for naming, error handling, dead code, simpler alternatives. Record both under `## Per-Slice Review` in `06-tdd.md`, naming the trigger that fired. Dispatch the `reviewer` subagent natively when available (log `fulfillmentMode: \"isolated\"`); otherwise fulfil via in-session role switch (`fulfillmentMode: \"role-switch\"`). Never fabricate an isolated pass from memory. Tracks outside `sliceReview.enforceOnTracks` still emit the section; doctor only escalates missed reviews on enforced tracks."
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
      "Run a fresh verification-before-completion check and capture command + PASS/FAIL plus a commit SHA when VCS is present; for `vcs: none`, record explicit no-vcs reason plus content/artifact hash unless `tdd.verificationRef: disabled` is configured.",
      "Run the REFACTOR intent preserving behavior.",
      "Record RED, GREEN, and REFACTOR evidence in artifact.",
      "Annotate traceability to plan task and spec criterion; on `sliceReview` triggers, append a Per-Slice Review entry before closing the slice."
    ],
    requiredGates: [
      { id: "tdd_test_discovery_complete", description: "Relevant existing tests, fixtures, helpers, and runnable commands were discovered before RED tests were written." },
      { id: "tdd_impact_check_complete", description: "Callbacks, state transitions, interfaces, schemas, and contracts affected by the slice were checked before implementation." },
      { id: "tdd_red_test_written", description: "Failing tests exist before implementation changes." },
      { id: "tdd_green_full_suite", description: "Full relevant suite passes in GREEN state." },
      { id: "tdd_refactor_completed", description: "Refactor pass completed with behavior preservation verified." },
      { id: "tdd_verified_before_complete", description: "Fresh verification evidence includes test command, explicit pass/fail status, and a config-aware ref: commit SHA when VCS is present/required or an explicit no-VCS attestation when allowed." },
      { id: "tdd_traceable_to_plan", description: "Change traceability to plan slice is explicit." },
      { id: "tdd_docs_drift_check", description: "When public API/config/CLI surfaces change, docs drift is addressed via a completed doc-updater pass." }
    ],
    requiredEvidence: [
      "Artifact updated at `.cclaw/artifacts/06-tdd.md` with Test Discovery, System-Wide Impact Check, RED, GREEN, and REFACTOR sections.",
      "Relevant existing test files, helpers, fixtures, and exact commands identified before RED.",
      "Callbacks, state transitions, interfaces, schemas, and contracts checked for impact before implementation.",
      "Execution posture and vertical-slice RED/GREEN/REFACTOR checkpoint plan recorded, including commit boundaries when the repo workflow supports them.",
      "Failing command output captured (RED).",
      "Full test/build output recorded (GREEN).",
      "Fresh verification evidence recorded with command, PASS/FAIL status, and config-aware commit SHA or no-VCS reason plus content/artifact hash before completion.",
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
      "no-VCS workspace without explicit `vcs: none`, no-vcs reason, content/artifact hash, or `tdd.verificationRef: disabled`"
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
      { section: "Test Discovery", required: true, validationRule: "Before RED: lists existing tests, fixtures/helpers, exact commands, and the chosen local pattern to extend." },
      { section: "System-Wide Impact Check", required: true, validationRule: "Before implementation: names affected callbacks, state transitions, interfaces, schemas, public APIs/config/CLI, persistence, or event contracts, with coverage or explicit out-of-scope notes." },
      { section: "Execution Posture", required: false, validationRule: "Records sequential/batch/blocked posture and vertical-slice RED/GREEN/REFACTOR checkpoint plan, including incremental commit boundaries when consistent with the repository git workflow." },
      { section: "RED Evidence", required: true, validationRule: "Failing test output captured per slice." },
      { section: "Acceptance Mapping", required: false, validationRule: "Each RED test links to a plan task and spec criterion." },
      { section: "Failure Analysis", required: false, validationRule: "Failure reason matches expected missing behavior." },
      { section: "GREEN Evidence", required: true, validationRule: "Full suite pass output captured." },
      { section: "REFACTOR Notes", required: true, validationRule: "What changed, why, behavior preservation confirmed." },
      { section: "Traceability", required: true, validationRule: "Plan task ID and spec criterion linked." },
      { section: "Verification Ladder", required: true, validationRule: "Per-slice verification tier (static, command, behavioral, human) with evidence captured for the highest tier reached this turn. Must include command + PASS/FAIL + commit SHA when VCS is present, or explicit no-vcs reason plus content/artifact hash/config override." },
      { section: "TDD Blocker Taxonomy", required: false, validationRule: "When blocked, classify as NO_SOURCE_CONTEXT, NO_TEST_SURFACE, NO_IMPLEMENTABLE_SLICE, RED_NOT_EXPRESSIBLE, or NO_VCS_MODE; include blockedBecause, missingInputs, recommendedRoute, nextCommand, and resumeCriteria." },
      { section: "Coverage Targets", required: false, validationRule: "If present: per-module or per-code-type coverage thresholds with current values and measurement commands." },
      { section: "Test Pyramid Shape", required: false, validationRule: "If present: per-slice count of Small/Medium/Large tests added, to let reviewers verify the suite is not drifting top-heavy." },
      { section: "Prove-It Reproduction", required: false, validationRule: "Required for bug-fix slices: original failing reproduction test (RED without fix), passing output with fix (GREEN), and a note confirming the test fails again if the fix is reverted." },
      { section: "Per-Slice Review", required: false, validationRule: "When `.cclaw/config.yaml::sliceReview.enabled` is true: per triggered slice, a two-part record — Spec-Compliance (slice <-> plan task <-> spec criterion trace plus edge-case notes) and Quality (diff-focused review of naming, error handling, dead code, simpler alternatives). Each entry names the trigger (touchCount, touchPaths glob, or highRisk) and the delegation fulfillmentMode (`isolated` when a reviewer subagent was dispatched natively; `role-switch` when fulfilled in-session). Slices that did not meet any trigger may list `not triggered` instead of a full pass." }
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
          "When `.cclaw/config.yaml::sliceReview.enabled` is true: does every triggered slice (touchCount >= threshold, touchPaths match, or highRisk=true) carry a Per-Slice Review entry with BOTH a Spec-Compliance pass (plan task <-> spec criterion + edge-case notes) AND a Quality pass (diff-level naming/errors/dead code/simpler alternatives)?",
          "Is the delegation `fulfillmentMode` recorded (`isolated` for a dispatched reviewer subagent, `role-switch` for an in-session pass) and does it match an entry in `.cclaw/state/delegation-log.json`?",
          "On tracks listed in `sliceReview.enforceOnTracks`, are there zero missed triggered slices (doctor also surfaces this as a warning)?"
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
        if (row.section === "Acceptance Mapping") {
          return {
            ...row,
            required: true,
            validationRule: "Each RED test links to a spec acceptance criterion ID (for example AC-1)."
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
