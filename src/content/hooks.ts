import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ROOT } from "../constants.js";

function resolveCliEntrypointForGeneratedHook(): string | null {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    path.resolve(path.dirname(here), "..", "cli.js"),
    path.resolve(path.dirname(here), "..", "..", "dist", "cli.js")
  ];
  for (const candidate of candidates) {
    // Synchronous probe runs only during cclaw-cli init/sync generation.
    // The generated hook receives a concrete path and does not need a global bin.
    if (existsSync(candidate)) return candidate;
  }
  return null;
}


function internalHelperScript(helperName: string, internalSubcommand: string, usage: string): string {
  const cliEntrypoint = resolveCliEntrypointForGeneratedHook();
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliEntrypoint)};
const HELPER_NAME = ${JSON.stringify(helperName)};
const INTERNAL_SUBCOMMAND = ${JSON.stringify(internalSubcommand)};
const USAGE = ${JSON.stringify(usage)};

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
  const [, , ...flags] = process.argv;
  if (flags.includes("--help") || flags.includes("-h")) {
    printUsage();
    return;
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
  } catch {
    process.stderr.write(
      "[cclaw] " + HELPER_NAME + ": local Node runtime entrypoint not found at " + cliEntrypoint + ". Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [cliEntrypoint, "internal", INTERNAL_SUBCOMMAND, ...flags], {
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
        "[cclaw] " + HELPER_NAME + ": node executable not found while invoking local runtime. Re-run npx cclaw-cli doctor.\\n"
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
    "Usage: node " + RUNTIME_ROOT + "/hooks/start-flow.mjs --track=<standard|medium|quick> [--class=...] [--prompt=...] [--stack=...] [--reason=...] [--reclassify] [--force-reset]"
  );
}

export function stageCompleteScript(): string {
  const cliEntrypoint = resolveCliEntrypointForGeneratedHook();
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliEntrypoint)};

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
  process.stderr.write(
    "Usage: node " +
      RUNTIME_ROOT +
      "/hooks/stage-complete.mjs <stage> [--passed=...] [--evidence-json=...] [--waive-delegation=...] [--waiver-reason=...] [--json]\\n"
  );
}

