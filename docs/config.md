# `.cclaw/config.yaml`

Config is mostly managed by cclaw. Users normally edit harnesses and, when needed, the TDD execution policy.

## What users can set

User-facing keys:

- `harnesses`: which harness shims/hooks cclaw materializes.
- `execution.topology`: `auto` (default), `inline`, `single-builder`, `parallel-builders`, or `strict-micro`.
- `execution.strictness`: `fast`, `balanced` (default), or `strict`.
- `execution.maxBuilders`: maximum simultaneous slice-builder workers when topology is `parallel-builders` (default `5`).
- `plan.sliceGranularity`: `feature-atomic` (default) or `strict-micro`.
- `plan.microTaskPolicy`: `advisory` (default) or `strict`.
- `tdd.lockfileTwinPolicy`: `auto-include` (default), `auto-revert`, or `strict-fence`.

## What cclaw manages automatically

- `version`: CLI version that wrote the config.
- `flowVersion`: flow-contract version.

`cclaw init` / `sync` / `upgrade` always keep this minimal shape:

```yaml
version: 3.0.0
flowVersion: 1.0.0
harnesses:
  - claude
  - cursor
  - opencode
  - codex
tdd:
  commitMode: managed-per-slice
  isolationMode: worktree
  worktreeRoot: .cclaw/worktrees
  lockfileTwinPolicy: auto-include
execution:
  topology: auto
  strictness: balanced
  maxBuilders: 5
plan:
  sliceGranularity: feature-atomic
  microTaskPolicy: advisory
```

`execution.topology: auto` + `execution.strictness: balanced` means cclaw treats feature-atomic implementation units as the schedulable surface, with internal 2-5 minute TDD steps. Use `execution.topology: strict-micro`, `execution.strictness: strict`, or `plan.microTaskPolicy: strict` when high-risk work should preserve the older one-tiny-task-per-slice discipline.

## Removed in 3.0.0

These keys are no longer supported at top level: `strictness`, `hookProfile`, `disabledHooks`, `gitHookGuards`, `vcs`, `tddTestGlobs`, `compound`, `earlyLoop`, `defaultTrack`, `languageRulePacks`, `trackHeuristics`, `sliceReview`, `ironLaws`, `optInAudits`, `reviewLoop`.

If any removed key is present, config parsing fails with:

`key X is no longer supported in cclaw 3.0.0; see CHANGELOG.md`

## After editing harnesses

Run:

`npx cclaw-cli sync`

so generated hook documents and harness shims match the new harness set.
