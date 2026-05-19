import { describe, expect, it } from "vitest";

import { SPECIALISTS } from "../../src/types.js";
import {
  assertFlowStateV82,
  FLOW_STATE_SCHEMA_VERSION
} from "../../src/flow-state.js";

/**
 * v8.62 — Unified flow architecture tripwires.
 *
 * Slimmed in v8.100: kept only the SPECIALISTS roster ordering anchor
 * and the permissive `lastSpecialist` back-compat wiring test. The
 * specialist-prompts file existence checks, architect/builder/reviewer
 * prompt-greps, plan template content-greps, and start-command body
 * greps were removed.
 */
describe("v8.62 — SPECIALISTS roster is the canonical pipeline (post-v8.82: 10 entries)", () => {
  it("orders the ten specialists along the canonical pipeline", () => {
    expect(SPECIALISTS).toEqual([
      "triage",
      "investigator",
      "architect",
      "builder",
      "plan-critic",
      "plan-design",
      "plan-devex",
      "qa-runner",
      "reviewer",
      "critic"
    ]);
  });
});

describe("v8.62 — clean break: pre-v8.62 state files validate via permissive readers", () => {
  it("the flow-state validator MUST NOT reject `lastSpecialist` values that are pre-v8.62 names (design, ac-author, slice-builder, security-reviewer)", () => {
    for (const legacyId of [
      "design",
      "ac-author",
      "slice-builder",
      "security-reviewer"
    ]) {
      expect(() =>
        assertFlowStateV82({
          schemaVersion: FLOW_STATE_SCHEMA_VERSION,
          currentSlug: "20260101-test",
          currentStage: "plan",
          ac: [],
          lastSpecialist: legacyId,
          startedAt: "2026-01-01T00:00:00Z",
          reviewIterations: 0,
          securityFlag: false,
          triage: null
        })
      ).not.toThrow();
    }
  });
});
