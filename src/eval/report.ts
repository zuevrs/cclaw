import path from "node:path";
import { EVALS_ROOT } from "../constants.js";
import { writeFileSafe } from "../fs-utils.js";
import type { EvalReport } from "./types.js";

export function reportsDir(projectRoot: string): string {
  return path.join(projectRoot, EVALS_ROOT, "reports");
}

export function defaultReportBasename(report: EvalReport): string {
  const ts = report.generatedAt.replace(/[:.]/g, "-");
  return `eval-${ts}-${report.runId.slice(0, 8)}`;
}

/**
 * Format a report as a human-readable Markdown document. Keeping the layout
 * stable matters: CI posts diffs against earlier reports, and unit tests use
 * the output as a regression guard.
 */
export function formatMarkdownReport(report: EvalReport): string {
  const { summary } = report;
  const stages = report.stages.length > 0 ? report.stages.join(", ") : "all";
  const lines: string[] = [];

  lines.push(`# cclaw eval report`);
  lines.push(``);
  lines.push(`- generated: ${report.generatedAt}`);
  lines.push(`- runId: ${report.runId}`);
  lines.push(`- cclaw version: ${report.cclawVersion}`);
  lines.push(`- provider: ${report.provider}`);
  lines.push(`- model: ${report.model}`);
  lines.push(`- tier: ${report.tier}`);
  lines.push(`- stages: ${stages}`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(`| metric | value |`);
  lines.push(`| --- | --- |`);
  lines.push(`| total cases | ${summary.totalCases} |`);
  lines.push(`| passed | ${summary.passed} |`);
  lines.push(`| failed | ${summary.failed} |`);
  lines.push(`| skipped | ${summary.skipped} |`);
  lines.push(`| total cost (USD) | ${summary.totalCostUsd.toFixed(4)} |`);
  lines.push(`| total duration (ms) | ${summary.totalDurationMs} |`);
  lines.push(``);

  if (report.baselineDelta) {
    const delta = report.baselineDelta;
    lines.push(`## Baseline delta`);
    lines.push(``);
    lines.push(`- baseline: ${delta.baselineId}`);
    lines.push(`- score delta: ${delta.scoreDelta.toFixed(4)}`);
    lines.push(`- critical failures: ${delta.criticalFailures}`);
    lines.push(``);
    if (delta.regressions.length > 0) {
      lines.push(`### Regressions`);
      lines.push(``);
      lines.push(`| stage | case id | verifier | reason | prev | curr |`);
      lines.push(`| --- | --- | --- | --- | --- | --- |`);
      for (const reg of delta.regressions) {
        const prev = reg.previousScore !== undefined ? reg.previousScore.toFixed(2) : "-";
        const curr = reg.currentScore !== undefined ? reg.currentScore.toFixed(2) : "-";
        lines.push(
          `| ${reg.stage} | ${reg.caseId} | ${reg.verifierId} | ${reg.reason} | ${prev} | ${curr} |`
        );
      }
      lines.push(``);
    }
  }

  if (report.cases.length === 0) {
    lines.push(`## Cases`);
    lines.push(``);
    lines.push(`No cases were executed. See \`docs/evals.md\` for the rollout plan.`);
    lines.push(``);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`## Cases`);
  lines.push(``);
  lines.push(`| stage | case id | passed | duration (ms) | cost (USD) |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const item of report.cases) {
    const cost = item.costUsd !== undefined ? item.costUsd.toFixed(4) : "-";
    lines.push(
      `| ${item.stage} | ${item.caseId} | ${item.passed ? "yes" : "no"} | ${item.durationMs} | ${cost} |`
    );
  }
  lines.push(``);

  lines.push(`## Verifier details`);
  lines.push(``);
  for (const item of report.cases) {
    lines.push(`### ${item.stage} / ${item.caseId}`);
    lines.push(``);
    for (const verifier of item.verifierResults) {
      const score = verifier.score !== undefined ? ` (score=${verifier.score.toFixed(2)})` : "";
      lines.push(
        `- ${verifier.kind} / ${verifier.id}: ${verifier.ok ? "ok" : "fail"}${score}` +
          (verifier.message ? ` — ${verifier.message}` : "")
      );
    }
    lines.push(``);
  }

  return `${lines.join("\n")}\n`;
}

export async function writeJsonReport(
  projectRoot: string,
  report: EvalReport,
  basename: string = defaultReportBasename(report)
): Promise<string> {
  const outPath = path.join(reportsDir(projectRoot), `${basename}.json`);
  await writeFileSafe(outPath, `${JSON.stringify(report, null, 2)}\n`);
  return outPath;
}

export async function writeMarkdownReport(
  projectRoot: string,
  report: EvalReport,
  basename: string = defaultReportBasename(report)
): Promise<string> {
  const outPath = path.join(reportsDir(projectRoot), `${basename}.md`);
  await writeFileSafe(outPath, formatMarkdownReport(report));
  return outPath;
}
