import { describe, expect, it } from "vitest";
import {
  assertFlowStateV82,
  createInitialFlowState,
  FLOW_STATE_SCHEMA_VERSION
} from "../../src/flow-state.js";
import type { TriageDecision } from "../../src/types.js";

/**
 * v8.20 review-loop polish — flow-state schema wiring.
 *
 * Slimmed in v8.100: kept only the `createInitialFlowState` /
 * `assertFlowStateV82` validator tests for the new reviewCounter +
 * iterationOverride fields. The REVIEWER_PROMPT, START_COMMAND_BODY,
 * cap-reached runbook, and review template content-greps were removed.
 */
describe("v8.20 — reviewCounter + iterationOverride flow-state contract", () => {
  it("flow-state.json includes reviewCounter in createInitialFlowState", () => {
    const state = createInitialFlowState("2026-05-11T00:00:00Z");
    expect(state.reviewCounter).toBe(0);
  });

  it("assertFlowStateV82 accepts state with reviewCounter set", () => {
    const state = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 5,
      reviewCounter: 5,
      securityFlag: false,
      triage: null
    };
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });

  it("assertFlowStateV82 rejects state with negative reviewCounter", () => {
    const state = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 0,
      reviewCounter: -1,
      securityFlag: false,
      triage: null
    };
    expect(() => assertFlowStateV82(state)).toThrow(/reviewCounter/u);
  });

  it("v8.19 state without reviewCounter validates unchanged (back-compat)", () => {
    const v819State = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: null,
      currentStage: null,
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 3,
      securityFlag: false,
      triage: null
    };
    expect(() => assertFlowStateV82(v819State)).not.toThrow();
  });

  it("TriageDecision schema accepts iterationOverride boolean", () => {
    const triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "test",
      decidedAt: "2026-05-11T00:00:00Z",
      userOverrode: false,
      iterationOverride: true
    } satisfies TriageDecision;
    const state = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "test",
      currentStage: "review",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 5,
      reviewCounter: 3,
      securityFlag: false,
      triage
    };
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });
});
