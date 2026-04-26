import { RUNTIME_ROOT } from "../constants.js";
import {
  groupBindingsByEvent,
  type HookHandlerId,
  type HookManifestHarness
} from "./hook-manifest.js";

function hookDispatcherCommand(hookName: HookHandlerId): string {
  // Dispatch through the polyglot .cmd wrapper so Windows harnesses can run
  // hooks even when command execution happens under CMD-style shells.
  return `${RUNTIME_ROOT}/hooks/run-hook.cmd ${hookName}`;
}

interface ClaudeCommandEntry {
  type: "command";
  command: string;
  timeout?: number;
}

interface ClaudeLikeOuterEntry {
  matcher?: string;
  hooks: ClaudeCommandEntry[];
}

/**
 * Claude / Codex share the same outer envelope: each event is an
 * array of `{matcher?, hooks: [{type: "command", command, timeout?}]}`
 * objects. Entries with the same `matcher` are merged into a single
 * outer entry so we emit one `{matcher: "..."}` block with multiple
 * inner hook commands.
 */
function buildClaudeLikeEvents(
  harness: "claude" | "codex"
): Record<string, ClaudeLikeOuterEntry[]> {
  const out: Record<string, ClaudeLikeOuterEntry[]> = {};
  for (const group of groupBindingsByEvent(harness)) {
    const mergedByMatcher = new Map<string, ClaudeLikeOuterEntry>();
    const order: string[] = [];
    for (const entry of group.entries) {
      const matcherKey = entry.matcher ?? "__no_matcher__";
      let bucket = mergedByMatcher.get(matcherKey);
      if (!bucket) {
        bucket = {
          ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
          hooks: []
        };
        mergedByMatcher.set(matcherKey, bucket);
        order.push(matcherKey);
      }
      const hookEntry: ClaudeCommandEntry = {
        type: "command",
        command: hookDispatcherCommand(entry.handler),
        ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {})
      };
      bucket.hooks.push(hookEntry);
    }
    out[group.event] = order.map((key) => mergedByMatcher.get(key) as ClaudeLikeOuterEntry);
  }
  return out;
}

interface CursorCommandEntry {
  command: string;
  matcher?: string;
  timeout?: number;
}

/**
 * Cursor uses a flat shape: each event maps directly to an array of
 * `{command, matcher?, timeout?}` entries — no inner `hooks` array.
 */
function buildCursorEvents(): Record<string, CursorCommandEntry[]> {
  const out: Record<string, CursorCommandEntry[]> = {};
  for (const group of groupBindingsByEvent("cursor")) {
    out[group.event] = group.entries.map((entry) => ({
      command: hookDispatcherCommand(entry.handler),
      ...(entry.matcher !== undefined ? { matcher: entry.matcher } : {}),
      ...(entry.timeout !== undefined ? { timeout: entry.timeout } : {})
    }));
  }
  return out;
}

export function claudeHooksJsonWithObservation(): string {
  return JSON.stringify(
    {
      cclawHookSchemaVersion: 1,
      hooks: buildClaudeLikeEvents("claude")
    },
    null,
    2
  );
}

export function cursorHooksJsonWithObservation(): string {
  return JSON.stringify(
    {
      cclawHookSchemaVersion: 1,
      version: 1,
      hooks: buildCursorEvents()
    },
    null,
    2
  );
}

export function codexHooksJsonWithObservation(): string {
  return JSON.stringify(
    {
      cclawHookSchemaVersion: 1,
      hooks: buildClaudeLikeEvents("codex")
    },
    null,
    2
  );
}

/**
 * Public accessor so diagnostic CLIs and tests can inspect the
 * manifest without importing the private generator helpers.
 */
export function hookManifestSnapshot(): Array<{
  harness: HookManifestHarness;
  events: Array<{
    event: string;
    entries: Array<{ handler: HookHandlerId; matcher?: string; timeout?: number }>;
  }>;
}> {
  return (["claude", "cursor", "codex"] as const).map((harness) => ({
    harness,
    events: groupBindingsByEvent(harness)
  }));
}
