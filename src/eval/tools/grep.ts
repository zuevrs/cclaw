import fs from "node:fs/promises";
import path from "node:path";
import { SandboxEscapeError } from "../sandbox.js";
import {
  type SandboxTool,
  parseArgs,
  requireString,
  optionalNumber,
  truncatePayload
} from "./types.js";

const DESCRIPTION =
  "Search the sandbox for a regular expression. Returns matching lines in " +
  "`path:line:text` form. Accepts optional `caseInsensitive` and a per-call " +
  "`maxMatches` cap (default 100, hard max 500).";

const HARD_MAX = 500;

export const grepTool: SandboxTool = {
  descriptor: {
    name: "grep",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Regular expression compiled with JavaScript semantics."
        },
        caseInsensitive: {
          type: "boolean",
          description: "Match case-insensitively (default false)."
        },
        maxMatches: {
          type: "integer",
          minimum: 1,
          description: "Stop after N matches (default 100, hard max 500)."
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
    let pattern: string;
    try {
      pattern = requireString(args, "pattern");
    } catch (err) {
      return { ok: false, name: this.descriptor.name, error: (err as Error).message };
    }
    const caseInsensitive = args.caseInsensitive === true;
    let maxMatches: number;
    try {
      const raw = optionalNumber(args, "maxMatches");
      maxMatches = raw === undefined ? 100 : Math.min(HARD_MAX, Math.max(1, Math.floor(raw)));
    } catch (err) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: (err as Error).message
      };
    }
    let regex: RegExp;
    try {
      regex = new RegExp(pattern, caseInsensitive ? "i" : "");
    } catch (err) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: `invalid regex: ${(err as Error).message}`
      };
    }

    let filesScanned = 0;
    const hits: string[] = [];
    try {
      await walk(ctx.sandbox.root, "", async (relPath, abs) => {
        if (hits.length >= maxMatches) return false;
        let content: string;
        try {
          content = await fs.readFile(abs, "utf8");
        } catch {
          return true;
        }
        filesScanned += 1;
        const lines = content.split(/\r?\n/);
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]!;
          if (regex.test(line)) {
            hits.push(`${relPath}:${i + 1}:${line}`);
            if (hits.length >= maxMatches) return false;
          }
        }
        return true;
      });
    } catch (err) {
      if (err instanceof SandboxEscapeError) {
        return {
          ok: false,
          name: this.descriptor.name,
          error: err.message,
          details: { deniedPath: pattern }
        };
      }
      return {
        ok: false,
        name: this.descriptor.name,
        error: `walk failed: ${(err as Error).message}`
      };
    }

    const body = hits.length > 0 ? hits.join("\n") : "(no matches)";
    return {
      ok: true,
      name: this.descriptor.name,
      content: truncatePayload(body, ctx.maxResultBytes),
      details: {
        pattern,
        caseInsensitive,
        matches: hits.length,
        filesScanned,
        truncated: hits.length >= maxMatches
      }
    };
  }
};

async function walk(
  root: string,
  rel: string,
  visit: (relPath: string, abs: string) => Promise<boolean>
): Promise<void> {
  const dir = path.join(root, rel);
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean; isSymbolicLink(): boolean }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as typeof entries;
  } catch {
    return;
  }
  for (const entry of entries) {
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      await walk(root, childRel, visit);
      continue;
    }
    if (entry.isFile()) {
      const keepGoing = await visit(
        childRel.replace(/\\/g, "/"),
        path.join(root, childRel)
      );
      if (keepGoing === false) return;
    }
  }
}
