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

const AGENT_DEF_REL = ".cclaw/agents/slice-builder.md";

async function setupHook(projectRoot: string): Promise<string> {
  const hookPath = path.join(projectRoot, ".cclaw/hooks/delegation-record.mjs");
  await fs.mkdir(path.dirname(hookPath), { recursive: true });
  await fs.writeFile(hookPath, delegationRecordScript(), "utf8");
  await fs.mkdir(path.join(projectRoot, ".cclaw/agents"), { recursive: true });
  await fs.writeFile(
    path.join(projectRoot, AGENT_DEF_REL),
    "# slice-builder\n",
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

describe("delegation-record --refactor-outcome ", () => {
  it("records refactorOutcome.mode=inline on phase=green", async () => {
    const root = await createTempProject("refactor-outcome-inline");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-1",
      "--span-id=span-green-inline-1",
      "--dispatch-id=disp-green-inline-1",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-builder.md",
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
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-2",
      "--span-id=span-green-deferred-2",
      "--dispatch-id=disp-green-deferred-2",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-builder.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--refactor-outcome=deferred",
      "--refactor-rationale=Deferred cleanup for S-2 / T-202 because this GREEN closes failing assertions first; followup refactor tracked in docs/refactor-plan.md."
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
      rationale:
        "Deferred cleanup for S-2 / T-202 because this GREEN closes failing assertions first; followup refactor tracked in docs/refactor-plan.md."
    });
    const refs = greenEvent!.evidenceRefs as string[] | undefined;
    expect(refs && refs[0]).toBe(
      "Deferred cleanup for S-2 / T-202 because this GREEN closes failing assertions first; followup refactor tracked in docs/refactor-plan.md."
    );
  });

  it("rejects --refactor-outcome=deferred without rationale", async () => {
    const root = await createTempProject("refactor-outcome-deferred-no-rationale");
    await ensureRunSystem(root);
    await setupHook(root);

    const result = await runHook(root, [
      "--stage=tdd",
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-3",
      "--span-id=span-green-deferred-3",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-builder.md",
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
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-4",
      "--span-id=span-green-invalid-4",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-builder.md",
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
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-5",
      "--span-id=span-green-high-5",
      "--dispatch-id=disp-green-high-5",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-builder.md",
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
      "--agent=slice-builder",
      "--mode=mandatory",
      "--status=completed",
      "--phase=green",
      "--slice-id=S-6",
      "--span-id=span-green-tier-6",
      "--dispatch-surface=claude-task",
      "--agent-definition-path=.cclaw/agents/slice-builder.md",
      "--ack-ts=2026-01-01T00:00:00Z",
      "--risk-tier=critical"
    ]);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/invalid --risk-tier/u);
  });
});
