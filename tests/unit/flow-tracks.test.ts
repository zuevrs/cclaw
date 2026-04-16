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
    it("recognizes standard and quick tracks", () => {
      expect(isFlowTrack("standard")).toBe(true);
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
  });

  describe("firstStageForTrack", () => {
    it("starts at brainstorm on standard", () => {
      expect(firstStageForTrack("standard")).toBe("brainstorm");
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

    it("quick ignores upstream stages (they are not on the critical path)", () => {
      // Falls back to legacy behavior if queried with an off-track stage.
      expect(nextStage("brainstorm", "quick")).toBe("scope");
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

    it("nextStage fallback returns the standard successor for stages absent from the active track", () => {
      // brainstorm is not on the quick track, but fallback walks the full standard order
      expect(nextStage("brainstorm", "quick")).toBe("scope");
      expect(nextStage("design", "quick")).toBe("spec");
      expect(nextStage("plan", "quick")).toBe("tdd");
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
