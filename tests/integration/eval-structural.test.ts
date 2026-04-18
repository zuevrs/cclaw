/**
 * Integration test for structural + rules + traceability evals.
 *
 * We copy the canonical `tests/fixtures/eval-demo/.cclaw/evals/` tree into a
 * temp directory so the test is hermetic (no cross-test contamination, no
 * reliance on the repo's working tree) and runs the real `runEval` pipeline
 * exactly the same way CI does. The test proves:
 *
 * 1. All 40 seed cases pass schema + rules + traceability gates against
 *    their committed baselines.
 * 2. Structural, rule, and traceability regressions each surface as
 *    baseline-driven critical failures.
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

describe("eval structural+rules - integration against the committed corpus", () => {
  it("loads 41 cases spanning all 8 stages", async () => {
    const root = await cloneDemo("eval-int-count");
    const res = await runEval({ projectRoot: root, dryRun: true, env: {} });
    expect("kind" in res).toBe(true);
    if ("kind" in res) {
      expect(res.corpus.total).toBe(41);
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
      for (const [stage, count] of Object.entries(res.corpus.byStage)) {
        expect(count).toBe(stage === "spec" ? 6 : 5);
      }
    }
  });

  it("passes all 40 structural/rules cases and skips the agent-mode demo with --rules", async () => {
    const root = await cloneDemo("eval-int-pass");
    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    expect("kind" in res).toBe(false);
    if (!("kind" in res)) {
      expect(res.summary.totalCases).toBe(41);
      expect(res.summary.passed).toBe(40);
      expect(res.summary.failed).toBe(0);
      expect(res.summary.skipped).toBe(1);
      expect(res.baselineDelta).toBeDefined();
      expect(res.baselineDelta?.criticalFailures).toBe(0);
      expect(res.baselineDelta?.regressions).toEqual([]);
    }
  });

  it("--schema-only skips the rules-only + agent-mode cases and passes the 24 structural cases", async () => {
    const root = await cloneDemo("eval-int-schema-only");
    const res = await runEval({
      projectRoot: root,
      schemaOnly: true,
      env: {}
    });
    if (!("kind" in res)) {
      expect(res.summary.totalCases).toBe(41);
      expect(res.summary.passed).toBe(24);
      expect(res.summary.skipped).toBe(17);
      expect(res.summary.failed).toBe(0);
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

    const res = await runEval({ projectRoot: root, rules: true, env: {} });
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

    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const regression = res.baselineDelta?.regressions.find(
        (r) => r.verifierId === "structural:forbidden:tbd" && r.reason === "newly-failing"
      );
      expect(regression).toBeDefined();
    }
  });

  it("synthetic rule regression (duplicate bullet) flips unique-in-section", async () => {
    const root = await cloneDemo("eval-int-rule-dup");
    const targetFixture = path.join(
      root,
      ".cclaw/evals/corpus/scope/scope-01-dark-mode/fixture.md"
    );
    const original = await fs.readFile(targetFixture, "utf8");
    const mutated = original.replace(
      "- D-03: SSR hint resolved in the root layout via a server component.",
      "- D-01: Preference stored in an HttpOnly cookie named `cclaw_theme`."
    );
    expect(mutated).not.toBe(original);
    await fs.writeFile(targetFixture, mutated, "utf8");

    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const regression = res.baselineDelta?.regressions.find(
        (r) =>
          r.caseId === "scope-04-dark-mode-rules" &&
          r.verifierId === "rules:unique-in-section:decisions" &&
          r.reason === "newly-failing"
      );
      expect(regression).toBeDefined();
    }
  });

  it("synthetic traceability regression (scope decision dropped from plan) is caught", async () => {
    const root = await cloneDemo("eval-int-trace");
    const targetFixture = path.join(
      root,
      ".cclaw/evals/corpus/plan/plan-01-dark-mode/fixture.md"
    );
    const original = await fs.readFile(targetFixture, "utf8");
    const mutated = original.replace(/- D-02[^\n]*\n/, "");
    expect(mutated).not.toBe(original);
    await fs.writeFile(targetFixture, mutated, "utf8");

    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const regression = res.baselineDelta?.regressions.find(
        (r) =>
          r.caseId === "plan-01-dark-mode" &&
          r.verifierId === "traceability:scope->self" &&
          r.reason === "newly-failing"
      );
      expect(regression).toBeDefined();
    }
  });
});
