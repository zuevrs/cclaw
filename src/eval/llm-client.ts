/**
 * LLM client for the cclaw eval subsystem.
 *
 * Thin adapter over the `openai` SDK pointed at any OpenAI-compatible
 * `baseURL` (z.ai, OpenAI, vLLM, Ollama+openai-proxy, ...). The surface is
 * deliberately narrow:
 *
 *  - `chat()` — one request/response round-trip with timeout, bounded
 *    retries on transient errors, and a structured error hierarchy so
 *    callers can react policy-style (cost-guard, judge, agent-under-test).
 *  - `ChatRequest` / `ChatResponse` — wire format decoupled from the
 *    OpenAI types so swapping vendors stays a one-file change.
 *
 * Factories stay side-effect-free: no network calls are made until `chat()`
 * is invoked, so CLI help and dry-run paths never need an API key.
 */
import OpenAI from "openai";
import type { ClientOptions } from "openai";
import type { ResolvedEvalConfig } from "./types.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  /**
   * OpenAI-style tool calls carried on a preceding assistant message.
   * Populated by the with-tools loop so the wire transcript stays
   * consistent (assistant message → tool responses).
   */
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** Per-call timeout override. Falls back to `config.timeoutMs`. */
  timeoutMs?: number;
  /**
   * Ask the provider for a JSON-object response. The judge pipeline sets
   * this; the agent-under-test usually leaves it unset.
   */
  responseFormatJson?: boolean;
  /**
   * Optional deterministic sampling seed. Providers that don't implement
   * `seed` simply ignore it.
   */
  seed?: number;
  /**
   * Tool/function-calling definitions in OpenAI wire format. Populated only
   * by agent/workflow modes. Ignored by the single-shot path.
   */
  tools?: unknown[];
  toolChoice?: "auto" | "none";
}

export interface ChatUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatResponse {
  content: string;
  toolCalls?: Array<{ id: string; name: string; arguments: string }>;
  usage: ChatUsage;
  finishReason: "stop" | "length" | "tool_calls" | "content_filter";
  model: string;
  attempts: number;
}

/** Base class so callers can `catch (err) { if (err instanceof EvalLlmError) ... }`. */
export class EvalLlmError extends Error {
  readonly retryable: boolean;
  readonly status?: number;

  constructor(message: string, opts: { retryable: boolean; status?: number; cause?: unknown }) {
    super(message);
    this.name = "EvalLlmError";
    this.retryable = opts.retryable;
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.cause !== undefined) (this as Error & { cause?: unknown }).cause = opts.cause;
  }
}

export class EvalLlmAuthError extends EvalLlmError {
  constructor(cause: unknown) {
    super("LLM request rejected (auth). Check CCLAW_EVAL_API_KEY and provider permissions.", {
      retryable: false,
      status: 401,
      cause
    });
    this.name = "EvalLlmAuthError";
  }
}

export class EvalLlmConfigError extends EvalLlmError {
  constructor(message: string, cause?: unknown) {
    super(message, { retryable: false, cause });
    this.name = "EvalLlmConfigError";
  }
}

export class EvalLlmTimeoutError extends EvalLlmError {
  constructor(timeoutMs: number) {
    super(`LLM request timed out after ${timeoutMs}ms.`, { retryable: true });
    this.name = "EvalLlmTimeoutError";
  }
}

export class EvalLlmRateLimitedError extends EvalLlmError {
  constructor(cause: unknown) {
    super("LLM rate limit hit. Retrying with backoff.", {
      retryable: true,
      status: 429,
      cause
    });
    this.name = "EvalLlmRateLimitedError";
  }
}

export class EvalLlmTransportError extends EvalLlmError {
  constructor(cause: unknown, status?: number) {
    super("LLM transport error.", { retryable: true, status, cause });
    this.name = "EvalLlmTransportError";
  }
}

export class EvalLlmInvalidResponseError extends EvalLlmError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { retryable: false });
    this.name = "EvalLlmInvalidResponseError";
    if (details) (this as EvalLlmInvalidResponseError & { details?: unknown }).details = details;
  }
}

