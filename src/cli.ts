#!/usr/bin/env node
import { realpathSync } from "node:fs";
import process from "node:process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { HARNESS_IDS } from "./types.js";
import { doctorChecks, doctorSucceeded } from "./doctor.js";
import { initCclaw, syncCclaw, uninstallCclaw, upgradeCclaw } from "./install.js";
import { error, info } from "./logger.js";
import type { CliContext, HarnessId } from "./types.js";

type CommandName = "init" | "sync" | "doctor" | "upgrade" | "uninstall";
const INSTALLER_COMMANDS: CommandName[] = ["init", "sync", "doctor", "upgrade", "uninstall"];

interface ParsedArgs {
  command?: CommandName;
  harnesses?: HarnessId[];
}

function usage(): string {
  return `cclaw - installer-first flow toolkit

Usage:
  cclaw init [--harnesses=claude,cursor,opencode,codex]
  cclaw sync
  cclaw doctor
  cclaw upgrade
  cclaw uninstall
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

function parseArgs(argv: string[]): ParsedArgs {
  const [commandRaw, ...flags] = argv;
  const command = INSTALLER_COMMANDS.includes(commandRaw as CommandName)
    ? (commandRaw as CommandName)
    : undefined;

  const parsed: ParsedArgs = { command };
  for (const flag of flags) {
    if (flag.startsWith("--harnesses=")) {
      parsed.harnesses = parseHarnesses(flag.replace("--harnesses=", ""));
    }
  }

  return parsed;
}

async function runCommand(parsed: ParsedArgs, ctx: CliContext): Promise<number> {
  const command = parsed.command;
  if (!command) {
    ctx.stderr.write(usage());
    return 1;
  }

  if (command === "init") {
    await initCclaw({
      projectRoot: ctx.cwd,
      harnesses: parsed.harnesses
    });
    info(ctx, "Initialized .cclaw runtime and generated harness shims");
    return 0;
  }

  if (command === "sync") {
    await syncCclaw(ctx.cwd);
    info(ctx, "Synchronized harness shims from current .cclaw config");
    return 0;
  }

  if (command === "doctor") {
    const checks = await doctorChecks(ctx.cwd);
    for (const check of checks) {
      ctx.stdout.write(`${check.ok ? "PASS" : "FAIL"} ${check.name} :: ${check.details}\n`);
    }
    return doctorSucceeded(checks) ? 0 : 2;
  }

  if (command === "upgrade") {
    await upgradeCclaw(ctx.cwd);
    info(ctx, "Upgraded .cclaw runtime and regenerated generated files");
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

export { parseArgs, parseHarnesses };
