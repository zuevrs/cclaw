#!/usr/bin/env node
import process from "node:process";
import path from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { error, info } from "./logger.js";
import { FLOW_TRACKS, HARNESS_IDS } from "./types.js";
import type { CliContext, FlowTrack, HarnessId } from "./types.js";
import { ARCHIVE_DISPOSITIONS, archiveRun } from "./runs.js";
import type { ArchiveDisposition } from "./runs.js";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { createDefaultConfig, readConfig } from "./config.js";
import { detectHarnesses } from "./init-detect.js";
import { HARNESS_ADAPTERS } from "./harness-adapters.js";
import { promptHarnessSelectionChecklist } from "./harness-selection.js";
export { parseHarnessSelectionAnswer } from "./harness-selection.js";
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
  | "upgrade"
  | "uninstall"
  | "archive"
  | "internal";
const INSTALLER_COMMANDS: CommandName[] = [
  "init",
  "sync",
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
  archiveName?: string;
  archiveSkipRetro?: boolean;
  archiveSkipRetroReason?: string;
  archiveDisposition?: ArchiveDisposition;
  archiveDispositionReason?: string;
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
             Flags: --harnesses=<list>  Update configured harnesses before syncing.
                    --interactive      Pick harnesses from a numbered TTY menu.
  upgrade    Refresh generated files in .cclaw. Preserves your config.yaml.
  archive    Archive the active run and reset flow state for the next run.
             Flags: --name=<slug>        Override archive folder suffix.
                    --skip-retro         Skip retro gate only when runtime allows it.
                    --retro-reason=<txt> Required rationale with --skip-retro.
                    --disposition=<completed|cancelled|abandoned>
                    --reason=<txt>      Required for cancelled/abandoned archives.
  uninstall  Remove .cclaw runtime and the generated harness shim files.

Global flags:
  -h, --help     Show this help message and exit 0.
  -v, --version  Print the cclaw CLI version and exit 0.

Examples:
  npx cclaw-cli
  npx cclaw-cli init --harnesses=claude,cursor --no-interactive
  npx cclaw-cli sync --interactive
  npx cclaw-cli archive --name=my-run
  npx cclaw-cli archive --disposition=cancelled --reason="deprioritized"
  npx cclaw-cli upgrade

Happy-path work happens inside your harness via /cc, /cc-idea,
and /cc-cancel. Installer/support operations are init/sync/upgrade/uninstall
plus explicit archive actions.

Docs:   https://github.com/zuevrs/cclaw
Local:  README.md and generated .cclaw/skills/*.md
Issues: https://github.com/zuevrs/cclaw/issues
`;
}

function parseHarnesses(raw: string): HarnessId[] {
  const requested = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (requested.length === 0) {
    throw new Error("Select at least one harness.");
  }

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

function parseArchiveDisposition(raw: string): ArchiveDisposition {
  const trimmed = raw.trim();
  if (!(ARCHIVE_DISPOSITIONS as readonly string[]).includes(trimmed)) {
    throw new Error(`Unknown archive disposition: ${trimmed}. Supported: ${ARCHIVE_DISPOSITIONS.join(", ")}`);
  }
  return trimmed as ArchiveDisposition;
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
    ".cclaw/archive/**",
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
  defaults: { harnesses: HarnessId[]; detectedHarnesses?: HarnessId[] },
  ctx: CliContext
): Promise<{ harnesses: HarnessId[] }> {
  const harnesses = await promptHarnessSelectionChecklist(defaults, ctx, "Initial cclaw harnesses");
  return { harnesses };
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
  const prompted = await promptInitConfig({ ...defaults, detectedHarnesses }, ctx);
  return {
    track: parsed.track,
    harnesses: prompted.harnesses,
    detectedHarnesses
  };
}

async function resolveSyncInputs(parsed: ParsedArgs, ctx: CliContext): Promise<{ harnesses?: HarnessId[] }> {
  const explicitHarnesses = parsed.harnesses;
  if (explicitHarnesses && explicitHarnesses.length > 0) {
    return { harnesses: explicitHarnesses };
  }
  if (parsed.interactive !== true) {
    return {};
  }
  if (!isInitPromptAllowed(ctx)) {
    throw new Error("Interactive sync requires a TTY. Remove --interactive or run in a terminal.");
  }
  let currentHarnesses: HarnessId[] = [];
  try {
    currentHarnesses = (await readConfig(ctx.cwd)).harnesses;
  } catch {
    currentHarnesses = [];
  }
  const detectedHarnesses = await detectHarnesses(ctx.cwd);
  const defaults = detectedHarnesses.length > 0 ? detectedHarnesses : currentHarnesses.length > 0 ? currentHarnesses : HARNESS_IDS.slice();
  return {
    harnesses: await promptHarnessSelectionChecklist({
      harnesses: defaults,
      detectedHarnesses,
      currentHarnesses
    }, ctx, "Sync harness reconfiguration")
  };
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
  const isAllowedForCommand = (flag: string): boolean => {
    if (parsed.command === "init" || parsed.command === "sync") {
      return flag.startsWith("--harnesses=") ||
        (parsed.command === "init" && flag.startsWith("--track=")) ||
        (parsed.command === "init" && flag.startsWith("--profile=")) ||
        flag === "--interactive" ||
        flag === "--no-interactive" ||
        (parsed.command === "init" && flag === "--dry-run");
    }
    if (parsed.command === "archive") {
      return flag.startsWith("--name=") ||
        flag === "--skip-retro" ||
        flag.startsWith("--retro-reason=") ||
        flag.startsWith("--disposition=") ||
        flag.startsWith("--reason=");
    }
    return false;
  };

  for (const flag of flags) {
    if (!isAllowedForCommand(flag)) {
      throw new Error(`Flag ${flag} is not supported for ${parsed.command ?? "this command"}.`);
    }
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
    if (flag.startsWith("--disposition=")) {
      parsed.archiveDisposition = parseArchiveDisposition(flag.replace("--disposition=", ""));
      continue;
    }
    if (flag.startsWith("--reason=")) {
      parsed.archiveDispositionReason = flag.replace("--reason=", "").trim();
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
    const resolved = await resolveSyncInputs(parsed, ctx);
    await syncCclaw(ctx.cwd, { harnesses: resolved.harnesses });
    const harnessNote = resolved.harnesses ? ` (${resolved.harnesses.join(", ")})` : "";
    info(ctx, `Synchronized harness shims from current .cclaw config${harnessNote}`);
    return 0;
  }


  if (command === "upgrade") {
    await upgradeCclaw(ctx.cwd);
    info(ctx, "Upgraded .cclaw runtime and regenerated generated files");
    return 0;
  }

  if (command === "archive") {
    const archived = await archiveRun(ctx.cwd, parsed.archiveName, {
      skipRetro: parsed.archiveSkipRetro === true,
      skipRetroReason: parsed.archiveSkipRetroReason,
      disposition: parsed.archiveDisposition,
      dispositionReason: parsed.archiveDispositionReason
    });
    const snapshotSummary = archived.snapshottedStateFiles.length > 0
      ? ` Snapshotted ${archived.snapshottedStateFiles.length} state file(s) under ${archived.archivePath}/state and wrote archive-manifest.json.`
      : "";
    info(
      ctx,
      `Archived active artifacts to ${archived.archivePath} (${archived.disposition}). Flow state reset to brainstorm.${snapshotSummary}`
    );
    const k = archived.knowledge;
    if (k.overThreshold) {
      info(
        ctx,
        `Knowledge curation recommended: ${k.knowledgePath} now has ${k.activeEntryCount} active entries (soft threshold ${k.softThreshold}). Ask your harness to curate cclaw knowledge and plan a soft-archive of stale/duplicate entries to ${RUNTIME_ROOT}/knowledge.archive.jsonl.`
      );
    } else if (k.activeEntryCount > 0) {
      info(
        ctx,
        `Knowledge: ${k.activeEntryCount}/${k.softThreshold} active entries. Ask your harness for a cclaw knowledge curation sweep before the next run if needed.`
      );
    } else {
      info(
        ctx,
        `Knowledge: 0 active entries in ${k.knowledgePath}. Capture lessons from this run through the learnings skill before they fade.`
      );
    }
    return 0;
  }

  await uninstallCclaw(ctx.cwd);
  info(ctx, "Removed .cclaw runtime and generated shim files");
  return 0;
}

async function main(): Promise<void> {
  const ctx: CliContext = {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr
  };

  try {
    const parsed = parseArgs(process.argv.slice(2));
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

export { parseArgs, parseArchiveDisposition, parseHarnesses, parseTrack };
