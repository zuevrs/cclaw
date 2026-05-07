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

const BUILD_PLAYBOOK = `# Stage runbook — build

The orchestrator opens this file before invoking \`slice-builder\` or implementing inline.

## 1. Pick the next pending AC

Read \`.cclaw/state/flow-state.json\` and pick the first AC with \`status: pending\`. If none, exit build-stage and transition to review.

## 2. Read the targets

Open every \`file:path:line\` reference in the AC's verification line. Do not invent file paths. If the planner cited a file that does not exist, **stop** and surface it back as a planner-stage finding.

## 3. Make the smallest change that satisfies the AC

Smallest in three senses:

1. **smallest diff** that makes the verification pass;
2. **smallest scope** — touches only files declared in the plan;
3. **smallest cognitive load** — no new abstraction layer unless the plan called for one.

If the smallest-correct change requires touching files outside the plan, **stop** and surface it. This is scope creep, not progress.

## 4. Stage and run commit-helper

\`\`\`bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="…"
\`\`\`

The hook does the commit, captures the SHA, updates flow-state, and re-renders the traceability block. Never call \`git commit\` directly.

## 5. Append a row to builds/<slug>.md

\`.cclaw/builds/<slug>.md\` is the implementation log. Each AC adds a row with:

- AC id,
- short SHA,
- file:line refs (every file touched, with the exact line range),
- a one-line note explaining the why (not the what — the diff is the what).

## 6. Repeat or hand off

If more AC are pending, repeat from step 1. If all AC are committed, transition to review-stage. If a finding from the previous review iteration applies, jump to fix-only flow (see below).

## 7. Fix-only flow (after a review iteration)

When \`reviewer\` returns \`block\`, the slice-builder is dispatched in \`fix-only\` mode with the bounded set of file:line refs from the latest review block.

Hard rules:

- only files cited in the latest review block may be touched;
- the fix commit reuses the original AC id (\`commit-helper.mjs --ac=AC-N --message="fix: F-2"\`);
- a separate row in \`builds/<slug>.md\` records the F-N → AC-N → commit chain;
- after the fix commits, the orchestrator re-invokes the same reviewer mode.

## 8. Common pitfalls

- Bypassing commit-helper "just this once". Don't. The traceability gate breaks.
- Staging unrelated edits along with the AC change. Use \`git add\` per file, never \`git add -A\` inside \`/cc\`.
- Writing tests in a follow-up commit. Tests live with the AC commit unless the plan explicitly separates them.
- Refactoring "while we're here". Refusal is the right answer; capture the refactor as a follow-up in \`.cclaw/ideas.md\`.
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
