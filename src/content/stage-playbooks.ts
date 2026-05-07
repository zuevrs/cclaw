export interface StagePlaybook {
  id: "plan" | "build" | "review" | "ship";
  fileName: string;
  title: string;
  body: string;
}

const PLAN_PLAYBOOK = `# Stage runbook — plan

The orchestrator opens this file before authoring or amending \`plans/<slug>.md\`. The runbook is a checklist; obey it in order.

## 0. Decide whether this is plan-stage or trivial-edit

If the task is a typo / format / rename limited to ≤1 file and ≤30 lines, **skip plan-stage**:

- create the change directly,
- stage it,
- run \`commit-helper.mjs --ac=AC-1 --message="..."\` with a one-line AC declared inline (no \`plan.md\` file),
- proceed to ship.

For anything else, continue with this runbook.

## 1. Read or seed the plan template

\`.cclaw/templates/plan.md\` is the canonical seed. The orchestrator copies it to \`.cclaw/plans/<slug>.md\` and replaces \`SLUG-PLACEHOLDER\` with the real slug.

If the slug already exists (active or shipped), the orchestrator must instead read the existing artifact and let the user pick **amend / rewrite / refine shipped / resume cancelled / new**. See \`.cclaw/skills/refinement.md\`.

## 2. Apply pre-flight checks from reference patterns

If the task matches a pattern in \`.cclaw/patterns/\`, open the pattern file and use its pre-flight checklist verbatim. Multiple patterns can apply (e.g. an endpoint that is also security-sensitive); merge their AC shape sections. Do not pull AC from a pattern that does not match the task.

## 3. Decide which discovery specialists to propose

| signal | propose |
| --- | --- |
| ambiguous goal, no clear "user observable" sentence | \`brainstormer\` |
| competing structural options or feasibility uncertainty | \`architect\` |
| more than 5 AC, or AC that span multiple modules | \`planner\` |

The orchestrator must ask the user before invoking specialists — never invoke silently. The user can accept all, accept some, or accept none. Document the choice in the plan body.

## 4. AC quality bar

Every AC must pass three checks before the plan is considered authored:

- **observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
- **independently committable** — a single commit covering only this AC is meaningful.
- **verifiable** — the AC has an explicit verification line (test name, manual step, or command).

AC that fail any of the three checks are not real AC. Reject them or rewrite them.

## 5. Topology

\`inline\` is the default. The orchestrator only proposes \`parallel-build\` when:

1. ≥4 AC.
2. AC touch disjoint file sets.
3. No AC depends on the output of another AC in the same wave.

The orchestrator must not silently choose \`parallel-build\`. Always surface the topology and ask the user to confirm.

## 6. Hand-off

Plan-stage ends when:

- frontmatter is filled in (slug, stage, status=active, ac with ids and pending statuses, last_specialist, refines, security_flag),
- AC table in the body matches the frontmatter,
- traceability block lists \`AC-N → commit pending\` for every AC,
- the user has approved the plan (an explicit "ok"; never proceed without it).

Then the orchestrator transitions to build-stage.

## 7. Common pitfalls

- Pulling the entire pattern file into the plan body. Cite the pattern; do not duplicate it.
- Inventing AC that mirror sub-tasks instead of outcomes. AC are outcomes.
- Skipping the security_flag in plans that touch authn / authz / secrets / supply chain / data exposure.
- Authoring more than 12 AC. Above 12 the request is two requests; ask the user to split.
`;

