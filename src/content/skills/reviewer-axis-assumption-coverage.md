---
name: reviewer-axis-assumption-coverage
trigger: gated reviewer axis (v8.85). Loads only when the assumption-coverage gate fired — `walkAssumptionCoverageAxis: true` on the dispatch envelope, set by the orchestrator when `flows/<slug>/plan.md > ## Key assumptions to validate` carries ≥1 bullet with a `KA-N` id. Structurally skipped on legacy plans authored pre-v8.80 (no `## Key assumptions to validate` section at all), on plans whose section is empty / template-placeholder-only, and on `ceremonyMode: inline` (no plan.md exists).
---

# Skill: reviewer-axis-assumption-coverage

Full rubric, evidence-collection guidance, and severity matrix for the reviewer's `assumption-coverage` axis (v8.85). Lifted out of `reviewer.ts` at axis introduction — the prompt carries only a 5-line stub pointing here.

The `assumption-coverage` axis is the ex-post enforcement of the plan's `## Key assumptions to validate` declarations. v8.80 promoted `## Key assumptions to validate` to a first-class plan-template section and plan-critic §6.5 gates ship on the section being non-empty (2-5 bullets naming bets the plan rests on, each pairing a validation method with an `unvalidated | validated | invalidated` status). v8.85 adds two changes:

1. **Stable `KA-N` ids** on every bullet (Key Assumption N — `KA-1`, `KA-2`, ..., monotonically numbered) so the builder, reviewer, and ship template can cross-reference rows by id.
2. **Closure loop** — the builder's `verify(AC-N): passing` commits MAY carry an optional `validates: KA-N [KA-M ...]` payload that flips the matching KA-N row to `Status: validated by <sha>` via the flow-state validator (`src/assumption-validation.ts`).

The `assumption-coverage` axis closes the post-build half: it cross-checks that every **high-stakes** KA-N row has at least one validating commit before ship, and surfaces unmeasured bets to the user via the ship template's `## Unvalidated assumptions` section. Sourced from gstack `/devex-review` boomerang pattern (a verify commit can "validate" an earlier assumption row, flipping status atomically) and the addyosmani `idea-refine` Phase Key-Assumptions-to-Validate discipline (every roadmap rests on bets; surface what would invalidate them).

## When to use

Pinned to the reviewer's dispatch envelope when `walkAssumptionCoverageAxis: true` is set. The orchestrator inspects `flows/<slug>/plan.md` at dispatch time, detects ≥1 KA-N-shaped bullet in the `## Key assumptions to validate` section, and passes `walkAssumptionCoverageAxis: true` to `buildAutoTriggerBlock("review", env)`. The skill loads only then. The reviewer's prompt body has a 5-line stub naming this skill; the full per-row cross-check protocol lives here.

## When NOT to apply

- `flows/<slug>/plan.md` has no `## Key assumptions to validate` section at all (legacy plan authored pre-v8.80) — axis skipped silently; emit zero findings. The orchestrator does NOT set the envelope flag, the skill body does not load, and the iteration block notes `assumption-coverage: skipped (legacy plan, no Key assumptions section)`. The back-compat rule preserves shipped-state correctness on flows authored before the v8.80 promotion.
- `ceremonyMode: inline` — no plan.md exists, no `## Key assumptions to validate` to cross-reference; axis is structurally skipped. The orchestrator does not set the envelope flag on inline-mode dispatches.
- `## Key assumptions to validate` section present but **every** bullet is legacy-shaped (no `KA-N` id) — gate still fires (the section is non-empty), but the axis emits a single `consider`-severity finding citing `key-assumptions-no-id` from plan-critic §6.5 and stops walking the per-row protocol. The closure loop is structurally disabled without ids; the fix is a plan-amend that adds ids per the v8.85 template format. Note `assumption-coverage: gate fired but no KA-N ids; cited key-assumptions-no-id` in the iteration block.
- `## Key assumptions to validate` section present, KA-N ids present, but every row's status is already `validated` (every bullet flipped by an earlier `validates: KA-N` payload) — axis fires the gate, walks the protocol, finds nothing to file, and notes `assumption-coverage: all KA-N rows validated; no findings` in the iteration block.
- The diff is a fix-only iteration (reviewer iteration ≥ 2; builder bounced on prior findings) AND the prior iteration's assumption-coverage axis was already walked AND closed — re-walking on every iteration is redundant. The axis still re-renders to confirm no NEW assumptions were silently flipped or invalidated, but findings from prior iterations stay closed unless the new fix-only commits re-introduced the gap.

