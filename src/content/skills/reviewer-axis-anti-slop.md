---
name: reviewer-axis-anti-slop
trigger: gated reviewer axis. Default-on for every reviewer iteration unless the dispatch envelope explicitly turns it off (`walkAntiSlopAxis: false`). The orchestrator stamps the flag as `true` by default — the axis always fires on `code` / `text-review` / `integration` / `release` / `adversarial` mode reviews so the Karpathy "Simplicity First" principle is checked once per slug regardless of triage surface. Structurally skipped on `ceremonyMode: inline` (no review.md at all) and on builds whose diff is structurally empty (doc-only single-character fix).
---

# Skill: reviewer-axis-anti-slop

Full rubric, evidence-collection guidance, and severity matrix for the reviewer's `anti-slop` axis. Lifted out of `reviewer.ts` at axis introduction — the prompt carries only a 5-line stub pointing here.

The `anti-slop` axis is the cclaw projection of Andrej Karpathy's **Simplicity First** principle (`forrestchang/andrej-karpathy-skills > CLAUDE.md`): "Minimum code that solves the problem. Nothing speculative. No features beyond what was asked. No abstractions for single-use code. No 'flexibility' or 'configurability' that wasn't requested." Karpathy's litmus test — *"Would a senior engineer say this is overcomplicated? If yes, simplify."* — is operationalised here as a four-dimension rubric the reviewer grades 0-10 on every diff.

The axis sits alongside the existing `complexity-budget` axis but is **distinct**: complexity-budget asks "is this change pulling its weight?" (per-AC ROI), anti-slop asks "is the shape of this change Karpathy-simple?" (per-diff aesthetic). A clean diff that earns full marks on complexity-budget (the AC justifies the change) can still fail anti-slop (the implementation overshoots — extension points, single-use abstractions, leftover scaffolding). The two axes catch different failure modes and the orchestrator never collapses them.

## When to use

Pinned to the reviewer's dispatch envelope by default. The orchestrator stamps `walkAntiSlopAxis: true` on every reviewer dispatch unless the user or a project config explicitly disables it via `walkAntiSlopAxis: false`. The skill loads on every iteration block; the reviewer's prompt body has a 5-line stub naming this skill; the full four-dimension grading protocol lives here.

## When NOT to apply

- `ceremonyMode: inline` — the inline path does not invoke the reviewer at all; the axis is structurally skipped.
- The dispatch envelope explicitly carries `walkAntiSlopAxis: false` — the user opted out (typically for a single tightly-scoped slug where the axis would only add noise; the default contract is `true`).
- The diff is structurally empty (e.g. a one-character typo fix in a markdown file). No code shape to grade; emit zero findings and note `anti-slop: skipped (structurally-empty diff)` in the iteration block.
- The diff consists entirely of files under the no-grade exclusion set (`*.md` / `*.json` / `*.yml` / `*.toml` / config dotfiles / `.cclaw/**` / `.github/**` / `docs/**`) AND the AC is `docs-only` posture. No production code to grade; emit zero findings; note `anti-slop: skipped (docs-only posture, no production code in diff)` in the iteration block.

## Process

**Sub-check 1 — Senior-test grading (0-10).** Read the entire diff with the question "would a senior engineer say this is overcomplicated?". Grade 0-10 on whether the diff's size and shape match the conceptual size of the change. Reference points:

