---
name: tdd-and-verification
trigger: when stage=build (granularity depends on ac_mode — see below); before any handoff between specialists or before ship; auto-triggered for slice-builder (between phases) and reviewer (before dispatch); when the slug is identified as a pure refactor
---

# Skill: tdd-and-verification (RED → GREEN → REFACTOR + staged verification gate + refactor safety)

This merged skill covers the full build-stage loop: the test-first cycle (formerly **tdd-cycle**), the staged verification gate that wraps handoffs (formerly **verification-loop**), and the behaviour-preservation rules that govern the REFACTOR step on pure-refactor slugs (formerly **refactor-safety**).

## tdd-cycle

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
- The test must encode the AC verification line authored by ac-author.
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

REFACTOR is **not optional**. Even when the GREEN diff feels minimal, you must consider rename / extract / inline / type-narrow / dedup / dead-code-removal. **Consult `code-simplification.md`** for the canonical rubric (five principles + four-step process) — that skill is cclaw's home for the simplification slot and bounds what counts as a real simplification vs a stylistic preference. The decision to apply or skip a refactor cites the rubric, not personal taste.

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

These are surfaced under the build summary's `### Noticed but didn't touch` (per `commit-hygiene` / `surgical-edit-hygiene` rules); the AC scope does NOT expand to fix them.

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

## Posture mapping (v8.36, supersedes "When NOT to apply")

Every AC in strict mode carries a **`posture`** value in its `plan.md` frontmatter — a per-AC annotation that picks the right TDD ceremony. The default is `test-first` (the standard RED → GREEN → REFACTOR cycle); the other five values cover the cases where the standard cycle is structurally absent or actively wrong. The ac-author sets the posture using the heuristic table in its prompt; the slice-builder reads it and selects the ceremony; the reviewer applies the posture-specific check; and `commit-helper.mjs` enforces the ceremony with the right `--phase` flag.

The mapping is mechanical — there is no "did the agent feel like TDD today?" judgement call. Pick the row that matches the AC's posture; do exactly what that row says.

| posture | ceremony required | commit-helper invocation | verification-loop mode | reviewer checks |
| --- | --- | --- | --- | --- |
| **`test-first`** (default) | RED → GREEN → REFACTOR (3 commits) | `--phase=red`, then `--phase=green`, then `--phase=refactor` (or `--phase=refactor --skipped`) | full (build, lint, typecheck, test, scope) | A-1 fires if RED is missing or stages production files; full TDD-integrity check |
| **`characterization-first`** | RED (pin existing behaviour) → GREEN (tiny shape fix) → REFACTOR (the real structural change) (3 commits) | same as `test-first`: `--phase=red|green|refactor` | full | same as `test-first` plus a check that the RED test actually exercises the code about to be refactored |
| **`tests-as-deliverable`** | write the contract / integration / snapshot test, capture deterministic outcome, single commit | `--phase=test` (helper records SHA under `phases.green`) | full (the test IS the deliverable; it must compile, run, and produce a deterministic outcome) | A-1 does NOT fire; reviewer checks (a) test compiles + runs, (b) deterministic outcome (named pass OR named expected-failure), (c) `touchSurface` is test/spec files only |
| **`refactor-only`** | pin existing suite (run, capture pass) → apply refactor → re-run suite (must pass with identical output), single commit | `--phase=refactor` (helper skips the RED+GREEN gate for this posture) | full (existing suite is the safety net) | A-1 does NOT fire; reviewer checks (a) pre-refactor suite captured passing, (b) post-refactor suite passes with same output, (c) no snapshot diff (snapshot move is `critical` axis=correctness); a `No-behavioural-delta:` block in the commit body is required |
| **`docs-only`** | single commit; no behaviour change | `--phase=docs` (helper refuses if `touchSurface` contains a source file — the predicate-as-double-check) | `diff-only` (skip build/typecheck/lint/test gates; only working-tree cleanliness + touchSurface match) | A-1 does NOT fire; reviewer checks (a) `touchSurface` matches the exclusion set, (b) verification ran in `diff-only` mode |
| **`bootstrap`** | AC-1: GREEN-only (runner is being installed; no RED is possible) ⇒ subsequent AC: full `test-first` cycle | AC-1: `--phase=green` (helper skips RED for AC-1 when posture is bootstrap); AC-2+: standard `--phase=red|green|refactor` | full | A-1 fires on AC-2+ if RED is missing; does NOT fire on AC-1 of a bootstrap slug |

The predicate-as-double-check: `commit-helper.mjs` runs `is_behavior_adding(touchSurface)` on every commit. The function returns `false` iff every file in `touchSurface` matches the exclusion set (`*.md`, `*.json`, `*.yml|*.yaml`, `*.toml`, `*.ini`, `*.cfg`, `*.conf`, `.env*`, `tests/**`, `*.test.*`, `*.spec.*`, `__tests__/**`, `docs/**`, `.cclaw/**`, `.github/**`). When `posture` says `docs-only` but the predicate returns `true`, the commit is refused with `posture=docs-only contradicts touchSurface containing source files`. The posture is the **annotation** an agent picked; the predicate is the **gate** that catches a contradiction.

### Bootstrap escape — the only AC-1 exception to RED-before-GREEN (v8.38, named)

AC-1 of a slug whose first task is installing the test framework itself sets `posture: bootstrap`; `commit-helper.mjs` accepts a GREEN commit without a RED predecessor for that AC only. AC-2+ in the same slug uses the full RED → GREEN → REFACTOR cycle. The legacy `state.buildProfile === "bootstrap"` field is still honoured for in-flight projects whose flow-state predates v8.36 — when set, the helper treats every AC as `posture: bootstrap` regardless of what its stanza says. Surfacing this as a named subsection (rather than a runtime knob in the hook body) is the v8.38 follow-up to the audit note that the bootstrap path was previously a hidden escape.

### Worked examples — picking the posture

Each of the five legacy "When NOT to apply" examples maps cleanly to a posture row above; the canonical TDD list is now the table, not the prose.

- **Pure prose / config edits** (README typo, CHANGELOG edit, `package.json` version bump): posture is **`docs-only`**. Single `docs(AC-N): ...` commit; verification-loop in `diff-only` mode; `touchSurface` constrained to docs/config files by the predicate.
- **Mechanical renames** driven by `commit-helper`'s known-safe set (e.g. rename a symbol via codemod): posture is **`refactor-only`**. Pin the suite, perform the rename, re-run the suite, single `refactor(AC-N): ...` commit. If the existing suite has insufficient coverage of the renamed code, surface a `required` finding and switch the posture to `characterization-first` — the rename cannot land without a pin.
- **Contract / integration / snapshot test slug** (e.g. "add a contract test against the public API"): posture is **`tests-as-deliverable`**. Write the test, run it, capture deterministic outcome, single `test(AC-N): ...` commit. The test IS the AC; there is no fake RED-then-immediately-GREEN dance.
- **Bootstrap of the test framework itself** (a slug whose AC-1 is "test framework installed and one passing example test exists"): posture is **`bootstrap`** on AC-1. The orchestrator must set posture on each AC explicitly; the legacy `build_profile: bootstrap` field is still recognised by `commit-helper.mjs` for backward compatibility, but new plans should use posture.
- **Characterization slug** (about to refactor a legacy module and want a safety net before touching it): posture is **`characterization-first`** on the pinning AC, then **`refactor-only`** on the structural-change AC.

## When NOT to apply

The posture mapping above covers every AC the slice-builder will see. Two cases live OUTSIDE the posture system because they are not "an AC with a different ceremony" — they are "no AC at all in the strict-mode sense", and so the skill itself does not apply:

- **`triage.acMode == "inline"`.** Trivial inline edits commit straight without the per-AC commit chain. A quick sanity check is enough; the audit-trail cost is wasted on a typo. The orchestrator never dispatches the slice-builder for inline mode, so this skill never opens.
- **Discovery-phase artifacts** (design Phases 0-7 in main context, plan / decisions / ADR drafts before the build stage opens). Those produce prose, not behaviour; the build stage is where the posture system opens. The skill is a build-stage rule, not a discovery-stage rule.

For every other AC, pick a row from the posture mapping above and follow it. There is no third "skip TDD entirely" escape hatch beyond these two — every other "we don't need a test here" instinct maps to **`docs-only`**, **`refactor-only`**, or **`tests-as-deliverable`** posture and gets the corresponding (smaller) ceremony, not zero ceremony.

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

## verification-loop

A **staged verification gate**. Each step runs only when the previous step passed. The point: catch regressions at the earliest, cheapest gate, instead of letting build/lint failures surface at ship and costing a full review iteration.

## Gates (in order)

1. **build** — `npm run build` (or the project's equivalent). Compilation / bundling success. Cheapest gate, catches type errors that escape the editor LSP, missing imports, etc.
2. **typecheck** — `npm run typecheck` / `tsc --noEmit` / `pyright` / `mypy` / `go vet`. Run separately from `build` because some build pipelines emit on type errors and only fail at runtime; the typecheck gate makes the contract explicit.
3. **lint** — `npm run lint` / `ruff check` / `golangci-lint run`. Style + obvious-bugs gate. Lint warnings count as **failures** here when the project has lint-as-error in CI; otherwise warnings pass but are recorded.
4. **test** — the project's full relevant suite (`npm test`, `pytest`, `go test ./...`). The slice-builder's GREEN evidence is a *subset* of this gate (per-AC suite); verification-loop runs the full repo suite.
5. **security** — when the slug's `security_flag` is true OR the diff matches the security-sensitive heuristic from the review stage (see start-command.ts), run the project's security check (`npm audit --audit-level=high`, `pip-audit`, `bandit`, `govulncheck`). When the check is absent, skip with an explicit "no security check configured" line in the verification log.
6. **diff** — `git diff --stat` + `git diff --name-only` against the slug's plan-base. Verifies the working tree is clean (no uncommitted changes) and the touched-file set matches the AC's union of touchSurfaces. Detects accidental commits to files outside the slug.

## How to run

Run gates **in order**. On failure of any gate:

- **Stop**. Do not continue to later gates — they will be running on a known-broken state and their output is misleading.
- **Capture** the failing gate's output (command + 1-3 line failure excerpt).
- **Decide** the recovery path:
  - If the gate is `build` / `typecheck` / `lint` and the failure is mechanical (missing semicolon, unused import, type widening): fix it, re-run from gate 1. **No reviewer dispatch yet.**
  - If the gate is `test` and the failure is a real regression: bounce the slice back to slice-builder in `fix-only` mode citing the failing test. **No reviewer dispatch yet.**
  - If the gate is `security`: surface to user with the audit output; require explicit `accept-warns` for medium-severity, `fix-only` for high+.
  - If the gate is `diff`: investigate uncommitted changes — were they leftover from a fix-only loop? Stage and commit, or stash and re-run.

## Modes

- **strict** (default for ship-gate): every gate must pass; failure of any blocks the next.
- **continuous** (slice-builder between AC): runs in the background as you work; reports status after each AC's REFACTOR commit. Failures surface as warnings; build proceeds to the next AC, but the cumulative failure list must be empty before review-stage entry.
- **diff-only** (text-only changes): skip build/typecheck/lint/test/security; run only the diff gate (working tree cleanliness + touchSurface match).

## Output format

Append to `flows/<slug>/build.md > Verification log` (one block per run):

```markdown
## Verification log — 2026-05-10T19:34Z (mode=strict)

| gate | command | result | evidence |
| --- | --- | --- | --- |
| build | npm run build | pass | exit 0; bundle size 142kb |
| typecheck | npm run typecheck | pass | exit 0; 0 errors |
| lint | npm run lint | pass | exit 0; 0 warnings |
| test | npm test | pass | 47 passed, 0 failed (2.3s) |
| security | npm audit --audit-level=high | pass | 0 high or critical vulnerabilities |
| diff | git diff --stat origin/main...HEAD | pass | 4 files changed, 89 ins, 12 del; touchSurface match |

Verdict: pass — ready for handoff.
```

When a gate fails, the row records `fail` with the excerpt; subsequent rows are blank with a single line "(skipped — earlier gate failed)" instead of running. The verdict is `fail — <reason>`.

## When to invoke

- **slice-builder** runs the loop in `continuous` mode after every AC's REFACTOR commit; in `strict` mode before returning the slim summary.
- **reviewer** runs the loop in `strict` mode before deciding `clear` or `warn`; a failed gate forces `block` regardless of finding count.
- **ship-gate** runs the loop in `strict` mode (this is the same set of gates §2 + §2a of the ship runbook codifies; verification-loop is the named skill that wraps them coherently).
- **slice-builder fix-only** runs the loop in `strict` mode after the fix commit, before re-handing off to reviewer.

## Hard rules

- **Never skip a gate to "save time".** A skipped gate is recorded as `skipped` with reason; the reviewer treats unjustified skips as `required` (axis=correctness).
- **Never run later gates after an earlier failure.** Their output is meaningless on a broken substrate.
- **Never silence a failing gate by editing the gate config** (changing lint rules, removing security audits, marking tests as `.skip`) without an explicit `Decisions.md` entry citing why.
- **Never claim a gate passed by pasting yesterday's output.** Run it fresh in the current turn.

## Common pitfalls

- Running test before typecheck and reporting "tests pass" while the build is broken — typecheck catches contract violations the test cannot.
- Running the gate then immediately re-editing without re-running. The recorded evidence must match the current working tree.
- Treating lint warnings as "fyi" without checking the project's CI strictness — many CI pipelines fail on warnings.
- Skipping the diff gate because "I know what I changed". The diff gate catches uncommitted leftover edits from a prior loop that would have shipped without anyone noticing.
- Running security only when `security_flag` is set, even though the diff added a new dependency. Dependency adds always trigger security regardless of the flag.

## refactor-safety

Refactors must be **behaviour-preserving**. The harness enforces this with three structural rules.

## Pin behaviour first

Before any rewrite, identify the pin:

- existing tests that should pass with the same expected output;
- a snapshot or fixture set that should not change;
- a manual repro the user accepts as the contract.

If no pin exists, "add a pin" is AC-1 of the refactor.

## One refactor at a time

A refactor slug must contain refactor changes only. A bug fix that would have been "while we're here" is a separate slug. The pin from the refactor slug is then valid input for the fix slug.

## Public API discipline

If the refactor renames or restructures public exports:

- add a deprecation alias so external consumers still compile;
- mark the old name with a `@deprecated` JSDoc / equivalent;
- record the deprecation deadline in `flows/<slug>/ship.md`.

If the project policy forbids deprecation aliases (some libraries), the refactor is breaking; `security_flag` does not apply but breaking-change handling does (see api-evolution skill).

## Verification

Refactor AC verification is "no behavioural diff": tests pass, snapshots unchanged, fixtures unchanged. If anything changes, the refactor leaked behaviour and must be split.

## Code-simplification catalog

Three rules that turn "make it simpler" from a feeling into mechanical, reviewer-checkable behaviour.

### Chesterton's Fence — understand WHY before removing

Before deleting a check, a guard, an early-return, an "obviously redundant" branch, a comment, an option flag, or a config knob, **understand why it exists**. The framing:

> "If you see a fence across a road and don't understand why it's there, don't tear it down."

Mechanically:

1. **Read the git history of the fence.** `git log -L ":<symbol>:<file>"` or `git blame` on the relevant lines. The commit message of the introduction often tells you why.
2. **Search for related tests.** A fence often has a regression test pinning it; if the test fails when you remove the fence, the fence was load-bearing.
3. **Search for callers / dependents.** Even if the fence looks self-contained, an external test or runtime check may rely on its presence.
4. **If you cannot find a reason, ask** before removing. "I'm about to delete this guard at `src/auth.ts:127`; `git blame` traces it back to a 2022 incident commit but no test covers it. Is it safe?"

The reviewer cites a fence-removal without due-diligence as **F-N | correctness | required | Chesterton's Fence violation**.

### Rule of 500 — invest in automation past the threshold

If a refactor would touch **more than 500 lines** of code by hand, **stop and invest in automation** instead. Options:

- **Codemod** — `jscodeshift`, `ts-morph`, `Bowery` for JS/TS; `libcst` for Python; `gofmt` / `go-rewrite` for Go.
- **AST transform script** — purpose-built one-shot script using the language's AST library.
- **`sed` / structural search-and-replace** — when the change is regular and AST is overkill.

Why the threshold:

- Hand-rolling 500+ line changes is where attention slips. Drive-by edits, missed call sites, partially-applied patterns become normal.
- Automation makes the change **inspectable at the rule level** instead of the diff level: the reviewer walks "the rule" once, then runs it against the diff, instead of reading 500+ touched lines.
- Repeating the same change in the future is free once the codemod exists.

Document the chosen automation inline in `plan.md` under `## Decisions` (D-N) before running it. The reviewer cites a hand-rolled mass-refactor as **F-N | architecture | consider | Rule of 500 violation**.

### Structural simplification patterns

When the refactor is "make this easier to read", apply named patterns. Each is a one-line rule the reviewer can cite:

| Symptom | Pattern | One-line rule |
|---|---|---|
| Deep nesting (`if/if/if/if`) | **Guard clauses** | Invert the condition; return early. |
| Boolean flag parameter (`createUser(name, email, isAdmin)`) | **Options object** | Replace flags with a discriminated options object. |
| Long parameter list (`> 4 args`) | **Parameter object** | Group related args into a single typed object. |
| Repeated null checks at every call site | **Null object** | Return a typed empty value instead of `null`; checks become uniform. |
| Boolean output of a switch / chain | **Polymorphism** | Replace conditional with a per-type method. |
| Unrelated functions with shared local state | **Extract class** | Group state + methods that operate on it. |
| Lost intermediate values in a long chain | **Extract variable** | Name intermediate steps; the diff reads as prose. |
| Inline comment explaining what code does | **Extract function** | Move the block into a function whose name replaces the comment. |

Each pattern is a refactor; each refactor still ships under `--phase=refactor`. The reviewer cites a missed pattern as severity `consider`, never `required` — pattern hygiene is a polish concern, not a correctness concern.

### Hard rules

- **Chesterton's Fence applies before any deletion** — comments, branches, option flags, env-var defaults included.
- **The 500-line threshold is a hard line** — over it, codemod or split the slug.
- **Pattern names go in commit messages.** `refactor(AC-3): extract guard clauses in paginate()` is the right shape; `refactor(AC-3): cleanup` is not.
