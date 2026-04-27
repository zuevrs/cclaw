import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RUNTIME_ROOT } from "./constants.js";
import { readConfig } from "./config.js";
import { exists, withDirectoryLock, writeFileSafe } from "./fs-utils.js";
import { HARNESS_ADAPTERS, type SubagentFallback } from "./harness-adapters.js";
import { readFlowState } from "./runs.js";
import { stageSchema } from "./content/stage-schema.js";
import type { FlowStage } from "./types.js";

const execFileAsync = promisify(execFile);

export type DelegationMode = "mandatory" | "proactive";
export type DelegationStatus = "scheduled" | "completed" | "failed" | "waived";

/**
 * How a delegation was actually fulfilled. Advisory — mirrors the harness
 * `subagentFallback` that was in effect when the entry was recorded.
 *
 * - `isolated`         — native isolated subagent worker (Claude/OpenCode/Codex).
 * - `generic-dispatch` — generic Task/Subagent dispatch mapped to a named role.
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
  /** Legacy field kept for backward compatibility with historical ledgers. */
  conditionTrigger?: string;
  /** Optional token usage captured from the delegated run. */
  tokens?: DelegationTokenUsage;
  /** Number of retries attempted for this span. */
  retryCount?: number;
  /** Optional references to evidence anchors in artifacts. */
  evidenceRefs?: string[];
  /** Optional skill marker used for role-specific mandatory checks. */
  skill?: string;
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

interface ReviewTriggerMetrics {
  changedFiles: number;
  changedLines: number;
  trustBoundaryChanged: boolean;
}

function delegationLogPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", "delegation-log.json");
}

function delegationLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".delegation.lock");
}

