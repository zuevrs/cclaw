#!/usr/bin/env node
import { createReadStream, existsSync, realpathSync } from "node:fs";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import process from "node:process";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { FLOW_TRACKS, HARNESS_IDS } from "./types.js";
import { doctorChecks, doctorSucceeded } from "./doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { error, info } from "./logger.js";
import type { CliContext, FlowTrack, HarnessId } from "./types.js";
import { archiveRun } from "./runs.js";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { createDefaultConfig } from "./config.js";
import { detectHarnesses } from "./init-detect.js";
import { HARNESS_ADAPTERS } from "./harness-adapters.js";
import {
  classifyCodexHooksFlag,
  codexConfigPath,
  patchCodexHooksFlag,
  readCodexConfig,
  writeCodexConfig
} from "./codex-feature-flag.js";
import { runEval } from "./eval/runner.js";
import { createStderrProgressLogger } from "./eval/progress.js";
import { writeBaselinesFromReport } from "./eval/baseline.js";
import { writeJsonReport, writeMarkdownReport } from "./eval/report.js";
import { formatDiffMarkdown, runEvalDiff } from "./eval/diff.js";
import {
  ensureRunDir,
  generateRunId,
  isRunAlive,
  listRuns,
  readRunStatus,
  resolveRunId,
  runLogPath,
  writeRunStatus,
  type EvalRunStatus
} from "./eval/runs.js";
import { EVAL_MODES } from "./eval/types.js";
import type { EvalMode } from "./eval/types.js";
import { parseModeInput } from "./eval/mode.js";
import { FLOW_STAGES } from "./types.js";
import { runInternalCommand } from "./internal/advance-stage.js";

type CommandName =
  | "init"
  | "sync"
  | "doctor"
  | "upgrade"
  | "uninstall"
  | "archive"
  | "eval"
  | "internal";
const INSTALLER_COMMANDS: CommandName[] = [
  "init",
  "sync",
  "doctor",
  "upgrade",
  "uninstall",
  "archive",
  "eval",
  "internal"
];

interface ParsedArgs {
  command?: CommandName;
  harnesses?: HarnessId[];
  track?: FlowTrack;
  dryRun?: boolean;
  interactive?: boolean;
  reconcileGates?: boolean;
  doctorJson?: boolean;
  doctorExplain?: boolean;
  doctorQuiet?: boolean;
  doctorOnly?: string[];
  archiveName?: string;
  archiveSkipRetro?: boolean;
  archiveSkipRetroReason?: string;
  evalStage?: string;
  evalMode?: EvalMode;
  evalSchemaOnly?: boolean;
  evalRules?: boolean;
  evalJudge?: boolean;
  evalJson?: boolean;
  evalNoWrite?: boolean;
  evalUpdateBaseline?: boolean;
  evalConfirm?: boolean;
  evalQuiet?: boolean;
  evalMaxCostUsd?: number;
  /** Optional subcommand after `eval`. */
  evalSubcommand?: "diff" | "runs";
  /** Positional arguments for eval subcommands (e.g. `diff <old> <new>`). */
  evalArgs?: string[];
  evalBackground?: boolean;
  evalCompareModel?: string;
  /** Hidden plumbing command (`cclaw internal ...`) arguments. */
  internalArgs?: string[];
  showHelp?: boolean;
  showVersion?: boolean;
}

export function usage(): string {
  return `cclaw - installer-first flow toolkit

Usage:
  npx cclaw-cli                   # launch setup or print "already installed" hint
  npx cclaw-cli <command> [flags]
  npx cclaw-cli --help | -h
  npx cclaw-cli --version | -v

Commands:
  init       Bootstrap .cclaw runtime, state, and harness shims in this project.
             Flags: --harnesses=<list>  Comma list of harnesses (claude,cursor,opencode,codex).
                    --no-interactive    Skip interactive prompts even on TTY (for CI/scripts).
  sync       Reconcile generated runtime files with the current config.
  upgrade    Refresh generated files in .cclaw. Preserves your config.yaml.
  archive    Archive the active run and reset flow state for next feature.
             Flags: --name=<slug>        Override archive folder suffix.
                    --skip-retro         Skip retro gate only when runtime allows it.
                    --retro-reason=<txt> Required rationale with --skip-retro.
  uninstall  Remove .cclaw runtime and the generated harness shim files.
  eval       Run cclaw evals. Maintainer surface — see docs/evals.md.
             Full flag reference: \`npx cclaw-cli eval --help\` or docs/evals.md.

Global flags:
  -h, --help     Show this help message and exit 0.
  -v, --version  Print the cclaw CLI version and exit 0.

Examples:
  npx cclaw-cli
  npx cclaw-cli init --harnesses=claude,cursor --no-interactive
  npx cclaw-cli sync
  npx cclaw-cli archive --name=my-feature
  npx cclaw-cli upgrade
  npx cclaw-cli eval --dry-run

Everything operational (retro, archive, worktrees, doctor, learnings)
happens inside your harness via slash commands. The CLI is just a
launcher. See README.md for the four user-facing slash commands.

Docs:   https://github.com/zuevrs/cclaw
Issues: https://github.com/zuevrs/cclaw/issues
`;
}

function parseHarnesses(raw: string): HarnessId[] {
  const requested = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const invalid = requested.filter((item) => !HARNESS_IDS.includes(item as HarnessId));
  if (invalid.length > 0) {
    throw new Error(`Unknown harnesses: ${invalid.join(", ")}`);
  }

  return requested as HarnessId[];
}

