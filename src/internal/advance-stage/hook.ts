import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import process from "node:process";
import { RUNTIME_ROOT } from "../../constants.js";
import type { HookArgs } from "./parsers.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

export async function runHookCommand(
  projectRoot: string,
  args: HookArgs,
  io: InternalIo
): Promise<number> {
  const runHookPath = path.join(projectRoot, RUNTIME_ROOT, "hooks", "run-hook.mjs");
  try {
    await fs.access(runHookPath);
  } catch {
    io.stderr.write(
      `cclaw internal hook: missing hook runtime at ${runHookPath}. Run \`cclaw sync\` first.\n`
    );
    return 1;
  }

  return await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [runHookPath, args.hookName], {
      cwd: projectRoot,
      env: process.env,
      stdio: ["inherit", "pipe", "pipe"]
    });
    child.stdout.on("data", (chunk) => {
      io.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk) => {
      io.stderr.write(chunk);
    });
    child.on("error", (err) => {
      io.stderr.write(
        `cclaw internal hook: failed to launch runtime (${err instanceof Error ? err.message : String(err)}).\n`
      );
      resolve(1);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        io.stderr.write(`cclaw internal hook: runtime terminated by signal ${signal}.\n`);
        resolve(1);
        return;
      }
      resolve(typeof code === "number" ? code : 1);
    });
  });
}
