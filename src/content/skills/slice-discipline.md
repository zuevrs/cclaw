---
name: slice-discipline
trigger: when authoring or reviewing Plan / Slices entries; when committing slice work for an active cclaw run with ceremony_mode=strict
---

# Skill: slice-discipline

cclaw separates **work** from **verification** in plan.md. Slices (SL-N) are the work units the builder runs TDD cycles against; acceptance criteria (AC-N) live in a separate table and are verified after every slice in their `Verifies` list has landed. This skill covers the slice side of that split; the AC side lives in `ac-discipline.md`.

## When NOT to apply

- **Inline / trivial flows (`triage.ceremonyMode == "inline"`).** No slice table is authored — the orchestrator's trivial path commits straight with plain `git commit`.
- **Soft mode flows.** The soft-mode plan has a `## Plan` bullet list and `## Testable conditions`, NOT slice / AC tables. The builder runs one TDD cycle for the whole feature; per-slice prefixes do not exist in soft mode.
- **Mid-flight slice additions to an existing plan.** Adding new SL-N during build is scope creep. Either the new work fits an existing slice (no new id, possibly an expanded `Surface`), or it is a follow-up slug — never a mid-flight slice graft. The architect rewrites plan.md if the slice table needs revision; the builder does not.
- **Renumbering slice ids after a delete.** Don't reuse `SL-3` because `SL-2` got removed; the remaining ids stay sequential after compaction without rewriting committed slice references.
- **Refinement slugs reading parent slug slice ids.** A refining slug restarts at `SL-1` even when the parent shipped slug had `SL-7`.
- **Strict mode slice commits without the per-slice prefix.** A bare `git commit -m "fix the thing"` in strict mode breaks the reviewer's `git log --grep="(SL-N):"` scan; the slice reads as missing and the reviewer files an A-1 finding (severity=required, axis=correctness).

## slice-quality

Three checks per slice in `plan.md > ## Plan / Slices`:

1. **Atomic** — implementing this slice is one coherent TDD cycle (one RED test, one minimal GREEN, one REFACTOR consideration). A slice whose RED test would have to assert three unrelated behaviours is a compound slice; split it.
2. **Surface-bounded** — the `Surface` column lists every file the slice will touch (production + test). The builder enforces this at the diff level: a diff touching files outside `Surface` is a contract violation.
3. **Dependency-honest** — `Depends-on` lists every other SL-K whose Surface or behaviour this slice reads from. Empty `Depends-on` means the slice is genuinely independent; the architect's `Independent` column derives from `Depends-on.length === 0`.

## Smell check

| smell | example | rewrite |
| --- | --- | --- |
| compound slice | "implement the helper AND wire the UI" | split into SL-1 (helper) + SL-2 (UI calls helper) |
| Surface omits test files | `Surface: src/lib/permissions.ts` (but the slice adds a new test) | `Surface: src/lib/permissions.ts, tests/unit/permissions.test.ts` |
| missing dependency | SL-3 reads from SL-1's new export but `Depends-on: —` | `Depends-on: SL-1` |
| dependency on later slice | SL-1's `Depends-on: SL-3` | reorder so prerequisite slices have lower ids |
| Surface drift between rows | SL-1 says `Surface: src/lib/a.ts`; SL-2 also touches `src/lib/a.ts` without declaring it | SL-2 adds `src/lib/a.ts` to its Surface and a `Depends-on: SL-1` row |
| vague title | "more code" | "extract `hasViewEmail` helper from inline ternary in RequestCard" |

## Numbering

- Slice ids start at `SL-1` and are sequential within a slug.
- Refinement slugs restart at `SL-1` even when they refine a slug that had `SL-1..SL-9`.
- Do not reuse a slice id within the same slug; if you delete a slice (architect-side, before the build stage runs), the remaining ids stay sequential after compaction.

## When to add a slice mid-flight

You don't. Adding slices during build is scope creep. Either the new work fits an existing slice (possibly with an expanded `Surface` row authored by the architect via a fresh dispatch), or it is a follow-up slug.

## slice-traceability (strict mode only)

In `strict` mode, cclaw has one mandatory gate for slice work: every commit produced inside `/cc` for a slice references exactly one slice via a posture-driven subject-line prefix, and the slice ↔ commit chain is reconstructible by anyone who runs `git log --grep="(SL-N):" --oneline`.

## Rules (strict mode)

