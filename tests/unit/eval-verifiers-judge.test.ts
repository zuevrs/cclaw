import { describe, expect, it } from "vitest";
import {
  judgeResultsToVerifiers,
  parseJudgeResponse,
  runJudge
} from "../../src/eval/verifiers/judge.js";
import type {
  ChatResponse,
  ChatUsage,
  EvalLlmClient
} from "../../src/eval/llm-client.js";
import type {
  JudgeInvocation,
  ResolvedEvalConfig,
  RubricDoc
} from "../../src/eval/types.js";

function usage(prompt = 100, completion = 50): ChatUsage {
  return { promptTokens: prompt, completionTokens: completion, totalTokens: prompt + completion };
}

function okResponse(content: string): ChatResponse {
  return {
    content,
    usage: usage(),
    finishReason: "stop",
    model: "glm-5.1",
    attempts: 1
  };
}

function rubric(): RubricDoc {
  return {
    stage: "brainstorm",
    id: "brainstorm",
    checks: [
      { id: "distinctness", prompt: "?", critical: true },
      { id: "coverage", prompt: "?" }
    ]
  };
}

function baseConfig(overrides: Partial<ResolvedEvalConfig> = {}): ResolvedEvalConfig {
  return {
    provider: "zai",
    baseUrl: "u",
    model: "glm-5.1",
    defaultTier: "A",
    timeoutMs: 60_000,
    maxRetries: 1,
    regression: { failIfDeltaBelow: -0.15, failIfCriticalBelow: 3.0 },
    source: "default",
    judgeSamples: 3,
    ...overrides
  };
}

describe("parseJudgeResponse", () => {
  it("parses clean JSON and returns per-check scores + rationales", () => {
    const doc = rubric();
    const sample = parseJudgeResponse(
      JSON.stringify({
        scores: { distinctness: 4, coverage: 3 },
        rationales: { distinctness: "good", coverage: "ok" }
      }),
      doc
    );
    expect(sample.scores).toEqual({ distinctness: 4, coverage: 3 });
    expect(sample.rationales).toEqual({ distinctness: "good", coverage: "ok" });
  });

  it("strips code fences", () => {
    const doc = rubric();
    const sample = parseJudgeResponse(
      "```json\n{\"scores\":{\"distinctness\":5,\"coverage\":5},\"rationales\":{}}\n```",
      doc
    );
    expect(sample.scores.distinctness).toBe(5);
    expect(sample.rationales.distinctness).toBe("");
  });

  it("clamps scores to integer 1..5", () => {
    const doc = rubric();
    const sample = parseJudgeResponse(
      JSON.stringify({
        scores: { distinctness: 9, coverage: -1 },
        rationales: {}
      }),
      doc
    );
    expect(sample.scores.distinctness).toBe(5);
    expect(sample.scores.coverage).toBe(1);
  });

  it("drops missing scores (aggregate marks coverage=false later)", () => {
    const doc = rubric();
    const sample = parseJudgeResponse(
      JSON.stringify({ scores: { distinctness: 3 }, rationales: {} }),
      doc
    );
    expect(sample.scores).toEqual({ distinctness: 3 });
  });

  it("throws on malformed JSON", () => {
    const doc = rubric();
    expect(() => parseJudgeResponse("not json", doc)).toThrow(/not valid JSON/);
  });

  it("throws when scores map is missing", () => {
    const doc = rubric();
    expect(() => parseJudgeResponse(JSON.stringify({}), doc)).toThrow(/missing "scores"/);
  });
});

