import { describe, expect, it } from "vitest";
import { selectReadySlices, type ReadySliceUnit } from "../../src/delegation.js";

describe("selectReadySlices (v6.13 DAG-ready)", () => {
  const units: ReadySliceUnit[] = [
    {
      unitId: "U-10",
      sliceId: "S-10",
      dependsOn: [],
      claimedPaths: ["a"],
      parallelizable: true
    },
    {
      unitId: "U-2",
      sliceId: "S-2",
      dependsOn: [],
      claimedPaths: ["b"],
      parallelizable: true
    }
  ];

  it("orders U-2 before U-10 (numeric U- ids, not lexicographic)", () => {
    const ready = selectReadySlices(units, {
      cap: 5,
      completedUnitIds: new Set(),
      activePathHolders: [],
      legacyContinuation: false
    });
    expect(ready.map((u) => u.unitId)).toEqual(["U-2", "U-10"]);
  });

  it("serializes legacy units without explicit parallelizable (pool filters to parallelizable-only)", () => {
    const mixed: ReadySliceUnit[] = [
      {
        unitId: "U-1",
        sliceId: "S-1",
        dependsOn: [],
        claimedPaths: ["x"],
        parallelizable: false
      },
      {
        unitId: "U-2",
        sliceId: "S-2",
        dependsOn: [],
        claimedPaths: ["y"],
        parallelizable: true
      }
    ];
    const ready = selectReadySlices(mixed, {
      cap: 5,
      completedUnitIds: new Set(),
      activePathHolders: [],
      legacyContinuation: true
    });
    expect(ready.map((u) => u.unitId)).toEqual(["U-2"]);
  });

  it("respects dependsOn and disjoint paths with cap", () => {
    const dag: ReadySliceUnit[] = [
      {
        unitId: "U-1",
        sliceId: "S-1",
        dependsOn: [],
        claimedPaths: ["src/a"],
        parallelizable: true
      },
      {
        unitId: "U-2",
        sliceId: "S-2",
        dependsOn: ["U-1"],
        claimedPaths: ["src/b"],
        parallelizable: true
      },
      {
        unitId: "U-3",
        sliceId: "S-3",
        dependsOn: [],
        claimedPaths: ["src/c"],
        parallelizable: true
      }
    ];
    const first = selectReadySlices(dag, {
      cap: 5,
      completedUnitIds: new Set(),
      activePathHolders: [],
      legacyContinuation: false
    });
    expect(first.map((u) => u.unitId).sort()).toEqual(["U-1", "U-3"]);
    const second = selectReadySlices(dag, {
      cap: 5,
      completedUnitIds: new Set(["U-1", "U-3"]),
      activePathHolders: [],
      legacyContinuation: false
    });
    expect(second.map((u) => u.unitId)).toEqual(["U-2"]);
  });
});
