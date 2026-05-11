---
name: performance-optimization
trigger: stage=build when `touchSurface` includes `ui` OR the diff touches a hot path (DB query, network call, render loop); stage=review when the reviewer cites a `perf` axis finding; never on inline / trivial slugs (no measurement infrastructure to support the gate)
---

# Skill: performance-optimization

Performance work is the slot cclaw most often gets wrong: an agent eyeballs a function, "optimises" it from `O(n)` to `O(log n)`, and ships a change that adds 200ms of cold-start cost because the new path lazy-imports a 50KB dependency. The rubric below exists to interrupt that pattern with one rule: **don't optimise without numbers.** Every "perf improvement" carries a before/after measurement at the same surface (Core Web Vitals on the page; query plan on the database; cold-start trace on the function). Without numbers, the change is a guess, and the reviewer cites the guess as a `perf` finding with severity `required`.

The skill is stage-windowed on `["build", "review"]`: build-stage TDD's REFACTOR step considers perf alongside readability and complexity-budget; review-stage's seven-axis pass surfaces perf findings citing this skill body for the measurement-first gate.

## When to use

- **When implementing a `touchSurface: ui` AC.** The Core Web Vitals targets (LCP, INP, CLS) gate the AC's "verifiable" check. The build-stage's verification line is "LCP ≤ 2.5s on a `Slow 4G` Lighthouse run" or equivalent — not "looks fast on my machine".
- **When the AC text mentions latency, throughput, query time, render budget, or "performance".** The AC must have a numeric target; if it does not, surface as `ac-discipline > verifiable` finding before writing code.
- **In the REFACTOR step of `tdd-and-verification`** when the GREEN commit introduced a perf regression. The REFACTOR is the audit-trailed place to restore the perf budget; commit under `--phase=refactor` with the measurement before/after in the message body.
- **In fix-only** when the reviewer cited a `perf` finding. The fix is RED (a perf test or benchmark that pins the budget) → GREEN (the optimisation that passes the budget) → REFACTOR (clean up).
- **Reviewer-side** when scoring a `perf` finding: cite this skill body. The finding's severity is bounded by whether the change is measurable. `nit` = no measurement attached but suspicious pattern; `consider` = measurement shows a real but small regression; `required` = measurement shows a budget violation.

## When NOT to apply

- **The slug is inline / trivial.** Inline slugs have no Lighthouse run, no benchmark, no perf budget. Touching a hot path inline still requires measurement, but the verification surface is the project's existing perf gate (CI Lighthouse step, `pnpm benchmark` script), not a new bespoke benchmark for one file.
- **The AC does not mention performance.** Drive-by "optimisation" while implementing a non-perf AC is a `commit-hygiene` A-4 (drive-by) violation. Surface the perf concern as "noticed but didn't touch" in the slim summary; let the design specialist schedule it as a separate slug.
- **You don't have numbers.** "I think this will be faster" is a hypothesis, not a fix. Get numbers first: capture a baseline measurement (Lighthouse run, `explain analyze`, benchmark suite). Without the baseline, you cannot tell if your change made things better or worse.
- **The "optimization" obscures intent.** A 5% speedup that turns clear code into a hand-rolled SIMD loop is a regression for the next agent who has to fix a bug in it. Re-read `code-simplification > Five principles` — principle 3 (clarity over cleverness) bounds principle 4 (preserve behaviour) on perf work too.
- **You are measuring at the wrong granularity.** A function microbenchmark that shows "10x speedup" but the surface metric (Lighthouse LCP, p99 query time) is unchanged means the function was not the bottleneck. Measure at the **user-observable** surface; microbenchmarks are diagnostic, not decisive.

## Core Web Vitals targets (UI work)

The cclaw default budgets, applied when the AC touches `ui` and the project does not pin tighter targets in `cclaw.config.json > perfBudget`:

