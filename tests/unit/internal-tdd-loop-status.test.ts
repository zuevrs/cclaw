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

async function seedTddCycleLog(root: string, runId: string, rows: Record<string, unknown>[]): Promise<void> {
  const stateDir = path.join(root, ".cclaw/state");
  await fs.mkdir(stateDir, { recursive: true });
  const lines = rows
    .map((row) => JSON.stringify({ runId, stage: "tdd", ...row }))
    .join("\n");
  await fs.writeFile(path.join(stateDir, "tdd-cycle-log.jsonl"), `${lines}\n`, "utf8");
}

async function seedTddStage(root: string, runId = "run-tdd"): Promise<string> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    JSON.stringify(
      {
        currentStage: "tdd",
        activeRunId: runId,
        completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
      },
      null,
      2
    ),
    "utf8"
  );
  return runId;
}

describe("cclaw internal tdd-loop-status", () => {
  it("writes ralph-loop.json and emits a one-line summary by default", async () => {
    const root = await createTempProject("internal-ralph-loop-status");
    const runId = await seedTddStage(root);
    await seedTddCycleLog(root, runId, [
      { ts: "t1", slice: "S-1", phase: "red", command: "v", exitCode: 1 },
      { ts: "t2", slice: "S-1", phase: "green", command: "v", exitCode: 0, acIds: ["AC-1"] },
      { ts: "t3", slice: "S-2", phase: "red", command: "v", exitCode: 1 }
    ]);

    const captured = captureIo();
    const exit = await runInternalCommand(root, ["tdd-loop-status"], captured.io);
    expect(exit).toBe(0);
    expect(captured.stdout()).toMatch(/Ralph Loop: iter=1, slices=2, acClosed=1, redOpen=S-2/);

    const ralphRaw = await fs.readFile(path.join(root, ".cclaw/state/ralph-loop.json"), "utf8");
    const ralph = JSON.parse(ralphRaw);
    expect(ralph.schemaVersion).toBe(1);
    expect(ralph.runId).toBe(runId);
    expect(ralph.loopIteration).toBe(1);
    expect(ralph.acClosed).toEqual(["AC-1"]);
    expect(ralph.redOpenSlices).toEqual(["S-2"]);
  });

  it("prints full JSON and skips the file write with --json --no-write", async () => {
    const root = await createTempProject("internal-ralph-loop-status-json");
    const runId = await seedTddStage(root);
    await seedTddCycleLog(root, runId, [
      { ts: "t1", slice: "S-1", phase: "red", command: "v", exitCode: 1 },
      { ts: "t2", slice: "S-1", phase: "green", command: "v", exitCode: 0, acIds: ["AC-1"] }
    ]);

    const captured = captureIo();
    const exit = await runInternalCommand(
      root,
      ["tdd-loop-status", "--json", "--no-write"],
      captured.io
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(captured.stdout());
    expect(parsed.loopIteration).toBe(1);
    expect(parsed.acClosed).toEqual(["AC-1"]);
    await expect(
      fs.stat(path.join(root, ".cclaw/state/ralph-loop.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
