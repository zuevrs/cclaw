import { describe, expect, it } from "vitest";
import {
  canTransition,
  createInitialFlowState,
  getTransitionGuards,
  nextStage,
  previousStage
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
});
