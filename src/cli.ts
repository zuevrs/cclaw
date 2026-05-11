#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import {
  configureLogger,
  error as logError,
  getStdout,
  info,
  writeOut
} from "./logger.js";
import { detectHarnesses } from "./harness-detect.js";
import { exists } from "./fs-utils.js";
import { readConfig } from "./config.js";
import {
  PROBLEM_TYPES,
  matchesProblemType,
  readKnowledgeLog,
  type KnowledgeEntry,
  type ProblemType
} from "./knowledge-store.js";
import {
  renderBanner,
  renderHelpSections,
  renderProgress,
  renderSummary,
  renderWelcome,
  shouldUseColor,
  type ProgressEvent
} from "./ui.js";
import {
  MENU_CANCELLED,
  runMainMenu,
  type MenuAction
} from "./main-menu.js";
import { isInteractive } from "./harness-prompt.js";
import { HARNESS_IDS, type CliContext, type HarnessId } from "./types.js";

const TAGLINE = "harness-first flow toolkit for coding agents";

/**
 * v8.29 — `cclaw` is now TUI-first. The canonical invocation is
 * `npx cclaw-cli@latest` (no args), which opens a top-level menu
 * (Install / Sync / Upgrade / Uninstall / Browse knowledge / Show
 * version / Quit) with a smart default highlight based on whether
 * `.cclaw/config.yaml` exists.
 *
 * The bare subcommand surface (`cclaw init`, `cclaw sync`, …) was
 * dropped in v8.29 — those error out and point at the no-arg
 * invocation. The `--non-interactive` flag is the escape hatch for
 * CI / scripts / piped input: `cclaw --non-interactive init`,
 * `cclaw --non-interactive sync --harness=cursor`, etc.
 *
 * `--help` / `-h` / `--version` / `-v` are preserved as flags
 * regardless of mode (standard CLI convention).
 */
const HELP_USAGE = `Usage:
  cclaw                                     # open the TUI menu (interactive default)
  cclaw --non-interactive <command> [opts]  # CI / scripts escape hatch
  cclaw --help | --version`;

const HELP_NOTES = `TUI default:
  Running \`cclaw\` (or \`npx cclaw-cli@latest\`) with no arguments opens a
  top-level menu — Install / Sync / Upgrade / Uninstall / Browse
  knowledge / Show version / Quit. The smart default highlights Install
  when no .cclaw/ exists, Sync when it does. Requires a real TTY.

Non-interactive (CI / scripts):
  \`cclaw --non-interactive <command>\` runs the named command without
  any TUI or picker. Harness selection falls back to --harness=<id>,
  then the existing .cclaw/config.yaml, then auto-detect from project
  root markers (.claude/, .cursor/, .opencode/, .codex/, .agents/skills/,
  CLAUDE.md, opencode.json). Errors out if nothing is found.

Flow control (plan / build / review / ship) lives inside the harness
via the /cc command, not in this CLI. There is no \`cclaw plan\`,
\`cclaw status\`, \`cclaw ship\`, or \`cclaw migrate\` — by design.`;

const HELP_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["install", "Install cclaw assets in the current project (TUI default when no .cclaw/)."],
  ["sync", "Reapply cclaw assets to match the current code (idempotent)."],
  ["upgrade", "Sync after upgrading the cclaw-cli npm package."],
  ["uninstall", "Remove cclaw assets from the current project."],
  ["knowledge", "List captured learnings (.cclaw/state/knowledge.jsonl) grouped by tag."]
];

