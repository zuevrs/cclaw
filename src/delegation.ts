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
import { type FlowState } from "./flow-state.js";
import {
  compareCanonicalUnitIds,
  mergeParallelWaveDefinitions,
  parseImplementationUnitParallelFields,
  parseImplementationUnits,
  parseParallelExecutionPlanWaves,
  parseWavePlanDirectory,
  type ParseImplementationUnitParallelOptions,
  type ParsedParallelWave
} from "./internal/plan-split-waves.js";

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

/** Agents that declare `claimedPaths` for parallel/disjoint scheduling and fan-out caps. */
export function isParallelTddSliceWorker(agent: string | undefined): boolean {
  return agent === "slice-builder";
}

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
   * Present on waiver rows that went through `cclaw-cli internal
   * waiver-grant`. Legacy rows that lack provenance are surfaced as the
   * advisory linter finding `waiver_legacy_provenance`.
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
   * When set, the operator explicitly opted into running this
   * scheduled span concurrently with another active span on the same
   * `(stage, agent)` pair. Bypasses the dispatch-dedup check.
   */
  allowParallel?: boolean;
  /**
   * Set on synthetic terminal `stale` rows written via
   * `--supersede=<prevSpanId>`. References the new spanId that
   * superseded this span. Helps `/cc tree` and the linter report a
   * coherent successor chain.
   */
  supersededBy?: string;
  /**
   * Repo-relative paths the delegated slice-builder will edit. Used by the
   * file-overlap scheduler to either auto-allow parallel dispatch (disjoint
   * paths) or block the row with `DispatchOverlapError` (overlapping paths).
   * For agents other than `slice-builder` the field is advisory.
   *
   * keep in sync with the inline copy in
   * `src/content/hooks.ts::delegationRecordScript`.
   */
  claimedPaths?: string[];
  /**
   * TDD slice identifier, e.g. `"S-1"`. Recorded by the controller when
   * dispatching `slice-builder` so the artifact linter can auto-derive the
   * Watched-RED Proof + Vertical Slice Cycle tables from
   * `delegation-events.jsonl` instead of requiring agents to maintain the
   * markdown by hand. Optional on non-TDD rows.
   *
   * keep in sync with the inline copy in
   * `src/content/hooks.ts::delegationRecordScript`.
   */
  sliceId?: string;
  /**
   * Explicit phase tag for TDD slice events. Combined with `sliceId`, the
   * linter validates RED → GREEN → REFACTOR → DOC monotonicity per slice.
   * `refactor-deferred` requires a rationale either via
   * `--refactor-rationale` (recorded into `evidenceRefs[0]`) or an
   * `evidenceRefs` entry that contains the rationale text.
   *
   * keep in sync with the inline copy in
   * `src/content/hooks.ts::delegationRecordScript`.
   */
  phase?:
    | "red"
    | "green"
    | "refactor"
    | "refactor-deferred"
    | "doc"
    | "resolve-conflict";
  /**
   * Refactor outcome folded into `phase=green` events so a single row can
   * close RED → GREEN → REFACTOR for the slice without a separate
   * `phase=refactor` / `phase=refactor-deferred` lifecycle pass.
   *
   * - `mode: "inline"` — refactor pass ran inline as part of the GREEN
   *   delegation (rationale optional but recommended for traceability).
   * - `mode: "deferred"` — refactor was intentionally deferred; rationale
   *   is required (carried in `rationale` and mirrored into
   *   `evidenceRefs[0]` so evidence-pointer linters keep matching).
   *
   * `phase=refactor` and `phase=refactor-deferred` events remain valid;
   * the linter accepts either form for REFACTOR coverage.
   *
   * keep in sync with the inline copy in
   * `src/content/hooks.ts::delegationRecordScript`.
   */
  refactorOutcome?: {
    mode: "inline" | "deferred";
    rationale?: string;
  };
  /**
   * Risk tier hint copied from the plan slice. Used by
   * `integrationCheckRequired()` to decide whether the integration-overseer
   * must run. `low` and `medium` are advisory; `high` always triggers the
   * overseer. Optional on every row.
   */
  riskTier?: "low" | "medium" | "high";
};

