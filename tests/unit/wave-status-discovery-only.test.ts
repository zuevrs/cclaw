import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runWaveStatus } from "../../src/internal/wave-status.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

/**
 * 7.7.1 — when every ready member of the active wave is in a non-high-risk
 * scaffold/docs lane and `claimedPaths` are disjoint, the lane-aware router
 * collapses the wave into:
 *   - `topology: "inline"` + `mode: "controller-inline"` (small batch)
 *   - `topology: "single-builder"` + `mode: "wave-fanout"` (large batch)
 *
 * The bug 7.7.1 fixes: 3 markdown-only discovery spikes triggered 3 parallel
 * slice-builder agents because the auto router ignored `lane`/`riskTier`.
 */

const PLAN_PREFIX = `# Plan Artifact

## Task List
- T-001
- T-002
- T-003

## Dependency Batches
- Batch 1: T-001, T-002, T-003

## Acceptance Mapping
- AC-001 -> T-001, T-002, T-003

## Execution Posture
- parallel-safe when paths are disjoint

`;

async function seedPlan(root: string, managedBlock: string): Promise<void> {
  await ensureRunSystem(root);
  const state = await readFlowState(root);
  await writeFlowState(
    root,
    {
      ...state,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    },
    { allowReset: true }
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/05-plan.md"),
    `${PLAN_PREFIX}${managedBlock}\n`,
    "utf8"
  );
}

describe("wave-status discovery-only lane awareness (7.7.1)", () => {
  it("collapses a 3-member scaffold-lane wave into topology=inline + mode=controller-inline", async () => {
    const root = await createTempProject("wave-status-discovery-inline-3");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | docs/spike-a.md | true | low | scaffold |
| S-2 | T-002 | [] | docs/spike-b.md | true | low | scaffold |
| S-3 | T-003 | [] | docs/spike-c.md | true | low | scaffold |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    expect(report.nextDispatch.waveId).toBe("W-01");
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-1", "S-2", "S-3"]);
    expect(report.nextDispatch.topology).toBe("inline");
    expect(report.nextDispatch.mode).toBe("controller-inline");
    expect(report.nextDispatch.controllerHint).toMatch(
      /Fulfill ready slices in this turn without dispatching slice-builder/iu
    );
    expect(report.nextDispatch.controllerHint).toMatch(/role=controller/iu);
    expect(report.nextDispatch.pathConflicts).toEqual([]);
  });

  it("hands a 5-member docs-lane wave to one single-builder span", async () => {
    const root = await createTempProject("wave-status-discovery-single-5");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | docs/a.md | true | low | docs |
| S-2 | T-002 | [] | docs/b.md | true | low | docs |
| S-3 | T-003 | [] | docs/c.md | true | low | docs |
| S-4 | T-004 | [] | docs/d.md | true | low | docs |
| S-5 | T-005 | [] | docs/e.md | true | low | docs |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    expect(report.nextDispatch.topology).toBe("single-builder");
    // mode for >1 ready slice + no path conflicts is wave-fanout; the
    // controller still reads `topology=single-builder` and issues exactly
    // one Task dispatch covering all ready members.
    expect(report.nextDispatch.mode).toBe("wave-fanout");
    expect(report.nextDispatch.controllerHint).toBeUndefined();
    expect(report.nextDispatch.readyToDispatch).toEqual([
      "S-1",
      "S-2",
      "S-3",
      "S-4",
      "S-5"
    ]);
  });

  it("does NOT inline a mixed wave when only some members are scaffold/docs", async () => {
    const root = await createTempProject("wave-status-discovery-mixed");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | docs/a.md | true | low | docs |
| S-2 | T-002 | [] | src/feature.ts | true | low | production |
| S-3 | T-003 | [] | docs/c.md | true | low | docs |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    // 1 production lane + 2 docs lanes ⇒ standard parallel-builders path;
    // controller-inline is reserved for fully-discovery ready sets.
    expect(report.nextDispatch.topology).toBe("parallel-builders");
    expect(report.nextDispatch.mode).toBe("wave-fanout");
    expect(report.nextDispatch.controllerHint).toBeUndefined();
  });

  it("never inlines a high-risk discovery-only ready set", async () => {
    const root = await createTempProject("wave-status-discovery-high-risk");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | docs/security-audit.md | true | high | docs |
| S-2 | T-002 | [] | docs/threat-model.md | true | high | docs |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    expect(report.nextDispatch.topology).not.toBe("inline");
    expect(report.nextDispatch.mode).not.toBe("controller-inline");
  });
});
