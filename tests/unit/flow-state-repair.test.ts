import fs from "node:fs/promises";
import path from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import {
  ensureRunSystem,
  flowStateGuardSidecarPathFor,
  flowStateRepairLogPathFor,
  readFlowState,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

async function runCli(root: string, argv: string[]): Promise<{
  code: number;
  stdout: string;
  stderr: string;
}> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let stdoutBuf = "";
  let stderrBuf = "";
  stdout.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString("utf8");
  });
  stderr.on("data", (chunk: Buffer) => {
    stderrBuf += chunk.toString("utf8");
  });
  const code = await runInternalCommand(root, argv, { stdout, stderr });
  return { code, stdout: stdoutBuf, stderr: stderrBuf };
}

describe("cclaw internal flow-state-repair", () => {
  it("fails when --reason is missing", async () => {
    const root = await createTempProject("flow-state-repair-missing-reason");
    await ensureRunSystem(root);
    const { code, stderr } = await runCli(root, ["flow-state-repair"]);
    expect(code).toBe(1);
    expect(stderr).toMatch(/requires --reason/u);
  });

  it("backfills missing completedStageMeta entries from completedStages on repair ", async () => {
    const root = await createTempProject("flow-state-repair-backfill-meta");
    await ensureRunSystem(root);
    const initial = createInitialFlowState({ track: "standard", discoveryMode: "guided" });
    initial.completedStages = ["brainstorm", "scope"];
    initial.completedStageMeta = {};
    initial.currentStage = "design";
    await writeFlowState(root, initial, { allowReset: true });

    // Seed brainstorm artifact so the backfill picks up an mtime instead of "now".
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    const brainstormPath = path.join(root, ".cclaw/artifacts/01-brainstorm.md");
    await fs.writeFile(brainstormPath, "# Brainstorm\n", "utf8");
    const stat = await fs.stat(brainstormPath);

    const { code, stdout } = await runCli(root, [
      "flow-state-repair",
      "--reason=meta_backfill",
      "--json"
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout) as {
      ok: boolean;
      completedStageMetaBackfilled: string[];
    };
    expect(payload.completedStageMetaBackfilled.sort()).toEqual(["brainstorm", "scope"]);
    const reloaded = await readFlowState(root);
    expect(reloaded.completedStageMeta?.brainstorm?.completedAt).toBeDefined();
    expect(reloaded.completedStageMeta?.scope?.completedAt).toBeDefined();
    // Brainstorm meta should match artifact mtime (within ms rounding).
    const brainstormCompletedAtMs = Date.parse(
      reloaded.completedStageMeta!.brainstorm!.completedAt
    );
    expect(Math.abs(brainstormCompletedAtMs - stat.mtimeMs)).toBeLessThan(1000);
  });

  it("recomputes sidecar and appends repair log with a valid reason", async () => {
    const root = await createTempProject("flow-state-repair-happy");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    const statePath = path.join(root, ".cclaw", "state", "flow-state.json");
    const raw = await fs.readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    parsed.currentStage = "plan";
    await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    const { code, stdout } = await runCli(root, [
      "flow-state-repair",
      "--reason=manual_edit_recovery",
      "--json"
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("flow-state-repair");
    const sidecarRaw = await fs.readFile(flowStateGuardSidecarPathFor(root), "utf8");
    const sidecar = JSON.parse(sidecarRaw) as Record<string, unknown>;
    expect(typeof sidecar.sha256).toBe("string");
    const logRaw = await fs.readFile(flowStateRepairLogPathFor(root), "utf8");
    expect(logRaw).toContain("reason=manual_edit_recovery");
    const loaded = await readFlowState(root);
    expect(loaded.currentStage).toBe("plan");
  });

  it("--early-loop normalizes early-loop.json from early-loop-log.jsonl (release repair)", async () => {
    const root = await createTempProject("flow-state-repair-early-loop");
    await ensureRunSystem(root);
    const initial = createInitialFlowState({ track: "standard", discoveryMode: "guided" });
    initial.currentStage = "scope";
    initial.activeRunId = "run-fix";
    await writeFlowState(root, initial, { allowReset: true });

    const stateDir = path.join(root, ".cclaw/state");
    await fs.mkdir(stateDir, { recursive: true });
    // Hand-written early-loop.json that does NOT match the canonical shape.
    await fs.writeFile(
      path.join(stateDir, "early-loop.json"),
      JSON.stringify({ legacy: true, iteration: "broken" }, null, 2),
      "utf8"
    );
    // Truthful early-loop log with one open concern.
    const logRow = {
      ts: "2026-04-29T10:00:00.000Z",
      runId: "run-fix",
      stage: "scope",
      iteration: 1,
      concerns: [
        {
          id: "C-1",
          severity: "critical",
          locator: "Scope > Out of Scope",
          summary: "Boundary missing"
        }
      ]
    };
    await fs.writeFile(
      path.join(stateDir, "early-loop-log.jsonl"),
      `${JSON.stringify(logRow)}\n`,
      "utf8"
    );

    const { code, stdout } = await runCli(root, [
      "flow-state-repair",
      "--reason=early_loop_normalize",
      "--early-loop",
      "--json"
    ]);
    expect(code).toBe(0);
    const payload = JSON.parse(stdout) as {
      earlyLoop: {
        performed: boolean;
        stage?: string;
        runId?: string;
        iteration?: number;
        openConcernCount?: number;
      } | null;
    };
    expect(payload.earlyLoop?.performed).toBe(true);
    expect(payload.earlyLoop?.stage).toBe("scope");
    expect(payload.earlyLoop?.runId).toBe("run-fix");
    expect(payload.earlyLoop?.openConcernCount).toBe(1);

    const normalized = JSON.parse(
      await fs.readFile(path.join(stateDir, "early-loop.json"), "utf8")
    ) as { iteration: number; openConcerns: Array<{ id: string }> };
    expect(normalized.iteration).toBe(1);
    expect(normalized.openConcerns.map((c) => c.id)).toEqual(["C-1"]);
  });
});
