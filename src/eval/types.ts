/**
 * Core types for the cclaw eval subsystem (Phase 7).
 *
 * The eval subsystem lets us measure whether a change to a prompt, skill, or
 * stage contract improves or regresses the quality of agent output. It is
 * deliberately decoupled from the main cclaw runtime so that:
 *
 * - Users who never run `cclaw eval` pay zero runtime cost.
 * - The verifier / rubric / LLM stack evolves on its own release cadence (Steps 0-6).
 * - Any OpenAI-compatible endpoint can be swapped in via config (z.ai, OpenAI, vLLM, etc.).
 */
import type { FlowStage } from "../types.js";

/**
 * Fidelity tier for the agent-under-test.
 *
 * - `A` — single-shot API call, no tools. Cheap, validates core prompt behavior.
 * - `B` — SDK loop with function-calling for Read/Write/Glob/Grep inside a sandbox.
 * - `C` — multi-stage workflow run (brainstorm -> scope -> ... -> plan) with threaded
 *   artifacts. Most realistic tier we ship in Phase 7; literal IDE-harness runs
 *   (claude-code / cursor-agent proxied to OpenAI-compat) are deferred to Phase 8.
 */
export const EVAL_TIERS = ["A", "B", "C"] as const;
export type EvalTier = (typeof EVAL_TIERS)[number];

/**
 * Verifier kinds, in increasing cost and decreasing determinism:
 * structural and rules run without LLM; judge and workflow use the configured model.
 * `consistency` is the Tier C cross-artifact family (deterministic but
 * operates over multiple artifacts at once).
 */
export const VERIFIER_KINDS = [
  "structural",
  "rules",
  "judge",
  "workflow",
  "consistency"
] as const;
export type VerifierKind = (typeof VERIFIER_KINDS)[number];

/**
 * Structural expectations — deterministic, LLM-free checks against a single
 * text artifact. Step 1 implements all fields below; Step 2 adds the
 * sibling `rules` shape, Step 3 adds `judge`.
 */
export interface StructuralExpected {
  /**
   * Case-insensitive substrings that must each appear on at least one markdown
   * heading line (line starting with `#`). Useful for "required sections".
   */
  requiredSections?: string[];
  /**
   * Case-insensitive substrings that must NOT appear anywhere in the body
   * (headings or prose). Typical entries: "TBD", "TODO", "placeholder".
   */
  forbiddenPatterns?: string[];
  /** Inclusive minimum line count of the artifact body (frontmatter excluded). */
  minLines?: number;
  /** Inclusive maximum line count of the artifact body (frontmatter excluded). */
  maxLines?: number;
  /** Inclusive minimum character count of the artifact body. */
  minChars?: number;
  /** Inclusive maximum character count of the artifact body. */
  maxChars?: number;
  /**
   * Keys that must appear in the leading YAML frontmatter (between a pair of
   * `---` delimiters at the very top of the file). An artifact without
   * frontmatter will fail every entry.
   */
  requiredFrontmatterKeys?: string[];
}

/**
 * Rule-based expectations — zero-LLM content checks that are richer than
 * structural (regex, numeric bounds, uniqueness). Introduced in Step 2.
 *
 * Every array field is optional; an empty `RulesExpected` produces zero
 * verifier results so authors can enable rules incrementally.
 */
export interface RulesExpected {
  /** Case-insensitive substrings the body must include at least once. */
  mustContain?: string[];
  /** Case-insensitive substrings the body must NOT include. */
  mustNotContain?: string[];
  /** Regex patterns that must match the body at least once. */
  regexRequired?: RuleRegex[];
  /** Regex patterns that must NOT match the body. */
  regexForbidden?: RuleRegex[];
  /** For each substring key, the body must contain at least N occurrences. */
  minOccurrences?: Record<string, number>;
  /** For each substring key, the body must contain at most N occurrences. */
  maxOccurrences?: Record<string, number>;
  /**
   * For each named section (case-insensitive heading substring), every bullet
   * (`- ...`) directly under the section must be unique. Catches duplicated
   * decisions or repeated risks.
   */
  uniqueBulletsInSection?: string[];
}

