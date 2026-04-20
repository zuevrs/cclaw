import { describe, expect, it } from "vitest";
import { COMMAND_FILE_ORDER } from "../../src/constants.js";
import { stageSchema } from "../../src/content/stage-schema.js";

describe("gate density policy", () => {
  it("keeps required gates at or below four per stage", () => {
    const REQUIRED_GATE_BUDGET: Partial<Record<string, number>> = {
      tdd: 5
    };
    for (const stage of COMMAND_FILE_ORDER) {
      const required = stageSchema(stage).requiredGates.filter((gate) => gate.tier === "required");
      const maxRequired = REQUIRED_GATE_BUDGET[stage] ?? 4;
      expect(
        required.length,
        `stage "${stage}" has ${required.length} required gates (> ${maxRequired})`
      ).toBeLessThanOrEqual(maxRequired);
    }
  });
});
