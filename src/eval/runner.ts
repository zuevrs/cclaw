import { randomUUID } from "node:crypto";
import { CCLAW_VERSION } from "../constants.js";
import type { FlowStage } from "../types.js";
import { FLOW_STAGES } from "../types.js";
import { compareAgainstBaselines, loadBaselinesByStage } from "./baseline.js";
import { loadCorpus, readFixtureArtifact } from "./corpus.js";
import { loadEvalConfig } from "./config-loader.js";
import type {
  BaselineDelta,
  BaselineSnapshot,
  EvalCase,
  EvalCaseResult,
  EvalReport,
  EvalTier,
  ResolvedEvalConfig,
  VerifierResult
} from "./types.js";
import { verifyStructural } from "./verifiers/structural.js";

export interface RunEvalOptions {
  projectRoot: string;
  stage?: FlowStage;
  tier?: EvalTier;
  /** When true, run only structural verifiers (Wave 7.1). */
  schemaOnly?: boolean;
  /** When true, run structural + rule-based verifiers. Wave 7.2 wires rules. */
  rules?: boolean;
  /** When true, also run LLM judge verifiers. Wave 7.3 wires judging. */
  judge?: boolean;
  /** When true, load config + corpus and return a summary without running any verifier. */
  dryRun?: boolean;
  /** Override process.env during tests. */
  env?: NodeJS.ProcessEnv;
}

export interface DryRunSummary {
  kind: "dry-run";
  config: ResolvedEvalConfig;
  corpus: {
    total: number;
    byStage: Record<string, number>;
    cases: Array<{ id: string; stage: FlowStage }>;
  };
  plannedTier: EvalTier;
  verifiersAvailable: {
    structural: boolean;
    rules: boolean;
    judge: boolean;
    workflow: boolean;
  };
  notes: string[];
}

function groupByStage(cases: EvalCase[]): Record<string, number> {
  return cases.reduce<Record<string, number>>((acc, item) => {
    acc[item.stage] = (acc[item.stage] ?? 0) + 1;
    return acc;
  }, {});
}

function skeletonVerifierResult(message: string, details?: Record<string, unknown>): VerifierResult {
  return {
    kind: "structural",
    id: "wave-7-1-no-structural-expected",
    ok: true,
    score: 1,
    message,
    ...(details !== undefined ? { details } : {})
  };
}

async function runCaseStructural(
  projectRoot: string,
  caseEntry: EvalCase,
  plannedTier: EvalTier
): Promise<EvalCaseResult> {
  const started = Date.now();
  const structuralExpected = caseEntry.expected?.structural;
  const verifierResults: VerifierResult[] = [];

  if (!structuralExpected || Object.keys(structuralExpected).length === 0) {
    // No structural expectations declared — case is treated as "N/A" for this
    // verifier kind; a placeholder pass keeps downstream math simple while
    // making the situation visible in the report.
    verifierResults.push(
      skeletonVerifierResult(
        "No structural expectations declared for this case; structural verifier skipped.",
        { skipped: true }
      )
    );
  } else {
    let artifact: string | undefined;
    try {
      artifact = await readFixtureArtifact(projectRoot, caseEntry);
    } catch (err) {
      verifierResults.push({
        kind: "structural",
        id: "structural:fixture:missing",
        ok: false,
        score: 0,
        message: err instanceof Error ? err.message : String(err),
        details: { fixture: caseEntry.fixture }
      });
    }

    if (artifact !== undefined) {
      const results = verifyStructural(artifact, structuralExpected);
      if (results.length === 0) {
        verifierResults.push(
          skeletonVerifierResult(
            "Structural expectations parsed but produced zero checks.",
            { skipped: true }
          )
        );
      } else {
        verifierResults.push(...results);
      }
    } else if (verifierResults.length === 0) {
      verifierResults.push({
        kind: "structural",
        id: "structural:fixture:absent",
        ok: false,
        score: 0,
        message:
          "Structural expectations declared but no fixture path provided. Add `fixture: ./<id>/fixture.md`.",
        details: { fixtureProvided: false }
      });
    }
  }

  const allOk = verifierResults.every((r) => r.ok);
  return {
    caseId: caseEntry.id,
    stage: caseEntry.stage,
    tier: plannedTier,
    passed: allOk,
    durationMs: Date.now() - started,
    verifierResults
  };
}