export interface RuleRegex {
  /** Source of the regex. Parsed with `new RegExp(pattern, flags)`. */
  pattern: string;
  /** Optional regex flags; defaults to `"i"` for case-insensitive matching. */
  flags?: string;
  /** Human-readable label rendered in verifier messages and slugged into the id. */
  description?: string;
}

/**
 * Cross-stage traceability expectations — assert every ID extracted from
 * `source` also appears in `self` and/or named `extra_fixtures`. Introduced
 * in Step 2.
 */
export interface TraceabilityExpected {
  /** Regex applied to the `source` fixture to collect the authoritative ID set. */
  idPattern: string;
  /** Optional regex flags (defaults to `"g"`). */
  idFlags?: string;
  /**
   * Where to read the authoritative ID set from. Either `"self"` (the case's
   * primary `fixture`) or a label present in the case's `extraFixtures` map.
   */
  source: string;
  /**
   * Where every source ID must also appear. Each entry is `"self"` or an
   * `extraFixtures` label. Order is preserved for deterministic result ids.
   */
  requireIn: string[];
}

/**
 * LLM-judge expectations — Step 3.
 *
 * When present, the judge runs against the resolved artifact (live-agent
 * output in Tier A/B/C, or the pre-generated fixture when `--judge` is
 * combined with `--schema-only` for smoke tests). Every field below is
 * optional; the case-level hint overlays the stage-level rubric loaded
 * from `.cclaw/evals/rubrics/<stage>.yaml`.
 */
export interface JudgeExpected {
  /**
   * Per-case check ids that MUST be present in the stage rubric. Used when
   * a case wants to assert the rubric covers scenario-specific properties.
   */
  requiredChecks?: string[];
  /**
   * Stage rubric identifier when a stage ships multiple rubrics (e.g.
   * "strict" vs. "lenient"). Defaults to the stage name.
   */
  rubric?: string;
  /** Optional override of `config.judgeSamples` for the case. */
  samples?: number;
  /** Per-check minimum score (1..5 scale). Fail when any score drops below. */
  minimumScores?: Record<string, number>;
}

/** Superset of per-verifier expectation shapes. */
export interface ExpectedShape {
  structural?: StructuralExpected;
  /** Rule-based (keyword/regex/count/uniqueness) checks — Step 2. */
  rules?: RulesExpected;
  /** Cross-stage ID propagation checks — Step 2. */
  traceability?: TraceabilityExpected;
  /** LLM-judge rubrics — Step 3. */
  judge?: JudgeExpected;
}

/**
 * A single eval case describes one input scenario for one stage. Cases live in
 * `.cclaw/evals/corpus/<stage>/<id>.yaml` and may reference a pre-generated
 * fixture artifact for verifier development (Step 1) before the agent loop
 * exists (Step 3+).
 */
export interface EvalCase {
  id: string;
  stage: FlowStage;
  inputPrompt: string;
  /** Project files copied into the Tier B/C sandbox before the agent runs. */
  contextFiles?: string[];
  /**
   * Typed expectation hints consumed by the structural/rules/judge verifiers.
   * Each sub-shape is optional; missing sub-shapes skip that verifier tier.
   */
  expected?: ExpectedShape;
  /**
   * Path (relative to the corpus case file) of a pre-generated artifact used
   * when verifiers are exercised without a live agent loop. Primarily a
   * Step 1 development aid.
   */
  fixture?: string;
  /**
   * Additional fixture paths loaded alongside the primary `fixture`, keyed
   * by a free-form label. Consumed by cross-artifact verifiers (e.g.,
   * traceability) introduced in Step 2. Paths are resolved relative to the
   * case's stage directory, just like `fixture`.
   */
  extraFixtures?: Record<string, string>;
}

/** Result of one verifier applied to one case. */
export interface VerifierResult {
  kind: VerifierKind;
  id: string;
  ok: boolean;
  /** Normalized 0..1 score when the verifier produces a numeric signal. */
  score?: number;
  message?: string;
  details?: Record<string, unknown>;
}

