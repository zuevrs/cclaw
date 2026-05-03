import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RUNTIME_ROOT } from "./constants.js";
import { readConfig } from "./config.js";
import { exists, withDirectoryLock, writeFileSafe } from "./fs-utils.js";
import { HARNESS_ADAPTERS, type SubagentFallback } from "./harness-adapters.js";
import { readFlowState } from "./runs.js";
import {
  mandatoryAgentsFor,
  stageSchema,
  type MandatoryDelegationTaskClass
} from "./content/stage-schema.js";
import type { FlowStage } from "./types.js";
import type { FlowState } from "./flow-state.js";

const execFileAsync = promisify(execFile);

export type DelegationMode = "mandatory" | "proactive";
export type DelegationStatus =
  | "scheduled"
  | "launched"
  | "acknowledged"
  | "completed"
  | "failed"
  | "waived"
  | "stale";
const TERMINAL_DELEGATION_STATUSES = new Set<DelegationStatus>(["completed", "failed", "waived", "stale"]);
export const DELEGATION_DISPATCH_SURFACES = [
  "claude-task",
  "cursor-task",
  "opencode-agent",
  "codex-agent",
  "generic-task",
  "role-switch",
  "manual"
] as const;
export type DelegationDispatchSurface = typeof DELEGATION_DISPATCH_SURFACES[number];

/**
 * Per-surface allowed agent-definition path prefixes. Used by the generated
 * `.cclaw/hooks/delegation-record.mjs` helper to reject mismatched
 * `--agent-definition-path` values without inspecting any harness state.
 *
 * The list is intentionally structural: each surface maps to one or more
 * repo-relative path prefixes that must be a parent of the supplied path.
 * `role-switch` and `manual` accept any path because the agent-definition
 * is intentionally not a generated artifact for those surfaces.
 */
export const DELEGATION_DISPATCH_SURFACE_PATH_PREFIXES: Record<
  DelegationDispatchSurface,
  string[]
> = {
  "claude-task": [".claude/agents/", ".cclaw/agents/"],
  "cursor-task": [".cursor/agents/", ".cclaw/agents/"],
  "opencode-agent": [".opencode/agents/", ".cclaw/agents/"],
  "codex-agent": [".codex/agents/", ".cclaw/agents/"],
  "generic-task": [".cclaw/agents/"],
  "role-switch": [],
  "manual": []
};

export type DelegationEventType = DelegationStatus;

/**
 * How a delegation was actually fulfilled. Advisory — mirrors the harness
 * `subagentFallback` that was in effect when the entry was recorded.
 *
 * - `isolated`         — native isolated subagent worker (Claude/OpenCode/Codex).
 * - `generic-dispatch` — generic Task/Subagent dispatch mapped to a named role.
 * - `role-switch`      — performed in-session with explicit role announce.
 * - `harness-waiver`   — auto-waived due to missing dispatch capability.
 * - `legacy-inferred`  — pre-v3 entry: completed status without dispatch
 *   surface/proof. Read-only; stage-complete reports it as a warning until
 *   the entry is re-recorded via `delegation-record.mjs --rerecord`.
 */
export type DelegationFulfillmentMode =
  | "isolated"
  | "generic-dispatch"
  | "role-switch"
  | "harness-waiver"
  | "legacy-inferred";

export interface DelegationTokenUsage {
  input: number;
  output: number;
  model: string;
}

export type DelegationWaiverAcceptedBy = "user-flag";

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
  acceptedBy?: DelegationWaiverAcceptedBy;
  /**
   * Waiver approval token captured from `cclaw-cli internal waiver-grant`.
   * Present on waiver rows written after v6.7.0. Legacy waiver rows omit
   * these fields and are surfaced as the advisory linter finding
   * `waiver_legacy_provenance`.
   */
  approvalToken?: string;
  approvalReason?: string;
  approvalIssuedAt?: string;
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
  /** Dispatch proof id from the parent/controller side. */
  dispatchId?: string;
  /** Worker-reported run id or task id returned by the harness. */
  workerRunId?: string;
  /** Concrete runtime surface used to launch the worker. */
  dispatchSurface?: DelegationDispatchSurface;
  /** Path to the generated or canonical agent definition used for dispatch. */
  agentDefinitionPath?: string;
  /** ISO timestamp when the worker was acknowledged by the harness/worker. */
  ackTs?: string;
  /** ISO timestamp when the worker was launched. */
  launchedTs?: string;
  /** ISO timestamp when the worker completed. */
  completedTs?: string;
  /** Optional skill marker used for role-specific mandatory checks. */
  skill?: string;
  /**
   * Fulfillment mode this entry was executed under. Omitted on legacy rows
   * (treated as `"isolated"` for Claude, otherwise inferred from the active
   * harness).
   */
  fulfillmentMode?: DelegationFulfillmentMode;
  /**
   * Schema version marker for span-compatible delegation rows.
   *
   * - `1` — legacy rows that predate the dispatch-surface lock
   * - `2` — historical interim format that introduced ack/launched
   *   timestamps but did not require dispatch-surface or ack-ts on
   *   completed isolated/generic
   * - `3` — current format: completed isolated/generic must carry
   *   `dispatchSurface`, `agentDefinitionPath`, and ACK timestamp
   */
  schemaVersion?: 1 | 2 | 3;
  /**
   * v6.8.0 — when set, the operator explicitly opted into running this
   * scheduled span concurrently with another active span on the same
   * `(stage, agent)` pair. Bypasses the dispatch-dedup check.
   */
  allowParallel?: boolean;
  /**
   * v6.8.0 — set on synthetic terminal `stale` rows written via
   * `--supersede=<prevSpanId>`. References the new spanId that
   * superseded this span. Helps `/cc tree` and the linter report a
   * coherent successor chain.
   */
  supersededBy?: string;
};

