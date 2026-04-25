import type { HarnessId } from "../types.js";

/**
 * Canonical operational manifest for cclaw hooks.
 *
 * This is the **single source of truth** for:
 *
 *  - the per-harness JSON generators in `./observe.ts`
 *    (claude/cursor/codex hook documents),
 *  - the semantic coverage map in `./hook-events.ts` (docs + doctor),
 *  - the `requiredEvents` list embedded in `src/hook-schemas/*.v1.json`
 *    (enforced by a parity test).
 *
 * When adding a new hook handler or rerouting an existing one, edit
 * this file and let the downstream modules rebuild from it. Never
 * hard-code a `SessionStart`, `PreToolUse`, etc. mapping outside of
 * this manifest.
 *
 * OpenCode is deliberately out of scope here: its plugin
 * (`opencode-plugin.ts`) implements the handlers inline rather than
 * dispatching through `run-hook.mjs`, so its coverage is tracked
 * separately in `HOOK_EVENTS_BY_HARNESS`.
 */

export const HOOK_MANIFEST_HARNESSES = ["claude", "cursor", "codex"] as const;
export type HookManifestHarness = (typeof HOOK_MANIFEST_HARNESSES)[number];

export const HOOK_HANDLERS = [
  "session-start",
  "prompt-guard",
  "workflow-guard",
  "context-monitor",
  "stop-handoff",
  "pre-compact",
  "verify-current-state"
] as const;
export type HookHandlerId = (typeof HOOK_HANDLERS)[number];

export interface HookBinding {
  /**
   * Harness-native event name (exact string; PascalCase for
   * claude/codex, camelCase for cursor). Do not normalize casing.
   */
  event: string;
  matcher?: string;
  timeout?: number;
  /**
   * Within a single (harness, event) group, entries are sorted by
   * `priority` ASC, ties broken by manifest-declaration order. Use
   * this to express "this handler must run BEFORE/AFTER that handler
   * on the same event" (e.g. pre-compact must run before session-start
   * on cursor `sessionCompact`). Default `0`.
   */
  priority?: number;
}

export interface HookHandlerSpec {
  handler: HookHandlerId;
  description: string;
  /**
   * Semantic event id used by `HOOK_EVENTS_BY_HARNESS` / docs.
   * `null` means this handler contributes no semantic coverage row
   * (e.g. `verify-current-state` on codex is a supplementary guard,
   * not a top-level semantic event).
   */
  semantic: HookSemanticEvent | null;
  bindings: Partial<Record<HookManifestHarness, HookBinding[]>>;
}

export const HOOK_SEMANTIC_EVENTS = [
  "session_rehydrate",
  "pre_tool_prompt_guard",
  "pre_tool_workflow_guard",
  "post_tool_context_monitor",
  "stop_handoff",
  "precompact_compat"
] as const;
export type HookSemanticEvent = (typeof HOOK_SEMANTIC_EVENTS)[number];

