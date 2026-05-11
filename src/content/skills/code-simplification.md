---
name: code-simplification
trigger: stage=build during the REFACTOR step of `tdd-and-verification` (per-AC in strict, per-feature in soft); stage=review when the reviewer cites a `complexity-budget` or `readability` finding; stage=build during the fix-only loop when slice-builder is restoring behaviour
---

# Skill: code-simplification

Simplification reduces complexity **while preserving behaviour exactly**. The goal is not fewer lines — it is code a next agent (or human) understands faster than the original. Every simplification carries a test: "would a teammate reading the diff approve this as a net improvement, not a stylistic preference?"

This skill is cclaw's canonical home for the simplification slot that pre-v8.27 was spread between the REFACTOR step of `tdd-and-verification` and the reviewer's `complexity-budget` / `readability` axes. The slot was real; the surface was scattered. This skill collects the rules in one place; the existing surfaces still own *when* simplification runs — REFACTOR runs after GREEN, reviewer-cited simplifications run in fix-only.

## When to use

- **Inside the REFACTOR step of `tdd-and-verification`** (per-AC in strict mode; per-feature in soft mode). After GREEN passes the full relevant suite, walk the diff against this skill's five principles + four-step process. If a simplification is warranted, apply it and commit under `--phase=refactor`. If none is warranted, commit `--phase=refactor --skipped` with a one-line reason citing this skill (e.g. "code-simplification: already clean, no rename/extract/inline opportunities").
- **In the fix-only loop** when the reviewer cited a `complexity-budget` or `readability` finding (severity `consider` or higher). The simplification is the F-N fix; the same RED → GREEN → REFACTOR cycle applies, with the RED being the pre-existing test plus the new finding's "did this break adjacent behaviour?" check.
- **Reviewer-side** when scoring a `complexity-budget` / `readability` finding: cite this skill body for the canonical "is this a real simplification or a stylistic preference?" rubric. The finding's severity is bounded by the rubric — pure-preference renames are `nit`, abstraction-without-consumer is `consider`, abstraction-that-actively-impedes-comprehension is `required`.

**When NOT to use:**

- The code is already clean — do not simplify for the sake of producing a REFACTOR diff. Explicit `--phase=refactor --skipped` with reason is the correct outcome.
- You do not yet understand what the code does — comprehend before simplifying. Apply Chesterton's Fence (see Process step 1).
- The code is performance-critical and a "simpler" version would be measurably slower (cite a benchmark or a `perf` finding from a prior review).
- A rewrite is imminent (next slug touches this surface end-to-end) — simplifying throwaway code wastes effort.
- The change would cross the AC's `touchSurfaces` boundary — surface as a "noticed but didn't touch" entry instead.

## Five principles

1. **Preserve behaviour exactly.** Inputs, outputs, side effects, error paths, ordering, and edge cases stay identical. If you cannot confidently say "yes" to "would all current tests pass without modification?" — do not make the change.
2. **Follow project conventions.** Simplification means consistency with the surrounding codebase, not imposing external taste. Before editing, scan the neighbouring module's style: import order, declaration shape, naming convention, error-handling pattern, type-annotation depth. A change that breaks consistency is churn, not simplification.
3. **Prefer clarity over cleverness.** Explicit code beats compact code when the compact version requires a mental pause to parse. A 5-line if/else chain that reads top-to-bottom beats a nested ternary on one line. Naming an intermediate value beats inlining a complex expression.
4. **Maintain balance — over-simplification is a real failure mode.** Inlining a helper that named a concept makes the call-site harder to read. Merging two simple functions into one with branches is not simpler. Removing a "speculative" abstraction can be right; removing an abstraction that exists for testability or extensibility is a regression. Optimising for line count is the most common over-simplification trap.
5. **Scope to what changed.** Default to simplifying code inside the AC's `touchSurfaces` set. Drive-by simplification of unrelated code creates noisy diffs and risks regressions in surfaces the reviewer is not equipped to verify. The reviewer cites unscoped simplification as a `commit-hygiene` A-4 (drive-by) finding.

## Process

### Step 1 — Understand before touching (Chesterton's Fence)

Before changing or removing anything, understand why it exists. If you see a fence across a road and don't know why it's there, don't tear it down — first understand the reason, then decide if the reason still applies.

Answer these before any edit:

- What is this code's responsibility? What calls it, what does it call?
- What edge cases / error paths does it handle? Are those paths tested?
- Why might it have been written this way — performance? platform constraint? historical reason? a prior reviewer finding?
- `git blame` the lines: what was the original context for the code? Was there a prior shipped slug touching this surface? Read its `learnings.md` if so.

If you cannot answer these, you are not ready to simplify. Read more context first.

### Step 2 — Identify simplification opportunities

Scan for these concrete patterns (each is a signal, not a vague smell):

**Structural complexity:**