export const DELEGATION_LEDGER_SCHEMA_VERSION = 3 as const;

export type DelegationLedger = {
  runId: string;
  entries: DelegationEntry[];
  /** Schema version of the ledger envelope. Current: `3`. */
  schemaVersion?: 1 | 2 | 3;
};

export type DelegationEvent = DelegationEntry & {
  event: DelegationEventType;
  eventTs: string;
  schemaVersion: 1 | 2 | 3;
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

function delegationEventsPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", "delegation-events.jsonl");
}

function subagentsStatePath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", "subagents.json");
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
    o.status === "launched" ||
    o.status === "acknowledged" ||
    o.status === "completed" ||
    o.status === "failed" ||
    o.status === "waived" ||
    o.status === "stale";
  const timestampOk =
    typeof o.ts === "string" ||
    typeof o.startTs === "string";
  const terminalStatus = o.status === "completed" || o.status === "failed" || o.status === "waived" || o.status === "stale";
  const lifecycleOk =
    (o.status !== "scheduled" && o.status !== "launched" && o.status !== "acknowledged") || o.endTs === undefined;
  const terminalLifecycleOk =
    !terminalStatus ||
    o.endTs === undefined ||
    typeof o.endTs === "string";
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
    lifecycleOk &&
    terminalLifecycleOk &&
    (o.spanId === undefined || typeof o.spanId === "string") &&
    (o.parentSpanId === undefined || typeof o.parentSpanId === "string") &&
    (o.startTs === undefined || typeof o.startTs === "string") &&
    (o.endTs === undefined || typeof o.endTs === "string") &&
    (o.taskId === undefined || typeof o.taskId === "string") &&
    (o.waiverReason === undefined || typeof o.waiverReason === "string") &&
    (o.acceptedBy === undefined || o.acceptedBy === "user-flag") &&
    (o.approvalToken === undefined || typeof o.approvalToken === "string") &&
    (o.approvalReason === undefined || typeof o.approvalReason === "string") &&
    (o.approvalIssuedAt === undefined || typeof o.approvalIssuedAt === "string") &&
    waiverOk &&
    (o.runId === undefined || typeof o.runId === "string") &&
    (o.fulfillmentMode === undefined ||
      o.fulfillmentMode === "isolated" ||
      o.fulfillmentMode === "generic-dispatch" ||
      o.fulfillmentMode === "role-switch" ||
      o.fulfillmentMode === "harness-waiver" ||
      o.fulfillmentMode === "legacy-inferred") &&
    (o.conditionTrigger === undefined || typeof o.conditionTrigger === "string") &&
    (o.dispatchId === undefined || typeof o.dispatchId === "string") &&
    (o.workerRunId === undefined || typeof o.workerRunId === "string") &&
    (o.dispatchSurface === undefined || isDelegationDispatchSurface(o.dispatchSurface)) &&
    (o.agentDefinitionPath === undefined || typeof o.agentDefinitionPath === "string") &&
    (o.ackTs === undefined || typeof o.ackTs === "string") &&
    (o.launchedTs === undefined || typeof o.launchedTs === "string") &&
    (o.completedTs === undefined || typeof o.completedTs === "string") &&
    (o.tokens === undefined || isDelegationTokenUsage(o.tokens)) &&
    retryOk &&
    (o.evidenceRefs === undefined || (Array.isArray(o.evidenceRefs) && o.evidenceRefs.every((item) => typeof item === "string"))) &&
    (o.skill === undefined || typeof o.skill === "string") &&
    (o.schemaVersion === undefined || o.schemaVersion === 1 || o.schemaVersion === 2 || o.schemaVersion === 3) &&
    (o.allowParallel === undefined || typeof o.allowParallel === "boolean") &&
    (o.supersededBy === undefined || typeof o.supersededBy === "string")
  );
}


function isDelegationDispatchSurface(value: unknown): value is DelegationDispatchSurface {
  return typeof value === "string" && (DELEGATION_DISPATCH_SURFACES as readonly string[]).includes(value);
}

