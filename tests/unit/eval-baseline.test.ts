import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  BASELINE_SCHEMA_VERSION,
  buildBaselineForStage,
  compareAgainstBaselines,
  listBaselineStages,
  loadBaseline,
  loadBaselinesByStage,
  writeBaselinesFromReport
} from "../../src/eval/baseline.js";
import { EVALS_ROOT } from "../../src/constants.js";
import { FLOW_STAGES } from "../../src/types.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";
import type {
  BaselineSnapshot,
  EvalCaseResult,
  EvalReport,
  VerifierResult
} from "../../src/eval/types.js";

function makeVerifier(
  id: string,
  ok: boolean,
  overrides: Partial<VerifierResult> = {}
): VerifierResult {
  return {
    kind: "structural",
    id,
    ok,
    score: ok ? 1 : 0,
    ...overrides
  };
}

function makeCaseResult(
  overrides: Partial<EvalCaseResult> & { caseId: string; stage: EvalCaseResult["stage"] }
): EvalCaseResult {
  return {
    mode: "fixture",
    passed: true,
    durationMs: 0,
    verifierResults: [makeVerifier("structural:x", true)],
    ...overrides
  } as EvalCaseResult;
}

function makeReport(overrides: Partial<EvalReport> = {}): EvalReport {
  const cases: EvalCaseResult[] = overrides.cases ?? [];
  const passed = cases.filter((c) => c.passed).length;
  const failed = cases.length - passed;
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    runId: randomUUID(),
    cclawVersion: "test",
    provider: "zai",
    model: "glm-5.1",
    mode: "fixture",
    stages: FLOW_STAGES.filter((s) => cases.some((c) => c.stage === s)),
    cases,
    summary: {
      totalCases: cases.length,
      passed,
      failed,
      skipped: 0,
      totalCostUsd: 0,
      totalDurationMs: 0
    },
    ...overrides
  };
}