/** Aggregate result for one case after all verifiers run. */
export interface EvalCaseResult {
  caseId: string;
  stage: FlowStage;
  tier: EvalTier;
  passed: boolean;
  durationMs: number;
  costUsd?: number;
  verifierResults: VerifierResult[];
  /**
   * Tier C only: the per-stage breakdown collected by the workflow
   * agent. Unset for Tier A/B cases so the on-disk JSON stays small.
   */
  workflow?: WorkflowRunSummary;
}

/** Top-level eval report, serialized to JSON and rendered to Markdown. */
export interface EvalReport {
  schemaVersion: 1;
  generatedAt: string;
  runId: string;
  cclawVersion: string;
  provider: string;
  model: string;
  tier: EvalTier;
  stages: FlowStage[];
  cases: EvalCaseResult[];
  summary: {
    totalCases: number;
    passed: number;
    failed: number;
    skipped: number;
    totalCostUsd: number;
    totalDurationMs: number;
  };
  /** Present when comparing against a saved baseline (Step 1+). */
  baselineDelta?: BaselineDelta;
}

/**
 * Eval configuration, persisted to `.cclaw/evals/config.yaml` and mergeable
 * with `CCLAW_EVAL_*` environment variables at runtime.
 */
export interface EvalConfig {
  /**
   * Free-form provider name used in reports. The actual HTTP protocol is
   * determined by `baseUrl`, which is expected to be OpenAI-compatible.
   */
  provider: string;
  /** OpenAI-compatible base URL, e.g. `https://api.z.ai/api/coding/paas/v4`. */
  baseUrl: string;
  /** Model identifier for both agent-under-test and judge unless `judgeModel` overrides. */
  model: string;
  /** Optional separate model for the judge role. Defaults to `model`. */
  judgeModel?: string;
  /** Default tier when `--tier` is not supplied. */
  defaultTier: EvalTier;
  /** Optional hard stop on estimated USD spend per day. Unset = no cap. */
  dailyUsdCap?: number;
  /** Regression thresholds for CI gates. */
  regression: {
    /** Fail when overall score drops by more than this fraction (e.g. 0.15 = 15%). */
    failIfDeltaBelow: number;
    /** Fail when any single critical rubric drops below this absolute score. */
    failIfCriticalBelow: number;
  };
  /** Per-agent-run timeout in milliseconds. */
  timeoutMs: number;
  /** Max retries per API call on transient failures. */
  maxRetries: number;
  /**
   * Number of judge samples per case (median-of-N). Defaults to 3 when unset.
   * Must be odd so a true median exists.
   */
  judgeSamples?: number;
  /** Sampling temperature for judge calls. Defaults to 0.0. */
  judgeTemperature?: number;
  /** Sampling temperature for the agent-under-test. Defaults to 0.2. */
  agentTemperature?: number;
  /**
   * Optional per-model USD pricing used by the cost guard. Keys match
   * `model` / `judgeModel`. Values in USD per 1K tokens, so
   * `{ input: 0.0005, output: 0.0015 }` = $0.50 per 1M input tokens.
   */
  tokenPricing?: Record<string, TokenPricing>;
  /**
   * Maximum assistant turns (tool_calls → tool result cycles) allowed by
   * the Tier B with-tools agent. Defaults to 8 when unset. Runs that
   * exceed the cap fail with a `MaxTurnsExceededError` and surface as a
   * workflow verifier result.
   */
  toolMaxTurns?: number;
  /**
   * Per-invocation ceiling on tool call arguments bytes. Defends against
   * runaway writes. Defaults to 64 KiB.
   */
  toolMaxArgumentsBytes?: number;
  /**
   * Per-invocation ceiling on tool call result bytes returned to the
   * model. Defaults to 32 KiB; longer results are truncated with a
   * marker so the model sees the cutoff.
   */
  toolMaxResultBytes?: number;
  /**
   * Maximum total turns a single Tier C workflow case may consume
   * across all stages combined. Defaults to 40 (stages × toolMaxTurns).
   * Runs that exceed the cap fail the current stage with a
   * `MaxTurnsExceededError` propagated from the underlying with-tools
   * loop rather than a dedicated workflow-level error.
   */
  workflowMaxTotalTurns?: number;
}

