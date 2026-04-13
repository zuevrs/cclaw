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
    expect(createInitialFlowState().activeRunId).toBe("run-pending");
    expect(createInitialFlowState("run-custom").activeRunId).toBe("run-custom");
  });

  it("allows test -> build and blocks test -> review", () => {
    expect(canTransition("test", "build")).toBe(true);
    expect(canTransition("test", "review")).toBe(false);
  });

  it("enforces guard list for plan -> test", () => {
    expect(getTransitionGuards("plan", "test")).toContain("plan_wait_for_confirm");
  });

  it("builds per-stage gate catalog in initial state", () => {
    const state = createInitialFlowState();
    expect(state.stageGateCatalog.plan.required).toContain("plan_wait_for_confirm");
    expect(state.stageGateCatalog.review.required).toContain("review_layer1_spec_compliance");
  });

  it("reports neighboring stages", () => {
    expect(nextStage("review")).toBe("ship");
    expect(previousStage("scope")).toBe("brainstorm");
    expect(previousStage("brainstorm")).toBeNull();
  });
});
