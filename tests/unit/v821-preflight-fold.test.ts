import { describe, expect, it } from "vitest";
import { assertFlowStateV82, FLOW_STATE_SCHEMA_VERSION } from "../../src/flow-state.js";
import type { TriageDecision } from "../../src/types.js";

/**
 * v8.21 preflight-fold — slimmed in v8.100.
 *
 * Kept the three `assertFlowStateV82` schema-validation tests that
 * exercise the real `triage.assumptions` contract. The architect-prompt
 * and skill-body grep tripwires were removed.
 */
describe("v8.21 preflight-fold — triage.assumptions validator", () => {
  it("TriageDecision schema still accepts triage.assumptions as a string array", () => {
    const triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "test",
      decidedAt: "2026-05-11T00:00:00Z",
      userOverrode: false,
      assumptions: ["Node 20", "tests/ live alongside source"]
    } satisfies TriageDecision;
    const state = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "test",
      currentStage: "plan",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 0,
      reviewCounter: 0,
      securityFlag: false,
      triage
    };
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });

  it("TriageDecision validator still accepts triage.assumptions: null (legacy + inline path)", () => {
    const triage = {
      complexity: "trivial",
      ceremonyMode: "inline",
      path: ["build"],
      rationale: "test",
      decidedAt: "2026-05-11T00:00:00Z",
      userOverrode: false,
      assumptions: null
    } satisfies TriageDecision;
    const state = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "test",
      currentStage: "build",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 0,
      reviewCounter: 0,
      securityFlag: false,
      triage
    };
    expect(() => assertFlowStateV82(state)).not.toThrow();
  });

  it("TriageDecision validator rejects non-string entries in triage.assumptions", () => {
    const triage = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "ship"],
      rationale: "test",
      decidedAt: "2026-05-11T00:00:00Z",
      userOverrode: false,
      assumptions: ["fine", 42 as unknown as string]
    };
    const state = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "test",
      currentStage: "plan",
      ac: [],
      lastSpecialist: null,
      startedAt: "2026-05-11T00:00:00Z",
      reviewIterations: 0,
      reviewCounter: 0,
      securityFlag: false,
      triage
    };
    expect(() => assertFlowStateV82(state)).toThrow(/triage\.assumptions/u);
  });
});
