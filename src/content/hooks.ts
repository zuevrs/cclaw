import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ROOT } from "../constants.js";
import {
  DELEGATION_DISPATCH_SURFACES,
  DELEGATION_DISPATCH_SURFACE_PATH_PREFIXES
} from "../delegation.js";

interface GeneratedCliRuntime {
  entrypoint: string | null;
  argsPrefix: string[];
}

function resolveCliRuntimeForGeneratedHook(): GeneratedCliRuntime {
  const here = fileURLToPath(import.meta.url);
  // Vitest runs init/sync from src/ and expects helpers to execute the same
  // source runtime, even when a stale dist/ exists in the repository.
  if (process.env.VITEST === "true") {
    const sourceCli = path.resolve(path.dirname(here), "..", "cli.ts");
    const viteNode = path.resolve(path.dirname(here), "..", "..", "node_modules", "vite-node", "vite-node.mjs");
    if (existsSync(sourceCli) && existsSync(viteNode)) {
      return { entrypoint: viteNode, argsPrefix: ["--script", sourceCli] };
    }
  }

  const candidates = [
    path.resolve(path.dirname(here), "..", "cli.js"),
    path.resolve(path.dirname(here), "..", "..", "dist", "cli.js")
  ];
  for (const candidate of candidates) {
    // Synchronous probe runs only during cclaw-cli init/sync generation.
    // The generated hook receives a concrete path and does not need a global bin.
    if (existsSync(candidate)) return { entrypoint: candidate, argsPrefix: [] };
  }

  return { entrypoint: null, argsPrefix: [] };
}


interface InternalHelperScriptOptions {
  positionalArgName?: string;
  positionalArgRequired?: boolean;
  defaultQuietEnvVar?: string;
}

function internalHelperScript(
  helperName: string,
  internalSubcommand: string,
  usage: string,
  options?: InternalHelperScriptOptions
): string {
  const cliRuntime = resolveCliRuntimeForGeneratedHook();
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliRuntime.entrypoint)};
const CCLAW_CLI_ARGS_PREFIX = ${JSON.stringify(cliRuntime.argsPrefix)};
const HELPER_NAME = ${JSON.stringify(helperName)};
const INTERNAL_SUBCOMMAND = ${JSON.stringify(internalSubcommand)};
const USAGE = ${JSON.stringify(usage)};
const POSITIONAL_ARG_NAME = ${JSON.stringify(options?.positionalArgName ?? null)};
const POSITIONAL_ARG_REQUIRED = ${JSON.stringify(options?.positionalArgRequired === true)};
const DEFAULT_QUIET_ENV_VAR = ${JSON.stringify(options?.defaultQuietEnvVar ?? null)};

async function detectRoot() {
  const candidates = [
    process.env.CCLAW_PROJECT_ROOT,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CURSOR_PROJECT_DIR,
    process.env.CURSOR_PROJECT_ROOT,
    process.env.OPENCODE_PROJECT_DIR,
    process.env.OPENCODE_PROJECT_ROOT,
    process.cwd()
  ].filter((value) => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    try {
      const runtimePath = path.join(candidate, RUNTIME_ROOT);
      const stat = await fs.stat(runtimePath);
      if (stat.isDirectory()) return candidate;
    } catch {
      // continue
    }
  }
  return candidates[0] || process.cwd();
}

function printUsage() {
  process.stderr.write(USAGE + "\\n");
}

