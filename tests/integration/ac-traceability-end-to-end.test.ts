import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { appendDelegation } from "../../src/delegation.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function gitCommit(cwd: string, message: string): Promise<void> {
  await execFileAsync(
    "git",
    ["-c", "user.email=tests@example.com", "-c", "user.name=Test Runner", "commit", "-m", message],
    { cwd }
  );
}

async function setupProject(root: string): Promise<void> {
  await ensureRunSystem(root);
  const flow = createInitialFlowState({
    activeRunId: "run-ac-e2e",
    track: "standard",
    discoveryMode: "guided"
  });
  flow.currentStage = "ship";
  flow.completedStages = ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review"];
  await writeFlowState(root, flow, { allowReset: true });

  await fs.mkdir(path.join(root, ".cclaw/artifacts/tdd-slices"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/slice.ts"), "export const value = 1;\n", "utf8");

  await fs.writeFile(path.join(root, ".cclaw/artifacts/04-spec.md"), `# Spec Artifact

## Acceptance Criteria
- AC-1: traceability links AC -> task -> slice -> commit.

## Edge Cases
- None.

## Acceptance Mapping
- AC-1 is covered by T-001.

## Approval
- Approved: yes.
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), `# Plan Artifact

## Task List
- T-001: implement AC-1 evidence chain.

## Dependency Batches
- Batch 1: T-001.

## Acceptance Mapping
- T-001 -> AC-1.

## Execution Posture
- Posture: serial.

## WAIT_FOR_CONFIRM
- Decision: confirmed.
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), `# TDD Artifact

## System-Wide Impact Check
- Traceability chain touches spec, plan, tdd-slices, and ship records.

## RED Evidence
- phase=red evidence in delegation-events.

## GREEN Evidence
- phase=green evidence in delegation-events.

## REFACTOR Notes
- None.

## Traceability
- Plan task IDs: T-001
- Spec criterion IDs: AC-1

## Iron Law Acknowledgement
- Acknowledged: yes

## Verification Ladder
- command: npm test -- pass
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/tdd-slices/S-1.md"), `# Slice S-1

## Plan unit
T-001

## Acceptance criteria
AC-1

Closes: AC-1

## REFACTOR notes
- None.

## Learnings
- None this slice.
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/08-ship.md"), `# Ship Artifact

## Preflight Results
- Review verdict: APPROVED
- Build: pass
- Tests: pass
- Lint: pass
- Type-check: pass
- Working tree clean: yes

## Release Notes
- AC-1 shipped via T-001 / S-1.

## Traceability Matrix
| AC ID | Slice ID(s) | Managed commit evidence | Coverage status |
|---|---|---|---|
| AC-1 | S-1 | S-1/green | covered |

## Architect Cross-Stage Verification
- Skill: architect-cross-stage-verification
- Result: CROSS_STAGE_VERIFIED
- Evidence refs: AC chain validated across stage artifacts.
- Drift summary: none

## Rollback Plan
- Trigger conditions: smoke-test regression.
- Rollback steps: revert release commit and redeploy.
- Verification steps: run smoke checks.

## Finalization
- Selected enum: FINALIZE_KEEP_BRANCH
- Execution result: branch preserved for handoff
`, "utf8");

  const startTs = "2026-01-03T00:00:00.000Z";
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-builder",
    mode: "mandatory",
    status: "completed",
    sliceId: "S-1",
    phase: "doc",
    spanId: "span-S-1",
    claimedPaths: ["src/slice.ts"],
    evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
    ts: startTs,
    completedTs: startTs
  });
}

describe("AC traceability end-to-end", () => {
  it("links spec AC ids through plan, tdd slice cards, and ship commit coverage", async () => {
    const root = await createTempProject("ac-traceability-e2e");
    await setupProject(root);

    await git(root, ["init"]);
    await git(root, ["add", "."]);
    await gitCommit(root, "init");
    await fs.writeFile(path.join(root, "src/slice.ts"), "export const value = 2;\n", "utf8");
    await git(root, ["add", "src/slice.ts"]);
    await gitCommit(root, "S-1/green: implement AC-1");

    const spec = await lintArtifact(root, "spec");
    const plan = await lintArtifact(root, "plan");
    const tdd = await lintArtifact(root, "tdd");
    const ship = await lintArtifact(root, "ship");

    expect(spec.findings.find((f) => f.section === "spec_ac_ids_present")?.found).toBe(true);
    expect(plan.findings.find((f) => f.section === "plan_acceptance_mapped")?.found).toBe(true);
    expect(tdd.findings.find((f) => f.section === "tdd_slice_closes_ac")?.found).toBe(true);
    expect(ship.findings.find((f) => f.section === "ship_all_acceptance_criteria_have_commits")?.found).toBe(true);
  });
});