| metric | what it measures | target (good) | watch (needs-work) | fail |
| --- | --- | --- | --- | --- |
| **LCP** (Largest Contentful Paint) | time to render the main viewport content | ≤ 2.5s | 2.5-4.0s | > 4.0s |
| **INP** (Interaction to Next Paint) | latency from user interaction to next paint | ≤ 200ms | 200-500ms | > 500ms |
| **CLS** (Cumulative Layout Shift) | unexpected layout movement | ≤ 0.1 | 0.1-0.25 | > 0.25 |
| **TTFB** (Time to First Byte) | server response start | ≤ 800ms | 800-1800ms | > 1800ms |
| **FCP** (First Contentful Paint) | first non-blank paint | ≤ 1.8s | 1.8-3.0s | > 3.0s |
| **TBT** (Total Blocking Time) | main-thread blocked-time | ≤ 200ms | 200-600ms | > 600ms |

Measurement surface: **Lighthouse with `Slow 4G` throttling + 4× CPU slowdown** (the official "mobile" preset). A "fast on Wi-Fi + M2 MacBook" run does not count — it under-reports every metric.

When the AC pins a target, the AC's value wins. When the project's `cclaw.config.json > perfBudget` pins a target, that value wins over the defaults above. When neither pins a target, the defaults above are the contract.

## Measurement-first workflow

The iron rule of perf work: every change is a triple of measurements, not a guess.

1. **Baseline.** Before any code change, capture the current state. For UI: Lighthouse run on the affected page, recorded with the URL + commit SHA + throttling profile. For DB: `EXPLAIN ANALYZE` on the affected query, recorded with the query text + table sizes + index list. For functions: a benchmark run (`pnpm bench`, `tinybench`, `Benchmark.js`), recorded with the suite output. Commit the baseline as a `tests/perf-baseline-<surface>.md` artifact in the same PR.
2. **RED — pin the budget.** Write a perf test that asserts the **target** (not the baseline). For UI: a Lighthouse CI check with the target metric thresholds. For DB: a benchmark that fails if the query exceeds the p95 budget. For functions: a benchmark that fails if the op/s drops below the floor. The test must fail on the baseline; that is the RED state.
3. **GREEN — make the test pass.** Implement the optimisation. The test must turn green; the baseline measurement is re-run and shows the budget is met.
4. **REFACTOR — verify no regressions.** Run the full perf-test suite (not just the one you added). Run the project's CI Lighthouse check on a sample of unrelated pages. If any other page regressed, revert and reconsider — the optimisation is local, not global.

A change that does not produce a measurement triple is not a perf change. It is either (a) a code change with a perf side-effect (then it is a behaviour change and the AC owns it), (b) a guess (then the reviewer cites `perf` with `required` severity), or (c) a `code-simplification` change with a coincidental perf delta (then it goes under REFACTOR with no perf claim).

## N+1 query anti-patterns and fixes

The most common backend perf bug. Cclaw flags these patterns in the diff during build-stage; the reviewer cites them in fix-only if the build slipped them through.

| anti-pattern | symptom | fix |
| --- | --- | --- |
| **Loop with embedded query** — `for (user of users) { await db.query('SELECT * FROM orders WHERE user_id = ?', user.id) }` | one round-trip per row; query count grows linearly with result size | `WHERE user_id IN (...)` single query OR explicit JOIN OR a batching layer (DataLoader / equivalent) |
| **ORM lazy load in template** — accessing `.related` inside a render loop triggers a per-row fetch | "It's fast in dev with 10 rows; production has 10000" | eager-load with `.include` / `.preload` / `.with` at the query layer, **before** the render |
| **GraphQL N+1** — resolver fetches per-field instead of per-batch | dataloader batching missing | introduce a batch resolver; cache per-request, not per-query |
| **Loop with embedded HTTP call** — `for (item of items) { await fetch('/api/score/' + item.id) }` | round-trip-per-item over the network; long tail of slow items | a batch endpoint (`POST /api/score with body=[ids]`); if no batch endpoint exists, that is the AC the design specialist should schedule |
| **Recursive walk with per-node query** — tree traversal that queries on every visit | exponential round-trips for branching | materialise the tree shape with a CTE / single recursive query; walk in memory |
| **Per-row authorization check** — `for (item of items) { if (await authz.check(user, item)) ... }` | one authz round-trip per item | resolve authorization once for the batch (a single "what can user U see of {items}" query) |

