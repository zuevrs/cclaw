import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { readConfig } from "./config.js";
import { exists, withDirectoryLock, writeFileSafe } from "./fs-utils.js";
import { HARNESS_ADAPTERS, type SubagentFallback } from "./harness-adapters.js";
import { readFlowState } from "./runs.js";
import { stageSchema } from "./content/stage-schema.js";
import type { FlowStage } from "./types.js";

export type DelegationMode = "mandatory" | "proactive" | "conditional";
export type DelegationStatus = "scheduled" | "completed" | "failed" | "waived";

/**
 * How a delegation was actually fulfilled. Advisory — mirrors the harness
 * `subagentFallback` that was in effect when the entry was recorded.
 *
 * - `isolated`         — Claude-style isolated subagent worker.
 * - `generic-dispatch` — Cursor-style Task dispatch mapped to a named role.
 * - `role-switch`      — performed in-session with explicit role announce.
 * - `harness-waiver`   — auto-waived due to missing dispatch capability.
 */
export type DelegationFulfillmentMode =
  | "isolated"
  | "generic-dispatch"
  | "role-switch"
  | "harness-waiver";

export interface DelegationTokenUsage {
  input: number;
  output: number;
  model: string;
}

export type DelegationEntry = {
  stage: string;
  agent: string;
  mode: DelegationMode;
  status: DelegationStatus;
  /**
   * Span identifier for this delegation unit. Multiple status transitions for
   * the same delegated unit should reuse the same spanId.
   */
  spanId?: string;
  /** Parent span id when this delegation was spawned from another span. */
  parentSpanId?: string;
  /** ISO timestamp when the delegation span started. */
  startTs?: string;
  /** ISO timestamp when the delegation span ended (for terminal statuses). */
  endTs?: string;
  /**
   * Legacy timestamp used by historical ledgers. New writers set both `ts` and
   * `startTs` for backward compatibility.
   */
  taskId?: string;
  waiverReason?: string;
  ts?: string;
  /**
   * Run id the entry belongs to. Older ledgers written before 0.5.17 may omit this;
   * consumers treat missing runId as unscoped (conservatively excluded from current-run checks).
   */
  runId?: string;
  /**
   * For `conditional` rows: the trigger predicate that fired (e.g. `diff_lines_gt:100`).
   * Recorded for audit so reviewers can see why the second pass was required.
   */
  conditionTrigger?: string;
  /** Optional token usage captured from the delegated run. */
  tokens?: DelegationTokenUsage;
  /** Number of retries attempted for this span. */
  retryCount?: number;
  /** Optional references to evidence anchors in artifacts. */
  evidenceRefs?: string[];
  /**
   * Fulfillment mode this entry was executed under. Omitted on legacy rows
   * (treated as `"isolated"` for Claude, otherwise inferred from the active
   * harness).
   */
  fulfillmentMode?: DelegationFulfillmentMode;
  /** Schema version marker for span-compatible delegation logs. */
  schemaVersion?: 1;
};

export type DelegationLedger = {
  runId: string;
  entries: DelegationEntry[];
};

function delegationLogPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", "delegation-log.json");
}

function delegationLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".delegation.lock");
}

