import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { RUNTIME_ROOT } from "../constants.js";

function resolveCliEntrypointForGeneratedHook(): string | null {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    path.resolve(path.dirname(here), "..", "cli.js"),
    path.resolve(path.dirname(here), "..", "..", "dist", "cli.js")
  ];
  for (const candidate of candidates) {
    // Synchronous probe runs only during cclaw-cli init/sync generation.
    // The generated hook receives a concrete path and does not need a global bin.
    if (existsSync(candidate)) return candidate;
  }
  return null;
}


function internalHelperScript(helperName: string, internalSubcommand: string, usage: string): string {
  const cliEntrypoint = resolveCliEntrypointForGeneratedHook();
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliEntrypoint)};
const HELPER_NAME = ${JSON.stringify(helperName)};
const INTERNAL_SUBCOMMAND = ${JSON.stringify(internalSubcommand)};
const USAGE = ${JSON.stringify(usage)};

async function detectRoot() {
  const candidates = [
    process.env.CCLAW_PROJECT_ROOT,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CURSOR_PROJECT_DIR,
    process.env.CURSOR_PROJECT_ROOT,
    process.env.OPENCODE_PROJECT_DIR,
    process.env.OPENCODE_PROJECT_ROOT,
    process.cwd()
  ].filter((value) => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    try {
      const runtimePath = path.join(candidate, RUNTIME_ROOT);
      const stat = await fs.stat(runtimePath);
      if (stat.isDirectory()) return candidate;
    } catch {
      // continue
    }
  }
  return candidates[0] || process.cwd();
}

function printUsage() {
  process.stderr.write(USAGE + "\\n");
}

