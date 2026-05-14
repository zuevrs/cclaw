import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { LEGACY_DISCOVERY_SPECIALISTS, SPECIALISTS } from "../../src/types.js";

/**
 * v8.14 lock-in tests, slimmed in v8.54.
 *
 * The v8.14 release collapsed brainstormer + architect into a single
 * design specialist that runs in the main orchestrator context. The
 * migration check (LEGACY_DISCOVERY_SPECIALISTS still names the two
 * retired ids) is the anchor that keeps the legacy state-rewrite path
 * connected. The historical "design main-context, others on-demand"
 * sweep is covered by core-agents.test.ts and types.test.ts; the
 * "decisions inline" sweep is covered by v813/v853 plan-template tests.
 */
describe("v8.14 strong-design (migration anchor)", () => {
  it("LEGACY_DISCOVERY_SPECIALISTS still names brainstormer + architect (drives the lastSpecialist rewrite)", () => {
    expect(LEGACY_DISCOVERY_SPECIALISTS).toEqual(["brainstormer", "architect"]);
    for (const legacy of LEGACY_DISCOVERY_SPECIALISTS) {
      expect(SPECIALISTS as readonly string[]).not.toContain(legacy);
    }
  });

  it("design ships as a main-context specialist (the single anchor; phase coverage is in design-prompt tests)", () => {
    const design = CORE_AGENTS.find((agent) => agent.id === "design");
    expect(design?.activation).toBe("main-context");
  });

  it("decisions template stays installed only on legacy-artifacts: true (v8.14 inline + v8.54 gating)", () => {
    const decisions = ARTIFACT_TEMPLATES.find((template) => template.id === "decisions");
    expect(decisions?.body).toMatch(/legacy/iu);
    expect(decisions?.description).toMatch(/legacy-artifacts/iu);
  });
});
