import { describe, expect, it } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { LEGACY_DISCOVERY_SPECIALISTS, SPECIALISTS } from "../../src/types.js";

/**
 * v8.14 lock-in tests, slimmed in v8.54 then re-pinned in v8.62.
 *
 * v8.14 collapsed brainstormer + architect into a single design specialist.
 * v8.62 unified flow retired that design specialist and reclaimed
 * `architect` as the new id for the renamed `ac-author` (which absorbs
 * `design`'s Phase 0/2-6 responsibilities). The historical
 * `LEGACY_DISCOVERY_SPECIALISTS` list keeps `brainstormer` only — the
 * v8.14-era `architect` id is reclaimed for the live v8.62 specialist and
 * therefore must NOT appear in the legacy list. The decisions template
 * gating is unchanged (legacy-artifacts: true).
 */
describe("v8.14/v8.62 discovery-roster migration anchor", () => {
  it("LEGACY_DISCOVERY_SPECIALISTS keeps `brainstormer` only (v8.62 reclaimed `architect` for the live specialist; the v8.14-era retired `architect` id is unreachable from the new roster)", () => {
    expect(LEGACY_DISCOVERY_SPECIALISTS).toEqual(["brainstormer"]);
    for (const legacy of LEGACY_DISCOVERY_SPECIALISTS) {
      expect(SPECIALISTS as readonly string[]).not.toContain(legacy);
    }
    // v8.62 — `architect` is now a live SPECIALISTS member; the legacy
    // list must NOT shadow it.
    expect(LEGACY_DISCOVERY_SPECIALISTS as readonly string[]).not.toContain("architect");
    expect(SPECIALISTS as readonly string[]).toContain("architect");
  });

  it("v8.62 — `architect` ships as an on-demand specialist (replacing v8.14's main-context `design`; mid-plan dialogue is dead, every specialist now runs as a sub-agent)", () => {
    const architect = CORE_AGENTS.find((agent) => agent.id === "architect");
    expect(architect?.activation).toBe("on-demand");
    // The retired v8.14 design specialist is gone.
    const design = CORE_AGENTS.find((agent) => agent.id === "design");
    expect(design).toBeUndefined();
  });

  it("decisions template stays installed only on legacy-artifacts: true (v8.14 inline + v8.54 gating; v8.62 unchanged)", () => {
    const decisions = ARTIFACT_TEMPLATES.find((template) => template.id === "decisions");
    expect(decisions?.body).toMatch(/legacy/iu);
    expect(decisions?.description).toMatch(/legacy-artifacts/iu);
  });
});