export class EvalLlmNotConfiguredError extends EvalLlmError {
  constructor() {
    super(
      `LLM client not configured. Set CCLAW_EVAL_API_KEY (and optionally ` +
        `CCLAW_EVAL_BASE_URL / CCLAW_EVAL_MODEL) or run with --schema-only / --rules.`,
      { retryable: false }
    );
    this.name = "EvalLlmNotConfiguredError";
  }
}

/** Lightweight client abstraction shared across eval runners. */
export interface EvalLlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

/**
 * Deprecated shim preserved so older wiring keeps compiling. Prefer
 * `EvalLlmNotConfiguredError` for the "caller forgot to provide an API
 * key" case.
 */
export class EvalLlmNotWiredError extends EvalLlmNotConfiguredError {}

/** `createEvalClient` options — mostly for tests to inject a fake transport. */
export interface CreateEvalClientOptions {
  /** Inject an `openai` stand-in. Used by unit tests to avoid real HTTP. */
  openaiFactory?: (opts: ClientOptions) => OpenAILike;
  /**
   * Override the default retry/backoff policy. Honored by the internal
   * retry loop; transport errors still fall back to the defaults when
   * unset.
   */
  retryPolicy?: RetryPolicy;
  /** Deterministic sleep used by the retry loop. Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Observer invoked when a chat() call is about to sleep before the next
   * retry attempt. Use this to surface "we are retrying" status via the
   * progress logger so long, silent backoff windows become visible.
   */
  onRetry?: (event: {
    attempt: number;
    maxAttempts: number;
    waitMs: number;
    error: EvalLlmError;
  }) => void;
}

export interface RetryPolicy {
  /** Max retries *on top of* the initial attempt. 0 = single attempt. */
  maxRetries: number;
  /** Initial backoff in ms. Doubles each retry (capped at `maxBackoffMs`). */
  initialBackoffMs: number;
  /** Upper bound for a single sleep between attempts. */
  maxBackoffMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 2,
  initialBackoffMs: 500,
  maxBackoffMs: 8_000
};

/**
 * Minimal OpenAI-SDK surface we depend on, declared here so tests can
 * substitute a plain object without pulling the real SDK into the test
 * runtime.
 */
export interface OpenAILike {
  chat: {
    completions: {
      create(
        body: Record<string, unknown>,
        options: { signal: AbortSignal }
      ): Promise<OpenAILikeChatResponse>;
    };
  };
}

