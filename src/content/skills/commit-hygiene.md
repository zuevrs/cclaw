---
name: commit-hygiene
trigger: before every commit-helper.mjs invocation; always-on for slice-builder; auto-applies to every commit produced inside a flow
---

# Skill: commit-hygiene

This merged skill covers both kinds of "what lands in a commit" discipline: how the message reads (formerly **commit-message-quality**) and what changes are allowed inside the commit's diff (formerly **surgical-edit-hygiene**).

## When NOT to apply

- **Inline / trivial flows commit with plain `git commit`.** `commit-helper.mjs` is the strict-mode contract; on inline / soft modes the AC↔commit chain is not enforced.
- **Amending a commit whose SHA is already recorded in `flow-state.json`.** Amend rewrites the SHA, breaks the AC chain, and orphans the recorded reference. Write a note in `build.md` and move on; the messaging is recoverable in review.
- **Cleaning up pre-existing dead code outside the AC's `touchSurfaces`.** Surfaced under `## Summary → Noticed but didn't touch`; never deleted in-scope. The audit trail breaks regardless of whether the dead code was real.
- **Writing co-author trailers on solo commits.** Anti-pattern call-out — co-author trailers belong on collaborative commits.
- **`git add -A` for "convenience".** Forbidden. Stage explicitly (`git add <path>` or `git add -p`); shell history with `-A` is an A-2 finding.
- **Stylistic / formatter passes that touch files the AC didn't authorise.** A drive-by reformat is A-4; bundle it into a follow-up slug instead.

## commit-message-quality

`commit-helper.mjs` accepts any non-empty message, but the AC traceability chain only stays useful if the messages stay readable.

## Rules

1. **Imperative voice** — "Add StatusPill component", not "Added" or "Adding".
2. **Subject ≤72 characters** — long subjects truncate in `git log --oneline` and CI signals.
3. **Subject does not repeat the AC id** — the hook already appends `refs: AC-N`.
4. **Body when needed** — second-line blank, then a short rationale paragraph and any non-obvious context. Use `--message` for the subject; if the message must be multi-line, write it to a file and pass `--file`.
5. **Cite finding ids in fix commits** — `fix: F-2 separate rejected token`.

## Anti-patterns

- "WIP", "fixes", "stuff", "more". The reviewer rejects these as F-1 `block`.
- Subject lines that paraphrase the diff. Diff is the diff; the message is the why.
- Co-author trailers in solo commits.

## When to amend

Never amend a commit produced by `commit-helper.mjs` after the SHA is recorded in `flow-state.json`. Amend changes the SHA and breaks the AC chain. If the message is wrong, write a short note in `flows/<slug>/build.md` and move on; it is recoverable in review.

## surgical-edit-hygiene

cclaw's iron law of **Surgical Changes** says "Touch only what each AC requires." This skill is the operational rulebook that turns the iron law into mechanical, reviewer-checkable behaviour.

> Drive-by improvements are the second-most-common AI-coding failure mode after silent scope creep. They look helpful in isolation; they corrupt the audit trail in aggregate. cclaw rejects them.

## The three rules

### Rule 1 — No drive-by edits to adjacent code

When the AC asks you to fix a bug in `fn foo()`, you fix `fn foo()`. You do **not**:

- "improve" comments above or below the function;
- reformat the surrounding block ("while we're here, let me reflow this");
- reorder imports;
- rename a local variable that is clearer-as-renamed but unrelated to the AC;
- add a missing JSDoc / docstring on a sibling function;
- delete a TODO comment because "it's stale";
- normalise quote style, indentation, or trailing-whitespace anywhere outside your touched lines.

Each of those is a separate slug (or, if trivial, a separate inline-mode flow). Inside this slug, you ship the AC and **only** the AC.

The reviewer cites a drive-by edit as **A-4 — Drive-by edits to adjacent comments / formatting / imports** with severity `consider` (or `required` when the drive-by edit hides scope creep).

### Rule 2 — Remove only orphans your changes created

After your edits, scan the diff for **orphans you produced**:

- imports your change made unused;
- variables your change made unreferenced;
- private helpers your change made unreachable;
- dead branches your change cut off;
- exports your change demoted to internal.

You **must** remove these. They are debt **your** AC created and they belong in the AC's commit chain.

You **must NOT** remove orphans that **pre-dated** your change. Pre-existing dead code is not your scope; deleting it produces a diff that mixes "AC implementation" with "cleanup of code I did not own". The AC's audit trail breaks.

The reviewer cites a deleted pre-existing orphan as **A-5 — Deletion of pre-existing dead code without permission** with severity `required`.

### Rule 3 — Mention pre-existing dead code under "Noticed but didn't touch"

When you spot pre-existing dead code, list it under your build artifact's `## Summary → Noticed but didn't touch` block (per the `summary-format` skill). Format:

