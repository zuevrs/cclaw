---
name: review-loop
trigger: when reviewer or security-reviewer is invoked
---

# Skill: review-loop

Review is a producer ↔ critic loop, not a single pass. Iteration N proposes findings; `slice-builder` (in `fix-only` mode) closes them; iteration N+1 re-checks. The loop ends only when one of three convergence signals fires (see "Convergence detector" below). This is the cclaw analogue of the Karpathy "Ralph loop": short cycles, an explicit ledger, and hard rules for when to stop.

Every iteration runs the **Five Failure Modes** checklist:

1. Hallucinated actions
2. Scope creep
3. Cascading errors
4. Context loss
5. Tool misuse

For each mode the reviewer answers yes/no with a citation when "yes". A "yes" without a citation is itself a finding (you cited nothing, that is the finding).

## Concern Ledger

Every `flows/<slug>/review.md` carries an append-only ledger. Each row is a single finding; rows are never edited or deleted, only appended.

```markdown
## Concern Ledger

| ID | Opened in | Mode | Axis | Severity | Status | Closed in | Citation |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F-1 | 1 | code | correctness | required | closed | 2 | `src/api/list.ts:14` |
| F-2 | 2 | code | readability | consider | open | – | `tests/integration/list.test.ts:31` |
| F-3 | 1 | code | perf | nit | open | – | `src/api/list.ts:88` |
```

Rules:

- **F-N** ids are stable and global per slug — never renumber. If a finding is superseded, append `F-K supersedes F-J` instead.
- **Axis** is one of `correctness` | `readability` | `architecture` | `security` | `perf`. Pick the dimension the finding speaks to; never blank.
- **Severity** is one of `critical` | `required` | `consider` | `nit` | `fyi`. Ship gate threshold depends on `acMode` (see below).
- **Status** is `open` | `closed`. A closed row records the iteration that closed it.
- **Citation** is a real `file:line` (or test id, or commit SHA). No prose-only findings — if you cannot cite, you do not have a finding yet.

When iteration N+1 runs, the reviewer reads the ledger first, re-validates each open row (still open? closed by a fix? superseded?), then appends new findings as F-(max+1). Closing a row requires a citation to the fix evidence (commit SHA, test name, or new file:line).

## Five axes (mandatory walk per iteration)

Walk every diff with the five axes in mind. Per-axis checklist:

| axis | what to check | typical findings |
| --- | --- | --- |
| `correctness` | does the code match the AC verification line? edge cases? tests assert state, not interactions? | wrong branch, missing edge case, test passes for wrong reason, mocks-of-things-we-own |
| `readability` | clear names, control flow, no dead code, no unnecessary cleverness | unclear name, long fn, hidden side effect |
| `architecture` | pattern fit, coupling, abstraction level, diff size | new dep when stdlib works; cross-layer reach; `>300 LOC` for one logical change → split |
| `security` | pre-screen for surfaces handled deeper by `security-reviewer` | unsanitised input, secrets in logs, missing authn/authz, encoding mismatch |
| `perf` | hot-path quality | N+1, unbounded loop, sync-where-async, missing pagination |

A reviewer that records zero findings on every axis must explicitly say so in the iteration block ("Five-axis pass: no findings on any axis"); silence is not the same as a clean review.

## Severity ↔ acMode → ship gate

| acMode | open severity → blocks ship |
| --- | --- |
| `strict` | `critical` OR `required` |
| `soft` | `critical` only (`required` carries over) |
| `inline` | reviewer not invoked |

`consider` / `nit` / `fyi` never block ship. They carry over to `flows/<slug>/ship.md` (and `flows/<slug>/learnings.md` for `consider`) but do not delay ship.

## Convergence detector (acMode-aware)

The loop ends when ANY of these fires:

