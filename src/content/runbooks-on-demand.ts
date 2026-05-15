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
─ Ceremony mode: <inline | soft | strict>
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

Open this runbook only when the ac-author artifact declares \`topology: parallel-build\` with ≥2 slices AND \`ceremonyMode == strict\`. For sequential build, see \`.cclaw/lib/runbooks/build.md\`.

## Trigger

When the ac-author artifact declares \`topology: parallel-build\` with ≥2 slices and \`ceremonyMode == strict\`, the orchestrator fans out one \`slice-builder\` sub-agent per slice, **capped at 5**, each in its own \`git worktree\`. This is the only fan-out cclaw uses outside of \`ship\`.

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
─ Ceremony mode: strict
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

const FINALIZE = `# On-demand runbook — finalize (ship → shipped)

Open this runbook **only after the compound step completes** and \`flows/<slug>/ship.md\` carries \`status: shipped\`. Finalize is the orchestrator's job, never a sub-agent's.

## Per-AC verified gate (precondition, shipped in v8.48)

Before running any of the steps below, run the per-criterion verified gate. The gate is the v8.48 precondition: finalize is refused when any AC failed verification, with no silent escape hatch.

### Gate procedure

1. Read \`flow-state.json > triage.ceremonyMode\`.
2. If \`ceremonyMode == "inline"\` — gate **skipped**; finalize may proceed (inline mode has no per-criterion tracking).
3. Otherwise, parse the \`AC verified:\` line from:
   - **strict mode** — the latest slice-builder slim summary (last \`build\` or \`fix-only\` cycle that returned \`continue\`) AND the latest reviewer slim summary. The reviewer's line takes precedence when the two disagree; reviewer's evidence is authoritative because slice-builder's attestation is self-reported.
   - **soft mode** — same two summaries, looking for the single \`feature=yes|no\` token.
4. Evaluate:
   - **All ACs (strict) or feature (soft) have \`=yes\`** → gate **passes**; proceed to Steps 1-8 below.
   - **Any AC has \`=no\`** OR **the \`AC verified:\` line is missing from either summary** → gate **fails**; orchestrator **refuses finalize** and surfaces a structured ask:

\`\`\`
Per-AC verification gate failed before finalize.

Unverified ACs from latest slim summaries:
- <list each AC-N with verified=no, with the source summary cited (slice-builder iteration N, reviewer iteration N)>
- <e.g. "AC-3 verified=no (slice-builder iter 2 — slim summary line 4); reviewer iter 1 confirmed: open F-2 required finding tied to AC-3">

Options:
[1] Bounce to slice-builder fix-only to close the unverified AC.
[2] Show the latest slim summaries.
[3] Stay paused — end the turn.
\`\`\`

The gate **never** auto-rescues — there is no \`accept-unverified-and-finalize\` option. The slug stays in active state until either every AC is \`=yes\` (gate passes naturally) or the user types \`/cc-cancel\` to discard the flow explicitly. The rationale: finalize moves artifacts into \`flows/shipped/<slug>/\` and resets \`flow-state.json\`; once finalized, the unverified AC is invisible to the next \`/cc\` run, and the slug-vs-shipped-AC drift becomes permanent.

### Edge cases

- **\`AC verified\` line missing from slice-builder summary** — treat as \`every AC = no\`. The slice-builder is required to emit the line from v8.48 onwards (see slice-builder prompt § Slim summary). Missing line is a fix-only bounce on the slice-builder itself — the orchestrator dispatches \`slice-builder mode=fix-only\` with a one-line note: "re-emit slim summary with v8.48 \`AC verified\` line".
- **\`AC verified\` line missing from reviewer summary** — same treatment; the reviewer is required to emit the line from v8.48 onwards. Bounce dispatches \`reviewer mode=code\` with a one-line note.
- **slice-builder says \`AC-N=yes\` but reviewer says \`AC-N=no\`** — reviewer wins. The reviewer's downgrade reflects evidence in the ledger; slice-builder's claim is self-reported and the gate respects the second opinion.
- **slice-builder says \`AC-N=no\` but reviewer says \`AC-N=yes\`** — slice-builder wins. The build couldn't verify itself; reviewer's \`yes\` is a process error (reviewer should have downgraded). Bounce to slice-builder fix-only to close AC-N legitimately, then re-review.
- **inline ACs intermixed with strict ACs** is structurally impossible — \`ceremonyMode\` is per-flow, not per-criterion. If you observe this in the wild, the flow-state is corrupted; surface and stop.

This gate ships at v8.48 and adds one network-free check to every finalize step. It exists because the older \`Open findings\` counter was too coarse — a slug could have \`Open findings: 0\` and still ship with an AC that was silently deferred ("AC-3 deferred — follow-up slug"). The per-criterion line forces the deferral to be explicit and forces the orchestrator to ask before letting the gap close silently.

## Steps (in order, in the orchestrator's own context)

1. **Pre-condition check.** \`flows/<slug>/ship.md\` exists with \`status: shipped\` (or equivalent gate). If the gate is \`block\`, do NOT finalise — stay paused. If the path was \`inline\` (trivial), there is nothing to finalise; skip finalize entirely. **Per-AC verified gate** (above) must have passed; if it has not, do NOT finalise.
2. **Create the shipped directory.** \`mkdir -p .cclaw/flows/shipped/<slug>\`. Idempotent: if the directory already exists (re-run, race), continue without error.
3. **Move every artifact.** Use \`git mv\` when the repo is a git workspace and the active flow files are tracked; otherwise plain \`mv\`. Move (do NOT copy) every file in \`flows/<slug>/\`:
   - \`plan.md\`
   - \`build.md\` (when present)
   - \`review.md\` (when present)
   - \`ship.md\`
   - \`decisions.md\` (when present — large-risky only, pre-v8.14 shipped flows)
   - \`learnings.md\` (when written by the compound step)
   - \`pre-mortem.md\` (only on \`legacy-artifacts: true\` — default v8.12 collapses pre-mortem into \`review.md\` as a section)
   - \`research-repo.md\` (when written by repo-research)
   - \`research-learnings.md\` (only on \`legacy-artifacts: true\` — default v8.12 keeps learnings inline in the ac-author's slim-summary)
   The word "copy" must not appear in the dispatch envelope or in your own actions. \`cp\` is forbidden here. The active directory must end up empty after the moves.
4. **Stamp the shipped frontmatter on \`ship.md\`.** As of v8.12, manifest.md is collapsed into \`ship.md\`'s frontmatter. Update \`ship.md\`'s frontmatter to include the final flow signals (snake_case keys per artefact-frontmatter convention): \`slug\`, \`shipped_at\`, \`ceremony_mode\`, \`complexity\`, \`security_flag\`, \`review_iterations\`, \`ac_count\`, \`finalization_mode\`. Body of \`ship.md\` keeps the AC↔commit map (strict) or condition checklist (soft); add an "## Artefact index" section listing the artefacts that ended up in the shipped dir (one bullet per file). Users on the opt-in \`legacy-artifacts: true\` config still get a separate \`manifest.md\` in addition.
5. **Post-condition check (mandatory).** \`flows/<slug>/\` (the active directory) must be empty. If it is not, you have made a mistake — list the residue, surface it to the user, do NOT continue. The most common cause is mistakenly using \`cp\` instead of \`git mv\`/\`mv\`. Once the active dir is empty, \`rmdir flows/<slug>\` to remove the now-empty directory.
6. **Promote ADRs (PROPOSED → ACCEPTED).** Scan \`flows/shipped/<slug>/plan.md\` (just moved in step 3; v8.14+ inlines D-N records there) and any legacy \`flows/shipped/<slug>/decisions.md\` (pre-v8.14 shipped flows) for \`ADR: docs/decisions/ADR-NNNN-<slug>.md (PROPOSED)\` lines. For each found ADR file, edit the frontmatter in place: \`status: PROPOSED\` → \`status: ACCEPTED\`; add \`accepted_at: <iso>\`; add \`accepted_in_slug: <slug>\`; add \`accepted_at_commit: <ship-commit-sha>\`. Commit each promotion with \`docs(adr-NNNN): promote to ACCEPTED via <slug>\`. Skip the entire step when no PROPOSED ADR was found. Do NOT promote ADRs the design phase did not propose for this slug. See \`.cclaw/lib/skills/documentation-and-adrs.md\` for the full lifecycle (including supersession bookkeeping for ADRs that supersede an earlier ACCEPTED one).
7. **Reset flow-state.** Write \`createInitialFlowState\` defaults to \`.cclaw/state/flow-state.json\` (\`currentSlug: null\`, \`currentStage: null\`, \`triage: null\`, \`ac: []\`, \`reviewIterations: 0\`, \`securityFlag: false\`, \`lastSpecialist: null\`). The shipped manifest is the durable record; flow-state is now a clean slot ready for the next \`/cc\`.
8. **Render the final summary** to the user: one block citing \`shipped/<slug>/ship.md\` (the file that now carries the manifest frontmatter — or \`shipped/<slug>/manifest.md\` on \`legacy-artifacts: true\`), the AC count, any captured learnings, and any ADR ids promoted to \`ACCEPTED\` in step 6.

## Hard rules

- **No "copy" anywhere.** Sub-agent dispatches do NOT mention copying. The orchestrator's own actions use \`git mv\` (preferred when the files are git-tracked) or \`mv\` (when not). \`cp\` is a bug.
- **No partial finalize.** If any \`mv\` fails (filesystem error, permission, lock), stop and surface the failure. Do not leave half the flow in shipped and half in active.
- **No re-entrant finalize on resume.** If \`flows/<slug>/\` is already empty when you reach finalize (a previous run finalised), check that \`shipped/<slug>/ship.md\` exists with \`status: shipped\` in its frontmatter; if it does, this slug is already shipped — reset flow-state and tell the user "already finalised in <iso>". Do NOT recreate the artefacts. (On \`legacy-artifacts: true\` you can also key off \`shipped/<slug>/manifest.md\`.)
`;

