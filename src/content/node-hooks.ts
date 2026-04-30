import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_COMPOUND_RECURRENCE_THRESHOLD,
  DEFAULT_EARLY_LOOP_MAX_ITERATIONS
} from "../config.js";
import { RUNTIME_ROOT } from "../constants.js";
import {
  SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD,
  SMALL_PROJECT_RECURRENCE_THRESHOLD
} from "../knowledge-store.js";
import {
  SHARED_FLOW_AND_KNOWLEDGE_SNIPPETS,
  SHARED_STAGE_SUPPORT_SNIPPETS
} from "./runtime-shared-snippets.js";

export interface NodeHookRuntimeOptions {
  /**
   * Single enforcement knob derived from `config.strictness`. Generated hooks
   * embed this value as the default for every guard (prompt, workflow, TDD,
   * iron-laws-coupled blocks). `CCLAW_STRICTNESS` env var overrides at run
   * time; per-law strictness still flows through `iron-laws.json`.
   */
  strictness?: "advisory" | "strict";
  tddTestPathPatterns?: string[];
  tddProductionPathPatterns?: string[];
  /**
   * Baked-in default recurrence threshold for compound-readiness computed
   * by the session-start hook. Derived from
   * `config.compound.recurrenceThreshold` at install time; re-run
   * `cclaw sync` after changing the config value so hook and CLI agree.
   */
  compoundRecurrenceThreshold?: number;
  /**
   * Enables early-stage producer/critic loop diagnostics in session-start.
   * Defaults to true.
   */
  earlyLoopEnabled?: boolean;
  /**
   * Baked-in max iterations for brainstorm/scope/design early-loop status.
   * Derived from `config.earlyLoop.maxIterations`.
   */
  earlyLoopMaxIterations?: number;
}

function normalizePatterns(patterns: string[] | undefined, fallback: string[]): string[] {
  if (!patterns || patterns.length === 0) return [...fallback];
  return patterns.map((value) => value.trim()).filter((value) => value.length > 0);
}

interface GeneratedCliRuntime {
  entrypoint: string | null;
  argsPrefix: string[];
}

function resolveCliRuntimeForGeneratedHook(): GeneratedCliRuntime {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    path.resolve(path.dirname(here), "..", "cli.js"),
    path.resolve(path.dirname(here), "..", "..", "dist", "cli.js")
  ];
  for (const candidate of candidates) {
    // Synchronous probe runs only during cclaw-cli init/sync generation.
    if (existsSync(candidate)) return { entrypoint: candidate, argsPrefix: [] };
  }

  // Vitest exercises init/sync directly from src/ without a compiled dist/.
  // Route that dev-only shape through vite-node so hooks still prove a local runtime.
  if (process.env.VITEST === "true") {
    const sourceCli = path.resolve(path.dirname(here), "..", "cli.ts");
    const viteNode = path.resolve(path.dirname(here), "..", "..", "node_modules", "vite-node", "vite-node.mjs");
    if (existsSync(sourceCli) && existsSync(viteNode)) {
      return { entrypoint: viteNode, argsPrefix: ["--script", sourceCli] };
    }
  }

  return { entrypoint: null, argsPrefix: [] };
}

/**
 * Node-only hook runtime (single entrypoint).
 *
 * Generated into `.cclaw/hooks/run-hook.mjs` and used by all harnesses to avoid
 * bash/python/jq runtime dependencies.
 */
export function nodeHookRuntimeScript(options: NodeHookRuntimeOptions = {}): string {
  const strictness = options.strictness === "strict" ? "strict" : "advisory";
  const tddTestPathPatterns = normalizePatterns(options.tddTestPathPatterns, [
    "**/*.test.*",
    "**/tests/**",
    "**/__tests__/**"
  ]);
  const tddProductionPathPatterns = normalizePatterns(options.tddProductionPathPatterns, []);
  const compoundRecurrenceThreshold =
    typeof options.compoundRecurrenceThreshold === "number" &&
    Number.isInteger(options.compoundRecurrenceThreshold) &&
    options.compoundRecurrenceThreshold >= 1
      ? options.compoundRecurrenceThreshold
      : DEFAULT_COMPOUND_RECURRENCE_THRESHOLD;
  const earlyLoopEnabled = options.earlyLoopEnabled !== false;
  const earlyLoopMaxIterations =
    typeof options.earlyLoopMaxIterations === "number" &&
    Number.isInteger(options.earlyLoopMaxIterations) &&
    options.earlyLoopMaxIterations >= 1
      ? options.earlyLoopMaxIterations
      : DEFAULT_EARLY_LOOP_MAX_ITERATIONS;
  const cliRuntime = resolveCliRuntimeForGeneratedHook();

  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
// Single strictness default, derived from config.strictness at install time.
// \`CCLAW_STRICTNESS\` env var overrides for the current process. All guards
// (prompt, workflow, TDD, iron-laws) route through \`resolveStrictness()\`.
const DEFAULT_STRICTNESS = ${JSON.stringify(strictness)};
const DEFAULT_TDD_TEST_PATH_PATTERNS = ${JSON.stringify(tddTestPathPatterns)};
const DEFAULT_TDD_PRODUCTION_PATH_PATTERNS = ${JSON.stringify(tddProductionPathPatterns)};
// Compound-readiness recurrence threshold. Baked from
// \`config.compound.recurrenceThreshold\` at install time so the hook and
// \`cclaw internal compound-readiness\` agree on the same number. The
// small-project relaxation rule (<${SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD} archived runs
// -> min(base, ${SMALL_PROJECT_RECURRENCE_THRESHOLD})) is applied at runtime.
const COMPOUND_RECURRENCE_THRESHOLD = ${JSON.stringify(compoundRecurrenceThreshold)};
const SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD = ${JSON.stringify(SMALL_PROJECT_ARCHIVE_RUNS_THRESHOLD)};
const SMALL_PROJECT_RECURRENCE_THRESHOLD = ${JSON.stringify(SMALL_PROJECT_RECURRENCE_THRESHOLD)};
const EARLY_LOOP_ENABLED = ${JSON.stringify(earlyLoopEnabled)};
const EARLY_LOOP_MAX_ITERATIONS = ${JSON.stringify(earlyLoopMaxIterations)};
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliRuntime.entrypoint)};
const CCLAW_CLI_ARGS_PREFIX = ${JSON.stringify(cliRuntime.argsPrefix)};
const SESSION_DIGEST_SCHEMA_VERSION = 1;
const SESSION_DIGEST_CACHE_FILE = "session-digest.json";
const SESSION_DIGEST_REFRESH_MARKER_FILE = "session-digest.refresh.json";
const SESSION_DIGEST_REFRESH_STALE_MS = 30000;

${SHARED_FLOW_AND_KNOWLEDGE_SNIPPETS}
${SHARED_STAGE_SUPPORT_SNIPPETS}

function resolveStrictness() {
  return process.env.CCLAW_STRICTNESS === "strict" ? "strict" : DEFAULT_STRICTNESS;
}

function toObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

function safeParseJson(raw, fallback = {}) {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return fallback;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed === undefined ? fallback : parsed;
  } catch {
    return fallback;
  }
}

// === atomic/locked state I/O =========================================
//
// The generated hook script runs OUTSIDE the cclaw CLI process, so it
// cannot import \`fs-utils.ts\`. These helpers mirror \`writeFileSafe\` and
// \`withDirectoryLock\` just enough to keep hook-owned state files
// atomic and free of interleaved concurrent writes.

function hookSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDirectoryLockInline(lockPath, fn, options = {}) {
  const retries = Number.isFinite(options.retries) ? options.retries : 200;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 20;
  const staleAfterMs = Number.isFinite(options.staleAfterMs) ? options.staleAfterMs : 60000;
  try {
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
  } catch {
    // parent may already exist
  }
  let acquired = false;
  let lastError = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      lastError = error;
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code !== "EEXIST") {
        throw error;
      }
      try {
        const stat = await fs.stat(lockPath);
        if (!stat.isDirectory()) {
          throw new Error("Lock path exists but is not a directory: " + lockPath);
        }
        if (Date.now() - stat.mtimeMs > staleAfterMs) {
          await fs.rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (
          statError instanceof Error &&
          statError.message.startsWith("Lock path exists but is not a directory")
        ) {
          throw statError;
        }
        // lock vanished between retries
      }
      await hookSleep(retryDelayMs);
    }
  }
  if (!acquired) {
    const details = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      "cclaw hook: failed to acquire lock " + lockPath + " (attempts=" + retries + ", lastError=" + details + ")"
    );
  }
  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function writeFileAtomic(filePath, content, options = {}) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    "." + path.basename(filePath) + ".tmp-" + process.pid + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8)
  );
  await fs.writeFile(tempPath, content, { encoding: "utf8" });
  // Windows' fs.rename can fail transiently with EPERM/EBUSY/EACCES when the
  // destination file is held open by another process (antivirus, indexer,
  // or a sibling hook invocation racing on the same file). Retry with tiny
  // backoff before falling back to copyFile.
  const renameRetryableCodes = new Set(["EPERM", "EBUSY", "EACCES"]);
  let attempt = 0;
  const maxAttempts = 6;
  while (true) {
    try {
      await fs.rename(tempPath, filePath);
      if (options.mode !== undefined) {
        await fs.chmod(filePath, options.mode).catch(() => undefined);
      }
      return;
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "EXDEV") {
        try {
          await fs.copyFile(tempPath, filePath);
        } finally {
          await fs.unlink(tempPath).catch(() => undefined);
        }
        if (options.mode !== undefined) {
          await fs.chmod(filePath, options.mode).catch(() => undefined);
        }
        return;
      }
      if (renameRetryableCodes.has(code) && attempt < maxAttempts) {
        attempt += 1;
        await hookSleep(10 * attempt + Math.floor(Math.random() * 10));
        continue;
      }
      if (renameRetryableCodes.has(code)) {
        // Last-resort fallback: copy-then-unlink. Not atomic, but the
        // directory lock around this call already serializes writers.
        try {
          await fs.copyFile(tempPath, filePath);
          if (options.mode !== undefined) {
            await fs.chmod(filePath, options.mode).catch(() => undefined);
          }
          return;
        } finally {
          await fs.unlink(tempPath).catch(() => undefined);
        }
      }
      await fs.unlink(tempPath).catch(() => undefined);
      throw error;
    }
  }
}

