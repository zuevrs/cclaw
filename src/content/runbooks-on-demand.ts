export interface OnDemandRunbook {
  id: string;
  fileName: string;
  title: string;
  body: string;
}

const DISPATCH_ENVELOPE = `# On-demand runbook — dispatch envelope shape

The orchestrator opens this runbook **before authoring any specialist dispatch envelope**. The shape below is the contract every \`/cc\` dispatch follows; the wire format is identical across harnesses (Claude Code, Cursor, OpenCode, Codex). When the orchestrator announces a dispatch in its message to the user, the announcement uses this shape verbatim so the harness picks it up consistently.

## Envelope shape

\`\`\`
Dispatch <specialist>
─ Required first read: .cclaw/lib/agents/<specialist>.md  (your contract — modes, hard rules, output schema, worked examples; do NOT skip)
─ Required second read: .cclaw/lib/skills/<wrapper>.md  (your wrapping skill — see "Stage → wrapper" in start-command)
─ Stage: <plan | build | review | ship>
─ Slug: <slug>
─ AC mode: <inline | soft | strict>
─ Pre-flight assumptions: see triage.assumptions in flow-state.json
─ Inputs the sub-agent reads after the contract + wrapper:
    - .cclaw/state/flow-state.json
    - .cclaw/flows/<slug>/<stage>.md (if it exists)
    - .cclaw/lib/templates/<stage>.md
    - other artifacts the stage needs (decisions, research-*, build, review)
─ Output contract (sub-agent writes):
    - .cclaw/flows/<slug>/<stage>.md (the main artifact)
    - return a slim summary block (≤6 lines, see start-command "Slim summary")
    - DO NOT mutate flow-state.json — only the orchestrator touches it
─ Forbidden:
    - dispatch other specialists (composition is the orchestrator's job)
    - run git commands other than \`git add\` / \`git commit -m "<prefix>(AC-N): ..."\` (no \`git push\`, no \`git rebase\`, no \`git reset\`)
    - read or modify files outside the slug's touch surface
\`\`\`

The first two reads are non-negotiable. A sub-agent that skips its contract file will hallucinate its own role definition (we observed this in production — early discovery specialists ran with a 30-line summary instead of their full contract). If the harness has a sub-agent system message, the orchestrator places those two reads as the sub-agent's first instructions; if the harness dispatches via plain "spawn a fresh context", the orchestrator puts them at the top of the inline prompt. Either way, the sub-agent opens \`.cclaw/lib/agents/<specialist>.md\` before doing anything else.

## Inline-fallback (no sub-agent dispatch support)

If the harness does not support sub-agent dispatch, run the specialist inline in a fresh context (clear the prior conversation if you can). Record the fallback in the artifact's frontmatter (\`subAgentDispatch: inline-fallback\`). This is not an error.

## What the sub-agent must NOT do

- dispatch other specialists (composition is the orchestrator's job, not theirs);
- push, rebase, force-update, or merge branches (the orchestrator owns the ship stage);
- modify files outside the slug's touch surface.

In strict mode the slice-builder commits each AC with the posture-driven prefix (\`red(AC-N): ...\` / \`green(AC-N): ...\` / \`refactor(AC-N): ...\` / \`test(AC-N): ...\` / \`docs(AC-N): ...\`); the reviewer verifies the chain ex-post via \`git log --grep="(AC-N):"\`. In soft / inline mode plain \`git commit\` is fine (one cycle for the feature).
`;

const PARALLEL_BUILD = `# On-demand runbook — parallel-build fan-out

Open this runbook only when the ac-author artifact declares \`topology: parallel-build\` with ≥2 slices AND \`acMode == strict\`. For sequential build, see \`.cclaw/lib/runbooks/build.md\`.

## Trigger

When the ac-author artifact declares \`topology: parallel-build\` with ≥2 slices and \`acMode == strict\`, the orchestrator fans out one \`slice-builder\` sub-agent per slice, **capped at 5**, each in its own \`git worktree\`. This is the only fan-out cclaw uses outside of \`ship\`.

## Fan-out shape

\`\`\`text
                                  flows/<slug>/plan.md
                                  topology: parallel-build
                                  slices: [s-1, s-2, s-3]   (max 5)
                                              │
                                              ▼
                            git worktree add .cclaw/worktrees/<slug>-s-1 -b cclaw/<slug>/s-1
                            git worktree add .cclaw/worktrees/<slug>-s-2 -b cclaw/<slug>/s-2
                            git worktree add .cclaw/worktrees/<slug>-s-3 -b cclaw/<slug>/s-3
                                              │
                          ┌───────────────────┼───────────────────┐
                          ▼                   ▼                   ▼
                   slice-builder         slice-builder         slice-builder
                   (s-1; AC-1, AC-2)     (s-2; AC-3)           (s-3; AC-4, AC-5)
                   cwd: …/<slug>-s-1      cwd: …/<slug>-s-2     cwd: …/<slug>-s-3
                   RED→GREEN→REFACTOR     RED→GREEN→REFACTOR    RED→GREEN→REFACTOR
                   per AC, in slice       per AC, in slice      per AC, in slice
                          │                   │                   │
                          └───────────────────┼───────────────────┘
                                              ▼
                                  reviewer (mode=integration)
                                  reads each branch, checks
                                  cross-slice conflicts, AC↔commit
                                  chain across the wave
                                              │
                                              ▼
                          merge cclaw/<slug>/s-1 → main, then s-2, then s-3
                          (fast-forward when wave was clean; otherwise stop and ask)
                                              │
                                              ▼
                          git worktree remove .cclaw/worktrees/<slug>-s-N (per slice)
\`\`\`

## Dispatch envelope (per slice)

\`\`\`
Dispatch slice-builder
─ Stage: build
─ Slug: <slug>
─ Slice: s-N  (acIds: [AC-N, AC-N+1])
─ Working tree: .cclaw/worktrees/<slug>-s-N
─ Branch: cclaw/<slug>/s-N
─ AC mode: strict
─ Touch surface (only paths this slice may modify): [<paths from plan>]
─ Output: .cclaw/flows/<slug>/build.md (append, marked with slice id)
─ Forbidden: read or modify any path outside touch surface; read another slice's worktree mid-flight; merge or rebase
\`\`\`

## After every slice-builder returns

1. Patch \`flow-state.json\` with the per-slice progress.
2. When **every** slice has reported, dispatch \`reviewer\` mode=\`integration\` (one sub-agent, reads from each branch).
3. On clear integration review, merge slices into main one at a time. On block, dispatch \`slice-builder\` mode=\`fix-only\` against the cited file:line refs, then re-run the integration reviewer.
4. Worktree cleanup happens after merge; the cclaw branches stay until ship.

## Hard rules

- **More than 5 parallel slices is forbidden.** If ac-author produced >5, the ac-author must merge thinner slices into fatter ones before build; do not generate "wave 2".
- Slice-builders never read each other's worktrees mid-flight. A slice that detects a conflict with another stops and raises an integration finding.
- **Parallel-build fallback (T1-5)** — when the harness lacks sub-agent dispatch or worktree creation fails (non-git repo, permissions, dirty working tree, harness limit reached), parallel-build degrades to inline-sequential. The fallback is **not silent**:
  - Render an explicit warning to the user in their language naming the cause (e.g., "harness does not support parallel sub-agents — falling back to sequential build, will run AC-1..AC-N one after another"), AND
  - Use the harness's structured ask to surface a single \`accept-fallback\` option (and inform the user they may invoke \`/cc-cancel\` themselves if the loss of parallelism makes the work not worth doing under sequential timing) — the orchestrator must wait for the user's explicit \`accept-fallback\` reply before dispatching the sequential slice-builder. The parallel→sequential decision changes wall-clock substantially; the user gets to make the call.
  - Record the fallback in \`flows/<slug>/build.md\` frontmatter (\`subAgentDispatch: inline-fallback\`, \`fallback_reason: <one-line>\`, \`fallback_accepted_at: <iso>\`) so the reviewer sees it. The fallback is not an error, but it is a visible event with a recorded user-acknowledgement.
- \`auto\` runMode does **not** affect the integration-reviewer ask: a parallel wave that produces a block finding always asks the user before fix-only.
`;