const CAP_REACHED_RECOVERY = `# On-demand runbook — cap-reached recovery (review iteration 5)

Open this runbook **only when \`flow-state.json > reviewCounter\` reaches 5** without convergence. For the standard review loop, see \`.cclaw/lib/runbooks/review.md\`.

## Review-cap picker (v8.20+)

Track the cap with \`flow-state.json > reviewCounter\` (v8.20-introduced sibling of \`reviewIterations\`; \`reviewIterations\` continues to be the monotonic lifetime counter, \`reviewCounter\` is the cap-budget that the user can extend). Increment \`reviewCounter\` on every reviewer dispatch in parallel with \`reviewIterations\`. v8.19 flows resumed on v8.20 start at \`reviewCounter: 0\` even if \`reviewIterations\` already reflects prior dispatches — the cap is a fresh budget on resume.

**When \`reviewCounter\` reaches \`5\`**, do NOT dispatch another reviewer. Surface a structured \`AskQuestion\` picker with these options and stop:

1. \`cancel-and-replan\` — Apply the cap-reached split-plan below: orchestrator authors the recommended split into \`review.md\` and asks the user to confirm the follow-up slug names. The current slug is parked; the user picks the first split slug to start, or \`/cc-cancel\` to discard.
2. \`accept-warns-and-ship\` — Treat every remaining open ledger row as a \`warn\` (only valid if no row is \`critical\` AND, per the architecture priors rule, no row is \`required + architecture\`; if either invariant fails, the option is greyed out and the picker explains why). Proceed to ship gate with the carry-over.
3. \`keep-iterating-anyway\` — Reset \`reviewCounter\` to \`3\`, buying two more rounds before the picker fires again. Append a v8.44 audit-log entry to \`.cclaw/state/triage-audit.jsonl\` with \`iterationOverride: true\` (telemetry: a future "why did this flow take 7 review iterations?" audit can answer without re-reading the iteration log; the entry lives in the audit log instead of \`triage.iterationOverride\` so routing state stays clean) and resume normal review-pause dispatch.

The picker is not skippable on autopilot; \`runMode: auto\` pauses here like any other hard gate.

## Cap-reached split-plan (T1-10)

When the 5th iteration ends without \`clear\` or \`warn\`, the review **does not just surface "residual blockers"**; the orchestrator (with the reviewer's help) authors a **split/handoff mini-plan** in the same review.md iteration block, under \`## Cap-reached recovery\`:

1. **Why we stopped** — one sentence: which findings persisted across iterations 4-5, what fix attempts converged or oscillated.
2. **Recommended split** — list of follow-up slugs the orchestrator should propose (\`<slug>-fix-A\`, \`<slug>-rearchitect-B\`, etc.) with one bullet per slug naming what AC / surface that slug would own. The split is the actionable path forward, not just a list of complaints.
3. **What ships now (if anything)** — a yes/no with reason. When AC-1..AC-K are clean and AC-K+1..AC-N are blocked, the recommendation is "ship AC-1..AC-K under the current slug, open \`<slug>-followup\` for the rest". When everything is entangled, the recommendation is "ship nothing under this slug; open \`<slug>-rearchitect\`".
4. **Handoff envelope** — for each recommended split slug, the input artifact references (\`flows/<slug>/plan.md#AC-3\`, \`flows/<slug>/review.md#F-7\`) the next slug should preload.

After this block is authored, the orchestrator surfaces a structured ask to the user with the split options (or "discard, re-triage from scratch"). \`/cc-cancel\` remains available as a typed command for nuking the slug.

## Architecture severity gates ship (v8.20+)

The reviewer prompt's "Architecture severity priors" rule names a stronger gate: an unresolved finding with \`severity=required\` AND \`axis=architecture\` **gates ship across every ceremonyMode** — not only in \`strict\`. The orchestrator enforces this at the ship gate: when the open ledger contains any \`required + architecture\` row, the ship picker does NOT offer \`continue\` until the user explicitly picks \`accept-warns-and-ship\` for the architecture finding(s). Other \`severity=required\` findings continue to follow the standard ceremonyMode table (gate in strict, carry-over in soft).

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

const HANDOFF_GATES = `# On-demand runbook — handoff gates (self-review before reviewer, ship before push)

Open this runbook on **two** pre-handoff inspections:

