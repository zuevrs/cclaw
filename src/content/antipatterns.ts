export const ANTIPATTERNS = `# .cclaw/antipatterns.md

Patterns we have seen fail. Each entry is a short symptom, the underlying mistake, and the corrective action. The orchestrator and specialists open this file when a smell is detected; the reviewer cites entries as findings when applicable.

## A-1 — "Just one more AC"

**Symptom.** A plan starts with 4 AC and ends with 11. Most of the additions appeared during build.

**Underlying mistake.** Scope is being expanded mid-flight without going back to plan-stage.

**Correction.** When build encounters new work, surface it as a follow-up in \`.cclaw/ideas.md\` or a fresh slug. If the new work is genuinely required to satisfy an existing AC, that AC was wrong; cancel the slug and re-plan with a tighter AC set.

## A-2 — Tests in a follow-up commit

**Symptom.** Build commits land for AC-N; tests for AC-N appear in a separate commit a few minutes later.

**Underlying mistake.** Tests are not part of the AC's verification; the verification is left implicit.

**Correction.** AC verification is part of the AC. The test for AC-N lives in the AC-N commit unless the plan explicitly separates them with a justification.

## A-3 — "While we're here" refactor

**Symptom.** A small AC commit also restructures an unrelated module.

**Underlying mistake.** Slice-builder is silently expanding scope.

**Correction.** Refusal is the right answer. Capture the refactor as a follow-up; if it really must happen, cancel the slug and re-plan as a refactor + behaviour-change pair of slugs.

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

**Symptom.** A new \`/cc\` invocation produces a slug whose plan is 80% identical to a slug already in \`.cclaw/shipped/\`.

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

## A-13 — "Implementation is obvious, skipping RED"

**Symptom.** Build commits land for AC-N with \`--phase=green\` but no \`--phase=red\` recorded earlier.

**Underlying mistake.** The TDD cycle was treated as a formality and skipped because the implementation looked obvious.

**Correction.** \`commit-helper.mjs\` rejects GREEN without a prior RED. Write the failing test first; commit it; then write the smallest implementation that turns it green. The cycle is the contract; obvious code still gets a test.

## A-14 — Single test green, didn't run the suite

**Symptom.** \`builds/<slug>.md\` GREEN evidence column shows \`npm test path/to/single.test\` only; full-suite run is missing.

**Underlying mistake.** A passing single test is not GREEN. Production change can break adjacent tests; without running the suite, the AC is shipped on a regression.

**Correction.** GREEN evidence must be the **full relevant suite** for the affected module(s), not the single test. The reviewer cites this as a block finding.

## A-15 — REFACTOR phase silently skipped

**Symptom.** AC has RED + GREEN commits but no \`--phase=refactor\` (skipped or applied) entry in flow-state.

**Underlying mistake.** REFACTOR was skipped without an explicit decision; the gate question was avoided.

**Correction.** REFACTOR is mandatory. Either commit a refactor or explicitly skip it with \`commit-helper.mjs --ac=AC-N --phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"\`. Silence fails the gate.

## A-16 — \`git add -A\` inside build

**Symptom.** A commit produced by \`commit-helper.mjs\` contains files that are unrelated to the AC.

**Underlying mistake.** \`git add -A\` was used to stage; the AC commit absorbed unrelated edits sitting in the working tree.

**Correction.** Stage AC-related files explicitly. Use \`git add path/to/file\` per file, or \`git add -p\` to pick hunks. Never \`git add -A\` inside \`/cc\`.

## A-17 — Production code in the RED commit

**Symptom.** A \`--phase=red\` commit touches \`src/\`, \`lib/\`, or \`app/\`. \`commit-helper.mjs\` should have rejected it; if it slipped through (e.g. via a non-standard root), the reviewer cites it.

**Underlying mistake.** RED is test-files-only. Including production code under RED breaks the "failing test is the spec" contract — the test only fails because the as-yet-unfinished implementation doesn't compile, not because the assertion encoded the AC.

**Correction.** Stage only test files for RED. Implementation lives in the GREEN commit, after RED is recorded.

## A-12 — Architect with one option

**Symptom.** \`decisions/<slug>.md\` lists exactly one option; the "Considered" section reads "we did the thing".

**Underlying mistake.** A one-option decision is not a decision; it is execution narrated as a decision.

**Correction.** If you cannot articulate a real alternative with a real trade-off, drop the decision record entirely and capture the choice as a one-line note in the plan body. Reserve \`D-N\` entries for actual choices.
`;
