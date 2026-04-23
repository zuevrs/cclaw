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
  it("parallel session-start invocations write a valid ralph-loop.json (no torn writes)", async () => {
    const root = await createTempProject("atomic-hook");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/contexts"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/skills/using-cclaw"), { recursive: true });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), JSON.stringify({
      currentStage: "tdd",
      activeRunId: "run-concurrent",
      completedStages: ["brainstorm", "scope", "design", "spec", "plan"]
    }, null, 2), "utf8");
    await fs.writeFile(path.join(root, ".cclaw/contexts/tdd.md"), "# tdd\n", "utf8");
    await fs.writeFile(path.join(root, ".cclaw/skills/using-cclaw/SKILL.md"), "# using\n", "utf8");

    const log = Array.from({ length: 20 }, (_, i) => ({
      runId: "run-concurrent",
      stage: "tdd",
      ts: `2026-04-01T00:00:${String(i).padStart(2, "0")}Z`,
      slice: `S-${(i % 3) + 1}`,
      phase: i % 2 === 0 ? "red" : "green",
      command: "vitest",
      exitCode: i % 2 === 0 ? 1 : 0
    }));
    await fs.writeFile(
      path.join(root, ".cclaw/state/tdd-cycle-log.jsonl"),
      log.map((row) => JSON.stringify(row)).join("\n") + "\n",
      "utf8"
    );

    const scriptPath = await installHookScript(root);

    // Fire 8 parallel session-start hooks. Without atomic+locked writes,
    // we see torn JSON or EEXIST errors; with them, every run succeeds
    // and the final file is parseable.
    const results = await Promise.all(
      Array.from({ length: 8 }, () => runHookOnce(scriptPath, root, "session-start", {}))
    );
    for (const result of results) {
      expect(result.code, result.stderr).toBe(0);
    }

    const ralphRaw = await fs.readFile(
      path.join(root, ".cclaw/state/ralph-loop.json"),
      "utf8"
    );
    expect(() => JSON.parse(ralphRaw)).not.toThrow();

    const compoundRaw = await fs.readFile(
      path.join(root, ".cclaw/state/compound-readiness.json"),
      "utf8"
    );
    expect(() => JSON.parse(compoundRaw)).not.toThrow();
  });

  it("records a breadcrumb when flow-state.json is corrupt instead of silently fallbacking", async () => {
    const root = await createTempProject("corrupt-flow-state");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/contexts"), { recursive: true });
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
