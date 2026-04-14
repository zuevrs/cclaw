import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  archiveRun,
  ensureRunSystem,
  listRuns,
  readFlowState,
  resumeRun,
  startNewFeatureRun,
  writeFlowState
} from "../../src/runs.js";

describe("runs system", () => {
  it("bootstraps active run and flow state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-bootstrap-"));
    const state = await ensureRunSystem(root);

    expect(state.activeRunId).toMatch(/^run-/);
    expect(state.currentStage).toBe("brainstorm");

    const runMetaPath = path.join(root, ".cclaw/runs", state.activeRunId, "run.json");
    const handoffPath = path.join(root, ".cclaw/runs", state.activeRunId, "handoff.md");
    await expect(fs.readFile(runMetaPath, "utf8")).resolves.toContain(`"id": "${state.activeRunId}"`);
    await expect(fs.readFile(handoffPath, "utf8")).resolves.toContain(`ID: ${state.activeRunId}`);
  });

  it("creates a new feature run and resets active flow state", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-new-"));
    const initial = await ensureRunSystem(root);

    await writeFlowState(root, {
      ...createInitialFlowState(initial.activeRunId),
      activeRunId: initial.activeRunId,
      currentStage: "design",
      completedStages: ["brainstorm", "scope"]
    });

    const next = await startNewFeatureRun(root, "Payments revamp");
    const flow = await readFlowState(root);

    expect(next.title).toBe("Payments revamp");
    expect(flow.activeRunId).toBe(next.id);
    expect(flow.currentStage).toBe("brainstorm");
    expect(flow.completedStages).toEqual([]);
  });

  it("resumes a run and restores state snapshot", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-resume-"));
    const initial = await ensureRunSystem(root);

    await writeFlowState(root, {
      ...createInitialFlowState(initial.activeRunId),
      activeRunId: initial.activeRunId,
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    });

    await startNewFeatureRun(root, "Second feature");
    await resumeRun(root, initial.activeRunId);
    const restored = await readFlowState(root);

    expect(restored.activeRunId).toBe(initial.activeRunId);
    expect(restored.currentStage).toBe("tdd");
    expect(restored.completedStages).toContain("plan");
  });

  it("resets to clean flow state when run snapshot is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-resume-nosnapshot-"));
    const initial = await ensureRunSystem(root);
    await startNewFeatureRun(root, "Other run");

    const runMetaPath = path.join(root, ".cclaw/runs", initial.activeRunId, "run.json");
    const runMeta = JSON.parse(await fs.readFile(runMetaPath, "utf8")) as {
      id: string;
      title: string;
      createdAt: string;
      archivedAt?: string;
      stateSnapshot?: unknown;
    };
    delete runMeta.stateSnapshot;
    await fs.writeFile(runMetaPath, `${JSON.stringify(runMeta, null, 2)}\n`, "utf8");

    await resumeRun(root, initial.activeRunId);
    const restored = await readFlowState(root);
    expect(restored.activeRunId).toBe(initial.activeRunId);
    expect(restored.currentStage).toBe("brainstorm");
    expect(restored.completedStages).toEqual([]);
  });

  it("archives active run and rolls forward to a new active run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-archive-"));
    const initial = await ensureRunSystem(root);
    const result = await archiveRun(root);
    const state = await readFlowState(root);
    const runs = await listRuns(root);

    expect(result.archived.id).toBe(initial.activeRunId);
    expect(result.archived.archivedAt).toBeTruthy();
    expect(result.active.id).not.toBe(initial.activeRunId);
    expect(state.activeRunId).toBe(result.active.id);
    expect(runs.length).toBeGreaterThanOrEqual(2);
  });

  it("archives non-active run without switching active run", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-archive-non-active-"));
    const first = await ensureRunSystem(root);
    const second = await startNewFeatureRun(root, "Second run");

    const result = await archiveRun(root, first.activeRunId);
    const state = await readFlowState(root);

    expect(result.archived.id).toBe(first.activeRunId);
    expect(result.archived.archivedAt).toBeTruthy();
    expect(result.active.id).toBe(second.id);
    expect(state.activeRunId).toBe(second.id);
  });

  it("rejects unsafe run ids", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-runs-safe-id-"));
    await ensureRunSystem(root);
    await expect(resumeRun(root, "../escape")).rejects.toThrow(/Invalid run id/);
    await expect(archiveRun(root, "../escape")).rejects.toThrow(/Invalid run id/);
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
          blocked: ["brainstorm_design_approved", 1]
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
    expect(state.stageGateCatalog.brainstorm.blocked).toEqual(["brainstorm_design_approved"]);
  });
});