export const HOOK_MANIFEST: readonly HookHandlerSpec[] = [
  {
    handler: "session-start",
    description: "Rehydrate flow state, refresh Ralph Loop + compound readiness, emit bootstrap digest.",
    semantic: "session_rehydrate",
    bindings: {
      claude: [{ event: "SessionStart", matcher: "startup|resume|clear|compact" }],
      cursor: [
        { event: "sessionStart" },
        { event: "sessionResume" },
        { event: "sessionClear" },
        { event: "sessionCompact" }
      ],
      codex: [{ event: "SessionStart", matcher: "startup|resume" }]
    }
  },
  {
    handler: "prompt-guard",
    description: "Stage-aware prompt gate (iron-laws + strictness).",
    semantic: "pre_tool_prompt_guard",
    bindings: {
      claude: [{ event: "PreToolUse", matcher: "*" }],
      cursor: [{ event: "preToolUse", matcher: "*" }],
      codex: [
        { event: "UserPromptSubmit" },
        { event: "PreToolUse", matcher: "Bash|bash" }
      ]
    }
  },
  {
    handler: "workflow-guard",
    description: "TDD and workflow gate on Write/Edit/Bash style tool invocations.",
    semantic: "pre_tool_workflow_guard",
    bindings: {
      claude: [{ event: "PreToolUse", matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash" }],
      cursor: [{ event: "preToolUse", matcher: "*" }],
      codex: [
        { event: "UserPromptSubmit" },
        { event: "PreToolUse", matcher: "Bash|bash" }
      ]
    }
  },
  {
    handler: "context-monitor",
    description: "Post-tool context usage + stage signal monitor.",
    semantic: "post_tool_context_monitor",
    bindings: {
      claude: [{ event: "PostToolUse", matcher: "*" }],
      cursor: [{ event: "postToolUse", matcher: "*" }],
      codex: [{ event: "PostToolUse", matcher: "Bash|bash" }]
    }
  },
  {
    handler: "stop-handoff",
    description: "Remind about clean handoff with stage + run context on session stop.",
    semantic: "stop_handoff",
    bindings: {
      claude: [{ event: "Stop", timeout: 10 }],
      cursor: [{ event: "stop", timeout: 10 }],
      codex: [{ event: "Stop", timeout: 10 }]
    }
  },
  {
    handler: "pre-compact",
    description: "No-op compatibility hook for harness pre-compact events; session-start rehydrates from flow-state, artifacts, and knowledge.",
    semantic: "precompact_compat",
    bindings: {
      claude: [{ event: "PreCompact", matcher: "manual|auto", timeout: 10 }],
      // Keep this before session-start on cursor `sessionCompact` so the
      // compatibility handler runs before rehydration.
      cursor: [{ event: "sessionCompact", priority: -10 }]
    }
  },
  {
    handler: "verify-current-state",
    description: "Supplementary codex guard that runs on UserPromptSubmit to assert the live state matches the flow.",
    semantic: null,
    bindings: {
      codex: [{ event: "UserPromptSubmit" }]
    }
  }
] as const;

/** Sanity: every harness in HOOK_MANIFEST_HARNESSES must be a HarnessId. */
const _harnessIdCheck: readonly HarnessId[] = HOOK_MANIFEST_HARNESSES;
void _harnessIdCheck;

export interface EventGroup {
  event: string;
  /**
   * Entries sorted by (priority ASC, declaration order). Default
   * priority is 0. Stable — ties preserve manifest order.
   */
  entries: Array<{
    handler: HookHandlerId;
    matcher?: string;
    timeout?: number;
  }>;
}

interface InternalGroup {
  event: string;
  entries: Array<{
    handler: HookHandlerId;
    matcher?: string;
    timeout?: number;
    priority: number;
    seq: number;
  }>;
}

/**
 * Group manifest bindings by harness-native event name. This is the
 * core projection that observe.ts generators consume to emit the
 * harness-specific JSON document.
 */
export function groupBindingsByEvent(harness: HookManifestHarness): EventGroup[] {
  const order: string[] = [];
  const byEvent = new Map<string, InternalGroup>();
  let seq = 0;
  for (const spec of HOOK_MANIFEST) {
    const bindings = spec.bindings[harness];
    if (!bindings) continue;
    for (const binding of bindings) {
      let group = byEvent.get(binding.event);
      if (!group) {
        group = { event: binding.event, entries: [] };
        byEvent.set(binding.event, group);
        order.push(binding.event);
      }
      group.entries.push({
        handler: spec.handler,
        ...(binding.matcher !== undefined ? { matcher: binding.matcher } : {}),
        ...(binding.timeout !== undefined ? { timeout: binding.timeout } : {}),
        priority: binding.priority ?? 0,
        seq: seq++
      });
    }
  }
  return order.map((event) => {
    const group = byEvent.get(event) as InternalGroup;
    const sorted = [...group.entries].sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.seq - b.seq;
    });
    return {
      event: group.event,
      entries: sorted.map(({ priority: _p, seq: _s, ...entry }) => entry)
    };
  });
}

/** Distinct harness-native event names covered by the manifest. */
export function requiredEventsFor(harness: HookManifestHarness): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const spec of HOOK_MANIFEST) {
    for (const binding of spec.bindings[harness] ?? []) {
      if (seen.has(binding.event)) continue;
      seen.add(binding.event);
      ordered.push(binding.event);
    }
  }
  return ordered;
}

/**
 * Human-readable per-harness semantic coverage used by docs and doctor output.
 */
export function semanticEventCoverage(
  harness: HookManifestHarness
): Partial<Record<HookSemanticEvent, string>> {
  const out: Partial<Record<HookSemanticEvent, string>> = {};
  for (const spec of HOOK_MANIFEST) {
    if (spec.semantic === null) continue;
    const bindings = spec.bindings[harness];
    if (!bindings || bindings.length === 0) continue;
    out[spec.semantic] = describeBindings(bindings);
  }
  return out;
}

function describeBindings(bindings: HookBinding[]): string {
  return bindings
    .map((binding) => {
      const pieces = [binding.event];
      if (binding.matcher) pieces.push(`matcher=${binding.matcher}`);
      if (binding.timeout) pieces.push(`timeout=${binding.timeout}s`);
      return pieces.join(" ");
    })
    .join(" | ");
}
