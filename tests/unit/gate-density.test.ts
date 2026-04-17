import { describe, expect, it } from "vitest";
import { COMMAND_FILE_ORDER } from "../../src/constants.js";
import { stageSchema } from "../../src/content/stage-schema.js";

describe("gate density policy", () => {
  it("keeps required gates at or below four per stage", () => {
    for (const stage of COMMAND_FILE_ORDER) {
      const required = stageSchema(stage).requiredGates.filter((gate) => gate.tier === "required");
      expect(
        required.length,
        `stage "${stage}" has ${required.length} required gates (> 4)`
      ).toBeLessThanOrEqual(4);
    }
  });
});
