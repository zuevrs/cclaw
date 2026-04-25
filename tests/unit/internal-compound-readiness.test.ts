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

async function seedKnowledge(root: string, rows: Record<string, unknown>[]): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), `${lines}\n`, "utf8");
}

/**
 * Seed enough archived runs that the small-project relaxation does NOT
 * fire. Individual tests opt into the relaxation explicitly.
 */
async function seedNonSmallProjectArchive(root: string): Promise<void> {
  const dir = path.join(root, ".cclaw/runs");
  await fs.mkdir(dir, { recursive: true });
  for (const name of ["run-a", "run-b", "run-c", "run-d", "run-e"]) {
    await fs.mkdir(path.join(dir, name), { recursive: true });
  }
}

const baseRow = {
  type: "pattern",
  confidence: "medium",
  domain: null,
  project: "cclaw",
  origin_run: null,
  origin_stage: "review",
  stage: "review",
  source: "stage",
  universality: "project",
  maturity: "raw",
  frequency: 1,
  created: "2026-04-01T00:00:00Z",
  first_seen_ts: "2026-04-01T00:00:00Z",
  last_seen_ts: "2026-04-01T00:00:00Z"
};

describe("cclaw internal compound-readiness", () => {
  it("writes compound-readiness.json and emits a one-line summary by default", async () => {
    const root = await createTempProject("internal-compound-readiness");
    await seedNonSmallProjectArchive(root);
    await seedKnowledge(root, [
      { ...baseRow, trigger: "swallowed errors", action: "rethrow with context", frequency: 2 },
      {
        ...baseRow,
        trigger: "swallowed errors",
        action: "rethrow with context",
        frequency: 1,
        last_seen_ts: "2026-04-10T00:00:00Z"
      },
      { ...baseRow, trigger: "below threshold", action: "skip", frequency: 1 }
    ]);

    const captured = captureIo();
    const exit = await runInternalCommand(root, ["compound-readiness"], captured.io);
    expect(exit).toBe(0);
    expect(captured.stdout()).toMatch(/Compound readiness: clusters=2, ready=1/);

    const raw = await fs.readFile(
      path.join(root, ".cclaw/state/compound-readiness.json"),
      "utf8"
    );
    const status = JSON.parse(raw);
    expect(status.schemaVersion).toBe(2);
    expect(status.threshold).toBe(3);
    expect(status.baseThreshold).toBe(3);
    expect(status.archivedRunsCount).toBe(5);
    expect(status.smallProjectRelaxationApplied).toBe(false);
    expect(status.readyCount).toBe(1);
    expect(status.ready[0]).toMatchObject({
      recurrence: 3,
      qualification: "recurrence"
    });
  });

  it("respects --threshold and --no-write", async () => {
    const root = await createTempProject("internal-compound-readiness-threshold");
    await seedNonSmallProjectArchive(root);
    await seedKnowledge(root, [
      { ...baseRow, trigger: "spike", action: "alert", frequency: 2 }
    ]);

    const captured = captureIo();
    const exit = await runInternalCommand(
      root,
      ["compound-readiness", "--threshold", "2", "--json", "--no-write"],
      captured.io
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(captured.stdout());
    expect(parsed.threshold).toBe(2);
    expect(parsed.readyCount).toBe(1);

    await expect(
      fs.stat(path.join(root, ".cclaw/state/compound-readiness.json"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects malformed --threshold values loudly", async () => {
    const root = await createTempProject("internal-compound-readiness-threshold-bad");
    const captured = captureIo();
    const exit = await runInternalCommand(
      root,
      ["compound-readiness", "--threshold", "2abc", "--no-write"],
      captured.io
    );
    expect(exit).toBe(1);
    expect(captured.stderr()).toMatch(/--threshold must be a positive integer, got 2abc/);
  });

  it("applies small-project relaxation when archive has < 5 runs", async () => {
    const root = await createTempProject("internal-compound-readiness-small");
    // Seed two knowledge entries for the same cluster (recurrence=2).
    // Default threshold=3, but with only 2 archived runs the relaxation
    // lowers the effective threshold to 2, so the cluster qualifies.
    await seedKnowledge(root, [
      { ...baseRow, trigger: "review gap", action: "regression", frequency: 1 },
      { ...baseRow, trigger: "review gap", action: "regression", frequency: 1 }
    ]);
    await fs.mkdir(path.join(root, ".cclaw/runs/run-a"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/runs/run-b"), { recursive: true });

    const captured = captureIo();
    const exit = await runInternalCommand(
      root,
      ["compound-readiness", "--json"],
      captured.io
    );
    expect(exit).toBe(0);
    const parsed = JSON.parse(captured.stdout());
    expect(parsed.baseThreshold).toBe(3);
    expect(parsed.threshold).toBe(2);
    expect(parsed.archivedRunsCount).toBe(2);
    expect(parsed.smallProjectRelaxationApplied).toBe(true);
    expect(parsed.readyCount).toBe(1);
  });

  it("emits a 'no candidates' line when nothing qualifies", async () => {
    const root = await createTempProject("internal-compound-readiness-empty");
    await seedNonSmallProjectArchive(root);
    await seedKnowledge(root, [
      { ...baseRow, trigger: "lonely", action: "alone", frequency: 1 }
    ]);

    const captured = captureIo();
    const exit = await runInternalCommand(root, ["compound-readiness"], captured.io);
    expect(exit).toBe(0);
    expect(captured.stdout()).toMatch(/Compound readiness: no candidates/);
  });
});
