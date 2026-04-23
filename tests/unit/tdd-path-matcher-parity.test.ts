import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import {
  hasFailingTestForPath,
  normalizeTddPath,
  parseTddCycleLog,
  pathMatchesTarget
} from "../../src/tdd-cycle.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";
import { ensureRunSystem, readFlowState } from "../../src/run-persistence.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";

describe("canonical path matcher", () => {
  it("normalizeTddPath strips ./ prefix, normalizes slashes, lowercases, trims", () => {
    expect(normalizeTddPath("./src/App.ts")).toBe("src/app.ts");
    expect(normalizeTddPath("src\\App.ts")).toBe("src/app.ts");
    expect(normalizeTddPath("  SRC/app.ts  ")).toBe("src/app.ts");
  });

  it("pathMatchesTarget matches exact and endsWith('/'+target)", () => {
    expect(pathMatchesTarget("src/app.ts", "src/app.ts")).toBe(true);
    expect(pathMatchesTarget("pkg/src/app.ts", "src/app.ts")).toBe(true);
    // Must not match when target is a suffix-but-not-segment (file vs. prefix).
    expect(pathMatchesTarget("src/app.test.ts", "src/app.ts")).toBe(false);
    expect(pathMatchesTarget("", "src/app.ts")).toBe(false);
    expect(pathMatchesTarget("src/app.ts", "")).toBe(false);
  });

  it("hasFailingTestForPath tolerates ./ and case differences", () => {
    const entries = parseTddCycleLog([
      JSON.stringify({
        ts: "t", runId: "R1", stage: "tdd", slice: "S-1", phase: "red",
        exitCode: 1, command: "v", files: ["./src/App.ts"]
      })
    ].join("\n"));
    expect(hasFailingTestForPath(entries, "src/app.ts", { runId: "R1" })).toBe(true);
  });
});

describe("slice-aware workflow guard", () => {
  async function runWorkflowGuard(
    root: string,
    payload: unknown
  ): Promise<{ code: number | null; stderr: string }> {
    const scriptPath = path.join(root, "run-hook.mjs");
    await fs.writeFile(scriptPath, nodeHookRuntimeScript({ strictness: "strict" }), "utf8");
    await fs.chmod(scriptPath, 0o755);
    return await new Promise((resolve) => {
      const child = spawn(process.execPath, [scriptPath, "workflow-guard"], {
        cwd: root,
        env: { ...process.env, CCLAW_PROJECT_ROOT: root, CCLAW_STRICTNESS: "strict" }
      });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("close", (code) => resolve({ code, stderr }));
      child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
      child.stdin.end();
    });
  }

  async function prepTddProject(
    suffix: string,
    makeRows: (activeRunId: string) => unknown[]
  ): Promise<{ root: string; activeRunId: string }> {
    const root = await createTempProject(suffix);
    await ensureRunSystem(root);
    const flow = await readFlowState(root);
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({
        ...flow,
        currentStage: "tdd",
        completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
      }, null, 2),
      "utf8"
    );
    const nowEpoch = Math.floor(Date.now() / 1000);
    await fs.writeFile(
      path.join(root, ".cclaw/state/workflow-guard.json"),
      JSON.stringify({
        lastFlowReadAt: new Date().toISOString(),
        lastFlowReadAtEpoch: nowEpoch
      }, null, 2),
      "utf8"
    );
    const rows = makeRows(flow.activeRunId);
    await fs.writeFile(
      path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"),
      rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8"
    );
    return { root, activeRunId: flow.activeRunId };
  }

  it("blocks tdd prod write in strict mode when all slices have closed their RED (slice-aware)", async () => {
    const { root } = await prepTddProject("workflow-guard-slice-aware", (runId) => [
      { ts: "t1", runId, stage: "tdd", slice: "S-1", phase: "red", exitCode: 1, command: "v" },
      { ts: "t2", runId, stage: "tdd", slice: "S-1", phase: "green", exitCode: 0, command: "v" }
    ]);

    const result = await runWorkflowGuard(root, {
      tool: "Write",
      hook_event_name: "PreToolUse",
      tool_input: { content: "export const x = 1;\n" }
    });

    expect(result.code).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("failing test first");
  });

  it("allows tdd prod write when at least one slice has an open RED (slice-aware)", async () => {
    const { root } = await prepTddProject("workflow-guard-open-red", (runId) => [
      { ts: "t1", runId, stage: "tdd", slice: "S-1", phase: "red", exitCode: 1, command: "v" },
      { ts: "t2", runId, stage: "tdd", slice: "S-1", phase: "green", exitCode: 0, command: "v" },
      { ts: "t3", runId, stage: "tdd", slice: "S-2", phase: "red", exitCode: 1, command: "v" }
    ]);

    const result = await runWorkflowGuard(root, {
      tool: "Write",
      hook_event_name: "PreToolUse",
      tool_input: { content: "export const x = 1;\n" }
    });

    expect(result.code, result.stderr).toBe(0);
  });
});

describe("tdd-red-evidence path-matcher parity with canonical", () => {
  function captureIo(): {
    stdout: () => string;
    io: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream };
  } {
    let out = "";
    const makeSink = () =>
      ({
        write: (chunk: string | Buffer): boolean => {
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
          out += text;
          return true;
        }
      }) as unknown as NodeJS.WritableStream;
    return { stdout: () => out, io: { stdout: makeSink(), stderr: makeSink() } };
  }

  it("matches a target against an endsWith recorded path (was previously strict-equal only)", async () => {
    const root = await createTempProject("red-evidence-endswith");
    await ensureRunSystem(root);
    const flow = await readFlowState(root);
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"),
      [
        JSON.stringify({
          ts: "t1", runId: flow.activeRunId, stage: "tdd", slice: "S-1", phase: "red",
          exitCode: 1, command: "v", files: ["pkg/src/app.ts"]
        })
      ].join("\n"),
      "utf8"
    );

    const captured = captureIo();
    const code = await runInternalCommand(
      root,
      ["tdd-red-evidence", "--path=src/app.ts", `--run-id=${flow.activeRunId}`],
      captured.io
    );
    expect(code).toBe(0);
    const payload = JSON.parse(captured.stdout()) as { ok: boolean };
    expect(payload.ok).toBe(true);
  });
});
