import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createTempProject } from "../helpers/index.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";

async function installHookScript(root: string): Promise<string> {
  const scriptPath = path.join(root, "run-hook.mjs");
  await fs.writeFile(scriptPath, nodeHookRuntimeScript(), "utf8");
  await fs.chmod(scriptPath, 0o755);
  return scriptPath;
}

function runHookOnce(
  scriptPath: string,
  cwd: string,
  hookName: string,
  payload: unknown
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [scriptPath, hookName], {
      cwd,
      env: { ...process.env, CCLAW_PROJECT_ROOT: cwd }
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("close", (code) => resolve({ code, stderr }));
    child.stdin.write(typeof payload === "string" ? payload : JSON.stringify(payload));
    child.stdin.end();
  });
}

describe("hook atomic/locked state writes", () => {
  it("parallel stop-handoff invocations write a valid stop-block counter (no torn writes)", async () => {
    const root = await createTempProject("atomic-hook");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "review",
      activeRunId: "run-concurrent",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan", "tdd"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# using\n", "utf8");
    await fs.writeFile(path.join(root, "dirty.txt"), "dirty\n", "utf8");
    await new Promise<void>((resolve, reject) => {
      const child = spawn("git", ["init"], { cwd: root, env: process.env });
      child.on("error", reject);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error("git init failed"))));
    });

    const scriptPath = await installHookScript(root);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        runHookOnce(scriptPath, root, "stop-handoff", { transcript_id: "parallel-stop" })
      )
    );
    expect(results.some((result) => result.code === 1)).toBe(true);

    const stopBlocksRaw = await fs.readFile(
      path.join(root, ".cclaw/state/stop-blocks-parallel-stop.json"),
      "utf8"
    );
    const parsed = JSON.parse(stopBlocksRaw) as { blockCount: number };
    // Concurrent hooks are lock-safe at the file level, but increment order is
    // intentionally best-effort; both 1 and 2 are valid under the max-2 cap.
    expect(parsed.blockCount).toBeGreaterThanOrEqual(1);
    expect(parsed.blockCount).toBeLessThanOrEqual(2);
  });

  it("records a breadcrumb when flow-state.json is corrupt instead of silently fallbacking", async () => {
    const root = await createTempProject("corrupt-flow-state");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    // Intentionally broken JSON.
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), "{not: valid json", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# using\n", "utf8");

    const scriptPath = await installHookScript(root);
    const result = await runHookOnce(scriptPath, root, "session-start", {});
    expect(result.code, result.stderr).toBe(0);

    const errorsRaw = await fs.readFile(
      path.join(root, ".cclaw/state/hook-errors.jsonl"),
      "utf8"
    );
    expect(errorsRaw).toContain("corrupt-json");
    expect(errorsRaw).toContain("read-flow-state");
  });
});