const FINALIZE = `# On-demand runbook — Hop 6 finalize (ship → shipped)

Open this runbook **only after Hop 5 (compound) completes** and \`flows/<slug>/ship.md\` carries \`status: shipped\`. Hop 6 is the orchestrator's job, never a sub-agent's.

## Steps (in order, in the orchestrator's own context)

1. **Pre-condition check.** \`flows/<slug>/ship.md\` exists with \`status: shipped\` (or equivalent gate). If the gate is \`block\`, do NOT finalise — stay paused. If the path was \`inline\` (trivial), there is nothing to finalise; skip Hop 6 entirely.
2. **Create the shipped directory.** \`mkdir -p .cclaw/flows/shipped/<slug>\`. Idempotent: if the directory already exists (re-run, race), continue without error.
3. **Move every artifact.** Use \`git mv\` when the repo is a git workspace and the active flow files are tracked; otherwise plain \`mv\`. Move (do NOT copy) every file in \`flows/<slug>/\`:
   - \`plan.md\`
   - \`build.md\` (when present)
   - \`review.md\` (when present)
   - \`ship.md\`
   - \`decisions.md\` (when present — large-risky only, pre-v8.14 shipped flows)
   - \`learnings.md\` (when written by Hop 5)
   - \`pre-mortem.md\` (only on \`legacy-artifacts: true\` — default v8.12 collapses pre-mortem into \`review.md\` as a section)
   - \`research-repo.md\` (when written by repo-research)
   - \`research-learnings.md\` (only on \`legacy-artifacts: true\` — default v8.12 keeps learnings inline in the ac-author's slim-summary)
   The word "copy" must not appear in the dispatch envelope or in your own actions. \`cp\` is forbidden here. The active directory must end up empty after the moves.
4. **Stamp the shipped frontmatter on \`ship.md\`.** As of v8.12, manifest.md is collapsed into \`ship.md\`'s frontmatter. Update \`ship.md\`'s frontmatter to include the final flow signals (snake_case keys per artefact-frontmatter convention): \`slug\`, \`shipped_at\`, \`ac_mode\`, \`complexity\`, \`security_flag\`, \`review_iterations\`, \`ac_count\`, \`finalization_mode\`. Body of \`ship.md\` keeps the AC↔commit map (strict) or condition checklist (soft); add an "## Artefact index" section listing the artefacts that ended up in the shipped dir (one bullet per file). Users on the opt-in \`legacy-artifacts: true\` config still get a separate \`manifest.md\` in addition.
5. **Post-condition check (mandatory).** \`flows/<slug>/\` (the active directory) must be empty. If it is not, you have made a mistake — list the residue, surface it to the user, do NOT continue. The most common cause is mistakenly using \`cp\` instead of \`git mv\`/\`mv\`. Once the active dir is empty, \`rmdir flows/<slug>\` to remove the now-empty directory.
6. **Promote ADRs (PROPOSED → ACCEPTED).** Scan \`flows/shipped/<slug>/plan.md\` (just moved in step 3; v8.14+ inlines D-N records there) and any legacy \`flows/shipped/<slug>/decisions.md\` (pre-v8.14 shipped flows) for \`ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)\` lines. For each found ADR file, edit the frontmatter in place: \`status: PROPOSED\` → \`status: ACCEPTED\`; add \`accepted_at: <iso>\`; add \`accepted_in_slug: <slug>\`; add \`accepted_at_commit: <ship-commit-sha>\`. Commit each promotion with \`docs(adr-NNNN): promote to ACCEPTED via <slug>\`. Skip the entire step when no PROPOSED ADR was found. Do NOT promote ADRs the design phase did not propose for this slug. See \`.cclaw/lib/skills/documentation-and-adrs.md\` for the full lifecycle (including supersession bookkeeping for ADRs that supersede an earlier ACCEPTED one).
7. **Reset flow-state.** Write \`createInitialFlowState\` defaults to \`.cclaw/state/flow-state.json\` (\`currentSlug: null\`, \`currentStage: null\`, \`triage: null\`, \`ac: []\`, \`reviewIterations: 0\`, \`securityFlag: false\`, \`lastSpecialist: null\`). The shipped manifest is the durable record; flow-state is now a clean slot ready for the next \`/cc\`.
8. **Render the final summary** to the user: one block citing \`shipped/<slug>/ship.md\` (the file that now carries the manifest frontmatter — or \`shipped/<slug>/manifest.md\` on \`legacy-artifacts: true\`), the AC count, any captured learnings, and any ADR ids promoted to \`ACCEPTED\` in step 6.

## Hard rules

- **No "copy" anywhere.** Sub-agent dispatches do NOT mention copying. The orchestrator's own actions use \`git mv\` (preferred when the files are git-tracked) or \`mv\` (when not). \`cp\` is a bug.
- **No partial finalize.** If any \`mv\` fails (filesystem error, permission, lock), stop and surface the failure. Do not leave half the flow in shipped and half in active.
- **No re-entrant finalize on resume.** If \`flows/<slug>/\` is already empty when you reach Hop 6 (a previous run finalised), check that \`shipped/<slug>/ship.md\` exists with \`status: shipped\` in its frontmatter; if it does, this slug is already shipped — reset flow-state and tell the user "already finalised in <iso>". Do NOT recreate the artefacts. (On \`legacy-artifacts: true\` you can also key off \`shipped/<slug>/manifest.md\`.)
`;

