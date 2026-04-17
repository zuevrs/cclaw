import type { StageSchemaInput } from "./schema-types.js";

// ---------------------------------------------------------------------------
// TDD — RED → GREEN → REFACTOR cycle (merged test + build)
// ---------------------------------------------------------------------------

export const TDD: StageSchemaInput = {
  stage: "tdd",
  skillFolder: "test-driven-development",
  skillName: "test-driven-development",
  skillDescription: "Full TDD cycle: RED (failing tests), GREEN (minimal implementation), REFACTOR (cleanup). One plan slice at a time with strict traceability.",
  hardGate: "Do NOT merge, ship, or skip review. Follow RED → GREEN → REFACTOR strictly for each plan slice. Do NOT write implementation code before RED tests exist. Do NOT skip the REFACTOR step.",
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
  checklist: [
    "Select plan slice — pick one task from the plan. Do not batch multiple tasks.",
    "Map to acceptance criterion — identify the specific spec criterion this test proves.",
    "Dispatch mandatory `test-author` subagent in `TEST_RED_ONLY` mode — produce failing behavior tests and RED evidence only (no production edits).",
    "RED: Capture failure output — copy the exact failure output as RED evidence. Record in artifact.",
    "Dispatch `test-author` subagent in `BUILD_GREEN_REFACTOR` mode — minimal implementation + full-suite GREEN + refactor notes.",
    "GREEN: Run full suite — execute ALL tests, not just the ones you wrote. The full suite must be GREEN.",
    "GREEN: Verify no regressions — if any existing test breaks, fix the regression before proceeding.",
    "REFACTOR: Improve code quality — without changing behavior. Document what you changed and why.",
    "Record evidence — capture RED failure, GREEN output, and REFACTOR notes in the TDD artifact.",
    "Annotate traceability — link to plan task ID and spec criterion.",
    "Repeat for each slice — return to step 1 for the next plan slice."
  ],
  interactionProtocol: [
    "Pick one planned slice at a time.",
    "Controller owns orchestration; execution runs through the mandatory `test-author` delegation for RED then GREEN/REFACTOR modes.",
    "Write behavior-focused tests before changing implementation (RED).",
    "Capture and store failing output as RED evidence.",
    "Apply minimal change to satisfy RED tests (GREEN).",
    "Run full suite, not partial checks, for GREEN validation.",
    "Refactor without changing behavior and document rationale (REFACTOR).",
    "Stop if regressions appear and fix before proceeding.",
    "If a test passes unexpectedly, investigate: does the behavior already exist, or is the test wrong?"
  ],
  process: [
    "Select slice and map to acceptance criterion.",
    "Dispatch `test-author` in TEST_RED_ONLY mode and produce failing test(s) for expected reason (RED).",
    "Run tests and capture failure output.",
    "Dispatch `test-author` in BUILD_GREEN_REFACTOR mode and implement smallest change needed for GREEN.",
    "Run full tests and build checks.",
    "Perform refactor pass preserving behavior.",
    "Record RED, GREEN, and REFACTOR evidence in artifact.",
    "Annotate traceability to plan task and spec criterion."
  ],
  requiredGates: [
    { id: "tdd_red_test_written", description: "Failing tests exist before implementation changes." },
    { id: "tdd_red_failure_captured", description: "Failure output is captured as evidence." },
    { id: "tdd_trace_to_acceptance", description: "RED tests trace to explicit acceptance criteria." },
    { id: "tdd_red_failure_reason_verified", description: "Failure is for the expected reason, not an unrelated error." },
    { id: "tdd_green_full_suite", description: "Full relevant suite passes in GREEN state." },
    { id: "tdd_refactor_completed", description: "Refactor pass completed with behavior preservation verified." },
    { id: "tdd_refactor_notes_written", description: "Refactor decisions and outcomes are documented." },
    { id: "tdd_traceable_to_plan", description: "Change traceability to plan slice is explicit." }
  ],
  requiredEvidence: [
    "Artifact updated at `.cclaw/artifacts/06-tdd.md` with RED, GREEN, and REFACTOR sections.",
    "Failing command output captured (RED).",
    "Full test/build output recorded (GREEN).",
    "Acceptance mapping documented.",
    "Failure reason analysis recorded.",
    "Refactor rationale captured.",
    "Traceability to task identifier is documented."
  ],
  inputs: ["approved plan slice", "spec acceptance criterion", "test harness configuration", "coding standards and constraints"],
  requiredContext: ["plan artifact", "spec artifact", "existing test patterns"],
  outputs: ["failing test set", "passing implementation", "refactor evidence", "review-ready change set"],
  blockers: [
    "tests pass before behavior change (RED failure missing)",
    "full suite not green",
    "behavior changed during refactor",
    "no evidence recorded"
  ],
  exitCriteria: [
    "RED evidence exists and is traceable",
    "GREEN evidence captured with full suite pass",
    "REFACTOR evidence captured",
    "required gates marked satisfied",
    "traceability annotated"
  ],
  antiPatterns: [
    "Writing code before failing test",
    "Asserting implementation details instead of behavior",
    "Big-bang implementation across multiple slices",
    "Partial test runs presented as GREEN",
    "Skipping evidence capture",
    "Undocumented refactor changes",
    "Adding features beyond what RED tests require"
  ],
  redFlags: [
    "No failing test output (RED missing)",
    "Implementation edits appear before RED evidence",
    "No full-suite GREEN evidence",
    "No refactor notes",
    "Multiple tasks implemented in one pass without justification",
    "Files changed outside current slice scope"
  ],
  policyNeedles: ["RED", "GREEN", "REFACTOR", "failing test", "full test suite", "acceptance criteria", "traceable to plan slice"],
  artifactFile: "06-tdd.md",
  next: "review",
  reviewSections: [
    {
      title: "RED Evidence Audit",
      evaluationPoints: [
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
  ],
  completionStatus: ["DONE", "DONE_WITH_CONCERNS", "BLOCKED"],
  crossStageTrace: {
    readsFrom: [".cclaw/artifacts/05-plan.md", ".cclaw/artifacts/04-spec.md", ".cclaw/artifacts/03-design.md"],
    writesTo: [".cclaw/artifacts/06-tdd.md"],
    traceabilityRule: "Every RED test traces to a plan task. Every GREEN change traces to a RED test. Every plan task traces to a spec criterion. Design decisions inform test strategy. Evidence chain must be unbroken."
  },
  artifactValidation: [
    { section: "RED Evidence", required: true, validationRule: "Failing test output captured per slice." },
    { section: "Acceptance Mapping", required: true, validationRule: "Each RED test links to a plan task and spec criterion." },
    { section: "Failure Analysis", required: true, validationRule: "Failure reason matches expected missing behavior." },
    { section: "GREEN Evidence", required: true, validationRule: "Full suite pass output captured." },
    { section: "REFACTOR Notes", required: true, validationRule: "What changed, why, behavior preservation confirmed." },
    { section: "Traceability", required: true, validationRule: "Plan task ID and spec criterion linked." },
    { section: "Verification Ladder", required: false, validationRule: "If present: per-slice verification tier (static, command, behavioral, human) with evidence for highest tier reached." },
    { section: "Coverage Targets", required: false, validationRule: "If present: per-module or per-code-type coverage thresholds with current values and measurement commands." },
    { section: "Test Pyramid Shape", required: false, validationRule: "If present: per-slice count of Small/Medium/Large tests added, to let reviewers verify the suite is not drifting top-heavy." },
    { section: "Prove-It Reproduction", required: false, validationRule: "Required for bug-fix slices: original failing reproduction test (RED without fix), passing output with fix (GREEN), and a note confirming the test fails again if the fix is reverted." }
  ],
  waveExecutionAllowed: true
};
