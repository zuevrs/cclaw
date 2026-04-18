/**
 * Lightweight progress logger for `cclaw eval`.
 *
 * The runner is otherwise silent: a full workflow-mode run can easily take
 * a few minutes and the user would see nothing until the Markdown report
 * hits disk. We emit structured events here so the CLI can print concise
 * one-line status updates to stderr (stdout stays reserved for the final
 * report + `--json` output).
 *
 * The logger is intentionally minimal: no ANSI colors, no spinners, no
 * carriage-return rewrites. Those do not survive `tee`, CI log viewers,
 * or the background `runs/tail` path (which copies the stream to a log
 * file), and users also told us "nothing is clear now, everything is
 * long" — so we optimize for log-friendly line-by-line readability.
 */
import type { EvalMode, WorkflowStageName } from "./types.js";

export type ProgressEvent =
  | { kind: "run-start"; mode: EvalMode; totalCases: number }
  | {
      kind: "case-start";
      caseId: string;
      stage: string;
      index: number;
      total: number;
    }
  | {
      kind: "case-end";
      caseId: string;
      stage: string;
      index: number;
      total: number;
      passed: boolean;
      durationMs: number;
      costUsd?: number;
    }
  | {
      kind: "stage-start";
      caseId: string;
      stage: WorkflowStageName;
      index: number;
      total: number;
    }
  | {
      kind: "stage-end";
      caseId: string;
      stage: WorkflowStageName;
      index: number;
      total: number;
      passed: boolean;
      durationMs: number;
      costUsd?: number;
    }
  | {
      kind: "retry";
      caseId: string;
      stage?: string;
      attempt: number;
      maxAttempts: number;
      waitMs: number;
      reason: string;
    }
  | { kind: "run-end"; totalCases: number; passed: number; failed: number; durationMs: number };

export interface ProgressLogger {
  emit(event: ProgressEvent): void;
}

const NOOP_LOGGER: ProgressLogger = { emit(): void {} };

export function noopProgressLogger(): ProgressLogger {
  return NOOP_LOGGER;
}

export interface StderrProgressLoggerOptions {
  /** Override the underlying write target; defaults to `process.stderr.write`. */
  writer?: (message: string) => void;
  /** Return wall-clock in ms. Injectable for tests. */
  now?: () => number;
}

/**
 * Emit a one-line status update per event to stderr.
 *
 * Format is deliberately boring: `[cclaw eval] <message>` so users can grep
 * for the prefix in combined logs. Costs are rendered with up to 4 decimals
 * so sub-cent runs still show a non-zero value.
 */
export function createStderrProgressLogger(
  opts: StderrProgressLoggerOptions = {}
): ProgressLogger {
  const writer = opts.writer ?? ((s: string) => process.stderr.write(s));
  return {
    emit(event: ProgressEvent): void {
      writer(`[cclaw eval] ${formatEvent(event)}\n`);
    }
  };
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s - m * 60);
  return `${m}m${rem.toString().padStart(2, "0")}s`;
}

function formatCost(usd?: number): string {
  if (usd === undefined || usd <= 0) return "";
  return ` $${usd.toFixed(4)}`;
}

function formatEvent(event: ProgressEvent): string {
  switch (event.kind) {
    case "run-start":
      return `start mode=${event.mode} cases=${event.totalCases}`;
    case "case-start":
      return `[${event.index}/${event.total}] ${event.caseId} (${event.stage}) ...`;
    case "case-end": {
      const status = event.passed ? "PASS" : "FAIL";
      return (
        `[${event.index}/${event.total}] ${event.caseId} (${event.stage}) ${status} ` +
        `in ${formatDuration(event.durationMs)}${formatCost(event.costUsd)}`
      );
    }
    case "stage-start":
      return `  stage ${event.stage} ...`;
    case "stage-end": {
      const status = event.passed ? "ok" : "fail";
      return `  stage ${event.stage} ${status} in ${formatDuration(event.durationMs)}${formatCost(event.costUsd)}`;
    }
    case "retry":
      return (
        `  retry ${event.caseId}${event.stage ? `/${event.stage}` : ""} ` +
        `attempt ${event.attempt}/${event.maxAttempts} in ${formatDuration(event.waitMs)} (${event.reason})`
      );
    case "run-end":
      return (
        `done pass=${event.passed} fail=${event.failed} total=${event.totalCases} ` +
        `in ${formatDuration(event.durationMs)}`
      );
  }
}