const CAP_REACHED_RECOVERY = `# On-demand runbook — cap-reached recovery (review iteration 5)

Open this runbook **only when \`flow-state.json > reviewCounter\` reaches 5** without convergence. For the standard review loop, see \`.cclaw/lib/runbooks/review.md\`.

## Review-cap picker (v8.20+)

Track the cap with \`flow-state.json > reviewCounter\` (v8.20-introduced sibling of \`reviewIterations\`; \`reviewIterations\` continues to be the monotonic lifetime counter, \`reviewCounter\` is the cap-budget that the user can extend). Increment \`reviewCounter\` on every reviewer dispatch in parallel with \`reviewIterations\`. v8.19 flows resumed on v8.20 start at \`reviewCounter: 0\` even if \`reviewIterations\` already reflects prior dispatches — the cap is a fresh budget on resume.

**When \`reviewCounter\` reaches \`5\`**, do NOT dispatch another reviewer. Surface a structured \`AskQuestion\` picker with these options and stop:

1. \`cancel-and-replan\` — Apply the cap-reached split-plan below: orchestrator authors the recommended split into \`review.md\` and asks the user to confirm the follow-up slug names. The current slug is parked; the user picks the first split slug to start, or \`/cc-cancel\` to discard.
2. \`accept-warns-and-ship\` — Treat every remaining open ledger row as a \`warn\` (only valid if no row is \`critical\` AND, per the architecture priors rule, no row is \`required + architecture\`; if either invariant fails, the option is greyed out and the picker explains why). Proceed to ship gate with the carry-over.
3. \`keep-iterating-anyway\` — Reset \`reviewCounter\` to \`3\`, buying two more rounds before the picker fires again. Stamp \`triage.iterationOverride: true\` (telemetry: a future "why did this flow take 7 review iterations?" audit can answer without re-reading the iteration log) and resume normal review-pause dispatch.

The picker is not skippable on autopilot; \`runMode: auto\` pauses here like any other hard gate.

## Cap-reached split-plan (T1-10)

When the 5th iteration ends without \`clear\` or \`warn\`, the review **does not just surface "residual blockers"**; the orchestrator (with the reviewer's help) authors a **split/handoff mini-plan** in the same review.md iteration block, under \`## Cap-reached recovery\`:

1. **Why we stopped** — one sentence: which findings persisted across iterations 4-5, what fix attempts converged or oscillated.
2. **Recommended split** — list of follow-up slugs the orchestrator should propose (\`<slug>-fix-A\`, \`<slug>-rearchitect-B\`, etc.) with one bullet per slug naming what AC / surface that slug would own. The split is the actionable path forward, not just a list of complaints.
3. **What ships now (if anything)** — a yes/no with reason. When AC-1..AC-K are clean and AC-K+1..AC-N are blocked, the recommendation is "ship AC-1..AC-K under the current slug, open \`<slug>-followup\` for the rest". When everything is entangled, the recommendation is "ship nothing under this slug; open \`<slug>-rearchitect\`".
4. **Handoff envelope** — for each recommended split slug, the input artifact references (\`flows/<slug>/plan.md#AC-3\`, \`flows/<slug>/review.md#F-7\`) the next slug should preload.

After this block is authored, the orchestrator surfaces a structured ask to the user with the split options (or "discard, re-triage from scratch"). \`/cc-cancel\` remains available as a typed command for nuking the slug.

## Architecture severity gates ship (v8.20+)

The reviewer prompt's "Architecture severity priors" rule names a stronger gate: an unresolved finding with \`severity=required\` AND \`axis=architecture\` **gates ship across every acMode** — not only in \`strict\`. The orchestrator enforces this at the ship gate (Hop 5): when the open ledger contains any \`required + architecture\` row, the ship picker does NOT offer \`continue\` until the user explicitly picks \`accept-warns-and-ship\` for the architecture finding(s). Other \`severity=required\` findings continue to follow the standard acMode table (gate in strict, carry-over in soft).

Concretely: when the reviewer's slim summary marks \`ship_gate: architecture\` (set whenever a \`required + architecture\` row is open), the ship picker's option list becomes \`accept-warns-and-ship\` (highlighted as the path past the architecture gate) / \`fix-only\` (re-dispatch slice-builder to address) / \`stay-paused\`. The \`continue\` (silent advance) option is not offered.
`;

const ADVERSARIAL_RERUN = `# On-demand runbook — adversarial pre-mortem rerun

Open this runbook **only at ship gate after a fix-only loop landed commits that touched lines previously flagged by an adversarial review**.

## Rerun trigger condition (computed at ship gate)

- The last adversarial iteration produced ≥1 finding with \`severity: required | critical\`, AND
- a fix-only loop has landed at least one commit since that adversarial run, AND
- the diff of those fix-only commits intersects the file:line set named in the prior adversarial findings.

## Why this rerun matters

The principle: a fix to an adversarially-flagged hot path is itself a hot-path change, and the original adversarial pass cannot have foreseen the fix. The marginal value of "re-look at the fix" exceeds the cost of one more adversarial pass when (and only when) the fix lands on a previously-flagged hot path.

## Behaviour when the trigger fires

When the trigger fires, the ship-gate parallel fan-out includes \`reviewer mode=adversarial\` again (alongside release + security if applicable). When it does not fire, adversarial runs once per slug as before.

Record the rerun reason in \`review.md\`: \`Adversarial reran because fix-only commits <SHA1>, <SHA2> touched lines previously flagged in F-3 and F-7\`.

## Limits

- The rerun runs **once per ship attempt**, not iteratively. If the rerun itself produces \`block\`-level findings, the orchestrator dispatches \`slice-builder\` mode=\`fix-only\` and re-runs the **regular** reviewer (mode=\`code\`) to confirm the fix; the adversarial pass does not rerun again unless the user explicitly requests it.
- In \`soft\` mode the adversarial pass (and its rerun) are skipped by default — the lighter-weight regular reviewer is enough for small/medium work. The user can opt in with \`/cc <task> --adversarial\` if they want the extra sweep regardless.
`;

const SELF_REVIEW_GATE = `# On-demand runbook — self-review gate (mandatory before reviewer dispatch)

Open this runbook **after every slice-builder return, before deciding whether to dispatch the reviewer**. Cheap to run (you already have the JSON in context) and saves one full reviewer cycle per failed attestation.

## What slice-builder returns

slice-builder's strict-mode JSON summary returns a \`self_review\` array with five rule attestations per AC: \`tests-fail-then-pass\`, \`build-clean\`, \`no-shims\`, \`touch-surface-respected\`, \`coverage-assessed\`. (Soft mode: one block per rule with \`ac: "feature"\`.) Each entry carries \`verified: true|false\` and a non-empty \`evidence\` string.

Before you dispatch the reviewer, **inspect \`self_review\`** in your own context. The reviewer never sees this field; it is your gate.

## Decision rule

- **All entries \`verified: true\` AND \`evidence\` non-empty** → dispatch reviewer normally.
- **Any \`verified: false\`** OR **any empty/missing \`evidence\`** OR **\`self_review\` array missing entirely** → **bounce the slice straight back to slice-builder with mode=fix-only**, citing the failed rule(s) and the slice-builder's own evidence string in the dispatch envelope. Do NOT dispatch reviewer.

## Fix-only bounce envelope

The fix-only bounce envelope reuses the slice-builder dispatch envelope shape; the "Inputs" line names the failed rules instead of a Concern Ledger fix list:

\`\`\`
Dispatch slice-builder
─ Stage: build (self-review fix-only)
─ Slug: <slug>
─ AC: <AC-N> (the AC whose self_review failed)
─ Failed rules: <one line per failed rule, copying the slice-builder's own evidence>
─ Output: .cclaw/flows/<slug>/build.md (append a "Self-review fix" iteration block above the existing Summary)
─ Then: re-emit the strict-mode JSON summary with self_review[] re-attested
\`\`\`

## Escalation on repeated failures

Repeated self-review failures (third bounce) escalate to user: render the failed evidence and ask whether to continue or split the AC.

## Parallel-build behaviour

In parallel-build the gate runs **per slice**: a slice whose self-review fails bounces back; **healthy slices proceed** to integration review independently. Do not block a clean slice waiting on a sibling's fix-only loop.
`;

