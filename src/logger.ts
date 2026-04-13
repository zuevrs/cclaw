import type { CliContext } from "./types.js";

export function info(ctx: CliContext, message: string): void {
  ctx.stdout.write(`[cclaw] ${message}\n`);
}

export function error(ctx: CliContext, message: string): void {
  ctx.stderr.write(`[cclaw:error] ${message}\n`);
}