- After every slice-builder return, **before deciding whether to dispatch the reviewer** (see \`## Pre-reviewer dispatch gate (self-review)\` below). Cheap to run (you already have the JSON in context) and saves one full reviewer cycle per failed attestation.
- After the review stage is clear / warn, **before any push / PR action** (see \`## Pre-ship dispatch gate (ship-gate)\` below). The ship gate is where the orchestrator surfaces a structured ask to the user.

Both surfaces share a pre-handoff inspection shape: read the latest slim summary or ledger, evaluate a deterministic rule, and either advance or bounce. The two sections below carry the per-gate procedure.

## Pre-reviewer dispatch gate (self-review)

### What slice-builder returns

slice-builder's strict-mode JSON summary returns a \`self_review\` array with five rule attestations per AC: \`tests-fail-then-pass\`, \`build-clean\`, \`no-shims\`, \`touch-surface-respected\`, \`coverage-assessed\`. (Soft mode: one block per rule with \`ac: "feature"\`.) Each entry carries \`verified: true|false\` and a non-empty \`evidence\` string.

Before you dispatch the reviewer, **inspect \`self_review\`** in your own context. The reviewer never sees this field; it is your gate.

### Decision rule

- **All entries \`verified: true\` AND \`evidence\` non-empty** → dispatch reviewer normally.
- **Any \`verified: false\`** OR **any empty/missing \`evidence\`** OR **\`self_review\` array missing entirely** → **bounce the slice straight back to slice-builder with mode=fix-only**, citing the failed rule(s) and the slice-builder's own evidence string in the dispatch envelope. Do NOT dispatch reviewer.

### Fix-only bounce envelope

The fix-only bounce envelope reuses the slice-builder dispatch envelope shape; the "Inputs" line names the failed rules instead of a Findings fix list:

\`\`\`
Dispatch slice-builder
─ Stage: build (self-review fix-only)
─ Slug: <slug>
─ AC: <AC-N> (the AC whose self_review failed)
─ Failed rules: <one line per failed rule, copying the slice-builder's own evidence>
─ Output: .cclaw/flows/<slug>/build.md (append a "Self-review fix" iteration block above the existing Summary)
─ Then: re-emit the strict-mode JSON summary with self_review[] re-attested
\`\`\`

### Escalation on repeated failures

Repeated self-review failures (third bounce) escalate to user: render the failed evidence and ask whether to continue or split the AC.

### Parallel-build behaviour

In parallel-build the gate runs **per slice**: a slice whose self-review fails bounces back; **healthy slices proceed** to integration review independently. Do not block a clean slice waiting on a sibling's fix-only loop.

## Pre-ship dispatch gate (ship-gate)

### Ship-stage parallel fan-out

The ship stage uses **parallel fan-out + merge** (the canonical cclaw fan-out). Dispatch all specialists in the same message; merge their summaries in your context.

Specialists fanned out:

- \`reviewer\` mode=\`release\` — always.
- \`reviewer\` mode=\`adversarial\` — **strict mode only** (see below). Rerun rules in \`adversarial-rerun.md\`.
- \`security-reviewer\` mode=\`threat-model\` — when \`security_flag\` is true.

Inputs: \`.cclaw/flows/<slug>/plan.md\`, build.md, review.md.

**Shared diff context (single parse pass).** Before the parallel dispatch, run \`git diff --stat <plan-base>..HEAD\` and \`git diff --name-only <plan-base>..HEAD\` once in the orchestrator's context. Pass the parsed shape (touched files list, additions/deletions per file, total LOC delta) to **every** parallel reviewer in the dispatch envelope under a \`Shared diff:\` block. Each reviewer reads its own filtered subset (release-mode reads everything; adversarial-mode skims for hot paths; security-reviewer prioritises files matching sensitive patterns). This avoids three independent \`git diff\` calls and three independent file-list parses — savings: 1-2 seconds per ship + ~1-2K tokens × 3 (diff parse boilerplate). The reviewers still independently \`git show <SHA>\` per finding to read commit-level context; only the aggregated diff shape is shared.

Output: \`.cclaw/flows/<slug>/ship.md\` with the go/no-go decision, AC↔commit map (strict) or condition checklist (soft), release notes, and rollback plan. As of v8.12 the adversarial reviewer's pre-mortem section is appended to \`review.md\` (no separate \`pre-mortem.md\` file unless \`legacy-artifacts: true\`).

After ship, run the compound learning gate.

### Ship-gate user ask (finalization mode)

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

### Adversarial pre-mortem (strict mode only)

Before the ship gate finalises, the orchestrator dispatches \`reviewer\` mode=\`adversarial\` against the diff produced for this slug. The adversarial reviewer's specific job is to **think like the failure**: how would this break in production a week from now?

As of v8.12, the adversarial sweep appends a \`## Pre-mortem (adversarial)\` section to the same \`flows/<slug>/review.md\`, not a separate file. (Users on \`legacy-artifacts: true\` still get a separate \`pre-mortem.md\` for tooling compat.) The adversarial reviewer treats the pre-mortem as a **scenario exercise** — reasoning backwards from "this shipped and failed, what was it" — and explicitly does NOT write a literal future date in the artefact body. See \`reviewer.ts\` Adversarial mode for the full schema.

Failure classes the adversarial pass MUST consider (mark each as "covered" / "not covered" / "n/a"):

- **data-loss** — write paths that could lose user data on rollback or partial failure;
- **race** — concurrent operations on shared state without locking / ordering guarantees;
- **regression** — prior-shipped behaviour an existing test does not pin;
- **rollback impossibility** — schema migration / persisted state shape that cannot be reverted;
- **accidental scope** — diff touches files no AC mentions;
- **security-edge** — auth bypass, injection, leaked secret in logs, untrusted input.

The adversarial reviewer treats every "not covered" as a finding (axis varies; severity \`required\` by default, escalated to \`critical\` for data-loss / security-edge). Findings go into the existing Findings table in \`review.md\`; the same file gets a \`## Pre-mortem (adversarial)\` section summarising the adversarial pass's reasoning so the user can read a one-page rationale. (On \`legacy-artifacts: true\` the section is mirrored into a standalone \`pre-mortem.md\` for downstream tooling.)

### Ship-gate decision matrix

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

Open this runbook **after every stage exit** — both at the end of plan / build / review / ship and at every design Phase 7 sign-off (which closes the discovery sub-phase under \`plan\`). Design's Phase 1 batched-ask pause is conversation-only and does NOT trigger a handoff rewrite (it is a mid-turn, mid-dialog state inside the same orchestrator context; HANDOFF.json is for resume-across-sessions checkpoints).

## Why two files

\`HANDOFF.json\` is what the orchestrator's resume step reads to rebuild dispatch context; \`.continue-here.md\` is what the user reads to remember what they were doing — possibly days later when they reopen a stale flow. The dot-prefix on \`.continue-here.md\` keeps it out of casual file-listing noise but keeps it readable when the user grep's for "continue".

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
- The detect step may consult \`HANDOFF.json\` as a fallback when \`flow-state.json\` is missing or unparseable (v8.13 hardening: file may be deleted by accident, but HANDOFF.json snapshots can rebuild the resume context).

## When the orchestrator rewrites

When a sub-agent dispatch's slim-summary returns, the orchestrator: (1) patches \`flow-state.json\`; (2) re-renders both handoff files; (3) renders the slim summary in the conversation; (4) ends the turn. Step 2 is mandatory — skipping it leaves the next \`/cc\` invocation rebuilding context the wrong way.
`;

const COMPOUND_REFRESH = `# On-demand runbook — compound refresh + discoverability self-check

Open this runbook **after a compound capture writes a line to \`.cclaw/state/knowledge.jsonl\`**, when either:

- \`knowledge.jsonl\` line count is a multiple of 5 after the new line is appended (compound-refresh trigger), OR
- The user runs \`/cc-compound-refresh\` manually.

For the compound gate itself (does this slug capture learnings?), see start-command's Compound step.

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

After ship completes (finalize done), the orchestrator scans \`AGENTS.md\` / \`CLAUDE.md\` / \`README.md\` for any mention of \`knowledge.jsonl\` or \`flows/shipped/\`. When **none** of these files mention either path, the orchestrator surfaces a one-line note in the user's language ("This project's knowledge.jsonl now has N entries but the AGENTS.md / CLAUDE.md / README.md don't reference it. Want me to add a 1-line discovery note so future agents know it exists? [add / skip-this-time / never]"). The user picks; on \`add\`, the orchestrator appends a single line to the most appropriate root file (preferring AGENTS.md, then CLAUDE.md, then README.md):

\`\`\`markdown
- \`.cclaw/knowledge.jsonl\` — append-only learnings catalogue from cclaw flows; cclaw specialists read this before authoring plans (\`learnings-research\` helper).
\`\`\`

This makes the catalogue discoverable to future agents/humans who don't already know cclaw's conventions. Without the note, a fresh contributor (or a different harness's bootstrap) won't know it exists.

The discoverability check runs **once per slug** (only when ship completes), and respects the user's \`never\` choice for the rest of the session.
`;

const PAUSE_RESUME = `# On-demand runbook — pause and resume mechanics (step / auto / Confidence gate)

The orchestrator opens this runbook on every stage exit when \`triage.path\` is **non-inline** (i.e., the path contains any of \`plan\` / \`review\` / \`ship\`, not just \`build\`). Inline / trivial paths set \`runMode: null\` and never pause — they skip pause/resume entirely, so they never open this runbook.

The orchestrator body keeps the orchestrator-wide invariants (\`/cc\` is the only resume verb, end-of-turn is the pause mechanism in step, Confidence: low is a hard gate in both modes). The full mechanics — including the per-mode procedure, the hard-gate enumeration, the Confidence × mode table, and the resume-from-fresh-session rules — live here so the orchestrator body stays slim on inline and small-medium paths that don't need every detail loaded.

## \`step\` mode (default; safer; recommended for \`strict\` work)

After every dispatch returns: (1) render the slim summary; (2) re-author \`HANDOFF.json\` + \`.continue-here.md\` (see \`runbooks/handoff-artifacts.md\`); (3) state the next stage in plain language ("Plan is ready (5 testable conditions). Send \`/cc\` to continue with build."); (4) **End your turn** — do NOT call \`askUserQuestion\`, do NOT wait for a magic word; the pause IS the end of the turn; \`flow-state.json\` + \`HANDOFF.json\` carry the resume point.

This is cclaw's **single resume mechanism**. Mid-session and cross-session pauses both end the turn; \`/cc\` is the only verb that moves the flow forward. No "type continue" magic word; no clickable Continue button mid-turn.

If the user wants \`fix-only\` or \`show\` semantics, they say so in plain text on the next \`/cc\` and the orchestrator routes accordingly: "/cc fix-only" → slice-builder mode=fix-only against cited findings; "/cc show" → open the current-stage artifact and stop; otherwise → advance to the next stage.

## \`auto\` mode (autopilot; faster; recommended for \`inline\` / \`soft\` work)

After every dispatch returns: (1) render the slim summary; (2) immediately dispatch the next stage in \`triage.path\` — no waiting, no question — UNLESS inside the design phase (v8.47+ pacing: Phase 1 conditional + Phase 7 mandatory pauses fire regardless of runMode; see \`runbooks/discovery.md\`).

Stop unconditionally only on these **hard gates** (autopilot **always** asks here):

- \`reviewer\` returned \`block\` (open findings) → ask "dispatch fix-only" / "stay paused".
- \`security-reviewer\` raised any finding → same shape.
- \`reviewer\` returned \`cap-reached\` → see \`runbooks/cap-reached-recovery.md\`.
- A slim summary has \`Confidence: low\` → see "Confidence as a hard gate" below.
- About to run \`ship\` (last stage) → ask "Ship now?" once. Ship always confirms in autopilot.
- Inside the design phase — Phase 1 (Clarify, conditional) + Phase 7 (Sign-off, mandatory) pauses fire regardless of runMode (v8.47+ two-turn-max pacing; see design.md).

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

Resume from a fresh session works because everything is on disk: \`flow-state.json\` has \`currentStage\`, \`triage\` (with \`runMode\`), \`flows/<slug>/*.md\` carries the artifacts. The next \`/cc\` invocation enters detect → resume summary → continue from \`currentStage\` with the saved runMode.

Resuming a paused \`auto\` flow re-enters auto mode silently. Resuming a paused \`step\` flow renders the slim summary again and ends the turn (the same end-of-turn rule applies on resume). The user's next \`/cc\` continues.

\`/cc-cancel\` is the **only** way to discard an active flow; it is never offered as a clickable option in any structured question. The orchestrator surfaces it as plain prose ("send \`/cc-cancel\` to discard this flow") only when the user appears stuck — not as the default.
`;

const CRITIC_STEPS = `# On-demand runbook — critic steps (pre-implementation + post-implementation)

cclaw has **two** critic specialists that share a dispatch envelope shape and the falsificationist pass discipline but fire at different points in the flow:

| stage | when | reads | output | verdicts |
| --- | --- | --- | --- | --- |
| **plan-critic** (v8.51) | between ac-author and slice-builder | plan.md only (read-only on the codebase) | flows/<slug>/plan-critic.md | \`pass\` / \`revise\` / \`cancel\` |
| **critic** (v8.42) | between reviewer-clear and ship | plan.md + build.md + review.md + diff | flows/<slug>/critic.md | \`pass\` / \`iterate\` / \`block-ship\` |

Both stages ship together because they catch different problem classes — plan-critic walks the plan itself ("is this plan structurally buildable?"); the post-impl critic walks the built diff ("did we build the right thing well?"). The orchestrator opens the matching section below for the transition in flight.

## Shared cross-stage rules

- **Pre-commitment predictions** are authored BEFORE the rest of the protocol runs (plan-critic §6; post-impl critic §1). Same discipline shape: 3-5 predictions naming verification paths and final outcomes (\`confirmed\` / \`refuted\` / \`partial\`); the discipline activates deliberate search instead of passive reading.
- **Anti-rationalization pointer.** Both specialists reference the shared \`.cclaw/lib/anti-rationalizations.md\` catalog (v8.49) for cross-cutting rationalizations; only specialist-unique rows live inline in the prompt body.
- **Iteration cap = 1.** Each specialist dispatches at most twice per slug (iteration 0 + one allowed retry). A third dispatch is structurally forbidden — the orchestrator surfaces a cap-reached user picker instead.
- **Slim summary shape.** Both return a ≤7-line slim summary with \`specialist\`, \`verdict\`, severity-bucketed findings count, \`iteration\`, \`confidence\`, and an optional \`notes\` line (required when confidence != high).

## Pre-implementation pass (plan-critic, v8.51)

The orchestrator opens this section **on every \`ac-author\` slim-summary return** when the v8.51 gate evaluates to true. plan-critic is the v8.51 pre-implementation adversarial specialist that runs between \`ac-author\` and \`slice-builder\` on a tight subset of flows. It walks what is **missing or wrong** in the plan itself (goal coverage / granularity / dependency accuracy / parallelism feasibility / risk catalog + pre-commitment predictions) rather than the post-impl critic's "did we build the right thing well?" pass. The contract that drives the dispatch lives in \`.cclaw/lib/agents/plan-critic.md\`; this section covers what the orchestrator does *around* the dispatch.

### plan-critic gating (the four AND conditions — orchestrator enforces deterministically)

plan-critic runs ONLY when ALL of these hold:

1. \`triage.ceremonyMode == "strict"\` (soft / inline plans don't carry the granularity surface to critique).
2. \`triage.complexity != "trivial"\` (trivial flows have no plan stage; small-medium and large-risky plans are both eligible).
3. \`triage.problemType\` ≠ \`"refines"\` (refines slugs extend prior shipped work; the parent slug already shipped + survived its post-impl critic).
4. AC count ≥ 2 (a single-AC plan has no internal granularity / dependency surface).

For any other combination, plan-critic is **structurally skipped**. The orchestrator advances directly from ac-author's slim summary to slice-builder dispatch, as today. The gate is **AND** across all four; the v8.54 widening dropped the prior \`complexity == "large-risky"\` requirement (reference patterns — chachamaru \`plan_critic\` runs on every Phase 0, gsd-v1 plan-checker runs across complexity tiers — showed cclaw's prior gate was the narrowest in the cohort and likely under-fired on strict small-medium flows; trivial flows still skipped because they have no plan to critique). Further widening any condition is a v8.55+ scope decision, not a within-slug runtime call.

### plan-critic dispatch envelope

\`\`\`
Dispatch plan-critic
─ Required first read: .cclaw/lib/agents/plan-critic.md  (your contract — gate, 5-dimension protocol, verdict, slim summary)
─ Required second read: .cclaw/lib/anti-rationalizations.md  (v8.49 catalog; the prompt body cites it)
─ Stage: plan-critic
─ Slug: <slug>
─ Ceremony mode: strict  (gate enforces; always strict)
─ AC count: <N>    (from plan.md frontmatter; ≥2 by gate)
─ Iteration: <0 | 1>  (0 on first dispatch; 1 on the one allowed revise loop)
─ Findings to address (iteration 1 only): <verbatim §8 hand-off block from the iter-0 plan-critic.md>
─ Inputs the sub-agent reads after the contract + catalog:
    - .cclaw/state/flow-state.json (triage)
    - .cclaw/flows/<slug>/plan.md (Frame, Spec, NFR, AC, Decisions, Pre-mortem, Topology)
    - .cclaw/lib/templates/plan-critic.md
    - CONTEXT.md at the project root, if it exists
─ Output contract:
    - .cclaw/flows/<slug>/plan-critic.md (single-shot — overwrite on re-dispatch, no append-only ledger)
    - return a slim summary block (≤7 lines)
    - DO NOT mutate flow-state.json — only the orchestrator touches it
─ Forbidden:
    - edit plan.md / build.md / review.md / source / tests
    - dispatch other specialists (composition is the orchestrator's job)
    - exceed 7k tokens (input + output combined; itself a finding when approached)
\`\`\`

### plan-critic verdict handling (slim summary → orchestrator routing)

The plan-critic returns one of three verdicts. The orchestrator branches on (verdict, iteration):

| verdict | iteration | \`currentStage\` after | \`triage.runMode\` behaviour | what the orchestrator does |
| --- | --- | --- | --- | --- |
| \`pass\` | 0 or 1 | \`"plan"\` → advance to \`"build"\` | step pauses end-of-stage; auto chains to build | no user gate; advance straight to slice-builder dispatch. \`iterate\` and \`fyi\` rows in plan-critic.md ride along as advisory notes for slice-builder + reviewer to see. |
| \`revise\` | 0 | stays \`"plan"\`, \`lastSpecialist: "plan-critic"\` | both modes proceed silently | dispatch \`ac-author\` again, with plan-critic.md §8 hand-off block prepended to the dispatch envelope's \`Inputs\` line. ac-author updates plan.md, then the orchestrator re-dispatches plan-critic (iteration 1). |
| \`revise\` | 1 | stays \`"plan"\` | both modes hard-gate | surface the revise-cap-reached user picker: \`[cancel]\` (out-of-band \`/cc-cancel\`), \`[accept-warnings-and-proceed]\` (advance to slice-builder anyway; stamps \`triage.planCriticOverride: true\` if you want to capture the override for audit — currently not a stamped field, surface as conversation), \`[re-design]\` (route back to design phase Phase 1 with the surfaced constraints). |
| \`cancel\` | 0 or 1 | stays \`"plan"\` | both modes hard-gate | surface the cancel picker IMMEDIATELY: \`[cancel-slug]\` (user types \`/cc-cancel\` out-of-band), \`[re-design]\` (route back to design phase Phase 1). No silent fallback — \`cancel\` means the plan is structurally not buildable. |

**Confidence: low** in the plan-critic's slim summary is a hard gate in both \`step\` and \`auto\` modes (same rule as every other specialist). The plan-critic MUST write a non-empty \`notes:\` line when confidence is not \`high\`; the orchestrator offers \`Expand plan-critic\` / \`Show artifact\` / \`Override and continue\` / \`Stay paused\` per the standard pause/resume invariants.

### plan-critic iteration cap enforcement

- \`planCriticIteration\` starts at 0 (initial dispatch about to fire) and increments to 1 after the first slim-summary return.
- The orchestrator dispatches plan-critic **at most twice per slug**: once at iteration 0, optionally once at iteration 1 (only on \`revise\` from iter 0). A third dispatch is structurally not allowed — the orchestrator surfaces the revise-cap-reached picker instead.
- A flow that goes \`revise\` (iter 0) → ac-author revise → \`revise\` (iter 1) is the canonical "1 revise loop max" path. After the second \`revise\`, the user picker decides whether to cancel, accept warnings and proceed to slice-builder, or re-design.
- A \`cancel\` verdict at any iteration immediately surfaces the cancel picker; iteration does not advance.
- The iteration cap is independent of \`reviewIterations\` (post-impl review loop) and \`criticIteration\` (post-impl critic). All three counters are tracked separately.

### plan-critic FlowState patches

**Immediately before dispatching plan-critic (iteration 0 OR iteration 1):**

\`\`\`json
{
  "currentStage": "plan",
  "lastSpecialist": "ac-author"
}
\`\`\`

(\`currentStage\` stays \`"plan"\` because plan-critic is structurally part of the plan stage — it sits between ac-author and slice-builder.)

**After plan-critic returns slim summary (orchestrator has read it, BEFORE user-gate decision):**

\`\`\`json
{
  "currentStage": "plan",
  "lastSpecialist": "plan-critic",
  "planCriticIteration": <0 if first dispatch returning; 1 if second dispatch returning>,
  "planCriticVerdict": "pass | revise | cancel",
  "planCriticDispatchedAt": "<iso timestamp>"
}
\`\`\`

**After pass verdict (advance to build):** \`currentStage\` advances to \`"build"\`. The plan-critic fields stay; they are immutable for the rest of the flow.

**After revise verdict (iter 0, bounce to ac-author):** \`currentStage\` stays \`"plan"\`; \`lastSpecialist\` is patched back to \`"ac-author"\` only after ac-author's revise dispatch returns its slim summary. plan-critic.md stays on disk; ac-author's next dispatch reads it.

**After cancel verdict / revise-cap picker resolution:** the user's pick drives the next state transition (\`/cc-cancel\` clears the flow; \`[re-design]\` resets to design Phase 1; \`[accept-warnings-and-proceed]\` advances to slice-builder despite the \`revise\` verdict). The plan-critic fields stay verbatim as the audit trail.

### What plan-critic CANNOT do (read this before authoring the envelope)

- Edit any source file (\`src/**\`, \`tests/**\`, \`.cclaw/state/**\`) or the body of \`plan.md\` / \`build.md\` / \`review.md\`. The only file plan-critic writes is \`.cclaw/flows/<slug>/plan-critic.md\`.
- Commit, push, rebase, or merge. plan-critic owns no git operations.
- Dispatch other specialists. Composition is the orchestrator's job.
- Exceed 7k input+output tokens. Approaching the cap is itself a finding (\`confidence: low\`, recommend split).
- Propose alternative approaches. The design phase chose; plan-critic catches mistakes in the chosen plan, not relitigates the choice.
- Emit multi-perspective lens findings (security / a11y / perf as parallel sweeps). That is v8.53 scope for the post-impl critic; plan-critic stays focused on the five dimensions.

### plan-critic legacy migration (pre-v8.51 \`flow-state.json\`)

A state file with \`currentStage: "plan"\` AND \`lastSpecialist: "ac-author"\` AND no \`planCriticVerdict\` field is treated as **pre-plan-critic intermediate**:

- If the slug satisfies the v8.54 gate (ceremonyMode=strict + complexity!=trivial + problemType!=refines + AC count>=2): on the next \`/cc\`, the orchestrator emits a one-line migration note (\`Legacy state (pre-v8.51) detected; plan-critic will run on next /cc.\`) and dispatches plan-critic before advancing to slice-builder.
- If the slug does NOT satisfy the gate (any combination that fails any of the four AND-conditions): no migration; plan-critic was structurally never going to run on this slug, advance to slice-builder as today.

The migration is one-pass and idempotent — a slug whose plan-critic has already run shows \`planCriticVerdict\` set, so the legacy branch is never re-entered.

## Post-implementation pass (critic, v8.42)

The orchestrator opens this section **on every transition from \`review\` to \`critic\`** and at every block-ship picker resolution. The critic is the v8.42 on-demand adversarial specialist that runs between the reviewer's final \`clear\` and the ship gate. It walks what is *missing* (gap analysis + pre-commitment predictions + goal-backward verification + Criterion check + realist check + — in adversarial mode — assumption-violation / composition / cascade / abuse cases), rather than re-walking the reviewer's eight axes. The contract that drives the dispatch lives in \`.cclaw/lib/agents/critic.md\`; this section covers what the orchestrator does *around* the dispatch.

### critic ceremonyMode gating (Q1, no flag exposed)

| \`triage.ceremonyMode\` | does critic run? | mode | typical token budget |
| --- | --- | --- | --- |
| \`inline\` | **no — skipped** (\`triage.path\` never includes \`critic\` on inline) | — | 0 |
| \`soft\` | **yes** | \`gap\` (light) — predictions ≤3, §3 adversarial skipped, §5 goal-backward collapsed to one paragraph | 5-7k |
| \`strict\` | **yes** | \`gap\` (full) by default; auto-escalates to \`adversarial\` (\§3 emitted in full + per-D-N devil's-advocate sweep) when any §8 trigger fires | 10-15k (gap) / 12-18k (adversarial), hard cap 20k |

### critic escalation triggers (§8, OR-conditions — any one fires escalation on \`ceremonyMode: strict\`)

1. **Architectural-tier change** — touchSurface includes ≥2 files marked \`tier: architectural\` in plan.md OR the build introduced one.
2. **Test-first + zero failing tests in build.md** — slug posture is \`test-first\` AND the TDD log shows zero \`RED\` rows (v8.42 Q5: narrow trigger, do NOT widen to "missing RED excerpt"; the difference matters — a slug with \`RED\` rows that lack a captured excerpt is a build.md audit-trail gap to be flagged, not a critic escalator).
3. **Large surface size** — \`git diff --stat\` reports ≥10 files OR ≥500 net lines changed since the plan committed.
4. **\`security_flag: true\`** OR security-reviewer ran during review.
5. **\`reviewIterations >= 4\`** — the slug needed near-cap iterations to converge; hidden complexity signal.

The orchestrator computes the trigger set deterministically from \`flow-state.json\` + \`plan.md\` frontmatter + \`build.md\` table + \`git diff --stat\` BEFORE dispatching critic. The dispatch envelope stamps the firing triggers verbatim so the prompt copies them into \`critic.md > frontmatter > escalation_triggers\`.

Mapping fired-triggers count to \`criticEscalation\`:

- \`ceremonyMode: soft\` AND exactly one trigger fired → \`light\` (still \`gap\` mode; one extra technique permitted).
- \`ceremonyMode: strict\` AND any trigger fired → \`full\` (\`adversarial\` mode; all four §3 techniques + devil's-advocate sweep).
- Otherwise → \`none\` (\`gap\` mode unchanged).

### critic cap & rerun rules

- **Hard cap: 1 critic re-run per slug.** \`criticIteration\` starts at 1 on the first dispatch, increments to 2 on a rerun, and would refuse a third — surfacing the critic-cap-reached picker (same shape as the v8.20 5-iteration reviewer cap).
- **Re-run trigger:** ONLY when the user picks \`[1] fix and re-review\` at the block-ship picker. The orchestrator re-dispatches \`slice-builder\` in \`fix-only\` mode, re-runs \`reviewer\` (this DOES increment \`reviewIterations\` — the v8.20 cap still applies), then re-runs \`critic\` (increments \`criticIteration\`).
- **Independence:** critic dispatches do NOT increment \`reviewIterations\`. The two counters are independent; the critic-cap-reached picker fires only on a third critic dispatch, even if the reviewer-cap is far from reached.

### critic verdict handling (slim summary → orchestrator routing)

| critic \`Verdict:\` | \`currentStage\` after | \`triage.runMode\` behaviour | what the orchestrator does |
| --- | --- | --- | --- |
| \`pass\` | \`"ship"\` | step pauses end-of-stage; auto chains to ship | no user gate; advance straight to ship |
| \`iterate\` | \`"ship"\` | step pauses end-of-stage; auto chains to ship | open critic gaps with severity \`iterate\` are copied verbatim into \`ship.md > ## Risks carried over\`; one line to the user ("Critic returned iterate (\<N\> gaps carried over). Continuing to ship.") |
| \`block-ship\` | stays \`"critic"\` | both modes hard-gate | surface the block-ship picker: \`[1] fix and re-review\` (consumes the one allowed rerun), \`[2] accept-and-ship\` (strict-mode escape hatch; stamps \`triage.criticOverride: true\` for audit trail), \`[3] /cc-cancel\` (out-of-band). Single-line summary cites the \`block-ship\` G-N / F-N anchors verbatim. |

**Confidence: low** in the critic's slim summary is a hard gate in both \`step\` and \`auto\` modes (same rule as every other specialist). The critic MUST write a non-empty \`Notes:\` line when Confidence is not \`high\`; the orchestrator offers \`Expand critic\` / \`Show artifact\` / \`Override and continue\` / \`Stay paused\` per the standard pause/resume invariants.

### critic FlowState patches

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

### Q4 dogfood — when this is the v8.42 implementation slug

The v8.42 slug introduces the critic itself. The acceptance criterion (Q4) is that *this* slug runs through *its own* critic stage during review. If the critic returns \`block-ship\` on its own implementation, the orchestrator records the block-ship reason in \`learnings.md\` and the user invokes \`[2] accept-and-ship\` (manual override; \`triage.criticOverride: true\`). The override is documented in the slug's PR body under \`## Critic self-dogfood findings\` per the v8.42 process checklist. This is a one-time bootstrap exception — every subsequent slug treats \`block-ship\` as a hard gate by default.

### critic legacy migration (pre-v8.42 \`flow-state.json\`)

A state file with \`currentStage: "review"\` AND \`lastSpecialist: "reviewer"\` AND no \`criticVerdict\` field is treated as **pre-critic intermediate**:

- If the slug directory is \`flows/<slug>/\` (still active, not yet shipped): on the next \`/cc\`, the orchestrator emits the one-line migration note (\`Legacy state (pre-v8.42) detected; the critic stage will run on next /cc.\`) and dispatches critic before advancing to ship.
- If the slug directory is \`flows/shipped/<slug>/\` (post-v8.41 ship already completed): the state is left alone. The shipped artifact set is immutable; the orchestrator does NOT retroactively run critic on a shipped slug.

The migration is one-pass and idempotent — a slug whose critic has already run shows \`criticVerdict\` set, so the legacy branch is never re-entered.

### What the critic CANNOT do (read this before authoring the envelope)

- Edit any source file (\`src/**\`, \`tests/**\`, \`.cclaw/state/**\`) or the body of \`plan.md\` / \`build.md\` / \`review.md\`.
- Commit, push, rebase, or merge. The critic owns no git operations.
- Dispatch other specialists. Composition is the orchestrator's job.
- Exceed 20k input+output tokens. Approaching the cap is itself a finding (\`Confidence: low\`, recommend split).
- Re-walk the reviewer's eight axes. The critic reads \`review.md > ## Findings\` as already-walked context and spends its budget on the *delta* (predictions / gaps / goal-backward / adversarial).

The only file the critic writes is \`.cclaw/flows/<slug>/critic.md\` (single-shot per dispatch; a rerun overwrites in place — no append-only ledger, see v8.42 Q2).
`;

const QA_STAGE = `# On-demand runbook — qa step (v8.52+)

The orchestrator opens this runbook **on every slice-builder GREEN slim-summary return** when the v8.52 qa gate evaluates to true. \`qa-runner\` is the v8.52 behavioural-acceptance specialist that runs between \`build\` and \`review\` on UI-touching slugs in non-inline mode. It walks the **rendered page** (Playwright > browser-MCP > manual) and emits one evidence row per UI-tagged AC. The contract that drives the dispatch lives in \`.cclaw/lib/agents/qa-runner.md\`; this runbook covers what the orchestrator does *around* the dispatch.

Distinct from \`debug-and-browser.md\` (live-system diagnostic discipline, fires on stop-the-line) and from \`reviewer.md > qa-evidence axis\` (post-qa cross-check that qa.md rows match the diff). The three together close the behavioural-QA gap that pre-v8.52 cclaw only handled implicitly through the reviewer's nine-axis pass.

## Gating (the three AND conditions — orchestrator enforces deterministically)

qa-runner runs ONLY when ALL of these hold:

1. \`triage.surfaces\` includes at least one of \`"ui"\` or \`"web"\` (CLI / library / API / data / infra / docs-only slugs structurally skip qa).
2. \`triage.ceremonyMode != "inline"\` (trivial / one-shot slugs skip qa; inline budget cannot afford a structured pass).
3. \`qaIteration < 1\` (hard cap — a third dispatch is structurally not allowed; the orchestrator surfaces the iterate-cap-reached picker instead).

For any other combination, qa-runner is **structurally skipped**. The orchestrator advances directly from slice-builder's GREEN slim summary to reviewer dispatch, as today. The gate is **AND** across all three; widening any condition (e.g. running qa on \`ceremonyMode: inline\`) is a v8.53+ scope decision, not a within-slug runtime call.

Backwards compat: a pre-v8.52 flow whose \`triage.surfaces\` field is absent reads as \`["other"]\` and skips qa — the orchestrator does not retro-fit qa onto legacy slugs.

## Dispatch envelope

\`\`\`
Dispatch qa-runner
─ Required first read: .cclaw/lib/agents/qa-runner.md  (your contract — gate, browser-tool hierarchy, evidence rubric, verdict semantics, slim summary)
─ Required second read: .cclaw/lib/skills/qa-and-browser.md  (the cross-cutting QA discipline; tier definitions, evidence requirements, anti-rationalizations)
─ Stage: qa
─ Slug: <slug>
─ Ceremony mode: <strict | soft>  (gate enforces non-inline; inline is structurally impossible here)
─ Surfaces: <list from triage.surfaces — e.g. ["ui"], ["web"], ["ui", "api"]>
─ UI ACs: <list of AC ids whose touchSurface includes UI files, computed from plan.md AC table>
─ Iteration: <0 | 1>  (0 on first dispatch; 1 on the one allowed iterate loop)
─ Findings to address (iteration 1 only): <verbatim §7 hand-off block from the iter-0 qa.md>
─ Inputs the sub-agent reads after the contract + skill:
    - .cclaw/state/flow-state.json (triage)
    - .cclaw/flows/<slug>/plan.md (AC table with touchSurface column)
    - .cclaw/flows/<slug>/build.md (GREEN evidence — what the slice-builder already verified)
    - .cclaw/flows/<slug>/qa.md (iter-0 artifact, when re-dispatching at iter 1)
    - .cclaw/lib/templates/qa.md
    - CONTEXT.md at the project root, if it exists
─ Output contract:
    - .cclaw/flows/<slug>/qa.md (single-shot — overwrite on re-dispatch, no append-only ledger)
    - .cclaw/flows/<slug>/qa-assets/<ac-id>-<n>.png (screenshots, only when evidence_tier == browser-mcp)
    - tests/e2e/<slug>-<ac>.spec.ts (Playwright specs, only when evidence_tier == playwright AND project ships Playwright)
    - return a slim summary block (≤7 lines)
    - DO NOT mutate flow-state.json — only the orchestrator touches it
─ Forbidden:
    - edit production source (src/**) — qa-runner is read-only; slice-builder owns production fixes
    - edit plan.md / build.md / review.md / flow-state.json
    - dispatch other specialists (composition is the orchestrator's job)
    - npm install Playwright as a side effect (downgrade to Tier 2 / 3 + surface a fyi finding instead)
    - exceed 10k tokens (input + output combined; itself a finding when approached)
\`\`\`

## Verdict handling (slim summary → orchestrator routing)

qa-runner returns one of three verdicts. The orchestrator branches on (verdict, iteration):

| verdict | iteration | \`currentStage\` after | \`triage.runMode\` behaviour | what the orchestrator does |
| --- | --- | --- | --- | --- |
| \`pass\` | 0 or 1 | \`"qa"\` → advance to \`"review"\` | step pauses end-of-stage; auto chains to review | no user gate; advance straight to reviewer dispatch. The reviewer's \`qa-evidence\` axis re-reads qa.md and cross-checks each row against the diff. \`fyi\` findings ride along as advisory notes. |
| \`iterate\` | 0 | stays \`"qa"\`, \`lastSpecialist: "qa-runner"\` | both modes proceed silently | dispatch \`slice-builder\` again in **fix-only** mode, with qa.md §7 hand-off block prepended to the dispatch envelope's \`Inputs\` line. slice-builder addresses each \`required\` finding (RED → GREEN cycle for the failed UI behaviour), then the orchestrator re-runs the build verification cycle and re-dispatches qa-runner (iteration 1). |
| \`iterate\` | 1 | stays \`"qa"\` | both modes hard-gate | surface the iterate-cap-reached user picker: \`[cancel]\` (out-of-band \`/cc-cancel\`), \`[accept-warnings-and-proceed-to-review]\` (advance to reviewer anyway; the surviving \`required\` findings ride into review.md as evidence the reviewer's \`qa-evidence\` axis will fire on), \`[re-design]\` (route back to design phase Phase 1 with the surfaced UI constraints). |
| \`blocked\` | 0 or 1 | stays \`"qa"\` | both modes hard-gate | surface the blocked user picker IMMEDIATELY: \`[proceed-without-qa-evidence]\` (advance to reviewer with qa.md noting the gap; \`qa-evidence\` axis fires \`required\`), \`[pause-for-manual-qa]\` (user follows qa.md §4 manual-steps blocks, then the orchestrator stamps Status: pass on confirmed ACs and re-evaluates verdict), \`[skip-qa]\` (advance to reviewer; qa.md frontmatter records \`evidence_tier: manual\` + \`verdict: blocked\` for the audit trail). No silent fallback — \`blocked\` means qa could not actually run. |

**Confidence: low** in the qa-runner's slim summary is a hard gate in both \`step\` and \`auto\` modes (same rule as every other specialist). The qa-runner MUST write a non-empty \`notes:\` line when confidence is not \`high\`; the orchestrator offers \`Expand qa-runner\` / \`Show artifact\` / \`Override and continue\` / \`Stay paused\` per the standard pause/resume invariants.

## Iteration cap enforcement

- \`qaIteration\` starts at 0 (initial dispatch about to fire) and increments to 1 after the first slim-summary return.
- The orchestrator dispatches qa-runner **at most twice per slug**: once at iteration 0, optionally once at iteration 1 (only on \`iterate\` from iter 0). A third dispatch is structurally not allowed — the orchestrator surfaces the iterate-cap-reached picker instead.
- A flow that goes \`iterate\` (iter 0) → slice-builder fix → \`iterate\` (iter 1) is the canonical "1 iterate loop max" path. After the second \`iterate\`, the user picker decides whether to cancel, accept warnings and proceed to review, or re-design.
- A \`blocked\` verdict at any iteration immediately surfaces the blocked picker; iteration does not advance until the user makes a choice.
- The iteration cap is independent of \`reviewIterations\` (post-impl review loop), \`criticIteration\` (post-impl critic), and \`planCriticIteration\` (pre-impl plan-critic). All four counters are tracked separately.

## FlowState patches

**Immediately before dispatching qa-runner (iteration 0 OR iteration 1):**

\`\`\`json
{
  "currentStage": "qa",
  "lastSpecialist": "slice-builder"
}
\`\`\`

(\`currentStage\` advances to \`"qa"\` because qa is a real stage in the v8.52 \`FLOW_STAGES\` enum, sitting between \`"build"\` and \`"review"\`.)

**After qa-runner returns slim summary (orchestrator has read it, BEFORE user-gate decision):**

\`\`\`json
{
  "currentStage": "qa",
  "lastSpecialist": "qa-runner",
  "qaIteration": <0 if first dispatch returning; 1 if second dispatch returning>,
  "qaVerdict": "pass | iterate | blocked",
  "qaEvidenceTier": "playwright | browser-mcp | manual | null",
  "qaDispatchedAt": "<iso timestamp>"
}
\`\`\`

(\`qaEvidenceTier\` is \`null\` only on a \`blocked\` verdict where no tier was actually exercised — e.g. browser tools unavailable and manual steps queued for the user. On \`pass\` and \`iterate\`, the tier is always one of \`playwright\` / \`browser-mcp\` / \`manual\`.)

**After pass verdict (advance to review):** \`currentStage\` advances to \`"review"\`. The qa fields stay; they are immutable for the rest of the flow. The reviewer's \`qa-evidence\` axis reads them.

**After iterate verdict (iter 0, bounce to slice-builder fix-only):** \`currentStage\` stays \`"qa"\`; \`lastSpecialist\` is patched back to \`"slice-builder"\` only after slice-builder's fix-only dispatch returns its slim summary. qa.md stays on disk; slice-builder's next dispatch reads §7 hand-off. After the fix-only slice-builder returns GREEN, the orchestrator re-dispatches qa-runner (iteration 1) — \`qaIteration\` increments at that point.

**After blocked verdict / iterate-cap picker resolution:** the user's pick drives the next state transition (\`/cc-cancel\` clears the flow; \`[re-design]\` resets to design Phase 1; \`[accept-warnings-and-proceed-to-review]\` advances \`currentStage\` to \`"review"\` despite the open findings; \`[skip-qa]\` or \`[proceed-without-qa-evidence]\` also advances to \`"review"\` with qa.md recording the gap). The qa fields stay verbatim as the audit trail.

## Reviewer cross-check (qa-evidence axis)

After the qa pass completes (or is overridden), the reviewer's v8.52 \`qa-evidence\` axis cross-checks the artifact against the diff:

1. **For every AC whose \`touchSurface\` includes a UI file**: the reviewer expects a matching \`qa.md > §4 Per-AC evidence\` row.
2. **Missing row** → reviewer fires a \`required\` finding (axis: \`qa-evidence\`, severity: \`required\`).
3. **Row with \`Status: fail\`** (qa returned \`pass\` despite a failed AC — should never happen if qa-runner is correct, but the reviewer cross-checks defensively) → reviewer fires a \`required\` finding citing the contradiction.
4. **Row with \`Status: pending-user\`** (manual tier, blocked verdict overridden) → reviewer fires a \`fyi\` finding flagging the weakest evidence tier.
5. **Silent tier downgrade** (qa.md frontmatter records \`evidence_tier: manual\` but \`package.json\` ships Playwright; OR \`evidence_tier: browser-mcp\` but no MCP was actually exercised) → reviewer fires a \`required\` finding citing the missed tier.

The axis is the 9th explicit axis (10th with the gated \`nfr-compliance\` axis). The reviewer's slim-summary axes counter includes \`qae=N\` for the qa-evidence finding count.

## What qa-runner CANNOT do (read this before authoring the envelope)

- Edit any production source file (\`src/**\`) or the body of \`plan.md\` / \`build.md\` / \`review.md\` / \`flow-state.json\`. The only files qa-runner writes are: \`.cclaw/flows/<slug>/qa.md\`, screenshots under \`.cclaw/flows/<slug>/qa-assets/\`, and (optionally) Playwright specs under \`tests/e2e/<slug>-<ac>.spec.ts\` — and the last only when the project already ships Playwright.
- Author production-code fixes for failed UI ACs. slice-builder owns production fixes; qa-runner surfaces failures in §5 Findings + §7 Hand-off and lets the orchestrator dispatch slice-builder.
- Commit, push, rebase, or merge. qa-runner owns no git operations except the implicit commit that lands the Playwright spec it authored (if any) — the slice-builder picks that up at the next iterate cycle.
- Dispatch other specialists. Composition is the orchestrator's job.
- Exceed 10k input+output tokens. Approaching the cap is itself a finding (\`confidence: low\`, recommend split).
- Pretend qa ran when it could not. \`blocked\` is the right verdict when browser tools are unavailable; never write \`pass\` against an AC you could not actually verify.
- Silently install Playwright. If the project does not ship Playwright, downgrade to Tier 2 / 3 and surface a \`fyi\` finding recommending a follow-up "add Playwright" slug — do not grow the dependency footprint as a qa side effect.
- Write findings about code quality. Quality belongs to the reviewer's nine-axis pass; qa-runner findings are strictly about behavioural verification of UI rendering.

## Legacy migration (pre-v8.52 \`flow-state.json\`)

A state file with \`currentStage: "build"\` AND \`lastSpecialist: "slice-builder"\` AND no \`qaVerdict\` field is treated as **pre-qa intermediate**:

- If the slug satisfies the v8.52 gate (\`triage.surfaces\` includes \`ui\` or \`web\` AND \`triage.ceremonyMode != "inline"\`): on the next \`/cc\`, the orchestrator emits a one-line migration note (\`Legacy state (pre-v8.52) detected; qa-runner will run on next /cc.\`) and dispatches qa-runner before advancing to reviewer.
- If the slug does NOT satisfy the gate (\`triage.surfaces\` is absent / empty / non-UI, OR \`triage.ceremonyMode == "inline"\`): no migration; qa-runner was structurally never going to run on this slug, advance to reviewer as today. \`triage.surfaces\` absent is treated as \`["other"]\` (the canonical no-QA-gating fallback).

The migration is one-pass and idempotent — a slug whose qa-runner has already run shows \`qaVerdict\` set, so the legacy branch is never re-entered.

For slugs where \`triage.surfaces\` was never populated (the field was added in v8.52 and pre-v8.52 triage prompts did not emit it), the orchestrator does NOT retro-populate the field on read — leaving \`surfaces\` absent is the canonical "this was a pre-v8.52 slug, qa was never on the table" signal. The qa gate evaluates absent-surfaces as the empty list and skips dispatch.
`;

const EXTEND_MODE = `# On-demand runbook — extend-mode entry point (v8.59+)

The orchestrator opens this runbook **on every \`/cc\` whose raw argument starts with the literal token \`extend \` (case-insensitive, exactly one space)**. The Detect hop fires before the v8.58 research-mode fork — \`extend\` always wins. This runbook covers the full extend-mode contract: argument parsing, parent validation, slug-init patches, triage inheritance, and the four error sub-cases. Specialist consumption of \`parentContext\` lives further down the orchestrator body under \`### v8.59 prior-context consumption\`; this runbook does not duplicate that section.

## Trigger evaluation order (Detect hop)

1. **Git-check sub-step (v8.23)** — \`.git/\` presence; force \`ceremonyMode: soft\` if absent.
2. **extend-mode fork (v8.59; this runbook)** — argument starts with \`extend \`.
3. **research-mode fork (v8.58)** — argument starts with \`research \` OR carries \`--research\`.
4. **Default routes** — fresh / resume / collision / pre-v8 state per the Detect table.

The order matters: \`/cc extend <slug> research <topic>\` enters extend mode, not research. The user wanting a research flow that extends a parent runs \`/cc research <topic>\` directly without the \`extend\` prefix.

## Argument parsing

When the fork fires, parse the argument into two parts:

- \`<slug>\` — the **first whitespace-separated token** after \`extend \`. Cases:
  - Empty (argument is exactly \`extend\` with no remainder) → sub-case "no slug".
  - Present but no follow-up text → sub-case "no task".
  - Present + remainder → continue to validation.

- \`<task>\` — the **remainder of the argument string** after the slug, trimmed. Must be non-empty for the fork to proceed.

The slug token is matched verbatim; no fuzzy resolution at this layer (a typo surfaces as \`reason: "missing"\` from \`loadParentContext\` and the orchestrator's error message points the user at \`cclaw --non-interactive knowledge\` for the canonical list).

## Parent validation via \`loadParentContext\`

Call \`loadParentContext(projectRoot, slug)\` from \`src/parent-context.ts\`. The helper returns a discriminated union:

\`\`\`typescript
type ParentContextResolution =
  | { ok: true; context: ParentContext }
  | { ok: false; reason: ParentContextErrorReason; slug: string; message: string };

type ParentContextErrorReason = "in-flight" | "cancelled" | "missing" | "corrupted";
\`\`\`

The orchestrator branches on \`ok\`:

### \`ok: true\` — happy path

The slug resolves to a shipped flow with a non-empty \`plan.md\`. Continue with extend-mode initialisation:

1. **Build a slug for the follow-up flow** — canonical \`YYYYMMDD-<semantic-kebab>\` from the \`<task>\` text. Same naming rules as a standard \`/cc <task>\` (date prefix mandatory; same-day collision suffix \`-2\`, \`-3\`, etc.).
2. **Stamp \`flow-state.json > parentContext\`** — patch the new flow's state with the resolved \`ParentContext\` (slug + status: "shipped" + optional shippedAt + artifactPaths) via \`patchFlowState\`. This is the single source of truth for the parent linkage; specialists read this field, not \`refines\`.
3. **Seed \`refines:\` in plan.md frontmatter** — write \`refines: <parent-slug>\` so the legacy v8.58 knowledge-store chain (\`findRefiningChain\`), qa-runner skip rule, plan-critic skip gate, and design Phase 6 ambiguity-score brownfield path keep working unchanged. The two writes (\`parentContext\` + \`refines\`) are kept in sync by the same init code path; user manual edits to plan.md after init are out of scope. \`parent_slug:\` mirrors the pointer (v8.59-native field); \`parent_slug:\` wins on drift.
4. **Run the triage inheritance sub-step** — see "Triage inheritance" below. The sub-step reads the parent's \`ship.md\` / \`plan.md\` frontmatter and seeds \`ceremonyMode\` / \`runMode\` / \`surfaces\` on the new triage decision, unless the user passed an explicit override flag.
5. **Proceed to triage announcement → first dispatch.** The new flow runs the same pipeline as a standard \`/cc <task>\` (plan → build → qa? → review → critic → ship). Only the parent-context loading at init is new.

### \`ok: false\` — error sub-cases

Surface the resolution's \`message\` field verbatim to the user and end the turn. The validator distinguishes four failure modes:

| \`reason\` | meaning | message template |
| --- | --- | --- |
| \`"in-flight"\` | slug is still active under \`flows/<slug>/\` | \`Slug '<slug>' is still in-flight (active under flows/<slug>/). Ship it first, then run /cc extend.\` |
| \`"cancelled"\` | slug was cancelled (under \`flows/cancelled/<slug>/\`) | \`Slug '<slug>' was cancelled (under flows/cancelled/<slug>/, never shipped). Pass a shipped slug.\` |
| \`"corrupted"\` | shipped dir exists but \`plan.md\` is missing | \`Shipped slug '<slug>' is corrupted (plan.md missing under flows/shipped/<slug>/). Cannot use as parent context.\` |
| \`"missing"\` | slug not found under \`flows/\` or \`flows/shipped/\` or \`flows/cancelled/\` | \`Unknown slug '<slug>'. Run 'cclaw --non-interactive knowledge' to list shipped slugs.\` |

The error message is plain prose, ends the turn, and does NOT consume any of the user's quota of clarifying questions (the lightweight router from v8.58 still asks zero questions; extend mode does not change that contract).

## Sub-cases — argument shapes that the parser must handle

- **Argument is \`extend\` alone (no slug, no task)** — surface \`extend mode needs a parent slug; try '/cc extend <slug> <task>'\`, end the turn.
- **Argument is \`extend <slug>\` (slug but no task)** — surface \`extend mode needs a follow-up task description; try '/cc extend <slug> <task>'\`, end the turn.
- **Argument is \`extend <slug> <task>\` AND a flow is active (\`currentSlug != null\`)** — collision case. Run the standard resume summary + r/s/n picker. On \`n\` (cancel the active flow), dispatch the extend flow as if no flow were active. On \`r\` or \`s\`, the user's choice wins; extend-mode dispatch is deferred until the active flow finalises.
- **Argument is \`extend <slug> <task>\` AND \`<slug>\` resolves to a shipped slug with \`outcome_signal: "reverted"\` in \`knowledge.jsonl\`** — proceed with extend init, but emit a one-line informational note: \`parent slug '<slug>' was later reverted — proceed only if you understand the revert.\` The user can still ship the follow-up; the note exists so a reverted parent does not become invisible context.
- **Argument starts with \`extend \` AND a ceremonyMode flag (\`--inline\` / \`--soft\` / \`--strict\`) is also present** — the explicit flag wins over inheritance (the user knows the new task's complexity better than the parent's classification did). Audit log records \`userOverrode: true\` when the chosen value differs from the parent's value.
- **Argument starts with \`extend \` AND the \`--mode=auto\` / \`--mode=step\` flag is also present** — the explicit toggle wins over inheritance (same precedence as ceremonyMode flags).
- **Argument is \`extend <slug> research <topic>\`** — extend mode takes precedence (the research-mode fork below does not fire when the argument begins with \`extend \`). The new flow extends \`<slug>\` and runs a normal task pipeline; the user wanting a research flow that extends a parent should run \`/cc research <topic>\` directly without the extend prefix.

## Multi-level chaining

v8.59 loads the **immediate** parent only. If \`parentContext.slug\` itself has \`refines:\` (its parent has a grandparent), the orchestrator does NOT auto-load the grandparent's artifacts. Specialists may walk the chain on demand via \`findRefiningChain\` in \`src/knowledge-store.ts\` when transitive context is needed (the helper walks parent → grandparent → great-grandparent until it hits a slug with no \`refines:\`). Multi-level auto-loading at orchestrator level is v8.60+ scope; the constraint here keeps the v8.59 context-loading bounded.

## Triage inheritance (fires only when \`parentContext\` is set at flow init)

When the Detect-hop extend-mode fork stamped \`flowState.parentContext\`, the orchestrator runs an **inheritance sub-step** BEFORE the v8.58 lightweight router's heuristic classifier. The sub-step reads the parent's shipped \`ship.md\` / \`plan.md\` frontmatter (best-effort; missing fields fall through to the router default) and seeds the new flow's triage with the parent's values:

- \`ceremonyMode\` ← parent's \`ceremony_mode\` (or pre-v8.56 \`ac_mode\`) from plan.md frontmatter, OR the value implied by the parent's ship.md when plan.md frontmatter is absent.
- \`runMode\` ← parent's \`run_mode\` from ship.md frontmatter (when present).
- \`surfaces\` ← parent's \`surfaces\` from plan.md / triage block (when present).

### Precedence rules (highest → lowest, evaluated in this order)

1. **Explicit override flag from the current \`/cc extend\`** — \`--strict\` / \`--soft\` / \`--inline\` for ceremonyMode; \`--mode=auto\` / \`--mode=step\` for runMode. Always wins; inheritance is bypassed for that field. Audit log records \`userOverrode: true\` when the chosen value differs from the parent's value.
2. **Escalation heuristic** — when the new \`<task>\` text matches an escalation pattern (\`security\` / \`auth\` / \`migration\` / \`schema\` / \`payment\` / \`gdpr\` / \`pci\`) AND the parent was \`soft\` or \`inline\`, escalate to \`strict\` for the new flow. One-line note to user: \`extend escalating <parent-mode> → strict (security-related keyword in task)\`. Mirrors the v8.23 no-git auto-downgrade audit shape.
3. **Parent inheritance** — fields not pinned by (1) or (2) inherit from parent's frontmatter.
4. **Router default** — fields not seeded by (1)-(3) fall through to the v8.58 lightweight router's heuristic classifier (same code path as a standard \`/cc <task>\` flow).

The inheritance is one-way: the new flow's triage values are immutable for its lifetime (except \`runMode\` via the v8.34 mid-flight toggle); changing them mid-flow requires \`/cc-cancel\` + a fresh \`/cc\`. The parent's values are never re-read after extend init.

### Worked examples

| user invocation | parent's \`ceremony_mode\` | parent's \`run_mode\` | new flow's \`ceremonyMode\` | new flow's \`runMode\` | rationale |
| --- | --- | --- | --- | --- | --- |
| \`/cc extend 20260514-auth-flow add OIDC\` | strict | step | strict | step | rule 3 (pure inheritance) |
| \`/cc extend 20260514-auth-flow --soft tighten error copy\` | strict | step | soft | step | rule 1 (explicit flag wins on ceremonyMode); rule 3 inherits runMode |
| \`/cc extend 20260514-auth-flow add SAML migration\` | soft | step | strict | step | rule 2 (escalation heuristic — \`migration\` keyword) |
| \`/cc extend 20260514-auth-flow --mode=auto tighten error copy\` | strict | step | strict | auto | rule 1 (explicit toggle wins on runMode); rule 3 inherits ceremonyMode |
| \`/cc extend 20260514-cli-help fix typo\` | inline | (null) | inline | (null) | rule 3 (inheritance); inline path has no runMode |
| \`/cc extend 20260514-old-slug refactor\` (where parent's plan.md frontmatter is absent) | (unknown) | (unknown) | (router heuristic decides) | (router heuristic decides) | rule 4 (router fallthrough) |

The audit log entry for the new flow's triage decision records:

\`\`\`json
{
  "decidedAt": "<iso>",
  "ceremonyMode": "strict",
  "runMode": "step",
  "rationale": "extend-mode inheritance from 20260514-auth-flow (parent: ceremony_mode=strict, run_mode=step)",
  "parentSlug": "20260514-auth-flow",
  "inheritanceSource": "parent-frontmatter",
  "userOverrode": false
}
\`\`\`

When \`userOverrode: true\` is recorded, the entry also includes a \`overrideField\` array (e.g. \`["ceremonyMode"]\`) so audit consumers can tell which field was explicitly flagged vs. which was inherited.

## What the orchestrator does NOT do at extend init

- **Auto-load grandparent artifacts.** v8.59 immediate-parent-only; multi-level traversal is opt-in via \`findRefiningChain\` from specialists.
- **Auto-detect extend intent from task text.** v8.59 ships the explicit \`/cc extend <slug>\` entry point only. Auto-detection (recognising "extend feature X" / "continue X" / "after slug Y" in a plain \`/cc <task>\`) is deferred to a future release — the v8.58 lightweight router is zero-question by default and adding a combined-form ask ("Looks like you're extending <slug>. Use parent context? [y/n]") would conflict with that contract. The deferred decision is recorded in \`.cclaw/flows/v859-continuation/design.md\` under "Decisions > D-7: auto-detection deferred".
- **Re-read parent state during the flow.** \`parentContext\` is stamped once at init and treated as immutable. If the parent's artifacts change after extend init (the parent is unshipped, re-shipped, or modified out-of-band), the new flow's view is stale and that is by design — specialists read the paths via \`await exists(path)\` and treat missing as a no-op skip.
- **Validate task overlap with the parent.** The orchestrator does not check whether the \`<task>\` text is coherent with the parent's scope; that's design's job (Phase 0 reads parent plan.md and surfaces the "Building on prior decisions" framing, then Phase 1 clarifies any contradictions).
- **Walk the knowledge store.** \`findNearKnowledge\` (v8.18) still runs at the specialist that consumes the result (\`ac-author\` Phase 3 on soft; \`design\` Phase 1 / Phase 4 on strict). When \`parentContext\` is set, the lookup augments rather than replaces; the parent's \`learnings.md\` ride alongside the global knowledge-store top-3 picks.

## Backwards compatibility

- **Pre-v8.59 state files** never carry \`parentContext\`. Readers default to \`null\`/absent meaning "cold-start flow, no parent". Migration is a no-op; the field is opt-in.
- **Pre-v8.59 shipped slugs** are valid extend targets. Their plan.md may not have a \`parent_slug:\` field; the orchestrator does not write one retroactively. The new flow's \`parentContext.slug\` is the canonical link.
- **\`priorResearch\` co-existence.** A \`/cc extend\` flow that also follows a \`/cc research\` ship reads BOTH context sources (the two fields are orthogonal on the FlowState type). Specialists merge the two when both are present; \`priorResearch\` is the bigger / fuzzier context, \`parentContext\` is the tighter / structured one.
- **Auto-detection deferral.** If a future release ships auto-detection, the entry point in this runbook stays unchanged — auto-detection becomes a second path into the same init code (the explicit \`/cc extend\` slug stays as the primary, unambiguous entry).
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
    title: "Finalize step",
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
    id: "handoff-gates",
    fileName: "handoff-gates.md",
    title: "Handoff gates (self-review + ship)",
    body: HANDOFF_GATES
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
    id: "pause-resume",
    fileName: "pause-resume.md",
    title: "Pause / resume mechanics (step / auto / Confidence gate)",
    body: PAUSE_RESUME
  },
  {
    id: "critic-steps",
    fileName: "critic-steps.md",
    title: "Critic steps (plan-critic + post-impl critic)",
    body: CRITIC_STEPS
  },
  {
    id: "qa-stage",
    fileName: "qa-stage.md",
    title: "QA step (v8.52+)",
    body: QA_STAGE
  },
  {
    id: "extend-mode",
    fileName: "extend-mode.md",
    title: "Extend-mode entry point (v8.59+)",
    body: EXTEND_MODE
  }
];

export const ON_DEMAND_RUNBOOKS_INDEX_SECTION = `## On-demand runbooks (v8.22)

These runbooks are opened only when the orchestrator hits a specific trigger (a dispatch, a parallel-build, a cap-reached review, etc.). The full \`/cc\` body keeps short pointers to each; the body lives here so the prompt budget stays under control.

| trigger | runbook |
| --- | --- |
${ON_DEMAND_RUNBOOKS.map((r) => `| ${r.title} | [\`${r.fileName}\`](./${r.fileName}) |`).join("\n")}
`;