## Process

**Sub-check 1 — Per-KA-N-row validation cross-check.** Read `plan.md > ## Key assumptions to validate` and enumerate every bullet. Each v8.85-shaped bullet has the shape `- **KA-N** — <assumption>. Validate by: <method>. Status: <unvalidated | validated | invalidated [by <sha>]>.` (the plan-template format plan-critic §6.5 enforces, with the v8.85 KA-N prefix and optional post-flip SHA citation). Parse the KA-N id, the assumption clause, the validation method, the current status, and the optional `(high-stakes)` label on the assumption.

For each KA-N row, scan the build range's verify-commit log for matching `validates:` payloads:

1. **Verify-commit scan** — `git log --grep="^verify(AC-" --format="%H%n%B%n---END---"` against the build range. For each verify commit, parse the body for a `validates:` line (case-insensitive; tolerant of comma or space separators inside the value list). The payload's KA-N ids name the rows the commit claims to validate.
2. **Cross-reference** — for each KA-N row in plan.md whose `Status` is still `unvalidated`, check whether at least one verify commit's `validates:` payload names the row's id. The match is a closure: the row is genuinely validated by the commit.

A KA-N row whose status is `unvalidated` AND has zero validating commits is an **assumption-coverage finding** (severity = `required` when the row carries the `(high-stakes)` label; severity = `consider` otherwise). File findings as `KA-N: not validated by any commit despite high-stakes label` (or `KA-N: not validated by any commit` for non-high-stakes rows), citing the row's text verbatim + the build range's verify-commit count (`0 verify commits carried "validates: KA-N"`). Numbering: the `KA-N` token is the row's own id; the finding's `F-N` is the reviewer's ledger id (the two namespaces coexist — `F-7 axis=assumption-coverage` carries the body that names `KA-2`).

**Sub-check 2 — False-positive `validates:` payload check.** When a verify commit's `validates: KA-N` payload claims to validate a row whose validation method names a test / benchmark / log query the commit's diff does NOT touch, the payload is a **false positive** — the builder bolted a `validates:` line onto a verify commit whose evidence doesn't actually prove the bet. Two flavours:

- **The claimed KA-N row doesn't exist** (the plan has no row with that id) — emit a `required`-severity finding (class=`validates-payload-references-missing-ka-row`). Cite the verify commit's SHA + the row id verbatim. The fix is a builder re-commit that drops or corrects the payload.
- **The claimed KA-N row exists but the verify commit's diff doesn't touch the validation method's anchor** — e.g. KA-2's `Validate by:` clause names `vitest bench: search-load.json p95 budget`, but the verify commit's diff is an empty marker commit OR touches a test file unrelated to `search-load.json`. Emit a `required`-severity finding (class=`validates-payload-false-positive`). Cite the row's validation method + the commit's diff anchor. The fix is either a fresh verify commit that ACTUALLY runs the validation method, or dropping the false-positive `validates:` line.

The false-positive check is the asymmetric guard against `validates:` payload abuse — without it the builder could silently flip rows to `validated` by stapling `validates: KA-N` onto every verify commit. The axis's `required` severity on false positives mirrors the v8.84 scope-drift axis's silent-reversal rule: the closure loop is the user-facing contract, and bypassing it without evidence is a `required` finding.

