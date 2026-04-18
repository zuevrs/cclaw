import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { EVALS_CONFIG_PATH } from "../constants.js";
import { exists } from "../fs-utils.js";
import type { EvalConfig, EvalTier, ResolvedEvalConfig, TokenPricing } from "./types.js";
import { EVAL_TIERS } from "./types.js";

/**
 * Default eval config. Optimized for the z.ai OpenAI-compatible coding endpoint
 * with GLM 5.1 per the roadmap locked decisions (D-EVAL-01..05). Any field can
 * be overridden by `.cclaw/evals/config.yaml` and then by `CCLAW_EVAL_*` env
 * variables (env wins last).
 */
export const DEFAULT_EVAL_CONFIG: EvalConfig = {
  provider: "zai",
  baseUrl: "https://api.z.ai/api/coding/paas/v4",
  model: "glm-5.1",
  defaultTier: "A",
  regression: {
    failIfDeltaBelow: -0.15,
    failIfCriticalBelow: 3.0
  },
  timeoutMs: 120_000,
  maxRetries: 2,
  judgeSamples: 3,
  judgeTemperature: 0,
  agentTemperature: 0.2
};

const EVAL_TIER_SET = new Set<string>(EVAL_TIERS);
const NUMERIC_ENVS = new Set([
  "CCLAW_EVAL_DAILY_USD_CAP",
  "CCLAW_EVAL_TIMEOUT_MS",
  "CCLAW_EVAL_MAX_RETRIES",
  "CCLAW_EVAL_JUDGE_SAMPLES",
  "CCLAW_EVAL_JUDGE_TEMPERATURE",
  "CCLAW_EVAL_AGENT_TEMPERATURE",
  "CCLAW_EVAL_TOOL_MAX_TURNS",
  "CCLAW_EVAL_TOOL_MAX_ARG_BYTES",
  "CCLAW_EVAL_TOOL_MAX_RESULT_BYTES",
  "CCLAW_EVAL_WORKFLOW_MAX_TOTAL_TURNS"
]);

function evalConfigError(configFilePath: string, reason: string): Error {
  return new Error(
    `Invalid cclaw eval config at ${configFilePath}: ${reason}\n` +
      `Supported tiers: ${EVAL_TIERS.join(", ")}\n` +
      `See docs/evals.md for the full schema. After fixing, run: cclaw eval --dry-run`
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseNumericEnv(name: string, raw: string): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`Environment variable ${name} must be numeric, got: ${raw}`);
  }
  return value;
}

function parseTierEnv(raw: string): EvalTier {
  const trimmed = raw.trim().toUpperCase();
  if (!EVAL_TIER_SET.has(trimmed)) {
    throw new Error(
      `Environment variable CCLAW_EVAL_TIER must be one of ${EVAL_TIERS.join("/")}, got: ${raw}`
    );
  }
  return trimmed as EvalTier;
}

