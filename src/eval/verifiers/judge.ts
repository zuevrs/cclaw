/**
 * LLM judge verifier — Step 3.
 *
 * Given an artifact and the stage's rubric, runs N judge samples (default
 * median-of-3) against the configured LLM, aggregates the per-check
 * scores, and returns one VerifierResult per rubric check plus one
 * aggregate result covering the whole stage.
 *
 * Deterministic pieces (JSON parsing, aggregation, scoring) are kept pure
 * so unit tests inject a stub EvalLlmClient and assert on the aggregate
 * math without touching the network.
 */
import {
  EvalLlmError,
  type ChatMessage,
  type ChatResponse,
  type ChatUsage,
  type EvalLlmClient
} from "../llm-client.js";
import { computeUsageUsd } from "../cost-guard.js";
import type {
  JudgeAggregate,
  JudgeExpected,
  JudgeInvocation,
  JudgeSample,
  ResolvedEvalConfig,
  RubricCheck,
  RubricDoc,
  VerifierResult
} from "../types.js";

export interface RunJudgeOptions {
  artifact: string;
  rubric: RubricDoc;
  config: Pick<
    ResolvedEvalConfig,
    | "model"
    | "judgeModel"
    | "judgeSamples"
    | "judgeTemperature"
    | "timeoutMs"
    | "tokenPricing"
  >;
  client: EvalLlmClient;
  /** Per-case hint that overlays the rubric (sample count, minimums). */
  caseHint?: JudgeExpected;
  /** Optional seed seed; incremented per sample for reproducibility. */
  baseSeed?: number;
}

const SCALE_MIN = 1;
const SCALE_MAX = 5;
const SYSTEM_PREAMBLE = `You are a strict reviewer for software engineering artifacts. ` +
  `You will receive a rubric and an artifact. ` +
  `Score each rubric check on an integer 1..5 scale, where:\n` +
  `  1 = does not meet the bar at all\n` +
  `  2 = barely meets the bar, major gaps\n` +
  `  3 = partially meets the bar, noticeable gaps\n` +
  `  4 = mostly meets the bar, small gaps\n` +
  `  5 = fully meets the bar\n` +
  `Respond with JSON only (no prose, no markdown fences). ` +
  `Shape: {"scores": {"<check-id>": 1..5, ...}, "rationales": {"<check-id>": "one sentence", ...}}. ` +
  `Include every check id in both maps. Use integer scores only.`;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] as number;
  return (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2);
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

function clampScore(raw: unknown): number | undefined {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return undefined;
  const clamped = Math.round(Math.min(Math.max(raw, SCALE_MIN), SCALE_MAX));
  return clamped;
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("```")) return trimmed;
  return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/**
 * Parse one judge response into a JudgeSample. The parser is intentionally
 * forgiving with rationales (missing -> empty string) but strict with
 * scores: missing or non-numeric entries are dropped and the coverage
 * flag on the aggregate flips to false.
 */
