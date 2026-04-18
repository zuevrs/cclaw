import fs from "node:fs/promises";
import path from "node:path";
import { SandboxEscapeError } from "../sandbox.js";
import {
  type SandboxTool,
  parseArgs,
  requireString,
  truncatePayload
} from "./types.js";

const DESCRIPTION =
  "Write a UTF-8 text file inside the sandbox. Creates parent directories " +
  "as needed. Overwrites existing files. Only paths inside the sandbox " +
  "are accepted.";

export const writeTool: SandboxTool = {
  descriptor: {
    name: "write_file",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path", "content"],
      properties: {
        path: {
          type: "string",
          description: "Path relative to the sandbox root."
        },
        content: {
          type: "string",
          description: "UTF-8 contents to write."
        }
      }
    }
  },
  async invoke(rawArgs, ctx) {
    let args: Record<string, unknown>;
    try {
      args = parseArgs(rawArgs);
    } catch (err) {
      return { ok: false, name: this.descriptor.name, error: (err as Error).message };
    }
    let relPath: string;
    try {
      relPath = requireString(args, "path");
    } catch (err) {
      return { ok: false, name: this.descriptor.name, error: (err as Error).message };
    }
    const rawContent = args.content;
    if (typeof rawContent !== "string") {
      return {
        ok: false,
        name: this.descriptor.name,
        error: '"content" must be a string'
      };
    }
    const payloadBytes = Buffer.byteLength(rawContent, "utf8");
    if (payloadBytes > ctx.maxResultBytes * 4) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: `"content" exceeds per-invocation ceiling (${payloadBytes} bytes).`
      };
    }
    let abs: string;
    try {
      abs = await ctx.sandbox.resolve(relPath, { allowMissing: true });
    } catch (err) {
      const denied = err instanceof SandboxEscapeError ? relPath : undefined;
      return {
        ok: false,
        name: this.descriptor.name,
        error: (err as Error).message,
        details: denied ? { deniedPath: denied } : undefined
      };
    }
    try {
      await fs.mkdir(path.dirname(abs), { recursive: true });
      await fs.writeFile(abs, rawContent, "utf8");
    } catch (err) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: `write failed: ${(err as Error).message}`,
        details: { path: relPath }
      };
    }
    const summary = `wrote ${payloadBytes} byte(s) to ${relPath}`;
    return {
      ok: true,
      name: this.descriptor.name,
      content: truncatePayload(summary, ctx.maxResultBytes),
      details: { path: relPath, bytes: payloadBytes }
    };
  }
};
