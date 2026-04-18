import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeUsageUsd,
  createCostGuard,
  DailyCostCapExceededError,
  DEFAULT_TOKEN_PRICING,
  UNKNOWN_MODEL_PRICING
} from "../../src/eval/cost-guard.js";
import { createTempProject } from "../helpers/index.js";
import type { ResolvedEvalConfig } from "../../src/eval/types.js";

function config(overrides: Partial<ResolvedEvalConfig> = {}): ResolvedEvalConfig {
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

describe("computeUsageUsd", () => {
  it("uses the custom tokenPricing schedule when present", () => {
    const cfg = config({
      tokenPricing: { "my-model": { input: 1.0, output: 2.0 } }
    });
    const usd = computeUsageUsd(
      "my-model",
      { promptTokens: 1_000, completionTokens: 1_000, totalTokens: 2_000 },
      cfg
    );
    expect(usd).toBeCloseTo(3.0, 6);
  });

  it("falls back to the builtin schedule for known models", () => {
    const usd = computeUsageUsd(
      "glm-5.1",
      { promptTokens: 1_000, completionTokens: 1_000, totalTokens: 2_000 },
      config()
    );
    const expected =
      DEFAULT_TOKEN_PRICING["glm-5.1"]!.input + DEFAULT_TOKEN_PRICING["glm-5.1"]!.output;
    expect(usd).toBeCloseTo(expected, 6);
  });

  it("falls back to UNKNOWN_MODEL_PRICING for unknown models", () => {
    const usd = computeUsageUsd(
      "unheard-of",
      { promptTokens: 1_000, completionTokens: 1_000, totalTokens: 2_000 },
      config()
    );
    const expected = UNKNOWN_MODEL_PRICING.input + UNKNOWN_MODEL_PRICING.output;
    expect(usd).toBeCloseTo(expected, 6);
  });

  it("returns 0 when tokens are zero", () => {
    const usd = computeUsageUsd(
      "glm-5.1",
      { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      config()
    );
    expect(usd).toBe(0);
  });
});

describe("createCostGuard", () => {
  it("is a no-op (no writes) when dailyUsdCap is unset", async () => {
    const root = await createTempProject("cost-guard-no-cap");
    const guard = createCostGuard(root, config());
    const usd = await guard.commit("glm-5.1", {
      promptTokens: 100,
      completionTokens: 100,
      totalTokens: 200
    });
    expect(usd).toBeGreaterThan(0);
    const snapshot = await guard.snapshot();
    expect(snapshot).toBeUndefined();
    const evalsDir = path.join(root, ".cclaw/evals");
    let files: string[] = [];
    try {
      files = await fs.readdir(evalsDir);
    } catch {
      files = [];
    }
    expect(files.some((f) => f.startsWith(".spend-"))).toBe(false);
  });

  it("persists a ledger and rejects commits that would cross the cap", async () => {
    const root = await createTempProject("cost-guard-cap");
    const fixedDate = new Date("2026-04-17T10:00:00Z");
    const guard = createCostGuard(
      root,
      config({
        dailyUsdCap: 0.01,
        tokenPricing: { "glm-5.1": { input: 0.005, output: 0.005 } }
      }),
      { now: () => fixedDate }
    );
    await guard.commit("glm-5.1", {
      promptTokens: 1_000,
      completionTokens: 0,
      totalTokens: 1_000
    });
    const snapshot = await guard.snapshot();
    expect(snapshot?.date).toBe("2026-04-17");
    expect(snapshot?.totalUsd).toBeCloseTo(0.005, 6);
    expect(snapshot?.calls).toBe(1);
    expect(snapshot?.byModel["glm-5.1"]).toEqual({
      tokensIn: 1_000,
      tokensOut: 0,
      usd: 0.005
    });
    await expect(
      guard.commit("glm-5.1", {
        promptTokens: 2_000,
        completionTokens: 0,
        totalTokens: 2_000
      })
    ).rejects.toBeInstanceOf(DailyCostCapExceededError);
  });

  it("resets the ledger when the UTC day rolls over", async () => {
    const root = await createTempProject("cost-guard-roll");
    let date = new Date("2026-04-17T23:59:30Z");
    const guard = createCostGuard(
      root,
      config({
        dailyUsdCap: 1,
        tokenPricing: { "glm-5.1": { input: 0.001, output: 0.001 } }
      }),
      { now: () => date }
    );
    await guard.commit("glm-5.1", {
      promptTokens: 1_000,
      completionTokens: 0,
      totalTokens: 1_000
    });
    const before = await guard.snapshot();
    expect(before?.totalUsd).toBeCloseTo(0.001, 6);
    date = new Date("2026-04-18T00:01:00Z");
    const fresh = await guard.snapshot();
    expect(fresh?.date).toBe("2026-04-18");
    expect(fresh?.totalUsd).toBe(0);
  });
});
