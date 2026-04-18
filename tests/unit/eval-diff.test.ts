import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  diffReports,
  formatDiffMarkdown,
  resolveReportPath,
  runEvalDiff
} from "../../src/eval/diff.js";
import type { EvalReport } from "../../src/eval/types.js";

function report(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-04-17T00:00:00.000Z",
    runId: "11111111-2222-3333-4444-555555555555",
    cclawVersion: "0.27.0",
    provider: "zai",
    model: "glm-5.1",
    tier: "B",
    stages: ["spec"],
    cases: [
      {
        caseId: "case-a",
        stage: "spec",
        tier: "B",
        passed: true,
        durationMs: 100,
        costUsd: 0.001,
        verifierResults: [
          { kind: "structural", id: "structural:required-sections", ok: true, score: 1 },
          { kind: "judge", id: "judge:traceability", ok: true, score: 0.8 }
        ]
      }
    ],
    summary: {
      totalCases: 1,
      passed: 1,
      failed: 0,
      skipped: 0,
      totalCostUsd: 0.001,
      totalDurationMs: 100
    },
    ...overrides
  };
}

async function write(root: string, name: string, data: EvalReport): Promise<string> {
  const dir = path.join(root, ".cclaw/evals/reports");
  await fs.mkdir(dir, { recursive: true });
  const p = path.join(dir, name);
  await fs.writeFile(p, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  return p;
}

describe("diffReports", () => {
  it("reports summary and verifier score drops between two reports", () => {
    const prev = report();
    const curr = report({
      cclawVersion: "0.28.0",
      cases: [
        {
          ...report().cases[0]!,
          passed: false,
          verifierResults: [
            { kind: "structural", id: "structural:required-sections", ok: true, score: 1 },
            { kind: "judge", id: "judge:traceability", ok: false, score: 0.3 }
          ]
        }
      ],
      summary: {
        totalCases: 1,
        passed: 0,
        failed: 1,
        skipped: 0,
        totalCostUsd: 0.002,
        totalDurationMs: 120
      }
    });

    const diff = diffReports(prev, curr, "/tmp/old.json", "/tmp/new.json");
    expect(diff.regressed).toBe(true);
    expect(diff.summaryDelta.failedDelta).toBe(1);
    expect(diff.summaryDelta.passedDelta).toBe(-1);
    const c = diff.cases[0]!;
    expect(c.transition).toBe("regressed");
    const judgeDelta = c.verifierDeltas.find((v) => v.verifierId === "judge:traceability");
    expect(judgeDelta?.transition).toBe("regressed");
    expect(judgeDelta?.previousScore).toBe(0.8);
    expect(judgeDelta?.currentScore).toBe(0.3);
  });

  it("flags added and removed cases between runs", () => {
    const prev = report();
    const curr = report({
      cases: [
        {
          ...report().cases[0]!,
          caseId: "case-b"
        }
      ]
    });
    const diff = diffReports(prev, curr, "a", "b");
    const ids = diff.cases.map((c) => `${c.caseId}:${c.transition}`);
    expect(ids).toContain("case-a:removed");
    expect(ids).toContain("case-b:added");
    expect(diff.regressed).toBe(true);
  });

  it("renders a diff markdown block without regressions section when clean", () => {
    const prev = report();
    const curr = report({ cclawVersion: "0.28.0" });
    const diff = diffReports(prev, curr, "a", "b");
    expect(diff.regressed).toBe(false);
    const md = formatDiffMarkdown(diff);
    expect(md).toContain("regressed: no");
    expect(md).toContain("No case-level changes.");
  });

  it("resolveReportPath finds reports by cclawVersion and by 'latest'", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-diff-"));
    try {
      const a = await write(root, "eval-a.json", report({ cclawVersion: "0.26.0" }));
      // Ensure distinct mtimes.
      await new Promise((r) => setTimeout(r, 20));
      const b = await write(root, "eval-b.json", report({ cclawVersion: "0.27.0" }));

      const byVersion = await resolveReportPath(root, "0.26.0");
      expect(byVersion).toBe(a);
      const latest = await resolveReportPath(root, "latest");
      expect(latest).toBe(b);
      const byName = await resolveReportPath(root, "eval-a.json");
      expect(byName).toBe(a);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("runEvalDiff wires the filesystem to a structured diff", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-diff-e2e-"));
    try {
      await write(root, "eval-old.json", report({ cclawVersion: "0.26.0" }));
      await new Promise((r) => setTimeout(r, 10));
      await write(
        root,
        "eval-new.json",
        report({
          cclawVersion: "0.27.0",
          summary: {
            totalCases: 1,
            passed: 1,
            failed: 0,
            skipped: 0,
            totalCostUsd: 0.002,
            totalDurationMs: 150
          }
        })
      );

      const diff = await runEvalDiff({
        projectRoot: root,
        old: "0.26.0",
        new: "0.27.0"
      });
      expect(diff.regressed).toBe(false);
      expect(diff.summaryDelta.totalCostUsdDelta).toBeCloseTo(0.001, 5);
      expect(diff.summaryDelta.totalDurationMsDelta).toBe(50);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