**Sub-check 3 — Unknown-id payload check.** When the verify-commit log carries a `validates: KA-N` payload for a `KA-N` id the plan does NOT have (typo on the builder's part; the plan was edited mid-build to renumber rows; the builder cited `KA-99` against a 3-row section), the orchestrator's flow-state validator silently ignores the payload (per `flipAssumptionRows`'s contract — unknown ids are dropped). The reviewer's job is to surface the unknown-id payload as a `consider`-severity finding (class=`validates-payload-unknown-ka-id`) so the builder can re-issue the verify commit with the correct id OR amend the plan. The finding is `consider` rather than `required` because the resulting state is honest (the row stays `unvalidated`; no silent over-validation occurred) — but the user still benefits from seeing the typo.

**Sub-check 4 — Unvalidated-rows ship handoff.** Compile the list of KA-N rows whose status is STILL `unvalidated` after the build's verify-commit scan completes (the rows that no `validates:` payload flipped, AND that weren't manually flipped to `validated` / `invalidated` in plan.md). Pass the list to the ship-stage compose: the ship template's `## Unvalidated assumptions` section is populated from this list (see `src/content/artifact-templates.ts > SHIP_TEMPLATE`). The reviewer's job in Sub-check 4 is **structural**: confirm the section is populated when ≥1 KA-N row remains unvalidated; emit a `consider`-severity finding (class=`ship-missing-unvalidated-assumptions`) when the ship-stage compose forgot to surface the rows.

The reviewer does NOT file findings against rows that remain `unvalidated` but are NOT `(high-stakes)`-labelled — non-high-stakes bets are explicitly allowed to ship unvalidated (the user signs off via the ship template's surface, not via an axis finding). The axis's required-severity findings concentrate on the high-stakes rows; non-high-stakes rows ride through as `consider`-severity, advisory only.

## Common rationalizations

Cross-cutting rows live in `.cclaw/lib/anti-rationalizations.md`; the four rows below are assumption-coverage-axis-specific to this gate:

| rationalization | rebuttal |
| --- | --- |
| "But the high-stakes label is just a guideline — the row isn't really load-bearing." | The `(high-stakes)` label IS the architect's contract that the bet is load-bearing on the plan. If the label is wrong, the fix is a plan-amend that removes the label (architect bounce; one-line edit). Silently shipping with the label present and the row `unvalidated` is exactly the rationalization the axis exists to catch — the label was the architect's explicit "validate before ship" call, and the reviewer's job is to honor it. |
| "But the AC's tests implicitly validate the KA row — they cover the same surface." | Implicit coverage IS NOT validation. The `validates: KA-N` payload is the explicit closure signal; without it, the flow-state validator does not flip the row, the ship template's `## Unvalidated assumptions` section still lists the row, and the user has to mentally trace the AC tests to the KA bullet. The fix is a one-line edit to the verify commit's message body — `git commit --amend` adds the `validates: KA-N` line. Cheap when the test really does cover the bet; correct because the closure is now visible. |
| "But the row reads `Status: validated` already — the post-impl critic flipped it manually." | Manual flips are valid (the reviewer / critic / post-ship learnings.md can rewrite the status as evidence lands), but the flow-state validator's automatic flips carry the SHA citation that makes the closure auditable. Surface the manual flip as a `consider`-severity finding (class=`manual-flip-no-sha-citation`) suggesting the future shape is a `validates:` payload on a verify commit. Don't block ship on the manual flip — the row IS validated; surface the audit-trail gap as advisory. |
| "But the plan has zero `(high-stakes)`-labelled rows — the axis has nothing to find." | Correct, but the axis still files Sub-check 2 / Sub-check 3 findings (false-positive payloads, unknown-id payloads) regardless of high-stakes labels. Don't skip the axis; walk it, find zero high-stakes findings, file any false-positive / unknown-id findings, and note `assumption-coverage: walked; zero high-stakes rows; <N> payload-shape findings` in the iteration block. The label drives Sub-check 1's severity, not whether the axis fires. |

## Red flags

- A KA-N row carrying the `(high-stakes)` label AND `Status: unvalidated` AND zero `validates: KA-N` payloads in the build range — severity = `required` immediately; the canonical Sub-check 1 finding shape.
- A `validates: KA-99` payload (or any KA-N id that does not exist in the plan) on a verify commit — severity = `consider` (Sub-check 3 unknown-id finding); the closure is silently dropped by the flow-state validator, but the audit trail still needs the surface.
- A `validates: KA-N` payload on a verify commit whose diff is an empty marker AND the KA-N row's `Validate by:` clause names a benchmark / test the verify commit's diff doesn't touch — severity = `required` (Sub-check 2 false-positive finding); the payload claims a closure the evidence doesn't support.
- More than 50% of the plan's KA-N rows still `unvalidated` at ship time AND the ship template's `## Unvalidated assumptions` section is missing — severity = `required` (Sub-check 4 ship-missing-unvalidated-assumptions finding); the user's "known-unmeasured-bets" surface was silently dropped.
- A verify commit's body carries a `validates:` line that names a non-KA-N token (e.g. `validates: SL-2` or `validates: AC-3`) — severity = `consider`; the line was probably meant to be a different namespace (the builder confused slice / AC / KA ids). Surface as a `validates-payload-wrong-namespace` finding suggesting the canonical shape.

## Worked example

A reviewer iteration that fires Sub-check 1 might produce:

```markdown
F-9 assumption-coverage/required — `plan.md > ## Key assumptions to validate > KA-2` — KA-2 reads `- **KA-2** — search p95 stays under 200ms under realistic load (high-stakes). Validate by: vitest bench against tests/fixtures/search-load.json at 100 RPS. Status: unvalidated.` Build range carries 4 `verify(AC-*): passing` commits; `git log --grep="^verify(AC-" --format=%B` shows zero `validates: KA-2` payloads. Row is high-stakes and load-bearing on the plan's perf budget; required severity per Sub-check 1.
→ Recommended fix: builder amends `verify(AC-3): passing` to add `git commit --amend -m "verify(AC-3): passing" -m "validates: KA-2" -m "vitest bench result: search p95 = 142ms (budget 200ms)"`. The amend lets the flow-state validator flip KA-2 to `Status: validated by <sha>` automatically on the next pass.
```

A Sub-check 2 false-positive example:

```markdown
F-10 assumption-coverage/required — `plan.md > ## Key assumptions to validate > KA-3` — `verify(AC-4): passing` (commit `8b9c0d1`) carries `validates: KA-3`, but KA-3's `Validate by:` clause names `vitest bench against tests/fixtures/search-load.json`. The commit's diff is empty (`git show --stat 8b9c0d1` shows zero files); no benchmark was actually run. False-positive payload — the closure is unsupported by evidence.
→ Recommended fix: builder either (a) authors a fresh `verify(AC-4): passing` commit whose diff actually runs the benchmark and asserts the budget (replacing the empty marker), OR (b) `git rebase -i` drops the `validates: KA-3` line from the existing commit body. Either fix re-runs the flow-state validator's pass; the latter leaves KA-3 `unvalidated`, which is honest.
```

A Sub-check 4 ship-handoff example:

```markdown
F-11 assumption-coverage/consider — `ship.md > ## Unvalidated assumptions` — Ship template was composed with 3 KA-N rows still `unvalidated` (KA-1, KA-3, KA-5), but the `## Unvalidated assumptions` section is missing entirely. The user's "known-unmeasured-bets" surface was silently dropped at ship time.
→ Recommended fix: ship-stage compose re-runs and populates the section with the unvalidated rows verbatim (one bullet per row, citing the row text + the validation method + the `unvalidated at ship time` status). Surfacing the rows lets the user accept-warns-and-ship knowingly rather than silently.
```