| pattern | signal | simplification |
| --- | --- | --- |
| deep nesting (3+ levels of `if` / `for` / `try`) | hard to follow control flow | guard clauses with early return; extract the inner body into a named helper |
| long functions (50+ lines) | multiple responsibilities | split into focused functions with descriptive names; the test suite is the safety net |
| nested ternaries | mental-stack to parse | replace with if/else chain or a lookup table / `Record<Key, Value>` |
| boolean parameter flags (`doThing(true, false)`) | call-site mystery | options object with named fields, OR separate functions per flag combination |
| repeated conditionals (same `if (...)` in 3+ places) | duplicated intent | extract to a named predicate function |

**Naming and readability:**

| pattern | signal | simplification |
| --- | --- | --- |
| generic names (`data`, `result`, `temp`, `val`) | call-site has to read the body to know what it holds | rename to the content (`userProfile`, `validationErrors`) |
| abbreviated names (`usr`, `cfg`, `btn`) | reader must expand | full words, unless the abbreviation is universal (`id`, `url`, `api`, `db`) |
| misleading names (`getX` that also mutates) | function shape lies about the contract | rename to reflect actual behaviour (`getOrCreateX`, `applyXAndReturn`) |
| comments restating the code (`// increment counter` above `count++`) | tautology | delete — the code already says it |
| comments explaining the *why* (`// Retry because the API is flaky under load`) | intent the code can't express | **keep** — these are load-bearing |

**Redundancy:**

| pattern | signal | simplification |
| --- | --- | --- |
| duplicated logic (5+ identical lines in 2+ places) | drift waiting to happen | extract to a shared function, **inside the AC's touchSurfaces** |
| dead code (unreachable branches, commented-out blocks, unused imports / variables) | residue | remove (after confirming truly dead — `git log -p` the line, search for callers) |
| unnecessary wrappers (`async function f() { return await g(); }`) | indirection that adds no value | inline the wrapper |
| over-engineered patterns (factory-for-a-factory, single-strategy strategy pattern) | speculative flexibility | replace with the direct call |
| redundant type assertions (casting to a type already inferred) | noise | remove |

### Step 3 — Apply changes incrementally

Make one simplification at a time. Run the affected-test suite after each change; run the full relevant suite before committing.

- If tests pass → commit (or continue to the next simplification, batched into the same REFACTOR commit).
- If tests fail → **revert and reconsider**. A test failure during simplification means behaviour changed; the principle ("preserve behaviour exactly") was violated. The right next move is to understand what shifted, not to update the test.

Do not batch multiple unrelated simplifications into one untested change. If something breaks, you need to know which simplification caused it. cclaw's per-AC commit chain enforces this naturally: REFACTOR is one commit per AC, and the diff is small enough to bisect mentally.

**Rule of 500.** If a simplification would touch more than ~500 lines, **stop** and surface a planning question. Hand-editing at that scale is error-prone; the right approach is either a codemod / AST transform (which becomes its own slug with its own AC chain) or a deliberate "noticed but didn't touch" surface for the design specialist to schedule.

### Step 4 — Verify the result

After the REFACTOR pass, compare before/after holistically:

- Is the simplified version genuinely easier to understand on a cold read?
- Did the diff introduce any patterns inconsistent with neighbouring code?
- Would the verification gate pass (`tdd-and-verification > verification-loop`)? Run it explicitly — `build → typecheck → lint → test` must all be green.
- Would a reviewer approve this as a net improvement, or would they cite it as `commit-hygiene` A-4 (drive-by) or `complexity-budget` (preference disguised as simplification)?

If the answer to any of these is "no" — revert. Not every simplification attempt succeeds; explicit revert + `--phase=refactor --skipped: attempt reverted, reason=<...>` is the honest record.

## Common rationalizations

The mirror of `tdd-and-verification`'s anti-rationalization table — same shape, simplification-specific entries. Catch yourself thinking the left column; do the right column instead.

| rationalization | truth |
| --- | --- |
| "It's working, no need to touch it." | Working code that's hard to read is hard to fix when it breaks. The REFACTOR step is the audit-trailed place to pay this cost; deferring it pushes the cost onto a future agent who has less context. |
| "Fewer lines is always simpler." | A 1-line nested ternary is not simpler than a 5-line if/else. The metric is comprehension speed on a cold read, not line count. |
| "I'll just quickly simplify this unrelated code too." | Unscoped simplification creates noisy diffs and risks regressions in code you did not intend to touch. Stay inside the AC's touchSurfaces; surface the rest as "noticed but didn't touch". |
| "The types make it self-documenting." | Types document structure, not intent. A well-named function explains *why* better than any type signature explains *what*. Both are useful; neither substitutes for the other. |
| "This abstraction might be useful later." | Speculative abstraction is complexity without a current consumer. Remove it; re-add when an actual second caller appears. The cost of removing-and-readding-later is small; the cost of carrying an unused abstraction is paid every time someone reads the file. |
| "The original author must have had a reason." | Maybe — apply Chesterton's Fence. But accumulated complexity often has *no* reason; it is the residue of iteration under pressure. `git blame` + the surrounding slug's `learnings.md` will tell you which case this is. |
| "I'll refactor while adding the feature." | Mix-refactor-with-feature is the classic anti-pattern. cclaw's TDD cycle enforces the split: GREEN is the smallest production diff; REFACTOR is the named place for the simplification, with its own commit. Mixing them defeats the audit trail and makes the diff unreviewable. |
| "The reviewer will catch it if I leave it ugly." | The reviewer's `complexity-budget` finding will fire on the *next* iteration's diff — pushing the cost to fix-only, where the cycle re-runs RED → GREEN → REFACTOR for the F-N. Cheaper to catch in the original REFACTOR. |

