import { describe, expect, it } from "vitest";
import {
  createEvalClient,
  EvalLlmAuthError,
  EvalLlmInvalidResponseError,
  EvalLlmNotConfiguredError,
  EvalLlmRateLimitedError,
  EvalLlmTimeoutError,
  EvalLlmTransportError,
  type OpenAILike
} from "../../src/eval/llm-client.js";
import type { ResolvedEvalConfig } from "../../src/eval/types.js";

function baseConfig(overrides: Partial<ResolvedEvalConfig> = {}): ResolvedEvalConfig {
  return {
    provider: "zai",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    model: "glm-5.1",
    defaultMode: "fixture",
    timeoutMs: 60_000,
    maxRetries: 2,
    regression: { failIfDeltaBelow: -0.15, failIfCriticalBelow: 3.0 },
    source: "default",
    ...overrides
  };
}

type CreateFn = OpenAILike["chat"]["completions"]["create"];

function fakeOpenai(create: CreateFn): OpenAILike {
  return { chat: { completions: { create } } };
}

describe("eval llm-client adapter", () => {
  it("returns a parsed ChatResponse on a happy path", async () => {
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async () => ({
          model: "glm-5.1-fake",
          choices: [
            {
              message: { content: "hi there" },
              finish_reason: "stop"
            }
          ],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
        }))
    });
    const response = await client.chat({
      model: "glm-5.1",
      messages: [{ role: "user", content: "hello" }]
    });
    expect(response.content).toBe("hi there");
    expect(response.model).toBe("glm-5.1-fake");
    expect(response.usage).toEqual({ promptTokens: 10, completionTokens: 5, totalTokens: 15 });
    expect(response.finishReason).toBe("stop");
    expect(response.attempts).toBe(1);
  });

  it("throws EvalLlmNotConfiguredError when apiKey is missing", async () => {
    const client = createEvalClient(baseConfig());
    await expect(
      client.chat({ model: "glm-5.1", messages: [] })
    ).rejects.toBeInstanceOf(EvalLlmNotConfiguredError);
  });

  it("retries on 429 with sleep and succeeds", async () => {
    let calls = 0;
    const slept: number[] = [];
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async () => {
          calls += 1;
          if (calls < 2) {
            const err: Error & { status?: number } = new Error("too many");
            err.status = 429;
            throw err;
          }
          return {
            model: "glm-5.1",
            choices: [
              { message: { content: "ok" }, finish_reason: "stop" }
            ],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          };
        }),
      sleep: async (ms) => {
        slept.push(ms);
      },
      retryPolicy: { maxRetries: 2, initialBackoffMs: 10, maxBackoffMs: 50 }
    });
    const response = await client.chat({ model: "glm-5.1", messages: [] });
    expect(response.content).toBe("ok");
    expect(response.attempts).toBe(2);
    expect(calls).toBe(2);
    expect(slept).toEqual([10]);
  });

  it("surfaces EvalLlmAuthError on 401 without retrying", async () => {
    let calls = 0;
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async () => {
          calls += 1;
          const err: Error & { status?: number } = new Error("unauthorized");
          err.status = 401;
          throw err;
        }),
      sleep: async () => {},
      retryPolicy: { maxRetries: 3, initialBackoffMs: 1, maxBackoffMs: 10 }
    });
    await expect(client.chat({ model: "glm-5.1", messages: [] })).rejects.toBeInstanceOf(
      EvalLlmAuthError
    );
    expect(calls).toBe(1);
  });

  it("surfaces EvalLlmRateLimitedError after exhausting retries", async () => {
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async () => {
          const err: Error & { status?: number } = new Error("too many");
          err.status = 429;
          throw err;
        }),
      sleep: async () => {},
      retryPolicy: { maxRetries: 1, initialBackoffMs: 1, maxBackoffMs: 5 }
    });
    await expect(client.chat({ model: "glm-5.1", messages: [] })).rejects.toBeInstanceOf(
      EvalLlmRateLimitedError
    );
  });

  it("maps AbortError into EvalLlmTimeoutError", async () => {
    const client = createEvalClient(baseConfig({ apiKey: "test", timeoutMs: 5_000 }), {
      openaiFactory: () =>
        fakeOpenai(async (_body, { signal }) => {
          return new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () => {
              const err: Error & { name: string } = new Error("aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }),
      sleep: async () => {},
      retryPolicy: { maxRetries: 0, initialBackoffMs: 1, maxBackoffMs: 10 }
    });
    await expect(
      client.chat({ model: "glm-5.1", messages: [], timeoutMs: 1_000 })
    ).rejects.toBeInstanceOf(EvalLlmTimeoutError);
  });

  it("throws EvalLlmInvalidResponseError when choices is empty", async () => {
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async () => ({
          model: "glm-5.1",
          choices: []
        })),
      sleep: async () => {},
      retryPolicy: { maxRetries: 0, initialBackoffMs: 1, maxBackoffMs: 10 }
    });
    await expect(client.chat({ model: "glm-5.1", messages: [] })).rejects.toBeInstanceOf(
      EvalLlmInvalidResponseError
    );
  });

  it("wraps generic transport errors in EvalLlmTransportError", async () => {
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async () => {
          throw new Error("ECONNRESET");
        }),
      sleep: async () => {},
      retryPolicy: { maxRetries: 0, initialBackoffMs: 1, maxBackoffMs: 10 }
    });
    await expect(client.chat({ model: "glm-5.1", messages: [] })).rejects.toBeInstanceOf(
      EvalLlmTransportError
    );
  });

  it("sets response_format:{type:'json_object'} when responseFormatJson=true", async () => {
    let seenBody: Record<string, unknown> | undefined;
    const client = createEvalClient(baseConfig({ apiKey: "test" }), {
      openaiFactory: () =>
        fakeOpenai(async (body) => {
          seenBody = body;
          return {
            model: "glm-5.1",
            choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          };
        })
    });
    await client.chat({
      model: "glm-5.1",
      messages: [{ role: "user", content: "h" }],
      responseFormatJson: true,
      seed: 42
    });
    expect(seenBody?.response_format).toEqual({ type: "json_object" });
    expect(seenBody?.seed).toBe(42);
  });
});
