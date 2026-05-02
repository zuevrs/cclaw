import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { nodeHookRuntimeScript } from "../../src/content/node-hooks.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import {
  ensureRunSystem,
  flowStateGuardSidecarPathFor,
  writeFlowState
} from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

async function runScript(
  projectRoot: string,
  scriptPath: string,
  args: string[],
  stdinPayload: string | null = null
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: projectRoot,
      env: { ...process.env, CCLAW_PROJECT_ROOT: projectRoot }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    if (stdinPayload !== null) {
      child.stdin?.write(stdinPayload);
    }
    child.stdin?.end();
  });
}

async function seedTamperedFlowState(root: string): Promise<void> {
  await ensureRunSystem(root);
  await writeFlowState(
    root,
    createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
    { allowReset: true }
  );
  const statePath = path.join(root, ".cclaw", "state", "flow-state.json");
  const raw = await fs.readFile(statePath, "utf8");
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  parsed.currentStage = "plan";
  await fs.writeFile(statePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
}

describe("hook-guard: manual edits to flow-state.json are hard-blocked", () => {
  it("session-start exits 2 with guard mismatch message on tampered flow-state", async () => {
    const root = await createTempProject("hook-guard-session-start");
    await seedTamperedFlowState(root);
    const scriptPath = path.join(root, ".cclaw/hooks/run-hook.mjs");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, nodeHookRuntimeScript(), "utf8");
    const result = await runScript(root, scriptPath, ["session-start"], "{}");
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/flow-state guard mismatch/u);
    expect(result.stderr).toMatch(/cclaw-cli internal flow-state-repair/u);
  });

  it("stop-handoff exits 2 with guard mismatch message on tampered flow-state", async () => {
    const root = await createTempProject("hook-guard-stop-handoff");
    await seedTamperedFlowState(root);
    const scriptPath = path.join(root, ".cclaw/hooks/run-hook.mjs");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, nodeHookRuntimeScript(), "utf8");
    const result = await runScript(root, scriptPath, ["stop-handoff"], "{}");
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/flow-state guard mismatch/u);
  });

  it("delegation-record exits 2 with guard mismatch message on tampered flow-state", async () => {
    const root = await createTempProject("hook-guard-delegation-record");
    await seedTamperedFlowState(root);
    const scriptPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, delegationRecordScript(), "utf8");
    const result = await runScript(root, scriptPath, [
      "--stage=scope",
      "--agent=guard-test",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-guard"
    ]);
    expect(result.code).toBe(2);
    expect(result.stderr).toMatch(/flow-state guard mismatch/u);
  });

  it("does not block hooks when flow-state.json matches the sidecar", async () => {
    const root = await createTempProject("hook-guard-happy");
    await ensureRunSystem(root);
    await writeFlowState(
      root,
      createInitialFlowState({ track: "standard", discoveryMode: "guided" }),
      { allowReset: true }
    );
    // Sanity check — sidecar was written
    await fs.access(flowStateGuardSidecarPathFor(root));
    const scriptPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await fs.mkdir(path.dirname(scriptPath), { recursive: true });
    await fs.writeFile(scriptPath, delegationRecordScript(), "utf8");
    const result = await runScript(root, scriptPath, [
      "--stage=brainstorm",
      "--agent=guard-test",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-guard-ok"
    ]);
    // The happy-path of delegation-record returns 0 or prints a stdout blob;
    // guard should NOT set exit 2.
    expect(result.code).not.toBe(2);
  });
});
