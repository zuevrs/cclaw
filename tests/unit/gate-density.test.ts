import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("gate density policy", () => {
  it("keeps required gates within per-stage budget", () => {
    const REQUIRED_GATE_BUDGET: Partial<Record<string, number>> = {
      design: 5,
      // tdd budget = 6: RED/GREEN/REFACTOR/verify/trace + docs-drift (public API surface).
      // docs-drift is a distinct axis from the cycle gates, so it counts toward budget.
      tdd: 6,
      review: 5
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