```
- Noticed pre-existing dead code: `src/legacy/foo.ts` exports `oldHelper()` with no callers (verified via grep). Did NOT delete; outside AC scope. Recommend a follow-up cleanup slug.
```

Be specific: cite the file, the symbol, and the evidence (grep output, IDE reference count, etc.). A bare "there's dead code somewhere" bullet is worthless and the reviewer downgrades it to severity `fyi` (no actionable signal).

## How the rules cascade with summary-format

The three rules above run **alongside** the `## Summary` block. The block's three sections map naturally:

- `### Changes made` — the AC-aligned diff (test files + minimal production diff + your-orphan cleanup; nothing else).
- `### Noticed but didn't touch` — pre-existing dead code, drive-by-fix temptations you resisted, formatting noise you saw, code smells outside the AC surface.
- `### Potential concerns` — ambiguities your implementation surfaced, edge cases the AC didn't cover, rollback gotchas.

A slice-builder that ships an AC and writes "no drive-by edits noticed" in the `Noticed but didn't touch` block when the diff actually contains one is a **contract violation**. The reviewer catches the drive-by; the absence of the bullet is itself a finding (axis=readability, severity=consider).

## Reviewer finding template — drive-by edit

Whenever the reviewer detects a drive-by edit, they record a finding with this exact shape:

```
| F-N | architecture | consider | AC-X | src/foo.ts:42 | A-4 — Drive-by edit: comment reflowed adjacent to AC-X change. The diff at lines 38-44 contains a comment normalisation that is unrelated to the AC. | Move the comment change to a separate slug, or revert it from this commit. |
```

Severity: `consider` for cosmetic drive-bys (formatting, comments, rename of local var). Escalate to `required` when the drive-by edit also hides logic change (e.g. "reformatted block" that quietly removed a guard clause).

## Reviewer finding template — deleted pre-existing dead code