const SHIP_GATE = `# On-demand runbook — ship gate (finalization + adversarial pre-mortem)

Open this runbook **only when the review stage is clear / warn and the next step is ship-stage dispatch**. The ship gate is where the orchestrator surfaces a structured ask to the user before any push / PR action.

## Ship-stage parallel fan-out

The ship stage uses **parallel fan-out + merge** (the canonical cclaw fan-out). Dispatch all specialists in the same message; merge their summaries in your context.

Specialists fanned out:

- \`reviewer\` mode=\`release\` — always.
- \`reviewer\` mode=\`adversarial\` — **strict mode only** (see below). Rerun rules in \`adversarial-rerun.md\`.
- \`security-reviewer\` mode=\`threat-model\` — when \`security_flag\` is true.

Inputs: \`.cclaw/flows/<slug>/plan.md\`, build.md, review.md.

**Shared diff context (single parse pass).** Before the parallel dispatch, run \`git diff --stat <plan-base>..HEAD\` and \`git diff --name-only <plan-base>..HEAD\` once in the orchestrator's context. Pass the parsed shape (touched files list, additions/deletions per file, total LOC delta) to **every** parallel reviewer in the dispatch envelope under a \`Shared diff:\` block. Each reviewer reads its own filtered subset (release-mode reads everything; adversarial-mode skims for hot paths; security-reviewer prioritises files matching sensitive patterns). This avoids three independent \`git diff\` calls and three independent file-list parses — savings: 1-2 seconds per ship + ~1-2K tokens × 3 (diff parse boilerplate). The reviewers still independently \`git show <SHA>\` per finding to read commit-level context; only the aggregated diff shape is shared.

Output: \`.cclaw/flows/<slug>/ship.md\` with the go/no-go decision, AC↔commit map (strict) or condition checklist (soft), release notes, and rollback plan. As of v8.12 the adversarial reviewer's pre-mortem section is appended to \`review.md\` (no separate \`pre-mortem.md\` file unless \`legacy-artifacts: true\`).

After ship, run the compound learning gate (Hop 5).

## Ship-gate user ask (finalization mode)

When the ship gate is passed (Victory Detector green) and finalization is required, the orchestrator surfaces a structured ask to the user. The options are the five \`finalization_mode\` enum values; **\`Cancel\` is NOT one of them**. \`/cc-cancel\` remains the explicit user-typed command for discarding a flow; structured asks for finalization MUST NOT include a "Cancel" row, because choosing "Cancel" mid-finalization leaves shipped artefacts in a half-moved state with no defined recovery.

\`\`\`
askUserQuestion(
  prompt: <one sentence in the user's language stating: ship gate passed, choose how to finalize the slug, list expected behaviour for git mode (or "no-vcs detected" for the no-vcs path)>,
  options: [
    <option label conveying: merge into base branch locally, verify clean merge, record the merged SHA>,
    <option label conveying: open a PR with structured body (gh pr create), record the URL>,
    <option label conveying: push the branch upstream and stop (git push -u origin HEAD), keep open for later review>,
    <option label conveying: discard the branch locally — requires typed confirmation in the next turn>,
    <option label conveying: no VCS available, record a manual handoff target and rollback owner>
  ],
  multiSelect: false
)
\`\`\`

If the user wants to abandon the flow at this point, they type \`/cc-cancel\` (out-of-band of the structured ask). The orchestrator does not pre-offer that as a clickable option, because:
1. The flow has already passed code-mode review + adversarial pre-mortem; cancelling here is unusual.
2. The shipped artefacts may have already been partially written (manifest-as-frontmatter, learnings.md); cancelling mid-finalize requires a different recovery path than \`/cc-cancel\` from earlier stages.

## Adversarial pre-mortem (strict mode only)

Before the ship gate finalises, the orchestrator dispatches \`reviewer\` mode=\`adversarial\` against the diff produced for this slug. The adversarial reviewer's specific job is to **think like the failure**: how would this break in production a week from now?

As of v8.12, the adversarial sweep appends a \`## Pre-mortem (adversarial)\` section to the same \`flows/<slug>/review.md\`, not a separate file. (Users on \`legacy-artifacts: true\` still get a separate \`pre-mortem.md\` for tooling compat.) The adversarial reviewer treats the pre-mortem as a **scenario exercise** — reasoning backwards from "this shipped and failed, what was it" — and explicitly does NOT write a literal future date in the artefact body. See \`reviewer.ts\` Adversarial mode for the full schema.

Failure classes the adversarial pass MUST consider (mark each as "covered" / "not covered" / "n/a"):

- **data-loss** — write paths that could lose user data on rollback or partial failure;
- **race** — concurrent operations on shared state without locking / ordering guarantees;
- **regression** — prior-shipped behaviour an existing test does not pin;
- **rollback impossibility** — schema migration / persisted state shape that cannot be reverted;
- **accidental scope** — diff touches files no AC mentions;
- **security-edge** — auth bypass, injection, leaked secret in logs, untrusted input.

The adversarial reviewer treats every "not covered" as a finding (axis varies; severity \`required\` by default, escalated to \`critical\` for data-loss / security-edge). Findings go into the existing Concern Ledger in \`review.md\`; the same file gets a \`## Pre-mortem (adversarial)\` section summarising the adversarial pass's reasoning so the user can read a one-page rationale. (On \`legacy-artifacts: true\` the section is mirrored into a standalone \`pre-mortem.md\` for downstream tooling.)

## Ship-gate decision matrix

| reviewer:release | reviewer:adversarial | security-reviewer | gate |
| --- | --- | --- | --- |
| clear | clear | clear | clear → ship may proceed |
| clear | block | any | block → fix-only loop or user override |
| any | any | block | block → fix-only loop |
| clear | warn | clear | warn → render adversarial findings, ask user |

The adversarial pass runs **once per ship attempt**, not iteratively. If it produces \`block\`-level findings, the orchestrator dispatches \`slice-builder\` mode=\`fix-only\` and re-runs the **regular** reviewer (mode=\`code\`) to confirm the fix; the adversarial pass does not re-run unless the user explicitly requests it (the marginal value drops fast on second run). For the conditional rerun rule on fix-only hot-path commits, see \`adversarial-rerun.md\`.

In \`soft\` mode the adversarial pass is **skipped** by default — the lighter-weight regular reviewer is enough for small/medium work. The user can opt in with \`/cc <task> --adversarial\` if they want the extra sweep regardless.
`;

const HANDOFF_ARTIFACTS = `# On-demand runbook — handoff artifacts (HANDOFF.json + .continue-here.md)

Open this runbook **after every stage exit** — both at the end of plan / build / review / ship and at every design Phase 7 sign-off (which closes the discovery sub-phase under \`plan\`). Design's internal Phase 0-6 pauses are conversation-only and do NOT trigger a handoff rewrite (those are mid-turn, mid-dialog states inside the same orchestrator context; HANDOFF.json is for resume-across-sessions checkpoints).

## Why two files

\`HANDOFF.json\` is what the orchestrator's resume hop reads to rebuild dispatch context; \`.continue-here.md\` is what the user reads to remember what they were doing — possibly days later when they reopen a stale flow. The dot-prefix on \`.continue-here.md\` keeps it out of casual file-listing noise but keeps it readable when the user grep's for "continue".

## HANDOFF.json schema

\`\`\`json
{
  "slug": "<slug>",
  "stage_completed": "plan | build | review | ship | discovery-design",
  "stage_started_at": "<iso>",
  "stage_completed_at": "<iso>",
  "next_stage": "build | review | ship | done | discovery-ac-author",
  "next_specialist": "<id> | null",
  "open_findings": <count>,
  "review_iterations": <count>,
  "feasibility_stamp": "green | yellow | red | null",
  "ci_smoke_passed": <boolean | null>,
  "release_notes_filled": <boolean | null>,
  "security_flag": <boolean>,
  "blocked_by": <"low-confidence" | "review-pause" | "cap-reached" | "user-decline" | null>,
  "resume_command": "/cc",
  "resume_envelope": {
    "required_first_read": ".cclaw/lib/agents/<next_specialist>.md",
    "required_second_read": ".cclaw/lib/skills/<next_wrapper>.md",
    "inputs": [".cclaw/state/flow-state.json", ".cclaw/flows/<slug>/<next_stage>.md", "..."]
  }
}
\`\`\`

## .continue-here.md shape (rendered in user's conversation language)

\`\`\`markdown
# Continue here — <slug>

**Stage just completed:** <stage> (<one-sentence verdict in user's language>)
**Where we are:** <one-sentence summary of the slug's current state — AC count, review iterations, open findings>
**What's next:** <one-sentence description of the next stage in user's language>
**To resume:** \`/cc\`  (or \`/cc-cancel\` to discard the slug)

## Open questions or pauses
- <bullet per pending decision the user must make; empty when none>

## Recent activity
- <last 3-5 specialist returns in chronological order, each as one short bullet>
\`\`\`

## Lifecycle

- Each stage exit (or discovery checkpoint) **rewrites both files from scratch** — they are idempotent snapshots, not appended logs. Stale data is the v8.11-era ship.md bug applied to handoff state; the fix is "always re-author".
- \`runCompoundAndShip\` moves both files into \`shipped/<slug>/\` alongside the canonical 7 stages (the T0-10 directory scan handles them automatically). Shipped flows preserve their final HANDOFF.json + .continue-here.md as a record of how the slug ended.
- \`/cc-cancel\` moves both into \`cancelled/<slug>/\`.
- The Hop 1 detect path may consult \`HANDOFF.json\` as a fallback when \`flow-state.json\` is missing or unparseable (v8.13 hardening: file may be deleted by accident, but HANDOFF.json snapshots can rebuild the resume context).

## When the orchestrator rewrites

When a sub-agent dispatch's slim-summary returns, the orchestrator: (1) patches \`flow-state.json\`; (2) re-renders both handoff files; (3) renders the slim summary in the conversation; (4) ends the turn. Step 2 is mandatory — skipping it leaves the next \`/cc\` invocation rebuilding context the wrong way.
`;

