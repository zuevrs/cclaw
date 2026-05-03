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
  active: Array<{
    spanId?: string;
    status?: string;
    stage?: string;
    agent?: string;
    allowParallel?: boolean;
  }>;
}

async function readTracker(projectRoot: string): Promise<SubagentsTracker> {
  const raw = await fs.readFile(
    path.join(projectRoot, ".cclaw/state/subagents.json"),
    "utf8"
  );
  return JSON.parse(raw) as SubagentsTracker;
}

describe("e2e: delegation-record hook full lifecycle", () => {
  it("rejects --ack-ts earlier than --launched-ts with delegation_timestamp_non_monotonic", async () => {
    const root = await createTempProject("hooks-lifecycle-monotonic");
    const scriptPath = await setupHook(root);
    const span = "span-monotonic";
    const dispatchId = "dispatch-monotonic";
    // launched-ts must be >= row startTs (which the inline hook anchors at "now"
    // when the span has no prior row), so we pick timestamps in the future
    // relative to test execution time.
    const inOneHour = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const inTwoHours = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

    const agentDefRel = ".cclaw/agents/monotonic-critic.md";
    await fs.mkdir(path.join(root, ".cclaw", "agents"), { recursive: true });
    await fs.writeFile(path.join(root, agentDefRel), "# critic\n", "utf8");

    const result = await runScript(root, scriptPath, [
      "--stage=scope",
      "--agent=critic",
      "--mode=mandatory",
      "--status=acknowledged",
      `--span-id=${span}`,
      `--dispatch-id=${dispatchId}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentDefRel}`,
      `--launched-ts=${inTwoHours}`,
      `--ack-ts=${inOneHour}`,
      "--json"
    ]);
    expect(result.code).toBe(2);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error: string;
      details: { field: string; actual: string; bound: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("delegation_timestamp_non_monotonic");
    expect(payload.details.field).toBe("ackTs");
    expect(payload.details.actual).toBe(inOneHour);
    expect(payload.details.bound).toBe(inTwoHours);
  });

  it("rejects a duplicate scheduled span on same (stage, agent) with dispatch_duplicate", async () => {
    const root = await createTempProject("hooks-lifecycle-dispatch-dup");
    const scriptPath = await setupHook(root);

    const first = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-dup-1",
      "--json"
    ]);
    expect(first.code, first.stderr).toBe(0);

    const second = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-dup-2",
      "--json"
    ]);
    expect(second.code).toBe(2);
    const payload = JSON.parse(second.stdout) as {
      ok: boolean;
      error: string;
      details: { existingSpanId: string; newSpanId: string; pair: { stage: string; agent: string } };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("dispatch_duplicate");
    expect(payload.details.existingSpanId).toBe("span-dup-1");
    expect(payload.details.newSpanId).toBe("span-dup-2");
    expect(payload.details.pair).toEqual({ stage: "design", agent: "critic" });
  });

  it("--supersede=<id> closes the previous span and records the new scheduled row", async () => {
    const root = await createTempProject("hooks-lifecycle-supersede");
    const scriptPath = await setupHook(root);

    const first = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-prev",
      "--json"
    ]);
    expect(first.code, first.stderr).toBe(0);

    const second = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-next",
      "--supersede=span-prev",
      "--json"
    ]);
    expect(second.code, second.stderr).toBe(0);

    const tracker = await readTracker(root);
    expect(tracker.active.map((a) => a.spanId)).toEqual(["span-next"]);

    const ledgerRaw = await fs.readFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      "utf8"
    );
    const ledger = JSON.parse(ledgerRaw) as {
      entries: Array<{ spanId: string; status: string; supersededBy?: string }>;
    };
    const stale = ledger.entries.find(
      (e) => e.spanId === "span-prev" && e.status === "stale"
    );
    expect(stale).toBeDefined();
    expect(stale?.supersededBy).toBe("span-next");
  });

  it("--allow-parallel records both spans in active and tags them allowParallel", async () => {
    const root = await createTempProject("hooks-lifecycle-allow-parallel");
    const scriptPath = await setupHook(root);

    const first = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=researcher",
      "--mode=proactive",
      "--status=scheduled",
      "--span-id=span-par-1",
      "--json"
    ]);
    expect(first.code, first.stderr).toBe(0);

    const second = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=researcher",
      "--mode=proactive",
      "--status=scheduled",
      "--span-id=span-par-2",
      "--allow-parallel",
      "--json"
    ]);
    expect(second.code, second.stderr).toBe(0);

    const tracker = await readTracker(root);
    expect(tracker.active.map((a) => a.spanId).sort()).toEqual([
      "span-par-1",
      "span-par-2"
    ]);
    const par2 = tracker.active.find((a) => a.spanId === "span-par-2");
    expect(par2?.allowParallel).toBe(true);
  });

  it("--supersede=<wrongId> rejects with mismatch error", async () => {
    const root = await createTempProject("hooks-lifecycle-supersede-mismatch");
    const scriptPath = await setupHook(root);

    await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-actual",
      "--json"
    ]);

    const result = await runScript(root, scriptPath, [
      "--stage=design",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      "--span-id=span-second",
      "--supersede=span-bogus",
      "--json"
    ]);
    expect(result.code).toBe(2);
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      error: string;
      details: { requested: string; actualActiveSpanId: string };
    };
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("dispatch_supersede_mismatch");
    expect(payload.details.requested).toBe("span-bogus");
    expect(payload.details.actualActiveSpanId).toBe("span-actual");
  });

  it("drives a span through scheduled→launched→acknowledged→completed and ends with empty active set", async () => {
    const root = await createTempProject("hooks-lifecycle-full");
    const scriptPath = await setupHook(root);
    const span = "span-lifecycle-1";
    const dispatchId = "dispatch-lifecycle-1";

    const agentDefDir = path.join(root, ".cclaw", "agents");
    await fs.mkdir(agentDefDir, { recursive: true });
    const agentDefRel = ".cclaw/agents/lifecycle-critic.md";
    await fs.writeFile(path.join(root, agentDefRel), "# critic\n", "utf8");

    let result = await runScript(root, scriptPath, [
      "--stage=scope",
      "--agent=critic",
      "--mode=mandatory",
      "--status=scheduled",
      `--span-id=${span}`,
      `--dispatch-id=${dispatchId}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentDefRel}`,
      "--json"
    ]);
    expect(result.code, result.stderr).toBe(0);

    let tracker = await readTracker(root);
    expect(tracker.active).toHaveLength(1);
    expect(tracker.active[0]?.status).toBe("scheduled");

    result = await runScript(root, scriptPath, [
      "--stage=scope",
      "--agent=critic",
      "--mode=mandatory",
      "--status=launched",
      `--span-id=${span}`,
      `--dispatch-id=${dispatchId}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentDefRel}`,
      "--json"
    ]);
    expect(result.code, result.stderr).toBe(0);

    tracker = await readTracker(root);
    expect(tracker.active).toHaveLength(1);
    expect(tracker.active[0]?.status).toBe("launched");

    result = await runScript(root, scriptPath, [
      "--stage=scope",
      "--agent=critic",
      "--mode=mandatory",
      "--status=acknowledged",
      `--span-id=${span}`,
      `--dispatch-id=${dispatchId}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentDefRel}`,
      "--json"
    ]);
    expect(result.code, result.stderr).toBe(0);

    tracker = await readTracker(root);
    expect(tracker.active).toHaveLength(1);
    expect(tracker.active[0]?.status).toBe("acknowledged");

    result = await runScript(root, scriptPath, [
      "--stage=scope",
      "--agent=critic",
      "--mode=mandatory",
      "--status=completed",
      `--span-id=${span}`,
      `--dispatch-id=${dispatchId}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentDefRel}`,
      "--evidence-ref=design-artifact#critic",
      "--json"
    ]);
    expect(result.code, result.stderr).toBe(0);

    tracker = await readTracker(root);
    expect(tracker.active).toEqual([]);
  });
});
