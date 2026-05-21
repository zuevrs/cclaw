---
name: ac-discipline
trigger: when authoring or reviewing AC entries; when committing AC verification for an active cclaw run with ceremony_mode=strict
---

# Skill: ac-discipline

This skill covers both AC concerns: the bar for every AC entry (formerly **ac-quality**), and the `verify(AC-N): passing` commit contract that wires AC ↔ verification chain in strict mode (formerly **ac-traceability**). v8.63 split work from verification: slice work (`red(SL-N):` / `green(SL-N):` / `refactor(SL-N):`) lives under `slice-discipline.md`; this skill keys off `AC-N` for the verification pass only.

## When NOT to apply

- **Inline / trivial flows (`triage.ceremonyMode == "inline"`).** Single-line edits commit straight with plain `git commit`; no AC ids exist to trace.
- **Soft mode commit chain.** In `soft` mode plain `git commit` is the contract. There is no per-criterion prefix and no AC↔commit chain; the reviewer reads `build.md` and the feature-level commit message instead.
- **Mid-flight AC additions to an existing plan.** Adding new AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug — never a mid-flight AC graft.
- **Renumbering AC ids after a delete.** Don't reuse `AC-3` because `AC-2` got removed; the remaining ids stay sequential after compaction without rewriting committed AC references.
- **Refinement slugs reading parent slug AC ids.** A refining slug restarts at `AC-1` even when the parent shipped slug had `AC-12`.
- **Strict mode AC verification without the `verify(AC-N): passing` subject.** A bare `git commit -m "all green"` for the AC verification pass breaks the reviewer's `git log --grep="verify(AC-N):"` scan; the AC reads as unclosed and the reviewer files an A-1 finding (severity=required, axis=correctness).

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

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a fresh slug.

## ac-traceability (v8.63 — AC verification pass only)

This part of the skill applies only when the active flow's `ceremony_mode` is `strict` (set at the triage gate for large-risky / security-flagged work). In `inline` and `soft` modes there is no per-criterion commit prefix and no AC↔commit chain — see `agents/triage.md` (routing contract) and `runbooks/triage-gate.md` (orchestrator-side Triage procedure) for what each mode does.

In `strict` mode (v8.63+), cclaw separates work from verification:

- **Slice work** (`red(SL-N): …` → `green(SL-N): …` → `refactor(SL-N): …`) is the TDD unit. Slices land in commits keyed by `SL-N`; the reviewer's `git log --grep="(SL-N):" --oneline` reconstructs the slice chain. See `slice-discipline.md` for the slice-side contract.
- **AC verification** is THIS skill's domain: after every slice in an AC's `Verifies` list lands and the full suite is green on the merged state, the builder stamps one `verify(AC-N): passing` commit per AC. The reviewer's `git log --grep="verify(AC-N):" --oneline` reconstructs the AC chain.

The two chains are independent; the dual grep is what makes the audit trail reconstructible by anyone who runs git log against the build range.

## Rules (strict mode)

1. **One `verify(AC-N): passing` commit per AC, after all slices in `Verifies` land.** Subject MUST be exactly `verify(AC-N): passing` — the reviewer's git-log scan keys off this verbatim. The body MAY include a one-line evidence citation (test file:test-name + suite output line) and the optional `validates: KA-N` payload (v8.85; one line per validated assumption from `## Key assumptions to validate`).
2. **The verify commit's diff is empty OR test-only.** Production code (`src/**`, `lib/**`, `app/**`) NEVER appears in a verify commit. If the AC cannot pass without a production edit, the responsible slice is incomplete — return to its TDD cycle; do not paper over with a verify commit that secretly ships behaviour.
3. **Stage only test files (or commit empty).** `git add tests/path/to/ac-coverage.test.ts && git commit -m "verify(AC-N): passing"` when the AC needs a verification target beyond what the slice tests already cover (perf budget, integration scenario, contract assertion); OR `git commit --allow-empty -m "verify(AC-N): passing"` when the slice tests already exercise the AC's observable behaviour. `git add -A` is forbidden — list the test files explicitly.
4. **The reviewer's ex-post checks at handoff time:**
   - **AC declared in plan.md.** `AC-N` cited in a verify commit must exist in `plan.md > ## Acceptance Criteria (verification)`.
   - **One verify commit per AC.** A duplicate `verify(AC-N): passing` commit for the same AC is A-1 (axis=correctness); a fresh re-verify after a fix-only edit is a new commit, not an amend of the prior verify.
   - **Verify after slices.** A `verify(AC-N): passing` commit landed BEFORE every slice in its `Verifies` list landed is A-1 (severity=required).
   - **Production-code freedom.** `git show --stat <verify(AC-N) SHA>` MUST be empty OR list test files only; a production-code touch in a verify commit is A-1 (severity=critical, axis=correctness).
