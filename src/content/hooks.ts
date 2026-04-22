import { RUNTIME_ROOT } from "../constants.js";

export function stageCompleteScript(): string {
  return `#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";

const RUNTIME_ROOT = ${JSON.stringify(RUNTIME_ROOT)};

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
      "/hooks/stage-complete.mjs <stage> [--passed=...] [--evidence-json=...] [--waive-delegation=...] [--waiver-reason=...]\\n"
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

  const cclawCommand = process.platform === "win32" ? "cclaw.cmd" : "cclaw";
  const child = spawn(cclawCommand, ["internal", "advance-stage", stage, ...flags], {
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
        "[cclaw] stage-complete: cclaw binary not found in PATH. Install cclaw CLI and rerun stage completion.\\n"
      );
    } else {
      process.stderr.write(
        "[cclaw] stage-complete: failed to invoke cclaw internal advance-stage (" +
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

export { claudeHooksJsonWithObservation as claudeHooksJson } from "./observe.js";
export { cursorHooksJsonWithObservation as cursorHooksJson } from "./observe.js";
export { codexHooksJsonWithObservation as codexHooksJson } from "./observe.js";
export { nodeHookRuntimeScript } from "./node-hooks.js";
export { opencodePluginJs } from "./opencode-plugin.js";