describe("baseline - load / write round-trip", () => {
  it("loadBaseline returns null when the file is absent", async () => {
    const root = await createTempProject("baseline-missing");
    expect(await loadBaseline(root, "brainstorm")).toBeNull();
  });

  it("throws on invalid JSON", async () => {
    const root = await createTempProject("baseline-bad-json");
    await writeProjectFile(root, `${EVALS_ROOT}/baselines/brainstorm.json`, "{not json");
    await expect(loadBaseline(root, "brainstorm")).rejects.toThrow(/Invalid baseline/);
  });

  it("throws on schema mismatch", async () => {
    const root = await createTempProject("baseline-shape");
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/baselines/brainstorm.json`,
      JSON.stringify({ schemaVersion: 99, stage: "brainstorm" })
    );
    await expect(loadBaseline(root, "brainstorm")).rejects.toThrow(/shape mismatch/);
  });

  it("buildBaselineForStage serializes cases for the given stage", () => {
    const report = makeReport({
      cases: [
        makeCaseResult({ caseId: "b1", stage: "brainstorm" }),
        makeCaseResult({ caseId: "s1", stage: "scope" }),
        makeCaseResult({ caseId: "b2", stage: "brainstorm" })
      ]
    });
    const snapshot = buildBaselineForStage("brainstorm", report);
    expect(snapshot.schemaVersion).toBe(BASELINE_SCHEMA_VERSION);
    expect(snapshot.stage).toBe("brainstorm");
    expect(Object.keys(snapshot.cases).sort()).toEqual(["b1", "b2"]);
  });

  it("writeBaselinesFromReport writes one file per stage present and can be reloaded", async () => {
    const root = await createTempProject("baseline-write");
    const report = makeReport({
      cases: [
        makeCaseResult({ caseId: "b1", stage: "brainstorm" }),
        makeCaseResult({ caseId: "sc1", stage: "scope" })
      ]
    });
    const written = await writeBaselinesFromReport(root, report);
    expect(written).toHaveLength(2);
    for (const file of written) {
      const raw = await fs.readFile(file, "utf8");
      expect(raw).toMatch(/"schemaVersion": 1/);
    }
    const reloaded = await loadBaseline(root, "brainstorm");
    expect(reloaded?.cases.b1?.passed).toBe(true);
  });

  it("listBaselineStages returns only known-stage files", async () => {
    const root = await createTempProject("baseline-list");
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/baselines/brainstorm.json`,
      JSON.stringify({
        schemaVersion: 1,
        stage: "brainstorm",
        generatedAt: "x",
        cclawVersion: "test",
        cases: {}
      })
    );
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/baselines/unknown-stage.json`,
      `{}`
    );
    const stages = await listBaselineStages(root);
    expect(stages).toEqual(["brainstorm"]);
  });
});

describe("baseline - compareAgainstBaselines", () => {
  const baseline: BaselineSnapshot = {
    schemaVersion: 1,
    stage: "brainstorm",
    generatedAt: "2026-01-01T00:00:00Z",
    cclawVersion: "test",
    cases: {
      alpha: {
        passed: true,
        verifierResults: [
          { kind: "structural", id: "structural:section:a", ok: true, score: 1 },
          { kind: "structural", id: "structural:forbidden:tbd", ok: true, score: 1 }
        ]
      },
      beta: {
        passed: true,
        verifierResults: [
          { kind: "structural", id: "structural:section:a", ok: true, score: 1 }
        ]
      }
    }
  };

  it("returns undefined when no baselines are loaded", () => {
    const report = makeReport({
      cases: [makeCaseResult({ caseId: "alpha", stage: "brainstorm" })]
    });
    expect(compareAgainstBaselines(report, new Map())).toBeUndefined();
  });

  it("flags newly failing verifier as critical regression", () => {
    const report = makeReport({
      cases: [
        {
          caseId: "alpha",
          stage: "brainstorm",
          mode: "fixture",
          passed: false,
          durationMs: 1,
          verifierResults: [
            makeVerifier("structural:section:a", false),
            makeVerifier("structural:forbidden:tbd", true)
          ]
        }
      ]
    });
    const delta = compareAgainstBaselines(
      report,
      new Map([["brainstorm", baseline]])
    );
    expect(delta).toBeDefined();
    expect(delta?.criticalFailures).toBeGreaterThanOrEqual(2);
    const newlyFailing = delta!.regressions.find(
      (r) => r.verifierId === "structural:section:a" && r.reason === "newly-failing"
    );
    expect(newlyFailing).toBeDefined();
    const caseFailing = delta!.regressions.find((r) => r.reason === "case-now-failing");
    expect(caseFailing).toBeDefined();
  });

  it("returns zero regressions when everything matches baseline", () => {
    const report = makeReport({
      cases: [
        {
          caseId: "alpha",
          stage: "brainstorm",
          mode: "fixture",
          passed: true,
          durationMs: 1,
          verifierResults: [
            makeVerifier("structural:section:a", true),
            makeVerifier("structural:forbidden:tbd", true)
          ]
        },
        {
          caseId: "beta",
          stage: "brainstorm",
          mode: "fixture",
          passed: true,
          durationMs: 1,
          verifierResults: [makeVerifier("structural:section:a", true)]
        }
      ]
    });
    const delta = compareAgainstBaselines(
      report,
      new Map([["brainstorm", baseline]])
    );
    expect(delta?.criticalFailures).toBe(0);
    expect(delta?.scoreDelta).toBe(0);
  });

  it("reports a score-drop when score fell without crossing ok boundary", () => {
    const report = makeReport({
      cases: [
        {
          caseId: "alpha",
          stage: "brainstorm",
          mode: "fixture",
          passed: true,
          durationMs: 1,
          verifierResults: [
            makeVerifier("structural:section:a", true, { score: 0.75 }),
            makeVerifier("structural:forbidden:tbd", true)
          ]
        }
      ]
    });
    const delta = compareAgainstBaselines(
      report,
      new Map([["brainstorm", baseline]])
    );
    expect(delta?.regressions.some((r) => r.reason === "score-drop")).toBe(true);
  });
});

describe("baseline - loadBaselinesByStage", () => {
  it("returns a map that skips stages without baselines", async () => {
    const root = await createTempProject("baseline-by-stage");
    const snapshot: BaselineSnapshot = {
      schemaVersion: 1,
      stage: "scope",
      generatedAt: "x",
      cclawVersion: "t",
      cases: {}
    };
    await writeProjectFile(
      root,
      path.join(EVALS_ROOT, "baselines", "scope.json"),
      JSON.stringify(snapshot)
    );
    const map = await loadBaselinesByStage(root, ["brainstorm", "scope"]);
    expect(map.size).toBe(1);
    expect(map.get("scope")?.stage).toBe("scope");
  });
});