function createSpanId(): string {
  return `dspan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function isDelegationTokenUsage(value: unknown): value is DelegationTokenUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.input === "number" &&
    Number.isFinite(o.input) &&
    typeof o.output === "number" &&
    Number.isFinite(o.output) &&
    typeof o.model === "string" &&
    o.model.trim().length > 0
  );
}

function isDelegationEntry(value: unknown): value is DelegationEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  const modeOk = o.mode === "mandatory" || o.mode === "proactive" || o.mode === "conditional";
  const statusOk =
    o.status === "scheduled" ||
    o.status === "completed" ||
    o.status === "failed" ||
    o.status === "waived";
  const timestampOk =
    typeof o.ts === "string" ||
    typeof o.startTs === "string";
  const retryOk =
    o.retryCount === undefined ||
    (typeof o.retryCount === "number" &&
      Number.isFinite(o.retryCount) &&
      Number.isInteger(o.retryCount) &&
      o.retryCount >= 0);
  return (
    typeof o.stage === "string" &&
    typeof o.agent === "string" &&
    modeOk &&
    statusOk &&
    timestampOk &&
    (o.spanId === undefined || typeof o.spanId === "string") &&
    (o.parentSpanId === undefined || typeof o.parentSpanId === "string") &&
    (o.startTs === undefined || typeof o.startTs === "string") &&
    (o.endTs === undefined || typeof o.endTs === "string") &&
    (o.taskId === undefined || typeof o.taskId === "string") &&
    (o.waiverReason === undefined || typeof o.waiverReason === "string") &&
    (o.runId === undefined || typeof o.runId === "string") &&
    (o.fulfillmentMode === undefined ||
      o.fulfillmentMode === "isolated" ||
      o.fulfillmentMode === "generic-dispatch" ||
      o.fulfillmentMode === "role-switch" ||
      o.fulfillmentMode === "harness-waiver") &&
    (o.conditionTrigger === undefined || typeof o.conditionTrigger === "string") &&
    (o.tokens === undefined || isDelegationTokenUsage(o.tokens)) &&
    retryOk &&
    (o.evidenceRefs === undefined || (Array.isArray(o.evidenceRefs) && o.evidenceRefs.every((item) => typeof item === "string"))) &&
    (o.schemaVersion === undefined || o.schemaVersion === 1)
  );
}

function parseLedger(raw: unknown, runId: string): DelegationLedger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { runId, entries: [] };
  }
  const o = raw as Record<string, unknown>;
  const entriesRaw = o.entries;
  const entries: DelegationEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const item of entriesRaw) {
      if (isDelegationEntry(item)) {
        const ts = item.startTs ?? item.ts ?? new Date().toISOString();
        entries.push({
          ...item,
          spanId: item.spanId ?? createSpanId(),
          startTs: ts,
          ts,
          retryCount:
            typeof item.retryCount === "number" && Number.isInteger(item.retryCount) && item.retryCount >= 0
              ? item.retryCount
              : 0,
          evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [],
          schemaVersion: 1
        });
      }
    }
  }
  return { runId, entries };
}

export async function readDelegationLedger(projectRoot: string): Promise<DelegationLedger> {
  const { activeRunId } = await readFlowState(projectRoot);
  const filePath = delegationLogPath(projectRoot);
  if (!(await exists(filePath))) {
    return { runId: activeRunId, entries: [] };
  }
  try {
    const text = await fs.readFile(filePath, "utf8");
    const parsed: unknown = JSON.parse(text);
    return parseLedger(parsed, activeRunId);
  } catch {
    return { runId: activeRunId, entries: [] };
  }
}

export async function appendDelegation(projectRoot: string, entry: DelegationEntry): Promise<void> {
  const { activeRunId } = await readFlowState(projectRoot);
  await withDirectoryLock(delegationLockPath(projectRoot), async () => {
    const filePath = delegationLogPath(projectRoot);
    const prior = await readDelegationLedger(projectRoot);
    const startTs = entry.startTs ?? entry.ts ?? new Date().toISOString();
    const stamped: DelegationEntry = { ...entry, runId: entry.runId ?? activeRunId };
    stamped.spanId = entry.spanId ?? createSpanId();
    stamped.startTs = startTs;
    stamped.ts = startTs;
    stamped.schemaVersion = 1;
    if (
      stamped.retryCount === undefined ||
      !Number.isInteger(stamped.retryCount) ||
      stamped.retryCount < 0
    ) {
      stamped.retryCount = 0;
    }
    if (!Array.isArray(stamped.evidenceRefs)) {
      stamped.evidenceRefs = [];
    }
    const ledger: DelegationLedger = {
      runId: activeRunId,
      entries: [...prior.entries, stamped]
    };
    await writeFileSafe(filePath, `${JSON.stringify(ledger, null, 2)}\n`);
  });
}

/**
 * Aggregate the fulfillment mode cclaw expects for the active harness set.
 * Priority native > generic-dispatch > role-switch > waiver — the best
 * available mode wins so mixed installs (e.g. claude + codex) inherit the
 * strongest guarantee.
 */
export function expectedFulfillmentMode(
  fallbacks: SubagentFallback[]
): DelegationFulfillmentMode {
  if (fallbacks.length === 0) return "isolated";
  if (fallbacks.some((f) => f === "native")) return "isolated";
  if (fallbacks.some((f) => f === "generic-dispatch")) return "generic-dispatch";
  if (fallbacks.some((f) => f === "role-switch")) return "role-switch";
  return "harness-waiver";
}

export async function checkMandatoryDelegations(
  projectRoot: string,
  stage: FlowStage
): Promise<{
  satisfied: boolean;
  missing: string[];
  waived: string[];
  autoWaived: string[];
  staleIgnored: string[];
  /** Delegation rows missing required evidence under a role-switch fallback. */
  missingEvidence: string[];
  /** Expected fulfillment mode for the active harness set. */
  expectedMode: DelegationFulfillmentMode;
}> {
  const mandatory = stageSchema(stage).mandatoryDelegations;
  const { activeRunId } = await readFlowState(projectRoot);
  const ledger = await readDelegationLedger(projectRoot);
  const forStage = ledger.entries.filter((e) => e.stage === stage);
  const forRun = forStage.filter((e) => e.runId === activeRunId);
  const staleIgnored = forStage
    .filter((e) => e.runId !== activeRunId)
    .map((e) => `${e.agent}(runId=${e.runId ?? "unknown"})`);

  const missing: string[] = [];
  const waived: string[] = [];
  const autoWaived: string[] = [];
  const missingEvidence: string[] = [];
  const config = await readConfig(projectRoot).catch(() => null);
  const harnesses = config?.harnesses ?? [];
  const fallbacks = harnesses.map((h) => HARNESS_ADAPTERS[h].capabilities.subagentFallback);
  const expectedMode = expectedFulfillmentMode(fallbacks);
  const onlyWaiverFallback =
    harnesses.length > 0 && fallbacks.every((f) => f === "waiver");

  for (const agent of mandatory) {
    const rows = forRun.filter((e) => e.agent === agent);
    const completedRows = rows.filter((e) => e.status === "completed");
    const waivedRows = rows.filter((e) => e.status === "waived");
    const hasCompleted = completedRows.length > 0;
    const hasWaived = waivedRows.length > 0;
    const ok = hasCompleted || hasWaived;

    if (!ok) {
      if (onlyWaiverFallback) {
        const existingHarnessWaiver = rows.some(
          (e) => e.status === "waived" && e.waiverReason === "harness_limitation"
        );
        if (!existingHarnessWaiver) {
          await appendDelegation(projectRoot, {
            stage,
            agent,
            mode: "mandatory",
            status: "waived",
            waiverReason: "harness_limitation",
            fulfillmentMode: "harness-waiver",
            ts: new Date().toISOString(),
            runId: activeRunId
          });
        }
        waived.push(agent);
        autoWaived.push(agent);
      } else {
        missing.push(agent);
      }
      continue;
    }

    if (hasWaived) {
      waived.push(agent);
    }

    // Under role-switch fallback, a `completed` row is only credible if it
    // carries at least one evidenceRef — otherwise the agent might have
    // claimed role-switch satisfaction without showing its work.
    if (
      hasCompleted &&
      expectedMode === "role-switch" &&
      !completedRows.some((e) => Array.isArray(e.evidenceRefs) && e.evidenceRefs.length > 0)
    ) {
      missingEvidence.push(agent);
    }
  }

  return {
    satisfied: missing.length === 0 && missingEvidence.length === 0,
    missing,
    waived,
    autoWaived,
    staleIgnored,
    missingEvidence,
    expectedMode
  };
}
