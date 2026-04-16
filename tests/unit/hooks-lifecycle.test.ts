import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { opencodePluginJs, sessionStartScript, stopCheckpointScript } from "../../src/content/hooks.js";
import { createTempProject } from "../helpers/index.js";
import {
  claudeHooksJsonWithObservation,
  contextMonitorScript,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation,
  promptGuardScript,
  workflowGuardScript
} from "../../src/content/observe.js";

interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runScript(
  root: string,
  scriptName: string,
  scriptBody: string,
  args: string[] = [],
  input = "",
  extraEnv: Record<string, string> = {}
): Promise<ScriptResult> {
  const scriptPath = path.join(root, scriptName);
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);

  return await new Promise<ScriptResult>((resolve, reject) => {
    const child = spawn("bash", [scriptPath, ...args], {
      cwd: root,
      env: {
        ...process.env,
        CCLAW_PROJECT_ROOT: root,
        ...extraEnv
      }
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    if (input.length > 0) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

describe("hooks lifecycle rehydration", () => {
  it("uses full lifecycle matcher in claude and codex hooks", () => {
    const claude = JSON.parse(claudeHooksJsonWithObservation()) as {
      hooks: { SessionStart: Array<{ matcher?: string }> };
    };
    const codex = JSON.parse(codexHooksJsonWithObservation()) as {
      hooks: { SessionStart: Array<{ matcher?: string }> };
    };

    expect(claude.hooks.SessionStart[0]?.matcher).toBe("startup|resume|clear|compact");
    expect(codex.hooks.SessionStart[0]?.matcher).toBe("startup|resume|clear|compact");
    expect((claude as { cclawHookSchemaVersion?: number }).cclawHookSchemaVersion).toBe(1);
    expect((codex as { cclawHookSchemaVersion?: number }).cclawHookSchemaVersion).toBe(1);
    expect(JSON.stringify(claude)).toContain("prompt-guard.sh");
    expect(JSON.stringify(claude)).toContain("workflow-guard.sh");
    expect(JSON.stringify(claude)).toContain("context-monitor.sh");
    expect(JSON.stringify(codex)).toContain("prompt-guard.sh");
    expect(JSON.stringify(codex)).toContain("workflow-guard.sh");
    expect(JSON.stringify(codex)).toContain("context-monitor.sh");
    expect(JSON.stringify(claude)).not.toContain("observe.sh");
    expect(JSON.stringify(codex)).not.toContain("observe.sh");
  });

  it("defines cursor rehydration lifecycle events", () => {
    const cursor = JSON.parse(cursorHooksJsonWithObservation()) as {
      hooks: Record<string, unknown>;
    };
    expect(Array.isArray(cursor.hooks.sessionStart)).toBe(true);
    expect(Array.isArray(cursor.hooks.sessionResume)).toBe(true);
    expect(Array.isArray(cursor.hooks.sessionClear)).toBe(true);
    expect(Array.isArray(cursor.hooks.sessionCompact)).toBe(true);
    expect((cursor as { cclawHookSchemaVersion?: number }).cclawHookSchemaVersion).toBe(1);
    expect(JSON.stringify(cursor)).toContain("prompt-guard.sh");
    expect(JSON.stringify(cursor)).toContain("workflow-guard.sh");
    expect(JSON.stringify(cursor)).toContain("context-monitor.sh");
    expect(JSON.stringify(cursor)).not.toContain("observe.sh");
  });

  it("session-start script injects active artifacts and knowledge context", () => {
    const script = sessionStartScript();
    expect(script).toContain("ACTIVE_RUN=");
    expect(script).toContain("checkpoint.json");
    expect(script).toContain("stage-activity.jsonl");
    expect(script).toContain("context-mode.json");
    expect(script).toContain("Context mode:");
    expect(script).toContain("Active artifacts: .cclaw/artifacts/");
    expect(script).toContain("knowledge.md");
  });

  it("session-start script executes and emits bootstrap payload with knowledge", async () => {
    const root = await createTempProject("session-start-runtime");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/contexts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/checkpoint.json"), JSON.stringify({
      stage: "review",
      status: "in_progress",
      runId: "active",
      timestamp: "2026-01-01T00:00:00Z"
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/stage-activity.jsonl"), [
      JSON.stringify({ ts: "2026-01-01T00:00:01Z", phase: "post", tool: "RunCommand", stage: "review", runId: "active" })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.md"), [
      "# Project Knowledge",
      "",
      "### 2026-01-01T00:00:00Z [pattern] keep-diffs-small",
      "- Stage: review",
      "- Context: wide release changes",
      "- Insight: split broad changes",
      "- Reuse: keep change sets focused"
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/context-mode.json"), JSON.stringify({
      activeMode: "review",
      updatedAt: "2026-01-01T00:00:00Z",
      availableModes: ["default", "execution", "review", "incident"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/contexts/review.md"), "# Context Mode: review\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using Cclaw\n", "utf8");

    const result = await runScript(root, "session-start.sh", sessionStartScript());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context = payload.hookSpecificOutput?.additionalContext ?? payload.additional_context ?? "";
    expect(context).toContain("cclaw loaded. Flow: stage=review");
    expect(context).toContain("run=active");
    expect(context).toContain("Context mode: review");
    expect(context).toContain("Checkpoint: stage=review");
    expect(context).toContain("Knowledge snapshot");
    expect(context).toContain("keep-diffs-small");
  });

  it("stop script writes checkpoint with run id and preserves progress fields", async () => {
    const root = await createTempProject("stop-runtime");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "plan",
      activeRunId: "active",
      completedStages: ["brainstorm"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/checkpoint.json"), JSON.stringify({
      stage: "scope",
      runId: "old-run",
      status: "blocked",
      lastCompletedStep: "captured assumptions",
      remainingSteps: ["ask approval"],
      blockers: ["need answer from user"]
    }, null, 2), "utf8");

    const result = await runScript(root, "stop-checkpoint.sh", stopCheckpointScript(), [], '{"loop_count":0}');
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");

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
    expect(checkpoint.runId).toBe("active");
    expect(checkpoint.status).toBe("blocked");
    expect(checkpoint.lastCompletedStep).toBe("captured assumptions");
    expect(checkpoint.remainingSteps).toEqual(["ask approval"]);
    expect(checkpoint.blockers).toEqual(["need answer from user"]);
  });

  it("prompt guard logs advisory events for risky cclaw writes", async () => {
    const root = await createTempProject("prompt-guard-runtime");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const result = await runScript(
      root,
      "prompt-guard.sh",
      promptGuardScript(),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: ".cclaw/state/flow-state.json",
          content: "rm -rf .cclaw"
        }
      })
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("Cclaw advisory");

    const log = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(log).toContain("write_to_cclaw_runtime");
  });

  it("prompt guard blocks risky writes in strict mode", async () => {
    const root = await createTempProject("prompt-guard-strict-runtime");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const result = await runScript(
      root,
      "prompt-guard-strict.sh",
      promptGuardScript({ strictMode: true }),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: ".cclaw/state/flow-state.json"
        }
      })
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("blocked by strict mode");
  });

  it("workflow guard warns on stage jumps without recent flow read", async () => {
    const root = await createTempProject("workflow-guard-runtime");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "scope",
      activeRunId: "active",
      completedStages: ["brainstorm"]
    }, null, 2), "utf8");

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "RunCommand",
        tool_input: {
          cmd: "/cc-next"
        }
      })
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("workflow guard");

    const log = await fs.readFile(path.join(root, ".cclaw/state/workflow-guard.jsonl"), "utf8");
    expect(log).not.toContain("non_safe_tool_in_plan_stage_scope");
    expect(log).toContain("stage_invocation_without_recent_flow_read");
  });

  it("workflow guard exempts cclaw doctor from non-safe-tool in plan stage", async () => {
    const root = await createTempProject("guard-cclaw-cli");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "design",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");

    const epoch = Math.floor(Date.now() / 1000);
    await fs.writeFile(path.join(root, ".cclaw/state/workflow-guard.json"), JSON.stringify({
      lastFlowReadAt: new Date().toISOString(),
      lastFlowReadAtEpoch: epoch
    }, null, 2), "utf8");

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "Shell",
        tool_input: {
          command: "npx cclaw doctor"
        }
      })
    );
    expect(result.code).toBe(0);
    const logPath = path.join(root, ".cclaw/state/workflow-guard.jsonl");
    const logExists = await fs.stat(logPath).then(() => true).catch(() => false);
    if (logExists) {
      const log = await fs.readFile(logPath, "utf8");
      expect(log).not.toContain("non_safe_tool_in_plan_stage");
    }
  });

  it("context monitor debounces warnings per band and respects TTL override", async () => {
    const root = await createTempProject("context-monitor-runtime");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });

    const payload = JSON.stringify({
      context: {
        remaining_percent: 18
      }
    });

    const first = await runScript(root, "context-monitor.sh", contextMonitorScript(), [], payload);
    expect(first.code).toBe(0);
    expect(first.stderr).toContain("Cclaw advisory");

    const second = await runScript(root, "context-monitor.sh", contextMonitorScript(), [], payload);
    expect(second.code).toBe(0);
    expect(second.stderr).toBe("");

    const forced = await runScript(
      root,
      "context-monitor.sh",
      contextMonitorScript(),
      [],
      payload,
      { CCLAW_CONTEXT_MONITOR_TTL_SEC: "0" }
    );
    expect(forced.code).toBe(0);
    expect(forced.stderr).toContain("Cclaw advisory");
  });

  it("opencode plugin rehydrates and runs guard hooks", async () => {
    const root = await createTempProject("opencode-runtime");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "design",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.md"), [
      "# Project Knowledge",
      "",
      "### 2026-01-01T00:00:00Z [rule] keep-risk-visible",
      "- Stage: design",
      "- Context: architecture decisions",
      "- Insight: make trade-offs explicit",
      "- Reuse: include risk notes in artifacts"
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using Cclaw\n", "utf8");

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    const stopScriptPath = path.join(root, ".cclaw/hooks/stop-checkpoint.sh");
    const promptGuardPath = path.join(root, ".cclaw/hooks/prompt-guard.sh");
    const workflowGuardPath = path.join(root, ".cclaw/hooks/workflow-guard.sh");
    const contextMonitorPath = path.join(root, ".cclaw/hooks/context-monitor.sh");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(stopScriptPath, stopCheckpointScript(), "utf8");
    await fs.writeFile(promptGuardPath, promptGuardScript(), "utf8");
    await fs.writeFile(workflowGuardPath, workflowGuardScript(), "utf8");
    await fs.writeFile(contextMonitorPath, contextMonitorScript(), "utf8");
    await fs.chmod(stopScriptPath, 0o755);
    await fs.chmod(promptGuardPath, 0o755);
    await fs.chmod(workflowGuardPath, 0o755);
    await fs.chmod(contextMonitorPath, 0o755);

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      event: (payload: unknown) => Promise<void>;
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
      "tool.execute.after": (input: unknown, output?: unknown) => Promise<void>;
      "experimental.chat.system.transform": (payload: unknown) => unknown;
    };
    const plugin = pluginFactory({ directory: root });

    await plugin["tool.execute.before"]({
      tool: "Write",
      tool_input: { path: ".cclaw/state/flow-state.json" }
    });
    await plugin["tool.execute.before"]({
      tool: "RunCommand",
      tool_input: { cmd: "/cc-review" }
    });
    await plugin["tool.execute.after"]({
      tool: "RunCommand",
      context: { remaining_percent: 15 },
      output: "ok"
    });
    await plugin.event({ event: { type: "session.idle", data: {} } });

    const transformed = plugin["experimental.chat.system.transform"]({ system: "base system" }) as {
      system: string;
    };
    expect(transformed.system).toContain("Active artifacts: .cclaw/artifacts/");
    expect(transformed.system).toContain("Knowledge snapshot");
    expect(transformed.system).toContain("keep-risk-visible");

    const guardLog = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(guardLog).toContain("write_to_cclaw_runtime");
    const workflowGuardLog = await fs.readFile(path.join(root, ".cclaw/state/workflow-guard.jsonl"), "utf8");
    expect(workflowGuardLog).toContain("stage_invocation_without_recent_flow_read");
    const contextWarnings = await fs.readFile(path.join(root, ".cclaw/state/context-warnings.jsonl"), "utf8");
    expect(contextWarnings).toContain("context remaining");
    const checkpoint = JSON.parse(await fs.readFile(path.join(root, ".cclaw/state/checkpoint.json"), "utf8")) as {
      runId?: string;
      stage?: string;
    };
    expect(checkpoint.runId).toBe("active");
    expect(checkpoint.stage).toBe("design");
  });

  it("opencode plugin includes lifecycle events in source", () => {
    const plugin = opencodePluginJs();
    expect(plugin).toContain("event: async");
    expect(plugin).toContain('"session.created"');
    expect(plugin).toContain('"session.resumed"');
    expect(plugin).toContain('"session.compacted"');
    expect(plugin).toContain('"session.cleared"');
    expect(plugin).toContain('"tool.execute.before"');
    expect(plugin).toContain('"tool.execute.after"');
    expect(plugin).toContain("prompt-guard.sh");
    expect(plugin).toContain("workflow-guard.sh");
    expect(plugin).toContain("context-monitor.sh");
    expect(plugin).toContain('"session.idle"');
    expect(plugin).toContain('"experimental.chat.system.transform"');
    expect(plugin).toContain("activeRunId");
    expect(plugin).not.toContain(".cclaw/runs/");
    expect(plugin).toContain("Knowledge snapshot");
    expect(plugin).toContain("Last session:");
    expect(plugin).toContain("Latest context warning:");
  });
});
