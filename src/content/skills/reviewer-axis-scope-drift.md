---
name: reviewer-axis-scope-drift
trigger: gated reviewer axis (v8.84). Loads only when the scope-drift gate fired — `walkScopeDriftAxis: true` on the dispatch envelope, set by the orchestrator when `flows/<slug>/plan.md` carries a non-empty `## Not Doing (and why)` section. Structurally skipped on legacy plans authored pre-v8.80 (no `## Not Doing` section) and on `ceremonyMode: inline` (no plan.md exists).
---

# Skill: reviewer-axis-scope-drift

Full rubric, evidence-collection guidance, and severity matrix for the reviewer's `scope-drift` axis (v8.84). Lifted out of `reviewer.ts` at axis introduction — the prompt carries only a 5-line stub pointing here.

The `scope-drift` axis is the ex-post enforcement of the plan's `## Not Doing (and why)` declarations. v8.80 promoted `## Not Doing (and why)` to a first-class plan-template section and plan-critic §6.5 gates ship on the section being non-empty (3-5 bullets naming explicit scope exclusions with one-sentence rationale). v8.84 closes the other half: the reviewer now cross-checks the shipped diff against those exclusion bullets and files findings whenever the build appears to implement scope the plan explicitly bracketed out.

Sourced from `ce-scope-guardian-reviewer` in the everyinc-compound playbook ("Does this scope item serve a stated goal?" / "Did the diff quietly re-introduce work the plan placed in 'Deferred for later'?"); cclaw's pre-v8.84 equivalent was scattered across the architect's `## Not Doing` author-time discipline and the orchestrator's plan-critic gate. The scope-drift axis pins the post-build half on the reviewer, where the diff actually exists to inspect.

## When to use

Pinned to the reviewer's dispatch envelope when `walkScopeDriftAxis: true` is set. The orchestrator inspects `flows/<slug>/plan.md` at dispatch time, detects a non-empty `## Not Doing (and why)` section (plan-critic §6.5 already gated ship on this; post-v8.80 every plan that reaches review has it), and passes `walkScopeDriftAxis: true` to `buildAutoTriggerBlock("review", env)`. The skill loads only then. The reviewer's prompt body has a 5-line stub naming this skill; the full Not-Doing cross-reference protocol lives here.

## When NOT to apply

