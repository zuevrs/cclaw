import { describe, expect, it } from "vitest";

import { topologicalLayers } from "../../src/slice-topology.js";
import type { SliceId } from "../../src/types.js";

/**
 * Minimal slice shape that satisfies `LayerableSlice` — just `id` and
 * `dependsOn`. Lets each test name its slices succinctly without
 * fabricating Surface arrays or `independent` flags that the topology
 * helper does not consult.
 */
type TestSlice = { id: SliceId; dependsOn: SliceId[] };

function slice(id: SliceId, dependsOn: SliceId[] = []): TestSlice {
  return { id, dependsOn };
}

describe("topologicalLayers — empty input", () => {
  it("returns [] for an empty slice list", () => {
    expect(topologicalLayers([])).toEqual([]);
  });
});

describe("topologicalLayers — single slice", () => {
  it("returns one layer containing the lone slice", () => {
    const sl1 = slice("SL-1");
    expect(topologicalLayers([sl1])).toEqual([[sl1]]);
  });
});

describe("topologicalLayers — three independent slices", () => {
  it("groups all three into a single layer (parallel dispatch shape)", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2");
    const sl3 = slice("SL-3");
    const layers = topologicalLayers([sl1, sl2, sl3]);
    expect(layers).toHaveLength(1);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1", "SL-2", "SL-3"]);
  });

  it("sorts the layer by numeric suffix regardless of input order", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2");
    const sl10 = slice("SL-10");
    const layers = topologicalLayers([sl10, sl1, sl2]);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1", "SL-2", "SL-10"]);
  });
});

describe("topologicalLayers — linear chain", () => {
  it("returns one layer per chain link (sequential shape)", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2", ["SL-1"]);
    const sl3 = slice("SL-3", ["SL-2"]);
    const layers = topologicalLayers([sl1, sl2, sl3]);
    expect(layers).toHaveLength(3);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1"]);
    expect(layers[1].map((s) => s.id)).toEqual(["SL-2"]);
    expect(layers[2].map((s) => s.id)).toEqual(["SL-3"]);
  });
});

describe("topologicalLayers — fan-in mix", () => {
  it("places SL-3 in a second layer when it depends on SL-1 and SL-2", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2");
    const sl3 = slice("SL-3", ["SL-1", "SL-2"]);
    const layers = topologicalLayers([sl1, sl2, sl3]);
    expect(layers).toHaveLength(2);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1", "SL-2"]);
    expect(layers[1].map((s) => s.id)).toEqual(["SL-3"]);
  });
});

describe("topologicalLayers — fan-out mix", () => {
  it("places SL-2 and SL-3 in a second layer when both depend on SL-1", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2", ["SL-1"]);
    const sl3 = slice("SL-3", ["SL-1"]);
    const layers = topologicalLayers([sl1, sl2, sl3]);
    expect(layers).toHaveLength(2);
    expect(layers[0].map((s) => s.id)).toEqual(["SL-1"]);
    expect(layers[1].map((s) => s.id)).toEqual(["SL-2", "SL-3"]);
  });
});

describe("topologicalLayers — diamond", () => {
  it("schedules a diamond SL-1 → {SL-2, SL-3} → SL-4 in three layers", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2", ["SL-1"]);
    const sl3 = slice("SL-3", ["SL-1"]);
    const sl4 = slice("SL-4", ["SL-2", "SL-3"]);
    const layers = topologicalLayers([sl4, sl3, sl2, sl1]);
    expect(layers.map((layer) => layer.map((s) => s.id))).toEqual([
      ["SL-1"],
      ["SL-2", "SL-3"],
      ["SL-4"],
    ]);
  });
});

describe("topologicalLayers — cycle detection", () => {
  it("throws a cycle error naming the slices it cannot schedule (2-node cycle)", () => {
    const sl1 = slice("SL-1", ["SL-2"]);
    const sl2 = slice("SL-2", ["SL-1"]);
    expect(() => topologicalLayers([sl1, sl2])).toThrowError(/cycle detected/);
    expect(() => topologicalLayers([sl1, sl2])).toThrowError(/SL-1/);
    expect(() => topologicalLayers([sl1, sl2])).toThrowError(/SL-2/);
  });

  it("throws a cycle error on a 3-node transitive loop", () => {
    const sl1 = slice("SL-1", ["SL-3"]);
    const sl2 = slice("SL-2", ["SL-1"]);
    const sl3 = slice("SL-3", ["SL-2"]);
    expect(() => topologicalLayers([sl1, sl2, sl3])).toThrowError(/cycle detected/);
  });

  it("schedules independent slices even when a cycle exists elsewhere — but still throws because the cycle blocks completion", () => {
    const sl1 = slice("SL-1");
    const sl2 = slice("SL-2", ["SL-3"]);
    const sl3 = slice("SL-3", ["SL-2"]);
    expect(() => topologicalLayers([sl1, sl2, sl3])).toThrowError(/cycle detected/);
  });
});

describe("topologicalLayers — bad inputs", () => {
  it("throws on a duplicate slice id", () => {
    const sl1 = slice("SL-1");
    const sl1Again = slice("SL-1");
    expect(() => topologicalLayers([sl1, sl1Again])).toThrowError(/duplicate slice id SL-1/);
  });

  it("throws on an unknown dependsOn id", () => {
    const sl1 = slice("SL-1", ["SL-9"]);
    expect(() => topologicalLayers([sl1])).toThrowError(
      /SL-1 dependsOn unknown id SL-9/,
    );
  });
});
