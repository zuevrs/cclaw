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
  "List files inside the sandbox whose relative path matches a glob-style " +
  "pattern. Supports `*` (any chars within a path segment) and `**` " +
  "(any number of path segments). Returns matching paths, one per line.";

const MAX_MATCHES = 500;

export const globTool: SandboxTool = {
  descriptor: {
    name: "glob",
    description: DESCRIPTION,
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["pattern"],
      properties: {
        pattern: {
          type: "string",
          description: "Glob pattern, relative to the sandbox root."
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
    if (pattern.includes("\0")) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: '"pattern" must not contain NUL bytes'
      };
    }
    let regex: RegExp;
    try {
      regex = globToRegExp(pattern);
    } catch (err) {
      return {
        ok: false,
        name: this.descriptor.name,
        error: (err as Error).message
      };
    }
    const matches: string[] = [];
    try {
      await walk(ctx.sandbox.root, "", matches, regex);
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
    matches.sort();
    const capped = matches.slice(0, MAX_MATCHES);
    const body =
      capped.length > 0
        ? capped.join("\n") +
          (matches.length > capped.length
            ? `\n…[truncated at ${MAX_MATCHES} matches]`
            : "")
        : "(no matches)";
    return {
      ok: true,
      name: this.descriptor.name,
      content: truncatePayload(body, ctx.maxResultBytes),
      details: {
        pattern,
        matches: capped.length,
        totalMatches: matches.length,
        truncated: matches.length > capped.length
      }
    };
  }
};

async function walk(
  root: string,
  rel: string,
  acc: string[],
  regex: RegExp
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
      await walk(root, childRel, acc, regex);
      continue;
    }
    if (entry.isFile() && regex.test(childRel.replace(/\\/g, "/"))) {
      acc.push(childRel);
    }
  }
}

/**
 * Minimal glob → regex: `**` matches zero or more path segments, `*`
 * matches anything except `/`, `?` matches a single non-slash char.
 * Everything else is escaped. Intentionally narrower than full
 * bash-style expansion so behavior is easy to reason about.
 */
function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/");
  let src = "^";
  let i = 0;
  while (i < normalized.length) {
    const c = normalized[i]!;
    if (c === "*") {
      if (normalized[i + 1] === "*") {
        if (normalized[i + 2] === "/") {
          src += "(?:.*/)?";
          i += 3;
        } else {
          src += ".*";
          i += 2;
        }
      } else {
        src += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      src += "[^/]";
      i += 1;
    } else if ("+()|^$.{}[]\\".includes(c)) {
      src += `\\${c}`;
      i += 1;
    } else {
      src += c;
      i += 1;
    }
  }
  src += "$";
  return new RegExp(src);
}
