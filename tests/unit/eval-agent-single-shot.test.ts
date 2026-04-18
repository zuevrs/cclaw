import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  loadStageSkill,
  runSingleShot
} from "../../src/eval/agents/single-shot.js";
import type {
  ChatRequest,
  ChatResponse,
  EvalLlmClient
} from "../../src/eval/llm-client.js";
import type { EvalCase, ResolvedEvalConfig } from "../../src/eval/types.js";
import { createTempProject } from "../helpers/index.js";

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
    ...overrides
  };
}

function sampleCase(): EvalCase {
  return {
    id: "brainstorm-01",
    stage: "brainstorm",
    inputPrompt: "Explore caching strategies for the read API."
  };
}

describe("runSingleShot", () => {
  it("composes the chat request from SKILL.md + case prompt and returns the trimmed artifact", async () => {
    const root = await createTempProject("single-shot-happy");
    let capturedRequest: ChatRequest | undefined;
    const client: EvalLlmClient = {
      async chat(request) {
        capturedRequest = request;
        const response: ChatResponse = {
          content: "   # Directions\n\n- Direction A\n",
          usage: { promptTokens: 300, completionTokens: 80, totalTokens: 380 },
          finishReason: "stop",
          model: request.model,
          attempts: 1
        };
        return response;
      }
    };
    const out = await runSingleShot({
      caseEntry: sampleCase(),
      config: baseConfig(),
      projectRoot: root,
      client,
      loadSkill: async () => "# Brainstorm SKILL\nRules."
    });
    expect(out.artifact).toBe("# Directions\n\n- Direction A");
    expect(out.usage.totalTokens).toBe(380);
    expect(out.usageUsd).toBeGreaterThan(0);
    expect(capturedRequest?.messages[0]?.role).toBe("system");
    expect(capturedRequest?.messages[0]?.content).toContain("Brainstorm SKILL");
    expect(capturedRequest?.messages[1]?.role).toBe("user");
    expect(capturedRequest?.messages[1]?.content).toContain("brainstorm-01");
    expect(capturedRequest?.messages[1]?.content).toContain("caching strategies");
    expect(capturedRequest?.messages[1]?.content).toContain("Do not wrap in code fences");
    expect(capturedRequest?.temperature).toBeCloseTo(0.2, 4);
  });

  it("honors agentTemperature override from config", async () => {
    const root = await createTempProject("single-shot-temp");
    let capturedRequest: ChatRequest | undefined;
    const client: EvalLlmClient = {
      async chat(request) {
        capturedRequest = request;
        return {
          content: "x",
          usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
          finishReason: "stop",
          model: request.model,
          attempts: 1
        };
      }
    };
    await runSingleShot({
      caseEntry: sampleCase(),
      config: baseConfig({ agentTemperature: 0.9 }),
      projectRoot: root,
      client,
      loadSkill: async () => "system"
    });
    expect(capturedRequest?.temperature).toBe(0.9);
  });

  it("propagates client errors up the stack", async () => {
    const root = await createTempProject("single-shot-err");
    const client: EvalLlmClient = {
      async chat() {
        throw new Error("kaput");
      }
    };
    await expect(
      runSingleShot({
        caseEntry: sampleCase(),
        config: baseConfig(),
        projectRoot: root,
        client,
        loadSkill: async () => "system"
      })
    ).rejects.toThrow("kaput");
  });
});

describe("loadStageSkill", () => {
  it("throws an actionable error when the skill file is missing", async () => {
    const root = await createTempProject("skill-missing");
    await expect(loadStageSkill(root, "brainstorm")).rejects.toThrow(/Stage skill not found/);
  });

  it("reads the SKILL.md for the stage's skill folder", async () => {
    const root = await createTempProject("skill-ok");
    const skillFile = path.join(
      root,
      ".cclaw/skills/brainstorming/SKILL.md"
    );
    await fs.mkdir(path.dirname(skillFile), { recursive: true });
    await fs.writeFile(skillFile, "hello from skill", "utf8");
    const text = await loadStageSkill(root, "brainstorm");
    expect(text).toBe("hello from skill");
  });
});