function statusTimestampPatch(entry: DelegationEntry, ts: string): DelegationEntry {
  const patch: DelegationEntry = { ...entry };
  if (patch.status === "launched") patch.launchedTs = patch.launchedTs ?? ts;
  if (patch.status === "acknowledged") patch.ackTs = patch.ackTs ?? ts;
  if (patch.status === "completed") patch.completedTs = patch.completedTs ?? patch.endTs ?? ts;
  return patch;
}

function eventFromEntry(entry: DelegationEntry): DelegationEvent {
  const eventTs = entry.completedTs ?? entry.ackTs ?? entry.launchedTs ?? entry.endTs ?? entry.startTs ?? entry.ts ?? new Date().toISOString();
  return {
    ...entry,
    event: entry.status,
    eventTs,
    schemaVersion: DELEGATION_LEDGER_SCHEMA_VERSION
  };
}

function isDelegationEvent(value: unknown): value is DelegationEvent {
  if (!isDelegationEntry(value)) return false;
  const o = value as Record<string, unknown>;
  if (o.event !== o.status || typeof o.eventTs !== "string") return false;
  return true;
}

function parseLedger(raw: unknown, runId: string): DelegationLedger {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { runId, entries: [], schemaVersion: DELEGATION_LEDGER_SCHEMA_VERSION };
  }
  const o = raw as Record<string, unknown>;
  const ledgerSchemaVersion = (
    o.schemaVersion === 1 || o.schemaVersion === 2 || o.schemaVersion === 3
      ? o.schemaVersion
      : undefined
  ) as DelegationLedger["schemaVersion"];
  const entriesRaw = o.entries;
  const entries: DelegationEntry[] = [];
  if (Array.isArray(entriesRaw)) {
    for (const item of entriesRaw) {
      if (isDelegationEntry(item)) {
        const ts = item.startTs ?? item.ts ?? new Date().toISOString();
        // A row is "pre-v3 legacy" when the file format predates the
        // dispatch-proof contract: schemaVersion is missing on both ledger
        // and entry, the entry has no fulfillmentMode, and there is no
        // dispatch-surface or dispatch-id evidence on the row. We honor
        // that by tagging fulfillmentMode = "legacy-inferred" so callers
        // (stage-complete, sync/runtime checks) can require an explicit `--rerecord`
        // before the row counts as proof-era.
        const ledgerHasNoVersion = ledgerSchemaVersion === undefined || ledgerSchemaVersion === 1;
        const entryHasNoVersion = item.schemaVersion === undefined || item.schemaVersion === 1;
        const looksLegacy =
          ledgerHasNoVersion &&
          entryHasNoVersion &&
          item.fulfillmentMode === undefined &&
          item.dispatchSurface === undefined &&
          item.dispatchId === undefined &&
          item.workerRunId === undefined &&
          item.agentDefinitionPath === undefined &&
          item.status === "completed";
        const inferredFulfillmentMode = item.fulfillmentMode
          ?? (looksLegacy ? "legacy-inferred" : (item.status === "completed" && item.schemaVersion === undefined ? "isolated" : undefined));
        entries.push({
          ...item,
          spanId: item.spanId ?? createSpanId(),
          startTs: ts,
          endTs: TERMINAL_DELEGATION_STATUSES.has(item.status) ? (item.endTs ?? ts) : undefined,
          ts,
          launchedTs: item.launchedTs ?? (item.status === "launched" ? ts : undefined),
          ackTs: item.ackTs ?? (item.status === "acknowledged" ? ts : undefined),
          completedTs: item.completedTs ?? (item.status === "completed" ? (item.endTs ?? ts) : undefined),
          retryCount:
            typeof item.retryCount === "number" && Number.isInteger(item.retryCount) && item.retryCount >= 0
              ? item.retryCount
              : 0,
          evidenceRefs: Array.isArray(item.evidenceRefs) ? item.evidenceRefs : [],
          fulfillmentMode: inferredFulfillmentMode,
          schemaVersion: item.schemaVersion ?? DELEGATION_LEDGER_SCHEMA_VERSION
        });
      }
    }
  }
  return { runId, entries, schemaVersion: ledgerSchemaVersion ?? DELEGATION_LEDGER_SCHEMA_VERSION };
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



/**
 * Wave 24 (v6.0.0) audit-only event types that live in
 * `delegation-events.jsonl` but do NOT carry a delegation lifecycle
 * payload (no agent/spanId). The parser must accept them so they
 * don't show up as corrupt lines.
 */
const NON_DELEGATION_AUDIT_EVENTS = new Set<string>([
  "mandatory_delegations_skipped_by_track",
  "artifact_validation_demoted_by_track",
  "expansion_strategist_skipped_by_track"
]);

function isAuditEventLine(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const evt = (parsed as { event?: unknown }).event;
  return typeof evt === "string" && NON_DELEGATION_AUDIT_EVENTS.has(evt);
}

