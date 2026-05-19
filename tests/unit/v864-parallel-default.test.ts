import { describe, expect, it } from "vitest";

import { topologicalLayers } from "../../src/slice-topology.js";

/**
 * v8.64 — parallel-by-default for multi-slice tasks.
 *
 * Slimmed in v8.100: kept only the `topologicalLayers` behaviour tests.
 * The builder/plan-critic/reviewer prompt-greps and start-command
 * content-greps for the parallel-by-default prose were removed.
 */
describe("v8.64 — topologicalLayers", () => {
  it("returns layers of one for a linear chain (sanity check)", () => {
    const slices = [
      { id: "SL-1" as const, dependsOn: [] },
      { id: "SL-2" as const, dependsOn: ["SL-1" as const] },
    ];
    const layers = topologicalLayers(slices);
    expect(layers).toHaveLength(2);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1"]);
    expect(layers[1].map((s) => s.id)).toEqual(["SL-2"]);
  });

  it("returns a single layer for independent slices (parallel dispatch shape)", () => {
    const slices = [
      { id: "SL-1" as const, dependsOn: [] },
      { id: "SL-2" as const, dependsOn: [] },
    ];
    const layers = topologicalLayers(slices);
    expect(layers).toHaveLength(1);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1", "SL-2"]);
  });
});
