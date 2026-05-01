# `.cclaw/config.yaml` reference

`cclaw init` writes a **deliberately minimal** config. The defaults work
for almost every project. Every additional knob below is for users who
hit a specific need — you add the key, cclaw picks it up, `cclaw upgrade`
preserves it.

No CLI flag exists for most of these — that is intentional. `cclaw-cli` is an installer/sync/support surface, not the day-to-day flow runtime.

For harness users: these knobs are typically managed by the agent on your behalf via natural-language requests (for example, "switch to minimal hooks"). Manual edits are still supported.

## What `cclaw init` writes

```yaml
version: ${CCLAW_VERSION}
flowVersion: 1.0.0
harnesses:
  - claude
  - cursor
  - opencode
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


| Value      | Harness                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------- |
| `claude`   | Claude Code — full native subagent + hook support                                                   |
| `cursor`   | Cursor IDE — partial subagent, full hooks                                                           |
| `opencode` | OpenCode — native generated subagents, plugin hooks, `question` tool                            |
| `codex`    | OpenAI Codex — native parallel subagents; experimental lifecycle hooks + `request_user_input` in Plan mode |


Re-run `npx cclaw-cli upgrade` after editing so shims and hooks line up
with the new list.

### `strictness` (`advisory` | `strict`, default `advisory`)

One knob that controls both guard families:

- `advisory` — prompt-guard and workflow/TDD violations are **logged** to
`.cclaw/state/prompt-guard.jsonl` and `.cclaw/state/workflow-guard.jsonl`
only when a guard actually fires; they do not block the agent.
- `strict` — violations **block** stage transitions until the agent
corrects them.

Codex note: because Codex hooks can hard-intercept only `Bash`, strict mode for
non-Bash edits is enforced at stage-closeout and via a `verify-current-state`
check on `UserPromptSubmit` (strict blocks, advisory logs).

Use `strict` on teams where agents tend to skip the preamble, skip RED
tests, or bypass stage gates. Most projects can stay on `advisory`.

Per-law escape: if you need **one specific iron law** to always block
while the rest of the pipeline stays advisory, list its id under
`ironLaws.strictLaws`. There is no longer a per-axis (prompt-vs-TDD)
override — the single `strictness` knob drives all guard families.

### `hookProfile` (`minimal` | `standard` | `strict`, default `standard`)

Controls how much of the hook surface is active at runtime:

- `minimal` — only `session-start` and `stop-handoff` handlers run (plus internal `session-start-refresh` worker calls).
- `standard` — default full hook surface.
- `strict` — full hook surface, and hook guards behave as strict even if `strictness` is advisory.

Runtime override (CI / emergency toggles):

- `CCLAW_HOOK_PROFILE=minimal|standard|strict`

`CCLAW_HOOK_PROFILE` overrides `hookProfile` from config.

### `disabledHooks` (list of hook handler ids)

Optional per-hook denylist applied after profile selection. Supported ids:

- `session-start`
- `session-start-refresh`
- `stop-handoff`
- `prompt-guard`
- `workflow-guard`
- `pre-tool-pipeline`
- `prompt-pipeline`
- `context-monitor`
- `verify-current-state`

Example:

```yaml
hookProfile: standard
disabledHooks:
  - context-monitor
```

Runtime override:

- `CCLAW_DISABLED_HOOKS=hook1,hook2,...`

When set, `CCLAW_DISABLED_HOOKS` overrides `disabledHooks` from config.

### `gitHookGuards` (boolean, default `false`)

When `true`, `cclaw init` / `cclaw upgrade` installs managed
`pre-commit` and `pre-push` hooks under `.git/hooks/` that refuse
commits whose stage artifact still has unmet gates.

Opt-in because many teams prefer hook-free workflows or already manage
their git hooks via `husky` / `lefthook` / etc.

### Knowledge capture (always-on, no config key)

Continuous knowledge capture does **not** require a config knob:

- Every stage artifact template includes `## Learnings`.
- Use either `- None this stage.` or JSON bullets (`type`, `trigger`,
`action`, `confidence`, optional schema fields).
- `node .cclaw/hooks/stage-complete.mjs <stage>` validates and harvests those
bullets into `.cclaw/knowledge.jsonl` with dedupe + schema checks. This helper is generated by `cclaw-cli` and must work without a runtime `cclaw` binary in `PATH`.

If you need manual operations, ask your harness to use the `learnings` skill
for search, add/backfill, or curation.

## Advanced overrides (opt-in)

Add any of these keys by hand when you need them. `cclaw upgrade`
preserves whatever you wrote; it never silently adds them back.

### Removed in this release: `promptGuardMode`, `tddEnforcement`, `workflowGuardMode`, `ironLaws.mode`

The three per-axis guard-mode knobs and `ironLaws.mode` were collapsed into
the single project-wide `strictness` field. If your config still sets any
of them, `readConfig` throws with a migration hint. Use `strictness: strict`
for project-wide strict enforcement, or `ironLaws.strictLaws: [<law-id>,...]`
for per-law escapes.

### `tdd` (object)

Path-pattern routing for real-time TDD guard classification:

- `testPathPatterns` — files counted as test-side writes (RED work).
- `productionPathPatterns` — optional allowlist for production writes that
should be blocked when RED is missing.

Default `testPathPatterns`:

```yaml
tdd:
  testPathPatterns:
    - "**/*.test.*"
    - "**/tests/**"
    - "**/__tests__/**"
```

Example with explicit production allowlist:

