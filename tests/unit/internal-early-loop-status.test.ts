import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  io: { stdout: Writable; stderr: Writable };
  stdout: () => string;
  stderr: () => string;
}

function captureIo(): CapturedIo {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk.toString());
      callback();
    }
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join("")
  };
}

async function seedEarlyStage(root: string, stage: "brainstorm" | "scope" | "design", runId = "run-early"): Promise<string> {
  const stateDir = path.join(root, ".cclaw/state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(stateDir, "flow-state.json"),
    JSON.stringify(
      {
        currentStage: stage,
        activeRunId: runId,
        completedStages: stage === "brainstorm" ? [] : ["brainstorm"]
      },
      null,
      2
    ),
    "utf8"
  );
  return runId;
}

async function seedEarlyLoopLog(root: string, runId: string, stage: "brainstorm" | "scope" | "design"): Promise<void> {
  const stateDir = path.join(root, ".cclaw/state");
  await fs.mkdir(stateDir, { recursive: true });
  const lines = [
    JSON.stringify({
      ts: "2026-04-29T10:00:00Z",
      runId,
      stage,
      iteration: 1,
      concerns: [{ id: "E-1", severity: "critical", locator: "Section A", summary: "Critical gap" }]
    }),
    JSON.stringify({
      ts: "2026-04-29T10:05:00Z",
      runId,
      stage,
      iteration: 2,
      concerns: [{ id: "E-1", severity: "critical", locator: "Section A", summary: "Critical gap" }]
    })
  ].join("\n");
  await fs.writeFile(path.join(stateDir, "early-loop-log.jsonl"), `${lines}\n`, "utf8");
}

describe("cclaw internal early-loop-status", () => {
  it("writes early-loop.json and emits a summary line by default", async () => {
    const root = await createTempProject("internal-early-loop-status");
    const runId = await seedEarlyStage(root, "scope");
    await seedEarlyLoopLog(root, runId, "scope");
    const captured = captureIo();

    const exit = await runInternalCommand(root, ["early-loop-status"], captured.io);
    expect(exit).toBe(0);
    expect(captured.stdout()).toMatch(/Early Loop: stage=scope, iter=2\/3, open=1, convergence=tripped/);

    const statusRaw = await fs.readFile(path.join(root, ".cclaw/state/early-loop.json"), "utf8");
    const status = JSON.parse(statusRaw) as {
      schemaVersion: number;
      runId: string;
      stage: string;
      openConcerns: Array<{ id: string }>;
      convergenceTripped: boolean;
    };
    expect(status.schemaVersion).toBe(1);
    expect(status.runId).toBe(runId);
    expect(status.stage).toBe("scope");
    expect(status.openConcerns).toHaveLength(1);
    expect(status.openConcerns[0]?.id).toBe("E-1");
    expect(status.convergenceTripped).toBe(true);
  });

  it("prints JSON and skips file write with --json --no-write", async () => {
    const root = await createTempProject("internal-early-loop-status-json");
    const runId = await seedEarlyStage(root, "design");
    await seedEarlyLoopLog(root, runId, "design");
    const captured = captureIo();

    const exit = await runInternalCommand(
      root,
      ["early-loop-status", "--json", "--no-write", "--stage=design", `--run-id=${runId}`],
      captured.io
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(captured.stdout()) as {
      stage: string;
      runId: string;
      openConcerns: Array<{ id: string }>;
      convergenceTripped: boolean;
    };
    expect(parsed.stage).toBe("design");
    expect(parsed.runId).toBe(runId);
    expect(parsed.openConcerns).toHaveLength(1);
    expect(parsed.openConcerns[0]?.id).toBe("E-1");
    expect(parsed.convergenceTripped).toBe(true);
    await expect(fs.stat(path.join(root, ".cclaw/state/early-loop.json"))).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("fails when current stage is not brainstorm/scope/design and no override is given", async () => {
    const root = await createTempProject("internal-early-loop-status-stage-error");
    const stateDir = path.join(root, ".cclaw/state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.writeFile(
      path.join(stateDir, "flow-state.json"),
      JSON.stringify(
        {
          currentStage: "tdd",
          activeRunId: "run-tdd",
          completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
        },
        null,
        2
      ),
      "utf8"
    );
    const captured = captureIo();
    const exit = await runInternalCommand(root, ["early-loop-status"], captured.io);
    expect(exit).toBe(1);
    expect(captured.stderr()).toContain("current stage is not an early-loop stage");
  });
});