function lockPathFor(filePath) {
  return filePath + ".lock";
}

async function recordHookError(root, stage, detail) {
  try {
    const errorsPath = path.join(root, RUNTIME_ROOT, "state", "hook-errors.jsonl");
    await fs.mkdir(path.dirname(errorsPath), { recursive: true });
    const payload = JSON.stringify({
      ts: new Date().toISOString(),
      stage: typeof stage === "string" ? stage : "unknown",
      detail: typeof detail === "string" ? detail : String(detail)
    });
    await fs.appendFile(errorsPath, payload + "\\n", "utf8");
  } catch {
    // diagnostics must never cascade
  }
}

async function readJsonFile(filePath, fallback = {}, options = {}) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    if (typeof raw !== "string" || raw.trim().length === 0) {
      return fallback;
    }
    try {
      const parsed = JSON.parse(raw);
      return parsed === undefined ? fallback : parsed;
    } catch (parseErr) {
      // Emit a diagnostic breadcrumb instead of silently returning fallback.
      // The hook must still continue (soft-fail), but the corruption is
      // now visible in \`state/hook-errors.jsonl\` and to \`npx cclaw-cli sync\`.
      if (options.root) {
        await recordHookError(
          options.root,
          options.stage || "read-json",
          "corrupt-json file=" + filePath + " error=" + (parseErr instanceof Error ? parseErr.message : String(parseErr))
        );
      }
      return fallback;
    }
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath, value) {
  const next = JSON.stringify(value, null, 2) + "\\n";
  await withDirectoryLockInline(lockPathFor(filePath), async () => {
    await writeFileAtomic(filePath, next);
  });
}

async function readTextFile(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

// CLI-compatible knowledge lock. Must match
// src/knowledge-store.ts::knowledgeLockPath exactly so the hook and the
// CLI serialize on the same mutex when reading / appending
// knowledge.jsonl. Drift here re-introduces the race we just closed.
function knowledgeLockPathInline(root) {
  return path.join(root, RUNTIME_ROOT, "state", ".knowledge.lock");
}

async function readTextFileLocked(lockPath, filePath, fallback = "") {
  return withDirectoryLockInline(lockPath, async () => {
    try {
      return await fs.readFile(filePath, "utf8");
    } catch {
      return fallback;
    }
  });
}

async function appendJsonLine(filePath, value) {
  const payload = JSON.stringify(value) + "\\n";
  await withDirectoryLockInline(lockPathFor(filePath), async () => {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.appendFile(filePath, payload, "utf8");
  });
}

async function readStdin() {
  return await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += String(chunk);
    });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(""));
  });
}

async function runCclawInternal(root, args, options = {}) {
  const cliEntrypoint = process.env.CCLAW_CLI_JS || CCLAW_CLI_ENTRYPOINT;
  const cliArgsPrefix = process.env.CCLAW_CLI_JS ? [] : CCLAW_CLI_ARGS_PREFIX;
  if (!cliEntrypoint || String(cliEntrypoint).trim().length === 0) {
    return {
      code: 1,
      stdout: "",
      stderr: "[cclaw] hook: local Node runtime entrypoint is missing. Re-run npx cclaw-cli sync or npx cclaw-cli upgrade.\\n",
      missingBinary: true
    };
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
    return {
      code: 1,
      stdout: "",
      stderr: "[cclaw] hook: local Node runtime entrypoint not found at " + cliEntrypoint + ". Re-run npx cclaw-cli sync or npx cclaw-cli upgrade.\\n",
      missingBinary: true
    };
  }

  return await new Promise((resolve) => {
    const captureStdout = options && options.captureStdout === true;
    let settled = false;
    let stdout = "";
    let stderr = "";
    const finalize = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    let child;
    try {
      child = spawn(process.execPath, [cliEntrypoint, ...cliArgsPrefix, "internal", ...args], {
        cwd: root,
        env: process.env,
        stdio: ["ignore", captureStdout ? "pipe" : "ignore", "pipe"]
      });
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      finalize({
        code: 1,
        stdout,
        stderr,
        missingBinary: code === "ENOENT"
      });
      return;
    }
    if (captureStdout) {
      child.stdout?.on("data", (chunk) => {
        stdout += String(chunk ?? "");
        if (stdout.length > 16000) {
          stdout = stdout.slice(-16000);
        }
      });
    }
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk ?? "");
      if (stderr.length > 8000) {
        stderr = stderr.slice(-8000);
      }
    });
    child.on("error", (error) => {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      finalize({
        code: 1,
        stdout,
        stderr,
        missingBinary: code === "ENOENT"
      });
    });
    child.on("close", (code, signal) => {
      if (signal) {
        finalize({
          code: 1,
          stdout,
          stderr,
          missingBinary: false
        });
        return;
      }
      finalize({
        code: typeof code === "number" ? code : 1,
        stdout,
        stderr,
        missingBinary: false
      });
    });
  });
}

function compactStderr(value) {
  const raw = typeof value === "string" ? value : "";
  return raw.replace(/\\s+/gu, " ").trim();
}

function summarizeInternalFailure(operation, result) {
  const detail = compactStderr(result && typeof result === "object" ? result.stderr : "");
  return detail.length > 0 ? operation + ": " + detail : operation + " failed";
}

function parseJsonStdoutObject(result) {
  const raw = typeof (result && result.stdout) === "string" ? result.stdout.trim() : "";
  if (raw.length === 0) return null;
  try {
    return toObject(JSON.parse(raw));
  } catch {
    return null;
  }
}

function firstStdoutLine(value) {
  const raw = typeof value === "string" ? value : "";
  const lines = raw
    .split(/\\r?\\n/gu)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines[0] || "";
}

function formatRalphLoopStatusLineFromJson(status) {
  const redOpenSlices = Array.isArray(status.redOpenSlices)
    ? status.redOpenSlices.filter((value) => typeof value === "string")
    : [];
  const redOpen = redOpenSlices.length > 0 ? redOpenSlices.join(",") : "none";
  const loopIteration =
    typeof status.loopIteration === "number" && Number.isFinite(status.loopIteration)
      ? Math.trunc(status.loopIteration)
      : 0;
  const sliceCount =
    typeof status.sliceCount === "number" && Number.isFinite(status.sliceCount)
      ? Math.trunc(status.sliceCount)
      : 0;
  const acClosed = Array.isArray(status.acClosed) ? status.acClosed.length : 0;
  return "Ralph Loop: iter=" + String(loopIteration) +
    ", slices=" + String(sliceCount) +
    ", acClosed=" + String(acClosed) +
    ", redOpen=" + redOpen;
}

function formatEarlyLoopStatusLineFromJson(status) {
  const stage = typeof status.stage === "string" ? status.stage : "unknown";
  const iteration =
    typeof status.iteration === "number" && Number.isFinite(status.iteration)
      ? Math.trunc(status.iteration)
      : 0;
  const maxIterations =
    typeof status.maxIterations === "number" && Number.isFinite(status.maxIterations)
      ? Math.trunc(status.maxIterations)
      : EARLY_LOOP_MAX_ITERATIONS;
  const openConcerns = Array.isArray(status.openConcerns) ? status.openConcerns.length : 0;
  const convergence = status.convergenceTripped === true ? "tripped" : "clear";
  return "Early Loop: stage=" + stage +
    ", iter=" + String(iteration) + "/" + String(maxIterations) +
    ", open=" + String(openConcerns) +
    ", convergence=" + convergence;
}

function detectHarness(env) {
  if (env.CLAUDE_PROJECT_DIR) return "claude";
  if (env.CURSOR_PROJECT_DIR || env.CURSOR_PROJECT_ROOT) return "cursor";
  if (env.OPENCODE_PROJECT_DIR || env.OPENCODE_PROJECT_ROOT) return "opencode";
  return "codex";
}

