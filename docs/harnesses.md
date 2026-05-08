# cclaw v8 — supported harnesses

Generated from src/install.ts. Run `npm run build:harness-docs` to regenerate.

| Harness | Commands dir | Agents dir | Hooks config |
| --- | --- | --- | --- |
| claude | .claude/commands | .claude/agents | .claude/hooks/hooks.json |
| cursor | .cursor/commands | .cursor/agents | .cursor/hooks.json |
| opencode | .opencode/commands | .opencode/agents | .opencode/plugins/cclaw-plugin.mjs |
| codex | .codex/commands | .codex/agents | .codex/hooks.json |

Each harness receives:
- `cc.md`, `cc-cancel.md`, `cc-idea.md` slash command files
- one markdown file per specialist in `<agents-dir>/` (brainstormer / architect / planner / reviewer / security-reviewer / slice-builder)
- a hooks config (claude/cursor/codex) or a plugin module (opencode) wiring `session.start` and `session.stop` to `.cclaw/hooks/*.mjs`.

The runtime hooks themselves (`session-start.mjs`, `stop-handoff.mjs`, `commit-helper.mjs`) live under `.cclaw/hooks/` and are shared across harnesses.
