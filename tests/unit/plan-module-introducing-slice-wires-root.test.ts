import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { lintArtifact } from "../../src/artifact-linter.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initGitRepo(root: string): Promise<void> {
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "tests@example.com"]);
  await git(root, ["config", "user.name", "Test Runner"]);
}

async function commitAll(root: string, msg: string): Promise<void> {
  await git(root, ["add", "."]);
  await git(root, ["commit", "-m", msg]);
}

async function touch(root: string, rel: string, body = ""): Promise<void> {
  const target = path.join(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, body, "utf8");
}

const PLAN_HEADER = `---
stage: plan
schema_version: v1
version: 1
locked_decisions: []
inputs_hash: 0
---

# Plan Artifact

## Plan Header
- Goal: ensure modules wire to root
- Architecture: layered
- Tech Stack: stack-aware

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

describe("plan_module_introducing_slice_wires_root (7.6.0 — Defect 4)", () => {
  describe("rust", () => {
    it("complains when a slice claims `src/foo.rs` but not `src/lib.rs`", async () => {
      const root = await createTempProject("wiring-rust-missing");
      await initGitRepo(root);
      await touch(root, "Cargo.toml", "[package]\nname = \"x\"\n");
      await touch(root, "src/lib.rs", "// existing crate root\n");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-rust-1",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/foo.rs | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding).toBeDefined();
      expect(finding?.required).toBe(true);
      expect(finding?.found).toBe(false);
      expect(finding?.details).toContain("S-1");
      expect(finding?.details).toContain("src/foo.rs");
      expect(finding?.details).toContain("src/lib.rs");
    });

    it("passes when the slice claims both `src/foo.rs` and `src/lib.rs`", async () => {
      const root = await createTempProject("wiring-rust-claim-lib");
      await initGitRepo(root);
      await touch(root, "Cargo.toml", "[package]\nname = \"x\"\n");
      await touch(root, "src/lib.rs", "// existing crate root\n");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-rust-2",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/foo.rs, src/lib.rs | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(true);
    });

    it("passes when the slice claims `src/foo.rs` and a predecessor wave-row claims `src/lib.rs`", async () => {
      const root = await createTempProject("wiring-rust-predecessor");
      await initGitRepo(root);
      await touch(root, "Cargo.toml", "[package]\nname = \"x\"\n");
      await touch(root, "src/lib.rs", "// existing crate root\n");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-rust-3",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-0 | T-000 | [] | src/lib.rs | true | low | production |
| S-1 | T-001 | [S-0] | src/foo.rs | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(true);
    });
  });

  describe("python", () => {
    it("requires `pkg/__init__.py` when the parent has one at HEAD", async () => {
      const root = await createTempProject("wiring-python-init-required");
      await initGitRepo(root);
      await touch(root, "pyproject.toml", "[project]\nname = \"x\"\n");
      await touch(root, "pkg/__init__.py", "");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-python-1",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | pkg/foo.py | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(false);
      expect(finding?.details).toContain("pkg/__init__.py");
    });

    it("is a no-op (PEP 420 namespace package) when the parent has no __init__.py at HEAD", async () => {
      const root = await createTempProject("wiring-python-namespace");
      await initGitRepo(root);
      await touch(root, "pyproject.toml", "[project]\nname = \"x\"\n");
      // Ensure the parent dir gets tracked at HEAD via a sentinel file
      // that isn't __init__.py — simulating a PEP 420 namespace package
      // layout.
      await touch(root, "pkg/.keep", "");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-python-2",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | pkg/foo.py | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(true);
    });
  });

  describe("node-ts", () => {
    it("requires the barrel `src/utils/index.ts` when one exists at HEAD", async () => {
      const root = await createTempProject("wiring-node-barrel-required");
      await initGitRepo(root);
      await touch(root, "package.json", "{\"name\":\"x\"}\n");
      await touch(root, "src/utils/index.ts", "export {};\n");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-node-1",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/utils/foo.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(false);
      expect(finding?.details).toContain("src/utils/index.ts");
    });

    it("is a no-op when the parent dir has no index.* at HEAD", async () => {
      const root = await createTempProject("wiring-node-no-barrel");
      await initGitRepo(root);
      await touch(root, "package.json", "{\"name\":\"x\"}\n");
      await touch(root, "src/utils/.keep", "");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-node-2",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | src/utils/foo.ts | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(true);
    });
  });

  describe("go", () => {
    it("does not fire (no wiring aggregator for Go)", async () => {
      const root = await createTempProject("wiring-go-noop");
      await initGitRepo(root);
      await touch(root, "go.mod", "module example.com/x\n");
      await commitAll(root, "init");
      await seedPlan(
        root,
        "run-wiring-go-1",
        `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-02
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-1 | T-001 | [] | pkg/foo.go | true | low | production |
<!-- parallel-exec-managed-end -->`
      );
      const result = await lintArtifact(root, "plan");
      const finding = result.findings.find((row) =>
        row.section === "plan_module_introducing_slice_wires_root"
      );
      expect(finding?.found).toBe(true);
      // For unknown-aggregator stacks the gate is advisory (not required).
      expect(finding?.required).toBe(false);
    });
  });
});
