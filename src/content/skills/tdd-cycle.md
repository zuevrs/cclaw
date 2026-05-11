---
name: tdd-cycle
trigger: when stage=build (granularity depends on ac_mode — see below)
---

# Skill: tdd-cycle (RED → GREEN → REFACTOR)

build is a TDD stage. **What changes between modes is the granularity, not whether to write tests.**

| ac_mode | granularity | enforced by |
| --- | --- | --- |
| `inline` (trivial) | optional; one quick check is enough | nothing |
| `soft` (small/medium) | one TDD cycle per feature: write 1–3 tests that exercise the listed conditions, then implement | reviewer at `/cc-review` |
| `strict` (large-risky / security-flagged) | full RED → GREEN → REFACTOR per AC ID | `commit-helper.mjs` |

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

The Iron Law holds in every mode; only the *bookkeeping* differs. Skipping tests entirely is never the answer; loosening the per-AC ceremony is.

## The three phases

### RED — write a failing test

- Touch test files **only**. No production edits in the RED commit.
- The test must encode the AC verification line authored by planner.
- The test must fail for the **right reason** — the assertion that encodes the AC, not a syntax / import / fixture error.
- Capture the runner output that proves the failure (command + 1-3 line excerpt). This is the **watched-RED proof**.
- **Test files are named by the unit under test, NOT by the AC id.** Mirror the production module path: `src/lib/permissions.ts` → `tests/unit/permissions.test.ts` (or whatever the project's convention is — `*.spec.ts`, `__tests__/*.ts`, `*_test.go`, `test_*.py`). `AC-1.test.ts`, `tests/AC-2.test.ts`, `spec/ac3.spec.ts` are anti-patterns. The AC id lives **inside** the test name (`it('AC-1: tooltip shows email …', …)`), in the commit message (`red(AC-1): …`), and in the build log — never in the filename.
- Commit: `commit-helper.mjs --ac=AC-N --phase=red --message="red(AC-N): …"`.

### GREEN — minimal production change

- Smallest possible production diff that turns RED into PASS.
- Run the **affected-test suite first** (test impact analysis), not the full suite — fast feedback. The affected tests are: tests in the test directory mirroring the modified production module path PLUS tests that import the modified module directly. Tools: `vitest related <file>`, `jest --findRelatedTests <file>`, `pytest --testmon` if available, or a manual `grep` for imports + the mirrored test file.
- After affected tests pass, run the **full relevant suite** as the safety net before commit. A passing single test with the suite broken elsewhere is a regression, not GREEN.
- Capture both: the affected-tests command + PASS summary, AND the full-suite command + PASS summary. The two together are the **GREEN evidence** in `build.md`.
- Touch only files declared in the plan. If a file outside the plan is required, **stop** and surface the conflict.
- Commit: `commit-helper.mjs --ac=AC-N --phase=green --message="green(AC-N): …"`.

Why two-stage: affected tests close the loop in seconds → fast iteration; full suite catches regressions impact analysis missed (test discovery is heuristic, not guaranteed). In tiny repos (<100 tests, <2s suite) the two stages collapse to one command — that is fine. In larger repos the difference is real wall-clock; affected-first matters.

### REFACTOR — mandatory pass

REFACTOR is **not optional**. Even when the GREEN diff feels minimal, you must consider rename / extract / inline / type-narrow / dedup / dead-code-removal.

After the refactor edits:

1. Run the **full relevant suite** (always, not just affected). REFACTOR is the safety net for "did my rename break a place I didn't expect"; affected-test analysis is by definition incomplete here because a renamed symbol may have changed which tests are affected.
2. The suite must pass with **identical expected output** (no behaviour change). Snapshot diffs are a refactor leak; if a snapshot moved, your "refactor" is a behaviour change in disguise.

If a refactor is warranted, apply it and commit:

`commit-helper.mjs --ac=AC-N --phase=refactor --message="refactor(AC-N): …"`.

If no refactor is warranted, say so **explicitly**:

`commit-helper.mjs --ac=AC-N --phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"`.

Silence fails the gate.

## Mandatory gates per AC

`commit-helper` enforces (a) ↔ (e) mechanically. The reviewer checks (b), (d), (f), (g) on iteration 1.

(a) **discovery_complete** — relevant tests / fixtures / helpers / commands cited.
(b) **impact_check_complete** — affected callbacks / state / interfaces / contracts named.
(c) **red_test_written** — failing test exists, watched-RED proof attached.
(d) **red_fails_for_right_reason** — RED captured a real assertion failure.
(e) **green_two_stage_suite** — affected-tests pass AND full relevant suite passes after GREEN. Both commands captured in build.md.
(f) **refactor_run_or_skipped_with_reason** — REFACTOR ran (with FULL suite green afterward), or explicitly skipped with reason.
(g) **traceable_to_plan** — commits reference plan AC ids and the plan's file set.
(h) **commit_chain_intact** — RED + GREEN + REFACTOR SHAs (or skipped sentinel) recorded in flow-state.

## Vertical slicing — tracer bullets, never horizontal waves

**One test → one impl → repeat.** Even in strict mode, you do not write all RED tests for the slice and then all GREEN code. That horizontal pattern produces tests of *imagined* behaviour: the data shape you guessed, the function signature you guessed, the error message you guessed. The tests pass when behaviour breaks and fail when behaviour is fine.

The correct pattern is a tracer bullet per AC:

```
WRONG (horizontal):
  RED:   AC-1 test, AC-2 test, AC-3 test
  GREEN: AC-1 impl, AC-2 impl, AC-3 impl

RIGHT (vertical / tracer bullet):
  AC-1: RED → GREEN → REFACTOR  (commit chain closes here)
  AC-2: RED → GREEN → REFACTOR  (next chain starts here, informed by what you learned in AC-1)
  AC-3: RED → GREEN → REFACTOR
```

Each cycle informs the next. The AC-2 test is shaped by what the AC-1 implementation revealed about the real interface. `commit-helper.mjs --phase=red` for AC-2 will refuse if AC-1's chain isn't closed yet — that's the rail.

In soft mode the same principle applies at feature granularity: write 1–3 tests for the highest-priority condition, implement, then if more tests are needed for adjacent conditions, write them after you've seen the real shape of the GREEN code.

## Stop-the-line rule

When **anything** unexpected happens during build — a test fails for the wrong reason, the build breaks, a prior-green test starts failing, a hook rejects a commit — **stop adding code**. Do not push past the failure to "come back later". Errors compound: a wrong assumption in AC-1 makes AC-2 and AC-3 wrong.

Procedure:

1. Preserve evidence. Capture the failing command + 1–3 lines of output verbatim.
2. Reproduce in isolation. Run only the failing test to confirm it fails reliably.
3. Diagnose root cause. Trace the failing assertion back to a concrete cause (the actual cause, not the first plausible one). Cite the file:line in the build log.
4. Fix. The fix is a refactor of the GREEN code, a correction of the RED test (if it tested the wrong thing), or a new RED that captures the missed behaviour — never silent.
5. Re-run the **full relevant suite**. A passing single test is not GREEN if the suite is red elsewhere.
6. Resume the cycle from where you stopped, with the chain intact.

If the root cause cannot be identified in three attempts, surface a blocker to the orchestrator. Do not "make it work" by removing the test, weakening the assertion, or commenting out the failure.

## Prove-It pattern (bug fixes)

When the input is a bug fix, the order is non-negotiable:

1. **Write a failing test that reproduces the bug.** This is the watched-RED proof. If you cannot reproduce the bug with a test, you cannot fix it with confidence — go gather more context.
2. Confirm the test fails for the right reason — your test captured the bug, not a syntax / fixture / import error.
3. Fix the bug. Smallest possible production diff that turns the new test green.
4. Run the full relevant suite — the fix must not break adjacent behaviour.
5. Refactor.

Bug-fix RED commits use `--phase=red` like any other RED. The AC id is the user's bug-fix slug (e.g. `AC-1: completing a task sets completedAt`). In soft mode, the same five steps apply, just with one cycle for the whole fix and a plain `git commit`.

## Writing good tests (state, not interactions; DAMP, not DRY)

These rules apply equally to soft and strict modes. They make the difference between tests that survive a refactor and tests that have to be rewritten every time.

- **Test state, not interactions.** Assert on the *outcome* of the operation — return value, persisted record, observable side effect — not on which methods were called internally. `expect(result).toEqual(...)` is good; `expect(db.query).toHaveBeenCalledWith(...)` couples the test to the implementation.
- **DAMP over DRY in tests.** A test should read like a specification. Each test independently understandable beats a clever shared setup that reads well only after tracing helpers. Duplication in test code is acceptable when it makes each case independently readable.
- **Prefer real implementations over mocks.** The more your tests use real code, the more confidence they provide. Mock only what is genuinely outside your control (third-party APIs, time, randomness). Real > Fake (in-memory) > Stub (canned data) > Mock (interaction). Reach for the simplest level that gets the job done.
- **Test pyramid: small / medium / large.** Most tests should be small (single process, no I/O, milliseconds). A handful are medium (boundary tests, in-process integration, seconds). E2E / multi-machine tests stay reserved for critical paths only.

## Test-design checklist

Three rules that target the most common test-quality regressions in AI-coded suites.

### One logical assertion per test

A test asserts **one observable outcome**. Multiple `expect()` calls are fine when they describe **one outcome from multiple angles** (e.g. asserting the row was inserted and asserting the side-effect counter went up are still one outcome). They are NOT fine when they bundle **two unrelated outcomes** into one test.

```ts
// ❌ Two outcomes, one test
test("user is created and email sent", async () => {
  const user = await createUser({ ... });
  expect(user.id).toBeDefined();           // outcome 1
  expect(emailQueue.length).toBe(1);       // outcome 2 — split into a second test
});

// ✅ Two tests
test("user is created with an id", async () => {
  const user = await createUser({ ... });
  expect(user.id).toBeDefined();
});
test("creating a user enqueues a welcome email", async () => {
  await createUser({ ... });
  expect(emailQueue.length).toBe(1);
});
```

The reviewer cites a "two-outcome test" as severity `consider` (axis=readability) — the test reads as fine until one of the outcomes regresses, at which point the failure message is ambiguous.

### Prefer SDK-style boundary APIs over generic fetchers

When mocking is unavoidable (the test rung touches a third-party HTTP API), prefer **SDK-style boundary APIs** (`getUser()`, `getOrders()`, `createInvoice()`) over **generic fetchers** (`fetch(endpoint, options)`, `http.request(url, ...)`).

Generic fetchers force the mock to **switch on URL / method / body** to return the right shape; SDK-style methods can be mocked individually. Concretely:

```ts
// ❌ Generic fetcher — mock has to encode every endpoint shape
vi.mocked(fetch).mockImplementation(async (url, opts) => {
  if (url === "/users/42") return { json: async () => ({ id: 42, name: "Ada" }) };
  if (url === "/orders/by-user/42") return { json: async () => [...] };
  if (opts.method === "POST" && url === "/invoices") return { json: async () => ({ ok: true }) };
  throw new Error("unhandled URL in mock");
});

// ✅ SDK-style — mock each method
vi.mocked(api.getUser).mockResolvedValue({ id: 42, name: "Ada" });
vi.mocked(api.getOrdersByUser).mockResolvedValue([...]);
vi.mocked(api.createInvoice).mockResolvedValue({ ok: true });
```

The SDK form **gives each endpoint its own type signature**, which means the mock cannot accidentally return the wrong shape; a refactor of one endpoint touches one mock, not a switch statement that touches all.

The reviewer cites a generic-fetcher mock with conditional logic as **Generic-fetcher mock with switch-on-URL logic**, severity `consider`. The fix is usually a small refactor: introduce an SDK-style adapter at the network boundary, then mock the adapter in tests.

### Smell catalogue — primitive obsession & feature envy

When a test reveals a structural smell in the production code, the slice-builder surfaces the smell as a finding **even if the AC does not require fixing it**. Two named smells the reviewer cites:

- **Primitive obsession.** A function that takes `(string, string, number)` where each `string` has a different meaning (e.g. `(userId, accountId, ageInDays)`) is at risk of caller-side mistakes (passing args in the wrong order). The fix is a typed value object (`UserId`, `AccountId`, `Days`); refactor surfaces the type system to catch the mistake. Severity: `consider`.

- **Feature envy.** A method on `A` that mostly reads / writes fields of `B` is "envious" of `B` — it probably belongs on `B`. Symptom: `a.method()` reads as `if (b.x === ...) b.y = b.z + ...`. The fix is to move the method to `B`. Severity: `consider`.

These are surfaced under the build summary's `### Noticed but didn't touch` (per `surgical-edit-hygiene`); the AC scope does NOT expand to fix them.

## Anti-patterns

The TDD cycle has a small number of well-known failure modes, all catalogued in `antipatterns.md`. The reviewer cites the antipattern entry directly; this list is a lookup.

- **Skipping RED, scrambling phases, missing REFACTOR, production code in the RED commit.** A-1 — TDD phase integrity broken. The cycle is the contract; an audit trail with reordered phases is unverifiable.
- **Single test green, didn't run the suite.** that is a regression, not GREEN. Run the full relevant suite after every implementation change.
- **Stage everything with `git add -A`.** A-2 — work outside the AC. Stage AC-related files explicitly (`git add <path>` per file, or `git add -p`).
- **Horizontal slicing (RED-batch then GREEN-batch).** writing all RED tests first, then all GREEN code produces tests of imagined behaviour. One test → one impl → repeat. See the Vertical Slicing section above.
- **Pushing past a failing test.** the next cycle is built on the previous cycle's invariants; if those are broken, you are debugging a stack of broken assumptions. Stop the line, root-cause, then resume.
- **Mocking what should not be mocked.** A-3 — mocking a database driver for a query test reads green and breaks in production. Use a real test DB or an in-memory fake; mock only what is genuinely outside your control.
- **Test file named after the AC id** (`AC-1.test.ts`, `tests/AC-2.spec.ts`). The reviewer cites this as severity=`required`. Mirror the unit under test in the filename; carry the AC id inside the test name and commit message only.

## Fix-only flow

When reviewer returns `block`, the same TDD cycle applies to the fix:

- F-N changes observable behaviour → new RED test that encodes the corrected behaviour, then GREEN, then REFACTOR.
- F-N is purely a refactor → commit under `--phase=refactor`.
- F-N is a docs / log / config nit → commit under `--phase=refactor` or `--phase=refactor --skipped`.

The AC id stays the same; commit messages cite `F-N`.

## When TDD does not apply

The single exception is **bootstrap of the test framework itself** — a slug whose AC-1 is "test framework installed and one passing example test exists". In that case the orchestrator must mark the slug as `build_profile: bootstrap` in plan frontmatter, and `commit-helper` accepts the GREEN commit without a prior RED for AC-1 only. Every subsequent AC and every other slug uses the full cycle.

## Anti-rationalization table (T2-8, addyosmani pattern; v8.13)

This table is the **explicit list of excuses an agent will produce to skip the cycle**, paired with the truth. When you catch yourself thinking the left column, do the right column instead. Surface the rationalization in your slim-summary Notes when you choose the right column anyway, so the reviewer can see the discipline.

| rationalization | truth |
| --- | --- |
| "This is a 5-line change, RED isn't worth the time." | RED takes 60-90 seconds and produces an audit trail. Without it, you're trusting a 5-line read against a 500-line context. The cost was always paid by the next agent who had to verify it. |
| "I already know this works because I tested it manually." | Manual tests don't ship; the watched-RED proof does. The next agent who reads the build log can't repeat your manual test. |
| "The full suite is slow; I'll just run the test for this AC." | A regression in another module makes the diff non-shippable regardless of whether your AC's test passes. Run the relevant suite, not the single test. |
| "REFACTOR is unnecessary here, the GREEN code is already clean." | Then say so explicitly with `--phase=refactor --skipped` and a one-line reason. Silence on REFACTOR fails the gate; explicit skip is fine. |
| "I added a try/catch around the failing path so the test passes." | The RED test was supposed to fail because the production code was wrong; suppressing the error doesn't fix it. Restore the failure, then fix the production code. |
| "I mocked the database to make the test green faster." | A-3 finding. Real DB > in-memory fake > stub > mock. Reach for the simplest level that gets the job done. |
| "The test file named `AC-1.test.ts` is fine — it's clearer where this test lives." | Required-severity finding. Tests are named after the unit under test; the AC id lives in the test name + commit message. `tests/unit/permissions.test.ts` is correct. |
| "I bypassed commit-helper just this once because the script was slow." | The traceability gate is the contract. Bypassing it once breaks resume / review / ship for everyone downstream. Restore the chain or surface the script bug as an A-N finding. |