function hookEventNameForOutput(hookName) {
  if (hookName === "session-start") return "SessionStart";
  if (hookName === "prompt-guard") return "PreToolUse";
  if (hookName === "workflow-guard") return "PreToolUse";
  if (hookName === "pre-tool-pipeline") return "PreToolUse";
  if (hookName === "prompt-pipeline") return "UserPromptSubmit";
  if (hookName === "context-monitor") return "PostToolUse";
  if (hookName === "stop-handoff") return "Stop";
  if (hookName === "verify-current-state") return "UserPromptSubmit";
  return "SessionStart";
}

function emitAdvisoryContext(runtime, hookName, note) {
  const normalized = normalizeText(note);
  if (normalized.length === 0) return;
  if (runtime.harness === "claude" || runtime.harness === "codex") {
    runtime.writeJson({
      hookSpecificOutput: {
        hookEventName: hookEventNameForOutput(hookName),
        additionalContext: normalized
      }
    });
    return;
  }
  runtime.writeJson({ additional_context: normalized });
}

async function detectRoot(env) {
  const candidates = [
    env.CCLAW_PROJECT_ROOT,
    env.CLAUDE_PROJECT_DIR,
    env.CURSOR_PROJECT_DIR,
    env.CURSOR_PROJECT_ROOT,
    env.OPENCODE_PROJECT_DIR,
    env.OPENCODE_PROJECT_ROOT,
    process.cwd()
  ].filter((value) => typeof value === "string" && value.length > 0);
  for (const candidate of candidates) {
    try {
      const runtimePath = path.join(candidate, RUNTIME_ROOT);
      const stat = await fs.stat(runtimePath);
      if (stat.isDirectory()) return { root: candidate, foundRuntime: true };
    } catch {
      // continue
    }
  }
  return { root: candidates[0] || process.cwd(), foundRuntime: false };
}

function toLower(value) {
  return String(value || "").toLowerCase();
}

function normalizeText(value) {
  return String(value || "").replace(/\\s+/gu, " ").trim();
}

// Mirrors \`src/tdd-cycle.ts::normalizeTddPath\`. Any change to
// canonical normalization must be updated in BOTH places; the
// tdd-parity test asserts matcher behavior agrees end-to-end.
function normalizePathForMatch(rawPath) {
  return String(rawPath == null ? "" : rawPath)
    .trim()
    .replace(/\\\\/gu, "/")
    .replace(/^\\.\\//u, "")
    .toLowerCase();
}

// Mirrors \`src/tdd-cycle.ts::pathMatchesTarget\`. Use instead of raw
// \`===\` when checking recorded files against a target path.
function pathMatchesTargetInline(candidate, target) {
  const normalizedCandidate = normalizePathForMatch(candidate);
  const normalizedTarget = normalizePathForMatch(target);
  if (normalizedCandidate.length === 0 || normalizedTarget.length === 0) {
    return false;
  }
  return (
    normalizedCandidate === normalizedTarget ||
    normalizedCandidate.endsWith("/" + normalizedTarget)
  );
}

function normalizeToolName(value) {
  if (typeof value === "string" && value.trim().length > 0) return value.trim();
  if (value && typeof value === "object") {
    if (typeof value.name === "string" && value.name.trim().length > 0) {
      return value.name.trim();
    }
    if (typeof value.id === "string" && value.id.trim().length > 0) {
      return value.id.trim();
    }
  }
  return "";
}

function extractToolAndPayload(inputData, inputRaw) {
  const root = toObject(inputData) || {};
  const nestedInput = toObject(root.input) || {};
  const nestedTool = toObject(root.tool) || {};
  const nestedInputTool = toObject(nestedInput.tool) || {};
  const candidates = [
    root.tool_name,
    root.tool,
    root.toolName,
    root.name,
    root.id,
    root.command,
    nestedTool.name,
    nestedTool.id,
    nestedInput.tool_name,
    nestedInput.tool,
    nestedInput.toolName,
    nestedInput.name,
    nestedInput.id,
    nestedInput.command,
    nestedInputTool.name,
    nestedInputTool.id
  ];
  let tool = "unknown";
  for (const candidate of candidates) {
    const next = normalizeToolName(candidate);
    if (next.length > 0) {
      tool = next;
      break;
    }
  }
  const payload =
    root.tool_input ??
    root.input ??
    root.arguments ??
    root.params ??
    root.payload ??
    {};
  let payloadText = "";
  try {
    payloadText = JSON.stringify(payload);
  } catch {
    payloadText = "";
  }
  if (payloadText.length === 0) {
    payloadText = typeof inputRaw === "string" ? inputRaw : "";
  }
  return { tool, payload, payloadText };
}

function collectPaths(value, bucket = new Set()) {
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, bucket);
    return bucket;
  }
  if (!value || typeof value !== "object") {
    return bucket;
  }
  const obj = value;
  for (const key of ["path", "file_path", "filepath"]) {
    const current = obj[key];
    if (typeof current === "string" && current.trim().length > 0) {
      bucket.add(current.trim());
    }
  }
  for (const child of Object.values(obj)) {
    collectPaths(child, bucket);
  }
  return bucket;
}

const globRegexCache = new Map();

function escapeRegex(value) {
  return value.replace(/[.*+?^\\\${}()|[\\]\\\\]/gu, "\\\\$&");
}

function globToRegExp(globPattern) {
  const normalized = normalizePathForMatch(globPattern);
  const cached = globRegexCache.get(normalized);
  if (cached) return cached;
  let pattern = normalized;
  pattern = pattern.replace(/\\*\\*\\//gu, "__GLOBSTAR_DIR__");
  pattern = pattern.replace(/\\/\\*\\*/gu, "__DIR_GLOBSTAR__");
  pattern = pattern.replace(/\\*\\*/gu, "__GLOBSTAR__");
  pattern = pattern.replace(/\\*/gu, "__STAR__");
  pattern = escapeRegex(pattern);
  pattern = pattern.replace(/__GLOBSTAR_DIR__/gu, "(?:.*\\\\/)?");
  pattern = pattern.replace(/__DIR_GLOBSTAR__/gu, "\\\\/.*");
  pattern = pattern.replace(/__GLOBSTAR__/gu, ".*");
  pattern = pattern.replace(/__STAR__/gu, "[^\\\\/]*");
  const built = new RegExp("^" + pattern + "$", "u");
  globRegexCache.set(normalized, built);
  return built;
}

function matchesPathPatterns(rawPath, patterns) {
  if (!Array.isArray(patterns) || patterns.length === 0) return false;
  const normalized = normalizePathForMatch(rawPath);
  for (const pattern of patterns) {
    if (globToRegExp(pattern).test(normalized)) return true;
  }
  return false;
}

function isCodeLikePath(rawPath) {
  return /\\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)$/u.test(
    normalizePathForMatch(rawPath)
  );
}

function isMutatingTool(toolLower) {
  return /^(write|edit|multiedit|multi_edit|delete|applypatch|apply_patch|notebookedit|notebook_edit)$/u.test(toolLower);
}

function isExecutionOrMutatingTool(toolLower) {
  if (isMutatingTool(toolLower)) return true;
  return /^(shell|bash|runcommand|run_command|execcommand|exec_command|terminal)$/u.test(toolLower);
}

function isPlanModeSafeTool(toolLower) {
  return /^(read|readfile|open|view|cat|head|tail|grep|glob|search|semanticsearch|ripgrep|rg|find|list_directory|ls|askquestion|askuserquestion|ask_question|ask_user_question|question|todowrite|todoread|todo_write|todo_read|webfetch|websearch|web_fetch|web_search|fetchmcpresource|switchmode|switch_mode|task|delegate)$/u.test(
    toolLower
  );
}

function isCclawCliPayload(payloadLower) {
  return /(cclaw |npx cclaw |\\/cc-|\\/cc[^a-z0-9_-])/u.test(payloadLower);
}

function stageIndex(stage) {
  const ordered = [
    "brainstorm",
    "scope",
    "design",
    "spec",
    "plan",
    "tdd",
    "review",
    "ship"
  ];
  const index = ordered.indexOf(stage);
  return index < 0 ? 0 : index + 1;
}

function detectTargetStage(payloadLower) {
  for (const stage of [
    "brainstorm",
    "scope",
    "design",
    "spec",
    "plan",
    "tdd",
    "review",
    "ship"
  ]) {
    if (new RegExp("(/cc-" + stage + "|cc-" + stage + ")([^a-z0-9_-]|$)", "u").test(payloadLower)) {
      return stage;
    }
  }
  return "";
}

function isFlowProgressionCommand(payloadLower) {
  return /\\/cc([^a-z0-9_-]|$)/u.test(payloadLower);
}

function isPreimplementationStage(stage) {
  return ["brainstorm", "scope", "design", "spec", "plan"].includes(stage);
}

