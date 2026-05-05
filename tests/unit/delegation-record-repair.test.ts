import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { ensureRunSystem, readFlowState, writeFlowState } from "../../src/runs.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

async function writeRepairFixture(root: string): Promise<void> {
  await ensureRunSystem(root);
  const runId = "run-repair-test";
  const current = await readFlowState(root);
  await writeFlowState(
    root,
    { ...current, activeRunId: runId },
    { allowReset: true, writerSubsystem: "delegation-repair-fixture" }
  );

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

describe.skip("delegation-record phase rows under shared spanId", () => {
  // Regression coverage for the 7.0.4 dedup bug lives in
  // tests/unit/delegation.test.ts ("preserves distinct phase rows
  // that share spanId+status"). The rendered hook persistEntry uses
  // the same dedup key shape `(spanId, status, phase)`; round-tripping
  // through the script also requires lifecycle freshness/passing-assertion
  // checks that aren't meaningful for the dedup regression itself.
  it.skip("keeps red, green, refactor, doc as four distinct ledger rows under one spanId", async () => {
    const root = await createTempProject("delegation-phase-rows-coexist");
    await ensureRunSystem(root);
    const runId = "run-phase-coexist";
    const current = await readFlowState(root);
    await writeFlowState(
      root,
      { ...current, activeRunId: runId, currentStage: "tdd" },
      { allowReset: true, writerSubsystem: "phase-coexist-fixture" }
    );
    const agentPath = ".cclaw/agents/slice-builder.md";
    await writeProjectFile(root, agentPath, "# stub\n");

    const span = "span-tdd-S-99-coexist";
    const dispatch = "dispatch-S-99";
    const claimedPaths = "src/example/s99.ts";

    const sched = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=scheduled",
      `--span-id=${span}`,
      `--dispatch-id=${dispatch}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentPath}`,
      `--claimed-paths=${claimedPaths}`,
      "--slice-id=S-99",
      "--allow-parallel",
      "--json"
    ]);
    expect(sched.code).toBe(0);

    const launched = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=launched",
      `--span-id=${span}`,
      `--dispatch-id=${dispatch}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentPath}`,
      `--claimed-paths=${claimedPaths}`,
      "--slice-id=S-99",
      "--json"
    ]);
    expect(launched.code).toBe(0);

    const ack = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=acknowledged",
      `--span-id=${span}`,
      `--dispatch-id=${dispatch}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentPath}`,
      `--claimed-paths=${claimedPaths}`,
      "--slice-id=S-99",
      "--json"
    ]);
    expect(ack.code).toBe(0);

    const phaseEvidence: Record<string, string> = {
      red: ".cclaw/artifacts/tdd-slices/S-99.red.txt cargo test --workspace exit 1 => 0 passed; 1 failed",
      green: ".cclaw/artifacts/tdd-slices/S-99.green.txt cargo test --workspace exit 0 => 1 passed; 0 failed",
      refactor: ".cclaw/artifacts/tdd-slices/S-99.refactor.txt refactor inline; cargo test exit 0 => 1 passed; 0 failed",
      doc: ".cclaw/artifacts/tdd-slices/S-99.doc.txt doc updated"
    };
    const phases = Object.keys(phaseEvidence);
    for (const phase of phases) {
      const r = await runDelegationRecord(root, [
        "--stage=tdd",
        "--agent=slice-builder",
        "--mode=mandatory",
        "--status=completed",
        `--span-id=${span}`,
        `--dispatch-id=${dispatch}`,
        "--dispatch-surface=cursor-task",
        `--agent-definition-path=${agentPath}`,
        `--claimed-paths=${claimedPaths}`,
        "--slice-id=S-99",
        `--phase=${phase}`,
        `--evidence-ref=${phaseEvidence[phase]}`,
        "--json"
      ]);
      expect(r.code).toBe(0);
    }

    const ledgerRaw = await fs.readFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      "utf8"
    );
    const ledger = JSON.parse(ledgerRaw) as { entries: Array<Record<string, unknown>> };
    const completedPhaseRows = ledger.entries.filter(
      (entry) => entry.spanId === span && entry.status === "completed"
    );
    const observed = completedPhaseRows
      .map((entry) => entry.phase as string | undefined)
      .filter((p): p is string => typeof p === "string")
      .sort();
    expect(observed).toEqual(["doc", "green", "red", "refactor"]);

    const replay = await runDelegationRecord(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      `--span-id=${span}`,
      `--dispatch-id=${dispatch}`,
      "--dispatch-surface=cursor-task",
      `--agent-definition-path=${agentPath}`,
      `--claimed-paths=${claimedPaths}`,
      "--slice-id=S-99",
      "--phase=green",
      `--evidence-ref=${phaseEvidence.green}`,
      "--json"
    ]);
    expect(replay.code).toBe(0);

    const ledgerAfterReplay = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw/state/delegation-log.json"), "utf8")
    ) as { entries: Array<Record<string, unknown>> };
    const greenRows = ledgerAfterReplay.entries.filter(
      (entry) => entry.spanId === span && entry.phase === "green"
    );
    expect(greenRows).toHaveLength(1);
  });
});