```yaml
tdd:
  testPathPatterns:
    - "**/*.unit.ts"
  productionPathPatterns:
    - "src/**"
    - "packages/**/src/**"
```

Legacy compatibility: top-level `tddTestGlobs` is still read, but new configs
should prefer `tdd.testPathPatterns`.

### `compound` (object)

Compound-stage clustering policy.

- `recurrenceThreshold` (positive integer, default `3`) — base minimum repeat
count for trigger/action clusters before lift candidates are proposed.

Runtime tuning applied everywhere compound readiness is computed (`cclaw internal compound-readiness` and the session-start hook that writes derived readiness status when needed):

- For repositories with `< 5` archived runs under `.cclaw/archive/`, the
effective threshold is temporarily lowered to
`min(recurrenceThreshold, 2)` and `smallProjectRelaxationApplied` is
set to `true` in the derived status.
- Any cluster containing a `severity: critical` knowledge entry is
eligible even at recurrence `1` (critical override, reported as
`qualification: "critical_override"`).
- After changing `recurrenceThreshold` in `.cclaw/config.yaml`, re-run
`npx cclaw-cli sync` so the hook picks up the new default (the CLI reads
the live config on every invocation).

```yaml
compound:
  recurrenceThreshold: 4
```

### `defaultTrack` (`quick` | `medium` | `standard`, default `standard`)

Fallback track for new runs when the `/cc` classifier cannot infer a
track from the prompt. In practice `/cc` almost always picks a track
itself; only set this on teams that routinely run many quick-track
hotfixes.


| Track      | Critical path                                              |
| ---------- | ---------------------------------------------------------- |
| `standard` | all 8 stages (brainstorm → ship)                           |
| `medium`   | skips scope + design; starts at brainstorm                 |
| `quick`    | starts at spec with RED-first TDD; good for hotfixes/typos |


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

### `optInAudits` (object, opt-in)

Additional strict artifact audits that stay disabled until explicitly enabled.

```yaml
optInAudits:
  scopePreAudit: true
  staleDiagramAudit: true
```

- `scopePreAudit` — when true, scope lint requires a filled
  `## Pre-Scope System Audit` section with evidence for:
  `git log -30 --oneline`, `git diff --stat`, `git stash list`, and a debt scan
  (`TODO|FIXME|XXX|HACK`).
- `staleDiagramAudit` — when true, design lint compares blast-radius files
  listed under `## Codebase Investigation` against the current design artifact's
  diagram baseline and fails when code changed after the diagrams were last updated.

### `reviewLoop` (object, opt-in)

Outside-voice review-loop tuning. Keep disabled unless you explicitly want a
second model/opinion in scope/design review loops.

```yaml
reviewLoop:
  externalSecondOpinion:
    enabled: true
    model: "external-reviewer"
    scoreDeltaThreshold: 0.2
```

- `externalSecondOpinion.enabled` — when true, review-loop integrations may run
  a second independent pass and reconcile differences.
- `externalSecondOpinion.model` — optional label included in review metadata.
- `externalSecondOpinion.scoreDeltaThreshold` — disagreement threshold (0..1)
  at which the loop surfaces an explicit "cross-model disagreement" finding.

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

### Strict on a single iron law, advisory elsewhere

```yaml
strictness: advisory
ironLaws:
  strictLaws: [tdd-red-before-write]
```

## Lifecycle preservation

`init`, `sync`, `upgrade`, and `uninstall` intentionally treat runtime data differently. This is the contract surface for what cclaw preserves versus regenerates.

| Operation | Preserved | Regenerated / rewritten | Removed / cleaned |
|---|---|---|---|
| `npx cclaw-cli init` | user repo files outside managed cclaw surfaces; custom assets under `.cclaw/agents` and `.cclaw/skills` | minimal `.cclaw/config.yaml`, commands, skills, templates, hooks, state scaffolding, harness shims, managed-resources manifest | legacy runtime folders/files and stale generated shim files |
| `npx cclaw-cli sync` | existing `flow-state`/artifacts/knowledge, existing config advanced keys | generated runtime files from current config, harness shims, hook wiring, managed-resources manifest | obsolete generated files from disabled harnesses + known legacy artifacts |
| `npx cclaw-cli upgrade` | same as sync + existing config shape (advanced keys stay), active run state | rewrites `version` + `flowVersion` in config and refreshes generated runtime from installed CLI version | legacy generated surfaces; stale managed files |
| `npx cclaw-cli uninstall` | user source code / git history / non-cclaw files | none | `.cclaw/` runtime + generated harness shims/hooks/rules/plugins and cclaw-managed skill aliases |

Backup semantics for managed generated files:
- On `sync`, changed managed files that diverged from prior manifest entries are backed up under `.cclaw/state/sync-backups/<timestamp>/...`.
- On `upgrade`, equivalent backups go under `.cclaw/state/upgrade-backups/<timestamp>/...`.
- Backups are best-effort protection for generated surfaces; they are not a replacement for git history.

Write-boundary reminder:
- Runtime state and artifacts are owned by the flow helpers.
- Manual edits to generated files may be overwritten by the next `sync`/`upgrade` unless intentionally kept outside managed surfaces.

## Validation

`readConfig()` validates every key on every stage transition. Unknown
top-level keys and unknown harness/track/pack values throw with an
actionable error pointing at the exact key. Legacy fields removed in
v0.38.0 — `trackHeuristics.priority` and `trackHeuristics.tracks.*.patterns`
— also throw, with a migration hint.

A config parse error is fatal: the agent cannot advance until you fix
it and re-run `npx cclaw-cli sync`.