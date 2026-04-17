#!/usr/bin/env node
import { readFileSync, realpathSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { FLOW_TRACKS, HARNESS_IDS, INIT_PROFILES } from "./types.js";
import { doctorChecks, doctorSucceeded } from "./doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { error, info } from "./logger.js";
import type { CliContext, FlowTrack, HarnessId, InitProfile } from "./types.js";
import { archiveRun } from "./runs.js";
import { RUNTIME_ROOT } from "./constants.js";
import { createDefaultConfig, createProfileConfig } from "./config.js";
import { detectHarnesses } from "./init-detect.js";
import { HARNESS_ADAPTERS } from "./harness-adapters.js";

type CommandName = "init" | "sync" | "doctor" | "upgrade" | "uninstall" | "archive";
const INSTALLER_COMMANDS: CommandName[] = ["init", "sync", "doctor", "upgrade", "uninstall", "archive"];

interface ParsedArgs {
  command?: CommandName;
  harnesses?: HarnessId[];
  track?: FlowTrack;
  profile?: InitProfile;
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
  showHelp?: boolean;
  showVersion?: boolean;
}

export function usage(): string {
  return `cclaw - installer-first flow toolkit

Usage:
  cclaw <command> [flags]
  cclaw --help | -h
  cclaw --version | -v

Commands:
  init       Bootstrap .cclaw runtime, state, and harness shims in this project.
             Flags: --profile=<id>      Pre-fill defaults. One of: minimal | standard | full. Default: standard.
                    --harnesses=<list>  Comma list of harnesses (claude,cursor,opencode,codex). Overrides the profile default.
                    --track=<id>        Flow track for new runs (standard | medium | quick). Overrides the profile default.
                    --interactive       Force interactive prompts (TTY only).
                    --no-interactive    Skip interactive prompts even on TTY.
                    --dry-run           Print resolved config + generated surfaces without writing files.
  sync       Regenerate harness shim files from the current .cclaw config (non-destructive).
  doctor     Run health checks against the local .cclaw runtime. Exit code 2 when any error-severity check fails.
             Flags: --reconcile-gates   Recompute current-stage gate evidence before checks.
                    --json              Emit machine-readable JSON output.
                    --only=<filter>     Comma list of severities/check-name filters (error,warning,info,trace:,hook:...).
                    --explain           Include fix + doc reference per check in text mode.
                    --quiet             Print only failing checks (and totals).
  archive    Move .cclaw/artifacts into .cclaw/runs/<date>-<slug> and reset flow state.
             Flags: --name=<feature>    Feature slug (default: inferred from 00-idea.md).
                    --skip-retro       Bypass mandatory retro gate (requires --retro-reason).
                    --retro-reason=<t> Reason for bypassing retro gate.
  upgrade    Refresh generated files in .cclaw without modifying user artifacts.
  uninstall  Remove .cclaw runtime and the generated harness shim files.

Global flags:
  -h, --help     Show this help message and exit 0.
  -v, --version  Print the cclaw CLI version and exit 0.

Examples:
  cclaw init --harnesses=claude,cursor
  cclaw doctor --reconcile-gates
  cclaw archive --name=payments-revamp

Docs:   https://github.com/zuevrs/cclaw
Issues: https://github.com/zuevrs/cclaw/issues
`;
}

function cliPackageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const candidates = [
      path.resolve(here, "../package.json"),
      path.resolve(here, "../../package.json")
    ];
    for (const candidate of candidates) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const parsed = JSON.parse(raw) as { name?: string; version?: string };
        if (parsed.name === "cclaw-cli" && typeof parsed.version === "string") {
          return parsed.version;
        }
      } catch {
        continue;
      }
    }
  } catch {
    // fall through
  }
  return "unknown";
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

function parseProfile(raw: string): InitProfile {
  const trimmed = raw.trim();
  if (!(INIT_PROFILES as readonly string[]).includes(trimmed)) {
    throw new Error(`Unknown profile: ${trimmed}. Supported: ${INIT_PROFILES.join(", ")}`);
  }
  return trimmed as InitProfile;
}

function isInitPromptAllowed(ctx: CliContext): boolean {
  return Boolean(process.stdin.isTTY && ctx.stdout.isTTY);
}

function buildInitSurfacePreview(harnesses: HarnessId[]): string[] {
  const lines = [
    ".cclaw/config.yaml",
    ".cclaw/commands/*.md",
    ".cclaw/skills/*/SKILL.md",
    ".cclaw/state/*.json|*.jsonl",
    ".cclaw/references/**",
    "AGENTS.md (managed block)"
  ];
  for (const harness of harnesses) {
    const adapter = HARNESS_ADAPTERS[harness];
    lines.push(`${adapter.commandDir}/cc*.md`);
    if (harness === "claude") {
      lines.push(".claude/hooks/hooks.json");
    }
    if (harness === "cursor") {
      lines.push(".cursor/hooks.json");
      lines.push(".cursor/rules/cclaw-workflow.mdc");
    }
    if (harness === "codex") {
      lines.push(".codex/hooks.json");
    }
    if (harness === "opencode") {
      lines.push(".opencode/plugins/cclaw-plugin.mjs");
      lines.push("opencode.json(.c) plugin registration");
    }
  }
  return lines;
}