- `flows/<slug>/plan.md` has no `## Not Doing (and why)` section at all (legacy plan authored pre-v8.80) — axis skipped silently; emit zero findings. The orchestrator does NOT set the envelope flag, the skill body does not load, and the iteration block notes "scope-drift: skipped (legacy plan, no Not-Doing section)". The back-compat rule preserves shipped-state correctness on flows authored before the v8.80 promotion.
- `ceremonyMode: inline` — no plan.md exists, no `## Not Doing` to cross-reference; axis is structurally skipped. The orchestrator does not set the envelope flag on inline-mode dispatches.
- `## Not Doing (and why)` section present but its single bullet reads the literal "nothing this round" form (tight-scope slug; plan-critic §6.5's accepted shape for slugs that genuinely exclude nothing beyond the obvious) — axis fires the gate but emits zero findings; note "scope-drift: gate fired but section names no exclusions to cross-check (`nothing this round`)" in the iteration block. This is the structural escape hatch for tightly-scoped slugs and is NOT a finding.
- The diff is a fix-only iteration (reviewer iteration ≥ 2; builder bounced on prior findings) AND the prior iteration's scope-drift axis was already walked AND closed — re-walking on every iteration is redundant. The axis still re-renders to confirm no NEW scope crept in via the fix-only commits, but findings from prior iterations stay closed unless the new fix-only commits re-introduced an exclusion.

## Process

**Sub-check 1 — Per-Not-Doing-bullet cross-reference.** Read `plan.md > ## Not Doing (and why)` and enumerate every bullet. Each bullet has the shape `- **<scope item>** — <one-sentence reason for excluding it from this slug>.` (the plan-template format plan-critic §6.5 enforces). Parse the bold-token `<scope item>` from each bullet; the rationale clause is contextual but not load-bearing for the cross-check (the cross-check fires on the scope item, not on the reason).

For each `<scope item>`, scan the shipped diff (`git diff <plan-commit>..HEAD` against the build range) and `flows/<slug>/plan.md > ## Plan / Slices` and `## Acceptance Criteria (verification)` for evidence that the item appears to be implemented:

1. **File-path match** — does the diff touch a file whose path name maps to the scope item? (`caching layer` Not-Doing bullet → diff touches `src/cache/**`, `src/lib/cache.ts`, `src/middleware/cache-middleware.ts`; `new dashboard view` Not-Doing bullet → diff touches `src/components/dashboard/**`, `app/dashboard/page.tsx`).
2. **Symbol / identifier match** — does the diff introduce a top-level export, class, function, or React component whose name maps to the scope item? (`webhook delivery retries` Not-Doing bullet → diff exports `retryWebhook` / `WebhookRetryQueue` / `withRetry`; `Stripe migration` Not-Doing bullet → diff introduces `stripeClient` / `StripeService`).
3. **AC / Slice-text match** — does any AC summary or Slice title in `plan.md` reference the scope item verbatim or near-verbatim? (`pagination` Not-Doing bullet → an AC titled "List view supports paginated fetch" or a slice titled "Pagination wiring").
4. **Commit-message match** — does any commit subject in `git log --grep="<scope-item-token>" --oneline` against the build range cite the scope item by name? (`telemetry pipeline` Not-Doing bullet → commit subject contains "telemetry" / "metrics pipeline" / "instrumentation").

A match on ANY of the four signals — file path, symbol, AC / slice text, commit message — is a **scope-drift finding (severity=consider by default; severity=required when ≥ medium signal strength)**. File findings as `SD-N: <not-doing item> appears to be implemented despite exclusion`, citing the matching evidence (file:line for file-path / symbol matches, plan.md anchor for AC / slice matches, commit SHA for commit-message matches). Numbering: `SD-1`, `SD-2`, ... — the `SD-` prefix is the scope-drift axis's namespace inside the reviewer's broader `F-N` ledger (an `SD-N` is filed as `F-N axis=scope-drift severity=<grade>` in the Findings table; the SD-prefix is the axis-local mnemonic recommended in the description body).

**Sub-check 2 — Acknowledged-reversal exception.** A scope-drift signal is NOT a finding when the plan explicitly acknowledges the reversal. Two acknowledged shapes:

- The plan's `## Not Doing (and why)` bullet itself contains the acknowledgement (the architect amended the bullet to read `- **<scope item>** — was originally excluded; <reason for re-including in this slug>.` — i.e. the rationale clause now justifies the inclusion). This is the canonical "the plan changed its mind" path; the bullet stays in the section as a record of the consideration.
- A `## Open questions` or `## Decisions` row in `plan.md` names the reversal verbatim (e.g. `## Open questions > Re-included pagination after triage feedback — see D-3`). The reviewer's job is to find the cross-reference, not to litigate whether the rationale is sound.

When the reversal is acknowledged, the axis still emits a `fyi` finding noting the in-flight reversal ("`SD-N` `<not-doing item>` was excluded in the original plan; the diff now includes it. Reversal is acknowledged at `<plan.md anchor>`. No action required.") — the FYI exists so compound captures the pattern as a learnings.md row, and so the user sees the reversal one more time before ship. FYI severity never blocks ship.

**Sub-check 3 — Severity grading (0-10 scale).** Grade each scope-drift finding's signal strength 0-10 (the grade is in the finding's description; it does not appear separately in the ledger). The grade drives severity:

