import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runWorkflow } from "../../src/eval/agents/workflow.js";
import type {
  ChatRequest,
  ChatResponse,
  EvalLlmClient
} from "../../src/eval/llm-client.js";
import type {
  ResolvedEvalConfig,
  WorkflowCase
} from "../../src/eval/types.js";

function baseConfig(overrides: Partial<ResolvedEvalConfig> = {}): ResolvedEvalConfig {
  return {
    provider: "zai",
    baseUrl: "u",
    model: "glm-5.1",
    defaultMode: "workflow",
    timeoutMs: 30_000,
    maxRetries: 1,
    regression: { failIfDeltaBelow: -0.15, failIfCriticalBelow: 3.0 },
    source: "default",
    toolMaxTurns: 3,
    toolMaxArgumentsBytes: 4 * 1024,
    toolMaxResultBytes: 4 * 1024,
    workflowMaxTotalTurns: 12,
    ...overrides
  };
}

function workflow(): WorkflowCase {
  return {
    id: "wf-01",
    description: "Tiny two-stage workflow for unit coverage.",
    stages: [
      {
        name: "brainstorm",
        inputPrompt: "Produce a brainstorm artifact."
      },
      {
        name: "scope",
        inputPrompt:
          "Read stages/brainstorm.md and produce a scope artifact with D-01."
      }
    ]
  };
}

function scripted(
  responses: ChatResponse[],
  captured: ChatRequest[] = []
): EvalLlmClient {
  let i = 0;
  return {
    async chat(request) {
      captured.push(request);
      const next = responses[i];
      i += 1;
      if (!next) throw new Error("client ran out of scripted responses");
      return { ...next, model: next.model ?? request.model };
    }
  };
}

describe("runWorkflow (workflow-mode orchestrator)", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-wf-"));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("runs each stage, threads prior artifacts, and records per-stage metrics", async () => {
    const captured: ChatRequest[] = [];
    const client = scripted(
      [
        // stage 1 final stop
        {
          content: "# Brainstorm\n\nDirections: A, B, C.\n\n## Recommendation\nPick A.",
          usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
          finishReason: "stop",
          model: "glm-5.1",
          attempts: 1
        },
        // stage 2 final stop
        {
          content:
            "# Scope\n\n## Decisions\n- D-01: go with A.\n\n## Out of scope\n- anything else",
          usage: { promptTokens: 180, completionTokens: 60, totalTokens: 240 },
          finishReason: "stop",
          model: "glm-5.1",
          attempts: 1
        }
      ],
      captured
    );

    const result = await runWorkflow({
      workflow: workflow(),
      config: baseConfig(),
      projectRoot,
      client,
      loadSkill: async () => "# Stage SKILL\nBe terse."
    });

    expect(result.caseId).toBe("wf-01");
    expect(result.stages.map((s) => s.stage)).toEqual(["brainstorm", "scope"]);
    expect(result.stages[0]?.artifact.startsWith("# Brainstorm")).toBe(true);
    expect(result.stages[1]?.artifact.includes("D-01")).toBe(true);
    expect(result.artifacts.get("brainstorm")?.includes("Recommendation")).toBe(true);
    expect(result.totalDurationMs).toBeGreaterThanOrEqual(0);

    // Second-stage user prompt should mention the stages/*.md files.
    const stage2Request = captured[1];
    const userMsg = stage2Request?.messages.find((m) => m.role === "user");
    expect(userMsg?.content).toContain("stages/brainstorm.md");
    expect(userMsg?.content).toContain('stage "scope"');
  });

  it("clears artifact.md between stages so the next stage never inherits it", async () => {
    const captured: ChatRequest[] = [];
    // Stage 1: model calls write_file to create artifact.md.
    // Stage 2: model emits its artifact via the final stop message only.
    const client = scripted(
      [
        {
          content: "",
          toolCalls: [
            {
              id: "c1",
              name: "write_file",
              arguments: JSON.stringify({
                path: "artifact.md",
                content: "# Stage-1\n\nbrainstorm body"
              })
            }
          ],
          usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 },
          finishReason: "tool_calls",
          model: "glm-5.1",
          attempts: 1
        },
        {
          content: "done",
          usage: { promptTokens: 90, completionTokens: 10, totalTokens: 100 },
          finishReason: "stop",
          model: "glm-5.1",
          attempts: 1
        },
        {
          content: "# Scope\n\n- D-01: decision\n",
          usage: { promptTokens: 150, completionTokens: 40, totalTokens: 190 },
          finishReason: "stop",
          model: "glm-5.1",
          attempts: 1
        }
      ],
      captured
    );

    const result = await runWorkflow({
      workflow: workflow(),
      config: baseConfig(),
      projectRoot,
      client,
      loadSkill: async () => "# S"
    });

    // Stage 1 should pick up the model-written artifact.md.
    expect(result.stages[0]?.artifact.startsWith("# Stage-1")).toBe(true);
    // Stage 2 must not inherit Stage 1's artifact.md (cleared between stages).
    expect(result.stages[1]?.artifact.includes("Stage-1")).toBe(false);
    expect(result.stages[1]?.artifact.startsWith("# Scope")).toBe(true);
  });

  it("propagates errors from underlying with-tools loop (no partial success)", async () => {
    const client = scripted([
      {
        content: "",
        toolCalls: [
          {
            id: "c1",
            name: "read_file",
            arguments: JSON.stringify({ path: "missing.md" })
          }
        ],
        usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c2",
            name: "read_file",
            arguments: JSON.stringify({ path: "missing.md" })
          }
        ],
        usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      },
      {
        content: "",
        toolCalls: [
          {
            id: "c3",
            name: "read_file",
            arguments: JSON.stringify({ path: "missing.md" })
          }
        ],
        usage: { promptTokens: 60, completionTokens: 30, totalTokens: 90 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      }
    ]);

    await expect(
      runWorkflow({
        workflow: workflow(),
        config: baseConfig({ toolMaxTurns: 3 }),
        projectRoot,
        client,
        loadSkill: async () => "# S"
      })
    ).rejects.toThrow(/exceeded/i);
  });
});
