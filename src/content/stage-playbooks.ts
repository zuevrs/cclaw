export interface StagePlaybook {
  id: "plan" | "build" | "review" | "ship";
  fileName: string;
  title: string;
  body: string;
}

const PLAN_PLAYBOOK = `# Stage runbook — plan

The orchestrator opens this file before authoring or amending \`flows/<slug>/plan.md\`. The runbook is a checklist; obey it in order.

## 0. Decide whether this is plan-stage or trivial-edit

If the task is a typo / format / rename limited to ≤1 file and ≤30 lines, **skip plan-stage**:

- create the change directly,
- stage it,
- run \`git commit -m "<feat|fix|refactor|docs>: <one-line summary>"\` (no per-criterion prefix; inline-mode flows do not produce an AC table),
- proceed to ship.

For anything else, continue with this runbook.

## 1. Read or seed the plan template

\`.cclaw/lib/templates/plan.md\` is the canonical seed. The orchestrator copies it to \`.cclaw/flows/<slug>/plan.md\` and replaces \`SLUG-PLACEHOLDER\` with the real slug.

If the slug already exists (active or shipped), the orchestrator must instead read the existing artifact and let the user pick **amend / rewrite / refine shipped / resume cancelled / new**. See \`.cclaw/lib/skills/refinement.md\`.

## 2. Apply pre-flight checks from reference patterns

If the task matches a pattern in \`.cclaw/lib/patterns/\`, open the pattern file and use its pre-flight checklist verbatim. Multiple patterns can apply (e.g. an endpoint that is also security-sensitive); merge their AC shape sections. Do not pull AC from a pattern that does not match the task.

## 3. Decide which discovery specialists to propose

| signal | propose |
| --- | --- |
| ambiguous goal, no clear "user observable" sentence | \`design\` (Phase 1 Clarify + Phase 2 Frame) |
| competing structural options or feasibility uncertainty | \`design\` (Phase 3 Approaches + Phase 4 Decisions) |
| more than 5 AC, or AC that span multiple modules | \`ac-author\` |

The orchestrator must ask the user before invoking specialists — never invoke silently. The user can accept all, accept some, or accept none. Document the choice in the plan body.

## 4. AC quality bar

Every AC must pass three checks before the plan is considered authored:

- **observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
- **independently committable** — a single commit covering only this AC is meaningful.
- **verifiable** — the AC has an explicit verification line (test name, manual step, or command).

AC that fail any of the three checks are not real AC. Reject them or rewrite them.

## 5. Topology

\`inline\` is the default. The orchestrator only proposes \`parallel-build\` when:

1. ≥4 AC AND ≥2 distinct touchSurface clusters.
2. Every AC in a parallel wave has \`parallelSafe: true\`.
3. No AC depends on the output of another AC in the same wave.
4. The slug fits in **≤5 parallel slices** (slice = 1+ AC sharing a touchSurface). If ac-author produces more than 5 slices, merge thinner slices into fatter ones — never generate "wave 2".

The orchestrator must not silently choose \`parallel-build\`. Always surface the topology and ask the user to confirm. See \`.cclaw/lib/skills/parallel-build.md\` for the worktree dispatch pattern and the silent fallback to \`inline\` when the harness does not support sub-agent dispatch.

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

## Path: small/medium

Open this section when \`triage.complexity == "small-medium"\` AND \`plan\` is in \`triage.path\`. For large-risky plan, see the "Path: large-risky" section below. For trivial / inline (\`triage.path == ["build"]\`) the plan stage is skipped entirely — this section is never read on the inline path.

### Specialist + wrappers

- Specialist: \`ac-author\`.
- Wrapper skills: \`plan-authoring.md\` (always) + \`source-driven.md\` (framework-specific tasks; strict mode only by default — soft opts in).

### Pre-author research order (ac-author dispatches BEFORE writing the plan)

- \`learnings-research\` — **always**, on small/medium + large-risky. Reads \`.cclaw/knowledge.jsonl\`. Returns 0-3 prior lessons inline in slim-summary's \`Notes\` as \`lessons={...}\`; the ac-author copies verbatim quotes into \`plan.md\`'s \`## Prior lessons\` section. No separate \`research-learnings.md\` artifact unless \`legacy-artifacts: true\`.
- \`repo-research\` — **brownfield only** (manifest at repo root AND populated source root). Skipped on greenfield. Writes \`flows/<slug>/research-repo.md\`.

Both research helpers run as sub-agent dispatches with their own \`.cclaw/lib/agents/<id>.md\` contracts; they never become \`lastSpecialist\` and never appear in \`triage.path\`.

### Inputs (ac-author reads after the contract + wrappers)

- triage decision (with \`assumptions\` from triage.assumptions)
- the user's original \`/cc <task>\` prompt
- \`.cclaw/lib/templates/plan.md\`
- the \`learnings-research\` blob (returned inline in its slim-summary \`Notes\`)
- \`flows/<slug>/research-repo.md\` (when brownfield)
- \`.cclaw/knowledge.jsonl\` for cross-check (independent of the learnings-research blob)
- the matching shipped slug if the flow is refining one (\`triage.refines\` is set)

### Output (small/medium)

\`flows/<slug>/plan.md\` with:

- frontmatter \`status: active\`, \`slug\`, \`stage: plan\`, \`ceremonyMode\` (\`soft\` or \`strict\`), \`ac: [...]\` (id + status), \`last_specialist: ac-author\`, \`refines\` (if applicable), \`security_flag\`.
- \`## Assumptions\` section, **verbatim** from \`triage.assumptions\` — do not paraphrase.
- \`## Prior lessons\` section from the learnings-research blob, **verbatim** quotes (no summary).
- Body shape depends on ceremonyMode:
  - **soft-mode body** = a bullet list of testable conditions (3-7 items typical).
  - **strict-mode body** = an AC table with \`AC-N\`, verification line (test name / manual step / command), \`touchSurface\`, and \`parallelSafe\` per row; \`## Topology\` block with \`inline\` (default) or \`parallel-build\` (only when the topology gate from §5 above fires).

### Slim summary (ac-author → orchestrator)

\`\`\`
Stage: plan  ✅ complete  |  ⏸ paused  |  ❌ blocked
Artifact: flows/<slug>/plan.md
What changed: <one sentence; e.g. "5 testable conditions" or "AC-1 … AC-7, parallel-build (3 slices)">
Open findings: 0
Confidence: <high | medium | low>
Recommended next: continue
Notes: lessons={<count or summary>}, topology=<inline | parallel-build>, prior-lesson-count=<N>
\`\`\`

The orchestrator reads only this; the full plan.md stays in \`flows/<slug>/plan.md\` for the next stage's slice-builder dispatch. The five report fields the orchestrator uses are: condition / AC count, max \`touchSurface\` value, parallel-build flag, recommended-next, prior-lesson count.

## Path: large-risky

Open this section **only when \`triage.complexity == "large-risky"\` and the path includes \`plan\`**. For small/medium plan, see "Path: small/medium" above.

The discovery sub-phase runs a **two-step** chain: \`design\` (main context, multi-turn) → \`ac-author\` (sub-agent). \`currentStage\` stays \`"plan"\` for both; \`lastSpecialist\` rotates through \`design\` then \`ac-author\`.

### v8.14 collapse context

Pre-v8.14 ran a three-step \`brainstormer → architect → ac-author\` chain of one-shot sub-agents, with a checkpoint-question between each. That ceremony was thin — the brainstormer's "Frame" and the architect's "decisions" both came from one shot of the model with no user dialog. v8.14 replaces the first two steps with a **single \`design\` specialist that runs in main context** across seven multi-turn phases (Bootstrap, Clarify, Frame, Approaches, Decisions inline, Pre-mortem, Compose, Sign-off), so framing and structural decisions emerge from a real user-collaborative pass instead of two short summaries.

### Discovery auto-skip (low-ambiguity fast path)

Before activating \`design\`, run the **discovery-needed heuristic** against the triage and pre-flight state. Skip directly to \`ac-author\` (single dispatch, no design phase) when **all** of the following hold:

1. \`triage.confidence\` is \`high\` (the heuristic produced an unambiguous large-risky classification).
2. \`triage.assumptions\` is non-empty AND the user accepted them in pre-flight without edits (\`pre_flight_edits == 0\`).
3. The user's \`/cc <task>\` prompt names ≥1 concrete file path or module (i.e. the focus surface is already given, not yet to be discovered).
4. There is no security-sensitive keyword (\`auth\`, \`token\`, \`secret\`, \`oauth\`, \`saml\`, \`encryption\`, \`pii\`, \`gdpr\`, \`pci\`, \`hipaa\`, \`soc2\`) in the prompt **AND** \`security_flag\` is not preset by triage.

When all four hold, the orchestrator surfaces a one-sentence skip notice in the user's language ("Discovery skipped: triage is high-confidence and the surface is named — going straight to ac-author. Reply with \`/cc-cancel\` if you want a design pass instead.") and dispatches \`ac-author\` directly with the same envelope as small/medium plus \`fast_path: skipped-discovery\` in flow-state. \`lastSpecialist\` stays \`null\` until ac-author returns.

When **any** of the four fails, run the full two-step discovery as below.

The user can also bypass the heuristic explicitly with \`/cc <task> --discovery=force\` (always run the full design phase) or \`/cc <task> --discovery=skip\` (always skip, even if the heuristic would not have skipped — they take responsibility).

### Full two-step discovery (default; auto-skip declined or its conditions failed)

> **Discovery never auto-chains across stages.** \`design\` runs in main context with the **v8.47+ two-turn-max** pacing: design pauses at MOST twice per flow — Phase 1 (Clarify, conditional) and Phase 7 (Sign-off, mandatory) — regardless of \`triage.runMode\`. \`auto\` runMode applies to plan→build→review→ship transitions only, **not** inside design's internal phase chain. The ac-author dispatch that follows the design's Phase 7 sign-off is a step-mode pause unless \`triage.runMode == auto\`.

1. **Activate \`design\` in main context** (read \`.cclaw/lib/agents/design.md\` as a skill the orchestrator itself follows; do NOT dispatch as a sub-agent).
   - The orchestrator picks the **posture** before activation: \`deep\` when any of (security-sensitive keyword, \`security_flag\` preset, irreversibility / migration / schema / breaking-change / data-loss / payment / gdpr / pci in the prompt, \`refines:\` points to a slug with \`security_flag: true\`); \`guided\` otherwise. The design prompt may escalate to \`deep\` mid-flight if Phase 3 surfaces irreversibility the orchestrator missed.
   - The orchestrator follows the design.md prompt phases 0-7 directly in this conversation. **v8.47+ pacing:** only **Phase 1** (Clarify, when 0-3 clarifying questions are needed — one batched \`askUserQuestion\` call) and **Phase 7** (Sign-off, always — three-option picker: \`approve\` / \`request-changes\` / \`reject\`) emit user-facing output and end the turn. Phases 0 (Bootstrap), 2 (Frame), 3 (Approaches), 4 (Decisions), 5 (Pre-mortem, deep only), 6 (Compose + self-review), and 6.5 (ADR proposal) all execute SILENTLY in the same orchestrator turn — append plan.md sections as you go; do not pause.
   - Output: appends Frame, Spec (v8.46), optional Non-functional, optional Approaches + Selected Direction, optional Decisions section (D-1 … D-N inline), optional Pre-mortem, Not Doing, optional Open questions, and Summary — design block to \`flows/<slug>/plan.md\`. Optional \`docs/decisions/ADR-NNNN-<slug>.md\` files when Phase 6.5 fires. **No separate \`decisions.md\` is written; v8.14 inlined that file into the Decisions section of plan.md.**
   - On Phase 7 \`approve\`: orchestrator patches \`lastSpecialist: "design"\` and \`plan.md\` frontmatter (\`last_specialist: design\`, \`posture: <guided|deep>\`, \`decision_count: <N>\`) → **ends the turn**. The next \`/cc\` continues with ac-author.
   - On Phase 7 \`request-changes\`: design re-runs the affected silent phases (Phase 2 / 3 / 4 / 5 / 6) internally and re-emits Phase 7 with the revised plan.md. **Revise cap = 3 iterations**; on the 4th request, design escalates explicitly (\`approve as-is\` / \`reject\` / \`revise one more time\`). Orchestrator does not patch \`lastSpecialist\` until the user picks \`approve\`.
   - On Phase 7 \`reject\`: design appends a brief \`## Design rejected\` note to plan.md and surfaces the rejection. Orchestrator does NOT patch \`lastSpecialist: design\`; the user is routed to \`/cc-cancel\` or re-triage.
2. **Dispatch \`ac-author\`** as a normal sub-agent with the same contract as small/medium plan, plus an extra input: the design sections already in \`flows/<slug>/plan.md\`.
   - AC author now writes the AC table (large-risky is always \`strict\` ceremonyMode by default), touch surfaces, parallel-build topology if it applies. The Frame / Approaches / Selected Direction / Decisions / Pre-mortem sections from design remain at the top of \`plan.md\`; ac-author appends its own sections below.
   - Orchestrator reads slim summary → patches \`lastSpecialist: "ac-author"\` AND advances \`currentStage\` to the next stage in \`triage.path\` (typically \`"build"\`). At this point the orchestrator follows \`triage.runMode\` for the plan→build transition: \`step\` ends the turn; \`auto\` chains immediately into the build dispatch.

Resume after a design or ac-author checkpoint: \`flow-state.lastSpecialist\` tells the orchestrator which discovery step to skip. If \`lastSpecialist == "design"\` and \`currentStage == "plan"\`, the resume dispatches \`ac-author\` directly. The user can also \`/cc <task> --skip-discovery\` to drop straight into a single ac-author dispatch when the design phase already happened in a prior session.

**Legacy migration:** state files written by pre-v8.14 cclaw with \`lastSpecialist: "brainstormer"\` or \`lastSpecialist: "architect"\` are rewritten to \`null\` on read; the orchestrator re-runs the unified design phase from scratch on those resumes. Shipped slugs with \`flows/shipped/<old-slug>/decisions.md\` keep that file untouched for historical reference.
`;