function createSpanId(): string {
  return `dspan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function activeHarnessSubagentFallback(): SubagentFallback | undefined {
  const activeHarness = process.env.CCLAW_ACTIVE_HARNESS;
  if (!activeHarness) return undefined;
  return HARNESS_ADAPTERS[activeHarness as keyof typeof HARNESS_ADAPTERS]
    ?.capabilities.subagentFallback;
}

async function resolveReviewDiffBase(projectRoot: string): Promise<string | null> {
  let head = "";
  try {
    head = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot })).stdout.trim();
  } catch {
    return null;
  }
  const candidates = ["origin/main", "origin/master", "main", "master"];
  for (const candidate of candidates) {
    try {
      await execFileAsync("git", ["rev-parse", "--verify", candidate], { cwd: projectRoot });
      const { stdout } = await execFileAsync("git", ["merge-base", "HEAD", candidate], {
        cwd: projectRoot
      });
      const base = stdout.trim();
      if (base.length > 0 && base !== head) {
        return base;
      }
    } catch {
      continue;
    }
  }
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD~1"], {
      cwd: projectRoot
    });
    const base = stdout.trim();
    return base.length > 0 ? base : null;
  } catch {
    return null;
  }
}

/**
 * Heuristic: does a changed file path strongly imply a trust-boundary
 * surface? Used by tests and prompt guidance for risk-triggered review.
 *
 * Matches authN/Z, credentials, crypto, policy, or explicit sanitization
 * or injection handling. Intentionally excludes broad terms like `input`
 * and `validation` because they match innocuous paths such as
 * `form-input.ts` or `number-validation.ts` and produce false positives.
 */
export function isTrustBoundaryPath(filePath: string): boolean {
  return /(auth|security|secret|token|credential|permission|acl|policy|oauth|session|encrypt|decrypt|sanitize|untrusted|csrf|xss|injection|taint)/iu.test(
    filePath
  );
}

async function detectReviewTriggers(projectRoot: string): Promise<ReviewTriggerMetrics> {
  const empty: ReviewTriggerMetrics = {
    changedFiles: 0,
    changedLines: 0,
    trustBoundaryChanged: false
  };
  const base = await resolveReviewDiffBase(projectRoot);
  if (!base) {
    return empty;
  }
  try {
    const range = `${base}..HEAD`;
    const shortstat = await execFileAsync("git", ["diff", "--shortstat", range], {
      cwd: projectRoot
    });
    const short = shortstat.stdout.trim();
    const changedFiles = Number((/(\d+)\s+files?\s+changed/u.exec(short)?.[1] ?? "0"));
    const insertions = Number((/(\d+)\s+insertions?\(\+\)/u.exec(short)?.[1] ?? "0"));
    const deletions = Number((/(\d+)\s+deletions?\(-\)/u.exec(short)?.[1] ?? "0"));
    const changedLines = insertions + deletions;

    const names = await execFileAsync("git", ["diff", "--name-only", range], {
      cwd: projectRoot
    });
    const changedPaths = names.stdout
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const trustBoundaryChanged = changedPaths.some((p) => isTrustBoundaryPath(p));
    return {
      changedFiles,
      changedLines,
      trustBoundaryChanged
    };
  } catch {
    return empty;
  }
}

function hasValidWaiverReason(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
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
  const modeOk = o.mode === "mandatory" || o.mode === "proactive";
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
  const waiverOk = o.status !== "waived" || hasValidWaiverReason(o.waiverReason);
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
    waiverOk &&
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
    (o.skill === undefined || typeof o.skill === "string") &&
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
        const isLegacyCompletion =
          item.fulfillmentMode === undefined &&
          item.schemaVersion === undefined &&
          item.status === "completed";
        const inferredFulfillmentMode = item.fulfillmentMode ?? (isLegacyCompletion ? "isolated" : undefined);
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
          fulfillmentMode: inferredFulfillmentMode,
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
    if (entry.status === "waived" && !hasValidWaiverReason(entry.waiverReason)) {
      throw new Error("waived delegation entries require a non-empty waiverReason");
    }
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
    if (stamped.status === "completed" && stamped.fulfillmentMode === undefined) {
      const activeFallback = activeHarnessSubagentFallback();
      if (activeFallback) {
        stamped.fulfillmentMode = expectedFulfillmentMode([activeFallback]);
      } else {
        const config = await readConfig(projectRoot).catch(() => null);
        const harnesses = config?.harnesses ?? [];
        const fallbacks = harnesses.map((h) => HARNESS_ADAPTERS[h].capabilities.subagentFallback);
        stamped.fulfillmentMode = expectedFulfillmentMode(fallbacks);
      }
    }
    // Idempotency: if a caller (or a retried hook) tries to append a row
    // with a spanId that already exists in the ledger, treat it as a no-op
    // instead of growing the log with duplicate entries that subsequent
    // delegation checks would mis-count.
    if (prior.entries.some((existing) => existing.spanId === stamped.spanId)) {
      return;
    }
    const ledger: DelegationLedger = {
      runId: activeRunId,
      entries: [...prior.entries, stamped]
    };
    await writeFileSafe(filePath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
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
  stage: FlowStage,
  options: { repairFeatureSystem?: boolean } = {}
): Promise<{
  satisfied: boolean;
  missing: string[];
  waived: string[];
  staleIgnored: string[];
  /** Delegation rows missing required evidence under a role-switch fallback. */
  missingEvidence: string[];
  /** Expected fulfillment mode for the active harness set. */
  expectedMode: DelegationFulfillmentMode;
}> {
  const flowState = await readFlowState(projectRoot, {
    repairFeatureSystem: options.repairFeatureSystem
  });
  const mandatory = stageSchema(stage, flowState.track).mandatoryDelegations;
  const { activeRunId } = flowState;
  const ledger = await readDelegationLedger(projectRoot);
  const forStage = ledger.entries.filter((e) => e.stage === stage);
  const forRun = forStage.filter((e) => e.runId === activeRunId);
  const staleIgnored = forStage
    .filter((e) => e.runId !== activeRunId)
    .map((e) => `${e.agent}(runId=${e.runId ?? "unknown"})`);

  const missing: string[] = [];
  const waived: string[] = [];
  const missingEvidence: string[] = [];
  const config = await readConfig(projectRoot).catch(() => null);
  const harnesses = config?.harnesses ?? [];
  const configuredFallbacks = harnesses.map((h) => HARNESS_ADAPTERS[h].capabilities.subagentFallback);
  const activeFallback = activeHarnessSubagentFallback();
  const expectedMode = expectedFulfillmentMode(activeFallback ? [activeFallback] : configuredFallbacks);
  for (const agent of mandatory) {
    const rows = forRun.filter((e) => e.agent === agent);
    const completedRows = rows.filter((e) => e.status === "completed");
    const waivedRows = rows.filter((e) => e.status === "waived" && e.mode === "mandatory");
    const hasCompleted = completedRows.length >= 1;
    const hasWaived = waivedRows.length > 0;
    const ok = hasWaived || hasCompleted;

    if (!ok) {
      missing.push(agent);
      continue;
    }

    if (hasWaived) {
      waived.push(agent);
    }

    // Evidence is required for non-isolated completions and for explicit
    // degraded role-switch rows. Native OpenCode/Codex/Claude isolated
    // dispatch is accepted as true subagent work; role-switch remains a
    // fallback that must point at artifact evidence.
    const evidenceRequired = expectedMode !== "isolated" || completedRows.some(
      (e) => (e.fulfillmentMode ?? "isolated") !== "isolated"
    );
    if (
      hasCompleted &&
      evidenceRequired &&
      !completedRows.some(
        (e) => Array.isArray(e.evidenceRefs) && e.evidenceRefs.length > 0
      )
    ) {
      missingEvidence.push(agent);
    }
  }

  return {
    satisfied: missing.length === 0 && missingEvidence.length === 0,
    missing,
    waived,
    staleIgnored,
    missingEvidence,
    expectedMode
  };
}