export async function readDelegationEvents(projectRoot: string): Promise<{ events: DelegationEvent[]; corruptLines: number[] }> {
  const filePath = delegationEventsPath(projectRoot);
  if (!(await exists(filePath))) {
    return { events: [], corruptLines: [] };
  }
  const events: DelegationEvent[] = [];
  const corruptLines: number[] = [];
  const text = await fs.readFile(filePath, "utf8").catch(() => "");
  const lines = text.split(/\r?\n/gu);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.length === 0) continue;
    try {
      const parsed: unknown = JSON.parse(line);
      if (isDelegationEvent(parsed)) {
        events.push(parsed);
      } else if (isAuditEventLine(parsed)) {
        // Wave 24 audit-only row (e.g. mandatory_delegations_skipped_by_track).
        // Not a delegation lifecycle event but valid audit content.
        continue;
      } else {
        corruptLines.push(index + 1);
      }
    } catch {
      corruptLines.push(index + 1);
    }
  }
  return { events, corruptLines };
}

async function appendDelegationEvent(projectRoot: string, event: DelegationEvent): Promise<void> {
  const filePath = delegationEventsPath(projectRoot);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", mode: 0o600 });
}

/**
 * Effective timestamp used to order rows that share a `spanId`. Newest
 * lifecycle column wins. Returns the empty string when nothing is set
 * so the caller still has a stable lexicographic compare key.
 *
 * keep in sync with the inline copy in
 * `src/content/hooks.ts::delegationRecordScript`.
 */
function effectiveSpanTs(entry: DelegationEntry): string {
  return entry.completedTs ?? entry.ackTs ?? entry.launchedTs ?? entry.endTs ?? entry.startTs ?? entry.ts ?? "";
}

const ACTIVE_DELEGATION_STATUSES = new Set<DelegationStatus>([
  "scheduled",
  "launched",
  "acknowledged"
]);

/**
 * Fold ledger entries to the latest row per `spanId` and keep only spans
 * whose latest status is still active (`scheduled | launched |
 * acknowledged`). Used by the `state/subagents.json` writer so the
 * tracker never reports a span that already has a terminal row.
 *
 * Output is ordered by ascending `startTs ?? ts` so existing UI
 * consumers see a stable presentation order.
 *
 * Rows without a `spanId` are skipped — they are not addressable by
 * the tracker contract and would collide on the empty key.
 *
 * Callers are expected to pass entries already filtered to the active
 * `runId`; cross-run rows are therefore not re-filtered here.
 *
 * keep in sync with the inline copy in
 * `src/content/hooks.ts::delegationRecordScript`.
 */
export function computeActiveSubagents(entries: DelegationEntry[]): DelegationEntry[] {
  const latestBySpan = new Map<string, DelegationEntry>();
  for (const entry of entries) {
    if (!entry.spanId) continue;
    const existing = latestBySpan.get(entry.spanId);
    if (!existing) {
      latestBySpan.set(entry.spanId, entry);
      continue;
    }
    const existingTs = effectiveSpanTs(existing);
    const incomingTs = effectiveSpanTs(entry);
    if (incomingTs >= existingTs) {
      latestBySpan.set(entry.spanId, entry);
    }
  }
  const folded: DelegationEntry[] = [];
  for (const entry of latestBySpan.values()) {
    if (ACTIVE_DELEGATION_STATUSES.has(entry.status)) {
      folded.push(entry);
    }
  }
  folded.sort((a, b) => {
    const aKey = a.startTs ?? a.ts ?? "";
    const bKey = b.startTs ?? b.ts ?? "";
    if (aKey === bKey) return 0;
    return aKey < bKey ? -1 : 1;
  });
  return folded;
}

/**
 * v6.8.0 — thrown by `validateMonotonicTimestamps` when an incoming row
 * would push a span's timeline backwards. Carries enough context that
 * the CLI / hook surface can format a `delegation_timestamp_non_monotonic`
 * JSON payload without re-deriving the offending field.
 *
 * keep in sync with the inline copy in
 * `src/content/hooks.ts::delegationRecordScript`.
 */
export class DelegationTimestampError extends Error {
  readonly field: string;
  readonly actual: string;
  readonly priorBound: string;
  constructor(field: string, actual: string, priorBound: string) {
    super(`delegation_timestamp_non_monotonic — ${field}: ${actual} < ${priorBound}`);
    this.name = "DelegationTimestampError";
    this.field = field;
    this.actual = actual;
    this.priorBound = priorBound;
  }
}

/**
 * v6.8.0 — enforce that lifecycle timestamps on a delegation span move
 * forward (or stay equal). Validates both per-row invariants
 * (`startTs ≤ launchedTs ≤ ackTs ≤ completedTs`) and a cross-row
 * invariant: the union of prior rows for this `spanId` plus the
 * incoming row must have non-decreasing `ts`.
 *
 * Equality is allowed because fast-completing dispatches legitimately
 * collapse multiple lifecycle markers onto the same instant.
 *
 * keep in sync with the inline copy in
 * `src/content/hooks.ts::delegationRecordScript`.
 */
