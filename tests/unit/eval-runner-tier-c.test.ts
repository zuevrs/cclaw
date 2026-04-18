import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { initCclaw } from "../../src/install.js";
import type { ChatResponse, EvalLlmClient } from "../../src/eval/llm-client.js";
import type { EvalReport } from "../../src/eval/types.js";

async function setupProjectWithWorkflowCase(root: string): Promise<void> {
  await initCclaw({ projectRoot: root });
  const yamlPath = path.join(
    root,
    ".cclaw/evals/corpus/workflows/wf-demo.yaml"
  );
  await fs.mkdir(path.dirname(yamlPath), { recursive: true });
  await fs.writeFile(
    yamlPath,
    [
      "id: wf-demo",
      "stages:",
      "  - name: brainstorm",
      "    input_prompt: Produce a brainstorm artifact.",
      "  - name: scope",
      "    input_prompt: Read stages/brainstorm.md and produce scope with D-01.",
      "consistency:",
      "  ids_flow:",
      "    - id_pattern: D-\\d+",
      "      from: scope",
      "      to: [scope]",
      "  placeholder_free:",
      "    stages: [brainstorm, scope]",
      ""
    ].join("\n"),
    "utf8"
  );
}

function stop(content: string): ChatResponse {
  return {
    content,
    usage: { promptTokens: 120, completionTokens: 40, totalTokens: 160 },
    finishReason: "stop",
    model: "glm-5.1",
    attempts: 1
  };
}

describe("eval runner --tier=C", () => {
  it("runs each stage of the workflow, records per-stage results, and runs consistency checks", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tier-c-"));
    await setupProjectWithWorkflowCase(root);

    const scripted: ChatResponse[] = [
      stop("# Brainstorm\n\n## Directions\n- A\n- B\n\n## Recommendation\nPick A.\n"),
      stop("# Scope\n\n## Decisions\n- D-01: pick A\n\n## Out of scope\n- none\n")
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
      tier: "C",
      env: { CCLAW_EVAL_API_KEY: "test" },
      llmClient: client
    });

    expect("kind" in result).toBe(false);
    const report = result as EvalReport;
    expect(report.tier).toBe("C");
    expect(report.summary.totalCases).toBe(1);
    const caseResult = report.cases[0]!;
    expect(caseResult.workflow).toBeDefined();
    expect(caseResult.workflow!.stages.map((s) => s.stage)).toEqual([
      "brainstorm",
      "scope"
    ]);
    const ids = caseResult.verifierResults.map((r) => r.id);
    expect(ids).toContain("workflow:agent");
    expect(
      ids.some((id) => id.startsWith("consistency:ids-flow:scope"))
    ).toBe(true);
    expect(
      ids.some((id) => id.startsWith("consistency:placeholder-free:"))
    ).toBe(true);
    expect(i).toBe(2);
  });

  it("records a workflow failure without throwing when the agent hits an error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tier-c-err-"));
    await setupProjectWithWorkflowCase(root);

    // The stage loop keeps asking for a tool that doesn't produce progress,
    // eventually hitting toolMaxTurns and surfacing MaxTurnsExceededError.
    const loopResp: ChatResponse = {
      content: "",
      toolCalls: [
        {
          id: "c",
          name: "read_file",
          arguments: JSON.stringify({ path: "README.md" })
        }
      ],
      usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
      finishReason: "tool_calls",
      model: "glm-5.1",
      attempts: 1
    };
    let i = 0;
    const client: EvalLlmClient = {
      async chat() {
        i += 1;
        return loopResp;
      }
    };
    await fs.writeFile(path.join(root, "README.md"), "hi\n", "utf8");

    const result = await runEval({
      projectRoot: root,
      tier: "C",
      env: {
        CCLAW_EVAL_API_KEY: "test",
        CCLAW_EVAL_TOOL_MAX_TURNS: "2"
      },
      llmClient: client
    });

    expect("kind" in result).toBe(false);
    const report = result as EvalReport;
    const caseResult = report.cases[0]!;
    expect(caseResult.passed).toBe(false);
    const errVerifier = caseResult.verifierResults.find(
      (r) => r.id === "workflow:agent:error"
    );
    expect(errVerifier).toBeDefined();
    expect(errVerifier?.ok).toBe(false);
    // The agent was invoked at least once.
    expect(i).toBeGreaterThan(0);
  });
});
