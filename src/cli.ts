#!/usr/bin/env node
import { CCLAW_VERSION } from "./constants.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { configureLogger, error as logError, info } from "./logger.js";
import { HARNESS_IDS, type CliContext, type HarnessId } from "./types.js";

const HELP_BODY = `cclaw v${CCLAW_VERSION} — harness installer / sync.

Usage: cclaw <command> [options]

Commands:
  init                Install cclaw assets in the current project (default harness: cursor).
  sync                Reapply cclaw assets to match the current code (idempotent).
  upgrade             Sync after upgrading the cclaw-cli npm package.
  uninstall           Remove cclaw assets from the current project.
  help                Show this help.
  version             Print the version.

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
      const result = await initCclaw({ cwd: context.cwd, harnesses: args.harnesses });
      info(`[cclaw] init complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "sync": {
      const result = await syncCclaw({ cwd: context.cwd, harnesses: args.harnesses });
      info(`[cclaw] sync complete. Harnesses: ${result.installedHarnesses.join(", ")}`);
      return 0;
    }
    case "upgrade": {
      const result = await upgradeCclaw({ cwd: context.cwd, harnesses: args.harnesses });
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

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
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
