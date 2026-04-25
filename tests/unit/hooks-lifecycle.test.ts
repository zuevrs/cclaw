import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { readFlowState } from "../../src/runs.js";
import { stageSchema } from "../../src/content/stage-schema.js";
import { opencodePluginJs, runHookCmdScript, stageCompleteScript } from "../../src/content/hooks.js";
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

function requiredGateEvidenceJson(stage: Parameters<typeof stageSchema>[0]): string {
  const requiredGateIds = stageSchema(stage).requiredGates
    .filter((gate) => gate.tier === "required")
    .map((gate) => gate.id);
  return JSON.stringify(Object.fromEntries(
    requiredGateIds.map((gateId) => [gateId, `evidence for ${gateId}`])
  ));
}

async function writeBrainstormArtifact(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), `# Brainstorm Artifact

## Context
- Project state: greenfield static landing page.
- Relevant existing code/patterns: none; initial flow stage.

## Problem
- What we're solving: pick a reliable frontend direction.
- Success criteria: approved direction and traceable trade-offs.
- Constraints: no implementation during brainstorm.

## Clarifying Questions
| # | Question | Answer | Decision impact |
|---|---|---|---|
| 1 | Static or dynamic? | Static | removes backend/CMS from v1 |

## Approach Tier
- Tier: Lightweight
- Why this tier: single static landing page.

## Short-Circuit Decision
- Status: bypassed
- Why: options still needed comparison.
- Scope handoff: continue with selected frontend direction.

## Approaches
| Approach | Role | Architecture | Trade-offs | Recommendation |
|---|---|---|---|---|
| A | baseline | Astro static site | fastest, smaller ecosystem |  |
| B | selected | Next.js static export | richer ecosystem, more overhead | recommended |
| C | challenger: higher-upside | Vite vanilla | maximum control, more manual work |  |

## Approach Reaction
- Closest option: B
- Concerns: wants ecosystem and animation support.
- What changed after reaction: recommendation moved to Next.js static export.

## Selected Direction
- Approach: B - Next.js static export
- Rationale: user reaction favored ecosystem and ready animation tooling.
- Approval: approved

## Design
- Architecture: static exported Next.js app.
- Key components: app router page, Tailwind styles, animation layer.
- Data flow: static content -> build -> exported HTML/CSS/JS.

## Assumptions and Open Questions
- Assumptions: single-page landing v1.
- Open questions (or "None"): None

## Learnings
- {"type":"pattern","trigger":"when stage completion runs without global cclaw","action":"invoke the generated Node stage-complete helper so learnings harvest still writes knowledge","confidence":"high","domain":"workflow","universality":"project","maturity":"raw"}
`, "utf8");
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
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd stop-handoff");
    expect(claude).toContain(".cclaw/hooks/run-hook.cmd pre-compact");
    expect(claude).not.toContain(".sh");

    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd stop-handoff");
    expect(cursor).toContain(".cclaw/hooks/run-hook.cmd pre-compact");
    expect(cursor).not.toContain(".sh");

    expect(codex).toContain(".cclaw/hooks/run-hook.cmd session-start");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd prompt-guard");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd workflow-guard");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd context-monitor");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd stop-handoff");
    expect(codex).toContain(".cclaw/hooks/run-hook.cmd verify-current-state");
    expect(codex).not.toContain(".sh");
  });

  it("run-hook wrapper reports missing node instead of silently skipping", () => {
    const wrapper = runHookCmdScript();
    expect(wrapper).toContain("node not found; cclaw hook skipped");
    expect(wrapper).toContain("Run npx cclaw-cli doctor");
  });

  it("stage-complete helper invokes a local Node runtime instead of a cclaw PATH binary", async () => {
    const root = await createTempProject("stage-complete-helper");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });

    const callsPath = path.join(root, "node-runtime-calls.log");
    const runtimeShimPath = path.join(root, "local-runtime.mjs");
    await fs.writeFile(runtimeShimPath, `#!/usr/bin/env node
import fs from "node:fs";
fs.appendFileSync(${JSON.stringify(callsPath)}, process.argv.slice(2).join(" ") + "\\n");
`, "utf8");
    await fs.chmod(runtimeShimPath, 0o755);

    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      stageCompleteScript(),
      ["scope", "--passed=scope_contract_written"],
      "",
      process.platform === "win32"
        ? { PATH: "", Path: "", CCLAW_CLI_JS: runtimeShimPath }
        : { PATH: "", CCLAW_CLI_JS: runtimeShimPath }
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal advance-stage scope --passed=scope_contract_written");
  });

  it("stage-complete helper advances state and harvests learnings without cclaw on PATH", async () => {
    const root = await createTempProject("stage-complete-no-path-harvest");
    await initCclaw({ projectRoot: root });
    await writeBrainstormArtifact(root);

    const scriptBody = await fs.readFile(path.join(root, ".cclaw/hooks/stage-complete.mjs"), "utf8");
    const result = await runNodeScript(
      root,
      ".cclaw/hooks/stage-complete.mjs",
      scriptBody,
      ["brainstorm", `--evidence-json=${requiredGateEvidenceJson("brainstorm")}`],
      "",
      process.platform === "win32" ? { PATH: "", Path: "" } : { PATH: "" }
    );

    expect(result.code, result.stderr).toBe(0);
    const state = await readFlowState(root);
    expect(state.completedStages).toContain("brainstorm");
    expect(state.currentStage).toBe("scope");

    const knowledgeRaw = await fs.readFile(path.join(root, ".cclaw/knowledge.jsonl"), "utf8");
    expect(knowledgeRaw).toContain("when stage completion runs without global cclaw");

    const artifact = await fs.readFile(path.join(root, ".cclaw/artifacts/01-brainstorm.md"), "utf8");
    expect(artifact).toContain("<!-- cclaw:learnings-harvested:");
  });

  it("opencode plugin source references node-only hook names", () => {
    const plugin = opencodePluginJs();
    expect(plugin).toContain("run-hook.mjs");
    expect(plugin).toContain('runHookScript("pre-compact"');
    expect(plugin).toContain('runHookScript("prompt-guard"');
    expect(plugin).toContain('runHookScript("workflow-guard"');
    expect(plugin).toContain('runHookScript("context-monitor"');
    expect(plugin).toContain('runHookScript("stop-handoff"');
    expect(plugin).not.toContain("prompt-guard.sh");
    expect(plugin).not.toContain("workflow-guard.sh");
    expect(plugin).not.toContain("context-monitor.sh");
    expect(plugin).not.toContain("pre-compact.sh");
    expect(plugin).not.toContain("stop-handoff.sh");
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
    await expect(fs.stat(path.join(root, ".cclaw/state/context-warnings.jsonl"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/session-digest.md"))).rejects.toBeDefined();
    await expect(fs.stat(path.join(root, ".cclaw/state/checkpoint.json"))).rejects.toBeDefined();
  });

  it("opencode plugin blocks when workflow guard exits non-zero under strict config", async () => {
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
    // Under the new advisory-by-default behavior, blocking only happens
    // when the user opts into strict mode — mirror that in this test
    // via the canonical config.yaml key.
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), "strictness: strict\n", "utf8");

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node
if ((process.argv[2] || "") === "workflow-guard") {
  process.stderr.write("workflow guard refused: gate evidence missing");
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

  it("opencode plugin bypasses guards for read-only tools", async () => {
    const root = await createTempProject("opencode-readonly-bypass");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", activeRunId: "active", completedStages: ["brainstorm"] }, null, 2),
      "utf8"
    );
    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node\nprocess.exit(1);\n`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    for (const tool of ["read", "Read", "glob", "Grep", "list", "webfetch", "WebSearch", "view"]) {
      await expect(
        plugin["tool.execute.before"]({ tool, tool_input: { path: "anything" } })
      ).resolves.toBeUndefined();
    }
  });

  it("opencode plugin skips guards when cclaw is not initialized", async () => {
    const root = await createTempProject("opencode-not-initialized");
    // Intentionally do not write flow-state.json or run-hook.mjs — this
    // is the "user hasn't run cclaw init yet" scenario.
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });

    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.mkdir(path.dirname(pluginPath), { recursive: true });
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    // Even a mutating tool should pass through when cclaw is not initialized.
    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).resolves.toBeUndefined();

    // Advisory logged exactly once.
    const logPath = path.join(root, ".cclaw/logs/opencode-plugin.log");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toMatch(/guards skipped: cclaw is not initialized/);
  });

  it("opencode plugin honors CCLAW_DISABLE env killswitch", async () => {
    const root = await createTempProject("opencode-killswitch");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", activeRunId: "active", completedStages: [] }, null, 2),
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node\nprocess.exit(1);\n`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);
    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");

    const previous = process.env.CCLAW_DISABLE;
    process.env.CCLAW_DISABLE = "1";
    try {
      const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
      const pluginFactory = imported.default as (ctx: { directory: string }) => {
        "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
      };
      const plugin = pluginFactory({ directory: root });

      await expect(
        plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
      ).resolves.toBeUndefined();

      const logPath = path.join(root, ".cclaw/logs/opencode-plugin.log");
      const log = await fs.readFile(logPath, "utf8");
      expect(log).toMatch(/guards disabled by env CCLAW_DISABLE=1/);
    } finally {
      if (previous === undefined) {
        delete process.env.CCLAW_DISABLE;
      } else {
        process.env.CCLAW_DISABLE = previous;
      }
    }
  });

  it("opencode plugin names failing guard and includes stderr + recovery hint", async () => {
    const root = await createTempProject("opencode-actionable-error");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", activeRunId: "active", completedStages: ["brainstorm"] }, null, 2),
      "utf8"
    );
    // Strict config is required for the thrown-error path; advisory
    // mode logs and lets the tool through.
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), "strictness: strict\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node
if ((process.argv[2] || "") === "workflow-guard") {
  process.stderr.write("workflow boundary failed: missing evidence for gate X");
  process.exit(1);
}
process.exit(0);
`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);
    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).rejects.toThrow(/cclaw workflow-guard blocked tool\.execute\.before/);
    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).rejects.toThrow(/workflow boundary failed: missing evidence/);
    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).rejects.toThrow(/npx cclaw-cli doctor/);
    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).rejects.toThrow(/CCLAW_DISABLE=1/);
  });

  it("opencode plugin defaults to advisory: logs without throwing when guard exits non-zero", async () => {
    const root = await createTempProject("opencode-advisory-default");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", activeRunId: "active", completedStages: ["brainstorm"] }, null, 2),
      "utf8"
    );
    // NOTE: no config.yaml and no CCLAW_STRICTNESS — should default to advisory.
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node
if ((process.argv[2] || "") === "workflow-guard") {
  process.stderr.write("workflow guard refused: pretend a gate failed");
  process.exit(1);
}
process.exit(0);
`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);
    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).resolves.toBeUndefined();

    const logPath = path.join(root, ".cclaw/logs/opencode-plugin.log");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toMatch(/advisory: workflow-guard flagged tool\.execute\.before/);
  });

  it("opencode plugin bypasses guards for ask / question / todo / think tools", async () => {
    const root = await createTempProject("opencode-readonly-bypass-extended");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", activeRunId: "active", completedStages: [] }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), "strictness: strict\n", "utf8");
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node\nprocess.stderr.write("should not run");\nprocess.exit(1);\n`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);
    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    for (const tool of [
      "question",
      "Question",
      "AskUserQuestion",
      "ask_user_question",
      "request_user_input",
      "TodoWrite",
      "todoread",
      "think",
      "prompt"
    ]) {
      await expect(
        plugin["tool.execute.before"]({ tool, tool_input: {} })
      ).resolves.toBeUndefined();
    }
  });

  it("opencode plugin never blocks on infra-looking stderr under strict mode", async () => {
    const root = await createTempProject("opencode-infra-noise");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({ currentStage: "scope", activeRunId: "active", completedStages: ["brainstorm"] }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(root, ".cclaw/config.yaml"), "strictness: strict\n", "utf8");
    // Emit yargs-style help to stderr (mimics the real-world regression
    // where a misrouted child process printed CLI help instead of a
    // guard refusal).
    await fs.writeFile(
      path.join(root, ".cclaw/hooks/run-hook.mjs"),
      `#!/usr/bin/env node
process.stderr.write([
  "Options:",
  "  -s, --session      session id to continue                              [string]",
  "      --fork         fork the session when continuing                    [boolean]",
  "      --prompt       prompt to use                                       [string]"
].join("\\n"));
process.exit(1);
`,
      "utf8"
    );
    await fs.chmod(path.join(root, ".cclaw/hooks/run-hook.mjs"), 0o755);
    const pluginPath = path.join(root, ".cclaw/hooks/opencode-plugin.mjs");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");

    const imported = await import(`${pathToFileURL(pluginPath).href}?t=${Date.now()}`);
    const pluginFactory = imported.default as (ctx: { directory: string }) => {
      "tool.execute.before": (input: unknown, output?: unknown) => Promise<void>;
    };
    const plugin = pluginFactory({ directory: root });

    await expect(
      plugin["tool.execute.before"]({ tool: "RunCommand", tool_input: { cmd: "echo test" } })
    ).resolves.toBeUndefined();

    const logPath = path.join(root, ".cclaw/logs/opencode-plugin.log");
    const log = await fs.readFile(logPath, "utf8");
    expect(log).toMatch(/infra: (prompt|workflow)-guard non-zero exit with non-guard stderr/);
  });
});
