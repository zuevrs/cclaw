---
name: commit-hygiene
trigger: before every git commit produced inside an active cclaw flow; always-on for builder
---

# Skill: commit-hygiene

This merged skill covers every kind of "what lands in a commit" discipline: how the message reads (formerly **commit-message-quality**), what changes are allowed inside the commit's diff (formerly **surgical-edit-hygiene**), the slice 3-check authoring rubric + slice↔commit traceability (absorbed from `slice-discipline`), and the AC 3-check authoring rubric + `verify(AC-N): passing` traceability (absorbed from `ac-discipline`). The posture-driven commit-prefix contract — `red(SL-N):` / `green(SL-N):` / `refactor(SL-N):` for slice work, `verify(AC-N): passing` for AC verification — is authored ONCE in the `commit-message-quality` section below; the slice / AC sections add the authoring rubrics, the SL↔AC mapping, and the reviewer's ex-post chain checks.

## When NOT to apply

- **Inline / trivial flows commit with plain `git commit`.** In inline / soft modes there is no slice ↔ commit / AC ↔ verify chain; the per-criterion prefix rules below apply only in strict mode.
- **Amending the most recent commit before push.** Amend is acceptable when the commit has not been pushed AND the amend fixes the message (e.g. correcting a mis-prefixed subject so the reviewer's `git log --grep="(SL-N):"` or `git log --grep="verify(AC-N):"` scan picks it up). Avoid amending once another commit is layered on top.
- **Cleaning up pre-existing dead code outside the slice's `Surface`.** Surfaced under `## Summary → Noticed but didn't touch`; never deleted in-scope. The audit trail breaks regardless of whether the dead code was real.
- **Writing co-author trailers on solo commits.** Anti-pattern call-out — co-author trailers belong on collaborative commits.
- **`git add -A` for "convenience".** Forbidden. Stage explicitly (`git add <path>` or `git add -p`); shell history with `-A` is an A-2 finding.
- **Stylistic / formatter passes that touch files the slice didn't authorise.** A drive-by reformat is A-4; bundle it into a follow-up slug instead.

## commit-message-quality

The reviewer's posture-aware chain check keys off the subject-line prefix. The plan-traceability chain only stays usable if every commit's subject is readable AND prefixed correctly. The chain is split in strict mode: slice work uses `(SL-N)` and AC verification uses `verify(AC-N): passing` — the reviewer dual-greps both.

## Rules

1. **Imperative voice** — "Add StatusPill component", not "Added" or "Adding".
2. **Subject ≤72 characters** — long subjects truncate in `git log --oneline` and CI signals.
3. **Strict-mode subject starts with the posture-driven prefix.** Slice work uses one of `red(SL-N):` / `green(SL-N):` / `refactor(SL-N):` / `refactor(SL-N) skipped:` / `test(SL-N):` / `docs(SL-N):` (pick the prefix from the slice's `Posture` value in `plan.md > ## Plan / Slices`). AC verification uses the fixed subject `verify(AC-N): passing`. The prefix is the contract the reviewer's `git log --grep="(SL-N):"` (slice work) and `git log --grep="verify(AC-N):"` (AC verification) scans read. In soft / inline modes use plain `<feat|fix|refactor|docs>: <one-line>` without a slice or AC id.
4. **Body when needed** — second-line blank, then a short rationale paragraph and any non-obvious context. Use `-m` for the subject; for multi-line messages use `git commit -F <file>` or repeat `-m` per paragraph. A `verify(AC-N): passing` commit MAY append `validates: KA-N` lines in the body when the verification closes the loop on a `## Key assumptions to validate` row.
5. **Cite finding ids in fix commits** — `red(SL-1): fix F-2 — separate rejected token` for slice fixes; `verify(AC-3): passing` (with `# re-verify after F-5 fix` in the body) for fresh AC verification after a fix-only loop. The `fix F-N` token in the body or subject is what cross-references the review-block finding at handoff time.

## Anti-patterns

- "WIP", "fixes", "stuff", "more". The reviewer rejects these as F-1 `block`.
- Subject lines that paraphrase the diff. Diff is the diff; the message is the why.
- Co-author trailers in solo commits.
- Strict-mode slice commits without the `(SL-N):` token — the reviewer's slice-chain scan misses them and the slice reads as incomplete (A-1, severity=required, axis=correctness).
- Strict-mode AC verification commits without `verify(AC-N): passing` — the reviewer's AC-chain scan misses them and the AC reads as unclosed (A-1, severity=required, axis=correctness).

## When to amend

In strict mode it is OK to amend the most recent commit when (a) the commit has NOT been pushed, AND (b) the amend fixes the subject prefix (e.g. correcting `fix bug` → `red(SL-3): reproduce off-by-one`, or `all green` → `verify(AC-2): passing`). Once another commit has landed on top, do NOT amend — write a fixup commit instead: `git commit --allow-empty -m "<prefix>(SL-N): re-record subject for <orig-SHA>"` for slice work, or `git commit --allow-empty -m "verify(AC-N): re-record for <orig-SHA>"` for AC verification. Both paths keep the reviewer's `git log --grep` scans honest.

After a push, never amend (it requires force-push, which the builder never does — that is the orchestrator's ship-stage call).

## surgical-edit-hygiene

cclaw's iron law of **Surgical Changes** says "Touch only what each slice (and each AC verification) requires." This skill is the operational rulebook that turns the iron law into mechanical, reviewer-checkable behaviour.

> Drive-by improvements are the second-most-common AI-coding failure mode after silent scope creep. They look helpful in isolation; they corrupt the audit trail in aggregate. cclaw rejects them.

## The three rules

### Rule 1 — No drive-by edits to adjacent code

When the slice asks you to fix a bug in `fn foo()`, you fix `fn foo()`. You do **not**:

- "improve" comments above or below the function;
- reformat the surrounding block ("while we're here, let me reflow this");
- reorder imports;
- rename a local variable that is clearer-as-renamed but unrelated to the slice;
- add a missing JSDoc / docstring on a sibling function;
- delete a TODO comment because "it's stale";
- normalise quote style, indentation, or trailing-whitespace anywhere outside your touched lines.

Each of those is a separate slug (or, if trivial, a separate inline-mode flow). Inside this slug, you ship the slice's diff and **only** that — plus, for the AC verification pass, the test-only edits the AC actually requires.

The reviewer cites a drive-by edit as **A-4 — Drive-by edits to adjacent comments / formatting / imports** with severity `consider` (or `required` when the drive-by edit hides scope creep).

### Rule 2 — Remove only orphans your changes created

After your edits, scan the diff for **orphans you produced**:

- imports your change made unused;
- variables your change made unreferenced;
- private helpers your change made unreachable;
- dead branches your change cut off;
- exports your change demoted to internal.

You **must** remove these. They are debt **your** slice created and they belong in the slice's commit chain.

You **must NOT** remove orphans that **pre-dated** your change. Pre-existing dead code is not your scope; deleting it produces a diff that mixes "slice implementation" with "cleanup of code I did not own". The slice's audit trail breaks.

The reviewer cites a deleted pre-existing orphan as **A-5 — Deletion of pre-existing dead code without permission** with severity `required`.

### Rule 3 — Mention pre-existing dead code under "Noticed but didn't touch"

When you spot pre-existing dead code, list it under your build artifact's `## Summary → Noticed but didn't touch` block (per the `summary-format` skill). Format:

```
- Noticed pre-existing dead code: `src/legacy/foo.ts` exports `oldHelper()` with no callers (verified via grep). Did NOT delete; outside slice scope. Recommend a follow-up cleanup slug.
```

Be specific: cite the file, the symbol, and the evidence (grep output, IDE reference count, etc.). A bare "there's dead code somewhere" bullet is worthless and the reviewer downgrades it to severity `fyi` (no actionable signal).

## How the rules cascade with summary-format

The three rules above run **alongside** the `## Summary` block. The block's three sections map naturally:

- `### Changes made` — the slice-aligned diff (test files + minimal production diff + your-orphan cleanup; nothing else) plus the AC verification's test-only additions where applicable.
- `### Noticed but didn't touch` — pre-existing dead code, drive-by-fix temptations you resisted, formatting noise you saw, code smells outside the slice's Surface.
- `### Potential concerns` — ambiguities your implementation surfaced, edge cases the slice didn't cover, rollback gotchas.

A builder that ships a slice and writes "no drive-by edits noticed" in the `Noticed but didn't touch` block when the diff actually contains one is a **contract violation**. The reviewer catches the drive-by; the absence of the bullet is itself a finding (axis=readability, severity=consider).

## Reviewer finding template — drive-by edit

Whenever the reviewer detects a drive-by edit, they record a finding with this exact shape:

```
| F-N | architecture | consider | SL-X | src/foo.ts:42 | A-4 — Drive-by edit: comment reflowed adjacent to SL-X change. The diff at lines 38-44 contains a comment normalisation that is unrelated to the slice. | Move the comment change to a separate slug, or revert it from this commit. |
```

Severity: `consider` for cosmetic drive-bys (formatting, comments, rename of local var). Escalate to `required` when the drive-by edit also hides logic change (e.g. "reformatted block" that quietly removed a guard clause).

## Reviewer finding template — deleted pre-existing dead code

```
| F-N | correctness | required | SL-X | src/legacy/util.ts | A-5 — Pre-existing helper `oldHelper()` deleted in this commit. The deletion is unrelated to SL-X (no slice or AC referenced it). | Restore the deletion; surface as a follow-up slug under `## Summary → Noticed but didn't touch`. |
```

Always `required` (even when the deletion is "obviously dead"): the audit trail breaks regardless of whether the dead code was real.

## Hard rules

- **A drive-by edit is a contract violation, not a style issue.** The reviewer flags every one.
- **Pre-existing dead code is never deleted in-scope.** Always surfaced under the summary block; never silently removed.
- **Your-orphan cleanup is mandatory.** An import your change made unused stays in the same commit chain as the change.
- **The diff scope test:** for every changed line in your commit, you must be able to point at a slice's `Surface` row (work pass) or an AC's verification target (verify pass) that justifies the change. If you cannot, the line is a drive-by — revert it or split the slug.
- **`git add -A` is forbidden.** Stage files explicitly (`git add <path>` per file or `git add -p` to pick hunks). The reviewer cites `git add -A` in shell history as A-2 (work outside slice).
- **Strict-mode commits carry the right token in the subject.** Slice commits carry `(SL-N)`; AC verification commits carry `verify(AC-N): passing` verbatim. The reviewer's dual `git log --grep` scan reads both — missing tokens break the chain.

## Worked example — RIGHT

SL-1's plan row says "Fix off-by-one in `paginate()` so the last page renders"; AC-1's `Verifies` list contains SL-1. Your diff:

```
src/lib/paginate.ts: -2 lines, +2 lines (the off-by-one fix)
src/lib/paginate.ts: -1 line (an import made unused by your change)
tests/unit/paginate.test.ts: +14 lines (the RED test, then GREEN verification)
```

Commits:

```
red(SL-1): paginate returns last page on integer divisor   (tests/unit/paginate.test.ts only)
green(SL-1): fix off-by-one in last-page boundary         (src/lib/paginate.ts only)
refactor(SL-1) skipped: 2-line fix, no extraction warranted
verify(AC-1): passing                                       (empty — slice test already covers the observable)
```

Build summary:

```
## Summary — builder
### Changes made
- SL-1: fixed off-by-one in `paginate()` (`src/lib/paginate.ts:84`); last page now renders.
- SL-1: removed unused `Math.ceil` import made unreferenced by the fix.
- AC-1 verified: empty `verify(AC-1): passing` commit — covered by `tests/unit/paginate.test.ts: "returns last page on integer divisor"` committed under SL-1.
### Noticed but didn't touch
- Pre-existing comment block in `src/lib/paginate.ts:14-22` repeats outdated math. Did NOT edit; recommend a follow-up doc slug.
- File `src/lib/legacy-paginate.ts` exports `oldPaginate()` with no callers (verified `rg "oldPaginate" src/`). Did NOT delete; outside slice scope.
### Potential concerns
- The fix changes off-by-one rounding for empty result sets too — confirm this is the desired behaviour (AC-1 text didn't specify).
```

## Worked example — WRONG

Same slice + AC, but the builder also "improved":

```
src/lib/paginate.ts: -2 lines, +2 lines (the fix)        ← OK
src/lib/paginate.ts: -8 lines, +12 lines (reformatted)   ← A-4 drive-by
src/lib/paginate.ts: -14 lines (deleted dead helper)     ← A-5 pre-existing dead code
tests/unit/paginate.test.ts: +14 lines                   ← OK
```

Reviewer findings:

- F-1 architecture consider (A-4) — drive-by reformat in lines 14-26.
- F-2 correctness required (A-5) — `legacyPaginate` deletion unrelated to SL-1.

Both findings block the slice from going to compound until the builder splits the diff: one commit for SL-1, drive-by reverts in a separate commit (or in a follow-up slug for the "real" cleanups).

## Common rationalizations

**Cross-cutting rationalizations:** the canonical `git add -A` / `WIP` / amend-after-push / bundling-rename-with-fix / skipping-prefix rows live in `.cclaw/lib/anti-rationalizations.md` under category `commit-discipline`. The rows below stay here because they cover commit-hygiene-specific framings (dead-code-cleanup reflex, 72-char subject cap, drive-by trivialization); the catalog covers the cross-cutting commit-prefix and stage-discipline prose.

The drive-by reflex and the dead-code-cleanup reflex are how scope discipline breaks. When you catch yourself thinking the left column, do the right column. Surface the rationalization in `## Summary → Noticed but didn't touch` when you resist it.

| rationalization | truth |
| --- | --- |
| "While I'm here, I'll just fix this adjacent comment / format / import." | That's the canonical A-4 drive-by. Open a separate slug (or inline-flow) for the cleanup — the reviewer flags every one, the commit chain stays clean. |
| "This dead code is obviously unused, I'll just delete it." | Pre-existing dead code is A-5, severity `required` — the audit trail breaks regardless of whether the deletion was "obviously safe". Surface under `Noticed but didn't touch` instead. |
| "`git add -A` is fine, I know what changed." | Forbidden. Stage explicitly (`git add <path>` per file, or `git add -p` for hunks). Shell history with `-A` is itself an A-2 finding. |
| "The message will say `WIP` for now; I'll fix it in review." | The reviewer rejects `WIP` / `fixes` / `stuff` as F-1 `block`. The cost to write a real subject is 30 seconds; the cost to fix later is a review iteration. |
| "I'll amend the last commit since I already pushed." | Once pushed, do not amend — the orchestrator's ship stage owns force-push. Write a fixup commit (`git commit --allow-empty -m "<prefix>(SL-N): re-record subject for <orig-SHA>"` for slice work; `git commit --allow-empty -m "verify(AC-N): re-record for <orig-SHA>"` for AC verification) and surface the mis-record in your slim summary. |
| "Subject 80 characters is fine, `git log --oneline` will truncate it nicely." | 72-char hard cap. Past that, CI signals truncate in unhelpful places and `git log --oneline` becomes unreadable. |
| "The diff has 5 files outside the slice's Surface but they're trivial." | If you cannot point at a slice Surface row (or AC verification target) that justifies a changed line, the line is a drive-by. Revert it or split the slug; "trivial" is not a justification. |
| "I'll bundle the rename and the bug fix into one commit; they're related." | They're not. The rename is a `refactor(SL-N): ...` commit; the bug fix is `red(SL-N): ...` + `green(SL-N): ...`. Mixing them defeats the audit trail and makes the diff unreviewable. |
| "I'll fold a production tweak into the `verify(AC-N): passing` commit so the AC actually passes." | NO. Verify commits are test-only or empty by contract; production-code touch is A-1 critical (axis=correctness). Fix the responsible slice, then re-emit `verify(AC-N): passing` as a fresh commit. |

## Composition

This skill is **always-on** for builder and for any specialist that produces a commit (which today means builder only — architect, plan-critic, qa-runner, reviewer, critic do not commit code). The reviewer reads this skill at the top of every iteration and uses the finding templates above verbatim.

---

# Slice discipline — authoring + traceability (absorbed `slice-discipline`)

cclaw separates **work** from **verification** in plan.md. Slices (SL-N) are the work units the builder runs TDD cycles against; acceptance criteria (AC-N) live in a separate table and are verified after every slice in their `Verifies` list has landed. This section covers the slice side of that split; the AC side is the **AC discipline** section below.

## slice-quality

Three checks per slice in `plan.md > ## Plan / Slices`:

1. **Atomic** — implementing this slice is one coherent TDD cycle (one RED test, one minimal GREEN, one REFACTOR consideration). A slice whose RED test would have to assert three unrelated behaviours is a compound slice; split it.
2. **Surface-bounded** — the `Surface` column lists every file the slice will touch (production + test). The builder enforces this at the diff level: a diff touching files outside `Surface` is a contract violation.
3. **Dependency-honest** — `Depends-on` lists every other SL-K whose Surface or behaviour this slice reads from. Empty `Depends-on` means the slice is genuinely independent; the architect's `Independent` column derives from `Depends-on.length === 0`.

## Parallel-by-default (strict mode)

The builder runs slices in **topologically-ordered layers** rather than strictly sequentially. Each layer is the maximal set of slices whose `Depends-on` is satisfied by the union of every previous layer. The pure utility `src/slice-topology.ts > topologicalLayers()` is the canonical implementation.

- **Slices marked `Independent: yes` (empty `Depends-on`) run in PARALLEL within their layer.** The builder dispatches one sub-builder per slice via the harness's parallel sub-agent primitive; each sub-builder runs RED → GREEN → REFACTOR for its assigned slice only and returns to the parent. Tasks with N truly independent slices finish in the time of the longest slice, not Σ(slice times).
- **Slices with `Depends-on: SL-K, ...` block on their predecessors.** They land in a later layer than every named predecessor. Linear chains (each slice depending on the previous) collapse back to the historical sequential shape — one slice per layer, no parallelism.
- **Single-slice layers run inline in the parent builder.** Small tasks (one slice total) pay zero parallelism overhead — the topology returns one layer of one slice and the builder runs it directly with no Task dispatch.

The user-facing outcome: small tasks stay small, large tasks become as fast as their longest slice. Plan-critic §4b is the safety gate — a slice with `Independent: yes` whose `Surface` overlaps another slice's `Surface` is `block-ship` (class=`independence-mismatch`); without that gate, parallel sub-builders would race on the shared file.

**Implication for slice authoring.** When the architect drafts the slice table, treat `Independent: yes` as a load-bearing promise: it commits the builder to parallel dispatch. The promise is testable by inspection — every file in this slice's `Surface` MUST be absent from every other slice's `Surface`. If you find an overlap, either narrow `Surface` (true independence) or add `Depends-on: SL-K` (forces a sequential layer ordering).

## slice smell check

| smell | example | rewrite |
| --- | --- | --- |
| compound slice | "implement the helper AND wire the UI" | split into SL-1 (helper) + SL-2 (UI calls helper) |
| Surface omits test files | `Surface: src/lib/permissions.ts` (but the slice adds a new test) | `Surface: src/lib/permissions.ts, tests/unit/permissions.test.ts` |
| missing dependency | SL-3 reads from SL-1's new export but `Depends-on: —` | `Depends-on: SL-1` |
| dependency on later slice | SL-1's `Depends-on: SL-3` | reorder so prerequisite slices have lower ids |
| Surface drift between rows | SL-1 says `Surface: src/lib/a.ts`; SL-2 also touches `src/lib/a.ts` without declaring it | SL-2 adds `src/lib/a.ts` to its Surface and a `Depends-on: SL-1` row |
| vague title | "more code" | "extract `hasViewEmail` helper from inline ternary in RequestCard" |

## slice numbering

- Slice ids start at `SL-1` and are sequential within a slug.
- Refinement slugs restart at `SL-1` even when they refine a slug that had `SL-1..SL-9`.
- Do not reuse a slice id within the same slug; if you delete a slice (architect-side, before the build stage runs), the remaining ids stay sequential after compaction.

## When to add a slice mid-flight

You don't. Adding slices during build is scope creep. Either the new work fits an existing slice (possibly with an expanded `Surface` row authored by the architect via a fresh dispatch), or it is a follow-up slug.

## slice-traceability (strict mode only)

In `strict` mode, cclaw has one mandatory gate for slice work: every commit produced inside `/cc` for a slice references exactly one slice via a posture-driven subject-line prefix (authored once in the `commit-message-quality` section above), and the slice ↔ commit chain is reconstructible by anyone who runs `git log --grep="(SL-N):" --oneline`.

The reviewer's ex-post checks at handoff time (beyond the message-shape rules above):

- **Slice declared in plan.md.** `SL-N` cited in a commit must exist in the active plan; an unknown SL-N is an A-N finding.
- **Posture-appropriate sequence.** For `test-first` (and the legacy `characterization-first`), `green(SL-N)` must follow a `red(SL-N)` in git-log order; for `refactor-only`, only `refactor(SL-N)` is expected; for `docs-only`, only `docs(SL-N)`; for the legacy `tests-as-deliverable`, only `test(SL-N)`. See `src/posture-validation.ts:POSTURE_COMMIT_PREFIXES` for the canonical mapping (it retains the retired postures so archived plans still review).
- **RED stages test files only.** `git show <red-SHA> --stat` for a `test-first` / `characterization-first` slice must list test files only; mixing in production files is an A-1 finding (severity=required, axis=correctness).
- **Diff matches Surface.** Every file in the slice's commits must appear in the slice's `Surface` row of `plan.md`. Drive-by edits outside `Surface` are A-4 (severity `consider` → `required`).

The builder appends the slice ↔ SHA row to `flows/<slug>/build.md` under `## Slice cycles` as the durable record; the row's `commits` column carries the SHA(s). The reviewer's final pass (`reviewer mode=release` at ship gate) verifies the chain is complete via `git log --grep="(SL-N):" --oneline` against the plan's Slices list.

## Slice ↔ AC mapping

Each slice's commits land first; AC verification commits land after. The architect authors the back-reference in the `Verifies` column of `## Acceptance Criteria (verification)`: every AC lists which slices verify it, and conversely every slice can be back-traced by reading which AC rows reference it.

- **Every slice MUST be referenced by at least one AC's `Verifies` column.** A slice that no AC verifies is dead work; plan-critic catches this.
- **Every AC's `Verifies` list MUST contain at least one slice.** An AC with no slice covering it is unverifiable; plan-critic catches this.
- **Slices and AC NEVER share commits.** Slice commits (`red(SL-N):` / `green(SL-N):` / `refactor(SL-N):`) carry production + test code. AC verify commits (`verify(AC-N): passing`) MUST NOT touch production code — they either carry test-only additions for verification beyond what the slice tests already cover, OR they are empty markers when the slice tests already cover the AC.

## Slice work in soft / inline modes

- In **soft mode** the builder runs one TDD cycle for the whole feature and commits with a plain `git commit -m "<feat|fix|...>: <one-line>"`. There is no `red(SL-N)` / `green(SL-N)` / `refactor(SL-N)` prefix and no slice table — the slice ↔ commit chain only exists in strict mode.
- In **inline mode** there is no slice or AC table at all; the orchestrator handled the trivial path directly with a single commit.

## When you accidentally committed without the per-slice prefix (strict mode only)

- Reviewer's `git log --grep="(SL-N):"` scan misses the commit; the slice reads as missing.
- Two options:
  - **Amend the most recent commit** with `git commit --amend -m "red(SL-N): <description>"` (only safe when the commit has not been pushed and is the most recent — the builder controls the working tree).
  - **Re-author as a fixup commit** with the correct prefix: `git commit --allow-empty -m "red(SL-N): re-record subject for <original-SHA>"` followed by the actual missing-content commit. The empty marker preserves the audit trail and the reviewer's scan reconstructs the slice's chain.
- Surface the mis-prefix as a Notes line in the slim summary; the reviewer treats it as a `consider`-severity finding (axis=readability) when amended cleanly, and `required` (axis=correctness) when the chain is left broken.

## Slice discipline — common rationalizations

**Cross-cutting rationalizations:** the canonical commit-prefix / amend-after-push / bundling rows live in `.cclaw/lib/anti-rationalizations.md` under category `commit-discipline`. The rows below stay here because they cover slice-discipline-specific framings (bundling-under-SL-2, vague Surface, mid-build slice addition, dependency misclaim); the catalog covers the cross-cutting commit-chain prose.

| rationalization | truth |
| --- | --- |
| "This work is part of SL-2, I'll just bundle it under SL-2." | Compound slice fails the smell check — atomic means one TDD cycle per slice. Split into a new slice with its own id; the audit trail and the reviewer's diff-vs-Surface check need the separation. |
| "I'll skip the `red(SL-N): ...` prefix this once — the message is self-explanatory." | The reviewer's git-log scan keys off the prefix. Without `(SL-N):` in the subject line, the commit is invisible to the chain check and the slice reads as missing. Amend the message or write a fixup commit; do not leave the chain broken. |
| "I'll add SL-7 mid-build because I noticed something needed." | Adding slices during build is scope creep. Either the new work fits an existing slice (architect-side revision of `Surface`), or it is a follow-up slug. SL-7 mid-flight breaks the build sub-phase's commit budget and the parallel-dispatch contract. |
| "Refinement of `<old-slug>` so SL-1 starts at SL-8 (continuation)." | Refinement slugs restart at SL-1. The `refines:` frontmatter is the link; the slice numbering does not carry. |
| "I'll claim SL-3 is `Independent: yes` even though it reads from SL-1's export." | Independence means `Depends-on.length === 0`. Reading from another slice's export is a dependency; declare it. Plan-critic catches mis-claimed independence at architect handoff. |
| "I'll renumber the slices after I delete SL-2 — `SL-3` becomes the new `SL-2`." | Don't. The remaining ids stay sequential after compaction; renumbering breaks the reviewer's `git log --grep="(SL-N):"` scan for any commit that already cited the old id. |
| "I'll mix the slice's RED test and the AC's verify test in one commit." | Slices and AC NEVER share commits. The slice's RED test goes in `red(SL-N): ...`; the AC's verify test (when needed) goes in `verify(AC-N): passing` as a separate commit. The split is enforced by message prefix. |
| "I touched a file outside `Surface` but it was a one-line fix." | Drive-by edits are A-4 (severity `consider` → `required` depending on size). Add the file to the slice's `Surface` (architect-side) OR list it under `## Summary → Things I noticed but didn't touch` and leave it for a follow-up slug. |

---

# AC discipline — authoring + verification (absorbed `ac-discipline`)

This section covers both AC concerns: the bar for every AC entry (formerly **ac-quality**), and the `verify(AC-N): passing` commit contract that wires the AC ↔ verification chain in strict mode (formerly **ac-traceability**). cclaw splits work from verification: slice work (`red(SL-N):` / `green(SL-N):` / `refactor(SL-N):`) lives in the Slice discipline section above; this section keys off `AC-N` for the verification pass only.

## ac-quality

Three checks per AC:

1. **Observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
2. **Independently committable** — a single commit covering only this AC is meaningful.
3. **Verifiable** — there is an explicit verification line (test name, manual step, or command).

## AC smell check

| smell | example | rewrite |
| --- | --- | --- |
| sub-task | "implement the helper" | "search returns BM25-ranked results for queries with multiple terms" |
| vague verification | "tests pass" | "verified by tests/unit/search.test.ts: 'returns BM25-ranked hits'" |
| internal detail | "refactor the cache" | "cache hit rate >90% on the dashboard repaint scenario" |
| compound AC | "build the page and add analytics" | split into two AC |

## AC numbering

- AC ids start at `AC-1` and are sequential.
- Refinement slugs restart at `AC-1` even when they refine a slug that had AC-1..AC-12.
- Do not reuse an AC id within the same slug; if you delete an AC, the remaining ids stay sequential after compaction.

## When to add an AC mid-flight

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a fresh slug.

## ac-traceability (AC verification pass only)

This part applies only when the active flow's `ceremony_mode` is `strict` (set at the triage gate for large-risky / security-flagged work). In `inline` and `soft` modes there is no per-criterion commit prefix and no AC↔commit chain — see `agents/triage.md` (routing contract) and `runbooks/triage-gate.md` (orchestrator-side Triage procedure) for what each mode does.

In `strict` mode, cclaw separates work from verification:

- **Slice work** (`red(SL-N): …` → `green(SL-N): …` → `refactor(SL-N): …`) is the TDD unit. Slices land in commits keyed by `SL-N`; the reviewer's `git log --grep="(SL-N):" --oneline` reconstructs the slice chain. See the Slice discipline section above for the slice-side contract.
- **AC verification** is THIS section's domain: after every slice in an AC's `Verifies` list lands and the full suite is green on the merged state, the builder stamps one `verify(AC-N): passing` commit per AC. The reviewer's `git log --grep="verify(AC-N):" --oneline` reconstructs the AC chain.

The two chains are independent; the dual grep is what makes the audit trail reconstructible by anyone who runs git log against the build range.

### Rules (strict mode)

1. **One `verify(AC-N): passing` commit per AC, after all slices in `Verifies` land.** Subject MUST be exactly `verify(AC-N): passing` — the reviewer's git-log scan keys off this verbatim. The body MAY include a one-line evidence citation (test file:test-name + suite output line) and the optional `validates: KA-N` payload (one line per validated assumption from `## Key assumptions to validate`).
2. **The verify commit's diff is empty OR test-only.** Production code (`src/**`, `lib/**`, `app/**`) NEVER appears in a verify commit. If the AC cannot pass without a production edit, the responsible slice is incomplete — return to its TDD cycle; do not paper over with a verify commit that secretly ships behaviour.
3. **Stage only test files (or commit empty).** `git add tests/path/to/ac-coverage.test.ts && git commit -m "verify(AC-N): passing"` when the AC needs a verification target beyond what the slice tests already cover (perf budget, integration scenario, contract assertion); OR `git commit --allow-empty -m "verify(AC-N): passing"` when the slice tests already exercise the AC's observable behaviour. `git add -A` is forbidden — list the test files explicitly.
4. **The reviewer's ex-post checks at handoff time:**
   - **AC declared in plan.md.** `AC-N` cited in a verify commit must exist in `plan.md > ## Acceptance Criteria (verification)`.
   - **One verify commit per AC.** A duplicate `verify(AC-N): passing` commit for the same AC is A-1 (axis=correctness); a fresh re-verify after a fix-only edit is a new commit, not an amend of the prior verify.
   - **Verify after slices.** A `verify(AC-N): passing` commit landed BEFORE every slice in its `Verifies` list landed is A-1 (severity=required).
   - **Production-code freedom.** `git show --stat <verify(AC-N) SHA>` MUST be empty OR list test files only; a production-code touch in a verify commit is A-1 (severity=critical, axis=correctness).
5. **`build.md > ## AC verification` carries the AC↔SHA row** as the durable record: `| AC-N | Verifies (slices) | Evidence | commit |`. The Evidence cell cites the test file:test-name (or perf/integration target); the commit cell carries the verify SHA.
6. **The reviewer's final pass (`reviewer mode=release` at ship gate)** verifies the dual chain via `git log --grep="(SL-N):" --oneline` (slice work) AND `git log --grep="verify(AC-N):" --oneline` (AC verification) against the plan's Slices + Acceptance Criteria tables.

## Archived-flow back-compat

Legacy slugs carry only a `## Acceptance Criteria` section (no `## Plan / Slices` table) and used `red(AC-N):` / `green(AC-N):` / `refactor(AC-N):` for AC work (no separate verify pass). The reviewer auto-detects the archived shape from the absence of `## Plan / Slices` in `plan.md` and applies the legacy per-posture recipe directly against the `(AC-N)` token. New strict-mode slugs always carry both tables and key slice work off `(SL-N)` + AC verification off `verify(AC-N): passing`; do not mix the two shapes within a single slug.

## AC work in soft / inline modes

- In **soft mode** the builder runs one TDD cycle for the whole feature and commits with a plain `git commit -m "<feat|fix|...>: <one-line>"`. There is no `verify(AC-N): passing` commit and no AC↔commit chain — the verification chain only exists in strict mode.
- In **inline mode** there is no AC table at all; the orchestrator handled the trivial path directly with a single commit.
- A soft-mode plan has bullet-list testable conditions, not numbered AC IDs. There is no `AC-N` to reference.
- A single TDD cycle covers the whole feature; you do not run RED → GREEN → REFACTOR per condition.
- Ship gate is a single reviewer pass ("all listed conditions verified"), not an AC-by-AC ledger.

## When you accidentally committed without the verify prefix (strict mode only)

- Reviewer's `git log --grep="verify(AC-N):"` scan misses the commit; the AC reads as unclosed.
- Two options:
  - **Amend the most recent commit** with `git commit --amend -m "verify(AC-N): passing"` (only safe when the commit has not been pushed and is the most recent — the builder controls the working tree).
  - **Re-author as a fixup commit** with the correct prefix: `git commit --allow-empty -m "verify(AC-N): passing"` after the mis-prefixed original. The empty marker preserves the audit trail and the reviewer's scan reconstructs the AC's chain via the fixup.
- Surface the mis-prefix as a Notes line in the slim summary; the reviewer treats it as a `consider`-severity finding (axis=readability) when amended cleanly, and `required` (axis=correctness) when the chain is left broken.

## AC discipline — common rationalizations

**Cross-cutting rationalizations:** the canonical commit-prefix / amend-after-push / bundling rows live in `.cclaw/lib/anti-rationalizations.md` under category `commit-discipline`. The rows below stay here because they cover AC-discipline-specific framings (bundling-under-AC-2, vague verification, mid-build AC addition, refinement renumbering, verify-commit purity); the catalog covers the cross-cutting commit-chain prose.

| rationalization | truth |
| --- | --- |
| "This AC is part of AC-2, I'll just bundle it under AC-2." | Compound AC fails the smell check — independently committable means one AC per commit. Split into a new AC with its own id; the audit trail and ship-gate need the separation. |
| "Verification is `tests pass`." | That's a vague verification; the smell check rejects it. Cite a specific test name + file + assertion (`tests/unit/permissions.test.ts: 'hides email when permission is missing'`). |
| "I'll renumber the ACs after I delete AC-2 — `AC-3` becomes the new `AC-2`." | Don't. The remaining ids stay sequential after compaction; renumbering breaks the reviewer's `git log --grep="verify(AC-N):"` scan for any commit that already cited the old id. |
| "I'll skip the `verify(AC-N): passing` commit — the slice tests already cover the AC." | The slice commits are the TDD unit; the `verify(AC-N): passing` commit is the atomic AC closure signal. Without it the AC reads as unclosed even when every contributing slice landed green. Stamp the verify commit (empty body is fine) so the reviewer's dual grep reconstructs the AC chain. |
| "I'll add AC-13 mid-build because I noticed something needed." | Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug. AC-13 mid-flight breaks the build sub-phase's commit budget. |
| "Refinement of `<old-slug>` so AC-1 starts at AC-13 (continuation)." | Refinement slugs restart at AC-1. The `refines:` frontmatter is the link; the AC numbering does not carry. |
| "The verification line is 'manual test' for this AC." | A manual step is a verification, but it must be **concrete** — name the click target, the expected observable, and the operator. "I clicked around and it looked fine" is the rationalization the reviewer catches. |
| "I'll inline the AC's text in the diff comment so the reviewer can see it." | The AC lives in `plan.md`, not in source comments. The reviewer reads the plan; inlining the AC text bloats the production diff with quoted plan prose. |
| "The verify(AC-N) commit needs a small production fix to actually pass — I'll just slip it in." | NO. The verify commit is test-only or empty by contract; production-code touch is A-1 critical (axis=correctness). If the AC won't pass on the merged state, the responsible slice is incomplete — return to its TDD cycle (`red(SL-K): …` → `green(SL-K): …` → `refactor(SL-K): …`), then re-emit `verify(AC-N): passing` as a fresh commit. |
