import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

const PLAN_BASE = `---
stage: plan
schema_version: 1
version: 1
run: run-adaptive-plan
locked_decisions: []
inputs_hash: sha256:pending
---

# Plan Artifact

## Plan Header
- Goal: deliver an adaptive feature slice
- Architecture: existing module plus focused tests
- Tech Stack: TypeScript, vitest

## Task List
- T-001 [~3m] write failing unit coverage for AC-1
- T-002 [~3m] implement the passing behavior for AC-1
- T-003 [~3m] refactor and verify AC-1

## Dependency Batches
- Batch 1: U-1

## Acceptance Mapping
- AC-1 -> T-001, T-002, T-003

## Execution Posture
- Posture: single-builder feature-atomic slice; internal 2-5 minute TDD steps.

## WAIT_FOR_CONFIRM
- Status: pending
`;

const IMPLEMENTATION_UNIT = `## Implementation Units
### Implementation Unit U-1
- **id:** U-1
- **dependsOn:** none
- **claimedPaths:** src/feature.ts, tests/feature.test.ts
- **parallelizable:** false
- **riskTier:** standard
- **Goal:** deliver AC-1 end to end
- **Files:** src/feature.ts, tests/feature.test.ts
- **Approach:** follow existing module boundaries.
- **Test scenarios:** happy, edge, regression
- **Verification:** vitest passes for feature behavior.
- **Steps (each 2-5 min):**
  - [ ] T-001 RED: write failing test
  - [ ] T-002 GREEN: minimal implementation
  - [ ] T-003 REFACTOR: cleanup and rerun suite
`;

async function seedPlan(root: string, plan: string, configBody?: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState("run-adaptive-plan");
  state.currentStage = "plan";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), plan, "utf8");
  if (configBody) {
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), configBody, "utf8");
  }
}

describe("adaptive execution plan linting", () => {
  it("accepts a feature-atomic implementation unit with internal 2-5 minute steps", async () => {
    const root = await createTempProject("adaptive-plan-unit-coverage");
    await seedPlan(
      root,
      `${PLAN_BASE}
${IMPLEMENTATION_UNIT}

<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01
Mode: sequential
| unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|
| U-1 | [] | src/feature.ts, tests/feature.test.ts | false | standard | production |
<!-- parallel-exec-managed-end -->
`
    );

    const result = await lintArtifact(root, "plan");
    const coverage = result.findings.find((row) => row.section === "plan_parallel_exec_full_coverage");
    const microtask = result.findings.find((row) => row.section === "plan_microtask_only_advisory");

    expect(coverage?.found).toBe(true);
    expect(coverage?.details).toContain("covers all 1 implementation unit");
    expect(microtask?.found).toBe(true);
  });

  it("warns on microtask-only plans in balanced mode", async () => {
    const root = await createTempProject("adaptive-plan-micro-balanced");
    await seedPlan(
      root,
      `${PLAN_BASE}
<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave W-01
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | tests/feature.test.ts | false | standard | test |
| S-2 | T-002 | [S-1] | src/feature.ts | false | standard | production |
| S-3 | T-003 | [S-2] | src/feature.ts, tests/feature.test.ts | false | standard | production |
<!-- parallel-exec-managed-end -->
`,
      "harnesses:\n  - claude\nexecution:\n  strictness: balanced\nplan:\n  microTaskPolicy: advisory\n"
    );

    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((row) => row.section === "plan_microtask_only_advisory");
    expect(finding?.required).toBe(false);
    expect(finding?.found).toBe(false);
  });

  it("allows microtask-only plans in strict mode", async () => {
    const root = await createTempProject("adaptive-plan-micro-strict");
    await seedPlan(
      root,
      `${PLAN_BASE}
<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave W-01
Mode: sequential
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | tests/feature.test.ts | false | standard | test |
| S-2 | T-002 | [S-1] | src/feature.ts | false | standard | production |
| S-3 | T-003 | [S-2] | src/feature.ts, tests/feature.test.ts | false | standard | production |
<!-- parallel-exec-managed-end -->
`,
      "harnesses:\n  - claude\nexecution:\n  strictness: strict\nplan:\n  microTaskPolicy: strict\n"
    );

    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((row) => row.section === "plan_microtask_only_advisory");
    expect(finding?.found).toBe(true);
    expect(finding?.details).toContain("Strict micro-slice posture");
  });
});