function parseTrack(raw: string): FlowTrack {
  const trimmed = raw.trim();
  if (!(FLOW_TRACKS as readonly string[]).includes(trimmed)) {
    throw new Error(`Unknown track: ${trimmed}. Supported: ${FLOW_TRACKS.join(", ")}`);
  }
  return trimmed as FlowTrack;
}

function parseLegacyTier(raw: string): EvalMode {
  return parseModeInput(raw.toUpperCase(), {
    source: "cli",
    raw: `--tier=${raw}`
  });
}

function parseEvalMode(raw: string): EvalMode {
  return parseModeInput(raw, {
    source: "cli",
    raw: `--mode=${raw}`
  });
}

function parseEvalStage(raw: string): string {
  const trimmed = raw.trim();
  if (!(FLOW_STAGES as readonly string[]).includes(trimmed)) {
    throw new Error(`Unknown eval stage: ${raw}. Supported: ${FLOW_STAGES.join(", ")}`);
  }
  return trimmed;
}

function isInitPromptAllowed(ctx: CliContext): boolean {
  return Boolean(process.stdin.isTTY && ctx.stdout.isTTY);
}

/**
 * Print a short, friendly hint when the user runs `cclaw-cli` with no
 * arguments. Does not read or mutate flow state — only checks whether
 * `.cclaw/config.yaml` exists to branch between "installed" and
 * "not-installed" messaging. Keeps exit 0 in both cases: users discover
 * the tool through this path, not through an error.
 */
function printNoArgsHint(ctx: CliContext): number {
  const installed = existsSync(path.join(ctx.cwd, RUNTIME_ROOT, "config.yaml"));
  if (installed) {
    ctx.stdout.write(
      "cclaw is installed in this project. Open your harness (Claude Code, " +
        "Cursor, OpenCode, or Codex) and type `/cc` to start.\n"
    );
  } else {
    ctx.stdout.write(
      "cclaw is not installed in this project yet.\n" +
        "Run `npx cclaw-cli init` to bootstrap .cclaw and the harness shims.\n" +
        "For help: `npx cclaw-cli --help`.\n"
    );
  }
  return 0;
}

function buildInitSurfacePreview(harnesses: HarnessId[]): string[] {
  const lines = [
    ".cclaw/config.yaml",
    ".cclaw/commands/*.md",
    ".cclaw/skills/*/SKILL.md",
    ".cclaw/contexts/*.md",
    ".cclaw/templates/*",
    ".cclaw/agents/*.md",
    ".cclaw/hooks/*",
    ".cclaw/rules/**",
    ".cclaw/adapters/*.md",
    ".cclaw/custom-skills/README.md",
    ".cclaw/worktrees/**",
    ".cclaw/features/** (legacy snapshots, read-only migration)",
    ".cclaw/runs/**",
    ".cclaw/artifacts/**",
    ".cclaw/knowledge.jsonl",
    ".cclaw/state/*.json|*.jsonl",
    ".cclaw/references/**",
    "AGENTS.md (managed block)"
  ];
  for (const harness of harnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    if (adapter.shimKind === "skill") {
      lines.push(`${adapter.commandDir}/cc*/SKILL.md`);
    } else {
      lines.push(`${adapter.commandDir}/cc*.md`);
    }
    if (harness === "claude") {
      lines.push(".claude/hooks/hooks.json");
    }
    if (harness === "cursor") {
      lines.push(".cursor/hooks.json");
      lines.push(".cursor/rules/cclaw-workflow.mdc");
    }
    if (harness === "codex") {
      // v0.40.0: .codex/hooks.json is managed again now that Codex CLI
      // grew a real hooks API (v0.114+, behind the `codex_hooks`
      // feature flag). Legacy `.codex/commands/*` is still auto-cleaned.
      lines.push(".codex/hooks.json (requires `codex_hooks = true` in ~/.codex/config.toml)");
    }
    if (harness === "opencode") {
      lines.push(".opencode/plugins/cclaw-plugin.mjs");
      lines.push("opencode.json(.c) plugin registration");
    }
  }
  return lines;
}

async function promptInitConfig(
  defaults: { harnesses: HarnessId[] },
  ctx: CliContext
): Promise<{ harnesses: HarnessId[] }> {
  const rl = createInterface({
    input: process.stdin,
    output: ctx.stdout
  });

  const pickHarnesses = async (fallback: HarnessId[]): Promise<HarnessId[]> => {
    const fallbackText = fallback.join(",");
    while (true) {
      const answer = (await rl.question(
        `\nHarnesses (comma list from ${HARNESS_IDS.join(", ")}) [${fallbackText}]: `
      )).trim();
      if (answer.length === 0) {
        return fallback;
      }
      try {
        const parsed = parseHarnesses(answer);
        if (parsed.length === 0) {
          ctx.stdout.write("Select at least one harness.\n");
          continue;
        }
        return parsed;
      } catch (err) {
        ctx.stdout.write(`${err instanceof Error ? err.message : "Invalid harness list"}\n`);
      }
    }
  };

  try {
    const harnesses = await pickHarnesses(defaults.harnesses);
    return { harnesses };
  } finally {
    rl.close();
  }
}

/**
 * When Codex is one of the installed harnesses, check the Codex CLI
 * config file for the `codex_hooks` feature flag. If it is missing or
 * disabled, offer to patch it in with the user's explicit consent.
 *
 * The function is deliberately advisory: it never fails init — the worst
 * case is that Codex runs without the hooks engine, which is exactly
 * how v0.39.x already shipped. We always print a resolution hint so
 * the user knows what to do next regardless of which branch was taken.
 */
