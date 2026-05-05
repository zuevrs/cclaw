# Hook Runtime

cclaw now materializes only two runtime hook handlers per harness.

## `session-start`

- Triggered on harness session lifecycle start/resume events.
- Rehydrates flow context (`stage`, `run`, completed stages).
- Injects knowledge digest + stage support context into startup prompt context.

## `stop-handoff`

- Triggered on stop/idle session events.
- Emits handoff reminder with current stage/run context.
- Blocks dirty git tree on stop, with safety carryovers:
  - bypass when `stop_hook_active`, `user_abort`, or `context_limit` is signaled
  - max 2 hard blocks per transcript key, then advisory-only reminder

## Harness event surface

- Claude: `SessionStart`, `Stop`
- Cursor: `sessionStart`, `sessionResume`, `sessionClear`, `sessionCompact`, `stop`
- Codex: `SessionStart`, `Stop`
- OpenCode plugin bridge: session lifecycle -> `session-start`, idle -> `stop-handoff`
