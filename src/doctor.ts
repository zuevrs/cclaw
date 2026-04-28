import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { REQUIRED_DIRS, RUNTIME_ROOT } from "./constants.js";
import { CCLAW_AGENTS } from "./content/core-agents.js";
import { detectAdvancedKeys, InvalidConfigError, readConfig } from "./config.js";
import { exists } from "./fs-utils.js";
import { gitignoreHasRequiredPatterns } from "./gitignore.js";
import {
  HARNESS_ADAPTERS,
  CCLAW_MARKER_START,
  CCLAW_MARKER_END,
  harnessShimFileNames,
  harnessShimSkillNames
} from "./harness-adapters.js";
import { policyChecks } from "./policy.js";
import { CorruptFlowStateError, readFlowState } from "./runs.js";
import { createInitialFlowState, skippedStagesForTrack } from "./flow-state.js";
import { FLOW_STAGES, TRACK_STAGES, type FlowStage } from "./types.js";
import { checkMandatoryDelegations, readDelegationEvents } from "./delegation.js";
import { buildTraceMatrix } from "./trace-matrix.js";
import {
  classifyReconciliationNotices,
  reconcileAndWriteCurrentStageGateCatalog,
  readReconciliationNotices,
  RECONCILIATION_NOTICES_REL_PATH,
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "./gate-evidence.js";
import { parseTddCycleLog, validateTddCycleOrder } from "./tdd-cycle.js";
import { stageSkillFolder } from "./content/skills.js";
import { stageCommandShimMarkdown } from "./content/stage-command.js";
import { doctorCheckMetadata } from "./doctor-registry.js";
import { resolveTrackFromPrompt } from "./track-heuristics.js";
import {
  classifyCodexHooksFlag,
  codexConfigPath,
  readCodexConfig,
  type CodexHooksFlagState
} from "./codex-feature-flag.js";
import {
  LANGUAGE_RULE_PACK_DIR,
  LANGUAGE_RULE_PACK_FILES,
  LEGACY_LANGUAGE_RULE_PACK_FOLDERS
} from "./content/utility-skills.js";
import { validateHookDocument } from "./hook-schema.js";
import { HOOK_EVENTS_BY_HARNESS } from "./content/hook-events.js";
import { validateKnowledgeEntry } from "./knowledge-store.js";
import { readSeedShelf } from "./content/seed-shelf.js";
import { evaluateRetroGate } from "./retro-gate.js";
import type { HarnessId } from "./types.js";
import type { DoctorSeverity } from "./doctor-registry.js";

const execFileAsync = promisify(execFile);

export interface DoctorCheck {
  name: string;
  ok: boolean;
  details: string;
  severity: DoctorSeverity;
  summary: string;
  fix: string;
  docRef?: string;
}

export interface DoctorOptions {
  /** When true, normalize current-stage gate catalog and persist reconciliation before checks. */
  reconcileCurrentStageGates?: boolean;
}

type PendingDoctorCheck = Omit<DoctorCheck, "severity" | "summary" | "fix" | "docRef"> &
  Partial<Pick<DoctorCheck, "severity" | "summary" | "fix" | "docRef">>;

async function isGitRepo(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

async function resolveGitHooksDir(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "--git-path", "hooks"], { cwd: projectRoot });
    const rel = stdout.trim();
    if (rel.length === 0) {
      return null;
    }
    return path.resolve(projectRoot, rel);
  } catch {
    return null;
  }
}

async function gitIgnoresRuntime(projectRoot: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "-q", `${RUNTIME_ROOT}/`], { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function collectHookCommands(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectHookCommands(item));
  }
  const obj = toObject(value);
  if (!obj) return [];
  const direct = typeof obj.command === "string" ? [obj.command] : [];
  const nested = collectHookCommands(obj.hooks);
  return [...direct, ...nested];
}

function extractGeneratedCliEntrypoints(scriptContent: string): string[] {
  const paths: string[] = [];
  for (const match of scriptContent.matchAll(/const\s+CCLAW_CLI_ENTRYPOINT\s*=\s*("(?:\\.|[^"\\])*"|null);/gu)) {
    const raw = match[1];
    if (!raw || raw === "null") continue;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed === "string" && parsed.trim().length > 0) {
        paths.push(parsed);
      }
    } catch {
      // malformed generated constant; treat below as missing/unusable
    }
  }
  return paths;
}

async function generatedCliEntrypointsOk(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const hookScripts = ["stage-complete.mjs", "start-flow.mjs", "run-hook.mjs"] as const;
  const problems: string[] = [];
  const checked: string[] = [];
  for (const script of hookScripts) {
    const scriptPath = path.join(projectRoot, RUNTIME_ROOT, "hooks", script);
    if (!(await exists(scriptPath))) continue;
    const content = await fs.readFile(scriptPath, "utf8");
    const entrypoints = extractGeneratedCliEntrypoints(content);
    if (entrypoints.length === 0) {
      problems.push(`${RUNTIME_ROOT}/hooks/${script} has no local CLI entrypoint`);
      continue;
    }
    for (const entrypoint of entrypoints) {
      checked.push(`${RUNTIME_ROOT}/hooks/${script} -> ${entrypoint}`);
      try {
        const stat = await fs.stat(entrypoint);
        if (!stat.isFile()) {
          problems.push(`${RUNTIME_ROOT}/hooks/${script} points to non-file ${entrypoint}`);
        }
      } catch {
        problems.push(`${RUNTIME_ROOT}/hooks/${script} points to missing ${entrypoint}`);
      }
    }
  }
  if (problems.length > 0) {
    return { ok: false, details: problems.join("; ") };
  }
  return {
    ok: true,
    details: checked.length > 0
      ? `local CLI entrypoints valid: ${checked.join("; ")}`
      : "local CLI entrypoint check skipped because generated hook scripts are absent"
  };
}

function expectedArtifactPrefix(stage: FlowStage): string {
  const index = FLOW_STAGES.indexOf(stage);
  return `${String(index + 1).padStart(2, "0")}-`;
}

function artifactStageFromFileName(fileName: string): FlowStage | null {
  if (!fileName.endsWith(".md")) return null;
  for (const stage of FLOW_STAGES) {
    if (fileName.startsWith(expectedArtifactPrefix(stage))) {
      return stage;
    }
  }
  return null;
}

function extractUserPromptFromIdeaArtifact(markdown: string): string | null {
  const normalized = markdown.replace(/\r\n?/gu, "\n");
  const heading = /^##\s+User prompt\s*$/imu.exec(normalized);
  if (!heading || heading.index === undefined) {
    return null;
  }
  const sectionStart = heading.index + heading[0].length;
  const tail = normalized.slice(sectionStart).replace(/^\s*\n/gu, "");
  const nextHeadingIndex = tail.search(/^##\s+/mu);
  const body = (nextHeadingIndex >= 0 ? tail.slice(0, nextHeadingIndex) : tail).trim();
  return body.length > 0 ? body : null;
}

function knowledgeRoutingSurfaceIsDiscoverable(content: string): boolean {
  const normalized = content.toLowerCase();
  if (!normalized.includes(".cclaw/knowledge.jsonl")) return false;
  if (!/\b(rule|pattern|lesson|compound)\b/u.test(normalized)) return false;
  return ["trigger", "action", "origin_run"].every((term) => normalized.includes(term));
}

async function commandAvailable(command: string): Promise<boolean> {
  const version = await commandVersion(command);
  return version.available;
}

async function commandVersion(
  command: string,
  args: string[] = ["--version"]
): Promise<{ available: boolean; output: string }> {
  try {
    if (process.platform === "win32") {
      await execFileAsync("where", [command]);
    }
    const { stdout, stderr } = await execFileAsync(command, args);
    return { available: true, output: `${stdout}${stderr}`.trim() };
  } catch {
    return { available: false, output: "" };
  }
}

function parseNodeMajor(versionOutput: string): number | null {
  const match = /v?(\d+)\./u.exec(versionOutput);
  if (!match) return null;
  return Number(match[1]);
}

function gitVersionLooksUsable(versionOutput: string): boolean {
  return /git version \d+\.\d+/iu.test(versionOutput);
}

function stripJsonCommentsOutsideStrings(input: string): string {
  let out = "";
  let i = 0;
  let inString = false;
  let escape = false;
  while (i < input.length) {
    const c = input[i]!;
    if (inString) {
      out += c;
      if (escape) {
        escape = false;
      } else if (c === "\\") {
        escape = true;
      } else if (c === "\"") {
        inString = false;
      }
      i += 1;
      continue;
    }
    if (c === "\"") {
      inString = true;
      out += c;
      i += 1;
      continue;
    }
    const next = input[i + 1];
    if (c === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") i += 1;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < input.length - 1 && !(input[i] === "*" && input[i + 1] === "/")) i += 1;
      i = Math.min(i + 2, input.length);
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function parseJsonLike(raw: string): unknown | null {
  try {
    return JSON.parse(raw);
  } catch {
    // fall through
  }
  try {
    const normalized = stripJsonCommentsOutsideStrings(raw).replace(/,\s*([}\]])/gu, "$1");
    return JSON.parse(normalized);
  } catch {
    return null;
  }
}

async function readHookDocument(filePath: string): Promise<Record<string, unknown> | null> {
  if (!(await exists(filePath))) return null;
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseJsonLike(raw);
    const obj = toObject(parsed);
    return obj ?? null;
  } catch {
    return null;
  }
}

async function readJsonObjectStatus(filePath: string): Promise<{
  exists: boolean;
  ok: boolean;
  error?: string;
}> {
  if (!(await exists(filePath))) {
    return { exists: false, ok: false, error: "file is missing" };
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, ok: false, error: "JSON root must be an object" };
    }
    return { exists: true, ok: true };
  } catch (error) {
    return {
      exists: true,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function readPermissionBits(filePath: string): Promise<number | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.mode & 0o777;
  } catch {
    return null;
  }
}

