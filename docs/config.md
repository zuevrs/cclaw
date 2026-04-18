# `.cclaw/config.yaml` reference

`cclaw init` writes a minimal config. Every power-user knob lives here.
Edit the file by hand and run `npx cclaw-cli upgrade` to regenerate
harness shims; your config values are preserved.

No CLI flag exists for most of these — that is intentional. The CLI is
a launcher, not a dashboard.

## Example

```yaml
version: 0.31.0
flowVersion: 2024-10-01
harnesses:
  - claude
  - cursor
promptGuardMode: advisory
tddEnforcement: advisory
tddTestGlobs:
  - "**/*.test.*"
  - "**/*.spec.*"
  - "**/test/**"
gitHookGuards: false
defaultTrack: standard
languageRulePacks: []
trackHeuristics:
  fallback: standard
  priority: [quick, medium, standard]
  tracks:
    quick:
      triggers: [hotfix, typo, rename]
      patterns: ["^fix:\\s"]
      veto: [migration, refactor]
```

## Keys

### `version` (string, auto-managed)

cclaw CLI version that generated this config. Rewritten on every
`cclaw upgrade`. Do not edit manually — it is informational.

### `flowVersion` (string, auto-managed)

Flow-contract version. Used by the session-start hook to detect
flow-schema migrations. Do not edit.

### `harnesses` (list, default: all four)

Which harnesses receive generated shims and hooks.

- `claude` — Claude Code (full native subagent + hook support).
- `cursor` — Cursor IDE (partial subagent, full hooks).
- `opencode` — OpenCode (partial subagent, plugin hooks).
- `codex` — OpenAI Codex (no native subagent dispatch).

Re-run `npx cclaw-cli upgrade` after editing to sync the command dirs.

### `promptGuardMode` ("advisory" | "strict", default: "advisory")

- `advisory` — prompt-guard violations are logged to
  `.cclaw/state/preamble-log.jsonl` but do not block the agent.
- `strict` — violations block stage transitions; the agent must
  correct them before `/cc-next` will advance.

Use `strict` on teams where agents tend to skip the preamble.

### `tddEnforcement` ("advisory" | "strict", default: "advisory")

- `advisory` — TDD stage passes even if no test-run evidence is
  captured (still strongly recommended).
- `strict` — TDD gate blocks until a red→green evidence cycle is
  logged in the stage activity stream.

### `tddTestGlobs` (list of glob strings, default: common test paths)

Globs the TDD stage uses to locate test files when synthesising the
red-run command. Extend for non-standard layouts (e.g.
`"src/**/__tests__/**"`).

### `gitHookGuards` (boolean, default: false)

When `true`, `cclaw upgrade` writes managed pre-commit and pre-push
hooks under `.git/hooks/` that refuse commits containing a stage
artifact with unmet gates. Opt-in because many teams prefer hook-free
workflows.

### `defaultTrack` ("quick" | "medium" | "standard", default: "standard")

Default flow track for new runs when the classifier cannot infer a
track from the prompt.

- `standard` — all eight stages (brainstorm → ship).
- `medium` — skips brainstorm+scope, starts at design.
- `quick` — starts at spec with a TDD-first contract (good for
  hotfixes, trivial edits, bug repros).

### `languageRulePacks` (list of strings, default: [])

Opt-in packs that preload language-specific review rules into the
reviewer subagent. Supported values: `typescript`, `python`, `go`.
Leave empty for language-agnostic installs.

### `trackHeuristics` (object, optional)

Override the classifier that picks a track from the user's prompt.

- `fallback` — track used when no rule matches.
- `priority` — order in which tracks are evaluated.
- `tracks.<track>.triggers` — bag-of-words trigger list (case-insensitive).
- `tracks.<track>.patterns` — list of regex patterns (evaluated with
  `iu` flags). Invalid regex throws at `readConfig()` time.
- `tracks.<track>.veto` — if any veto word appears in the prompt, this
  track is skipped even if triggers/patterns match.

## Common recipes

### Single-harness minimal install

```yaml
harnesses: [claude]
defaultTrack: medium
```

### Strict-everything for an enterprise repo

```yaml
promptGuardMode: strict
tddEnforcement: strict
gitHookGuards: true
languageRulePacks: [typescript]
```

### Hotfix-friendly classifier

```yaml
trackHeuristics:
  fallback: standard
  priority: [quick, medium, standard]
  tracks:
    quick:
      triggers: [hotfix, patch, typo, rename]
      patterns: ["^fix:\\s"]
```

## Validation

`readConfig()` validates every key on every stage transition. Unknown
top-level keys, unknown harness/track/pack values, and invalid regex
patterns all throw with an actionable error pointing at the exact key.
A config parse error is fatal — the agent cannot advance until it is
fixed.