function inferTrackDefault(profile: InitProfile | undefined, track: FlowTrack | undefined): FlowTrack {
  if (track) return track;
  if (!profile) return "standard";
  return createProfileConfig(profile).defaultTrack ?? "standard";
}

async function promptInitConfig(
  defaults: { profile: InitProfile; track: FlowTrack; harnesses: HarnessId[] },
  ctx: CliContext
): Promise<{ profile: InitProfile; track: FlowTrack; harnesses: HarnessId[] }> {
  const rl = createInterface({
    input: process.stdin,
    output: ctx.stdout
  });

  const pickSingle = async <T extends string>(
    label: string,
    options: readonly T[],
    fallback: T
  ): Promise<T> => {
    while (true) {
      ctx.stdout.write(`\n${label}\n`);
      options.forEach((option, index) => {
        const marker = option === fallback ? " (default)" : "";
        ctx.stdout.write(`  ${index + 1}) ${option}${marker}\n`);
      });
      const answer = (await rl.question("> ")).trim();
      if (answer.length === 0) {
        return fallback;
      }
      const numeric = Number(answer);
      if (Number.isInteger(numeric) && numeric >= 1 && numeric <= options.length) {
        return options[numeric - 1]!;
      }
      if ((options as readonly string[]).includes(answer)) {
        return answer as T;
      }
      ctx.stdout.write("Invalid selection. Use option number or value.\n");
    }
  };

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
    const profile = await pickSingle("Select init profile:", INIT_PROFILES, defaults.profile);
    const trackDefault = inferTrackDefault(profile, defaults.track);
    const track = await pickSingle("Select default flow track:", FLOW_TRACKS, trackDefault);
    const harnesses = await pickHarnesses(defaults.harnesses);
    return { profile, track, harnesses };
  } finally {
    rl.close();
  }
}

async function resolveInitInputs(parsed: ParsedArgs, ctx: CliContext): Promise<{
  profile?: InitProfile;
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
    parsed.profile === undefined &&
    parsed.track === undefined &&
    parsed.harnesses === undefined;
  const shouldPrompt = promptRequested || implicitPrompt;

  if (!shouldPrompt) {
    return {
      profile: parsed.profile,
      track: parsed.track,
      harnesses: autoHarnesses,
      detectedHarnesses
    };
  }

  if (!isInitPromptAllowed(ctx)) {
    throw new Error("Interactive init requires a TTY. Remove --interactive or run in a terminal.");
  }

  const defaults = {
    profile: parsed.profile ?? "standard",
    track: inferTrackDefault(parsed.profile, parsed.track),
    harnesses: autoHarnesses ?? HARNESS_IDS.slice()
  };
  const prompted = await promptInitConfig(defaults, ctx);
  return {
    profile: prompted.profile,
    track: prompted.track,
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

  const [commandRaw, ...flags] = argv.filter(
    (arg) => arg !== "--help" && arg !== "-h" && arg !== "--version" && arg !== "-v"
  );
  parsed.command = INSTALLER_COMMANDS.includes(commandRaw as CommandName)
    ? (commandRaw as CommandName)
    : undefined;

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
      parsed.profile = parseProfile(flag.replace("--profile=", ""));
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
    ctx.stdout.write(`cclaw ${cliPackageVersion()}\n`);
    return 0;
  }

  const command = parsed.command;
  if (!command) {
    ctx.stderr.write(usage());
    return 1;
  }

  if (command === "init") {
    const resolved = await resolveInitInputs(parsed, ctx);
    const effectiveProfile = resolved.profile;
    const effectiveTrack = resolved.track;
    const effectiveHarnesses = resolved.harnesses;

    if (parsed.dryRun === true) {
      const previewConfig = effectiveProfile
        ? createProfileConfig(effectiveProfile, {
            harnesses: effectiveHarnesses,
            defaultTrack: effectiveTrack
          })
        : createDefaultConfig(effectiveHarnesses, effectiveTrack);
      const previewSurfaces = buildInitSurfacePreview(previewConfig.harnesses);
      info(ctx, "Dry run: no files were written.");
      if (resolved.detectedHarnesses.length > 0 && parsed.harnesses === undefined) {
        info(ctx, `Detected harnesses from repo: ${resolved.detectedHarnesses.join(", ")}`);
      }
      ctx.stdout.write(`${JSON.stringify({
        profile: effectiveProfile ?? "standard(default)",
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
      track: effectiveTrack,
      profile: effectiveProfile
    });
    if (resolved.detectedHarnesses.length > 0 && parsed.harnesses === undefined) {
      info(ctx, `Detected harnesses from repo: ${resolved.detectedHarnesses.join(", ")}`);
    }
    const profileNote = effectiveProfile ? ` profile=${effectiveProfile}` : "";
    const trackNote = effectiveTrack ? ` track=${effectiveTrack}` : "";
    const suffix = profileNote || trackNote ? ` (${(profileNote + trackNote).trim()})` : "";
    info(ctx, `Initialized .cclaw runtime and generated harness shims${suffix}`);
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
        `Knowledge curation recommended: ${k.knowledgePath} now has ${k.activeEntryCount} active entries (soft threshold ${k.softThreshold}). Run \`/cc-learn curate\` to plan a soft-archive of stale/duplicate entries to ${RUNTIME_ROOT}/knowledge.archive.md.`
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

export { parseArgs, parseHarnesses, parseTrack, parseProfile };
