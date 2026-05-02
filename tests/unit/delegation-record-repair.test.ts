import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

async function writeRepairFixture(root: string): Promise<void> {
  await ensureRunSystem(root);
  const runId = "run-repair-test";
  const flowPath = path.join(root, ".cclaw/state/flow-state.json");
  const raw = JSON.parse(await fs.readFile(flowPath, "utf8")) as { activeRunId?: string };
  raw.activeRunId = runId;
  await fs.writeFile(flowPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  const agentPath = ".cclaw/agents/researcher.md";
  await writeProjectFile(root, agentPath, "# stub\n");

  const scheduled = {
    stage: "brainstorm",
    agent: "researcher",
    mode: "proactive",
    status: "scheduled",
    spanId: "span-repair-1",
    runId,
    dispatchId: "disp-1",
    dispatchSurface: "cursor-task",
    agentDefinitionPath: agentPath,
    fulfillmentMode: "generic-dispatch",
    schemaVersion: 3,
    event: "scheduled",
    eventTs: "2026-05-01T00:00:00.000Z"
  };
  await fs.writeFile(
    path.join(root, ".cclaw/state/delegation-events.jsonl"),
    `${JSON.stringify(scheduled)}\n`,
    "utf8"
  );
}

async function runDelegationRecord(
  root: string,
  args: string[]
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const scriptPath = path.join(root, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(scriptPath), { recursive: true });
  await fs.writeFile(scriptPath, delegationRecordScript(), "utf8");
  await fs.chmod(scriptPath, 0o755);

  return await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: root,
      env: { ...process.env, CCLAW_PROJECT_ROOT: root, VITEST: "true" }
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (c) => {
      stdout += c.toString();
    });
    child.stderr?.on("data", (c) => {
      stderr += c.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

describe("delegation-record --repair", () => {
  it("exits 2 when --repair is missing --span-id or --repair-reason", async () => {
    const root = await createTempProject("delegation-repair-args");
    await writeRepairFixture(root);
    let r = await runDelegationRecord(root, ["--repair", "--repair-reason=x", "--json"]);
    expect(r.code).toBe(2);
    const firstErr = JSON.parse(r.stdout.trim()) as { problems: string[] };
    expect(firstErr.problems.join(" ").toLowerCase()).toContain("span-id");

    r = await runDelegationRecord(root, ["--repair", "--span-id=span-repair-1", "--json"]);
    expect(r.code).toBe(2);
    const secondErr = JSON.parse(r.stdout.trim()) as { problems: string[] };
    expect(secondErr.problems.join(" ").toLowerCase()).toContain("repair-reason");
  });

  it("refuses repair when span has no existing lifecycle events", async () => {
    const root = await createTempProject("delegation-repair-empty-span");
    await ensureRunSystem(root);
    await fs.writeFile(path.join(root, ".cclaw/state/delegation-events.jsonl"), "", "utf8");
    const r = await runDelegationRecord(root, [
      "--repair",
      "--span-id=missing",
      "--repair-reason=test",
      "--json"
    ]);
    expect(r.code).toBe(2);
    const body = JSON.parse(r.stdout.trim()) as { problems: string[] };
    expect(body.problems.join(" ").toLowerCase()).toMatch(/refused|no lifecycle/iu);
  });

  it("appends only missing lifecycle phases and is idempotent", async () => {
    const root = await createTempProject("delegation-repair-idempotent");
    await writeRepairFixture(root);
    const eventsPath = path.join(root, ".cclaw/state/delegation-events.jsonl");

    let r = await runDelegationRecord(root, [
      "--repair",
      "--span-id=span-repair-1",
      "--repair-reason=unit-test",
      "--json"
    ]);
    expect(r.code).toBe(0);
    const first = JSON.parse(r.stdout.trim()) as { appended: string[] };
    expect(first.appended).toEqual(["launched", "acknowledged", "completed"]);

    const linesAfter = (await fs.readFile(eventsPath, "utf8")).trim().split("\n").filter(Boolean);
    expect(linesAfter.length).toBe(4);

    r = await runDelegationRecord(root, [
      "--repair",
      "--span-id=span-repair-1",
      "--repair-reason=second-run",
      "--json"
    ]);
    expect(r.code).toBe(0);
    const second = JSON.parse(r.stdout.trim()) as { appended: string[] };
    expect(second.appended).toEqual([]);

    const linesFinal = (await fs.readFile(eventsPath, "utf8")).trim().split("\n").filter(Boolean);
    expect(linesFinal.length).toBe(4);
  });
});