**Verification pattern**: a perf test that runs the workflow with N=100 rows and asserts `dbQueryCount ≤ 5` (or `dbDurationMs ≤ 100`, or `httpCallCount ≤ 1`). The exact budget depends on the workflow; the budget being tested is what makes the test useful.

## Bundle budget table

For UI work, the JavaScript / CSS shipped to the user is a perf input. cclaw defaults (override in `cclaw.config.json > perfBudget.bundle`):

| asset | target (good) | watch | fail |
| --- | --- | --- | --- |
| **Initial JS** (first-load JS shipped to first interactive paint) | ≤ 170KB compressed | 170-250KB | > 250KB |
| **Initial CSS** (critical render-path CSS) | ≤ 50KB compressed | 50-100KB | > 100KB |
| **Per-route lazy chunk** | ≤ 80KB compressed | 80-150KB | > 150KB |
| **Image asset** (per image, hero / above-fold) | ≤ 100KB after optimisation | 100-300KB | > 300KB |
| **Font asset** (per font face) | ≤ 50KB woff2 | 50-100KB | > 100KB |
| **Total page weight** (compressed, first load) | ≤ 500KB | 500KB-1MB | > 1MB |

Bundle changes are flagged by the build-stage `npm run build` output's bundle-size summary (most modern frameworks emit one). The AC's verification line for any UI slug that adds a new route or library MUST include "bundle delta ≤ X" — without that, the reviewer cites `perf > bundle` with `consider` severity.

## "Don't optimise without numbers" — iron rule

The single rule this skill is built around. State the rule explicitly in every perf-adjacent slim summary:

- **What it forbids:** Implementing a "perf improvement" without baseline + target + measured result.
- **What it permits:** Implementing a behaviour change that happens to have a perf side-effect, **provided** the AC owns the behaviour change (not the perf side-effect). The perf delta is recorded in the slim summary's `Notes:` line but is not the AC's verification surface.
- **What it requires when violated:** Revert. The reviewer cites the violation as `perf > unmeasured` with severity `required`. Fix-only re-runs the slug with the baseline + target captured first.

The rule is sticky to perf claims, not perf side-effects. A `code-simplification` REFACTOR that inlines a wrapper does not claim a perf improvement and does not need a measurement. The same REFACTOR that adds a `[Symbol.iterator]` to a class is **claiming a perf shape** (lazy iteration) and DOES need a measurement.

## Common rationalizations

| rationalization | truth |
| --- | --- |
| "This is obviously faster — I don't need to measure it." | "Obviously" is the word that introduces the perf bug. Every senior engineer has a story about an "obvious" optimisation that turned out to be a regression because of cache effects, JIT compilation, or constant-factor overhead. Measure. |
| "I'll add the measurement later." | Later doesn't come. The PR ships with the optimisation; the measurement-task is forgotten; six months later someone asks "why is this code so weird?" and the answer is "I think it was faster, not sure". Measure before, not after. |
| "The user will notice if it's slower." | The user notices the worst-case latency; they don't notice the average. p50 unchanged + p99 doubled is a UX regression you cannot detect by "feel". Measure with a profile that captures the long tail (Lighthouse, real-user monitoring, p99 benchmark). |
| "Premature optimization is the root of all evil — so I'll skip this concern." | Knuth's quote ends "... but we should not pass up our opportunities in that critical 3%". This skill is for the 3%. The other 97% of code follows `code-simplification`; this skill governs the hot-path slot. Misreading Knuth as "never optimise" is the more common error. |
| "My machine runs it fast enough." | Your machine is faster than the median user's by 10-30x. Throttle to `Slow 4G + 4× CPU` (Lighthouse mobile preset) or run on a representative production instance. Local-dev performance is non-information. |
| "It's just one extra query — won't matter." | One extra query per row × 10000 rows = 10000 round-trips. The N+1 pattern's seductive line is "but it's just one query". Count the round-trips at the boundary of the loop. |
| "I'll bundle the optimization into this feature PR — it's basically the same surface." | Bundling perf work into a behaviour-change PR makes the perf delta unreviewable (it is mixed with behaviour delta). The reviewer cannot tell if a regression came from the feature or the optimisation. Split into separate slugs: feature first (with perf baseline + budget assertion), perf optimisation second (with measurement triple). |
| "We'll fix perf in v2." | The slug shipping today is the one the user sees. "v2" rarely happens; even when it does, the perf debt accumulated under "v1" makes the v2 baseline worse, and you end up optimising harder than if you had just held the budget in v1. Hold the budget per slug. |

