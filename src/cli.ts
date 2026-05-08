#!/usr/bin/env node
import path from "node:path";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CCLAW_VERSION } from "./constants.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { configureLogger, error as logError, info } from "./logger.js";
import { HARNESS_IDS, type CliContext, type HarnessId } from "./types.js";

const HELP_BODY = `cclaw v${CCLAW_VERSION} — harness installer / sync.

Usage: cclaw <command> [options]

Commands:
  init                Install cclaw assets in the current project.
  sync                Reapply cclaw assets to match the current code (idempotent).
  upgrade             Sync after upgrading the cclaw-cli npm package.
  uninstall           Remove cclaw assets from the current project.
  help                Show this help.
  version             Print the version.

Harness selection:
  - If --harness=<id>[,<id>] is passed, install for those.
  - Otherwise, the existing .cclaw/config.yaml (if any) wins.
  - Otherwise, in an interactive TTY, cclaw shows a checkbox picker
    (auto-detected harnesses pre-selected; Up/Down · Space · Enter).
  - In non-TTY (CI, npx --yes, piped input), cclaw auto-detects from project
    root markers (.claude/, .cursor/, .opencode/, .codex/, .agents/skills/,
    CLAUDE.md, opencode.json) and exits with an error if nothing is found.

Flow control (plan / build / review / ship) lives inside the harness via the /cc command, not in this CLI. There is no \`cclaw plan\`, \`cclaw status\`, \`cclaw ship\`, or \`cclaw migrate\` — by design.

Options:
  --harness=<id>[,<id>]  Comma-separated list. Supported: ${HARNESS_IDS.join(", ")}.
`;

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

export async function runCli(argv: string[], context: CliContext): Promise<number> {
  configureLogger(context.stdout, context.stderr);
  const args = parseArgs(argv);
  switch (args.command) {
    case "init": {
      const result = await initCclaw({
        cwd: context.cwd,
        harnesses: args.harnesses,
        interactive: true
      });
      info(`[cclaw] init complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "sync": {
      const result = await syncCclaw({
        cwd: context.cwd,
        harnesses: args.harnesses,
        interactive: true
      });
      info(`[cclaw] sync complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "upgrade": {
      const result = await upgradeCclaw({
        cwd: context.cwd,
        harnesses: args.harnesses,
        interactive: true
      });
      info(`[cclaw] upgrade complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "uninstall": {
      await uninstallCclaw({ cwd: context.cwd });
      info("[cclaw] uninstall complete.");
      return 0;
    }
    case "version":
    case "--version":
    case "-v":
      info(CCLAW_VERSION);
      return 0;
    case "help":
    case "--help":
    case "-h":
      info(HELP_BODY);
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
      logError(HELP_BODY);
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
