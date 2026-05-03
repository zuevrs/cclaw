import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLAN_SPLIT_DEFAULT_WAVE_SIZE,
  PLAN_SPLIT_SMALL_PLAN_THRESHOLD,
  extractPathsLine,
  parseImplementationUnits,
  parsePlanSplitWavesArgs,
  runPlanSplitWaves,
  upsertWavePlansSection
} from "../../src/internal/plan-split-waves.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
  outBuf: string[];
  errBuf: string[];
}

function makeIo(): CapturedIo {
  const outBuf: string[] = [];
  const errBuf: string[] = [];
  return {
    outBuf,
    errBuf,
    stdout: {
      write(chunk: string): boolean {
        outBuf.push(chunk);
        return true;
      }
    },
    stderr: {
      write(chunk: string): boolean {
        errBuf.push(chunk);
        return true;
      }
    }
  };
}

async function seedPlanArtifact(root: string, runId: string, planMarkdown: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
  const state = createInitialFlowState(runId);
  state.currentStage = "plan";
  await fs.writeFile(
    path.join(root, ".cclaw/state/flow-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8"
  );
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
  await fs.writeFile(path.join(root, ".cclaw/artifacts/05-plan.md"), planMarkdown, "utf8");
}

function buildSyntheticPlan(unitCount: number): string {
  const units: string[] = [];
  for (let i = 1; i <= unitCount; i += 1) {
    units.push(
      [
        `### Implementation Unit U-${i}`,
        `- **Goal:** synthetic unit ${i}`,
        `- **Files:** src/u${i}.ts, tests/u${i}.spec.ts`,
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

describe("parseImplementationUnits", () => {
  it("extracts each ### Implementation Unit U-N block with body", () => {
    const plan = buildSyntheticPlan(3);
    const units = parseImplementationUnits(plan);
    expect(units.map((u) => u.id)).toEqual(["U-1", "U-2", "U-3"]);
    expect(units[0]!.body).toContain("### Implementation Unit U-1");
    expect(units[0]!.body).not.toContain("### Implementation Unit U-2");
    expect(units[2]!.body).not.toContain("## WAIT_FOR_CONFIRM");
  });

  it("captures Files paths in unit.paths", () => {
    const plan = buildSyntheticPlan(1);
    const units = parseImplementationUnits(plan);
    expect(units[0]!.paths).toEqual(["src/u1.ts", "tests/u1.spec.ts"]);
  });
});

describe("extractPathsLine", () => {
  it("ignores units without a Files line", () => {
    expect(extractPathsLine("### Implementation Unit U-1\n- **Goal:** none\n")).toEqual([]);
  });

  it("parses bold Files line", () => {
    expect(
      extractPathsLine("### Implementation Unit U-1\n- **Files:** src/a.ts, src/b.ts\n")
    ).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("parses Files (repo-relative) bullet block", () => {
    expect(
      extractPathsLine("### Implementation Unit U-1\n- Files (repo-relative): a.ts, b.ts\n")
    ).toEqual(["a.ts", "b.ts"]);
  });
});

describe("parsePlanSplitWavesArgs", () => {
  it("defaults to wave size 25, no dry-run, no force", () => {
    expect(parsePlanSplitWavesArgs([])).toEqual({
      waveSize: PLAN_SPLIT_DEFAULT_WAVE_SIZE,
      dryRun: false,
      force: false,
      json: false
    });
  });

  it("parses --wave-size <N>", () => {
    expect(parsePlanSplitWavesArgs(["--wave-size", "20"]).waveSize).toBe(20);
  });

  it("parses --wave-size=N", () => {
    expect(parsePlanSplitWavesArgs(["--wave-size=15"]).waveSize).toBe(15);
  });

  it("rejects invalid wave size", () => {
    expect(() => parsePlanSplitWavesArgs(["--wave-size", "0"])).toThrow(/>=\s*1/);
    expect(() => parsePlanSplitWavesArgs(["--wave-size", "abc"])).toThrow(/positive integer/);
  });

  it("parses --dry-run, --force, --json", () => {
    const args = parsePlanSplitWavesArgs(["--dry-run", "--force", "--json"]);
    expect(args.dryRun).toBe(true);
    expect(args.force).toBe(true);
    expect(args.json).toBe(true);
  });
});

describe("upsertWavePlansSection", () => {
  it("appends managed block when no markers exist", () => {
    const updated = upsertWavePlansSection(
      "# Plan\n\nbody\n",
      "<!-- wave-split-managed-start -->\n## Wave Plans\n<!-- wave-split-managed-end -->"
    );
    expect(updated).toContain("<!-- wave-split-managed-start -->");
    expect(updated).toContain("body");
    expect(updated.indexOf("body")).toBeLessThan(updated.indexOf("Wave Plans"));
  });

  it("replaces existing managed block in-place, preserving outer text", () => {
    const original = [
      "# Plan",
      "",
      "outer above",
      "",
      "<!-- wave-split-managed-start -->",
      "## Wave Plans",
      "old content",
      "<!-- wave-split-managed-end -->",
      "",
      "outer below",
      ""
    ].join("\n");
    const updated = upsertWavePlansSection(
      original,
      [
        "<!-- wave-split-managed-start -->",
        "## Wave Plans",
        "new content",
        "<!-- wave-split-managed-end -->"
      ].join("\n")
    );
    expect(updated).toContain("outer above");
    expect(updated).toContain("outer below");
    expect(updated).toContain("new content");
    expect(updated).not.toContain("old content");
  });
});

describe("runPlanSplitWaves", () => {
  it("no-op when plan is below the small-plan threshold", async () => {
    const root = await createTempProject("plan-split-small");
    await seedPlanArtifact(root, "run-1", buildSyntheticPlan(10));
    const io = makeIo();
    const code = await runPlanSplitWaves(
      root,
      { waveSize: 25, dryRun: false, force: false, json: true },
      io
    );
    expect(code).toBe(0);
    const out = io.outBuf.join("");
    expect(out).toMatch(/"smallPlanNoOp":true/);
    const wavesDir = await fs
      .readdir(path.join(root, ".cclaw/artifacts/wave-plans"))
      .catch(() => null);
    expect(wavesDir).toBeNull();
  });

  it("splits a 60-unit plan into 3 waves of 25/25/10", async () => {
    const root = await createTempProject("plan-split-60");
    await seedPlanArtifact(root, "run-2", buildSyntheticPlan(60));
    const io = makeIo();
    const code = await runPlanSplitWaves(
      root,
      { waveSize: 25, dryRun: false, force: false, json: true },
      io
    );
    expect(code).toBe(0);
    const wavesDir = await fs.readdir(path.join(root, ".cclaw/artifacts/wave-plans"));
    expect(wavesDir.sort()).toEqual(["wave-01.md", "wave-02.md", "wave-03.md"]);

    const wave1 = await fs.readFile(
      path.join(root, ".cclaw/artifacts/wave-plans/wave-01.md"),
      "utf8"
    );
    const wave3 = await fs.readFile(
      path.join(root, ".cclaw/artifacts/wave-plans/wave-03.md"),
      "utf8"
    );
    expect(wave1).toContain("Source: 05-plan.md units U-1..U-25");
    expect(wave3).toContain("Source: 05-plan.md units U-51..U-60");

    const planText = await fs.readFile(path.join(root, ".cclaw/artifacts/05-plan.md"), "utf8");
    expect(planText).toContain("<!-- wave-split-managed-start -->");
    expect(planText).toContain("Wave 01");
    expect(planText).toContain("Wave 03");
    expect(planText).toContain("<!-- wave-split-managed-end -->");
  });

  it("--force overwrites existing wave files", async () => {
    const root = await createTempProject("plan-split-force");
    await seedPlanArtifact(root, "run-3", buildSyntheticPlan(60));
    await fs.mkdir(path.join(root, ".cclaw/artifacts/wave-plans"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/wave-plans/wave-01.md"),
      "# stale wave\n",
      "utf8"
    );
    const io = makeIo();
    const code = await runPlanSplitWaves(
      root,
      { waveSize: 25, dryRun: false, force: true, json: true },
      io
    );
    expect(code).toBe(0);
    const wave1 = await fs.readFile(
      path.join(root, ".cclaw/artifacts/wave-plans/wave-01.md"),
      "utf8"
    );
    expect(wave1).not.toContain("stale wave");
    expect(wave1).toContain("Source: 05-plan.md units U-1..U-25");
  });

  it("refuses to overwrite without --force", async () => {
    const root = await createTempProject("plan-split-refuse");
    await seedPlanArtifact(root, "run-4", buildSyntheticPlan(60));
    await fs.mkdir(path.join(root, ".cclaw/artifacts/wave-plans"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/wave-plans/wave-01.md"),
      "# stale wave\n",
      "utf8"
    );
    const io = makeIo();
    const code = await runPlanSplitWaves(
      root,
      { waveSize: 25, dryRun: false, force: false, json: true },
      io
    );
    expect(code).toBe(1);
    expect(io.errBuf.join("")).toMatch(/already exists/);
  });

  it("--dry-run does not write any wave files", async () => {
    const root = await createTempProject("plan-split-dry");
    await seedPlanArtifact(root, "run-5", buildSyntheticPlan(60));
    const io = makeIo();
    const code = await runPlanSplitWaves(
      root,
      { waveSize: 25, dryRun: true, force: false, json: true },
      io
    );
    expect(code).toBe(0);
    const wavesDir = await fs
      .readdir(path.join(root, ".cclaw/artifacts/wave-plans"))
      .catch(() => null);
    expect(wavesDir).toBeNull();
    expect(io.outBuf.join("")).toMatch(/"dryRun":true/);
  });

  it("threshold sanity: PLAN_SPLIT_SMALL_PLAN_THRESHOLD is 50", () => {
    expect(PLAN_SPLIT_SMALL_PLAN_THRESHOLD).toBe(50);
  });
});
