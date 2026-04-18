import { randomUUID } from "node:crypto";
import { CCLAW_VERSION } from "../constants.js";
import type { FlowStage } from "../types.js";
import { FLOW_STAGES } from "../types.js";
import { runSingleShot } from "./agents/single-shot.js";
import { compareAgainstBaselines, loadBaselinesByStage } from "./baseline.js";
import { loadCorpus, readExtraFixtures, readFixtureArtifact } from "./corpus.js";
import { loadEvalConfig } from "./config-loader.js";
import {
  type CostGuard,
  createCostGuard,
  DailyCostCapExceededError
} from "./cost-guard.js";
import {
  createEvalClient,
  EvalLlmError,
  type EvalLlmClient
} from "./llm-client.js";
import { loadAllRubrics } from "./rubric-loader.js";
import type {
  BaselineDelta,
  BaselineSnapshot,
  EvalCase,
  EvalCaseResult,
  EvalReport,
  EvalTier,
  JudgeInvocation,
  ResolvedEvalConfig,
  RubricDoc,
  VerifierResult
} from "./types.js";
import { judgeResultsToVerifiers, runJudge } from "./verifiers/judge.js";
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
  /**
   * Optional LLM client injection. Primary use case: unit and
   * integration tests that want deterministic judge + agent behavior
   * without hitting the network.
   */
  llmClient?: EvalLlmClient;
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
  runJudge: boolean;
  runAgent: boolean;
}

/**
 * --schema-only narrows to structural. --rules opens up rules + traceability
 * on top of structural (traceability is a rule-family verifier even though
 * it lives in its own module). --judge opens up the LLM judge and, for
 * Tier A, the single-shot agent-under-test. --schema-only always wins so
 * the LLM-free PR gate never pays for tokens even if stale flags collide.
 */
function resolveRunFlags(options: RunEvalOptions): RunFlags {
  const rulesRequested = options.rules === true;
  const schemaOnly = options.schemaOnly === true;
  const judgeRequested = options.judge === true;
  const runJudge = judgeRequested && !schemaOnly;
  const runAgent = runJudge && (options.tier ?? "A") === "A";
  return {
    runStructural: true,
    runRules: rulesRequested && !schemaOnly,
    runTraceability: rulesRequested && !schemaOnly,
    runJudge,
    runAgent
  };
}

/**
 * Wrap a client so every chat() result is accounted against the cost
 * guard before being returned. The guard throws
 * DailyCostCapExceededError if committing the call would cross the
 * configured cap — the runner surfaces that as a hard failure so
 * nightly CI fails loud instead of silently overspending.
 */