const HELP_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["--non-interactive", "Run a command without the TUI / picker (CI / scripts)."],
  ["--harness=<id>[,<id>]", `Comma-separated list. Supported: ${HARNESS_IDS.join(", ")}.`],
  [
    "--skip-orphan-cleanup",
    "Skip the scan that removes stale .md files in .cclaw/lib/skills/ and .cclaw/lib/runbooks/."
  ],
  ["--all", "knowledge: drop the default 20-row limit and print every captured entry."],
  ["--tag=<tag>", "knowledge: filter to entries whose tags[] contains <tag>."],
  [
    "--surface=<substring>",
    "knowledge: filter to entries whose touchSurface[] contains <substring>."
  ],
  [
    "--type=<kind>",
    "knowledge: filter by problemType (bug | knowledge | decision | performance | refactor); absent problemType surfaces only under --type=knowledge (v8.34)."
  ],
  ["--json", "knowledge: emit raw jsonl pass-through (one parsed entry per line)."],
  ["--help, -h", "Show this help and exit."],
  ["--version, -v", "Print the version and exit."]
];

interface ParsedArgs {
  /** The first non-flag positional arg. May be undefined when no subcommand was given. */
  command?: string;
  /** Optional `--harness=<list>` value, validated against `HARNESS_IDS`. */
  harnesses?: HarnessId[];
  /** Other long-form flags. Boolean for bare flags, string for `--name=value`. */
  flags: Record<string, string | boolean>;
  /**
   * Whether `--non-interactive` was passed. Hoisted out of `flags` so
   * the dispatch path doesn't have to keep reaching back into the
   * generic flag bag for the single most important routing signal.
   */
  nonInteractive: boolean;
  helpFlag: boolean;
  versionFlag: boolean;
}

/**
 * Parse `argv` into the dispatch shape consumed by `runCli`. Position-
 * independent for `--non-interactive` / `--help` / `--version` so the
 * operator can write either `cclaw --non-interactive init` or
 * `cclaw init --non-interactive` and get the same result.
 */
function parseArgs(argv: string[]): ParsedArgs {
  let command: string | undefined;
  let harnesses: HarnessId[] | undefined;
  let nonInteractive = false;
  let helpFlag = false;
  let versionFlag = false;
  const flags: Record<string, string | boolean> = {};
  for (const arg of argv) {
    if (arg === "--non-interactive") {
      nonInteractive = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      helpFlag = true;
      continue;
    }
    if (arg === "--version" || arg === "-v") {
      versionFlag = true;
      continue;
    }
    if (arg.startsWith("--harness=")) {
      const list = arg.slice("--harness=".length).split(",").map((value) => value.trim()).filter(Boolean);
      const invalid = list.filter((value) => !HARNESS_IDS.includes(value as HarnessId));
      if (invalid.length > 0) {
        throw new Error(`Unknown harnesses: ${invalid.join(", ")}. Supported: ${HARNESS_IDS.join(", ")}`);
      }
      harnesses = list as HarnessId[];
      continue;
    }
    if (arg.startsWith("--")) {
      const [name, ...value] = arg.slice(2).split("=");
      flags[name!] = value.length === 0 ? true : value.join("=");
      continue;
    }
    if (!command) {
      command = arg;
    }
  }
  return { command, harnesses, flags, nonInteractive, helpFlag, versionFlag };
}

function emitBanner(useColor: boolean): void {
  writeOut(renderBanner({ version: CCLAW_VERSION, tagline: TAGLINE, useColor }));
}

function emitHelp(useColor: boolean): void {
  writeOut(`  ${HELP_USAGE.split("\n").join("\n  ")}\n`);
  writeOut(
    renderHelpSections(
      [
        { heading: "Commands", rows: HELP_COMMANDS },
        { heading: "Options", rows: HELP_OPTIONS }
      ],
      useColor
    )
  );
  writeOut(`\n\n  ${HELP_NOTES.split("\n").join("\n  ")}\n`);
}

function makeProgressPrinter(useColor: boolean): (event: ProgressEvent) => void {
  return (event: ProgressEvent) => {
    writeOut(renderProgress(event, useColor));
  };
}

async function isInstalled(cwd: string): Promise<boolean> {
  return exists(path.join(cwd, RUNTIME_ROOT, "config.yaml"));
}

