import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { opencodePluginJs, stageCompleteScript } from "../../src/content/hooks.js";
import {
  claudeHooksJsonWithObservation,
  codexHooksJsonWithObservation,
  cursorHooksJsonWithObservation
} from "../../src/content/observe.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";
import { createTempProject } from "../helpers/index.js";

interface ScriptResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runNodeScript(
  root: string,
  scriptName: string,
  scriptBody: string,
  args: string[] = [],
  input = "",
  extraEnv: Record<string, string> = {}
): Promise<ScriptResult> {
  const scriptPath = path.join(root, scriptName);
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);

  return await new Promise<ScriptResult>((resolve, reject) => {
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
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      env
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

describe("hooks lifecycle wiring", () => {
  it("uses node runtime commands for all harness hook configs", () => {
    const claude = claudeHooksJsonWithObservation();
    const cursor = cursorHooksJsonWithObservation();
    const codex = codexHooksJsonWithObservation();

    expect(claude).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd stop-checkpoint");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd pre-compact");
    expect(claude).not.toContain(".sh");

    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd stop-checkpoint");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd pre-compact");
    expect(cursor).not.toContain(".sh");

    expect(codex).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd stop-checkpoint");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd verify-current-state");
    expect(codex).not.toContain(".sh");
  });

  it("stage-complete helper delegates to internal advance-stage", async () => {
    const root = await createTempProject("stage-complete-helper");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });

    const binDir = path.join(root, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const callsPath = path.join(root, "cclaw-calls.log");
    const cclawShimPath = path.join(binDir, process.platform === "win32" ? "cclaw.cmd" : "cclaw");
    if (process.platform === "win32") {
      await fs.writeFile(
        cclawShimPath,
        `@echo off
>>"${callsPath}" echo %*
exit /b 0
`,
        "utf8"
      );
    } else {
      await fs.writeFile(
        cclawShimPath,
        `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "${callsPath}"
`,
        "utf8"
      );
      await fs.chmod(cclawShimPath, 0o755);
    }
    const joinedPath = `${binDir}${path.delimiter}${process.env.PATH ?? process.env.Path ?? ""}`;
    const pathEnv =
      process.platform === "win32"
        ? { PATH: joinedPath, Path: joinedPath }
        : { PATH: joinedPath };

    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      stageCompleteScript(),
      ["scope", "--passed=scope_contract_written"],
      "",
      pathEnv
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal advance-stage scope --passed=scope_contract_written");
  });

  it("stage-complete helper fails closed when cclaw binary is unavailable", async () => {
    const root = await createTempProject("stage-complete-no-cclaw");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      stageCompleteScript(),
      ["scope"],
      "",
      process.platform === "win32" ? { PATH: "", Path: "" } : { PATH: "" }
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cclaw binary not found in PATH");
  });

  it("opencode plugin source references node-only hook names", () => {
    const plugin = opencodePluginJs();
    expect(plugin).toContain("run-hook.mjs");
    expect(plugin).toContain('runHookScript("pre-compact"');
    expect(plugin).toContain('runHookScript("prompt-guard"');
    expect(plugin).toContain('runHookScript("workflow-guard"');
    expect(plugin).toContain('runHookScript("context-monitor"');
    expect(plugin).toContain('runHookScript("stop-checkpoint"');
    expect(plugin).not.toContain("prompt-guard.sh");
    expect(plugin).not.toContain("workflow-guard.sh");
    expect(plugin).not.toContain("context-monitor.sh");
    expect(plugin).not.toContain("pre-compact.sh");
    expect(plugin).not.toContain("stop-checkpoint.sh");
  });

  it("opencode plugin rehydrates and runs node hook runtime", async () => {
    const root = await createTempProject("opencode-runtime");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "design",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), [
      JSON.stringify({
        type: "rule",
        trigger: "when making architecture decisions",
        action: "make trade-offs explicit and include risk notes in the design artifact",
        confidence: "high",
        domain: "architecture",
        stage: "design",
        created: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using Cclaw\n", "utf8");

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    const hookRuntimePath = path.join(root, ".cclaw/hooks/run-hook.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(hookRuntimePath, nodeHookRuntimeScript(), "utf8");
    await fs.chmod(hookRuntimePath, 0o755);

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
    await plugin.event({ event: { type: "session.compacted", data: {} } });
    await plugin.event({ event: { type: "session.idle", data: {} } });

    const transformed = plugin["experimental.chat.system.transform"]({ system: "base system" }) as {
      system: string;
    };
    expect(transformed.system).toContain("Active artifacts: .cclaw/artifacts/");
    expect(transformed.system).toContain("Knowledge digest");
    expect(transformed.system).toContain("make trade-offs explicit");

    const guardLog = await fs.readFile(path.join(root, ".cclaw/state/prompt-guard.jsonl"), "utf8");
    expect(guardLog).toContain("write_to_cclaw_runtime");
    const workflowGuardLog = await fs.readFile(path.join(root, ".cclaw/state/workflow-guard.jsonl"), "utf8");
    expect(workflowGuardLog).toContain("stage_invocation_without_recent_flow_read");
    const contextWarnings = await fs.readFile(path.join(root, ".cclaw/state/context-warnings.jsonl"), "utf8");
    expect(contextWarnings).toContain("context remaining");
    const sessionDigest = await fs.readFile(path.join(root, ".cclaw/state/session-digest.md"), "utf8");
    expect(sessionDigest).toContain("# Session Digest");
    expect(sessionDigest).toContain("Generated by pre-compact hook");
    const checkpoint = JSON.parse(await fs.readFile(path.join(root, ".cclaw/state/checkpoint.json"), "utf8")) as {
      runId?: string;
      stage?: string;
    };
    expect(checkpoint.runId).toBe("active");
    expect(checkpoint.stage).toBe("design");
  });

  it("opencode plugin blocks when workflow guard exits non-zero", async () => {
    const root = await createTempProject("opencode-strict-block");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "scope",
      activeRunId: "active",
      completedStages: ["brainstorm"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using Cclaw\n", "utf8");

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node
if ((process.argv[2] || "") === "workflow-guard") {
  process.exit(1);
}
process.exit(0);
`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    await expect(
      plugin["tool.execute.before"]({
        tool: "RunCommand",
        tool_input: { cmd: "echo test" }
      })
    ).rejects.toThrow(/blocked tool\.execute\.before/);
  });
});