const BUILD_PLAYBOOK = `# Stage runbook — build (TDD cycle)

**Build is a TDD cycle.** Every AC goes through RED → GREEN → REFACTOR. There is no other build mode in cclaw v8. The orchestrator opens this file before invoking \`slice-builder\` or implementing inline; \`slice-builder\` opens it on every AC.

## Iron Law

> NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. THE RED FAILURE IS THE SPEC.

Build refuses to commit production code that is not preceded by a recorded RED test. \`commit-helper.mjs\` invocations carry a \`--phase\` flag (\`red\` / \`green\` / \`refactor\`) so the AC traceability chain encodes the cycle.

## 1. Pick the next pending AC

Read \`.cclaw/state/flow-state.json\` and pick the first AC with \`status: pending\`. If none, exit build-stage and transition to review.

## 2. Discover before RED (mandatory)

Before writing the failing test, **read** the affected surface:

- Existing test files for the module (run \`rg\` for the function name in \`tests/\`).
- Fixture and helper files used by the closest existing tests.
- The runnable command(s) that execute those tests (\`npm test path\`, \`pytest path\`, \`go test ./pkg/...\`).
- Public API surfaces, callbacks, state transitions, schemas, and contracts the AC touches.

Cite each citation as \`file:path:line\`. No invented paths. If the planner cited a file that does not exist, **stop** and surface it back as a planner-stage finding.

The discovery output goes into \`builds/<slug>.md\` under the AC's row, in the **Discovery** column. Skipping discovery is one of the five mandatory gate failures.

## 3. RED — write a failing test that encodes the AC verification

Rules for the RED phase:

- Touch test files only. **No production edits in the RED commit.**
- The test must fail for the **right reason** — the assertion that encodes the AC, not a syntax error or import error.
- Capture the test runner output that proves the failure. The captured output is the **watched-RED proof**.
- One AC = one RED commit. If the AC needs more than one test to be observable, stage them all and commit together.

Stage and commit:

\`\`\`bash
git add tests/path/to/new-or-updated.test.ts
node .cclaw/hooks/commit-helper.mjs --ac=AC-N --phase=red \\
  --message="red(AC-N): assert <observable behaviour>"
\`\`\`

Append the watched-RED proof to \`builds/<slug>.md\` under the AC row, in the **RED proof** column (test name + 1-2 line failure excerpt).

## 4. GREEN — minimal production change to make RED pass

Rules for the GREEN phase:

- Smallest possible production diff that turns RED into PASS.
- Run the **full relevant suite**, not the single test, before committing. A passing single test with the rest of the suite broken is not GREEN.
- Capture the suite output (command + PASS/FAIL summary). This is the **GREEN evidence**.
- Touch only files declared in the plan. If the GREEN-correct change requires touching files outside the plan, **stop** and surface it. Scope creep is not progress.

Stage and commit:

\`\`\`bash
git add src/path/to/implementation.ts
node .cclaw/hooks/commit-helper.mjs --ac=AC-N --phase=green \\
  --message="green(AC-N): minimal impl that satisfies RED"
\`\`\`

Append the GREEN evidence to \`builds/<slug>.md\` under the AC row, in the **GREEN evidence** column.

## 5. REFACTOR — keep behaviour, improve shape (mandatory)

REFACTOR is **not optional**. Even when the GREEN diff feels clean, run a deliberate refactor pass:

- Behaviour-preserving cleanups: rename, extract, inline, deduplicate, narrow types.
- Run the same suite again after the refactor; it must still pass with **identical expected output**.
- If no refactor is warranted (the GREEN diff is genuinely minimal and idiomatic), **say so explicitly** in the row's **REFACTOR notes** column ("no refactor: 12-line addition, idiomatic"). Silence is not acceptable; the gate exists to force the question.

If a refactor lands, commit it separately:

\`\`\`bash
git add src/path/to/refactored.ts
node .cclaw/hooks/commit-helper.mjs --ac=AC-N --phase=refactor \\
  --message="refactor(AC-N): <one-line shape change>"
\`\`\`

Otherwise call \`commit-helper.mjs --ac=AC-N --phase=refactor --skipped\` so the chain records the explicit decision.

## 6. Append the AC row to builds/<slug>.md

After REFACTOR, the AC row in \`.cclaw/builds/<slug>.md\` carries:

| AC | Discovery | RED proof | GREEN evidence | REFACTOR notes | commits |
| --- | --- | --- | --- | --- | --- |
| AC-N | tests/path:line, fixtures... | test name + failure excerpt | command + PASS summary | one-line shape change or "skipped: reason" | red SHA, green SHA, refactor SHA (or "skipped") |

The build is complete for this AC only when all six columns are filled.

## 7. Repeat or hand off

If more AC are pending, repeat from step 1. If all AC are through REFACTOR, transition to review-stage.

## 8. Fix-only flow (after a review iteration)

When \`reviewer\` returns \`block\`, the slice-builder is dispatched in \`fix-only\` mode bound to the file:line refs from the latest review block. The TDD cycle still applies:

- if the fix changes observable behaviour, write a new RED test that encodes the corrected behaviour, then GREEN, then REFACTOR;
- if the fix is purely a refactor of existing code (no behaviour change), commit it under \`--phase=refactor\` with a citation of the F-N finding;
- the AC id stays the same (\`commit-helper.mjs --ac=AC-N --phase=… --message="fix: F-N …"\`);
- a separate set of rows in \`builds/<slug>.md\` records F-N → phase → commit.

## 9. Mandatory gates (every AC)

Before transitioning to review, every AC must satisfy:

1. **discovery_complete** — relevant tests / fixtures / helpers / commands cited.
2. **impact_check_complete** — affected callbacks / state / interfaces / contracts named.
3. **red_test_written** — failing test exists, recorded with watched-RED proof.
4. **red_fails_for_right_reason** — RED captured a real assertion failure, not a syntax error.
5. **green_full_suite** — full relevant suite green after GREEN, not the single test.
6. **refactor_completed_or_skipped_with_reason** — REFACTOR ran, or was explicitly skipped with a one-line reason.
7. **traceable_to_plan** — AC commits reference plan AC ids and the plan's file set.
8. **commit_chain_intact** — \`commit-helper.mjs\` recorded RED + GREEN + REFACTOR SHAs in flow-state.

\`commit-helper.mjs\` enforces 1, 3, 6, 8 mechanically. The reviewer enforces 2, 4, 5, 7 in iteration 1.

## 10. Common pitfalls

- Skipping RED because "the implementation is obvious". The cycle is the contract; obvious code still gets a test.
- Single test passes, full suite fails, but commit anyway. That is not GREEN; it is a regression.
- REFACTOR phase silently skipped. Always emit the explicit "skipped: reason" note.
- Writing production code in the RED commit. Stage and commit test files only in the RED phase.
- Bypassing commit-helper "just this once". The traceability gate breaks.
- \`git add -A\` inside build. Stage AC-related files only.
- Refactoring across files outside the AC scope. That is a separate slug.
`;

