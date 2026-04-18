import { randomUUID } from "node:crypto";
import { CCLAW_VERSION } from "../constants.js";
import type { FlowStage } from "../types.js";
import { FLOW_STAGES } from "../types.js";
import { compareAgainstBaselines, loadBaselinesByStage } from "./baseline.js";
import { loadCorpus, readExtraFixtures, readFixtureArtifact } from "./corpus.js";
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
import { verifyRules } from "./verifiers/rules.js";
import { verifyStructural } from "./verifiers/structural.js";
import { verifyTraceability } from "./verifiers/traceability.js";

export interface RunEvalOptions {
  projectRoot: string;
  stage?: FlowStage;
  tier?: EvalTier;
  /** When true, run only structural verifiers (Step 1). */
  schemaOnly?: boolean;
  /** When true, run structural + rule-based verifiers. Step 2 wires rules. */
  rules?: boolean;
  /** When true, also run LLM judge verifiers. Step 3 wires judging. */
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
    id: "structural:no-expectations",
    ok: true,
    score: 1,
    message,
    ...(details !== undefined ? { details } : {})
  };
}

interface RunFlags {
  runStructural: boolean;
  runRules: boolean;
  runTraceability: boolean;
}

/**
 * --schema-only narrows to structural. --rules opens up rules + traceability
 * on top of structural (traceability is a rule-family verifier even though
 * it lives in its own module). Default (no flag) matches --schema-only for
 * backwards compatibility with the Step 1 gate.
 */
function resolveRunFlags(options: RunEvalOptions): RunFlags {
  const rulesRequested = options.rules === true;
  const schemaOnly = options.schemaOnly === true;
  return {
    runStructural: true,
    runRules: rulesRequested && !schemaOnly,
    runTraceability: rulesRequested && !schemaOnly
  };
}

async function loadArtifactOrRecord(
  projectRoot: string,
  caseEntry: EvalCase,
  verifierResults: VerifierResult[]
): Promise<string | undefined> {
  try {
    return await readFixtureArtifact(projectRoot, caseEntry);
  } catch (err) {
    verifierResults.push({
      kind: "structural",
      id: "structural:fixture:missing",
      ok: false,
      score: 0,
      message: err instanceof Error ? err.message : String(err),
      details: { fixture: caseEntry.fixture }
    });
    return undefined;
  }
}

async function runCase(
  projectRoot: string,
  caseEntry: EvalCase,
  plannedTier: EvalTier,
  flags: RunFlags
): Promise<EvalCaseResult> {
  const started = Date.now();
  const verifierResults: VerifierResult[] = [];
  const expected = caseEntry.expected;

  const hasStructural =
    !!expected?.structural && Object.keys(expected.structural).length > 0;
  const hasRules =
    flags.runRules && !!expected?.rules && Object.keys(expected.rules).length > 0;
  const hasTraceability =
    flags.runTraceability && !!expected?.traceability;

  const needsArtifact = hasStructural || hasRules || hasTraceability;
  let artifact: string | undefined;
  if (needsArtifact) {
    artifact = await loadArtifactOrRecord(projectRoot, caseEntry, verifierResults);
    if (artifact === undefined && verifierResults.length === 0) {
      verifierResults.push({
        kind: "structural",
        id: "structural:fixture:absent",
        ok: false,
        score: 0,
        message:
          "Expectations declared but no fixture path provided. Add `fixture: ./<id>/fixture.md`.",
        details: { fixtureProvided: false }
      });
    }
  }

  if (flags.runStructural) {
    if (!hasStructural) {
      verifierResults.push(
        skeletonVerifierResult(
          "No structural expectations declared for this case; structural verifier skipped.",
          { skipped: true }
        )
      );
    } else if (artifact !== undefined) {
      const results = verifyStructural(artifact, expected!.structural);
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
    }
  }

  if (hasRules && artifact !== undefined) {
    const results = verifyRules(artifact, expected!.rules);
    verifierResults.push(...results);
  }

  if (hasTraceability && artifact !== undefined) {
    try {
      const extras = await readExtraFixtures(projectRoot, caseEntry);
      const results = verifyTraceability(artifact, extras, expected!.traceability);
      verifierResults.push(...results);
    } catch (err) {
      verifierResults.push({
        kind: "rules",
        id: "traceability:fixture:missing",
        ok: false,
        score: 0,
        message: err instanceof Error ? err.message : String(err),
        details: { extraFixtures: Object.keys(caseEntry.extraFixtures ?? {}) }
      });
    }
  }

  const nonSkippedResults = verifierResults.filter((r) => r.details?.skipped !== true);
  const allOk =
    nonSkippedResults.length === 0
      ? verifierResults.every((r) => r.ok)
      : nonSkippedResults.every((r) => r.ok);
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
 * Structural runner. When `schemaOnly` is set (or no other verifier flags are
 * active), runs structural verifiers against fixture-backed cases and loads
 * per-stage baselines for regression comparison. Tier A/B/C agent loops
 * arrive in later steps; until then cases without `fixture` are marked as
 * skipped rather than failing.
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
  if (options.judge) {
    notes.push("--judge is accepted; LLM judging is not wired yet.");
  }

  const flags: RunFlags = resolveRunFlags(options);

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
        structural: flags.runStructural,
        rules: flags.runRules,
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
    caseResults.push(await runCase(options.projectRoot, item, plannedTier, flags));
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