function wrapClientWithCostGuard(
  client: EvalLlmClient,
  costGuard: CostGuard,
  fallbackModel: string
): EvalLlmClient {
  return {
    async chat(request) {
      const response = await client.chat(request);
      await costGuard.commit(response.model || fallbackModel, response.usage);
      return response;
    }
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

interface RunCaseContext {
  projectRoot: string;
  caseEntry: EvalCase;
  plannedTier: EvalTier;
  flags: RunFlags;
  config: ResolvedEvalConfig;
  client?: EvalLlmClient;
  costGuard: CostGuard;
  rubrics: Map<FlowStage, RubricDoc>;
}

async function runCase(ctx: RunCaseContext): Promise<EvalCaseResult> {
  const { projectRoot, caseEntry, plannedTier, flags, config, client, costGuard, rubrics } = ctx;
  const started = Date.now();
  const verifierResults: VerifierResult[] = [];
  const expected = caseEntry.expected;
  let caseCostUsd = 0;

  const hasStructural =
    !!expected?.structural && Object.keys(expected.structural).length > 0;
  const hasRules =
    flags.runRules && !!expected?.rules && Object.keys(expected.rules).length > 0;
  const hasTraceability =
    flags.runTraceability && !!expected?.traceability;
  const judgeRequested =
    flags.runJudge && !!expected?.judge;

  const needsArtifact = hasStructural || hasRules || hasTraceability || judgeRequested;
  let artifact: string | undefined;
  if (needsArtifact) {
    if (flags.runAgent && judgeRequested && client) {
      try {
        const produced = await runSingleShot({
          caseEntry,
          config,
          projectRoot,
          client
        });
        artifact = produced.artifact;
        caseCostUsd += produced.usageUsd;
        verifierResults.push({
          kind: "workflow",
          id: "agent:single-shot",
          ok: true,
          score: 1,
          message: `single-shot agent produced ${produced.artifact.length} char(s) in ${produced.durationMs}ms`,
          details: {
            model: produced.model,
            tokensIn: produced.usage.promptTokens,
            tokensOut: produced.usage.completionTokens,
            usageUsd: produced.usageUsd,
            attempts: produced.attempts
          }
        });
      } catch (err) {
        const retryable = err instanceof EvalLlmError ? err.retryable : false;
        verifierResults.push({
          kind: "workflow",
          id: "agent:single-shot",
          ok: false,
          score: 0,
          message: err instanceof Error ? err.message : String(err),
          details: { retryable }
        });
      }
    } else {
      artifact = await loadArtifactOrRecord(projectRoot, caseEntry, verifierResults);
    }
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

  if (judgeRequested && artifact !== undefined && client) {
    const rubric = rubrics.get(caseEntry.stage);
    if (!rubric) {
      verifierResults.push({
        kind: "judge",
        id: "judge:rubric:missing",
        ok: false,
        score: 0,
        message: `No rubric at .cclaw/evals/rubrics/${caseEntry.stage}.yaml. Add one before running --judge.`,
        details: { stage: caseEntry.stage }
      });
    } else {
      try {
        const invocation: JudgeInvocation = await runJudge({
          artifact,
          rubric,
          config,
          client,
          caseHint: expected!.judge
        });
        caseCostUsd += invocation.usageUsd;
        const judgeVerifiers = judgeResultsToVerifiers(
          rubric,
          invocation,
          config,
          expected!.judge
        );
        verifierResults.push(...judgeVerifiers);
      } catch (err) {
        if (err instanceof DailyCostCapExceededError) throw err;
        const retryable = err instanceof EvalLlmError ? err.retryable : false;
        verifierResults.push({
          kind: "judge",
          id: "judge:invocation:error",
          ok: false,
          score: 0,
          message: err instanceof Error ? err.message : String(err),
          details: { retryable, rubricId: rubric.id }
        });
      }
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
    costUsd: caseCostUsd > 0 ? Number(caseCostUsd.toFixed(6)) : undefined,
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
  const flags: RunFlags = resolveRunFlags(options);

  if (flags.runJudge && !config.apiKey && !options.llmClient) {
    notes.push(
      "--judge requires CCLAW_EVAL_API_KEY (or an injected client for tests); judge pipeline will report errors per case."
    );
  }
  if ((options.tier ?? "A") !== "A" && flags.runJudge) {
    notes.push(
      "Tier B/C agent-under-test is not wired yet; --judge will score the committed fixture as a stand-in."
    );
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
        structural: flags.runStructural,
        rules: flags.runRules,
        judge: flags.runJudge,
        workflow: flags.runAgent
      },
      notes
    };
    return summary;
  }

  const costGuard = createCostGuard(options.projectRoot, config);
  let wrappedClient: EvalLlmClient | undefined;
  if (flags.runJudge) {
    const base = options.llmClient ?? createEvalClient(config);
    wrappedClient = wrapClientWithCostGuard(
      base,
      costGuard,
      config.judgeModel ?? config.model
    );
  }
  const rubrics = flags.runJudge
    ? await loadAllRubrics(options.projectRoot)
    : new Map<FlowStage, RubricDoc>();

  const now = new Date().toISOString();
  const caseResults: EvalCaseResult[] = [];
  for (const item of corpus) {
    caseResults.push(
      await runCase({
        projectRoot: options.projectRoot,
        caseEntry: item,
        plannedTier,
        flags,
        config,
        client: wrappedClient,
        costGuard,
        rubrics
      })
    );
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
