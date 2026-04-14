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
    expect(JSON.stringify(claude)).toContain("prompt-guard.sh");
    expect(JSON.stringify(claude)).toContain("context-monitor.sh");
    expect(JSON.stringify(codex)).toContain("prompt-guard.sh");
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
    expect(JSON.stringify(cursor)).toContain("prompt-guard.sh");
    expect(JSON.stringify(cursor)).toContain("context-monitor.sh");
  });

  it("session-start script injects run and recovery context", () => {
    const script = sessionStartScript();
    expect(script).toContain("ACTIVE_RUN=");
    expect(script).toContain("checkpoint.json");
    expect(script).toContain("stage-activity.jsonl");
    expect(script).toContain("Active run artifacts: .cclaw/runs/$ACTIVE_RUN/artifacts/");
  });

  it("session-start script executes and emits bootstrap payload", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-session-start-runtime-"));
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
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
    expect(context).toContain("Checkpoint: stage=review");
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

  it("context monitor emits threshold warnings once per band", async () => {
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

    const warnings = await fs.readFile(path.join(root, ".cclaw/state/context-warnings.jsonl"), "utf8");
    expect(warnings.split("\n").filter(Boolean).length).toBe(1);
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
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(summarizerPath, summarizeObservationsRuntimeModule(), "utf8");
    await fs.writeFile(summarizeScriptPath, summarizeObservationsScript(), "utf8");
    await fs.writeFile(stopScriptPath, stopCheckpointScript(), "utf8");
    await fs.chmod(summarizeScriptPath, 0o755);
    await fs.chmod(stopScriptPath, 0o755);

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
