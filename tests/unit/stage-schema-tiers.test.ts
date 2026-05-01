import { describe, expect, it } from "vitest";
import {
  mandatoryDelegationsForStage,
  stageDelegationSummary
} from "../../src/content/stage-schema.js";

/**
 * Wave 22 (Phase G3): document the contract that `stageDelegationSummary`
 * filters dispatch rows by `requiredAtTier`. The current matrix marks all
 * mandatory rows as `requiredAtTier: "standard"`, so `lightweight` falls
 * below the threshold and intentionally has zero mandatory delegations.
 *
 * If a future wave adds `requiredAtTier: "lightweight"` rows, this test
 * documents the intent (lightweight = self-review, no mandatory subagents)
 * and forces a deliberate update if the policy changes.
 */

describe("stage delegation tier filtering", () => {
  it("lightweight tier strips mandatory delegations from elicitation stages (brainstorm/scope/design = self-review only)", () => {
    for (const stage of ["brainstorm", "scope", "design"] as const) {
      const mandatory = mandatoryDelegationsForStage(stage, "lightweight");
      expect(
        mandatory,
        `lightweight ${stage} should not enforce mandatory delegations; rely on agent self-review and the artifact linter instead.`
      ).toEqual([]);
    }
  });

  it("lightweight tier keeps risk-critical mandatory delegations on tdd/review/ship", () => {
    // These rows explicitly set `requiredAtTier: "lightweight"` because shipping
    // unsafe code on a lightweight track would still be a regression — TDD
    // evidence, two-pass review, security attestation, architect cohesion,
    // release readiness, and doc-updater run on every track.
    expect(mandatoryDelegationsForStage("tdd", "lightweight")).toContain("test-author");
    const lightReview = mandatoryDelegationsForStage("review", "lightweight");
    expect(lightReview).toContain("reviewer");
    expect(lightReview).toContain("security-reviewer");
    const lightShip = mandatoryDelegationsForStage("ship", "lightweight");
    expect(lightShip).toContain("architect");
    expect(lightShip).toContain("release-reviewer");
  });

  it("standard tier produces non-empty mandatory delegations for elicitation stages", () => {
    for (const stage of ["brainstorm", "scope", "design"] as const) {
      const mandatory = mandatoryDelegationsForStage(stage, "standard");
      expect(
        mandatory.length,
        `standard ${stage} should require at least one mandatory delegation`
      ).toBeGreaterThan(0);
    }
  });

  it("deep tier inherits standard mandatory delegations (deep >= standard tier rank)", () => {
    for (const stage of ["brainstorm", "scope", "design"] as const) {
      const standard = mandatoryDelegationsForStage(stage, "standard");
      const deep = mandatoryDelegationsForStage(stage, "deep");
      for (const agent of standard) {
        expect(
          deep,
          `deep ${stage} should at minimum include every standard mandatory agent (${agent})`
        ).toContain(agent);
      }
    }
  });

  it("lightweight tier still surfaces proactive rows when the matrix declares any (no current rows is OK)", () => {
    // Documents the contract: proactive rows are tier-filtered the same way as
    // mandatory rows. We do not assert proactive.length>0 because the policy
    // for lightweight is to keep agent autonomy maximal.
    const summary = stageDelegationSummary("lightweight");
    for (const row of summary) {
      expect(Array.isArray(row.proactiveAgents)).toBe(true);
    }
  });
});
