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
  input: unknown = {}
): Promise<RuntimeResult> {
  const scriptPath = path.join(root, "run-hook.mjs");
  await fs.writeFile(scriptPath, scriptBody, "utf8");
  await fs.chmod(scriptPath, 0o755);
  const payload = typeof input === "string" ? input : JSON.stringify(input);

  return await new Promise<RuntimeResult>((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, hookName], {
      cwd: root,
      env: {
        ...process.env,
        CCLAW_PROJECT_ROOT: root
      }
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
    child.stdin.write(payload);
    child.stdin.end();
  });
}

async function runCommand(
  command: string,
  args: string[],
  cwd: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: process.env });
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
  });
}

async function seedFlowState(root: string, stage = "review"): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    JSON.stringify({
      currentStage: stage,
      activeRunId: "run-node",
      completedStages: ["brainstorm", "scope", "design"]
    }, null, 2),
    "utf8"
  );
  await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), "", "utf8");
  await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");
}

async function seedDirtyGitTree(root: string): Promise<void> {
  const initResult = await runCommand("git", ["init"], root);
  if (initResult.code !== 0) {
    throw new Error(`git init failed: ${initResult.stderr}`);
  }
  await fs.writeFile(path.join(root, "dirty.txt"), "dirty\n", "utf8");
}

describe("node hook runtime", () => {
  it("session-start emits bootstrap context with stage/run", async () => {
    const root = await createTempProject("node-hook-session-start-minimal");
    await seedFlowState(root, "scope");

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);

    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context = payload.hookSpecificOutput?.additionalContext ?? payload.additional_context ?? "";
    expect(context).toContain("cclaw loaded. Flow: stage=scope");
    expect(context).toContain("run=run-node");
  });

  it("session-start surfaces adaptive skip-questions hints", async () => {
    const root = await createTempProject("node-hook-session-start-hints");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/state/flow-state.json"),
      JSON.stringify({
        currentStage: "scope",
        activeRunId: "run-hint",
        completedStages: ["brainstorm"],
        interactionHints: {
          scope: {
            skipQuestions: true,
            sourceStage: "brainstorm",
            recordedAt: "2026-04-29T12:00:00.000Z"
          }
        }
      }, null, 2),
      "utf8"
    );
    await fs.writeFile(path.join(root, ".cclaw/knowledge.jsonl"), "", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# Using cclaw\n", "utf8");

    const result = await runNodeHook(root, "session-start", nodeHookRuntimeScript());
    expect(result.code).toBe(0);
    const payload = JSON.parse(result.stdout) as {
      hookSpecificOutput?: { additionalContext?: string };
      additional_context?: string;
    };
    const context = payload.hookSpecificOutput?.additionalContext ?? payload.additional_context ?? "";
    expect(context).toContain("Adaptive elicitation hint");
    expect(context).toContain("--skip-questions");
  });

  it("stop-handoff blocks dirty tree", async () => {
    const root = await createTempProject("node-hook-stop-handoff-dirty");
    await seedFlowState(root);
    await seedDirtyGitTree(root);

    const result = await runNodeHook(root, "stop-handoff", nodeHookRuntimeScript(), {
      transcript_id: "dirty-case"
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Stop blocked by iron law");
  });

  it("stop-handoff bypasses block on safety context-limit signal", async () => {
    const root = await createTempProject("node-hook-stop-handoff-bypass");
    await seedFlowState(root);
    await seedDirtyGitTree(root);

    const result = await runNodeHook(root, "stop-handoff", nodeHookRuntimeScript(), {
      transcript_id: "bypass-case",
      context_limit: true
    });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain("bypassing strict stop block due to safety rule");
  });

  it("stop-handoff caps dirty-tree hard blocks to two per transcript", async () => {
    const root = await createTempProject("node-hook-stop-handoff-cap");
    await seedFlowState(root);
    await seedDirtyGitTree(root);
    const script = nodeHookRuntimeScript();
    const payload = { transcript_id: "cap-case" };

    const first = await runNodeHook(root, "stop-handoff", script, payload);
    const second = await runNodeHook(root, "stop-handoff", script, payload);
    const third = await runNodeHook(root, "stop-handoff", script, payload);

    expect(first.code).toBe(1);
    expect(second.code).toBe(1);
    expect(third.code).toBe(0);
    expect(third.stderr).toContain("block limit reached");

    const stopBlockPath = path.join(root, ".cclaw/state/stop-blocks-cap-case.json");
    const stopBlock = JSON.parse(await fs.readFile(stopBlockPath, "utf8")) as { blockCount: number };
    expect(stopBlock.blockCount).toBe(2);
  });

  it("rejects unsupported hook names with usage output", async () => {
    const root = await createTempProject("node-hook-unsupported");
    await seedFlowState(root);
    const result = await runNodeHook(root, "workflow-guard", nodeHookRuntimeScript(), {});
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("<session-start|stop-handoff>");
  });
});
