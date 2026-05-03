import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function runCli(projectRoot: string, args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const cliPath = path.resolve(__dirname, "../../dist/cli.js");
    const child = spawn(process.execPath, [cliPath, ...args], {
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

function buildSyntheticPlan(unitCount: number): string {
  const units: string[] = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      [
        `### Implementation Unit U-${i}`,
        `- **Goal:** synthetic unit ${i}`,
        `- **Files:** src/u${i}.ts`,
        `- **Approach:** trivial`,
        `- **Test scenarios:** none`,
        `- **Verification:** trivial`,
        ""
      ].join("\n")
    );
  }
  return [
    "---",
    "stage: plan",
    "schema_version: v1",
    "version: 1",
    "locked_decisions: []",
    "inputs_hash: 0",
    "---",
    "",
    "# Plan Artifact",
    "",
    "## Implementation Units",
    "",
    units.join("\n"),
    "",
    "## WAIT_FOR_CONFIRM",
    "- Status: pending",
    ""
  ].join("\n");
}

async function seedPlan(root: string, runId: string, unitCount: number): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "plan";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".cclaw/artifacts/05-plan.md"),
    buildSyntheticPlan(unitCount),
    "utf8"
  );
}

async function distExists(): Promise<boolean> {
  try {
    await fs.access(path.resolve(__dirname, "../../dist/cli.js"));
    return true;
  } catch {
    return false;
  }
}

describe("e2e: plan-split-waves CLI", () => {
  it("splits a 60-unit plan into 3 wave files and writes the managed Wave Plans block", async () => {
    if (!(await distExists())) {
      // dist/cli.js must be built before this e2e can drive the binary.
      // Fall back to in-process execution via the internal subcommand.
      const { runInternalCommand } = await import("../../src/internal/advance-stage.js");
      const root = await createTempProject("e2e-plan-split-waves-inproc");
      await seedPlan(root, "run-1", 60);
      const out: string[] = [];
      const err: string[] = [];
      const code = await runInternalCommand(
        root,
        ["plan-split-waves", "--wave-size", "25", "--json"],
        {
          stdout: { write: (chunk: string) => { out.push(chunk); return true; } },
          stderr: { write: (chunk: string) => { err.push(chunk); return true; } }
        } as never
      );
      expect(code, `inproc stderr=${err.join("")}`).toBe(0);
      const wavesDir = await fs.readdir(path.join(root, ".cclaw/artifacts/wave-plans"));
      expect(wavesDir.sort()).toEqual(["wave-01.md", "wave-02.md", "wave-03.md"]);
      const planText = await fs.readFile(
        path.join(root, ".cclaw/artifacts/05-plan.md"),
        "utf8"
      );
      expect(planText).toContain("<!-- wave-split-managed-start -->");
      expect(planText).toContain("Wave 03");
      return;
    }

    const root = await createTempProject("e2e-plan-split-waves-cli");
    await seedPlan(root, "run-2", 60);

    const result = await runCli(root, [
      "internal",
      "plan-split-waves",
      "--wave-size",
      "25",
      "--json"
    ]);
    expect(result.code, `stderr=${result.stderr}`).toBe(0);
    expect(result.stdout).toMatch(/"waveCount":3/);

    const wavesDir = await fs.readdir(path.join(root, ".cclaw/artifacts/wave-plans"));
    expect(wavesDir.sort()).toEqual(["wave-01.md", "wave-02.md", "wave-03.md"]);

    const planText = await fs.readFile(
      path.join(root, ".cclaw/artifacts/05-plan.md"),
      "utf8"
    );
    expect(planText).toContain("<!-- wave-split-managed-start -->");
    expect(planText).toContain("Wave 03");
    expect(planText).toContain("<!-- wave-split-managed-end -->");
  });
});
