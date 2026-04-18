import { randomUUID } from "node:crypto";
import { CCLAW_VERSION } from "../constants.js";
import type { FlowStage } from "../types.js";
import { FLOW_STAGES } from "../types.js";
import { runSingleShot } from "./agents/single-shot.js";
import {
  MaxTurnsExceededError,
  runWithTools
} from "./agents/with-tools.js";
import { runWorkflow } from "./agents/workflow.js";
import { compareAgainstBaselines, loadBaselinesByStage } from "./baseline.js";
import { loadCorpus, readExtraFixtures, readFixtureArtifact } from "./corpus.js";
import { loadWorkflowCorpus } from "./workflow-corpus.js";
import { loadEvalConfig } from "./config-loader.js";
import {
  type CostGuard,
  createCostGuard,
  DailyCostCapExceededError,
  RunCostCapExceededError
} from "./cost-guard.js";
import {
  createEvalClient,
  EvalLlmError,
  type EvalLlmClient
} from "./llm-client.js";
import { noopProgressLogger, type ProgressLogger } from "./progress.js";
import { loadAllRubrics } from "./rubric-loader.js";
import type {
  BaselineDelta,
  BaselineSnapshot,
  EvalCase,
  EvalCaseResult,
  EvalMode,
  EvalReport,
  JudgeInvocation,
  ResolvedEvalConfig,
  RubricDoc,
  VerifierResult,
  WorkflowCase,
  WorkflowRunSummary,
  WorkflowStageName,
  WorkflowStageResult,
  WorkflowStageStep
} from "./types.js";
import { judgeResultsToVerifiers, runJudge } from "./verifiers/judge.js";
import { verifyRules } from "./verifiers/rules.js";
import { verifyStructural } from "./verifiers/structural.js";
import { verifyTraceability } from "./verifiers/traceability.js";
import { verifyWorkflowConsistency } from "./verifiers/workflow-consistency.js";

export interface RunEvalOptions {
  projectRoot: string;
  stage?: FlowStage;
  mode?: EvalMode;
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
  /**
   * Optional progress logger. The CLI wires a stderr-backed logger by
   * default so users see one-line updates during long runs; tests and
   * programmatic callers can inject a silent (noop) logger or capture
   * events for assertions. When omitted, progress is silenced.
   */
  progress?: ProgressLogger;
  /**
   * Per-run USD cap. Enforced in-memory; independent from the daily cap
   * (`dailyUsdCap` / `CCLAW_EVAL_DAILY_USD_CAP`) that persists across
   * invocations. Undefined means no cap.
   */
  maxCostUsd?: number;
  /**
   * Override the configured `model` (and `judgeModel`) for this run.
   * Used by `cclaw eval --compare-model` to replay the same corpus
   * against an alternative model without editing `config.yaml`.
   */
  modelOverride?: string;
}