## Red flags

Stop and reconsider if any of these appear during a simplification pass:

- **Tests need modification to pass after a "simplification".** Behaviour changed. This is not a simplification — it is an undeclared spec change. Revert; if the behaviour change is wanted, surface as a new AC.
- **The simplified version is longer or harder to follow than the original.** Over-simplification (principle 4). Revert.
- **Renaming things to match personal preference rather than project convention.** Principle 2 violated. Match the surrounding code, not your training data.
- **Removing error handling to "make the code cleaner".** Error handling is behaviour. Removing it changes behaviour. See Red Flag #1.
- **Simplifying code you do not fully understand.** Chesterton's Fence (Process step 1) was skipped. Stop, read context, then return.
- **Batching many simplifications into one hard-to-review commit.** Process step 3 violated. Each simplification should be a reviewable unit; the per-AC REFACTOR commit is the natural boundary.
- **Refactoring code outside the AC's touchSurfaces.** Principle 5 violated. Surface as "noticed but didn't touch"; do not auto-fix.
- **A simplification that produces a deeper diff than the GREEN commit it follows.** Almost certainly two unrelated changes mixed. Split.

## Verification

After a simplification pass, before committing under `--phase=refactor`:

- [ ] All existing tests pass without modification (re-run the **full relevant suite**, not just affected).
- [ ] `npm run build` (or project equivalent) succeeds with no new warnings.
- [ ] `npm run lint` passes (no style regressions).
- [ ] Each simplification is reviewable as an incremental change (one principle's worth of edits at most).
- [ ] The diff is clean — no unrelated changes mixed in (compare against `git diff --stat HEAD~1` for the GREEN commit; the REFACTOR diff should only touch files the GREEN diff already touched, OR strictly new tests for the simplified code).
- [ ] Simplified code follows project conventions (matches neighbouring style).
- [ ] No error handling was removed or weakened.
- [ ] No dead code left behind (no unused imports, no unreachable branches introduced by an extract that wasn't followed through).
- [ ] A reviewer (or you, re-reading the diff cold) would approve this as a net improvement.

If any box is unchecked → either fix the gap or revert to the GREEN state and commit `--phase=refactor --skipped: <reason>`.

## Anti-pattern catalogue cross-reference

These cclaw antipatterns interact with simplification — cite them by id when the simplification pass uncovers one (per `tdd-and-verification > Anti-patterns` and `commit-hygiene`):

- **A-1 (TDD phase integrity)** — simplification disguised as a GREEN commit fails the audit trail. Always commit under `--phase=refactor`.
- **A-4 (drive-by edits)** — unscoped simplification (touching files outside the AC's touchSurfaces) is the canonical case. The reviewer cites A-4 with severity bounded by the size of the drive-by; pure-formatting drift is `nit`, semantic-change in adjacent code is `required`.
- **A-5 (deleted pre-existing dead code)** — dead-code removal during simplification is allowed when the dead code is your own GREEN leftover; pre-existing dead code is surfaced under "noticed but didn't touch" (per `commit-hygiene > surgical-edit-hygiene`).

## Cross-references

- `tdd-and-verification > REFACTOR — mandatory pass` — the runtime invocation point for this skill. REFACTOR runs after GREEN; the body of REFACTOR consults this skill body for the rubric.
- `review-discipline > Eight-axis review` — the reviewer's `complexity-budget` and `readability` axes cite this skill body for the "real simplification vs preference" rubric. Pre-v8.27 the rubric was inlined in the reviewer prompt; v8.27 moves the canonical rubric here and the reviewer cites it.
- `commit-hygiene > surgical-edit-hygiene` — the "no drive-by" rule that bounds simplification scope (principle 5).
- `tdd-and-verification > Anti-rationalization table` — the parent rubric this skill's "Common rationalizations" extends to the simplification slot.

---

*Inspired by [addy osmani's `code-simplification` skill](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/code-simplifier/agents/code-simplifier.md), which in turn was inspired by the Claude Code Simplifier plugin. This cclaw adaptation: cclaw-native stage-windowing, integration with `tdd-and-verification`'s REFACTOR step, AC-scoped touchSurfaces rule, anti-pattern cross-references, and cclaw's anti-rationalization table shape. The five principles + four-step process are addy's; the cclaw fitting is ours.*