/** Per-model pricing schedule, expressed as USD per 1K tokens. */
export interface TokenPricing {
  input: number;
  output: number;
}

/** Resolved config with env overrides applied. */
export interface ResolvedEvalConfig extends EvalConfig {
  apiKey?: string;
  source: "default" | "file" | "env" | "file+env";
}

/**
 * Frozen per-stage baseline used by regression gating (Step 1). Baselines
 * are committed to git; `cclaw eval --update-baseline --confirm` rewrites
 * them. The shape is intentionally flat so a quick `git diff` reveals what
 * changed between runs.
 */
export interface BaselineSnapshot {
  schemaVersion: 1;
  stage: FlowStage;
  generatedAt: string;
  cclawVersion: string;
  /** Keyed by `EvalCase.id` so unchanged cases produce zero diff. */
  cases: Record<string, BaselineCaseEntry>;
}

export interface BaselineCaseEntry {
  passed: boolean;
  verifierResults: BaselineVerifierEntry[];
}

export interface BaselineVerifierEntry {
  id: string;
  kind: VerifierKind;
  ok: boolean;
  score?: number;
}

/**
 * Delta between a fresh report and the saved baseline. Populated when
 * baselines exist on disk and the run covers matching cases.
 */
export interface BaselineDelta {
  baselineId: string;
  /** Fresh-score − baseline-score, bounded to [-1, 1]. */
  scoreDelta: number;
  /** Count of checks that flipped from `ok:true` to `ok:false`. */
  criticalFailures: number;
  /** Per-case regression details for the Markdown report. */
  regressions: BaselineRegression[];
}

export interface BaselineRegression {
  caseId: string;
  stage: FlowStage;
  verifierId: string;
  reason: "newly-failing" | "case-now-failing" | "score-drop";
  previousScore?: number;
  currentScore?: number;
}

/**
 * One rubric check evaluated by the LLM judge. Scored on a 1..5 scale;
 * 5 means "the artifact fully meets the bar described by `prompt`".
 */
export interface RubricCheck {
  /** Kebab-case slug, unique per rubric. Stable across runs. */
  id: string;
  /** Natural-language question posed to the judge. */
  prompt: string;
  /** Human-readable scale description rendered in judge prompts. */
  scale?: string;
  /** Relative weight for the stage's aggregate score. Defaults to 1.0. */
  weight?: number;
  /**
   * When true, any sample below `config.regression.failIfCriticalBelow`
   * flips the verifier to `ok:false` (not just a score drop).
   */
  critical?: boolean;
}

/** Parsed `.cclaw/evals/rubrics/<stage>.yaml`. */
export interface RubricDoc {
  stage: FlowStage;
  /** Optional rubric variant label; defaults to the stage name. */
  id: string;
  checks: RubricCheck[];
}

/**
 * Judge response for a single sample (one API call). The judge is asked to
 * return structured JSON; `scores[id]` maps rubric check id → integer 1..5.
 * `rationales[id]` is a short plain-text explanation, useful in reports but
 * never used for gating.
 */
export interface JudgeSample {
  scores: Record<string, number>;
  rationales: Record<string, string>;
}

/** Aggregated judge output across N samples, per rubric check. */
export interface JudgeAggregate {
  checkId: string;
  samples: number[];
  median: number;
  mean: number;
  /** True iff every sample returned a score for this check. */
  coverage: boolean;
}

/**
 * Judge invocation result. Produced by `runJudge` and consumed by the
 * runner: the runner converts each aggregate into a `VerifierResult` and
 * records `usageUsd` toward the per-case cost.
 */
export interface JudgeInvocation {
  rubricId: string;
  samples: JudgeSample[];
  aggregates: JudgeAggregate[];
  usageUsd: number;
  durationMs: number;
}

/**
 * Tool-use summary produced by the Tier B with-tools agent. Captured so
 * the runner can surface per-case tool metrics in the markdown report
 * (number of calls, depth, error rate, denied paths).
 */
export interface ToolUseSummary {
  /** Turns consumed before the agent produced a terminal assistant message. */
  turns: number;
  /** Total successful tool invocations across all turns. */
  calls: number;
  /** Tool invocations that returned an error (bad args, denied path, etc.). */
  errors: number;
  /** Paths the sandbox refused to resolve (escape attempts, missing files). */
  deniedPaths: string[];
  /** Per-tool call counts, keyed by tool name. */
  byTool: Record<string, number>;
}

