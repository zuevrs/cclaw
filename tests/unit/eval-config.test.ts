import { describe, expect, it } from "vitest";
import { DEFAULT_EVAL_CONFIG, loadEvalConfig } from "../../src/eval/config-loader.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

describe("eval config loader", () => {
  it("returns defaults on a project with no evals config", async () => {
    const root = await createTempProject("eval-config-default");
    const config = await loadEvalConfig(root, {});
    expect(config.source).toBe("default");
    expect(config.provider).toBe(DEFAULT_EVAL_CONFIG.provider);
    expect(config.baseUrl).toBe(DEFAULT_EVAL_CONFIG.baseUrl);
    expect(config.model).toBe(DEFAULT_EVAL_CONFIG.model);
    expect(config.defaultTier).toBe("A");
    expect(config.apiKey).toBeUndefined();
    expect(config.dailyUsdCap).toBeUndefined();
  });

  it("defaults point at z.ai coding paas v4 with glm-5.1 per locked decisions", () => {
    expect(DEFAULT_EVAL_CONFIG.baseUrl).toBe("https://api.z.ai/api/coding/paas/v4");
    expect(DEFAULT_EVAL_CONFIG.model).toBe("glm-5.1");
    expect(DEFAULT_EVAL_CONFIG.provider).toBe("zai");
    expect(DEFAULT_EVAL_CONFIG.dailyUsdCap).toBeUndefined();
  });

  it("loads overrides from .cclaw/evals/config.yaml", async () => {
    const root = await createTempProject("eval-config-file");
    await writeProjectFile(
      root,
      ".cclaw/evals/config.yaml",
      `provider: openai\nmodel: gpt-5\ndefaultTier: B\nregression:\n  failIfDeltaBelow: -0.1\n`
    );
    const config = await loadEvalConfig(root, {});
    expect(config.source).toBe("file");
    expect(config.provider).toBe("openai");
    expect(config.model).toBe("gpt-5");
    expect(config.defaultTier).toBe("B");
    expect(config.regression.failIfDeltaBelow).toBeCloseTo(-0.1);
    expect(config.regression.failIfCriticalBelow).toBe(DEFAULT_EVAL_CONFIG.regression.failIfCriticalBelow);
  });

  it("env overrides beat file overrides", async () => {
    const root = await createTempProject("eval-config-env");
    await writeProjectFile(
      root,
      ".cclaw/evals/config.yaml",
      `model: glm-4.6\n`
    );
    const config = await loadEvalConfig(root, {
      CCLAW_EVAL_MODEL: "claude-sonnet-4-5",
      CCLAW_EVAL_BASE_URL: "https://example.test/v1",
      CCLAW_EVAL_API_KEY: "sk-test",
      CCLAW_EVAL_DAILY_USD_CAP: "12.5",
      CCLAW_EVAL_TIER: "c"
    });
    expect(config.source).toBe("file+env");
    expect(config.model).toBe("claude-sonnet-4-5");
    expect(config.baseUrl).toBe("https://example.test/v1");
    expect(config.apiKey).toBe("sk-test");
    expect(config.dailyUsdCap).toBe(12.5);
    expect(config.defaultTier).toBe("C");
  });

  it("env-only applies when there is no config.yaml", async () => {
    const root = await createTempProject("eval-config-env-only");
    const config = await loadEvalConfig(root, { CCLAW_EVAL_MODEL: "glm-4.5" });
    expect(config.source).toBe("env");
    expect(config.model).toBe("glm-4.5");
  });

  it("rejects unknown top-level keys", async () => {
    const root = await createTempProject("eval-config-unknown");
    await writeProjectFile(
      root,
      ".cclaw/evals/config.yaml",
      `unknownKey: 42\n`
    );
    await expect(loadEvalConfig(root, {})).rejects.toThrow(/unknown top-level key/);
  });

  it("rejects invalid tier in file", async () => {
    const root = await createTempProject("eval-config-bad-tier");
    await writeProjectFile(
      root,
      ".cclaw/evals/config.yaml",
      `defaultTier: Z\n`
    );
    await expect(loadEvalConfig(root, {})).rejects.toThrow(/defaultTier/);
  });

  it("rejects invalid tier in env", async () => {
    const root = await createTempProject("eval-config-bad-env");
    await expect(
      loadEvalConfig(root, { CCLAW_EVAL_TIER: "Z" })
    ).rejects.toThrow(/CCLAW_EVAL_TIER/);
  });

  it("rejects non-numeric daily cap", async () => {
    const root = await createTempProject("eval-config-bad-cap");
    await expect(
      loadEvalConfig(root, { CCLAW_EVAL_DAILY_USD_CAP: "abc" })
    ).rejects.toThrow(/CCLAW_EVAL_DAILY_USD_CAP/);
  });

  it("rejects negative daily cap in file", async () => {
    const root = await createTempProject("eval-config-negative-cap");
    await writeProjectFile(
      root,
      ".cclaw/evals/config.yaml",
      `dailyUsdCap: -5\n`
    );
    await expect(loadEvalConfig(root, {})).rejects.toThrow(/dailyUsdCap/);
  });

  it("accepts judgeModel override separate from model", async () => {
    const root = await createTempProject("eval-config-judge");
    const config = await loadEvalConfig(root, {
      CCLAW_EVAL_MODEL: "glm-5.1",
      CCLAW_EVAL_JUDGE_MODEL: "claude-sonnet-4-5"
    });
    expect(config.model).toBe("glm-5.1");
    expect(config.judgeModel).toBe("claude-sonnet-4-5");
  });
});
