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
    "Usage: node " + RUNTIME_ROOT + "/hooks/stage-complete.mjs <stage> [--passed=...] [--evidence-json=...] [--waive-delegation=...] [--waiver-reason=...] [--accept-proactive-waiver] [--accept-proactive-waiver-reason=\"<why safe>\"] [--skip-questions] [--json]",
    {
      positionalArgName: "stage",
      positionalArgRequired: true,
      defaultQuietEnvVar: "CCLAW_STAGE_COMPLETE_QUIET"
    }
  );
}

export function delegationRecordScript(): string {
  return `#!/usr/bin/env node
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
    "  node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent> --mode=<mandatory|proactive> --status=<scheduled|launched|acknowledged|completed|failed|waived|stale> --span-id=<id> [--dispatch-id=<id>] [--worker-run-id=<id>] [--dispatch-surface=<surface>] [--agent-definition-path=<path>] [--ack-ts=<iso>] [--launched-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--waiver-reason=<text>] [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --rerecord --span-id=<id> --dispatch-id=<id> --dispatch-surface=<surface> --agent-definition-path=<path> [--ack-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --repair --span-id=<id> --repair-reason=\"<why>\" [--json]",
    "",
    "Allowed --dispatch-surface values:",
    "  " + VALID_DISPATCH_SURFACES.join(", "),
    "",
    "Per-surface allowed --agent-definition-path prefixes:",
    ...VALID_DISPATCH_SURFACES.map((surface) => "  " + surface + ": " + (SURFACE_PATH_PREFIXES[surface].length === 0 ? "(any)" : SURFACE_PATH_PREFIXES[surface].join(", "))),
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

function buildRow(args, status, runId, now) {
  const fulfillmentMode = args["dispatch-surface"] === "role-switch"
    ? "role-switch"
    : args["dispatch-surface"] === "cursor-task" || args["dispatch-surface"] === "generic-task"
      ? "generic-dispatch"
      : "isolated";
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
    startTs: now,
    ts: now,
    launchedTs: args["launched-ts"] || (status === "launched" ? now : undefined),
    ackTs: args["ack-ts"] || (status === "acknowledged" ? now : undefined),
    completedTs: args["completed-ts"] || (status === "completed" ? now : undefined),
    endTs: TERMINAL.has(status) ? now : undefined,
    schemaVersion: LEDGER_SCHEMA_VERSION
  };
}

async function persistEntry(root, runId, clean, event, options = {}) {
  const stateDir = path.join(root, RUNTIME_ROOT, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.appendFile(path.join(stateDir, "delegation-events.jsonl"), JSON.stringify(event) + "\\n", { encoding: "utf8", mode: 0o600 });

  const ledgerPath = path.join(stateDir, "delegation-log.json");
  let ledger = { runId, entries: [], schemaVersion: LEDGER_SCHEMA_VERSION };
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
    await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
  } else if (!ledger.entries.some((entry) => entry.spanId === clean.spanId && entry.status === clean.status)) {
    ledger.entries.push(clean);
    ledger.runId = runId;
    ledger.schemaVersion = LEDGER_SCHEMA_VERSION;
    await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
  }

  const active = ledger.entries.filter((entry) => ["scheduled", "launched", "acknowledged"].includes(entry.status));
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
  const row = buildRow(args, status, runId, now);
  const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const event = { ...clean, event: status, eventTs: now };
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
