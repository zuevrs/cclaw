import { describe, expect, it } from "vitest";
import {
  createInitialFlowState,
  firstStageForTrack,
  isFlowTrack,
  nextStage,
  previousStage,
  skippedStagesForTrack,
  trackStages
} from "../../src/flow-state.js";

describe("flow tracks", () => {
  describe("isFlowTrack", () => {
    it("recognizes standard, medium, and quick tracks", () => {
      expect(isFlowTrack("standard")).toBe(true);
      expect(isFlowTrack("medium")).toBe(true);
      expect(isFlowTrack("quick")).toBe(true);
    });

    it("rejects unknown or non-string values", () => {
      expect(isFlowTrack("unknown")).toBe(false);
      expect(isFlowTrack(undefined)).toBe(false);
      expect(isFlowTrack(42)).toBe(false);
      expect(isFlowTrack(null)).toBe(false);
    });
  });

  describe("trackStages", () => {
    it("standard track runs all 8 stages in order", () => {
      expect(trackStages("standard")).toEqual([
        "brainstorm",
        "scope",
        "design",
        "spec",
        "plan",
        "tdd",
        "review",
        "ship"
      ]);
    });

    it("medium track keeps brainstorm/spec/plan then execution stages", () => {
      expect(trackStages("medium")).toEqual([
        "brainstorm",
        "spec",
        "plan",
        "tdd",
        "review",
        "ship"
      ]);
    });

    it("quick track runs only the safety core", () => {
      expect(trackStages("quick")).toEqual(["spec", "tdd", "review", "ship"]);
    });
  });

  describe("skippedStagesForTrack", () => {
    it("has no skipped stages on standard", () => {
      expect(skippedStagesForTrack("standard")).toEqual([]);
    });

    it("marks upstream stages as skipped on quick", () => {
      expect(skippedStagesForTrack("quick")).toEqual(["brainstorm", "scope", "design", "plan"]);
    });

    it("marks scope and design as skipped on medium", () => {
      expect(skippedStagesForTrack("medium")).toEqual(["scope", "design"]);
    });
  });

  describe("firstStageForTrack", () => {
    it("starts at brainstorm on standard", () => {
      expect(firstStageForTrack("standard")).toBe("brainstorm");
    });

    it("starts at brainstorm on medium", () => {
      expect(firstStageForTrack("medium")).toBe("brainstorm");
    });

    it("starts at spec on quick", () => {
      expect(firstStageForTrack("quick")).toBe("spec");
    });
  });

  describe("createInitialFlowState", () => {
    it("defaults to standard track and brainstorm when called with no args", () => {
      const state = createInitialFlowState();
      expect(state.track).toBe("standard");
      expect(state.currentStage).toBe("brainstorm");
      expect(state.skippedStages).toEqual([]);
    });

    it("preserves legacy string-arg call signature for run id", () => {
      const state = createInitialFlowState("run-123");
      expect(state.activeRunId).toBe("run-123");
      expect(state.track).toBe("standard");
    });

    it("accepts options object with track and activeRunId", () => {
      const state = createInitialFlowState({ activeRunId: "run-q", track: "quick" });
      expect(state.activeRunId).toBe("run-q");
      expect(state.track).toBe("quick");
      expect(state.currentStage).toBe("spec");
      expect(state.skippedStages).toEqual(["brainstorm", "scope", "design", "plan"]);
    });

    it("accepts medium track and sets skipped scope/design", () => {
      const state = createInitialFlowState({ activeRunId: "run-m", track: "medium" });
      expect(state.activeRunId).toBe("run-m");
      expect(state.track).toBe("medium");
      expect(state.currentStage).toBe("brainstorm");
      expect(state.skippedStages).toEqual(["scope", "design"]);
    });

    it("accepts legacy (runId, track) tuple call signature", () => {
      const state = createInitialFlowState("run-tuple", "quick");
      expect(state.activeRunId).toBe("run-tuple");
      expect(state.track).toBe("quick");
      expect(state.currentStage).toBe("spec");
    });

    it("populates full stageGateCatalog regardless of track (gates are stage-wide)", () => {
      const standard = createInitialFlowState("a", "standard");
      const quick = createInitialFlowState("b", "quick");
      const stageKeys = Object.keys(standard.stageGateCatalog).sort();
      expect(stageKeys).toEqual(Object.keys(quick.stageGateCatalog).sort());
      expect(stageKeys).toContain("brainstorm");
      expect(stageKeys).toContain("ship");
      expect(standard.stageGateCatalog.tdd.required).toContain("tdd_traceable_to_plan");
      expect(quick.stageGateCatalog.tdd.required).not.toContain("tdd_traceable_to_plan");
      expect(quick.stageGateCatalog.tdd.recommended).not.toContain("tdd_traceable_to_plan");
      expect(standard.stageGateCatalog.review.required).toContain("review_layer_coverage_complete");
      expect(quick.stageGateCatalog.review.required).toContain("review_layer_coverage_complete");
    });
  });

  describe("nextStage and previousStage honor track", () => {
    it("standard advance follows full 8-stage chain", () => {
      expect(nextStage("brainstorm", "standard")).toBe("scope");
      expect(nextStage("plan", "standard")).toBe("tdd");
      expect(nextStage("ship", "standard")).toBeNull();
    });

    it("quick advance skips plan and goes spec → tdd", () => {
      expect(nextStage("spec", "quick")).toBe("tdd");
      expect(nextStage("tdd", "quick")).toBe("review");
      expect(nextStage("review", "quick")).toBe("ship");
      expect(nextStage("ship", "quick")).toBeNull();
    });

    it("medium advance follows brainstorm → spec → plan chain", () => {
      expect(nextStage("brainstorm", "medium")).toBe("spec");
      expect(nextStage("spec", "medium")).toBe("plan");
      expect(nextStage("plan", "medium")).toBe("tdd");
      expect(nextStage("ship", "medium")).toBeNull();
    });

    it("quick returns null for upstream stages outside the active track", () => {
      expect(nextStage("brainstorm", "quick")).toBeNull();
    });

    it("previousStage on quick returns null at spec and skips back to spec from tdd", () => {
      expect(previousStage("spec", "quick")).toBeNull();
      expect(previousStage("tdd", "quick")).toBe("spec");
      expect(previousStage("review", "quick")).toBe("tdd");
    });

    it("defaults to standard when track is omitted", () => {
      expect(nextStage("spec")).toBe("plan");
      expect(previousStage("tdd")).toBe("plan");
    });

    it("nextStage returns null for any stage absent from the active track", () => {
      expect(nextStage("brainstorm", "quick")).toBeNull();
      expect(nextStage("design", "quick")).toBeNull();
      expect(nextStage("plan", "quick")).toBeNull();
    });

    it("previousStage fallback walks back through the standard order for off-track stages", () => {
      // brainstorm is at index 0 of the standard order — no predecessor exists at all
      expect(previousStage("brainstorm", "quick")).toBeNull();
      // scope/design/plan are off the quick track but have standard predecessors
      expect(previousStage("scope", "quick")).toBe("brainstorm");
      expect(previousStage("design", "quick")).toBe("scope");
      expect(previousStage("plan", "quick")).toBe("spec");
    });
  });
});
