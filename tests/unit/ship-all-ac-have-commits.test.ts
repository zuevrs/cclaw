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
    activeRunId: "run-ship-ac-commits",
    track: "standard",
    discoveryMode: "guided"
  });
  flow.currentStage = "ship";
  flow.completedStages = ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review"];
  await writeFlowState(root, flow, { allowReset: true });
}

async function writeArtifacts(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts/tdd-slices"), { recursive: true });
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "src/slice.ts"), "export const sliceValue = 1;\n", "utf8");
  await fs.writeFile(path.join(root, ".cclaw/artifacts/04-spec.md"), `# Spec Artifact

## Acceptance Criteria
- AC-1: slice commit coverage is present for ship.

## Edge Cases
- None.

## Acceptance Mapping
- AC-1 is implemented by S-1.

## Approval
- Approved: yes.
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
  await fs.writeFile(path.join(root, ".cclaw/artifacts/08-ship.md"), `# Ship Artifact

## Preflight Results
- Review verdict: APPROVED
- Build: pass
- Tests: pass
- Lint: pass
- Type-check: pass
- Working tree clean: yes

## Release Notes
- AC-1 shipped via slice S-1.

## Traceability Matrix
| AC ID | Slice ID(s) | Managed commit evidence | Coverage status |
|---|---|---|---|
| AC-1 | S-1 | S-1/green | covered |

## Architect Cross-Stage Verification
- Skill: architect-cross-stage-verification
- Result: CROSS_STAGE_VERIFIED
- Evidence refs: AC map is coherent across spec/tdd/ship.
- Drift summary: none

## Rollback Plan
- Trigger conditions: elevated error rates.
- Rollback steps: revert release commit and redeploy.
- Verification steps: run smoke checks.

## Finalization
- Selected enum: FINALIZE_KEEP_BRANCH
- Execution result: staged for release handoff
`, "utf8");
}

async function seedRunEvidence(root: string): Promise<void> {
  const docTs = "2026-01-01T00:00:00.000Z";
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
    ts: docTs,
    completedTs: docTs
  });
}

describe("ship_all_acceptance_criteria_have_commits", () => {
  it("passes when each AC has slice mapping and managed commit", async () => {
    const root = await createTempProject("ship-ac-commit-pass");
    await seedFlow(root);
    await writeArtifacts(root);
    await seedRunEvidence(root);

    await git(root, ["init"]);
    await git(root, ["add", "."]);
    await gitCommit(root, "init");
    await fs.writeFile(path.join(root, "src/slice.ts"), "export const sliceValue = 2;\n", "utf8");
    await git(root, ["add", "src/slice.ts"]);
    await gitCommit(root, "S-1/green: close AC-1");

    const result = await lintArtifact(root, "ship");
    const gate = result.findings.find((finding) => finding.section === "ship_all_acceptance_criteria_have_commits");
    expect(gate?.found).toBe(true);
    expect(result.findings.some((finding) => finding.section === "acceptance_criterion_AC-1_uncovered")).toBe(false);
  });

  it("fails when AC is mapped to slice but managed commit is missing", async () => {
    const root = await createTempProject("ship-ac-commit-fail");
    await seedFlow(root);
    await writeArtifacts(root);
    await seedRunEvidence(root);

    await git(root, ["init"]);
    await git(root, ["add", "."]);
    await gitCommit(root, "init");

    const result = await lintArtifact(root, "ship");
    const gate = result.findings.find((finding) => finding.section === "ship_all_acceptance_criteria_have_commits");
    const perAc = result.findings.find((finding) => finding.section === "acceptance_criterion_AC-1_uncovered");
    expect(gate?.found).toBe(false);
    expect(perAc?.found).toBe(false);
  });
});
