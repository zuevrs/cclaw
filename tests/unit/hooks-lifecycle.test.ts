import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  opencodePluginJs,
  preCompactScript,
  sessionStartScript,
  stageCompleteScript,
  stopCheckpointScript
} from "../../src/content/hooks.js";
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
    // Codex CLI v0.114+ emits only `startup` and `resume` — there is no
    // `clear` or `compact` lifecycle phase in Codex.
    expect(codex.hooks.SessionStart[0]?.matcher).toBe("startup|resume");
    expect((claude as { cclawHookSchemaVersion?: number }).cclawHookSchemaVersion).toBe(1);
    expect((codex as { cclawHookSchemaVersion?: number }).cclawHookSchemaVersion).toBe(1);
    expect(JSON.stringify(claude)).toContain("run-hook.cmd");
    expect(JSON.stringify(claude)).toContain("prompt-guard.sh");
    expect(JSON.stringify(claude)).toContain("workflow-guard.sh");
    expect(JSON.stringify(claude)).toContain("context-monitor.sh");
    expect(JSON.stringify(codex)).toContain("run-hook.cmd");
    expect(JSON.stringify(codex)).toContain("prompt-guard.sh");
    expect(JSON.stringify(codex)).toContain("workflow-guard.sh");
    expect(JSON.stringify(codex)).toContain("context-monitor.sh");
    expect(JSON.stringify(codex)).toContain("verify-current-state --quiet");
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
    expect(JSON.stringify(cursor)).toContain("run-hook.cmd");
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
    expect(script).toContain("knowledge.jsonl");
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
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), [
      JSON.stringify({
        type: "pattern",
        trigger: "when a single PR spans multiple unrelated changes",
        action: "split broad changes into small focused diffs before review",
        confidence: "high",
        domain: "review",
        stage: "review",
        created: "2026-01-01T00:00:00Z",
        project: "cclaw"
      })
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
    expect(context).toContain("Knowledge digest");
    expect(context).toContain("split broad changes into small focused diffs");
    const digest = await fs.readFile(path.join(root, ".cclaw/state/knowledge-digest.md"), "utf8");
    expect(digest).toContain("Knowledge digest (auto-generated)");
    expect(digest).toContain("split broad changes into small focused diffs");
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

  it("stage-complete helper delegates to internal advance-stage", async () => {
    const root = await createTempProject("stage-complete-helper");
    const hooksDir = path.join(root, ".cclaw/hooks");
    await fs.mkdir(hooksDir, { recursive: true });

    const binDir = path.join(root, "bin");
    await fs.mkdir(binDir, { recursive: true });
    const callsPath = path.join(root, "cclaw-calls.log");
    const cclawShimPath = path.join(binDir, "cclaw");
    await fs.writeFile(
      cclawShimPath,
      `#!/usr/bin/env bash
printf '%s\n' "$*" >> "${callsPath}"
`,
      "utf8"
    );
    await fs.chmod(cclawShimPath, 0o755);

    const result = await runScript(
      root,
      ".cclaw/hooks/stage-complete.sh",
      stageCompleteScript(),
      ["scope", "--passed=scope_contract_written"],
      "",
      { PATH: `${binDir}:${process.env.PATH ?? ""}` }
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe("");
    const calls = await fs.readFile(callsPath, "utf8");
    expect(calls).toContain("internal advance-stage scope --passed=scope_contract_written");
  });

  it("stage-complete helper fails closed when cclaw binary is unavailable", async () => {
    const root = await createTempProject("stage-complete-no-cclaw");
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    const result = await runScript(
      root,
      ".cclaw/hooks/stage-complete.sh",
      stageCompleteScript(),
      ["scope"],
      "",
      { PATH: "/usr/bin:/bin" }
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cclaw binary not found in PATH");
  });

  it("pre-compact digest reads gate state from stageGateCatalog", async () => {
    const root = await createTempProject("pre-compact-stage-catalog");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/hooks"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      track: "standard",
      activeRunId: "run-stage-catalog",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"],
      skippedStages: [],
      stageGateCatalog: {
        review: {
          passed: ["review_criticals_resolved"],
          blocked: ["review_security_attested"]
        }
      }
    }, null, 2), "utf8");

    const result = await runScript(
      root,
      ".cclaw/hooks/pre-compact.sh",
      preCompactScript()
    );
    expect(result.code).toBe(0);
    const digest = await fs.readFile(path.join(root, ".cclaw/state/session-digest.md"), "utf8");
    expect(digest).toContain("passed: review_criticals_resolved");
    expect(digest).toContain("blocked: review_security_attested");
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

  it("workflow guard blocks tdd production writes before RED in strict tdd mode", async () => {
    const root = await createTempProject("workflow-guard-tdd-need-red");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript({ tddEnforcementMode: "strict" }),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 1;\n"
        }
      })
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Write a failing test first");
  });

  it("workflow guard allows production writes in tdd when RED is open", async () => {
    const root = await createTempProject("workflow-guard-tdd-red-open");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({ ts: "2026-04-20T00:00:00Z", runId: "active", phase: "red" })
    ].join("\n"), "utf8");

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript({ tddEnforcementMode: "strict" }),
      [],
      JSON.stringify({
        tool_name: "Edit",
        tool_input: {
          path: "src/app.ts",
          old_string: "const old = 1;",
          new_string: "const next = 2;"
        }
      })
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("Write a failing test first");
  });

  it("workflow guard allows production writes in tdd after GREEN is done", async () => {
    const root = await createTempProject("workflow-guard-tdd-green-done");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({ ts: "2026-04-20T00:00:00Z", runId: "active", phase: "red" }),
      JSON.stringify({ ts: "2026-04-20T00:02:00Z", runId: "active", phase: "green" })
    ].join("\n"), "utf8");

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript({ tddEnforcementMode: "strict" }),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 3;\n"
        }
      })
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("Write a failing test first");
  });

  it("workflow guard fallback counting keeps runId isolation when jq/python are unusable", async () => {
    const root = await createTempProject("workflow-guard-runid-fallback");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-current",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"), [
      JSON.stringify({ ts: "2026-04-20T00:00:00Z", runId: "run-old", phase: "red" }),
      JSON.stringify({ ts: "2026-04-20T00:00:10Z", runId: "run-current", phase: "red" }),
      JSON.stringify({ ts: "2026-04-20T00:00:20Z", runId: "run-current", phase: "green" })
    ].join("\n"), "utf8");
    const binDir = path.join(root, "bin");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(path.join(binDir, "jq"), "#!/usr/bin/env bash\nexit 1\n", "utf8");
    await fs.writeFile(path.join(binDir, "python3"), "#!/usr/bin/env bash\nexit 1\n", "utf8");
    await fs.chmod(path.join(binDir, "jq"), 0o755);
    await fs.chmod(path.join(binDir, "python3"), 0o755);

    const result = await runScript(
      root,
      "workflow-guard.sh",
      workflowGuardScript({ tddEnforcementMode: "strict" }),
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const value = 42;\n"
        }
      }),
      { PATH: `${binDir}:/usr/bin:/bin` }
    );
    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain("Write a failing test first");
  });

  it("workflow guard classifies paths with tdd.testPathPatterns and tdd.productionPathPatterns", async () => {
    const root = await createTempProject("workflow-guard-tdd-pattern-routing");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "active",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");

    const script = workflowGuardScript({
      tddEnforcementMode: "strict",
      tddTestPathPatterns: ["**/*.unit.ts"],
      tddProductionPathPatterns: ["src/**"]
    });

    const testWrite = await runScript(
      root,
      "workflow-guard.sh",
      script,
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: "tests/math.unit.ts",
          content: "describe('math', () => {});\n"
        }
      })
    );
    expect(testWrite.code).toBe(0);

    const nonProdWrite = await runScript(
      root,
      "workflow-guard.sh",
      script,
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: "scripts/build.ts",
          content: "console.log('build');\n"
        }
      })
    );
    expect(nonProdWrite.code).toBe(0);

    const prodWrite = await runScript(
      root,
      "workflow-guard.sh",
      script,
      [],
      JSON.stringify({
        tool_name: "Write",
        tool_input: {
          path: "src/app.ts",
          content: "export const v = 1;\n"
        }
      })
    );
    expect(prodWrite.code).toBe(1);
    expect(prodWrite.stderr).toContain("Write a failing test first");
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
    const stopScriptPath = path.join(root, ".cclaw/hooks/stop-checkpoint.sh");
    const preCompactPath = path.join(root, ".cclaw/hooks/pre-compact.sh");
    const promptGuardPath = path.join(root, ".cclaw/hooks/prompt-guard.sh");
    const workflowGuardPath = path.join(root, ".cclaw/hooks/workflow-guard.sh");
    const contextMonitorPath = path.join(root, ".cclaw/hooks/context-monitor.sh");
    await fs.writeFile(pluginPath, opencodePluginJs(), "utf8");
    await fs.writeFile(stopScriptPath, stopCheckpointScript(), "utf8");
    await fs.writeFile(preCompactPath, preCompactScript(), "utf8");
    await fs.writeFile(promptGuardPath, promptGuardScript(), "utf8");
    await fs.writeFile(workflowGuardPath, workflowGuardScript(), "utf8");
    await fs.writeFile(contextMonitorPath, contextMonitorScript(), "utf8");
    await fs.chmod(stopScriptPath, 0o755);
    await fs.chmod(preCompactPath, 0o755);
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
    expect(sessionDigest).toContain("## Flow snapshot");
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
    expect(plugin).toContain('"session.updated"');
    expect(plugin).toContain('runHookScript("pre-compact.sh"');
    expect(plugin).toContain('"tool.execute.before"');
    expect(plugin).toContain('"tool.execute.after"');
    expect(plugin).not.toContain('eventType === "tool.execute.before"');
    expect(plugin).not.toContain('eventType === "tool.execute.after"');
    expect(plugin).toContain("prompt-guard.sh");
    expect(plugin).toContain("workflow-guard.sh");
    expect(plugin).toContain("context-monitor.sh");
    expect(plugin).toContain('"session.idle"');
    expect(plugin).toContain('"experimental.chat.system.transform"');
    expect(plugin).toContain("activeRunId");
    expect(plugin).not.toContain(".cclaw/runs/");
    expect(plugin).toContain("Knowledge digest");
    expect(plugin).toContain("Last session:");
    expect(plugin).toContain("Latest context warning:");
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
    await fs.writeFile(path.join(root, ".cclaw/hooks/prompt-guard.sh"), "#!/usr/bin/env bash\nexit 0\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/hooks/workflow-guard.sh"), "#!/usr/bin/env bash\nexit 1\n", "utf8");
    await fs.chmod(path.join(root, ".cclaw/hooks/prompt-guard.sh"), 0o755);
    await fs.chmod(path.join(root, ".cclaw/hooks/workflow-guard.sh"), 0o755);

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