export function validateMonotonicTimestamps(
  stamped: DelegationEntry,
  prior: DelegationEntry[]
): void {
  const startTs = stamped.startTs;
  if (stamped.launchedTs && startTs && stamped.launchedTs < startTs) {
    throw new DelegationTimestampError("launchedTs", stamped.launchedTs, startTs);
  }
  if (stamped.ackTs) {
    const ackBound = stamped.launchedTs ?? startTs;
    if (ackBound && stamped.ackTs < ackBound) {
      throw new DelegationTimestampError("ackTs", stamped.ackTs, ackBound);
    }
  }
  if (stamped.completedTs) {
    const completedBound = stamped.ackTs ?? stamped.launchedTs ?? startTs;
    if (completedBound && stamped.completedTs < completedBound) {
      throw new DelegationTimestampError("completedTs", stamped.completedTs, completedBound);
    }
  }
  if (!stamped.spanId) return;
  const priorForSpan = prior.filter((entry) => entry.spanId === stamped.spanId);
  if (priorForSpan.length === 0) return;
  const timeline = [...priorForSpan, stamped]
    .map((entry) => ({ entry, ts: entry.ts ?? entry.startTs ?? "" }))
    .filter((row) => row.ts.length > 0)
    .sort((a, b) => (a.ts === b.ts ? 0 : a.ts < b.ts ? -1 : 1));
  for (let i = 1; i < timeline.length; i += 1) {
    const previous = timeline[i - 1]!;
    const current = timeline[i]!;
    if (current.ts < previous.ts) {
      throw new DelegationTimestampError("ts", current.ts, previous.ts);
    }
  }
  // Find the latest existing row by `ts` for the same spanId; if the
  // new row's `ts` is older than that latest, the timeline regressed.
  const latestPrior = priorForSpan
    .map((entry) => entry.ts ?? entry.startTs ?? "")
    .filter((ts) => ts.length > 0)
    .sort()
    .at(-1);
  const stampedTs = stamped.ts ?? stamped.startTs ?? "";
  if (latestPrior && stampedTs && stampedTs < latestPrior) {
    throw new DelegationTimestampError("ts", stampedTs, latestPrior);
  }
}

/**
 * v6.8.0 — thrown by `appendDelegation` when the operator opens a
 * second `scheduled` span on the same `(stage, agent)` pair while an
 * earlier span on the same pair is still active. Callers can catch and
 * either pass the existing span id via `--supersede=<id>` (which
 * pre-writes a synthetic `stale` row) or `--allow-parallel` to record
 * concurrent spans intentionally.
 */
export class DispatchDuplicateError extends Error {
  readonly existingSpanId: string;
  readonly existingStatus: DelegationStatus;
  readonly newSpanId: string;
  readonly pair: { stage: string; agent: string };
  constructor(params: {
    existingSpanId: string;
    existingStatus: DelegationStatus;
    newSpanId: string;
    pair: { stage: string; agent: string };
  }) {
    super(
      `dispatch_duplicate — already-active spanId=${params.existingSpanId} (status=${params.existingStatus}) on stage=${params.pair.stage}, agent=${params.pair.agent}. ` +
        `pass --supersede=${params.existingSpanId} to close the previous span as stale, or --allow-parallel to record both as concurrent.`
    );
    this.name = "DispatchDuplicateError";
    this.existingSpanId = params.existingSpanId;
    this.existingStatus = params.existingStatus;
    this.newSpanId = params.newSpanId;
    this.pair = params.pair;
  }
}

/**
 * v6.9.0 — find the latest active span for a given `(stage, agent)`
 * pair in the supplied ledger entries. Returns the row whose latest
 * status (after the latest-by-spanId fold) is still in the active set
 * (`scheduled | launched | acknowledged`).
 *
 * Run-scope is **strict**: only entries whose `runId` matches the
 * supplied `runId` are folded. Entries with empty/missing `runId`
 * (legacy ledgers from v6.8 and earlier) are treated as NOT belonging
 * to the current run, so they cannot keep an old span "active" across
 * a fresh dispatch and trip a spurious `dispatch_duplicate`. This
 * fixes R7: a slice-implementer that ran in run-1 must not block a
 * slice-implementer scheduled in run-2.
 *
 * keep in sync with the inline copy in
 * `src/content/hooks.ts::delegationRecordScript`.
 */
export function findActiveSpanForPair(
  stage: string,
  agent: string,
  runId: string,
  ledger: DelegationLedger
): DelegationEntry | null {
  const sameRun = ledger.entries.filter((entry) => {
    if (typeof entry.runId !== "string" || entry.runId.length === 0) return false;
    if (entry.runId !== runId) return false;
    return entry.stage === stage && entry.agent === agent;
  });
  for (const entry of computeActiveSubagents(sameRun)) {
    return entry;
  }
  return null;
}

