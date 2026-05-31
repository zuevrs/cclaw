# On-demand runbook — parallel-review fan-out (size-gated)

The orchestrator opens this runbook from the review stage (`REVIEW_PLAYBOOK` §1a) **only when the size gate below fires**. On the common path — small / medium diffs — review stays a single sequential `reviewer` `code` dispatch. Do not fan out.

## Why size-gated (read first)

Parallel review costs N reviewer dispatches + one merge + one integration sweep. On a small diff that is pure overhead: a single reviewer is faster wall-clock **and** cheaper in tokens. Fan-out only pays off when the diff is large enough that one reviewer is slow and prone to context-loss across unrelated surfaces. The gate keeps the common path invisible and cheap; the user only ever pays for parallel review when it actually saves time. This is the same opt-in posture as `parallel-build`: never the default, only on a clear signal.

## Size gate (ALL four must hold — else single sequential reviewer)

1. **`triage.ceremonyMode == "strict"`** — soft / inline flows are small by construction and never fan out.
2. **Diff is large** — `git diff --stat` against the build base shows **≥ 12 changed files OR ≥ 400 changed lines**.
3. **≥ 2 disjoint clusters** — the changed files split into ≥ 2 groups with no shared top-level module / directory (the same disjoint-surface test `parallel-build` uses to form slices).
4. **Sub-agent dispatch + git both available** — the harness can spawn sub-agents and the repo is git-backed.

If **any** condition fails → one sequential `reviewer` `code` dispatch over the whole diff (the default). Record nothing special; this is the normal path, not a degradation.

## Partition (≤ 5 — mirror parallel-build's cap)

Split the changed files into cohesive **partitions** by cluster (shared module / adjacent dirs). Hard cap **5 partitions**. If the diff yields more than 5, **merge the thinnest partitions** (group by adjacent files / shared module) until ≤ 5 — **never** cascade "wave 2" / "wave 3". If after merging you still have > 5 genuinely disjoint clusters, the change is too large for one review pass: recommend splitting the slug. Each partition is reviewed by exactly one `reviewer` `code` sub-agent scoped to that partition's files.

The 5-partition cap is intentional, and identical to `parallel-build`'s for the same reasons: orchestration + merge cost grows non-linearly past 5; 5 fits under every tested harness's sub-agent quota; larger fan-outs reliably produce more merge findings than wall-clock saved.

## Dispatch

1. For each partition, dispatch one `reviewer` in `code` mode. The envelope carries: the partition id, the **file globs it owns** (the only paths it reviews), the AC ids whose `touchSurface` intersects the partition, and the `plan.md` + `build.md` context. Each partition reviewer walks all nine axes **on its files only** and returns a slim summary + a findings block.
2. **Security + cross-cutting axes are NOT partitioned.** One designated reviewer (partition 1, or a dedicated whole-diff pass) walks the `security` axis and any cross-file invariants over the **entire** diff, because a per-partition view misses taint, authz, and supply-chain issues that cross partition boundaries. Name this whole-diff responsibility explicitly in that reviewer's envelope.

## Merge (orchestrator — deterministic)

1. Concatenate every partition's findings into **one** `review.md` iteration block. The iteration header records `partitions: N (parallel)` + the per-partition reviewer ids.
2. **Dedupe** findings that cite the same `file:line` + same axis (a cross-cutting issue caught by two partitions) — keep one, note the partitions that flagged it.
3. The merged **decision = worst of the partition decisions** (`block` > `warn` > `clear`). Any single partition `block` blocks the slug.
4. Run **one** integration + Five Failure Modes pass across the merged findings — the same mandatory sweep `parallel-build` runs after a parallel wave. It catches issues that live in the **seams** between partitions (a fix in one cluster that breaks another).

## flow-state + cockpit

- **No new flow-state field.** Review iterations are already tracked by `reviewIterations`; a partitioned iteration counts as **one** iteration against the §3 5-cap. The fan-out is recorded only in the `review.md` iteration header (`partitions: N (parallel)`), exactly as the sequential path records `mode` + `reviewer (id)`. Keeping the schema untouched keeps resume + cancel stable.
- **Cockpit:** when (and only when) an iteration fanned out, surface one plain clause on that stage's cockpit line — "reviewed N partitions in parallel". On the sequential default, the cockpit is unchanged (the user never sees a parallel concept they didn't pay for).

## Fallback (silent, not an error)

If sub-agent dispatch is unavailable, the repo is non-git, or partition creation fails, parallel-review **degrades to a single sequential reviewer** over the whole diff. Record one line in `review.md`:

```markdown
> Review was size-eligible for parallel fan-out but the harness does not support sub-agent dispatch (or partitioning failed); reviewed sequentially over the whole diff.
```

Degradation never reduces review depth — the single reviewer still walks all nine axes over every changed file.

## Hard rules

- The size gate is the **sole** trigger. Never fan out review on a small / medium diff.
- **≤ 5 partitions.** Merge thin partitions or accept a single reviewer; never cascade waves.
- The `security` axis is reviewed across the **whole** diff, never per-partition.
- A partitioned iteration is **one** iteration against the per-slug 5-cap.
- The integration + Five Failure Modes pass after merge is **mandatory** — no shortcut.
- Partition reviewers never read each other's scope mid-flight; a cross-partition concern is raised as a finding, not hand-resolved.
