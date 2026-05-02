import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "../constants.js";
import { ensureDir, exists, withDirectoryLock, writeFileSafe } from "../fs-utils.js";
import { FLOW_STAGES, type FlowStage } from "../types.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

/**
 * Tokens issued by `cclaw internal waiver-grant` live under the runtime
 * root. The ledger also tracks `consumed[]` entries so consumption is
 * traceable and one-shot.
 */
const WAIVER_LEDGER_REL_PATH = `${RUNTIME_ROOT}/.waivers.json`;
const WAIVER_LEDGER_LOCK_REL_PATH = `${RUNTIME_ROOT}/.waivers.json.lock`;
export const WAIVER_TOKEN_DEFAULT_TTL_MINUTES = 30;
export const WAIVER_TOKEN_MAX_TTL_MINUTES = 120;
export const WAIVER_REASON_PATTERN = /^[a-z][a-z0-9_-]{2,}$/u;
const WAIVER_TOKEN_PREFIX = "WV";
const WAIVER_LEDGER_SCHEMA_VERSION = 1;

export interface WaiverRecord {
  token: string;
  stage: FlowStage;
  reason: string;
  issuedAt: string;
  expiresAt: string;
  consumedAt: string | null;
  issuerSubsystem: string;
  consumedBy?: string;
}

export interface WaiverLedger {
  schemaVersion: number;
  pending: WaiverRecord[];
  consumed: WaiverRecord[];
}

export interface IssueWaiverTokenOptions {
  stage: FlowStage;
  reason: string;
  expiresInMinutes?: number;
  issuerSubsystem?: string;
  now?: Date;
}

export interface ConsumeWaiverOptions {
  stage: FlowStage;
  token: string;
  consumedBy?: string;
  now?: Date;
}

function waiverLedgerPath(projectRoot: string): string {
  return path.join(projectRoot, WAIVER_LEDGER_REL_PATH);
}

function waiverLedgerLockPath(projectRoot: string): string {
  return path.join(projectRoot, WAIVER_LEDGER_LOCK_REL_PATH);
}

function sanitizeWaiverRecord(value: unknown): WaiverRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const token = typeof row.token === "string" ? row.token : "";
  const stage = row.stage;
  const reason = typeof row.reason === "string" ? row.reason : "";
  const issuedAt = typeof row.issuedAt === "string" ? row.issuedAt : "";
  const expiresAt = typeof row.expiresAt === "string" ? row.expiresAt : "";
  const consumedAt = typeof row.consumedAt === "string" ? row.consumedAt : null;
  const issuerSubsystem = typeof row.issuerSubsystem === "string" ? row.issuerSubsystem : "";
  const consumedBy = typeof row.consumedBy === "string" ? row.consumedBy : undefined;
  if (
    token.length === 0 ||
    typeof stage !== "string" ||
    !FLOW_STAGES.includes(stage as FlowStage) ||
    reason.length === 0 ||
    issuedAt.length === 0 ||
    expiresAt.length === 0 ||
    issuerSubsystem.length === 0
  ) {
    return null;
  }
  return {
    token,
    stage: stage as FlowStage,
    reason,
    issuedAt,
    expiresAt,
    consumedAt,
    issuerSubsystem,
    ...(consumedBy ? { consumedBy } : {})
  };
}