function normalizeOpenCodePluginEntry(entry: unknown): string | null {
  if (typeof entry === "string" && entry.trim().length > 0) return entry.trim();
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const obj = entry as Record<string, unknown>;
  for (const key of ["path", "src", "plugin"] as const) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function generatedAgentShape(content: string, kind: "opencode" | "codex", agentName: string): boolean {
  if (kind === "opencode") {
    return content.includes("mode: subagent") && content.includes(`# ${agentName}`) && content.includes("STRICT_RETURN_SCHEMA");
  }
  return content.includes(`name = "${agentName}"`) && content.includes("developer_instructions") && content.includes("STRICT_RETURN_SCHEMA");
}

function harnessRealityLabel(harness: HarnessId): string {
  const adapter = HARNESS_ADAPTERS[harness];
  const declaredSupport = adapter.capabilities.nativeSubagentDispatch;
  const runtimeLaunch = harness === "opencode" || harness === "codex" ? "prompt-level launch" : declaredSupport === "generic" ? "generic Task launch" : "native tool launch";
  const proofRequired = adapter.capabilities.subagentFallback === "native" ? "dispatchId+spanId+ack" : "evidenceRefs";
  const proofSource = harness === "opencode" ? ".opencode/agents + delegation-events.jsonl" : harness === "codex" ? ".codex/agents + delegation-events.jsonl" : ".cclaw/state/delegation-log.json";
  return `declaredSupport=${declaredSupport}; runtimeLaunch=${runtimeLaunch}; proofRequired=${proofRequired}; proofSource=${proofSource}`;
}

const OPENCODE_PLUGIN_REL_PATH = ".opencode/plugins/cclaw-plugin.mjs";

function opencodeConfigCandidates(projectRoot: string): string[] {
  return [
    path.join(projectRoot, "opencode.json"),
    path.join(projectRoot, "opencode.jsonc"),
    path.join(projectRoot, "oh-my-opencode.jsonc"),
    path.join(projectRoot, "oh-my-openagent.jsonc"),
    path.join(projectRoot, ".opencode/opencode.json"),
    path.join(projectRoot, ".opencode/opencode.jsonc"),
    path.join(projectRoot, ".opencode/oh-my-opencode.jsonc"),
    path.join(projectRoot, ".opencode/oh-my-openagent.jsonc")
  ];
}

function openCodeConfigRegistersPlugin(parsed: Record<string, unknown>): boolean {
  const plugins = Array.isArray(parsed.plugin) ? parsed.plugin : [];
  return plugins.some((entry) => normalizeOpenCodePluginEntry(entry) === OPENCODE_PLUGIN_REL_PATH);
}

async function opencodeRegistrationCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const mismatches: string[] = [];
  let foundAnyConfig = false;
  for (const configPath of opencodeConfigCandidates(projectRoot)) {
    if (!(await exists(configPath))) {
      continue;
    }
    foundAnyConfig = true;
    const parsed = await readHookDocument(configPath);
    if (!parsed) {
      mismatches.push(`${path.relative(projectRoot, configPath)} is unreadable or invalid JSON`);
      continue;
    }
    if (openCodeConfigRegistersPlugin(parsed)) {
      return { ok: true, details: `${path.relative(projectRoot, configPath)} registers ${OPENCODE_PLUGIN_REL_PATH}` };
    }
    mismatches.push(`${path.relative(projectRoot, configPath)} missing plugin ${OPENCODE_PLUGIN_REL_PATH}`);
  }

  if (foundAnyConfig) {
    return { ok: false, details: mismatches.join(" | ") };
  }
  return { ok: false, details: `No opencode.json/opencode.jsonc found with plugin ${OPENCODE_PLUGIN_REL_PATH}` };
}

async function opencodeQuestionPermissionCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const mismatches: string[] = [];
  for (const configPath of opencodeConfigCandidates(projectRoot)) {
    if (!(await exists(configPath))) continue;
    const parsed = await readHookDocument(configPath);
    if (!parsed || !openCodeConfigRegistersPlugin(parsed)) continue;
    const permission = toObject(parsed.permission) ?? {};
    if (permission.question === "allow") {
      return {
        ok: true,
        details: `${path.relative(projectRoot, configPath)} sets permission.question to "allow" for structured questions`
      };
    }
    mismatches.push(
      `${path.relative(projectRoot, configPath)} registers ${OPENCODE_PLUGIN_REL_PATH} but must set permission.question to "allow"`
    );
  }
  if (mismatches.length > 0) {
    return { ok: false, details: mismatches.join(" | ") };
  }
  return {
    ok: false,
    details: `No opencode config with ${OPENCODE_PLUGIN_REL_PATH} registration found; cannot verify permission.question = "allow"`
  };
}

function opencodeQuestionEnvCheck(): { ok: boolean; details: string } {
  if (process.env.OPENCODE_ENABLE_QUESTION_TOOL === "1") {
    return { ok: true, details: "OPENCODE_ENABLE_QUESTION_TOOL=1 is set for ACP question tooling" };
  }
  return {
    ok: false,
    details: "Set OPENCODE_ENABLE_QUESTION_TOOL=1 for OpenCode ACP clients so permission-gated structured questions can use the question tool."
  };
}

function codexFlagInactiveDetail(configPath: string, state: CodexHooksFlagState | "read-error", error?: unknown): string {
  if (state === "enabled") {
    return `codex_hooks feature flag is enabled in ${configPath}; Codex hooks are active.`;
  }
  if (state === "read-error") {
    return `Codex hooks are inactive: could not read ${configPath} (${error instanceof Error ? error.message : String(error)}).`;
  }
  if (state === "missing-file") {
    return `Codex hooks are inactive: ${configPath} does not exist; .codex/hooks.json is ignored until [features] codex_hooks = true is configured.`;
  }
  if (state === "missing-section") {
    return `Codex hooks are inactive: ${configPath} has no [features] section; add codex_hooks = true to activate configured hooks.`;
  }
  if (state === "missing-key") {
    return `Codex hooks are inactive: ${configPath} is missing codex_hooks under [features]; add codex_hooks = true to activate configured hooks.`;
  }
  return `Codex hooks are inactive: ${configPath} sets codex_hooks to a non-true value; set codex_hooks = true under [features].`;
}

function hookCommandsWithMatchers(value: unknown): Array<{ command: string; matcher?: string }> {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: Array<{ command: string; matcher?: string }> = [];
  for (const item of value) {
    const obj = toObject(item);
    if (!obj) continue;
    const matcher = typeof obj.matcher === "string" ? obj.matcher : undefined;
    if (typeof obj.command === "string") {
      out.push({ command: obj.command, matcher });
    }
    const nested = hookCommandsWithMatchers(obj.hooks);
    for (const child of nested) {
      out.push({ ...child, matcher: child.matcher ?? matcher });
    }
  }
  return out;
}

function commandHasHandler(entries: Array<{ command: string; matcher?: string }>, handler: string): boolean {
  return entries.some((entry) => entry.command.includes(`run-hook.cmd ${handler}`) || entry.command.includes(`run-hook.mjs ${handler}`));
}

function codexBashOnly(entries: Array<{ command: string; matcher?: string }>, handler: string): boolean {
  const matches = entries.filter((entry) => entry.command.includes(`run-hook.cmd ${handler}`) || entry.command.includes(`run-hook.mjs ${handler}`));
  return matches.length > 0 && matches.every((entry) => entry.matcher === "Bash|bash");
}

function codexStructuralWiringCheck(codexHooks: Record<string, unknown>): { ok: boolean; details: string } {
  const problems: string[] = [];
  const expectedSession = HOOK_EVENTS_BY_HARNESS.codex.session_rehydrate;
  if (expectedSession !== "SessionStart matcher=startup|resume") {
    problems.push("semantic session_rehydrate mapping must remain SessionStart matcher=startup|resume");
  }
  const session = hookCommandsWithMatchers(codexHooks.SessionStart);
  if (!commandHasHandler(session, "session-start") || !session.some((entry) => entry.matcher === "startup|resume")) {
    problems.push("SessionStart must run session-start with matcher startup|resume");
  }
  const userPrompt = hookCommandsWithMatchers(codexHooks.UserPromptSubmit);
  if (!commandHasHandler(userPrompt, "prompt-guard")) {
    problems.push("UserPromptSubmit must run prompt-guard");
  }
  if (!commandHasHandler(userPrompt, "verify-current-state")) {
    problems.push("UserPromptSubmit must run verify-current-state");
  }
  const pre = hookCommandsWithMatchers(codexHooks.PreToolUse);
  if (!codexBashOnly(pre, "prompt-guard")) {
    problems.push("PreToolUse prompt-guard must be Bash-only matcher Bash|bash");
  }
  if (!codexBashOnly(pre, "workflow-guard")) {
    problems.push("PreToolUse workflow-guard must be Bash-only matcher Bash|bash");
  }
  const post = hookCommandsWithMatchers(codexHooks.PostToolUse);
  if (!codexBashOnly(post, "context-monitor")) {
    problems.push("PostToolUse context-monitor must be Bash-only matcher Bash|bash");
  }
  const stop = hookCommandsWithMatchers(codexHooks.Stop);
  if (!commandHasHandler(stop, "stop-handoff")) {
    problems.push("Stop must run stop-handoff");
  }
  return problems.length === 0
    ? { ok: true, details: "Codex hook events, matchers, and manifest semantic mappings are structurally valid" }
    : { ok: false, details: problems.join("; ") };
}

async function initRecoveryCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const sentinelPath = path.join(projectRoot, RUNTIME_ROOT, "state", ".init-in-progress");
  if (!(await exists(sentinelPath))) {
    return { ok: true, details: "no partial init/sync sentinel found" };
  }
  let summary = `${RUNTIME_ROOT}/state/.init-in-progress sentinel present`;
  try {
    const parsed = JSON.parse(await fs.readFile(sentinelPath, "utf8")) as {
      operation?: unknown;
      startedAt?: unknown;
    };
    const operation = typeof parsed.operation === "string" ? parsed.operation : "unknown";
    const startedAt = typeof parsed.startedAt === "string" ? parsed.startedAt : "unknown";
    summary = `${summary} (operation=${operation}, startedAt=${startedAt})`;
  } catch {
    summary = `${summary} (unreadable sentinel payload)`;
  }
  return {
    ok: false,
    details: `${summary}. Fix: inspect generated runtime files, then rerun cclaw sync or remove the sentinel only after confirming the runtime is complete.`
  };
}

async function archiveIntegrityCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const runsDir = path.join(projectRoot, RUNTIME_ROOT, "runs");
  if (!(await exists(runsDir))) {
    return { ok: true, details: `${RUNTIME_ROOT}/runs is absent; no archives to inspect yet` };
  }
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(runsDir, { withFileTypes: true });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, details: `unable to inspect ${RUNTIME_ROOT}/runs (${reason})` };
  }

  const problems: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const runId = entry.name;
    const runPath = path.join(runsDir, runId);
    const relRunPath = `${RUNTIME_ROOT}/runs/${runId}`;
    if (await exists(path.join(runPath, ".archive-in-progress"))) {
      problems.push(`${relRunPath}/.archive-in-progress sentinel present`);
    }

    const manifestPath = path.join(runPath, "archive-manifest.json");
    if (!(await exists(manifestPath))) {
      problems.push(`${relRunPath} missing archive-manifest.json`);
      continue;
    }

    let manifest: { snapshottedStateFiles?: unknown };
    try {
      manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as { snapshottedStateFiles?: unknown };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      problems.push(`${relRunPath}/archive-manifest.json unreadable (${reason})`);
      continue;
    }

    const stateFiles = Array.isArray(manifest.snapshottedStateFiles)
      ? manifest.snapshottedStateFiles.filter((value): value is string => typeof value === "string")
      : [];
    const stateDir = path.join(runPath, "state");
    if (stateFiles.length > 0 && !(await exists(stateDir))) {
      problems.push(`${relRunPath} manifest lists state snapshot files but state/ is missing`);
      continue;
    }
    for (const stateFile of stateFiles) {
      if (stateFile.endsWith("/")) continue;
      if (!(await exists(path.join(stateDir, stateFile)))) {
        problems.push(`${relRunPath}/state missing ${stateFile} listed in manifest`);
      }
    }
  }

  if (problems.length === 0) {
    return { ok: true, details: "no partial archive sentinels or incomplete archive snapshots found" };
  }
  return {
    ok: false,
    details: `${problems.join("; ")}. Fix: inspect the archive directory, retry archive if the active run was restored, or recover/rollback artifacts and state from the snapshot before removing the sentinel.`
  };
}

