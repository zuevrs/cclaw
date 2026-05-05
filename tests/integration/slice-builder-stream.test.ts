import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_ROOT } from "../../src/constants.js";
import { runWaveStatus } from "../../src/internal/wave-status.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

const PLAN_BODY = `# Plan Artifact

## Task List
- T-001
- T-002

## Dependency Batches
- Batch 1: T-001, T-002

## Acceptance Mapping
- AC-001 -> T-001, T-002

<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/a.ts | true | low | production |
| S-2 | T-002 | [] | src/b.ts | true | low | production |
<!-- parallel-exec-managed-end -->
`;

async function seedTddPlan(root: string): Promise<{ runId: string; artifactsDir: string }> {
  await ensureRunSystem(root);
  const flow = await readFlowState(root);
  await writeFlowState(
    root,
    {
      ...flow,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    },
    { allowReset: true }
  );
  const latest = await readFlowState(root);
  const artifactsDir = path.join(root, RUNTIME_ROOT, "artifacts");
  await fs.mkdir(artifactsDir, { recursive: true });
  await fs.writeFile(path.join(artifactsDir, "05-plan.md"), PLAN_BODY, "utf8");
  return { runId: latest.activeRunId, artifactsDir };
}

describe("slice-builder streaming integration", () => {
  it("uses live stream events to compute next dispatch", async () => {
    const root = await createTempProject("slice-builder-stream-live");
    const { runId } = await seedTddPlan(root);
    const streamPath = path.join(root, RUNTIME_ROOT, "state", "slice-builder-stream.jsonl");
    await fs.mkdir(path.dirname(streamPath), { recursive: true });
    await fs.writeFile(
      streamPath,
      `${JSON.stringify({
        event: "phase-completed",
        runId,
        stage: "tdd",
        sliceId: "S-1",
        phase: "refactor"
      })}\n`,
      "utf8"
    );

    const report = await runWaveStatus(root, { streamMode: "live" });
    expect(report.waves[0]?.closedMembers).toEqual(["S-1"]);
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-2"]);
  });

  it("falls back to delegation-events when stream is empty", async () => {
    const root = await createTempProject("slice-builder-stream-fallback");
    const { runId } = await seedTddPlan(root);
    const stateDir = path.join(root, RUNTIME_ROOT, "state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(path.join(stateDir, "slice-builder-stream.jsonl"), "", "utf8");
    await fs.writeFile(
      path.join(stateDir, "delegation-events.jsonl"),
      `${JSON.stringify({
        event: "completed",
        status: "completed",
        runId,
        stage: "tdd",
        agent: "slice-builder",
        mode: "mandatory",
        ts: new Date().toISOString(),
        eventTs: new Date().toISOString(),
        sliceId: "S-1",
        phase: "refactor-deferred"
      })}\n`,
      "utf8"
    );

    const report = await runWaveStatus(root, { streamMode: "live" });
    expect(report.warnings.join("\n")).toContain("wave_status_live_fallback_to_file");
    expect(report.waves[0]?.closedMembers).toEqual(["S-1"]);
    expect(report.nextDispatch.readyToDispatch).toEqual(["S-2"]);
  });
});
