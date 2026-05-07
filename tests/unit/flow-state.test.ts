import { describe, expect, it } from "vitest";
import {
  FLOW_STATE_SCHEMA_VERSION,
  LegacyFlowStateError,
  assertFlowStateV8,
  createInitialFlowStateV8,
  isFlowStage
} from "../../src/flow-state.js";

describe("flow-state", () => {
  it("uses schema version 2", () => {
    expect(FLOW_STATE_SCHEMA_VERSION).toBe(2);
    expect(createInitialFlowStateV8().schemaVersion).toBe(2);
  });

  it("creates a fresh state with no slug, no stage, empty AC", () => {
    const state = createInitialFlowStateV8("2026-05-07T00:00:00Z");
    expect(state).toEqual({
      schemaVersion: 2,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-07T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false
    });
  });

  it("rejects schemaVersion 1 (cclaw 7.x runs)", () => {
    const legacy = { schemaVersion: 1, currentStage: "spec" };
    expect(() => assertFlowStateV8(legacy)).toThrow(LegacyFlowStateError);
  });

  it("validates AC entries", () => {
    expect(() =>
      assertFlowStateV8({
        schemaVersion: 2,
        currentSlug: "x",
        currentStage: "plan",
        ac: [{ id: "AC-1", text: "t", status: "weird" }],
        lastSpecialist: null,
        startedAt: "2026-05-07T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false
      })
    ).toThrow(/Invalid AC status/);
  });

  it("rejects unknown specialist", () => {
    expect(() =>
      assertFlowStateV8({
        schemaVersion: 2,
        currentSlug: "x",
        currentStage: null,
        ac: [],
        lastSpecialist: "fixer",
        startedAt: "2026-05-07T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false
      })
    ).toThrow(/Invalid lastSpecialist/);
  });

  it("isFlowStage matches the four allowed values", () => {
    expect(isFlowStage("plan")).toBe(true);
    expect(isFlowStage("build")).toBe(true);
    expect(isFlowStage("review")).toBe(true);
    expect(isFlowStage("ship")).toBe(true);
    expect(isFlowStage("brainstorm")).toBe(false);
    expect(isFlowStage("design")).toBe(false);
    expect(isFlowStage("tdd")).toBe(false);
    expect(isFlowStage("spec")).toBe(false);
  });
});
