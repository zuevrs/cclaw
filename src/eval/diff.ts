/**
 * `cclaw eval diff <old> <new>` — side-by-side report comparison.
 *
 * Loads two JSON reports under `.cclaw/evals/reports/` (by version tag or
 * explicit filename) and emits a compact human-readable + JSON diff:
 *
 *   - summary-level deltas (passed/failed/cost/duration)
 *   - per-case pass/fail transitions
 *   - per-verifier score drops (only the drops — new passes are noted in
 *     the summary line, not repeated per verifier)
 *   - Workflow-mode stage-level cost & duration deltas when both reports
 *     carry a `workflow` summary for the same case id
 *
 * The resolver accepts three shapes for the `<old>` / `<new>` arguments:
 *
 *   1. A bare version string (`0.26.0`) — matched against any report JSON
 *      whose `cclawVersion` field equals the string.
 *   2. A full or relative filename (`eval-2026-04-17T...-abc123.json`).
 *   3. The literal `latest` — picks the most recent report on disk by
 *      mtime.
 *
 * The diff is deterministic: sorted by case id, then verifier id. Missing
 * cases in one report show up as `added` or `removed` so callers can see
 * which corpus changes slipped in between versions.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import type {
  EvalCaseResult,
  EvalReport,
  VerifierResult,
  WorkflowStageResult
} from "./types.js";

export interface EvalDiffInput {
  projectRoot: string;
  /** Version string, filename, or "latest". */
  old: string;
  /** Version string, filename, or "latest". */
  new: string;
}

export interface EvalDiffCaseEntry {
  caseId: string;
  stage: string;
  /** Pass/fail transition: `same`, `regressed`, `recovered`, `added`, `removed`. */
  transition: "same" | "regressed" | "recovered" | "added" | "removed";
  previousPassed?: boolean;
  currentPassed?: boolean;
  durationDeltaMs?: number;
  costDeltaUsd?: number;
  verifierDeltas: EvalDiffVerifierEntry[];
  stageDeltas?: EvalDiffStageEntry[];
}

export interface EvalDiffVerifierEntry {
  verifierId: string;
  kind: string;
  transition: "same" | "regressed" | "recovered" | "added" | "removed" | "score-drop";
  previousScore?: number;
  currentScore?: number;
  previousOk?: boolean;
  currentOk?: boolean;
}

export interface EvalDiffStageEntry {
  stage: string;
  durationDeltaMs: number;
  costDeltaUsd: number;
  turnsDelta: number;
  callsDelta: number;
}

export interface EvalDiffReport {
  old: EvalDiffReportMeta;
  new: EvalDiffReportMeta;
  summaryDelta: {
    totalCasesDelta: number;
    passedDelta: number;
    failedDelta: number;
    skippedDelta: number;
    totalCostUsdDelta: number;
    totalDurationMsDelta: number;
  };
  cases: EvalDiffCaseEntry[];
  /** True when any case regressed or any verifier dropped. */
  regressed: boolean;
}

export interface EvalDiffReportMeta {
  runId: string;
  cclawVersion: string;
  generatedAt: string;
  mode: string;
  model: string;
  sourcePath: string;
}

const SCORE_DROP_EPSILON = 0.0001;