async function readWaiverLedger(projectRoot: string): Promise<WaiverLedger> {
  const statePath = waiverLedgerPath(projectRoot);
  if (!(await exists(statePath))) {
    return { schemaVersion: WAIVER_LEDGER_SCHEMA_VERSION, pending: [], consumed: [] };
  }
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch {
    return { schemaVersion: WAIVER_LEDGER_SCHEMA_VERSION, pending: [], consumed: [] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { schemaVersion: WAIVER_LEDGER_SCHEMA_VERSION, pending: [], consumed: [] };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { schemaVersion: WAIVER_LEDGER_SCHEMA_VERSION, pending: [], consumed: [] };
  }
  const typed = parsed as Record<string, unknown>;
  const pending = Array.isArray(typed.pending)
    ? typed.pending
        .map((item) => sanitizeWaiverRecord(item))
        .filter((item): item is WaiverRecord => item !== null)
    : [];
  const consumed = Array.isArray(typed.consumed)
    ? typed.consumed
        .map((item) => sanitizeWaiverRecord(item))
        .filter((item): item is WaiverRecord => item !== null)
    : [];
  return { schemaVersion: WAIVER_LEDGER_SCHEMA_VERSION, pending, consumed };
}

async function writeWaiverLedger(projectRoot: string, ledger: WaiverLedger): Promise<void> {
  const next: WaiverLedger = {
    schemaVersion: WAIVER_LEDGER_SCHEMA_VERSION,
    pending: ledger.pending,
    consumed: ledger.consumed
  };
  await writeFileSafe(
    waiverLedgerPath(projectRoot),
    `${JSON.stringify(next, null, 2)}\n`,
    { mode: 0o600 }
  );
}

function formatExpiresSlug(expiresAt: Date): string {
  // Minute-precision slug for the token: e.g. `20260502T220500Z`
  return expiresAt.toISOString().replace(/[-:]/gu, "").replace(/\..+$/u, "").concat("Z");
}

function minuteFingerprint(stage: FlowStage, reason: string, issuedAt: Date): string {
  const payload = `${stage}|${reason}|${issuedAt.toISOString()}|${Math.random().toString(16).slice(2, 12)}`;
  return createHash("sha256").update(payload, "utf8").digest("hex").slice(0, 8);
}

export function formatWaiverToken(
  stage: FlowStage,
  fingerprint: string,
  expiresAt: Date
): string {
  return `${WAIVER_TOKEN_PREFIX}-${stage}-${fingerprint}-${formatExpiresSlug(expiresAt)}`;
}

export async function issueWaiverToken(
  projectRoot: string,
  options: IssueWaiverTokenOptions
): Promise<WaiverRecord> {
  if (!FLOW_STAGES.includes(options.stage)) {
    throw new Error(
      `waiver-grant: --stage must be one of ${FLOW_STAGES.join(", ")}.`
    );
  }
  const reason = options.reason.trim();
  if (reason.length === 0) {
    throw new Error("waiver-grant: --reason is required.");
  }
  if (!WAIVER_REASON_PATTERN.test(reason)) {
    throw new Error(
      "waiver-grant: --reason must match /^[a-z][a-z0-9_-]{2,}$/ (short lowercase slug, e.g. architect_unavailable)."
    );
  }
  const ttlRaw =
    typeof options.expiresInMinutes === "number" && Number.isFinite(options.expiresInMinutes)
      ? Math.floor(options.expiresInMinutes)
      : WAIVER_TOKEN_DEFAULT_TTL_MINUTES;
  if (ttlRaw < 1) {
    throw new Error("waiver-grant: --ttl must be >= 1 minute.");
  }
  if (ttlRaw > WAIVER_TOKEN_MAX_TTL_MINUTES) {
    throw new Error(
      `waiver-grant: --ttl must be <= ${WAIVER_TOKEN_MAX_TTL_MINUTES} minutes.`
    );
  }
  const issuedAtDate = options.now ?? new Date();
  const expiresAtDate = new Date(issuedAtDate.getTime() + ttlRaw * 60 * 1000);
  const fingerprint = minuteFingerprint(options.stage, reason, issuedAtDate);
  const token = formatWaiverToken(options.stage, fingerprint, expiresAtDate);
  const record: WaiverRecord = {
    token,
    stage: options.stage,
    reason,
    issuedAt: issuedAtDate.toISOString(),
    expiresAt: expiresAtDate.toISOString(),
    consumedAt: null,
    issuerSubsystem: options.issuerSubsystem?.trim() || "cli"
  };
  await ensureDir(path.dirname(waiverLedgerPath(projectRoot)));
  await withDirectoryLock(waiverLedgerLockPath(projectRoot), async () => {
    const ledger = await readWaiverLedger(projectRoot);
    ledger.pending.push(record);
    await writeWaiverLedger(projectRoot, ledger);
  });
  return record;
}

export type ConsumeWaiverFailureReason =
  | "not-found"
  | "wrong-stage"
  | "expired"
  | "already-consumed";

export interface ConsumeWaiverSuccess {
  ok: true;
  record: WaiverRecord;
}

export interface ConsumeWaiverFailure {
  ok: false;
  reason: ConsumeWaiverFailureReason;
  record?: WaiverRecord;
  detail: string;
}

export type ConsumeWaiverResult = ConsumeWaiverSuccess | ConsumeWaiverFailure;

export async function consumeWaiverToken(
  projectRoot: string,
  options: ConsumeWaiverOptions
): Promise<ConsumeWaiverResult> {
  const token = options.token.trim();
  if (token.length === 0) {
    return {
      ok: false,
      reason: "not-found",
      detail: "waiver token is required"
    };
  }
  const now = (options.now ?? new Date()).getTime();
  return withDirectoryLock(waiverLedgerLockPath(projectRoot), async () => {
    const ledger = await readWaiverLedger(projectRoot);
    const pendingIdx = ledger.pending.findIndex((entry) => entry.token === token);
    const consumedMatch = ledger.consumed.find((entry) => entry.token === token);
    if (pendingIdx < 0) {
      if (consumedMatch) {
        return {
          ok: false,
          reason: "already-consumed",
          record: consumedMatch,
          detail: `waiver token ${token} was already consumed at ${consumedMatch.consumedAt ?? "unknown time"}`
        };
      }
      return {
        ok: false,
        reason: "not-found",
        detail: `no pending waiver token "${token}" found in ${WAIVER_LEDGER_REL_PATH}`
      };
    }
    const record = ledger.pending[pendingIdx]!;
    if (record.stage !== options.stage) {
      return {
        ok: false,
        reason: "wrong-stage",
        record,
        detail: `waiver token ${token} was issued for stage "${record.stage}", not "${options.stage}"`
      };
    }
    const expiresAt = Date.parse(record.expiresAt);
    if (Number.isFinite(expiresAt) && expiresAt < now) {
      return {
        ok: false,
        reason: "expired",
        record,
        detail: `waiver token ${token} expired at ${record.expiresAt}`
      };
    }
    const consumedAtIso = (options.now ?? new Date()).toISOString();
    const consumedRecord: WaiverRecord = {
      ...record,
      consumedAt: consumedAtIso,
      ...(options.consumedBy ? { consumedBy: options.consumedBy } : {})
    };
    ledger.pending.splice(pendingIdx, 1);
    ledger.consumed.push(consumedRecord);
    await writeWaiverLedger(projectRoot, ledger);
    return { ok: true, record: consumedRecord };
  });
}

export interface WaiverGrantArgs {
  stage: FlowStage;
  reason: string;
  ttlMinutes: number;
  json: boolean;
  quiet: boolean;
}

export function parseWaiverGrantArgs(tokens: string[]): WaiverGrantArgs {
  let stage: FlowStage | undefined;
  let reason: string | undefined;
  let ttlMinutes = WAIVER_TOKEN_DEFAULT_TTL_MINUTES;
  let json = false;
  let quiet = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const nextToken = tokens[i + 1];
    const readValue = (flag: string): string => {
      if (token.startsWith(`${flag}=`)) return token.slice(flag.length + 1);
      if (token === flag && nextToken && !nextToken.startsWith("--")) {
        i += 1;
        return nextToken;
      }
      throw new Error(`${flag} requires a value.`);
    };
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--quiet") {
      quiet = true;
      continue;
    }
    if (token === "--stage" || token.startsWith("--stage=")) {
      const raw = readValue("--stage").trim();
      if (!FLOW_STAGES.includes(raw as FlowStage)) {
        throw new Error(
          `waiver-grant: --stage must be one of ${FLOW_STAGES.join(", ")}.`
        );
      }
      stage = raw as FlowStage;
      continue;
    }
    if (token === "--reason" || token.startsWith("--reason=")) {
      reason = readValue("--reason").trim();
      continue;
    }
    if (token === "--ttl" || token.startsWith("--ttl=")) {
      const raw = readValue("--ttl").trim();
      if (!/^[0-9]+$/u.test(raw)) {
        throw new Error("waiver-grant: --ttl must be an integer number of minutes.");
      }
      ttlMinutes = Number(raw);
      continue;
    }
    throw new Error(`Unknown flag for internal waiver-grant: ${token}`);
  }
  if (!stage) {
    throw new Error(
      `internal waiver-grant requires --stage=<${FLOW_STAGES.join("|")}>.`
    );
  }
  if (!reason) {
    throw new Error(
      `internal waiver-grant requires --reason=<short-slug> (e.g. architect_unavailable).`
    );
  }
  return { stage, reason, ttlMinutes, json, quiet };
}

