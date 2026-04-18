import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { initCclaw } from "../../src/install.js";
import type { ChatResponse, EvalLlmClient } from "../../src/eval/llm-client.js";
import type { EvalReport } from "../../src/eval/types.js";

async function setupProjectWithSpecCase(root: string): Promise<void> {
  await initCclaw({ projectRoot: root });
  const casePath = path.join(
    root,
    ".cclaw/evals/corpus/spec/tier-b-demo.yaml"
  );
  await fs.mkdir(path.dirname(casePath), { recursive: true });
  await fs.writeFile(
    casePath,
    [
      "id: tier-b-demo",
      "stage: spec",
      "input_prompt: |",
      "  Read the seeded README.md and produce a one-paragraph spec artifact.",
      "context_files:",
      "  - README.md",
      "expected:",
      "  judge:",
      "    required_checks:",
      "      - traceability",
      ""
    ].join("\n"),
    "utf8"
  );
  await fs.writeFile(
    path.join(root, "README.md"),
    "# Demo project\n\nHandles orders.\n",
    "utf8"
  );
}

function agentWithReadThenStop(): ChatResponse[] {
  return [
    {
      content: "",
      toolCalls: [
        {
          id: "call_read",
          name: "read_file",
          arguments: JSON.stringify({ path: "README.md" })
        }
      ],
      usage: { promptTokens: 100, completionTokens: 10, totalTokens: 110 },
      finishReason: "tool_calls",
      model: "glm-5.1",
      attempts: 1
    },
    {
      content: "# Spec\n\nHandles orders.\n",
      usage: { promptTokens: 120, completionTokens: 30, totalTokens: 150 },
      finishReason: "stop",
      model: "glm-5.1",
      attempts: 1
    }
  ];
}

function judgeResponse(scores: Record<string, number>): ChatResponse {
  return {
    content: JSON.stringify({
      scores,
      rationales: Object.fromEntries(Object.keys(scores).map((id) => [id, "ok"]))
    }),
    usage: { promptTokens: 400, completionTokens: 40, totalTokens: 440 },
    finishReason: "stop",
    model: "glm-5.1",
    attempts: 1
  };
}

async function makeTempRoot(prefix: string): Promise<string> {
  const os = await import("node:os");
  return fs.mkdtemp(path.join(os.tmpdir(), `cclaw-${prefix}-`));
}

describe("eval runner --judge --mode=agent", () => {
  it("runs the with-tools agent, records tool metrics, and scores the artifact", async () => {
    const root = await makeTempRoot("agent-mode");
    await setupProjectWithSpecCase(root);
    const scripted: ChatResponse[] = [
      ...agentWithReadThenStop(),
      judgeResponse({
        traceability: 5,
        "acceptance-criteria-coverage": 4,
        "decision-traceability": 4,
        testability: 4
      }),
      judgeResponse({
        traceability: 5,
        "acceptance-criteria-coverage": 5,
        "decision-traceability": 4,
        testability: 4
      }),
      judgeResponse({
        traceability: 5,
        "acceptance-criteria-coverage": 4,
        "decision-traceability": 5,
        testability: 4
      })
    ];
    let i = 0;
    const client: EvalLlmClient = {
      async chat() {
        const next = scripted[i];
        i += 1;
        if (!next) throw new Error(`client ran out at call ${i}`);
        return next;
      }
    };

    const result = await runEval({
      projectRoot: root,
      judge: true,
      mode: "agent",
      rules: false,
      stage: "spec",
      env: { CCLAW_EVAL_API_KEY: "test" },
      llmClient: client
    });

    expect("kind" in result).toBe(false);
    const report = result as EvalReport;
    expect(report.mode).toBe("agent");
    expect(report.summary.totalCases).toBe(1);
    const caseResult = report.cases[0]!;
    const ids = caseResult.verifierResults.map((r) => r.id);
    expect(ids).toContain("agent:with-tools");
    expect(ids).toContain("judge:traceability");
    const agentVerifier = caseResult.verifierResults.find(
      (r) => r.id === "agent:with-tools"
    );
    expect(agentVerifier?.ok).toBe(true);
    const toolUse = agentVerifier?.details?.toolUse as
      | { turns: number; calls: number; byTool: Record<string, number> }
      | undefined;
    expect(toolUse?.turns).toBe(2);
    expect(toolUse?.calls).toBe(1);
    expect(toolUse?.byTool.read_file).toBe(1);
    expect(caseResult.costUsd).toBeDefined();
    expect(caseResult.costUsd!).toBeGreaterThan(0);
    expect(i).toBe(5);
  });
});
