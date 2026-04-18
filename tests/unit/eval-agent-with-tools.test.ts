import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MaxTurnsExceededError,
  runWithTools
} from "../../src/eval/agents/with-tools.js";
import type {
  ChatRequest,
  ChatResponse,
  EvalLlmClient
} from "../../src/eval/llm-client.js";
import type { EvalCase, ResolvedEvalConfig } from "../../src/eval/types.js";

function baseConfig(overrides: Partial<ResolvedEvalConfig> = {}): ResolvedEvalConfig {
  return {
    provider: "zai",
    baseUrl: "u",
    model: "glm-5.1",
    defaultMode: "agent",
    timeoutMs: 30_000,
    maxRetries: 1,
    regression: { failIfDeltaBelow: -0.15, failIfCriticalBelow: 3.0 },
    source: "default",
    toolMaxTurns: 4,
    toolMaxArgumentsBytes: 4 * 1024,
    toolMaxResultBytes: 4 * 1024,
    ...overrides
  };
}

function spec(): EvalCase {
  return {
    id: "spec-01",
    stage: "spec",
    inputPrompt: "Read README.md and restate it verbatim as the artifact."
  };
}

function makeClient(
  responses: ChatResponse[],
  opts: { captureRequests?: ChatRequest[] } = {}
): EvalLlmClient {
  let i = 0;
  return {
    async chat(request) {
      opts.captureRequests?.push(request);
      const next = responses[i];
      i += 1;
      if (!next) throw new Error("client ran out of scripted responses");
      return { ...next, model: next.model ?? request.model };
    }
  };
}