describe("runJudge", () => {
  function fakeClient(responses: string[]): EvalLlmClient {
    let i = 0;
    return {
      async chat() {
        const content = responses[i] ?? "{}";
        i += 1;
        return okResponse(content);
      }
    };
  }

  it("returns median-of-3 aggregates per rubric check", async () => {
    const doc = rubric();
    const client = fakeClient([
      JSON.stringify({ scores: { distinctness: 4, coverage: 3 }, rationales: {} }),
      JSON.stringify({ scores: { distinctness: 5, coverage: 3 }, rationales: {} }),
      JSON.stringify({ scores: { distinctness: 2, coverage: 4 }, rationales: {} })
    ]);
    const invocation = await runJudge({
      artifact: "some artifact",
      rubric: doc,
      config: baseConfig(),
      client
    });
    expect(invocation.samples).toHaveLength(3);
    const distinctness = invocation.aggregates.find((a) => a.checkId === "distinctness");
    expect(distinctness?.median).toBe(4);
    expect(distinctness?.coverage).toBe(true);
    const coverage = invocation.aggregates.find((a) => a.checkId === "coverage");
    expect(coverage?.median).toBe(3);
  });

  it("respects a single-sample run when judgeSamples=1", async () => {
    const doc = rubric();
    const client = fakeClient([
      JSON.stringify({ scores: { distinctness: 5, coverage: 5 }, rationales: {} })
    ]);
    const invocation = await runJudge({
      artifact: "x",
      rubric: doc,
      config: baseConfig({ judgeSamples: 1 }),
      client
    });
    expect(invocation.samples).toHaveLength(1);
    expect(invocation.aggregates.every((a) => a.median === 5)).toBe(true);
  });

  it("rejects even sample counts", async () => {
    const doc = rubric();
    const client = fakeClient([]);
    await expect(
      runJudge({
        artifact: "x",
        rubric: doc,
        config: baseConfig({ judgeSamples: 2 }),
        client
      })
    ).rejects.toThrow(/must be odd/);
  });

  it("flips coverage=false when a sample misses a check", async () => {
    const doc = rubric();
    const client = fakeClient([
      JSON.stringify({ scores: { distinctness: 4, coverage: 3 }, rationales: {} }),
      JSON.stringify({ scores: { distinctness: 5 }, rationales: {} }),
      JSON.stringify({ scores: { distinctness: 3, coverage: 3 }, rationales: {} })
    ]);
    const invocation = await runJudge({
      artifact: "x",
      rubric: doc,
      config: baseConfig(),
      client
    });
    const coverage = invocation.aggregates.find((a) => a.checkId === "coverage");
    expect(coverage?.coverage).toBe(false);
    expect(coverage?.samples).toEqual([3, 3]);
  });
});

describe("judgeResultsToVerifiers", () => {
  function invocation(medians: Record<string, number>, allCovered = true): JudgeInvocation {
    const doc = rubric();
    return {
      rubricId: doc.id,
      samples: [],
      aggregates: doc.checks.map((c) => ({
        checkId: c.id,
        samples: [medians[c.id]!],
        median: medians[c.id]!,
        mean: medians[c.id]!,
        coverage: allCovered
      })),
      usageUsd: 0.001,
      durationMs: 10
    };
  }

  it("marks ok when medians clear the critical floor", () => {
    const results = judgeResultsToVerifiers(
      rubric(),
      invocation({ distinctness: 4, coverage: 5 }),
      baseConfig()
    );
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it("fails critical checks below failIfCriticalBelow", () => {
    const results = judgeResultsToVerifiers(
      rubric(),
      invocation({ distinctness: 2, coverage: 5 }),
      baseConfig({ regression: { failIfDeltaBelow: -0.15, failIfCriticalBelow: 3.0 } })
    );
    const distinctness = results.find((r) => r.id === "judge:distinctness");
    expect(distinctness?.ok).toBe(false);
    const coverage = results.find((r) => r.id === "judge:coverage");
    expect(coverage?.ok).toBe(true);
  });

  it("fails a non-critical check when the case hint sets a minimumScore", () => {
    const results = judgeResultsToVerifiers(
      rubric(),
      invocation({ distinctness: 5, coverage: 3 }),
      baseConfig(),
      { minimumScores: { coverage: 4 } }
    );
    const coverage = results.find((r) => r.id === "judge:coverage");
    expect(coverage?.ok).toBe(false);
  });

  it("emits a judge:required-checks failure when a required id is absent", () => {
    const results = judgeResultsToVerifiers(
      rubric(),
      invocation({ distinctness: 4, coverage: 4 }),
      baseConfig(),
      { requiredChecks: ["missing-check"] }
    );
    const required = results.find((r) => r.id === "judge:required-checks");
    expect(required?.ok).toBe(false);
    expect(required?.message).toContain("missing-check");
  });

  it("treats coverage=false as failing regardless of the median", () => {
    const results = judgeResultsToVerifiers(
      rubric(),
      invocation({ distinctness: 5, coverage: 5 }, false),
      baseConfig()
    );
    expect(results.every((r) => r.ok === false)).toBe(true);
  });
});
