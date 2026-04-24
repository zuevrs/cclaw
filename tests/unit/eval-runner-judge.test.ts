import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { initCclaw } from "../../src/install.js";
import type { ChatResponse, EvalLlmClient } from "../../src/eval/llm-client.js";
import type { EvalReport } from "../../src/eval/types.js";

async function setupProjectWithCase(root: string): Promise<void> {
  await initCclaw({ projectRoot: root });
  const casePath = path.join(
    root,
    ".cclaw/evals/corpus/brainstorm/judge-demo.yaml"
  );
  await fs.mkdir(path.dirname(casePath), { recursive: true });
  await fs.writeFile(
    casePath,
    [
      "id: judge-demo",
      "stage: brainstorm",
      "input_prompt: |",
      "  Explore three caching strategies for the read API.",
      "expected:",
      "  judge:",
      "    required_checks:",
      "      - distinctness",
      ""
    ].join("\n"),
    "utf8"
  );

  const rubricPath = path.join(root, ".cclaw/evals/rubrics/brainstorm.yaml");
  await fs.mkdir(path.dirname(rubricPath), { recursive: true });
  await fs.writeFile(
    rubricPath,
    [
      "stage: brainstorm",
      "id: brainstorm",
      "checks:",
      "  - id: distinctness",
      "    prompt: Distinct alternatives are presented",
      "  - id: coverage",
      "    prompt: Key constraints and tradeoffs are covered",
      "  - id: actionability",
      "    prompt: Recommendations are concrete and actionable",
      "  - id: recommendation-clarity",
      "    prompt: Recommended option is explicit and justified",
      ""
    ].join("\n"),
    "utf8"
  );
}

function fakeAgentResponse(content: string): ChatResponse {
  return {
    content,
    usage: { promptTokens: 200, completionTokens: 80, totalTokens: 280 },
    finishReason: "stop",
    model: "glm-5.1",
    attempts: 1
  };
}

function fakeJudgeResponse(scores: Record<string, number>): ChatResponse {
  return {
    content: JSON.stringify({
      scores,
      rationales: Object.fromEntries(
        Object.keys(scores).map((id) => [id, "ok"])
      )
    }),
    usage: { promptTokens: 300, completionTokens: 40, totalTokens: 340 },
    finishReason: "stop",
    model: "glm-5.1",
    attempts: 1
  };
}

async function makeTempRoot(prefix: string): Promise<string> {
  const os = await import("node:os");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `cclaw-${prefix}-`));
  return root;
}

describe("eval runner --judge --mode=fixture", () => {
  it("runs the single-shot agent, scores the artifact, and records per-case cost", async () => {
    const root = await makeTempRoot("judge-happy");
    await setupProjectWithCase(root);
    let callIndex = 0;
    const client: EvalLlmClient = {
      async chat() {
        callIndex += 1;
        if (callIndex === 1) return fakeAgentResponse("# Directions\n\n- A\n- B\n- C\n");
        return fakeJudgeResponse({
          distinctness: 4,
          coverage: 4,
          actionability: 5,
          "recommendation-clarity": 5
        });
      }
    };
    const result = await runEval({
      projectRoot: root,
      judge: true,
      mode: "fixture",
      rules: false,
      stage: "brainstorm",
      env: { CCLAW_EVAL_API_KEY: "test" },
      llmClient: client
    });
    expect("kind" in result).toBe(false);
    const report = result as EvalReport;
    expect(callIndex).toBe(4);
    expect(report.summary.totalCases).toBe(1);
    const caseResult = report.cases[0]!;
    expect(caseResult.passed).toBe(true);
    expect(caseResult.costUsd).toBeDefined();
    const verifierIds = caseResult.verifierResults.map((r) => r.id);
    expect(verifierIds).toContain("agent:single-shot");
    expect(verifierIds).toContain("judge:distinctness");
    expect(verifierIds).toContain("judge:recommendation-clarity");
  });

  it("emits judge:rubric:missing when the stage rubric is absent", async () => {
    const root = await makeTempRoot("judge-no-rubric");
    await setupProjectWithCase(root);
    await fs.unlink(path.join(root, ".cclaw/evals/rubrics/brainstorm.yaml"));
    let callIndex = 0;
    const client: EvalLlmClient = {
      async chat() {
        callIndex += 1;
        return fakeAgentResponse("stub\n");
      }
    };
    const result = await runEval({
      projectRoot: root,
      judge: true,
      mode: "fixture",
      stage: "brainstorm",
      env: { CCLAW_EVAL_API_KEY: "test" },
      llmClient: client
    });
    expect("kind" in result).toBe(false);
    const report = result as EvalReport;
    const caseResult = report.cases[0]!;
    const missing = caseResult.verifierResults.find((r) => r.id === "judge:rubric:missing");
    expect(missing?.ok).toBe(false);
    expect(callIndex).toBe(1);
  });

  it("propagates DailyCostCapExceededError by aborting the run", async () => {
    const root = await makeTempRoot("judge-cap");
    await setupProjectWithCase(root);
    const client: EvalLlmClient = {
      async chat() {
        return {
          content: "# Big",
          usage: {
            promptTokens: 5_000_000,
            completionTokens: 5_000_000,
            totalTokens: 10_000_000
          },
          finishReason: "stop",
          model: "glm-5.1",
          attempts: 1
        };
      }
    };
    await expect(
      runEval({
        projectRoot: root,
        judge: true,
        mode: "fixture",
        stage: "brainstorm",
        env: {
          CCLAW_EVAL_API_KEY: "test",
          CCLAW_EVAL_DAILY_USD_CAP: "0.01"
        },
        llmClient: client
      })
    ).rejects.toThrow(/Daily cost cap/);
  });
});
