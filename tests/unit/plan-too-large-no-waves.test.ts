import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

async function seedPlanArtifact(
  root: string,
  runId: string,
  unitCount: number
): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "plan";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  const units: string[] = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      [
        `### Implementation Unit U-${i}`,
        `- **Goal:** synthetic unit ${i}`,
        `- **Files:** src/u${i}.ts`,
        `- **Approach:** trivial`,
        `- **Test scenarios:** none`,
        `- **Verification:** trivial`,
        ""
      ].join("\n")
    );
  }
  const plan = [
    "---",
    "stage: plan",
    "schema_version: v1",
    "version: 1",
    "locked_decisions: []",
    "inputs_hash: 0",
    "---",
    "",
    "# Plan Artifact",
    "",
    "## Plan Header",
    "- Goal: synthetic",
    "- Architecture: synthetic",
    "- Tech Stack: synthetic",
    "",
    "## Task List",
    "| ID | Task |",
    "| --- | --- |",
    "| T-1 | trivial |",
    "",
    "## Dependency Batches",
    "- Batch 1: T-1",
    "",
    "## Acceptance Mapping",
    "| AC ID | Task IDs |",
    "| --- | --- |",
    "| AC-1 | T-1 |",
    "",
    "## Execution Posture",
    "- Posture: sequential",
    "",
    "## Implementation Units",
    "",
    units.join("\n"),
    "",
    "## WAIT_FOR_CONFIRM",
    "- Status: pending",
    ""
  ].join("\n");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), plan, "utf8");
}

describe("plan_too_large_no_waves advisory (P4)", () => {
  it("does not fire for a small plan", async () => {
    const root = await createTempProject("p4-small");
    await seedPlanArtifact(root, "run-1", 10);
    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((f) => f.section === "plan_too_large_no_waves");
    expect(finding).toBeUndefined();
  });

  it("fires when units exceed the threshold and wave-plans is empty", async () => {
    const root = await createTempProject("p4-large");
    await seedPlanArtifact(root, "run-2", 60);
    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((f) => f.section === "plan_too_large_no_waves");
    expect(finding).toBeDefined();
    expect(finding?.required).toBe(false);
    expect(finding?.found).toBe(false);
    expect(finding?.details).toMatch(/plan-split-waves/);
  });

  it("does not fire when wave files already exist", async () => {
    const root = await createTempProject("p4-large-with-waves");
    await seedPlanArtifact(root, "run-3", 60);
    await fs.mkdir(path.join(root, ".cclaw/artifacts/wave-plans"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/wave-plans/wave-01.md"),
      "# wave 1\n",
      "utf8"
    );
    const result = await lintArtifact(root, "plan");
    const finding = result.findings.find((f) => f.section === "plan_too_large_no_waves");
    expect(finding).toBeUndefined();
  });

  it("is advisory only and does not change overall passed=true semantics", async () => {
    const root = await createTempProject("p4-advisory-only");
    await seedPlanArtifact(root, "run-4", 60);
    const result = await lintArtifact(root, "plan");
    // The advisory itself never sets passed=false because required:false +
    // found:false maps to a soft finding. We only assert it does not toggle
    // a stricter check; passed status will depend on other rules but the
    // advisory itself must not be the blocker.
    const finding = result.findings.find((f) => f.section === "plan_too_large_no_waves")!;
    expect(finding.required).toBe(false);
  });
});