async function main() {
  const [, , stage, ...flags] = process.argv;
  if (!stage || stage.trim().length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const root = await detectRoot();
  const runtimePath = path.join(root, RUNTIME_ROOT);
  try {
    const stat = await fs.stat(runtimePath);
    if (!stat.isDirectory()) throw new Error("not-dir");
  } catch {
    process.stderr.write("[cclaw] stage-complete: runtime root not found at " + runtimePath + "\\n");
    process.exitCode = 1;
    return;
  }

  const cliEntrypoint = process.env.CCLAW_CLI_JS || CCLAW_CLI_ENTRYPOINT;
  if (!cliEntrypoint || cliEntrypoint.trim().length === 0) {
    process.stderr.write(
      "[cclaw] stage-complete: local Node runtime entrypoint is missing. Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const stat = await fs.stat(cliEntrypoint);
    if (!stat.isFile()) throw new Error("not-file");
  } catch {
    process.stderr.write(
      "[cclaw] stage-complete: local Node runtime entrypoint not found at " + cliEntrypoint + ". Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(
    process.execPath,
    [cliEntrypoint, "internal", "advance-stage", stage, ...flags],
    {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  }
  );
  let spawnErrored = false;

  child.on("error", (error) => {
    spawnErrored = true;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      process.stderr.write(
        "[cclaw] stage-complete: node executable not found while invoking local runtime. Re-run npx cclaw-cli doctor.\\n"
      );
    } else {
      process.stderr.write(
        "[cclaw] stage-complete: failed to invoke local Node advance-stage runtime (" +
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

export function delegationRecordScript(): string {
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const VALID_STATUSES = new Set(["scheduled", "launched", "acknowledged", "completed", "failed", "waived", "stale"]);
const TERMINAL = new Set(["completed", "failed", "waived", "stale"]);

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
  process.stderr.write("Usage: node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent> --mode=<mandatory|proactive> --status=<scheduled|launched|acknowledged|completed|failed|waived|stale> --span-id=<id> [--dispatch-id=<id>] [--worker-run-id=<id>] [--dispatch-surface=<surface>] [--agent-definition-path=<path>] [--ack-ts=<iso>] [--launched-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--waiver-reason=<text>] [--json]\\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const json = args.json !== undefined;
  const problems = [];
  if (!args.stage) problems.push("missing --stage");
  if (!args.agent) problems.push("missing --agent");
  if (args.mode !== "mandatory" && args.mode !== "proactive") problems.push("--mode must be mandatory or proactive");
  if (!VALID_STATUSES.has(args.status)) problems.push("invalid --status");
  if (!args["span-id"]) problems.push("missing --span-id");
  if (args.status === "waived" && !args["waiver-reason"]) problems.push("waived status requires --waiver-reason");
  if (args.status === "completed" && args["dispatch-surface"] !== "role-switch") {
    for (const key of ["dispatch-id", "dispatch-surface", "agent-definition-path"]) {
      if (!args[key]) problems.push("completed isolated/generic status requires --" + key);
    }
  }
  if (args.status === "completed" && args["dispatch-surface"] === "role-switch" && !args["evidence-ref"]) {
    problems.push("completed role-switch status requires --evidence-ref");
  }
  if (problems.length > 0) {
    if (json) process.stdout.write(JSON.stringify({ ok: false, problems }, null, 2) + "\\n");
    else {
      usage();
      process.stderr.write("[cclaw] delegation-record: " + problems.join("; ") + "\\n");
    }
    process.exitCode = 1;
    return;
  }

  const root = await detectRoot();
  const now = new Date().toISOString();
  const runId = await readRunId(root);
  if (args.status === "completed" && args["dispatch-surface"] !== "role-switch" && !args["ack-ts"]) {
    const priorEvents = await readDelegationEvents(root);
    if (!hasPriorAck(priorEvents, args, runId)) {
      const ackProblem = "completed isolated/generic status requires prior acknowledged event for same span or --ack-ts";
      if (json) process.stdout.write(JSON.stringify({ ok: false, problems: [ackProblem] }, null, 2) + "\\n");
      else {
        usage();
        process.stderr.write("[cclaw] delegation-record: " + ackProblem + "\\n");
      }
      process.exitCode = 1;
      return;
    }
  }
  const status = args.status;
  const row = {
    stage: args.stage,
    agent: args.agent,
    mode: args.mode,
    status,
    spanId: args["span-id"],
    dispatchId: args["dispatch-id"],
    workerRunId: args["worker-run-id"],
    dispatchSurface: args["dispatch-surface"],
    agentDefinitionPath: args["agent-definition-path"],
    fulfillmentMode: args["dispatch-surface"] === "role-switch" ? "role-switch" : args["dispatch-surface"] === "cursor-task" || args["dispatch-surface"] === "generic-task" ? "generic-dispatch" : "isolated",
    waiverReason: args["waiver-reason"],
    evidenceRefs: args["evidence-ref"] ? [args["evidence-ref"]] : [],
    runId,
    startTs: now,
    ts: now,
    launchedTs: args["launched-ts"] || (status === "launched" ? now : undefined),
    ackTs: args["ack-ts"] || (status === "acknowledged" ? now : undefined),
    completedTs: args["completed-ts"] || (status === "completed" ? now : undefined),
    endTs: TERMINAL.has(status) ? now : undefined,
    schemaVersion: 1
  };
  const clean = Object.fromEntries(Object.entries(row).filter(([, value]) => value !== undefined));
  const event = { ...clean, event: status, eventTs: now };
  const stateDir = path.join(root, RUNTIME_ROOT, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.appendFile(path.join(stateDir, "delegation-events.jsonl"), JSON.stringify(event) + "\\n", { encoding: "utf8", mode: 0o600 });

  const ledgerPath = path.join(stateDir, "delegation-log.json");
  let ledger = { runId, entries: [] };
  try {
    ledger = JSON.parse(await fs.readFile(ledgerPath, "utf8"));
    if (!Array.isArray(ledger.entries)) ledger.entries = [];
  } catch {
    ledger = { runId, entries: [] };
  }
  if (!ledger.entries.some((entry) => entry.spanId === clean.spanId && entry.status === clean.status)) {
    ledger.entries.push(clean);
    ledger.runId = runId;
    await fs.writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
  }

  const active = ledger.entries.filter((entry) => ["scheduled", "launched", "acknowledged"].includes(entry.status));
  await fs.writeFile(path.join(stateDir, "subagents.json"), JSON.stringify({ active, updatedAt: now }, null, 2) + "\\n", { encoding: "utf8", mode: 0o600 });
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
  echo [cclaw] run-hook.cmd: node not found; cclaw hook skipped. Run npx cclaw-cli doctor. >&2
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
  echo "[cclaw] run-hook.cmd: node not found; cclaw hook skipped. Run npx cclaw-cli doctor." >&2
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