export async function runWaiverGrant(
  projectRoot: string,
  args: WaiverGrantArgs,
  io: InternalIo
): Promise<number> {
  const record = await issueWaiverToken(projectRoot, {
    stage: args.stage,
    reason: args.reason,
    expiresInMinutes: args.ttlMinutes,
    issuerSubsystem: "cli"
  });
  if (args.json) {
    io.stdout.write(
      `${JSON.stringify({
        ok: true,
        command: "waiver-grant",
        token: record.token,
        stage: record.stage,
        reason: record.reason,
        issuedAt: record.issuedAt,
        expiresAt: record.expiresAt,
        ttlMinutes: args.ttlMinutes,
        consumption: `cclaw-cli internal advance-stage ${record.stage} --accept-proactive-waiver=${record.token} --accept-proactive-waiver-reason="${record.reason}"`
      })}\n`
    );
    return 0;
  }
  io.stdout.write(`${record.token}\n`);
  if (!args.quiet) {
    io.stdout.write(
      `Waiver token issued for stage="${record.stage}" reason="${record.reason}" expires=${record.expiresAt}.\n`
    );
    io.stdout.write(
      `Consume with: node ${RUNTIME_ROOT}/hooks/stage-complete.mjs ${record.stage} --accept-proactive-waiver=${record.token} --accept-proactive-waiver-reason="${record.reason}"\n`
    );
  }
  return 0;
}
