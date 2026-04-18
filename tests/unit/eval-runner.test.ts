import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { createEvalClient, EvalLlmNotWiredError } from "../../src/eval/llm-client.js";
import type { DryRunSummary } from "../../src/eval/runner.js";
import type { EvalReport } from "../../src/eval/types.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

function assertDryRun(result: DryRunSummary | EvalReport): asserts result is DryRunSummary {
  if (!("kind" in result)) {
    throw new Error("expected dry-run summary");
  }
}

function assertReport(result: DryRunSummary | EvalReport): asserts result is EvalReport {
  if ("kind" in result) {
    throw new Error("expected report");
  }
}

describe("eval runner", () => {
  it("returns dry-run summary with defaults when corpus is empty", async () => {
    const root = await createTempProject("runner-dry-empty");
    const result = await runEval({ projectRoot: root, dryRun: true, env: {} });
    assertDryRun(result);
    expect(result.corpus.total).toBe(0);
    expect(result.plannedTier).toBe("A");
    expect(result.config.apiKey).toBeUndefined();
    expect(result.verifiersAvailable).toEqual({
      structural: true,
      rules: false,
      judge: false,
      workflow: false
    });
    expect(result.notes.some((n) => n.includes("Corpus is empty"))).toBe(true);
  });

  it("dry-run with --judge adds a Wave 7.3 note", async () => {
    const root = await createTempProject("runner-dry-judge");
    const result = await runEval({
      projectRoot: root,
      dryRun: true,
      judge: true,
      env: {}
    });
    assertDryRun(result);
    expect(result.notes.some((n) => n.includes("Wave 7.3"))).toBe(true);
  });

  it("dry-run respects tier override", async () => {
    const root = await createTempProject("runner-dry-tier");
    const result = await runEval({
      projectRoot: root,
      dryRun: true,
      tier: "C",
      env: {}
    });
    assertDryRun(result);
    expect(result.plannedTier).toBe("C");
  });

  it("groups corpus by stage in dry-run summary", async () => {
    const root = await createTempProject("runner-dry-corpus");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/brainstorm/01.yaml",
      `id: b-01\nstage: brainstorm\ninput_prompt: x\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/brainstorm/02.yaml",
      `id: b-02\nstage: brainstorm\ninput_prompt: y\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/scope/01.yaml",
      `id: s-01\nstage: scope\ninput_prompt: z\n`
    );
    const result = await runEval({ projectRoot: root, dryRun: true, env: {} });
    assertDryRun(result);
    expect(result.corpus.total).toBe(3);
    expect(result.corpus.byStage).toEqual({ brainstorm: 2, scope: 1 });
  });

  it("non-dry-run on empty corpus returns a skeleton report", async () => {
    const root = await createTempProject("runner-skeleton");
    const result = await runEval({ projectRoot: root, env: {} });
    assertReport(result);
    expect(result.schemaVersion).toBe(1);
    expect(result.summary.totalCases).toBe(0);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.skipped).toBe(0);
    expect(result.provider).toBe("zai");
    expect(result.model).toBe("glm-5.1");
  });

  it("non-dry-run on a corpus without structural expectations skips verification", async () => {
    const root = await createTempProject("runner-skip");
    await writeProjectFile(
      root,
      ".cclaw/evals/corpus/brainstorm/01.yaml",
      `id: b-01\nstage: brainstorm\ninput_prompt: x\n`
    );
    const result = await runEval({ projectRoot: root, env: {} });
    assertReport(result);
    expect(result.summary.totalCases).toBe(1);
    expect(result.summary.skipped).toBe(1);
    expect(result.cases[0]?.passed).toBe(true);
    expect(result.cases[0]?.verifierResults[0]?.details).toEqual({ skipped: true });
  });
});

describe("eval llm client (Wave 7.0 stub)", () => {
  it("createEvalClient returns a shape that throws on chat()", async () => {
    const client = createEvalClient({
      provider: "zai",
      baseUrl: "https://api.z.ai/api/coding/paas/v4",
      model: "glm-5.1",
      defaultTier: "A",
      timeoutMs: 120_000,
      maxRetries: 2,
      regression: { failIfDeltaBelow: -0.15, failIfCriticalBelow: 3.0 },
      source: "default"
    });
    await expect(
      client.chat({ model: "glm-5.1", messages: [] })
    ).rejects.toBeInstanceOf(EvalLlmNotWiredError);
  });

  it("EvalLlmNotWiredError mentions the wave and offline fallback", async () => {
    const err = new EvalLlmNotWiredError("7.3");
    expect(err.message).toContain("Wave 7.3");
    expect(err.message).toContain("--dry-run");
  });
});
