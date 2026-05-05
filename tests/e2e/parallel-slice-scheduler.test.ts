import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const AGENT_DEF_REL = ".cclaw/agents/slice-builder.md";

async function seedAgentDef(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/agents"), { recursive: true });
  await fs.writeFile(path.join(root, AGENT_DEF_REL), "# slice-builder\n", "utf8");
}

function scheduleArgs(span: string, paths: string[], extra: string[] = []): string[] {
  return [
    "--stage=tdd",
    "--agent=slice-builder",
    "--mode=mandatory",
    "--status=scheduled",
    `--span-id=${span}`,
    `--dispatch-id=${span}-d`,
    "--dispatch-surface=cursor-task",
    `--agent-definition-path=${AGENT_DEF_REL}`,
    `--paths=${paths.join(",")}`,
    "--json",
    ...extra
  ];
}

describe("e2e: parallel slice-builder scheduler", () => {
  let savedEnv: string | undefined;
  beforeEach(() => {
    savedEnv = process.env.CCLAW_MAX_PARALLEL_SLICE_BUILDERS;
    delete process.env.CCLAW_MAX_PARALLEL_SLICE_BUILDERS;
  });
  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.CCLAW_MAX_PARALLEL_SLICE_BUILDERS;
    } else {
      process.env.CCLAW_MAX_PARALLEL_SLICE_BUILDERS = savedEnv;
    }
  });

  it("schedules two disjoint slice-builders and blocks an overlap, then enforces the cap and override", async () => {
    const root = await createTempProject("e2e-parallel-scheduler");
    const scriptPath = await setupHook(root);
    await seedAgentDef(root);

    const r1 = await runScript(root, scriptPath, scheduleArgs("span-1", ["src/a.ts"]));
    expect(r1.code, `scheduled-1 stderr=${r1.stderr}`).toBe(0);
    const r2 = await runScript(root, scriptPath, scheduleArgs("span-2", ["src/b.ts"]));
    expect(r2.code, `scheduled-2 stderr=${r2.stderr}`).toBe(0);

    const ledgerRaw = await fs.readFile(
      path.join(root, ".cclaw/state/delegation-log.json"),
      "utf8"
    );
    const ledger = JSON.parse(ledgerRaw) as {
      entries: Array<{ spanId: string; status: string; allowParallel?: boolean }>;
    };
    const span2Row = ledger.entries.find((e) => e.spanId === "span-2");
    expect(span2Row?.allowParallel, "second disjoint span should auto-allow parallel").toBe(true);

    const r3 = await runScript(root, scriptPath, scheduleArgs("span-3", ["src/a.ts"]));
    expect(r3.code, `expected dispatch_overlap, got code=${r3.code}`).not.toBe(0);
    const out3 = `${r3.stdout}${r3.stderr}`;
    expect(out3).toMatch(/dispatch_overlap/);

    for (let i = 3; i <= 5; i += 1) {
      const r = await runScript(root, scriptPath, scheduleArgs(`span-${i + 100}`, [`src/m${i}.ts`]));
      expect(r.code, `scheduled-${i} stderr=${r.stderr}`).toBe(0);
    }

    const overflow = await runScript(root, scriptPath, scheduleArgs("span-overflow", ["src/x.ts"]));
    expect(overflow.code, `expected dispatch_cap, got code=${overflow.code}`).not.toBe(0);
    const outOver = `${overflow.stdout}${overflow.stderr}`;
    expect(outOver).toMatch(/dispatch_cap/);

    const overridden = await runScript(
      root,
      scriptPath,
      scheduleArgs("span-overflow", ["src/x.ts"], ["--override-cap=10", "--reason=cap-burst-e2e"])
    );
    expect(overridden.code, `override stderr=${overridden.stderr}`).toBe(0);
  });
});
