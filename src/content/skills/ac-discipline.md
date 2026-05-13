---
name: ac-discipline
trigger: when authoring or reviewing AC entries; when committing changes for an active cclaw run with ac_mode=strict
---

# Skill: ac-discipline

This merged skill covers both AC concerns: the bar for every AC entry (formerly **ac-quality**), and the commit-prefix contract that wires AC ↔ commit chain in strict mode (formerly **ac-traceability**).

## When NOT to apply

- **Inline / trivial flows (`triage.acMode == "inline"`).** Single-line edits commit straight with plain `git commit`; no AC ids exist to trace.
- **Soft mode commit chain.** In `soft` mode plain `git commit` is the contract. There is no per-AC prefix and no AC↔commit chain; the reviewer reads `build.md` and the feature-level commit message instead.
- **Mid-flight AC additions to an existing plan.** Adding new AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug — never a mid-flight AC graft.
- **Renumbering AC ids after a delete.** Don't reuse `AC-3` because `AC-2` got removed; the remaining ids stay sequential after compaction without rewriting committed AC references.
- **Refinement slugs reading parent slug AC ids.** A refining slug restarts at `AC-1` even when the parent shipped slug had `AC-12`.
- **Strict mode commits without the per-AC prefix.** A bare `git commit -m "fix the thing"` in strict mode breaks the reviewer's `git log --grep="(AC-N):"` scan; the AC reads as missing and the reviewer files an A-1 finding (severity=required, axis=correctness).

## ac-quality

Three checks per AC:

1. **Observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
2. **Independently committable** — a single commit covering only this AC is meaningful.
3. **Verifiable** — there is an explicit verification line (test name, manual step, or command).

## Smell check

| smell | example | rewrite |
| --- | --- | --- |
| sub-task | "implement the helper" | "search returns BM25-ranked results for queries with multiple terms" |
| vague verification | "tests pass" | "verified by tests/unit/search.test.ts: 'returns BM25-ranked hits'" |
| internal detail | "refactor the cache" | "cache hit rate >90% on the dashboard repaint scenario" |
| compound AC | "build the page and add analytics" | split into two AC |

## Numbering

- AC ids start at `AC-1` and are sequential.
- Refinement slugs restart at `AC-1` even when they refine a slug that had AC-1..AC-12.
- Do not reuse an AC id within the same slug; if you delete an AC, the remaining ids stay sequential after compaction.

## When to add an AC mid-flight

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a follow-up (`/cc-idea`) or a fresh slug.

## ac-traceability

This part of the skill applies only when the active flow's `ac_mode` is `strict` (set at the triage gate for large-risky / security-flagged work). In `inline` and `soft` modes there is no per-AC commit prefix and no AC↔commit chain — see `triage-gate.md` for what each mode does.

In `strict` mode, cclaw has one mandatory gate: every commit produced inside `/cc` references exactly one AC via a posture-driven subject-line prefix, and the AC ↔ commit chain is reconstructible by anyone who runs `git log --grep="(AC-N):" --oneline`.

## Rules (strict mode)

1. Every AC commit uses a posture-driven prefix in its subject line: `red(AC-N): ...` / `green(AC-N): ...` / `refactor(AC-N): ...` / `refactor(AC-N) skipped: ...` / `test(AC-N): ...` / `docs(AC-N): ...`. Pick the prefix from the AC's `posture` value in `plan.md`.
2. Stage only AC-related changes before committing. `git add -A` is forbidden — list the files explicitly (`git add tests/<path>.test.ts src/<path>.ts`) or use `git add -p` for hunks.
3. The reviewer's ex-post checks at handoff time:
   - **AC declared in plan.md.** `AC-N` cited in a commit must exist in the active plan; an unknown AC-N is an A-N finding.
   - **Posture-appropriate sequence.** For `test-first` / `characterization-first` postures, `green(AC-N)` must follow a `red(AC-N)` in git-log order; for `refactor-only`, only `refactor(AC-N)` is expected; for `tests-as-deliverable`, only `test(AC-N)`; for `docs-only`, only `docs(AC-N)`. See `src/posture-validation.ts:POSTURE_COMMIT_PREFIXES` for the canonical mapping.
   - **RED stages test files only.** `git show <red-SHA> --stat` for a `test-first` / `characterization-first` AC must list test files only; mixing in production files is an A-1 finding (severity=required, axis=correctness).