function validateFileConfig(
  raw: unknown,
  configFilePath: string
): Partial<EvalConfig> {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    throw evalConfigError(configFilePath, "top-level value must be a mapping");
  }

  const out: Partial<EvalConfig> = {};

  const assignString = (key: keyof EvalConfig, value: unknown): void => {
    if (value === undefined) return;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw evalConfigError(configFilePath, `"${String(key)}" must be a non-empty string`);
    }
    (out as Record<string, unknown>)[key as string] = value.trim();
  };

  assignString("provider", raw.provider);
  assignString("baseUrl", raw.baseUrl);
  assignString("model", raw.model);
  assignString("judgeModel", raw.judgeModel);

  if (raw.defaultTier !== undefined) {
    if (typeof raw.defaultTier !== "string" || !EVAL_TIER_SET.has(raw.defaultTier)) {
      throw evalConfigError(
        configFilePath,
        `"defaultTier" must be one of: ${EVAL_TIERS.join(", ")}`
      );
    }
    out.defaultTier = raw.defaultTier as EvalTier;
  }

  if (raw.dailyUsdCap !== undefined) {
    if (typeof raw.dailyUsdCap !== "number" || raw.dailyUsdCap < 0) {
      throw evalConfigError(configFilePath, `"dailyUsdCap" must be a non-negative number`);
    }
    out.dailyUsdCap = raw.dailyUsdCap;
  }

  if (raw.timeoutMs !== undefined) {
    if (typeof raw.timeoutMs !== "number" || raw.timeoutMs <= 0) {
      throw evalConfigError(configFilePath, `"timeoutMs" must be a positive number`);
    }
    out.timeoutMs = raw.timeoutMs;
  }

  if (raw.maxRetries !== undefined) {
    if (!Number.isInteger(raw.maxRetries) || (raw.maxRetries as number) < 0) {
      throw evalConfigError(configFilePath, `"maxRetries" must be a non-negative integer`);
    }
    out.maxRetries = raw.maxRetries as number;
  }

  if (raw.judgeSamples !== undefined) {
    const value = raw.judgeSamples;
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw evalConfigError(configFilePath, `"judgeSamples" must be a positive integer`);
    }
    if ((value as number) % 2 === 0) {
      throw evalConfigError(
        configFilePath,
        `"judgeSamples" must be odd (so median-of-N is a true integer)`
      );
    }
    out.judgeSamples = value as number;
  }

  if (raw.judgeTemperature !== undefined) {
    if (typeof raw.judgeTemperature !== "number" || !Number.isFinite(raw.judgeTemperature)) {
      throw evalConfigError(configFilePath, `"judgeTemperature" must be a finite number`);
    }
    if (raw.judgeTemperature < 0 || raw.judgeTemperature > 2) {
      throw evalConfigError(configFilePath, `"judgeTemperature" must be within [0, 2]`);
    }
    out.judgeTemperature = raw.judgeTemperature;
  }

  if (raw.agentTemperature !== undefined) {
    if (typeof raw.agentTemperature !== "number" || !Number.isFinite(raw.agentTemperature)) {
      throw evalConfigError(configFilePath, `"agentTemperature" must be a finite number`);
    }
    if (raw.agentTemperature < 0 || raw.agentTemperature > 2) {
      throw evalConfigError(configFilePath, `"agentTemperature" must be within [0, 2]`);
    }
    out.agentTemperature = raw.agentTemperature;
  }

  if (raw.tokenPricing !== undefined) {
    if (!isRecord(raw.tokenPricing)) {
      throw evalConfigError(configFilePath, `"tokenPricing" must be a mapping`);
    }
    const pricing: Record<string, TokenPricing> = {};
    for (const [model, value] of Object.entries(raw.tokenPricing)) {
      if (!isRecord(value)) {
        throw evalConfigError(
          configFilePath,
          `"tokenPricing.${model}" must be a mapping with numeric input + output keys`
        );
      }
      const input = (value as Record<string, unknown>).input;
      const output = (value as Record<string, unknown>).output;
      if (typeof input !== "number" || input < 0) {
        throw evalConfigError(
          configFilePath,
          `"tokenPricing.${model}.input" must be a non-negative number`
        );
      }
      if (typeof output !== "number" || output < 0) {
        throw evalConfigError(
          configFilePath,
          `"tokenPricing.${model}.output" must be a non-negative number`
        );
      }
      const extraneous = Object.keys(value).filter((key) => key !== "input" && key !== "output");
      if (extraneous.length > 0) {
        throw evalConfigError(
          configFilePath,
          `"tokenPricing.${model}" has unknown key(s): ${extraneous.join(", ")}`
        );
      }
      pricing[model] = { input, output };
    }
    out.tokenPricing = pricing;
  }

  const assignPositiveInt = (key: keyof EvalConfig, value: unknown, label: string): void => {
    if (value === undefined) return;
    if (!Number.isInteger(value) || (value as number) < 1) {
      throw evalConfigError(configFilePath, `"${label}" must be a positive integer`);
    }
    (out as Record<string, unknown>)[key as string] = value as number;
  };
  assignPositiveInt("toolMaxTurns", raw.toolMaxTurns, "toolMaxTurns");
  assignPositiveInt(
    "toolMaxArgumentsBytes",
    raw.toolMaxArgumentsBytes,
    "toolMaxArgumentsBytes"
  );
  assignPositiveInt(
    "toolMaxResultBytes",
    raw.toolMaxResultBytes,
    "toolMaxResultBytes"
  );
  assignPositiveInt(
    "workflowMaxTotalTurns",
    raw.workflowMaxTotalTurns,
    "workflowMaxTotalTurns"
  );

  if (raw.regression !== undefined) {
    if (!isRecord(raw.regression)) {
      throw evalConfigError(configFilePath, `"regression" must be a mapping`);
    }
    const failIfDeltaBelow = raw.regression.failIfDeltaBelow;
    const failIfCriticalBelow = raw.regression.failIfCriticalBelow;
    if (failIfDeltaBelow !== undefined && typeof failIfDeltaBelow !== "number") {
      throw evalConfigError(
        configFilePath,
        `"regression.failIfDeltaBelow" must be a number`
      );
    }
    if (failIfCriticalBelow !== undefined && typeof failIfCriticalBelow !== "number") {
      throw evalConfigError(
        configFilePath,
        `"regression.failIfCriticalBelow" must be a number`
      );
    }
    out.regression = {
      failIfDeltaBelow:
        typeof failIfDeltaBelow === "number"
          ? failIfDeltaBelow
          : DEFAULT_EVAL_CONFIG.regression.failIfDeltaBelow,
      failIfCriticalBelow:
        typeof failIfCriticalBelow === "number"
          ? failIfCriticalBelow
          : DEFAULT_EVAL_CONFIG.regression.failIfCriticalBelow
    };
  }

  const knownKeys = new Set([
    "provider",
    "baseUrl",
    "model",
    "judgeModel",
    "defaultTier",
    "dailyUsdCap",
    "timeoutMs",
    "maxRetries",
    "regression",
    "judgeSamples",
    "judgeTemperature",
    "agentTemperature",
    "tokenPricing",
    "toolMaxTurns",
    "toolMaxArgumentsBytes",
    "toolMaxResultBytes",
    "workflowMaxTotalTurns"
  ]);
  const unknown = Object.keys(raw).filter((key) => !knownKeys.has(key));
  if (unknown.length > 0) {
    throw evalConfigError(configFilePath, `unknown top-level key(s): ${unknown.join(", ")}`);
  }

  return out;
}

