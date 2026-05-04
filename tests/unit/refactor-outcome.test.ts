import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { delegationRecordScript } from "../../src/content/hooks.js";
import { ensureRunSystem } from "../../src/runs.js";
import { createTempProject } from "../helpers/index.js";

interface RunResult {
  code: number | null;
  stderr: string;
  stdout: string;
}

const AGENT_DEF_REL = ".cclaw/agents/slice-implementer.md";

async function setupHook(projectRoot: string): Promise<string> {
  const hookPath = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, delegationRecordScript(), "utf8");
  await fs.mkdir(path.join(projectRoot, ".cclaw/agents"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, AGENT_DEF_REL),
    "# slice-implementer\n",
    "utf8"
  );
  return hookPath;
}

function runHook(projectRoot: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const script = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const child = spawn(process.execPath, [script, ...args], {
      cwd: projectRoot,
      env: { ...process.env, CCLAW_PROJECT_ROOT: projectRoot }
    });
    child.stdout?.on("data", (chunk) => stdoutChunks.push(chunk.toString()));
    child.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: stdoutChunks.join(""),
        stderr: stderrChunks.join("")
      })
    );
  });
}

async function readEvents(projectRoot: string): Promise<unknown[]> {
  const eventsFile = path.join(projectRoot, ".cclaw/state/delegation-events.jsonl");
  const text = await fs.readFile(eventsFile, "utf8").catch(() => "");
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line));
}

describe("delegation-record --refactor-outcome (v6.14.0)", () => {
  it("records refactorOutcome.mode=inline on phase=green", async () => {
    const root = await createTempProject("refactor-outcome-inline");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-implementer",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-1",
      "--span-id=span-green-inline-1",
      "--dispatch-id=disp-green-inline-1",
      "--claim-token=tok-1",
      "--owner-lane-id=lane-1",
      "--leased-until=2099-01-01T00:00:00Z",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-implementer.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--refactor-outcome=inline"
    ]);

    expect(result.code, result.stderr).toBe(0);

    const events = await readEvents(root);
    const greenEvent = events.find(
      (e): e is Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        (e as Record<string, unknown>).phase === "green"
    );
    expect(greenEvent, "expected a phase=green event").toBeTruthy();
    expect(greenEvent!.refactorOutcome).toEqual({ mode: "inline" });
  });

  it("records refactorOutcome.mode=deferred with rationale and mirrors to evidenceRefs", async () => {
    const root = await createTempProject("refactor-outcome-deferred");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-implementer",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-2",
      "--span-id=span-green-deferred-2",
      "--dispatch-id=disp-green-deferred-2",
      "--claim-token=tok-2",
      "--owner-lane-id=lane-2",
      "--leased-until=2099-01-01T00:00:00Z",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-implementer.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--refactor-outcome=deferred",
      "--refactor-rationale=tracked in followups/REF-12"
    ]);

    expect(result.code, result.stderr).toBe(0);
    const events = await readEvents(root);
    const greenEvent = events.find(
      (e): e is Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        (e as Record<string, unknown>).phase === "green"
    ) as Record<string, unknown> | undefined;
    expect(greenEvent).toBeTruthy();
    expect(greenEvent!.refactorOutcome).toEqual({
      mode: "deferred",
      rationale: "tracked in followups/REF-12"
    });
    const refs = greenEvent!.evidenceRefs as string[] | undefined;
    expect(refs && refs[0]).toBe("tracked in followups/REF-12");
  });

  it("rejects --refactor-outcome=deferred without rationale", async () => {
    const root = await createTempProject("refactor-outcome-deferred-no-rationale");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-implementer",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-3",
      "--span-id=span-green-deferred-3",
      "--claim-token=tok-3",
      "--owner-lane-id=lane-3",
      "--leased-until=2099-01-01T00:00:00Z",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-implementer.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--refactor-outcome=deferred"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/refactor-outcome=deferred/u);
  });

  it("rejects invalid --refactor-outcome values", async () => {
    const root = await createTempProject("refactor-outcome-invalid");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-implementer",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-4",
      "--span-id=span-green-invalid-4",
      "--claim-token=tok-4",
      "--owner-lane-id=lane-4",
      "--leased-until=2099-01-01T00:00:00Z",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-implementer.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--refactor-outcome=skipped"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/invalid --refactor-outcome/u);
  });

  it("records --risk-tier=high on the event", async () => {
    const root = await createTempProject("risk-tier-high");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-implementer",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-5",
      "--span-id=span-green-high-5",
      "--dispatch-id=disp-green-high-5",
      "--claim-token=tok-5",
      "--owner-lane-id=lane-5",
      "--leased-until=2099-01-01T00:00:00Z",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-implementer.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--risk-tier=high"
    ]);

    expect(result.code, result.stderr).toBe(0);
    const events = await readEvents(root);
    const greenEvent = events.find(
      (e): e is Record<string, unknown> =>
        typeof e === "object" &&
        e !== null &&
        (e as Record<string, unknown>).phase === "green"
    ) as Record<string, unknown> | undefined;
    expect(greenEvent).toBeTruthy();
    expect(greenEvent!.riskTier).toBe("high");
  });

  it("rejects invalid --risk-tier values", async () => {
    const root = await createTempProject("risk-tier-invalid");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-implementer",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-6",
      "--span-id=span-green-tier-6",
      "--claim-token=tok-6",
      "--owner-lane-id=lane-6",
      "--leased-until=2099-01-01T00:00:00Z",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-implementer.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--risk-tier=critical"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/invalid --risk-tier/u);
  });
});
