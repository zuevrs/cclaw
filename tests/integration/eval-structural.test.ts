/**
 * Integration test for Wave 7.1 structural evals.
 *
 * We copy the canonical `tests/fixtures/eval-demo/.cclaw/evals/` tree into a
 * temp directory so the test is hermetic (no cross-test contamination, no
 * reliance on the repo's working tree) and runs the real `runEval` pipeline
 * exactly the same way CI does. The test proves two things:
 *
 * 1. All 24 seed cases pass against their committed baselines.
 * 2. A synthetic regression — deleting a required section from one fixture —
 *    is caught as a baseline-driven critical failure.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { createTempProject } from "../helpers/index.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEMO_ROOT = path.resolve(HERE, "../fixtures/eval-demo");

async function copyDirRecursive(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDirRecursive(srcPath, dstPath);
    } else {
      await fs.copyFile(srcPath, dstPath);
    }
  }
}

async function cloneDemo(tag: string): Promise<string> {
  const tmp = await createTempProject(tag);
  await copyDirRecursive(path.join(DEMO_ROOT, ".cclaw"), path.join(tmp, ".cclaw"));
  return tmp;
}

describe("eval structural - integration against the committed corpus", () => {
  it("loads 24 cases spanning all 8 stages", async () => {
    const root = await cloneDemo("eval-int-count");
    const res = await runEval({ projectRoot: root, dryRun: true, env: {} });
    expect("kind" in res).toBe(true);
    if ("kind" in res) {
      expect(res.corpus.total).toBe(24);
      expect(Object.keys(res.corpus.byStage).sort()).toEqual([
        "brainstorm",
        "design",
        "plan",
        "review",
        "scope",
        "ship",
        "spec",
        "tdd"
      ]);
      for (const count of Object.values(res.corpus.byStage)) {
        expect(count).toBe(3);
      }
    }
  });

  it("passes all 24 cases and reports zero regressions against baselines", async () => {
    const root = await cloneDemo("eval-int-pass");
    const res = await runEval({ projectRoot: root, env: {} });
    expect("kind" in res).toBe(false);
    if (!("kind" in res)) {
      expect(res.summary.totalCases).toBe(24);
      expect(res.summary.passed).toBe(24);
      expect(res.summary.failed).toBe(0);
      expect(res.summary.skipped).toBe(0);
      expect(res.baselineDelta).toBeDefined();
      expect(res.baselineDelta?.criticalFailures).toBe(0);
      expect(res.baselineDelta?.regressions).toEqual([]);
    }
  });

  it("synthetic regression (missing required section) is caught as a critical failure", async () => {
    const root = await cloneDemo("eval-int-regress");
    const targetFixture = path.join(
      root,
      ".cclaw/evals/corpus/brainstorm/brainstorm-01-dark-mode/fixture.md"
    );
    const original = await fs.readFile(targetFixture, "utf8");
    const mutated = original.replace("## Directions", "## Options");
    expect(mutated).not.toBe(original);
    await fs.writeFile(targetFixture, mutated, "utf8");

    const res = await runEval({ projectRoot: root, env: {} });
    expect("kind" in res).toBe(false);
    if (!("kind" in res)) {
      expect(res.summary.failed).toBeGreaterThanOrEqual(1);
      expect(res.baselineDelta).toBeDefined();
      expect(res.baselineDelta?.criticalFailures).toBeGreaterThanOrEqual(1);
      const regression = res.baselineDelta?.regressions.find(
        (r) =>
          r.caseId === "brainstorm-01-dark-mode" &&
          r.verifierId === "structural:section:directions" &&
          r.reason === "newly-failing"
      );
      expect(regression).toBeDefined();
    }
  });

  it("synthetic regression (forbidden pattern introduced) is caught", async () => {
    const root = await cloneDemo("eval-int-forbidden");
    const targetFixture = path.join(
      root,
      ".cclaw/evals/corpus/spec/spec-02-auth-refactor/fixture.md"
    );
    const original = await fs.readFile(targetFixture, "utf8");
    const mutated = original + "\nTBD: follow up with provider docs.\n";
    await fs.writeFile(targetFixture, mutated, "utf8");

    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      const regression = res.baselineDelta?.regressions.find(
        (r) => r.verifierId === "structural:forbidden:tbd" && r.reason === "newly-failing"
      );
      expect(regression).toBeDefined();
    }
  });
});
