import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ROOT } from "../constants.js";
import {
  DELEGATION_DISPATCH_SURFACES,
  DELEGATION_DISPATCH_SURFACE_PATH_PREFIXES,
  DELEGATION_PHASES
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
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const VALID_STATUSES = new Set(["scheduled", "launched", "acknowledged", "completed", "failed", "waived", "stale"]);
const TERMINAL = new Set(["completed", "failed", "waived", "stale"]);
const VALID_DISPATCH_SURFACES = ${JSON.stringify([...DELEGATION_DISPATCH_SURFACES])};
const VALID_DISPATCH_SURFACES_SET = new Set(VALID_DISPATCH_SURFACES);
const SURFACE_PATH_PREFIXES = ${JSON.stringify(DELEGATION_DISPATCH_SURFACE_PATH_PREFIXES)};
const VALID_DELEGATION_PHASES = ${JSON.stringify([...DELEGATION_PHASES])};
const VALID_DELEGATION_PHASES_SET = new Set(VALID_DELEGATION_PHASES);
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

// Read \`tddGreenMinElapsedMs\` from flow-state.json. Defaults to 4000ms
// when missing or invalid. Operators set 0 to disable the freshness floor
// while keeping RED-test-name and passing-assertion checks active.
async function readTddGreenMinElapsedMsInline(root) {
  try {
    const raw = await fs.readFile(path.join(root, RUNTIME_ROOT, "state", "flow-state.json"), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.tddGreenMinElapsedMs === "number" && parsed.tddGreenMinElapsedMs >= 0) {
      return Math.floor(parsed.tddGreenMinElapsedMs);
    }
    return 4000;
  } catch {
    return 4000;
  }
}

// Match the RED test name into the GREEN evidenceRef. Returns the
// basename or stem (without extension) of the most-specific path token
// in the RED row's first evidenceRef. We deliberately use a substring
// match, not equality, so callers can include richer text like
// "REGRESSION: cargo test --test foo => 8 passed; 0 failed".
function extractRedTestNameInline(redEvidenceRef) {
  if (typeof redEvidenceRef !== "string") return null;
  const trimmed = redEvidenceRef.trim();
  if (trimmed.length === 0) return null;
  // Path-shaped token (foo/bar/baz_test.rs or src/foo.test.ts).
  const pathMatch = /[A-Za-z0-9_./-]+/u.exec(trimmed);
  if (pathMatch) {
    const token = pathMatch[0];
    const slashIdx = token.lastIndexOf("/");
    const base = slashIdx >= 0 ? token.slice(slashIdx + 1) : token;
    const dotIdx = base.indexOf(".");
    const stem = dotIdx > 0 ? base.slice(0, dotIdx) : base;
    if (stem.length >= 4) return stem;
    return base;
  }
  return trimmed;
}

// Match canonical runner pass lines using language-agnostic examples:
//   Node/TS   (vitest/jest): "=> N passed; 0 failed" or "Tests: N passed"
//   Python    (pytest): "===== N passed in 0.42s ====="
//   Go        (go test): "ok   pkg   0.123s"
//   Rust      (cargo test): "test result: ok. N passed; 0 failed"
//   Java/JVM  (maven/surefire): "Tests run: N, Failures: 0, Errors: 0"
// We accept a generic "passed/failed" shape plus runner-specific patterns.
const GREEN_PASS_PATTERNS = [
  /=>\\s*\\d+\\s+passed/iu,
  /\\b\\d+\\s+passed[;,]\\s*0\\s+failed\\b/iu,
  /\\btest\\s+result:\\s*ok\\b/iu,
  /\\b\\d+\\s+passed\\s+in\\s+\\d+(?:\\.\\d+)?\\s*s\\b/iu,
  /^ok\\s+\\S+\\s+\\d+(?:\\.\\d+)?s\\b/imu,
  /tests\\s+run\\s*:\\s*\\d+\\s*,\\s*failures\\s*:\\s*0\\s*,\\s*errors\\s*:\\s*0/iu
];

function matchesPassingAssertionInline(value) {
  if (typeof value !== "string") return false;
  return GREEN_PASS_PATTERNS.some((re) => re.test(value));
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

async function appendAuditEventInline(root, payload) {
  const stateDir = path.join(root, RUNTIME_ROOT, "state");
  await fs.mkdir(stateDir, { recursive: true });
  await fs.appendFile(
    path.join(stateDir, "delegation-events.jsonl"),
    JSON.stringify(payload) + "\\n",
    { encoding: "utf8", mode: 0o600 }
  );
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
    "  node .cclaw/hooks/delegation-record.mjs --stage=<stage> --agent=<agent> --mode=<mandatory|proactive> --status=<scheduled|launched|acknowledged|completed|failed|waived|stale> --span-id=<id> [--dispatch-id=<id>] [--worker-run-id=<id>] [--dispatch-surface=<surface>] [--agent-definition-path=<path>] [--ack-ts=<iso>] [--launched-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--waiver-reason=<text>] [--supersede=<prevSpanId>] [--allow-parallel] [--paths=<comma-separated>] [--override-cap=<int>] [--reason=<slug>] [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --rerecord --span-id=<id> --dispatch-id=<id> --dispatch-surface=<surface> --agent-definition-path=<path> [--ack-ts=<iso>] [--completed-ts=<iso>] [--evidence-ref=<ref>] [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --repair --span-id=<id> --repair-reason=\\\"<why>\\\" [--json]",
    "  node .cclaw/hooks/delegation-record.mjs --audit-kind=cclaw_integration_overseer_skipped [--audit-reason=\\\"<comma-separated reasons>\\\"] [--slice-ids=\\\"S-1,S-2\\\"] [--json]    # non-delegation audit row",
    "",
    "Allowed --dispatch-surface values:",
    "  " + VALID_DISPATCH_SURFACES.join(", "),
    "",
    "Per-surface allowed --agent-definition-path prefixes:",
    ...VALID_DISPATCH_SURFACES.map((surface) => "  " + surface + ": " + (SURFACE_PATH_PREFIXES[surface].length === 0 ? "(any)" : SURFACE_PATH_PREFIXES[surface].join(", "))),
    "",
    "Dispatch dedup:",
    "  --supersede=<prevSpanId>  close the previous active span on this (stage, agent) as 'stale' before recording the new scheduled row",
    "  --allow-parallel          record both spans as concurrent; new row is tagged allowParallel: true",
    "",
    "TDD parallel scheduler:",
    "  --paths=<a,b,c>           repo-relative paths the slice-builder will edit; disjoint sets auto-promote to allowParallel, overlap throws DispatchOverlapError",
    "  --override-cap=<int>      raise the slice worker fan-out cap once for this dispatch (default cap " + String(5) + ", env CCLAW_MAX_PARALLEL_SLICE_BUILDERS overrides globally)",
    "  --reason=<slug>           required with --override-cap so cap bypasses are auditable (e.g. red-checkpoint-retry)",
    "",
    "TDD slice phase tagging:",
    "  --slice=<id>              TDD slice identifier (e.g. S-1) used by the linter to auto-derive the Watched-RED + Vertical Slice Cycle tables.",
    "  --phase=<phase>           one of " + VALID_DELEGATION_PHASES.join(", ") + ". Pair with --slice to record a TDD slice phase event.",
    "  --refactor-rationale=<t>  required for deferred refactor paths; must be >=80 chars and mention slice + task context (e.g. S-12 / T-103).",
    "  --refactor-outcome=<m>   one of inline|deferred. Folds REFACTOR into the phase=green event so a single row can close RED→GREEN→REFACTOR. Pair --refactor-outcome=deferred with --refactor-rationale.",
    "  --risk-tier=<t>          one of low|medium|high. high triggers integration-overseer in conditional mode.",
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

function validateDeferredRationaleInline(rationaleRaw, args) {
  const rationale = typeof rationaleRaw === "string" ? rationaleRaw.trim() : "";
  if (rationale.length === 0) {
    return "missing";
  }
  if (rationale.length < 80) {
    return "too-short";
  }
  const lower = rationale.toLowerCase();
  const sliceRaw = typeof args.slice === "string" ? args.slice.trim().toLowerCase() : "";
  const hasSliceMention =
    (sliceRaw.length > 0 && lower.includes(sliceRaw)) ||
    /\\bs-\\d+\\b/iu.test(rationale);
  const hasTaskMention =
    /\\bt-\\d{3}[a-z]?(?:\\.\\d{1,3})?\\b/iu.test(rationale) ||
    /\\btask\\b/iu.test(rationale);
  if (!hasSliceMention || !hasTaskMention) {
    return "missing-context";
  }
  return "ok";
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
  // claimedPaths from --paths=<comma-separated>. Empty arrays are dropped.
  const claimedPathsRaw = typeof args.paths === "string" ? args.paths : "";
  const claimedPaths = claimedPathsRaw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  // TDD slice tagging via --slice / --phase. Phase must be one of the
  // canonical enum values; the inline validator rejects unknown phases
  // before the row hits the ledger.
  const sliceId =
    typeof args.slice === "string" && args.slice.trim().length > 0
      ? args.slice.trim()
      : undefined;
  const phase =
    typeof args.phase === "string" && args.phase.trim().length > 0
      ? args.phase.trim()
      : undefined;
  // When --refactor-rationale is supplied it is folded into
  // evidenceRefs[0] so the linter (which reads evidenceRefs only) can
  // surface the rationale without touching new fields. The user may
  // also pass --evidence-ref containing the rationale text.
  let resolvedEvidenceRefs = normalizeEvidenceRefs(args);
  if (
    phase === "refactor-deferred" &&
    typeof args["refactor-rationale"] === "string" &&
    args["refactor-rationale"].trim().length > 0
  ) {
    const rationale = args["refactor-rationale"].trim();
    if (!resolvedEvidenceRefs.includes(rationale)) {
      resolvedEvidenceRefs = [rationale, ...resolvedEvidenceRefs];
    }
  }
  // refactorOutcome folds REFACTOR into a phase=green event. We also
  // accept it on phase=refactor / phase=refactor-deferred for controllers
  // that emit it on the per-phase lifecycle. When mode=deferred and a
  // --refactor-rationale is supplied we mirror the rationale into
  // evidenceRefs[0] so the linter keeps reading evidence (matches the
  // refactor-deferred behavior).
  const refactorOutcomeMode =
    typeof args["refactor-outcome"] === "string"
      ? args["refactor-outcome"].trim()
      : "";
  let refactorOutcome;
  if (refactorOutcomeMode === "inline" || refactorOutcomeMode === "deferred") {
    const rationaleRaw =
      typeof args["refactor-rationale"] === "string"
        ? args["refactor-rationale"].trim()
        : "";
    refactorOutcome = {
      mode: refactorOutcomeMode,
      ...(rationaleRaw.length > 0 ? { rationale: rationaleRaw } : {})
    };
    if (
      refactorOutcomeMode === "deferred" &&
      rationaleRaw.length > 0 &&
      !resolvedEvidenceRefs.includes(rationaleRaw)
    ) {
      resolvedEvidenceRefs = [rationaleRaw, ...resolvedEvidenceRefs];
    }
  }
  const riskTierRaw =
    typeof args["risk-tier"] === "string" ? args["risk-tier"].trim() : "";
  const riskTier =
    riskTierRaw === "low" || riskTierRaw === "medium" || riskTierRaw === "high"
      ? riskTierRaw
      : undefined;
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
    evidenceRefs: resolvedEvidenceRefs,
    runId,
    startTs,
    ts: now,
    launchedTs: args["launched-ts"] || (status === "launched" ? now : undefined),
    ackTs: args["ack-ts"] || (status === "acknowledged" ? now : undefined),
    completedTs: args["completed-ts"] || (status === "completed" ? now : undefined),
    endTs: TERMINAL.has(status) ? now : undefined,
    schemaVersion: LEDGER_SCHEMA_VERSION,
    allowParallel: args["allow-parallel"] === true ? true : undefined,
    claimedPaths: claimedPaths.length > 0 ? claimedPaths : undefined,
    sliceId,
    phase,
    refactorOutcome,
    riskTier
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
    // Strict run-scope: entries without a runId are treated as foreign so
    // they cannot keep an old span "active" across runs and trip
    // dispatch_duplicate on a fresh dispatch.
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
  if (stamped.agent !== "slice-builder" || stamped.stage !== "tdd") {
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

const MAX_PARALLEL_SLICE_BUILDERS_INLINE = 5;

function readMaxParallelOverrideFromEnvInline() {
  const raw = process.env.CCLAW_MAX_PARALLEL_SLICE_BUILDERS;
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 1) return null;
  return parsed;
}

// keep in sync with validateFanOutCap in src/delegation.ts
function validateFanOutCapInline(stamped, activeEntries, override) {
  if (stamped.agent !== "slice-builder" || stamped.stage !== "tdd") return null;
  if (stamped.status !== "scheduled") return null;
  let cap;
  if (override !== null && override !== undefined && Number.isInteger(override) && override >= 1) {
    cap = override;
  } else {
    cap = readMaxParallelOverrideFromEnvInline() || MAX_PARALLEL_SLICE_BUILDERS_INLINE;
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
    // an exact (spanId, status, phase) triple is dropped to keep retried hooks
    // idempotent. Including \`phase\` in the dedup key is required because a
    // single TDD slice-builder span legitimately emits FOUR rows with
    // status=completed (one each for phase=red|green|refactor|doc); a
    // dedup on (spanId, status) alone would silently drop GREEN/REFACTOR/DOC
    // and leave the linter reporting tdd_slice_green_missing for slices
    // whose work actually landed.
    if (options.replaceBySpanId) {
      ledger.entries = ledger.entries.filter((entry) => entry.spanId !== clean.spanId);
      ledger.entries.push(clean);
      ledger.runId = runId;
      ledger.schemaVersion = LEDGER_SCHEMA_VERSION;
      await writeDelegationLedgerAtomic(ledgerPath, ledger);
    } else if (!ledger.entries.some((entry) =>
      entry.spanId === clean.spanId &&
      entry.status === clean.status &&
      (entry.phase ?? null) === (clean.phase ?? null)
    )) {
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

// Allow-list of non-delegation audit events the controller can emit via
// the helper. Keep in sync with NON_DELEGATION_AUDIT_EVENTS in
// src/delegation.ts.
const VALID_AUDIT_KINDS = new Set([
  "cclaw_integration_overseer_skipped",
  "cclaw_allow_parallel_auto_flip"
]);

async function runAuditEmit(args, json) {
  const kind = String(args["audit-kind"]).trim();
  if (!VALID_AUDIT_KINDS.has(kind)) {
    emitProblems([
      "invalid --audit-kind: " + kind +
        " (allowed: " + [...VALID_AUDIT_KINDS].join(", ") + ")"
    ], json, 2);
    return;
  }
  const root = await detectRoot();
  const runId = await readRunId(root);
  const reason = typeof args["audit-reason"] === "string"
    ? args["audit-reason"].trim()
    : "";
  const sliceIdsRaw = typeof args["slice-ids"] === "string"
    ? args["slice-ids"].trim()
    : "";
  const sliceIds = sliceIdsRaw.length > 0
    ? sliceIdsRaw
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
    : [];
  const ts = new Date().toISOString();
  const payload = {
    event: kind,
    runId,
    ts,
    eventTs: ts,
    ...(reason.length > 0 ? { reasons: reason.split(",").map((r) => r.trim()).filter((r) => r.length > 0) } : {}),
    ...(sliceIds.length > 0 ? { sliceIds } : {})
  };
  const stateDir = path.join(root, RUNTIME_ROOT, "state");
  try {
    await fs.mkdir(stateDir, { recursive: true });
    await fs.appendFile(
      path.join(stateDir, "delegation-events.jsonl"),
      JSON.stringify(payload) + "\\n",
      { encoding: "utf8", mode: 0o600 }
    );
  } catch (error) {
    const message = error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
    emitErrorJson("audit_emit_failed", { kind, message }, json);
    return;
  }
  if (json) {
    process.stdout.write(JSON.stringify({
      ok: true,
      command: "audit-emit",
      auditKind: kind,
      runId,
      sliceIds,
      ts
    }, null, 2) + "\\n");
  } else {
    process.stdout.write("[cclaw] audit emitted: " + kind + " (run=" + runId + ", ts=" + ts + ")\\n");
  }
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

async function runSliceCommitIfNeeded(root, row, runId) {
  if (
    row.stage !== "tdd" ||
    row.agent !== "slice-builder" ||
    row.status !== "completed" ||
    row.phase !== "doc"
  ) {
    return { ok: true, skipped: true };
  }
  const sliceId = typeof row.sliceId === "string" ? row.sliceId.trim() : "";
  const spanId = typeof row.spanId === "string" ? row.spanId.trim() : "";
  if (sliceId.length === 0 || spanId.length === 0) {
    return { ok: true, skipped: true };
  }
  const helperPath = path.join(root, RUNTIME_ROOT, "hooks", "slice-commit.mjs");
  if (!(await exists(helperPath))) {
    return { ok: true, skipped: true };
  }
  const helperArgs = [
    helperPath,
    "--json",
    "--quiet",
    "--slice=" + sliceId,
    "--span-id=" + spanId,
    "--run-id=" + runId
  ];
  if (typeof row.taskId === "string" && row.taskId.trim().length > 0) {
    helperArgs.push("--task-id=" + row.taskId.trim());
  }
  if (Array.isArray(row.claimedPaths) && row.claimedPaths.length > 0) {
    helperArgs.push("--claimed-paths=" + row.claimedPaths.join(","));
  }
  if (Array.isArray(row.evidenceRefs) && row.evidenceRefs.length > 0) {
    const title = String(row.evidenceRefs[0] || "").trim();
    if (title.length > 0) {
      helperArgs.push("--title=" + title.slice(0, 120));
    }
  }

  return await new Promise((resolve) => {
    const child = spawn(process.execPath, helperArgs, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => {
      out += String(chunk ?? "");
    });
    child.stderr.on("data", (chunk) => {
      err += String(chunk ?? "");
    });
    child.on("error", (error) => {
      resolve({
        ok: false,
        errorCode: "slice_commit_failed",
        details: {
          message: error instanceof Error ? error.message : String(error)
        }
      });
    });
    child.on("close", (code) => {
      let payload = null;
      const trimmed = out.trim();
      if (trimmed.length > 0) {
        try {
          payload = JSON.parse(trimmed);
        } catch {
          payload = null;
        }
      }
      if (code === 0) {
        resolve({ ok: true, payload });
        return;
      }
      const payloadCode =
        payload && typeof payload === "object" && typeof payload.errorCode === "string"
          ? payload.errorCode
          : "slice_commit_failed";
      resolve({
        ok: false,
        errorCode: payloadCode,
        details:
          payload && typeof payload === "object"
            ? payload
            : {
              stderr: err.trim(),
              stdout: out.trim()
            }
      });
    });
  });
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

  // Audit-only emit path. When the controller wants to record a
  // non-delegation audit row (e.g. \`cclaw_integration_overseer_skipped\`
  // when the wave heuristic chose to skip the overseer dispatch), pass
  // --audit-kind=<event-name> [--audit-reason=<text>] [--slice-ids=<csv>]
  // and the helper appends a single line to delegation-events.jsonl
  // without touching the lifecycle ledger. The kind must be in the
  // canonical allow-list so a typo cannot inject an unrecognized event.
  if (typeof args["audit-kind"] === "string" && args["audit-kind"].trim().length > 0) {
    await runAuditEmit(args, json);
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

  // TDD slice phase tagging validation. --phase is strictly enum-bound;
  // --slice must be a non-empty string when provided;
  // --phase=refactor-deferred requires either an explicit
  // --refactor-rationale or an --evidence-ref with rationale text so the
  // linter has something to render.
  if (args.phase !== undefined && !VALID_DELEGATION_PHASES_SET.has(args.phase)) {
    problems.push("invalid --phase (allowed: " + VALID_DELEGATION_PHASES.join(", ") + ")");
    emitProblems(problems, json, 2);
    return;
  }
  if (args.slice !== undefined && (typeof args.slice !== "string" || args.slice.trim().length === 0)) {
    problems.push("--slice requires a non-empty value");
    emitProblems(problems, json, 2);
    return;
  }
  if (args.phase === "refactor-deferred") {
    const rationaleQuality = validateDeferredRationaleInline(args["refactor-rationale"], args);
    if (rationaleQuality !== "ok") {
      if (rationaleQuality === "missing") {
        problems.push("--phase=refactor-deferred requires --refactor-rationale=<text>");
      } else if (rationaleQuality === "too-short") {
        problems.push("--refactor-rationale for deferred refactor must be at least 80 characters");
      } else {
        problems.push("--refactor-rationale for deferred refactor must mention slice/task context (e.g. S-12 and T-103)");
      }
      emitProblems(problems, json, 2);
      return;
    }
  }

  // --refactor-outcome must be one of inline|deferred. When mode=deferred
  // a rationale is required (either --refactor-rationale or --evidence-ref
  // carrying the rationale text). --risk-tier must be one of low|medium|high
  // if provided.
  if (
    args["refactor-outcome"] !== undefined &&
    args["refactor-outcome"] !== "inline" &&
    args["refactor-outcome"] !== "deferred"
  ) {
    problems.push("invalid --refactor-outcome (allowed: inline, deferred)");
    emitProblems(problems, json, 2);
    return;
  }
  if (args["refactor-outcome"] === "deferred") {
    const rationaleQuality = validateDeferredRationaleInline(args["refactor-rationale"], args);
    if (rationaleQuality !== "ok") {
      if (rationaleQuality === "missing") {
        problems.push("--refactor-outcome=deferred requires --refactor-rationale=<text>");
      } else if (rationaleQuality === "too-short") {
        problems.push("--refactor-rationale for deferred refactor must be at least 80 characters");
      } else {
        problems.push("--refactor-rationale for deferred refactor must mention slice/task context (e.g. S-12 and T-103)");
      }
      emitProblems(problems, json, 2);
      return;
    }
  }
  if (
    args["risk-tier"] !== undefined &&
    args["risk-tier"] !== "low" &&
    args["risk-tier"] !== "medium" &&
    args["risk-tier"] !== "high"
  ) {
    problems.push("invalid --risk-tier (allowed: low, medium, high)");
    emitProblems(problems, json, 2);
    return;
  }
  if (args["override-cap"] !== undefined) {
    const overrideRaw = String(args["override-cap"]).trim();
    const overrideNum = Number(overrideRaw);
    if (!Number.isInteger(overrideNum) || overrideNum < 1) {
      problems.push("--override-cap must be an integer >= 1");
      emitProblems(problems, json, 2);
      return;
    }
    const reasonRaw = typeof args.reason === "string" ? args.reason.trim() : "";
    if (reasonRaw.length === 0) {
      problems.push("--override-cap requires --reason=<slug>");
      emitProblems(problems, json, 2);
      return;
    }
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
  let autoParallelAuditEvent = null;

  const violation = validateMonotonicTimestampsInline(clean, priorLedger);
  if (violation) {
    emitErrorJson("delegation_timestamp_non_monotonic", violation, json);
    return;
  }

  // File-overlap scheduler + fan-out cap. Run before the dispatch
  // dedup so disjoint claimedPaths can auto-promote to allowParallel,
  // emit an audit event for the flip, and bypass the duplicate guard.
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
      autoParallelAuditEvent = {
        event: "cclaw_allow_parallel_auto_flip",
        runId,
        ts: now,
        eventTs: now,
        stage: clean.stage,
        agent: clean.agent,
        spanId: clean.spanId,
        sliceId: clean.sliceId,
        reason: "disjoint-claimed-paths-auto-flip",
        claimedPaths: Array.isArray(clean.claimedPaths) ? clean.claimedPaths : []
      };
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

  // GREEN evidence freshness contract for \`slice-builder --phase green
  // --status=completed\`. Three checks:
  //   1. green_evidence_red_test_mismatch — evidenceRefs[0] must contain
  //      the basename/stem of the RED span's first evidenceRef.
  //   2. green_evidence_passing_assertion_missing — evidenceRefs[0]
  //      must carry a recognized passing-assertion line ("=> N passed;
  //      0 failed" or runner-specific equivalents).
  //   3. green_evidence_too_fresh — completedTs minus ackTs must be
  //      >= flow-state.json::tddGreenMinElapsedMs (default 4000ms).
  // Escape hatch for legitimate observational GREENs (cross-slice
  // handoff, no-op verification): --green-mode=observational.
  if (
    clean.stage === "tdd" &&
    clean.agent === "slice-builder" &&
    clean.phase === "green" &&
    clean.status === "completed"
  ) {
    const isObservational =
      typeof args["green-mode"] === "string" &&
      args["green-mode"].trim().toLowerCase() === "observational";
    const greenEvidenceFirst =
      Array.isArray(clean.evidenceRefs) && clean.evidenceRefs.length > 0
        ? String(clean.evidenceRefs[0])
        : "";

    // Locate the matching RED row's first evidenceRef in the events log.
    const priorEvents = await readDelegationEvents(root);
    let redEvidenceRef = null;
    for (let i = priorEvents.length - 1; i >= 0; i -= 1) {
      const ev = priorEvents[i];
      if (!ev) continue;
      if (ev.runId !== runId) continue;
      if (ev.stage !== "tdd") continue;
      if (ev.sliceId !== clean.sliceId) continue;
      if (ev.phase !== "red") continue;
      if (Array.isArray(ev.evidenceRefs) && ev.evidenceRefs.length > 0) {
        redEvidenceRef = String(ev.evidenceRefs[0] || "");
        break;
      }
    }

    // The freshness contract only fires when there's a matching RED row
    // for this slice in the active run. Without RED context we have
    // nothing to verify GREEN against (legacy ledger imports, RED
    // happened outside cclaw harness, or test fixtures that bypass
    // RED). Once a RED row is present, the contract becomes
    // mandatory unless explicitly waived via --green-mode=observational.
    const hasRedContext = redEvidenceRef !== null;
    const escapeFastGreen = isObservational;

    if (hasRedContext && !escapeFastGreen) {
      // Check 1: RED test name match.
      const stem = extractRedTestNameInline(redEvidenceRef);
      if (stem && greenEvidenceFirst.length > 0 && !greenEvidenceFirst.toLowerCase().includes(stem.toLowerCase())) {
        emitErrorJson(
          "green_evidence_red_test_mismatch",
          {
            sliceId: clean.sliceId,
            redEvidenceFirst: redEvidenceRef,
            greenEvidenceFirst,
            expectedSubstring: stem,
            remediation:
              "evidenceRefs[0] on the GREEN row must reference the same test the RED row cited. Re-run the matching RED test, capture its passing output, and pass it as --evidence-ref."
          },
          json
        );
        return;
      }

      // Check 2: passing-assertion line.
      if (greenEvidenceFirst.length > 0 && !matchesPassingAssertionInline(greenEvidenceFirst)) {
        emitErrorJson(
          "green_evidence_passing_assertion_missing",
          {
            sliceId: clean.sliceId,
            greenEvidenceFirst,
            remediation:
              "evidenceRefs[0] on the GREEN row must contain a passing-assertion line (language-agnostic examples: Node/Vitest \\"=> N passed; 0 failed\\", Python/Pytest \\"N passed in 0.42s\\", Go \\"ok pkg 0.12s\\", Rust \\"test result: ok\\", Java/Maven \\"Tests run: N, Failures: 0, Errors: 0\\"). Re-run the test and paste a fresh runner line."
          },
          json
        );
        return;
      }

      // Check 3: fast-green floor. ackTs is required upstream; we use
      // the persisted ackTs from prior events when not provided on this
      // row.
      const minMs = await readTddGreenMinElapsedMsInline(root);
      if (minMs > 0 && clean.completedTs) {
        let ackTs = clean.ackTs;
        if (!ackTs) {
          for (let i = priorEvents.length - 1; i >= 0; i -= 1) {
            const ev = priorEvents[i];
            if (!ev) continue;
            if (ev.spanId !== clean.spanId) continue;
            if (typeof ev.ackTs === "string" && ev.ackTs.length > 0) {
              ackTs = ev.ackTs;
              break;
            }
          }
        }
        if (ackTs) {
          const completedMs = Date.parse(clean.completedTs);
          const ackMs = Date.parse(ackTs);
          if (Number.isFinite(completedMs) && Number.isFinite(ackMs)) {
            const elapsed = completedMs - ackMs;
            if (elapsed < minMs) {
              emitErrorJson(
                "green_evidence_too_fresh",
                {
                  sliceId: clean.sliceId,
                  ackTs,
                  completedTs: clean.completedTs,
                  elapsedMs: elapsed,
                  minMs,
                  remediation:
                    "GREEN completedTs - ackTs is below the freshness floor. Either run the verification test for real and re-record, or pass --green-mode=observational for legitimate no-op verification spans."
                },
                json
              );
              return;
            }
          }
        }
      }
    }
  }

  const sliceCommitResult = await runSliceCommitIfNeeded(root, clean, runId);
  if (!sliceCommitResult.ok) {
    emitErrorJson(
      sliceCommitResult.errorCode || "slice_commit_failed",
      sliceCommitResult.details || {},
      json
    );
    return;
  }
  if (
    sliceCommitResult.payload &&
    typeof sliceCommitResult.payload === "object" &&
    typeof sliceCommitResult.payload.commitSha === "string"
  ) {
    event.sliceCommitSha = sliceCommitResult.payload.commitSha;
  }

  await persistEntry(root, runId, clean, event);
  if (autoParallelAuditEvent) {
    await appendAuditEventInline(root, autoParallelAuditEvent);
  }

  process.stdout.write(JSON.stringify({ ok: true, event }, null, 2) + "\\n");
}

void main();
`;
}

export function sliceCommitScript(): string {
  return internalHelperScript(
    "slice-commit",
    "slice-commit",
    "Usage: node " + RUNTIME_ROOT + "/hooks/slice-commit.mjs --slice=<S-N> --span-id=<span-id> [--task-id=<T-id>] [--title=<text>] [--run-id=<run-id>] [--claimed-paths=<path1,path2,...>] [--claimed-path=<path> ...] [--json] [--quiet]"
  );
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
