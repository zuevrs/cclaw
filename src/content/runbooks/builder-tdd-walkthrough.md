# Builder TDD walkthrough

End-to-end bash transcripts for a strict-mode build cycle: per-slice RED → GREEN → REFACTOR plus the post-slice AC verification pass. Lifted out of `agents/builder.md` to free up in-prompt budget; the in-prompt anchor is 3 lines pointing here.

## Worked example — full cycle for one slice + AC verification

```bash
# Discovery (no commit, just citations in flows/<slug>/build.md)
$ rg "ViewEmail" src/ tests/
src/lib/permissions.ts:14: ...
tests/unit/permissions.test.ts:23: ...

# SL-1: RED
$ git add tests/unit/permissions.test.ts
$ git commit -m "red(SL-1): hasViewEmail returns true when claim set"
[master a1b2c3d] red(SL-1): hasViewEmail returns true when claim set
# watched-RED proof: 1 failing test — record in build.md row

# SL-1: GREEN
$ git add src/lib/permissions.ts
$ git commit -m "green(SL-1): minimal hasViewEmail implementation"
[master 4e5f6a7] green(SL-1): minimal hasViewEmail implementation
# full suite: 47 passed, 0 failed — record in build.md row

# SL-1: REFACTOR — applied
$ git add src/lib/permissions.ts
$ git commit -m "refactor(SL-1): hoist claim-name to constant"
[master 9e2c3a4] refactor(SL-1): hoist claim-name to constant

# SL-2 (depends on SL-1) follows the same RED → GREEN → REFACTOR cycle …

# AC verification pass (after every slice in plan.md has landed)
$ npm test    # confirm merged state is green
$ git commit --allow-empty -m "verify(AC-1): passing"
[master 1c2d3e4] verify(AC-1): passing
# AC row in build.md: Evidence cites tests/unit/permissions.test.ts:32 +
# tests/unit/RequestCard.test.tsx:18 already committed under SL-1 + SL-2.

$ vim tests/perf/request-card.bench.ts    # AC-2 needs a perf budget assertion
$ git add tests/perf/request-card.bench.ts
$ git commit -m "verify(AC-2): passing"
[master 5f6a7b8] verify(AC-2): passing
```

`flows/<slug>/build.md` ends up with a `## Slice cycles` table (SL-1, SL-2, …) and a `## AC verification` table (AC-1, AC-2, …). The reviewer at handoff time runs `git log --grep="(SL-N):" --oneline` per slice and `git log --grep="verify(AC-N):" --oneline` per AC, confirming the dual chain.

## Worked example — REFACTOR explicitly skipped (path: build.md declaration, no empty commit)

The default is to record a skipped refactor in the slice's `build.md` row instead of an empty commit. No `git commit` for the refactor phase; the reviewer reads the row and treats the literal `Refactor: skipped` token as the satisfied refactor slot.

```markdown
| SL-2 | tests/unit/clock.test.ts:1, src/lib/clock.ts:14 | "advances by one second" — TypeError: clock.tick is not a function | npm test src/lib/clock.ts → 32 passed, 0 failed | Refactor: skipped — 8-line addition, idiomatic; nothing to extract | red a1b2c3d, green 4e5f6a7 |
```

For backwards compat with already-shipped slugs, the legacy empty-marker commit still satisfies the gate:

```bash
$ git commit --allow-empty -m "refactor(SL-2) skipped: 8-line addition, idiomatic; nothing to extract"
[master b3d4e5f] refactor(SL-2) skipped: 8-line addition, idiomatic; nothing to extract
# Legacy path; the reviewer reads the literal "skipped:" token from git log.
```

## Why these are walkthroughs, not contracts

The TDD-cycle contract (one slice per cycle, three commits, prefix shapes, AC verify pass after all slices land) lives in the builder's in-prompt body (Hard rules + Strict-mode commit shapes). These transcripts are *instances* of the contract — useful when the agent needs to see the literal `git add` / `git commit` shape but redundant for a fresh agent that has already read the in-prompt rules.

When in doubt, read the in-prompt Hard rules first; come here for the bash-level shape.