## Red flags

Stop and re-measure / revert when any appear:

- **The PR description claims a perf improvement but no benchmark / Lighthouse run is cited.** Iron rule violated. Add the baseline + target + result, or remove the claim from the description.
- **A microbenchmark shows a big speedup but the user-observable metric (LCP, p99) is unchanged.** You optimised the wrong thing. The function wasn't the bottleneck.
- **A change "improves" perf by removing a feature** (lazy-load a critical path, defer a security check, drop a validation). Behaviour change disguised as perf. Reject; re-scope as a behaviour AC if the feature is genuinely droppable.
- **The optimisation works only in production-shape data** but the test suite uses dev-shape (10 rows). Add a perf test with production-scale data; the dev-shape pass is not enough.
- **You are profiling with the dev server / unoptimised build.** Production build is the only valid measurement surface (tree-shaken, minified, gzipped, with prod-side rendering). Dev-server numbers under-report bundle costs by 5-10x.
- **You are about to add a memoisation cache to "speed up" a function whose call-site profile shows zero hot calls.** Speculative optimisation. Don't.
- **The "optimised" code introduces a new abstraction nobody else uses.** Premature abstraction. The cost of an unused abstraction (next agent reading it, refactoring around it) is paid forever; the perf win is paid once.
- **The diff touches files outside the AC's `touchSurfaces`.** Drive-by perf work. Surface as "noticed but didn't touch"; schedule as a follow-up slug.

## Verification

After a perf-claiming change, before committing:

- [ ] Baseline captured (file: `tests/perf-baseline-<surface>.md` or equivalent in the project's perf-fixture location).
- [ ] Target articulated as a numeric threshold (LCP ≤ X ms, query duration ≤ Y ms, op/s ≥ Z).
- [ ] RED state demonstrated — the perf test failed on the baseline.
- [ ] GREEN state demonstrated — the perf test passes on the change.
- [ ] Full perf-test suite (not just the new one) runs green after the change (no other regression).
- [ ] Measurement was taken on the **production build / throttled profile / production-shape data** — not the dev server / fast machine / 10-row fixture.
- [ ] The change is in the AC's `touchSurfaces` (or the AC is explicitly a perf AC with its own touchSurface set).
- [ ] CHANGELOG (if user-visible) names the before/after numbers, not just "made it faster".
- [ ] Bundle-size delta (UI only) is included in the slim summary's `Notes:` line.

If any box is unchecked → revert. An unverified perf claim is `perf > unmeasured` waiting to be cited.

## Cross-references

- `tdd-and-verification > REFACTOR — mandatory pass` — the runtime invocation point for the build-stage perf work. REFACTOR's measurement step consults this skill body.
- `review-discipline > Seven-axis review` — the reviewer's `perf` axis cites this skill body. v8.13 added test-quality and complexity-budget; v8.32 promotes the `perf` axis from "advisory" to "first-class" via this skill.
- `ac-discipline > verifiable` — the AC's verification line for any perf-claiming AC must be a numeric threshold, per this skill's iron rule.
- `code-simplification > Five principles` — principle 3 (clarity over cleverness) bounds perf work; an "optimised" version that is harder to read fails the simplification rubric even if it is measurably faster.
- `commit-hygiene > surgical-edit-hygiene` — perf changes follow the no-drive-by rule. Out-of-scope optimisation is "noticed but didn't touch".

---

*Adapted from the addy-osmani performance-optimization pattern. The Core Web Vitals targets are Google's current guidance (LCP/INP/CLS thresholds as of 2026). The N+1 table is project-agnostic; the bundle-budget table assumes a typical SPA shape and is overridden by `cclaw.config.json > perfBudget` when projects pin tighter targets.*
