import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  archiveRun,
  CorruptFlowStateError,
  ensureRunSystem,
  InvalidStageTransitionError,
  listRuns,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";
import { doctorChecks } from "../../src/doctor.js";
import { evaluateRetroGate } from "../../src/retro-gate.js";
import { createTempProject } from "../helpers/index.js";

describe("runs system", () => {
  it("bootstraps active artifacts root and flow state", async () => {
    const root = await createTempProject("runs-bootstrap");
    const state = await ensureRunSystem(root);

    expect(state.activeRunId).toMatch(/^run-/);
    expect(state.currentStage).toBe("brainstorm");
    await expect(fs.stat(path.join(root, ".cclaw/artifacts"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".cclaw/worktrees"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/active-feature.json"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/worktrees.json"))).rejects.toBeDefined();
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
    expect(archived.runName).toBe("Payments Revamp");
    await expect(
      fs.readFile(path.join(archived.archivePath, "artifacts", "01-brainstorm.md"), "utf8")
    ).resolves.toContain("# draft");

    const activeArtifacts = await fs.readdir(path.join(root, ".cclaw/artifacts"));
    expect(activeArtifacts).toEqual([]);
    expect(state.currentStage).toBe("brainstorm");
    expect(state.completedStages).toEqual([]);
    expect(state.activeRunId).toMatch(/^run-/);
  });

  it("removes the .archive-in-progress sentinel on success", async () => {
    const root = await createTempProject("runs-archive-sentinel-clean");
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/artifacts/00-idea.md"), "# Payments\n", "utf8");
    const archived = await archiveRun(root, "Payments");
    await expect(
      fs.stat(path.join(archived.archivePath, ".archive-in-progress"))
    ).rejects.toHaveProperty("code", "ENOENT");
    // Manifest must be present so the archive is considered committed.
    await expect(
      fs.stat(path.join(archived.archivePath, "archive-manifest.json"))
    ).resolves.toBeTruthy();
  });

  it("surfaces partial archive sentinels through doctor", async () => {
    const root = await createTempProject("runs-partial-archive-doctor");
    await ensureRunSystem(root);
    const archiveDir = path.join(root, ".cclaw/runs/2026-04-26-partial");
    await fs.mkdir(archiveDir, { recursive: true });
    await fs.writeFile(
      path.join(archiveDir, ".archive-in-progress"),
      `${JSON.stringify({ archiveId: "2026-04-26-partial", startedAt: "2026-04-26T00:00:00Z" })}
`,
      "utf8"
    );

    const checks = await doctorChecks(root);
    const archiveIntegrity = checks.find((check) => check.name === "runs:archive_integrity");
    expect(archiveIntegrity).toBeDefined();
    expect(archiveIntegrity?.ok).toBe(false);
    expect(archiveIntegrity?.details).toContain(".archive-in-progress");
    expect(archiveIntegrity?.details).toContain("retry archive");
    expect(archiveIntegrity?.details).toContain("recover/rollback");
  });

  it("creates unique archive ids for same-day run names", async () => {
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

    await expect(archiveRun(root, "Retro Blocked")).rejects.toThrow(/ready_to_archive/i);
  });

  it("blocks archive when current stage is ship and closeout is not ready, even if ship is not marked complete", async () => {
    const root = await createTempProject("runs-ship-stage-not-ready");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review"]
      },
      { allowReset: true }
    );

    await expect(archiveRun(root, "Ship Not Ready")).rejects.toThrow(/ready_to_archive/i);
  });

  it("rejects --skip-retro while current stage is ship", async () => {
    const root = await createTempProject("runs-ship-stage-skip-retro-disallowed");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active"),
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...createInitialFlowState("active").closeout,
          shipSubstate: "ready_to_archive"
        }
      },
      { allowReset: true }
    );

    await expect(
      archiveRun(root, "Skip Retro Forbidden", {
        skipRetro: true,
        skipRetroReason: "unit test should fail"
      })
    ).rejects.toThrow(/skip-retro is not allowed/i);
  });

  it("allows archive when retro was skipped via closeout substate with a reason", async () => {
    const root = await createTempProject("runs-retro-skipped-closeout");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive",
          retroSkipped: true,
          retroSkipReason: "trivial doc change",
          retroAcceptedAt: "2026-01-01T00:00:00Z"
        }
      },
      { allowReset: true }
    );

    const archived = await archiveRun(root, "Skip Via Closeout");
    expect(archived.retro.required).toBe(true);
    // R-03: an explicit retroSkipped + reason now counts as a completed
    // retro from the gate's perspective, so archive manifests record the
    // gate as complete while preserving the `skipped` + `skipReason`
    // fields for audit trail.
    expect(archived.retro.completed).toBe(true);
    expect(archived.retro.skipped).toBe(true);
    expect(archived.retro.skipReason).toBe("trivial doc change");
  });

  it("demotes on-disk shipSubstate=ready_to_archive when retro leg is missing", async () => {
    const root = await createTempProject("runs-closeout-demote");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    // Hand-crafted tampered flow-state: ready_to_archive without any
    // retroAcceptedAt / retroSkipped. The sanitizer must demote to
    // retro_review on read so the archive gate blocks.
    const statePath = path.join(root, ".cclaw/state/flow-state.json");
    const tampered = {
      ...base,
      currentStage: "ship",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
      closeout: {
        ...base.closeout,
        shipSubstate: "ready_to_archive"
      }
    };
    await fs.writeFile(statePath, `${JSON.stringify(tampered, null, 2)}\n`, "utf8");

    const read = await readFlowState(root);
    expect(read.closeout.shipSubstate).toBe("retro_review");
    await expect(archiveRun(root, "Tampered Closeout")).rejects.toThrow(/ready_to_archive/i);
  });

  it("blocks archive when retro was skipped but closeout is not ready_to_archive", async () => {
    const root = await createTempProject("runs-retro-skipped-not-ready");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "compound_review",
          retroSkipped: true,
          retroSkipReason: "small release, no retro",
          retroAcceptedAt: "2026-01-01T00:00:00Z"
        }
      },
      { allowReset: true }
    );

    await expect(archiveRun(root, "Retro Skipped Not Ready")).rejects.toThrow(/ready_to_archive/i);
  });

  it("blocks archive when retro artifacts exist but closeout substate is not ready_to_archive", async () => {
    const root = await createTempProject("runs-retro-substate-block");
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
        source: "retro",
        trigger: "after release retrospective",
        action: "capture at least one durable run-level rule",
        confidence: "high",
        domain: "workflow",
        stage: null,
        origin_stage: "ship",
        origin_run: "retro-substate-check",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-01-01T00:00:00Z",
        first_seen_ts: "2026-01-01T00:00:00Z",
        last_seen_ts: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })}\n`,
      "utf8"
    );

    await expect(archiveRun(root, "Retro Not Ready")).rejects.toThrow(/ready_to_archive/i);
  });

  it("allows archive after retro artifact + retro knowledge are present and closeout is ready", async () => {
    const root = await createTempProject("runs-retro-ok");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive",
          retroDraftedAt: "2026-01-01T00:00:00Z",
          retroAcceptedAt: "2026-01-02T00:00:00Z"
        }
      },
      { allowReset: true }
    );
    await fs.writeFile(path.join(root, ".cclaw/artifacts/09-retro.md"), "# retro\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      `${JSON.stringify({
        type: "compound",
        source: "retro",
        trigger: "after high-risk release retrospective",
        action: "run focused rollback drill before merge",
        confidence: "high",
        domain: "ship",
        stage: null,
        origin_stage: "ship",
        origin_run: "retro-ready",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-01-01T00:00:00Z",
        first_seen_ts: "2026-01-01T00:00:00Z",
        last_seen_ts: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })}\n`,
      "utf8"
    );

    const archived = await archiveRun(root, "Retro Ready");
    expect(archived.retro.required).toBe(true);
    expect(archived.retro.completed).toBe(true);
    expect(archived.retro.compoundEntries).toBeGreaterThanOrEqual(1);
  });

  it("allows archive when retro artifact exists but compound review yielded zero new patterns", async () => {
    const root = await createTempProject("runs-retro-no-new-patterns");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive",
          retroDraftedAt: "2026-03-01T00:00:00Z",
          retroAcceptedAt: "2026-03-02T00:00:00Z",
          compoundSkipped: true
        }
      },
      { allowReset: true }
    );
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/09-retro.md"),
      "# retro\n\nNo new compound patterns this run.\n",
      "utf8"
    );

    const archived = await archiveRun(root, "Retro No New Patterns");
    expect(archived.retro.required).toBe(true);
    expect(archived.retro.completed).toBe(true);
    expect(archived.retro.compoundEntries).toBe(0);
  });

  it("treats retroSkipped=true as a complete retro even when the retro artifact is missing (R-03)", async () => {
    const root = await createTempProject("runs-retro-skipped-no-artifact");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive",
          retroSkipped: true,
          retroSkipReason: "micro-fix, no insights worth retro-ing"
        }
      },
      { allowReset: true }
    );

    const state = await readFlowState(root);
    const retroGate = await evaluateRetroGate(root, state);
    expect(retroGate.required).toBe(true);
    expect(retroGate.completed).toBe(true);
    expect(retroGate.hasRetroArtifact).toBe(false);
  });

  it("ignores retro knowledge entries outside the current retro closeout window", async () => {
    const root = await createTempProject("runs-retro-window-scope");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive",
          retroDraftedAt: "2026-02-01T00:00:00Z",
          retroAcceptedAt: "2026-02-02T00:00:00Z"
        }
      },
      { allowReset: true }
    );
    await fs.writeFile(path.join(root, ".cclaw/artifacts/09-retro.md"), "# retro\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      `${JSON.stringify({
        type: "compound",
        source: "retro",
        trigger: "stale previous run retro",
        action: "should not satisfy current run retro gate",
        confidence: "high",
        domain: "ship",
        stage: null,
        origin_stage: "ship",
        origin_run: "old-run",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: "2026-01-01T00:00:00Z",
        first_seen_ts: "2026-01-01T00:00:00Z",
        last_seen_ts: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })}\n`,
      "utf8"
    );

    await expect(archiveRun(root, "Retro Window Scope")).rejects.toThrow(/retro gate/i);
  });

  it("falls back to retro artifact mtime window when closeout timestamps are missing", async () => {
    const root = await createTempProject("runs-retro-mtime-fallback");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive"
        }
      },
      { allowReset: true }
    );

    const retroPath = path.join(root, ".cclaw/artifacts/09-retro.md");
    const retroTimestamp = new Date("2026-03-10T12:00:00Z");
    await fs.writeFile(retroPath, "# retro\n\nRecovered session without closeout timestamps.\n", "utf8");
    await fs.utimes(retroPath, retroTimestamp, retroTimestamp);
    await fs.writeFile(
      path.join(root, ".cclaw/knowledge.jsonl"),
      `${JSON.stringify({
        type: "compound",
        source: "retro",
        trigger: "recovered-retro-note",
        action: "recover retro gate after interrupted session",
        confidence: "medium",
        domain: "ship",
        stage: "retro",
        origin_stage: "ship",
        origin_run: "retro-fallback",
        frequency: 1,
        universality: "project",
        maturity: "raw",
        created: retroTimestamp.toISOString(),
        first_seen_ts: retroTimestamp.toISOString(),
        last_seen_ts: retroTimestamp.toISOString(),
        project: "cclaw"
      })}\n`,
      "utf8"
    );

    const state = await readFlowState(root);
    const retroGate = await evaluateRetroGate(root, state);
    expect(retroGate.required).toBe(true);
    expect(retroGate.completed).toBe(true);
    expect(retroGate.compoundEntries).toBeGreaterThanOrEqual(1);
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
    expect(state.stageGateCatalog.brainstorm.passed).toEqual([]);
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
    await fs.writeFile(
      path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"),
      `${JSON.stringify({ sliceId: "S-1", phase: "RED", ts: "2026-04-16T00:00:02.000Z" })}\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/state/reconciliation-notices.json"),
      JSON.stringify({
        schemaVersion: 1,
        notices: [
          {
            id: "active:brainstorm:brainstorm_context_explored:2026-04-16T00:00:03.000Z",
            runId: "active",
            stage: "brainstorm",
            gateId: "brainstorm_context_explored",
            reason: "demoted from passed to blocked during gate reconciliation (missing evidence)",
            demotedAt: "2026-04-16T00:00:03.000Z"
          }
        ]
      }, null, 2),
      "utf8"
    );
    const archived = await archiveRun(root, "Search Revamp");

    expect(archived.snapshottedStateFiles).toContain("flow-state.json");
    expect(archived.snapshottedStateFiles).toContain("delegation-log.json");
    expect(archived.snapshottedStateFiles).toContain("stage-activity.jsonl");
    expect(archived.snapshottedStateFiles).toContain("tdd-cycle-log.jsonl");
    expect(archived.snapshottedStateFiles).toContain("reconciliation-notices.json");
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
    const reconciliationSnap = JSON.parse(
      await fs.readFile(path.join(snapshotDir, "reconciliation-notices.json"), "utf8")
    ) as { notices: Array<{ gateId: string }> };
    expect(reconciliationSnap.notices[0]?.gateId).toBe("brainstorm_context_explored");

    const manifestPath = path.join(archived.archivePath, "archive-manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    expect(manifest.version).toBe(2);
    expect(manifest.archiveId).toBe(archived.archiveId);
    expect(manifest.runName).toBe("Search Revamp");
    expect(manifest).not.toHaveProperty("featureName");
    expect(manifest).not.toHaveProperty("activeFeature");
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

    const resetDelegation = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/delegation-log.json"), "utf8")
    ) as { runId: string; entries: unknown[] };
    expect(resetDelegation.runId).toBe(resetState.activeRunId);
    expect(resetDelegation.entries).toEqual([]);

    const resetTddLog = await fs.readFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), "utf8");
    expect(resetTddLog).toBe("");
    const resetReconciliation = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/reconciliation-notices.json"), "utf8")
    ) as { schemaVersion: number; notices: unknown[] };
    expect(resetReconciliation.schemaVersion).toBe(1);
    expect(resetReconciliation.notices).toEqual([]);
  });

  it("evaluateRetroGate reports retroSkipped=true as completed skipped retro", async () => {
    const root = await createTempProject("runs-retro-gate-skipped-status");
    await ensureRunSystem(root);
    const state = {
      ...createInitialFlowState("active"),
      currentStage: "ship" as const,
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship" as const],
      closeout: {
        ...createInitialFlowState("active").closeout,
        shipSubstate: "ready_to_archive" as const,
        retroSkipped: true,
        retroSkipReason: "operator skipped empty retro"
      }
    };
    await writeFlowState(root, state, { allowReset: true });

    const status = await evaluateRetroGate(root, state);
    expect(status.required).toBe(true);
    expect(status.completed).toBe(true);
    expect(status.skipped).toBe(true);
    expect(status.hasRetroArtifact).toBe(false);
  });

  it("does not complete skipped retro without a skip reason", async () => {
    const root = await createTempProject("runs-retro-gate-skip-no-reason");
    await ensureRunSystem(root);
    const state = {
      ...createInitialFlowState("active"),
      currentStage: "ship" as const,
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship" as const],
      closeout: {
        ...createInitialFlowState("active").closeout,
        shipSubstate: "ready_to_archive" as const,
        retroSkipped: true
      }
    };
    await writeFlowState(root, state, { allowReset: true });

    const persisted = await readFlowState(root);
    expect(persisted.closeout.retroSkipped).toBeUndefined();
    expect(persisted.closeout.shipSubstate).toBe("retro_review");

    const status = await evaluateRetroGate(root, state);
    expect(status.required).toBe(true);
    expect(status.completed).toBe(false);
    expect(status.skipped).toBe(false);
    await expect(archiveRun(root, "Skip Without Reason")).rejects.toThrow(/ready_to_archive/i);
  });

  it("does not trust stale positive retro compoundEntries without evidence", async () => {
    const root = await createTempProject("runs-retro-stale-compound-count");
    await ensureRunSystem(root);
    const base = createInitialFlowState("active");
    await writeFlowState(
      root,
      {
        ...base,
        currentStage: "ship",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd", "review", "ship"],
        retro: {
          required: true,
          completedAt: "2026-01-02T00:00:00Z",
          compoundEntries: 1
        },
        closeout: {
          ...base.closeout,
          shipSubstate: "ready_to_archive",
          retroDraftedAt: "2026-01-01T00:00:00Z",
          retroAcceptedAt: "2026-01-02T00:00:00Z"
        }
      },
      { allowReset: true }
    );
    await fs.writeFile(path.join(root, ".cclaw/artifacts/09-retro.md"), "# retro\n", "utf8");

    const state = await readFlowState(root);
    const status = await evaluateRetroGate(root, state);
    expect(status.compoundEntries).toBe(0);
    expect(status.completed).toBe(false);
    await expect(archiveRun(root, "Stale Compound Count")).rejects.toThrow(/retro gate/i);
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

  it("rejects track changes in writeFlowState (track is immutable per run)", async () => {
    const root = await createTempProject("runs-transition-track-immutable");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active", "standard"),
        currentStage: "brainstorm"
      },
      { allowReset: true }
    );

    await expect(
      writeFlowState(root, {
        ...createInitialFlowState("active", "quick"),
        currentStage: "brainstorm"
      })
    ).rejects.toBeInstanceOf(InvalidStageTransitionError);
  });

  it("accepts a legal forward transition via writeFlowState", async () => {
    const root = await createTempProject("runs-transition-ok");
    await ensureRunSystem(root);
    const current = await readFlowState(root);

    await writeFlowState(root, {
      ...current,
      currentStage: "scope",
      completedStages: ["brainstorm"]
    });

    const stored = await readFlowState(root);
    expect(stored.currentStage).toBe("scope");
    expect(stored.completedStages).toEqual(["brainstorm"]);
  });


  it("rejects cross-track transitions even if globally valid in another track", async () => {
    const root = await createTempProject("runs-transition-cross-track-illegal");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      {
        ...createInitialFlowState("active", "quick"),
        currentStage: "brainstorm"
      },
      { allowReset: true }
    );

    await expect(
      writeFlowState(root, {
        ...createInitialFlowState("active", "quick"),
        currentStage: "spec"
      })
    ).rejects.toBeInstanceOf(InvalidStageTransitionError);
  });

  it("accepts review -> tdd rewind transition via writeFlowState", async () => {
    const root = await createTempProject("runs-transition-review-rewind");
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

    await writeFlowState(root, {
      ...createInitialFlowState("active"),
      currentStage: "tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    });

    const stored = await readFlowState(root);
    expect(stored.currentStage).toBe("tdd");
    expect(stored.completedStages).toEqual(["brainstorm", "scope", "design", "spec", "plan", "tdd"]);
  });

});
