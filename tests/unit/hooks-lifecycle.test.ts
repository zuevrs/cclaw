import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { opencodePluginJs, sessionStartScript, stopCheckpointScript } from "../../src/content/hooks.js";
import {
  claudeHooksJsonWithObservation,
  contextMonitorScript,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation,
  observeScript,
  promptGuardScript,
  workflowGuardScript,
  summarizeObservationsRuntimeModule,
  summarizeObservationsScript
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

async function commandExists(command: string): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const child = spawn("bash", ["-lc", `command -v ${command} >/dev/null 2>&1`]);
    child.on("close", (code) => resolve(code === 0));
    child.on("error", () => resolve(false));
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
  });

  it("session-start script injects run and recovery context", () => {
    const script = sessionStartScript();
    expect(script).toContain("ACTIVE_RUN=");
    expect(script).toContain("checkpoint.json");
    expect(script).toContain("stage-activity.jsonl");
    expect(script).toContain("context-mode.json");
    expect(script).toContain("Context mode:");
    expect(script).toContain("Active run artifacts: .cclaw/runs/$ACTIVE_RUN/artifacts/");
  });

  it("session-start script executes and emits bootstrap payload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-session-start-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/contexts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-session",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "test", "build"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/checkpoint.json"), JSON.stringify({
      stage: "review",
      status: "in_progress",
      runId: "run-session",
      timestamp: "2026-01-01T00:00:00Z"
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/stage-activity.jsonl"), [
      JSON.stringify({ ts: "2026-01-01T00:00:01Z", phase: "post", tool: "RunCommand", stage: "review", runId: "run-session" })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/learnings.jsonl"), [
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", key: "prefer-small-diffs", type: "pitfall", insight: "Split broad changes", confidence: 6, source: "observed" })
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
    expect(context).toContain("run=run-session");
    expect(context).toContain("Context mode: review");
    expect(context).toContain("Checkpoint: stage=review");
  });

  it("session-start merges project and global learnings when enabled", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-session-global-learnings-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "build",
      activeRunId: "run-global",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "test"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/learnings.jsonl"), [
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", key: "local-learning", type: "pattern", insight: "local insight", confidence: 3, source: "observed" })
    ].join("\n"), "utf8");
    const globalLearningsPath = path.join(root, "global-learnings.jsonl");
    await fs.writeFile(globalLearningsPath, [
      JSON.stringify({ ts: "2026-01-01T00:00:00Z", key: "global-learning", type: "pattern", insight: "global insight", confidence: 9, source: "user-stated" })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using Cclaw\n", "utf8");

    const result = await runScript(
      root,
      "session-start-global.sh",
      sessionStartScript({ globalLearningsEnabled: true, globalLearningsPath })
    );
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context = payload.hookSpecificOutput?.additionalContext ?? payload.additional_context ?? "";
    expect(context).toContain("global-learning");
    expect(context).toContain("local-learning");
  });

  it("stop script writes checkpoint with run id", () => {
    const script = stopCheckpointScript();
    expect(script).toContain("CHECKPOINT_FILE=");
    expect(script).toContain("CHECKPOINT_TMP=");
    expect(script).toContain("mv \"$CHECKPOINT_TMP\" \"$CHECKPOINT_FILE\"");
    expect(script).toContain("activeRunId");
    expect(script).toContain("runId");
    expect(script).toContain(".cclaw/state/checkpoint.json");
  });

  it("stop script preserves checkpoint progress fields at runtime", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-stop-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "build",
      activeRunId: "run-abc",
      completedStages: ["brainstorm"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/checkpoint.json"), JSON.stringify({
      stage: "plan",
      runId: "run-old",
      status: "blocked",
      lastCompletedStep: "wrote plan slices",
      remainingSteps: ["collect review notes"],
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
    expect(checkpoint.stage).toBe("build");
    expect(checkpoint.runId).toBe("run-abc");
    expect(checkpoint.status).toBe("blocked");
    expect(checkpoint.lastCompletedStep).toBe("wrote plan slices");
    expect(checkpoint.remainingSteps).toEqual(["collect review notes"]);
    expect(checkpoint.blockers).toEqual(["need answer from user"]);
  });

  it("observe script appends stage activity entries", () => {
    const script = observeScript();
    expect(script).toContain("ACTIVITY_FILE=");
    expect(script).toContain("stage-activity.jsonl");
    expect(script).toContain("runId");
  });

  it("prompt guard logs advisory events for risky cclaw writes", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-prompt-guard-runtime-"));
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
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-prompt-guard-strict-runtime-"));
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

  it("prompt guard flags eval payloads with a valid ERE", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-prompt-guard-eval-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    const result = await runScript(
      root,
      "prompt-guard-eval.sh",
      promptGuardScript(),
      [],
      JSON.stringify({
        tool_name: "RunCommand",
        tool_input: {
          cmd: "node -e 'eval(foo)'"
        }
      })
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("suspicious_payload_pattern");

    const log = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(log).toContain("suspicious_payload_pattern");
  });

  it("workflow guard warns on stage jumps without recent flow read", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-workflow-guard-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "scope",
      activeRunId: "run-guard",
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
    expect(log).toContain("non_safe_tool_in_plan_stage_scope");
  });

  it("workflow guard blocks source file writes during pre-implementation stages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-wg-block-write-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "brainstorm",
      activeRunId: "run-block",
      completedStages: []
    }, null, 2), "utf8");

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: "src/main.ts", content: "hello" }
      })
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("blocked by workflow guard");

    const allowCclaw = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: { file_path: ".cclaw/artifacts/01-brainstorm.md", content: "# Design" }
      })
    );
    expect(allowCclaw.code).toBe(0);
  });

  it("workflow guard warns on non-safe tools during pre-implementation stages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-wg-plan-safe-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "design",
      activeRunId: "run-safe",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");

    const shellResult = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "Shell",
        tool_input: { command: "npm run build" }
      })
    );
    expect(shellResult.code).toBe(0);
    expect(shellResult.stderr).toContain("non_safe_tool_in_plan_stage");

    const readResult = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "Read",
        tool_input: { path: "src/main.ts" }
      })
    );
    expect(readResult.code).toBe(0);
    expect(readResult.stderr).toBe("");

    const askResult = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript(),
      [],
      JSON.stringify({
        tool_name: "AskQuestion",
        tool_input: { question: "Which approach?" }
      })
    );
    expect(askResult.code).toBe(0);
    expect(askResult.stderr).toBe("");
  });

  it("context monitor debounces warnings per band and respects TTL override", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-context-monitor-runtime-"));
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

    const warnings = await fs.readFile(path.join(root, ".cclaw/state/context-warnings.jsonl"), "utf8");
    expect(warnings.split("\n").filter(Boolean).length).toBe(2);
    const state = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/context-monitor.json"), "utf8")
    ) as {
      lastAdvisoryBand?: string;
      lastAdvisoryAt?: string;
    };
    expect(state.lastAdvisoryBand).toBe("critical");
    expect(typeof state.lastAdvisoryAt).toBe("string");
    expect((state.lastAdvisoryAt ?? "").length).toBeGreaterThan(0);
  });

  it("observe post syncs run artifacts incrementally", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-observe-run-sync-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/runs/run-sync/artifacts"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "build",
      activeRunId: "run-sync",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "test"]
    }, null, 2), "utf8");

    const activeKeep = path.join(root, ".cclaw/artifacts/keep.md");
    const activeUpdated = path.join(root, ".cclaw/artifacts/updated.md");
    const activeAdded = path.join(root, ".cclaw/artifacts/added.md");
    await fs.writeFile(activeKeep, "same", "utf8");
    await fs.writeFile(activeUpdated, "new-content", "utf8");
    await fs.writeFile(activeAdded, "added-content", "utf8");

    const runKeep = path.join(root, ".cclaw/runs/run-sync/artifacts/keep.md");
    const runUpdated = path.join(root, ".cclaw/runs/run-sync/artifacts/updated.md");
    const runStale = path.join(root, ".cclaw/runs/run-sync/artifacts/stale.md");
    await fs.writeFile(runKeep, "same", "utf8");
    await fs.writeFile(runUpdated, "old-content", "utf8");
    await fs.writeFile(runStale, "stale-content", "utf8");

    const fixedTime = new Date("2001-01-01T00:00:00Z");
    await fs.utimes(runKeep, fixedTime, fixedTime);
    const keepBefore = await fs.stat(runKeep);

    const result = await runScript(
      root,
      "observe-run-sync.sh",
      observeScript(),
      ["post"],
      JSON.stringify({ tool_name: "Write", tool_output: "sync" })
    );
    expect(result.code).toBe(0);

    const keepAfter = await fs.stat(runKeep);
    expect(Math.abs(keepAfter.mtimeMs - keepBefore.mtimeMs)).toBeLessThan(5);
    const updatedAfter = await fs.readFile(runUpdated, "utf8");
    expect(updatedAfter).toBe("new-content");
    const addedAfter = await fs.readFile(path.join(root, ".cclaw/runs/run-sync/artifacts/added.md"), "utf8");
    expect(addedAfter).toBe("added-content");
    await expect(fs.stat(runStale)).rejects.toThrow();
  });

  it("observe and summarize scripts execute end-to-end", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-observe-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "test",
      activeRunId: "run-observe",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/learnings.jsonl"), "", "utf8");

    const observeBody = observeScript();
    for (let i = 0; i < 5; i += 1) {
      const pre = await runScript(
        root,
        `observe-pre-${i}.sh`,
        observeBody,
        ["pre"],
        JSON.stringify({ tool_name: "RunCommand", tool_input: { cmd: `echo pre-${i}` } })
      );
      expect(pre.code).toBe(0);

      const post = await runScript(
        root,
        `observe-post-${i}.sh`,
        observeBody,
        ["post"],
        JSON.stringify({ tool_name: "RunCommand", tool_output: `error at step ${i}` })
      );
      expect(post.code).toBe(0);
    }

    const observationsBefore = await fs.readFile(path.join(root, ".cclaw/observations.jsonl"), "utf8");
    const activityBefore = await fs.readFile(path.join(root, ".cclaw/state/stage-activity.jsonl"), "utf8");
    expect(observationsBefore.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(5);
    expect(activityBefore.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(5);

    const summarize = await runScript(root, "summarize.sh", summarizeObservationsScript());
    expect(summarize.code).toBe(0);

    if (await commandExists("jq")) {
      const archiveDir = path.join(root, ".cclaw/observations.archive");
      const archives = await fs.readdir(archiveDir);
      expect(archives.length).toBeGreaterThan(0);

      const observationsAfter = await fs.readFile(path.join(root, ".cclaw/observations.jsonl"), "utf8");
      expect(observationsAfter.trim()).toBe("");

      const learnings = await fs.readFile(path.join(root, ".cclaw/learnings.jsonl"), "utf8");
      expect(learnings).toContain("frequent-errors-RunCommand");
    }
  });

  it("opencode plugin appends observations and summarizes on idle", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-opencode-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "build",
      activeRunId: "run-opencode",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "test"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/learnings.jsonl"), "", "utf8");

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    const summarizerPath = path.join(root, ".cclaw/hooks/summarize-observations.mjs");
    const summarizeScriptPath = path.join(root, ".cclaw/hooks/summarize-observations.sh");
    const stopScriptPath = path.join(root, ".cclaw/hooks/stop-checkpoint.sh");
    const promptGuardPath = path.join(root, ".cclaw/hooks/prompt-guard.sh");
    const workflowGuardPath = path.join(root, ".cclaw/hooks/workflow-guard.sh");
    const contextMonitorPath = path.join(root, ".cclaw/hooks/context-monitor.sh");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(summarizerPath, summarizeObservationsRuntimeModule(), "utf8");
    await fs.writeFile(summarizeScriptPath, summarizeObservationsScript(), "utf8");
    await fs.writeFile(stopScriptPath, stopCheckpointScript(), "utf8");
    await fs.writeFile(promptGuardPath, promptGuardScript(), "utf8");
    await fs.writeFile(workflowGuardPath, workflowGuardScript(), "utf8");
    await fs.writeFile(contextMonitorPath, contextMonitorScript(), "utf8");
    await fs.chmod(summarizeScriptPath, 0o755);
    await fs.chmod(stopScriptPath, 0o755);
    await fs.chmod(promptGuardPath, 0o755);
    await fs.chmod(workflowGuardPath, 0o755);
    await fs.chmod(contextMonitorPath, 0o755);

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      event: (name: string, data?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    for (let i = 0; i < 3; i += 1) {
      await plugin.event("tool.execute.before", {
        tool: "RunCommand",
        arguments: { cmd: `echo pre-${i}` }
      });
      await plugin.event("tool.execute.after", {
        tool: "RunCommand",
        output: `error at step ${i}`
      });
    }

    const observations = await fs.readFile(path.join(root, ".cclaw/observations.jsonl"), "utf8");
    const observationLines = observations.split("\n").filter(Boolean);
    expect(observationLines.length).toBe(6);
    const parsed = observationLines.map((line) => JSON.parse(line) as {
      event: string;
      phase: string;
      tool: string;
      stage: string;
      runId: string;
      data: string;
    });
    expect(parsed[0]?.event).toBe("tool_start");
    expect(parsed[0]?.phase).toBe("pre");
    expect(parsed[0]?.tool).toBe("RunCommand");
    expect(parsed[0]?.stage).toBe("build");
    expect(parsed[0]?.runId).toBe("run-opencode");
    expect(parsed.some((entry) => entry.event === "tool_complete" && entry.data.includes("error at step"))).toBe(true);

    await plugin.event("tool.execute.before", {
      tool: "Write",
      tool_input: { path: ".cclaw/state/flow-state.json" }
    });
    await plugin.event("tool.execute.before", {
      tool: "RunCommand",
      tool_input: { cmd: "/cc-review" }
    });
    await plugin.event("tool.execute.after", {
      tool: "RunCommand",
      context: { remaining_percent: 15 },
      output: "ok"
    });

    const guardLog = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(guardLog).toContain("write_to_cclaw_runtime");
    const workflowGuardLog = await fs.readFile(path.join(root, ".cclaw/state/workflow-guard.jsonl"), "utf8");
    expect(workflowGuardLog).toContain("stage_invocation_without_recent_flow_read");
    const contextWarnings = await fs.readFile(path.join(root, ".cclaw/state/context-warnings.jsonl"), "utf8");
    expect(contextWarnings).toContain("context remaining");

    await plugin.event("session.idle", {});

    const learnings = await fs.readFile(path.join(root, ".cclaw/learnings.jsonl"), "utf8");
    expect(learnings).toContain("frequent-errors-RunCommand");
    const checkpoint = JSON.parse(await fs.readFile(path.join(root, ".cclaw/state/checkpoint.json"), "utf8")) as {
      runId?: string;
      stage?: string;
    };
    expect(checkpoint.runId).toBe("run-opencode");
    expect(checkpoint.stage).toBe("build");
  });

  it("opencode plugin rehydrates on multiple lifecycle events", () => {
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
    expect(plugin).toContain(".cclaw/runs/");
    expect(plugin).toContain("Last session:");
    expect(plugin).toContain("Latest context warning:");
    expect(plugin).toContain("Stage learnings (");
    expect(plugin).toContain("suggestion-memory.json");
  });
});
