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
`;