async function maybeEnableCodexHooksFlag(
  harnesses: HarnessId[] | undefined,
  parsed: ParsedArgs,
  ctx: CliContext
): Promise<void> {
  if (!harnesses || !harnesses.includes("codex")) return;

  const configPath = codexConfigPath();
  let existing: string | null;
  try {
    existing = await readCodexConfig(configPath);
  } catch (err) {
    ctx.stdout.write(
      `note: Could not read ${configPath} to check the codex_hooks flag: ` +
        `${err instanceof Error ? err.message : String(err)}\n`
    );
    return;
  }

  const state = classifyCodexHooksFlag(existing);
  if (state === "enabled") {
    return;
  }

  const humanState =
    state === "missing-file"
      ? "Codex config file does not exist yet"
      : state === "missing-section"
        ? "no [features] section"
        : state === "missing-key"
          ? "no codex_hooks key"
          : "codex_hooks is not enabled";

  const instructions =
    `To enable Codex hooks manually later, ensure ${configPath} contains:\n` +
      `  [features]\n  codex_hooks = true\n`;

  if (parsed.interactive === false) {
    ctx.stdout.write(
      `note: codex_hooks feature flag is not enabled (${humanState}).\n` +
        `      cclaw wrote .codex/hooks.json, but Codex will ignore it until you enable the flag.\n` +
        `      ${instructions}`
    );
    return;
  }

  if (!isInitPromptAllowed(ctx)) {
    ctx.stdout.write(
      `note: codex_hooks feature flag is not enabled (${humanState}).\n` +
        `      cclaw wrote .codex/hooks.json, but Codex will ignore it until you enable the flag.\n` +
        `      ${instructions}`
    );
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: ctx.stdout
  });
  try {
    const answer = (await rl.question(
      `\nCodex CLI hooks are off (${humanState}).\n` +
        `Enable [features] codex_hooks = true in ${configPath} now? [y/N]: `
    )).trim().toLowerCase();
    const yes = answer === "y" || answer === "yes";
    if (!yes) {
      ctx.stdout.write(
        `Leaving ${configPath} untouched. ${instructions}`
      );
      return;
    }

    const { updated, changed } = patchCodexHooksFlag(existing);
    if (!changed) {
      ctx.stdout.write(
        `codex_hooks is already enabled — no changes written.\n`
      );
      return;
    }
    try {
      await writeCodexConfig(configPath, updated);
      ctx.stdout.write(
        `Enabled [features] codex_hooks = true in ${configPath}.\n`
      );
    } catch (err) {
      ctx.stdout.write(
        `Could not write ${configPath}: ` +
          `${err instanceof Error ? err.message : String(err)}\n` +
          `${instructions}`
      );
    }
  } finally {
    rl.close();
  }
}

async function resolveInitInputs(parsed: ParsedArgs, ctx: CliContext): Promise<{
  track?: FlowTrack;
  harnesses?: HarnessId[];
  detectedHarnesses: HarnessId[];
}> {
  const detectedHarnesses = parsed.harnesses ? [] : await detectHarnesses(ctx.cwd);
  const autoHarnesses = parsed.harnesses
    ? parsed.harnesses
    : (detectedHarnesses.length > 0 ? detectedHarnesses : undefined);

  const promptRequested = parsed.interactive === true;
  const promptForbidden = parsed.interactive === false;
  const implicitPrompt =
    !promptForbidden &&
    isInitPromptAllowed(ctx) &&
    parsed.track === undefined &&
    parsed.harnesses === undefined;
  const shouldPrompt = promptRequested || implicitPrompt;

  if (!shouldPrompt) {
    return {
      track: parsed.track,
      harnesses: autoHarnesses,
      detectedHarnesses
    };
  }

  if (!isInitPromptAllowed(ctx)) {
    throw new Error("Interactive init requires a TTY. Remove --interactive or run in a terminal.");
  }

  const defaults = {
    harnesses: autoHarnesses ?? HARNESS_IDS.slice()
  };
  const prompted = await promptInitConfig(defaults, ctx);
  return {
    track: parsed.track,
    harnesses: prompted.harnesses,
    detectedHarnesses
  };
}

