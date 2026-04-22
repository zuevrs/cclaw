import type { HarnessId } from "../types.js";
import {
  HOOK_SEMANTIC_EVENTS,
  HOOK_MANIFEST_HARNESSES,
  semanticEventCoverage,
  type HookSemanticEvent,
  type HookManifestHarness
} from "./hook-manifest.js";

export { HOOK_SEMANTIC_EVENTS, type HookSemanticEvent } from "./hook-manifest.js";

function isManifestHarness(value: HarnessId): value is HookManifestHarness {
  return (HOOK_MANIFEST_HARNESSES as readonly HarnessId[]).includes(value);
}

/**
 * OpenCode is covered by the inline plugin (`opencode-plugin.ts`), not
 * by the generated `run-hook.mjs` dispatcher. We keep its semantic
 * coverage table here as an explicit descriptor, since it does not
 * flow through the hook manifest.
 */
const OPENCODE_SEMANTIC_COVERAGE: Partial<Record<HookSemanticEvent, string>> = {
  session_rehydrate: "plugin event handlers + transform rehydration",
  pre_tool_prompt_guard: "plugin tool.execute.before -> prompt-guard",
  pre_tool_workflow_guard: "plugin tool.execute.before -> workflow-guard",
  post_tool_context_monitor: "plugin tool.execute.after -> context-monitor",
  stop_checkpoint: "plugin session.idle -> stop-checkpoint",
  precompact_digest: "plugin session.compacted -> pre-compact"
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

void isManifestHarness;