const COMPOUND_REFRESH = `# On-demand runbook — compound refresh + discoverability self-check

Open this runbook **after a compound capture writes a line to \`.cclaw/state/knowledge.jsonl\`**, when either:

- \`knowledge.jsonl\` line count is a multiple of 5 after the new line is appended (compound-refresh trigger), OR
- The user runs \`/cc-compound-refresh\` manually.

For the compound gate itself (does this slug capture learnings?), see start-command's Hop 5.

## Compound-refresh sub-step (T2-4, everyinc pattern; v8.13)

Every **5th** capture, the orchestrator runs a **knowledge-refresh** pass over the file. The point: append-only is durable but lossy on signal-to-noise — duplicates accumulate, superseded findings persist, and cross-cutting themes never get consolidated. The refresh applies five actions to the existing entries:

1. **dedup** — entries whose touchSurface + tags + learnings shape are near-identical (Jaccard ≥ 0.8 over the touchSurface union AND tags union AND verbatim-overlap of learnings). Keep the most recent entry, mark the others \`status: dedup-of <newer-slug>\`. The newer entry inherits the older entries' \`historicSlugs: []\` array so the lineage isn't lost.
2. **keep** — entry is unique, non-stale, still cited by at least one open antipattern reference. No change.
3. **update** — entry is unique but a later slug refined the lesson (different phrasing, sharper boundary). Patch the entry's \`learnings\` field with the newer phrasing; keep the older slug citation alongside the newer one. Mark \`refined_at: <iso>\`, \`refined_via_slug: <newer-slug>\`.
4. **consolidate** — 2+ entries on the same theme but different surfaces (e.g., 3 entries about "fix-only loops on auth flows that drifted in scope"). Merge into a single entry with a richer learnings paragraph and \`mergedFrom: [slug-list]\`. The merged entry's \`learnings\` is authored by the orchestrator (synthesis), not copy-paste.
5. **replace** — old entry is genuinely superseded (architecture changed, library replaced). Keep the old entry but mark \`status: superseded-by <newer-slug>\`; the search/scoring layer treats superseded entries as \`-2\` to keep them out of top-3 picks but still findable for archaeology.

The refresh runs **inline in the orchestrator's context** as the 5th capture finishes. Output: a new \`.cclaw/knowledge-refresh-<iso>.md\` log file (one block per action, citing slug ids) so the user can see what changed. Failures (file unparseable, IO error) write the log but skip the actions; the original \`knowledge.jsonl\` is unchanged.

## Trigger thresholds (configurable in \`.cclaw/config.yaml\`)

- \`compoundRefreshEvery: 5\` — run every Nth capture; default 5; set to \`0\` to disable.
- \`compoundRefreshFloor: 10\` — skip refresh until \`knowledge.jsonl\` has ≥10 lines (otherwise the refresh has nothing to dedup against).

Manual trigger: \`/cc-compound-refresh\` — runs the same pass on demand. Useful after large bulk-import of legacy slugs.

## Discoverability self-check (T2-12)

After ship completes (Hop 6 done), the orchestrator scans \`AGENTS.md\` / \`CLAUDE.md\` / \`README.md\` for any mention of \`knowledge.jsonl\` or \`flows/shipped/\`. When **none** of these files mention either path, the orchestrator surfaces a one-line note in the user's language ("This project's knowledge.jsonl now has N entries but the AGENTS.md / CLAUDE.md / README.md don't reference it. Want me to add a 1-line discovery note so future agents know it exists? [add / skip-this-time / never]"). The user picks; on \`add\`, the orchestrator appends a single line to the most appropriate root file (preferring AGENTS.md, then CLAUDE.md, then README.md):

\`\`\`markdown
- \`.cclaw/knowledge.jsonl\` — append-only learnings catalogue from cclaw flows; cclaw specialists read this before authoring plans (\`learnings-research\` helper).
\`\`\`

This makes the catalogue discoverable to future agents/humans who don't already know cclaw's conventions. Without the note, a fresh contributor (or a different harness's bootstrap) won't know it exists.

The discoverability check runs **once per slug** (only when ship completes), and respects the user's \`never\` choice for the rest of the session.
`;

