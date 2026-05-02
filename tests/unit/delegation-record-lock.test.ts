import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

function runDelegationRecord(
  projectRoot: string,
  args: string[]
): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    const script = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
    const chunks: string[] = [];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot,
      env: { ...process.env, CCLAW_PROJECT_ROOT: projectRoot }
    });
    child.stderr?.on("data", (chunk) => chunks.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stderr: chunks.join("") }));
  });
}

describe("delegation-record ledger lock", () => {
  it("exits 2 when delegation-log.json.lock cannot be acquired", async () => {
    const root = await createTempProject("delegation-record-lock-timeout");
    await ensureRunSystem(root);

    const stateDir = path.join(root, ".cclaw/state");
    await fs.mkdir(stateDir, { recursive: true });
    await fs.mkdir(path.join(stateDir, "delegation-log.json.lock"), { recursive: true });

    const hookPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, delegationRecordScript(), "utf8");

    const { code, stderr } = await runDelegationRecord(root, [
      "--stage=scope",
      "--agent=lock-test",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-lock-timeout"
    ]);

    expect(code).toBe(2);
    expect(stderr).toMatch(/timeout.*delegation-log\.json\.lock/iu);
  }, 8000);
});