/**
 * v8.18 — `cclaw knowledge` command body. Surface unchanged from v8.18;
 * dispatcher rewired in v8.29 to reach this via either the TUI menu or
 * `--non-interactive knowledge` (the bare `cclaw knowledge` subcommand
 * is gone).
 */
async function runKnowledgeCommand(
  cwd: string,
  flags: Record<string, string | boolean>
): Promise<number> {
  let entries: KnowledgeEntry[];
  try {
    entries = await readKnowledgeLog(cwd);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logError(`[cclaw] knowledge: failed to read .cclaw/state/knowledge.jsonl (${message})`);
    return 1;
  }

  const tagFilter = typeof flags.tag === "string" ? flags.tag : undefined;
  const surfaceFilter = typeof flags.surface === "string" ? flags.surface : undefined;
  const typeFilterRaw = typeof flags.type === "string" ? flags.type : undefined;
  const allFlag = flags.all === true;
  const jsonFlag = flags.json === true;

  let typeFilter: ProblemType | undefined;
  if (typeFilterRaw !== undefined) {
    if (!(PROBLEM_TYPES as readonly string[]).includes(typeFilterRaw)) {
      logError(
        `[cclaw] knowledge: --type=<kind> must be one of ${PROBLEM_TYPES.join(" | ")}; got ${JSON.stringify(typeFilterRaw)}`
      );
      return 1;
    }
    typeFilter = typeFilterRaw as ProblemType;
  }

  let filtered = entries;
  if (tagFilter) {
    filtered = filtered.filter((entry) => (entry.tags ?? []).includes(tagFilter));
  }
  if (surfaceFilter) {
    filtered = filtered.filter((entry) =>
      (entry.touchSurface ?? []).some((p) => p.includes(surfaceFilter))
    );
  }
  if (typeFilter) {
    filtered = filtered.filter((entry) => matchesProblemType(entry, typeFilter));
  }

  // File order is chronological (append-only); reverse for recency-first.
  const recent = [...filtered].reverse();
  const limit = allFlag ? recent.length : Math.min(20, recent.length);
  const limited = recent.slice(0, limit);

  if (jsonFlag) {
    for (const entry of limited) {
      writeOut(`${JSON.stringify(entry)}\n`);
    }
    return 0;
  }

  if (entries.length === 0) {
    writeOut("[cclaw] knowledge: no entries yet (.cclaw/state/knowledge.jsonl is empty or missing)\n");
    return 0;
  }
  if (limited.length === 0) {
    const filterDesc = [
      tagFilter ? `--tag=${tagFilter}` : "",
      surfaceFilter ? `--surface=${surfaceFilter}` : "",
      typeFilter ? `--type=${typeFilter}` : ""
    ]
      .filter(Boolean)
      .join(" ");
    writeOut(`[cclaw] knowledge: 0 entries match ${filterDesc || "(no filter)"}\n`);
    return 0;
  }

  const grouped = new Map<string, KnowledgeEntry[]>();
  for (const entry of limited) {
    const groupKey = (entry.tags ?? [])[0] ?? "untagged";
    const bucket = grouped.get(groupKey) ?? [];
    bucket.push(entry);
    grouped.set(groupKey, bucket);
  }

  for (const [groupKey, rows] of grouped) {
    writeOut(`\n${groupKey}\n`);
    for (const row of rows) {
      const summary = row.notes ?? "";
      const tags = (row.tags ?? []).join(", ");
      writeOut(`  ${row.slug}  ${truncate(summary, 60)}  ${truncate(tags, 30)}\n`);
    }
  }
  writeOut(`\n[cclaw] knowledge: ${limited.length} of ${entries.length} entries shown${allFlag ? "" : " (--all to see more)"}\n`);
  return 0;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}