function parseDoctorOnly(raw: string): string[] {
  return raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function filterDoctorChecks(
  checks: Awaited<ReturnType<typeof doctorChecks>>,
  filters: string[] | undefined
): Awaited<ReturnType<typeof doctorChecks>> {
  if (!filters || filters.length === 0) {
    return checks;
  }
  return checks.filter((check) => {
    const name = check.name.toLowerCase();
    return filters.some((filter) => {
      if (filter === "error" || filter === "warning" || filter === "info") {
        return check.severity === filter;
      }
      return name.includes(filter);
    });
  });
}

function doctorCountsBySeverity(checks: Awaited<ReturnType<typeof doctorChecks>>): {
  error: { total: number; failing: number };
  warning: { total: number; failing: number };
  info: { total: number; failing: number };
} {
  const result = {
    error: { total: 0, failing: 0 },
    warning: { total: 0, failing: 0 },
    info: { total: 0, failing: 0 }
  };
  for (const check of checks) {
    const bucket = result[check.severity];
    bucket.total += 1;
    if (!check.ok) {
      bucket.failing += 1;
    }
  }
  return result;
}

function printDoctorText(
  ctx: CliContext,
  checks: Awaited<ReturnType<typeof doctorChecks>>,
  options: { explain: boolean; quiet: boolean }
): void {
  const orderedSeverities: Array<"error" | "warning" | "info"> = ["error", "warning", "info"];
  const view = options.quiet ? checks.filter((check) => !check.ok) : checks;

  for (const severity of orderedSeverities) {
    const inBucket = view.filter((check) => check.severity === severity);
    if (inBucket.length === 0) continue;
    ctx.stdout.write(`\n[${severity.toUpperCase()}]\n`);
    for (const check of inBucket) {
      const status = check.ok ? "PASS" : "FAIL";
      ctx.stdout.write(`${status} ${check.name} :: ${check.summary}\n`);
      if (!options.quiet) {
        ctx.stdout.write(`  details: ${check.details}\n`);
      }
      if (options.explain) {
        ctx.stdout.write(`  fix: ${check.fix}\n`);
        if (check.docRef) {
          ctx.stdout.write(`  docs: ${check.docRef}\n`);
        }
      }
    }
  }

  const counts = doctorCountsBySeverity(checks);
  const failingErrors = checks.filter((check) => check.severity === "error" && !check.ok).length;
  ctx.stdout.write(
    `\nTotals: error ${counts.error.failing}/${counts.error.total} failing, ` +
      `warning ${counts.warning.failing}/${counts.warning.total} failing, ` +
      `info ${counts.info.failing}/${counts.info.total} failing\n`
  );
  if (failingErrors > 0) {
    ctx.stdout.write(`Doctor status: BLOCKED (${failingErrors} failing error checks)\n`);
  } else {
    ctx.stdout.write("Doctor status: HEALTHY (no failing error checks)\n");
  }
}

function resolveMaxCostOption(
  fromCli: number | undefined,
  env: NodeJS.ProcessEnv
): { maxCostUsd?: number } {
  if (fromCli !== undefined) return { maxCostUsd: fromCli };
  const raw = env.CCLAW_EVAL_MAX_COST_USD;
  if (raw === undefined || raw.trim() === "") return {};
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(
      `CCLAW_EVAL_MAX_COST_USD must be a positive number, got: ${raw}`
    );
  }
  return { maxCostUsd: value };
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {};

  const helpFlag = argv.find((arg) => arg === "--help" || arg === "-h");
  if (helpFlag) {
    parsed.showHelp = true;
  }
  const versionFlag = argv.find((arg) => arg === "--version" || arg === "-v");
  if (versionFlag) {
    parsed.showVersion = true;
  }

  const filteredArgv = argv.filter(
    (arg) => arg !== "--help" && arg !== "-h" && arg !== "--version" && arg !== "-v"
  );
  const [commandRaw, ...rest] = filteredArgv;
  parsed.command = INSTALLER_COMMANDS.includes(commandRaw as CommandName)
    ? (commandRaw as CommandName)
    : undefined;

  // Hidden maintainer surface for runtime guards/helpers. Keep raw positional
  // args untouched so subcommand-level parsing can evolve independently.
  if (parsed.command === "internal") {
    parsed.internalArgs = [...rest];
    return parsed;
  }

  // For `eval`, the next non-flag argument is an optional subcommand. Any
  // subsequent non-flag tokens are captured as evalArgs (consumed by the
  // subcommand handler). This preserves backwards compat: callers that run
  // `cclaw eval --dry-run` see no subcommand and no positional args.
  let flags: string[] = rest;
  if (parsed.command === "eval") {
    const evalArgs: string[] = [];
    const remainder: string[] = [];
    let sawSubcommand = false;
    for (const token of rest) {
      if (token.startsWith("--")) {
        remainder.push(token);
        continue;
      }
      if (!sawSubcommand) {
        if (token === "diff") {
          parsed.evalSubcommand = "diff";
          sawSubcommand = true;
        } else if (token === "runs") {
          parsed.evalSubcommand = "runs";
          sawSubcommand = true;
        } else {
          evalArgs.push(token);
        }
        continue;
      }
      evalArgs.push(token);
    }
    if (evalArgs.length > 0) parsed.evalArgs = evalArgs;
    flags = remainder;
  }

  for (const flag of flags) {
    if (flag.startsWith("--harnesses=")) {
      parsed.harnesses = parseHarnesses(flag.replace("--harnesses=", ""));
      continue;
    }
    if (flag.startsWith("--track=")) {
      parsed.track = parseTrack(flag.replace("--track=", ""));
      continue;
    }
    if (flag.startsWith("--profile=")) {
      continue;
    }
    if (flag === "--interactive") {
      parsed.interactive = true;
      continue;
    }
    if (flag === "--no-interactive") {
      parsed.interactive = false;
      continue;
    }
    if (flag === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (flag === "--reconcile-gates") {
      parsed.reconcileGates = true;
      continue;
    }
    if (flag === "--json") {
      parsed.doctorJson = true;
      continue;
    }
    if (flag === "--explain") {
      parsed.doctorExplain = true;
      continue;
    }
    if (flag === "--quiet") {
      parsed.doctorQuiet = true;
      continue;
    }
    if (flag.startsWith("--only=")) {
      parsed.doctorOnly = parseDoctorOnly(flag.replace("--only=", ""));
      continue;
    }
    if (flag.startsWith("--name=")) {
      parsed.archiveName = flag.replace("--name=", "").trim();
      continue;
    }
    if (flag === "--skip-retro") {
      parsed.archiveSkipRetro = true;
      continue;
    }
    if (flag.startsWith("--retro-reason=")) {
      parsed.archiveSkipRetroReason = flag.replace("--retro-reason=", "").trim();
      continue;
    }
    if (flag.startsWith("--stage=")) {
      parsed.evalStage = parseEvalStage(flag.replace("--stage=", ""));
      continue;
    }
    if (flag.startsWith("--mode=")) {
      parsed.evalMode = parseEvalMode(flag.replace("--mode=", ""));
      continue;
    }
    if (flag.startsWith("--tier=")) {
      parsed.evalMode = parseLegacyTier(flag.replace("--tier=", ""));
      continue;
    }
    if (flag === "--schema-only") {
      parsed.evalSchemaOnly = true;
      continue;
    }
    if (flag === "--rules") {
      parsed.evalRules = true;
      continue;
    }
    if (flag === "--judge") {
      parsed.evalJudge = true;
      continue;
    }
    if (flag === "--no-write") {
      parsed.evalNoWrite = true;
      continue;
    }
    if (flag === "--update-baseline") {
      parsed.evalUpdateBaseline = true;
      continue;
    }
    if (flag === "--confirm") {
      parsed.evalConfirm = true;
      continue;
    }
    if (flag === "--background") {
      parsed.evalBackground = true;
      continue;
    }
    if (flag.startsWith("--compare-model=")) {
      const value = flag.replace("--compare-model=", "").trim();
      if (value.length === 0) {
        throw new Error(
          `--compare-model requires a non-empty model id (e.g. --compare-model=gpt-4o-mini).`
        );
      }
      parsed.evalCompareModel = value;
      continue;
    }
    if (flag.startsWith("--max-cost-usd=")) {
      const raw = flag.replace("--max-cost-usd=", "").trim();
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new Error(
          `--max-cost-usd requires a positive number, got: ${raw}`
        );
      }
      parsed.evalMaxCostUsd = value;
      continue;
    }
  }

  // `--json` is shared between doctor and eval. Disambiguate by command.
  if (parsed.command === "eval" && parsed.doctorJson === true) {
    parsed.evalJson = true;
    parsed.doctorJson = undefined;
  }
  // `--quiet` on `eval` silences the stderr progress logger. On doctor it
  // continues to mean "print only failing checks" — the flag slot is the
  // same, the semantics depend on which command owns the invocation.
  if (parsed.command === "eval" && parsed.doctorQuiet === true) {
    parsed.evalQuiet = true;
    parsed.doctorQuiet = undefined;
  }

  return parsed;
}