const BUILD_PLAYBOOK = `# Stage runbook — build (TDD cycle)

**Build is a TDD cycle.** Every AC goes through RED → GREEN → REFACTOR. There is no other build mode. The orchestrator opens this file before invoking \`slice-builder\` or implementing inline; \`slice-builder\` opens it on every AC.

## Iron Law

> NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. THE RED FAILURE IS THE SPEC.

Build refuses to commit production code that is not preceded by a recorded RED test. As of v8.40 the cycle is enforced by **prompt + commit-message-prefix contract** (no hook): each AC's commits carry an explicit \`red(AC-N): ...\` / \`green(AC-N): ...\` / \`refactor(AC-N): ...\` (or posture-specific \`test\` / \`docs\`) prefix that the reviewer scans at handoff time via \`git log --grep="(AC-N):"\`. Missing or out-of-order commits are A-1 findings (severity=required).

## 1. Pick the next pending AC

Read \`.cclaw/state/flow-state.json\` and pick the first AC with \`status: pending\`. If none, exit build-stage and transition to review.

## 2. Discover before RED (mandatory)

Before writing the failing test, **read** the affected surface:

- Existing test files for the module (run \`rg\` for the function name in \`tests/\`).
- Fixture and helper files used by the closest existing tests.
- The runnable command(s) that execute those tests (\`npm test path\`, \`pytest path\`, \`go test ./pkg/...\`).
- Public API surfaces, callbacks, state transitions, schemas, and contracts the AC touches.

Cite each citation as \`file:path:line\`. No invented paths. If the ac-author cited a file that does not exist, **stop** and surface it back as a ac-author-stage finding.

The discovery output goes into \`flows/<slug>/build.md\` under the AC's row, in the **Discovery** column. Skipping discovery is one of the five mandatory gate failures.

## 3. RED — write a failing test that encodes the AC verification

Rules for the RED phase:

- Touch test files only. **No production edits in the RED commit.**
- The test must fail for the **right reason** — the assertion that encodes the AC, not a syntax error or import error.
- Capture the test runner output that proves the failure. The captured output is the **watched-RED proof**.
- One AC = one RED commit. If the AC needs more than one test to be observable, stage them all and commit together.
- **Test files are named after the unit under test, never after the AC id.** \`tests/unit/permissions.test.ts\` is correct; \`AC-1.test.ts\` / \`tests/AC-2.test.ts\` is wrong. The AC id lives in the test name (\`it('AC-1: …', …)\`), the commit message, and the build log — not in the filename.

Stage and commit:

\`\`\`bash
git add tests/path/to/new-or-updated.test.ts
git commit -m "red(AC-N): assert <observable behaviour>"
\`\`\`

Append the watched-RED proof to \`flows/<slug>/build.md\` under the AC row, in the **RED proof** column (test name + 1-2 line failure excerpt). The commit SHA goes into the row's **commits** column so the reviewer can cross-reference \`git log --grep="^red(AC-N):"\`.

## 4. GREEN — minimal production change to make RED pass

Rules for the GREEN phase:

- Smallest possible production diff that turns RED into PASS.
- Run the **full relevant suite**, not the single test, before committing. A passing single test with the rest of the suite broken is not GREEN.
- Capture the suite output (command + PASS/FAIL summary). This is the **GREEN evidence**.
- Touch only files declared in the plan. If the GREEN-correct change requires touching files outside the plan, **stop** and surface it. Scope creep is not progress.

Stage and commit:

\`\`\`bash
git add src/path/to/implementation.ts
git commit -m "green(AC-N): minimal impl that satisfies RED"
\`\`\`

Append the GREEN evidence to \`flows/<slug>/build.md\` under the AC row, in the **GREEN evidence** column. The reviewer cross-checks with \`git log --grep="^green(AC-N):"\` at handoff time — a \`green(AC-N): ...\` commit without a prior \`red(AC-N): ...\` (and posture is \`test-first\` or \`characterization-first\`) is an A-1 finding (severity=required, axis=correctness).

## 5. REFACTOR — keep behaviour, improve shape (mandatory)

REFACTOR is **not optional**. Even when the GREEN diff feels clean, run a deliberate refactor pass:

- Behaviour-preserving cleanups: rename, extract, inline, deduplicate, narrow types.
- Run the same suite again after the refactor; it must still pass with **identical expected output**.
- If no refactor is warranted (the GREEN diff is genuinely minimal and idiomatic), **say so explicitly** in the row's **REFACTOR notes** column ("no refactor: 12-line addition, idiomatic"). Silence is not acceptable; the gate exists to force the question.

If a refactor lands, commit it separately:

\`\`\`bash
git add src/path/to/refactored.ts
git commit -m "refactor(AC-N): <one-line shape change>"
\`\`\`

If no refactor lands, **v8.49 default is the build.md row declaration** (no empty commit needed): write \`Refactor: skipped — <one-line reason>\` in the AC row's REFACTOR notes column. The reviewer reads the literal \`Refactor: skipped\` token from the row and treats the refactor slot as satisfied. The legacy path — \`git commit --allow-empty -m "refactor(AC-N) skipped: <reason>"\` — is still accepted for backwards compat on already-shipped slugs. A row that records neither a SHA, the build.md \`Refactor: skipped\` token, nor the empty marker is treated as missing-refactor (A-1, severity=required).

## 6. Append the AC row to builds/<slug>.md

After REFACTOR, the AC row in \`.cclaw/flows/<slug>/build.md\` carries:

| AC | Discovery | RED proof | GREEN evidence | REFACTOR notes | commits |
| --- | --- | --- | --- | --- | --- |
| AC-N | tests/path:line, fixtures... | test name + failure excerpt | command + PASS summary | one-line shape change applied **or** "Refactor: skipped — <reason>" (v8.49 default; no empty commit) | red SHA, green SHA, refactor SHA (omit when REFACTOR notes declares "Refactor: skipped") |

The build is complete for this AC only when all six columns are filled.

## 7. Repeat or hand off

If more AC are pending, repeat from step 1. If all AC are through REFACTOR, transition to review-stage.

## 8. Fix-only flow (after a review iteration)

When \`reviewer\` returns \`block\`, the slice-builder is dispatched in \`fix-only\` mode bound to the file:line refs from the latest review block. The TDD cycle still applies:

- if the fix changes observable behaviour, write a new RED test that encodes the corrected behaviour, then GREEN, then REFACTOR;
- if the fix is purely a refactor of existing code (no behaviour change), commit it as \`refactor(AC-N): fix F-N — <one-line>\`;
- the AC id stays the same (\`git commit -m "<prefix>(AC-N): fix F-N — <one-line>"\`); the \`fix F-N\` token in the body is what the reviewer cross-references against the review block;
- a separate set of rows in \`flows/<slug>/build.md\` records F-N → phase → commit (SHA).

## 9. Mandatory gates (every AC)

Before transitioning to review, every AC must satisfy:

1. **discovery_complete** — relevant tests / fixtures / helpers / commands cited.
2. **impact_check_complete** — affected callbacks / state / interfaces / contracts named.
3. **red_test_written** — failing test exists, recorded with watched-RED proof.
4. **red_fails_for_right_reason** — RED captured a real assertion failure, not a syntax error.
5. **green_full_suite** — full relevant suite green after GREEN, not the single test.
6. **refactor_completed_or_skipped_with_reason** — REFACTOR ran, or was explicitly skipped with a one-line reason. The skip declaration may live in the AC's \`build.md\` row REFACTOR notes column (v8.49 default — literal token \`Refactor: skipped — <reason>\`) OR as a legacy \`refactor(AC-N) skipped: <reason>\` empty-marker commit; either satisfies the gate.
7. **traceable_to_plan** — AC commits reference plan AC ids and the plan's file set.
8. **commit_chain_intact** — \`git log --grep="(AC-N):" --oneline\` shows the posture-appropriate commit sequence (e.g. \`red(AC-N)\` before \`green(AC-N)\` for \`test-first\` / \`characterization-first\` postures; \`refactor(AC-N)\` only for \`refactor-only\`; \`test(AC-N)\` only for \`tests-as-deliverable\`; \`docs(AC-N)\` only for \`docs-only\`). For \`test-first\` / \`characterization-first\` postures the refactor slot may be satisfied by EITHER a \`refactor(AC-N)\` commit OR the v8.49 build.md \`Refactor: skipped — <reason>\` row token; chain integrity is preserved across both representations.

All eight gates are now reviewer-enforced ex-post via prompt + git log + \`build.md\` inspection (v8.40 retired the mechanical pre-commit gate cclaw used to ship). The slice-builder's \`self_review[]\` JSON attestation is the pre-reviewer gate the orchestrator inspects; the reviewer is the ex-post gate that verifies the chain by running \`git log --grep\` against the plan's AC list.

## 10. Common pitfalls

- Skipping RED because "the implementation is obvious". The cycle is the contract; obvious code still gets a test.
- Single test passes, full suite fails, but commit anyway. That is not GREEN; it is a regression.
- REFACTOR phase silently skipped. v8.49 default: write \`Refactor: skipped — <reason>\` in the AC's build.md row REFACTOR notes column (no empty commit needed). The legacy empty-marker commit is still accepted; absence of both is the missing-refactor finding.
- Writing production code in the RED commit. Stage and commit test files only in the RED phase.
- Skipping the per-criterion prefix (\`red(AC-N): ...\`) "just this once" or committing without an AC id. The reviewer's \`git log --grep\` scan misses it and the AC reads as missing → A-1 finding, fix-only bounce.
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

Each iteration appends a block to \`.cclaw/flows/<slug>/review.md\`:

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

A \`warn\` does not block ship, but the warning must be recorded in \`flows/<slug>/review.md\` and surfaced in \`flows/<slug>/ship.md\`. The user can decide to fix it inline or capture it as a follow-up.

## 6. Five Failure Modes pass (mandatory)

Every iteration explicitly answers each mode: yes / no, with citation when yes.

1. **Hallucinated actions** — invented files, ids, env vars, function names, command flags?
2. **Scope creep** — diff touches files no AC mentions?
3. **Cascading errors** — one fix introduces typecheck / runtime / test failures elsewhere?
4. **Context loss** — earlier decisions / AC text / design Frame ignored?
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

> **Iron Law:** NO MERGE WITHOUT GREEN PREFLIGHT, A WRITTEN ROLLBACK, AND EXACTLY ONE SELECTED FINALIZATION MODE. No exceptions for urgency. If no VCS is available, use \`FINALIZE_NO_VCS\` explicitly instead of inventing git steps.

## 1. Plan traceability gate

Before anything else, verify every AC in flow-state.json is \`status: committed\` with a real SHA. If any AC is pending, the gate refuses ship. Stop and either complete the AC or open a fresh slug for the rest.

The gate is enforced inside the runtime; you cannot bypass it. If you think you must, you don't.

## 2. Run preflight checks (fresh output)

Every check below must produce fresh output in this turn. Pasting "tests passed yesterday" does not count.

\\\`\\\`\\\`bash
$ npm test
$ npm run build
$ npm run lint
$ npm run typecheck
$ git status --porcelain
\\\`\\\`\\\`

Record each result in \`flows/<slug>/ship.md > Preflight checks\` (table). Set frontmatter \`preflight_passed: true\` only when every row is pass/empty. Any failure blocks ship; you do not move on until preflight is fully green.

### 2a. CI smoke gate (mandatory; T1-11 — v8.13)

After local preflight passes, run a **CI-equivalent smoke pass** against the slug's diff before authoring \`ship.md\`. The principle: local preflight catches "did the test suite I last touched still run", but CI runs the **full project suite under the project's CI conditions** (Node version, linting strictness, integration suites that local skips, deterministic environment). If CI would have caught a regression that local missed, the ship gate must catch it before merge.

Three modes, in order of preference:

1. **Project has a CI smoke target** (\`npm run ci:smoke\` / \`make ci-smoke\` / equivalent): run it. Capture stdout + exit code. Pass = exit 0 with no \`FAIL\` lines.

2. **No CI smoke target but a CI workflow file exists** (\`.github/workflows/*.yml\`, \`.gitlab-ci.yml\`, \`circleci/config.yml\`): synthesise the equivalent locally — read the workflow's \`run:\` steps for the test/build/lint job, then execute that exact sequence in this turn. Capture stdout per step. Pass = every step exits 0.

3. **No CI workflow at all** (small/personal repo, prototype): run an **expanded local preflight** that adds (a) a clean install (\`rm -rf node_modules && npm ci\` or equivalent for the language) and (b) every script under \`scripts/test:*\` / \`scripts/lint:*\` / \`scripts/check:*\` that is not already in §2's list. Record this in ship.md's frontmatter as \`ci_smoke_mode: expanded-local\` with the rationale "no CI workflow detected".

Record the ci-smoke result in \`flows/<slug>/ship.md > CI smoke\` (table — command + exit code + 1-3 line summary). Set frontmatter \`ci_smoke_passed: true\` only when **every** row is pass/exit-0. Any failure blocks ship.

The ship gate's Victory Detector treats \`ci_smoke_passed: true\` as a **mandatory** condition (alongside \`preflight_passed: true\`); a slug cannot ship without both.

## 3. Detect repository mode

\\\`\\\`\\\`bash
$ test -d .git && echo git || echo no-vcs
\\\`\\\`\\\`

If no-vcs, the only valid finalization mode is \`FINALIZE_NO_VCS\`. Document the manual handoff target and rollback owner; skip the merge-base step.

## 4. Merge-base detection (git mode only)

\\\`\\\`\\\`bash
$ git merge-base HEAD <base-branch>
$ git rev-list --count <merge-base>..<base-branch>
\\\`\\\`\\\`

If the count is non-zero AND any of those upstream commits touch this slug's \`touchSurface\`, rebase first. After the rebase, re-run preflight from step 2; do not trust the prior preflight result.

## 5. Author ships/<slug>.md

Seed from \`.cclaw/lib/templates/ship.md\`. Required sections (every one must be filled, no placeholders):

- summary (2-4 lines),
- preflight checks (table with command + fresh output),
- ci smoke (table; mandatory per §2a),
- repo mode (\`git\` / \`no-vcs\`),
- merge-base detection (git mode only),
- AC ↔ commit map with red/green/refactor SHAs read from \`git log --grep="(AC-N):" --oneline\` for every AC in the plan,
- rollback plan triplet (trigger / steps / verification — all three or it does not count),
- monitoring checklist (error rates, latency budgets, business metrics),
- finalization_mode (exactly one of FINALIZE_MERGE_LOCAL, FINALIZE_OPEN_PR, FINALIZE_KEEP_BRANCH, FINALIZE_DISCARD_BRANCH, FINALIZE_NO_VCS),
- breaking changes / migration ("none" is a valid value),
- release notes (one paragraph suitable for CHANGELOG.md; see §5a — auto-generated from AC↔commit evidence),
- risks carried over (warn-severity ledger rows, open assumptions),
- what didn't work (T2-11; 0-3 bullets naming approaches you tried and abandoned in this slug, why, and the path you took instead — empty section is fine when nothing was abandoned, write \`None.\` explicitly),
- victory detector check.

### 5a. Release-notes auto-gen (T1-12)

Do not author the \`release notes\` section by hand. Generate it from AC↔commit evidence + reviewer's positive findings:

1. Read \`flow-state.json > ac[]\` for every AC's id, text, phases (red/green/refactor SHAs).
2. Read the commit messages those SHAs produced (\`git show -s --format=%s <sha>\`); extract the post-AC-id descriptive part.
3. Read \`flows/<slug>/review.md\` for the latest iteration's \`What's done well\` block.
4. Synthesise a one-paragraph release-notes block in this shape:

\`\`\`markdown
## Release notes — <slug>

<one-sentence summary: what user-facing capability landed; phrase as "added" / "fixed" / "improved" / "changed" so it reads cleanly in CHANGELOG.md>

- **AC-1: <one short sentence from AC text>** — <implementation note from green commit>; verified by <test name>.
- **AC-2: <…>** — <…>.
…
\`\`\`

If the slug has \`> 6\` AC, group by touchSurface clusters (one bullet per cluster, naming "AC-X..AC-Y"). The auto-gen is a draft — you may rewrite for grammar, but you may **not** drop AC bullets or invent capabilities not in the AC list. The reviewer cross-checks the release notes against the AC list at iteration N+1; mismatches are \`required\` severity (axis=correctness).

For \`FINALIZE_OPEN_PR\`, the PR body's "Release Notes Draft" section is populated from this same block.

Set frontmatter \`release_notes_filled: true\` after authoring; the Victory Detector requires it.

## 6. Victory Detector

Ship is allowed only when ALL of these are true:

- review verdict = \`clear\` or \`warn\` (with convergence signal #2 fired),
- preflight_passed = true with fresh output recorded in this turn,
- ci_smoke_passed = true with fresh output recorded in this turn (T1-11; see §2a),
- rollback_recorded = true with all three fields filled,
- release_notes_filled = true (T1-12; \`release_notes\` body section is non-empty and not the template placeholder; see §5a below),
- learnings_captured_or_explicitly_skipped = true (T1-13; quality gate captured \`learnings.md\`, OR the user explicitly bypassed via the structured ask in §7a; silent skip is no longer allowed),
- finalization_mode set to exactly one enum value,
- repo_mode matches the chosen finalization mode (\`no-vcs\` cannot pick \`FINALIZE_MERGE_LOCAL\`).

If any condition fails, keep \`status: blocked\` and iterate. Do NOT advance with red preflight, a missing rollback, missing release notes, or a silent learnings skip.

## 7. Run compound

\`runCompoundAndShip()\` does the gate check, captures learnings if the quality gate passes, moves all active artifacts to \`.cclaw/flows/shipped/<slug>/\` (T0-10: also moves any non-canonical files like \`research-repo.md\`, \`cancel.md\`, future \`handoff.json\`), stamps the shipped frontmatter onto \`ship.md\` (slug, ship_commit, shipped_at, ac_count, review_iterations, security_flag, has_architect_decision, refines — \`has_architect_decision\` is kept as a stable signal name for back-compat; it now means "design's Phase 4 produced ≥1 D-N inline in plan.md"), appends an \`## Artefact index\` section listing every moved file (canonical and extra), appends to \`knowledge.jsonl\` if learnings were captured, and resets flow-state. (On \`legacy-artifacts: true\` it additionally writes a separate \`shipped/<slug>/manifest.md\` for back-compat.)

The compound quality gate captures \`flows/<slug>/learnings.md\` only when at least one of:

- \`design\` (Phase 4 D-N inline) or \`ac-author\` recorded a non-trivial decision,
- review needed ≥3 iterations,
- a security review ran or \`security_flag\` is true,
- the user explicitly asked.

### 7a. Learnings hard-stop (T1-13)

Prior versions silently skipped the learnings capture when none of the four signals fired. v8.13 makes this **non-silent**: when the quality gate fails AND the slug touched ≥2 modules OR ran ≥3 commits, the orchestrator **pauses before ship** and surfaces a structured ask:

> The compound quality gate did not fire (no design D-N recorded, fewer than 3 review iterations, no security review). Do you want to capture a one-paragraph learning anyway? [capture / skip-this-time / never-on-this-slug]

- **capture** → set \`signals.userRequestedCapture: true\` in the compound options; the gate then captures \`learnings.md\` and appends to \`knowledge.jsonl\` as if the gate had fired naturally.
- **skip-this-time** → \`signals.userRequestedCapture: false\` AND record the explicit skip in ship.md frontmatter (\`learnings_skipped_at: <iso>\`, \`learnings_skipped_reason: user-declined\`). The Victory Detector sees the explicit skip and accepts.
- **never-on-this-slug** → same as skip-this-time, plus a marker so a later refinement of this slug doesn't re-prompt.

The pause is the **default behaviour for any non-trivial slug whose gate didn't fire**; the user can suppress it permanently by setting \`config.captureLearningsBypass: true\` in \`.cclaw/config.yaml\` (CI-friendly opt-out).

This guards against the silent-skip path losing knowledge that *could* have shipped because none of the four heuristic signals matched. The user makes the call; cclaw doesn't decide silently.

When the gate fails on **trivial** slugs (single-AC, single-module, no review iterations), the silent skip stays — capturing learnings on a 12-line bug fix is noise.

## 8. Execute finalization

Run the action implied by \`finalization_mode\` and record the result back into \`flows/<slug>/ship.md\`. **The first thing you do here is update the \`finalization_mode\` frontmatter field on \`ship.md\`** from \`null\` to the chosen enum value — frontmatter is the machine-readable source of truth, and the body's \`Selected: <mode>\` line is supplementary. Inconsistency between frontmatter and body is a v8.11-era bug; the spec now requires both reflect the same value.

- **FINALIZE_MERGE_LOCAL** — merge into the base branch locally; verify clean merge; record the merged SHA.
- **FINALIZE_OPEN_PR** — \`gh pr create\` with a structured body (summary, AC↔commit map, rollback plan). Record the PR URL.
- **FINALIZE_KEEP_BRANCH** — \`git push -u origin HEAD\`. Record the upstream branch.
- **FINALIZE_DISCARD_BRANCH** — list what will be deleted, require typed confirmation in this turn (\`yes, discard <slug>\`), then delete. Record the deletion.
- **FINALIZE_NO_VCS** — record handoff target, artifact bundle path, and manual rollback owner. No git commands.

**Always ask before pushing.** Always ask before opening a PR. Do not run \`git push --force\` ever — if the user requests it explicitly, surface the warning and require a second confirmation.

## 9. Hand-off

Ship-stage ends when:

- \`flows/shipped/<slug>/ship.md\` exists with shipped-frontmatter (the v8.12 manifest replacement; \`legacy-artifacts: true\` also yields a separate \`manifest.md\`),
- flow-state is reset,
- the user is told push/PR status (whether approved or skipped),
- the rollback plan is sticky in \`flows/<slug>/ship.md\` (the future operator opens this if anything goes wrong).

The next \`/cc\` invocation can be a brand-new request or a refinement of this slug.

## 10. Re-write ship.md if late iterations land after the first pass

If the orchestrator dispatches a fix-only loop or an additional review iteration **after \`ship.md\` has been authored for the first time**, you must **re-author \`ship.md\` with the latest counts**, not append a delta paragraph:

- \`review_iterations\` — frontmatter and any body reference must reflect the final count.
- AC ↔ commit map — re-emit with the latest fix-only commit SHAs.
- Risks carried over — re-pull from the now-updated Findings table.
- Victory Detector — re-evaluate against the latest review verdict.
- Test counts ("16 tests" → "22 tests") — re-pull from the build artefact.

Stale \`ship.md\` is the v8.11-era bug where the file froze at iteration 2 (16 tests) while the manifest correctly reported iteration 5 (22 tests). The fix is **idempotent re-authoring**: re-write the file from scratch every time the ship-gate runs, do not patch incrementally.

## 11. Common pitfalls

- Skipping preflight because "tests passed during build". Preflight is the post-merge sanity check; build-stage tests are pre-merge.
- Skipping the rollback plan because "it's a small change". Small changes break production too. The triplet is mandatory.
- Selecting multiple finalization modes. Pick exactly one.
- Picking \`FINALIZE_MERGE_LOCAL\` in a repo with no \`.git/\`. The Victory Detector will refuse; use \`FINALIZE_NO_VCS\` and record the manual target.
- Pushing without asking. Always ask, always wait, every time.
- Opening a PR with stale release notes. Re-read \`flows/<slug>/ship.md\` before opening the PR.
- **Letting \`ship.md\` go stale across late iterations.** See §10 above; \`ship.md\` is idempotently re-authored, not patched.
- **Frontmatter \`finalization_mode: null\` while body says \`Selected: FINALIZE_X\`.** Frontmatter and body must both reflect the same value (see §8 above).
- Editing artifacts after they're moved to \`.cclaw/flows/shipped/\`. Shipped slugs are read-only. Refinement creates a new slug.
- Using \`git push --force\` to "fix" the ship_commit. Never. Open a follow-up slug instead.
`;

export const STAGE_PLAYBOOKS: StagePlaybook[] = [
  { id: "plan", fileName: "plan.md", title: "Stage runbook — plan", body: PLAN_PLAYBOOK },
  { id: "build", fileName: "build.md", title: "Stage runbook — build", body: BUILD_PLAYBOOK },
  { id: "review", fileName: "review.md", title: "Stage runbook — review", body: REVIEW_PLAYBOOK },
  { id: "ship", fileName: "ship.md", title: "Stage runbook — ship", body: SHIP_PLAYBOOK }
];

export const STAGE_PLAYBOOKS_INDEX = `# .cclaw/lib/runbooks/

Per-stage runbooks the orchestrator opens before transitioning into a stage. Each runbook is a strict checklist plus the common pitfalls collected from prior runs.

| stage | runbook |
| --- | --- |
${STAGE_PLAYBOOKS.map((p) => `| ${p.id} | [\`${p.fileName}\`](./${p.fileName}) |`).join("\n")}

The runbooks are intentionally redundant with the specialist prompts and skills — when the orchestrator is mid-stage and short on context budget, the runbook is the smallest self-contained reference.
`;