async function main() {
  const [, , ...argvTokens] = process.argv;
  if (argvTokens.includes("--help") || argvTokens.includes("-h")) {
    printUsage();
    return;
  }
  let positionalArg = "";
  let flags = argvTokens;
  if (POSITIONAL_ARG_NAME !== null) {
    positionalArg = (argvTokens[0] ?? "").trim();
    flags = argvTokens.slice(1);
    if (POSITIONAL_ARG_REQUIRED && positionalArg.length === 0) {
      printUsage();
      process.exitCode = 1;
      return;
    }
  }

  if (DEFAULT_QUIET_ENV_VAR !== null) {
    const envRaw = process.env[DEFAULT_QUIET_ENV_VAR];
    if (typeof envRaw !== "string" || envRaw.trim().length === 0) {
      process.env[DEFAULT_QUIET_ENV_VAR] = "1";
    }
    const quietRaw = (process.env[DEFAULT_QUIET_ENV_VAR] ?? "").trim().toLowerCase();
    const quietEnabled = !/^(0|false|no|off)$/u.test(quietRaw);
    const alreadyQuiet = flags.includes("--quiet");
    if (quietEnabled && !alreadyQuiet) {
      flags = [...flags, "--quiet"];
    }
  }

  const root = await detectRoot();
  const runtimePath = path.join(root, RUNTIME_ROOT);
  try {
    const stat = await fs.stat(runtimePath);
    if (!stat.isDirectory()) throw new Error("not-dir");
  } catch {
    process.stderr.write("[cclaw] " + HELPER_NAME + ": runtime root not found at " + runtimePath + "\\n");
    process.exitCode = 1;
    return;
  }

  const cliEntrypoint = process.env.CCLAW_CLI_JS || CCLAW_CLI_ENTRYPOINT;
  const cliArgsPrefix = process.env.CCLAW_CLI_JS ? [] : CCLAW_CLI_ARGS_PREFIX;
  if (!cliEntrypoint || cliEntrypoint.trim().length === 0) {
    process.stderr.write(
      "[cclaw] " + HELPER_NAME + ": local Node runtime entrypoint is missing. Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const stat = await fs.stat(cliEntrypoint);
    if (!stat.isFile()) throw new Error("not-file");
    for (const argPath of cliArgsPrefix) {
      if (typeof argPath !== "string" || argPath.startsWith("-")) continue;
      const argStat = await fs.stat(argPath);
      if (!argStat.isFile()) throw new Error("arg-not-file");
    }
  } catch {
    process.stderr.write(
      "[cclaw] " + HELPER_NAME + ": local Node runtime entrypoint not found at " + cliEntrypoint + ". Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  const internalArgs =
    POSITIONAL_ARG_NAME !== null
      ? [INTERNAL_SUBCOMMAND, positionalArg, ...flags]
      : [INTERNAL_SUBCOMMAND, ...flags];

  const child = spawn(process.execPath, [cliEntrypoint, ...cliArgsPrefix, "internal", ...internalArgs], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  let spawnErrored = false;

  child.on("error", (error) => {
    spawnErrored = true;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      process.stderr.write(
        "[cclaw] " + HELPER_NAME + ": node executable not found while invoking local runtime. Re-run npx cclaw-cli sync.\\n"
      );
    } else {
      process.stderr.write(
        "[cclaw] " + HELPER_NAME + ": failed to invoke local Node runtime (" +
          (error instanceof Error ? error.message : String(error)) +
          ").\\n"
      );
    }
    process.exitCode = 1;
  });

  child.on("close", (code, signal) => {
    if (spawnErrored) {
      process.exitCode = 1;
      return;
    }
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = typeof code === "number" && code >= 0 ? code : 1;
  });
}

void main();
`;
}

export function startFlowScript(): string {
  return internalHelperScript(
    "start-flow",
    "start-flow",
    "Usage: node " + RUNTIME_ROOT + "/hooks/start-flow.mjs --track=<standard|medium|quick> [--discovery-mode=<lean|guided|deep>] [--class=...] [--prompt=...] [--stack=...] [--reason=...] [--reclassify] [--force-reset]",
    { defaultQuietEnvVar: "CCLAW_START_FLOW_QUIET" }
  );
}

export function cancelRunScript(): string {
  return internalHelperScript(
    "cancel-run",
    "cancel-run",
    "Usage: node " + RUNTIME_ROOT + "/hooks/cancel-run.mjs --reason=<text> [--disposition=<cancelled|abandoned>] [--name=<slug>]"
  );
}

export function stageCompleteScript(): string {
  return internalHelperScript(
    "stage-complete",
    "advance-stage",
    "Usage: node " + RUNTIME_ROOT + "/hooks/stage-complete.mjs <stage> [--passed=...] [--evidence-json=...] [--waive-delegation=...] [--waiver-reason=...] [--accept-proactive-waiver=<token>] [--accept-proactive-waiver-reason=\"<why safe>\"] [--skip-questions] [--json]",
    {
      positionalArgName: "stage",
      positionalArgRequired: true,
      defaultQuietEnvVar: "CCLAW_STAGE_COMPLETE_QUIET"
    }
  );
}

export function delegationRecordScript(): string {
  return `#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const VALID_STATUSES = new Set(["scheduled", "launched", "acknowledged", "completed", "failed", "waived", "stale"]);
const TERMINAL = new Set(["completed", "failed", "waived", "stale"]);
const VALID_DISPATCH_SURFACES = ${JSON.stringify([...DELEGATION_DISPATCH_SURFACES])};
const VALID_DISPATCH_SURFACES_SET = new Set(VALID_DISPATCH_SURFACES);
const SURFACE_PATH_PREFIXES = ${JSON.stringify(DELEGATION_DISPATCH_SURFACE_PATH_PREFIXES)};
const LEDGER_SCHEMA_VERSION = 3;
const FLOW_STATE_GUARD_REL_PATH = RUNTIME_ROOT + "/.flow-state.guard.json";

async function verifyFlowStateGuardInline(root) {
  const statePath = path.join(root, RUNTIME_ROOT, "state", "flow-state.json");
  const guardPath = path.join(root, FLOW_STATE_GUARD_REL_PATH);
  let raw;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch {
    return;
  }
  let guard;
  try {
    const guardRaw = await fs.readFile(guardPath, "utf8");
    guard = JSON.parse(guardRaw);
  } catch {
    return;
  }
  if (!guard || typeof guard !== "object" || typeof guard.sha256 !== "string") return;
  const actual = createHash("sha256").update(raw, "utf8").digest("hex");
  if (actual === guard.sha256) return;
  process.stderr.write(
    "[cclaw] delegation-record: flow-state guard mismatch: " + (guard.runId || "unknown-run") + "\\n" +
      "expected sha: " + guard.sha256 + "\\n" +
      "actual sha:   " + actual + "\\n" +
      "last writer:  " + (guard.writerSubsystem || "unknown") + "@" + (guard.writtenAt || "unknown") + "\\n" +
      "do not edit flow-state.json by hand. To recover, run:\\n" +
      "  cclaw-cli internal flow-state-repair --reason \\"manual_edit_recovery\\"\\n"
  );
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    const valueMatch = /^--([^=]+)=(.*)$/u.exec(raw);
    if (valueMatch) {
      args[valueMatch[1]] = valueMatch[2];
      continue;
    }
    const flagMatch = /^--([^=]+)$/u.exec(raw);
    if (flagMatch) args[flagMatch[1]] = true;
  }
  return args;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function detectRoot() {
  const candidates = [
    process.env.CCLAW_PROJECT_ROOT,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CURSOR_PROJECT_DIR,
    process.env.CURSOR_PROJECT_ROOT,
    process.env.OPENCODE_PROJECT_DIR,
    process.env.OPENCODE_PROJECT_ROOT,
    process.cwd()
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    if (await exists(path.join(candidate, RUNTIME_ROOT))) return candidate;
  }
  return candidates[0] || process.cwd();
}

async function readRunId(root) {
  try {
    const raw = await fs.readFile(path.join(root, RUNTIME_ROOT, "state", "flow-state.json"), "utf8");
    const parsed = JSON.parse(raw);
    return typeof parsed.activeRunId === "string" ? parsed.activeRunId : "unknown-run";
  } catch {
    return "unknown-run";
  }
}

async function readDelegationEvents(root) {
  try {
    const raw = await fs.readFile(path.join(root, RUNTIME_ROOT, "state", "delegation-events.jsonl"), "utf8");
    return raw
      .split(/\\r?\\n/u)
      .filter((line) => line.trim().length > 0)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter((event) => event && typeof event === "object");
  } catch {
    return [];
  }
}

function hasPriorAck(events, args, runId) {
  return events.some((event) =>
    event.runId === runId &&
    event.stage === args.stage &&
    event.agent === args.agent &&
    event.spanId === args["span-id"] &&
    event.event === "acknowledged" &&
    typeof event.ackTs === "string" &&
    event.ackTs.length > 0
  );
}

function usage() {
  process.stderr.write([
    "Usage:",
    "  node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent> --mode=<mandatory|proactive> --status=<scheduled|launched|acknowledged|completed|failed|waived|stale> --span-id=<id> [--dispatch-id=<id>] [--worker-run-id=<id>] [--dispatch-surface=<surface>] [--agent-definition-path=<path>] [--ack-ts=<iso>] [--launched-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--waiver-reason=<text>] [--supersede=<prevSpanId>] [--allow-parallel] [--paths=<comma-separated>] [--override-cap=<int>] [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --rerecord --span-id=<id> --dispatch-id=<id> --dispatch-surface=<surface> --agent-definition-path=<path> [--ack-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --repair --span-id=<id> --repair-reason=\"<why>\" [--json]",
    "",
    "Allowed --dispatch-surface values:",
    "  " + VALID_DISPATCH_SURFACES.join(", "),
    "",
    "Per-surface allowed --agent-definition-path prefixes:",
    ...VALID_DISPATCH_SURFACES.map((surface) => "  " + surface + ": " + (SURFACE_PATH_PREFIXES[surface].length === 0 ? "(any)" : SURFACE_PATH_PREFIXES[surface].join(", "))),
    "",
    "Dispatch dedup (v6.8.0):",
    "  --supersede=<prevSpanId>  close the previous active span on this (stage, agent) as 'stale' before recording the new scheduled row",
    "  --allow-parallel          record both spans as concurrent; new row is tagged allowParallel: true",
    "",
    "TDD parallel scheduler (v6.10.0):",
    "  --paths=<a,b,c>           repo-relative paths the slice-implementer will edit; disjoint sets auto-promote to allowParallel, overlap throws DispatchOverlapError",
    "  --override-cap=<int>      raise the slice-implementer fan-out cap once for this dispatch (default cap " + String(5) + ", env CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS overrides globally)",
    ""
  ].join("\\n") + "\\n");
}

function emitProblems(problems, json, code) {
  const exitCode = typeof code === "number" ? code : 1;
  if (json) {
    process.stdout.write(JSON.stringify({ ok: false, problems, allowedDispatchSurfaces: VALID_DISPATCH_SURFACES }, null, 2) + "\\n");
  } else {
    usage();
    process.stderr.write("[cclaw] delegation-record: " + problems.join("; ") + "\\n");
  }
  process.exitCode = exitCode;
}

function emitErrorJson(error, details, json) {
  if (json) {
    process.stdout.write(JSON.stringify({ ok: false, error, details }, null, 2) + "\\n");
  } else {
    process.stderr.write("[cclaw] delegation-record: error: " + error + " — " + JSON.stringify(details) + "\\n");
  }
  process.exit(2);
}

// keep in sync with validateMonotonicTimestamps in src/delegation.ts
function validateMonotonicTimestampsInline(stamped, prior) {
  const startTs = stamped.startTs;
  if (stamped.launchedTs && startTs && stamped.launchedTs < startTs) {
    return { field: "launchedTs", actual: stamped.launchedTs, bound: startTs };
  }
  if (stamped.ackTs) {
    const ackBound = stamped.launchedTs || startTs;
    if (ackBound && stamped.ackTs < ackBound) {
      return { field: "ackTs", actual: stamped.ackTs, bound: ackBound };
    }
  }
  if (stamped.completedTs) {
    const completedBound = stamped.ackTs || stamped.launchedTs || startTs;
    if (completedBound && stamped.completedTs < completedBound) {
      return { field: "completedTs", actual: stamped.completedTs, bound: completedBound };
    }
  }
  if (!stamped.spanId) return null;
  const priorForSpan = (prior || []).filter((entry) => entry && entry.spanId === stamped.spanId);
  if (priorForSpan.length === 0) return null;
  const tsValues = priorForSpan
    .map((entry) => entry.ts || entry.startTs || "")
    .filter((ts) => ts.length > 0);
  if (tsValues.length === 0) return null;
  let latest = tsValues[0];
  for (let i = 1; i < tsValues.length; i += 1) {
    if (tsValues[i] > latest) latest = tsValues[i];
  }
  const stampedTs = stamped.ts || stamped.startTs || "";
  if (stampedTs && stampedTs < latest) {
    return { field: "ts", actual: stampedTs, bound: latest };
  }
  return null;
}

function normalizeRelPath(value) {
  return String(value || "").replace(/\\\\/gu, "/").replace(/^\\.\\//u, "");
}

function dispatchSurfaceMatchesPath(surface, agentDefinitionPath) {
  const allowed = SURFACE_PATH_PREFIXES[surface] || [];
  if (allowed.length === 0) return true;
  const normalized = normalizeRelPath(agentDefinitionPath);
  return allowed.some((prefix) => normalized === prefix.replace(/\\/$/u, "") || normalized.startsWith(prefix));
}

async function pathExists(filePath) {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() || stat.isDirectory();
  } catch {
    return false;
  }
}

function normalizeEvidenceRefs(args) {
  if (Array.isArray(args["evidence-refs"])) {
    return args["evidence-refs"]
      .filter((ref) => typeof ref === "string" && ref.trim().length > 0)
      .map((ref) => ref.trim());
  }
  if (typeof args["evidence-ref"] === "string" && args["evidence-ref"].trim().length > 0) {
    return [args["evidence-ref"].trim()];
  }
  return [];
}

function buildRow(args, status, runId, now, options) {
  const fulfillmentMode = args["dispatch-surface"] === "role-switch"
    ? "role-switch"
    : args["dispatch-surface"] === "cursor-task" || args["dispatch-surface"] === "generic-task"
      ? "generic-dispatch"
      : "isolated";
  // Inherit the span's startTs from prior rows so monotonic validation
  // can compare against the original schedule, not the row write time.
  const startTs = (options && options.spanStartTs) || now;
  // v6.10.0 (P1): claimedPaths from --paths=<comma-separated>. Empty
  // arrays are dropped so the row stays compatible with v6.9 readers.
  const claimedPathsRaw = typeof args.paths === "string" ? args.paths : "";
  const claimedPaths = claimedPathsRaw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return {
    stage: args.stage,
    agent: args.agent,
    mode: args.mode,
    status,
    spanId: args["span-id"],
    dispatchId: args["dispatch-id"],
    workerRunId: args["worker-run-id"],
    dispatchSurface: args["dispatch-surface"],
    agentDefinitionPath: args["agent-definition-path"],
    fulfillmentMode,
    waiverReason: args["waiver-reason"],
    evidenceRefs: normalizeEvidenceRefs(args),
    runId,
    startTs,
    ts: now,
    launchedTs: args["launched-ts"] || (status === "launched" ? now : undefined),
    ackTs: args["ack-ts"] || (status === "acknowledged" ? now : undefined),
    completedTs: args["completed-ts"] || (status === "completed" ? now : undefined),
    endTs: TERMINAL.has(status) ? now : undefined,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    allowParallel: args["allow-parallel"] === true ? true : undefined,
    claimedPaths: claimedPaths.length > 0 ? claimedPaths : undefined
  };
}

async function readDelegationLedgerEntries(root) {
  try {
    const raw = await fs.readFile(path.join(root, RUNTIME_ROOT, "state", "delegation-log.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.entries)) return parsed.entries;
  } catch {
    // empty / missing ledger is fine for dedup + monotonicity checks
  }
  return [];
}

// keep in sync with findActiveSpanForPair / DispatchDuplicateError in src/delegation.ts
function findActiveSpanForPairInline(stage, agent, runId, entries) {
  const ACTIVE_STATUSES = new Set(["scheduled", "launched", "acknowledged"]);
  const effectiveTs = (entry) =>
    entry.completedTs || entry.ackTs || entry.launchedTs || entry.endTs || entry.startTs || entry.ts || "";
  const latestBySpan = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.spanId !== "string" || entry.spanId.length === 0) continue;
    // Strict run-scope (v6.9.0 R7 fix): legacy entries without a runId
    // are treated as foreign so they cannot keep an old span "active"
    // across runs and trip dispatch_duplicate on a fresh dispatch.
    if (typeof entry.runId !== "string" || entry.runId.length === 0) continue;
    if (entry.runId !== runId) continue;
    if (entry.stage !== stage || entry.agent !== agent) continue;
    const existing = latestBySpan.get(entry.spanId);
    if (!existing || effectiveTs(entry) >= effectiveTs(existing)) {
      latestBySpan.set(entry.spanId, entry);
    }
  }
  for (const entry of latestBySpan.values()) {
    if (ACTIVE_STATUSES.has(entry.status)) return entry;
  }
  return null;
}

// keep in sync with computeActiveSubagents in src/delegation.ts
function computeActiveSubagentsInline(entries) {
  const ACTIVE_STATUSES = new Set(["scheduled", "launched", "acknowledged"]);
  const effectiveTs = (entry) =>
    entry.completedTs || entry.ackTs || entry.launchedTs || entry.endTs || entry.startTs || entry.ts || "";
  const latestBySpan = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    if (typeof entry.spanId !== "string" || entry.spanId.length === 0) continue;
    const existing = latestBySpan.get(entry.spanId);
    if (!existing || effectiveTs(entry) >= effectiveTs(existing)) {
      latestBySpan.set(entry.spanId, entry);
    }
  }
  const active = [];
  for (const entry of latestBySpan.values()) {
    if (ACTIVE_STATUSES.has(entry.status)) active.push(entry);
  }
  return active;
}

// keep in sync with validateFileOverlap in src/delegation.ts
function validateFileOverlapInline(stamped, activeEntries) {
  if (stamped.agent !== "slice-implementer" || stamped.stage !== "tdd") {
    return { autoParallel: false, conflict: null };
  }
  const newPaths = Array.isArray(stamped.claimedPaths) ? stamped.claimedPaths : [];
  if (newPaths.length === 0) {
    return { autoParallel: false, conflict: null };
  }
  const sameLane = activeEntries.filter(
    (entry) =>
      entry.stage === stamped.stage &&
      entry.agent === stamped.agent &&
      entry.spanId !== stamped.spanId
  );
  if (sameLane.length === 0) {
    return { autoParallel: true, conflict: null };
  }
  for (const existing of sameLane) {
    const existingPaths = Array.isArray(existing.claimedPaths) ? existing.claimedPaths : [];
    if (existingPaths.length === 0) {
      return { autoParallel: false, conflict: null };
    }
    const overlap = newPaths.filter((p) => existingPaths.includes(p));
    if (overlap.length > 0) {
      return {
        autoParallel: false,
        conflict: {
          existingSpanId: existing.spanId || "unknown",
          newSpanId: stamped.spanId || "unknown",
          pair: { stage: stamped.stage, agent: stamped.agent },
          conflictingPaths: overlap
        }
      };
    }
  }
  return { autoParallel: true, conflict: null };
}

const MAX_PARALLEL_SLICE_IMPLEMENTERS_INLINE = 5;

function readMaxParallelOverrideFromEnvInline() {
  const raw = process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

// keep in sync with validateFanOutCap in src/delegation.ts
function validateFanOutCapInline(stamped, activeEntries, override) {
  if (stamped.agent !== "slice-implementer" || stamped.stage !== "tdd") return null;
  if (stamped.status !== "scheduled") return null;
  let cap;
  if (override !== null && override !== undefined && Number.isInteger(override) && override >= 1) {
    cap = override;
  } else {
    cap = readMaxParallelOverrideFromEnvInline() || MAX_PARALLEL_SLICE_IMPLEMENTERS_INLINE;
  }
  const sameLaneActive = activeEntries.filter(
    (entry) =>
      entry.stage === stamped.stage &&
      entry.agent === stamped.agent &&
      entry.spanId !== stamped.spanId
  );
  if (sameLaneActive.length + 1 > cap) {
    return {
      cap,
      active: sameLaneActive.length,
      pair: { stage: stamped.stage, agent: stamped.agent }
    };
  }
  return null;
}

function enforceDispatchDedupInline(stamped, priorEntries, args) {
  if (stamped.status !== "scheduled") return null;
  if (args["allow-parallel"] === true) return null;
  const existing = findActiveSpanForPairInline(
    stamped.stage,
    stamped.agent,
    stamped.runId,
    priorEntries
  );
  if (!existing || existing.spanId === stamped.spanId) return null;
  if (typeof args.supersede === "string" && args.supersede.length > 0) {
    if (args.supersede !== existing.spanId) {
      return {
        kind: "supersede-mismatch",
        details: {
          requested: args.supersede,
          actualActiveSpanId: existing.spanId,
          stage: stamped.stage,
          agent: stamped.agent
        }
      };
    }
    return { kind: "supersede", existing };
  }
  return {
    kind: "error",
    details: {
      existingSpanId: existing.spanId,
      existingStatus: existing.status,
      newSpanId: stamped.spanId,
      pair: { stage: stamped.stage, agent: stamped.agent },
      hint: "pass --supersede=" + existing.spanId + " to close the previous span as stale, or --allow-parallel to record both as concurrent"
    }
  };
}

async function acquireDelegationLogLock(stateDir) {
  const lockDir = path.join(stateDir, "delegation-log.json.lock");
  const maxWaitMs = 3000;
  const startMs = Date.now();
  let delayMs = 25;
  while (true) {
    try {
      await fs.mkdir(lockDir, { recursive: false });
      return lockDir;
    } catch (err) {
      const code = err && typeof err === "object" && "code" in err ? err.code : "";
      if (code !== "EEXIST") throw err;
      if (Date.now() - startMs >= maxWaitMs) {
        process.stderr.write(
          "[cclaw] delegation-record: timeout waiting for delegation-log.json.lock (max " + maxWaitMs + "ms)\\n"
        );
        process.exit(2);
      }
      const jitter = Math.floor(Math.random() * 25);
      await new Promise((resolve) => setTimeout(resolve, delayMs + jitter));
      delayMs = Math.min(delayMs * 2, 200);
    }
  }
}

async function releaseDelegationLogLock(lockDir) {
  try {
    await fs.rm(lockDir, { recursive: true, force: true });
  } catch {
    // best-effort release
  }
}

async function writeDelegationLedgerAtomic(ledgerPath, ledger) {
  const dir = path.dirname(ledgerPath);
  const tmp =
    path.join(dir, ".delegation-log.json." + process.pid + "." + Date.now() + "." + Math.random().toString(16).slice(2) + ".tmp");
  await fs.writeFile(tmp, JSON.stringify(ledger, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
  await fs.rename(tmp, ledgerPath);
}

async function persistEntry(root, runId, clean, event, options = {}) {
  const stateDir = path.join(root, RUNTIME_ROOT, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.appendFile(path.join(stateDir, "delegation-events.jsonl"), JSON.stringify(event) + "\\n", { encoding: "utf8", mode: 0o600 });

  const ledgerPath = path.join(stateDir, "delegation-log.json");
  let ledger = { runId, entries: [], schemaVersion: LEDGER_SCHEMA_VERSION };
  const lockDir = await acquireDelegationLogLock(stateDir);
  try {
    try {
      ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
      if (!Array.isArray(ledger.entries)) ledger.entries = [];
    } catch {
      ledger = { runId, entries: [], schemaVersion: LEDGER_SCHEMA_VERSION };
    }

    // Rerecord semantics: replace any pre-existing row with the same spanId
    // (regardless of its status) so the legacy v1/v2 row is upgraded to v3
    // shape on disk. The append path keeps the historical dedup semantics:
    // an exact (spanId, status) duplicate is dropped to keep retried hooks
    // idempotent.
    if (options.replaceBySpanId) {
      ledger.entries = ledger.entries.filter((entry) => entry.spanId !== clean.spanId);
      ledger.entries.push(clean);
      ledger.runId = runId;
      ledger.schemaVersion = LEDGER_SCHEMA_VERSION;
      await writeDelegationLedgerAtomic(ledgerPath, ledger);
    } else if (!ledger.entries.some((entry) => entry.spanId === clean.spanId && entry.status === clean.status)) {
      ledger.entries.push(clean);
      ledger.runId = runId;
      ledger.schemaVersion = LEDGER_SCHEMA_VERSION;
      await writeDelegationLedgerAtomic(ledgerPath, ledger);
    }
  } finally {
    await releaseDelegationLogLock(lockDir);
  }

  // keep in sync with computeActiveSubagents in src/delegation.ts
  const ACTIVE_STATUSES = new Set(["scheduled", "launched", "acknowledged"]);
  const effectiveTs = (entry) =>
    entry.completedTs || entry.ackTs || entry.launchedTs || entry.endTs || entry.startTs || entry.ts || "";
  const latestBySpan = new Map();
  for (const entry of ledger.entries) {
    if (!entry || typeof entry !== "object" || typeof entry.spanId !== "string" || entry.spanId.length === 0) continue;
    const existing = latestBySpan.get(entry.spanId);
    if (!existing) {
      latestBySpan.set(entry.spanId, entry);
      continue;
    }
    if (effectiveTs(entry) >= effectiveTs(existing)) {
      latestBySpan.set(entry.spanId, entry);
    }
  }
  const active = [];
  for (const entry of latestBySpan.values()) {
    if (ACTIVE_STATUSES.has(entry.status)) active.push(entry);
  }
  active.sort((a, b) => {
    const aKey = a.startTs || a.ts || "";
    const bKey = b.startTs || b.ts || "";
    if (aKey === bKey) return 0;
    return aKey < bKey ? -1 : 1;
  });
  await fs.writeFile(path.join(stateDir, "subagents.json"), JSON.stringify({ active, updatedAt: event.eventTs }, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
}

async function findLegacyEntry(root, spanId) {
  const ledgerPath = path.join(root, RUNTIME_ROOT, "state", "delegation-log.json");
  let ledger;
  try {
    ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
  } catch {
    return null;
  }
  if (!ledger || !Array.isArray(ledger.entries)) return null;
  return ledger.entries.find((entry) => entry && entry.spanId === spanId) || null;
}

async function runRerecord(args, json) {
  const problems = [];
  for (const key of ["span-id", "dispatch-id", "dispatch-surface", "agent-definition-path"]) {
    if (!args[key]) problems.push("missing --" + key);
  }
  if (args["dispatch-surface"] && !VALID_DISPATCH_SURFACES_SET.has(args["dispatch-surface"])) {
    problems.push("invalid --dispatch-surface (allowed: " + VALID_DISPATCH_SURFACES.join(", ") + ")");
  }
  if (problems.length > 0) {
    emitProblems(problems, json, 2);
    return;
  }
  const root = await detectRoot();
  const now = new Date().toISOString();
  const runId = await readRunId(root);
  const legacyEntry = await findLegacyEntry(root, args["span-id"]);
  if (!legacyEntry) {
    emitProblems(["no legacy ledger entry found for --span-id=" + args["span-id"]], json, 1);
    return;
  }
  const explicitEvidenceRef =
    typeof args["evidence-ref"] === "string" && args["evidence-ref"].trim().length > 0
      ? args["evidence-ref"].trim()
      : "";
  const legacyEvidenceRefs = Array.isArray(legacyEntry.evidenceRefs)
    ? legacyEntry.evidenceRefs
      .filter((ref) => typeof ref === "string" && ref.trim().length > 0)
      .map((ref) => ref.trim())
    : [];
  const mergedEvidenceRefs = explicitEvidenceRef.length > 0
    ? [explicitEvidenceRef]
    : legacyEvidenceRefs;
  if (args["dispatch-surface"] !== "role-switch") {
    if (!dispatchSurfaceMatchesPath(args["dispatch-surface"], args["agent-definition-path"])) {
      const allowedPrefixes = SURFACE_PATH_PREFIXES[args["dispatch-surface"]];
      emitProblems([
        "--agent-definition-path does not lie under any allowed prefix for --dispatch-surface=" + args["dispatch-surface"] + " (expected one of: " + (allowedPrefixes.join(", ") || "(any)") + ")"
      ], json, 2);
      return;
    }
    const exists = await pathExists(path.join(root, args["agent-definition-path"]));
    if (!exists) {
      emitProblems(["--agent-definition-path does not exist on disk: " + args["agent-definition-path"]], json, 2);
      return;
    }
  }
  const merged = {
    stage: legacyEntry.stage,
    agent: legacyEntry.agent,
    mode: legacyEntry.mode || "mandatory",
    "span-id": args["span-id"],
    "dispatch-id": args["dispatch-id"],
    "worker-run-id": args["worker-run-id"] || legacyEntry.workerRunId,
    "dispatch-surface": args["dispatch-surface"],
    "agent-definition-path": args["agent-definition-path"],
    "ack-ts": args["ack-ts"] || legacyEntry.ackTs || now,
    "completed-ts": args["completed-ts"] || legacyEntry.completedTs || now,
    "launched-ts": args["launched-ts"] || legacyEntry.launchedTs || now,
    "evidence-ref": explicitEvidenceRef.length > 0 ? explicitEvidenceRef : undefined,
    "evidence-refs": mergedEvidenceRefs
  };
  const status = "completed";
  const clean = Object.fromEntries(Object.entries(buildRow(merged, status, runId, now)).filter(([, value]) => value !== undefined));
  clean.fulfillmentMode = clean.dispatchSurface === "role-switch" ? "role-switch" : (clean.dispatchSurface === "cursor-task" || clean.dispatchSurface === "generic-task" ? "generic-dispatch" : "isolated");
  const event = { ...clean, event: status, eventTs: now, rerecord: true };
  await persistEntry(root, runId, clean, event, { replaceBySpanId: true });
  process.stdout.write(JSON.stringify({ ok: true, event, rerecord: true }, null, 2) + "\\n");
}

const LIFECYCLE_PHASES = ["scheduled", "launched", "acknowledged", "completed"];

function mergeSpanTemplate(spanEvents) {
  const base = {};
  const keys = [
    "stage",
    "agent",
    "mode",
    "runId",
    "dispatchId",
    "dispatchSurface",
    "agentDefinitionPath",
    "workerRunId",
    "fulfillmentMode",
    "schemaVersion",
    "parentSpanId",
    "evidenceRefs",
    "waiverReason"
  ];
  for (const e of spanEvents) {
    if (!e || typeof e !== "object") continue;
    for (const k of keys) {
      if (base[k] === undefined && e[k] !== undefined) {
        base[k] = e[k];
      }
    }
  }
  return base;
}

function repairFulfillmentMode(base) {
  if (base.fulfillmentMode) return base.fulfillmentMode;
  if (base.dispatchSurface === "role-switch") return "role-switch";
  if (base.dispatchSurface === "cursor-task" || base.dispatchSurface === "generic-task") {
    return "generic-dispatch";
  }
  return "isolated";
}

async function runRepair(args, json) {
  const problems = [];
  if (!args["span-id"]) problems.push("repair mode requires --span-id");
  if (!args["repair-reason"] || String(args["repair-reason"]).trim().length === 0) {
    problems.push("repair mode requires --repair-reason=<text>");
  }
  if (problems.length > 0) {
    emitProblems(problems, json, 2);
    return;
  }
  const spanId = args["span-id"];
  const repairedReason = String(args["repair-reason"]).trim();
  const root = await detectRoot();
  const events = await readDelegationEvents(root);
  const spanEvents = events.filter(
    (e) => e && e.spanId === spanId && typeof e.event === "string" && LIFECYCLE_PHASES.includes(e.event)
  );
  if (spanEvents.length === 0) {
    emitProblems(
      ["repair refused: no lifecycle delegation-events.jsonl rows found for --span-id=" + spanId],
      json,
      2
    );
    return;
  }
  const present = new Set(spanEvents.map((e) => e.event));
  const base = mergeSpanTemplate(spanEvents);
  if (!base.stage || !base.agent || !base.mode) {
    emitProblems(["repair refused: span events missing stage/agent/mode to clone"], json, 2);
    return;
  }
  const runId =
    typeof base.runId === "string" && base.runId.length > 0 ? base.runId : await readRunId(root);
  const fulfillmentMode = repairFulfillmentMode(base);
  const schemaVersion =
    typeof base.schemaVersion === "number" && base.schemaVersion > 0
      ? base.schemaVersion
      : LEDGER_SCHEMA_VERSION;
  const evidenceRefs = Array.isArray(base.evidenceRefs)
    ? base.evidenceRefs.filter((r) => typeof r === "string" && r.trim().length > 0)
    : [];
  const now = new Date().toISOString();
  const appended = [];

  for (const status of LIFECYCLE_PHASES) {
    if (present.has(status)) continue;
    if (status === "completed" && base.dispatchSurface !== "role-switch") {
      if (!base.dispatchId || !base.dispatchSurface || !base.agentDefinitionPath) {
        emitProblems(
          [
            "repair refused: cannot synthesize completed row without dispatchId, dispatchSurface, and agentDefinitionPath on span " +
              spanId
          ],
          json,
          2
        );
        return;
      }
    }
    if (status === "completed" && base.dispatchSurface === "role-switch" && evidenceRefs.length === 0) {
      emitProblems(
        ["repair refused: role-switch completed synthesis requires evidenceRefs on span " + spanId],
        json,
        2
      );
      return;
    }
    const launchedTs =
      status === "launched" || status === "acknowledged" || status === "completed" ? now : undefined;
    const ackTs = status === "acknowledged" || status === "completed" ? now : undefined;
    const completedTs = status === "completed" ? now : undefined;
    const endTs = status === "completed" ? now : undefined;
    const row = {
      stage: base.stage,
      agent: base.agent,
      mode: base.mode,
      status,
      spanId,
      dispatchId: base.dispatchId,
      workerRunId: base.workerRunId,
      dispatchSurface: base.dispatchSurface,
      agentDefinitionPath: base.agentDefinitionPath,
      fulfillmentMode,
      evidenceRefs,
      runId,
      startTs: now,
      ts: now,
      launchedTs,
      ackTs,
      completedTs,
      endTs,
      schemaVersion
    };
    const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
    const event = { ...clean, event: status, eventTs: now, repairedAt: now, repairedReason };
    await persistEntry(root, runId, clean, event);
    present.add(status);
    appended.push(status);
  }

  if (json) {
    process.stdout.write(
      JSON.stringify({ ok: true, repair: true, spanId, appended, repairedAt: now, repairedReason }, null, 2) + "\\n"
    );
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = args.json !== undefined;

  const guardRoot = await detectRoot();
  await verifyFlowStateGuardInline(guardRoot);

  if (args.repair) {
    await runRepair(args, json);
    return;
  }

  if (args.rerecord) {
    await runRerecord(args, json);
    return;
  }

  const problems = [];
  if (!args.stage) problems.push("missing --stage");
  if (!args.agent) problems.push("missing --agent");
  if (args.mode !== "mandatory" && args.mode !== "proactive") problems.push("--mode must be mandatory or proactive");
  if (!VALID_STATUSES.has(args.status)) problems.push("invalid --status");
  if (!args["span-id"]) problems.push("missing --span-id");
  if (args.status === "waived" && !args["waiver-reason"]) problems.push("waived status requires --waiver-reason");

  // Strict --dispatch-surface enum validation: any provided surface must be
  // in the canonical allow-list. Do this BEFORE we use the value to gate
  // completed/role-switch fields.
  if (args["dispatch-surface"] !== undefined && !VALID_DISPATCH_SURFACES_SET.has(args["dispatch-surface"])) {
    problems.push("invalid --dispatch-surface (allowed: " + VALID_DISPATCH_SURFACES.join(", ") + ")");
    emitProblems(problems, json, 2);
    return;
  }

  if (args.status === "completed" && args["dispatch-surface"] !== "role-switch") {
    for (const key of ["dispatch-id", "dispatch-surface", "agent-definition-path"]) {
      if (!args[key]) problems.push("completed isolated/generic status requires --" + key);
    }
  }
  if (args.status === "completed" && args["dispatch-surface"] === "role-switch" && !args["evidence-ref"]) {
    problems.push("completed role-switch status requires --evidence-ref");
  }

  // Validate --agent-definition-path against the surface and on-disk
  // existence whenever both are provided.
  if (args["dispatch-surface"] && args["agent-definition-path"] && args["dispatch-surface"] !== "role-switch" && args["dispatch-surface"] !== "manual") {
    if (!dispatchSurfaceMatchesPath(args["dispatch-surface"], args["agent-definition-path"])) {
      const allowedPrefixes = SURFACE_PATH_PREFIXES[args["dispatch-surface"]];
      problems.push("--agent-definition-path does not lie under any allowed prefix for --dispatch-surface=" + args["dispatch-surface"] + " (expected one of: " + (allowedPrefixes.join(", ") || "(any)") + ")");
    }
  }

  if (problems.length > 0) {
    emitProblems(problems, json, 2);
    return;
  }

  const root = await detectRoot();
  const now = new Date().toISOString();
  const runId = await readRunId(root);

  // For completed isolated/generic rows, --agent-definition-path must
  // resolve to an existing file or directory inside the project. This
  // catches typos and stale generated agent paths before they enter the
  // ledger. Skipped for role-switch (no agent file is generated) and
  // manual (intentionally free-form).
  if (
    args.status === "completed" &&
    args["dispatch-surface"] &&
    args["dispatch-surface"] !== "role-switch" &&
    args["dispatch-surface"] !== "manual" &&
    args["agent-definition-path"]
  ) {
    const exists = await pathExists(path.join(root, args["agent-definition-path"]));
    if (!exists) {
      emitProblems(["--agent-definition-path does not exist on disk: " + args["agent-definition-path"]], json, 2);
      return;
    }
  }

  // Completed isolated/generic rows require explicit --ack-ts OR a prior
  // acknowledged event for the same span. fulfillmentMode=isolated cannot
  // be claimed without an ACK timestamp anchor.
  if (args.status === "completed" && args["dispatch-surface"] !== "role-switch" && !args["ack-ts"]) {
    const priorEvents = await readDelegationEvents(root);
    if (!hasPriorAck(priorEvents, args, runId)) {
      const ackProblem = "completed isolated/generic status requires prior acknowledged event for same span or --ack-ts";
      emitProblems([ackProblem], json, 2);
      return;
    }
  }

  const status = args.status;
  const priorLedger = await readDelegationLedgerEntries(root);
  const priorForSpan = priorLedger.filter((e) => e && e.spanId === args["span-id"]);
  const inheritedStartTs = priorForSpan
    .map((e) => e.startTs)
    .filter((ts) => typeof ts === "string" && ts.length > 0)
    .sort()[0];
  // When no prior row exists, fall back to the earliest user-supplied
  // event timestamp so the monotonic validator never sees the row write
  // time overshoot the real event timestamps.
  const lifecycleCandidates = [
    inheritedStartTs,
    args["launched-ts"],
    args["ack-ts"],
    args["completed-ts"],
    now
  ].filter((value) => typeof value === "string" && value.length > 0);
  const spanStartTs = inheritedStartTs ||
    lifecycleCandidates.reduce((min, candidate) => (candidate < min ? candidate : min), now);
  const row = buildRow(args, status, runId, now, { spanStartTs });
  const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const event = { ...clean, event: status, eventTs: now };

  const violation = validateMonotonicTimestampsInline(clean, priorLedger);
  if (violation) {
    emitErrorJson("delegation_timestamp_non_monotonic", violation, json);
    return;
  }

  // v6.10.0 (P1+P2): file-overlap scheduler + fan-out cap. Run before
  // the legacy dispatch dedup so disjoint claimedPaths can auto-promote
  // to allowParallel and bypass the duplicate guard.
  if (status === "scheduled") {
    const sameRunPrior = priorLedger.filter((entry) => entry.runId === runId);
    const activeForRun = computeActiveSubagentsInline(sameRunPrior);
    const overlap = validateFileOverlapInline(clean, activeForRun);
    if (overlap.conflict) {
      emitErrorJson("dispatch_overlap", overlap.conflict, json);
      return;
    }
    if (overlap.autoParallel && clean.allowParallel !== true) {
      clean.allowParallel = true;
      args["allow-parallel"] = true;
      event.allowParallel = true;
    }
    const overrideRaw = typeof args["override-cap"] === "string" ? args["override-cap"] : null;
    const override = overrideRaw !== null ? Number(overrideRaw) : null;
    const capViolation = validateFanOutCapInline(clean, activeForRun, override);
    if (capViolation) {
      emitErrorJson("dispatch_cap", capViolation, json);
      return;
    }
  }
  const dedupViolation = enforceDispatchDedupInline(clean, priorLedger, args);
  if (dedupViolation) {
    if (dedupViolation.kind === "supersede") {
      const stalenessTs = new Date(new Date(now).getTime() - 1).toISOString();
      const staleRow = {
        stage: dedupViolation.existing.stage,
        agent: dedupViolation.existing.agent,
        mode: dedupViolation.existing.mode,
        status: "stale",
        spanId: dedupViolation.existing.spanId,
        runId,
        startTs: dedupViolation.existing.startTs || stalenessTs,
        ts: stalenessTs,
        endTs: stalenessTs,
        supersededBy: clean.spanId,
        schemaVersion: LEDGER_SCHEMA_VERSION
      };
      const staleEvent = { ...staleRow, event: "stale", eventTs: stalenessTs };
      await persistEntry(root, runId, staleRow, staleEvent);
    } else if (dedupViolation.kind === "error") {
      emitErrorJson("dispatch_duplicate", dedupViolation.details, json);
      return;
    } else if (dedupViolation.kind === "supersede-mismatch") {
      emitErrorJson("dispatch_supersede_mismatch", dedupViolation.details, json);
      return;
    }
  }

  await persistEntry(root, runId, clean, event);
  process.stdout.write(JSON.stringify({ ok: true, event }, null, 2) + "\\n");
}

void main();
`;
}

export function runHookCmdScript(): string {
  return `: << 'CMDBLOCK'
@echo off
REM Cross-platform wrapper for cclaw Node hook runtime.
REM Windows executes this batch block; Unix shells treat it as a heredoc comment.
if "%~1"=="" (
  echo [cclaw] run-hook.cmd: missing hook name >&2
  exit /b 1
)
set "HOOK_DIR=%~dp0"
set "RUNTIME=%HOOK_DIR%run-hook.mjs"
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  REM Best-effort: missing node should not block harness execution loops.
  echo [cclaw] run-hook.cmd: node not found; cclaw hook skipped. Run npx cclaw-cli sync. >&2
  exit /b 0
)
node "%RUNTIME%" %*
exit /b %ERRORLEVEL%
CMDBLOCK
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -lt 1 ]; then
  echo "[cclaw] run-hook.cmd: missing hook name" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[cclaw] run-hook.cmd: node not found; cclaw hook skipped. Run npx cclaw-cli sync." >&2
  exit 0
fi
exec node "\${SCRIPT_DIR}/run-hook.mjs" "$@"
`;
}

export { claudeHooksJsonWithObservation as claudeHooksJson } from "./observe.js";
export { cursorHooksJsonWithObservation as cursorHooksJson } from "./observe.js";
export { codexHooksJsonWithObservation as codexHooksJson } from "./observe.js";
export { nodeHookRuntimeScript } from "./node-hooks.js";
export { opencodePluginJs } from "./opencode-plugin.js";
