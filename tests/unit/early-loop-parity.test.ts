import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";
import { computeEarlyLoopStatus } from "../../src/early-loop.js";

async function runHook(
  root: string,
  scriptBody: string,
  hookName: string,
  payload: unknown
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const scriptPath = path.join(root, "run-hook.mjs");
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);
  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, hookName], {
      cwd: root,
      env: { ...process.env, CCLAW_PROJECT_ROOT: root }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("early-loop parity (inline hook vs main)", () => {
  it("computeEarlyLoopStatusInline matches computeEarlyLoopStatus", async () => {
    const root = await createTempProject("early-loop-parity");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify(
        {
          currentStage: "scope",
          activeRunId: "run-early",
          completedStages: ["brainstorm"]
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const logLines = [
      JSON.stringify({
        ts: "2026-04-01T00:00:01Z",
        runId: "run-early",
        stage: "scope",
        iteration: 1,
        concerns: [
          {
            id: "C-1",
            severity: "critical",
            locator: "Scope Contract > In Scope",
            summary: "Missing rollback ownership"
          }
        ]
      }),
      JSON.stringify({
        ts: "2026-04-01T00:00:02Z",
        runId: "run-early",
        stage: "scope",
        iteration: 2,
        concerns: [
          {
            id: "C-1",
            severity: "critical",
            locator: "Scope Contract > In Scope",
            summary: "Missing rollback ownership"
          },
          {
            id: "C-2",
            severity: "important",
            locator: "Scope Contract > Out of Scope",
            summary: "Boundary still vague"
          }
        ]
      }),
      JSON.stringify({
        ts: "2026-04-01T00:00:03Z",
        runId: "run-early",
        stage: "scope",
        iteration: 3,
        concerns: [
          {
            id: "C-1",
            severity: "critical",
            locator: "Scope Contract > In Scope",
            summary: "Missing rollback ownership"
          }
        ],
        resolvedConcernIds: ["C-2"]
      }),
      JSON.stringify({
        ts: "2026-04-01T00:00:04Z",
        runId: "run-other",
        stage: "scope",
        iteration: 1,
        concerns: [{ id: "X-1", severity: "critical", locator: "Other", summary: "Ignored by run filter" }]
      }),
      JSON.stringify({
        ts: "2026-04-01T00:00:05Z",
        runId: "run-early",
        stage: "design",
        iteration: 1,
        concerns: [{ id: "D-1", severity: "important", locator: "Design", summary: "Ignored by stage filter" }]
      })
    ];
    const logPath = path.join(root, ".cclaw/state/early-loop-log.jsonl");
    await fs.writeFile(logPath, `${logLines.join("\n")}\n`, "utf8");

    const hookResult = await runHook(root, nodeHookRuntimeScript({ earlyLoopMaxIterations: 3 }), "session-start", {});
    expect(hookResult.code).toBe(0);

    const inlineStatus = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/early-loop.json"), "utf8")
    ) as Record<string, unknown>;
    const mainStatus = await computeEarlyLoopStatus("scope", "run-early", logPath, {
      maxIterations: 3
    });

    expect(inlineStatus.schemaVersion).toBe(mainStatus.schemaVersion);
    expect(inlineStatus.stage).toBe(mainStatus.stage);
    expect(inlineStatus.runId).toBe(mainStatus.runId);
    expect(inlineStatus.iteration).toBe(mainStatus.iteration);
    expect(inlineStatus.maxIterations).toBe(mainStatus.maxIterations);
    expect(inlineStatus.openConcernCount).toBe(mainStatus.openConcernCount);
    expect(inlineStatus.resolvedConcernCount).toBe(mainStatus.resolvedConcernCount);
    expect(inlineStatus.lastSeenConcernIds).toEqual(mainStatus.lastSeenConcernIds);
    expect(inlineStatus.openConcerns).toEqual(mainStatus.openConcerns);
    expect(inlineStatus.resolvedConcerns).toEqual(mainStatus.resolvedConcerns);
    expect(inlineStatus.convergenceTripped).toBe(mainStatus.convergenceTripped);
    expect(inlineStatus.escalationReason).toBe(mainStatus.escalationReason);
  });

  it("session-start includes the early-loop summary line for early stages", async () => {
    const root = await createTempProject("early-loop-summary-line");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify(
        {
          currentStage: "brainstorm",
          activeRunId: "run-summary",
          completedStages: []
        },
        null,
        2
      ),
      "utf8"
    );
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/state/early-loop-log.jsonl"),
      `${JSON.stringify({
        ts: "2026-04-01T00:00:01Z",
        runId: "run-summary",
        stage: "brainstorm",
        iteration: 1,
        concerns: [{ id: "B-1", severity: "important", locator: "Approaches", summary: "Missing fallback path" }]
      })}\n`,
      "utf8"
    );

    const hookResult = await runHook(root, nodeHookRuntimeScript(), "session-start", {});
    expect(hookResult.code).toBe(0);
    const payload = JSON.parse(hookResult.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context = payload.hookSpecificOutput?.additionalContext ?? payload.additional_context ?? "";
    expect(context).toContain("Early Loop: stage=brainstorm, iter=1/3");
    expect(context).toContain("open=1");
  });
});
