import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("gate density policy", () => {
  it("keeps required gates within per-stage budget", () => {
    const REQUIRED_GATE_BUDGET: Partial<Record<string, number>> = {
      // design budget = 6 after wave-8 freshness gate:
      // research, architecture lock, diagram freshness, data flow, failure modes, test/perf.
      design: 6,
      // spec budget = 5 after wave-9 self-review gate:
      // measurable AC, testability, assumptions, self-review, approval.
      spec: 5,
      // plan budget = 7: slice budget, dependency batches, acceptance mapping,
      // execution posture, full parallel-exec coverage, disjoint same-wave
      // claimed paths, and explicit WAIT_FOR_CONFIRM.
      plan: 7,
      // tdd budget = 11 after wave-9 enforcement:
      // discovery, impact, RED/GREEN/REFACTOR, verify, docs-drift, traceability (non-quick),
      // plus required iron-law, watched-RED, and vertical-slice-cycle evidence gates.
      tdd: 11,
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