- **0-3** — weak signal. Single match on commit-message keyword OR a single symbol that maps weakly to the scope item (a `cache` variable in an unrelated config file when the Not-Doing bullet excludes `caching layer`). Severity = `consider`; the author can push back with evidence that the match is coincidental.
- **4-6** — medium signal. Two of the four signal categories match (e.g. file path + symbol) AND the match maps unambiguously to the scope item. Severity = `required`; blocks ship in strict mode. The author either reverts the scope drift OR amends the Not-Doing bullet via a plan-edit (architect bounce) to acknowledge the reversal.
- **7-10** — strong signal. Three or more signal categories match (file path + symbol + commit message; or file path + AC text + symbol) AND the diff would be obviously the implementation if read by a fresh agent. Severity = `required`; blocks ship in strict AND soft modes (one severity tier above the default "required blocks soft only when soft has a `required` open" rule because scope-drift findings are load-bearing on the plan's contract). On `triage.complexity == "critical"` slugs (single-step rollbacks affecting users), severity escalates one tier to `critical`.

A finding with grade `0-3` may be downgraded to `fyi` if the author's push-back includes a citation that the match is coincidental (e.g. "the `cache` variable in `src/config.ts:23` is the existing tiered cache — not the new caching layer the Not-Doing bullet excludes; cf. commit `5a91ab2`"). The downgrade requires the citation; "looks unrelated" without evidence is not enough.

**Sub-check 4 — Plan-amendment alternative.** Scope-drift is not always a build-side error; sometimes the plan is wrong. When the diff legitimately needed to touch the scope item (the implementation revealed the item is on the critical path; the architect's Not-Doing call was wrong), the fix is a **plan amendment** — architect bounces with `task: plan-amend`, edits the Not-Doing bullet (either removes it OR rewrites the rationale to acknowledge the inclusion per Sub-check 2), and the architect's plan-amend commit closes the SD-N finding with a citation to the plan.md edit. The reviewer's next iteration re-walks the axis with the amended plan and notes the closure.

The plan-amendment path is the **canonical fix** when the build-side scope is genuinely required — silently leaving the scope drift open and shipping anyway is exactly the rationalization the axis exists to catch.

## Common rationalizations

Cross-cutting rows live in `.cclaw/lib/anti-rationalizations.md`; the three rows below are scope-drift-axis-specific to this gate:

| rationalization | rebuttal |
| --- | --- |
| "But the Not-Doing bullet was vague — it said `caching` and I added a memoization wrapper, not a caching layer." | The bullet's specificity is the architect's call, not the reviewer's. A vague Not-Doing bullet that matches the diff IS a finding; the fix is a plan amendment that either tightens the bullet (`caching layer (Redis or memcached)` so the memoization wrapper is genuinely out of scope) OR acknowledges the reversal. Silently shipping the memoization-as-not-caching reading is the failure mode the axis exists to catch — the plan's text is the contract, and the contract's language was the architect's choice. |
| "But the diff only touches the scope item in service of an AC that IS in scope — it's incidental, not the feature." | Incidental implementation IS implementation. If the diff adds the excluded scope item's surface to the codebase (new files, new exports, new commit messages naming the item), the item is implemented in fact regardless of motivating intent. The fix is either to refactor the AC to not need the excluded surface OR to amend the Not-Doing bullet. A `consider`-severity finding still applies to incidental matches; promote to `required` if the match is on more than one signal category. |
| "But the user asked for this in mid-slug — I added it because the user wanted it." | User mid-slug requests are not silent overrides of the plan's Not-Doing section. The correct flow: the user's request triggers an architect bounce that edits the Not-Doing bullet (per Sub-check 2's acknowledged-reversal shape); the architect's plan-amend commit records the user's request as the reason. The builder may then implement the now-included scope. Building first and acknowledging never is exactly the kind of unrecorded scope creep this axis catches — and the lack of a paper trail makes compound's later learnings extraction impossible. |

## Red flags

- A Not-Doing bullet whose `<scope item>` token appears in three or more of the four signal categories (file path + symbol + AC text + commit message) — severity=required immediately; mark as strong signal in the finding description.
- A Not-Doing bullet whose `<scope item>` matches a file path that contains the literal token AND the file is a new file (created in this slug's diff, not pre-existing) — severity=required. New files dedicated to the excluded item are the strongest possible signal.
- A Not-Doing bullet whose `<scope item>` matches in the diff AND the plan has no `## Open questions` / `## Decisions` row acknowledging the reversal AND no plan-amend commit landed — severity=required (the silent-reversal path; the axis's primary failure mode).
- Three or more open `scope-drift` rows on a single slug — collapse the rows under a single umbrella finding "build is drifting from declared exclusions" (severity=required, axis=scope-drift) until the architect re-authors the Not-Doing section. Three+ rows is structural evidence that the plan's scope contract is broken on more than one axis, not just one.
- A scope-drift finding `Status: closed` with a citation that does not point to either (a) a revert commit removing the excluded surface OR (b) a plan-amend commit acknowledging the reversal. Closing without the right shape of citation is itself an `axis=correctness, severity=required` meta-finding ("ledger row closed without evidence" per the reviewer's hard rules) and re-opens the SD-N.

## Worked example

A reviewer iteration that fires Sub-check 1 might produce:

```markdown
F-14 scope-drift/required — src/lib/cache.ts:* — `## Not Doing (and why)` bullet 2 reads `- **caching layer** — out of scope this round; tiered cache work tracked in #4421.` The diff adds `src/lib/cache.ts` (new file, 87 lines exporting `CacheClient` / `CacheStore`); `git log --grep="cache" --oneline` returns `7a91ab2 feat: add cache wrapper for hot endpoints`; `plan.md > ## Plan / Slices > SL-3 (Surface: src/lib/cache.ts, src/api/list.ts)`. Three signal categories matched (file path + symbol + commit message); grade 8/10 (strong signal). No acknowledged reversal in `## Open questions` or `## Decisions`.
→ Recommended fix: architect bounce — amend Not-Doing bullet 2 to acknowledge the reversal (e.g. `- **caching layer** — was originally excluded; re-included after the hot-endpoint benchmark in SL-2 showed p95 > 500ms; see D-4.`) AND add D-4 to `## Decisions` documenting the rationale + reversibility. OR revert SL-3's `src/lib/cache.ts` commit and route the hot-endpoint perf work to a follow-up slug.
```

A Sub-check 2 acknowledged-reversal example (FYI only):

```markdown
F-15 scope-drift/fyi — src/components/Pagination.tsx — `## Not Doing (and why)` bullet 1 reads `- **pagination** — was originally excluded; re-included after triage feedback on the user list; see D-2.` Diff implements pagination per D-2's call. Reversal is acknowledged at plan.md `## Decisions > D-2`.
→ No action required. FYI surfaces for compound's learnings.md capture: "pagination re-included mid-slug after triage feedback" is a recurring pattern worth tracking.
```
