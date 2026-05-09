export const ANTIPATTERNS = `# .cclaw/lib/antipatterns.md

Patterns we have seen fail. Each entry is a short symptom, the underlying mistake, and the corrective action. The orchestrator and specialists open this file when a smell is detected; the reviewer cites entries as findings when applicable.

## A-1 — "Just one more AC"

**Symptom.** A plan starts with 4 AC and ends with 11. Most of the additions appeared during build.

**Underlying mistake.** Scope is being expanded mid-flight without going back to plan-stage.

**Correction.** When build encounters new work, surface it as a follow-up in \`.cclaw/ideas.md\` or a fresh slug. If the new work is genuinely required to satisfy an existing AC, that AC was wrong; cancel the slug and re-plan with a tighter AC set.

## A-2 — TDD phase integrity broken

**Symptom (any of):**

- Build commits land for AC-N with \`--phase=green\` but no \`--phase=red\` recorded earlier.
- AC has RED + GREEN commits but no \`--phase=refactor\` (skipped or applied) entry in flow-state.
- A \`--phase=red\` commit touches \`src/\`, \`lib/\`, or \`app/\` — production code slipped into RED.
- Tests for AC-N appear in a separate commit a few minutes after the AC-N implementation lands.

**Underlying mistake.** The TDD cycle was treated as ceremony, not as the contract. The cycle exists so the failing test encodes the AC; skipping or scrambling phases produces an audit trail that nobody can trust.

**Correction.** \`commit-helper.mjs\` enforces RED → GREEN → REFACTOR per AC. Write a failing test first and commit under \`--phase=red\` (test files only). Implement the smallest production change that turns it green; commit under \`--phase=green\`. Either commit a refactor under \`--phase=refactor\` or skip it explicitly with \`--phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"\`. The reviewer cites this entry whenever the chain is incomplete.

## A-3 — Work outside the AC

**Symptom (any of):**

- A small AC commit also restructures an unrelated module.
- A commit produced by \`commit-helper.mjs\` contains files that are unrelated to the AC.
- \`git add -A\` appears in shell history inside \`/cc\`.

**Underlying mistake.** Slice-builder absorbed unrelated edits or silently expanded scope. The AC commit no longer maps cleanly to the AC.

**Correction.** Stage AC-related files explicitly: \`git add <path>\` per file, or \`git add -p\` to pick hunks. Never \`git add -A\` inside \`/cc\`. If a refactor really must happen, capture it as a follow-up; if it really blocks the AC, cancel the slug and re-plan as a refactor + behaviour-change pair.

## A-4 — AC that mirror sub-tasks

**Symptom.** AC read like "implement the helper", "wire the helper", "test the helper".

**Underlying mistake.** AC are outcomes, not sub-tasks. Outcomes survive refactors; sub-tasks do not.

**Correction.** Rewrite AC as observable outcomes. The helper is an implementation detail, not an AC.

## A-5 — Over-careful brainstormer

**Symptom.** Brainstormer produces three pages of Context for a small task; planner is then unable to size the work.

**Underlying mistake.** Brainstormer ignored the routing class. Trivial / small-medium tasks should have a one-paragraph Context, not a Frame + Scope + Alternatives sweep.

**Correction.** Brainstormer reads the routing class first and short-circuits when the task is small. Three sentences of Context is enough for AC-1.

## A-6 — "I already looked"

**Symptom.** Reviewer reports a "clear" decision without a Five Failure Modes pass.

**Underlying mistake.** The Five Failure Modes pass is the artifact. Skipping it because "I already looked" produces no audit trail.

**Correction.** Reviewer always emits the Five Failure Modes block. Each item gets yes / no with citation when yes. A "no" with no thinking attached is fine; an absent block is not.

## A-7 — Shipping with a pending AC

**Symptom.** \`runCompoundAndShip()\` is invoked while flow-state has at least one AC with \`status: pending\`.

**Underlying mistake.** The agent expected the orchestrator to "figure it out" and complete the AC silently.

**Correction.** The AC traceability gate refuses ship. Either complete the AC (slice-builder) or cancel the slug (\`/cc-cancel\`) and re-plan with the smaller AC set. There is no override.

## A-8 — Re-creating a shipped slug instead of refining

**Symptom.** A new \`/cc\` invocation produces a slug whose plan is 80% identical to a slug already in \`.cclaw/flows/shipped/\`.

**Underlying mistake.** Existing-plan detection was skipped or its output was ignored.

**Correction.** Existing-plan detection is mandatory at the start of every \`/cc\`. When a shipped match is offered, the user picks **refine shipped** or **new unrelated**, not "ignore the match".

## A-9 — Editing shipped artifacts

**Symptom.** A shipped slug's \`plan.md\` is edited weeks after ship.

**Underlying mistake.** Shipped artifacts are immutable. Editing them invalidates the knowledge index and breaks refinement chains.

**Correction.** Open a refinement slug. The new slug carries \`refines: <old-slug>\` and contains the corrections. The old slug stays as it shipped.

## A-10 — Force-push during ship

**Symptom.** \`git push --force\` appears in shell history during ship.

**Underlying mistake.** Force-push rewrites the SHAs that flow-state and the AC traceability block reference. The chain breaks silently; nothing in the runtime detects it.

**Correction.** Refuse \`git push --force\` inside \`/cc\` unless the user explicitly requested it twice (initial request + confirmation). After the force-push, every recorded SHA in the slug must be re-verified by hand and updated.

## A-11 — Hidden security surface

**Symptom.** A slug ships without \`security_flag: true\` even though the diff added a new auth-adjacent code path.

**Underlying mistake.** The author judged "this is mostly UI" and skipped the security checklist.

**Correction.** \`security_flag\` is set whenever the diff touches authn / authz / secrets / supply chain / data exposure, even when the change feels small. The cost of a spurious security flag is a few minutes; the cost of a missed one is a CVE.

## A-12 — Single test green, didn't run the suite

**Symptom.** \`flows/<slug>/build.md\` GREEN evidence column shows \`npm test path/to/single.test\` only; full-suite run is missing.

**Underlying mistake.** A passing single test is not GREEN. Production change can break adjacent tests; without running the suite, the AC is shipped on a regression.

**Correction.** GREEN evidence must be the **full relevant suite** for the affected module(s), not the single test. The reviewer cites this as a block finding.

## A-13 — Horizontal slicing (RED-batch then GREEN-batch)

**Symptom.** \`flows/<slug>/build.md\` shows AC-1 RED, AC-2 RED, AC-3 RED committed in a row, then AC-1 GREEN, AC-2 GREEN, AC-3 GREEN. Or the slice-builder describes the build as "tests written, now I'll implement".

**Underlying mistake.** Writing all RED tests before any GREEN code means the tests describe the behaviour you *guessed* before you saw the real interface. Tests written this way pass when behaviour breaks (because they test the imagined shape) and fail when behaviour is fine (because the real shape diverged from the imagination). They get rewritten during the next refactor.

**Correction.** One test → one implementation → repeat. Each cycle informs the next. The AC-2 test is shaped by what the AC-1 implementation revealed about the real interface. \`commit-helper.mjs --phase=red\` for AC-2 will refuse if AC-1's chain isn't closed yet — that is the rail. See the Vertical Slicing section in \`tdd-cycle.md\`.

## A-14 — Pushing past a failing test

**Symptom.** Build log shows a flaky or unexpected failure on AC-2, then continues into AC-3 with "I'll come back to AC-2 later". Or a hook rejection silently retried with a slightly different commit message.

**Underlying mistake.** Errors compound. AC-3 is built on the invariants AC-2 was supposed to establish. If AC-2's RED failed for the wrong reason, you are debugging a stack of broken assumptions, and every cycle past that point makes the diagnosis harder.

**Correction.** Stop the line. Preserve the failure (command + 1–3 lines of output verbatim), reproduce in isolation, root-cause to a concrete file:line, fix once, re-run the full relevant suite, then resume the cycle. If the root cause cannot be identified in three attempts, surface a blocker to the orchestrator — do not "make it work" by removing the test or weakening the assertion.

## A-15 — Mocking what should not be mocked

**Symptom.** A database query test mocks the driver and asserts on \`db.query\` call shape; the test is green and the actual query never runs in production. Or a service test mocks every collaborator and only verifies which methods were called, in which order.

**Underlying mistake.** Mocking a dependency you control couples the test to the implementation. The test reads green even when the SQL is wrong, the migration is missing, the column is misspelled. Real bugs live in those gaps. Interaction-based assertions (\`expect(x).toHaveBeenCalledWith(...)\`) break on every refactor and provide weaker confidence than state-based assertions on the outcome.

**Correction.** Use a real test database (or an in-memory fake of the same shape) and assert on the **outcome** — the row that was inserted, the response from the query, the observable side effect — not on the call. Reach for mocks only for things genuinely outside your control: third-party APIs, time, randomness, the network. Real > Fake (in-memory) > Stub (canned data) > Mock (interaction).

## A-16 — Drive-by edits to adjacent comments / formatting / imports

**Symptom.** The diff for AC-3 (a one-line bug fix in \`paginate()\`) also reformats six unrelated comments above the function, normalises quote style across the file, and reorders imports. None of these changes are referenced by AC-3.

**Underlying mistake.** "While I'm here, let me improve this" sounds helpful and corrupts the audit trail. The AC commit no longer maps cleanly to the AC; reviewers cannot tell which lines were the actual fix and which were cosmetic; bisection on the slug becomes harder.

**Correction.** Touch only what the AC requires. If you spot a fix-worthy thing nearby, list it under your build artifact's \`## Summary → Noticed but didn't touch\` block (per the \`summary-format\` skill) and open a follow-up slug — never absorb it into the current commit. The reviewer cites this with severity \`consider\` for cosmetic drive-bys, escalating to \`required\` when the drive-by edit also masks a logic change. See the \`surgical-edit-hygiene\` skill for finding templates.

## A-17 — Deletion of pre-existing dead code without permission

**Symptom.** The diff for AC-3 also deletes \`legacyHelper()\` from \`src/lib/legacy.ts\`, citing "no callers". The deletion is unrelated to AC-3.

**Underlying mistake.** Pre-existing dead code is not the AC's scope. Deleting it produces a diff that mixes "AC implementation" with "cleanup of code I didn't own". The audit trail breaks — a future bisect that lands on this commit cannot tell which deletion caused the regression. The deletion may also have surprised callers (test fixtures, build scripts, IDE-time-only references) that grep didn't catch.

**Correction.** When you spot pre-existing dead code, list it under your build artifact's \`## Summary → Noticed but didn't touch\` block with cite-able evidence (\`rg <symbol> src/\` returns 0 hits). The orchestrator opens a follow-up cleanup slug; the dead code is removed in its own commit chain. Always \`required\` even when the dead code is "obviously dead": the audit-trail cost is the issue, not whether the code was real.

## A-21 — Untagged debug logs

**Symptom.** Build commits contain new \`console.log("here")\`, \`console.log({ user })\`, \`console.error(err)\` lines outside test files. The agent left them in "to be safe" or forgot to remove them after debugging.

**Underlying mistake.** Cleanup of untagged debug logs is manual: every \`console.\` call needs human review to decide "kept or scrubbed". When the AC ships with stray logs, production console output gets noisy; in worse cases, logs leak PII or internal state. The slow drift of "stray debug log" → "load-bearing log" → "log-as-API" is a real phenomenon.

**Correction.** Tag every temporary debug log with a unique 4-character hex prefix per debugging session: \`console.log("[DEBUG-a4f2] cache lookup", { ... })\`. Before commit, \`rg "[DEBUG-a4f2]" src/\` must return 0 hits; \`rg "console\\.(log|error|warn)" -g '!*.test.*' src/\` must show no new lines. See the \`debug-loop\` skill for the full multi-step protocol.

## A-22 — Single-run flakiness conclusion

**Symptom.** A test failed once; the agent re-ran it and it passed; the agent moved on, recording GREEN in \`build.md\`.

**Underlying mistake.** A single-run pass after an observed failure is **undecided**, not green. The failure could be flakiness (real concurrency / RNG / time-zone bug masquerading as "transient"), an environment delta (CI vs local), or a race with another test in the same suite. "It passed this time" is not evidence of correctness; it is evidence that the test sometimes passes.

**Correction.** Multi-run protocol: 20 iterations on first observed failure; escalate to 100 if any failure shows up. Document the iteration count and failure pattern in \`build.md\`. After the fix, re-run N×2 times to verify. The fix must eliminate the failure, not reduce its rate. See the \`debug-loop\` skill, Phase 4.

## A-23 — Hyrum's Law surface unpinned

**Symptom.** A new public API (HTTP endpoint, library export, CLI command) ships without documenting the return shape, the sort order, the silent-on-missing behaviour, or the timing semantics. The PR description says "follows existing conventions".

**Underlying mistake.** Every observable behaviour will be depended on by somebody. "Follows existing conventions" is not a contract. Once consumers code to the observed-but-undocumented behaviour, changing it later is a breaking change you did not announce. See the \`api-and-interface-design\` skill.

**Correction.** \`decisions.md\` for any public interface pins: shape (return type, error type, status codes, headers); order (sort key + direction for lists); silence (what is returned on missing input, partial failure, timeout); timing (sync, async, eventual, with what staleness window). Severity \`required\` when the surface is genuinely public; \`consider\` for inter-module surfaces inside one repo with a tight version pin.

## A-24 — Unvalidated external response shape

**Symptom.** Code consumes a third-party API (or webhook payload, queue message, file upload) and uses fields directly without validating the shape. A response like \`{ user: { id: 42 } }\` is read as \`data.user.id\`; if the API ever returns \`{ user: null }\` or \`{ id: 42 }\` (no nesting), the code throws or silently writes \`undefined\` downstream.

**Underlying mistake.** External data is untrusted. Treating it as the shape your TypeScript / pydantic / Go struct **says** it should be is a type assertion, not a type check. The compiler will not catch a runtime shape mismatch; downstream consumers see corrupted state.

**Correction.** Validate at the boundary with a schema library (zod, valibot, ajv, yup, pydantic, ozzo-validation, etc.). On validation failure, throw a typed error and surface the failure — do NOT pass partial / undefined fields downstream. See the \`api-and-interface-design\` skill, "Untrusted third-party API responses". Severity \`required\` always.

## A-25 — Hypothetical seam (one-adapter port)

**Symptom.** \`decisions.md\` introduces a \`StorageInterface\` port "in case we ever want to swap to S3"; the slug ships with one production adapter (\`PostgresStorage\`) and a test that mocks the port. There is no second real adapter.

**Underlying mistake.** A port without two real adapters is dead architecture — extra surface area, extra indirection, no payoff. The "we might swap it" reflex is a guess about the future; the future swap rarely happens, and when it does the original port shape is wrong for the new adapter anyway.

**Correction.** Two-adapter rule: a port is justified only when at least two adapters are concretely justified — typically prod + a test substitute (in-memory fake) that is NOT a mock, OR two prod adapters (Postgres + SQLite, S3 + local-fs). Document both adapters in \`decisions.md\`. See the \`api-and-interface-design\` skill. Severity \`required\`.

## A-26 — Chesterton's Fence violation

**Symptom.** The refactor commit deletes a guard clause, an early-return, an option flag, or a comment "because it looked redundant". \`git blame\` traces the removed line back to a years-old incident commit; no test pins the guard.

**Underlying mistake.** Removing a fence whose purpose you don't understand is a guess about safety. The fence may have been load-bearing for a path that is rare, that is in production but not in tests, or that was important historically and is still important even if no current code path needs it.

**Correction.** Before deleting any check / guard / branch / option flag / comment, walk the four-step protocol: (1) read \`git log -L\`/\`git blame\` for the line, (2) search for related tests, (3) search for callers / dependents, (4) if no reason can be identified, **ask** before removing. See the \`refactor-safety\` skill, "Code-simplification catalog → Chesterton's Fence". Severity \`required\` always.

## A-27 — Rule of 500 violation

**Symptom.** A refactor slug touches 800+ lines by hand. The commit message says "rename \`User\` to \`Account\` across the codebase".

**Underlying mistake.** Past 500 lines, attention slips. Drive-by edits sneak in, call sites get missed, the same pattern is applied inconsistently. The reviewer ends up walking 800 lines of "did you apply the rule correctly" instead of one rule + a generated diff.

**Correction.** Past 500 lines, invest in automation: codemod (\`jscodeshift\`, \`ts-morph\`, \`libcst\`), AST transform script, or structural \`sed\`. Document the chosen automation in \`decisions.md\` (D-N) before running it; reviewer reviews the rule, then runs the automation against the diff. See the \`refactor-safety\` skill. Severity \`consider\` (the diff still works; the cost is hidden until later).

## A-28 — Generic-fetcher mock with switch-on-URL logic

**Symptom.** Test setup contains \`vi.mocked(fetch).mockImplementation(async (url, opts) => { if (url === "/users/42") return ...; if (url === "/orders/...") return ...; throw new Error("unhandled URL in mock"); })\`.

**Underlying mistake.** A switch-on-URL mock is essentially re-implementing the third-party API in the test setup. Each new endpoint adds a branch; the mock's type signature is \`(string, options) => Promise<Response>\` regardless of the endpoint, so wrong-shape responses are not caught at the type level.

**Correction.** Introduce SDK-style boundary methods (\`api.getUser(id)\`, \`api.createInvoice(input)\`, etc.) at the network boundary in production code; mock the SDK methods individually in tests. Each method has its own type signature; refactoring one endpoint touches one mock. See the \`tdd-cycle\` skill, "Test-design checklist → Prefer SDK-style boundary APIs". Severity \`consider\`.

## A-29 — Primitive obsession masquerading as type safety

**Symptom.** Function signature is \`createSession(userId: string, accountId: string, durationMinutes: number)\`. Callers pass \`createSession(accountId, userId, 30)\` (args in the wrong order); the type checker is happy because all three are \`string | string | number\`.

**Underlying mistake.** \`string\` and \`number\` carry no business meaning. The type system cannot distinguish a \`userId\` from an \`accountId\`; mistakes happen at the call site and are invisible until they show up as "wrong session for the right user".

**Correction.** Introduce typed value objects: \`type UserId = string & { readonly __brand: "UserId" }\`, \`type AccountId = string & { readonly __brand: "AccountId" }\`. Construct only via factories (\`UserId.from(s)\`); the type checker now catches arg-order mistakes at the call site. See the \`tdd-cycle\` skill, "Test-design checklist → Smell catalogue". Severity \`consider\`.

## A-30 — Feature envy

**Symptom.** Method \`a.method()\` reads / writes mostly fields of \`b\`: \`if (this.b.x === ...) this.b.y = this.b.z + ...\`.

**Underlying mistake.** The method is "envious" of \`b\`'s state; it probably belongs on \`b\`. Distance between behaviour and state makes refactoring \`b\` harder (every change has to consider \`a\`'s envy) and tends to produce circular references when \`b\` then needs to call back to \`a\`.

**Correction.** Move the method to the class whose state it primarily manipulates. \`b.method()\` instead of \`a.method()\`; \`a\` calls \`this.b.method()\` if it still needs to invoke. Often the move reveals that the method should be a constructor or factory on \`b\` instead of an arbitrary method. See the \`tdd-cycle\` skill. Severity \`consider\`.

## A-31 — Churn Rule violation

**Symptom.** A deprecation lands with the deadline ("removed in v3.0, six months from now") but no migration plan, no consumer list, no adapter, no per-team coordination. The expectation is that downstream teams will fix their code by the deadline.

**Underlying mistake.** Deprecation is the **deprecator's** problem to solve, not every consumer's. Throwing the deadline over the wall produces a known-future incident: at deadline-1 day, half the consumers haven't migrated, and the deprecator has to choose between extending the deadline (breaking the deprecation contract) or shipping the breakage (breaking consumers).

**Correction.** Apply the Churn Rule: identify consumers (rg, dependency-graph, registry stats); pick a migration cost split (deprecator ships an adapter, OR deprecator pairs with each consumer's owner to land migration commits); document the choice in \`decisions.md\`. See the \`breaking-changes\` skill, "Deprecation & migration patterns → Churn Rule". Severity \`required\` always.

## A-32 — Big-bang migration

**Symptom.** A large migration (replacing a subsystem) ships in one slug. There is no canary phase; 100% traffic flips from old to new in a single deploy. Rollback is "revert the deploy".

**Underlying mistake.** Without a canary phase, parity issues between old and new go undetected until 100% traffic is on the new path. Rollback is an all-or-nothing deploy revert; if the new path was running for 3 hours and writing data, the rollback may have to deal with consistency repair on top of the deploy.

**Correction.** Strangler Pattern: 1% canary, 10% / 50% with parity monitoring, 100% with the old path fenced off, then old-path removal. Each phase has explicit ship-gate criteria and rollback steps documented in \`decisions.md\`. See the \`breaking-changes\` skill, "Deprecation & migration patterns → Strangler Pattern". Severity \`required\` for any subsystem-scale migration.

## A-33 — Zombie code reliance

**Symptom.** A new slug introduces a call to \`legacy.computeFoo()\` because "it does what we need". \`git blame\` shows the last meaningful change to \`legacy.computeFoo()\` was 2018; no current team owns it; no tests cover it.

**Underlying mistake.** Building new features on zombie code (no owner, no tests, no maintenance) extends the lifetime of the zombie and adds a new caller to the eventual cleanup. Every flow that ships through zombie code makes the eventual retirement more expensive.

**Correction.** Architect's response when zombie code is identified: (a) assign an owner and maintain it (write tests, document, refactor) — opens a follow-up slug, OR (b) deprecate it with a concrete migration plan (Churn Rule + Strangler). Do NOT silently extend the dependency. See the \`breaking-changes\` skill, "Deprecation & migration patterns → Zombie Code lifecycle". Severity \`consider\` (escalates to \`required\` when the zombie code is on a security-sensitive path).
`;
