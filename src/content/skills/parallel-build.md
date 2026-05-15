---
name: parallel-build
trigger: when ac-author topology = parallel-build
---

# Skill: parallel-build

`parallel-build` is the only parallelism allowed during build. It is opt-in. The orchestrator never picks it without ac-author naming it explicitly in `flows/<slug>/plan.md` Topology section.

## When to use

Triggered when ac-author topology in `plan.md` reads `parallel-build`. Pre-conditions in the next section gate eligibility (≥4 AC, ≥2 disjoint touchSurface clusters, every AC `parallelSafe: true`, no in-wave dependencies). On large-risky slugs with `triage.downgradeReason == "no-git"` the orchestrator suppresses parallel dispatch even when topology says parallel-build, because `git worktree` is unavailable without `.git/`. See `runbooks/parallel-build.md` for the full dispatch envelope.

## When NOT to apply

- **`triage.ceremonyMode != "strict"`.** Soft and inline AC have no per-criterion commit chain to parallelise — single-cycle sequential build is the only shape.
- **Fewer than 4 AC**, or fewer than 2 disjoint touchSurface clusters. Worktree + sub-agent overhead beats wall-clock savings under that threshold; the orchestrator picks inline-sequential.
- **Any AC without `parallelSafe: true`** in the plan's topology block. The flag is opt-in; missing or `false` means the AC depends on outputs of another AC and cannot run in isolation.
- **`triage.downgradeReason == "no-git"`.** `git worktree add` requires `.git/`. The orchestrator silently degrades to inline-sequential and records the fallback.
- **Harness lacks sub-agent dispatch.** Single-context harnesses fall back to inline-sequential — the worktree overhead is paid without the parallel-execution win.
- **The slug already produced >5 candidate slices after merging.** That is a "split the slug" signal; do not generate `wave 2` / `wave 3` / cascading waves.

## Pre-conditions (all must hold)

1. **≥4 AC** in the plan.
2. **≥2 distinct touchSurface clusters** — there is at least one pair of AC whose `touchSurface` arrays are completely disjoint.
3. Every AC in a parallel wave carries `parallelSafe: true`.
4. No AC depends on outputs of another AC in the same wave.

For ≤4 AC the orchestrator picks `inline` even when AC look "parallelSafe". The git-worktree + sub-agent dispatch overhead is not worth saving 1-2 AC of wall-clock.

## Slice = 1+ AC with shared touchSurface

A **slice** is one or more AC whose `touchSurface` arrays intersect. AC with disjoint touchSurfaces go into different slices; AC with overlapping touchSurfaces stay in the **same** slice (run sequentially inside it). Each slice is owned by exactly one slice-builder sub-agent.

## Hard cap: 5 parallel slices per wave

If the slug produces more than 5 slices, **merge the thinner slices into fatter ones** (group AC by adjacent files / shared module) until you have ≤5. **Do not generate "wave 2", "wave 3", etc.** If after merging you still have >5 slices, the slug is too large — split it into multiple slugs.

This 5-slice cap is intentional:

- orchestration cost grows non-linearly past 5 sub-agents (context shuffling, integration review, conflict surface);
- 5 fits comfortably under the harness sub-agent quota everywhere we tested (Claude Code, Cursor, OpenCode, Codex);
- larger fan-outs reliably produce more integration findings than wall-clock saved.

## Execution

1. Orchestrator reads `flows/<slug>/plan.md` Topology section, extracts the slice list (max 5).
2. For each slice, dispatch one `slice-builder` sub-agent. Pass:
   - the slice id,
   - the AC ids it owns,
   - the slice's `touchSurface` (the only paths the slice may modify),
   - the worktree path (see below).
3. Each slice-builder runs the full TDD cycle (RED → GREEN → REFACTOR) for every AC it owns, sequentially inside the slice, in its own working tree.
4. After all slice-builders return, the orchestrator invokes `reviewer` in mode `integration` (separate sub-agent if the harness supports it; inline otherwise). Integration reviewer checks path conflicts, double-edits, the AC↔commit chain across all slices, and integration tests covering the slice boundary.
5. If integration finds problems, the orchestrator dispatches `slice-builder` in `fix-only` mode against the cited file:line refs.

## Git-worktree pattern (when harness supports sub-agent dispatch)

Each parallel slice runs in its own `git worktree` rooted at `.cclaw/worktrees/<slug>-<slice-id>/`:

```bash
$ git worktree add .cclaw/worktrees/<slug>-slice-1 -b cclaw/<slug>/slice-1
$ git worktree add .cclaw/worktrees/<slug>-slice-2 -b cclaw/<slug>/slice-2
$ git worktree add .cclaw/worktrees/<slug>-slice-3 -b cclaw/<slug>/slice-3
```

Each slice-builder sub-agent runs with its worktree path as cwd. After all slices finish:

1. Integration reviewer reads from each worktree's branch.
2. The orchestrator merges `cclaw/<slug>/slice-N` into the main branch one slice at a time (or fast-forward if the wave was clean).
3. `git worktree remove .cclaw/worktrees/<slug>-slice-N` per slice; the cclaw branches stay until ship.

## Fallback: inline-sequential when sub-agent dispatch is unavailable

If the harness does not support sub-agent dispatch (or worktree creation fails — non-git repo, permission denied, etc.), `parallel-build` **degrades silently to `inline`** and runs all slices sequentially in the main working tree. The orchestrator records the fallback in `flows/<slug>/build.md`:

```markdown
> Topology was `parallel-build` but the harness does not support sub-agent dispatch (or worktree creation failed). Slices ran sequentially in the main working tree.
```

This degradation is not an error and does not reduce review depth.

## Hard rules

- `integration` mode reviewer is mandatory after every parallel wave. No shortcut.
- Slice-builders never read each other's worktrees mid-flight.
- A slice-builder that detects a conflict with another slice stops and raises an integration finding instead of hand-merging.
- More than 5 parallel slices is forbidden. Merge or split.
