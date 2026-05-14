#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { initCclaw, renderHarnessRulesGuidance, uninstallCclaw } from "./install.js";
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
 * v8.29 — `cclaw` is TUI-first. The canonical invocation is
 * `npx cclaw-cli@latest` (no args), which opens a top-level menu with a
 * smart default highlight based on whether `.cclaw/config.yaml` exists.
 *
 * The bare subcommand surface (`cclaw init`, `cclaw sync`, …) was
 * dropped in v8.29 — those error out and point at the no-arg
 * invocation. The `--non-interactive` flag is the escape hatch for
 * CI / scripts / piped input.
 *
 * v8.37 — `cclaw --non-interactive sync` and `cclaw --non-interactive
 * upgrade` were collapsed into `cclaw --non-interactive install`.
 * Under the hood, all three previously called `syncCclaw()` /
 * `upgradeCclaw()` (themselves thin wrappers around the same idempotent
 * installer with orphan cleanup). The non-interactive surface now
 * matches the code path: ONE installer (`install`), the read-only
 * commands (`knowledge`, `version`, `help`), and `uninstall`.
 *
 * v8.39 — the TUI menu finishes the v8.37 collapse: rows are now just
 * `Install` / `Uninstall` / `Quit`. `Sync` and `Upgrade` were intent
 * aliases that confused the picture (three rows, one behaviour);
 * `Install` now carries both readings via its description
 * ("first-time setup OR idempotent reapply"). `Browse knowledge` and
 * `Show version` were moved off the menu — power users invoke them as
 * `cclaw --non-interactive knowledge` / `cclaw --version`. v8.39 also
 * fixes a perceptible-on-slow-terminals double-render of the 6-line
 * Unicode logo: the no-arg TUI path used to emit the banner above the
 * menu AND again inside the action dispatcher; the second emission is
 * gone (the original banner stays in scrollback while menu rows are
 * erased, so the install progress flows under the banner the operator
 * already saw).
 *
 * `--help` / `-h` / `--version` / `-v` are preserved as flags regardless
 * of mode (standard CLI convention).
 */
const HELP_USAGE = `Usage:
  cclaw                                     # open the TUI menu (interactive default)
  cclaw --non-interactive <command> [opts]  # CI / scripts escape hatch
  cclaw --help | --version`;

const HELP_NOTES = `TUI default:
  Running \`cclaw\` (or \`npx cclaw-cli@latest\`) with no arguments opens a
  top-level menu — Install / Uninstall / Quit. The cursor always lands on
  Install: on a fresh project it's first-time setup, on an installed
  project it's the idempotent reapply that covers former sync / upgrade.
  Requires a real TTY.

Non-interactive (CI / scripts):
  \`cclaw --non-interactive <command>\` runs the named command without
  any TUI or picker. Supported commands: install, knowledge, uninstall,
  version, help. Harness selection falls back to --harness=<id>, then
  the existing .cclaw/config.yaml, then auto-detect from project root
  markers (.claude/, .cursor/, .opencode/, .codex/, .agents/skills/,
  CLAUDE.md, opencode.json). Errors out if nothing is found.

v8.37 migration:
  \`--non-interactive sync\` and \`--non-interactive upgrade\` were merged
  into \`--non-interactive install\`. The installer is idempotent and runs
  orphan cleanup; calling it on an installed project produces the same
  result \`sync\` produced before. CI scripts should rename their command;
  the old names exit 1 with a migration hint.

Flow control (plan / build / review / ship) lives inside the harness
via the /cc command, not in this CLI. There is no \`cclaw plan\`,
\`cclaw status\`, \`cclaw ship\`, or \`cclaw migrate\` — by design.`;

const HELP_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["install", "Install / reapply cclaw assets (idempotent; runs orphan cleanup). The single installer."],
  ["knowledge", "List captured learnings (.cclaw/state/knowledge.jsonl) grouped by tag."],
  ["uninstall", "Remove cclaw assets from the current project."],
  ["version", "Print the cclaw version and exit (alias of --version)."],
  ["help", "Print this help screen and exit (alias of --help)."],
  ["sync", "(v8.37) renamed — use `cclaw --non-interactive install` (idempotent + orphan cleanup)."],
  ["upgrade", "(v8.37) renamed — use `cclaw --non-interactive install` after upgrading the package."]
];