export interface DryRunSummary {
  kind: "dry-run";
  config: ResolvedEvalConfig;
  corpus: {
    total: number;
    byStage: Record<string, number>;
    cases: Array<{ id: string; stage: FlowStage }>;
  };
  /** Only populated in `workflow` mode; empty for fixture / agent modes. */
  workflowCorpus: {
    total: number;
    cases: Array<{ id: string; stages: WorkflowStageName[] }>;
  };
  plannedMode: EvalMode;
  verifiersAvailable: {
    structural: boolean;
    rules: boolean;
    judge: boolean;
    workflow: boolean;
    consistency: boolean;
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
 * it lives in its own module). --judge opens up the LLM judge and, in
 * `agent` / `workflow` modes, the agent-under-test loop. --schema-only always
 * wins so the LLM-free PR gate never pays for tokens even if stale flags
 * collide.
 */
function resolveRunFlags(options: RunEvalOptions): RunFlags {
  const rulesRequested = options.rules === true;
  const schemaOnly = options.schemaOnly === true;
  const judgeRequested = options.judge === true;
  const mode: EvalMode = options.mode ?? "fixture";
  const runJudge = judgeRequested && !schemaOnly;
  // `workflow` always needs the agent loop (no fixture fallback), so we still
  // require an LLM client but do NOT require --judge on the CLI to produce a
  // workflow run. The judge piece stays gated by `runJudge` so consistency-
  // only runs remain cheap and deterministic.
  const runAgent =
    mode === "workflow"
      ? !schemaOnly
      : runJudge && (mode === "fixture" || mode === "agent");
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
  plannedMode: EvalMode;
  flags: RunFlags;
  config: ResolvedEvalConfig;
  client?: EvalLlmClient;
  costGuard: CostGuard;
  rubrics: Map<FlowStage, RubricDoc>;
}

interface RunWorkflowContext {
  projectRoot: string;
  workflow: WorkflowCase;
  plannedMode: EvalMode;
  flags: RunFlags;
  config: ResolvedEvalConfig;
  client?: EvalLlmClient;
  costGuard: CostGuard;
  rubrics: Map<FlowStage, RubricDoc>;
  progress: ProgressLogger;
  caseIndex: number;
  totalCases: number;
}

function stageJudgeHint(step: WorkflowStageStep): {
  rubric?: string;
  requiredChecks?: string[];
  minimumScores?: Record<string, number>;
} {
  const hint: {
    rubric?: string;
    requiredChecks?: string[];
    minimumScores?: Record<string, number>;
  } = {};
  if (step.rubric) hint.rubric = step.rubric;
  if (step.requiredChecks) hint.requiredChecks = step.requiredChecks;
  if (step.minimumScores) hint.minimumScores = step.minimumScores;
  return hint;
}

async function runWorkflowCase(ctx: RunWorkflowContext): Promise<EvalCaseResult> {
  const { projectRoot, workflow, plannedMode, flags, config, client, rubrics, progress, caseIndex, totalCases } = ctx;
  const started = Date.now();
  const verifierResults: VerifierResult[] = [];
  let caseCostUsd = 0;

  const lastStage: WorkflowStageName =
    (workflow.stages[workflow.stages.length - 1]?.name as WorkflowStageName) ??
    "plan";

  if (!flags.runAgent || !client) {
    verifierResults.push({
      kind: "workflow",
      id: "workflow:agent:disabled",
      ok: false,
      score: 0,
      message:
        "workflow mode requires the with-tools agent (CCLAW_EVAL_API_KEY or injected client). " +
        "Re-run with credentials to execute the workflow.",
      details: { stages: workflow.stages.map((s) => s.name) }
    });
    return {
      caseId: workflow.id,
      stage: lastStage as FlowStage,
      mode: plannedMode,
      passed: false,
      durationMs: Date.now() - started,
      verifierResults
    };
  }

  let workflowResult: Awaited<ReturnType<typeof runWorkflow>>;
  try {
    workflowResult = await runWorkflow({
      workflow,
      config,
      projectRoot,
      client,
      onStageStart: (stage) =>
        progress.emit({
          kind: "stage-start",
          caseId: workflow.id,
          stage,
          index: caseIndex,
          total: totalCases
        }),
      onStageEnd: (stage, stageResult) =>
        progress.emit({
          kind: "stage-end",
          caseId: workflow.id,
          stage,
          index: caseIndex,
          total: totalCases,
          passed: true,
          durationMs: stageResult.durationMs,
          ...(stageResult.usageUsd > 0 ? { costUsd: stageResult.usageUsd } : {})
        })
    });
  } catch (err) {
    if (err instanceof DailyCostCapExceededError || err instanceof RunCostCapExceededError) throw err;
    const retryable = err instanceof EvalLlmError ? err.retryable : false;
    const maxTurns = err instanceof MaxTurnsExceededError ? err.turns : undefined;
    verifierResults.push({
      kind: "workflow",
      id: "workflow:agent:error",
      ok: false,
      score: 0,
      message: err instanceof Error ? err.message : String(err),
      details: {
        retryable,
        ...(maxTurns !== undefined ? { maxTurnsExceeded: maxTurns } : {})
      }
    });
    return {
      caseId: workflow.id,
      stage: lastStage as FlowStage,
      mode: plannedMode,
      passed: false,
      durationMs: Date.now() - started,
      verifierResults
    };
  }

  caseCostUsd += workflowResult.totalUsageUsd;
  const stageResults: WorkflowStageResult[] = [...workflowResult.stages];
  verifierResults.push({
    kind: "workflow",
    id: "workflow:agent",
    ok: true,
    score: 1,
    message:
      `workflow ran ${stageResults.length} stage(s) in ` +
      `${workflowResult.totalDurationMs}ms ` +
      `(spent $${workflowResult.totalUsageUsd.toFixed(6)})`,
    details: {
      stages: stageResults.map((s) => ({
        name: s.stage,
        durationMs: s.durationMs,
        usageUsd: s.usageUsd,
        turns: s.toolUse.turns,
        calls: s.toolUse.calls
      }))
    }
  });

  let allJudgeOk = true;
  if (flags.runJudge) {
    for (let i = 0; i < workflow.stages.length; i += 1) {
      const step = workflow.stages[i] as WorkflowStageStep;
      const stageResult = stageResults[i] as WorkflowStageResult;
      const rubric = rubrics.get(step.name);
      if (!rubric) {
        verifierResults.push({
          kind: "judge",
          id: `judge:rubric:missing:${step.name}`,
          ok: false,
          score: 0,
          message: `No rubric at .cclaw/evals/rubrics/${step.name}.yaml.`,
          details: { stage: step.name }
        });
        allJudgeOk = false;
        stageResult.judgeOk = false;
        continue;
      }
      const hint = stageJudgeHint(step);
      try {
        const invocation = await runJudge({
          artifact: stageResult.artifact,
          rubric,
          config,
          client,
          caseHint: hint
        });
        caseCostUsd += invocation.usageUsd;
        const judgeVerifiers = judgeResultsToVerifiers(
          rubric,
          invocation,
          config,
          hint
        );
        const medians: Record<string, number> = {};
        for (const agg of invocation.aggregates) {
          medians[agg.checkId] = agg.median;
        }
        stageResult.judgeMedians = medians;
        const stageOk = judgeVerifiers.every((v) => v.ok);
        stageResult.judgeOk = stageOk;
        if (!stageOk) allJudgeOk = false;
        for (const v of judgeVerifiers) {
          verifierResults.push({
            ...v,
            id: `${v.id}:${step.name}`,
            details: { ...(v.details ?? {}), stage: step.name }
          });
        }
      } catch (err) {
        if (err instanceof DailyCostCapExceededError || err instanceof RunCostCapExceededError) throw err;
        const retryable = err instanceof EvalLlmError ? err.retryable : false;
        verifierResults.push({
          kind: "judge",
          id: `judge:invocation:error:${step.name}`,
          ok: false,
          score: 0,
          message: err instanceof Error ? err.message : String(err),
          details: { retryable, rubricId: rubric.id, stage: step.name }
        });
        stageResult.judgeOk = false;
        allJudgeOk = false;
      }
    }
  }

  const consistencyResults = verifyWorkflowConsistency(
    workflowResult.artifacts,
    workflow.consistency
  );
  verifierResults.push(...consistencyResults);

  const nonSkipped = verifierResults.filter((r) => r.details?.skipped !== true);
  const allOk =
    nonSkipped.length === 0
      ? verifierResults.every((r) => r.ok)
      : nonSkipped.every((r) => r.ok);

  const workflowSummary: WorkflowRunSummary = {
    caseId: workflow.id,
    stages: stageResults,
    totalUsageUsd: workflowResult.totalUsageUsd,
    totalDurationMs: workflowResult.totalDurationMs,
    allJudgeOk: flags.runJudge ? allJudgeOk : true
  };

  return {
    caseId: workflow.id,
    stage: lastStage as FlowStage,
    mode: plannedMode,
    passed: allOk,
    durationMs: Date.now() - started,
    costUsd: caseCostUsd > 0 ? Number(caseCostUsd.toFixed(6)) : undefined,
    verifierResults,
    workflow: workflowSummary
  };
}

async function runCase(ctx: RunCaseContext): Promise<EvalCaseResult> {
  const { projectRoot, caseEntry, plannedMode, flags, config, client, costGuard, rubrics } = ctx;
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
    if (flags.runAgent && judgeRequested && client && plannedMode === "fixture") {
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
        if (err instanceof DailyCostCapExceededError || err instanceof RunCostCapExceededError) throw err;
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
    } else if (flags.runAgent && judgeRequested && client && plannedMode === "agent") {
      try {
        const produced = await runWithTools({
          caseEntry,
          config,
          projectRoot,
          client
        });
        artifact = produced.artifact;
        caseCostUsd += produced.usageUsd;
        verifierResults.push({
          kind: "workflow",
          id: "agent:with-tools",
          ok: true,
          score: 1,
          message:
            `with-tools agent produced ${produced.artifact.length} char(s) in ` +
            `${produced.durationMs}ms across ${produced.toolUse.turns} turn(s) ` +
            `(${produced.toolUse.calls} tool call(s))`,
          details: {
            model: produced.model,
            tokensIn: produced.usage.promptTokens,
            tokensOut: produced.usage.completionTokens,
            usageUsd: produced.usageUsd,
            attempts: produced.attempts,
            toolUse: produced.toolUse
          }
        });
      } catch (err) {
        if (err instanceof DailyCostCapExceededError || err instanceof RunCostCapExceededError) throw err;
        const retryable = err instanceof EvalLlmError ? err.retryable : false;
        const maxTurns = err instanceof MaxTurnsExceededError ? err.turns : undefined;
        verifierResults.push({
          kind: "workflow",
          id: "agent:with-tools",
          ok: false,
          score: 0,
          message: err instanceof Error ? err.message : String(err),
          details: {
            retryable,
            ...(maxTurns !== undefined ? { maxTurnsExceeded: maxTurns } : {})
          }
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
        if (err instanceof DailyCostCapExceededError || err instanceof RunCostCapExceededError) throw err;
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
    mode: plannedMode,
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
 * Main eval runner. Dispatches between fixture-backed verification, the
 * single-stage agent-with-tools loop, and the multi-stage workflow
 * orchestrator based on `options.mode`. Per-stage baselines are loaded for
 * regression comparison. Cases without a `fixture` path in the yaml are
 * marked skipped (not failed) when no LLM drafting runs.
 */
export async function runEval(options: RunEvalOptions): Promise<DryRunSummary | EvalReport> {
  const baseConfig = await loadEvalConfig(
    options.projectRoot,
    options.env ?? process.env
  );
  const config: ResolvedEvalConfig = options.modelOverride
    ? {
        ...baseConfig,
        model: options.modelOverride,
        judgeModel: options.modelOverride
      }
    : baseConfig;
  const plannedMode: EvalMode = options.mode ?? config.defaultMode;
  const corpus =
    plannedMode === "workflow" ? [] : await loadCorpus(options.projectRoot, options.stage);
  const workflowCorpus =
    plannedMode === "workflow" ? await loadWorkflowCorpus(options.projectRoot) : [];

  const notes: string[] = [];
  if (plannedMode !== "workflow" && corpus.length === 0) {
    notes.push(
      "Corpus is empty. Seed cases live under `.cclaw/evals/corpus/<stage>/*.yaml`."
    );
  }
  if (plannedMode === "workflow" && workflowCorpus.length === 0) {
    notes.push(
      "Workflow corpus is empty. Workflow-mode cases live under `.cclaw/evals/corpus/workflows/*.yaml`."
    );
  }
  const flags: RunFlags = resolveRunFlags(options);

  if (flags.runJudge && !config.apiKey && !options.llmClient) {
    notes.push(
      "--judge requires CCLAW_EVAL_API_KEY (or an injected client for tests); judge pipeline will report errors per case."
    );
  }
  if (plannedMode === "workflow" && !config.apiKey && !options.llmClient) {
    notes.push(
      "workflow mode requires CCLAW_EVAL_API_KEY (or an injected client for tests); workflow runs will fail per case without one."
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
      workflowCorpus: {
        total: workflowCorpus.length,
        cases: workflowCorpus.map((item) => ({
          id: item.id,
          stages: item.stages.map((s) => s.name)
        }))
      },
      plannedMode,
      verifiersAvailable: {
        structural: flags.runStructural,
        rules: flags.runRules,
        judge: flags.runJudge,
        workflow: flags.runAgent,
        consistency: plannedMode === "workflow"
      },
      notes
    };
    return summary;
  }

  const costGuard = createCostGuard(
    options.projectRoot,
    config,
    options.maxCostUsd !== undefined ? { runCapUsd: options.maxCostUsd } : {}
  );
  const progress = options.progress ?? noopProgressLogger();
  let wrappedClient: EvalLlmClient | undefined;
  const clientNeeded = flags.runJudge || plannedMode === "workflow";
  if (clientNeeded) {
    const base =
      options.llmClient ??
      createEvalClient(config, {
        onRetry: (event) =>
          progress.emit({
            kind: "retry",
            caseId: "llm",
            attempt: event.attempt,
            maxAttempts: event.maxAttempts,
            waitMs: event.waitMs,
            reason: event.error.message
          })
      });
    wrappedClient = wrapClientWithCostGuard(
      base,
      costGuard,
      config.judgeModel ?? config.model
    );
  }
  const rubricsNeeded = flags.runJudge;
  const rubrics = rubricsNeeded
    ? await loadAllRubrics(options.projectRoot)
    : new Map<FlowStage, RubricDoc>();

  const now = new Date().toISOString();
  const caseResults: EvalCaseResult[] = [];
  const totalPlannedCases =
    plannedMode === "workflow" ? workflowCorpus.length : corpus.length;
  const runStarted = Date.now();
  progress.emit({
    kind: "run-start",
    mode: plannedMode,
    totalCases: totalPlannedCases
  });
  if (plannedMode === "workflow") {
    for (let i = 0; i < workflowCorpus.length; i += 1) {
      const wf = workflowCorpus[i]!;
      progress.emit({
        kind: "case-start",
        caseId: wf.id,
        stage: wf.stages[wf.stages.length - 1]?.name ?? "workflow",
        index: i + 1,
        total: workflowCorpus.length
      });
      const result = await runWorkflowCase({
        projectRoot: options.projectRoot,
        workflow: wf,
        plannedMode,
        flags,
        config,
        client: wrappedClient,
        costGuard,
        rubrics,
        progress,
        caseIndex: i + 1,
        totalCases: workflowCorpus.length
      });
      progress.emit({
        kind: "case-end",
        caseId: wf.id,
        stage: result.stage,
        index: i + 1,
        total: workflowCorpus.length,
        passed: result.passed,
        durationMs: result.durationMs,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {})
      });
      caseResults.push(result);
    }
  } else {
    for (let i = 0; i < corpus.length; i += 1) {
      const item = corpus[i]!;
      progress.emit({
        kind: "case-start",
        caseId: item.id,
        stage: item.stage,
        index: i + 1,
        total: corpus.length
      });
      const result = await runCase({
        projectRoot: options.projectRoot,
        caseEntry: item,
        plannedMode,
        flags,
        config,
        client: wrappedClient,
        costGuard,
        rubrics
      });
      progress.emit({
        kind: "case-end",
        caseId: item.id,
        stage: item.stage,
        index: i + 1,
        total: corpus.length,
        passed: result.passed,
        durationMs: result.durationMs,
        ...(result.costUsd !== undefined ? { costUsd: result.costUsd } : {})
      });
      caseResults.push(result);
    }
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
    mode: plannedMode,
    stages,
    cases: caseResults,
    summary
  };

  const baselineDelta: BaselineDelta | undefined = compareAgainstBaselines(
    report,
    baselines
  );
  if (baselineDelta) report.baselineDelta = baselineDelta;

  progress.emit({
    kind: "run-end",
    totalCases: summary.totalCases,
    passed: summary.passed,
    failed: summary.failed,
    durationMs: Date.now() - runStarted
  });

  return report;
}
