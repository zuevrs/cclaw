/**
 * Cost guard for the cclaw eval subsystem.
 *
 * Two responsibilities:
 *
 * 1. Convert `ChatUsage` (prompt/completion token counts) into USD using
 *    a per-model `TokenPricing` schedule. Pricing comes from
 *    `config.tokenPricing[model]` first, then from the builtin fallback
 *    schedule for well-known models (z.ai GLM 5.1 at publish time).
 * 2. Maintain a per-day running total persisted to
 *    `.cclaw/evals/.spend-YYYY-MM-DD.json` so that a long eval session
 *    (or a cron-run nightly) can't blow through the configured
 *    `dailyUsdCap`. The counter is opt-in: no cap, no writes.
 *
 * The guard is deliberately pessimistic — it rounds USD up to 6 decimals
 * and never subtracts, so a CI run that errors mid-flight still shows the
 * partial spend in the next report.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";
import type { ChatUsage } from "./llm-client.js";
import type { ResolvedEvalConfig, TokenPricing } from "./types.js";

/**
 * Builtin pricing fallback. Intentionally conservative: when the user
 * hasn't configured pricing and we don't know the model, we default to a
 * "small model" USD schedule so the cap can still do something useful.
 *
 * Values are USD per 1K tokens. Sources are public pricing pages as of
 * 2026-04; update by editing this constant, not the guard logic.
 */
export const DEFAULT_TOKEN_PRICING: Readonly<Record<string, TokenPricing>> = {
  "glm-5.1": { input: 0.0005, output: 0.0015 },
  "glm-4.6": { input: 0.0005, output: 0.0015 },
  "gpt-4o-mini": { input: 0.00015, output: 0.0006 },
  "gpt-4o": { input: 0.005, output: 0.015 }
};

/** Hard default when neither config nor builtins know the model. */
export const UNKNOWN_MODEL_PRICING: TokenPricing = { input: 0.001, output: 0.003 };

export interface SpendLedger {
  /** ISO date (`YYYY-MM-DD` in UTC) — also embedded in the file name. */
  date: string;
  /** USD spent so far today across every call that hit the guard. */
  totalUsd: number;
  /** Number of `chat()` calls accounted for. */
  calls: number;
  /** Per-model breakdown for the report. */
  byModel: Record<string, { tokensIn: number; tokensOut: number; usd: number }>;
}

export class DailyCostCapExceededError extends Error {
  readonly capUsd: number;
  readonly projectedUsd: number;
  readonly currentUsd: number;

  constructor(opts: { capUsd: number; projectedUsd: number; currentUsd: number }) {
    super(
      `Daily cost cap would be exceeded: ` +
        `current=$${opts.currentUsd.toFixed(4)}, ` +
        `projected=$${opts.projectedUsd.toFixed(4)}, ` +
        `cap=$${opts.capUsd.toFixed(4)}. ` +
        `Unset CCLAW_EVAL_DAILY_USD_CAP or increase the cap to continue.`
    );
    this.name = "DailyCostCapExceededError";
    this.capUsd = opts.capUsd;
    this.projectedUsd = opts.projectedUsd;
    this.currentUsd = opts.currentUsd;
  }
}

function utcDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function pricingFor(
  model: string,
  config: Pick<ResolvedEvalConfig, "tokenPricing">
): TokenPricing {
  const custom = config.tokenPricing?.[model];
  if (custom) return custom;
  const builtin = DEFAULT_TOKEN_PRICING[model];
  if (builtin) return builtin;
  return UNKNOWN_MODEL_PRICING;
}

/**
 * Compute USD cost of a single `ChatUsage` using the given `model` pricing
 * schedule. Returns 0 when `usage.totalTokens` is 0 (e.g. transport error
 * before first token).
 */
