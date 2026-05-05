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
- Goal: validate lane semantics
- Architecture: modular
- Tech Stack: ts

## Task List
- T-001

## Dependency Batches
- Batch 1: T-001

## Acceptance Mapping
- AC-001 -> T-001

## Execution Posture
- posture: adaptive

## WAIT_FOR_CONFIRM
- Status: pending
`;

async function seedPlan(root: string, runId: string, body: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "plan";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), `${PLAN_HEADER}\n${body}\n`, "utf8");
}

describe("plan lane + parallelizable consistency lint", () => {
  it("flags non-whitelisted lane values", async () => {
    const root = await createTempProject("plan-lane-invalid");
    await seedPlan(
      root,
      "run-plan-lane-invalid",
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/a.ts | true | low | sidecar-manifest |
<!-- parallel-exec-managed-end -->`
    );

    const result = await lintArtifact(root, "plan");
    const laneFinding = result.findings.find((row) => row.section === "plan_lane_meaningful");
    expect(laneFinding).toBeDefined();
    expect(laneFinding?.required).toBe(false);
    expect(laneFinding?.found).toBe(false);
    expect(laneFinding?.details).toContain("sidecar-manifest");
  });

  it("flags serial slices when wave lacks sequential mode hints", async () => {
    const root = await createTempProject("plan-parallelizable-inconsistent");
    await seedPlan(
      root,
      "run-plan-serial-inconsistent",
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/a.ts | false | low | production |
<!-- parallel-exec-managed-end -->`
    );

    const result = await lintArtifact(root, "plan");
    const consistency = result.findings.find((row) => row.section === "plan_parallelizable_consistency");
    expect(consistency).toBeDefined();
    expect(consistency?.required).toBe(false);
    expect(consistency?.found).toBe(false);
    expect(consistency?.details).toContain("W-02");
  });

  it("accepts sequential hints and records mermaid visualization when present", async () => {
    const root = await createTempProject("plan-serial-consistent-mermaid");
    await seedPlan(
      root,
      "run-plan-serial-consistent",
      `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
- Mode: sequential
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/a.ts | false | low | production |
<!-- parallel-exec-managed-end -->

\`\`\`mermaid
flowchart TD
  W02[W-02] --> S1[S-1]
\`\`\``
    );

    const result = await lintArtifact(root, "plan");
    const consistency = result.findings.find((row) => row.section === "plan_parallelizable_consistency");
    const lane = result.findings.find((row) => row.section === "plan_lane_meaningful");
    const mermaid = result.findings.find((row) => row.section === "plan_parallel_exec_mermaid_present");
    expect(consistency?.found).toBe(true);
    expect(lane?.found).toBe(true);
    expect(mermaid?.required).toBe(false);
    expect(mermaid?.found).toBe(true);
  });
});
