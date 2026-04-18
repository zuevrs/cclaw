import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  defaultReportBasename,
  formatMarkdownReport,
  writeJsonReport,
  writeMarkdownReport
} from "../../src/eval/report.js";
import type { EvalReport } from "../../src/eval/types.js";
import { createTempProject } from "../helpers/index.js";

function buildReport(overrides: Partial<EvalReport> = {}): EvalReport {
  return {
    schemaVersion: 1,
    generatedAt: "2026-04-17T10:00:00.000Z",
    runId: "11111111-2222-3333-4444-555555555555",
    cclawVersion: "0.22.0",
    provider: "zai",
    model: "glm-5.1",
    tier: "A",
    stages: [],
    cases: [],
    summary: {
      totalCases: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      totalCostUsd: 0,
      totalDurationMs: 0
    },
    ...overrides
  };
}

describe("eval report", () => {
  it("formats an empty report", () => {
    const md = formatMarkdownReport(buildReport());
    expect(md).toContain("# cclaw eval report");
    expect(md).toContain("provider: zai");
    expect(md).toContain("model: glm-5.1");
    expect(md).toContain("No cases were executed");
  });

  it("formats a report with cases and verifier details", () => {
    const report = buildReport({
      stages: ["brainstorm"],
      cases: [
        {
          caseId: "brainstorm-01",
          stage: "brainstorm",
          tier: "A",
          passed: true,
          durationMs: 42,
          costUsd: 0.0125,
          verifierResults: [
            { kind: "structural", id: "section-check", ok: true, score: 1 },
            {
              kind: "judge",
              id: "distinctness",
              ok: false,
              score: 0.6,
              message: "borderline"
            }
          ]
        }
      ],
      summary: {
        totalCases: 1,
        passed: 1,
        failed: 0,
        skipped: 0,
        totalCostUsd: 0.0125,
        totalDurationMs: 42
      }
    });
    const md = formatMarkdownReport(report);
    expect(md).toContain("| brainstorm | brainstorm-01 | yes | 42 | 0.0125 |");
    expect(md).toContain("structural / section-check: ok (score=1.00)");
    expect(md).toContain("judge / distinctness: fail (score=0.60) — borderline");
  });

  it("formats baseline delta when present", () => {
    const md = formatMarkdownReport(
      buildReport({
        baselineDelta: {
          baselineId: "2026-04-10-main",
          scoreDelta: -0.03,
          criticalFailures: 1
        }
      })
    );
    expect(md).toContain("## Baseline delta");
    expect(md).toContain("score delta: -0.0300");
    expect(md).toContain("critical failures: 1");
  });

  it("writes both JSON and Markdown to .cclaw/evals/reports/", async () => {
    const root = await createTempProject("report-writer");
    const report = buildReport();
    const basename = defaultReportBasename(report);
    const jsonPath = await writeJsonReport(root, report);
    const mdPath = await writeMarkdownReport(root, report);
    expect(jsonPath.endsWith(`${basename}.json`)).toBe(true);
    expect(mdPath.endsWith(`${basename}.md`)).toBe(true);
    const reportsDir = path.join(root, ".cclaw/evals/reports");
    const entries = await fs.readdir(reportsDir);
    expect(entries.some((e) => e.endsWith(".json"))).toBe(true);
    expect(entries.some((e) => e.endsWith(".md"))).toBe(true);
  });

  it("json report parses cleanly after write", async () => {
    const root = await createTempProject("report-roundtrip");
    const report = buildReport();
    const jsonPath = await writeJsonReport(root, report);
    const content = await fs.readFile(jsonPath, "utf8");
    const parsed = JSON.parse(content) as EvalReport;
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.cclawVersion).toBe("0.22.0");
  });
});