/**
 * Spawn `cclaw eval` (without `--background`) in a detached child process
 * and return immediately. The child's stdout+stderr are piped to
 * `.cclaw/evals/runs/<id>/run.log` so the user can attach later with
 * `cclaw eval runs tail`. We do NOT wait for the child — the whole point
 * is to free the terminal while a multi-minute workflow-mode run
 * proceeds in the background.
 */
async function spawnBackgroundEval(
  parsed: ParsedArgs,
  ctx: CliContext
): Promise<number> {
  const id = generateRunId();
  await ensureRunDir(ctx.cwd, id);
  const logPath = runLogPath(ctx.cwd, id);
  const childArgv = process.argv.slice(2).filter((a) => a !== "--background");
  const cliEntry = process.argv[1];
  if (!cliEntry) {
    error(ctx, "Could not resolve cclaw entrypoint for --background.");
    return 1;
  }
  const logHandle = await fs.open(logPath, "a");
  try {
    const child = spawn(process.execPath, [cliEntry, ...childArgv], {
      cwd: ctx.cwd,
      detached: true,
      stdio: ["ignore", logHandle.fd, logHandle.fd],
      env: process.env
    });
    const pid = child.pid ?? -1;
    await writeRunStatus(ctx.cwd, {
      id,
      startedAt: new Date().toISOString(),
      pid,
      argv: childArgv,
      cwd: ctx.cwd,
      state: "running"
    });
    child.unref();
    const finalize = async (code: number | null): Promise<void> => {
      const current = await readRunStatus(ctx.cwd, id);
      if (!current) return;
      const exitCode = typeof code === "number" ? code : -1;
      await writeRunStatus(ctx.cwd, {
        ...current,
        endedAt: new Date().toISOString(),
        exitCode,
        state: exitCode === 0 ? "succeeded" : "failed"
      });
    };
    child.on("exit", (code) => {
      void finalize(code);
    });
    child.on("error", (err) => {
      void writeRunStatus(ctx.cwd, {
        id,
        startedAt: new Date().toISOString(),
        pid,
        argv: childArgv,
        cwd: ctx.cwd,
        endedAt: new Date().toISOString(),
        exitCode: -1,
        state: "failed"
      });
      error(ctx, `Background eval failed to start: ${err.message}`);
    });
    ctx.stdout.write(
      `cclaw eval: background run id=${id} pid=${pid}\n` +
        `  log:    ${logPath}\n` +
        `  tail:   cclaw eval runs tail ${id}\n` +
        `  status: cclaw eval runs status ${id}\n`
    );
    return 0;
  } finally {
    await logHandle.close();
  }
}

function formatRunRow(status: EvalRunStatus): string {
  const ended = status.endedAt ? ` ended=${status.endedAt}` : "";
  const exitCode =
    status.exitCode !== undefined ? ` exit=${status.exitCode}` : "";
  const alive =
    status.state === "running" ? (isRunAlive(status) ? "" : " (stale)") : "";
  return `${status.id}  state=${status.state}${alive}  pid=${status.pid}  started=${status.startedAt}${ended}${exitCode}`;
}