export async function resolveReportPath(
  projectRoot: string,
  selector: string
): Promise<string> {
  const dir = path.join(projectRoot, EVALS_ROOT, "reports");
  if (!(await exists(dir))) {
    throw new Error(
      `No reports directory at ${path.relative(projectRoot, dir)}. ` +
        `Run \`cclaw eval\` at least once before comparing reports.`
    );
  }
  const trimmed = selector.trim();
  if (trimmed.length === 0) {
    throw new Error(`Empty report selector. Pass a version like "0.26.0" or "latest".`);
  }

  // 1. Explicit filename (absolute or relative).
  const asPath = path.isAbsolute(trimmed) ? trimmed : path.join(dir, trimmed);
  if (await exists(asPath)) return asPath;
  if (trimmed.endsWith(".json") && (await exists(asPath))) return asPath;

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const jsonFiles = entries
    .filter((e) => e.isFile() && e.name.endsWith(".json"))
    .map((e) => path.join(dir, e.name));
  if (jsonFiles.length === 0) {
    throw new Error(
      `No JSON reports found under ${path.relative(projectRoot, dir)}.`
    );
  }

  if (trimmed === "latest") {
    let latest = jsonFiles[0] as string;
    let latestMtime = (await fs.stat(latest)).mtimeMs;
    for (const f of jsonFiles.slice(1)) {
      const stat = await fs.stat(f);
      if (stat.mtimeMs > latestMtime) {
        latest = f;
        latestMtime = stat.mtimeMs;
      }
    }
    return latest;
  }

  // 3. Version match — pick most recent by mtime among matches.
  const matches: Array<{ file: string; mtimeMs: number }> = [];
  for (const file of jsonFiles) {
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw) as { cclawVersion?: string };
      if (parsed.cclawVersion === trimmed) {
        const stat = await fs.stat(file);
        matches.push({ file, mtimeMs: stat.mtimeMs });
      }
    } catch {
      continue;
    }
  }
  if (matches.length === 0) {
    throw new Error(
      `No report matched selector "${selector}". ` +
        `Pass a filename under ${path.relative(projectRoot, dir)} or a cclawVersion present in one of the reports.`
    );
  }
  matches.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return (matches[0] as { file: string }).file;
}

async function loadReport(filePath: string): Promise<EvalReport> {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = JSON.parse(raw) as EvalReport;
  if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.cases)) {
    throw new Error(
      `File at ${filePath} is not a valid cclaw eval report (missing schemaVersion or cases).`
    );
  }
  return parsed;
}

function meta(report: EvalReport, sourcePath: string): EvalDiffReportMeta {
  return {
    runId: report.runId,
    cclawVersion: report.cclawVersion,
    generatedAt: report.generatedAt,
    mode: report.mode,
    model: report.model,
    sourcePath
  };
}

function verifierMap(
  results: VerifierResult[]
): Map<string, VerifierResult> {
  const out = new Map<string, VerifierResult>();
  for (const v of results) out.set(v.id, v);
  return out;
}

