import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  ensureRunDir,
  generateRunId,
  isRunAlive,
  listRuns,
  readRunStatus,
  resolveRunId,
  runStatusPath,
  type EvalRunStatus,
  writeRunStatus
} from "../../src/eval/runs.js";
import { createTempProject } from "../helpers/index.js";

describe("eval runs bookkeeping", () => {
  it("generateRunId returns sortable timestamp prefix with random suffix", () => {
    const id = generateRunId(new Date("2026-04-21T18:15:44.123Z"));
    expect(id).toMatch(/^20260421T181544Z-[0-9a-f]{6}$/);
  });

  it("readRunStatus returns null for missing or malformed status files", async () => {
    const root = await createTempProject("eval-runs-read");
    expect(await readRunStatus(root, "missing")).toBeNull();

    await ensureRunDir(root, "broken");
    await fs.writeFile(runStatusPath(root, "broken"), "{not-json", "utf8");
    expect(await readRunStatus(root, "broken")).toBeNull();
  });

  it("lists runs newest-first and skips half-initialized run directories", async () => {
    const root = await createTempProject("eval-runs-list");
    const older: EvalRunStatus = {
      id: "20260420T100000Z-a1b2c3",
      startedAt: "2026-04-20T10:00:00Z",
      pid: 111,
      argv: ["eval"],
      cwd: root,
      state: "succeeded",
      endedAt: "2026-04-20T10:00:10Z",
      exitCode: 0
    };
    const newer: EvalRunStatus = {
      id: "20260421T100000Z-d4e5f6",
      startedAt: "2026-04-21T10:00:00Z",
      pid: 222,
      argv: ["eval"],
      cwd: root,
      state: "running"
    };

    await writeRunStatus(root, older);
    await writeRunStatus(root, newer);
    await ensureRunDir(root, "incomplete");

    const runs = await listRuns(root);
    expect(runs.map((entry) => entry.id)).toEqual([newer.id, older.id]);
  });

  it("resolveRunId handles explicit ids and latest fallback", async () => {
    const root = await createTempProject("eval-runs-resolve");
    const first: EvalRunStatus = {
      id: "20260420T100000Z-a1b2c3",
      startedAt: "2026-04-20T10:00:00Z",
      pid: 111,
      argv: ["eval"],
      cwd: root,
      state: "failed",
      endedAt: "2026-04-20T10:00:05Z",
      exitCode: 1
    };
    const second: EvalRunStatus = {
      id: "20260421T120000Z-ffeedd",
      startedAt: "2026-04-21T12:00:00Z",
      pid: 222,
      argv: ["eval"],
      cwd: root,
      state: "running"
    };
    await writeRunStatus(root, first);
    await writeRunStatus(root, second);

    expect(await resolveRunId(root, "latest")).toBe(second.id);
    expect(await resolveRunId(root, undefined)).toBe(second.id);
    expect(await resolveRunId(root, first.id)).toBe(first.id);
    expect(await resolveRunId(root, "missing")).toBeNull();
  });

  it("isRunAlive only returns true for running processes", () => {
    const succeeded: EvalRunStatus = {
      id: "done",
      startedAt: "2026-04-21T00:00:00Z",
      endedAt: "2026-04-21T00:00:01Z",
      pid: process.pid,
      argv: [],
      cwd: process.cwd(),
      state: "succeeded",
      exitCode: 0
    };
    const runningSelf: EvalRunStatus = {
      id: "running-self",
      startedAt: "2026-04-21T00:00:00Z",
      pid: process.pid,
      argv: [],
      cwd: process.cwd(),
      state: "running"
    };
    const runningUnknownPid: EvalRunStatus = {
      id: "running-dead",
      startedAt: "2026-04-21T00:00:00Z",
      pid: 999_999,
      argv: [],
      cwd: process.cwd(),
      state: "running"
    };

    expect(isRunAlive(succeeded)).toBe(false);
    expect(isRunAlive(runningSelf)).toBe(true);
    expect(isRunAlive(runningUnknownPid)).toBe(false);
  });
});
