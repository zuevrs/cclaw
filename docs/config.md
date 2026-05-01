# `.cclaw/config.yaml`

Wave 21 (`3.0.0`) is harness-only.

## What users can set

Only one user-facing key remains:

- `harnesses`: which harness shims/hooks cclaw materializes.

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
```

## Removed in 3.0.0

These keys are no longer supported: `strictness`, `hookProfile`, `disabledHooks`, `gitHookGuards`, `vcs`, `tdd`, `tddTestGlobs`, `compound`, `earlyLoop`, `defaultTrack`, `languageRulePacks`, `trackHeuristics`, `sliceReview`, `ironLaws`, `optInAudits`, `reviewLoop`.

If any removed key is present, config parsing fails with:

`key X is no longer supported in cclaw 3.0.0; see CHANGELOG.md`

## After editing harnesses

Run:

`npx cclaw-cli sync`

so generated hook documents and harness shims match the new harness set.
