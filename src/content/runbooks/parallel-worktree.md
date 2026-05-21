# Parallel worktree dispatch (v8.111+)

Worked example for the v8.73 topological-layer dispatch: how the parent builder uses `createSliceWorktree` / `mergeSliceWorktree` / `cleanupSliceWorktree` against a layer of ≥2 independent slices. Lifted out of `agents/builder.md` in v8.111 to free in-prompt budget; the in-prompt anchor is 8 lines naming the three helpers + the dispatch contract.

## Worked example — three-slice flow with one parallel layer (v8.73 worktree-isolated)

Slice table (from `plan.md > ## Plan / Slices`):

| SL | dependsOn | Surface |
| --- | --- | --- |
| SL-1 | — | src/lib/auth.ts, tests/unit/auth.test.ts |
| SL-2 | — | src/lib/clock.ts, tests/unit/clock.test.ts |
| SL-3 | SL-1, SL-2 | src/server/handler.ts, tests/integration/handler.test.ts |

`topologicalLayers()` returns `[[SL-1, SL-2], [SL-3]]`.

- **Layer 1** (size 2 → parallel, worktree-isolated): parent calls `createSliceWorktree` twice → `../cclaw-myslug-SL-1` (branch `cclaw/myslug-SL-1`) + `../cclaw-myslug-SL-2` (branch `cclaw/myslug-SL-2`). Dispatches sub-builders for SL-1 + SL-2 in a single Task batch, each with its `worktreePath` in the envelope. Both sub-builders `cd` into their own worktree, run RED → GREEN → REFACTOR, commit with `(SL-1)` / `(SL-2)` prefixes on the disposable branch, and return their slim summaries. The parent inspects both `self_review` blocks, then fast-forward merges `cclaw/myslug-SL-1` into `HEAD` (CI gate: typecheck + tests pass) → fast-forward merges `cclaw/myslug-SL-2` (CI gate: typecheck + tests pass).
- **Layer 2** (size 1 → inline): parent runs SL-3's TDD cycle directly in the parent tree (it depends on SL-1's auth helper and SL-2's clock, both already on disk after the layer 1 fast-forwards). Commit chain `red(SL-3)` → `green(SL-3)` → `refactor(SL-3)`.
- **AC pass** (sequential, parent tree): for each AC in `## Acceptance Criteria (verification)`, emit one `verify(AC-N): passing` commit per the existing AC pass procedure.

Wall-clock: `max(time(SL-1), time(SL-2)) + time(CI gate ×2) + time(SL-3) + time(AC pass)`. The two CI-gate runs are sequential because they share the parent tree, but they are short (typecheck + test suite, not a full rebuild) and the parallel RED→GREEN→REFACTOR wins still dominate the savings.

Worktree cleanup runs at slug ship (compound layer calls `cleanupSliceWorktreeAsync` per stamped `worktreePath` before moving artifacts) or at `/cc-cancel` (cancel layer same hook). Neither path runs during the build itself; the worktrees stay on disk for inspection.

## When the in-prompt anchor refers here

The builder's prompt body retains the three helpers + the dispatch contract (parent owns the merge; sub-builders never recurse; CI gate per fast-forward). The 41-line worked example above lives here so the in-prompt budget doesn't pay for it twice on every builder dispatch.