```
| F-N | correctness | required | AC-X | src/legacy/util.ts | A-5 — Pre-existing helper `oldHelper()` deleted in this commit. The deletion is unrelated to AC-X (no AC referenced it). | Restore the deletion; surface as a follow-up slug under `## Summary → Noticed but didn't touch`. |
```

Always `required` (even when the deletion is "obviously dead"): the audit trail breaks regardless of whether the dead code was real.

## Hard rules

- **A drive-by edit is a contract violation, not a style issue.** The reviewer flags every one.
- **Pre-existing dead code is never deleted in-scope.** Always surfaced under the summary block; never silently removed.
- **Your-orphan cleanup is mandatory.** An import your change made unused stays in the same commit chain as the change.
- **The diff scope test:** for every changed line in your commit, you must be able to point at an AC verification line that justifies the change. If you cannot, the line is a drive-by — revert it or split the slug.
- **`git add -A` is forbidden.** Stage files explicitly (`git add <path>` per file or `git add -p` to pick hunks). The reviewer cites `git add -A` in shell history as A-2 (work outside AC).

## Worked example — RIGHT

AC-1 says "Fix off-by-one in `paginate()` so the last page renders". Your diff:

```
src/lib/paginate.ts: -2 lines, +2 lines (the off-by-one fix)
src/lib/paginate.ts: -1 line (an import made unused by your change)
tests/unit/paginate.test.ts: +14 lines (the RED test, then GREEN verification)
```

Build summary:

```
## Summary — slice-builder
### Changes made
- Fixed off-by-one in `paginate()` (`src/lib/paginate.ts:84`); last page now renders.
- Removed unused `Math.ceil` import made unreferenced by the fix.
### Noticed but didn't touch
- Pre-existing comment block in `src/lib/paginate.ts:14-22` repeats outdated math. Did NOT edit; recommend a follow-up doc slug.
- File `src/lib/legacy-paginate.ts` exports `oldPaginate()` with no callers (verified `rg "oldPaginate" src/`). Did NOT delete; outside AC scope.
### Potential concerns
- The fix changes off-by-one rounding for empty result sets too — confirm this is the desired behaviour (AC text didn't specify).
```

## Worked example — WRONG

Same AC, but the slice-builder also "improved":

```
src/lib/paginate.ts: -2 lines, +2 lines (the fix)        ← OK
src/lib/paginate.ts: -8 lines, +12 lines (reformatted)   ← A-4 drive-by
src/lib/paginate.ts: -14 lines (deleted dead helper)     ← A-5 pre-existing dead code
tests/unit/paginate.test.ts: +14 lines                   ← OK
```

Reviewer findings:

- F-1 architecture consider (A-4) — drive-by reformat in lines 14-26.
- F-2 correctness required (A-5) — `legacyPaginate` deletion unrelated to AC-1.

Both findings block the slice from going to compound until the slice-builder splits the diff: one commit for AC-1, drive-by reverts in a separate commit (or in a follow-up slug for the "real" cleanups).

## Common rationalizations

The drive-by reflex and the dead-code-cleanup reflex are how scope discipline breaks. When you catch yourself thinking the left column, do the right column. Surface the rationalization in `## Summary → Noticed but didn't touch` when you resist it.

| rationalization | truth |
| --- | --- |
| "While I'm here, I'll just fix this adjacent comment / format / import." | That's the canonical A-4 drive-by. Open a separate slug (or inline-flow) for the cleanup — the reviewer flags every one, the commit chain stays clean. |
| "This dead code is obviously unused, I'll just delete it." | Pre-existing dead code is A-5, severity `required` — the audit trail breaks regardless of whether the deletion was "obviously safe". Surface under `Noticed but didn't touch` instead. |
| "`git add -A` is fine, I know what changed." | Forbidden. Stage explicitly (`git add <path>` per file, or `git add -p` for hunks). Shell history with `-A` is itself an A-2 finding. |
| "The message will say `WIP` for now; I'll fix it in review." | The reviewer rejects `WIP` / `fixes` / `stuff` as F-1 `block`. The cost to write a real subject is 30 seconds; the cost to fix later is a review iteration. |
| "Amending the last commit is faster than a new one." | Amend rewrites the SHA. The SHA is recorded in `flow-state.json` and downstream traceability blocks; amending breaks the chain. Write a note in `build.md` and move on. |
| "Subject 80 characters is fine, `git log --oneline` will truncate it nicely." | 72-char hard cap. Past that, CI signals truncate in unhelpful places and `git log --oneline` becomes unreadable. |
| "The diff has 5 files outside touchSurfaces but they're trivial." | If you cannot point at an AC verification line that justifies a changed line, the line is a drive-by. Revert it or split the slug; "trivial" is not a justification. |
| "I'll bundle the rename and the bug fix into one commit; they're related." | They're not. The rename is a refactor (`--phase=refactor`); the bug fix is `red` + `green`. Mixing them defeats the audit trail and makes the diff unreviewable. |

## Composition

This skill is **always-on** for slice-builder and for any specialist that produces a commit (which today means slice-builder only — design, ac-author, reviewer, security-reviewer do not commit code). The reviewer reads this skill at the top of every iteration and uses the finding templates above verbatim.