async function runEvalRunsSubcommand(
  parsed: ParsedArgs,
  ctx: CliContext
): Promise<number> {
  const args = parsed.evalArgs ?? [];
  const action = args[0] ?? "list";
  if (action === "list") {
    const runs = await listRuns(ctx.cwd);
    if (runs.length === 0) {
      ctx.stdout.write("No eval runs recorded under .cclaw/evals/runs/.\n");
      return 0;
    }
    if (parsed.evalJson === true) {
      ctx.stdout.write(`${JSON.stringify(runs, null, 2)}\n`);
      return 0;
    }
    for (const run of runs) ctx.stdout.write(`${formatRunRow(run)}\n`);
    return 0;
  }
  if (action === "status") {
    const id = await resolveRunId(ctx.cwd, args[1]);
    if (!id) {
      error(ctx, `No such run: ${args[1] ?? "(none recorded)"}`);
      return 1;
    }
    const status = await readRunStatus(ctx.cwd, id);
    if (!status) {
      error(ctx, `Run ${id} has no status file.`);
      return 1;
    }
    if (parsed.evalJson === true) {
      ctx.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
    } else {
      ctx.stdout.write(`${formatRunRow(status)}\n`);
      ctx.stdout.write(`log: ${runLogPath(ctx.cwd, id)}\n`);
    }
    return status.state === "failed" ? 1 : 0;
  }
  if (action === "tail") {
    const id = await resolveRunId(ctx.cwd, args[1]);
    if (!id) {
      error(ctx, `No such run: ${args[1] ?? "(none recorded)"}`);
      return 1;
    }
    const logFile = runLogPath(ctx.cwd, id);
    const stream = createReadStream(logFile, { encoding: "utf8" });
    await new Promise<void>((resolve, reject) => {
      stream.on("data", (chunk) => ctx.stdout.write(chunk));
      stream.on("end", () => resolve());
      stream.on("error", reject);
    });
    return 0;
  }
  error(
    ctx,
    `Unknown \`cclaw eval runs\` action: ${action}. Use list | status | tail.`
  );
  return 1;
}

/**
 * Run the same corpus twice — once against the configured model, once
 * against `--compare-model=<id>` — and print a summary comparing the
 * two. Both reports are written to `.cclaw/evals/reports/` (unless
 * `--no-write` is set) and a unified diff is emitted to stdout. Exit
 * code is 1 when the override model regressed against the baseline
 * model, 0 otherwise.
 */
async function runCompareModel(
  parsed: ParsedArgs,
  ctx: CliContext,
  progress: ReturnType<typeof createStderrProgressLogger> | undefined
): Promise<number> {
  const baselineOpts = {
    projectRoot: ctx.cwd,
    stage: parsed.evalStage as Parameters<typeof runEval>[0]["stage"],
    mode: parsed.evalMode,
    schemaOnly: parsed.evalSchemaOnly === true,
    rules: parsed.evalRules === true,
    judge: parsed.evalJudge === true,
    ...(progress ? { progress } : {}),
    ...resolveMaxCostOption(parsed.evalMaxCostUsd, process.env)
  };
  ctx.stderr.write(`[cclaw eval] compare: running baseline model...\n`);
  const baseline = await runEval(baselineOpts);
  if ("kind" in baseline) {
    error(ctx, "--compare-model is incompatible with --dry-run.");
    return 1;
  }
  ctx.stderr.write(
    `[cclaw eval] compare: running ${parsed.evalCompareModel} ...\n`
  );
  const candidate = await runEval({
    ...baselineOpts,
    modelOverride: parsed.evalCompareModel
  });
  if ("kind" in candidate) {
    error(ctx, "--compare-model received an unexpected dry-run response.");
    return 1;
  }
  if (parsed.evalNoWrite !== true) {
    await writeJsonReport(ctx.cwd, baseline);
    await writeMarkdownReport(ctx.cwd, baseline);
    await writeJsonReport(ctx.cwd, candidate);
    await writeMarkdownReport(ctx.cwd, candidate);
  }
  const passDelta = candidate.summary.passed - baseline.summary.passed;
  const failDelta = candidate.summary.failed - baseline.summary.failed;
  const costDelta =
    candidate.summary.totalCostUsd - baseline.summary.totalCostUsd;
  if (parsed.evalJson === true) {
    ctx.stdout.write(
      `${JSON.stringify(
        {
          baseline: {
            model: baseline.model,
            summary: baseline.summary
          },
          candidate: {
            model: candidate.model,
            summary: candidate.summary
          },
          delta: { passed: passDelta, failed: failDelta, costUsd: costDelta }
        },
        null,
        2
      )}\n`
    );
  } else {
    ctx.stdout.write(
      `cclaw eval compare-model:\n` +
        `  baseline   ${baseline.model}: pass=${baseline.summary.passed}/${baseline.summary.totalCases} ` +
        `fail=${baseline.summary.failed} cost=$${baseline.summary.totalCostUsd.toFixed(4)}\n` +
        `  candidate  ${candidate.model}: pass=${candidate.summary.passed}/${candidate.summary.totalCases} ` +
        `fail=${candidate.summary.failed} cost=$${candidate.summary.totalCostUsd.toFixed(4)}\n` +
        `  delta: passed=${passDelta >= 0 ? "+" : ""}${passDelta} ` +
        `failed=${failDelta >= 0 ? "+" : ""}${failDelta} ` +
        `cost=${costDelta >= 0 ? "+" : ""}$${costDelta.toFixed(4)}\n`
    );
  }
  return failDelta > 0 ? 1 : 0;
}

