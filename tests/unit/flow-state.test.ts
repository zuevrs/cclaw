import { describe, expect, it } from "vitest";
import {
  canTransition,
  createInitialCloseoutState,
  createInitialFlowState,
  DEFAULT_TDD_GREEN_MIN_ELAPSED_MS,
  effectiveTddGreenMinElapsedMs,
  FLOW_STATE_SCHEMA_VERSION,
  getAvailableTransitions,
  getTransitionGuards,
  nextStage,
  previousStage,
  SHIP_SUBSTATES
} from "../../src/flow-state.js";

describe("flow state", () => {
  it("starts at brainstorm", () => {
    expect(createInitialFlowState().currentStage).toBe("brainstorm");
  });

  it("initializes with active run id", () => {
    expect(createInitialFlowState().activeRunId).toMatch(/^run-/);
    expect(createInitialFlowState("run-custom").activeRunId).toBe("run-custom");
  });

  it("includes a schema version for migrations", () => {
    expect(createInitialFlowState().schemaVersion).toBe(FLOW_STATE_SCHEMA_VERSION);
  });

  it("allows tdd -> review, allows review -> tdd rewind, and blocks tdd -> ship", () => {
    expect(canTransition("tdd", "review")).toBe(true);
    expect(canTransition("review", "tdd")).toBe(true);
    expect(canTransition("tdd", "ship")).toBe(false);
  });

  it("enforces guard list for plan -> tdd", () => {
    expect(getTransitionGuards("plan", "tdd")).toContain("plan_wait_for_confirm");
  });

  it("exposes blocked-review guard for review -> tdd transition", () => {
    expect(getTransitionGuards("review", "tdd")).toContain("review_verdict_blocked");
  });

  it("lists natural transition first, then special review rewind transitions", () => {
    const transitions = getAvailableTransitions("review");
    expect(transitions[0]?.to).toBe("ship");
    expect(transitions.some((rule) => rule.to === "tdd")).toBe(true);
  });

  it("returns track-specific guards for shared edges (standard keeps tdd_traceable_to_plan, quick drops it)", () => {
    const standardGuards = getTransitionGuards("tdd", "review", "standard");
    const quickGuards = getTransitionGuards("tdd", "review", "quick");
    expect(standardGuards).toContain("tdd_traceable_to_plan");
    expect(quickGuards).not.toContain("tdd_traceable_to_plan");
    // Both tracks still enforce the universally-required TDD gates.
    expect(standardGuards).toContain("tdd_red_test_written");
    expect(quickGuards).toContain("tdd_red_test_written");
  });

  it("allows medium track brainstorm -> spec and quick track spec -> tdd transitions", () => {
    // Medium skips scope/design; quick skips brainstorm/scope/design/plan.
    // buildTransitionRules must emit neighbour edges for every track.
    expect(canTransition("brainstorm", "spec")).toBe(true);
    expect(canTransition("spec", "tdd")).toBe(true);
  });

  it("builds per-stage gate catalog in initial state", () => {
    const state = createInitialFlowState();
    expect(state.stageGateCatalog.plan.required).toContain("plan_wait_for_confirm");
    expect(state.stageGateCatalog.plan.recommended.length).toBe(0);
    expect(Array.isArray(state.stageGateCatalog.plan.conditional)).toBe(true);
    expect(Array.isArray(state.stageGateCatalog.plan.triggered)).toBe(true);
    expect(state.stageGateCatalog.review.required).toContain("review_layer1_spec_compliance");
  });

  it("reports neighboring stages", () => {
    expect(nextStage("review")).toBe("ship");
    expect(previousStage("scope")).toBe("brainstorm");
    expect(previousStage("brainstorm")).toBeNull();
  });

  it("initializes closeout substate to idle with no timestamps", () => {
    const state = createInitialFlowState();
    expect(state.closeout.shipSubstate).toBe("idle");
    expect(state.closeout.retroDraftedAt).toBeUndefined();
    expect(state.closeout.retroAcceptedAt).toBeUndefined();
    expect(state.closeout.retroSkipped).toBeUndefined();
    expect(state.closeout.compoundCompletedAt).toBeUndefined();
    expect(state.closeout.compoundSkipped).toBeUndefined();
    expect(state.closeout.compoundSkipReason).toBeUndefined();
    expect(state.closeout.compoundPromoted).toBe(0);
  });

  it("exposes the full shipSubstate machine", () => {
    expect(SHIP_SUBSTATES).toEqual([
      "idle",
      "post_ship_review",
      "ready_to_archive",
      "archived"
    ]);
    const closeout = createInitialCloseoutState();
    expect(SHIP_SUBSTATES).toContain(closeout.shipSubstate);
  });

  describe("effectiveTddGreenMinElapsedMs (release Fix 4)", () => {
    it("returns the documented default when the field is missing", () => {
      const state = createInitialFlowState();
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(
        DEFAULT_TDD_GREEN_MIN_ELAPSED_MS
      );
    });

    it("returns the per-project override when set to a finite non-negative number", () => {
      const state = createInitialFlowState();
      state.tddGreenMinElapsedMs = 8000;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(8000);
      state.tddGreenMinElapsedMs = 0;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(0);
    });

    it("falls through to the default for negative, NaN, Infinity, or non-number inputs", () => {
      const state = createInitialFlowState();
      state.tddGreenMinElapsedMs = -1;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(
        DEFAULT_TDD_GREEN_MIN_ELAPSED_MS
      );
      state.tddGreenMinElapsedMs = Number.NaN;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(
        DEFAULT_TDD_GREEN_MIN_ELAPSED_MS
      );
      state.tddGreenMinElapsedMs = Number.POSITIVE_INFINITY;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(
        DEFAULT_TDD_GREEN_MIN_ELAPSED_MS
      );
      state.tddGreenMinElapsedMs = "8000" as unknown as number;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(
        DEFAULT_TDD_GREEN_MIN_ELAPSED_MS
      );
    });

    it("floors fractional values to the integer ms", () => {
      const state = createInitialFlowState();
      state.tddGreenMinElapsedMs = 4500.7;
      expect(effectiveTddGreenMinElapsedMs(state)).toBe(4500);
    });
  });
});
