---
title: "cclaw v8 hook runtime"
status: locked
---

# Hook runtime — v8

cclaw v8 ships **three hooks** under `.cclaw/hooks/`. Default profile is `minimal`. Only `commit-helper.mjs` is mandatory (for AC traceability).

## `session-start.mjs`

- Wired to harness session lifecycle start/resume events.
- Reads `.cclaw/state/flow-state.json`, prints the active slug + stage, and reports AC committed / pending counts.
- Stops the session and surfaces operator choices when `schemaVersion: 1` is detected.

## `stop-handoff.mjs`

- Wired to harness session stop / idle events.
- Prints a one-line reminder when stopping with pending AC.
- Does **not** block git or stop the harness; it is purely advisory.

## `commit-helper.mjs`

- Mandatory. Used inside `/cc` build steps.
- Invocation: `node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="…"`.
- Validates that `AC-N` is declared in `flow-state.json`, checks that something is staged, runs `git commit`, captures the new SHA, and writes it back into the AC entry.
- Refuses to commit when `flow-state.json` is missing or `schemaVersion` is not `2`.

## Harness event surface

- Claude: `SessionStart`, `Stop`
- Cursor: `sessionStart`, `sessionResume`, `sessionClear`, `sessionCompact`, `stop`
- Codex: `SessionStart`, `Stop`
- OpenCode plugin bridge: lifecycle → `session-start.mjs`, idle → `stop-handoff.mjs`

## What was removed in v8

- `stage-complete.mjs` — there are no mandatory stage gates to fire.
- `delegation-record.mjs` — specialists are on demand; no four-event lifecycle.
- `flow-state-repair` / `verify-current-state` CLI helpers — removed.

If your team needs stricter local enforcement, set `hooks.profile: strict` in `.cclaw/config.yaml` (currently behaviour-equivalent to `minimal`; reserved for future use).