const REVIEW_PLAYBOOK = `# Stage runbook — review

The orchestrator opens this file before invoking \`reviewer\` (and \`security-reviewer\` when applicable).

## 1. Choose the mode(s)

| mode | when |
| --- | --- |
| \`code\` | always, immediately after build commits land |
| \`text-review\` | before ship if plan / decisions / ship-notes are non-trivial |
| \`integration\` | after \`parallel-build\` completes |
| \`release\` | before push when the change is user-visible |
| \`adversarial\` | at least once for risky / security-sensitive slugs |

\`security-reviewer\` runs in addition to (not instead of) \`reviewer\` when the task or diff touches sensitive surfaces. They can run in parallel.

## 2. Iterate

Each iteration appends a block to \`.cclaw/reviews/<slug>.md\`:

- iteration number, mode, reviewer (id),
- findings table (id F-N, severity, AC ref, file:path:line, finding, fix),
- Five Failure Modes pass (yes/no per mode, citation when yes),
- decision: \`block\` / \`warn\` / \`clear\` / \`cap-reached\`.

## 3. Hard cap

5 review/fix iterations per slug. After the 5th, write \`status: cap-reached\` and stop. Surface the remaining blockers; recommend \`/cc-cancel\` or splitting the work into a fresh slug.

The cap is per-slug, not per-mode. Five iterations of \`code\` and one of \`text-review\` is six total — the cap is hit at five.

## 4. Block findings → fix-only

A \`block\` decision dispatches \`slice-builder\` in \`fix-only\` mode bound to the cited file:line refs. After the fix lands, the orchestrator re-invokes the same reviewer mode and continues iterating.

## 5. Warn findings

A \`warn\` does not block ship, but the warning must be recorded in \`reviews/<slug>.md\` and surfaced in \`ships/<slug>.md\`. The user can decide to fix it inline or capture it as a follow-up.

## 6. Five Failure Modes pass (mandatory)

Every iteration explicitly answers each mode: yes / no, with citation when yes.

1. **Hallucinated actions** — invented files, ids, env vars, function names, command flags?
2. **Scope creep** — diff touches files no AC mentions?
3. **Cascading errors** — one fix introduces typecheck / runtime / test failures elsewhere?
4. **Context loss** — earlier decisions / AC text / brainstormer scope ignored?
5. **Tool misuse** — destructive operations (force push, rm -rf, schema migration without backup), wrong-mode tool calls?

A "yes" without a citation is itself a finding.

## 7. Hand-off

Review-stage ends when an iteration returns \`clear\` or \`cap-reached\`. \`clear\` proceeds to ship; \`cap-reached\` stops the flow and surfaces remaining work.

## 8. Common pitfalls

- Running review without first checking that all AC are \`status: committed\`. If anything is pending, build-stage isn't done.
- Skipping the Five Failure Modes pass because "I already looked". The pass is the artifact; "I already looked" is not.
- Writing findings without file:line. A finding without a target is speculation.
- Letting iteration counts grow silently. The cap exists for a reason.
`;