/**
 * Cross-stage consistency expectations for a Tier C workflow case. Every
 * sub-check is optional so authors can opt in incrementally; an empty
 * block produces zero verifier results.
 */
export interface WorkflowConsistencyExpected {
  /**
   * For each rule, every id extracted from the `from` stage must appear in
   * every listed `to` stage. Typical entry: `{ idPattern: "D-\\d+", from:
   * "scope", to: ["plan"] }`. Guards the "decisions flow downstream" rule.
   */
  idsFlow?: Array<{
    idPattern: string;
    idFlags?: string;
    from: WorkflowStageName;
    to: WorkflowStageName[];
  }>;
  /**
   * Stages that must not contain any of the listed case-insensitive
   * phrases. Defaults to `["TBD", "TODO", "placeholder"]` when set to an
   * empty array; omit entirely to skip the check.
   */
  placeholderFree?: {
    stages: WorkflowStageName[];
    phrases?: string[];
  };
  /**
   * Free-form substring pairs: for every entry, if `must` appears in the
   * named stage, `forbid` must NOT appear anywhere in the listed
   * `stages`. Useful for "v1 decided in scope, plan must not say v2".
   */
  noContradictions?: Array<{
    stage: WorkflowStageName;
    must: string;
    forbid: string;
    stages: WorkflowStageName[];
  }>;
}

/**
 * A single stage step inside a Tier C workflow case. The stage's
 * `inputPrompt` is handed to the Tier B with-tools agent with prior-stage
 * artifacts seeded into the sandbox under `stages/<name>.md`.
 */
export interface WorkflowStageStep {
  name: WorkflowStageName;
  inputPrompt: string;
  /** Per-stage rubric id override (defaults to the stage name). */
  rubric?: string;
  /** Per-stage required rubric check ids (mirror of JudgeExpected.requiredChecks). */
  requiredChecks?: string[];
  /** Per-stage minimum rubric scores (mirror of JudgeExpected.minimumScores). */
  minimumScores?: Record<string, number>;
}

/**
 * Supported workflow stages. Deliberately a subset of `FlowStage` —
 * Tier C covers the early "design" arc of a project. TDD/review/ship
 * are out of scope (they require real code execution).
 */
export const WORKFLOW_STAGES = [
  "brainstorm",
  "scope",
  "design",
  "spec",
  "plan"
] as const;
export type WorkflowStageName = (typeof WORKFLOW_STAGES)[number];

/**
 * A Tier C workflow case. Lives under
 * `.cclaw/evals/corpus/workflows/<id>.yaml` and wires a multi-stage run
 * through the with-tools agent.
 */
export interface WorkflowCase {
  id: string;
  /** Short human-readable description (rendered in reports). */
  description?: string;
  /** Project files seeded into the sandbox before stage 1 runs. */
  contextFiles?: string[];
  /** Ordered list of stages to run. Must be non-empty. */
  stages: WorkflowStageStep[];
  /** Cross-stage consistency checks (Tier C-specific verifier family). */
  consistency?: WorkflowConsistencyExpected;
}

/** Per-stage record inside a Tier C workflow run. */
export interface WorkflowStageResult {
  stage: WorkflowStageName;
  artifact: string;
  durationMs: number;
  usageUsd: number;
  toolUse: ToolUseSummary;
  attempts: number;
  model: string;
  promptTokens: number;
  completionTokens: number;
  /** True when the judge (when requested) produced `ok:true` for every required check. */
  judgeOk?: boolean;
  /** Per-rubric-check medians keyed by check id (for the report). */
  judgeMedians?: Record<string, number>;
}

/** Tier C orchestration output collected by the runner. */
export interface WorkflowRunSummary {
  caseId: string;
  stages: WorkflowStageResult[];
  totalUsageUsd: number;
  totalDurationMs: number;
  /** True when every stage judge was ok (or judge was skipped everywhere). */
  allJudgeOk: boolean;
}
