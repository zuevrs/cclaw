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
import { readKnowledgeLog, type KnowledgeEntry } from "./knowledge-store.js";
import {
  renderBanner,
  renderHelpSections,
  renderProgress,
  renderSummary,
  renderWelcome,
  shouldUseColor,
  type ProgressEvent
} from "./ui.js";
import { HARNESS_IDS, type CliContext, type HarnessId } from "./types.js";

const TAGLINE = "harness-first flow toolkit for coding agents";

const HELP_USAGE = `Usage: cclaw <command> [options]`;

const HELP_NOTES = `Harness selection:
  - If --harness=<id>[,<id>] is passed, install for those.
  - Otherwise, the existing .cclaw/config.yaml (if any) wins.
  - Otherwise, in an interactive TTY, cclaw shows a checkbox picker
    (auto-detected harnesses pre-selected; Up/Down · Space · Enter).
  - In non-TTY (CI, npx --yes, piped input), cclaw auto-detects from project
    root markers (.claude/, .cursor/, .opencode/, .codex/, .agents/skills/,
    CLAUDE.md, opencode.json) and exits with an error if nothing is found.

Flow control (plan / build / review / ship) lives inside the harness via
the /cc command, not in this CLI. There is no \`cclaw plan\`, \`cclaw status\`,
\`cclaw ship\`, or \`cclaw migrate\` — by design.`;

const HELP_COMMANDS: ReadonlyArray<readonly [string, string]> = [
  ["init", "Install cclaw assets in the current project."],
  ["sync", "Reapply cclaw assets to match the current code (idempotent)."],
  ["upgrade", "Sync after upgrading the cclaw-cli npm package."],
  ["uninstall", "Remove cclaw assets from the current project."],
  ["knowledge", "List captured learnings (.cclaw/state/knowledge.jsonl) grouped by tag."],
  ["help", "Show this help."],
  ["version", "Print the version."]
];

const HELP_OPTIONS: ReadonlyArray<readonly [string, string]> = [
  ["--harness=<id>[,<id>]", `Comma-separated list. Supported: ${HARNESS_IDS.join(", ")}.`],
  [
    "--skip-orphan-cleanup",
    "Skip the v8.17 scan that removes .md files in .cclaw/lib/skills/ no longer in AUTO_TRIGGER_SKILLS. Use for emergencies; the scan is normally loud + idempotent."
  ],
  [
    "--all",
    "knowledge: drop the default 20-row limit and print every captured entry."
  ],
  [
    "--tag=<tag>",
    "knowledge: filter to entries whose tags[] contains <tag>."
  ],
  [
    "--surface=<substring>",
    "knowledge: filter to entries whose touchSurface[] contains <substring> as a substring of any path."
  ],
  [
    "--json",
    "knowledge: emit raw jsonl pass-through (one parsed entry per line, no formatting)."
  ]
];