const HELP_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["--non-interactive", "Run a command without the TUI / picker (CI / scripts)."],
  ["--harness=<id>[,<id>]", `Comma-separated list. Supported: ${HARNESS_IDS.join(", ")}.`],
  [
    "--skip-orphan-cleanup",
    "Skip the scan that removes stale .md files in .cclaw/lib/skills/ and .cclaw/lib/runbooks/."
  ],
  [
    "--with-context",
    "install/sync: write a CONTEXT.md project-domain-glossary stub at the project root when the file does not already exist (v8.35; opt-in)."
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
 * Run the install action. Shared between the TUI menu dispatch path
 * and the `--non-interactive install` path so the two surfaces stay
 * byte-for-byte identical in their write behaviour.
 *
 * `interactive: true` lets the harness picker fire when needed (TTY +
 * no `--harness` + no existing config). `interactive: false` is the
 * non-interactive escape hatch — picker is skipped, auto-detect falls
 * through, hard error if no harness can be resolved.
 *
 * v8.39 — does NOT emit the banner. Callers emit it once at the right
 * moment: the TUI no-arg path emits it above the menu (one banner, one
 * render); the non-interactive path emits it right before dispatching.
 * Emitting inside this function as well used to double-render the
 * 6-line Unicode logo right after the menu closed, which presented as
 * perceptible "lag" on terminals where redrawing box-drawing characters
 * is slow.
 *
 * v8.39 — the `action` parameter was dropped. v8.37 collapsed
 * sync / upgrade into install at the CLI surface; v8.39 finishes the
 * collapse at the TUI surface, so the only legitimate call shape is
 * the install path.
 */
async function dispatchInstallAction(
  context: CliContext,
  args: ParsedArgs,
  interactive: boolean,
  useColor: boolean
): Promise<number> {
  const firstRun = !(await isInstalled(context.cwd));
  const detected = firstRun ? await detectHarnesses(context.cwd) : [];
  if (firstRun) writeOut(renderWelcome({ detected, useColor }));
  const result = await initCclaw({
    cwd: context.cwd,
    harnesses: args.harnesses,
    interactive,
    skipOrphanCleanup: Boolean(args.flags["skip-orphan-cleanup"]),
    withContext: Boolean(args.flags["with-context"]),
    onProgress: makeProgressPrinter(useColor)
  });
  writeOut(renderSummary(result.counts, useColor));
  // v8.55 — per-harness ambient rules activation guidance. Cursor is
  // auto-load; Claude Code / Codex / OpenCode need a one-line
  // `@`-reference from the user's root memory file (CLAUDE.md /
  // AGENTS.md). Emitting between the summary block and the final
  // "install complete" line keeps the message in the post-install
  // vertical rhythm without disrupting the existing counts table.
  writeOut(renderHarnessRulesGuidance(result.installedHarnesses));
  info(`[cclaw] install complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
  return 0;
}

/**
 * Run the uninstall action. Same banner-ownership rule as
 * `dispatchInstallAction`: the caller emits the banner exactly once;
 * this function does not. See the v8.39 paragraph there for the lag
 * fix rationale.
 */
async function dispatchUninstall(
  context: CliContext,
  useColor: boolean
): Promise<number> {
  const config = await readConfig(context.cwd);
  const harnesses = config?.harnesses ?? [];
  await uninstallCclaw({ cwd: context.cwd });
  info(
    `[cclaw] uninstall complete.${harnesses.length > 0 ? ` Removed: ${harnesses.join(", ")}` : ""}`
  );
  return 0;
}

/**
 * Dispatcher for the TUI menu's resolved action. The v8.39 menu is
 * three rows: install / uninstall / quit. Banner has already been
 * emitted above the menu by the no-arg caller in `runCli` — see the
 * v8.39 paragraph on `dispatchInstallAction` for why we do not emit
 * it again here.
 *
 * `quit` is terminal — exits without touching the project.
 */
async function dispatchMenuAction(
  action: MenuAction,
  context: CliContext,
  args: ParsedArgs,
  useColor: boolean
): Promise<number> {
  switch (action) {
    case "install":
      return dispatchInstallAction(context, args, true, useColor);
    case "uninstall":
      return dispatchUninstall(context, useColor);
    case "quit":
      return 0;
  }
}

/**
 * Non-interactive subcommand surface. Disjoint from `MenuAction` after
 * v8.39 — the TUI menu shrank to install / uninstall / quit, but the
 * non-interactive path still accepts `knowledge` and `version` (the two
 * read-only utilities that were dropped from the TUI rows but kept as
 * CI-friendly commands).
 */
type NonInteractiveAction = "install" | "uninstall" | "knowledge" | "version";

const SUBCOMMAND_TO_ACTION: Record<string, NonInteractiveAction> = {
  // `init` is kept as a backwards-compatible alias for `install` in the
  // non-interactive path; saves the muscle-memory tax for CI scripts
  // that pinned `cclaw init` between v8.0 and v8.28. The TUI menu
  // surfaces the canonical name (`Install`).
  init: "install",
  install: "install",
  uninstall: "uninstall",
  knowledge: "knowledge",
  version: "version"
  // v8.39 — `sync` and `upgrade` are filtered earlier by
  // `COLLAPSED_NON_INTERACTIVE_COMMANDS` (with a one-line migration
  // hint), so they never reach this lookup. v8.37 kept them here so
  // the TUI menu's Sync / Upgrade rows could dispatch through this
  // map; v8.39 collapsed those rows so the map no longer carries them.
};

/**
 * v8.37 — non-interactive commands that were collapsed into `install`.
 * `sync` and `upgrade` previously called `syncCclaw()` and `upgradeCclaw()`
 * which are thin aliases around the idempotent installer. In CI / scripts
 * the rename was cognitive overhead with zero functional difference; we
 * refuse them here with a one-line migration hint pointing at `install`.
 * The TUI menu keeps both items (intent-named UX for humans).
 */
const COLLAPSED_NON_INTERACTIVE_COMMANDS: Record<string, string> = {
  sync: "sync was renamed; use `cclaw --non-interactive install` (it is idempotent and runs orphan cleanup).",
  upgrade:
    "upgrade was renamed; use `cclaw --non-interactive install` after upgrading the cclaw-cli npm package."
};

/**
 * v8.37 — set of subcommands the non-interactive path accepts. Anything
 * not in this set OR not in `COLLAPSED_NON_INTERACTIVE_COMMANDS` is a
 * hard "unknown command" error. The TUI menu surface is broader.
 */
const NON_INTERACTIVE_COMMANDS = new Set(["install", "init", "knowledge", "uninstall", "version", "help"]);

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
        "[cclaw] --non-interactive requires a subcommand (install | knowledge | uninstall | version | help)."
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

  // v8.37 — `help` is a non-interactive command (alias of the --help
  // flag). Handled BEFORE the bare-subcommand gate AND before the
  // menu-action lookup because there is no `help` MenuAction (the TUI
  // menu doesn't surface help as a menu row, and bare `cclaw help`
  // would otherwise hit the same "no longer a bare subcommand" path
  // every other command hits — but `help` is a read-only "print and
  // exit" that does not benefit from the TUI / non-interactive
  // distinction at all).
  if (args.command === "help") {
    emitBanner(useColor);
    emitHelp(useColor);
    return 0;
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

  // v8.37 — non-interactive `sync` / `upgrade` were collapsed into
  // `install`. Print the one-line migration hint and exit 1 (NOT 2 —
  // the command shape is valid, the command itself is retired).
  const collapsedHint = COLLAPSED_NON_INTERACTIVE_COMMANDS[args.command];
  if (collapsedHint) {
    logError(`[cclaw] ${collapsedHint}`);
    return 1;
  }

  // v8.37 — the supported non-interactive command set is a small fixed
  // list. Anything not in it is an unknown command — refuse here so the
  // error names the gate explicitly rather than the older generic
  // "unknown command" emit-help path.
  if (!NON_INTERACTIVE_COMMANDS.has(args.command)) {
    logError(
      `[cclaw] '${args.command}' is not a non-interactive command. Supported: install, knowledge, uninstall, version, help.`
    );
    return 2;
  }

  const subcommandAction = SUBCOMMAND_TO_ACTION[args.command];
  if (!subcommandAction) {
    logError(`[cclaw] unknown command: ${args.command}`);
    emitHelp(useColor);
    return 2;
  }

  // --non-interactive path: same code as the TUI dispatcher but with
  // interactive: false so the harness picker doesn't fire even when a
  // TTY happens to be attached. Auto-detect + --harness fall-through
  // unchanged from v8.28. Note: sync/upgrade cases were stripped above
  // by the COLLAPSED_NON_INTERACTIVE_COMMANDS gate. install/uninstall
  // emit the banner here (their dispatchers no longer do — v8.39 lag
  // fix); knowledge / version stay banner-less (their output is the
  // primary signal, the banner would just push it down).
  switch (subcommandAction) {
    case "install":
      emitBanner(useColor);
      return dispatchInstallAction(context, args, false, useColor);
    case "uninstall":
      emitBanner(useColor);
      return dispatchUninstall(context, useColor);
    case "knowledge":
      return runKnowledgeCommand(context.cwd, args.flags);
    case "version":
      info(CCLAW_VERSION);
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
