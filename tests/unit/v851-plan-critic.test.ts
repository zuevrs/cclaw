import { describe, expect, it } from "vitest";

import { assertFlowStateV8 } from "../../src/flow-state.js";

/**
 * v8.51 plan-critic — flow-state schema wiring.
 *
 * Slimmed in v8.100: kept only the `assertFlowStateV8` validator tests
 * for the planCritic.* fields. The registry / prompt / template /
 * runbook / start-command content-greps were removed.
 */
describe("v8.51 plan-critic — flow-state validator surface", () => {
  const BASE = {
    schemaVersion: 3 as const,
    currentSlug: "v851-plan-critic",
    currentStage: "plan" as const,
    ac: [],
    lastSpecialist: "architect" as const,
    startedAt: "2026-05-14T18:00:00.000Z",
    reviewIterations: 0,
    securityFlag: false,
    triage: null
  };

  it("validator accepts pre-v8.51 flow-state (no planCritic fields)", () => {
    expect(() => assertFlowStateV8(BASE)).not.toThrow();
  });

  it("validator accepts each valid planCriticVerdict (null / pass / revise / cancel)", () => {
    for (const verdict of [null, "pass", "revise", "cancel"] as const) {
      expect(() => assertFlowStateV8({ ...BASE, planCriticVerdict: verdict })).not.toThrow();
    }
  });

  it("validator rejects post-impl critic verdicts (`block-ship`, `iterate`) — separate vocabulary", () => {
    expect(() => assertFlowStateV8({ ...BASE, planCriticVerdict: "block-ship" })).toThrow(
      /Invalid planCriticVerdict/
    );
    expect(() => assertFlowStateV8({ ...BASE, planCriticVerdict: "iterate" })).toThrow(
      /Invalid planCriticVerdict/
    );
  });

  it("validator caps planCriticIteration at 0 | 1 (one revise loop max)", () => {
    expect(() => assertFlowStateV8({ ...BASE, planCriticIteration: 0 })).not.toThrow();
    expect(() => assertFlowStateV8({ ...BASE, planCriticIteration: 1 })).not.toThrow();
    expect(() => assertFlowStateV8({ ...BASE, planCriticIteration: 2 })).toThrow(
      /planCriticIteration.*0 or 1|revise-loop cap/
    );
  });

  it("validator accepts the happy-path full state (verdict + iteration + dispatchedAt)", () => {
    expect(() =>
      assertFlowStateV8({
        ...BASE,
        planCriticVerdict: "pass",
        planCriticIteration: 0,
        planCriticDispatchedAt: "2026-05-14T18:10:00.000Z"
      })
    ).not.toThrow();
  });
});