interface OpenAILikeChatResponse {
  model?: string;
  choices: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{
        id: string;
        function: { name: string; arguments: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

function isAbortError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const name = (err as { name?: unknown }).name;
  const code = (err as { code?: unknown }).code;
  return (
    name === "AbortError" || code === "ABORT_ERR" || code === "ERR_CANCELED"
  );
}

function statusFromError(err: unknown): number | undefined {
  if (err === null || typeof err !== "object") return undefined;
  const status = (err as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

function normalizeError(err: unknown, timeoutMs: number): EvalLlmError {
  if (err instanceof EvalLlmError) return err;
  if (isAbortError(err)) return new EvalLlmTimeoutError(timeoutMs);
  const status = statusFromError(err);
  if (status === 401 || status === 403) return new EvalLlmAuthError(err);
  if (status === 429) return new EvalLlmRateLimitedError(err);
  if (status !== undefined && status >= 400 && status < 500) {
    return new EvalLlmError(`LLM request rejected (HTTP ${status}).`, {
      retryable: false,
      status,
      cause: err
    });
  }
  return new EvalLlmTransportError(err, status);
}

function normalizeFinishReason(raw: string | null | undefined): ChatResponse["finishReason"] {
  switch (raw) {
    case "length":
      return "length";
    case "tool_calls":
    case "function_call":
      return "tool_calls";
    case "content_filter":
      return "content_filter";
    case "stop":
    case null:
    case undefined:
    default:
      return "stop";
  }
}

function buildBody(request: ChatRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: request.model,
    messages: request.messages.map((m) => ({
      role: m.role,
      content: m.content,
      ...(m.name !== undefined ? { name: m.name } : {}),
      ...(m.toolCallId !== undefined ? { tool_call_id: m.toolCallId } : {}),
      ...(m.toolCalls && m.toolCalls.length > 0
        ? {
            tool_calls: m.toolCalls.map((call) => ({
              id: call.id,
              type: "function",
              function: { name: call.name, arguments: call.arguments }
            }))
          }
        : {})
    }))
  };
  if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
  if (request.temperature !== undefined) body.temperature = request.temperature;
  if (request.seed !== undefined) body.seed = request.seed;
  if (request.tools !== undefined) body.tools = request.tools;
  if (request.toolChoice !== undefined) body.tool_choice = request.toolChoice;
  if (request.responseFormatJson === true) {
    body.response_format = { type: "json_object" };
  }
  return body;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffDelay(attempt: number, policy: RetryPolicy): number {
  const raw = policy.initialBackoffMs * 2 ** attempt;
  return Math.min(raw, policy.maxBackoffMs);
}

/**
 * Build a real client pointed at the configured endpoint. Throws
 * `EvalLlmNotConfiguredError` at call time (not construction time) when no
 * API key is available, so CLI help and dry-run paths stay offline-safe.
 */
export function createEvalClient(
  config: ResolvedEvalConfig,
  options: CreateEvalClientOptions = {}
): EvalLlmClient {
  const retryPolicy: RetryPolicy = options.retryPolicy ?? {
    ...DEFAULT_RETRY_POLICY,
    maxRetries: Math.max(0, config.maxRetries ?? DEFAULT_RETRY_POLICY.maxRetries)
  };
  const sleep = options.sleep ?? defaultSleep;

  let cached: OpenAILike | undefined;
  const getClient = (): OpenAILike => {
    if (cached) return cached;
    if (!config.apiKey) throw new EvalLlmNotConfiguredError();
    const factory =
      options.openaiFactory ??
      ((opts: ClientOptions) => new OpenAI(opts) as unknown as OpenAILike);
    cached = factory({ apiKey: config.apiKey, baseURL: config.baseUrl });
    return cached;
  };

  return {
    async chat(request: ChatRequest): Promise<ChatResponse> {
      const timeoutMs = Math.max(1_000, request.timeoutMs ?? config.timeoutMs);
      const body = buildBody(request);
      const client = getClient();

      let lastError: EvalLlmError | undefined;
      const maxAttempts = retryPolicy.maxRetries + 1;
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const controller = new AbortController();
        const handle = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const raw = await client.chat.completions.create(body, {
            signal: controller.signal
          });
          clearTimeout(handle);
          const choice = raw.choices?.[0];
          if (!choice) {
            throw new EvalLlmInvalidResponseError(
              "LLM response contained no choices.",
              { model: raw.model }
            );
          }
          const content = choice.message?.content ?? "";
          const toolCalls = choice.message?.tool_calls?.map((call) => ({
            id: call.id,
            name: call.function.name,
            arguments: call.function.arguments
          }));
          const usage: ChatUsage = {
            promptTokens: raw.usage?.prompt_tokens ?? 0,
            completionTokens: raw.usage?.completion_tokens ?? 0,
            totalTokens: raw.usage?.total_tokens ?? 0
          };
          return {
            content,
            ...(toolCalls && toolCalls.length > 0 ? { toolCalls } : {}),
            usage,
            finishReason: normalizeFinishReason(choice.finish_reason),
            model: raw.model ?? request.model,
            attempts: attempt + 1
          };
        } catch (err) {
          clearTimeout(handle);
          const normalized = normalizeError(err, timeoutMs);
          lastError = normalized;
          const isLastAttempt = attempt === maxAttempts - 1;
          if (!normalized.retryable || isLastAttempt) throw normalized;
          const waitMs = backoffDelay(attempt, retryPolicy);
          options.onRetry?.({
            attempt: attempt + 1,
            maxAttempts,
            waitMs,
            error: normalized
          });
          await sleep(waitMs);
        }
      }
      throw lastError ?? new EvalLlmTransportError(new Error("unknown"));
    }
  };
}
