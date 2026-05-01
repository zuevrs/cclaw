# Hook Runtime Notes

This file documents runtime hook behavior that is specific to harness execution.

## Hook profile gating

Generated `run-hook.mjs` resolves hook execution in this order:

1. `CCLAW_HOOK_PROFILE` / `CCLAW_DISABLED_HOOKS` env vars (highest priority)
2. `.cclaw/config.yaml` keys `hookProfile` / `disabledHooks`
3. Built-in defaults (`standard`, empty disabled list)

Profiles:

- `minimal`: only `session-start`, `session-start-refresh`, and `stop-handoff`
- `standard`: full hook surface
- `strict`: full hook surface + strict guard behavior

## Stop-handoff safety rules

The stop hook never hard-blocks when any safety signal is present:

- `stop_hook_active=true`
- user-abort/cancel signal
- `context_limit` signal

Additionally, strict dirty-tree stop blocks are capped at 2 per transcript key;
after that, stop-handoff degrades to advisory mode for the rest of that transcript.
