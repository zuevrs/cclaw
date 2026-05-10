export const ANTIPATTERNS = `# .cclaw/lib/antipatterns.md

Patterns we have seen fail. Each entry is a short symptom, the underlying mistake, and the corrective action. The orchestrator and specialists open this file when a smell is detected; the reviewer cites entries as findings when applicable.

> **v8.12 cleanup.** Earlier versions of cclaw shipped 33 antipatterns (A-1 .. A-33) but only 7 were ever wired into reviewer / slice-builder citations. v8.12 deletes the 24 unused entries and renumbers the wired set to A-1 .. A-7. The mapping (for anyone returning to a v8.11-shipped slug): old A-2 → new A-1; old A-3 → new A-2; old A-15 → new A-3; old A-16 → new A-4; old A-17 → new A-5; old A-21 → new A-6; old A-22 → new A-7.

## A-1 — TDD phase integrity broken

**Symptom (any of):**

- Build commits land for AC-N with \`--phase=green\` but no \`--phase=red\` recorded earlier.
- AC has RED + GREEN commits but no \`--phase=refactor\` (skipped or applied) entry in flow-state.
- A \`--phase=red\` commit touches \`src/\`, \`lib/\`, or \`app/\` — production code slipped into RED.
- Tests for AC-N appear in a separate commit a few minutes after the AC-N implementation lands.

**Underlying mistake.** The TDD cycle was treated as ceremony, not as the contract. The cycle exists so the failing test encodes the AC; skipping or scrambling phases produces an audit trail that nobody can trust.

**Correction.** \`commit-helper.mjs\` enforces RED → GREEN → REFACTOR per AC. Write a failing test first and commit under \`--phase=red\` (test files only). Implement the smallest production change that turns it green; commit under \`--phase=green\`. Either commit a refactor under \`--phase=refactor\` or skip it explicitly with \`--phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"\`. The reviewer cites this entry whenever the chain is incomplete.

## A-2 — Work outside the AC

**Symptom (any of):**

- A small AC commit also restructures an unrelated module.
- A commit produced by \`commit-helper.mjs\` contains files that are unrelated to the AC.
- \`git add -A\` appears in shell history inside \`/cc\`.

**Underlying mistake.** Slice-builder absorbed unrelated edits or silently expanded scope. The AC commit no longer maps cleanly to the AC.

**Correction.** Stage AC-related files explicitly: \`git add <path>\` per file, or \`git add -p\` to pick hunks. Never \`git add -A\` inside \`/cc\`. If a refactor really must happen, capture it as a follow-up; if it really blocks the AC, cancel the slug and re-plan as a refactor + behaviour-change pair.

## A-3 — Mocking what should not be mocked

**Symptom.** A database query test mocks the driver and asserts on \`db.query\` call shape; the test is green and the actual query never runs in production. Or a service test mocks every collaborator and only verifies which methods were called, in which order.

**Underlying mistake.** Mocking a dependency you control couples the test to the implementation. The test reads green even when the SQL is wrong, the migration is missing, the column is misspelled. Real bugs live in those gaps. Interaction-based assertions (\`expect(x).toHaveBeenCalledWith(...)\`) break on every refactor and provide weaker confidence than state-based assertions on the outcome.

**Correction.** Use a real test database (or an in-memory fake of the same shape) and assert on the **outcome** — the row that was inserted, the response from the query, the observable side effect — not on the call. Reach for mocks only for things genuinely outside your control: third-party APIs, time, randomness, the network. Real > Fake (in-memory) > Stub (canned data) > Mock (interaction).

## A-4 — Drive-by edits to adjacent comments / formatting / imports

**Symptom.** The diff for AC-3 (a one-line bug fix in \`paginate()\`) also reformats six unrelated comments above the function, normalises quote style across the file, and reorders imports. None of these changes are referenced by AC-3.

**Underlying mistake.** "While I'm here, let me improve this" sounds helpful and corrupts the audit trail. The AC commit no longer maps cleanly to the AC; reviewers cannot tell which lines were the actual fix and which were cosmetic; bisection on the slug becomes harder.

**Correction.** Touch only what the AC requires. If you spot a fix-worthy thing nearby, list it under your build artifact's \`## Summary → Noticed but didn't touch\` block (per the \`summary-format\` skill) and open a follow-up slug — never absorb it into the current commit. The reviewer cites this with severity \`consider\` for cosmetic drive-bys, escalating to \`required\` when the drive-by edit also masks a logic change. See the \`surgical-edit-hygiene\` skill for finding templates.

## A-5 — Deletion of pre-existing dead code without permission

**Symptom.** The diff for AC-3 also deletes \`legacyHelper()\` from \`src/lib/legacy.ts\`, citing "no callers". The deletion is unrelated to AC-3.

**Underlying mistake.** Pre-existing dead code is not the AC's scope. Deleting it produces a diff that mixes "AC implementation" with "cleanup of code I didn't own". The audit trail breaks — a future bisect that lands on this commit cannot tell which deletion caused the regression. The deletion may also have surprised callers (test fixtures, build scripts, IDE-time-only references) that grep didn't catch.

**Correction.** When you spot pre-existing dead code, list it under your build artifact's \`## Summary → Noticed but didn't touch\` block with cite-able evidence (\`rg <symbol> src/\` returns 0 hits). The orchestrator opens a follow-up cleanup slug; the dead code is removed in its own commit chain. Always \`required\` even when the dead code is "obviously dead": the audit-trail cost is the issue, not whether the code was real.

## A-6 — Untagged debug logs

**Symptom.** Build commits contain new \`console.log("here")\`, \`console.log({ user })\`, \`console.error(err)\` lines outside test files. The agent left them in "to be safe" or forgot to remove them after debugging.

**Underlying mistake.** Cleanup of untagged debug logs is manual: every \`console.\` call needs human review to decide "kept or scrubbed". When the AC ships with stray logs, production console output gets noisy; in worse cases, logs leak PII or internal state. The slow drift of "stray debug log" → "load-bearing log" → "log-as-API" is a real phenomenon.

**Correction.** Tag every temporary debug log with a unique 4-character hex prefix per debugging session: \`console.log("[DEBUG-a4f2] cache lookup", { ... })\`. Before commit, \`rg "[DEBUG-a4f2]" src/\` must return 0 hits; \`rg "console\\.(log|error|warn)" -g '!*.test.*' src/\` must show no new lines. See the \`debug-loop\` skill for the full multi-step protocol.

## A-7 — Single-run flakiness conclusion

**Symptom.** A test failed once; the agent re-ran it and it passed; the agent moved on, recording GREEN in \`build.md\`.

**Underlying mistake.** A single-run pass after an observed failure is **undecided**, not green. The failure could be flakiness (real concurrency / RNG / time-zone bug masquerading as "transient"), an environment delta (CI vs local), or a race with another test in the same suite. "It passed this time" is not evidence of correctness; it is evidence that the test sometimes passes.

**Correction.** Multi-run protocol: 20 iterations on first observed failure; escalate to 100 if any failure shows up. Document the iteration count and failure pattern in \`build.md\`. After the fix, re-run N×2 times to verify. The fix must eliminate the failure, not reduce its rate. See the \`debug-loop\` skill, Phase 4.
`;
