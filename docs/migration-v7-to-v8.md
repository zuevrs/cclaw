---
title: "Migration guide — cclaw 7.x to 8.0"
status: locked
---

# cclaw 7.x → 8.0 migration

cclaw 8.0 is a breaking redesign. There is no automatic migration. This guide describes the manual steps a project should take, and the maintainer release tasks.

## What does not migrate

- Active 7.x runs in `.cclaw/state/flow-state.json`. The `/cc` orchestrator refuses `schemaVersion: 1` and asks the user to finish, abandon, or replace.
- The `archive/<date>-<slug>-shipped/` layout. v8 uses `shipped/<slug>/` and never copies state.
- 7.x state files: `delegation-events.jsonl`, `delegation-log.json`, `managed-resources.json`, `early-loop.json`, `early-loop-log.jsonl`, `subagents.json`, `compound-readiness.json`, `tdd-cycle-log.jsonl`, `iron-laws.json`, `.linter-findings.json`, `.flow-state.guard.json`, `.waivers.json`.
- 14 of 18 specialists. The mapping is in [`docs/v8-vision.md`](v8-vision.md#specialists-6-all-on-demand). If your project hard-coded `feasibility-reviewer`, `coherence-reviewer`, or similar, replace those references with the appropriate `architect` or `reviewer` mode.
- The 7.x slash commands `/cc-amend` and `/cc-compound`. Refinement and learning capture both live inside `/cc` now.

## Project-side steps

```bash
# 1) update the toolkit
npx cclaw-cli@8.0.0 sync

# 2) decide what to do with the old run, if any
#    - finish or abandon it with cclaw 7.x first, OR
#    - delete the old runtime state to start fresh on v8
rm -f .cclaw/state/flow-state.json

# 3) optional: rename or remove the legacy archive directory
git mv .cclaw/archive .cclaw/archive-v7-legacy   # or rm -rf
```

After this, `/cc` works as documented in [README.md](../README.md).

## What you can keep

- `.cclaw/plans/`, `.cclaw/builds/`, `.cclaw/reviews/`, `.cclaw/ships/`, `.cclaw/decisions/`, `.cclaw/learnings/` — v8 reads markdown bodies. Frontmatter is enriched by the new orchestrator on first touch (you may also pre-populate the v8 frontmatter manually using the spec in `docs/v8-vision.md`).
- `.cclaw/shipped/<slug>/` from any v8 ship.
- `.cclaw/knowledge.jsonl` — the format is forward-compatible.

## Behavioural changes you will feel

| Area | 7.x behaviour | 8.0 behaviour |
| --- | --- | --- |
| Discovery | Mandatory `brainstorm` / `scope` / `design` per task | Optional, only proposed for large/risky tasks |
| Reviews | Five separate reviewers in parallel | Single `reviewer` with multi-mode prompts |
| Specialists | 18 dispatched proactively | 6 invoked on demand only |
| Hooks | 5 mandatory by default | 1 mandatory (`commit-helper.mjs`) |
| Refinement | `/cc-amend` opened a new run | `/cc` detects existing plan and asks amend / rewrite / new |
| Learnings | Captured for every shipped run | Captured only when quality gate passes |
| Archive | `archive/<date>-<slug>-shipped/` with state snapshots | `shipped/<slug>/` with artifacts only |
| State files | 9 | 1 (`flow-state.json` ~500 bytes) |
| CLI | `cclaw advance`, `cclaw verify-current-state`, ... | Installer-only: `init / sync / upgrade / uninstall / version / help` |

## Maintainer release tasks (intentionally manual)

```bash
# from a clean checkout of feat/v8-core
git checkout feat/v8-core
npm run release:check     # build + test + plugin manifests + smoke

# publish
npm publish

# deprecate <8.0.0 with a community-friendly message
npm deprecate cclaw-cli@"<8.0.0" "8.0 is a breaking redesign. See docs/migration-v7-to-v8.md."

# tag and push
git tag v8.0.0 -m "cclaw v8.0.0"
git push origin feat/v8-core --tags

# (optional) open a GitHub release using docs/v8-vision.md as body
```

Do **not** run `npm unpublish` — existing installs should keep working with the deprecation warning, per the lock-in decision in `docs/v8-vision.md`.