function extractCommandFromPayload(payload) {
  const stack = [payload];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const key of ["command", "cmd"]) {
      const value = current[key];
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    for (const value of Object.values(current)) {
      stack.push(value);
    }
  }
  return "";
}

function extractExitCodeFromPayload(payload) {
  const stack = [payload];
  while (stack.length > 0) {
    const current = stack.shift();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const key of ["exitCode", "exit_code", "code", "status"]) {
      const value = current[key];
      if (typeof value === "number" && Number.isFinite(value)) {
        return Math.trunc(value);
      }
      if (typeof value === "boolean") {
        return value ? 0 : 1;
      }
      if (typeof value === "string" && /^-?[0-9]+$/u.test(value.trim())) {
        return Number(value.trim());
      }
    }
    for (const value of Object.values(current)) {
      stack.push(value);
    }
  }
  return null;
}

function extractRemainingPercent(payload) {
  const readPath = (segments) => {
    let current = payload;
    for (const segment of segments) {
      if (!current || typeof current !== "object" || Array.isArray(current)) return null;
      current = current[segment];
    }
    if (typeof current !== "number" || !Number.isFinite(current)) return null;
    return current;
  };
  const candidates = [
    { path: ["context", "remaining_percent"], invert: false },
    { path: ["context", "remainingPercent"], invert: false },
    { path: ["context_usage", "remaining_percent"], invert: false },
    { path: ["context_usage", "remainingPercent"], invert: false },
    { path: ["contextUsage", "remainingPercent"], invert: false },
    { path: ["context_window", "remaining_percent"], invert: false },
    { path: ["remaining_context_percent"], invert: false },
    { path: ["remainingContextPercent"], invert: false },
    { path: ["remaining_context_ratio"], invert: false },
    { path: ["remainingContextRatio"], invert: false },
    { path: ["context", "used_percent"], invert: true },
    { path: ["context", "usedPercent"], invert: true },
    { path: ["context_usage", "used_percent"], invert: true },
    { path: ["context_usage", "usedPercent"], invert: true },
    { path: ["contextUsage", "usedPercent"], invert: true },
    { path: ["context_window", "used_ratio"], invert: true },
    { path: ["context_window", "usedRatio"], invert: true }
  ];
  for (const candidate of candidates) {
    const value = readPath(candidate.path);
    if (value === null) continue;
    let percent = value <= 1 ? value * 100 : value;
    if (candidate.invert) {
      percent = 100 - percent;
    }
    if (!Number.isFinite(percent)) continue;
    if (percent < 0) percent = 0;
    if (percent > 100) percent = 100;
    return Number(percent.toFixed(2));
  }
  return null;
}

function extractTextBlobs(payload) {
  const stack = [payload];
  const lines = [];
  while (stack.length > 0) {
    const current = stack.shift();
    if (typeof current === "string" && current.length > 0) {
      lines.push(current);
      continue;
    }
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const value of Object.values(current)) {
      stack.push(value);
    }
  }
  return lines.join("\\n");
}

function extractCodePathsFromText(value) {
  const pattern =
    /(?:[A-Za-z0-9_.-]+[\\\\/])+[A-Za-z0-9_.-]+\\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|php|cs|swift)/gu;
  const matches = value.match(pattern) || [];
  const out = [];
  const seen = new Set();
  for (const match of matches) {
    const normalized = match.trim().replace(/^[\\s"']+|[\\s"'.,:;()\\[\\]{}<>]+$/gu, "");
    if (normalized.length === 0) continue;
    const key = normalizePathForMatch(normalized);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= 20) break;
  }
  return out;
}

async function readFlowState(root) {
  const statePath = path.join(root, RUNTIME_ROOT, "state", "flow-state.json");
  // Loud-on-corrupt: if flow-state.json exists but fails JSON.parse, log
  // a breadcrumb into state/hook-errors.jsonl before falling back to an
  // empty object. Silent fallbacks used to mask stale CLI+hook drift.
  const parsed = await readJsonFile(statePath, {}, { root, stage: "read-flow-state" });
  const obj = toObject(parsed) || {};
  const summary = summarizeFlowState(obj);
  return {
    filePath: statePath,
    currentStage: summary.stage,
    activeRunId: summary.activeRunId === "none" ? "active" : summary.activeRunId,
    completedCount: summary.completed,
    raw: obj
  };
}

async function readFileMtimeMs(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile()) return 0;
    return Math.trunc(stat.mtimeMs);
  } catch {
    return 0;
  }
}

function parseNumericMs(value) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.trunc(value)
    : -1;
}

async function readSessionDigestLines(stateDir, state, flowStateMtimeMs) {
  const cachePath = path.join(stateDir, SESSION_DIGEST_CACHE_FILE);
  const cache = toObject(await readJsonFile(cachePath, {})) || {};
  const cachedMtimeMs = parseNumericMs(cache.flowStateMtimeMs);
  const sameStage = typeof cache.currentStage === "string" ? cache.currentStage === state.currentStage : true;
  const sameRun = typeof cache.activeRunId === "string" ? cache.activeRunId === state.activeRunId : true;
  const fresh = cachedMtimeMs === flowStateMtimeMs && sameStage && sameRun;
  if (!fresh) {
    return {
      ralphLoopLine: "",
      earlyLoopLine: "",
      compoundReadinessLine: "",
      fresh: false
    };
  }
  return {
    ralphLoopLine: typeof cache.ralphLoopLine === "string" ? cache.ralphLoopLine : "",
    earlyLoopLine: typeof cache.earlyLoopLine === "string" ? cache.earlyLoopLine : "",
    compoundReadinessLine: typeof cache.compoundReadinessLine === "string" ? cache.compoundReadinessLine : "",
    fresh: true
  };
}