5. **`build.md > ## AC verification` carries the AC↔SHA row** as the durable record: `| AC-N | Verifies (slices) | Evidence | commit |`. The Evidence cell cites the test file:test-name (or perf/integration target); the commit cell carries the verify SHA.
6. **The reviewer's final pass (`reviewer mode=release` at ship gate)** verifies the dual chain via `git log --grep="(SL-N):" --oneline` (slice work) AND `git log --grep="verify(AC-N):" --oneline` (AC verification) against the plan's Slices + Acceptance Criteria tables.

## Archived-flow back-compat (pre-v8.63)

Slugs authored before v8.63 carry only a `## Acceptance Criteria` section (no `## Plan / Slices` table) and used `red(AC-N):` / `green(AC-N):` / `refactor(AC-N):` for AC work (no separate verify pass). The reviewer auto-detects the archived shape from the absence of `## Plan / Slices` in `plan.md` and applies the legacy per-posture recipe directly against the `(AC-N)` token. New strict-mode slugs always carry both tables and key slice work off `(SL-N)` + AC verification off `verify(AC-N): passing`; do not mix the two shapes within a single slug.

## In soft / inline modes

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

## Common rationalizations

**Cross-cutting rationalizations:** the canonical commit-prefix / amend-after-push / bundling rows live in `.cclaw/lib/anti-rationalizations.md` under category `commit-discipline`. The rows below stay here because they cover AC-discipline-specific framings (bundling-under-AC-2, vague verification, mid-build AC addition, refinement renumbering, verify-commit purity); the catalog covers the cross-cutting commit-chain prose.

AC discipline is the first thing that pressures an agent to "just commit something" when iteration is slow. Catch yourself thinking the left column; do the right column. Surface the rationalization in `## Summary → Potential concerns` when you obey the right column anyway.

| rationalization | truth |
| --- | --- |
| "This AC is part of AC-2, I'll just bundle it under AC-2." | Compound AC fails the smell check — independently committable means one AC per commit. Split into a new AC with its own id; the audit trail and ship-gate need the separation. |
| "Verification is `tests pass`." | That's a vague verification; the smell check rejects it. Cite a specific test name + file + assertion (`tests/unit/permissions.test.ts: 'hides email when permission is missing'`). |
| "I'll renumber the ACs after I delete AC-2 — `AC-3` becomes the new `AC-2`." | Don't. The remaining ids stay sequential after compaction; renumbering breaks the reviewer's `git log --grep="verify(AC-N):"` scan for any commit that already cited the old id. |
| "I'll skip the `verify(AC-N): passing` commit — the slice tests already cover the AC." | The slice commits are the TDD unit; the `verify(AC-N): passing` commit is the atomic AC closure signal (v8.63). Without it the AC reads as unclosed even when every contributing slice landed green. Stamp the verify commit (empty body is fine) so the reviewer's dual grep reconstructs the AC chain. |
| "I'll add AC-13 mid-build because I noticed something needed." | Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it's a follow-up slug. AC-13 mid-flight breaks the build sub-phase's commit budget. |
| "Refinement of `<old-slug>` so AC-1 starts at AC-13 (continuation)." | Refinement slugs restart at AC-1. The `refines:` frontmatter is the link; the AC numbering does not carry. |
| "The verification line is 'manual test' for this AC." | A manual step is a verification, but it must be **concrete** — name the click target, the expected observable, and the operator. "I clicked around and it looked fine" is the rationalization the reviewer catches. |
| "I'll inline the AC's text in the diff comment so the reviewer can see it." | The AC lives in `plan.md`, not in source comments. The reviewer reads the plan; inlining the AC text bloats the production diff with quoted plan prose. |
| "The verify(AC-N) commit needs a small production fix to actually pass — I'll just slip it in." | NO. The verify commit is test-only or empty by contract; production-code touch is A-1 critical (axis=correctness). If the AC won't pass on the merged state, the responsible slice is incomplete — return to its TDD cycle (`red(SL-K): …` → `green(SL-K): …` → `refactor(SL-K): …`), then re-emit `verify(AC-N): passing` as a fresh commit. |