async function writeSubagentTracker(projectRoot: string, entries: DelegationEntry[]): Promise<void> {
  const active = computeActiveSubagents(entries).map((entry) => ({
    spanId: entry.spanId,
    dispatchId: entry.dispatchId,
    workerRunId: entry.workerRunId,
    stage: entry.stage,
    agent: entry.agent,
    status: entry.status,
    dispatchSurface: entry.dispatchSurface,
    agentDefinitionPath: entry.agentDefinitionPath,
    startedAt: entry.startTs,
    launchedAt: entry.launchedTs,
    acknowledgedAt: entry.ackTs,
    allowParallel: entry.allowParallel
  }));
  await writeFileSafe(subagentsStatePath(projectRoot), `${JSON.stringify({ active, updatedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
}

export async function appendDelegation(projectRoot: string, entry: DelegationEntry): Promise<void> {
  const { activeRunId } = await readFlowState(projectRoot);
  await withDirectoryLock(delegationLockPath(projectRoot), async () => {
    const filePath = delegationLogPath(projectRoot);
    const prior = await readDelegationLedger(projectRoot);
    // Span start anchor: prefer explicit `startTs`; otherwise fall back to
    // the earliest provided lifecycle marker so the monotonic validator
    // never sees a synthetic `now` overshoot a real event timestamp.
    const lifecycleCandidates = [
      entry.startTs,
      entry.launchedTs,
      entry.ackTs,
      entry.completedTs,
      entry.ts
    ].filter((value): value is string => typeof value === "string" && value.length > 0);
    const earliestLifecycle = lifecycleCandidates.length > 0
      ? lifecycleCandidates.reduce((min, candidate) => (candidate < min ? candidate : min))
      : undefined;
    const startTs = entry.startTs ?? earliestLifecycle ?? new Date().toISOString();
    if (entry.status === "waived" && !hasValidWaiverReason(entry.waiverReason)) {
      throw new Error("waived delegation entries require a non-empty waiverReason");
    }
    const stamped: DelegationEntry = statusTimestampPatch({ ...entry, runId: entry.runId ?? activeRunId }, startTs);
    stamped.spanId = entry.spanId ?? createSpanId();
    stamped.startTs = startTs;
    stamped.ts = startTs;
    if (TERMINAL_DELEGATION_STATUSES.has(stamped.status) && !stamped.endTs) {
      stamped.endTs = new Date().toISOString();
    }
    if (stamped.status === "completed") {
      stamped.completedTs = stamped.completedTs ?? stamped.endTs ?? new Date().toISOString();
    }
    if (stamped.status === "scheduled") {
      delete stamped.endTs;
    }
    stamped.schemaVersion = DELEGATION_LEDGER_SCHEMA_VERSION;
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
    // Idempotency: a retried hook may replay the same lifecycle row. Allow a
    // terminal row to close an existing scheduled span, but drop exact same
    // span/status duplicates so checks do not mis-count repeated writes.
    if (prior.entries.some((existing) =>
      existing.spanId === stamped.spanId && existing.status === stamped.status
    )) {
      return;
    }
    validateMonotonicTimestamps(stamped, prior.entries);
    if (stamped.status === "scheduled" && stamped.allowParallel !== true) {
      const existing = findActiveSpanForPair(
        stamped.stage,
        stamped.agent,
        activeRunId,
        prior
      );
      if (existing && existing.spanId && existing.spanId !== stamped.spanId) {
        throw new DispatchDuplicateError({
          existingSpanId: existing.spanId,
          existingStatus: existing.status,
          newSpanId: stamped.spanId,
          pair: { stage: stamped.stage, agent: stamped.agent }
        });
      }
    }
    await appendDelegationEvent(projectRoot, eventFromEntry(stamped));
    const ledger: DelegationLedger = {
      runId: activeRunId,
      entries: [...prior.entries, stamped],
      schemaVersion: DELEGATION_LEDGER_SCHEMA_VERSION
    };
    await writeFileSafe(filePath, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
    await writeSubagentTracker(projectRoot, ledger.entries);
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
  options: {
    repairFeatureSystem?: boolean;
    /**
     * Optional task class for the active run. When set to
     * `"software-bugfix"`, the mandatory delegation gate is skipped
     * entirely (Wave 24). Callers that don't classify the run leave
     * this undefined; the function then falls back to
     * `flowState.taskClass` (persisted in `flow-state.json`) so the
     * Wave 24 bugfix-skip remains active across the `cclaw advance-stage`
     * code path even when no caller forwards an explicit override.
     */
    taskClass?: MandatoryDelegationTaskClass | null;
  } = {}
): Promise<{
  satisfied: boolean;
  missing: string[];
  waived: string[];
  staleIgnored: string[];
  /** Delegation rows missing required evidence under a role-switch fallback. */
  missingEvidence: string[];
  /** Native isolated completion rows that lack dispatch proof. */
  missingDispatchProof: string[];
  /** Legacy inferred isolated completions accepted only as migration warnings. */
  legacyInferredCompletions: string[];
  /** Current-run event log lines that could not be parsed. */
  corruptEventLines: number[];
  /** Current-run scheduled rows with no terminal row sharing the same spanId. */
  staleWorkers: string[];
  /** Expected fulfillment mode for the active harness set. */
  expectedMode: DelegationFulfillmentMode;
  /**
   * Wave 24 (v6.0.0): true when `mandatoryAgentsFor` returned [] for
   * this (track, taskClass) combination — i.e. the gate was skipped
   * entirely on quick track or software-bugfix runs. The skip is also
   * recorded as a `mandatory_delegations_skipped_by_track` event in
   * `delegation-events.jsonl` for audit traceability.
   */
  skippedByTrack: boolean;
}> {
  const flowState = await readFlowState(projectRoot, {
    repairFeatureSystem: options.repairFeatureSystem
  });
  // Wave 24 follow-up (v6.1.1): read `flowState.taskClass` as a fallback
  // when the caller doesn't pass an explicit override. The
  // `cclaw advance-stage` path (`buildValidationReport` →
  // `checkMandatoryDelegations`) never forwarded `taskClass`, which left
  // the `software-bugfix` skip dead for users who classified their run
  // via `flow-state.json`. Forward-typed `null` callers still suppress
  // the lookup explicitly; only `undefined` triggers the fallback.
  const resolvedTaskClass: MandatoryDelegationTaskClass | null =
    options.taskClass !== undefined ? options.taskClass : flowState.taskClass ?? null;
  const mandatory = mandatoryAgentsFor(stage, flowState.track, resolvedTaskClass, "standard", flowState.discoveryMode);
  const skippedByTrack = mandatory.length === 0 &&
    stageSchema(stage, flowState.track, flowState.discoveryMode, resolvedTaskClass).mandatoryDelegations.length > 0;
  if (skippedByTrack) {
    await recordMandatorySkippedByTrack(projectRoot, {
      stage,
      track: flowState.track,
      taskClass: resolvedTaskClass,
      runId: flowState.activeRunId
    });
  }
  const { activeRunId } = flowState;
  const ledger = await readDelegationLedger(projectRoot);
  const events = await readDelegationEvents(projectRoot);
  const forStage = ledger.entries.filter((e) => e.stage === stage);
  const forRun = forStage.filter((e) => e.runId === activeRunId);
  const staleIgnored = forStage
    .filter((e) => e.runId !== activeRunId)
    .map((e) => `${e.agent}(runId=${e.runId ?? "unknown"})`);

  const missing: string[] = [];
  const waived: string[] = [];
  const missingEvidence: string[] = [];
  const missingDispatchProof: string[] = [];
  const legacyInferredCompletions: string[] = [];
  let legacyRequiresRerecord = false;
  const terminalSpanIds = new Set(
    forRun
      .filter((entry) => TERMINAL_DELEGATION_STATUSES.has(entry.status) && entry.spanId)
      .map((entry) => entry.spanId as string)
  );
  const staleWorkers = forRun
    .filter((entry) => entry.status === "scheduled" && entry.spanId && !terminalSpanIds.has(entry.spanId))
    .map((entry) => `${entry.agent}(spanId=${entry.spanId})`);
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

    // legacyInferredCompletions has two sources, split by `legacyTagged`:
    //   - legacyTagged === true : the row was *parsed* as legacy-inferred
    //     from a pre-v3 ledger file. Requires `delegation-record.mjs
    //     --rerecord` and BLOCKS satisfied.
    //   - legacyTagged === false: in-check inference for minimally-spec'd
    //     isolated rows that lack proof-era signals. Advisory only —
    //     preserves backward-compatible behavior for existing API callers.
    for (const row of completedRows) {
      const mode = row.fulfillmentMode ?? "isolated";
      if (mode === "legacy-inferred") {
        legacyInferredCompletions.push(`${agent}(spanId=${row.spanId ?? "unknown"})`);
        legacyRequiresRerecord = true;
        continue;
      }
      if (mode === "isolated") {
        const spanEvents = events.events.filter((event) =>
          event.runId === activeRunId &&
          event.stage === stage &&
          event.agent === agent &&
          event.spanId === row.spanId
        );
        const dispatchId = row.dispatchId ?? row.workerRunId ?? spanEvents.find((event) => event.dispatchId || event.workerRunId)?.dispatchId ?? spanEvents.find((event) => event.workerRunId)?.workerRunId;
        const dispatchSurface = row.dispatchSurface ?? spanEvents.find((event) => event.dispatchSurface)?.dispatchSurface;
        const agentDefinitionPath = row.agentDefinitionPath ?? spanEvents.find((event) => event.agentDefinitionPath)?.agentDefinitionPath;
        const hasAck = Boolean(row.ackTs || spanEvents.some((event) => event.event === "acknowledged" && event.ackTs));
        const hasCompleted = Boolean(row.completedTs || spanEvents.some((event) => event.event === "completed" && event.completedTs));
        const hasDispatchProof = Boolean(row.spanId && dispatchId && dispatchSurface && agentDefinitionPath && hasAck && hasCompleted);
        if (!hasDispatchProof) {
          const proofEraSignal = Boolean(row.dispatchId || row.workerRunId || row.dispatchSurface || row.agentDefinitionPath || spanEvents.some((event) =>
            event.dispatchId || event.workerRunId || event.dispatchSurface || event.agentDefinitionPath || event.event === "acknowledged" || event.event === "launched"
          ));
          if (proofEraSignal) {
            missingDispatchProof.push(agent);
          } else {
            legacyInferredCompletions.push(`${agent}(spanId=${row.spanId ?? "unknown"})`);
          }
        }
      }
    }
  }

  return {
    satisfied:
      missing.length === 0 &&
      missingEvidence.length === 0 &&
      missingDispatchProof.length === 0 &&
      !legacyRequiresRerecord &&
      staleWorkers.length === 0 &&
      events.corruptLines.length === 0,
    missing,
    waived,
    staleIgnored,
    missingEvidence,
    missingDispatchProof,
    legacyInferredCompletions,
    corruptEventLines: events.corruptLines,
    staleWorkers,
    expectedMode,
    skippedByTrack
  };
}

