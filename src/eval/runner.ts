import { randomUUID } from "node:crypto";
import { CCLAW_VERSION } from "../constants.js";
import type { FlowStage } from "../types.js";
import { loadCorpus } from "./corpus.js";
import { loadEvalConfig } from "./config-loader.js";
import type {
  EvalCase,
  EvalCaseResult,
  EvalReport,
  EvalTier,
  ResolvedEvalConfig
} from "./types.js";

export interface RunEvalOptions {
  projectRoot: string;
  stage?: FlowStage;
  tier?: EvalTier;
  /** When true, run only structural verifiers. Wave 7.1 wires actual verifiers. */
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
  /**
   * Waves 7.1–7.3 progressively flip these to `true`. Wave 7.0 is `false`
   * across the board because no verifier is implemented yet.
   */
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

/**
 * Wave 7.0 runner. Responsibilities:
 * - Load resolved config (defaults + file + env).
 * - Load corpus (empty on a fresh install).
 * - Validate that no verifier flag asks for a capability that does not exist yet.
 * - Return either a dry-run summary or an empty report.
 *
 * Waves 7.1+ will replace the "no verifiers available" branch with the real
 * verifier dispatch pipeline. The signature stays stable so CLI wiring does
 * not churn.
 */
export async function runEval(options: RunEvalOptions): Promise<DryRunSummary | EvalReport> {
  const config = await loadEvalConfig(options.projectRoot, options.env ?? process.env);
  const corpus = await loadCorpus(options.projectRoot, options.stage);
  const plannedTier = options.tier ?? config.defaultTier;

  const notes: string[] = [];
  if (corpus.length === 0) {
    notes.push(
      "Corpus is empty. Seed cases land in Wave 7.1 (`.cclaw/evals/corpus/<stage>/*.yaml`)."
    );
  }
  if (options.schemaOnly) {
    notes.push("--schema-only is accepted; structural verifiers wire up in Wave 7.1.");
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
        structural: false,
        rules: false,
        judge: false,
        workflow: false
      },
      notes
    };
    return summary;
  }

  const now = new Date().toISOString();
  const caseResults: EvalCaseResult[] = corpus.map((item) => ({
    caseId: item.id,
    stage: item.stage,
    tier: plannedTier,
    passed: false,
    durationMs: 0,
    verifierResults: [
      {
        kind: "structural",
        id: "wave-7-0-skeleton",
        ok: false,
        message: "Verifiers are not implemented in Wave 7.0; run with --dry-run.",
        details: { skipped: true }
      }
    ]
  }));

  const report: EvalReport = {
    schemaVersion: 1,
    generatedAt: now,
    runId: randomUUID(),
    cclawVersion: CCLAW_VERSION,
    provider: config.provider,
    model: config.model,
    tier: plannedTier,
    stages: options.stage ? [options.stage] : [],
    cases: caseResults,
    summary: {
      totalCases: caseResults.length,
      passed: 0,
      failed: 0,
      skipped: caseResults.length,
      totalCostUsd: 0,
      totalDurationMs: 0
    }
  };

  return report;
}