/**
 * Run a named install action (install / sync / upgrade / uninstall).
 * Shared between the TUI menu dispatch path and the
 * `--non-interactive <cmd>` path so the two surfaces stay byte-for-byte
 * identical in their write behaviour.
 *
 * `interactive: true` lets the harness picker fire when needed (TTY +
 * no `--harness` + no existing config). `interactive: false` is the
 * non-interactive escape hatch — picker is skipped, auto-detect falls
 * through, hard error if no harness can be resolved.
 */
async function dispatchInstallAction(
  action: "install" | "sync" | "upgrade",
  context: CliContext,
  args: ParsedArgs,
  interactive: boolean,
  useColor: boolean
): Promise<number> {
  emitBanner(useColor);
  if (action === "install") {
    const firstRun = !(await isInstalled(context.cwd));
    const detected = firstRun ? await detectHarnesses(context.cwd) : [];
    if (firstRun) writeOut(renderWelcome({ detected, useColor }));
  }
  const runner = action === "install" ? initCclaw : action === "sync" ? syncCclaw : upgradeCclaw;
  const result = await runner({
    cwd: context.cwd,
    harnesses: args.harnesses,
    interactive,
    skipOrphanCleanup: Boolean(args.flags["skip-orphan-cleanup"]),
    onProgress: makeProgressPrinter(useColor)
  });
  writeOut(renderSummary(result.counts, useColor));
  info(`[cclaw] ${action} complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
  return 0;
}

async function dispatchUninstall(
  context: CliContext,
  useColor: boolean
): Promise<number> {
  const config = await readConfig(context.cwd);
  const harnesses = config?.harnesses ?? [];
  emitBanner(useColor);
  await uninstallCclaw({ cwd: context.cwd });
  info(
    `[cclaw] uninstall complete.${harnesses.length > 0 ? ` Removed: ${harnesses.join(", ")}` : ""}`
  );
  return 0;
}

/**
 * Dispatcher for the TUI menu's resolved action. Maps the menu's seven
 * actions to the same code paths the `--non-interactive` mode uses,
 * with `interactive: true` so the harness picker fires when appropriate.
 *
 * `version` and `quit` are terminal — they print and exit without
 * touching the project.
 */
async function dispatchMenuAction(
  action: MenuAction,
  context: CliContext,
  args: ParsedArgs,
  useColor: boolean
): Promise<number> {
  switch (action) {
    case "install":
    case "sync":
    case "upgrade":
      return dispatchInstallAction(action, context, args, true, useColor);
    case "uninstall":
      return dispatchUninstall(context, useColor);
    case "knowledge":
      return runKnowledgeCommand(context.cwd, args.flags);
    case "version":
      info(CCLAW_VERSION);
      return 0;
    case "quit":
      return 0;
  }
}

const SUBCOMMAND_TO_MENU_ACTION: Record<string, MenuAction> = {
  // `init` is kept as a backwards-compatible alias for `install` in the
  // non-interactive path; saves the muscle-memory tax for CI scripts
  // that pinned `cclaw init` between v8.0 and v8.28. The TUI menu
  // surfaces the new canonical name (`Install`).
  init: "install",
  install: "install",
  sync: "sync",
  upgrade: "upgrade",
  uninstall: "uninstall",
  knowledge: "knowledge",
  version: "version"
};

const BLOCKED_FLOW_COMMANDS = new Set([
  "plan",
  "status",
  "ship",
  "migrate",
  "build",
  "review"
]);

export async function runCli(argv: string[], context: CliContext): Promise<number> {
  configureLogger(context.stdout, context.stderr);
  const args = parseArgs(argv);
  const stdout = getStdout();
  const useColor = shouldUseColor(stdout);

  if (args.helpFlag) {
    emitBanner(useColor);
    emitHelp(useColor);
    return 0;
  }
  if (args.versionFlag) {
    info(CCLAW_VERSION);
    return 0;
  }

  // No subcommand: TUI default. Operators with a real TTY get the
  // top-level menu; non-TTY callers (CI without --non-interactive, npx
  // --yes, piped input) get an error pointing at the escape hatch.
  if (!args.command) {
    if (args.nonInteractive) {
      logError(
        "[cclaw] --non-interactive requires a subcommand (install | sync | upgrade | uninstall | knowledge | version)."
      );
      return 2;
    }
    if (!isInteractive()) {
      logError(
        "[cclaw] needs an interactive terminal to open the TUI menu. For CI / scripts use `cclaw --non-interactive <command>` (e.g. `cclaw --non-interactive install --harness=cursor`)."
      );
      return 2;
    }
    emitBanner(useColor);
    let action: MenuAction;
    try {
      action = await runMainMenu({ installed: await isInstalled(context.cwd) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === MENU_CANCELLED) {
        info("[cclaw] menu cancelled — exiting without changes.");
        return 0;
      }
      throw err;
    }
    return dispatchMenuAction(action, context, args, useColor);
  }

  // Flow control commands (`cclaw plan`, `cclaw ship`, …) were never
  // CLI commands in v8 — error message kept verbatim so the
  // wrong-place-to-do-this confusion is named the same way as before.
  if (BLOCKED_FLOW_COMMANDS.has(args.command)) {
    logError(
      `[cclaw] '${args.command}' is not a CLI command in v8. Flow control happens via /cc inside your harness.`
    );
    return 2;
  }

  const menuAction = SUBCOMMAND_TO_MENU_ACTION[args.command];
  if (!menuAction) {
    logError(`[cclaw] unknown command: ${args.command}`);
    emitHelp(useColor);
    return 2;
  }

  // v8.29 — bare subcommand surface dropped. `cclaw init` /
  // `cclaw sync` / `cclaw knowledge` / etc. all require the
  // `--non-interactive` flag, which is the explicit "I am a script,
  // not a human reading the TUI" signal. The error message points at
  // both escape hatches (TUI for humans, --non-interactive for CI).
  if (!args.nonInteractive) {
    logError(
      `[cclaw] '${args.command}' is no longer a bare subcommand. Run \`cclaw\` (no args) for the TUI menu, or \`cclaw --non-interactive ${args.command}\` for CI / scripts.`
    );
    return 2;
  }

  // --non-interactive path: same code as the TUI dispatcher but with
  // interactive: false so the harness picker doesn't fire even when a
  // TTY happens to be attached. Auto-detect + --harness fall-through
  // unchanged from v8.28.
  switch (menuAction) {
    case "install":
    case "sync":
    case "upgrade":
      return dispatchInstallAction(menuAction, context, args, false, useColor);
    case "uninstall":
      return dispatchUninstall(context, useColor);
    case "knowledge":
      return runKnowledgeCommand(context.cwd, args.flags);
    case "version":
      info(CCLAW_VERSION);
      return 0;
    case "quit":
      return 0;
  }
}

/**
 * True when this module is the program entry point. Resolves both the
 * argv[1] path and the import.meta.url to their realpath because:
 *  - `npx cclaw-cli` invokes the CLI through a symlink under
 *    `~/.npm/_npx/<hash>/node_modules/.bin/cclaw-cli` that points at the
 *    real `dist/cli.js`. argv[1] keeps the symlink path, but
 *    import.meta.url resolves through to the real file. The naive
 *    `import.meta.url === \`file://${argv[1]}\`` check returns false in
 *    this case and the CLI silently exits 0 without doing anything.
 *  - On macOS `/tmp` is a symlink to `/private/tmp`, which produces the
 *    same mismatch even when no user-level symlink is involved.
 *  - `npm install -g cclaw-cli` creates a similar symlink in the global
 *    bin directory.
 *
 * Mirrors the v7.x `isDirectExecution()` check that is known to work
 * across npx, global installs, and macOS path normalisation.
 */
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
  runCli(process.argv.slice(2), { cwd: process.cwd(), stdout: process.stdout, stderr: process.stderr })
    .then((code) => {
      process.exit(code);
    })
    .catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[cclaw] ${message}\n`);
      process.exit(1);
    });
}
