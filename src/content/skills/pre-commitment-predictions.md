---
name: pre-commitment-predictions
trigger: specialist:plan-critic OR specialist:critic OR specialist:qa-runner OR before:section-1; stages plan / review / qa.
---

# Skill: pre-commitment-predictions

Before reading the rest of the artifact set, every adversarial / verification pass writes **3-5 predictions** of what is most likely to be wrong, missing, or under-graded. Then it reads the rest and verifies each prediction against the evidence. The discipline activates **deliberate search** rather than passive evaluation: writing predictions first forces the specialist to commit to expected failure modes BEFORE the artifact's wording has a chance to anchor them.

Consolidated in v8.111 across the three specialists that ran their own near-identical inline §1 / §3 / §6 blocks (post-impl critic, plan-critic, qa-runner). Each specialist now carries a one-line anchor pointing here.

## When to use

The §1 (or §3 / §6 depending on the specialist's template) pre-commitment pass fires once per dispatch:

- **post-impl critic** (`specialist:critic`) — §1 of the eight-section critic protocol; predictions land BEFORE §2-§5 read build.md / review.md in detail.
- **plan-critic** (`specialist:plan-critic`) — §1 of the per-mode rubric protocol; predictions land BEFORE §2-§4 walk the rubric in detail. Same pattern across all three modes (`generic` / `design` / `devex`).
- **qa-runner** (`specialist:qa-runner`) — §3 of the qa.md template; predictions land BEFORE §4 per-AC evidence collection, BEFORE running any browser interaction or test execution.

Stages: `plan` (plan-critic dispatch), `review` (post-impl critic dispatch), `qa` (qa-runner dispatch). Not relevant in `triage` / `build` / `ship` / `compound` stages.

## When NOT to apply

- **Triage** — the router's job is to classify, not to enumerate failure modes. Pre-commitment predictions would slow the dispatch without surfacing actionable signal.
- **Builder** — the builder TDDs against the AC; the RED test IS the prediction (a structured "this case should fail until I implement it"). Adding a parallel `## Pre-commitment predictions` section inside builder.ts would double-write the same discipline against a different surface.
- **Reviewer** — the reviewer walks the fourteen-axis pass; that IS the structured walk. Pre-commitment predictions would compete with the per-axis findings table rather than augment it.
- **Ship synthesis / compound layer** — both are after-the-fact aggregations, not adversarial passes.

## Hard rules

- **3-5 predictions, no more, no less.** Fewer than 3 means you skipped pre-commitment (predicting forces deliberate search rather than passive reading). More than 5 is fishing — the marginal prediction has weak rationale.
- **Predictions are committed BEFORE reading the rest of the artifact set in detail.** This ordering is the entire point of the skill: writing predictions after reading the artifact is anchored evaluation, not deliberate search. The specialist's template structures this by placing the pre-commitment section at §1 / §3 (qa-runner) ABOVE the detailed-evidence sections that come next.
- **Each prediction names a verification path.** "What would I see in the artifact / git log / test output if this prediction is right?" — the verification path is the prediction's testable shape. A prediction without a verification path is a hunch, not a falsifiable claim.
- **Every prediction's outcome is recorded** as one of `confirmed` / `refuted` / `partial`. `refuted` is information; never delete a wrong prediction. The §7 verdict (critic) / §4 (plan-critic) / §6 (qa-runner) block aggregates: `Predictions: <N made; N_confirmed confirmed, N_refuted refuted, N_partial partial>`.
- **"Refuted is information" rule.** A refuted prediction is NOT a failure — it is a signal that the specialist's prior expected failure mode did not materialize. The §1 protocol explicitly preserves refuted predictions; delete-and-replace is forbidden because the audit trail's value is the refuted-ness itself.

## Mode-flavoured prediction shape (cite-back)

Each prediction's wording is flavoured by the specialist's mode so the §2-§N walks have a concrete verification target:

- **post-impl critic (`gap` mode)** — predictions about coverage / edge-case gaps / decision drift / scope-creep / false assumptions. "I expect §2 will find an uncovered branch in `src/api/list.ts:filter` because the AC says 'show items where archived=false' but the diff only checks `deleted=false`."
- **post-impl critic (`adversarial` mode)** — predictions about production-fail-mode classes. Two of the 5-7 predictions are reserved for "I expect this slug will fail in production via <class>" framings (e.g. "via the retry loop double-firing on connection reset"; "via the cache invalidation racing the write").
- **plan-critic (`generic` mode)** — predictions about goal-coverage / granularity / dependency-graph / risk-catalog gaps. "I expect §3 will find a cycle because AC-2 and AC-3 both touch `src/cache/refresh.ts`."
- **plan-critic (`design` mode)** — predictions about per-dimension grading gaps. "I expect interaction affordances will grade ≤5 because the plan's AC table lists `shows a toast` without enumerating loading / empty / error states."
- **plan-critic (`devex` mode)** — predictions about getting-started / API-ergonomics / docs gaps. "I expect docs will grade ≤5 because the AC table lists `add endpoint` without any README / SDK reference update."
- **qa-runner** — predictions about which UI AC will fail when rendered. "I expect AC-3's toast to be missing because the builder's GREEN evidence cited only the click handler, not the rendered toast component."

## Adversarial-mode expansion (post-impl critic only)

In the post-impl critic's `adversarial` mode, expand the cap to **5-7 predictions** — the additional 2 slots are reserved for production-fail-mode predictions (the adversarial flavour). Outside `adversarial` mode the 3-5 cap holds.

## Rationalization rebuttals

| Excuse | Reality |
| --- | --- |
| "I'll just enumerate 8-10 predictions to be thorough." | NO. The 3-5 cap exists because every prediction past 5 has weaker rationale — you are *fishing*, not predicting. Six predictions is the symmetry trap; seven is hedge-betting. Pick the 3-5 most likely and commit. The adversarial-mode expansion to 5-7 is the only exception, and it's tightly scoped to production-fail-mode framings. |
| "I read the artifact set first to know what to predict." | NO. Reading first is anchored evaluation, not deliberate search. The point of pre-commitment is that you DON'T know what the artifact set says when you write the predictions; that's what activates deliberate search in the §2-§N walks. The §1 / §3 / §6 templates structurally enforce the ordering — predictions BEFORE detailed reads. |
| "Prediction X turned out wrong — let me delete it and write a better one." | NO. `refuted` is information. The §7 verdict rolls up `N_confirmed / N_refuted / N_partial`; a refuted prediction is part of the audit trail. Delete-and-replace breaks the audit; if the original prediction is genuinely wrong-shaped, mark it `refuted` and the §2-§N walks pick up the gap honestly. |
| "I'll write a 'safe' prediction so I don't look wrong." | NO. The point is to commit to falsifiable claims. A prediction shaped "I expect §2 will find something" is not falsifiable; it always confirms (something always exists). Name the *specific* expected failure: "I expect §2 will find a coverage gap on the empty-input edge case because AC-1 cites only the happy-path test." |
| "The slug is tiny / the artifact is tiny — I'll skip pre-commitment." | NO. The 3-5 cap is tight enough that pre-commitment on tiny slugs takes < 30 seconds. The discipline cost is constant; the discipline value compounds. Skipping is the source of "I forgot what I expected to find when I started" mid-pass anchoring. |
| "The artifact's `## Concerns` already names the failure modes." | The builder's `Potential concerns` section is helpful but it is the builder's framing of risk. Pre-commitment is YOUR adversarial framing. Copying the builder's concerns into the prediction list is just-walking-the-artifact, which is exactly what the discipline exists to prevent. Write your own predictions in your own language; cross-check them against the `Potential concerns` afterward. |
| "Why 3-5 specifically? Couldn't it be 2 or 6?" | The lower bound (3) forces enumeration past the most-obvious failure mode — if you stop at 1 prediction, you anchored on the first thing that came to mind. The upper bound (5) prevents the fishing trap. The band 3-5 is wide enough that small / large slugs both fit; tight enough that the discipline doesn't drift. The exception (5-7 in adversarial mode) carves out the production-fail-mode framings that genuinely need more slots. |

## Outcome recording shape

Each prediction's outcome is recorded inline in the §1 / §3 / §6 block:

```text
1. **Prediction**: I expect §2 will find a cycle because AC-2 and AC-3 both touch `src/cache/refresh.ts`.
   **Verification path**: §3 dependency-graph pass should surface the overlap.
   **Outcome**: refuted — §3 walked the graph and found `src/cache/refresh.ts` is touched by AC-2 only; AC-3's `Verifies` list mistyped `src/cache/render.ts` (different file). Coverage-correctness preserved, but a typo finding goes into the §4 ledger.
```

`refuted` outcomes that surface unexpected findings still land in the §2-§N ledger — the prediction-was-wrong observation is its own audit signal, but the underlying finding (the typo) still routes through the normal severity-and-class ladder.

## Cross-references

The discipline is sourced from the **OMC pattern** (`oh-my-claudecode/agents/critic.md:58-60`) — "predicting forces deliberate search rather than passive reading" — and dovetails with cclaw's existing **structured-status** discipline (every adversarial pass emits a structured verdict; pre-commitment predictions are the structured *input* into that verdict). The §7 verdict's "Predictions:" line is the canonical aggregation surface; downstream specialists (plan-critic, post-impl critic, qa-runner) read it as input to their own §1 / §3 / §6 passes.
