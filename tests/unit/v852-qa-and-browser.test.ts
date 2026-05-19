import { describe, expect, it } from "vitest";

import { assertFlowStateV8 } from "../../src/flow-state.js";

/**
 * v8.52 — qa-and-browser stage flow-state wiring.
 *
 * Slimmed in v8.100: kept only the `assertFlowStateV8` validator tests
 * for the qa.* fields. The SURFACES / FLOW_STAGES / qa-runner registry
 * + prompt / template / runbook content-greps were removed.
 */
describe("v8.52 flow-state — qa{Verdict,Iteration,DispatchedAt,EvidenceTier}", () => {
  const BASE_FLOW_STATE = {
    schemaVersion: 3 as const,
    currentSlug: "v852-qa-and-browser",
    currentStage: "qa" as const,
    ac: [],
    lastSpecialist: "slice-builder" as const,
    startedAt: "2026-05-14T18:00:00.000Z",
    reviewIterations: 0,
    securityFlag: false,
    triage: null
  };

  it("accepts a full happy-path state with all four qa fields populated", () => {
    expect(() =>
      assertFlowStateV8({
        ...BASE_FLOW_STATE,
        qaVerdict: "pass",
        qaIteration: 0,
        qaDispatchedAt: "2026-05-14T18:10:00.000Z",
        qaEvidenceTier: "playwright"
      })
    ).not.toThrow();
  });

  it("accepts state without any qa fields (backwards compat with pre-v8.52 flows)", () => {
    expect(() => assertFlowStateV8(BASE_FLOW_STATE)).not.toThrow();
  });

  it("rejects invalid qaVerdict (e.g. `revise` — that's the plan-critic's vocabulary)", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaVerdict: "revise" })
    ).toThrow(/Invalid qaVerdict/);
  });

  it("rejects qaIteration outside {0, 1} (the iterate-loop cap)", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaIteration: 2 })
    ).toThrow(/qaIteration/);
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaIteration: -1 })
    ).toThrow(/qaIteration/);
  });

  it("rejects invalid qaEvidenceTier (e.g. `cypress` — not in the enum)", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaEvidenceTier: "cypress" })
    ).toThrow(/Invalid qaEvidenceTier/);
  });

  it("rejects qaDispatchedAt as a non-string", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaDispatchedAt: 1715706600 })
    ).toThrow(/qaDispatchedAt/);
  });
});
