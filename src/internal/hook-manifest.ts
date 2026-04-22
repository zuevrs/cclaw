import type { Writable } from "node:stream";
import {
  HOOK_MANIFEST,
  HOOK_MANIFEST_HARNESSES,
  groupBindingsByEvent,
  requiredEventsFor
} from "../content/hook-manifest.js";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

interface HookManifestArgs {
  json: boolean;
  harness?: "claude" | "cursor" | "codex";
}

function parseArgs(tokens: string[]): HookManifestArgs {
  const args: HookManifestArgs = { json: false };
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    if (token === "--json") args.json = true;
    else if (token === "--harness") {
      const value = tokens[i + 1];
      if (value !== "claude" && value !== "cursor" && value !== "codex") {
        throw new Error(`--harness must be one of claude|cursor|codex, got ${String(value)}`);
      }
      args.harness = value;
      i += 1;
    } else {
      throw new Error(`Unknown hook-manifest flag: ${token}`);
    }
  }
  return args;
}

/**
 * `cclaw internal hook-manifest` — diagnostic command that prints
 * the resolved manifest. Primary use cases:
 *
 *  - debugging "which handler fires for event X on harness Y",
 *  - migration tooling that needs a machine-readable view,
 *  - parity verification between the source-of-truth manifest and
 *    per-harness generated documents.
 */
export async function runHookManifestCommand(
  _projectRoot: string,
  argv: string[],
  io: InternalIo
): Promise<number> {
  const args = parseArgs(argv);
  const harnesses = args.harness ? [args.harness] : [...HOOK_MANIFEST_HARNESSES];

  if (args.json) {
    const payload = {
      handlers: HOOK_MANIFEST.map((spec) => ({
        handler: spec.handler,
        description: spec.description,
        semantic: spec.semantic,
        bindings: spec.bindings
      })),
      byHarness: Object.fromEntries(
        harnesses.map((harness) => [
          harness,
          {
            requiredEvents: requiredEventsFor(harness),
            events: groupBindingsByEvent(harness)
          }
        ])
      )
    };
    io.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  }

  const lines: string[] = [];
  lines.push("cclaw hook manifest");
  for (const harness of harnesses) {
    lines.push("");
    lines.push(`## ${harness}`);
    const groups = groupBindingsByEvent(harness);
    if (groups.length === 0) {
      lines.push("  (no bindings)");
      continue;
    }
    for (const group of groups) {
      lines.push(`  ${group.event}:`);
      for (const entry of group.entries) {
        const parts: string[] = [entry.handler];
        if (entry.matcher) parts.push(`matcher=${entry.matcher}`);
        if (entry.timeout) parts.push(`timeout=${entry.timeout}s`);
        lines.push(`    - ${parts.join(" ")}`);
      }
    }
  }
  io.stdout.write(`${lines.join("\n")}\n`);
  return 0;
}
