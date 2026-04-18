/**
 * LLM client skeleton for the cclaw eval subsystem.
 *
 * Wave 7.0 declares the shape of the client without pulling in the `openai`
 * runtime dependency. The real implementation is wired in Wave 7.3 when
 * single-shot (Tier A) evals and LLM judging come online. Keeping this stub
 * separate means users of Waves 7.0–7.2 (structural + rule-based verifiers)
 * never install an extra dependency or receive network egress warnings.
 */
import type { ResolvedEvalConfig } from "./types.js";

/**
 * Minimal chat interface the rest of the eval code will depend on. It is
 * intentionally a subset of OpenAI's Chat Completions surface so that the
 * Wave 7.3 implementation is a thin adapter around `OpenAI.chat.completions.create`.
 */
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /**
   * Tool/function-calling definitions in OpenAI wire format. Populated only by
   * Wave 7.4 (Tier B). Ignored by the Wave 7.3 single-shot path.
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
}

/** Lightweight client abstraction shared across eval runners. */
export interface EvalLlmClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}

export class EvalLlmNotWiredError extends Error {
  constructor(wave: string) {
    super(
      `LLM client is not wired in Wave 7.0. It arrives in Wave ${wave}.\n` +
        `Run \`cclaw eval --dry-run\` or \`cclaw eval --schema-only\` for offline evals.`
    );
    this.name = "EvalLlmNotWiredError";
  }
}

/**
 * Factory stub. Throws with a clear message so accidental Wave 7.0 usage is
 * easy to diagnose. The Wave 7.3 implementation will replace this body with
 * `new OpenAI({ apiKey, baseURL }) ... adapter`.
 */
export function createEvalClient(_config: ResolvedEvalConfig): EvalLlmClient {
  return {
    async chat() {
      throw new EvalLlmNotWiredError("7.3");
    }
  };
}
