import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  archiveRun,
  CorruptFlowStateError,
  ensureRunSystem,
  listRuns,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";

describe("runs system", () => {
  it("bootstraps active artifacts root and flow state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-bootstrap-"));
    const state = await ensureRunSystem(root);

    expect(state.activeRunId).toBe("active");
    expect(state.currentStage).toBe("brainstorm");
    await expect(fs.stat(path.join(root, ".cclaw/artifacts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/runs"))).resolves.toBeTruthy();
  });

  it("archives active artifacts into dated run folder and resets flow", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-archive-"));
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), "# draft\n", "utf8");
    await writeFlowState(root, {
      ...createInitialFlowState("active"),
      currentStage: "design",
      completedStages: ["brainstorm", "scope"]
    });

    const archived = await archiveRun(root, "Payments Revamp");
    const state = await readFlowState(root);

    expect(archived.archiveId).toMatch(/^\d{4}-\d{2}-\d{2}-payments-revamp/);
    await expect(
      fs.readFile(path.join(archived.archivePath, "artifacts", "01-brainstorm.md"), "utf8")
    ).resolves.toContain("# draft");

    const activeArtifacts = await fs.readdir(path.join(root, ".cclaw/artifacts"));
    expect(activeArtifacts).toEqual([]);
    expect(state.currentStage).toBe("brainstorm");
    expect(state.completedStages).toEqual([]);
    expect(state.activeRunId).toBe("active");
  });

  it("creates unique archive ids for same-day feature names", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-archive-unique-"));
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Payments\n", "utf8");
    const first = await archiveRun(root, "Payments");

    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Payments\n", "utf8");
    const second = await archiveRun(root, "Payments");

    expect(second.archiveId).not.toBe(first.archiveId);
    expect(second.archiveId).toMatch(/-2$/);
  });

  it("lists archived run folders", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-list-"));
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Alpha\n", "utf8");
    const first = await archiveRun(root, "Alpha");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Beta\n", "utf8");
    const second = await archiveRun(root, "Beta");

    const runs = await listRuns(root);
    const ids = runs.map((run) => run.id);
    expect(ids).toContain(first.archiveId);
    expect(ids).toContain(second.archiveId);
  });

  it("sanitizes malformed flow state values", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-sanitize-"));
    await ensureRunSystem(root);
    const flowPath = path.join(root, ".cclaw/state/flow-state.json");

    await fs.writeFile(flowPath, JSON.stringify({
      activeRunId: "run-custom",
      currentStage: "not-a-stage",
      completedStages: ["brainstorm", "fake-stage", 123],
      guardEvidence: {
        ok: "yes",
        bad: 42
      },
      stageGateCatalog: {
        brainstorm: {
          required: ["tampered"],
          passed: ["brainstorm_context_explored", "tampered"],
          blocked: ["brainstorm_direction_approved", 1]
        }
      }
    }, null, 2), "utf8");

    const state = await readFlowState(root);
    expect(state.activeRunId).toBe("run-custom");
    expect(state.currentStage).toBe("brainstorm");
    expect(state.completedStages).toEqual(["brainstorm"]);
    expect(state.guardEvidence).toEqual({ ok: "yes" });
    expect(state.stageGateCatalog.brainstorm.required).toContain("brainstorm_context_explored");
    expect(state.stageGateCatalog.brainstorm.required).not.toContain("tampered");
    expect(state.stageGateCatalog.brainstorm.passed).toEqual(["brainstorm_context_explored"]);
    expect(state.stageGateCatalog.brainstorm.blocked).toEqual(["brainstorm_direction_approved"]);
  });

  it("quarantines corrupt flow-state.json and throws CorruptFlowStateError", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-corrupt-"));
    await ensureRunSystem(root);
    const flowPath = path.join(root, ".cclaw/state/flow-state.json");
    await fs.writeFile(flowPath, "this is not { json", "utf8");

    await expect(readFlowState(root)).rejects.toBeInstanceOf(CorruptFlowStateError);

    await expect(fs.stat(flowPath)).rejects.toThrow();
    const stateDirEntries = await fs.readdir(path.join(root, ".cclaw/state"));
    const quarantined = stateDirEntries.filter((name) => name.startsWith("flow-state.json.corrupt-"));
    expect(quarantined).toHaveLength(1);
    const quarantinedContents = await fs.readFile(
      path.join(root, ".cclaw/state", quarantined[0]),
      "utf8"
    );
    expect(quarantinedContents).toBe("this is not { json");
  });

  it("quarantines flow-state.json when top-level value is not an object", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-corrupt-array-"));
    await ensureRunSystem(root);
    const flowPath = path.join(root, ".cclaw/state/flow-state.json");
    await fs.writeFile(flowPath, "[1,2,3]", "utf8");

    await expect(readFlowState(root)).rejects.toBeInstanceOf(CorruptFlowStateError);
    await expect(fs.stat(flowPath)).rejects.toThrow();
  });
});
