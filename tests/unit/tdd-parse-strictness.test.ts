import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import {
  parseTddCycleLog,
  type TddCycleParseIssue
} from "../../src/tdd-cycle.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { ensureRunSystem, readFlowState } from "../../src/run-persistence.js";

function captureIo(): {
  stdout: () => string;
  stderr: () => string;
  io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
} {
  let out = "";
  let err = "";
  const makeSink = (sink: "out" | "err") =>
    ({
      write: (chunk: string | Buffer): boolean => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (sink === "out") out += text;
        else err += text;
        return true;
      }
    }) as unknown as NodeJS.WritableStream;
  return {
    stdout: () => out,
    stderr: () => err,
    io: { stdout: makeSink("out"), stderr: makeSink("err") }
  };
}

describe("parseTddCycleLog strict mode + issues", () => {
  it("soft mode (default) backfills defaults but reports issues when callers opt in", () => {
    const text = [
      JSON.stringify({ ts: "t1", runId: "R1", stage: "tdd", slice: "S-1", phase: "red", exitCode: 1, command: "v" }),
      "{ this is not json",
      JSON.stringify({ phase: "red", exitCode: 1, command: "v" }),
      JSON.stringify({ phase: "other", command: "v" })
    ].join("\n");

    const issues: TddCycleParseIssue[] = [];
    const entries = parseTddCycleLog(text, { issues });

    expect(entries).toHaveLength(2);
    expect(entries[0]!.runId).toBe("R1");
    expect(entries[1]!.runId).toBe("active");
    expect(entries[1]!.stage).toBe("tdd");
    expect(entries[1]!.slice).toBe("S-unknown");

    const reasons = issues.map((issue) => issue.reason);
    expect(reasons.some((reason) => reason.startsWith("json-parse-failed"))).toBe(true);
    expect(reasons.some((reason) => reason.startsWith("invalid-phase"))).toBe(true);
  });

  it("strict mode drops rows missing runId/stage/slice and records them in issues", () => {
    const text = [
      JSON.stringify({ ts: "t1", runId: "R1", stage: "tdd", slice: "S-1", phase: "red", exitCode: 1, command: "v" }),
      JSON.stringify({ phase: "red", exitCode: 1, command: "v" }),
      JSON.stringify({ runId: "R1", stage: "tdd", phase: "green", exitCode: 0, command: "v" })
    ].join("\n");

    const issues: TddCycleParseIssue[] = [];
    const entries = parseTddCycleLog(text, { strict: true, issues });

    expect(entries).toHaveLength(1);
    expect(entries[0]!.slice).toBe("S-1");
    expect(issues.some((issue) => issue.reason.includes("missing-required-fields"))).toBe(true);
  });
});

describe("tdd-red-evidence runId scoping", () => {
  it("fails loud when readFlowState throws and --runId is absent", async () => {
    const root = await createTempProject("red-evidence-no-run");
    // Break flow-state.json enough that readFlowState rejects (the
    // file is present but feature-system validation fails because we
    // corrupted the active-feature sidecar). The command used to fall
    // back to unscoped matching; now it must fail loud.
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      "not-json-at-all",
      "utf8"
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["tdd-red-evidence", "--path=src/app.ts"],
      captured.io
    );
    expect(code).toBe(2);
    const payload = JSON.parse(captured.stdout()) as {
      ok: boolean;
      runId: string | null;
      error?: string;
    };
    expect(payload.ok).toBe(false);
    expect(payload.runId).toBeNull();
    expect(payload.error ?? "").toContain("no --runId provided");
  });

  it("rejects cross-run evidence even if a matching path exists in an older runId", async () => {
    const root = await createTempProject("red-evidence-cross-run");
    await ensureRunSystem(root);
    const flow = await readFlowState(root);
    const otherRunId = flow.activeRunId === "OLD-RUN" ? "PRE-OLD-RUN" : "OLD-RUN";
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({
        ts: "2026-04-01T00:00:00Z",
        runId: otherRunId,
        stage: "tdd",
        slice: "S-1",
        phase: "red",
        command: "vitest",
        files: ["src/app.ts"],
        exitCode: 1
      })
    ].join("\n"), "utf8");

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["tdd-red-evidence", "--path=src/app.ts", `--run-id=${flow.activeRunId}`],
      captured.io
    );
    expect(code).toBe(2);
    const payload = JSON.parse(captured.stdout()) as { ok: boolean };
    expect(payload.ok).toBe(false);
  });
});