function reduceSummary(caseResults: EvalCaseResult[]) {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let totalCostUsd = 0;
  let totalDurationMs = 0;
  for (const c of caseResults) {
    totalDurationMs += c.durationMs;
    if (c.costUsd !== undefined) totalCostUsd += c.costUsd;
    if (c.verifierResults.length === 1 && c.verifierResults[0]?.details?.skipped === true) {
      skipped += 1;
      continue;
    }
    if (c.passed) passed += 1;
    else failed += 1;
  }
  return {
    totalCases: caseResults.length,
    passed,
    failed,
    skipped,
    totalCostUsd: Number(totalCostUsd.toFixed(6)),
    totalDurationMs
  };
}

function stagesInResults(caseResults: EvalCaseResult[]): FlowStage[] {
  const set = new Set<FlowStage>();
  for (const c of caseResults) set.add(c.stage);
  return FLOW_STAGES.filter((s) => set.has(s));
}

/**
 * Wave 7.1 runner. When `schemaOnly` is set (or no other verifier flags are
 * active), runs structural verifiers against fixture-backed cases and loads
 * per-stage baselines for regression comparison. Tier A/B/C agent loops
 * still arrive in Waves 7.3+; until then cases without `fixture` are marked
 * as skipped rather than failing.
 */
export async function runEval(options: RunEvalOptions): Promise<DryRunSummary | EvalReport> {
  const config = await loadEvalConfig(options.projectRoot, options.env ?? process.env);
  const corpus = await loadCorpus(options.projectRoot, options.stage);
  const plannedTier = options.tier ?? config.defaultTier;

  const notes: string[] = [];
  if (corpus.length === 0) {
    notes.push(
      "Corpus is empty. Seed cases live under `.cclaw/evals/corpus/<stage>/*.yaml`."
    );
  }
  if (options.rules) {
    notes.push("--rules is accepted; rule verifiers wire up in Wave 7.2.");
  }
  if (options.judge) {
    notes.push("--judge is accepted; LLM judging wires up in Wave 7.3.");
  }

  if (options.dryRun === true) {
    const summary: DryRunSummary = {
      kind: "dry-run",
      config,
      corpus: {
        total: corpus.length,
        byStage: groupByStage(corpus),
        cases: corpus.map((item) => ({ id: item.id, stage: item.stage }))
      },
      plannedTier,
      verifiersAvailable: {
        structural: true,
        rules: false,
        judge: false,
        workflow: false
      },
      notes
    };
    return summary;
  }

  const now = new Date().toISOString();
  const caseResults: EvalCaseResult[] = [];
  for (const item of corpus) {
    caseResults.push(await runCaseStructural(options.projectRoot, item, plannedTier));
  }

  const stages = stagesInResults(caseResults);
  const baselines: Map<FlowStage, BaselineSnapshot> = await loadBaselinesByStage(
    options.projectRoot,
    stages
  );

  const summary = reduceSummary(caseResults);

  const report: EvalReport = {
    schemaVersion: 1,
    generatedAt: now,
    runId: randomUUID(),
    cclawVersion: CCLAW_VERSION,
    provider: config.provider,
    model: config.model,
    tier: plannedTier,
    stages,
    cases: caseResults,
    summary
  };

  const baselineDelta: BaselineDelta | undefined = compareAgainstBaselines(
    report,
    baselines
  );
  if (baselineDelta) report.baselineDelta = baselineDelta;

  return report;
}