async function opencodePluginRuntimeShapeCheck(projectRoot: string): Promise<{ ok: boolean; details: string }> {
  const pluginPath = path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs");
  if (!(await exists(pluginPath))) {
    return { ok: false, details: `${path.relative(projectRoot, pluginPath)} not found` };
  }

  try {
    const moduleUrl = `${pathToFileURL(pluginPath).href}?doctor=${Date.now()}`;
    const imported = await import(moduleUrl) as { default?: unknown };
    if (typeof imported.default !== "function") {
      return {
        ok: false,
        details: `${path.relative(projectRoot, pluginPath)} must export a default plugin factory function`
      };
    }

    const plugin = imported.default({ directory: projectRoot }) as Record<string, unknown>;
    if (!plugin || typeof plugin !== "object" || Array.isArray(plugin)) {
      return {
        ok: false,
        details: `${path.relative(projectRoot, pluginPath)} factory must return a plugin object`
      };
    }
    const requiredHandlers = [
      "event",
      "tool.execute.before",
      "tool.execute.after",
      "experimental.chat.system.transform"
    ];
    const missing = requiredHandlers.filter((name) => typeof plugin?.[name] !== "function");
    if (missing.length > 0) {
      return {
        ok: false,
        details: `${path.relative(projectRoot, pluginPath)} missing runtime handlers: ${missing.join(", ")}`
      };
    }
    return {
      ok: true,
      details: `${path.relative(projectRoot, pluginPath)} exports compatible runtime handler shape`
    };
  } catch (error) {
    return {
      ok: false,
      details: `runtime load failed for .opencode/plugins/cclaw-plugin.mjs: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

export async function doctorChecks(projectRoot: string, options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const checks: PendingDoctorCheck[] = [];

  for (const dir of REQUIRED_DIRS) {
    const fullPath = path.join(projectRoot, dir);
    checks.push({
      name: `dir:${dir}`,
      ok: await exists(fullPath),
      details: fullPath
    });
  }

  for (const stage of FLOW_STAGES) {
    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", stageSkillFolder(stage), "SKILL.md");
    const skillExists = await exists(skillPath);
    checks.push({
      name: `skill:${stage}`,
      ok: skillExists,
      details: skillPath
    });

    if (skillExists) {
      const skillContent = await fs.readFile(skillPath, "utf8");
      const lineCount = skillContent.split("\n").length;
      const MIN_SKILL_LINES = 110;
      // Soft max tightened from 650 → 500 after externalising the TDD
      // batch-execution walkthrough and collapsing the duplicate "what
      // goes wrong" lists. Stage skills beyond 500 lines drift into unread
      // bloat; long-form content belongs in shared guidance sections instead.
      const MAX_SKILL_LINES = 500;
      checks.push({
        name: `skill:${stage}:min_lines`,
        ok: lineCount >= MIN_SKILL_LINES,
        details: `${skillPath} has ${lineCount} lines (minimum ${MIN_SKILL_LINES})`
      });
      checks.push({
        name: `skill:${stage}:max_lines`,
        ok: lineCount <= MAX_SKILL_LINES,
        details: `${skillPath} has ${lineCount} lines (soft max ${MAX_SKILL_LINES}; stage skills beyond this drift into unread bloat)`
      });

      const canonicalSections: Array<{ id: string; pattern: RegExp; label: string }> = [
        { id: "frontmatter", pattern: /^---\nname: [\w-]+\ndescription: /m, label: "YAML frontmatter (name + description)" },
        { id: "iron_law", pattern: /^\*\*IRON LAW — [A-Z]+:\*\* .+$/m, label: "Iron Law punchcard (<EXTREMELY-IMPORTANT> wrapper)" },
        { id: "hard_gate", pattern: /^## HARD-GATE$/m, label: "## HARD-GATE" },
        { id: "checklist", pattern: /^## Checklist$/m, label: "## Checklist" },
        { id: "completion_parameters", pattern: /^## Completion Parameters$/m, label: "## Completion Parameters" },
        { id: "shared_guidance", pattern: /^## Shared Stage Guidance$/m, label: "## Shared Stage Guidance" },
        { id: "anti_patterns", pattern: /^## Anti-Patterns & Red Flags$/m, label: "## Anti-Patterns & Red Flags" }
      ];
      const missingSections = canonicalSections
        .filter((section) => !section.pattern.test(skillContent))
        .map((section) => section.label);
      checks.push({
        name: `skill:${stage}:canonical_sections`,
        ok: missingSections.length === 0,
        details:
          missingSections.length === 0
            ? `${skillPath} contains all canonical sections`
            : `${skillPath} missing sections: ${missingSections.join(", ")}`
      });
    }
  }

  // Meta-skill health — the using-cclaw routing brain must always contain the
  // signals that stage skills reference. When one of these drifts, every stage
  // citation breaks silently.
  const metaSkillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", "using-cclaw", "SKILL.md");
  if (await exists(metaSkillPath)) {
    const metaContent = await fs.readFile(metaSkillPath, "utf8");
    const requiredSignals: Array<{ id: string; pattern: RegExp; label: string }> = [
      { id: "instruction_priority", pattern: /Instruction Priority/i, label: "Instruction Priority" },
      { id: "routing_flow", pattern: /Routing flow/i, label: "Routing flow" },
      { id: "task_classification", pattern: /Task classification/i, label: "Task classification" },
      { id: "stage_map", pattern: /Stage quick map/i, label: "Stage quick map" },
      { id: "protocol_behavior", pattern: /Protocol Behavior/i, label: "Protocol Behavior" },
      { id: "knowledge_guidance", pattern: /Knowledge guidance/i, label: "Knowledge guidance" },
      { id: "failure_guardrails", pattern: /Failure guardrails/i, label: "Failure guardrails" }
    ];
    const missingMeta = requiredSignals
      .filter((signal) => !signal.pattern.test(metaContent))
      .map((signal) => signal.label);
    checks.push({
      name: "skill:meta:signals",
      ok: missingMeta.length === 0,
      details:
        missingMeta.length === 0
          ? `${metaSkillPath} contains all required routing signals`
          : `${metaSkillPath} missing signals: ${missingMeta.join(", ")}`
    });
  }

  checks.push({
    name: "gitignore:required_patterns",
    ok: await gitignoreHasRequiredPatterns(projectRoot),
    details: ".gitignore must include cclaw ignore block"
  });

  let configuredHarnesses: HarnessId[] = [];
  let parsedConfig: Awaited<ReturnType<typeof readConfig>> | null = null;
  try {
    const config = await readConfig(projectRoot);
    parsedConfig = config;
    configuredHarnesses = config.harnesses;
    checks.push({
      name: "config:valid",
      ok: true,
      details: `${RUNTIME_ROOT}/config.yaml parsed successfully`
    });
  } catch (error) {
    checks.push({
      name: "config:valid",
      ok: false,
      severity: error instanceof InvalidConfigError ? "error" : "warning",
      details: error instanceof Error ? error.message : "Invalid config"
    });
  }

  if (parsedConfig) {
    const advancedKeys = await detectAdvancedKeys(projectRoot).catch(() => new Set());
    const hasLegacyTddTestGlobs = advancedKeys.has("tddTestGlobs");
    const hasModernTddConfig = advancedKeys.has("tdd");
    checks.push({
      name: "warning:config:deprecated_tdd_test_globs",
      ok: !hasLegacyTddTestGlobs,
      details: hasLegacyTddTestGlobs
        ? hasModernTddConfig
          ? `warning: ${RUNTIME_ROOT}/config.yaml sets deprecated "tddTestGlobs" alongside "tdd.*"; "tdd.testPathPatterns" takes precedence. Remove legacy key.`
          : `warning: ${RUNTIME_ROOT}/config.yaml uses deprecated "tddTestGlobs". Migrate to "tdd.testPathPatterns".`
        : `no deprecated "tddTestGlobs" key detected in ${RUNTIME_ROOT}/config.yaml`
    });

    const expectedStrictness = parsedConfig.strictness === "strict" ? "strict" : "advisory";
    const hookRuntimePath = path.join(projectRoot, RUNTIME_ROOT, "hooks", "run-hook.mjs");
    let strictnessOk = false;
    if (await exists(hookRuntimePath)) {
      const runtimeContent = await fs.readFile(hookRuntimePath, "utf8");
      strictnessOk = runtimeContent.includes(`const DEFAULT_STRICTNESS = "${expectedStrictness}"`);
    }
    checks.push({
      name: "hook:runtime:strictness",
      ok: strictnessOk,
      details: `${hookRuntimePath} must embed DEFAULT_STRICTNESS = "${expectedStrictness}" matching config.strictness`
    });

    if (parsedConfig.gitHookGuards === true) {
      const runtimePreCommit = path.join(projectRoot, RUNTIME_ROOT, "hooks", "git", "pre-commit.mjs");
      const runtimePrePush = path.join(projectRoot, RUNTIME_ROOT, "hooks", "git", "pre-push.mjs");
      const runtimeScriptsOk = (await exists(runtimePreCommit)) && (await exists(runtimePrePush));
      checks.push({
        name: "git_hooks:managed:runtime_scripts",
        ok: runtimeScriptsOk,
        details: `${RUNTIME_ROOT}/hooks/git/pre-commit.mjs and pre-push.mjs must exist when gitHookGuards=true`
      });

      const gitHooksDir = await resolveGitHooksDir(projectRoot);
      if (!gitHooksDir) {
        checks.push({
          name: "git_hooks:managed:relays",
          ok: true,
          details: "git repository not detected; relay hook check skipped"
        });
      } else {
        const preCommitHookPath = path.join(gitHooksDir, "pre-commit");
        const prePushHookPath = path.join(gitHooksDir, "pre-push");
        let relaysOk = false;
        if ((await exists(preCommitHookPath)) && (await exists(prePushHookPath))) {
          const preCommitHook = await fs.readFile(preCommitHookPath, "utf8");
          const prePushHook = await fs.readFile(prePushHookPath, "utf8");
          relaysOk =
            preCommitHook.includes("cclaw-managed-git-hook") &&
            prePushHook.includes("cclaw-managed-git-hook");
        }
        checks.push({
          name: "git_hooks:managed:relays",
          ok: relaysOk,
          details: `${path.relative(projectRoot, gitHooksDir)}/pre-commit and pre-push must contain managed relay marker`
        });
      }
    }
  }

  for (const harness of configuredHarnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    if (!adapter) {
      checks.push({
        name: `harness:${harness}:supported`,
        ok: false,
        details: `Unsupported harness "${harness}" in ${RUNTIME_ROOT}/config.yaml`
      });
      continue;
    }
    // For command-kind harnesses we check flat files; skill-kind (codex) is
    // validated in the codex-specific block below (`shim:codex:<name>:*`).
    if (adapter.shimKind === "command") {
      for (const shim of harnessShimFileNames()) {
        const shimPath = path.join(projectRoot, adapter.commandDir, shim);
        checks.push({
          name: `shim:${harness}:${shim.replace(".md", "")}`,
          ok: await exists(shimPath),
          details: shimPath
        });
      }
    }
  }

  for (const harness of configuredHarnesses) {
    checks.push({
      name: `harness:reality:${harness}`,
      ok: true,
      severity: "info",
      details: harnessRealityLabel(harness)
    });
  }

  const agentsFile = path.join(projectRoot, "AGENTS.md");
  let agentsBlockOk = false;
  if (await exists(agentsFile)) {
    const content = await fs.readFile(agentsFile, "utf8");
    const hasMarkers = content.includes(CCLAW_MARKER_START) && content.includes(CCLAW_MARKER_END);
    const hasCcCommand = content.includes("/cc");
    const hasCcNext = content.includes("/cc-next");
    const hasCcIdeate = content.includes("/cc-ideate");
    const hasCcView = content.includes("/cc-view");
    const hasVerification = content.includes("Verification Discipline");
    const hasMinimalMarker = content.includes("intentionally minimal for cross-project use");
    const hasMetaSkillPointer = content.includes(".cclaw/skills/using-cclaw/SKILL.md");
    agentsBlockOk = hasMarkers
      && hasCcCommand
      && hasCcNext
      && hasCcIdeate
      && hasCcView
      && hasVerification
      && hasMinimalMarker
      && hasMetaSkillPointer;
  }
  checks.push({
    name: "agents:cclaw_block",
    ok: agentsBlockOk,
    details: `${agentsFile} must contain the managed cclaw marker block with routing, verification, and minimal detail pointer`
  });

  for (const cmd of ["start", "next", "ideate", "view"] as const) {
    const cmdPath = path.join(projectRoot, RUNTIME_ROOT, "commands", `${cmd}.md`);
    checks.push({
      name: `utility_command:${cmd}`,
      ok: await exists(cmdPath),
      details: cmdPath
    });
  }
  for (const stage of FLOW_STAGES) {
    const cmdPath = path.join(projectRoot, RUNTIME_ROOT, "commands", `${stage}.md`);
    let stageCommandOk = false;
    if (await exists(cmdPath)) {
      const content = await fs.readFile(cmdPath, "utf8");
      stageCommandOk = content === stageCommandShimMarkdown(stage);
    }
    checks.push({
      name: `stage_command:${stage}`,
      ok: stageCommandOk,
      details: `${cmdPath} must be a thin shim to ${RUNTIME_ROOT}/skills/${stageSkillFolder(stage)}/SKILL.md and /cc-next`
    });
  }

  // Utility skills
  for (const [folder, label] of [
    ["learnings", "learnings"],
    ["flow-ideate", "flow-ideate"],
    ["flow-view", "flow-view"],
    ["subagent-dev", "sdd"],
    ["parallel-dispatch", "parallel-agents"],
    ["session", "session"],
    ["using-cclaw", "meta-skill"]
  ] as const) {
    const skillPath = path.join(projectRoot, RUNTIME_ROOT, "skills", folder, "SKILL.md");
    checks.push({
      name: `utility_skill:${label}`,
      ok: await exists(skillPath),
      details: skillPath
    });
  }

  // Opt-in language rule packs: only check presence for packs the user enabled.
  // Canonical location is .cclaw/rules/lang/<pack>.md.
  for (const pack of parsedConfig?.languageRulePacks ?? []) {
    const fileName = LANGUAGE_RULE_PACK_FILES[pack];
    if (!fileName) continue;
    const packPath = path.join(projectRoot, RUNTIME_ROOT, ...LANGUAGE_RULE_PACK_DIR, fileName);
    checks.push({
      name: `language_rule_pack:${pack}`,
      ok: await exists(packPath),
      details: packPath
    });
  }

  // Drift: legacy per-language skill folders from v0.7.0 must not coexist with
  // the new rules/lang/ layout. `cclaw sync` removes them on the next run.
  for (const legacyFolder of LEGACY_LANGUAGE_RULE_PACK_FOLDERS) {
    const legacyPath = path.join(projectRoot, RUNTIME_ROOT, "skills", legacyFolder);
    const legacyPresent = await exists(legacyPath);
    checks.push({
      name: `language_rule_pack:no_legacy:${legacyFolder}`,
      ok: !legacyPresent,
      details: legacyPresent
        ? `legacy ${legacyPath} must be removed — language packs moved to ${RUNTIME_ROOT}/${LANGUAGE_RULE_PACK_DIR.join("/")}/. Run \`cclaw sync\`.`
        : `no legacy ${legacyFolder} skill folder`
    });
  }

  // Agent definition files
  for (const agent of CCLAW_AGENTS) {
    const agentPath = path.join(projectRoot, RUNTIME_ROOT, "agents", `${agent.name}.md`);
    let agentOk = await exists(agentPath);
    if (agentOk) {
      const content = await fs.readFile(agentPath, "utf8");
      agentOk = content.includes(`name: ${agent.name}`) && content.includes("tools:");
    }
    checks.push({
      name: `agent:${agent.name}`,
      ok: agentOk,
      details: agentPath
    });
  }

  for (const agent of CCLAW_AGENTS) {
    if (configuredHarnesses.includes("opencode")) {
      const agentPath = path.join(projectRoot, ".opencode", "agents", `${agent.name}.md`);
      let ok = false;
      if (await exists(agentPath)) {
        ok = generatedAgentShape(await fs.readFile(agentPath, "utf8"), "opencode", agent.name);
      }
      checks.push({
        name: `agent:opencode:${agent.name}:shape`,
        ok,
        details: `${agentPath} must be a generated OpenCode subagent with mode: subagent and strict return schema`
      });
    }
    if (configuredHarnesses.includes("codex")) {
      const agentPath = path.join(projectRoot, ".codex", "agents", `${agent.name}.toml`);
      let ok = false;
      if (await exists(agentPath)) {
        ok = generatedAgentShape(await fs.readFile(agentPath, "utf8"), "codex", agent.name);
      }
      checks.push({
        name: `agent:codex:${agent.name}:shape`,
        ok,
        details: `${agentPath} must be a generated Codex custom agent TOML with developer_instructions and strict return schema`
      });
    }
  }

  // Hook scripts
  for (const script of [
    "run-hook.mjs",
    "run-hook.cmd",
    "stage-complete.mjs",
    "start-flow.mjs",
    "delegation-record.mjs",
    "opencode-plugin.mjs"
  ]) {
    const scriptPath = path.join(projectRoot, RUNTIME_ROOT, "hooks", script);
    const scriptExists = await exists(scriptPath);
    checks.push({
      name: `hook:script:${script}`,
      ok: scriptExists,
      details: scriptPath
    });
    if (scriptExists) {
      let executable = false;
      try {
        const stat = await fs.stat(scriptPath);
        executable = (stat.mode & 0o111) !== 0;
      } catch {
        executable = false;
      }
      const executableCheckOk = process.platform === "win32" ? true : executable;
      checks.push({
        name: `hook:script:${script}:executable`,
        ok: executableCheckOk,
        details:
          process.platform === "win32"
            ? `${scriptPath} executable-bit check skipped on Windows`
            : `${scriptPath} must be executable`
      });
    }
  }

  const localCliEntrypoints = await generatedCliEntrypointsOk(projectRoot);
  checks.push({
    name: "hook:script:local_cli_entrypoint",
    ok: localCliEntrypoints.ok,
    details: localCliEntrypoints.details
  });

  // Hook JSON files per harness. OpenCode ships hooks through its plugin
  // system (covered below). Codex joined the managed list in v0.40.0 — Codex
  // CLI ≥ v0.114 consumes `.codex/hooks.json` behind the `codex_hooks`
  // feature flag.
  const hookPaths: Record<string, string> = {
    claude: ".claude/hooks/hooks.json",
    cursor: ".cursor/hooks.json",
    codex: ".codex/hooks.json"
  };
  for (const harness of configuredHarnesses) {
    const hp = hookPaths[harness];
    if (!hp && harness !== "opencode") {
      checks.push({
        name: `hook:json:${harness}`,
        ok: false,
        details: `Unsupported harness "${harness}" in ${RUNTIME_ROOT}/config.yaml`
      });
      continue;
    }
    if (hp) {
      const fullPath = path.join(projectRoot, hp);
      const parsed = await readHookDocument(fullPath);
      const hookOk = !!(parsed && typeof parsed.hooks === "object" && parsed.hooks !== null);
      checks.push({
        name: `hook:json:${harness}`,
        ok: hookOk,
        details: fullPath
      });
      if (harness === "claude" || harness === "cursor" || harness === "codex") {
        const schema = validateHookDocument(harness, parsed);
        checks.push({
          name: `hook:schema:${harness}`,
          ok: schema.ok,
          details: schema.ok
            ? `${fullPath} matches cclaw hook schema v1`
            : `${fullPath} schema issues: ${schema.errors.join("; ")}`
        });
      }
    }
  }

  // OpenCode plugin deployed path. (Presence of the source under
  // `${RUNTIME_ROOT}/hooks/opencode-plugin.mjs` is already asserted by the
  // generic `hook:script:opencode-plugin.mjs` check above; avoid a duplicate.)
  const opencodeEnabled = configuredHarnesses.includes("opencode");
  const opencodeDeployed = await exists(path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs"));
  checks.push({
    name: "hook:opencode_plugin_deployed",
    ok: opencodeEnabled ? opencodeDeployed : true,
    details: opencodeEnabled
      ? ".opencode/plugins/cclaw-plugin.mjs"
      : "opencode harness disabled; deployed plugin check skipped"
  });

  if (configuredHarnesses.includes("claude")) {
    const file = path.join(projectRoot, ".claude/hooks/hooks.json");
    const parsed = await readHookDocument(file);
    const hooks = toObject(parsed?.hooks) ?? {};
    const sessionStart = hooks.SessionStart;
    const ok = JSON.stringify(sessionStart ?? "").includes("startup|resume|clear|compact");
    checks.push({
      name: "lifecycle:claude:rehydration_matcher",
      ok,
      details: `${file} must include SessionStart matcher startup|resume|clear|compact`
    });

    const sessionCommands = collectHookCommands(hooks.SessionStart);
    const preCommands = collectHookCommands(hooks.PreToolUse);
    const postCommands = collectHookCommands(hooks.PostToolUse);
    const stopCommands = collectHookCommands(hooks.Stop);
    const wiringOk =
      sessionCommands.some((cmd) => cmd.includes("session-start")) &&
      preCommands.some((cmd) => cmd.includes("prompt-guard")) &&
      preCommands.some((cmd) => cmd.includes("workflow-guard")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor")) &&
      stopCommands.some((cmd) => cmd.includes("stop-handoff"));
    checks.push({
      name: "hook:wiring:claude",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/workflow-guard/context-monitor/stop-handoff`
    });
  }

  if (configuredHarnesses.includes("cursor")) {
    const file = path.join(projectRoot, ".cursor/hooks.json");
    const parsed = await readHookDocument(file);
    const hooks = toObject(parsed?.hooks) ?? {};
    const hasLifecycleKeys =
      Array.isArray(hooks.sessionStart) &&
      Array.isArray(hooks.sessionResume) &&
      Array.isArray(hooks.sessionClear) &&
      Array.isArray(hooks.sessionCompact);
    checks.push({
      name: "lifecycle:cursor:rehydration_events",
      ok: hasLifecycleKeys,
      details: `${file} must include sessionStart/sessionResume/sessionClear/sessionCompact hooks`
    });

    const sessionCommands = [
      ...collectHookCommands(hooks.sessionStart),
      ...collectHookCommands(hooks.sessionResume),
      ...collectHookCommands(hooks.sessionClear),
      ...collectHookCommands(hooks.sessionCompact)
    ];
    const preCommands = collectHookCommands(hooks.preToolUse);
    const postCommands = collectHookCommands(hooks.postToolUse);
    const stopCommands = collectHookCommands(hooks.stop);
    const wiringOk =
      sessionCommands.some((cmd) => cmd.includes("session-start")) &&
      preCommands.some((cmd) => cmd.includes("prompt-guard")) &&
      preCommands.some((cmd) => cmd.includes("workflow-guard")) &&
      postCommands.some((cmd) => cmd.includes("context-monitor")) &&
      stopCommands.some((cmd) => cmd.includes("stop-handoff"));
    checks.push({
      name: "hook:wiring:cursor",
      ok: wiringOk,
      details: `${file} must wire session-start/prompt-guard/workflow-guard/context-monitor/stop-handoff`
    });

    const cursorRulePath = path.join(projectRoot, ".cursor/rules/cclaw-workflow.mdc");
    let cursorRuleOk = false;
    if (await exists(cursorRulePath)) {
      const content = await fs.readFile(cursorRulePath, "utf8");
      cursorRuleOk =
        content.includes("cclaw-managed-cursor-workflow-rule") &&
        content.includes(".cclaw/state/flow-state.json") &&
        content.includes("/cc-next");
    }
    checks.push({
      name: "rules:cursor:workflow",
      ok: cursorRuleOk,
      details: `${cursorRulePath} must include managed marker and core cclaw workflow guardrails`
    });
  }

  if (configuredHarnesses.includes("codex")) {
    // Codex CLI has no custom slash-command discovery (`.codex/commands/*`
    // was never read, even historically). cclaw ships codex entry points
    // as skills under `.agents/skills/cc*/SKILL.md`; Codex v0.114+ also
    // supports lifecycle hooks at `.codex/hooks.json` (gated by the
    // `codex_hooks` feature flag in `~/.codex/config.toml`).
    const skillsRoot = path.join(projectRoot, ".agents/skills");
    for (const skillName of harnessShimSkillNames()) {
      const skillPath = path.join(skillsRoot, skillName, "SKILL.md");
      let ok = false;
      let frontmatterOk = false;
      if (await exists(skillPath)) {
        ok = true;
        const content = await fs.readFile(skillPath, "utf8");
        frontmatterOk = new RegExp(`^---[\\s\\S]*?\\nname: ${skillName}\\b`, "u").test(content);
      }
      checks.push({
        name: `shim:codex:${skillName}:present`,
        ok,
        details: skillPath
      });
      checks.push({
        name: `shim:codex:${skillName}:frontmatter`,
        ok: frontmatterOk,
        details: frontmatterOk
          ? `${skillPath} has \`name: ${skillName}\` frontmatter`
          : ok
            ? `${skillPath} present but \`name: ${skillName}\` frontmatter is missing`
            : `${skillPath} absent; cannot validate frontmatter`
      });
    }

    // Hook wiring: the generated `.codex/hooks.json` must reference every
    // runtime script cclaw needs. Separate from the schema check above;
    // schema covers structure, this check covers semantic wiring.
    const codexHooksFile = path.join(projectRoot, ".codex/hooks.json");
    const codexDoc = await readHookDocument(codexHooksFile);
    const codexHooks = toObject(codexDoc?.hooks) ?? {};
    const codexSessionCmds = collectHookCommands(codexHooks.SessionStart);
    const codexUserPromptCmds = collectHookCommands(codexHooks.UserPromptSubmit);
    const codexPreCmds = collectHookCommands(codexHooks.PreToolUse);
    const codexPostCmds = collectHookCommands(codexHooks.PostToolUse);
    const codexStopCmds = collectHookCommands(codexHooks.Stop);
    const codexWiringOk =
      codexSessionCmds.some((cmd) => cmd.includes("session-start")) &&
      codexUserPromptCmds.some((cmd) => cmd.includes("prompt-guard")) &&
      codexUserPromptCmds.some((cmd) => cmd.includes("verify-current-state")) &&
      codexPreCmds.some((cmd) => cmd.includes("prompt-guard")) &&
      codexPreCmds.some((cmd) => cmd.includes("workflow-guard")) &&
      codexPostCmds.some((cmd) => cmd.includes("context-monitor")) &&
      codexStopCmds.some((cmd) => cmd.includes("stop-handoff"));
    checks.push({
      name: "hook:wiring:codex",
      ok: codexWiringOk,
      details: `${codexHooksFile} must wire SessionStart, UserPromptSubmit(prompt/verify-current-state), Bash-only PreToolUse(prompt/workflow), Bash-only PostToolUse(context-monitor), and Stop(stop-handoff). Codex workflow-guard is intentionally strict Bash-only.`
    });
    const codexStructural = codexStructuralWiringCheck(codexHooks);
    checks.push({
      name: "hook:wiring:codex:structure",
      ok: codexStructural.ok,
      details: codexStructural.details
    });

    // Codex ignores `.codex/hooks.json` unless the user has
    // `[features] codex_hooks = true` in `~/.codex/config.toml`.
    const codexConfig = codexConfigPath();
    let codexFlagState: CodexHooksFlagState | "read-error" = "read-error";
    let codexFlagReadError: unknown;
    try {
      const content = await readCodexConfig(codexConfig);
      codexFlagState = classifyCodexHooksFlag(content);
    } catch (err) {
      codexFlagReadError = err;
    }
    const featureFlagNote = codexFlagInactiveDetail(codexConfig, codexFlagState, codexFlagReadError);
    const featureFlagOk = codexFlagState === "enabled";
    checks.push({
      name: "warning:codex:feature_flag",
      ok: featureFlagOk,
      details: featureFlagNote,
      summary: featureFlagOk
        ? "Codex hooks are active."
        : "Codex hooks are inactive; configured hooks will be ignored.",
      fix: "Set `[features] codex_hooks = true` in the Codex config or run cclaw init/sync with Codex flag repair.",
      docRef: "docs/harnesses.md"
    });
    if (parsedConfig?.strictness === "strict") {
      checks.push({
        name: "hook:codex:feature_flag_active",
        ok: featureFlagOk,
        details: featureFlagNote,
        summary: featureFlagOk
          ? "Codex hooks are active for strict runtime enforcement."
          : "Codex hooks are inactive; strict Codex hook enforcement is not ready.",
        fix: "Set `[features] codex_hooks = true` in the Codex config so strict Codex hooks can run.",
        docRef: "docs/harnesses.md"
      });
    }

    // Legacy `.codex/commands/*` must not linger from older cclaw installs.
    // (The `.codex/hooks.json` path is now managed and is validated above,
    // so there is no longer a legacy_hooks_json warning.)
    const legacyCommandsDir = path.join(projectRoot, ".codex/commands");
    const legacyCommandsPresent = await exists(legacyCommandsDir);
    checks.push({
      name: "warning:codex:legacy_commands_dir",
      ok: true,
      details: legacyCommandsPresent
        ? `warning: ${legacyCommandsDir} still present; Codex never consumed this directory — run \`cclaw sync\` to remove it.`
        : `no legacy ${legacyCommandsDir} detected`
    });

    // Legacy v0.39.x skill layout under `.agents/skills/cclaw-cc*/`
    // must have been removed — cclaw sync deletes these automatically,
    // but flag leftovers so users notice an upgrade issue.
    const legacyCodexSkills: string[] = [];
    try {
      const entries = await fs.readdir(skillsRoot);
      for (const entry of entries) {
        if (/^cclaw-cc(?:-.*)?$/u.test(entry)) {
          legacyCodexSkills.push(entry);
        }
      }
    } catch {
      // skills root absent; nothing to warn about
    }
    checks.push({
      name: "warning:codex:legacy_cclaw_cc_skills",
      ok: legacyCodexSkills.length === 0,
      details: legacyCodexSkills.length === 0
        ? `no legacy cclaw-cc* skill folders detected under .agents/skills/`
        : `warning: legacy skill folders from cclaw v0.39.x present (${legacyCodexSkills.join(", ")}); run \`cclaw sync\` to remove them.`
    });
  }

  if (configuredHarnesses.includes("opencode")) {
    const file = path.join(projectRoot, ".opencode/plugins/cclaw-plugin.mjs");
    let ok = false;
    let singleHandlerPathOk = false;
    let precompactHookOk = false;
    if (await exists(file)) {
      const content = await fs.readFile(file, "utf8");
      ok =
        content.includes("event: async") &&
        content.includes('"tool.execute.before"') &&
        content.includes('"tool.execute.after"') &&
        content.includes("prompt-guard") &&
        content.includes("workflow-guard") &&
        content.includes("context-monitor") &&
        content.includes("pre-compact") &&
        content.includes('"session.created"') &&
        content.includes('"session.idle"') &&
        content.includes('"session.resumed"') &&
        content.includes('"session.compacted"') &&
        content.includes('"session.cleared"') &&
        content.includes('"session.updated"') &&
        content.includes('"experimental.chat.system.transform"');
      singleHandlerPathOk =
        !content.includes('eventType === "tool.execute.before"') &&
        !content.includes('eventType === "tool.execute.after"') &&
        content.includes('"tool.execute.before": async') &&
        content.includes('"tool.execute.after": async');
      precompactHookOk =
        content.includes('eventType === "session.compacted"') &&
        content.includes('runHookScript("pre-compact"');
    }
    checks.push({
      name: "lifecycle:opencode:rehydration_events",
      ok,
      details: `${file} must include event lifecycle handler, session.created/updated/resumed/cleared/compacted rehydration, tool.execute.before/after with prompt/workflow/context hooks, session.idle handoff, and transform rehydration`
    });
    checks.push({
      name: "hook:opencode:single_tool_handler_path",
      ok: singleHandlerPathOk,
      details: `${file} must route tool.execute.before/after through dedicated handlers exactly once (no duplicate event() branches).`
    });
    checks.push({
      name: "hook:opencode:precompact_compat",
      ok: precompactHookOk,
      details: `${file} must run pre-compact on session.compacted before bootstrap refresh.`
    });
    const runtimeShape = await opencodePluginRuntimeShapeCheck(projectRoot);
    checks.push({
      name: "hook:opencode:runtime_shape",
      ok: runtimeShape.ok,
      details: runtimeShape.details
    });
    const registration = await opencodeRegistrationCheck(projectRoot);
    checks.push({
      name: "hook:opencode:config_registration",
      ok: registration.ok,
      details: registration.details
    });
    const questionPermission = await opencodeQuestionPermissionCheck(projectRoot);
    checks.push({
      name: "hook:opencode:question_permission",
      ok: questionPermission.ok,
      details: questionPermission.details
    });
    const questionEnv = opencodeQuestionEnvCheck();
    checks.push({
      name: "warning:opencode:question_tool_env",
      ok: questionEnv.ok,
      details: questionEnv.details
    });
  }

  const nodeVersion = await commandVersion("node");
  const nodeMajor = parseNodeMajor(nodeVersion.output);
  checks.push({
    name: "capability:required:node",
    ok: nodeVersion.available,
    details: nodeVersion.available
      ? `node binary available (${nodeVersion.output || "version unknown"})`
      : "node is required for cclaw runtime scripts and CLI wiring"
  });
  checks.push({
    name: "capability:required:node_version",
    ok: nodeVersion.available && nodeMajor !== null && nodeMajor >= 20,
    details: nodeVersion.available
      ? `node >=20 required; detected ${nodeVersion.output || "unknown version"}`
      : "node version check skipped because node binary is unavailable"
  });
  const gitVersion = await commandVersion("git");
  checks.push({
    name: "capability:required:git",
    ok: gitVersion.available,
    details: gitVersion.available
      ? `git binary available (${gitVersion.output || "version unknown"})`
      : "git is required for repository detection, hook setup, and doctor checks"
  });
  checks.push({
    name: "capability:required:git_version",
    ok: gitVersion.available && gitVersionLooksUsable(gitVersion.output),
    details: gitVersion.available
      ? `git version output: ${gitVersion.output || "unknown version"}`
      : "git version check skipped because git binary is unavailable"
  });
  const windowsHookConfigCandidates = [
    path.join(projectRoot, ".claude/hooks/hooks.json"),
    path.join(projectRoot, ".cursor/hooks.json"),
    path.join(projectRoot, ".codex/hooks.json")
  ];
  const legacyDispatchFiles: string[] = [];
  for (const candidate of windowsHookConfigCandidates) {
    if (!(await exists(candidate))) continue;
    const content = (await fs.readFile(candidate, "utf8")).replace(/\\/gu, "/");
    if (/bash\s+\.cclaw\/hooks\/|\.cclaw\/hooks\/(?:session-start|stop-handoff|stop-checkpoint|pre-compact|prompt-guard|workflow-guard|context-monitor)\.sh/u.test(content)) {
      legacyDispatchFiles.push(path.relative(projectRoot, candidate));
    }
  }
  checks.push({
    name: "warning:windows:hook_dispatch_node_only",
    ok: legacyDispatchFiles.length === 0,
    details: legacyDispatchFiles.length === 0
      ? "hook configs use managed .cclaw/hooks/run-hook.cmd dispatch commands"
      : `warning: legacy shell hook dispatch remains in ${legacyDispatchFiles.join(", ")}`
  });

  // Knowledge store exists (canonical JSONL, no markdown mirror)
  checks.push({
    name: "knowledge:store_exists",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl")),
    details: `${RUNTIME_ROOT}/knowledge.jsonl must exist`
  });
  // There must be NO legacy markdown knowledge store — JSONL is the only store.
  const legacyKnowledgeMdPath = path.join(projectRoot, RUNTIME_ROOT, "knowledge.md");
  const legacyExists = await exists(legacyKnowledgeMdPath);
  checks.push({
    name: "knowledge:no_legacy_markdown",
    ok: !legacyExists,
    details: legacyExists
      ? `legacy ${RUNTIME_ROOT}/knowledge.md must be removed — cclaw is JSONL-native`
      : `no legacy markdown store present`
  });
  const knowledgePath = path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl");
  if (await exists(knowledgePath)) {
    let malformedKnowledgeLines = 0;
    let missingSchemaV2Fields = 0;
    let parsedKnowledgeLines = 0;
    let lowConfidenceLines = 0;
    let staleRawEntries = 0;
    const schemaErrors: string[] = [];
    const triggerActionCounts = new Map<string, number>();
    // Stale threshold for raw entries: ~90 days with no re-observation.
    // Chosen to match the compound drift checklist language; anything newer is
    // recent enough to trust, anything older deserves a curate/supersede pass.
    const STALE_RAW_THRESHOLD_MS = 90 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const requiredV2Fields = [
      "type",
      "trigger",
      "action",
      "confidence",
      "domain",
      "stage",
      "origin_stage",
      "origin_run",
      "frequency",
      "universality",
      "maturity",
      "created",
      "first_seen_ts",
      "last_seen_ts",
      "project"
    ];
    try {
      const raw = await fs.readFile(knowledgePath, "utf8");
      const lines = raw
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            malformedKnowledgeLines += 1;
            continue;
          }
          parsedKnowledgeLines += 1;
          const validation = validateKnowledgeEntry(parsed);
          if (!validation.ok) {
            schemaErrors.push(`line ${parsedKnowledgeLines}: ${validation.errors.slice(0, 3).join(" ")}`);
          }
          const confidence = typeof parsed.confidence === "string" ? parsed.confidence.toLowerCase() : "";
          if (confidence === "low") {
            lowConfidenceLines += 1;
          }
          const trigger = typeof parsed.trigger === "string" ? parsed.trigger.trim().toLowerCase() : "";
          const action = typeof parsed.action === "string" ? parsed.action.trim().toLowerCase() : "";
          if (trigger.length > 0 && action.length > 0) {
            const key = `${trigger} => ${action}`;
            triggerActionCounts.set(key, (triggerActionCounts.get(key) ?? 0) + 1);
          }
          const missing = requiredV2Fields.some((field) =>
            !Object.prototype.hasOwnProperty.call(parsed, field)
          );
          if (missing) {
            missingSchemaV2Fields += 1;
          }
          const maturity = typeof parsed.maturity === "string" ? parsed.maturity.toLowerCase() : "";
          const lastSeenRaw = typeof parsed.last_seen_ts === "string" ? parsed.last_seen_ts : "";
          if (maturity === "raw" && lastSeenRaw.length > 0) {
            const lastSeenMs = Date.parse(lastSeenRaw);
            if (Number.isFinite(lastSeenMs) && now - lastSeenMs > STALE_RAW_THRESHOLD_MS) {
              staleRawEntries += 1;
            }
          }
        } catch {
          malformedKnowledgeLines += 1;
        }
      }
    } catch {
      malformedKnowledgeLines += 1;
    }
    checks.push({
      name: "knowledge:jsonl_parseable",
      ok: malformedKnowledgeLines === 0,
      details:
        malformedKnowledgeLines === 0
          ? "knowledge.jsonl lines parse as JSON objects"
          : `knowledge.jsonl contains ${malformedKnowledgeLines} malformed line(s)`
    });
    checks.push({
      name: "warning:knowledge:schema_v2_fields",
      ok: true,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : missingSchemaV2Fields === 0
            ? `all ${parsedKnowledgeLines} knowledge line(s) include schema v2 fields`
            : `warning: ${missingSchemaV2Fields}/${parsedKnowledgeLines} knowledge line(s) miss schema v2 fields (origin/maturity/frequency metadata)`
    });
    checks.push({
      name: "warning:knowledge:current_schema",
      ok: schemaErrors.length === 0,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : schemaErrors.length === 0
            ? `all ${parsedKnowledgeLines} knowledge line(s) match the current strict schema`
            : `warning: ${schemaErrors.length}/${parsedKnowledgeLines} knowledge line(s) fail current schema validation (${schemaErrors.slice(0, 3).join("; ")})`
    });
    const lowConfidenceRatio = parsedKnowledgeLines === 0 ? 0 : lowConfidenceLines / parsedKnowledgeLines;
    checks.push({
      name: "warning:knowledge:low_confidence_density",
      ok: true,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : lowConfidenceRatio <= 0.35
            ? `low-confidence entries: ${lowConfidenceLines}/${parsedKnowledgeLines}`
            : `warning: low-confidence entries are high (${lowConfidenceLines}/${parsedKnowledgeLines}, ${(lowConfidenceRatio * 100).toFixed(1)}%). Consider a learnings curation pass before adding more.`
    });
    const repeatedClusters = [...triggerActionCounts.entries()].filter(([, count]) => count >= 3);
    checks.push({
      name: "warning:knowledge:repeat_clusters",
      ok: true,
      details:
        repeatedClusters.length === 0
          ? "no high-frequency repeated trigger/action clusters detected"
          : `warning: ${repeatedClusters.length} repeated learning cluster(s) detected (>=3 repeats). Consider curating knowledge lifts into durable rules/skills.`
    });
    checks.push({
      name: "warning:knowledge:stale_raw_entries",
      ok: true,
      details:
        parsedKnowledgeLines === 0
          ? "knowledge.jsonl is empty"
          : staleRawEntries === 0
            ? `no raw knowledge entries older than 90 days`
            : `warning: ${staleRawEntries} raw knowledge entry(ies) have last_seen_ts older than 90 days. Run a learnings curation pass or append a superseding entry before the next compound pass.`
    });
  }

  const routingKnowledgeSurfaces: string[] = [];
  for (const routingFileName of ["AGENTS.md", "CLAUDE.md"] as const) {
    const routingFilePath = path.join(projectRoot, routingFileName);
    if (!(await exists(routingFilePath))) continue;
    const content = await fs.readFile(routingFilePath, "utf8");
    if (knowledgeRoutingSurfaceIsDiscoverable(content)) {
      routingKnowledgeSurfaces.push(routingFileName);
    }
  }
  checks.push({
    name: "warning:knowledge:discoverability",
    ok: routingKnowledgeSurfaces.length > 0,
    details:
      routingKnowledgeSurfaces.length > 0
        ? `knowledge store schema is discoverable from ${routingKnowledgeSurfaces.join(", ")}`
        : "warning: AGENTS.md or CLAUDE.md should mention .cclaw/knowledge.jsonl and its type/trigger/action/origin_run usage"
  });

  const seedEntries = await readSeedShelf(projectRoot);
  const orphanSeeds = seedEntries.filter(
    (seed) => seed.sourceArtifact === null || seed.triggerWhen.length === 0 || seed.action === null || seed.action.trim().length === 0
  );
  checks.push({
    name: "warning:knowledge:orphan_seeds",
    ok: orphanSeeds.length === 0,
    details:
      seedEntries.length === 0
        ? "no seed shelf entries present"
        : orphanSeeds.length === 0
          ? `all ${seedEntries.length} seed shelf entr${seedEntries.length === 1 ? "y is" : "ies are"} discoverable`
          : `warning: ${orphanSeeds.length}/${seedEntries.length} seed shelf entr${seedEntries.length === 1 ? "y is" : "ies are"} missing source_artifact, trigger_when, or action (${orphanSeeds.slice(0, 3).map((seed) => seed.relPath).join(", ")})`
  });

  let flowState = createInitialFlowState();
  let flowStateCorruptError: CorruptFlowStateError | null = null;
  try {
    flowState = await readFlowState(projectRoot, { repairFeatureSystem: false });
  } catch (error) {
    if (error instanceof CorruptFlowStateError) {
      flowStateCorruptError = error;
      checks.push({
        name: "flow_state:readable",
        ok: false,
        severity: "error",
        details: error.message
      });
    } else {
      throw error;
    }
  }
  if (options.reconcileCurrentStageGates === true && !flowStateCorruptError) {
    const reconciliation = await reconcileAndWriteCurrentStageGateCatalog(projectRoot);
    if (reconciliation.wrote) {
      flowState = {
        ...flowState,
        stageGateCatalog: {
          ...flowState.stageGateCatalog,
          [reconciliation.stage]: reconciliation.after
        }
      };
    }
    checks.push({
      name: "gates:reconcile:writeback",
      ok: true,
      details: reconciliation.wrote
        ? `reconciled gate catalog for stage "${reconciliation.stage}": ${reconciliation.notes.join("; ")}`
        : `no gate reconciliation changes needed for stage "${reconciliation.stage}"`
    });
  } else if (options.reconcileCurrentStageGates === true && flowStateCorruptError) {
    checks.push({
      name: "gates:reconcile:writeback",
      ok: false,
      details: "skipped gate reconciliation because flow-state.json is corrupt"
    });
  }
  const activeRunId = typeof flowState.activeRunId === "string" ? flowState.activeRunId.trim() : "";
  checks.push({
    name: "flow_state:active_run_id",
    ok: activeRunId.length > 0,
    details: `${RUNTIME_ROOT}/state/flow-state.json must include activeRunId`
  });
  const sensitivePermissionTargets = [
    path.join(projectRoot, RUNTIME_ROOT, "state", "flow-state.json"),
    path.join(projectRoot, RUNTIME_ROOT, "state", "delegation-log.json"),
    path.join(projectRoot, RUNTIME_ROOT, "state", "reconciliation-notices.json"),
    path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl")
  ];
  const permissiveStateFiles: string[] = [];
  for (const targetPath of sensitivePermissionTargets) {
    const bits = await readPermissionBits(targetPath);
    if (bits === null) continue;
    if (bits > 0o640) {
      permissiveStateFiles.push(`${path.relative(projectRoot, targetPath)}:${bits.toString(8)}`);
    }
  }
  checks.push({
    name: "warning:state:file_permissions",
    ok: true,
    details: permissiveStateFiles.length === 0
      ? "sensitive state files are <=0640 permissions"
      : `warning: sensitive state files are overly permissive (${permissiveStateFiles.join(", ")}). Run \`chmod 600 .cclaw/state/*.json .cclaw/state/*.jsonl .cclaw/knowledge.jsonl\` if this machine is multi-user.`
  });
  const reconciliationNotices = await readReconciliationNotices(projectRoot);
  checks.push({
    name: "state:reconciliation_notices_parse",
    ok: reconciliationNotices.parseOk && reconciliationNotices.schemaOk,
    details: !reconciliationNotices.parseOk
      ? `unable to parse ${RECONCILIATION_NOTICES_REL_PATH}; reset with \`cclaw sync\` or repair JSON by hand`
      : !reconciliationNotices.schemaOk
        ? `${RECONCILIATION_NOTICES_REL_PATH} schemaVersion mismatch; expected ${reconciliationNotices.schemaVersion}`
        : `${RECONCILIATION_NOTICES_REL_PATH} parsed successfully`
  });
  const noticeBuckets = classifyReconciliationNotices(flowState, reconciliationNotices.notices);
  const formatNoticeList = (items: typeof noticeBuckets.activeBlocked): string =>
    items
      .slice(0, 8)
      .map((notice) => `${notice.stage}.${notice.gateId}`)
      .join(", ");
  checks.push({
    name: "state:reconciliation_notices",
    ok: noticeBuckets.unsynced.length === 0,
    details: noticeBuckets.unsynced.length > 0
      ? `reconciliation notices out of sync in ${RECONCILIATION_NOTICES_REL_PATH}: ${formatNoticeList(noticeBuckets.unsynced)}. Run \`cclaw doctor --reconcile-gates\` to resync and clear stale entries.`
      : noticeBuckets.currentStageBlocked.length > 0
        ? `active reconciliation notices for current stage "${flowState.currentStage}": ${formatNoticeList(noticeBuckets.currentStageBlocked)}`
        : noticeBuckets.activeBlocked.length > 0
          ? `active reconciliation notices for run "${flowState.activeRunId}": ${formatNoticeList(noticeBuckets.activeBlocked)}`
          : `no active reconciliation notices in ${RECONCILIATION_NOTICES_REL_PATH}`
  });

  const activeTrack = flowState.track ?? "standard";
  const trackStageList = TRACK_STAGES[activeTrack];
  const skippedFromState = Array.isArray(flowState.skippedStages) ? flowState.skippedStages : [];
  const expectedSkipped = skippedStagesForTrack(activeTrack);
  const skippedConsistent =
    expectedSkipped.length === skippedFromState.length &&
    expectedSkipped.every((stage) => skippedFromState.includes(stage));
  checks.push({
    name: "flow_state:track",
    ok: skippedConsistent,
    details: skippedConsistent
      ? `active track "${activeTrack}" (${trackStageList.length}/${FLOW_STAGES.length} stages: ${trackStageList.join(" → ")})${
          expectedSkipped.length > 0 ? `; skippedStages=${expectedSkipped.join(", ")}` : ""
        }`
      : `track "${activeTrack}" expects skippedStages=[${expectedSkipped.join(", ")}] but flow-state has [${skippedFromState.join(", ")}] — run \`cclaw sync\` to repair`
  });
  if (parsedConfig?.trackHeuristics) {
    const ideaArtifactPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "00-idea.md");
    let heuristicsAligned = true;
    let heuristicsDetails = "trackHeuristics configured; advisory alignment check skipped.";

    if (!(await exists(ideaArtifactPath))) {
      heuristicsDetails = `trackHeuristics configured but ${RUNTIME_ROOT}/artifacts/00-idea.md is missing; advisory alignment check skipped.`;
    } else {
      const ideaMarkdown = await fs.readFile(ideaArtifactPath, "utf8");
      if (/^Reclassification:\s*/imu.test(ideaMarkdown)) {
        heuristicsDetails = "00-idea.md contains Reclassification entry; advisory heuristic mismatch check skipped.";
      } else {
        const userPrompt = extractUserPromptFromIdeaArtifact(ideaMarkdown);
        if (!userPrompt) {
          heuristicsDetails = "00-idea.md has no `## User prompt` section; advisory heuristic mismatch check skipped.";
        } else {
          const resolution = resolveTrackFromPrompt(userPrompt, parsedConfig.trackHeuristics);
          const tokenNote =
            resolution.matchedTokens.length > 0
              ? `matched: ${resolution.matchedTokens.join(", ")}`
              : "matched: none (fallback)";
          heuristicsAligned = resolution.track === activeTrack;
          heuristicsDetails = heuristicsAligned
            ? `trackHeuristics advisory matches active track "${activeTrack}" (${tokenNote}).`
            : `warning: trackHeuristics advisory predicts "${resolution.track}" (${tokenNote}; ${resolution.reason}) but flow-state track is "${activeTrack}". Re-run classification or add Reclassification in 00-idea.md if override was intentional.`;
        }
      }
    }
    checks.push({
      name: "warning:track_heuristics:advisory_alignment",
      ok: heuristicsAligned,
      details: heuristicsDetails
    });
  }
  checks.push({
    name: "flow_state:track_completed_in_track",
    ok: flowState.completedStages.every((stage) => trackStageList.includes(stage) || expectedSkipped.includes(stage)),
    details: (() => {
      const offTrack = flowState.completedStages.filter((stage) => !trackStageList.includes(stage) && !expectedSkipped.includes(stage));
      return offTrack.length === 0
        ? `every completed stage belongs to track "${activeTrack}" or its skipped set`
        : `completed stages contain entries outside track "${activeTrack}" and not in skipped set: ${offTrack.join(", ")}`;
    })()
  });
  checks.push({
    name: "artifacts:active_root",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "artifacts")),
    details: `${RUNTIME_ROOT}/artifacts must exist as the active artifact root`
  });
  const artifactsRoot = path.join(projectRoot, RUNTIME_ROOT, "artifacts");
  let artifactPlaceholderHits: string[] = [];
  let duplicateArtifactGroups: string[] = [];
  if (await exists(artifactsRoot)) {
    try {
      const entries = await fs.readdir(artifactsRoot, { withFileTypes: true });
      const placeholderPattern = /\b(?:TODO|TBD|FIXME)\b|<fill-in>|<your-.*-here>/giu;
      const stageArtifactFiles = new Map<FlowStage, string[]>();
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
        const stageForArtifact = artifactStageFromFileName(entry.name);
        if (stageForArtifact) {
          const files = stageArtifactFiles.get(stageForArtifact) ?? [];
          files.push(entry.name);
          stageArtifactFiles.set(stageForArtifact, files);
        }
        const filePath = path.join(artifactsRoot, entry.name);
        const content = await fs.readFile(filePath, "utf8");
        const matchCount = (content.match(placeholderPattern) ?? []).length;
        if (matchCount > 0) {
          artifactPlaceholderHits.push(`${entry.name}:${matchCount}`);
        }
      }
      duplicateArtifactGroups = [...stageArtifactFiles.entries()]
        .filter(([, files]) => files.length > 1)
        .map(([stageName, files]) => `${stageName}: ${files.sort().join(", ")}`);
    } catch {
      artifactPlaceholderHits = [];
      duplicateArtifactGroups = [];
    }
  }
  checks.push({
    name: "warning:artifacts:stale_placeholders",
    ok: true,
    details: artifactPlaceholderHits.length === 0
      ? "no TODO/TBD/FIXME placeholder markers found in active artifacts"
      : `warning: placeholder markers detected in active artifacts (${artifactPlaceholderHits.join(", ")}). Clear before marking completion.`
  });
  checks.push({
    name: "warning:artifacts:duplicate_stage_artifacts",
    ok: duplicateArtifactGroups.length === 0,
    details: duplicateArtifactGroups.length === 0
      ? "no duplicate stage artifacts detected in active artifacts"
      : `warning: duplicate stage artifacts detected (${duplicateArtifactGroups.join("; ")}). The resolver uses the newest matching file; archive or rename stale copies to avoid ambiguous operator handoff.`
  });
  const staleStages = Object.keys(flowState.staleStages).filter((value) =>
    FLOW_STAGES.includes(value as (typeof FLOW_STAGES)[number])
  );
  checks.push({
    name: "state:stale_stages_resolved",
    ok: staleStages.length === 0,
    details: staleStages.length === 0
      ? "no stale stages pending acknowledgement"
      : `stale stages pending acknowledgement: ${staleStages.join(", ")}. Re-run the current stale stage, then clear it with cclaw internal rewind --ack ${flowState.currentStage}.`
  });
  const retroGateStatus = await evaluateRetroGate(projectRoot, flowState);
  checks.push({
    name: "state:retro_gate",
    ok: retroGateStatus.completed,
    details: retroGateStatus.completed
      ? retroGateStatus.required
        ? retroGateStatus.skipped
          ? "retro gate complete (retro skipped with recorded closeout decision)"
          : `retro gate complete (${retroGateStatus.compoundEntries} compound entries)`
        : "retro gate not required yet (ship not completed)"
      : "retro gate incomplete: ship flow requires recorded retrospective evidence or an explicit retro skip."
  });
  const tddLogPath = path.join(projectRoot, RUNTIME_ROOT, "state", "tdd-cycle-log.jsonl");
  const tddLogExists = await exists(tddLogPath);
  const tddCompleted = flowState.completedStages.includes("tdd")
    || (flowState.currentStage === "review" || flowState.currentStage === "ship");
  checks.push({
    name: "state:tdd_cycle_log_exists",
    ok: tddLogExists || !tddCompleted,
    details: tddLogExists
      ? `${RUNTIME_ROOT}/state/tdd-cycle-log.jsonl exists`
      : tddCompleted
        ? `${RUNTIME_ROOT}/state/tdd-cycle-log.jsonl must exist once TDD is complete`
        : `${RUNTIME_ROOT}/state/tdd-cycle-log.jsonl will be created when TDD evidence is generated`
  });
  if (tddLogExists) {
    const tddLogRaw = await fs.readFile(tddLogPath, "utf8");
    const parsedCycles = parseTddCycleLog(tddLogRaw);
    const validation = validateTddCycleOrder(parsedCycles, { runId: activeRunId || undefined });
    const hasCoverage = validation.sliceCount > 0;
    checks.push({
      name: "state:tdd_cycle_order",
      ok: validation.ok && (!tddCompleted || hasCoverage),
      details: validation.ok
        ? tddCompleted && !hasCoverage
          ? "tdd stage complete but no RED/GREEN cycle evidence logged"
          : `tdd cycle log valid (${validation.sliceCount} slice(s), open_red=${validation.openRedSlices.length})`
        : `tdd cycle order issues: ${validation.issues.join("; ")}${
            validation.openRedSlices.length > 0
              ? ` | open red slices: ${validation.openRedSlices.join(", ")}`
              : ""
          }`
    });
  } else {
    checks.push({
      name: "state:tdd_cycle_order",
      ok: !tddCompleted,
      details: tddCompleted
        ? "tdd stage complete but tdd-cycle-log.jsonl is missing"
        : "tdd cycle order deferred until tdd stage evidence is generated"
    });
  }
  checks.push({
    name: "runs:archive_root",
    ok: await exists(path.join(projectRoot, RUNTIME_ROOT, "runs")),
    details: `${RUNTIME_ROOT}/runs must exist for archived run snapshots`
  });
  const initRecovery = await initRecoveryCheck(projectRoot);
  checks.push({
    name: "state:init_recovery",
    ok: initRecovery.ok,
    details: initRecovery.details
  });
  const archiveIntegrity = await archiveIntegrityCheck(projectRoot);
  checks.push({
    name: "runs:archive_integrity",
    ok: archiveIntegrity.ok,
    details: archiveIntegrity.details
  });

  const currentGateState = flowState.stageGateCatalog[flowState.currentStage];
  const currentStageUntouched =
    flowState.completedStages.length === 0 &&
    flowState.rewinds.length === 0 &&
    Object.keys(flowState.guardEvidence).length === 0 &&
    (currentGateState?.passed.length ?? 0) === 0 &&
    (currentGateState?.blocked.length ?? 0) === 0;
  const delegation = await checkMandatoryDelegations(projectRoot, flowState.currentStage, {
    repairFeatureSystem: false
  });
  const delegationEvents = await readDelegationEvents(projectRoot);
  const delegationSatisfiedForDoctor = currentStageUntouched || delegation.satisfied;
  const missingEvidenceNote =
    delegation.missingEvidence && delegation.missingEvidence.length > 0
      ? ` (role-switch rows without evidenceRefs: ${delegation.missingEvidence.join(", ")})`
      : "";
  checks.push({
    name: "delegation:mandatory:current_stage",
    ok: delegationSatisfiedForDoctor,
    details: currentStageUntouched
      ? `mandatory delegation check deferred for untouched stage "${flowState.currentStage}"; stage-complete enforces it when work begins`
      : delegation.satisfied
        ? `All mandatory delegations satisfied for stage "${flowState.currentStage}" (mode: ${delegation.expectedMode})`
        : `Missing mandatory delegations for stage "${flowState.currentStage}": ${delegation.missing.join(", ")}${missingEvidenceNote}; missingDispatchProof=${delegation.missingDispatchProof.join(", ")}; staleWorkers=${delegation.staleWorkers.join(", ")}; corruptEventLines=${delegation.corruptEventLines.join(", ")}`
  });

  checks.push({
    name: "delegation:events:parse",
    ok: delegationEvents.corruptLines.length === 0,
    details: delegationEvents.corruptLines.length === 0
      ? `${RUNTIME_ROOT}/state/delegation-events.jsonl parsed successfully (${delegationEvents.events.length} event(s))`
      : `corrupt delegation event line(s): ${delegationEvents.corruptLines.join(", ")}`
  });
  checks.push({
    name: "delegation:proof:current_stage",
    ok: currentStageUntouched || delegation.missingDispatchProof.length === 0,
    details: currentStageUntouched
      ? `dispatch proof check deferred for untouched stage "${flowState.currentStage}"`
      : delegation.missingDispatchProof.length === 0
        ? `no dispatch proof gaps for current stage "${flowState.currentStage}"`
        : `isolated completions missing dispatchId/dispatchSurface/agentDefinitionPath/ackTs/completedTs: ${delegation.missingDispatchProof.join(", ")}`
  });
  checks.push({
    name: "warning:delegation:legacy_inferred_completions",
    ok: true,
    details: delegation.legacyInferredCompletions.length > 0
      ? `warning: legacy inferred isolated completion rows lack event-log proof: ${delegation.legacyInferredCompletions.join(", ")}`
      : "no legacy inferred isolated completions for current stage"
  });

  checks.push({
    name: "warning:delegation:waived",
    ok: true,
    details: delegation.waived.length > 0
      ? `warning: waived mandatory delegations for stage "${flowState.currentStage}": ${delegation.waived.join(", ")}`
      : "no waived mandatory delegations for current stage"
  });
  checks.push({
    name: "warning:delegation:stale_runs",
    ok: true,
    details: delegation.staleIgnored.length > 0
      ? `warning: ${delegation.staleIgnored.length} delegation entries from other runs were ignored: ${delegation.staleIgnored.join(", ")}`
      : "no stale delegation entries from prior runs"
  });

  const trace = await buildTraceMatrix(projectRoot);
  const artifactsDir = path.join(projectRoot, RUNTIME_ROOT, "artifacts");
  const specExists = await exists(path.join(artifactsDir, "04-spec.md"));
  const planExists = await exists(path.join(artifactsDir, "05-plan.md"));
  const tddExists = await exists(path.join(artifactsDir, "06-tdd.md"));
  const traceHasSignal =
    trace.entries.length > 0 ||
    trace.orphanedCriteria.length > 0 ||
    trace.orphanedTasks.length > 0 ||
    trace.orphanedTests.length > 0;
  const artifactsPresent = specExists || planExists || tddExists;
  const emptyMatrixWithArtifacts = !traceHasSignal && artifactsPresent;
  checks.push({
    name: "trace:matrix_populated",
    ok: !emptyMatrixWithArtifacts,
    details: emptyMatrixWithArtifacts
      ? `trace matrix is empty but artifacts exist (${[
          specExists ? "04-spec.md" : null,
          planExists ? "05-plan.md" : null,
          tddExists ? "06-tdd.md" : null
        ].filter(Boolean).join(", ")}). The extractors found no criterion/task/slice IDs — check heading conventions and ID formats.`
      : artifactsPresent
        ? `trace matrix parsed ${trace.entries.length} criterion(s) from present artifacts`
        : "no downstream artifacts to trace yet"
  });
  checks.push({
    name: "trace:criteria_coverage",
    ok: !traceHasSignal || trace.orphanedCriteria.length === 0,
    details: trace.orphanedCriteria.length === 0
      ? "all spec criteria are linked to plan tasks"
      : `orphaned criteria: ${trace.orphanedCriteria.join(", ")}`
  });
  checks.push({
    name: "trace:task_to_test_coverage",
    ok: !traceHasSignal || trace.orphanedTasks.length === 0,
    details: trace.orphanedTasks.length === 0
      ? "all plan tasks are linked to test slices"
      : `orphaned tasks: ${trace.orphanedTasks.join(", ")}`
  });
  checks.push({
    name: "trace:test_to_criteria_coverage",
    ok: !traceHasSignal || trace.orphanedTests.length === 0,
    details: trace.orphanedTests.length === 0
      ? "all test slices map to acceptance-linked tasks"
      : `orphaned test slices: ${trace.orphanedTests.join(", ")}`
  });

  // Slice-review warning (opt-in via config.sliceReview.enabled).
  // Fires when:
  //   - sliceReview.enabled is true
  //   - current track is listed in sliceReview.enforceOnTracks
  //   - 06-tdd.md exists (so the slice loop actually started)
  //   - artifact contains at least one slice marker (look for the tdd
  //     "Acceptance Mapping" or any `### Slice` heading) AND the Per-Slice
  //     Review heading is absent
  // Non-blocking — warnings guide the user toward adding the review
  // section without failing doctor.
  const sliceReviewConfig = parsedConfig?.sliceReview;
  const sliceReviewEnabled = sliceReviewConfig?.enabled === true;
  const sliceReviewEnforcedTracks = sliceReviewConfig?.enforceOnTracks ?? ["standard"];
  const sliceReviewEnforcedHere =
    sliceReviewEnabled && sliceReviewEnforcedTracks.includes(activeTrack);
  if (sliceReviewEnforcedHere && tddExists) {
    const tddMarkdown = await fs.readFile(path.join(artifactsDir, "06-tdd.md"), "utf8");
    const hasSliceSignal = /^###\s+Slice\b/im.test(tddMarkdown)
      || /^##\s+Acceptance Mapping\b/im.test(tddMarkdown)
      || /^##\s+RED\b/im.test(tddMarkdown);
    const hasReviewHeading = /^##\s+Per-Slice Review\b/im.test(tddMarkdown);
    const missing = hasSliceSignal && !hasReviewHeading;
    checks.push({
      name: "warning:slice_review:missing_section",
      ok: !missing,
      details: missing
        ? `warning: sliceReview is enabled for track "${activeTrack}" and 06-tdd.md contains slice evidence but no "## Per-Slice Review" section. Add a Per-Slice Review entry for every triggered slice (touchCount >= ${sliceReviewConfig?.filesChangedThreshold ?? 5}, touchPaths match, or highRisk=true), or record "not triggered" explicitly.`
        : hasReviewHeading
          ? `sliceReview section present in 06-tdd.md (track "${activeTrack}")`
          : `sliceReview enabled but no slice evidence yet in 06-tdd.md (track "${activeTrack}")`
    });
  }

  const gateEvidence = await verifyCurrentStageGateEvidence(projectRoot, flowState);
  checks.push({
    name: "gates:evidence:current_stage",
    ok: gateEvidence.ok,
    details: gateEvidence.ok
      ? `stage "${gateEvidence.stage}" gate evidence is consistent (required=${gateEvidence.requiredCount}, recommended=${gateEvidence.recommendedCount}, conditional=${gateEvidence.conditionalCount}, triggered=${gateEvidence.triggeredConditionalCount}, passed=${gateEvidence.passedCount}, blocked=${gateEvidence.blockedCount})`
      : gateEvidence.issues.join(" ")
  });
  checks.push({
    name: "warning:gates:recommended:current_stage",
    ok: true,
    details: gateEvidence.missingRecommended.length > 0
      ? `warning: stage "${gateEvidence.stage}" has unmet recommended gates: ${gateEvidence.missingRecommended.join(", ")}`
      : `no unmet recommended gates for stage "${gateEvidence.stage}"`
  });

  const completedClosure = verifyCompletedStagesGateClosure(flowState);
  checks.push({
    name: "gates:closure:completed_stages",
    ok: completedClosure.ok,
    details: completedClosure.ok
      ? flowState.completedStages.length === 0
        ? "no completed stages yet"
        : `all ${flowState.completedStages.length} completed stages have every required gate passed`
      : completedClosure.issues.join(" ")
  });

  const isRepo = await isGitRepo(projectRoot);
  checks.push({
    name: "git:cclaw_ignored_runtime",
    ok: isRepo ? await gitIgnoresRuntime(projectRoot) : true,
    details: isRepo
      ? `git check-ignore must pass for ${RUNTIME_ROOT}/`
      : "repository not initialized; check skipped"
  });

  const rulesJsonPath = path.join(projectRoot, RUNTIME_ROOT, "rules", "rules.json");
  let hasRules = false;
  if (await exists(rulesJsonPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(rulesJsonPath, "utf8")) as Record<string, unknown>;
      const hasCoreLists = Array.isArray(parsed.MUST_ALWAYS) && Array.isArray(parsed.MUST_NEVER);
      const stageOrder = parsed.stage_order;
      const stageGates = parsed.stage_gates;
      const hasStageOrder =
        Array.isArray(stageOrder) &&
        FLOW_STAGES.every((stage) => stageOrder.includes(stage));
      const hasStageGates =
        typeof stageGates === "object" &&
        stageGates !== null &&
        FLOW_STAGES.every((stage) =>
          Array.isArray((stageGates as Record<string, unknown[]>)[stage])
        );

      hasRules = hasCoreLists && hasStageOrder && hasStageGates;
    } catch {
      hasRules = false;
    }
  }
  checks.push({
    name: "rules:policy_schema",
    ok: hasRules,
    details: rulesJsonPath
  });

  const policy = await policyChecks(projectRoot, { harnesses: configuredHarnesses });
  checks.push(...policy);

  return checks.map((check): DoctorCheck => {
    const metadata = doctorCheckMetadata(check.name);
    return {
      ...check,
      severity: check.severity ?? metadata.severity,
      summary: check.summary ?? metadata.summary,
      fix: check.fix ?? metadata.fix,
      docRef: check.docRef ?? metadata.docRef
    };
  });
}

export function doctorSucceeded(checks: DoctorCheck[]): boolean {
  return checks.every((check) => check.ok || check.severity !== "error");
}