1. **All ledger rows closed.** Decision: `clear`.
2. **Two consecutive iterations append zero new blocking findings AND every open row is non-blocking.** Decision: `clear` with non-blocking carry-over to `flows/<slug>/ship.md` and `flows/<slug>/learnings.md`. "Blocking" depends on acMode (see table above).
3. **Hard cap reached** (5 iterations) with at least one open blocking row remaining. Decision: `cap-reached`. Stop; surface to user.

Tie-breaker: if iteration 5 closes the last blocking row, return `clear` (signal #1) even though the cap was hit. The cap exists to bound runaway loops, not to punish a slug that converges on the last attempt.

## Hard cap

- 5 review iterations per slug. After the 5th, the reviewer writes `status: cap-reached` and stops.
- The orchestrator surfaces every remaining open ledger row and recommends `/cc-cancel` (split into a fresh slug) or `accept-and-ship` (only valid if every remaining open row is non-blocking under the active acMode).

## Decision values

- `block` — at least one ledger row is blocking under the active acMode + open. `slice-builder` (mode=fix-only) must run next; then re-review.
- `warn` — open rows exist, all non-blocking, convergence detector signal #2 has fired. Ship may proceed; carry-over.
- `clear` — signal #1 (all closed) OR signal #2 (non-blocking convergence). Ready for ship.
- `cap-reached` — signal #3 fired with at least one open blocking row remaining.

## Worked example — three-iteration convergence (strict mode)

```markdown
## Iteration 1 — code — 2026-04-18T10:14Z

Five-axis pass:
- correctness: F-1 (missing pagination cursor).
- readability: no findings.
- architecture: no findings.
- security: no findings.
- perf: F-2 (no negative test for empty page; potential N+1 if cursor regressed).

Findings:
- F-1 correctness/required — `src/api/list.ts:14` — missing pagination cursor.
- F-2 perf/consider — `tests/integration/list.test.ts:31` — no negative test for empty page.

Decision: block (F-1 is required-severity in strict). slice-builder (mode=fix-only) invoked next.

## Iteration 2 — code — 2026-04-18T10:39Z

Ledger reread:
- F-1: closed — fix at `src/api/list.ts:18` (commit 7a91ab2). Citation matches.
- F-2: open — no fix attempted (consider carry-over).

Five-axis pass: no new findings on any axis.

Decision: warn. Convergence signal #2 needs another zero-blocking iteration.

## Iteration 3 — code — 2026-04-18T11:02Z

Ledger reread:
- F-1: closed (sticky).
- F-2: open (consider carry-over).

Five-axis pass: no findings. Two consecutive zero-blocking iterations recorded.

Decision: clear (signal #2). F-2 carries to ships/<slug>.md and learnings/<slug>.md.
```

## Common pitfalls

- Adding "implicit" findings without citations because "the reviewer can see it". The reviewer cannot. Cite `file:line` or do not record the finding.
- Renumbering F-N ids when an old finding is superseded. Append a new row `F-K supersedes F-J`; never rewrite history.
- Closing a row without a fix citation. Closing is itself a claim — record the SHA / test name / file:line that proves the fix.
- Treating "no new findings" as instant clear. The convergence detector requires *two* consecutive zero-blocking iterations; one is not enough.
- Skipping the convergence check and looping until cap. The detector exists so easy slugs ship fast; do not waste budget.
- Mixing `code` and `text-review` modes within one iteration. Each iteration declares one mode in its header.
- Recording a finding without an axis. Every row carries an axis (one of `correctness` / `readability` / `architecture` / `security` / `perf`). Pick the dimension the finding speaks to; never blank.
- Marking everything as `required` because "it might matter". Severity is graduated: `critical` for ship-breaking, `required` for must-fix-before-ship, `consider` for suggestion, `nit` for minor, `fyi` for context only. Padding severity makes it useless.
- Walking only one or two axes when the diff touches all five. The Five-axis pass is mandatory every iteration; record "no findings" for axes you walked but found clean. Silence is a smell — say what you walked.