const DISCOVERY = `# On-demand runbook — discovery sub-phase (large-risky plan stage)

Open this runbook **only when \`triage.complexity == "large-risky"\` and the path includes \`plan\`**. For small/medium plan, see start-command's "Plan stage on small/medium".

The discovery sub-phase runs a **two-step** chain: \`design\` (main context, multi-turn) → \`ac-author\` (sub-agent). \`currentStage\` stays \`"plan"\` for both; \`lastSpecialist\` rotates through \`design\` then \`ac-author\`.

## v8.14 collapse context

Pre-v8.14 ran a three-step \`brainstormer → architect → ac-author\` chain of one-shot sub-agents, with a checkpoint-question between each. That ceremony was thin — the brainstormer's "Frame" and the architect's "decisions" both came from one shot of the model with no user dialog. v8.14 replaces the first two steps with a **single \`design\` specialist that runs in main context** across seven multi-turn phases (Bootstrap, Clarify, Frame, Approaches, Decisions inline, Pre-mortem, Compose, Sign-off), so framing and structural decisions emerge from a real user-collaborative pass instead of two short summaries.

## Discovery auto-skip (low-ambiguity fast path)

Before activating \`design\`, run the **discovery-needed heuristic** against the triage and pre-flight state. Skip directly to \`ac-author\` (single dispatch, no design phase) when **all** of the following hold:

1. \`triage.confidence\` is \`high\` (the heuristic produced an unambiguous large-risky classification).
2. \`triage.assumptions\` is non-empty AND the user accepted them in pre-flight without edits (\`pre_flight_edits == 0\`).
3. The user's \`/cc <task>\` prompt names ≥1 concrete file path or module (i.e. the focus surface is already given, not yet to be discovered).
4. There is no security-sensitive keyword (\`auth\`, \`token\`, \`secret\`, \`oauth\`, \`saml\`, \`encryption\`, \`pii\`, \`gdpr\`, \`pci\`, \`hipaa\`, \`soc2\`) in the prompt **AND** \`security_flag\` is not preset by triage.

When all four hold, the orchestrator surfaces a one-sentence skip notice in the user's language ("Discovery skipped: triage is high-confidence and the surface is named — going straight to ac-author. Reply with \`/cc-cancel\` if you want a design pass instead.") and dispatches \`ac-author\` directly with the same envelope as small/medium plus \`fast_path: skipped-discovery\` in flow-state. \`lastSpecialist\` stays \`null\` until ac-author returns.

When **any** of the four fails, run the full two-step discovery as below.

The user can also bypass the heuristic explicitly with \`/cc <task> --discovery=force\` (always run the full design phase) or \`/cc <task> --discovery=skip\` (always skip, even if the heuristic would not have skipped — they take responsibility).

## Full two-step discovery (default; auto-skip declined or its conditions failed)

> **Discovery never auto-chains.** \`design\` runs in main context and pauses end-of-turn between each of its internal phases (Phase 0 through Phase 7) regardless of \`triage.runMode\`. \`auto\` runMode applies to the plan→build→review→ship transitions only, **not** inside the design phase. The ac-author dispatch that follows the design's Phase 7 sign-off is also a step-mode pause unless \`triage.runMode == auto\`.

1. **Activate \`design\` in main context** (read \`.cclaw/lib/agents/design.md\` as a skill the orchestrator itself follows; do NOT dispatch as a sub-agent).
   - The orchestrator picks the **posture** before activation: \`deep\` when any of (security-sensitive keyword, \`security_flag\` preset, irreversibility / migration / schema / breaking-change / data-loss / payment / gdpr / pci in the prompt, \`refines:\` points to a slug with \`security_flag: true\`); \`guided\` otherwise. The design prompt may escalate to \`deep\` mid-flight if Phase 3 surfaces irreversibility the orchestrator missed.
   - The orchestrator follows the design.md prompt phases 0-7 directly in this conversation. Each phase that emits user-facing output (Phase 1 Clarify, Phase 2 Frame, Phase 3 Approaches, Phase 4 Decisions one D-N per turn, Phase 5 Pre-mortem deep only, Phase 7 Sign-off) ends the turn with an \`askUserQuestion\` picker; Phase 0 (Bootstrap) and Phase 6 (Compose + self-review) are silent and flow directly into the next user-facing phase.
   - Output: appends Frame, optional Approaches + Selected Direction, optional Decisions section (D-1 … D-N inline), optional Pre-mortem, Not Doing, optional Open questions, and Summary — design block to \`flows/<slug>/plan.md\`. Optional \`docs/decisions/ADR-NNNN-<slug>.md\` files when Phase 6.5 fires. **No separate \`decisions.md\` is written; v8.14 inlined that file into the Decisions section of plan.md.**
   - On Phase 7 \`approve & proceed\`: orchestrator patches \`lastSpecialist: "design"\` and \`plan.md\` frontmatter (\`last_specialist: design\`, \`posture: <guided|deep>\`, \`decision_count: <N>\`) → **ends the turn**. The next \`/cc\` continues with ac-author.
   - On Phase 7 \`revise\` / \`save & cancel\`: orchestrator handles per the design prompt's instructions; it does not patch \`lastSpecialist\` until the user actually signs off.
2. **Dispatch \`ac-author\`** as a normal sub-agent with the same contract as small/medium plan, plus an extra input: the design sections already in \`flows/<slug>/plan.md\`.
   - AC author now writes the AC table (large-risky is always \`strict\` acMode by default), touch surfaces, parallel-build topology if it applies. The Frame / Approaches / Selected Direction / Decisions / Pre-mortem sections from design remain at the top of \`plan.md\`; ac-author appends its own sections below.
   - Orchestrator reads slim summary → patches \`lastSpecialist: "ac-author"\` AND advances \`currentStage\` to the next stage in \`triage.path\` (typically \`"build"\`). At this point the orchestrator follows \`triage.runMode\` for the plan→build transition: \`step\` ends the turn; \`auto\` chains immediately into the build dispatch.

Resume after a design or ac-author checkpoint: \`flow-state.lastSpecialist\` tells the orchestrator which discovery step to skip. If \`lastSpecialist == "design"\` and \`currentStage == "plan"\`, the resume dispatches \`ac-author\` directly. The user can also \`/cc <task> --skip-discovery\` to drop straight into a single ac-author dispatch when the design phase already happened in a prior session.

**Legacy migration:** state files written by pre-v8.14 cclaw with \`lastSpecialist: "brainstormer"\` or \`lastSpecialist: "architect"\` are rewritten to \`null\` on read; the orchestrator re-runs the unified design phase from scratch on those resumes. Shipped slugs with \`flows/shipped/<old-slug>/decisions.md\` keep that file untouched for historical reference.
`;

const PAUSE_RESUME = `# On-demand runbook — pause and resume mechanics (step / auto / Confidence gate)

The orchestrator opens this runbook on every stage exit when \`triage.path\` is **non-inline** (i.e., the path contains any of \`plan\` / \`review\` / \`ship\`, not just \`build\`). Inline / trivial paths set \`runMode: null\` and never pause — they skip Hop 4 entirely, so they never open this runbook.

The orchestrator body keeps the orchestrator-wide invariants (\`/cc\` is the only resume verb, end-of-turn is the pause mechanism in step, Confidence: low is a hard gate in both modes). The full mechanics — including the per-mode procedure, the hard-gate enumeration, the Confidence × mode table, and the resume-from-fresh-session rules — live here so the orchestrator body stays slim on inline and small-medium paths that don't need every detail loaded.

## \`step\` mode (default; safer; recommended for \`strict\` work)

After every dispatch returns: (1) render the slim summary; (2) re-author \`HANDOFF.json\` + \`.continue-here.md\` (see \`runbooks/handoff-artifacts.md\`); (3) state the next stage in plain language ("Plan is ready (5 testable conditions). Send \`/cc\` to continue with build."); (4) **End your turn** — do NOT call \`askUserQuestion\`, do NOT wait for a magic word; the pause IS the end of the turn; \`flow-state.json\` + \`HANDOFF.json\` carry the resume point.

This is cclaw's **single resume mechanism**. Mid-session and cross-session pauses both end the turn; \`/cc\` is the only verb that moves the flow forward. No "type continue" magic word; no clickable Continue button mid-turn.

If the user wants \`fix-only\` or \`show\` semantics, they say so in plain text on the next \`/cc\` and the orchestrator routes accordingly: "/cc fix-only" → slice-builder mode=fix-only against cited findings; "/cc show" → open the current-stage artifact and stop; otherwise → advance to the next stage.

## \`auto\` mode (autopilot; faster; recommended for \`inline\` / \`soft\` work)

After every dispatch returns: (1) render the slim summary; (2) immediately dispatch the next stage in \`triage.path\` — no waiting, no question — UNLESS inside the design phase (per-phase pauses fire regardless of runMode; see \`runbooks/discovery.md\`).

Stop unconditionally only on these **hard gates** (autopilot **always** asks here):

- \`reviewer\` returned \`block\` (open findings) → ask "dispatch fix-only" / "stay paused".
- \`security-reviewer\` raised any finding → same shape.
- \`reviewer\` returned \`cap-reached\` → see \`runbooks/cap-reached-recovery.md\`.
- A slim summary has \`Confidence: low\` → see "Confidence as a hard gate" below.
- About to run \`ship\` (last stage) → ask "Ship now?" once. Ship always confirms in autopilot.
- Inside the design phase — pauses managed by design.md.

Auto mode never silently skips a hard gate; it just removes the cosmetic pause between green non-discovery stages. \`Cancel\` is **never** a clickable option; \`Stay paused\` (end turn) is the always-present safe-out.

## Confidence as a hard gate (both modes)

Every slim summary carries a \`Confidence: high | medium | low\` line — a quality signal for the dispatch that just returned, not a prediction of the next stage:

| Confidence | step mode | auto mode |
| --- | --- | --- |
| \`high\` | normal pause; render summary, end the turn (\`/cc\` advances) | normal flow; chain to next stage |
| \`medium\` | normal pause; mention confidence in the user-facing line ("Plan ready (medium confidence — see Notes). Send \`/cc\` to continue."); end the turn. The \`Notes:\` line is required when confidence is medium | render the summary inline ("medium — see Notes"); chain anyway |
| \`low\` | hard gate. End the turn, surface \`Notes\` verbatim. User replies with \`/cc expand\` (re-dispatch with richer envelope), \`/cc show\` (open artifact), \`/cc override\` (acknowledge risk + advance), or \`/cc-cancel\` (nuke). | hard gate. Stop chaining. Ask: \`Expand <stage>\` / \`Show artifact\` / \`Override and continue\` / \`Stay paused\`. Only \`Override and continue\` resumes auto-chaining. |

A specialist returning \`Confidence: low\` MUST write a non-empty \`Notes:\` line explaining the dimension that drove confidence down (missing input, unverified citation, partial coverage). Repeated low-confidence on the same stage is a routing signal: re-triage with a richer path or split the slug rather than re-dispatching the same specialist. Override is sticky to **this stage only**.

## Common rules for both modes

Resume from a fresh session works because everything is on disk: \`flow-state.json\` has \`currentStage\`, \`triage\` (with \`runMode\`), \`flows/<slug>/*.md\` carries the artifacts. The next \`/cc\` invocation enters Hop 1 → detect → resume summary → continue from \`currentStage\` with the saved runMode.

Resuming a paused \`auto\` flow re-enters auto mode silently. Resuming a paused \`step\` flow renders the slim summary again and ends the turn (the same end-of-turn rule applies on resume). The user's next \`/cc\` continues.

\`/cc-cancel\` is the **only** way to discard an active flow; it is never offered as a clickable option in any structured question. The orchestrator surfaces it as plain prose ("send \`/cc-cancel\` to discard this flow") only when the user appears stuck — not as the default.
`;

