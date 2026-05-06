import { describe, expect, it } from "vitest";
import { stageSchema } from "../../src/content/stage-schema.js";
import { FLOW_STAGES } from "../../src/types.js";

describe("gate density policy", () => {
  it("keeps required gates within per-stage budget", () => {
    const REQUIRED_GATE_BUDGET: Partial<Record<string, number>> = {
      // design budget = 6 after wave-8 freshness gate:
      // research, architecture lock, diagram freshness, data flow, failure modes, test/perf.
      design: 6,
      // spec budget = 6 after AC traceability:
      // AC ids present, measurable AC, testability, assumptions, self-review, approval.
      spec: 6,
      // plan budget = 8: slice budget, dependency batches, acceptance mapping,
      // execution posture, full parallel-exec coverage, disjoint same-wave
      // claimed paths, module-wires-root (7.6.0), and explicit WAIT_FOR_CONFIRM.
      plan: 8,
      // tdd budget = 13 after AC traceability:
      // discovery, impact, RED/GREEN/REFACTOR, verify, docs-drift, traceability (non-quick),
      // iron-law, watched-RED, vertical-slice-cycle, closes-AC links, orphan-change guard.
      tdd: 13,
      review: 6,
      // ship budget = 5 after AC-to-commit coverage gate.
      ship: 5
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
