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

async function seedFlow(root: string): Promise<void> {
  await ensureRunSystem(root);
  const flow = createInitialFlowState({
    activeRunId: "run-orphan-changes",
    track: "standard",
    discoveryMode: "guided"
  });
  flow.currentStage = "tdd";
  flow.completedStages = ["brainstorm", "scope", "design", "spec", "plan"];
  await writeFlowState(root, flow, { allowReset: true });
}

async function writeArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts/tdd-slices"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/slice.ts"), "export const claimed = 1;\n", "utf8");
  await fs.writeFile(path.join(root, "src/orphan.ts"), "export const orphan = 1;\n", "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/04-spec.md"), `# Spec Artifact

## Acceptance Criteria
- AC-1: claimed-path drift is blocked.
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), `# Plan Artifact

## Task List
- T-1: implement claimed path edits only (AC-1).

## Dependency Batches
- Batch 1: T-1.

## Acceptance Mapping
- T-1 -> AC-1.

## Execution Posture
- Posture: serial.

## WAIT_FOR_CONFIRM
- Decision: confirmed.
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), `# TDD Artifact

## System-Wide Impact Check
- Claimed path confinement around src/slice.ts.

## RED Evidence
- red evidence exists in delegation-events.

## GREEN Evidence
- green evidence exists in delegation-events.

## REFACTOR Notes
- None.

## Traceability
- Plan task IDs: T-1
- Spec criterion IDs: AC-1

## Iron Law Acknowledgement
- Acknowledged: yes

## Verification Ladder
- command: npm test -- pass
`, "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/tdd-slices/S-1.md"), `# Slice S-1

## Plan unit
T-1

## Acceptance criteria
AC-1

Closes: AC-1

## REFACTOR notes
- None.

## Learnings
- None this slice.
`, "utf8");
}

async function seedDocEvents(root: string): Promise<void> {
  const redTs = "2026-01-02T00:00:00.000Z";
  const greenTs = "2026-01-02T00:05:00.000Z";
  const refactorTs = "2026-01-02T00:08:00.000Z";
  const docTs = "2026-01-02T00:10:00.000Z";
  const spanId = "span-S-1";
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-builder",
    mode: "mandatory",
    status: "completed",
    sliceId: "S-1",
    phase: "red",
    spanId,
    evidenceRefs: ["tests/unit/slice.test.ts"],
    ts: redTs,
    completedTs: redTs
  });
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-builder",
    mode: "proactive",
    status: "completed",
    sliceId: "S-1",
    phase: "green",
    spanId,
    evidenceRefs: ["tests/unit/slice.test.ts"],
    ts: greenTs,
    completedTs: greenTs
  });
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-builder",
    mode: "proactive",
    status: "completed",
    sliceId: "S-1",
    phase: "refactor",
    spanId,
    evidenceRefs: ["src/slice.ts"],
    ts: refactorTs,
    completedTs: refactorTs
  });
  await appendDelegation(root, {
    stage: "tdd",
    agent: "slice-builder",
    mode: "proactive",
    status: "completed",
    sliceId: "S-1",
    phase: "doc",
    spanId,
    claimedPaths: ["src/slice.ts"],
    evidenceRefs: [".cclaw/artifacts/tdd-slices/S-1.md"],
    ts: docTs,
    completedTs: docTs
  });
}

describe("slice_no_orphan_changes", () => {
  it("passes when modified paths stay inside claimedPaths", async () => {
    const root = await createTempProject("slice-no-orphan-pass");
    await seedFlow(root);
    await writeArtifacts(root);
    await seedDocEvents(root);

    await git(root, ["init"]);
    await git(root, ["add", "."]);
    await gitCommit(root, "init");
    await fs.writeFile(path.join(root, "src/slice.ts"), "export const claimed = 2;\n", "utf8");

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find((entry) => entry.section === "slice_no_orphan_changes");
    expect(finding?.found).toBe(true);
  });

  it("fails when unstaged paths escape claimedPaths", async () => {
    const root = await createTempProject("slice-no-orphan-fail");
    await seedFlow(root);
    await writeArtifacts(root);
    await seedDocEvents(root);

    await git(root, ["init"]);
    await git(root, ["add", "."]);
    await gitCommit(root, "init");
    await fs.writeFile(path.join(root, "src/orphan.ts"), "export const orphan = 2;\n", "utf8");

    const result = await lintArtifact(root, "tdd");
    const finding = result.findings.find((entry) => entry.section === "slice_no_orphan_changes");
    expect(finding?.found).toBe(false);
    expect(finding?.details ?? "").toContain("src/orphan.ts");
  });
});