function diffCase(
  caseId: string,
  previous: EvalCaseResult | undefined,
  current: EvalCaseResult | undefined
): EvalDiffCaseEntry {
  const stage = (current ?? previous)!.stage;
  if (!previous) {
    return {
      caseId,
      stage,
      transition: "added",
      currentPassed: current?.passed,
      verifierDeltas: []
    };
  }
  if (!current) {
    return {
      caseId,
      stage,
      transition: "removed",
      previousPassed: previous.passed,
      verifierDeltas: []
    };
  }
  const transition: EvalDiffCaseEntry["transition"] =
    previous.passed === current.passed
      ? "same"
      : previous.passed && !current.passed
      ? "regressed"
      : "recovered";
  const prevMap = verifierMap(previous.verifierResults);
  const currMap = verifierMap(current.verifierResults);
  const verifierDeltas: EvalDiffVerifierEntry[] = [];
  const allIds = new Set<string>([...prevMap.keys(), ...currMap.keys()]);
  for (const id of [...allIds].sort((a, b) => a.localeCompare(b))) {
    const p = prevMap.get(id);
    const c = currMap.get(id);
    const kind = (c ?? p)!.kind;
    if (!p && c) {
      verifierDeltas.push({
        verifierId: id,
        kind,
        transition: "added",
        currentOk: c.ok,
        ...(c.score !== undefined ? { currentScore: c.score } : {})
      });
      continue;
    }
    if (p && !c) {
      verifierDeltas.push({
        verifierId: id,
        kind,
        transition: "removed",
        previousOk: p.ok,
        ...(p.score !== undefined ? { previousScore: p.score } : {})
      });
      continue;
    }
    if (!p || !c) continue;
    const okChanged = p.ok !== c.ok;
    const scoreChanged =
      typeof p.score === "number" &&
      typeof c.score === "number" &&
      Math.abs(p.score - c.score) > SCORE_DROP_EPSILON;
    if (!okChanged && !scoreChanged) continue;
    const entry: EvalDiffVerifierEntry = {
      verifierId: id,
      kind,
      transition: okChanged
        ? p.ok
          ? "regressed"
          : "recovered"
        : typeof p.score === "number" &&
          typeof c.score === "number" &&
          c.score < p.score
        ? "score-drop"
        : "same",
      previousOk: p.ok,
      currentOk: c.ok
    };
    if (typeof p.score === "number") entry.previousScore = p.score;
    if (typeof c.score === "number") entry.currentScore = c.score;
    if (entry.transition !== "same") verifierDeltas.push(entry);
  }

  const caseEntry: EvalDiffCaseEntry = {
    caseId,
    stage,
    transition,
    previousPassed: previous.passed,
    currentPassed: current.passed,
    durationDeltaMs: current.durationMs - previous.durationMs,
    verifierDeltas
  };
  const costDelta = (current.costUsd ?? 0) - (previous.costUsd ?? 0);
  if (Math.abs(costDelta) > SCORE_DROP_EPSILON) {
    caseEntry.costDeltaUsd = Number(costDelta.toFixed(6));
  }
  if (previous.workflow && current.workflow) {
    const prevStages = new Map<string, WorkflowStageResult>();
    for (const s of previous.workflow.stages) prevStages.set(s.stage, s);
    const stageDeltas: EvalDiffStageEntry[] = [];
    for (const curStage of current.workflow.stages) {
      const prevStage = prevStages.get(curStage.stage);
      if (!prevStage) continue;
      stageDeltas.push({
        stage: curStage.stage,
        durationDeltaMs: curStage.durationMs - prevStage.durationMs,
        costDeltaUsd: Number((curStage.usageUsd - prevStage.usageUsd).toFixed(6)),
        turnsDelta: curStage.toolUse.turns - prevStage.toolUse.turns,
        callsDelta: curStage.toolUse.calls - prevStage.toolUse.calls
      });
    }
    if (stageDeltas.length > 0) caseEntry.stageDeltas = stageDeltas;
  }
  return caseEntry;
}

export function diffReports(
  previous: EvalReport,
  current: EvalReport,
  prevPath: string,
  currPath: string
): EvalDiffReport {
  const prevMap = new Map<string, EvalCaseResult>();
  const currMap = new Map<string, EvalCaseResult>();
  for (const c of previous.cases) prevMap.set(c.caseId, c);
  for (const c of current.cases) currMap.set(c.caseId, c);
  const allIds = new Set<string>([...prevMap.keys(), ...currMap.keys()]);
  const cases = [...allIds]
    .sort((a, b) => a.localeCompare(b))
    .map((id) => diffCase(id, prevMap.get(id), currMap.get(id)));

  const regressed = cases.some(
    (c) =>
      c.transition === "regressed" ||
      c.transition === "removed" ||
      c.verifierDeltas.some(
        (v) => v.transition === "regressed" || v.transition === "score-drop"
      )
  );

  return {
    old: meta(previous, prevPath),
    new: meta(current, currPath),
    summaryDelta: {
      totalCasesDelta: current.summary.totalCases - previous.summary.totalCases,
      passedDelta: current.summary.passed - previous.summary.passed,
      failedDelta: current.summary.failed - previous.summary.failed,
      skippedDelta: current.summary.skipped - previous.summary.skipped,
      totalCostUsdDelta: Number(
        (current.summary.totalCostUsd - previous.summary.totalCostUsd).toFixed(6)
      ),
      totalDurationMsDelta:
        current.summary.totalDurationMs - previous.summary.totalDurationMs
    },
    cases,
    regressed
  };
}

