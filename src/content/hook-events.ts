import type { HarnessId } from "../types.js";

export const HOOK_SEMANTIC_EVENTS = [
  "session_rehydrate",
  "pre_tool_prompt_guard",
  "pre_tool_workflow_guard",
  "post_tool_context_monitor",
  "stop_checkpoint",
  "precompact_digest"
] as const;

export type HookSemanticEvent = (typeof HOOK_SEMANTIC_EVENTS)[number];

export const HOOK_EVENTS_BY_HARNESS: Record<
  HarnessId,
  Partial<Record<HookSemanticEvent, string>>
> = {
  claude: {
    session_rehydrate: "SessionStart matcher startup|resume|clear|compact",
    pre_tool_prompt_guard: "PreToolUse -> prompt-guard.sh",
    pre_tool_workflow_guard: "PreToolUse -> workflow-guard.sh",
    post_tool_context_monitor: "PostToolUse -> context-monitor.sh",
    stop_checkpoint: "Stop -> stop-checkpoint.sh",
    precompact_digest: "PreCompact -> pre-compact.sh"
  },
  cursor: {
    session_rehydrate: "sessionStart/sessionResume/sessionClear/sessionCompact",
    pre_tool_prompt_guard: "preToolUse -> prompt-guard.sh",
    pre_tool_workflow_guard: "preToolUse -> workflow-guard.sh",
    post_tool_context_monitor: "postToolUse -> context-monitor.sh",
    stop_checkpoint: "stop -> stop-checkpoint.sh",
    precompact_digest: "sessionCompact -> pre-compact.sh"
  },
  opencode: {
    session_rehydrate: "plugin event handlers + transform rehydration",
    pre_tool_prompt_guard: "plugin tool.execute.before -> prompt-guard.sh",
    pre_tool_workflow_guard: "plugin tool.execute.before -> workflow-guard.sh",
    post_tool_context_monitor: "plugin tool.execute.after -> context-monitor.sh",
    stop_checkpoint: "plugin session.idle -> stop-checkpoint.sh",
    precompact_digest: "plugin session.compacted -> pre-compact.sh"
  },
  codex: {
    // Codex CLI v0.114+ exposes lifecycle hooks via `.codex/hooks.json`,
    // gated by `[features] codex_hooks = true` in `~/.codex/config.toml`.
    // SessionStart, Stop, and UserPromptSubmit fire for every turn;
    // PreToolUse/PostToolUse are **Bash-only** (Write/Edit/WebSearch/MCP
    // calls do not trigger them). `precompact_digest` is unmapped —
    // Codex has no PreCompact event; cclaw covers it via `/cc-ops retro`.
    session_rehydrate: "SessionStart matcher startup|resume",
    pre_tool_prompt_guard: "PreToolUse matcher Bash -> prompt-guard.sh (plus UserPromptSubmit for non-Bash prompts)",
    pre_tool_workflow_guard: "PreToolUse matcher Bash -> workflow-guard.sh (Bash-only)",
    post_tool_context_monitor: "PostToolUse matcher Bash -> context-monitor.sh (Bash-only)",
    stop_checkpoint: "Stop -> stop-checkpoint.sh"
  }
};