1. Every slice commit uses a posture-driven prefix in its subject line: `red(SL-N): ...` / `green(SL-N): ...` / `refactor(SL-N): ...` / `refactor(SL-N) skipped: ...` / `test(SL-N): ...` / `docs(SL-N): ...`. Pick the prefix from the slice's `Posture` value in `plan.md`.
2. Stage only slice-related changes before committing. `git add -A` is forbidden — list the files explicitly (`git add tests/<path>.test.ts src/<path>.ts`) or use `git add -p` for hunks.
3. The reviewer's ex-post checks at handoff time:
   - **Slice declared in plan.md.** `SL-N` cited in a commit must exist in the active plan; an unknown SL-N is an A-N finding.
   - **Posture-appropriate sequence.** For `test-first` / `characterization-first` postures, `green(SL-N)` must follow a `red(SL-N)` in git-log order; for `refactor-only`, only `refactor(SL-N)` is expected; for `tests-as-deliverable`, only `test(SL-N)`; for `docs-only`, only `docs(SL-N)`. See `src/posture-validation.ts:POSTURE_COMMIT_PREFIXES` for the canonical mapping.
   - **RED stages test files only.** `git show <red-SHA> --stat` for a `test-first` / `characterization-first` slice must list test files only; mixing in production files is an A-1 finding (severity=required, axis=correctness).
   - **Diff matches Surface.** Every file in the slice's commits must appear in the slice's `Surface` row of `plan.md`. Drive-by edits outside `Surface` are A-4 (severity `consider` → `required`).
4. The builder appends the slice ↔ SHA row to `flows/<slug>/build.md` under `## Slice cycles` as the durable record; the row's `commits` column carries the SHA(s).
5. The reviewer's final pass (`reviewer mode=release` at ship gate) verifies the chain is complete via `git log --grep="(SL-N):" --oneline` against the plan's Slices list.

## Slice ↔ AC mapping

Each slice's commits land first; AC verification commits land after. The architect authors the back-reference in the `Verifies` column of `## Acceptance Criteria (verification)`: every AC lists which slices verify it, and conversely every slice can be back-traced by reading which AC rows reference it.

- **Every slice MUST be referenced by at least one AC's `Verifies` column.** A slice that no AC verifies is dead work; plan-critic catches this.
- **Every AC's `Verifies` list MUST contain at least one slice.** An AC with no slice covering it is unverifiable; plan-critic catches this.
- **Slices and AC NEVER share commits.** Slice commits (`red(SL-N):` / `green(SL-N):` / `refactor(SL-N):`) carry production + test code. AC verify commits (`verify(AC-N): passing`) MUST NOT touch production code — they either carry test-only additions for verification beyond what the slice tests already cover, OR they are empty markers when the slice tests already cover the AC.

## In soft / inline modes

- In **soft mode** the builder runs one TDD cycle for the whole feature and commits with a plain `git commit -m "<feat|fix|...>: <one-line>"`. There is no `red(SL-N)` / `green(SL-N)` / `refactor(SL-N)` prefix and no slice table — the slice ↔ commit chain only exists in strict mode.
- In **inline mode** there is no slice or AC table at all; the orchestrator handled the trivial path directly with a single commit.

## When you accidentally committed without the per-slice prefix (strict mode only)

- Reviewer's `git log --grep="(SL-N):"` scan misses the commit; the slice reads as missing.
- Two options:
  - **Amend the most recent commit** with `git commit --amend -m "red(SL-N): <description>"` (only safe when the commit has not been pushed and is the most recent — the builder controls the working tree).
  - **Re-author as a fixup commit** with the correct prefix: `git commit --allow-empty -m "red(SL-N): re-record subject for <original-SHA>"` followed by the actual missing-content commit. The empty marker preserves the audit trail and the reviewer's scan reconstructs the slice's chain.
- Surface the mis-prefix as a Notes line in the slim summary; the reviewer treats it as a `consider`-severity finding (axis=readability) when amended cleanly, and `required` (axis=correctness) when the chain is left broken.

## Common rationalizations

**Cross-cutting rationalizations:** the canonical commit-prefix / amend-after-push / bundling rows live in `.cclaw/lib/anti-rationalizations.md` under category `commit-discipline`. The rows below stay here because they cover slice-discipline-specific framings (bundling-under-SL-2, vague Surface, mid-build slice addition, dependency misclaim); the catalog covers the cross-cutting commit-chain prose.

Slice discipline is the first thing that pressures an agent to "just commit everything together" when iteration is slow. Catch yourself thinking the left column; do the right column. Surface the rationalization in `## Summary → Potential concerns` when you obey the right column anyway.

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
