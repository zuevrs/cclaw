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

async function setupHook(projectRoot: string): Promise<string> {
  await ensureRunSystem(projectRoot);
  const scriptPath = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, delegationRecordScript(), "utf8");
  return scriptPath;
}

function runScript(projectRoot: string, scriptPath: string, args: string[]): Promise<RunResult> {
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
  });
}

interface SubagentsTracker {
  active: Array<{ spanId?: string; status?: string }>;
}

async function readTracker(projectRoot: string): Promise<SubagentsTracker> {
  const raw = await fs.readFile(
    path.join(projectRoot, ".cclaw/state/subagents.json"),
    "utf8"
  );
  return JSON.parse(raw) as SubagentsTracker;
}

describe("e2e: sequential slice-implementer cycles", () => {
  it("runs five sequential slice-implementer cycles for the same agent without dispatch_duplicate", async () => {
    const root = await createTempProject("e2e-flow-tdd-cycles");
    const scriptPath = await setupHook(root);

    const agentDefDir = path.join(root, ".cclaw", "agents");
    await fs.mkdir(agentDefDir, { recursive: true });
    const agentDefRel = ".cclaw/agents/slice-implementer.md";
    await fs.writeFile(path.join(root, agentDefRel), "# slice-implementer\n", "utf8");

    for (let cycle = 1; cycle <= 5; cycle += 1) {
      const span = `span-S-${cycle}`;
      const dispatch = `dispatch-S-${cycle}`;

      const scheduled = await runScript(root, scriptPath, [
        "--stage=tdd",
        "--agent=slice-implementer",
        "--mode=mandatory",
        "--status=scheduled",
        `--span-id=${span}`,
        `--dispatch-id=${dispatch}`,
        "--dispatch-surface=cursor-task",
        `--agent-definition-path=${agentDefRel}`,
        "--json"
      ]);
      expect(scheduled.code, `cycle ${cycle} scheduled stderr=${scheduled.stderr}`).toBe(0);

      const launched = await runScript(root, scriptPath, [
        "--stage=tdd",
        "--agent=slice-implementer",
        "--mode=mandatory",
        "--status=launched",
        `--span-id=${span}`,
        `--dispatch-id=${dispatch}`,
        "--dispatch-surface=cursor-task",
        `--agent-definition-path=${agentDefRel}`,
        "--json"
      ]);
      expect(launched.code, `cycle ${cycle} launched stderr=${launched.stderr}`).toBe(0);

      const acknowledged = await runScript(root, scriptPath, [
        "--stage=tdd",
        "--agent=slice-implementer",
        "--mode=mandatory",
        "--status=acknowledged",
        `--span-id=${span}`,
        `--dispatch-id=${dispatch}`,
        "--dispatch-surface=cursor-task",
        `--agent-definition-path=${agentDefRel}`,
        "--json"
      ]);
      expect(acknowledged.code, `cycle ${cycle} acknowledged stderr=${acknowledged.stderr}`).toBe(0);

      const completed = await runScript(root, scriptPath, [
        "--stage=tdd",
        "--agent=slice-implementer",
        "--mode=mandatory",
        "--status=completed",
        `--span-id=${span}`,
        `--dispatch-id=${dispatch}`,
        "--dispatch-surface=cursor-task",
        `--agent-definition-path=${agentDefRel}`,
        "--evidence-ref=tdd:S-1-evidence",
        "--json"
      ]);
      expect(
        completed.code,
        `cycle ${cycle} completed stdout=${completed.stdout} stderr=${completed.stderr}`
      ).toBe(0);

      // After each completed cycle, subagents.json must show no active span for
      // this (stage, agent) pair so the next scheduled write is allowed.
      const tracker = await readTracker(root);
      const activeForPair = tracker.active.filter(
        (entry) => entry.status !== "completed" && entry.status !== "stale"
      );
      expect(activeForPair, `tracker not drained after cycle ${cycle}`).toEqual([]);
    }

    // Final state: ledger has 20 rows (5 spans × 4 statuses) and the
    // tracker is empty.
    const ledgerRaw = await fs.readFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      "utf8"
    );
    const ledger = JSON.parse(ledgerRaw) as {
      entries: Array<{ spanId: string; status: string }>;
    };
    expect(ledger.entries.length).toBe(20);
    const finalTracker = await readTracker(root);
    expect(finalTracker.active).toEqual([]);
  });
});
