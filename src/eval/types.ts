/**
 * Core types for the cclaw eval subsystem (Phase 7).
 *
 * The eval subsystem lets us measure whether a change to a prompt, skill, or
 * stage contract improves or regresses the quality of agent output. It is
 * deliberately decoupled from the main cclaw runtime so that:
 *
 * - Users who never run `cclaw eval` pay zero runtime cost.
 * - The verifier / rubric / LLM stack evolves on its own release cadence (Waves 7.0-7.6).
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
 * A single eval case describes one input scenario for one stage. Cases live in
 * `.cclaw/evals/corpus/<stage>/<id>.yaml` and may reference a pre-generated
 * fixture artifact for verifier development (Wave 7.1) before the agent loop
 * exists (Wave 7.3+).
 */
export interface EvalCase {
  id: string;
  stage: FlowStage;
  inputPrompt: string;
  /** Project files copied into the Tier B/C sandbox before the agent runs. */
  contextFiles?: string[];
  /**
   * Optional expected-shape hints consumed by structural/rule verifiers.
   * Left intentionally loose; verifiers in Waves 7.1–7.2 will narrow this.
   */
  expected?: Record<string, unknown>;
  /**
   * Path (relative to the corpus case file) of a pre-generated artifact used
   * when verifiers are exercised without a live agent loop. Primarily a Wave
   * 7.1 development aid.
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
  /** Present when comparing against a saved baseline (Wave 7.1+). */
  baselineDelta?: {
    baselineId: string;
    scoreDelta: number;
    criticalFailures: number;
  };
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
