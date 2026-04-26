import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("gate density policy", () => {
  it("keeps required gates within per-stage budget", () => {
    const REQUIRED_GATE_BUDGET: Partial<Record<string, number>> = {
      design: 5,
      // plan budget = 5: slice budget, dependency batches, acceptance mapping,
      // execution posture, and explicit WAIT_FOR_CONFIRM.
      plan: 5,
      // tdd budget = 8: discovery + impact check + RED/GREEN/REFACTOR/verify/trace + docs-drift.
      // Discovery and impact are explicit pre-RED gates from the reference workflow.
      tdd: 8,
      review: 6
    };
    for (const stage of FLOW_STAGES) {
      const required = stageSchema(stage).requiredGates.filter((gate) => gate.tier === "required");
      const maxRequired = REQUIRED_GATE_BUDGET[stage] ?? 4;
      expect(
        required.length,
        `stage "${stage}" has ${required.length} required gates (> ${maxRequired})`
      ).toBeLessThanOrEqual(maxRequired);
    }
  });
});