const SHIP_PLAYBOOK = `# Stage runbook — ship

The orchestrator opens this file before invoking \`runCompoundAndShip()\` (or its harness equivalent).

## 1. AC traceability gate

Before anything else, verify every AC in flow-state.json is \`status: committed\` with a real SHA. If any AC is pending, the gate refuses ship. Stop and either complete the AC or open a fresh slug for the rest.

The gate is enforced inside the runtime; you cannot bypass it. If you think you must, you don't.

## 2. Author ships/<slug>.md

Seed from \`.cclaw/templates/ship.md\`. Required sections:

- summary (2-4 lines),
- AC ↔ commit map (table mirroring frontmatter),
- push / PR (\`pending\` until the user explicitly approves both),
- breaking changes / migration ("none" is a valid value),
- release notes (one paragraph suitable for CHANGELOG.md).

## 3. Run compound

\`runCompoundAndShip()\` does the gate check, captures learnings if the quality gate passes, moves all active artifacts to \`.cclaw/shipped/<slug>/\`, writes a \`manifest.md\`, appends to \`knowledge.jsonl\` if learnings were captured, and resets flow-state.

The compound quality gate captures \`learnings/<slug>.md\` only when at least one of:

- \`architect\` or \`planner\` recorded a non-trivial decision,
- review needed ≥3 iterations,
- a security review ran or \`security_flag\` is true,
- the user explicitly asked.

When the gate fails, the run still ships — only the learning capture is skipped.

## 4. Push and PR

**Always ask before pushing.** Always ask before opening a PR.

If the user approves push: do that one action and stop. Do not proactively open a PR after pushing unless the user asked for it. Do not run \`git push --force\` ever — if the user requests it explicitly, surface the warning and require a second confirmation.

If the user approves PR creation: use \`gh pr create\` with a body summarising the slug. The PR description must reference the AC ids.

## 5. Hand-off

Ship-stage ends when:

- \`shipped/<slug>/manifest.md\` exists,
- flow-state is reset,
- the user is told push/PR status (whether approved or skipped).

The next \`/cc\` invocation can be a brand-new request or a refinement of this slug.

## 6. Common pitfalls

- Pushing without asking. Always ask, always wait, every time.
- Opening a PR with stale release notes. Re-read \`ships/<slug>.md\` before opening the PR.
- Skipping the manifest because "the slug is small". The manifest is the entry point future agents use to understand the slug; skipping it makes refinement harder later.
- Editing artifacts after they're moved to \`.cclaw/shipped/\`. Shipped slugs are read-only. Refinement creates a new slug.
`;

export const STAGE_PLAYBOOKS: StagePlaybook[] = [
  { id: "plan", fileName: "plan.md", title: "Stage runbook — plan", body: PLAN_PLAYBOOK },
  { id: "build", fileName: "build.md", title: "Stage runbook — build", body: BUILD_PLAYBOOK },
  { id: "review", fileName: "review.md", title: "Stage runbook — review", body: REVIEW_PLAYBOOK },
  { id: "ship", fileName: "ship.md", title: "Stage runbook — ship", body: SHIP_PLAYBOOK }
];

export const STAGE_PLAYBOOKS_INDEX = `# .cclaw/runbooks/

Per-stage runbooks the orchestrator opens before transitioning into a stage. Each runbook is a strict checklist plus the common pitfalls collected from prior runs.

| stage | runbook |
| --- | --- |
${STAGE_PLAYBOOKS.map((p) => `| ${p.id} | [\`${p.fileName}\`](./${p.fileName}) |`).join("\n")}

The runbooks are intentionally redundant with the specialist prompts and skills — when the orchestrator is mid-stage and short on context budget, the runbook is the smallest self-contained reference.
`;