async function runCommand(parsed: ParsedArgs, ctx: CliContext): Promise<number> {
  if (parsed.showHelp) {
    ctx.stdout.write(usage());
    return 0;
  }
  if (parsed.showVersion) {
    ctx.stdout.write(`cclaw ${CCLAW_VERSION}\n`);
    return 0;
  }

  const command = parsed.command;
  if (!command) {
    return printNoArgsHint(ctx);
  }
  if (command === "internal") {
    return runInternalCommand(ctx.cwd, parsed.internalArgs ?? [], ctx);
  }

  if (command === "init") {
    const resolved = await resolveInitInputs(parsed, ctx);
    const effectiveTrack = resolved.track;
    const effectiveHarnesses = resolved.harnesses;

    if (parsed.dryRun === true) {
      const previewConfig = createDefaultConfig(effectiveHarnesses, effectiveTrack);
      const previewSurfaces = buildInitSurfacePreview(previewConfig.harnesses);
      info(ctx, "Dry run: no files were written.");
      if (resolved.detectedHarnesses.length > 0 && parsed.harnesses === undefined) {
        info(ctx, `Detected harnesses from repo: ${resolved.detectedHarnesses.join(", ")}`);
      }
      ctx.stdout.write(`${JSON.stringify({
        track: previewConfig.defaultTrack ?? "standard",
        harnesses: previewConfig.harnesses,
        promptGuardMode: previewConfig.promptGuardMode,
        gitHookGuards: previewConfig.gitHookGuards,
        languageRulePacks: previewConfig.languageRulePacks,
        generatedSurfaces: previewSurfaces
      }, null, 2)}\n`);
      return 0;
    }

    await initCclaw({
      projectRoot: ctx.cwd,
      harnesses: effectiveHarnesses,
      track: effectiveTrack
    });
    if (resolved.detectedHarnesses.length > 0 && parsed.harnesses === undefined) {
      info(ctx, `Detected harnesses from repo: ${resolved.detectedHarnesses.join(", ")}`);
    }
    const trackNote = effectiveTrack ? ` (track=${effectiveTrack})` : "";
    info(ctx, `Initialized .cclaw runtime and generated harness shims${trackNote}`);
    // Point new users at the one config surface they might actually flip —
    // `strictness` and `gitHookGuards` — without overselling the other knobs
    // (those live behind docs/config.md until someone needs them).
    info(
      ctx,
      "Config: .cclaw/config.yaml (strictness=advisory, gitHookGuards=false)."
    );
    info(
      ctx,
      "Need stricter guards or language rule packs? See docs/config.md."
    );
    await maybeEnableCodexHooksFlag(effectiveHarnesses, parsed, ctx);
    return 0;
  }

  if (command === "sync") {
    await syncCclaw(ctx.cwd);
    info(ctx, "Synchronized harness shims from current .cclaw config");
    return 0;
  }

  if (command === "doctor") {
    const checks = await doctorChecks(ctx.cwd, {
      reconcileCurrentStageGates: parsed.reconcileGates === true
    });
    const filteredChecks = filterDoctorChecks(checks, parsed.doctorOnly);
    const explain = parsed.doctorExplain === true;
    const quiet = parsed.doctorQuiet === true;

    if (parsed.doctorJson === true) {
      const counts = doctorCountsBySeverity(filteredChecks);
      ctx.stdout.write(
        `${JSON.stringify({
          ok: doctorSucceeded(checks),
          filters: parsed.doctorOnly ?? [],
          counts,
          checks: filteredChecks
        }, null, 2)}\n`
      );
    } else {
      if (filteredChecks.length === 0) {
        ctx.stdout.write("No checks matched the --only filter.\n");
      } else {
        printDoctorText(ctx, filteredChecks, { explain, quiet });
      }
    }
    return doctorSucceeded(checks) ? 0 : 2;
  }

  if (command === "upgrade") {
    await upgradeCclaw(ctx.cwd);
    info(ctx, "Upgraded .cclaw runtime and regenerated generated files");
    return 0;
  }

  if (command === "eval" && parsed.evalSubcommand === "runs") {
    return runEvalRunsSubcommand(parsed, ctx);
  }

  if (command === "eval" && parsed.evalBackground === true) {
    return spawnBackgroundEval(parsed, ctx);
  }

  if (command === "eval" && parsed.evalSubcommand === "diff") {
    const args = parsed.evalArgs ?? [];
    if (args.length !== 2) {
      error(
        ctx,
        `\`cclaw eval diff\` requires two arguments: <old> <new>. ` +
          `Example: cclaw eval diff 0.26.0 latest`
      );
      return 1;
    }
    const [oldSel, newSel] = args as [string, string];
    try {
      const diff = await runEvalDiff({
        projectRoot: ctx.cwd,
        old: oldSel,
        new: newSel
      });
      if (parsed.evalJson === true) {
        ctx.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
      } else {
        ctx.stdout.write(formatDiffMarkdown(diff));
      }
      return diff.regressed ? 1 : 0;
    } catch (err) {
      error(ctx, err instanceof Error ? err.message : String(err));
      return 1;
    }
  }

  if (command === "eval") {
    const wantProgress =
      parsed.evalQuiet !== true &&
      parsed.dryRun !== true &&
      parsed.evalJson !== true;
    const progress = wantProgress
      ? createStderrProgressLogger({ writer: (s) => ctx.stderr.write(s) })
      : undefined;
    if (parsed.evalCompareModel !== undefined) {
      return runCompareModel(parsed, ctx, progress);
    }
    const result = await runEval({
      projectRoot: ctx.cwd,
      stage: parsed.evalStage as Parameters<typeof runEval>[0]["stage"],
      mode: parsed.evalMode,
      schemaOnly: parsed.evalSchemaOnly === true,
      rules: parsed.evalRules === true,
      judge: parsed.evalJudge === true,
      dryRun: parsed.dryRun === true,
      ...(progress ? { progress } : {}),
      ...resolveMaxCostOption(parsed.evalMaxCostUsd, process.env)
    });

    if ("kind" in result) {
      if (parsed.evalJson === true) {
        ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
        return 0;
      }
      ctx.stdout.write(`cclaw eval dry-run\n`);
      ctx.stdout.write(`  provider: ${result.config.provider}\n`);
      ctx.stdout.write(`  baseUrl: ${result.config.baseUrl}\n`);
      ctx.stdout.write(`  model: ${result.config.model}\n`);
      ctx.stdout.write(`  source: ${result.config.source}\n`);
      ctx.stdout.write(`  apiKey: ${result.config.apiKey ? "set" : "unset"}\n`);
      ctx.stdout.write(`  mode: ${result.plannedMode}\n`);
      ctx.stdout.write(`  corpus: ${result.corpus.total} case(s)\n`);
      for (const [stage, count] of Object.entries(result.corpus.byStage)) {
        ctx.stdout.write(`    - ${stage}: ${count}\n`);
      }
      if (result.workflowCorpus.total > 0 || result.plannedMode === "workflow") {
        ctx.stdout.write(
          `  workflow corpus: ${result.workflowCorpus.total} case(s)\n`
        );
        for (const wf of result.workflowCorpus.cases) {
          ctx.stdout.write(`    - ${wf.id}: ${wf.stages.join(" → ")}\n`);
        }
      }
      ctx.stdout.write(`  verifiers available:\n`);
      for (const [key, value] of Object.entries(result.verifiersAvailable)) {
        ctx.stdout.write(`    - ${key}: ${value ? "yes" : "no"}\n`);
      }
      if (result.notes.length > 0) {
        ctx.stdout.write(`  notes:\n`);
        for (const note of result.notes) {
          ctx.stdout.write(`    - ${note}\n`);
        }
      }
      return 0;
    }

    if (parsed.evalUpdateBaseline === true && parsed.evalConfirm !== true) {
      error(
        ctx,
        "--update-baseline requires --confirm to prevent accidental baseline resets."
      );
      return 1;
    }

    if (parsed.evalUpdateBaseline === true) {
      if (result.summary.failed > 0) {
        error(
          ctx,
          `Refusing to update baselines: ${result.summary.failed} case(s) currently failing. Fix structural checks first.`
        );
        return 1;
      }
      const written = await writeBaselinesFromReport(ctx.cwd, result);
      for (const file of written) {
        info(ctx, `Baseline written: ${path.relative(ctx.cwd, file)}`);
      }
    }

    if (parsed.evalNoWrite !== true) {
      const jsonPath = await writeJsonReport(ctx.cwd, result);
      const mdPath = await writeMarkdownReport(ctx.cwd, result);
      info(ctx, `Report written: ${path.relative(ctx.cwd, jsonPath)}`);
      info(ctx, `Report written: ${path.relative(ctx.cwd, mdPath)}`);
    }

    const regressionCount = result.baselineDelta?.criticalFailures ?? 0;

    if (parsed.evalJson === true) {
      ctx.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      const regressionNote =
        regressionCount > 0 ? `, ${regressionCount} regression(s)` : "";
      ctx.stdout.write(
        `cclaw eval: ${result.summary.totalCases} case(s), ` +
          `${result.summary.passed} passed, ` +
          `${result.summary.failed} failed, ` +
          `${result.summary.skipped} skipped${regressionNote}\n`
      );
    }
    if (result.summary.failed > 0) return 1;
    if (regressionCount > 0) return 1;
    return 0;
  }

  if (command === "archive") {
    const archived = await archiveRun(ctx.cwd, parsed.archiveName, {
      skipRetro: parsed.archiveSkipRetro === true,
      skipRetroReason: parsed.archiveSkipRetroReason
    });
    const snapshotSummary = archived.snapshottedStateFiles.length > 0
      ? ` Snapshotted ${archived.snapshottedStateFiles.length} state file(s) under ${archived.archivePath}/state and wrote archive-manifest.json.`
      : "";
    info(
      ctx,
      `Archived active artifacts to ${archived.archivePath}. Flow state reset to brainstorm.${snapshotSummary}`
    );
    const k = archived.knowledge;
    if (k.overThreshold) {
      info(
        ctx,
        `Knowledge curation recommended: ${k.knowledgePath} now has ${k.activeEntryCount} active entries (soft threshold ${k.softThreshold}). Run \`/cc-learn curate\` to plan a soft-archive of stale/duplicate entries to ${RUNTIME_ROOT}/knowledge.archive.jsonl.`
      );
    } else if (k.activeEntryCount > 0) {
      info(
        ctx,
        `Knowledge: ${k.activeEntryCount}/${k.softThreshold} active entries. Run \`/cc-learn curate\` if you want a sweep before the next run.`
      );
    } else {
      info(
        ctx,
        `Knowledge: 0 active entries in ${k.knowledgePath}. Capture lessons from this run with \`/cc-learn add\` before they fade.`
      );
    }
    return 0;
  }

  await uninstallCclaw(ctx.cwd);
  info(ctx, "Removed .cclaw runtime and generated shim files");
  return 0;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const ctx: CliContext = {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
  };

  try {
    const code = await runCommand(parsed, ctx);
    process.exitCode = code;
  } catch (err) {
    error(ctx, err instanceof Error ? err.message : "Unknown error");
    process.exitCode = 1;
  }
}

function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const entryPath = realpathSync(path.resolve(process.argv[1]));
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return entryPath === modulePath;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void main();
}

export { parseArgs, parseHarnesses, parseTrack };
