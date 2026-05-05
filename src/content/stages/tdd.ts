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
      "**Wave discovery:** Entering TDD, first call `node .cclaw/cli.mjs internal wave-status --json`. It parses the managed `<!-- parallel-exec-managed-start -->` block; read `05-plan.md`/`wave-plans/` only once `wave-status` names work. Restore partial waves by parallelizing remaining members.",
      "**Routing AskQuestion:** Two or more ready slices ⇒ exactly one AskQuestion (“launch wave …” vs “single slice …”, default wave). Otherwise do not ask “which slice next?” when the plan already resolves it.",
      "**Record before dispatch:** For every `Task`, write `delegation-record` `--status=scheduled` then `--status=launched` before the tool call. Workers self-record `acknowledged` and `completed`; back-fill is `--repair` only.",
      "**One worker per slice:** Dispatch `slice-builder` with `--slice S-<id>` and explicit `--paths` from the plan. Parallel builders are allowed when paths are disjoint; honor any lane/lease flags the hook requires today.",
      "**Single span owns the slice:** `slice-builder` runs RED → GREEN → REFACTOR (separate phase rows or `--refactor-outcome` on GREEN) and authors `<artifacts-dir>/tdd-slices/S-<id>.md`. Follow the agent body and `delegation-record` snippets it embeds.",
      "**Wave closure:** When every slice in the wave has GREEN + REFACTOR coverage, call `integrationCheckRequired`. Dispatch `integration-overseer` when required; otherwise emit `cclaw_integration_overseer_skipped` via `delegation-record --audit-kind=...`.",
      "**Plan triggers:** If the unit row demands extra scrutiny (`touchCount >= filesChangedThreshold`, matching `touchPaths`, or `highRisk`), capture that review posture in `tdd-slices/S-<id>.md` or via a reviewer dispatch before closing the slice.",
      "**Auto-render tables:** Do not hand-edit content between `auto-start: tdd-slice-summary` markers; the linter overwrites them from `delegation-events.jsonl`.",
      "**Active-span collisions:** If scheduling fails with `dispatch_duplicate` / `dispatch_active_span_collision`, identify the live span; use `--allow-parallel` or `--supersede` deliberately. Do not silence errors blindly.",
    ],
    interactionProtocol: [
      "Parallel `slice-builder` tasks are allowed when `claimedPaths` are disjoint; remain serial when the plan orders dependencies.",
      "Controller never writes production code or per-slice prose — the delegated worker does. Record routing decisions; cite `wave-status` before redundant slice questions.",
      "Discover existing tests and commands before RED; run a system-wide impact check (callbacks, state, interfaces, contracts) before GREEN.",
      "RED must fail for the right reason; capture logs. GREEN must run the full relevant suite, not a narrow subset.",
      "Before calling a slice done, run verification-before-completion (command + PASS/FAIL + commit SHA or no-VCS attestation).",
      "Integration-overseer must complete with PASS/PASS_WITH_GAPS when fan-out closes a wave unless the controller emits `cclaw_integration_overseer_skipped` for a documented heuristic skip.",
      "Investigation discipline + behavior anchor in this skill govern evidence: cite commands and paths, not pasted source dumps.",
    ],
    process: [
      "Map the slice to acceptance criteria; read `ralph-loop.json` for open RED cycles before starting new work.",
      "Discover tests, fixtures, helpers, and commands; record impact on public surfaces.",
      "Dispatch `slice-builder` for RED (failing tests, no production edits beyond test files).",
      "Dispatch the same builder for GREEN with minimal production changes and full-suite evidence.",
      "Close REFACTOR inline, via deferred phase, or `--refactor-outcome` on GREEN — match what `delegation-record` expects.",
      "Keep `tdd-slices/S-<id>.md` aligned with evidence as the builder finishes.",
      "Run fresh verification and attach traceability (plan task + spec criterion).",
      "Return to `wave-status` for the next unit of work.",
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
      "Execution posture for RED/GREEN/REFACTOR recorded (commits or explicit checkpoint notes).",
      "`phase=red` events in `delegation-events.jsonl` with non-empty evidenceRefs for each closed slice; derive the active slice from `wave-status --json`, not from historical flow-state markers.",
      "`phase=green` events with `completedTs` after the matching RED, worker `slice-builder`, evidence pointing at the formerly failing test.",
      "REFACTOR coverage: separate `phase=refactor|refactor-deferred` rows or `refactorOutcome` folded into GREEN as the hook documents.",
      "`tdd-slices/S-<id>.md` kept current with the builder span; phase events remain the ground truth for lint auto-render blocks.",
      "`event: slice-completed` umbrella rows tie RED/GREEN timestamps to the builder once that writer runs on the repo.",
      "Fresh verification (command + PASS/FAIL + commit SHA or no-VCS reason + hash); Iron Law acknowledgement; acceptance mapping + traceability IDs.",
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
      { section: "System-Wide Impact Check", required: true, validationRule: "Before implementation: names affected callbacks, state transitions, interfaces, schemas, public APIs/config/CLI, persistence, or event contracts, with coverage or explicit out-of-scope notes." },
      { section: "RED Evidence", required: true, validationRule: "Failing test output per slice. Auto-satisfied when `delegation-events.jsonl` has a `phase=red` row with non-empty evidenceRefs; otherwise the markdown section must document the failure." },
      { section: "Acceptance & Failure Map", required: false, validationRule: "Each slice row carries Source ID, AC ID, expected behavior, and a RED-link; slice phase events can satisfy the RED-link column." },
      { section: "GREEN Evidence", required: true, validationRule: "Full suite pass output. Auto-satisfied when `phase=green` rows exist with evidence; otherwise keep markdown proof." },
      { section: "REFACTOR Notes", required: true, validationRule: "What changed, why, behavior preservation confirmed." },
      { section: "Traceability", required: true, validationRule: "Plan task ID and spec criterion linked." },
      { section: "Iron Law Acknowledgement", required: true, validationRule: "Must include `Acknowledged: yes` and list exceptions (or `None`)." },
      { section: "Verification Ladder", required: true, validationRule: "Per-slice verification tier (static, command, behavioral, human) with evidence captured for the highest tier reached this turn. Must include command + PASS/FAIL + commit SHA when VCS is present, or explicit no-vcs reason plus content/artifact hash/config override." },
      { section: "TDD Blocker Taxonomy", required: false, validationRule: "When blocked, classify as NO_SOURCE_CONTEXT, NO_TEST_SURFACE, NO_IMPLEMENTABLE_SLICE, RED_NOT_EXPRESSIBLE, or NO_VCS_MODE; include blockedBecause, missingInputs, recommendedRoute, nextCommand, and resumeCriteria." }
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
        title: "State-over-Interaction + Beyoncé Coverage",
        evaluationPoints: [
          "Do assertions target observable state (return values, persisted data, HTTP responses, logs) rather than which internal helpers were called?",
          "Are mocks/spies used only at true trust boundaries (network, filesystem, time, external services), not for module-internal collaborators?",
          "For every public surface touched in this slice (exported API, CLI flag, config key, env var, exit code, schema field) — does at least one test observe it?",
          "If a bug or review finding revealed an uncovered surface, was a test added alongside the fix, not just the code change?",
          "Are interaction-style assertions (e.g. `toHaveBeenCalledWith` without a state assertion) justified by an explicit boundary comment, or flagged for follow-up?"
        ],
        stopGate: false
      },
      {
        title: "Per-Slice Review Audit (conditional)",
        evaluationPoints: [
          "When `touchCount >= filesChangedThreshold`, `touchPaths` match a trigger glob, or `highRisk=true`, capture a focused pass (spec ↔ plan ↔ evidence + diff quality) in `tdd-slices/S-<id>.md` or dispatch `reviewer` before closing the slice."
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
            validationRule: "Each slice row carries Source ID, AC ID (spec acceptance criterion ID, for example AC-1), expected behavior, and a RED-link (delegation spanId or evidence path). A `phase=red` row in `delegation-events.jsonl` with non-empty evidenceRefs can satisfy the RED-link column."
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
