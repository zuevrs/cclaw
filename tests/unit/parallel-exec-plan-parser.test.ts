import { describe, expect, it } from "vitest";
import {
  WavePlanDuplicateSliceError,
  WavePlanMergeConflictError,
  extractParallelExecutionManagedBody,
  mergeParallelWaveDefinitions,
  parseParallelExecutionPlanWaves,
  parseWavePlanFileBody
} from "../../src/internal/plan-split-waves.js";

const MANAGED_BLOCK = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave 02
- **Members:** S-13, S-14, U-15, U-16

### Wave 03
- **Members:** S-20, S-21
<!-- parallel-exec-managed-end -->`;

describe("parseParallelExecutionPlanWaves (v6.13.1)", () => {
  it("returns empty when managed markers are absent", () => {
    expect(parseParallelExecutionPlanWaves("# no markers\n")).toEqual([]);
  });

  it("parses waves and normalizes U-* to shared S-N / U-N pairs", () => {
    const plan = `# Plan\n\n${MANAGED_BLOCK}\n`;
    const waves = parseParallelExecutionPlanWaves(plan);
    expect(waves.map((w) => w.waveId)).toEqual(["W-02", "W-03"]);
    expect(waves[0]!.members.map((m) => m.sliceId)).toEqual(["S-13", "S-14", "S-15", "S-16"]);
    expect(waves[0]!.members.map((m) => m.unitId)).toEqual(["U-13", "U-14", "U-15", "U-16"]);
  });

  it("extractParallelExecutionManagedBody returns inner markdown", () => {
    const inner = extractParallelExecutionManagedBody(`x\n${MANAGED_BLOCK}\ny`);
    expect(inner).toContain("## Parallel Execution Plan");
    expect(inner).not.toContain("parallel-exec-managed-start");
  });

  it("throws on duplicate slice ids", () => {
    const bad = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1, S-1
<!-- parallel-exec-managed-end -->`;
    expect(() => parseParallelExecutionPlanWaves(bad)).toThrow(WavePlanDuplicateSliceError);
  });
});

describe("parseWavePlanFileBody", () => {
  it("prefers Members line over free-text S-* scan", () => {
    const body = `# Wave
Members: S-2, S-3
Also mentions S-9 in prose.
`;
    const w = parseWavePlanFileBody(body, "W-01");
    expect(w.members.map((m) => m.sliceId)).toEqual(["S-2", "S-3"]);
  });
});

describe("mergeParallelWaveDefinitions", () => {
  it("merges disjoint slices from secondary source", () => {
    const a = parseParallelExecutionPlanWaves(`<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1
<!-- parallel-exec-managed-end -->`);
    const merged = mergeParallelWaveDefinitions(a, [
      { waveId: "W-01", members: [{ sliceId: "S-2", unitId: "U-2" }] }
    ]);
    const w1 = merged.find((w) => w.waveId === "W-01");
    expect(w1?.members.map((m) => m.sliceId).sort()).toEqual(["S-1", "S-2"]);
  });

  it("errors when the same slice appears in conflicting waves", () => {
    const primary = [
      { waveId: "W-01", members: [{ sliceId: "S-1", unitId: "U-1" }] }
    ];
    const secondary = [
      { waveId: "W-02", members: [{ sliceId: "S-1", unitId: "U-1" }] }
    ];
    expect(() => mergeParallelWaveDefinitions(primary, secondary)).toThrow(WavePlanMergeConflictError);
  });
});
