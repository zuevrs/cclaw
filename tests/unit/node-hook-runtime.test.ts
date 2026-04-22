import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";

interface RuntimeResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runNodeHook(
  root: string,
  hookName: string,
  scriptBody: string,
  input: unknown = {},
  extraEnv: Record<string, string> = {}
): Promise<RuntimeResult> {
  const scriptPath = path.join(root, "run-hook.mjs");
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);
  const payload = typeof input === "string" ? input : JSON.stringify(input);

  return await new Promise<RuntimeResult>((resolve, reject) => {
    const env = {
      ...process.env,
      CCLAW_PROJECT_ROOT: root,
      ...extraEnv
    } as Record<string, string | undefined>;
    if (process.platform === "win32") {
      const normalizedPath = extraEnv.Path ?? extraEnv.PATH ?? process.env.Path ?? process.env.PATH ?? "";
      delete env.PATH;
      delete env.Path;
      env.Path = normalizedPath;
    }
    const child = spawn(process.execPath, [scriptPath, hookName], {
      cwd: root,
      env
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
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.stdin.write(payload);
    child.stdin.end();
  });
}

describe("node hook runtime", () => {
  it("session-start emits bootstrap payload and writes knowledge digest", async () => {
    const root = await createTempProject("node-hook-session-start");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/contexts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-node",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/checkpoint.json"), JSON.stringify({
      stage: "review",
      runId: "run-node",
      status: "in_progress",
      timestamp: "2026-04-20T00:00:00Z"
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/context-mode.json"), JSON.stringify({
      activeMode: "review"
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/contexts/review.md"), "# review\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), [
      JSON.stringify({
        type: "pattern",
        trigger: "when review scope is too broad",
        action: "split into focused diffs",
        confidence: "high",
        domain: "review",
        stage: "review",
        origin_stage: "review",
        origin_feature: "feature-a",
        frequency: 2,
        universality: "project",
        maturity: "raw",
        created: "2026-04-20T00:00:00Z",
        first_seen_ts: "2026-04-20T00:00:00Z",
        last_seen_ts: "2026-04-20T00:00:00Z",
        project: "cclaw"
      })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context =
      payload.hookSpecificOutput?.additionalContext ??
      payload.additional_context ??
      "";
    expect(context).toContain("cclaw loaded. Flow: stage=review");
    expect(context).toContain("run=run-node");
    expect(context).toContain("Context mode: review");
    expect(context).toContain("Checkpoint: stage=review");
    expect(context).toContain("Knowledge digest");
    const digest = await fs.readFile(path.join(root, ".cclaw/state/knowledge-digest.md"), "utf8");
    expect(digest).toContain("Knowledge digest (auto-generated)");
    expect(digest).toContain("split into focused diffs");
  });

  it("stop-checkpoint preserves progress fields while syncing stage/run", async () => {
    const root = await createTempProject("node-hook-stop");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "plan",
      activeRunId: "run-plan",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/checkpoint.json"), JSON.stringify({
      stage: "scope",
      runId: "old",
      status: "blocked",
      lastCompletedStep: "captured assumptions",
      remainingSteps: ["ask approval"],
      blockers: ["need PM answer"]
    }, null, 2), "utf8");

    const result = await runNodeHook(
      root,
      "stop-checkpoint",
      nodeHookRuntimeScript(),
      { loop_count: 0 }
    );
    expect(result.code).toBe(0);
    const checkpoint = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/checkpoint.json"), "utf8")
    ) as {
      stage: string;
      runId: string;
      status: string;
      lastCompletedStep: string;
      remainingSteps: string[];
      blockers: string[];
    };
    expect(checkpoint.stage).toBe("plan");
    expect(checkpoint.runId).toBe("run-plan");
    expect(checkpoint.status).toBe("blocked");
    expect(checkpoint.lastCompletedStep).toBe("captured assumptions");
    expect(checkpoint.remainingSteps).toEqual(["ask approval"]);
    expect(checkpoint.blockers).toEqual(["need PM answer"]);
  });

  it("prompt-guard supports advisory and strict modes", async () => {
    const root = await createTempProject("node-hook-prompt-guard");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const payload = {
      tool_name: "Write",
      tool_input: {
        path: ".cclaw/state/flow-state.json",
        content: "x"
      }
    };

    const advisory = await runNodeHook(
      root,
      "prompt-guard",
      nodeHookRuntimeScript(),
      payload
    );
    expect(advisory.code).toBe(0);
    expect(advisory.stderr).toContain("Cclaw advisory");
    const log = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(log).toContain("write_to_cclaw_runtime");

    const strict = await runNodeHook(
      root,
      "prompt-guard",
      nodeHookRuntimeScript({ promptGuardMode: "strict" }),
      payload
    );
    expect(strict.code).toBe(1);
    expect(strict.stderr).toContain("blocked by strict mode");
  });

  it("workflow-guard enforces per-path RED evidence in strict tdd mode", async () => {
    const root = await createTempProject("node-hook-workflow-guard");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-tdd",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");

    const missingRed = await runNodeHook(
      root,
      "workflow-guard",
      nodeHookRuntimeScript({ tddEnforcementMode: "strict" }),
      {
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 1;\n"
        }
      }
    );
    expect(missingRed.code).toBe(1);
    expect(missingRed.stderr).toContain("missing failing RED evidence");

    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({
        ts: "2026-04-20T00:00:00Z",
        runId: "run-tdd",
        stage: "tdd",
        slice: "S-1",
        phase: "red",
        command: "npm test -- tests/unit/app.test.ts",
        files: ["src/app.ts"],
        exitCode: 1
      })
    ].join("\n"), "utf8");

    const hasRed = await runNodeHook(
      root,
      "workflow-guard",
      nodeHookRuntimeScript({ tddEnforcementMode: "strict" }),
      {
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 2;\n"
        }
      }
    );
    expect(hasRed.code).toBe(0);
    expect(hasRed.stderr).not.toContain("missing failing RED evidence");
  });

  it("verify-current-state honors strict/advisory mode without bash wrappers", async () => {
    const root = await createTempProject("node-hook-verify-current-state");
    const binDir = path.join(root, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const shimName = process.platform === "win32" ? "cclaw.cmd" : "cclaw";
    const shimPath = path.join(binDir, shimName);
    if (process.platform === "win32") {
      await fs.writeFile(
        shimPath,
        `@echo off
if /I "%1"=="internal" if /I "%2"=="verify-current-state" exit /b %CCLAW_FAKE_VERIFY_EXIT%
exit /b 0
`,
        "utf8"
      );
    } else {
      await fs.writeFile(
        shimPath,
        `#!/usr/bin/env bash
if [ "$1" = "internal" ] && [ "$2" = "verify-current-state" ]; then
  exit "\${CCLAW_FAKE_VERIFY_EXIT:-0}"
fi
exit 0
`,
        "utf8"
      );
      await fs.chmod(shimPath, 0o755);
    }
    const joinedPath = `${binDir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
    const pathEnv =
      process.platform === "win32"
        ? { PATH: joinedPath, Path: joinedPath }
        : { PATH: joinedPath };

    const strictFail = await runNodeHook(
      root,
      "verify-current-state",
      nodeHookRuntimeScript(),
      {},
      {
        ...pathEnv,
        CCLAW_WORKFLOW_GUARD_MODE: "strict",
        CCLAW_FAKE_VERIFY_EXIT: "1"
      }
    );
    expect(strictFail.code).toBe(1);

    const advisoryFail = await runNodeHook(
      root,
      "verify-current-state",
      nodeHookRuntimeScript(),
      {},
      {
        ...pathEnv,
        CCLAW_WORKFLOW_GUARD_MODE: "advisory",
        CCLAW_FAKE_VERIFY_EXIT: "1"
      }
    );
    expect(advisoryFail.code).toBe(0);

    const missingBinary = await runNodeHook(
      root,
      "verify-current-state",
      nodeHookRuntimeScript(),
      {},
      process.platform === "win32" ? { PATH: "", Path: "" } : { PATH: "" }
    );
    expect(missingBinary.code).toBe(1);
    expect(missingBinary.stderr).toContain("cclaw binary is required for verify-current-state");
  });

  it("context-monitor debounces advisories and auto-captures failing tests", async () => {
    const root = await createTempProject("node-hook-context-monitor");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-context",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");

    const warningPayload = {
      context: { remaining_percent: 18 }
    };
    const first = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      warningPayload
    );
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("Cclaw advisory");

    const second = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      warningPayload
    );
    expect(second.code).toBe(0);
    expect(second.stderr).toBe("");

    const forced = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      warningPayload,
      { CCLAW_CONTEXT_MONITOR_TTL_SEC: "0" }
    );
    expect(forced.code).toBe(0);
    expect(forced.stderr).toContain("Cclaw advisory");

    const autoEvidence = await runNodeHook(
      root,
      "context-monitor",
      nodeHookRuntimeScript(),
      {
        input: {
          tool: "RunCommand",
          tool_input: { cmd: "npm test -- tests/unit/app.test.ts" }
        },
        output: {
          exitCode: 1,
          stderr: "FAIL src/app.ts"
        }
      }
    );
    expect(autoEvidence.code).toBe(0);
    const evidenceLog = await fs.readFile(
      path.join(root, ".cclaw/state/tdd-red-evidence.jsonl"),
      "utf8"
    );
    expect(evidenceLog).toContain('"source":"posttool-auto"');
    expect(evidenceLog).toContain("src/app.ts");
  });
});
