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

describe("delegation-record ledger concurrency", () => {
  it("serializes parallel persistEntry updates without losing ledger rows", async () => {
    const root = await createTempProject("delegation-record-concurrency");
    const flowState = await ensureRunSystem(root);
    const runId = flowState.activeRunId;

    const hookPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
    await fs.mkdir(path.dirname(hookPath), { recursive: true });
    await fs.writeFile(hookPath, delegationRecordScript(), "utf8");

    const n = 10;
    const results = await Promise.all(
      Array.from({ length: n }, (_, i) =>
        runDelegationRecord(root, [
          "--stage=scope",
          `--agent=concurrency-agent-${i}`,
          "--mode=mandatory",
          "--status=scheduled",
          `--span-id=span-concurrent-${i}`
        ])
      )
    );

    for (const r of results) {
      expect(r.code, r.stderr).toBe(0);
    }

    const ledgerRaw = await fs.readFile(path.join(root, ".cclaw/state/delegation-log.json"), "utf8");
    const ledger = JSON.parse(ledgerRaw) as { runId: string; entries: { spanId: string; agent: string }[] };
    expect(ledger.runId).toBe(runId);
    expect(ledger.entries.length).toBe(n);
    const spanIds = new Set(ledger.entries.map((e) => e.spanId));
    expect(spanIds.size).toBe(n);
  });
});