describe("runWithTools (agent-mode with tools)", () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-agent-b-"));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
  });

  it("runs a read→final-stop loop, tracks tool usage, and disposes the sandbox", async () => {
    const requests: ChatRequest[] = [];
    const client = makeClient(
      [
        {
          content: "",
          toolCalls: [
            {
              id: "call_1",
              name: "read_file",
              arguments: JSON.stringify({ path: "README.md" })
            }
          ],
          usage: { promptTokens: 100, completionTokens: 20, totalTokens: 120 },
          finishReason: "tool_calls",
          model: "glm-5.1",
          attempts: 1
        },
        {
          content: "# Artifact\n\nRead the readme.",
          usage: { promptTokens: 180, completionTokens: 40, totalTokens: 220 },
          finishReason: "stop",
          model: "glm-5.1",
          attempts: 1
        }
      ],
      { captureRequests: requests }
    );

    await fs.writeFile(path.join(projectRoot, "README.md"), "hello world\n", "utf8");
    const result = await runWithTools({
      caseEntry: { ...spec(), contextFiles: ["README.md"] },
      config: baseConfig(),
      projectRoot,
      client,
      loadSkill: async () => "# Spec SKILL\nBe rigorous."
    });

    expect(result.artifact.startsWith("# Artifact")).toBe(true);
    expect(result.toolUse.turns).toBe(2);
    expect(result.toolUse.calls).toBe(1);
    expect(result.toolUse.errors).toBe(0);
    expect(result.toolUse.byTool.read_file).toBe(1);
    expect(result.usage.totalTokens).toBe(340);
    expect(requests[0]?.tools).toBeTruthy();
    expect(requests[0]?.toolChoice).toBe("auto");
    const toolMessage = requests[1]?.messages.find((m) => m.role === "tool");
    expect(toolMessage?.toolCallId).toBe("call_1");
    expect(toolMessage?.content).toContain("hello world");
  });

  it("prefers artifact.md written by the model over the assistant content", async () => {
    const client = makeClient([
      {
        content: "",
        toolCalls: [
          {
            id: "call_w",
            name: "write_file",
            arguments: JSON.stringify({
              path: "artifact.md",
              content: "# From disk\n"
            })
          }
        ],
        usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      },
      {
        content: "ignored fallback",
        usage: { promptTokens: 60, completionTokens: 5, totalTokens: 65 },
        finishReason: "stop",
        model: "glm-5.1",
        attempts: 1
      }
    ]);

    const out = await runWithTools({
      caseEntry: spec(),
      config: baseConfig(),
      projectRoot,
      client,
      loadSkill: async () => "# Spec SKILL"
    });
    expect(out.artifact).toBe("# From disk");
    expect(out.toolUse.byTool.write_file).toBe(1);
  });

  it("counts sandbox denials as tool errors and records the denied path", async () => {
    const client = makeClient([
      {
        content: "",
        toolCalls: [
          {
            id: "call_escape",
            name: "read_file",
            arguments: JSON.stringify({ path: "/etc/passwd" })
          }
        ],
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      },
      {
        content: "# Safe",
        usage: { promptTokens: 15, completionTokens: 3, totalTokens: 18 },
        finishReason: "stop",
        model: "glm-5.1",
        attempts: 1
      }
    ]);
    const out = await runWithTools({
      caseEntry: spec(),
      config: baseConfig(),
      projectRoot,
      client,
      loadSkill: async () => "# Spec"
    });
    expect(out.toolUse.errors).toBe(1);
    expect(out.toolUse.calls).toBe(0);
    expect(out.toolUse.deniedPaths).toContain("/etc/passwd");
  });

  it("rejects unknown tools without crashing the loop", async () => {
    const client = makeClient([
      {
        content: "",
        toolCalls: [
          { id: "u1", name: "delete_universe", arguments: "{}" }
        ],
        usage: { promptTokens: 10, completionTokens: 1, totalTokens: 11 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      },
      {
        content: "# Recovered",
        usage: { promptTokens: 12, completionTokens: 2, totalTokens: 14 },
        finishReason: "stop",
        model: "glm-5.1",
        attempts: 1
      }
    ]);
    const out = await runWithTools({
      caseEntry: spec(),
      config: baseConfig(),
      projectRoot,
      client,
      loadSkill: async () => "# Spec"
    });
    expect(out.toolUse.errors).toBe(1);
    expect(out.toolUse.byTool.delete_universe).toBe(1);
    expect(out.artifact).toBe("# Recovered");
  });

  it("throws MaxTurnsExceededError when the model never stops", async () => {
    const loop: ChatResponse = {
      content: "",
      toolCalls: [
        {
          id: "loop",
          name: "read_file",
          arguments: JSON.stringify({ path: "nope.txt" })
        }
      ],
      usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
      finishReason: "tool_calls",
      model: "glm-5.1",
      attempts: 1
    };
    const client = makeClient([loop, loop, loop]);
    await expect(
      runWithTools({
        caseEntry: spec(),
        config: baseConfig({ toolMaxTurns: 3 }),
        projectRoot,
        client,
        loadSkill: async () => "# Spec"
      })
    ).rejects.toBeInstanceOf(MaxTurnsExceededError);
  });

  it("enforces the toolMaxArgumentsBytes ceiling", async () => {
    const bigArgs = JSON.stringify({ pattern: "x".repeat(4096) });
    const client = makeClient([
      {
        content: "",
        toolCalls: [{ id: "big", name: "grep", arguments: bigArgs }],
        usage: { promptTokens: 5, completionTokens: 1, totalTokens: 6 },
        finishReason: "tool_calls",
        model: "glm-5.1",
        attempts: 1
      },
      {
        content: "# Still produced",
        usage: { promptTokens: 6, completionTokens: 1, totalTokens: 7 },
        finishReason: "stop",
        model: "glm-5.1",
        attempts: 1
      }
    ]);
    const out = await runWithTools({
      caseEntry: spec(),
      config: baseConfig({ toolMaxArgumentsBytes: 128 }),
      projectRoot,
      client,
      loadSkill: async () => "# Spec"
    });
    expect(out.toolUse.errors).toBe(1);
    expect(out.toolUse.byTool.grep).toBe(1);
  });
});