const PLAN_SMALL_MEDIUM = `# On-demand runbook — plan stage on small/medium

The orchestrator opens this runbook when \`triage.complexity == "small-medium"\` AND \`plan\` is in \`triage.path\`. For large-risky plan, open \`discovery.md\` instead. For trivial / inline (\`triage.path == ["build"]\`) the plan stage is skipped entirely — this runbook is never opened on the inline path.

## Specialist + wrappers

- Specialist: \`ac-author\`.
- Wrapper skills: \`plan-authoring.md\` (always) + \`source-driven.md\` (framework-specific tasks; strict mode only by default — soft opts in).

## Pre-author research order (ac-author dispatches BEFORE writing the plan)

- \`learnings-research\` — **always**, on small/medium + large-risky. Reads \`.cclaw/knowledge.jsonl\`. Returns 0-3 prior lessons inline in slim-summary's \`Notes\` as \`lessons={...}\`; the ac-author copies verbatim quotes into \`plan.md\`'s \`## Prior lessons\` section. No separate \`research-learnings.md\` artifact unless \`legacy-artifacts: true\`.
- \`repo-research\` — **brownfield only** (manifest at repo root AND populated source root). Skipped on greenfield. Writes \`flows/<slug>/research-repo.md\`.

Both research helpers run as sub-agent dispatches with their own \`.cclaw/lib/agents/<id>.md\` contracts; they never become \`lastSpecialist\` and never appear in \`triage.path\`.

## Inputs (ac-author reads after the contract + wrappers)

- triage decision (with \`assumptions\` from triage.assumptions)
- the user's original \`/cc <task>\` prompt
- \`.cclaw/lib/templates/plan.md\`
- the \`learnings-research\` blob (returned inline in its slim-summary \`Notes\`)
- \`flows/<slug>/research-repo.md\` (when brownfield)
- \`.cclaw/knowledge.jsonl\` for cross-check (independent of the learnings-research blob)
- the matching shipped slug if the flow is refining one (\`triage.refines\` is set)

## Output

\`flows/<slug>/plan.md\` with:

- frontmatter \`status: active\`, \`slug\`, \`stage: plan\`, \`acMode\` (\`soft\` or \`strict\`), \`ac: [...]\` (id + status), \`last_specialist: ac-author\`, \`refines\` (if applicable), \`security_flag\`.
- \`## Assumptions\` section, **verbatim** from \`triage.assumptions\` — do not paraphrase.
- \`## Prior lessons\` section from the learnings-research blob, **verbatim** quotes (no summary).
- Body shape depends on acMode:
  - **soft-mode body** = a bullet list of testable conditions (3-7 items typical).
  - **strict-mode body** = an AC table with \`AC-N\`, verification line (test name / manual step / command), \`touchSurface\`, and \`parallelSafe\` per row; \`## Topology\` block with \`inline\` (default) or \`parallel-build\` (only when the topology gate from \`plan.md\` stage runbook §5 fires).

## Slim summary (ac-author → orchestrator)

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
`;