async function main() {
  const [, , ...flags] = process.argv;
  if (flags.includes("--help") || flags.includes("-h")) {
    printUsage();
    return;
  }

  const root = await detectRoot();
  const runtimePath = path.join(root, RUNTIME_ROOT);
  try {
    const stat = await fs.stat(runtimePath);
    if (!stat.isDirectory()) throw new Error("not-dir");
  } catch {
    process.stderr.write("[cclaw] " + HELPER_NAME + ": runtime root not found at " + runtimePath + "\\n");
    process.exitCode = 1;
    return;
  }

  const cliEntrypoint = process.env.CCLAW_CLI_JS || CCLAW_CLI_ENTRYPOINT;
  if (!cliEntrypoint || cliEntrypoint.trim().length === 0) {
    process.stderr.write(
      "[cclaw] " + HELPER_NAME + ": local Node runtime entrypoint is missing. Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const stat = await fs.stat(cliEntrypoint);
    if (!stat.isFile()) throw new Error("not-file");
  } catch {
    process.stderr.write(
      "[cclaw] " + HELPER_NAME + ": local Node runtime entrypoint not found at " + cliEntrypoint + ". Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(process.execPath, [cliEntrypoint, "internal", INTERNAL_SUBCOMMAND, ...flags], {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  let spawnErrored = false;

  child.on("error", (error) => {
    spawnErrored = true;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      process.stderr.write(
        "[cclaw] " + HELPER_NAME + ": node executable not found while invoking local runtime. Re-run npx cclaw-cli doctor.\\n"
      );
    } else {
      process.stderr.write(
        "[cclaw] " + HELPER_NAME + ": failed to invoke local Node runtime (" +
          (error instanceof Error ? error.message : String(error)) +
          ").\\n"
      );
    }
    process.exitCode = 1;
  });

  child.on("close", (code, signal) => {
    if (spawnErrored) {
      process.exitCode = 1;
      return;
    }
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = typeof code === "number" && code >= 0 ? code : 1;
  });
}

void main();
`;
}

export function startFlowScript(): string {
  return internalHelperScript(
    "start-flow",
    "start-flow",
    "Usage: node " + RUNTIME_ROOT + "/hooks/start-flow.mjs --track=<standard|medium|quick> [--class=...] [--prompt=...] [--stack=...] [--reason=...] [--reclassify] [--force-reset]"
  );
}

export function stageCompleteScript(): string {
  const cliEntrypoint = resolveCliEntrypointForGeneratedHook();
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};
const CCLAW_CLI_ENTRYPOINT = ${JSON.stringify(cliEntrypoint)};

async function detectRoot() {
  const candidates = [
    process.env.CCLAW_PROJECT_ROOT,
    process.env.CLAUDE_PROJECT_DIR,
    process.env.CURSOR_PROJECT_DIR,
    process.env.CURSOR_PROJECT_ROOT,
    process.env.OPENCODE_PROJECT_DIR,
    process.env.OPENCODE_PROJECT_ROOT,
    process.cwd()
  ].filter((value) => typeof value === "string" && value.length > 0);

  for (const candidate of candidates) {
    try {
      const runtimePath = path.join(candidate, RUNTIME_ROOT);
      const stat = await fs.stat(runtimePath);
      if (stat.isDirectory()) return candidate;
    } catch {
      // continue
    }
  }
  return candidates[0] || process.cwd();
}

function printUsage() {
  process.stderr.write(
    "Usage: node " +
      RUNTIME_ROOT +
      "/hooks/stage-complete.mjs <stage> [--passed=...] [--evidence-json=...] [--waive-delegation=...] [--waiver-reason=...] [--json]\\n"
  );
}

async function main() {
  const [, , stage, ...flags] = process.argv;
  if (!stage || stage.trim().length === 0) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const root = await detectRoot();
  const runtimePath = path.join(root, RUNTIME_ROOT);
  try {
    const stat = await fs.stat(runtimePath);
    if (!stat.isDirectory()) throw new Error("not-dir");
  } catch {
    process.stderr.write("[cclaw] stage-complete: runtime root not found at " + runtimePath + "\\n");
    process.exitCode = 1;
    return;
  }

  const cliEntrypoint = process.env.CCLAW_CLI_JS || CCLAW_CLI_ENTRYPOINT;
  if (!cliEntrypoint || cliEntrypoint.trim().length === 0) {
    process.stderr.write(
      "[cclaw] stage-complete: local Node runtime entrypoint is missing. Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  try {
    const stat = await fs.stat(cliEntrypoint);
    if (!stat.isFile()) throw new Error("not-file");
  } catch {
    process.stderr.write(
      "[cclaw] stage-complete: local Node runtime entrypoint not found at " + cliEntrypoint + ". Re-run npx cclaw-cli sync, or set CCLAW_CLI_JS=/absolute/path/to/dist/cli.js for this session.\\n"
    );
    process.exitCode = 1;
    return;
  }

  const child = spawn(
    process.execPath,
    [cliEntrypoint, "internal", "advance-stage", stage, ...flags],
    {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  }
  );
  let spawnErrored = false;

  child.on("error", (error) => {
    spawnErrored = true;
    const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
    if (code === "ENOENT") {
      process.stderr.write(
        "[cclaw] stage-complete: node executable not found while invoking local runtime. Re-run npx cclaw-cli doctor.\\n"
      );
    } else {
      process.stderr.write(
        "[cclaw] stage-complete: failed to invoke local Node advance-stage runtime (" +
          (error instanceof Error ? error.message : String(error)) +
          ").\\n"
      );
    }
    process.exitCode = 1;
  });

  child.on("close", (code, signal) => {
    if (spawnErrored) {
      process.exitCode = 1;
      return;
    }
    if (signal) {
      process.exitCode = 1;
      return;
    }
    process.exitCode = typeof code === "number" && code >= 0 ? code : 1;
  });
}

void main();
`;
}

export function runHookCmdScript(): string {
  return `: << 'CMDBLOCK'
@echo off
REM Cross-platform wrapper for cclaw Node hook runtime.
REM Windows executes this batch block; Unix shells treat it as a heredoc comment.
if "%~1"=="" (
  echo [cclaw] run-hook.cmd: missing hook name >&2
  exit /b 1
)
set "HOOK_DIR=%~dp0"
set "RUNTIME=%HOOK_DIR%run-hook.mjs"
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
  REM Best-effort: missing node should not block harness execution loops.
  echo [cclaw] run-hook.cmd: node not found; cclaw hook skipped. Run npx cclaw-cli doctor. >&2
  exit /b 0
)
node "%RUNTIME%" %*
exit /b %ERRORLEVEL%
CMDBLOCK
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ "$#" -lt 1 ]; then
  echo "[cclaw] run-hook.cmd: missing hook name" >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "[cclaw] run-hook.cmd: node not found; cclaw hook skipped. Run npx cclaw-cli doctor." >&2
  exit 0
fi
exec node "\${SCRIPT_DIR}/run-hook.mjs" "$@"
`;
}

export { claudeHooksJsonWithObservation as claudeHooksJson } from "./observe.js";
export { cursorHooksJsonWithObservation as cursorHooksJson } from "./observe.js";
export { codexHooksJsonWithObservation as codexHooksJson } from "./observe.js";
export { nodeHookRuntimeScript } from "./node-hooks.js";
export { opencodePluginJs } from "./opencode-plugin.js";