async function readFileConfig(
  projectRoot: string
): Promise<{ patch: Partial<EvalConfig>; source: "default" | "file" }> {
  const configFilePath = path.join(projectRoot, EVALS_CONFIG_PATH);
  if (!(await exists(configFilePath))) {
    return { patch: {}, source: "default" };
  }
  let parsed: unknown;
  try {
    parsed = parse(await fs.readFile(configFilePath, "utf8"));
  } catch (err) {
    throw evalConfigError(configFilePath, err instanceof Error ? err.message : String(err));
  }
  const patch = validateFileConfig(parsed, configFilePath);
  return { patch, source: "file" };
}

function applyEnvOverrides(
  base: EvalConfig,
  env: NodeJS.ProcessEnv
): { patched: EvalConfig; overridden: boolean; apiKey?: string } {
  let overridden = false;
  const patched: EvalConfig = {
    ...base,
    regression: { ...base.regression }
  };

  for (const name of Object.keys(env)) {
    if (!name.startsWith("CCLAW_EVAL_")) continue;
    if (NUMERIC_ENVS.has(name) && typeof env[name] === "string") {
      // validated below when applied
    }
  }

  const read = (name: string): string | undefined => {
    const value = env[name];
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
  };

  const baseUrl = read("CCLAW_EVAL_BASE_URL");
  if (baseUrl) {
    patched.baseUrl = baseUrl;
    overridden = true;
  }
  const model = read("CCLAW_EVAL_MODEL");
  if (model) {
    patched.model = model;
    overridden = true;
  }
  const judgeModel = read("CCLAW_EVAL_JUDGE_MODEL");
  if (judgeModel) {
    patched.judgeModel = judgeModel;
    overridden = true;
  }
  const provider = read("CCLAW_EVAL_PROVIDER");
  if (provider) {
    patched.provider = provider;
    overridden = true;
  }
  const tier = read("CCLAW_EVAL_TIER");
  if (tier) {
    patched.defaultTier = parseTierEnv(tier);
    overridden = true;
  }
  const cap = read("CCLAW_EVAL_DAILY_USD_CAP");
  if (cap) {
    patched.dailyUsdCap = parseNumericEnv("CCLAW_EVAL_DAILY_USD_CAP", cap);
    overridden = true;
  }
  const timeout = read("CCLAW_EVAL_TIMEOUT_MS");
  if (timeout) {
    patched.timeoutMs = parseNumericEnv("CCLAW_EVAL_TIMEOUT_MS", timeout);
    overridden = true;
  }
  const retries = read("CCLAW_EVAL_MAX_RETRIES");
  if (retries) {
    patched.maxRetries = parseNumericEnv("CCLAW_EVAL_MAX_RETRIES", retries);
    overridden = true;
  }
  const judgeSamples = read("CCLAW_EVAL_JUDGE_SAMPLES");
  if (judgeSamples) {
    const value = parseNumericEnv("CCLAW_EVAL_JUDGE_SAMPLES", judgeSamples);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(
        `Environment variable CCLAW_EVAL_JUDGE_SAMPLES must be a positive integer, got: ${judgeSamples}`
      );
    }
    if (value % 2 === 0) {
      throw new Error(
        `Environment variable CCLAW_EVAL_JUDGE_SAMPLES must be odd, got: ${judgeSamples}`
      );
    }
    patched.judgeSamples = value;
    overridden = true;
  }
  const judgeTemp = read("CCLAW_EVAL_JUDGE_TEMPERATURE");
  if (judgeTemp) {
    const value = parseNumericEnv("CCLAW_EVAL_JUDGE_TEMPERATURE", judgeTemp);
    if (value < 0 || value > 2) {
      throw new Error(
        `Environment variable CCLAW_EVAL_JUDGE_TEMPERATURE must be within [0, 2], got: ${judgeTemp}`
      );
    }
    patched.judgeTemperature = value;
    overridden = true;
  }
  const agentTemp = read("CCLAW_EVAL_AGENT_TEMPERATURE");
  if (agentTemp) {
    const value = parseNumericEnv("CCLAW_EVAL_AGENT_TEMPERATURE", agentTemp);
    if (value < 0 || value > 2) {
      throw new Error(
        `Environment variable CCLAW_EVAL_AGENT_TEMPERATURE must be within [0, 2], got: ${agentTemp}`
      );
    }
    patched.agentTemperature = value;
    overridden = true;
  }

  const readPositiveInt = (name: string, key: keyof EvalConfig, label: string): void => {
    const raw = read(name);
    if (!raw) return;
    const value = parseNumericEnv(name, raw);
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`Environment variable ${name} must be a positive integer, got: ${raw}`);
    }
    (patched as unknown as Record<string, unknown>)[key as string] = value;
    overridden = true;
    void label;
  };
  readPositiveInt("CCLAW_EVAL_TOOL_MAX_TURNS", "toolMaxTurns", "toolMaxTurns");
  readPositiveInt(
    "CCLAW_EVAL_WORKFLOW_MAX_TOTAL_TURNS",
    "workflowMaxTotalTurns",
    "workflowMaxTotalTurns"
  );
  readPositiveInt(
    "CCLAW_EVAL_TOOL_MAX_ARG_BYTES",
    "toolMaxArgumentsBytes",
    "toolMaxArgumentsBytes"
  );
  readPositiveInt(
    "CCLAW_EVAL_TOOL_MAX_RESULT_BYTES",
    "toolMaxResultBytes",
    "toolMaxResultBytes"
  );

  const apiKey = read("CCLAW_EVAL_API_KEY");
  return { patched, overridden, apiKey };
}

/**
 * Resolve eval config in layered order: defaults -> config.yaml -> env vars.
 * Returns a fully-populated config plus a provenance marker so `--dry-run` can
 * surface where each setting came from.
 */
export async function loadEvalConfig(
  projectRoot: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<ResolvedEvalConfig> {
  const { patch, source: fileSource } = await readFileConfig(projectRoot);
  const merged: EvalConfig = {
    ...DEFAULT_EVAL_CONFIG,
    ...patch,
    regression: {
      ...DEFAULT_EVAL_CONFIG.regression,
      ...(patch.regression ?? {})
    }
  };
  const { patched, overridden, apiKey } = applyEnvOverrides(merged, env);

  let source: ResolvedEvalConfig["source"] = "default";
  if (fileSource === "file" && overridden) source = "file+env";
  else if (fileSource === "file") source = "file";
  else if (overridden) source = "env";

  return {
    ...patched,
    apiKey,
    source
  };
}
