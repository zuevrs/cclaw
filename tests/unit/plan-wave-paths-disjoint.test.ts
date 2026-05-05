import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

const PLAN_HEADER = `---
stage: plan
schema_version: v1
version: 1
locked_decisions: []
inputs_hash: 0
---

# Plan Artifact

## Plan Header
- Goal: enforce disjoint paths
- Architecture: modular
- Tech Stack: ts

## Task List
- T-001
- T-002

## Dependency Batches
- Batch 1: T-001, T-002

## Acceptance Mapping
- AC-001 -> T-001, T-002

## Execution Posture
- posture: parallel-safe

## WAIT_FOR_CONFIRM
- Status: pending
`;

async function seedPlan(root: string, runId: string, managedBlock: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "plan";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/05-plan.md"),
    `${PLAN_HEADER}\n${managedBlock}\n`,
    "utf8"
  );
}

describe("plan_wave_paths_disjoint gate", () => {
  it("fails when two slices in the same wave overlap on claimedPaths", async () => {
    const root = await createTempProject("plan-wave-paths-overlap");
    await seedPlan(
      root,
      "run-plan-overlap",
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/shared.ts, src/a.ts | true | low | production |
| S-2 | T-002 | [] | src/shared.ts, src/b.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
    );

    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((row) => row.section === "plan_wave_paths_disjoint");
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(true);
    expect(finding?.found).toBe(false);
    expect(finding?.details).toContain("S-1<->S-2");
  });

  it("passes when same-wave claimedPaths are disjoint", async () => {
    const root = await createTempProject("plan-wave-paths-disjoint");
    await seedPlan(
      root,
      "run-plan-disjoint",
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/a.ts | true | low | production |
| S-2 | T-002 | [] | src/b.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
    );

    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((row) => row.section === "plan_wave_paths_disjoint");
    expect(finding).toBeDefined();
    expect(finding?.found).toBe(true);
  });
});
