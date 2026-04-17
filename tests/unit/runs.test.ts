import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  acknowledgeStaleStage,
  archiveRun,
  CorruptFlowStateError,
  ensureRunSystem,
  InvalidStageTransitionError,
  listRuns,
  readFlowState,
  rewindRun,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

describe("runs system", () => {
  it("bootstraps active artifacts root and flow state", async () => {
    const root = await createTempProject("runs-bootstrap");
    const state = await ensureRunSystem(root);

    expect(state.activeRunId).toBe("active");
    expect(state.currentStage).toBe("brainstorm");
    await expect(fs.stat(path.join(root, ".cclaw/artifacts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/features/default"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/state/active-feature.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/runs"))).resolves.toBeTruthy();
  });

  it("archives active artifacts into dated run folder and resets flow", async () => {
    const root = await createTempProject("runs-archive");
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), "# draft\n", "utf8");
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "design",
        completedStages: ["brainstorm", "scope"]
      },
      { allowReset: true }
    );

    const archived = await archiveRun(root, "Payments Revamp");
    const state = await readFlowState(root);

    expect(archived.archiveId).toMatch(/^\d{4}-\d{2}-\d{2}-payments-revamp/);
    expect(archived.activeFeature).toBe("default");
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
    const root = await createTempProject("runs-archive-unique");
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Payments\n", "utf8");
    const first = await archiveRun(root, "Payments");

    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Payments\n", "utf8");
    const second = await archiveRun(root, "Payments");

    expect(second.archiveId).not.toBe(first.archiveId);
    expect(second.archiveId).toMatch(/-2$/);
  });

  it("blocks archive when ship is complete but retro gate is not satisfied", async () => {
    const root = await createTempProject("runs-retro-block");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"]
      },
      { allowReset: true }
    );

    await expect(archiveRun(root, "Retro Blocked")).rejects.toThrow(/retro gate/i);
  });

  it("allows archive after retro artifact + compound knowledge are present", async () => {
    const root = await createTempProject("runs-retro-ok");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"]
      },
      { allowReset: true }
    );
    await fs.writeFile(path.join(root, ".cclaw/artifacts/09-retro.md"), "# retro\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      `${JSON.stringify({
        type: "compound",
        trigger: "when shipping a high-risk change",
        action: "run focused rollback drill before merge",
        confidence: "high",
        domain: "ship",
        stage: "retro",
        created: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })}\n`,
      "utf8"
    );

    const archived = await archiveRun(root, "Retro Ready");
    expect(archived.retro.required).toBe(true);
    expect(archived.retro.completed).toBe(true);
    expect(archived.retro.compoundEntries).toBeGreaterThanOrEqual(1);
  });

  it("lists archived run folders", async () => {
    const root = await createTempProject("runs-list");
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
    const root = await createTempProject("runs-sanitize");
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
    expect(state.stageGateCatalog.brainstorm.required).toContain("brainstorm_approaches_compared");
    expect(state.stageGateCatalog.brainstorm.required).not.toContain("tampered");
    expect(state.stageGateCatalog.brainstorm.passed).toEqual(["brainstorm_context_explored"]);
    expect(state.stageGateCatalog.brainstorm.blocked).toEqual(["brainstorm_direction_approved"]);
  });

  it("quarantines corrupt flow-state.json and throws CorruptFlowStateError", async () => {
    const root = await createTempProject("runs-corrupt");
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

  it("archive snapshots state/ (flow-state, delegation-log) and writes a manifest", async () => {
    const root = await createTempProject("runs-archive-state");
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Search Revamp\n", "utf8");
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "plan",
        completedStages: ["brainstorm", "scope", "design", "spec"]
      },
      { allowReset: true }
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      JSON.stringify({
        runId: "active",
        entries: [
          {
            stage: "scope",
            agent: "planner",
            mode: "mandatory",
            status: "completed",
            ts: "2026-04-16T00:00:00.000Z"
          }
        ]
      }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/stage-activity.jsonl"),
      `${JSON.stringify({ stage: "scope", ts: "2026-04-16T00:00:01.000Z", event: "enter" })}\n`,
      "utf8"
    );
    const archived = await archiveRun(root, "Search Revamp");

    expect(archived.snapshottedStateFiles).toContain("flow-state.json");
    expect(archived.snapshottedStateFiles).toContain("delegation-log.json");
    expect(archived.snapshottedStateFiles).toContain("stage-activity.jsonl");
    for (const name of archived.snapshottedStateFiles) {
      expect(name.startsWith(".flow-state.lock")).toBe(false);
      expect(name.startsWith(".delegation.lock")).toBe(false);
    }

    const snapshotDir = path.join(archived.archivePath, "state");
    const flowSnap = JSON.parse(await fs.readFile(path.join(snapshotDir, "flow-state.json"), "utf8"));
    expect(flowSnap.currentStage).toBe("plan");
    expect(flowSnap.completedStages).toEqual(["brainstorm", "scope", "design", "spec"]);

    const delegationSnap = JSON.parse(
      await fs.readFile(path.join(snapshotDir, "delegation-log.json"), "utf8")
    );
    expect(delegationSnap.entries[0].agent).toBe("planner");

    const manifestPath = path.join(archived.archivePath, "archive-manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.version).toBe(1);
    expect(manifest.archiveId).toBe(archived.archiveId);
    expect(manifest.featureName).toBe("Search Revamp");
    expect(manifest.activeFeature).toBe("default");
    expect(manifest.sourceCurrentStage).toBe("plan");
    expect(manifest.sourceCompletedStages).toEqual([
      "brainstorm",
      "scope",
      "design",
      "spec"
    ]);

    const resetState = await readFlowState(root);
    expect(resetState.currentStage).toBe("brainstorm");
    expect(resetState.completedStages).toEqual([]);
  });

  it("quarantines flow-state.json when top-level value is not an object", async () => {
    const root = await createTempProject("runs-corrupt-array");
    await ensureRunSystem(root);
    const flowPath = path.join(root, ".cclaw/state/flow-state.json");
    await fs.writeFile(flowPath, "[1,2,3]", "utf8");

    await expect(readFlowState(root)).rejects.toBeInstanceOf(CorruptFlowStateError);
    await expect(fs.stat(flowPath)).rejects.toThrow();
  });

  it("rejects illegal stage transitions in writeFlowState", async () => {
    const root = await createTempProject("runs-transition-illegal");
    await ensureRunSystem(root);

    await expect(
      writeFlowState(root, {
        ...createInitialFlowState("active"),
        currentStage: "design"
      })
    ).rejects.toBeInstanceOf(InvalidStageTransitionError);
  });

  it("rejects non-monotonic completedStages in writeFlowState", async () => {
    const root = await createTempProject("runs-transition-monotonic");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "scope",
        completedStages: ["brainstorm"]
      },
      { allowReset: true }
    );

    await expect(
      writeFlowState(root, {
        ...createInitialFlowState("active"),
        currentStage: "scope",
        completedStages: []
      })
    ).rejects.toBeInstanceOf(InvalidStageTransitionError);
  });

  it("accepts a legal forward transition via writeFlowState", async () => {
    const root = await createTempProject("runs-transition-ok");
    await ensureRunSystem(root);

    await writeFlowState(root, {
      ...createInitialFlowState("active"),
      currentStage: "scope",
      completedStages: ["brainstorm"]
    });

    const stored = await readFlowState(root);
    expect(stored.currentStage).toBe("scope");
    expect(stored.completedStages).toEqual(["brainstorm"]);
  });

  it("rewind invalidates downstream stages and archives stale artifacts", async () => {
    const root = await createTempProject("runs-rewind");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "review",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
      },
      { allowReset: true }
    );
    await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), "# plan\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/06-tdd.md"), "# tdd\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/artifacts/07-review.md"), "# review\n", "utf8");

    const rewound = await rewindRun(root, { to: "spec", reason: "requirements shift" });
    const state = await readFlowState(root);

    expect(rewound.from).toBe("review");
    expect(rewound.to).toBe("spec");
    expect(rewound.invalidatedStages).toEqual(["plan", "tdd", "review"]);
    expect(state.currentStage).toBe("spec");
    expect(state.completedStages).toEqual(["brainstorm", "scope", "design"]);
    expect(Object.keys(state.staleStages).sort()).toEqual(["plan", "review", "tdd"]);
    await expect(fs.stat(path.join(root, ".cclaw/artifacts/05-plan.stale.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/artifacts/06-tdd.stale.md"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/artifacts/07-review.stale.md"))).resolves.toBeTruthy();
    await expect(
      fs.readFile(path.join(rewound.archivePath, "05-plan.md"), "utf8")
    ).resolves.toContain("# plan");
    const rewindLog = await fs.readFile(path.join(root, ".cclaw/state/rewind-log.jsonl"), "utf8");
    expect(rewindLog).toContain("\"toStage\":\"spec\"");
  });

  it("acknowledgeStaleStage clears exactly one stale marker", async () => {
    const root = await createTempProject("runs-rewind-ack");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "tdd",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan"],
        staleStages: {
          tdd: {
            rewindId: "rewind-1",
            reason: "test",
            markedAt: "2026-01-01T00:00:00.000Z"
          },
          review: {
            rewindId: "rewind-1",
            reason: "test",
            markedAt: "2026-01-01T00:00:00.000Z"
          }
        }
      },
      { allowReset: true }
    );

    const result = await acknowledgeStaleStage(root, "tdd");
    const state = await readFlowState(root);
    expect(result.acknowledged).toBe(true);
    expect(result.remaining).toEqual(["review"]);
    expect(state.staleStages.tdd).toBeUndefined();
    expect(state.staleStages.review).toBeDefined();
  });
});
