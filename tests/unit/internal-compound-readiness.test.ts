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

const baseRow = {
  type: "pattern",
  confidence: "medium",
  domain: null,
  project: "cclaw",
  origin_feature: null,
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
    expect(status.schemaVersion).toBe(1);
    expect(status.threshold).toBe(3);
    expect(status.readyCount).toBe(1);
    expect(status.ready[0]).toMatchObject({
      recurrence: 3,
      qualification: "recurrence"
    });
  });

  it("respects --threshold and --no-write", async () => {
    const root = await createTempProject("internal-compound-readiness-threshold");
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

  it("emits a 'no candidates' line when nothing qualifies", async () => {
    const root = await createTempProject("internal-compound-readiness-empty");
    await seedKnowledge(root, [
      { ...baseRow, trigger: "lonely", action: "alone", frequency: 1 }
    ]);

    const captured = captureIo();
    const exit = await runInternalCommand(root, ["compound-readiness"], captured.io);
    expect(exit).toBe(0);
    expect(captured.stdout()).toMatch(/Compound readiness: no candidates/);
  });
});
