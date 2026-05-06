import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runWaveStatus } from "../../src/internal/wave-status.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

const PLAN_PREFIX = `# Plan Artifact

## Task List
- T-001
- T-002

## Dependency Batches
- Batch 1: T-001, T-002

## Acceptance Mapping
- AC-001 -> T-001, T-002

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

describe("wave-status pathConflicts detection", () => {
  it("returns blocked mode with slice:path conflicts for overlapping same-wave claimed paths", async () => {
    const root = await createTempProject("wave-status-path-conflicts");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/shared.ts, src/a.ts | true | low | production |
| S-2 | T-002 | [] | src/shared.ts, src/b.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    expect(report.nextDispatch.waveId).toBe("W-02");
    expect(report.nextDispatch.mode).toBe("blocked");
    expect(report.nextDispatch.topology).toBe("single-builder");
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-1", "S-2"]);
    expect(report.nextDispatch.pathConflicts).toEqual(["S-1:src/shared.ts", "S-2:src/shared.ts"]);
  });

  it("keeps wave-fanout mode when claimed paths are disjoint", async () => {
    const root = await createTempProject("wave-status-path-conflicts-disjoint");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/a.ts | true | low | production |
| S-2 | T-002 | [] | src/b.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    expect(report.nextDispatch.waveId).toBe("W-02");
    expect(report.nextDispatch.mode).toBe("wave-fanout");
    expect(report.nextDispatch.topology).toBe("parallel-builders");
    expect(report.nextDispatch.pathConflicts).toEqual([]);
  });

  it("derives ready slice ids from implementation-unit wave rows", async () => {
    const root = await createTempProject("wave-status-unit-rows");
    await seedPlan(
      root,
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|
| U-1 | [] | src/a.ts | true | low | production |
| U-2 | [] | src/b.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
    );

    const report = await runWaveStatus(root);
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-1", "S-2"]);
    expect(report.nextDispatch.topology).toBe("parallel-builders");
  });
});
