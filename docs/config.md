# `.cclaw/config.yaml` reference

`cclaw init` writes a **deliberately minimal** config. The defaults work
for almost every project. Every additional knob below is for users who
hit a specific need — you add the key, cclaw picks it up, `cclaw upgrade`
preserves it.

No CLI flag exists for most of these — that is intentional. The CLI is a
launcher, not a dashboard.

## What `cclaw init` writes

```yaml
version: 0.43.0
flowVersion: 1.0.0
harnesses:
  - codex
strictness: advisory
gitHookGuards: false
```

Five keys. If auto-detection found a Node / Python / Go project, a sixth
`languageRulePacks` line appears. That is the whole default surface.

Every other key in this document is **opt-in**: add it by hand only when
you know you want the behaviour it turns on.

## Minimal keys (always present)

### `version` and `flowVersion` (auto-managed)

cclaw CLI and flow-contract versions that generated this config.
Rewritten on every `cclaw upgrade`. Do not edit.

### `harnesses` (required, list)

Which harnesses receive generated shims and hooks.

| Value      | Harness                                                      |
|------------|--------------------------------------------------------------|
| `claude`   | Claude Code — full native subagent + hook support            |
| `cursor`   | Cursor IDE — partial subagent, full hooks                    |
| `opencode` | OpenCode — partial subagent, plugin hooks, `question` tool   |
| `codex`    | OpenAI Codex — no native subagent; experimental lifecycle hooks + `request_user_input` in Plan mode |

Re-run `npx cclaw-cli upgrade` after editing so shims and hooks line up
with the new list.

### `strictness` (`advisory` | `strict`, default `advisory`)

One knob that controls both guard families:

- `advisory` — prompt-guard and TDD violations are **logged** to
  `.cclaw/state/preamble-log.jsonl` and `stage-activity.jsonl` but do
  not block the agent.
- `strict` — violations **block** stage transitions until the agent
  corrects them.

Use `strict` on teams where agents tend to skip the preamble, skip RED
tests, or bypass stage gates. Most projects can stay on `advisory`.

Power-user note: if you need asymmetric strictness (for example, strict
prompt guard but advisory TDD during a migration), set the legacy keys
`promptGuardMode` and `tddEnforcement` directly — they override
`strictness` per-axis. See [Advanced overrides](#advanced-overrides).

### `gitHookGuards` (boolean, default `false`)

When `true`, `cclaw init` / `cclaw upgrade` installs managed
`pre-commit` and `pre-push` hooks under `.git/hooks/` that refuse
commits whose stage artifact still has unmet gates.

Opt-in because many teams prefer hook-free workflows or already manage
their git hooks via `husky` / `lefthook` / etc.

## Advanced overrides (opt-in)

Add any of these keys by hand when you need them. `cclaw upgrade`
preserves whatever you wrote; it never silently adds them back.

### `promptGuardMode`, `tddEnforcement` (`advisory` | `strict`)

Explicit per-axis overrides for the `strictness` knob. Useful when you
want, say, strict TDD during a red-green push but advisory prompt
guarding. When set, these values win over the derived `strictness`.

### `tddTestGlobs` (list of glob strings)

Globs the TDD workflow guard uses to detect whether a write targets a
test file. Defaults cover the common layouts — TS/JS `*.test.*`, `*.spec.*`,
`test/` directories — which matches Python/Go/Rust/Java too.

Override only for non-standard layouts:

```yaml
tddTestGlobs:
  - "src/**/__tests__/**"
  - "internal/**/testing_*.py"
```

### `defaultTrack` (`quick` | `medium` | `standard`, default `standard`)

Fallback track for new runs when the `/cc` classifier cannot infer a
track from the prompt. In practice `/cc` almost always picks a track
itself; only set this on teams that routinely run many quick-track
hotfixes.

| Track     | Critical path                                               |
|-----------|-------------------------------------------------------------|
| `standard`| all 8 stages (brainstorm → ship)                            |
| `medium`  | skips scope + design; starts at brainstorm                  |
| `quick`   | starts at spec with RED-first TDD; good for hotfixes/typos  |

### `languageRulePacks` (list of `typescript` | `python` | `go`)

Opt-in packs that preload language-specific review rules into the
reviewer subagent. `cclaw init` auto-detects the list from project
manifests (`package.json` with `typescript` in deps, `go.mod`,
`pyproject.toml` / `requirements.txt` / `setup.py` / `Pipfile`).

Override manually if you want a different set, or to disable packs:

```yaml
languageRulePacks: []       # disable everything
languageRulePacks:          # enable all three regardless of detection
  - typescript
  - python
  - go
```

### `trackHeuristics` (object, advisory)

Per-track vocabulary hints the LLM applies when classifying a `/cc`
prompt. cclaw surfaces these lists in the `/cc` skill prose — there is
no Node-level router that enforces them.

```yaml
trackHeuristics:
  fallback: standard
  tracks:
    quick:
      triggers: [hotfix, rollback, prod-incident]
      veto: [schema, migration]   # veto wins even when a trigger hits
    standard:
      triggers: [epic, platform-team, core-infra]
```

Evaluation order is fixed: `standard -> medium -> quick` (narrow-to-broad).
Removed in v0.38.0: regex `patterns` and the `priority` override, which
were never wired into the runtime.

### `sliceReview` (object, opt-in)

Per-slice review heuristic for the TDD stage. When enabled, the TDD
skill requires a `## Per-Slice Review` section in `06-tdd.md` for slices
that exceed `filesChangedThreshold` or match any `touchTriggers` glob.

```yaml
sliceReview:
  enabled: true
  filesChangedThreshold: 5
  touchTriggers:
    - "migrations/**"
    - "auth/**"
  enforceOnTracks: [standard]
```

All fields optional. Defaults (when `enabled: true`): threshold 5, no
touch triggers, `enforceOnTracks: [standard]`.

## Common recipes

### Single-harness minimal install

```yaml
harnesses: [claude]
```

### Enterprise repo — strict guards everywhere

```yaml
harnesses: [claude, cursor]
strictness: strict
gitHookGuards: true
languageRulePacks: [typescript, python]
```

### Hotfix-friendly classifier

```yaml
trackHeuristics:
  tracks:
    quick:
      triggers: [hotfix, patch, typo, rename, "fix:"]
```

### Strict TDD, advisory prompt guard

```yaml
strictness: advisory
tddEnforcement: strict
```

## Validation

`readConfig()` validates every key on every stage transition. Unknown
top-level keys and unknown harness/track/pack values throw with an
actionable error pointing at the exact key. Legacy fields removed in
v0.38.0 — `trackHeuristics.priority` and `trackHeuristics.tracks.*.patterns`
— also throw, with a migration hint.

A config parse error is fatal: the agent cannot advance until you fix
it and re-run `cclaw sync`.