export async function runEvalDiff(input: EvalDiffInput): Promise<EvalDiffReport> {
  const [oldPath, newPath] = await Promise.all([
    resolveReportPath(input.projectRoot, input.old),
    resolveReportPath(input.projectRoot, input.new)
  ]);
  const [oldReport, newReport] = await Promise.all([
    loadReport(oldPath),
    loadReport(newPath)
  ]);
  return diffReports(oldReport, newReport, oldPath, newPath);
}

/** Render the diff as a terse human-readable Markdown block. */
export function formatDiffMarkdown(diff: EvalDiffReport): string {
  const lines: string[] = [];
  lines.push(`# cclaw eval diff`);
  lines.push(``);
  lines.push(`- old: ${diff.old.cclawVersion} (${path.basename(diff.old.sourcePath)})`);
  lines.push(`- new: ${diff.new.cclawVersion} (${path.basename(diff.new.sourcePath)})`);
  lines.push(`- regressed: ${diff.regressed ? "yes" : "no"}`);
  lines.push(``);
  lines.push(`## Summary delta`);
  lines.push(``);
  const sd = diff.summaryDelta;
  lines.push(`| metric | delta |`);
  lines.push(`| --- | --- |`);
  lines.push(`| total cases | ${sd.totalCasesDelta >= 0 ? "+" : ""}${sd.totalCasesDelta} |`);
  lines.push(`| passed | ${sd.passedDelta >= 0 ? "+" : ""}${sd.passedDelta} |`);
  lines.push(`| failed | ${sd.failedDelta >= 0 ? "+" : ""}${sd.failedDelta} |`);
  lines.push(`| skipped | ${sd.skippedDelta >= 0 ? "+" : ""}${sd.skippedDelta} |`);
  lines.push(`| cost (USD) | ${sd.totalCostUsdDelta >= 0 ? "+" : ""}${sd.totalCostUsdDelta.toFixed(4)} |`);
  lines.push(`| duration (ms) | ${sd.totalDurationMsDelta >= 0 ? "+" : ""}${sd.totalDurationMsDelta} |`);
  lines.push(``);

  const noisyCases = diff.cases.filter(
    (c) => c.transition !== "same" || c.verifierDeltas.length > 0
  );
  if (noisyCases.length === 0) {
    lines.push(`No case-level changes.`);
    lines.push(``);
    return `${lines.join("\n")}\n`;
  }

  lines.push(`## Case changes`);
  lines.push(``);
  lines.push(`| case id | stage | transition | prev | curr |`);
  lines.push(`| --- | --- | --- | --- | --- |`);
  for (const c of noisyCases) {
    const prev =
      c.previousPassed === undefined ? "-" : c.previousPassed ? "pass" : "fail";
    const curr =
      c.currentPassed === undefined ? "-" : c.currentPassed ? "pass" : "fail";
    lines.push(
      `| ${c.caseId} | ${c.stage} | ${c.transition} | ${prev} | ${curr} |`
    );
  }
  lines.push(``);

  const withVerifiers = noisyCases.filter((c) => c.verifierDeltas.length > 0);
  if (withVerifiers.length > 0) {
    lines.push(`## Verifier changes`);
    lines.push(``);
    lines.push(`| case id | verifier | kind | transition | prev score | curr score |`);
    lines.push(`| --- | --- | --- | --- | --- | --- |`);
    for (const c of withVerifiers) {
      for (const v of c.verifierDeltas) {
        const prev =
          v.previousScore !== undefined ? v.previousScore.toFixed(2) : "-";
        const curr =
          v.currentScore !== undefined ? v.currentScore.toFixed(2) : "-";
        lines.push(
          `| ${c.caseId} | ${v.verifierId} | ${v.kind} | ${v.transition} | ${prev} | ${curr} |`
        );
      }
    }
    lines.push(``);
  }

  return `${lines.join("\n")}\n`;
}
