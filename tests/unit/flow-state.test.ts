import { describe, expect, it } from "vitest";
import {
  canTransition,
  createInitialCloseoutState,
  createInitialFlowState,
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
    expect(createInitialFlowState().activeRunId).toBe("active");
    expect(createInitialFlowState("run-custom").activeRunId).toBe("run-custom");
  });

  it("allows tdd -> review and blocks tdd -> ship", () => {
    expect(canTransition("tdd", "review")).toBe(true);
    expect(canTransition("tdd", "ship")).toBe(false);
  });

  it("enforces guard list for plan -> tdd", () => {
    expect(getTransitionGuards("plan", "tdd")).toContain("plan_wait_for_confirm");
  });

  it("builds per-stage gate catalog in initial state", () => {
    const state = createInitialFlowState();
    expect(state.stageGateCatalog.plan.required).toContain("plan_wait_for_confirm");
    expect(state.stageGateCatalog.plan.recommended.length).toBeGreaterThan(0);
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
    expect(state.closeout.compoundPromoted).toBe(0);
  });

  it("exposes the full shipSubstate machine", () => {
    expect(SHIP_SUBSTATES).toEqual([
      "idle",
      "retro_review",
      "compound_review",
      "ready_to_archive",
      "archived"
    ]);
    const closeout = createInitialCloseoutState();
    expect(SHIP_SUBSTATES).toContain(closeout.shipSubstate);
  });
});
