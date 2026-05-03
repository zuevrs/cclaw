import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ROOT } from "../constants.js";
import {
  SHARED_FLOW_AND_KNOWLEDGE_SNIPPETS,
  SHARED_STAGE_SUPPORT_SNIPPETS
} from "./runtime-shared-snippets.js";

export interface NodeHookRuntimeOptions {}

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
  void options;
  const defaultHookProfile = "standard";
  const defaultDisabledHooks: string[] = [];
  const cliRuntime = resolveCliRuntimeForGeneratedHook();

  return `#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const FLOW_STATE_GUARD_REL_PATH = RUNTIME_ROOT + "/.flow-state.guard.json";
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliRuntime.entrypoint)};
const CCLAW_CLI_ARGS_PREFIX = ${JSON.stringify(cliRuntime.argsPrefix)};
const DEFAULT_HOOK_PROFILE = ${JSON.stringify(defaultHookProfile)};
const DEFAULT_DISABLED_HOOKS = ${JSON.stringify(defaultDisabledHooks)};
const HOOK_PROFILE_VALUES = new Set(["minimal", "standard", "strict"]);
const MINIMAL_PROFILE_ALLOWED_HOOKS = new Set([
  "session-start",
  "stop-handoff"
]);

${SHARED_FLOW_AND_KNOWLEDGE_SNIPPETS}
${SHARED_STAGE_SUPPORT_SNIPPETS}

function normalizeHookToken(value) {
  return String(value == null ? "" : value).trim().toLowerCase();
}

function parseHookProfile(rawValue, fallback = "standard") {
  const normalized = normalizeHookToken(rawValue);
  if (HOOK_PROFILE_VALUES.has(normalized)) return normalized;
  return fallback;
}

function parseDisabledHooksCsv(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue : "";
  if (raw.trim().length === 0) return [];
  const out = [];
  for (const token of raw.split(",")) {
    const normalized = normalizeHookToken(token);
    if (normalized.length === 0) continue;
    if (!out.includes(normalized)) out.push(normalized);
  }
  return out;
}

function parseInlineYamlList(rawValue) {
  const raw = typeof rawValue === "string" ? rawValue.trim() : "";
  if (!raw.startsWith("[") || !raw.endsWith("]")) return [];
  const inside = raw.slice(1, -1).trim();
  if (inside.length === 0) return [];
  return inside.split(",").map((token) => normalizeHookToken(token.replace(/^['"]|['"]$/g, ""))).filter((token) => token.length > 0);
}

function parseConfigHookProfile(rawYaml) {
  if (typeof rawYaml !== "string" || rawYaml.trim().length === 0) {
    return "";
  }
  const match = rawYaml.match(/^\\s*hookProfile\\s*:\\s*([A-Za-z0-9_-]+)\\s*$/m);
  if (!match || typeof match[1] !== "string") return "";
  return parseHookProfile(match[1], "");
}

function parseConfigDisabledHooks(rawYaml) {
  if (typeof rawYaml !== "string" || rawYaml.trim().length === 0) {
    return [];
  }
  const lines = rawYaml.split(/\\r?\\n/u);
  const out = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const inlineMatch = line.match(/^\\s*disabledHooks\\s*:\\s*(\\[[^\\]]*\\])\\s*$/u);
    if (inlineMatch) {
      for (const value of parseInlineYamlList(inlineMatch[1])) {
        if (!out.includes(value)) out.push(value);
      }
      continue;
    }
    const blockMatch = line.match(/^(\\s*)disabledHooks\\s*:\\s*$/u);
    if (!blockMatch) continue;
    const baseIndent = blockMatch[1] ? blockMatch[1].length : 0;
    for (let j = i + 1; j < lines.length; j += 1) {
      const nextLine = lines[j];
      const indent = (nextLine.match(/^(\\s*)/u)?.[1].length ?? 0);
      const trimmed = nextLine.trim();
      if (trimmed.length === 0) continue;
      if (indent <= baseIndent) break;
      const itemMatch = nextLine.match(/^\\s*-\\s*(.+?)\\s*$/u);
      if (!itemMatch) continue;
      const normalized = normalizeHookToken(itemMatch[1].replace(/^['"]|['"]$/g, ""));
      if (normalized.length === 0) continue;
      if (!out.includes(normalized)) out.push(normalized);
    }
  }
  return out;
}

async function readConfigHookPolicy(root) {
  const configPath = path.join(root, RUNTIME_ROOT, "config.yaml");
  const raw = await readTextFile(configPath, "");
  const profile = parseConfigHookProfile(raw);
  const disabledHooks = parseConfigDisabledHooks(raw);
  return { profile, disabledHooks };
}

async function resolveHookPolicy(root) {
  const fromConfig = await readConfigHookPolicy(root);
  const configProfile = parseHookProfile(fromConfig.profile, DEFAULT_HOOK_PROFILE);
  const configDisabledHooks = Array.isArray(fromConfig.disabledHooks) && fromConfig.disabledHooks.length > 0
    ? fromConfig.disabledHooks
    : DEFAULT_DISABLED_HOOKS;

  const envProfileRaw = process.env.CCLAW_HOOK_PROFILE;
  const envProfile = parseHookProfile(envProfileRaw, "");
  const profile = envProfile.length > 0 ? envProfile : configProfile;

  const envDisabledRaw = process.env.CCLAW_DISABLED_HOOKS;
  const envDisabledHooks = parseDisabledHooksCsv(envDisabledRaw);
  const disabledHooks = envDisabledHooks.length > 0 ? envDisabledHooks : configDisabledHooks;
  const disabled = new Set(disabledHooks.map((value) => normalizeHookToken(value)));
  return { profile, disabled };
}

function hookDisabledByProfile(profile, hookName) {
  if (profile !== "minimal") return false;
  return !MINIMAL_PROFILE_ALLOWED_HOOKS.has(hookName);
}

function isHookDisabled(policy, hookName) {
  if (policy.disabled.has(hookName)) return true;
  return hookDisabledByProfile(policy.profile, hookName);
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

function detectHarness(env) {
  if (env.CLAUDE_PROJECT_DIR) return "claude";
  if (env.CURSOR_PROJECT_DIR || env.CURSOR_PROJECT_ROOT) return "cursor";
  if (env.OPENCODE_PROJECT_DIR || env.OPENCODE_PROJECT_ROOT) return "opencode";
  return "codex";
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

function normalizeText(value) {
  return String(value || "").replace(/\\s+/gu, " ").trim();
}

async function verifyFlowStateGuardInline(root, hookName) {
  const statePath = path.join(root, RUNTIME_ROOT, "state", "flow-state.json");
  const guardPath = path.join(root, FLOW_STATE_GUARD_REL_PATH);
  let raw;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch {
    return true;
  }
  let guard;
  try {
    const guardRaw = await fs.readFile(guardPath, "utf8");
    guard = JSON.parse(guardRaw);
  } catch {
    return true;
  }
  if (!guard || typeof guard !== "object" || typeof guard.sha256 !== "string") {
    return true;
  }
  const actual = createHash("sha256").update(raw, "utf8").digest("hex");
  if (actual === guard.sha256) return true;
  const hookLabel = typeof hookName === "string" && hookName.length > 0 ? hookName : "hook";
  process.stderr.write(
    "[cclaw] " + hookLabel + ": flow-state guard mismatch: " + (guard.runId || "unknown-run") + "\\n" +
      "expected sha: " + guard.sha256 + "\\n" +
      "actual sha:   " + actual + "\\n" +
      "last writer:  " + (guard.writerSubsystem || "unknown") + "@" + (guard.writtenAt || "unknown") + "\\n" +
      "do not edit flow-state.json by hand. To recover, run:\\n" +
      "  cclaw-cli internal flow-state-repair --reason \\"manual_edit_recovery\\"\\n"
  );
  await recordHookError(root, hookLabel, "flow-state guard mismatch actual=" + actual + " expected=" + guard.sha256).catch(() => undefined);
  return false;
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

  // Wave 21 honest-core: session-start no longer runs background helper
  // pipelines or digest caches. It rehydrates flow + knowledge only.
  const ralphLoopLine = "";
  const earlyLoopLine = "";
  const compoundReadinessLine = "";
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
  const ironLawsSkillFile = path.join(runtime.root, RUNTIME_ROOT, "skills", "iron-laws", "SKILL.md");
  const ironLawsContent = (await readTextFile(ironLawsSkillFile, "")).trim();
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
  if (metaContent.length > 0) {
    parts.push(metaContent);
  }
  // v6.9.0: load iron-laws content into the session-start digest so the
  // non-negotiable workflow constraints are visible from the first turn,
  // not lazily on tool dispatch.
  if (ironLawsContent.length > 0) {
    parts.push(ironLawsContent);
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

const STOP_BLOCK_LIMIT_PER_TRANSCRIPT = 2;

function asBoolean(value) {
  if (value === true || value === false) return value;
  if (typeof value === "number") return Number.isFinite(value) && value !== 0;
  if (typeof value !== "string") return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return ["1", "true", "yes", "on"].includes(normalized);
}

function stringTokenHit(value, tokens) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized.length === 0) return false;
  return tokens.some((token) => normalized.includes(token));
}

function sanitizeStopSessionKey(raw) {
  const normalized = normalizeText(raw)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return normalized.length > 0 ? normalized.slice(0, 96) : "global";
}

function extractStopSignals(input, fallbackSessionKey) {
  const event = toObject(input.event) || {};
  const session = toObject(input.session) || {};
  const contextLimit =
    asBoolean(input.context_limit) ||
    asBoolean(input.contextLimit) ||
    asBoolean(event.context_limit) ||
    asBoolean(event.contextLimit) ||
    stringTokenHit(input.reason, ["context_limit", "context limit"]) ||
    stringTokenHit(event.reason, ["context_limit", "context limit"]) ||
    stringTokenHit(input.stop_reason, ["context_limit", "context limit"]) ||
    stringTokenHit(event.stop_reason, ["context_limit", "context limit"]);
  const userAbort =
    asBoolean(input.user_abort) ||
    asBoolean(input.userAbort) ||
    asBoolean(input.user_cancelled) ||
    asBoolean(input.userCancelled) ||
    asBoolean(event.user_abort) ||
    asBoolean(event.userAbort) ||
    stringTokenHit(input.reason, ["user_abort", "user abort", "cancelled by user", "stop button", "ctrl+c"]) ||
    stringTokenHit(event.reason, ["user_abort", "user abort", "cancelled by user", "stop button", "ctrl+c"]) ||
    stringTokenHit(input.stop_reason, ["user_abort", "user abort", "cancelled by user", "stop button", "ctrl+c"]) ||
    stringTokenHit(event.stop_reason, ["user_abort", "user abort", "cancelled by user", "stop button", "ctrl+c"]);
  const stopHookActive =
    asBoolean(input.stop_hook_active) ||
    asBoolean(input.stopHookActive) ||
    asBoolean(event.stop_hook_active) ||
    asBoolean(event.stopHookActive);

  const sessionKeyCandidate =
    (typeof input.transcript_id === "string" && input.transcript_id) ||
    (typeof input.transcriptId === "string" && input.transcriptId) ||
    (typeof input.session_id === "string" && input.session_id) ||
    (typeof input.sessionId === "string" && input.sessionId) ||
    (typeof session.id === "string" && session.id) ||
    fallbackSessionKey;
  const sessionKey = sanitizeStopSessionKey(sessionKeyCandidate);

  return {
    contextLimit,
    userAbort,
    stopHookActive,
    sessionKey
  };
}

async function handleStopHandoff(runtime) {
  const state = await readFlowState(runtime.root);
  const stateDir = path.join(runtime.root, RUNTIME_ROOT, "state");
  const input = toObject(runtime.inputData) || {};
  const loopCount =
    typeof input.loop_count === "number" && Number.isFinite(input.loop_count)
      ? Math.trunc(input.loop_count)
      : 0;

  const dirtyState = await isGitDirty(runtime.root);
  const stopSignals = extractStopSignals(input, "run-" + state.activeRunId);
  const safetyBypassActive = stopSignals.stopHookActive || stopSignals.userAbort || stopSignals.contextLimit;
  if (dirtyState === "dirty" && !safetyBypassActive) {
    const stopBlocksPath = path.join(stateDir, "stop-blocks-" + stopSignals.sessionKey + ".json");
    const prior = toObject(await readJsonFile(stopBlocksPath, {})) || {};
    const priorCount =
      typeof prior.blockCount === "number" && Number.isFinite(prior.blockCount)
        ? Math.max(0, Math.trunc(prior.blockCount))
        : 0;
    if (priorCount < STOP_BLOCK_LIMIT_PER_TRANSCRIPT) {
      const nextCount = priorCount + 1;
      await writeJsonFile(stopBlocksPath, {
        schemaVersion: 1,
        sessionKey: stopSignals.sessionKey,
        blockCount: nextCount,
        updatedAt: new Date().toISOString()
      });
      process.stderr.write(
        '[cclaw] Stop blocked by iron law "stop-clean-or-handoff": working tree is dirty. Commit/revert changes or record blockers in the current artifact before ending the session.\\n'
      );
      return 1;
    }
    process.stderr.write(
      '[cclaw] Stop advisory: dirty working tree detected, but block limit reached for this transcript (max 2). Continuing with handoff reminder only.\\n'
    );
  } else if (dirtyState === "dirty" && safetyBypassActive) {
    const reason = stopSignals.stopHookActive
      ? "stop_hook_active"
      : stopSignals.userAbort
        ? "user_abort"
        : "context_limit";
    process.stderr.write(
      "[cclaw] Stop advisory: bypassing strict stop block due to safety rule (" + reason + ").\\n"
    );
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

function normalizeHookName(rawName) {
  const value = normalizeText(rawName).toLowerCase();
  if (value === "session-start") return "session-start";
  if (value === "stop-handoff" || value === "stop") return "stop-handoff";
  if (value === "stop-checkpoint") return "stop-handoff";
  if (value === "session-rehydrate") return "session-start";
  return "";
}

async function main() {
  const hookName = normalizeHookName(process.argv[2] || "");
  if (!hookName) {
    process.stderr.write(
      "[cclaw] run-hook: usage: node " +
        RUNTIME_ROOT +
        "/hooks/run-hook.mjs <session-start|stop-handoff>\\n"
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
    const policy = await resolveHookPolicy(runtime.root);
    if (isHookDisabled(policy, hookName)) {
      // Honor CCLAW_HOOK_PROFILE / CCLAW_DISABLED_HOOKS / config disabledHooks.
      // Disabled hooks must exit 0 quietly so harnesses keep running.
      process.exitCode = 0;
      return;
    }
    if (hookName === "session-start" || hookName === "stop-handoff") {
      const guardOk = await verifyFlowStateGuardInline(runtime.root, hookName);
      if (!guardOk) {
        process.exitCode = 2;
        return;
      }
    }
    if (hookName === "session-start") {
      process.exitCode = await handleSessionStart(runtime);
      return;
    }
    if (hookName === "stop-handoff") {
      process.exitCode = await handleStopHandoff(runtime);
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
