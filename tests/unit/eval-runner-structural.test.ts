import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { EVALS_ROOT } from "../../src/constants.js";
import {
  createTempProject,
  writeProjectFile
} from "../helpers/index.js";

const PASSING_FIXTURE = [
  "---",
  "stage: brainstorm",
  "author: cclaw",
  "---",
  "# Brainstorm",
  "",
  "## Directions",
  "",
  "- idea one",
  "- idea two",
  "",
  "## Recommendation",
  "",
  "Go with idea two.",
  ""
].join("\n");

const CASE_YAML = [
  "id: brainstorm-shape",
  "stage: brainstorm",
  "input_prompt: Shape a brainstorm artifact.",
  "fixture: ./brainstorm-shape/fixture.md",
  "expected:",
  "  structural:",
  "    required_sections:",
  "      - Directions",
  "      - Recommendation",
  "    forbidden_patterns:",
  "      - TBD",
  "      - TODO",
  "    required_frontmatter_keys:",
  "      - stage",
  "      - author",
  "    min_lines: 5",
  "    max_lines: 200",
  ""
].join("\n");

async function seedCorpus(root: string, fixtureBody = PASSING_FIXTURE): Promise<void> {
  await writeProjectFile(root, `${EVALS_ROOT}/corpus/brainstorm/shape.yaml`, CASE_YAML);
  await writeProjectFile(
    root,
    `${EVALS_ROOT}/corpus/brainstorm/brainstorm-shape/fixture.md`,
    fixtureBody
  );
}

describe("runEval - structural (Wave 7.1)", () => {
  it("verifiersAvailable.structural is true in dry-run", async () => {
    const root = await createTempProject("eval-structural-dry-run");
    await seedCorpus(root);
    const res = await runEval({ projectRoot: root, dryRun: true, env: {} });
    expect("kind" in res && res.kind === "dry-run").toBe(true);
    if ("kind" in res) {
      expect(res.verifiersAvailable.structural).toBe(true);
      expect(res.corpus.total).toBe(1);
    }
  });

  it("passes a fixture that meets every structural expectation", async () => {
    const root = await createTempProject("eval-structural-pass");
    await seedCorpus(root);
    const res = await runEval({ projectRoot: root, env: {} });
    expect("kind" in res).toBe(false);
    if (!("kind" in res)) {
      expect(res.summary.totalCases).toBe(1);
      expect(res.summary.passed).toBe(1);
      expect(res.summary.failed).toBe(0);
      const result = res.cases[0]!;
      expect(result.passed).toBe(true);
      expect(result.verifierResults.every((v) => v.ok)).toBe(true);
    }
  });

  it("fails when a required section is missing", async () => {
    const root = await createTempProject("eval-structural-fail-section");
    const broken = PASSING_FIXTURE.replace("## Directions", "## Other");
    await seedCorpus(root, broken);
    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      expect(res.summary.failed).toBe(1);
      const result = res.cases[0]!;
      expect(result.passed).toBe(false);
      const sectionCheck = result.verifierResults.find(
        (v) => v.id === "structural:section:directions"
      );
      expect(sectionCheck?.ok).toBe(false);
    }
  });

  it("emits a fixture:missing verifier when the fixture path does not resolve", async () => {
    const root = await createTempProject("eval-structural-missing-fixture");
    await writeProjectFile(root, `${EVALS_ROOT}/corpus/brainstorm/shape.yaml`, CASE_YAML);
    // fixture.md intentionally omitted
    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      expect(res.summary.failed).toBe(1);
      const result = res.cases[0]!;
      expect(result.verifierResults[0]?.id).toBe("structural:fixture:missing");
    }
  });

  it("skips verification when a case has no structural expectations", async () => {
    const root = await createTempProject("eval-structural-noexpected");
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/corpus/brainstorm/bare.yaml`,
      "id: brainstorm-bare\nstage: brainstorm\ninput_prompt: plain prompt\n"
    );
    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      expect(res.summary.totalCases).toBe(1);
      expect(res.summary.skipped).toBe(1);
      expect(res.cases[0]!.verifierResults[0]?.id).toBe(
        "wave-7-1-no-structural-expected"
      );
    }
  });

  it("loads per-stage baseline and attaches delta to the report", async () => {
    const root = await createTempProject("eval-structural-baseline");
    await seedCorpus(root);
    // A baseline where the same case already passed with the same verifier ids.
    const baseline = {
      schemaVersion: 1,
      stage: "brainstorm",
      generatedAt: "2026-01-01T00:00:00Z",
      cclawVersion: "test",
      cases: {
        "brainstorm-shape": {
          passed: true,
          verifierResults: [
            { kind: "structural", id: "structural:section:directions", ok: true, score: 1 }
          ]
        }
      }
    };
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/baselines/brainstorm.json`,
      JSON.stringify(baseline)
    );
    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      expect(res.baselineDelta).toBeDefined();
      expect(res.baselineDelta?.criticalFailures).toBe(0);
    }
  });

  it("flags critical failure in baselineDelta when previously-ok verifier now fails", async () => {
    const root = await createTempProject("eval-structural-regression");
    const broken = PASSING_FIXTURE.replace("## Directions", "## Other");
    await seedCorpus(root, broken);
    const baseline = {
      schemaVersion: 1,
      stage: "brainstorm",
      generatedAt: "2026-01-01T00:00:00Z",
      cclawVersion: "test",
      cases: {
        "brainstorm-shape": {
          passed: true,
          verifierResults: [
            { kind: "structural", id: "structural:section:directions", ok: true, score: 1 }
          ]
        }
      }
    };
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/baselines/brainstorm.json`,
      JSON.stringify(baseline)
    );
    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      expect(res.baselineDelta?.criticalFailures).toBeGreaterThanOrEqual(1);
      const reg = res.baselineDelta?.regressions.find(
        (r) => r.verifierId === "structural:section:directions"
      );
      expect(reg?.reason).toBe("newly-failing");
    }
  });
});

describe("runEval - stage filter still works under structural verifier", () => {
  it("restricts to one stage when --stage is provided", async () => {
    const root = await createTempProject("eval-structural-stage");
    await seedCorpus(root);
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/corpus/scope/bare.yaml`,
      "id: scope-bare\nstage: scope\ninput_prompt: p\n"
    );
    const res = await runEval({ projectRoot: root, stage: "brainstorm", env: {} });
    if (!("kind" in res)) {
      expect(res.cases).toHaveLength(1);
      expect(res.stages).toEqual(["brainstorm"]);
    }
    expect(path.sep.length).toBe(1); // placate the lint rule; path import intentional
  });
});