interface ParsedArgs {
  command: string;
  harnesses?: HarnessId[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const [command = "help", ...rest] = argv;
  const flags: Record<string, string | boolean> = {};
  let harnesses: HarnessId[] | undefined;
  for (const arg of rest) {
    if (arg.startsWith("--harness=")) {
      const list = arg.slice("--harness=".length).split(",").map((value) => value.trim()).filter(Boolean);
      const invalid = list.filter((value) => !HARNESS_IDS.includes(value as HarnessId));
      if (invalid.length > 0) {
        throw new Error(`Unknown harnesses: ${invalid.join(", ")}. Supported: ${HARNESS_IDS.join(", ")}`);
      }
      harnesses = list as HarnessId[];
    } else if (arg.startsWith("--")) {
      const [name, ...value] = arg.slice(2).split("=");
      flags[name] = value.length === 0 ? true : value.join("=");
    } else {
      flags._ = arg;
    }
  }
  return { command, harnesses, flags };
}

function emitBanner(useColor: boolean): void {
  writeOut(renderBanner({ version: CCLAW_VERSION, tagline: TAGLINE, useColor }));
}

function emitHelp(useColor: boolean): void {
  writeOut(`  ${HELP_USAGE}\n`);
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

async function isFirstRun(cwd: string): Promise<boolean> {
  return !(await exists(path.join(cwd, RUNTIME_ROOT, "config.yaml")));
}

/**
 * v8.18 — `cclaw knowledge` command body.
 *
 * Reads `.cclaw/state/knowledge.jsonl`, applies optional `--tag` /
 * `--surface` filters, sorts by recency (most recent first; file order is
 * already chronological — slice from the tail), groups by `tags[0]`
 * (`untagged` when empty), and renders as a 3-column table:
 *
 *     <tag>
 *       slug                                      summary                                           tags
 *       ────────────────────────────────────────  ────────────────────────────────────────────────  ────────
 *       20260503-ac-mode-soft-edge                Soft-mode AC discipline edge cases                ac, soft
 *
 * Default cap: 20 rows total (across all groups). `--all` lifts the cap.
 * `--json` short-circuits everything else and prints one JSON entry per
 * line (the raw jsonl shape; no human formatting).
 *
 * Empty / missing knowledge.jsonl prints a single one-liner and exits 0.
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
  const allFlag = flags.all === true;
  const jsonFlag = flags.json === true;

  let filtered = entries;
  if (tagFilter) {
    filtered = filtered.filter((entry) => (entry.tags ?? []).includes(tagFilter));
  }
  if (surfaceFilter) {
    filtered = filtered.filter((entry) =>
      (entry.touchSurface ?? []).some((path) => path.includes(surfaceFilter))
    );
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
      surfaceFilter ? `--surface=${surfaceFilter}` : ""
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

export async function runCli(argv: string[], context: CliContext): Promise<number> {
  configureLogger(context.stdout, context.stderr);
  const args = parseArgs(argv);
  const stdout = getStdout();
  const useColor = shouldUseColor(stdout);

  // Short-circuit per-subcommand help: `cclaw sync --help`, `cclaw init -h`,
  // etc. all print the global help block instead of running the command.
  // Keeps option discovery (e.g. `--skip-orphan-cleanup`) reachable from
  // wherever the user happens to be in their muscle memory.
  if (args.flags.help === true || args.flags.h === true) {
    emitBanner(useColor);
    emitHelp(useColor);
    return 0;
  }

  switch (args.command) {
    case "init": {
      const firstRun = await isFirstRun(context.cwd);
      const detected = firstRun ? await detectHarnesses(context.cwd) : [];
      emitBanner(useColor);
      if (firstRun) writeOut(renderWelcome({ detected, useColor }));
      const result = await initCclaw({
        cwd: context.cwd,
        harnesses: args.harnesses,
        interactive: true,
        skipOrphanCleanup: Boolean(args.flags["skip-orphan-cleanup"]),
        onProgress: makeProgressPrinter(useColor)
      });
      writeOut(renderSummary(result.counts, useColor));
      info(`[cclaw] init complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "sync": {
      emitBanner(useColor);
      const result = await syncCclaw({
        cwd: context.cwd,
        harnesses: args.harnesses,
        interactive: true,
        skipOrphanCleanup: Boolean(args.flags["skip-orphan-cleanup"]),
        onProgress: makeProgressPrinter(useColor)
      });
      writeOut(renderSummary(result.counts, useColor));
      info(`[cclaw] sync complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "upgrade": {
      emitBanner(useColor);
      const result = await upgradeCclaw({
        cwd: context.cwd,
        harnesses: args.harnesses,
        interactive: true,
        skipOrphanCleanup: Boolean(args.flags["skip-orphan-cleanup"]),
        onProgress: makeProgressPrinter(useColor)
      });
      writeOut(renderSummary(result.counts, useColor));
      info(`[cclaw] upgrade complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "uninstall": {
      const config = await readConfig(context.cwd);
      const harnesses = config?.harnesses ?? [];
      emitBanner(useColor);
      await uninstallCclaw({ cwd: context.cwd });
      info(
        `[cclaw] uninstall complete.${harnesses.length > 0 ? ` Removed: ${harnesses.join(", ")}` : ""}`
      );
      return 0;
    }
    case "knowledge":
      return runKnowledgeCommand(context.cwd, args.flags);
    case "version":
    case "--version":
    case "-v":
      info(CCLAW_VERSION);
      return 0;
    case "help":
    case "--help":
    case "-h":
      emitBanner(useColor);
      emitHelp(useColor);
      return 0;
    case "plan":
    case "status":
    case "ship":
    case "migrate":
    case "build":
    case "review":
      logError(`[cclaw] '${args.command}' is not a CLI command in v8. Flow control happens via /cc inside your harness.`);
      return 2;
    default:
      logError(`[cclaw] unknown command: ${args.command}`);
      emitHelp(useColor);
      return 2;
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