const CRITIC_STAGE = `# On-demand runbook — critic stage (Hop 4.5, v8.42+)

The orchestrator opens this runbook **on every transition from \`review\` to \`critic\`** and at every block-ship picker resolution. The critic is the v8.42 on-demand adversarial specialist that runs between the reviewer's final \`clear\` and the ship gate. It walks what is *missing* (gap analysis + pre-commitment predictions + goal-backward verification + AC self-audit + realist check + — in adversarial mode — assumption-violation / composition / cascade / abuse cases), rather than re-walking the reviewer's eight axes. The contract that drives the dispatch lives in \`.cclaw/lib/agents/critic.md\`; this runbook covers what the orchestrator does *around* the dispatch.

## acMode gating (Q1, no flag exposed)

| \`triage.acMode\` | does critic run? | mode | typical token budget |
| --- | --- | --- | --- |
| \`inline\` | **no — skipped** (\`triage.path\` never includes \`critic\` on inline) | — | 0 |
| \`soft\` | **yes** | \`gap\` (light) — predictions ≤3, §3 adversarial skipped, §5 goal-backward collapsed to one paragraph | 5-7k |
| \`strict\` | **yes** | \`gap\` (full) by default; auto-escalates to \`adversarial\` (\§3 emitted in full + per-D-N devil's-advocate sweep) when any §8 trigger fires | 10-15k (gap) / 12-18k (adversarial), hard cap 20k |

## Escalation triggers (§8, OR-conditions — any one fires escalation on \`acMode: strict\`)

1. **Architectural-tier change** — touchSurface includes ≥2 files marked \`tier: architectural\` in plan.md OR the build introduced one.
2. **Test-first + zero failing tests in build.md** — slug posture is \`test-first\` AND the TDD log shows zero \`RED\` rows (v8.42 Q5: narrow trigger, do NOT widen to "missing RED excerpt"; the difference matters — a slug with \`RED\` rows that lack a captured excerpt is a build.md audit-trail gap to be flagged, not a critic escalator).
3. **Large surface size** — \`git diff --stat\` reports ≥10 files OR ≥500 net lines changed since the plan committed.
4. **\`security_flag: true\`** OR security-reviewer ran during Hop 4.
5. **\`reviewIterations >= 4\`** — the slug needed near-cap iterations to converge; hidden complexity signal.

The orchestrator computes the trigger set deterministically from \`flow-state.json\` + \`plan.md\` frontmatter + \`build.md\` table + \`git diff --stat\` BEFORE dispatching critic. The dispatch envelope stamps the firing triggers verbatim so the prompt copies them into \`critic.md > frontmatter > escalation_triggers\`.

Mapping fired-triggers count to \`criticEscalation\`:

- \`acMode: soft\` AND exactly one trigger fired → \`light\` (still \`gap\` mode; one extra technique permitted).
- \`acMode: strict\` AND any trigger fired → \`full\` (\`adversarial\` mode; all four §3 techniques + devil's-advocate sweep).
- Otherwise → \`none\` (\`gap\` mode unchanged).

## Cap & rerun rules

- **Hard cap: 1 critic re-run per slug.** \`criticIteration\` starts at 1 on the first dispatch, increments to 2 on a rerun, and would refuse a third — surfacing the critic-cap-reached picker (same shape as the v8.20 5-iteration reviewer cap).
- **Re-run trigger:** ONLY when the user picks \`[1] fix and re-review\` at the block-ship picker. The orchestrator re-dispatches \`slice-builder\` in \`fix-only\` mode, re-runs \`reviewer\` (this DOES increment \`reviewIterations\` — the v8.20 cap still applies), then re-runs \`critic\` (increments \`criticIteration\`).
- **Independence:** critic dispatches do NOT increment \`reviewIterations\`. The two counters are independent; the critic-cap-reached picker fires only on a third critic dispatch, even if the reviewer-cap is far from reached.

## Verdict handling (slim summary → orchestrator routing)

| critic \`Verdict:\` | \`currentStage\` after | \`triage.runMode\` behaviour | what the orchestrator does |
| --- | --- | --- | --- |
| \`pass\` | \`"ship"\` | step pauses end-of-stage; auto chains to Hop 5 | no user gate; advance straight to ship |
| \`iterate\` | \`"ship"\` | step pauses end-of-stage; auto chains to Hop 5 | open critic gaps with severity \`iterate\` are copied verbatim into \`ship.md > ## Risks carried over\`; one line to the user ("Critic returned iterate (\<N\> gaps carried over). Continuing to ship.") |
| \`block-ship\` | stays \`"critic"\` | both modes hard-gate | surface the block-ship picker: \`[1] fix and re-review\` (consumes the one allowed rerun), \`[2] accept-and-ship\` (strict-mode escape hatch; stamps \`triage.criticOverride: true\` for audit trail), \`[3] /cc-cancel\` (out-of-band). Single-line summary cites the \`block-ship\` G-N / F-N anchors verbatim. |

**Confidence: low** in the critic's slim summary is a hard gate in both \`step\` and \`auto\` modes (same rule as every other specialist). The critic MUST write a non-empty \`Notes:\` line when Confidence is not \`high\`; the orchestrator offers \`Expand critic\` / \`Show artifact\` / \`Override and continue\` / \`Stay paused\` per the standard Hop 4 invariants.

## FlowState patches

**Immediately before dispatching critic:**

\`\`\`json
{
  "currentStage": "critic",
  "lastSpecialist": null
}
\`\`\`

**After critic returns slim summary (orchestrator has read it, BEFORE user-gate decision):**

\`\`\`json
{
  "currentStage": "critic",
  "lastSpecialist": "critic",
  "criticIteration": 1,
  "criticVerdict": "pass | iterate | block-ship",
  "criticGapsCount": <integer; open gaps with severity != fyi>,
  "criticEscalation": "none | light | full"
}
\`\`\`

**After ship begins (user approved continue or auto-chain fired):** \`currentStage\` advances to \`"ship"\`. The critic fields stay; they are immutable for the rest of the flow.

## Q4 dogfood — when this is the v8.42 implementation slug

The v8.42 slug introduces the critic itself. The acceptance criterion (Q4) is that *this* slug runs through *its own* critic stage during review. If the critic returns \`block-ship\` on its own implementation, the orchestrator records the block-ship reason in \`learnings.md\` and the user invokes \`[2] accept-and-ship\` (manual override; \`triage.criticOverride: true\`). The override is documented in the slug's PR body under \`## Critic self-dogfood findings\` per the v8.42 process checklist. This is a one-time bootstrap exception — every subsequent slug treats \`block-ship\` as a hard gate by default.

## Legacy migration (pre-v8.42 \`flow-state.json\`)

A state file with \`currentStage: "review"\` AND \`lastSpecialist: "reviewer"\` AND no \`criticVerdict\` field is treated as **pre-critic intermediate**:

- If the slug directory is \`flows/<slug>/\` (still active, not yet shipped): on the next \`/cc\`, the orchestrator emits the one-line migration note (\`Legacy state (pre-v8.42) detected; the critic stage will run on next /cc.\`) and dispatches critic before advancing to ship.
- If the slug directory is \`flows/shipped/<slug>/\` (post-v8.41 ship already completed): the state is left alone. The shipped artifact set is immutable; the orchestrator does NOT retroactively run critic on a shipped slug.

The migration is one-pass and idempotent — a slug whose critic has already run shows \`criticVerdict\` set, so the legacy branch is never re-entered.

## What the critic CANNOT do (read this before authoring the envelope)

- Edit any source file (\`src/**\`, \`tests/**\`, \`.cclaw/state/**\`) or the body of \`plan.md\` / \`build.md\` / \`review.md\`.
- Commit, push, rebase, or merge. The critic owns no git operations.
- Dispatch other specialists. Composition is the orchestrator's job.
- Exceed 20k input+output tokens. Approaching the cap is itself a finding (\`Confidence: low\`, recommend split).
- Re-walk the reviewer's eight axes. The critic reads \`review.md > ## Concern Ledger\` as already-walked context and spends its budget on the *delta* (predictions / gaps / goal-backward / adversarial).

The only file the critic writes is \`.cclaw/flows/<slug>/critic.md\` (single-shot per dispatch; a rerun overwrites in place — no append-only ledger, see v8.42 Q2).
`;

export const ON_DEMAND_RUNBOOKS: OnDemandRunbook[] = [
  {
    id: "dispatch-envelope",
    fileName: "dispatch-envelope.md",
    title: "Dispatch envelope shape",
    body: DISPATCH_ENVELOPE
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    title: "Parallel-build fan-out",
    body: PARALLEL_BUILD
  },
  {
    id: "finalize",
    fileName: "finalize.md",
    title: "Hop 6 finalize",
    body: FINALIZE
  },
  {
    id: "cap-reached-recovery",
    fileName: "cap-reached-recovery.md",
    title: "Cap-reached recovery",
    body: CAP_REACHED_RECOVERY
  },
  {
    id: "adversarial-rerun",
    fileName: "adversarial-rerun.md",
    title: "Adversarial pre-mortem rerun",
    body: ADVERSARIAL_RERUN
  },
  {
    id: "self-review-gate",
    fileName: "self-review-gate.md",
    title: "Self-review gate",
    body: SELF_REVIEW_GATE
  },
  {
    id: "ship-gate",
    fileName: "ship-gate.md",
    title: "Ship gate + adversarial pre-mortem",
    body: SHIP_GATE
  },
  {
    id: "handoff-artifacts",
    fileName: "handoff-artifacts.md",
    title: "Handoff artifacts (HANDOFF.json + .continue-here.md)",
    body: HANDOFF_ARTIFACTS
  },
  {
    id: "compound-refresh",
    fileName: "compound-refresh.md",
    title: "Compound refresh + discoverability self-check",
    body: COMPOUND_REFRESH
  },
  {
    id: "discovery",
    fileName: "discovery.md",
    title: "Discovery sub-phase (large-risky plan)",
    body: DISCOVERY
  },
  {
    id: "pause-resume",
    fileName: "pause-resume.md",
    title: "Pause / resume mechanics (step / auto / Confidence gate)",
    body: PAUSE_RESUME
  },
  {
    id: "plan-small-medium",
    fileName: "plan-small-medium.md",
    title: "Plan stage on small/medium",
    body: PLAN_SMALL_MEDIUM
  },
  {
    id: "critic-stage",
    fileName: "critic-stage.md",
    title: "Critic stage (Hop 4.5, v8.42+)",
    body: CRITIC_STAGE
  }
];

export const ON_DEMAND_RUNBOOKS_INDEX_SECTION = `## On-demand runbooks (v8.22)

These runbooks are opened only when the orchestrator hits a specific trigger (a dispatch, a parallel-build, a cap-reached review, etc.). The full \`/cc\` body keeps short pointers to each; the body lives here so the prompt budget stays under control.

| trigger | runbook |
| --- | --- |
${ON_DEMAND_RUNBOOKS.map((r) => `| ${r.title} | [\`${r.fileName}\`](./${r.fileName}) |`).join("\n")}
`;