/**
 * Wave 24 (v6.0.0) — append a non-delegation audit event to
 * `delegation-events.jsonl` recording that the mandatory delegation
 * gate was skipped because of the active track / task class. Plays the
 * same audit role as a `waived` row but does NOT carry an agent —
 * downstream tooling treats `event === "mandatory_delegations_skipped_by_track"`
 * lines as informational.
 *
 * Failures are swallowed: the audit log is best-effort. Missing the
 * event must never block stage advance because the gate skip itself is
 * authoritative.
 */
async function recordMandatorySkippedByTrack(
  projectRoot: string,
  params: {
    stage: FlowStage;
    track: FlowState["track"];
    taskClass: MandatoryDelegationTaskClass | null;
    runId: string;
  }
): Promise<void> {
  const eventsPath = delegationEventsPath(projectRoot);
  const payload = {
    event: "mandatory_delegations_skipped_by_track" as const,
    stage: params.stage,
    track: params.track,
    taskClass: params.taskClass,
    runId: params.runId,
    ts: new Date().toISOString()
  };
  try {
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    await fs.appendFile(eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // best-effort audit; never block stage advance.
  }
}

/**
 * Wave 25 (v6.1.0) — append a non-delegation audit event recording
 * that one or more required artifact-validation findings were
 * demoted from blocking to advisory because the active run is on a
 * small-fix lane (`track === "quick"` or `taskClass === "software-bugfix"`).
 *
 * The event mirrors the Wave 24 `mandatory_delegations_skipped_by_track`
 * audit pattern: best-effort write to `delegation-events.jsonl`, no
 * agent payload, recognized by `readDelegationEvents` so it does not
 * corrupt downstream parsers. Failures are swallowed.
 */
export async function recordArtifactValidationDemotedByTrack(
  projectRoot: string,
  params: {
    stage: FlowStage;
    track: FlowState["track"];
    taskClass: MandatoryDelegationTaskClass | null;
    runId: string;
    sections: string[];
  }
): Promise<void> {
  if (params.sections.length === 0) return;
  const eventsPath = delegationEventsPath(projectRoot);
  const payload = {
    event: "artifact_validation_demoted_by_track" as const,
    stage: params.stage,
    track: params.track,
    taskClass: params.taskClass,
    runId: params.runId,
    sections: params.sections,
    ts: new Date().toISOString()
  };
  try {
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    await fs.appendFile(eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // best-effort audit; never block stage advance.
  }
}

/**
 * Wave 25 (v6.1.0) — append a non-delegation audit event recording
 * that the scope-stage Expansion Strategist (`product-discovery`)
 * delegation requirement was skipped because the active run is on a
 * small-fix lane (`track === "quick"` or `taskClass === "software-bugfix"`).
 *
 * Mirrors the Wave 24 `mandatory_delegations_skipped_by_track`
 * audit pattern: best-effort write to `delegation-events.jsonl`, no
 * agent payload, recognized by `readDelegationEvents` so it does not
 * corrupt downstream parsers. Failures are swallowed.
 */
export async function recordExpansionStrategistSkippedByTrack(
  projectRoot: string,
  params: {
    track: FlowState["track"];
    taskClass: MandatoryDelegationTaskClass | null;
    runId: string;
    selectedScopeMode: string;
  }
): Promise<void> {
  const eventsPath = delegationEventsPath(projectRoot);
  const payload = {
    event: "expansion_strategist_skipped_by_track" as const,
    stage: "scope" as const,
    track: params.track,
    taskClass: params.taskClass,
    runId: params.runId,
    selectedScopeMode: params.selectedScopeMode,
    ts: new Date().toISOString()
  };
  try {
    await fs.mkdir(path.dirname(eventsPath), { recursive: true });
    await fs.appendFile(eventsPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // best-effort audit; never block stage advance.
  }
}