4. The slice-builder appends the AC↔SHA row to `flows/<slug>/build.md` as the durable record; the row's `commits` column carries the SHA(s).
5. The reviewer's final pass (`reviewer mode=release` at ship gate) verifies the chain is complete via `git log --grep="(AC-N):" --oneline` against the plan's AC list. There is no separate `runCompoundAndShip` gate (v8.40 dropped it — reviewer is the only ship gate).

## In soft / inline modes

- In **soft mode** the slice-builder runs one TDD cycle for the whole feature and commits with a plain `git commit -m "<feat|fix|...>: <one-line>"`. There is no `red(AC-N)` / `green(AC-N)` / `refactor(AC-N)` prefix — the AC↔commit chain only exists in strict mode.
- In **inline mode** there is no AC table at all; the orchestrator handled the trivial path directly with a single commit.
- A soft-mode plan has bullet-list testable conditions, not numbered AC IDs. There is no `AC-N` to reference.
- A single TDD cycle covers the whole feature; you do not run RED → GREEN → REFACTOR per condition.
- Ship gate is a single reviewer pass ("all listed conditions verified"), not an AC-by-AC ledger.

## When you accidentally committed without the per-AC prefix (strict mode only)

- Reviewer's `git log --grep="(AC-N):"` scan misses the commit; the AC reads as missing.
- Two options:
  - **Amend the most recent commit** with `git commit --amend -m "red(AC-N): <description>"` (only safe when the commit has not been pushed and is the most recent — the slice-builder controls the working tree).
  - **Re-author as a fixup commit** with the correct prefix: `git commit --allow-empty -m "red(AC-N): re-record subject for <original-SHA>"` followed by the actual missing-content commit. The empty marker preserves the audit trail and the reviewer's scan reconstructs the AC's chain.
- Surface the mis-prefix as a Notes line in the slim summary; the reviewer treats it as a `consider`-severity finding (axis=readability) when amended cleanly, and `required` (axis=correctness) when the chain is left broken.

## Common rationalizations

AC discipline is the first thing that pressures an agent to "just commit something" when iteration is slow. Catch yourself thinking the left column; do the right column. Surface the rationalization in `## Summary → Potential concerns` when you obey the right column anyway.

| rationalization | truth |
| --- | --- |
| "This AC is part of AC-2, I'll just bundle it under AC-2." | Compound AC fails the smell check — independently committable means one AC per commit. Split into a new AC with its own id; the audit trail and ship-gate need the separation. |
| "Verification is `tests pass`." | That's a vague verification; the smell check rejects it. Cite a specific test name + file + assertion (`tests/unit/permissions.test.ts: 'hides email when permission is missing'`). |
| "I'll renumber the ACs after I delete AC-2 — `AC-3` becomes the new `AC-2`." | Don't. The remaining ids stay sequential after compaction; renumbering breaks the reviewer's `git log --grep="(AC-N):"` scan for any commit that already cited the old id. |
| "I'll skip the `red(AC-N): ...` prefix this once — the message is self-explanatory." | The reviewer's git-log scan keys off the prefix. Without `(AC-N):` in the subject line, the commit is invisible to the chain check and the AC reads as missing. Amend the message or write a fixup commit; do not leave the chain broken. |
| "I'll add AC-13 mid-build because I noticed something needed." | Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug. AC-13 mid-flight breaks the build sub-phase's commit budget. |
| "Refinement of `<old-slug>` so AC-1 starts at AC-13 (continuation)." | Refinement slugs restart at AC-1. The `refines:` frontmatter is the link; the AC numbering does not carry. |
| "The verification line is 'manual test' for this AC." | A manual step is a verification, but it must be **concrete** — name the click target, the expected observable, and the operator. "I clicked around and it looked fine" is the rationalization the reviewer catches. |
| "I'll inline the AC's text in the diff comment so the reviewer can see it." | The AC lives in `plan.md`, not in source comments. The reviewer reads the plan; inlining the AC text bloats the production diff with quoted plan prose. |