async function refreshSessionDigestCache(root, state, flowStateMtimeMs) {
  const stateDir = path.join(root, RUNTIME_ROOT, "state");
  let ralphLoopLine = "";
  let earlyLoopLine = "";
  let compoundReadinessLine = "";

  if (state.currentStage === "tdd") {
    try {
      const internalRalph = await runCclawInternal(
        root,
        ["tdd-loop-status", "--json", "--write"],
        { captureStdout: true }
      );
      if (internalRalph.code !== 0) {
        throw new Error(summarizeInternalFailure("tdd-loop-status", internalRalph));
      }
      const ralphStatus = parseJsonStdoutObject(internalRalph);
      if (!ralphStatus) {
        throw new Error("tdd-loop-status returned empty or malformed JSON");
      }
      ralphLoopLine = formatRalphLoopStatusLineFromJson(ralphStatus);
    } catch (err) {
      await recordHookError(
        root,
        "session-start:ralph-loop",
        err instanceof Error ? err.message : String(err)
      );
    }
  }
  if (
    EARLY_LOOP_ENABLED &&
    (state.currentStage === "brainstorm" || state.currentStage === "scope" || state.currentStage === "design")
  ) {
    try {
      const internalEarly = await runCclawInternal(
        root,
        [
          "early-loop-status",
          "--json",
          "--write",
          "--stage",
          state.currentStage,
          "--run-id",
          state.activeRunId
        ],
        { captureStdout: true }
      );
      if (internalEarly.code !== 0) {
        throw new Error(summarizeInternalFailure("early-loop-status", internalEarly));
      }
      const earlyLoopStatus = parseJsonStdoutObject(internalEarly);
      if (!earlyLoopStatus) {
        throw new Error("early-loop-status returned empty or malformed JSON");
      }
      earlyLoopLine = formatEarlyLoopStatusLineFromJson(earlyLoopStatus);
    } catch (err) {
      await recordHookError(
        root,
        "session-start:early-loop",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  try {
    const shouldShowReadiness = state.currentStage === "review" || state.currentStage === "ship";
    const internalReadiness = await runCclawInternal(
      root,
      shouldShowReadiness ? ["compound-readiness"] : ["compound-readiness", "--quiet"],
      { captureStdout: true }
    );
    if (internalReadiness.code !== 0) {
      throw new Error(summarizeInternalFailure("compound-readiness", internalReadiness));
    }
    if (shouldShowReadiness) {
      compoundReadinessLine = firstStdoutLine(internalReadiness.stdout);
    }
  } catch (err) {
    await recordHookError(
      root,
      "session-start:compound-readiness",
      err instanceof Error ? err.message : String(err)
    );
  }

  const digestPath = path.join(stateDir, SESSION_DIGEST_CACHE_FILE);
  await writeJsonFile(digestPath, {
    schemaVersion: SESSION_DIGEST_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    flowStateMtimeMs,
    currentStage: state.currentStage,
    activeRunId: state.activeRunId,
    ralphLoopLine,
    earlyLoopLine,
    compoundReadinessLine
  });
}

async function scheduleSessionDigestRefresh(runtime, state, flowStateMtimeMs) {
  if (flowStateMtimeMs <= 0) return;
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const digestPath = path.join(stateDir, SESSION_DIGEST_CACHE_FILE);
  const markerPath = path.join(stateDir, SESSION_DIGEST_REFRESH_MARKER_FILE);

  const cache = toObject(await readJsonFile(digestPath, {})) || {};
  const cachedMtimeMs = parseNumericMs(cache.flowStateMtimeMs);
  if (cachedMtimeMs === flowStateMtimeMs) return;

  const marker = toObject(await readJsonFile(markerPath, {})) || {};
  const markerMtimeMs = parseNumericMs(marker.flowStateMtimeMs);
  const markerStartedAtMs = parseNumericMs(marker.startedAtMs);
  const markerFresh =
    markerMtimeMs === flowStateMtimeMs &&
    markerStartedAtMs > 0 &&
    Date.now() - markerStartedAtMs < SESSION_DIGEST_REFRESH_STALE_MS;
  if (markerFresh) return;

  await writeJsonFile(markerPath, {
    flowStateMtimeMs,
    startedAtMs: Date.now(),
    currentStage: state.currentStage,
    activeRunId: state.activeRunId
  });

  try {
    const child = spawn(process.execPath, [process.argv[1], "session-start-refresh"], {
      cwd: runtime.root,
      stdio: "ignore",
      windowsHide: true,
      detached: true,
      env: {
        ...process.env,
        CCLAW_PROJECT_ROOT: runtime.root,
        CCLAW_BG_WORKER: "1"
      }
    });
    child.unref();
  } catch (err) {
    await fs.rm(markerPath, { force: true }).catch(() => undefined);
    await recordHookError(
      runtime.root,
      "session-start:spawn-refresh",
      err instanceof Error ? err.message : String(err)
    );
  }
}

async function handleSessionStartRefresh(runtime) {
  const state = await readFlowState(runtime.root);
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const markerPath = path.join(stateDir, SESSION_DIGEST_REFRESH_MARKER_FILE);
  try {
    const flowStateMtimeMs = await readFileMtimeMs(state.filePath);
    await refreshSessionDigestCache(runtime.root, state, flowStateMtimeMs);
  } finally {
    await fs.rm(markerPath, { force: true }).catch(() => undefined);
  }
  return 0;
}


async function buildKnowledgeDigest(root, currentStage, prereadRaw) {
  const knowledgeFile = path.join(root, RUNTIME_ROOT, "knowledge.jsonl");
  // Caller may supply pre-read raw bytes to avoid re-reading knowledge.jsonl.
  // Falls back to a local read if nothing is passed in.
  const raw = typeof prereadRaw === "string"
    ? prereadRaw
    : await readTextFile(knowledgeFile, "");
  const digest = parseKnowledgeDigest(raw, currentStage, 6);
  return {
    digestLines: digest.lines,
    learningsCount: digest.learningsCount
  };
}

async function readStageSupportContext(root, currentStage) {
  if (!isKnownStageId(currentStage)) return [];
  const stage = currentStage;

  const parts = [];
  const contractPath = path.join(root, RUNTIME_ROOT, "templates", "state-contracts", stage + ".json");
  const contract = (await readTextFile(contractPath, "")).trim();
  if (contract.length > 0) {
    parts.push(
      "Current stage state contract (read before drafting or editing the stage artifact):\\n" +
        contract
    );
  }

  const promptName = reviewPromptFileName(stage);
  if (typeof promptName === "string") {
    const promptPath = path.join(root, RUNTIME_ROOT, "skills", "review-prompts", promptName);
    const prompt = (await readTextFile(promptPath, "")).trim();
    if (prompt.length > 0) {
      parts.push(
        "Current stage calibrated review prompt (use before asking for approval/completion):\\n" +
          prompt
      );
    }
  }

  return parts;
}

async function handleSessionStart(runtime) {
  const state = await readFlowState(runtime.root);
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const ironLawsFile = path.join(stateDir, "iron-laws.json");
  const metaSkillFile = path.join(runtime.root, RUNTIME_ROOT, "skills", "using-cclaw", "SKILL.md");


  // Read knowledge.jsonl exactly once per session-start while holding the
  // SAME lock CLI writers acquire in \`appendKnowledge\`. Guarantees we never
  // see a partial (mid-write) snapshot. Both the digest and
  // compound-readiness derive from this single read.
  const knowledgeFilePath = path.join(runtime.root, RUNTIME_ROOT, "knowledge.jsonl");
  const knowledgeRaw = await readTextFileLocked(
    knowledgeLockPathInline(runtime.root),
    knowledgeFilePath,
    ""
  );
  const knowledge = await buildKnowledgeDigest(runtime.root, state.currentStage, knowledgeRaw);

  // Fast path: read precomputed status lines from session-digest cache.
  // If cache is stale, schedule a debounced background refresh so this hook
  // returns quickly inside harness startup.
  const flowStateMtimeMs = await readFileMtimeMs(state.filePath);
  const forceSyncRefresh =
    normalizeText(process.env.CCLAW_SESSION_START_BG_SYNC).toLowerCase() === "1" ||
    ["1", "true", "yes"].includes(normalizeText(process.env.VITEST).toLowerCase());
  let sessionDigest = await readSessionDigestLines(stateDir, state, flowStateMtimeMs);
  if (forceSyncRefresh && flowStateMtimeMs > 0) {
    await refreshSessionDigestCache(runtime.root, state, flowStateMtimeMs);
    sessionDigest = await readSessionDigestLines(stateDir, state, flowStateMtimeMs);
  } else if (!sessionDigest.fresh) {
    await scheduleSessionDigestRefresh(runtime, state, flowStateMtimeMs);
  }
  const ralphLoopLine = sessionDigest.ralphLoopLine;
  const earlyLoopLine = sessionDigest.earlyLoopLine;
  const compoundReadinessLine = sessionDigest.compoundReadinessLine;

  const ironLawsObj = toObject(await readJsonFile(ironLawsFile, {})) || {};
  const laws = Array.isArray(ironLawsObj.laws) ? ironLawsObj.laws : [];
  const ironLawLines = laws
    .filter((row) => row && typeof row === "object")
    .slice(0, 6)
    .map((row) => {
      const strict = row.strict === true ? "strict" : "advisory";
      const id = typeof row.id === "string" && row.id.length > 0 ? row.id : "law";
      const rule = typeof row.rule === "string" ? row.rule : "";
      return "- [" + strict + "] " + id + " -> " + rule;
    });
  const staleStages = toObject(state.raw.staleStages) || {};
  const staleStageNames = Object.keys(staleStages);
  const interactionHints = toObject(state.raw.interactionHints) || {};
  const stageInteractionHint = toObject(interactionHints[state.currentStage]);
  const skipQuestionsHintActive = stageInteractionHint?.skipQuestions === true;
  const skipQuestionsSource = typeof stageInteractionHint?.sourceStage === "string"
    ? stageInteractionHint.sourceStage
    : "";
  const skipQuestionsRecordedAt = typeof stageInteractionHint?.recordedAt === "string"
    ? stageInteractionHint.recordedAt
    : "";
  const metaContent = (await readTextFile(metaSkillFile, "")).trim();
  const stageSupportContext = await readStageSupportContext(runtime.root, state.currentStage);

  const parts = [
    "cclaw loaded. Flow: stage=" +
      state.currentStage +
      " (" +
      String(state.completedCount) +
      "/8 completed, run=" +
      state.activeRunId +
      "). Active artifacts: " +
      activeArtifactsPathLabel(RUNTIME_ROOT) +
      " Learnings: " +
      String(knowledge.learningsCount) +
      " entries."
  ];
  if (ralphLoopLine.length > 0) {
    parts.push(ralphLoopLine);
  }
  if (earlyLoopLine.length > 0) {
    parts.push(earlyLoopLine);
  }
  if (compoundReadinessLine.length > 0) {
    parts.push(compoundReadinessLine);
  }
  if (staleStageNames.length > 0) {
    parts.push(
      "Stale stages pending acknowledgement: " +
        staleStageNames.join(", ") +
        " (use npx cclaw-cli internal rewind --ack <stage> after redo)."
    );
  }
  if (skipQuestionsHintActive) {
    parts.push(
      "Adaptive elicitation hint: this stage inherits a prior user stop signal (--skip-questions" +
        (skipQuestionsSource ? " from " + skipQuestionsSource : "") +
        (skipQuestionsRecordedAt ? " at " + skipQuestionsRecordedAt : "") +
        "). Draft with available context unless irreversible/security override checks still require explicit confirmation."
    );
  }
  if (knowledge.digestLines.length > 0) {
    parts.push(
      "Knowledge digest (top relevant entries):\\n" +
        knowledge.digestLines.join("\\n")
    );
  }
  if (stageSupportContext.length > 0) {
    parts.push(...stageSupportContext);
  }
  if (ironLawLines.length > 0) {
    parts.push("Iron laws (enforced policy highlights):\\n" + ironLawLines.join("\\n"));
  }
  if (metaContent.length > 0) {
    parts.push(metaContent);
  }

  const context = parts.join("\\n");
  if (runtime.harness === "claude" || runtime.harness === "codex") {
    runtime.writeJson({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: context
      }
    });
    return 0;
  }
  runtime.writeJson({ additional_context: context });
  return 0;
}

async function isGitDirty(root) {
  return await new Promise((resolve) => {
    const child = spawn("git", ["-C", root, "status", "--porcelain"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
    });
    child.on("error", () => resolve("unknown"));
    child.on("close", (code) => {
      if (code !== 0) {
        resolve("unknown");
      } else {
        resolve(output.trim().length > 0 ? "dirty" : "clean");
      }
    });
  });
}

function stopLawIsStrict(ironLawsObj) {
  if ((ironLawsObj.mode || "advisory") === "strict") return true;
  const laws = Array.isArray(ironLawsObj.laws) ? ironLawsObj.laws : [];
  return laws.some(
    (row) =>
      row &&
      typeof row === "object" &&
      (row.id === "stop-clean-or-handoff" || row.id === "stop-clean-or-checkpointed") &&
      row.strict === true
  );
}

async function handleStopHandoff(runtime) {
  const state = await readFlowState(runtime.root);
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const ironLawsFile = path.join(stateDir, "iron-laws.json");
  const input = toObject(runtime.inputData) || {};
  const loopCount =
    typeof input.loop_count === "number" && Number.isFinite(input.loop_count)
      ? Math.trunc(input.loop_count)
      : 0;

  const dirtyState = await isGitDirty(runtime.root);
  const strictStop = stopLawIsStrict(toObject(await readJsonFile(ironLawsFile, {})) || {});
  if (dirtyState === "dirty" && strictStop) {
    process.stderr.write(
      '[cclaw] Stop blocked by iron law "stop-clean-or-handoff": working tree is dirty. Commit/revert changes or record blockers in the current artifact before ending the session.\\n'
    );
    return 1;
  }

  const closeoutObj = toObject(state.raw.closeout) || {};
  const shipSubstate = typeof closeoutObj.shipSubstate === "string" ? closeoutObj.shipSubstate : "idle";
  const closeoutContext =
    state.currentStage === "ship" || shipSubstate !== "idle"
      ? " closeout.shipSubstate=" + shipSubstate + "; closeout chain=post_ship_review -> archive; continue closeout with /cc."
      : "";

  const message =
    "Cclaw: session ending (stage=" +
    state.currentStage +
    ", run=" +
    state.activeRunId +
    ")." +
    closeoutContext +
    " Active artifacts stay in " +
    RUNTIME_ROOT +
    "/artifacts until archive. Before stopping: (1) confirm flow-state reflects reality, (2) ensure artifact changes match current intent, (3) if you discovered a non-obvious rule/pattern during stage work, add it to the current artifact ## Learnings section so stage-complete can harvest it, (4) commit or revert pending changes.";

  if (runtime.harness === "cursor") {
    if (loopCount === 0) {
      runtime.writeJson({ followup_message: message });
    } else {
      runtime.writeJson({});
    }
    return 0;
  }

  runtime.writeJson({ systemMessage: message });
  return 0;
}

async function handlePromptGuard(runtime) {
  const mode = resolveStrictness();
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const guardLog = path.join(stateDir, "prompt-guard.jsonl");

  const { tool, payloadText } = extractToolAndPayload(runtime.inputData, runtime.inputRaw);
  const toolLower = toLower(tool);
  const payloadLower = toLower(payloadText);
  const reasons = [];

  if (/^(write|edit|multiedit|multi_edit|delete|applypatch|notebookedit|runcommand|shell|terminal|execcommand)$/u.test(toolLower)) {
    // Artifacts, runs, and knowledge writes are part of normal stage flow.
    // Guard only managed internals that should be mutated via installer/CLI.
    if (/\\.cclaw\\/(state|hooks|skills|commands|agents)/u.test(payloadLower)) {
      reasons.push("write_to_cclaw_runtime");
    }
  }
  if (/(rm\\s+-rf\\s+\\.cclaw|curl\\s+.*https?:\\/\\/|wget\\s+.*https?:\\/\\/|base64\\s+-d|eval\\(|python\\s+-c)/u.test(payloadLower)) {
    reasons.push("suspicious_payload_pattern");
  }

  if (reasons.length > 0) {
    const note =
      "Cclaw advisory: potential risky write intent detected for " +
      RUNTIME_ROOT +
      " runtime (" +
      reasons.join(",") +
      "). Prefer installer commands before mutating managed runtime internals (.cclaw/state|hooks|skills|commands|agents).";
    await appendJsonLine(guardLog, {
      ts: new Date().toISOString(),
      harness: runtime.harness,
      tool,
      reasons,
      note
    });
    const advisoryNote = mode === "strict" ? note + " Blocked by strict mode." : note;
    emitAdvisoryContext(runtime, "prompt-guard", advisoryNote);
    if (mode === "strict") {
      process.stderr.write("[cclaw] " + note + " (blocked by strict mode)\\n");
      return 1;
    }
    process.stderr.write("[cclaw] " + note + "\\n");
  }
  return 0;
}

async function hasFailingRedEvidenceForPath(stateDir, runId, rawPath) {
  const cycleRaw = await readTextFile(path.join(stateDir, "tdd-cycle-log.jsonl"), "");
  for (const line of cycleRaw.split(/\\r?\\n/gu)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const row = JSON.parse(trimmed);
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const rowRun = typeof row.runId === "string" && row.runId.length > 0 ? row.runId : runId;
      if (rowRun !== runId) continue;
      if (row.phase !== "red") continue;
      const exitCode =
        typeof row.exitCode === "number" && Number.isFinite(row.exitCode)
          ? Math.trunc(row.exitCode)
          : null;
      if (exitCode === 0) continue;
      const files = Array.isArray(row.files) ? row.files : [];
      for (const filePath of files) {
        if (typeof filePath !== "string") continue;
        // endsWith-aware match (mirrors tdd-cycle.ts::pathMatchesTarget)
        // — previously the inline impl used strict === which disagreed
        // with the CLI/internal path and produced guard blind spots.
        if (pathMatchesTargetInline(filePath, rawPath)) return true;
      }
    } catch {
      // ignore malformed line
    }
  }

  const autoRaw = await readTextFile(path.join(stateDir, "tdd-red-evidence.jsonl"), "");
  for (const line of autoRaw.split(/\\r?\\n/gu)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try {
      const row = JSON.parse(trimmed);
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const rowRun = typeof row.runId === "string" && row.runId.length > 0 ? row.runId : runId;
      if (rowRun !== runId) continue;
      const exitCode =
        typeof row.exitCode === "number" && Number.isFinite(row.exitCode)
          ? Math.trunc(row.exitCode)
          : null;
      if (exitCode === 0) continue;
      const paths = Array.isArray(row.paths) ? row.paths : [];
      for (const filePath of paths) {
        if (typeof filePath !== "string") continue;
        if (pathMatchesTargetInline(filePath, rawPath)) return true;
      }
    } catch {
      // ignore malformed line
    }
  }
  return false;
}

function reviewCoverageComplete(reviewArmy) {
  const root = toObject(reviewArmy) || {};
  const reconciliation = toObject(root.reconciliation) || {};
  const coverage = toObject(reconciliation.layerCoverage) || {};
  for (const key of [
    "spec",
    "correctness",
    "security",
    "performance",
    "architecture",
    "external-safety"
  ]) {
    if (coverage[key] !== true) return false;
  }
  return true;
}

function strictLawSet(ironLaws) {
  const root = toObject(ironLaws) || {};
  const set = new Set();
  if ((root.mode || "advisory") === "strict") {
    set.add("*");
  }
  const laws = Array.isArray(root.laws) ? root.laws : [];
  for (const row of laws) {
    if (!row || typeof row !== "object") continue;
    if (row.strict === true && typeof row.id === "string" && row.id.length > 0) {
      set.add(row.id);
    }
  }
  return set;
}

function lawIsStrict(strictSet, lawId) {
  return strictSet.has("*") || strictSet.has(lawId);
}

function isTestPayload(payloadTextLower, payloadPaths, testPatterns) {
  for (const rawPath of payloadPaths) {
    if (matchesPathPatterns(rawPath, testPatterns)) return true;
  }
  return /(\\/tests?\\/|\\/__tests__\\/|\\.test\\.)/u.test(payloadTextLower);
}

function isProductionPath(rawPath, testPatterns, productionPatterns) {
  const normalized = normalizePathForMatch(rawPath);
  if (normalized.includes("/.cclaw/") || normalized.startsWith(".cclaw/")) return false;
  if (matchesPathPatterns(normalized, testPatterns)) return false;
  if (productionPatterns.length > 0) {
    return matchesPathPatterns(normalized, productionPatterns);
  }
  return isCodeLikePath(normalized);
}

async function handleWorkflowGuard(runtime) {
  const mode = resolveStrictness();
  const maxAgeRaw = process.env.CCLAW_WORKFLOW_GUARD_MAX_AGE_SEC;
  const maxAgeSec =
    typeof maxAgeRaw === "string" && /^[0-9]+$/u.test(maxAgeRaw)
      ? Number(maxAgeRaw)
      : 1800;
  // TDD enforcement now follows the same single strictness knob — keeping the
  // distinct local binding so the downstream block rules stay self-documenting.
  const tddEnforcement = mode;

  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const guardStateFile = path.join(stateDir, "workflow-guard.json");
  const guardLogFile = path.join(stateDir, "workflow-guard.jsonl");
  const flowState = await readFlowState(runtime.root);
  const currentStage = flowState.currentStage;
  const currentRun = flowState.activeRunId || "active";
  const reviewArmyFile = path.join(runtime.root, RUNTIME_ROOT, "artifacts", "07-review-army.json");
  const ironLaws = await readJsonFile(path.join(stateDir, "iron-laws.json"), {});
  const strictLaws = strictLawSet(ironLaws);

  const { tool, payload, payloadText } = extractToolAndPayload(runtime.inputData, runtime.inputRaw);
  const toolLower = toLower(tool);
  const payloadLower = toLower(payloadText);
  const payloadPaths = [...collectPaths(runtime.inputData)].filter((value) => typeof value === "string");
  const reasons = [];
  let missingRedPaths = [];

  const targetStage = detectTargetStage(payloadLower);
  const flowCommandInvoked = isFlowProgressionCommand(payloadLower);

  if (targetStage.length > 0 && currentStage !== "none") {
    const currentIndex = stageIndex(currentStage);
    const targetIndex = stageIndex(targetStage);
    if (currentIndex > 0 && targetIndex > 0 && targetIndex > currentIndex + 1) {
      reasons.push("stage_jump_" + currentStage + "_to_" + targetStage);
    }
  }

  if (isMutatingTool(toolLower) && /\\.cclaw\\/state\\/flow-state\\.json/u.test(payloadLower)) {
    reasons.push("direct_flow_state_edit");
  }

  if (isPreimplementationStage(currentStage) && isMutatingTool(toolLower)) {
    if (!/\\.cclaw\\//u.test(payloadLower)) {
      reasons.push("implementation_write_before_" + currentStage + "_completion");
    }
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  const guardState = toObject(await readJsonFile(guardStateFile, {})) || {};
  const lastFlowReadAtEpoch =
    typeof guardState.lastFlowReadAtEpoch === "number" && Number.isFinite(guardState.lastFlowReadAtEpoch)
      ? Math.trunc(guardState.lastFlowReadAtEpoch)
      : 0;
  const staleFlowRead =
    lastFlowReadAtEpoch <= 0 || nowEpoch - lastFlowReadAtEpoch > maxAgeSec;

  if (isMutatingTool(toolLower) && staleFlowRead) {
    reasons.push("mutating_without_recent_flow_read");
  }
  if ((targetStage.length > 0 || flowCommandInvoked) && staleFlowRead) {
    reasons.push("stage_invocation_without_recent_flow_read");
  }

  const shouldRecordFlowRead =
    /^(read|readfile|open|view|cat|shell|runcommand|run_command|execcommand|exec_command|terminal)$/u.test(
      toolLower
    ) &&
    /(\\.cclaw\\/state\\/flow-state\\.json|npx cclaw-cli sync|npx cclaw-cli sync|npx cclaw-cli sync|cclaw sync)/u.test(payloadLower);
  if (shouldRecordFlowRead) {
    await writeJsonFile(guardStateFile, {
      ...guardState,
      lastFlowReadAt: new Date().toISOString(),
      lastFlowReadAtEpoch: nowEpoch
    });
  }

  const testPatterns = DEFAULT_TDD_TEST_PATH_PATTERNS;
  const productionPatterns = DEFAULT_TDD_PRODUCTION_PATH_PATTERNS;

  if (currentStage === "tdd" && isMutatingTool(toolLower)) {
    const productionPaths = payloadPaths.filter((rawPath) =>
      isProductionPath(rawPath, testPatterns, productionPatterns)
    );
    if (productionPaths.length > 0) {
      for (const productionPath of productionPaths) {
        const hasRed = await hasFailingRedEvidenceForPath(stateDir, currentRun, productionPath);
        if (!hasRed) {
          missingRedPaths.push(productionPath);
        }
      }
      if (missingRedPaths.length > 0) {
        reasons.push("tdd_write_without_red_for_path");
      }
    } else if (productionPatterns.length === 0 && !isTestPayload(payloadLower, payloadPaths, testPatterns)) {
      // Slice-aware fallback: the previous implementation used a flat
      // red/green count which said "ok" as long as the totals balanced
      // across ALL slices, so a closed S-1 could unlock production
      // writes that actually belonged to a new, not-yet-red S-2. Now
      // we reuse the canonical Ralph Loop status: if NO slice has an
      // open RED, we block.
      const internalRalph = await runCclawInternal(
        runtime.root,
        ["tdd-loop-status", "--json", "--no-write"],
        { captureStdout: true }
      );
      const ralphStatus = parseJsonStdoutObject(internalRalph);
      const redOpen = internalRalph.code === 0 && ralphStatus?.redOpen === true;
      if (!redOpen) {
        reasons.push("tdd_write_without_open_red");
      }
    }
  }

  if (isPreimplementationStage(currentStage) && !isPlanModeSafeTool(toolLower)) {
    if (!isMutatingTool(toolLower) && !/\\.cclaw\\//u.test(payloadLower) && !isCclawCliPayload(payloadLower)) {
      reasons.push("non_safe_tool_in_plan_stage_" + currentStage);
    }
  }

  if (currentStage === "ship" && isExecutionOrMutatingTool(toolLower)) {
    if (/(npm publish|pnpm publish|yarn publish|gh release create|git push\\s+.*--tags|npm version)/u.test(payloadLower)) {
      const shipGate = toObject((toObject(flowState.raw.stageGateCatalog) || {}).ship) || {};
      const passed = Array.isArray(shipGate.passed) ? shipGate.passed : [];
      if (!passed.includes("ship_preflight_passed")) {
        reasons.push("ship_preflight_required");
      }
      const reviewArmy = await readJsonFile(reviewArmyFile, {});
      if (!reviewCoverageComplete(reviewArmy)) {
        reasons.push("ship_review_coverage_required");
      }
    }
  }

  if (isMutatingTool(toolLower) && /\\.cclaw\\/(state|hooks|skills)/u.test(payloadLower)) {
    if (!isCclawCliPayload(payloadLower)) {
      reasons.push("runtime_write_requires_managed_only");
    }
  }

  if (reasons.length > 0) {
    let note =
      "Cclaw workflow guard: detected potential flow violation (" +
      reasons.join(",") +
      "). Re-read " +
      RUNTIME_ROOT +
      "/state/flow-state.json and align with stage constraints.";
    if (reasons.includes("tdd_write_without_red_for_path")) {
      note =
        "Cclaw workflow guard: missing failing RED evidence for production path(s): " +
        (missingRedPaths.length > 0 ? missingRedPaths.join(", ") : "unknown") +
        ". Log failing tests before touching these files.";
    } else if (reasons.includes("tdd_write_without_open_red")) {
      note =
        "Cclaw workflow guard: Write a failing test first before editing production files during tdd stage.";
    } else if (reasons.includes("ship_preflight_required")) {
      note =
        "Cclaw workflow guard: ship finalization command detected before ship_preflight_passed gate.";
    } else if (reasons.includes("ship_review_coverage_required")) {
      note =
        "Cclaw workflow guard: ship finalization requires complete review layer coverage in 07-review-army.json.";
    } else if (reasons.includes("mutating_without_recent_flow_read")) {
      note =
        "Cclaw workflow guard: mutating action requires a fresh read of " +
        RUNTIME_ROOT +
        "/state/flow-state.json before edits.";
    }

    await appendJsonLine(guardLogFile, {
      ts: new Date().toISOString(),
      tool,
      currentStage,
      targetStage,
      reasons,
      note
    });

    let shouldBlock = false;
    if (mode === "strict") shouldBlock = true;
    if (
      (reasons.includes("tdd_write_without_open_red") || reasons.includes("tdd_write_without_red_for_path")) &&
      tddEnforcement === "strict"
    ) {
      shouldBlock = true;
    }
    if (
      (reasons.includes("tdd_write_without_open_red") || reasons.includes("tdd_write_without_red_for_path")) &&
      lawIsStrict(strictLaws, "tdd-red-before-write")
    ) {
      shouldBlock = true;
    }
    if (reasons.includes("ship_preflight_required") && lawIsStrict(strictLaws, "ship-preflight-required")) {
      shouldBlock = true;
    }
    if (
      reasons.includes("ship_review_coverage_required") &&
      lawIsStrict(strictLaws, "review-coverage-complete-before-ship")
    ) {
      shouldBlock = true;
    }

    if (shouldBlock) {
      emitAdvisoryContext(runtime, "workflow-guard", note + " Blocked by workflow guard.");
      process.stderr.write("[cclaw] " + note + " (blocked by workflow guard)\\n");
      return 1;
    }
    emitAdvisoryContext(runtime, "workflow-guard", note);
    process.stderr.write("[cclaw] " + note + "\\n");
  }

  return 0;
}

async function handleContextMonitor(runtime) {
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const monitorStateFile = path.join(stateDir, "context-monitor.json");
  const autoEvidenceFile = path.join(stateDir, "tdd-red-evidence.jsonl");
  const flowState = await readFlowState(runtime.root);

  const command = extractCommandFromPayload(runtime.inputData);
  const exitCode = extractExitCodeFromPayload(runtime.inputData);
  const commandLower = toLower(command);
  if (
    flowState.currentStage === "tdd" &&
    command.length > 0 &&
    exitCode !== null &&
    exitCode !== 0 &&
    /(npm test|npm run test|pnpm test|pnpm run test|yarn test|bun test|vitest|jest|pytest|go test|cargo test|mvn test|gradle test|dotnet test)/u.test(
      commandLower
    )
  ) {
    const textBlob = extractTextBlobs(runtime.inputData) + "\\n" + command;
    const paths = extractCodePathsFromText(textBlob);
    await appendJsonLine(autoEvidenceFile, {
      ts: new Date().toISOString(),
      runId: flowState.activeRunId || "active",
      stage: "tdd",
      source: "posttool-auto",
      command,
      tool: normalizeToolName(
        (toObject(runtime.inputData) || {}).tool_name ??
          (toObject(runtime.inputData) || {}).tool ??
          (toObject(toObject(runtime.inputData)?.input) || {}).tool ??
          ""
      ),
      exitCode,
      paths
    });
  }

  const remainingPercent = extractRemainingPercent(runtime.inputData);
  if (remainingPercent === null) return 0;

  let band = "none";
  if (remainingPercent <= 20) {
    band = "critical";
  } else if (remainingPercent <= 35) {
    band = "warning";
  }

  const ttlRaw = process.env.CCLAW_CONTEXT_MONITOR_TTL_SEC;
  const ttlSeconds =
    typeof ttlRaw === "string" && /^[0-9]+$/u.test(ttlRaw) ? Number(ttlRaw) : 900;
  const now = new Date();
  const nowEpoch = Math.floor(now.getTime() / 1000);
  const monitorState = toObject(await readJsonFile(monitorStateFile, {})) || {};
  const lastBand = typeof monitorState.lastBand === "string" ? monitorState.lastBand : "none";
  const lastAdvisoryBand =
    typeof monitorState.lastAdvisoryBand === "string"
      ? monitorState.lastAdvisoryBand
      : lastBand;
  const lastAdvisoryAt =
    typeof monitorState.lastAdvisoryAt === "string" ? monitorState.lastAdvisoryAt : "";
  const lastAdvisoryEpoch = lastAdvisoryAt.length > 0
    ? Math.floor(Date.parse(lastAdvisoryAt) / 1000) || 0
    : 0;

  let shouldEmit = false;
  if (band !== "none") {
    if (band !== lastAdvisoryBand) {
      shouldEmit = true;
    } else if (ttlSeconds === 0) {
      shouldEmit = true;
    } else if (nowEpoch - lastAdvisoryEpoch >= ttlSeconds) {
      shouldEmit = true;
    }
  }

  let nextAdvisoryBand = lastAdvisoryBand;
  let nextAdvisoryAt = lastAdvisoryAt;
  if (shouldEmit) {
    const note =
      "Cclaw advisory: context remaining is " +
      String(remainingPercent.toFixed(2)) +
      "% (" +
      band +
      "). Consider leaving a handoff note or compacting soon.";
    emitAdvisoryContext(runtime, "context-monitor", note);
    process.stderr.write("[cclaw] " + note + "\\n");
    nextAdvisoryBand = band;
    nextAdvisoryAt = now.toISOString();
  }

  await writeJsonFile(monitorStateFile, {
    lastUpdated: now.toISOString(),
    lastBand: band,
    lastRemainingPercent: remainingPercent,
    harness: runtime.harness,
    lastAdvisoryBand: nextAdvisoryBand,
    lastAdvisoryAt: nextAdvisoryAt
  });
  return 0;
}

async function handleVerifyCurrentState(runtime) {
  const mode = resolveStrictness();
  const result = await runCclawInternal(runtime.root, ["verify-current-state", "--quiet"]);
  if (result.missingBinary) {
    const message = result.stderr.trim().length > 0
      ? result.stderr.trim()
      : "Cclaw verify-current-state requires a local Node runtime entrypoint.";
    emitAdvisoryContext(runtime, "verify-current-state", message);
    process.stderr.write(result.stderr.trim().length > 0
      ? result.stderr
      : "[cclaw] hook: local Node runtime entrypoint is required for verify-current-state\\n");
    return mode === "strict" ? 1 : 0;
  }
  if (mode === "strict") {
    if (result.code !== 0) {
      emitAdvisoryContext(
        runtime,
        "verify-current-state",
        result.stderr.trim().length > 0
          ? result.stderr.trim()
          : "Cclaw verify-current-state failed in strict mode."
      );
    }
    if (result.code !== 0 && result.stderr.trim().length > 0) {
      process.stderr.write(result.stderr);
    }
    return result.code === 0 ? 0 : 1;
  }
  return 0;
}

async function handlePreToolPipeline(runtime) {
  const promptExitCode = await handlePromptGuard(runtime);
  if (promptExitCode !== 0) {
    return promptExitCode;
  }
  return await handleWorkflowGuard(runtime);
}

async function handlePromptPipeline(runtime) {
  const promptExitCode = await handlePromptGuard(runtime);
  if (promptExitCode !== 0) {
    return promptExitCode;
  }
  const verifyExitCode = await handleVerifyCurrentState(runtime);
  if (verifyExitCode !== 0) {
    return verifyExitCode;
  }
  runtime.writeJson({ ok: true });
  return 0;
}

function normalizeHookName(rawName) {
  const value = normalizeText(rawName).toLowerCase();
  if (value === "session-start") return "session-start";
  if (value === "session-start-refresh") return "session-start-refresh";
  if (value === "stop-handoff" || value === "stop") return "stop-handoff";
  if (value === "stop-checkpoint") return "stop-handoff";
  if (value === "session-rehydrate") return "session-start";
  if (value === "prompt-guard") return "prompt-guard";
  if (value === "workflow-guard") return "workflow-guard";
  if (value === "pre-tool-pipeline" || value === "pretool-pipeline") return "pre-tool-pipeline";
  if (value === "prompt-pipeline" || value === "promptpipeline") return "prompt-pipeline";
  if (value === "context-monitor") return "context-monitor";
  if (value === "verify-current-state") return "verify-current-state";
  return "";
}

async function main() {
  const hookName = normalizeHookName(process.argv[2] || "");
  if (!hookName) {
    process.stderr.write(
      "[cclaw] run-hook: usage: node " +
        RUNTIME_ROOT +
        "/hooks/run-hook.mjs <session-start|session-start-refresh|stop-handoff|prompt-guard|workflow-guard|pre-tool-pipeline|prompt-pipeline|context-monitor|verify-current-state>\\n"
    );
    process.exitCode = 1;
    return;
  }

  const harness = detectHarness(process.env);
  const { root, foundRuntime } = await detectRoot(process.env);
  if (!foundRuntime) {
    // No .cclaw/ runtime in any candidate root — this directory is not
    // initialized for cclaw. Exit 0 silently so hooks never block harnesses
    // that run in unrelated repos; users initialize with \`cclaw init\`.
    process.exitCode = 0;
    return;
  }
  const inputRaw = await readStdin();
  const inputData = safeParseJson(inputRaw, {});
  const runtime = {
    harness,
    root,
    inputRaw,
    inputData,
    writeJson(value) {
      process.stdout.write(JSON.stringify(value) + "\\n");
    }
  };

  try {
    if (hookName === "session-start") {
      process.exitCode = await handleSessionStart(runtime);
      return;
    }
    if (hookName === "session-start-refresh") {
      process.exitCode = await handleSessionStartRefresh(runtime);
      return;
    }
    if (hookName === "stop-handoff") {
      process.exitCode = await handleStopHandoff(runtime);
      return;
    }
    if (hookName === "prompt-guard") {
      process.exitCode = await handlePromptGuard(runtime);
      return;
    }
    if (hookName === "workflow-guard") {
      process.exitCode = await handleWorkflowGuard(runtime);
      return;
    }
    if (hookName === "pre-tool-pipeline") {
      process.exitCode = await handlePreToolPipeline(runtime);
      return;
    }
    if (hookName === "prompt-pipeline") {
      process.exitCode = await handlePromptPipeline(runtime);
      return;
    }
    if (hookName === "context-monitor") {
      process.exitCode = await handleContextMonitor(runtime);
      return;
    }
    if (hookName === "verify-current-state") {
      process.exitCode = await handleVerifyCurrentState(runtime);
      return;
    }
    process.stderr.write("[cclaw] run-hook: unsupported hook " + hookName + "\\n");
    process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      "[cclaw] run-hook: " +
        hookName +
        " failed: " +
        (error instanceof Error ? error.message : String(error)) +
        "\\n"
    );
    process.exitCode = 1;
  }
}

void main();
`;
}
