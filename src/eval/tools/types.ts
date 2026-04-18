/**
 * Shared types for Tier B sandbox-confined tools.
 *
 * Tools are plain async functions: they take validated arguments and a
 * sandbox handle and return a structured result. The runner serializes
 * results for the model as JSON; the `SandboxTool.invoke` wrapper keeps
 * both the raw structured output (for tests/metrics) and the stringified
 * model-facing payload.
 */
import type { Sandbox } from "../sandbox.js";

export interface ToolDescriptor {
  /** Name the model calls (must match the function-calling schema). */
  name: string;
  /** Human-readable prompt shown to the model. */
  description: string;
  /** JSON schema shipped with the OpenAI-style `tools[]` array. */
  parameters: Record<string, unknown>;
}

export interface ToolContext {
  sandbox: Sandbox;
  /**
   * Maximum bytes the tool may return in `content`. Results longer than
   * this are truncated with a trailing marker so the model sees the
   * cutoff.
   */
  maxResultBytes: number;
}

export interface ToolSuccess {
  ok: true;
  name: string;
  content: string;
  details?: Record<string, unknown>;
}

export interface ToolFailure {
  ok: false;
  name: string;
  error: string;
  details?: Record<string, unknown>;
}

export type ToolResult = ToolSuccess | ToolFailure;

export interface SandboxTool {
  descriptor: ToolDescriptor;
  invoke(rawArgs: string, ctx: ToolContext): Promise<ToolResult>;
}

/** Truncate a result payload to `maxBytes` with a visible cutoff marker. */
export function truncatePayload(payload: string, maxBytes: number): string {
  if (Buffer.byteLength(payload, "utf8") <= maxBytes) return payload;
  const marker = "\n…[truncated by cclaw sandbox]";
  const budget = Math.max(0, maxBytes - Buffer.byteLength(marker, "utf8"));
  const buf = Buffer.from(payload, "utf8").subarray(0, budget);
  return `${buf.toString("utf8")}${marker}`;
}

export function parseArgs(raw: string): Record<string, unknown> {
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("tool arguments missing");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `tool arguments are not valid JSON: ${(err as Error).message}`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("tool arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function requireString(
  args: Record<string, unknown>,
  key: string
): string {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`"${key}" must be a non-empty string`);
  }
  return value;
}

export function optionalNumber(
  args: Record<string, unknown>,
  key: string
): number | undefined {
  const value = args[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`"${key}" must be a finite number`);
  }
  return value;
}
