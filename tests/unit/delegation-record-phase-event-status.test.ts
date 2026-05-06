import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runDelegationRecord(
  projectRoot: string,
  args: string[]
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
    const stdout: string[] = [];
    const stderr: string[] = [];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot,
      env: { ...process.env, CCLAW_PROJECT_ROOT: projectRoot }
    });
    child.stdout?.on("data", (chunk) => stdout.push(chunk.toString()));
    child.stderr?.on("data", (chunk) => stderr.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({ code, stdout: stdout.join(""), stderr: stderr.join("") })
    );
  });
}

async function setupHook(root: string): Promise<void> {
  await ensureRunSystem(root);
  const hookPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, delegationRecordScript(), "utf8");
}

describe("delegation-record.mjs phase-event status validation (7.6.0)", () => {
  it("rejects --phase=red --status=acknowledged with phase_event_requires_completed_or_failed_status", async () => {
    const root = await createTempProject("hook-phase-acked");
    await setupHook(root);
    const result = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=acknowledged",
      "--span-id=dspan-phase-bad",
      "--slice=S-41",
      "--phase=red",
      "--json"
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("phase_event_requires_completed_or_failed_status");
    expect(result.stdout).toContain("--status=completed --phase=red");
    expect(result.stdout).toContain("--slice=S-41");
  });

  it("rejects --phase=doc --status=acknowledged (the hox W-08/S-41 bug)", async () => {
    const root = await createTempProject("hook-phase-doc-acked");
    await setupHook(root);
    const result = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=acknowledged",
      "--span-id=dspan-doc-bad",
      "--slice=S-41",
      "--phase=doc",
      "--json"
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("phase_event_requires_completed_or_failed_status");
    expect(result.stdout).toContain("--status=completed --phase=doc");
  });

  it("accepts dispatch-level --status=acknowledged when no --phase is set", async () => {
    const root = await createTempProject("hook-dispatch-ack");
    await setupHook(root);
    const result = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=acknowledged",
      "--span-id=dspan-ack-ok",
      "--slice=S-1",
      "--ack-ts=2026-05-06T00:00:00Z",
      "--json"
    ]);
    expect(result.code, result.stderr).toBe(0);
    const ledgerRaw = await fs.readFile(path.join(root, ".cclaw/state/delegation-log.json"), "utf8");
    const ledger = JSON.parse(ledgerRaw) as { entries: Array<{ status: string; phase?: string }> };
    expect(ledger.entries[0]?.status).toBe("acknowledged");
    expect(ledger.entries[0]?.phase).toBeUndefined();
  });

  it("rejects --phase=refactor-deferred --status=acknowledged", async () => {
    const root = await createTempProject("hook-refdef-acked");
    await setupHook(root);
    const result = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=acknowledged",
      "--span-id=dspan-refdef-bad",
      "--slice=S-1",
      "--phase=refactor-deferred",
      "--json"
    ]);
    expect(result.code).toBe(2);
    expect(result.stdout).toContain("phase_event_requires_completed_or_failed_status");
  });

  it("accepts --phase=red --status=failed (BLOCKED outcome)", async () => {
    const root = await createTempProject("hook-phase-failed");
    await setupHook(root);
    const result = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=failed",
      "--span-id=dspan-blocked",
      "--slice=S-2",
      "--phase=red",
      "--evidence-ref=BLOCKED: cannot reproduce upstream",
      "--json"
    ]);
    expect(result.code, result.stderr).toBe(0);
  });
});
