import fs from "node:fs/promises";
import { SandboxEscapeError } from "../sandbox.js";
import {
  type SandboxTool,
  parseArgs,
  requireString,
  optionalNumber,
  truncatePayload
} from "./types.js";

const DESCRIPTION =
  "Read a UTF-8 text file from the sandbox. Returns the file contents. " +
  "Supports optional 1-indexed `offset` and `limit` to read a slice.";

export const readTool: SandboxTool = {
  descriptor: {
    name: "read_file",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: {
          type: "string",
          description: "Path relative to the sandbox root."
        },
        offset: {
          type: "integer",
          minimum: 1,
          description: "1-indexed start line (inclusive)."
        },
        limit: {
          type: "integer",
          minimum: 1,
          description: "Maximum number of lines to return."
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
    let offset: number | undefined;
    let limit: number | undefined;
    try {
      offset = optionalNumber(args, "offset");
      limit = optionalNumber(args, "limit");
    } catch (err) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: (err as Error).message
      };
    }
    if (offset !== undefined && (!Number.isInteger(offset) || offset < 1)) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: '"offset" must be a positive integer'
      };
    }
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: '"limit" must be a positive integer'
      };
    }

    let abs: string;
    try {
      abs = await ctx.sandbox.resolve(relPath);
    } catch (err) {
      const denied = err instanceof SandboxEscapeError ? relPath : undefined;
      return {
        ok: false,
        name: this.descriptor.name,
        error: (err as Error).message,
        details: denied ? { deniedPath: denied } : undefined
      };
    }
    let raw: string;
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch (err) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: `read failed: ${(err as Error).message}`,
        details: { path: relPath }
      };
    }
    let content = raw;
    let effectiveLines: number | undefined;
    if (offset !== undefined || limit !== undefined) {
      const lines = raw.split(/\r?\n/);
      const start = Math.max(0, (offset ?? 1) - 1);
      const end = limit !== undefined ? Math.min(lines.length, start + limit) : lines.length;
      const slice = lines.slice(start, end);
      content = slice.join("\n");
      effectiveLines = slice.length;
    }
    const truncated = truncatePayload(content, ctx.maxResultBytes);
    return {
      ok: true,
      name: this.descriptor.name,
      content: truncated,
      details: {
        path: relPath,
        bytes: Buffer.byteLength(truncated, "utf8"),
        truncated: truncated !== content,
        ...(effectiveLines !== undefined ? { lines: effectiveLines } : {})
      }
    };
  }
};
