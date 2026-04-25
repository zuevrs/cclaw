#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { doctorChecks, doctorSucceeded } from "./doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { error, info } from "./logger.js";
import { FLOW_TRACKS, HARNESS_IDS } from "./types.js";
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
import { runInternalCommand } from "./internal/advance-stage.js";

type CommandName =
  | "init"
  | "sync"
  | "doctor"
  | "upgrade"
  | "uninstall"
  | "archive"
  | "internal";
const INSTALLER_COMMANDS: CommandName[] = [
  "init",
  "sync",
  "doctor",
  "upgrade",
  "uninstall",
  "archive",
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

Global flags:
  -h, --help     Show this help message and exit 0.
  -v, --version  Print the cclaw CLI version and exit 0.

Examples:
  npx cclaw-cli
  npx cclaw-cli init --harnesses=claude,cursor --no-interactive
  npx cclaw-cli sync
  npx cclaw-cli archive --name=my-feature
  npx cclaw-cli upgrade

Everything operational (retro, archive, doctor, learnings)
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
    ".cclaw/templates/*",
    ".cclaw/agents/*.md",
    ".cclaw/hooks/*",
    ".cclaw/rules/**",
    ".cclaw/runs/**",
    ".cclaw/artifacts/**",
    ".cclaw/knowledge.jsonl",
    ".cclaw/state/*.json|*.jsonl",
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

  const flags: string[] = rest;

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
  }


  return parsed;
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
        strictness: previewConfig.strictness ?? "advisory",
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