export const DELEGATION_PHASES = [
  "red",
  "green",
  "refactor",
  "refactor-deferred",
  "doc",
  "resolve-conflict"
] as const;
export type DelegationPhase = (typeof DELEGATION_PHASES)[number];

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
    (o.supersededBy === undefined || typeof o.supersededBy === "string") &&
    (o.claimedPaths === undefined ||
      (Array.isArray(o.claimedPaths) && o.claimedPaths.every((item) => typeof item === "string"))) &&
    (o.sliceId === undefined || typeof o.sliceId === "string") &&
    (o.phase === undefined ||
      (typeof o.phase === "string" &&
        (DELEGATION_PHASES as readonly string[]).includes(o.phase))) &&
    (o.refactorOutcome === undefined || isRefactorOutcomeShape(o.refactorOutcome)) &&
    (o.riskTier === undefined ||
      o.riskTier === "low" ||
      o.riskTier === "medium" ||
      o.riskTier === "high")
  );
}

function isRefactorOutcomeShape(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const o = value as Record<string, unknown>;
  if (o.mode !== "inline" && o.mode !== "deferred") return false;
  if (o.rationale !== undefined && typeof o.rationale !== "string") return false;
  return true;
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
 * Audit-only event types that live in
 * `delegation-events.jsonl` but do NOT carry a delegation lifecycle
 * payload (no agent/spanId). The parser must accept them so they
 * don't show up as corrupt lines.
 */
const NON_DELEGATION_AUDIT_EVENTS = new Set<string>([
  "mandatory_delegations_skipped_by_track",
  "artifact_validation_demoted_by_track",
  "expansion_strategist_skipped_by_track",
  "cclaw_slice_lease_expired",
  "cclaw_fanin_applied",
  "cclaw_fanin_conflict",
  "cclaw_fanin_resolved",
  "cclaw_fanin_abandoned",
  "cclaw_integration_overseer_skipped",
  "slice-completed"
]);

function isAuditEventLine(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
  const evt = (parsed as { event?: unknown }).event;
  return typeof evt === "string" && NON_DELEGATION_AUDIT_EVENTS.has(evt);
}

export async function readDelegationEvents(projectRoot: string): Promise<{
  events: DelegationEvent[];
  corruptLines: number[];
}> {
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
        // Audit-only row (e.g. mandatory_delegations_skipped_by_track).
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
 * Thrown by `validateMonotonicTimestamps` when an incoming row
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
 * Enforce that lifecycle timestamps on a delegation span move
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
 * Thrown by `appendDelegation` when the operator opens a
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
 * Thrown by `validateFileOverlap` when a new `slice-builder` is scheduled
 * on a TDD stage with at least one `claimedPaths` entry that overlaps an
 * active span. The scheduler auto-allows parallel dispatch when paths are
 * disjoint, so an explicit overlap is treated as a serialization signal:
 * the operator must wait for the existing span to terminate or pass
 * `--allow-parallel` deliberately to acknowledge the conflict.
 */
export class DispatchOverlapError extends Error {
  readonly existingSpanId: string;
  readonly newSpanId: string;
  readonly pair: { stage: string; agent: string };
  readonly conflictingPaths: string[];
  constructor(params: {
    existingSpanId: string;
    newSpanId: string;
    pair: { stage: string; agent: string };
    conflictingPaths: string[];
  }) {
    super(
      `dispatch_overlap — slice-builder span ${params.newSpanId} claims path(s) ${params.conflictingPaths.join(", ")} already held by active spanId=${params.existingSpanId} on stage=${params.pair.stage}. ` +
        `Wait for ${params.existingSpanId} to finish, dispatch a non-overlapping slice, or pass --allow-parallel to acknowledge the conflict.`
    );
    this.name = "DispatchOverlapError";
    this.existingSpanId = params.existingSpanId;
    this.newSpanId = params.newSpanId;
    this.pair = params.pair;
    this.conflictingPaths = params.conflictingPaths;
  }
}

/**
 * Thrown when the count of active `slice-builder` spans reaches
 * `MAX_PARALLEL_SLICE_BUILDERS` and a new scheduled row would push it past
 * the cap. Cap can be overridden once via `--override-cap=N` on the hook
 * flag or globally via `CCLAW_MAX_PARALLEL_SLICE_BUILDERS=<N>` env.
 */
export class DispatchCapError extends Error {
  readonly cap: number;
  readonly active: number;
  readonly pair: { stage: string; agent: string };
  constructor(params: { cap: number; active: number; pair: { stage: string; agent: string } }) {
    super(
      `dispatch_cap — ${params.active} active ${params.pair.agent}(s) at the cap of ${params.cap}. ` +
        `Complete one before scheduling another, or pass --override-cap=N (or CCLAW_MAX_PARALLEL_SLICE_BUILDERS=N) to lift the cap for this run.`
    );
    this.name = "DispatchCapError";
    this.cap = params.cap;
    this.active = params.active;
    this.pair = params.pair;
  }
}

/**
 * Patterns describing repo-relative paths owned by the cclaw managed
 * runtime under `.cclaw/`. Workers MUST NOT claim these as
 * `claimedPaths` because they are regenerated/rebound by `cclaw-cli sync`
 * (and similar managed flows), and worker writes silently bypass the
 * managed-resources manifest. Note: `.cclaw/artifacts/` is intentionally
 * NOT protected — slice-builders legitimately write slice cards there.
 *
 * Motivated by the hox-session 7.0.5 finding: subagent S-36 hand-edited
 * `.cclaw/hooks/delegation-record.mjs`, which had to be reverted because
 * the next `cclaw-cli sync` would have stomped the change.
 */
const MANAGED_RUNTIME_PATH_PATTERNS: readonly RegExp[] = [
  /^\.cclaw\/(hooks|agents|skills|commands|templates|seeds|rules|state)\//u,
  /^\.cclaw\/config\.yaml$/u,
  /^\.cclaw\/managed-resources\.json$/u,
  /^\.cclaw\/\.flow-state\.guard\.json$/u
];

/**
 * Return `true` when `path` is a repo-relative path owned by the cclaw
 * managed runtime under `.cclaw/`. Used by `validateClaimedPathsNotProtected`
 * during `appendDelegation` to reject `slice-builder` (or any worker)
 * spans that try to claim ownership of cclaw-managed files. Does not
 * normalise the input — callers pass the path exactly as the worker wrote
 * it into `claimedPaths` so the error message points at the real string.
 */
export function isManagedRuntimePath(path: string): boolean {
  if (typeof path !== "string" || path.length === 0) return false;
  return MANAGED_RUNTIME_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/**
 * Thrown by `appendDelegation` when a scheduled span declares a
 * `claimedPaths` entry that lives under the cclaw managed runtime
 * (see `isManagedRuntimePath`). Workers must never edit those paths
 * directly — they are owned by the managed sync surface. The error
 * lists the offending paths so the operator can drop or rewrite them.
 */
export class DispatchClaimedPathProtectedError extends Error {
  readonly protectedPaths: string[];
  readonly spanId: string;
  constructor(params: { protectedPaths: string[]; spanId: string }) {
    super(
      `dispatch_claimed_path_protected — span ${params.spanId} claims managed-runtime path(s) ${params.protectedPaths.join(", ")}; ` +
        `paths under .cclaw/{hooks,agents,skills,commands,templates,seeds,rules,state}/, .cclaw/config.yaml, .cclaw/managed-resources.json, and .cclaw/.flow-state.guard.json are owned by cclaw-cli sync and must not appear in claimedPaths. ` +
        `Drop them from claimedPaths or, if a managed-runtime change is genuinely required, ship it through a cclaw release rather than a worker span.`
    );
    this.name = "DispatchClaimedPathProtectedError";
    this.protectedPaths = params.protectedPaths;
    this.spanId = params.spanId;
  }
}

/**
 * Reject any worker span that declares `claimedPaths` entries owned by
 * the cclaw managed runtime. Called from `appendDelegation` for
 * `status === "scheduled"` rows alongside the overlap and fan-out
 * checks. Throws `DispatchClaimedPathProtectedError` listing every
 * offending path so the operator can fix the dispatch in one pass.
 */
export function validateClaimedPathsNotProtected(stamped: DelegationEntry): void {
  const claimed = Array.isArray(stamped.claimedPaths) ? stamped.claimedPaths : [];
  if (claimed.length === 0) return;
  const offending = claimed.filter((p) => isManagedRuntimePath(p));
  if (offending.length === 0) return;
  throw new DispatchClaimedPathProtectedError({
    protectedPaths: offending,
    spanId: stamped.spanId ?? "unknown"
  });
}

/**
 * Thrown by `appendDelegation` when a new `scheduled` span would open a
 * second TDD cycle for a slice that already has at least one closed span
 * (a span with completed phase rows for `red`, `green`, at least one of
 * `refactor`/`refactor-deferred`, and `doc`) in the same run. Re-running
 * a slice under a fresh span is almost always controller drift —
 * legitimate replay reuses the original spanId and is absorbed by the
 * existing dedup. Motivated by the hox-session 7.0.5 finding where
 * `S-36` had two scheduled spans (`span-w07-S-36-final` and `span-w07-S-36`)
 * that the linter then misread as out-of-order phases.
 */
export class SliceAlreadyClosedError extends Error {
  readonly sliceId: string;
  readonly runId: string;
  readonly closedSpanId: string;
  readonly newSpanId: string;
  constructor(params: {
    sliceId: string;
    runId: string;
    closedSpanId: string;
    newSpanId: string;
  }) {
    super(
      `slice ${params.sliceId} already has a closed span (${params.closedSpanId}); refusing to schedule new span ${params.newSpanId} in run ${params.runId}`
    );
    this.name = "SliceAlreadyClosedError";
    this.sliceId = params.sliceId;
    this.runId = params.runId;
    this.closedSpanId = params.closedSpanId;
    this.newSpanId = params.newSpanId;
  }
}

/**
 * Detect closed spans for `(sliceId, runId)`. A span is considered
 * closed when it has completed phase rows for `red`, `green`, REFACTOR
 * coverage (either `phase=refactor`, `phase=refactor-deferred`, or
 * `phase=green` carrying `refactorOutcome`), AND `doc`. Returns the set of
 * closed spanIds; callers use this to reject new scheduled spans on
 * already-closed slices.
 */
function closedSliceSpans(
  prior: DelegationEntry[],
  sliceId: string,
  runId: string | undefined
): Set<string> {
  const closed = new Set<string>();
  if (typeof sliceId !== "string" || sliceId.length === 0) return closed;
  const matches = prior.filter(
    (entry) =>
      entry.sliceId === sliceId &&
      entry.runId === runId &&
      typeof entry.spanId === "string" &&
      entry.spanId.length > 0
  );
  const bySpan = new Map<string, DelegationEntry[]>();
  for (const entry of matches) {
    const spanId = entry.spanId as string;
    const existing = bySpan.get(spanId) ?? [];
    existing.push(entry);
    bySpan.set(spanId, existing);
  }
  for (const [spanId, entries] of bySpan.entries()) {
    const phases = new Set(
      entries
        .filter((e) => e.status === "completed" && typeof e.phase === "string")
        .map((e) => e.phase as string)
    );
    const hasRed = phases.has("red");
    const hasGreen = phases.has("green");
    const hasRefactorPhase = phases.has("refactor") || phases.has("refactor-deferred");
    const greens = entries.filter((e) => e.status === "completed" && e.phase === "green");
    const greenWithOutcome = greens.find(
      (e) =>
        e.refactorOutcome &&
        (e.refactorOutcome.mode === "inline" || e.refactorOutcome.mode === "deferred")
    );
    let hasRefactorFromGreen = false;
    if (greenWithOutcome?.refactorOutcome?.mode === "deferred") {
      hasRefactorFromGreen = !!(
        (greenWithOutcome.refactorOutcome.rationale &&
          greenWithOutcome.refactorOutcome.rationale.trim().length > 0) ||
        (Array.isArray(greenWithOutcome.evidenceRefs) &&
          greenWithOutcome.evidenceRefs.some((ref) => typeof ref === "string" && ref.trim().length > 0))
      );
    } else if (greenWithOutcome?.refactorOutcome?.mode === "inline") {
      hasRefactorFromGreen = true;
    }
    const hasRefactor = hasRefactorPhase || hasRefactorFromGreen;
    const hasDoc = phases.has("doc");
    if (hasRed && hasGreen && hasRefactor && hasDoc) {
      closed.add(spanId);
    }
  }
  return closed;
}

/**
 * Default cap on active `slice-builder` spans in a single TDD run. Override
 * via `CCLAW_MAX_PARALLEL_SLICE_BUILDERS=<int>` (validated `>=1`).
 */
export const MAX_PARALLEL_SLICE_BUILDERS = 5 as const;

export interface ReadySliceUnit {
  unitId: string;
  sliceId: string;
  dependsOn: string[];
  claimedPaths: string[];
  parallelizable: boolean;
}

export interface SelectReadySlicesOptions {
  cap: number;
  completedUnitIds: ReadonlySet<string>;
  activePathHolders: ReadonlyArray<{ paths: string[] }>;
}

/**
 * Return up to `cap` slice units whose dependsOn are satisfied, avoiding
 * `claimedPaths` intersections with already-selected units and active holders.
 */
export function selectReadySlices(
  units: ReadySliceUnit[],
  opts: SelectReadySlicesOptions
): ReadySliceUnit[] {
  const ordered = [...units].sort((a, b) => compareCanonicalUnitIds(a.unitId, b.unitId));
  const selected: ReadySliceUnit[] = [];
  const blockedPaths = new Set<string>();
  for (const holder of opts.activePathHolders) {
    for (const p of holder.paths) {
      blockedPaths.add(p);
    }
  }
  for (const u of ordered) {
    if (opts.completedUnitIds.has(u.unitId)) continue;
    if (!u.dependsOn.every((d) => opts.completedUnitIds.has(d))) continue;
    let clash = false;
    for (const p of u.claimedPaths) {
      if (blockedPaths.has(p)) {
        clash = true;
        break;
      }
    }
    if (clash) continue;
    for (const v of selected) {
      for (const pu of u.claimedPaths) {
        if (v.claimedPaths.includes(pu)) {
          clash = true;
          break;
        }
      }
      if (clash) break;
    }
    if (clash) continue;
    selected.push(u);
    for (const p of u.claimedPaths) {
      blockedPaths.add(p);
    }
    if (selected.length >= opts.cap) break;
  }
  return selected;
}

/**
 * Build scheduler rows from merged parallel wave definitions + plan units.
 */
export function readySliceUnitsFromMergedWaves(
  mergedWaves: ParsedParallelWave[],
  planMarkdown: string,
  options?: ParseImplementationUnitParallelOptions
): ReadySliceUnit[] {
  const units = parseImplementationUnits(planMarkdown);
  const metaByUnit = new Map(
    units.map((u) => {
      const m = parseImplementationUnitParallelFields(u, options);
      return [m.unitId, m] as const;
    })
  );
  const sliceSet = new Set<string>();
  for (const w of mergedWaves) {
    for (const m of w.members) {
      sliceSet.add(m.sliceId);
    }
  }
  const out: ReadySliceUnit[] = [];
  for (const sliceId of [...sliceSet].sort((a, b) => a.localeCompare(b))) {
    const member = mergedWaves.flatMap((w) => w.members).find((x) => x.sliceId === sliceId);
    if (!member) continue;
    const meta = metaByUnit.get(member.unitId);
    if (!meta) {
      out.push({
        unitId: member.unitId,
        sliceId,
        dependsOn: [],
        claimedPaths: [],
        parallelizable: true
      });
      continue;
    }
    out.push({
      unitId: meta.unitId,
      sliceId,
      dependsOn: meta.dependsOn,
      claimedPaths: meta.claimedPaths,
      parallelizable: meta.parallelizable
    });
  }
  return out;
}

/**
 * Verdict from `integrationCheckRequired()`.
 *
 * `required: true` means the controller MUST dispatch
 * `integration-overseer` before stage-complete; `reasons[]` lists the
 * triggers that fired so the controller can quote them in artifacts.
 *
 * `required: false` means the integration check can be safely skipped
 * (disjoint paths and no high-risk slices). Callers
 * that skip dispatch should append a `cclaw_integration_overseer_skipped`
 * audit row to `delegation-events.jsonl` so the run log stays honest
 * about the decision.
 */
export interface IntegrationCheckVerdict {
  required: boolean;
  reasons: string[];
}

interface IntegrationCheckInput {
  /** Slice id (e.g. `S-1`). Required for the heuristic to be meaningful. */
  sliceId: string;
  /**
   * Repo-relative paths the slice claimed (file-overlap scheduler
   * input + slice-builder evidence).
   */
  claimedPaths?: string[];
  /** Optional `riskTier` echoed from the plan row. */
  riskTier?: "low" | "medium" | "high";
}

/**
 * Heuristic helper deciding whether a multi-slice wave needs
 * the `integration-overseer` dispatch.
 *
 * Triggers (any one):
 *   - **two or more closed slices share import boundaries** (heuristic:
 *     two slices declare a `claimedPaths` whose first 2 path segments
 *     match — same package/module directory);
 *   - any slice has `riskTier === "high"`.
 *
 * When none fire, the verdict is `{ required: false, reasons: ["disjoint-paths"] }`
 * and the caller should record a `cclaw_integration_overseer_skipped`
 * audit before bypassing the dispatch.
 *
 * Note on inputs: this function reads from the supplied delegation
 * events list directly so callers can inject synthetic data in tests.
 * Use `readDelegationEvents(projectRoot)` in production paths.
 */
export function integrationCheckRequired(events: DelegationEvent[]): IntegrationCheckVerdict {
  const reasons: string[] = [];
  // Closed slices = ones whose phase=green or phase=refactor row is
  // completed. We collect each unique sliceId's representative paths
  // and risk tier so the heuristic looks at terminal state only.
  const sliceState = new Map<string, IntegrationCheckInput>();
  for (const evt of events) {
    if (evt.stage !== "tdd") continue;
    if (typeof evt.sliceId !== "string" || evt.sliceId.length === 0) continue;
    if (evt.status !== "completed") continue;
    if (evt.phase !== "green" && evt.phase !== "refactor" && evt.phase !== "refactor-deferred") {
      continue;
    }
    const existing = sliceState.get(evt.sliceId) ?? { sliceId: evt.sliceId };
    if (Array.isArray(evt.claimedPaths) && evt.claimedPaths.length > 0) {
      const merged = new Set(existing.claimedPaths ?? []);
      for (const p of evt.claimedPaths) merged.add(p);
      existing.claimedPaths = [...merged];
    }
    if (evt.riskTier === "low" || evt.riskTier === "medium" || evt.riskTier === "high") {
      // Highest-wins so the verdict is conservative.
      const order = { low: 0, medium: 1, high: 2 } as const;
      const prev = existing.riskTier ?? "low";
      if (order[evt.riskTier] >= order[prev]) {
        existing.riskTier = evt.riskTier;
      }
    }
    sliceState.set(evt.sliceId, existing);
  }

  const slices = [...sliceState.values()];
  if (slices.some((s) => s.riskTier === "high")) {
    reasons.push("high-risk-slice");
  }

  // Shared-directory heuristic — two distinct slices with overlapping
  // first-2-segment directory prefixes count as shared boundary.
  const sliceDirs = new Map<string, Set<string>>();
  for (const s of slices) {
    const dirs = new Set<string>();
    for (const raw of s.claimedPaths ?? []) {
      const segments = raw.split("/").filter((seg) => seg.length > 0);
      if (segments.length === 0) continue;
      // For top-level files like `package.json`, fall back to the
      // first segment so single-segment paths still count as a shared
      // directory when two slices both claim the file.
      const prefix = segments.slice(0, Math.max(1, Math.min(2, segments.length))).join("/");
      dirs.add(prefix);
    }
    if (dirs.size > 0) sliceDirs.set(s.sliceId, dirs);
  }
  let sharedFound = false;
  const ids = [...sliceDirs.keys()];
  outer: for (let i = 0; i < ids.length; i += 1) {
    const a = sliceDirs.get(ids[i]!)!;
    for (let j = i + 1; j < ids.length; j += 1) {
      const b = sliceDirs.get(ids[j]!)!;
      for (const dir of a) {
        if (b.has(dir)) {
          sharedFound = true;
          break outer;
        }
      }
    }
  }
  if (sharedFound) reasons.push("shared-import-boundary");

  if (reasons.length > 0) {
    return { required: true, reasons };
  }
  return { required: false, reasons: ["disjoint-paths"] };
}

/**
 * Append a non-delegation audit event recording that the
 * integration-overseer dispatch was skipped because
 * `integrationCheckRequired()` returned `required: false`. Best-effort;
 * never throws.
 */
export async function recordIntegrationOverseerSkipped(
  projectRoot: string,
  params: {
    runId: string;
    reasons: string[];
    sliceIds: string[];
  }
): Promise<void> {
  const eventsPath = delegationEventsPath(projectRoot);
  const payload = {
    event: "cclaw_integration_overseer_skipped" as const,
    runId: params.runId,
    reasons: params.reasons,
    sliceIds: params.sliceIds,
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
 * Load merged wave plan (Parallel Execution Plan block + wave-plans/) and map to `ReadySliceUnit[]`.
 */
export async function loadTddReadySlicePool(
  planMarkdown: string,
  artifactsDir: string,
  options?: ParseImplementationUnitParallelOptions
): Promise<ReadySliceUnit[]> {
  const merged = mergeParallelWaveDefinitions(
    parseParallelExecutionPlanWaves(planMarkdown),
    await parseWavePlanDirectory(artifactsDir)
  );
  return readySliceUnitsFromMergedWaves(merged, planMarkdown, options);
}

function readMaxParallelOverrideFromEnv(): number | null {
  const raw = process.env.CCLAW_MAX_PARALLEL_SLICE_BUILDERS;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

/**
 * When scheduling a `slice-builder` on a TDD stage, compare `claimedPaths`
 * against every currently active span on the same `(stage, agent)` pair.
 * Overlap → throw `DispatchOverlapError`; disjoint paths → return
 * `{ autoParallel: true }` so the caller can mark the new entry
 * `allowParallel = true` without explicit operator intent. When the agent
 * is not a slice-builder or no `claimedPaths` are supplied, the function
 * returns `{ autoParallel: false }` and the standard dedup path takes over.
 */
export function validateFileOverlap(
  stamped: DelegationEntry,
  activeEntries: DelegationEntry[]
): { autoParallel: boolean } {
  if (!isParallelTddSliceWorker(stamped.agent) || stamped.stage !== "tdd") {
    return { autoParallel: false };
  }
  const newPaths = Array.isArray(stamped.claimedPaths) ? stamped.claimedPaths : [];
  if (newPaths.length === 0) {
    return { autoParallel: false };
  }
  const sameLane = activeEntries.filter(
    (entry) =>
      entry.stage === stamped.stage &&
      entry.agent === stamped.agent &&
      entry.spanId !== stamped.spanId
  );
  if (sameLane.length === 0) {
    return { autoParallel: true };
  }
  for (const existing of sameLane) {
    const existingPaths = Array.isArray(existing.claimedPaths) ? existing.claimedPaths : [];
    if (existingPaths.length === 0) {
      // We can't prove disjoint without the other side declaring paths;
      // be conservative and let the standard dedup error path fire.
      return { autoParallel: false };
    }
    const overlap = newPaths.filter((p) => existingPaths.includes(p));
    if (overlap.length > 0) {
      throw new DispatchOverlapError({
        existingSpanId: existing.spanId ?? "unknown",
        newSpanId: stamped.spanId ?? "unknown",
        pair: { stage: stamped.stage, agent: stamped.agent },
        conflictingPaths: overlap
      });
    }
  }
  return { autoParallel: true };
}

/**
 * Enforce the slice-builder fan-out cap. The new scheduled row pushes the
 * active count from N to N+1; if that would exceed the cap (default 5,
 * env-overridable via `CCLAW_MAX_PARALLEL_SLICE_BUILDERS`), throw
 * `DispatchCapError`.
 *
 * Caller passes the already-folded list of active entries (latest row per
 * spanId, ACTIVE statuses only). The function counts entries that match
 * the agent on the same `stage`. The new row's own spanId is excluded so
 * re-recording a `scheduled` doesn't trip the cap on a span that's already
 * counted.
 */
export function validateFanOutCap(
  stamped: DelegationEntry,
  activeEntries: DelegationEntry[],
  override?: number | null
): void {
  if (!isParallelTddSliceWorker(stamped.agent) || stamped.stage !== "tdd") return;
  if (stamped.status !== "scheduled") return;
  const cap = (override !== null && override !== undefined && Number.isInteger(override) && override >= 1)
    ? override
    : (readMaxParallelOverrideFromEnv() ?? MAX_PARALLEL_SLICE_BUILDERS);
  const sameLaneActive = activeEntries.filter(
    (entry) =>
      entry.stage === stamped.stage &&
      entry.agent === stamped.agent &&
      entry.spanId !== stamped.spanId
  );
  if (sameLaneActive.length + 1 > cap) {
    throw new DispatchCapError({
      cap,
      active: sameLaneActive.length,
      pair: { stage: stamped.stage, agent: stamped.agent }
    });
  }
}

/**
 * Find the latest active span for a given `(stage, agent)`
 * pair in the supplied ledger entries. Returns the row whose latest
 * status (after the latest-by-spanId fold) is still in the active set
 * (`scheduled | launched | acknowledged`).
 *
 * Run-scope is **strict**: only entries whose `runId` matches the
 * supplied `runId` are folded. Entries with empty/missing `runId`
 * (older ledgers without explicit run scoping) are treated as NOT belonging
 * to the current run, so they cannot keep an old span "active" across
 * a fresh dispatch and trip a spurious `dispatch_duplicate`. This
 * Ensures a slice-builder that ran in run-1 does not block a
 * slice-builder scheduled in run-2.
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
  const flowState = await readFlowState(projectRoot);
  const { activeRunId } = flowState;
  await withDirectoryLock(delegationLockPath(projectRoot), async () => {
    const filePath = delegationLogPath(projectRoot);
    const prior = await readDelegationLedger(projectRoot);
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
    if (prior.entries.some((existing) =>
      existing.spanId === stamped.spanId &&
      existing.status === stamped.status &&
      (existing.phase ?? null) === (stamped.phase ?? null)
    )) {
      return;
    }
    validateMonotonicTimestamps(stamped, prior.entries);
    if (
      stamped.status === "scheduled" &&
      typeof stamped.sliceId === "string" &&
      stamped.sliceId.length > 0 &&
      stamped.phase === undefined
    ) {
      const closed = closedSliceSpans(prior.entries, stamped.sliceId, activeRunId);
      if (closed.size > 0 && !(stamped.spanId && closed.has(stamped.spanId))) {
        const closedSpanId = closed.values().next().value as string;
        throw new SliceAlreadyClosedError({
          sliceId: stamped.sliceId,
          runId: activeRunId,
          closedSpanId,
          newSpanId: stamped.spanId ?? "unknown"
        });
      }
    }
    if (stamped.status === "scheduled") {
      validateClaimedPathsNotProtected(stamped);
      const sameRunPrior = prior.entries.filter((entry) => entry.runId === activeRunId);
      const activeForRun = computeActiveSubagents(sameRunPrior);
      const overlap = validateFileOverlap(stamped, activeForRun);
      if (overlap.autoParallel && stamped.allowParallel !== true) {
        stamped.allowParallel = true;
      }
      validateFanOutCap(stamped, activeForRun);
      if (stamped.allowParallel !== true) {
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
     * entirely. Callers that don't classify the run leave
     * this undefined; the function then falls back to
     * `flowState.taskClass` (persisted in `flow-state.json`) so the
     * Bugfix-skip remains active across the `cclaw advance-stage`
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
   * `true` when `mandatoryAgentsFor` returned [] for
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
  // Read `flowState.taskClass` as a fallback
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
 * Append a non-delegation audit event to
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
 * Append a non-delegation audit event recording
 * that one or more required artifact-validation findings were
 * demoted from blocking to advisory because the active run is on a
 * small-fix lane (`track === "quick"` or `taskClass === "software-bugfix"`).
 *
 * The event mirrors `mandatory_delegations_skipped_by_track`
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
 * Append a non-delegation audit event recording
 * that the scope-stage Expansion Strategist (`product-discovery`)
 * delegation requirement was skipped because the active run is on a
 * small-fix lane (`track === "quick"` or `taskClass === "software-bugfix"`).
 *
 * Mirrors the `mandatory_delegations_skipped_by_track`
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