export function computeUsageUsd(
  model: string,
  usage: ChatUsage,
  config: Pick<ResolvedEvalConfig, "tokenPricing">
): number {
  if (!usage || usage.totalTokens <= 0) return 0;
  const schedule = pricingFor(model, config);
  const cost =
    (usage.promptTokens * schedule.input) / 1_000 +
    (usage.completionTokens * schedule.output) / 1_000;
  return Math.max(0, Number(cost.toFixed(6)));
}

function emptyLedger(date: string): SpendLedger {
  return { date, totalUsd: 0, calls: 0, byModel: {} };
}

function ledgerPath(projectRoot: string, date: string): string {
  return path.join(projectRoot, EVALS_ROOT, `.spend-${date}.json`);
}

async function readLedger(file: string, date: string): Promise<SpendLedger> {
  if (!(await exists(file))) return emptyLedger(date);
  try {
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as Partial<SpendLedger>;
    if (raw?.date !== date) return emptyLedger(date);
    return {
      date,
      totalUsd: typeof raw.totalUsd === "number" ? raw.totalUsd : 0,
      calls: typeof raw.calls === "number" ? raw.calls : 0,
      byModel: raw.byModel && typeof raw.byModel === "object" ? raw.byModel : {}
    };
  } catch {
    return emptyLedger(date);
  }
}

async function writeLedger(file: string, ledger: SpendLedger): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
}

/**
 * Guard a single LLM call against the daily USD cap. Returns the updated
 * ledger on success; throws `DailyCostCapExceededError` when the projected
 * total would cross the cap. When `config.dailyUsdCap` is unset, the guard
 * is a no-op — no file writes, no ledger — so non-judge runs never touch
 * the filesystem.
 */
export interface CostGuard {
  /**
   * Commit the USD cost of a finished call to the ledger. When `dailyUsdCap`
   * is set, refuses the commit if the projected total would exceed the cap.
   */
  commit(model: string, usage: ChatUsage): Promise<number>;
  /** Snapshot the current ledger (or undefined when no cap is set). */
  snapshot(): Promise<SpendLedger | undefined>;
}

export interface CreateCostGuardOptions {
  /** Clock injection for tests. */
  now?: () => Date;
  /** Override the default filesystem root for the ledger. */
  ledgerPath?: string;
}

export function createCostGuard(
  projectRoot: string,
  config: Pick<ResolvedEvalConfig, "dailyUsdCap" | "tokenPricing">,
  options: CreateCostGuardOptions = {}
): CostGuard {
  const now = options.now ?? (() => new Date());
  const currentDate = (): string => utcDate(now());
  const file = (): string =>
    options.ledgerPath ?? ledgerPath(projectRoot, currentDate());

  return {
    async commit(model, usage) {
      const usd = computeUsageUsd(model, usage, config);
      if (config.dailyUsdCap === undefined) return usd;
      const date = currentDate();
      const target = file();
      const ledger = await readLedger(target, date);
      const projected = Number((ledger.totalUsd + usd).toFixed(6));
      if (projected > config.dailyUsdCap) {
        throw new DailyCostCapExceededError({
          capUsd: config.dailyUsdCap,
          projectedUsd: projected,
          currentUsd: ledger.totalUsd
        });
      }
      ledger.totalUsd = projected;
      ledger.calls += 1;
      const byModel =
        ledger.byModel[model] ?? { tokensIn: 0, tokensOut: 0, usd: 0 };
      byModel.tokensIn += usage.promptTokens;
      byModel.tokensOut += usage.completionTokens;
      byModel.usd = Number((byModel.usd + usd).toFixed(6));
      ledger.byModel[model] = byModel;
      await writeLedger(target, ledger);
      return usd;
    },
    async snapshot() {
      if (config.dailyUsdCap === undefined) return undefined;
      const date = currentDate();
      return readLedger(file(), date);
    }
  };
}

/** Exposed for tests. */
export const __internal = {
  utcDate,
  pricingFor,
  ledgerPath,
  readLedger,
  writeLedger
};
