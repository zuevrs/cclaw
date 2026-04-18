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
 */
export const VERIFIER_KINDS = ["structural", "rules", "judge", "workflow"] as const;
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

/** Superset of per-verifier expectation shapes. Only `structural` is wired in Step 1. */
export interface ExpectedShape {
  structural?: StructuralExpected;
  /** Rule-based (keyword/regex/traceability) checks — Step 2. */
  rules?: Record<string, unknown>;
  /** LLM-judge rubrics — Step 3. */
  judge?: Record<string, unknown>;
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
