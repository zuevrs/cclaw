import type { HarnessId } from "../types.js";
import {
  semanticEventCoverage,
  type HookSemanticEvent
} from "./hook-manifest.js";

export { HOOK_SEMANTIC_EVENTS, type HookSemanticEvent } from "./hook-manifest.js";

/**
 * OpenCode is covered by the inline plugin (`opencode-plugin.ts`), not
 * by the generated `run-hook.mjs` dispatcher. We keep its semantic
 * coverage table here as an explicit descriptor, since it does not
 * flow through the hook manifest.
 */
const OPENCODE_SEMANTIC_COVERAGE: Partial<Record<HookSemanticEvent, string>> = {
  session_rehydrate: "plugin event handlers + transform rehydration",
  stop_handoff: "plugin session.idle -> stop-handoff"
};

/**
 * Public semantic coverage map derived from `HOOK_MANIFEST` for
 * claude/cursor/codex, plus the static OpenCode descriptor. Consumers
 * should treat this as read-only.
 */
export const HOOK_EVENTS_BY_HARNESS: Record<
  HarnessId,
  Partial<Record<HookSemanticEvent, string>>
> = Object.freeze(
  {
    claude: semanticEventCoverage("claude"),
    cursor: semanticEventCoverage("cursor"),
    codex: semanticEventCoverage("codex"),
    opencode: OPENCODE_SEMANTIC_COVERAGE
  } satisfies Record<HarnessId, Partial<Record<HookSemanticEvent, string>>>
);