- **10/10** — diff size matches the conceptual size of the change exactly (a one-line conditional fix lands as a one-line diff; a new endpoint lands at the minimal surface the AC required, not the maximal surface a 'proper' endpoint 'should' have). A senior reviewer would say "this is the minimum that works".
- **6-9/10** — diff is broadly appropriate but carries some over-engineering (one extra abstraction layer; one config flag that wasn't required; one helper that could be inlined). The senior reviewer would say "looks fine, could be tighter".
- **3-5/10** — diff is meaningfully larger than the conceptual change requires (the simpler-thing was clearly available; the diff added structure the AC did not require). The senior reviewer would say "this could be half the size".
- **0-2/10** — diff is dramatically over-engineered (200 lines doing the work of 50; new manager classes / config layers / strategy patterns for a one-call site; the AC's behavioural test would pass on a 30%-smaller version trivially). The senior reviewer would say "rewrite this".

Cite the file:line of the worst over-engineering. The 0-10 grade is the **anchor for severity** (see Sub-check 5 below); below-6 grades become findings.

**Sub-check 2 — Speculative-flexibility grading (0-10).** Walk the diff looking for extension points, hooks, callback signatures, config layers, "pluggable" interfaces that have no concrete current consumer. Grade 0-10 on whether every flexibility the diff introduces is justified by a current consumer:

- **10/10** — every options object key / config row / callback parameter / 'pluggable' interface in the diff has at least one current concrete consumer naming it. No `options?: { ... }` parameter with all-optional fields and zero callers passing them. No `Strategy` / `Provider` / `Factory` abstraction whose only concrete implementation is the one the AC needed.
- **6-9/10** — flexibility is broadly justified, with one or two speculative additions (an unused config row; a callback signature with a `// for future use` comment). The senior reviewer would say "drop the unused bits".
- **3-5/10** — meaningful speculative flexibility (multiple unused config rows; an interface with no second implementation; an environment-driven branch with no consumer setting the env var). The senior reviewer would say "remove the flexibility that has no caller".
- **0-2/10** — diff is structured as if the unmet hypothetical future was the primary requirement (a Strategy pattern around a single implementation; a config-driven dispatcher with one entry; a hook system with no subscribers). The senior reviewer would say "this is built for a future that may never come".

Cite the file:line of each speculative surface. Below-6 grades become findings.

**Sub-check 3 — Single-use-abstraction grading (0-10).** Walk the diff looking for helpers / classes / modules / hooks introduced by the diff that are used exactly once but parameterized as if they had ≥2 callers. Grade 0-10 on whether each abstraction is justified by current reuse OR explicit AC requirement:

- **10/10** — every helper / class / module / hook introduced by the diff is called by ≥2 distinct call sites OR the AC explicitly required the abstraction (e.g. an interface extracted to enable mocking in a named test). No `extractFooHelper` whose body is two lines used in one place. No class whose body is a single method called from one call site.
- **6-9/10** — one borderline single-use abstraction (a helper used once but with a name that implies future reuse; a class whose single method could be a function). The senior reviewer would say "consider inlining or simplifying".
- **3-5/10** — multiple single-use abstractions (≥2 helpers used once each; ≥3 levels of indirection where ≤1 would do). The senior reviewer would say "collapse these layers".
- **0-2/10** — abstraction is the structural feature of the diff (an `XManager` / `XService` / `XProvider` whose body is a thin wrapper around a single function; multiple wrapper layers around what should be one direct call). The senior reviewer would say "this is abstraction-for-abstraction's-sake".

Cite the file:line of each single-use abstraction. Note explicitly when an abstraction is justified by AC-required mocking / extension — the grade is on the diff's shape, not on intent. Below-6 grades become findings.

**Sub-check 4 — Orphan-cleanup-discipline grading (0-10).** Walk the diff looking for orphan code that THIS diff created (imports / variables / functions / files made unused by THIS change) AND for leftover scaffolding from an earlier iteration of the same slug. ALSO walk the diff looking for **pre-existing** dead code that was silently deleted (Karpathy's "remove only your own mess" rule — don't drive-by-clean unrelated dead code; mention it in `## Summary > Things I noticed but didn't touch` instead). Grade 0-10:

- **10/10** — every import / variable / function / file orphaned BY this diff is removed in the same diff (unused imports stripped; functions that lost their only caller deleted; type aliases that lost their only reference removed); no leftover scaffolding from an earlier iteration of THIS slug; pre-existing dead code that THIS diff did not create is NOT silently deleted — it is either mentioned in build.md's `## Summary > Things I noticed but didn't touch` OR left untouched.
- **6-9/10** — one or two orphans left behind (an unused import; a type alias with no remaining consumer); OR one drive-by deletion of pre-existing dead code without acknowledgement. The senior reviewer would say "clean up the leftovers" or "you didn't create that orphan — leave it".
- **3-5/10** — meaningful orphan rot (≥3 unused imports / vars; leftover scaffolding from a half-written earlier iteration; OR ≥2 drive-by deletions of pre-existing dead code unrelated to the AC). The senior reviewer would say "this diff is not clean".
- **0-2/10** — diff carries substantial dead weight (half-written features the AC dropped; commented-out blocks; orphan files; OR the diff is half-cleanup of unrelated pre-existing dead code that the orchestrator never asked for). The senior reviewer would say "split this into 'the AC change' and 'the cleanup' — they don't belong in one commit".

Cite the file:line of each orphan or drive-by deletion. Below-6 grades become findings.

**Sub-check 5 — Severity grading (0-10 → severity; cap-at-consider).** Every below-6 dimension grade maps to `severity = consider` — full stop. The ramp collapses to a hard cap:

- **5/10** — severity = `consider`. Author may push back with reason; carries to learnings.md if unaddressed.
- **3-4/10** — severity = `consider` (was `required`). Same carry-over rule.
- **0-2/10** — severity = `consider` (was `required`-or-`critical`-escalation). No tier escalation on `triage.complexity == "critical"`; the 0-2/10 grade still surfaces the structural over-engineering signal in the Findings table, but no ship gate fires.

The cap is the over-engineering-audit response: anti-slop dimensions surface **qualitative simplicity signals** (Karpathy's "would a senior engineer say this is overcomplicated?") rather than load-bearing correctness gaps, and the blocking ladder was the dominant false-positive surface in the audit. The cap is "safer than default-off": the signal still reaches `review.md` Findings AND `learnings.md` AND any downstream compound learnings; the human still sees the feedback; but the axis never returns a blocking decision. To re-enable blocking on a specific slug (rare), file the same surface separately as a `required + axis=complexity-budget` finding — the cap is anti-slop-axis-only, not on the cross-cutting `complexity-budget` axis (which still escalates per the standard cclaw severity ladder when the AC-vs-ROI math fails).

A finding with grade `5/10` may still be downgraded to `nit` if the author's push-back includes a citation that the over-engineering is required by an AC's named technical constraint (e.g. "the `OptionsParser` class is single-use today but AC-3 of THIS slug names the second call site landing in SL-4"). The downgrade requires the citation; "looks fine to me" without evidence is not enough. The cap-at-consider rule is the maximum severity the axis emits; downgrades below `consider` (to `nit` / `fyi`) remain available when the citation supports them.

**Sub-check 6 — Finding shape.** File findings in the iteration block's Findings table as `AS-N: <dimension> at <grade>: <description>`. Example: `AS-1: speculative-flexibility at 3/10: src/lib/cache.ts:14-22 exports a Strategy interface with one concrete implementation (`MemoryCacheStrategy`) and no second caller; recommended fix — inline the strategy into the consumer or drop the interface and call the concrete class directly`. The `AS-` prefix is the anti-slop axis's namespace inside the reviewer's broader `F-N` ledger (an `AS-N` is filed as `F-N axis=anti-slop severity=<grade>` in the Findings table; the AS-prefix is the axis-local mnemonic recommended in the description body, mirroring the SD-N / KA-N convention).

## Common rationalizations

Cross-cutting rows live in `.cclaw/lib/anti-rationalizations.md`; the four rows below are anti-slop-axis-specific to this gate:

| rationalization | rebuttal |
| --- | --- |
| "But the abstraction is ready for the second consumer we'll add in the next slug." | "Next slug" is the canonical speculative-flexibility tell. If the second consumer is actually in the next slug, build it then — the cost of inlining now and extracting later is lower than the cost of carrying an unused interface. If the second consumer is not yet committed to a slug (no plan.md, no AC, no roadmap row), the abstraction is hypothetical and the grade stands. The fix is to inline the single-use abstraction and rebuild the interface when the second consumer actually lands. |
| "But the unused config row documents the future configurability — it's better than nothing." | A config row with no consumer is documentation that lies. The next agent reading the file sees an option that should work, tries to use it, and discovers the dispatcher doesn't honour it. The fix is to either (a) wire a real consumer in THIS slug, OR (b) drop the row and document the future configurability in plan.md's `## Future work` section (where it is correctly classed as not-yet-built). |
| "But the orphan import / variable will be used again two iterations from now — leaving it saves the re-add." | Orphans cost more than the re-add. They confuse the next reader, they trip up grep / rg / import-checker tooling, and they decay (the symbol they reference may move or rename). The fix is to remove the orphan; the re-add is one line of typing. If the symbol is truly load-bearing for the next iteration, mention it in `## Summary > Things I noticed but didn't touch` so the future iteration knows to re-import. |
| "But the diff IS the simplest version — every line is required by the AC." | The grade is the reviewer's call, not the author's. Every line being required is the **default state for 10/10** — the grade drops when the diff has lines that are NOT required (extension points, single-use wrappers, leftover scaffolding). If the author believes every line is required and the reviewer graded below 6, the productive path is to walk through the diff line-by-line in the next iteration's `What's done well` section and cite which AC clause requires each non-obvious line. The exercise of citing usually surfaces the lines that are NOT required. |

## Red flags

Each red flag below names a low-grade pattern the axis still calls out as a finding; per the cap-at-consider rule, severity is **always `consider`** even when the underlying grade is 0-3/10. The "grade" column drives the iteration block's grading table (and the learnings capture), not a ship gate.

- A new `XManager` / `XService` / `XProvider` / `XStrategy` / `XFactory` / `XProvider` class introduced by the diff whose body is a single method called from one call site — severity = `consider` (grade ≤3 on single-use-abstraction).
- A new `options?: { ... }` parameter where every field is optional AND no caller in the diff passes any of the fields — severity = `consider` (grade ≤3 on speculative-flexibility).
- A new exported interface / type with one concrete implementation in the diff AND no place in the codebase that imports the type symbol distinct from its single implementation — severity = `consider` (grade ≤3 on speculative-flexibility).
- A diff that contains both the AC-required change AND ≥10 lines of cleanup of pre-existing dead code unrelated to the AC — severity = `consider` (grade ≤4 on orphan-cleanup-discipline; the cleanup should be its own slug; "remove only your own mess").
- A diff that adds ≥3 levels of indirection (function → method → strategy → implementation) where the AC needed ≤1 level — severity = `consider` (grade ≤3 on single-use-abstraction).
- A diff whose total LOC is ≥3× the conceptually-simplest implementation visible from the AC + plan.md — severity = `consider` (grade ≤3 on senior-test). The 3× multiplier is the senior-test's structural threshold: at ≥3× simplicity-ratio, even a sympathetic senior reviewer would push back — the finding still surfaces to learnings, the cap-at-consider rule just keeps it from ship-gating.

## Worked example

A reviewer iteration that fires Sub-check 2 might produce (note `severity=consider` even at grade 3/10):

```markdown
F-7 anti-slop/consider — src/lib/cache.ts:14-22 — AS-1: speculative-flexibility at 3/10. The diff exports a `CacheStrategy` interface with one concrete implementation (`MemoryCacheStrategy` at src/lib/cache.ts:24-40) and zero second callers. The AC required "add a cache for the hot endpoints" — the interface adds a layer of indirection that the AC did not ask for. No second strategy is committed to a future slug; the next-slug roadmap (plan.md > ## Future work) does not name a second cache backend. Karpathy "Simplicity First" rebuttal: the second strategy belongs to the slug that actually adds it; today's diff should drop the interface and call MemoryCacheStrategy directly. The finding surfaces here for learnings.md; cap-at-consider, it does NOT block ship.
→ Recommended fix: inline `MemoryCacheStrategy`'s logic into the cache module and drop the `CacheStrategy` interface. If a second backend genuinely lands in a follow-up slug, re-extract the interface then. Cost of re-extraction is ~10 lines; cost of carrying the unused interface is permanent cognitive overhead.
```

A Sub-check 4 orphan-cleanup-discipline example (still `consider`):

```markdown
F-8 anti-slop/consider — src/lib/permissions.ts:12 — AS-2: orphan-cleanup-discipline at 4/10. The diff deletes `legacyHasViewEmail` (pre-existing helper at the now-deleted line 12-18), which was NOT created by this slug — it was a pre-existing dead code surface that THIS diff stumbled upon. The AC was "add tooltip permission check"; the diff legitimately added `hasViewEmail` (lines 14-22) but ALSO deleted unrelated pre-existing dead code. Karpathy "Surgical Changes" rebuttal: remove only orphans YOUR changes created; mention pre-existing dead code in `## Summary > Things I noticed but didn't touch`.
→ Recommended fix: revert the `legacyHasViewEmail` deletion in a separate commit, OR move the pre-existing dead code cleanup to its own follow-up slug (with its own AC for "remove unused legacyHasViewEmail helper"). The current diff conflates two changes; split them.
```

A Sub-check 3 single-use-abstraction example downgraded to `consider`:

```markdown
F-9 anti-slop/consider — src/lib/clock.ts:8-14 — AS-3: single-use-abstraction at 5/10. The diff adds `makeFixedClock(date)` (lines 8-14) used only in the new test fixture at `tests/unit/permissions.test.ts:42`. Borderline: the helper is single-use AND the helper's only call site is a test, which the cclaw test-quality axis explicitly allows (mocking at the test boundary). The grade is 5/10 not 4 because the helper IS at the test boundary — Karpathy's "Surgical Changes" rule permits boundary helpers when they aid test readability.
→ Recommended fix (optional, severity=consider): consider inlining `makeFixedClock` into the test (one-line `vi.setSystemTime(new Date("2026-04-18T10:14Z"))`). Push-back acceptable if the helper is genuinely cleaner than the inline call.
```

## Edge cases

- **The diff is intentionally over-engineered to support a critical-load-bearing AC.** Some ACs genuinely require a Strategy pattern (e.g. "the orchestrator must support N pluggable storage backends; the AC's tests verify the dispatch on at least 2 of them"). When the AC explicitly names the abstraction as a deliverable, grade the abstraction as 10/10 even when the diff only ships one concrete implementation — the second one is committed to a follow-up slug within the same plan's `## Future work` and the abstraction is load-bearing today.
- **The diff lands as the first slug of a multi-slug refactor sequence.** The orchestrator dispatches multi-slug sequences as separate slugs; the first slug's diff may introduce abstractions that are single-use in THAT slug but become multi-use as later slugs land. The rule: the first slug's abstraction earns the second-caller credit ONLY when the multi-slug sequence is explicitly named in plan.md > `## Plan / Slices` AND the later slug's AC names the second consumer verbatim. Otherwise the single-use grade stands.
- **The diff is a pure refactor (`refactor-only` posture).** Refactor-only slugs intentionally restructure code; the anti-slop axis still fires but the grading is **comparative** — is the post-refactor shape simpler than the pre-refactor shape? If the refactor introduces NEW abstractions while collapsing OLD ones, grade on the net shape. A refactor that nets to "more abstraction layers than before, same observable behaviour" is exactly the failure mode this axis catches.
- **The diff is a doc-only slug (`docs-only` posture).** Skip the axis silently; no production code to grade. The orchestrator's `anti-slop: skipped (docs-only posture)` note in the iteration block is honest; do not invent findings.