export function parseJudgeResponse(
  content: string,
  rubric: RubricDoc
): JudgeSample {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(content));
  } catch (err) {
    throw new Error(
      `Judge response was not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Judge response must be a JSON object with scores/rationales maps.");
  }
  const rawScores = (parsed as { scores?: unknown }).scores;
  const rawRationales = (parsed as { rationales?: unknown }).rationales;
  if (!rawScores || typeof rawScores !== "object" || Array.isArray(rawScores)) {
    throw new Error('Judge response missing "scores" object.');
  }
  const scores: Record<string, number> = {};
  const rationales: Record<string, string> = {};
  for (const check of rubric.checks) {
    const rawScore = (rawScores as Record<string, unknown>)[check.id];
    const clamped = clampScore(rawScore);
    if (clamped !== undefined) scores[check.id] = clamped;
    let rationale = "";
    if (rawRationales && typeof rawRationales === "object" && !Array.isArray(rawRationales)) {
      const raw = (rawRationales as Record<string, unknown>)[check.id];
      if (typeof raw === "string") rationale = raw.trim();
    }
    rationales[check.id] = rationale;
  }
  return { scores, rationales };
}

function aggregateSamples(rubric: RubricDoc, samples: JudgeSample[]): JudgeAggregate[] {
  return rubric.checks.map((check) => {
    const values: number[] = [];
    let covered = true;
    for (const sample of samples) {
      const value = sample.scores[check.id];
      if (typeof value === "number") values.push(value);
      else covered = false;
    }
    return {
      checkId: check.id,
      samples: values,
      median: median(values),
      mean: Number(mean(values).toFixed(4)),
      coverage: covered && samples.length > 0
    };
  });
}

function buildMessages(artifact: string, rubric: RubricDoc): ChatMessage[] {
  const rubricLines = rubric.checks.map((check) => {
    const scale = check.scale ? ` (${check.scale})` : "";
    const critical = check.critical ? " [critical]" : "";
    return `- ${check.id}${critical}: ${check.prompt}${scale}`;
  });
  const userContent = [
    `Rubric (stage=${rubric.stage}, rubric=${rubric.id}):`,
    ...rubricLines,
    ``,
    `Artifact:`,
    `"""`,
    artifact,
    `"""`,
    ``,
    `Return JSON only.`
  ].join("\n");
  return [
    { role: "system", content: SYSTEM_PREAMBLE },
    { role: "user", content: userContent }
  ];
}

function sumUsage(usages: ChatUsage[]): ChatUsage {
  let promptTokens = 0;
  let completionTokens = 0;
  let totalTokens = 0;
  for (const u of usages) {
    promptTokens += u.promptTokens;
    completionTokens += u.completionTokens;
    totalTokens += u.totalTokens;
  }
  return { promptTokens, completionTokens, totalTokens };
}

/** Run the judge against an artifact and return per-sample + aggregate data. */
export async function runJudge(options: RunJudgeOptions): Promise<JudgeInvocation> {
  const { artifact, rubric, config, client, caseHint, baseSeed } = options;
  const rawSamples =
    caseHint?.samples ?? config.judgeSamples ?? 3;
  if (!Number.isInteger(rawSamples) || rawSamples < 1) {
    throw new Error(
      `Invalid judge sample count: ${rawSamples}. Use a positive integer (1, 3, 5).`
    );
  }
  if (rawSamples % 2 === 0) {
    throw new Error(
      `Judge sample count must be odd (so a true median exists), got: ${rawSamples}.`
    );
  }
  const started = Date.now();
  const model = config.judgeModel ?? config.model;
  const temperature = config.judgeTemperature ?? 0;
  const messages = buildMessages(artifact, rubric);

  const samples: JudgeSample[] = [];
  const usages: ChatUsage[] = [];
  for (let i = 0; i < rawSamples; i += 1) {
    let response: ChatResponse;
    try {
      response = await client.chat({
        model,
        messages,
        temperature,
        responseFormatJson: true,
        ...(baseSeed !== undefined ? { seed: baseSeed + i } : {}),
        timeoutMs: config.timeoutMs
      });
    } catch (err) {
      if (err instanceof EvalLlmError) throw err;
      throw err;
    }
    usages.push(response.usage);
    samples.push(parseJudgeResponse(response.content, rubric));
  }
  const aggregates = aggregateSamples(rubric, samples);
  const usage = sumUsage(usages);
  const usageUsd = computeUsageUsd(model, usage, { tokenPricing: config.tokenPricing });
  return {
    rubricId: rubric.id,
    samples,
    aggregates,
    usageUsd,
    durationMs: Date.now() - started
  };
}

function verifierIdFor(check: RubricCheck): string {
  return `judge:${check.id}`;
}

/**
 * Convert a JudgeInvocation into VerifierResult[] for the runner. One
 * result per rubric check (score 0..1 normalized from the 1..5 median) +
 * one "coverage" result that flips to `ok:false` when any sample failed
 * to emit a score for a check.
 */
export function judgeResultsToVerifiers(
  rubric: RubricDoc,
  invocation: JudgeInvocation,
  config: Pick<ResolvedEvalConfig, "regression">,
  caseHint?: JudgeExpected
): VerifierResult[] {
  const out: VerifierResult[] = [];
  const failIfCriticalBelow = config.regression.failIfCriticalBelow;
  for (const aggregate of invocation.aggregates) {
    const check = rubric.checks.find((c) => c.id === aggregate.checkId);
    if (!check) continue;
    const normalized = (aggregate.median - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
    const caseMinimum = caseHint?.minimumScores?.[check.id];
    const criticalFloor = check.critical ? failIfCriticalBelow : undefined;
    const floors: number[] = [];
    if (typeof caseMinimum === "number") floors.push(caseMinimum);
    if (typeof criticalFloor === "number") floors.push(criticalFloor);
    const floor = floors.length > 0 ? Math.max(...floors) : undefined;
    const ok = !aggregate.coverage
      ? false
      : floor === undefined || aggregate.median >= floor;
    out.push({
      kind: "judge",
      id: verifierIdFor(check),
      ok,
      score: Number(Math.max(0, Math.min(1, normalized)).toFixed(4)),
      message: ok
        ? `median=${aggregate.median.toFixed(2)} across ${aggregate.samples.length} sample(s)`
        : aggregate.coverage
        ? `median=${aggregate.median.toFixed(2)} below floor=${floor?.toFixed(2) ?? "n/a"}`
        : `judge did not score every sample (${aggregate.samples.length}/${invocation.samples.length}); treated as failing`,
      details: {
        median: aggregate.median,
        mean: aggregate.mean,
        samples: aggregate.samples,
        coverage: aggregate.coverage,
        critical: check.critical === true,
        caseMinimum: caseMinimum ?? null,
        criticalFloor: criticalFloor ?? null
      }
    });
  }
  const required = caseHint?.requiredChecks ?? [];
  const covered = new Set(rubric.checks.map((c) => c.id));
  const missingRequired = required.filter((id) => !covered.has(id));
  if (missingRequired.length > 0) {
    out.push({
      kind: "judge",
      id: "judge:required-checks",
      ok: false,
      score: 0,
      message: `Rubric is missing required check id(s): ${missingRequired.join(", ")}`,
      details: { missing: missingRequired, rubricId: rubric.id }
    });
  }
  return out;
}
