export interface AutoTriggerSkill {
  id: string;
  fileName: string;
  description: string;
  triggers: string[];
  body: string;
}

const PLAN_AUTHORING = `---
name: plan-authoring
trigger: when writing or updating .cclaw/flows/<slug>/plan.md
---

# Skill: plan-authoring

Use this skill whenever you create or modify any \`.cclaw/flows/<slug>/plan.md\`.

## Rules

1. **Frontmatter is mandatory.** Every plan starts with the YAML block from \`.cclaw/lib/templates/plan.md\`. Required keys: \`slug\`, \`stage\`, \`status\`, \`ac\`, \`last_specialist\`, \`refines\`, \`shipped_at\`, \`ship_commit\`, \`review_iterations\`, \`security_flag\`.
2. **AC ids are sequential** starting at \`AC-1\`. They must match the AC table inside the body.
3. **Each AC is observable.** Verification line is mandatory. If you cannot write the verification, the AC is not real.
4. **The traceability block at the end** is rebuilt by \`commit-helper.mjs\`. Do not edit it by hand once a commit was recorded.
5. **Out-of-scope items** stay in the body. Do not let them leak into AC.

## When refining a shipped slug

- Quote at most one paragraph from \`.cclaw/flows/shipped/<old-slug>/plan.md\`.
- Set \`refines: <old-slug>\` in the new plan's frontmatter.
- Do not copy the shipped AC verbatim — write fresh AC for the refinement.

## What to refuse

- Plans without AC.
- Plans whose AC count exceeds 12 (split first).
- Plans that change scope between brainstormer and planner without going back to brainstormer.
`;

const AC_TRACEABILITY = `---
name: ac-traceability
trigger: when committing changes for an active cclaw run
---

# Skill: ac-traceability

cclaw has one mandatory gate: every commit produced inside \`/cc\` references exactly one AC, and the AC ↔ commit chain is recorded in \`flow-state.json\`.

## Rules

1. Use \`node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="..."\` for every AC commit. Do not call \`git commit\` directly.
2. Stage only AC-related changes before invoking the hook.
3. The hook will refuse the commit if:
   - \`AC-N\` is not declared in the active plan;
   - \`flow-state.json\` schemaVersion is not \`2\`;
   - nothing is staged.
4. After the commit succeeds, the hook records the SHA in \`flow-state.json\` under the matching AC and re-renders the traceability block in \`plans/<slug>.md\`.
5. \`runCompoundAndShip\` refuses to ship a slug with any pending AC. There is no override.

## When you accidentally committed without the hook

- \`flow-state.json\` is now out of sync with the working tree.
- Run the hook manually for the affected AC: \`node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message="resync"\` while staging an empty change is not allowed; instead, edit \`.cclaw/state/flow-state.json\` to add the SHA to the AC entry by hand and verify with the orchestrator before continuing.
`;

const REFINEMENT = `---
name: refinement
trigger: when /cc detects an existing plan (active or shipped) for the new task
---

# Skill: refinement

\`/cc\` performs existing-plan detection at the start of every invocation. When it finds a fuzzy match, the user is asked to choose one of:

- **amend** — keep the active plan, add new AC, leave already-committed AC intact;
- **rewrite** — replace the active plan body and AC entirely (commits remain in git, but AC ids restart);
- **refine shipped** — create a new plan with \`refines: <old-slug>\` linking to the shipped slug;
- **new** — start an unrelated plan.

## Rules for refinement

1. \`refines: <old-slug>\` is set in the new plan's frontmatter and must match a real shipped slug.
2. Do not move artifacts out of \`.cclaw/flows/shipped/\`. The shipped slug stays read-only.
3. The new plan can quote up to one paragraph from the shipped plan but must restate the full Context for the refinement.
4. AC ids restart at AC-1 in the new plan. Do not number "AC-13" because the shipped slug had 12 AC.
5. \`knowledge.jsonl\` will record the new entry with \`refines: <old-slug>\` so the index forms a chain.

## What the orchestrator surfaces

- last_specialist of the active plan, so the user can see "stopped at architect" or "review iteration 3 in progress".
- The AC table with their statuses (\`pending\` / \`committed\`).
- Whether \`security_flag\` was set.
- A direct link to \`.cclaw/flows/shipped/<slug>/manifest.md\` if the match is a shipped slug.
`;

const PARALLEL_BUILD = `---
name: parallel-build
trigger: when planner topology = parallel-build
---

# Skill: parallel-build

\`parallel-build\` is the only parallelism allowed during build. It is opt-in. The orchestrator never picks it without planner naming it explicitly in \`plans/<slug>.md\` Topology section.

## Pre-conditions (all must hold)

1. **≥4 AC** in the plan.
2. **≥2 distinct touchSurface clusters** — there is at least one pair of AC whose \`touchSurface\` arrays are completely disjoint.
3. Every AC in a parallel wave carries \`parallelSafe: true\`.
4. No AC depends on outputs of another AC in the same wave.

For ≤4 AC the orchestrator picks \`inline\` even when AC look "parallelSafe". The git-worktree + sub-agent dispatch overhead is not worth saving 1-2 AC of wall-clock.

## Slice = 1+ AC with shared touchSurface

A **slice** is one or more AC whose \`touchSurface\` arrays intersect. AC with disjoint touchSurfaces go into different slices; AC with overlapping touchSurfaces stay in the **same** slice (run sequentially inside it). Each slice is owned by exactly one slice-builder sub-agent.

## Hard cap: 5 parallel slices per wave

If the slug produces more than 5 slices, **merge the thinner slices into fatter ones** (group AC by adjacent files / shared module) until you have ≤5. **Do not generate "wave 2", "wave 3", etc.** If after merging you still have >5 slices, the slug is too large — split it into multiple slugs.

This 5-slice cap is the v7-era constraint we kept on purpose:

- orchestration cost grows non-linearly past 5 sub-agents (context shuffling, integration review, conflict surface);
- 5 fits comfortably under the harness sub-agent quota everywhere we tested (Claude Code, Cursor, OpenCode, Codex);
- larger fan-outs reliably produce more integration findings than wall-clock saved.

## Execution

1. Orchestrator reads \`plans/<slug>.md\` Topology section, extracts the slice list (max 5).
2. For each slice, dispatch one \`slice-builder\` sub-agent. Pass:
   - the slice id,
   - the AC ids it owns,
   - the slice's \`touchSurface\` (the only paths the slice may modify),
   - the worktree path (see below).
3. Each slice-builder runs the full TDD cycle (RED → GREEN → REFACTOR) for every AC it owns, sequentially inside the slice, in its own working tree.
4. After all slice-builders return, the orchestrator invokes \`reviewer\` in mode \`integration\` (separate sub-agent if the harness supports it; inline otherwise). Integration reviewer checks path conflicts, double-edits, the AC↔commit chain across all slices, and integration tests covering the slice boundary.
5. If integration finds problems, the orchestrator dispatches \`slice-builder\` in \`fix-only\` mode against the cited file:line refs.

## Git-worktree pattern (when harness supports sub-agent dispatch)

Each parallel slice runs in its own \`git worktree\` rooted at \`.cclaw/worktrees/<slug>-<slice-id>/\`:

\`\`\`bash
$ git worktree add .cclaw/worktrees/<slug>-slice-1 -b cclaw/<slug>/slice-1
$ git worktree add .cclaw/worktrees/<slug>-slice-2 -b cclaw/<slug>/slice-2
$ git worktree add .cclaw/worktrees/<slug>-slice-3 -b cclaw/<slug>/slice-3
\`\`\`

Each slice-builder sub-agent runs with its worktree path as cwd. After all slices finish:

1. Integration reviewer reads from each worktree's branch.
2. The orchestrator merges \`cclaw/<slug>/slice-N\` into the main branch one slice at a time (or fast-forward if the wave was clean).
3. \`git worktree remove .cclaw/worktrees/<slug>-slice-N\` per slice; the cclaw branches stay until ship.

## Fallback: inline-sequential when sub-agent dispatch is unavailable

If the harness does not support sub-agent dispatch (or worktree creation fails — non-git repo, permission denied, etc.), \`parallel-build\` **degrades silently to \`inline\`** and runs all slices sequentially in the main working tree. The orchestrator records the fallback in \`builds/<slug>.md\`:

\`\`\`markdown
> Topology was \`parallel-build\` but the harness does not support sub-agent dispatch (or worktree creation failed). Slices ran sequentially in the main working tree.
\`\`\`

This degradation is not an error and does not reduce review depth.

## Hard rules

- \`integration\` mode reviewer is mandatory after every parallel wave. No shortcut.
- Slice-builders never read each other's worktrees mid-flight.
- A slice-builder that detects a conflict with another slice stops and raises an integration finding instead of hand-merging.
- More than 5 parallel slices is forbidden. Merge or split.
`;

const SECURITY_REVIEW = `---
name: security-review
trigger: when the diff touches authn / authz / secrets / supply chain / data exposure
---

# Skill: security-review

The orchestrator dispatches \`security-reviewer\` automatically when the active task or diff touches sensitive surfaces. You can also invoke it explicitly with \`/cc <task> --security-review\`.

## Rules

1. \`security-reviewer\` is a separate specialist from \`reviewer\`. They can run in parallel against the same diff.
2. \`security-reviewer\` decisions of severity \`security\` are block-level: ship is blocked until they are resolved by slice-builder mode=fix-only and the security review reruns clear.
3. \`security_flag: true\` in plan frontmatter triggers the compound learning gate even if no other quality signal is present.

## Threat-model checklist (mandatory)

For every \`threat-model\` invocation, write \`ok\` / \`flag\` / \`n/a\` for each:

1. Authentication
2. Authorization
3. Secrets (committed credentials, env, signing keys)
4. Supply chain (new third-party deps, version pinning, provenance)
5. Data exposure (logging, transmission, storage of user data)

## Pure UI / docs diffs

State explicitly that all five items are \`n/a\` and write a one-line justification per item. Do not skip the checklist.
`;

const REVIEW_LOOP = `---
name: review-loop
trigger: when reviewer or security-reviewer is invoked
---

# Skill: review-loop

Review is a producer ↔ critic loop, not a single pass. Iteration N proposes findings; \`slice-builder\` (in \`fix-only\` mode) closes them; iteration N+1 re-checks. The loop ends only when one of three convergence signals fires (see "Convergence detector" below). This is the cclaw analogue of the Karpathy "Ralph loop": short cycles, an explicit ledger, and hard rules for when to stop.

Every iteration runs the **Five Failure Modes** checklist:

1. Hallucinated actions
2. Scope creep
3. Cascading errors
4. Context loss
5. Tool misuse

For each mode the reviewer answers yes/no with a citation when "yes". A "yes" without a citation is itself a finding (you cited nothing, that is the finding).

## Concern Ledger

Every \`reviews/<slug>.md\` carries an append-only ledger. Each row is a single finding; rows are never edited or deleted, only appended.

\`\`\`markdown
## Concern Ledger

| ID | Opened in | Mode | Severity | Status | Closed in | Citation |
| --- | --- | --- | --- | --- | --- | --- |
| F-1 | 1 | code | block | closed | 2 | \`src/api/list.ts:14\` |
| F-2 | 2 | code | warn | open | – | \`tests/integration/list.test.ts:31\` |
\`\`\`

Rules:

- **F-N** ids are stable and global per slug — never renumber. If a finding is superseded, append \`F-K supersedes F-J\` instead.
- **Severity** is \`block\` | \`warn\`. \`block\` rows must close before ship; \`warn\` rows may ship with a recorded note in \`ships/<slug>.md\`.
- **Status** is \`open\` | \`closed\`. A closed row records the iteration that closed it.
- **Citation** is a real \`file:line\` (or test id, or commit SHA). No prose-only findings — if you cannot cite, you do not have a finding yet.

When iteration N+1 runs, the reviewer reads the ledger first, re-validates each open row (still open? closed by a fix? superseded?), then appends new findings as F-(max+1). Closing a row requires a citation to the fix evidence (commit SHA, test name, or new file:line).

## Convergence detector

The loop ends when ANY of these fires:

1. **All ledger rows closed.** Decision: \`clear\`. Ship may proceed.
2. **Two consecutive iterations append zero new \`block\` findings AND every open row is \`warn\`.** Decision: \`clear\` with warn carry-over recorded in \`ships/<slug>.md\` and \`learnings/<slug>.md\`.
3. **Hard cap reached** (5 iterations) with at least one open \`block\` row remaining. Decision: \`cap-reached\`. Stop; surface to user.

Tie-breaker: if iteration 5 closes the last \`block\` row, return \`clear\` (signal #1) even though the cap was hit. The cap exists to bound runaway loops, not to punish a slug that converges on the last attempt.

## Hard cap

- 5 review iterations per slug. After the 5th, the reviewer writes \`status: cap-reached\` and stops.
- The orchestrator surfaces every remaining open ledger row and recommends \`/cc-cancel\` (split into a fresh slug) or \`accept warns and ship\` (only valid if every remaining open row has severity=warn).

## Decision values

- \`block\` — at least one ledger row is severity=block + status=open. \`slice-builder\` (mode=fix-only) must run next; then re-review.
- \`warn\` — open rows exist, all severity=warn, convergence detector signal #2 has fired. Ship may proceed; warns carry over.
- \`clear\` — convergence detector signal #1 fired (all rows closed) OR signal #2 (warn-only convergence). Ready for ship.
- \`cap-reached\` — signal #3 fired with at least one open block row remaining. Stop; surface to user.

## Worked example — three-iteration convergence

\`\`\`markdown
## Iteration 1 — code — 2026-04-18T10:14Z

Findings:
- F-1 block — \`src/api/list.ts:14\` — missing pagination cursor.
- F-2 warn — \`tests/integration/list.test.ts:31\` — no negative test for empty page.

Decision: block. slice-builder (mode=fix-only) invoked next.

## Iteration 2 — code — 2026-04-18T10:39Z

Ledger reread:
- F-1: closed — fix at \`src/api/list.ts:18\` (commit 7a91ab2). Citation matches.
- F-2: open — no fix attempted (warn carry-over).

New findings: none.

Decision: warn. Convergence signal #2 needs another zero-block iteration.

## Iteration 3 — code — 2026-04-18T11:02Z

Ledger reread:
- F-1: closed (sticky).
- F-2: open (warn carry-over).

New findings: none. Two consecutive zero-block iterations recorded.

Decision: clear (signal #2). F-2 carries to ships/<slug>.md and learnings/<slug>.md.
\`\`\`

## Common pitfalls

- Adding "implicit" findings without citations because "the reviewer can see it". The reviewer cannot. Cite \`file:line\` or do not record the finding.
- Renumbering F-N ids when an old finding is superseded. Append a new row \`F-K supersedes F-J\`; never rewrite history.
- Closing a row without a fix citation. Closing is itself a claim — record the SHA / test name / file:line that proves the fix.
- Treating "no new findings" as instant clear. The convergence detector requires *two* consecutive zero-block iterations; one is not enough.
- Skipping the convergence check and looping until cap. The detector exists so easy slugs ship fast; do not waste budget.
- Mixing \`code\` and \`text-review\` modes within one iteration. Each iteration declares one mode in its header.
`;

const COMMIT_MESSAGE_QUALITY = `---
name: commit-message-quality
trigger: before every commit-helper.mjs invocation
---

# Skill: commit-message-quality

\`commit-helper.mjs\` accepts any non-empty message, but the AC traceability chain only stays useful if the messages stay readable.

## Rules

1. **Imperative voice** — "Add StatusPill component", not "Added" or "Adding".
2. **Subject ≤72 characters** — long subjects truncate in \`git log --oneline\` and CI signals.
3. **Subject does not repeat the AC id** — the hook already appends \`refs: AC-N\`.
4. **Body when needed** — second-line blank, then a short rationale paragraph and any non-obvious context. Use \`--message\` for the subject; if the message must be multi-line, write it to a file and pass \`--file\`.
5. **Cite finding ids in fix commits** — \`fix: F-2 separate rejected token\`.

## Anti-patterns

- "WIP", "fixes", "stuff", "more". The reviewer rejects these as F-1 \`block\`.
- Subject lines that paraphrase the diff. Diff is the diff; the message is the why.
- Co-author trailers in solo commits.

## When to amend

Never amend a commit produced by \`commit-helper.mjs\` after the SHA is recorded in \`flow-state.json\`. Amend changes the SHA and breaks the AC chain. If the message is wrong, write a short note in \`builds/<slug>.md\` and move on; it is recoverable in review.
`;

const AC_QUALITY = `---
name: ac-quality
trigger: when authoring or reviewing AC entries
---

# Skill: ac-quality

Three checks per AC:

1. **Observable** — a user, test, or operator can tell whether it is satisfied without reading the diff.
2. **Independently committable** — a single commit covering only this AC is meaningful.
3. **Verifiable** — there is an explicit verification line (test name, manual step, or command).

## Smell check

| smell | example | rewrite |
| --- | --- | --- |
| sub-task | "implement the helper" | "search returns BM25-ranked results for queries with multiple terms" |
| vague verification | "tests pass" | "verified by tests/unit/search.test.ts: 'returns BM25-ranked hits'" |
| internal detail | "refactor the cache" | "cache hit rate >90% on the dashboard repaint scenario" |
| compound AC | "build the page and add analytics" | split into two AC |

## Numbering

- AC ids start at \`AC-1\` and are sequential.
- Refinement slugs restart at \`AC-1\` even when they refine a slug that had AC-1..AC-12.
- Do not reuse an AC id within the same slug; if you delete an AC, the remaining ids stay sequential after compaction.

## When to add an AC mid-flight

You don't. Adding AC during build is scope creep. Either the new work fits an existing AC (no new id), or it should be a follow-up (\`/cc-idea\`) or a fresh slug.
`;

const REFACTOR_SAFETY = `---
name: refactor-safety
trigger: when the slug is identified as a pure refactor
---

# Skill: refactor-safety

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
- mark the old name with a \`@deprecated\` JSDoc / equivalent;
- record the deprecation deadline in \`ships/<slug>.md\`.

If the project policy forbids deprecation aliases (some libraries), the refactor is breaking; \`security_flag\` does not apply but breaking-change handling does (see breaking-changes skill).

## Verification

Refactor AC verification is "no behavioural diff": tests pass, snapshots unchanged, fixtures unchanged. If anything changes, the refactor leaked behaviour and must be split.
`;

const TDD_CYCLE = `---
name: tdd-cycle
trigger: always-on whenever stage=build (mandatory; build IS the TDD stage)
---

# Skill: tdd-cycle (RED → GREEN → REFACTOR)

build is a TDD stage. Every AC goes through the cycle. There is no other build mode.

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

## The three phases

### RED — write a failing test

- Touch test files **only**. No production edits in the RED commit.
- The test must encode the AC verification line authored by planner.
- The test must fail for the **right reason** — the assertion that encodes the AC, not a syntax / import / fixture error.
- Capture the runner output that proves the failure (command + 1-3 line excerpt). This is the **watched-RED proof**.
- **Test files are named by the unit under test, NOT by the AC id.** Mirror the production module path: \`src/lib/permissions.ts\` → \`tests/unit/permissions.test.ts\` (or whatever the project's convention is — \`*.spec.ts\`, \`__tests__/*.ts\`, \`*_test.go\`, \`test_*.py\`). \`AC-1.test.ts\`, \`tests/AC-2.test.ts\`, \`spec/ac3.spec.ts\` are anti-patterns. The AC id lives **inside** the test name (\`it('AC-1: tooltip shows email …', …)\`), in the commit message (\`red(AC-1): …\`), and in the build log — never in the filename.
- Commit: \`commit-helper.mjs --ac=AC-N --phase=red --message="red(AC-N): …"\`.

### GREEN — minimal production change

- Smallest possible production diff that turns RED into PASS.
- Run the **full relevant suite**, not the single test. A passing single test with the suite broken elsewhere is a regression, not GREEN.
- Capture the suite command + PASS/FAIL summary. This is the **GREEN evidence**.
- Touch only files declared in the plan. If a file outside the plan is required, **stop** and surface the conflict.
- Commit: \`commit-helper.mjs --ac=AC-N --phase=green --message="green(AC-N): …"\`.

### REFACTOR — mandatory pass

REFACTOR is **not optional**. Even when the GREEN diff feels minimal, you must consider rename / extract / inline / type-narrow / dedup / dead-code-removal. Run the same suite again; it must pass with **identical** expected output.

If a refactor is warranted, apply it and commit:

\`commit-helper.mjs --ac=AC-N --phase=refactor --message="refactor(AC-N): …"\`.

If no refactor is warranted, say so **explicitly**:

\`commit-helper.mjs --ac=AC-N --phase=refactor --skipped --message="refactor(AC-N) skipped: <reason>"\`.

Silence fails the gate.

## Mandatory gates per AC

\`commit-helper\` enforces (a) ↔ (e) mechanically. The reviewer checks (b), (d), (f), (g) on iteration 1.

(a) **discovery_complete** — relevant tests / fixtures / helpers / commands cited.\n(b) **impact_check_complete** — affected callbacks / state / interfaces / contracts named.\n(c) **red_test_recorded** — failing test exists, watched-RED proof attached.\n(d) **red_fails_for_right_reason** — RED captured a real assertion failure.\n(e) **green_full_suite** — full relevant suite green after GREEN.\n(f) **refactor_run_or_skipped_with_reason** — REFACTOR ran, or explicitly skipped with reason.\n(g) **traceable_to_plan** — commits reference plan AC ids and the plan's file set.\n(h) **commit_chain_intact** — RED + GREEN + REFACTOR SHAs (or skipped sentinel) recorded in flow-state.

## Anti-patterns

- "The implementation is obvious, skipping RED." A-13 — gate fails immediately.
- "Single test green, didn't run the suite." A-14 — that's not GREEN; it's a regression.
- "Nothing to refactor, skipping silently." A-15 — emit the explicit \`--skipped\` commit with reason.
- "Stage everything with \`git add -A\`." A-16 — staged unrelated edits leak into the AC commit.
- "Production code in the RED commit." A-17 — RED is test files only.
- **"Test file named after the AC id" — \`AC-1.test.ts\`, \`tests/AC-2.spec.ts\`, etc.** The reviewer flags this as \`block\`. Mirror the unit under test in the filename; carry the AC id inside the test name and commit message only.

## Fix-only flow

When reviewer returns \`block\`, the same TDD cycle applies to the fix:

- F-N changes observable behaviour → new RED test that encodes the corrected behaviour, then GREEN, then REFACTOR.
- F-N is purely a refactor → commit under \`--phase=refactor\`.
- F-N is a docs / log / config nit → commit under \`--phase=refactor\` or \`--phase=refactor --skipped\`.

The AC id stays the same; commit messages cite \`F-N\`.

## When TDD does not apply

The single exception is **bootstrap of the test framework itself** — a slug whose AC-1 is "test framework installed and one passing example test exists". In that case the orchestrator must mark the slug as \`build_profile: bootstrap\` in plan frontmatter, and \`commit-helper\` accepts the GREEN commit without a prior RED for AC-1 only. Every subsequent AC and every other slug uses the full cycle.
`;

const BREAKING_CHANGES = `---
name: breaking-changes
trigger: when the diff modifies public API surface or persisted contracts
---

# Skill: breaking-changes

A change is breaking when:

- a public export is renamed, removed, or changes signature;
- a CLI flag is renamed or removed;
- a wire format (HTTP, RPC, queue payload) changes shape or required fields;
- a persisted contract (DB schema, file format, env var) changes in a way that requires migration.

## Rules

1. **Plan must declare it.** Set \`breaking_change: true\` (or note it explicitly in the plan body).
2. **Migration must exist.** \`ships/<slug>.md\` carries a migration section: who is affected, what they need to do, when the old path stops working.
3. **Deprecation window.** Public libraries — at least one minor version. Internal services — at least one deploy cycle and one alert.
4. **Release notes.** The CHANGELOG line must start with \`BREAKING:\` and link to the migration section.

## Coexistence

When possible, ship the new path alongside the old. Examples:

- new endpoint path next to the old one;
- new column added before the old one is dropped;
- new env var name accepted along with the old (with a deprecation log line);
- new function exported with the new name; old name aliased to it.

Coexistence is not always possible (e.g. wire-format changes for older clients you cannot upgrade). When it is not possible, surface this back to architect; the decision must be recorded in \`decisions/<slug>.md\`.

## Common pitfalls

- "Internal API, not breaking." If the change crosses a service boundary, treat it as breaking.
- Renaming a CLI flag without an alias. Aliases for CLI flags are nearly always free; add them.
- Skipping the CHANGELOG line because "everyone knows". They do not.
- Forgetting the alert window for internal services. The deploy cycle is not enough; users need a heads-up.
`;

const CONVERSATION_LANGUAGE = `---
name: conversation-language
trigger: always-on
---

# Skill: conversation-language

cclaw is a harness tool. The harness has one user; the user has one language. Your conversational output must be in that language. Detect it from the user's most recent message and stay in it for the remainder of the turn.

## What MUST stay in the user's language

Everything that the user reads as prose:

- Status updates ("starting plan", "RED for AC-2 looks good").
- Questions you ask the user.
- Clarifications, recommendations, summaries, recaps.
- Error explanations and recovery suggestions.
- Diff explanations during review iterations.

If the user wrote to you in Russian, your status updates are in Russian. If the user wrote in Ukrainian, your status updates are in Ukrainian. If the user mixed languages, follow their dominant language; if there is no dominant language, mirror the language of their final paragraph.

Do NOT translate during the same conversation. The user has already chosen their language; restating the same point in English is noise.

## What MUST NOT be translated

Mechanical tokens stay in their original form regardless of conversation language:

- File paths (\`.cclaw/flows/<slug>/plan.md\`).
- AC ids (\`AC-1\`, \`AC-2\`).
- Decision ids (\`D-1\`, \`D-2\`).
- Slugs (\`add-approval-page\`, never "добавить-страницу-одобрения").
- Commands and CLI flags (\`/cc\`, \`--phase=red\`, \`commit-helper.mjs\`).
- Hook output and machine-readable JSON.
- Specialist names (\`brainstormer\`, \`architect\`, \`planner\`, \`reviewer\`, \`security-reviewer\`, \`slice-builder\`).
- Mode names (\`code\`, \`text-review\`, \`integration\`, \`release\`, \`adversarial\`, \`fix-only\`).
- Frontmatter keys (\`slug\`, \`stage\`, \`status\`, \`ac\`, \`phases\`).
- Stage names (\`plan\`, \`build\`, \`review\`, \`ship\`).
- TDD phase names (\`red\`, \`green\`, \`refactor\`).

These tokens are the wire protocol of cclaw. Translating them breaks tool calls, AC matching, frontmatter parsing, and the commit-helper hook. They are identifiers, not vocabulary.

## What MAY be in either language

Artifact bodies (the prose inside \`plans/<slug>.md\`, \`builds/<slug>.md\`, \`reviews/<slug>.md\`, \`ships/<slug>.md\`, \`decisions/<slug>.md\`, \`learnings/<slug>.md\`).

Default rule: write the artifact body in the same language as the user's conversation, because the artifact is for them and for the next agent who reads their notes. The frontmatter stays English (it is the wire protocol).

If the user explicitly asks for English-only artifacts ("write the plan in English so the rest of the team can read it"), honour the request. Otherwise stay in their language.

Commit messages: the AC line stays English (\`AC-N: …\`); the rest of the message body may follow the artifact-body language.

## Worked example — Russian conversation

User: "сделай мне CLI клиент для нашего REST API"

You (status): "Стартую план \`api-cli\`. Подтягиваю pattern \`api-endpoint.md\`. Пять AC: list, get, create, update, delete. Подтверждаешь?"

You (artifact \`flows/api-cli/plan.md\`):

\`\`\`markdown
---
slug: api-cli
stage: plan
status: active
ac:
  - id: AC-1
    text: list команда вызывает GET /resources и печатает таблицу.
    status: pending
---

# api-cli

…
\`\`\`

Note: slug stays \`api-cli\` (English, kebab-case); AC ids stay \`AC-1\` (English); frontmatter keys stay English; the AC body is in Russian.

You (commit message): \`AC-1: добавлен list-команд via fetch\`. The \`AC-1:\` prefix is English (commit-helper requires it); the message body is Russian.

## Common pitfalls

- Translating slugs ("добавить-cli" instead of "add-cli"). Slugs are filenames; keep them ASCII kebab-case.
- Translating frontmatter keys (\`статус: активен\`). Frontmatter is parsed by code; keys must be English.
- Restating the same status update twice ("Старт. — Starting."). Pick one. Match the user.
- Switching to English when the answer is "complicated". The user's complexity tolerance is not your language tolerance.
- Translating commit-helper output (\`[ошибка]\`). Hook output is read by the harness; leave it in English. Your own commentary on top of the hook output may be in the user's language.

## How to detect language

1. Read the user's last message. If it has at least one full sentence in language X, X is the language.
2. If the user mixed languages within one message, count tokens; pick the language with the most non-stopword tokens.
3. If still tied, default to the language of their previous-but-one message.
4. If there is no usable history (first turn, terse prompt), default to English. Do not guess from one ambiguous word.
`;

const ANTI_SLOP = `---
name: anti-slop
trigger: always-on for any code-modifying step (slice-builder, fix-only, recovery)
---

# Skill: anti-slop

cclaw takes its lean ethos seriously: **no busywork, no fake fixes, no fake progress.** This skill applies whenever you are writing code, modifying tests, debugging a build/lint/test failure, or running verification commands.

## Two iron rules

### 1. No redundant verification

Do not re-run the same build, test, or lint command twice in a row without a code or input change in between. The result will not change. If a check failed, change something — or stop and report the failure as a finding.

**What counts as a "change":**

- modified production source
- modified test file
- modified config / fixture / lockfile
- different argument set passed to the same tool (\`npm test\` → \`npm test -- --reporter=verbose --testNamePattern="AC-1"\` is OK; the same \`npm test\` twice is not)

**Red flags (do NOT do these):**

- "let me try the test again" without any edit
- "let me re-build" without any edit
- "let me re-lint" without any edit
- "let me check if the issue is still there" without any edit

If a tool succeeded once, do not run it a second time to "make sure". If it failed once, the second identical run will fail too.

### 2. No environment shims, no fake fixes

When a build / test / lint fails, **fix the root cause** or **surface the failure as a finding**. The following are anti-patterns; reviewer flags them as \`block\`:

- wrapping a real failure in \`try / catch\` and ignoring the error
- skipping a test (\`.skip\`, \`xit\`, \`@pytest.mark.skip\`, \`#[ignore]\`) "until later" without a follow-up issue or AC
- adding \`process.env.NODE_ENV === "test"\` (or equivalent) branches just to make tests pass
- adding \`// @ts-ignore\`, \`// eslint-disable\`, \`# noqa\`, \`# type: ignore\` to silence the failure rather than fix it
- short-circuiting a function with a hardcoded fixture value when "in test"
- mocking a function inline inside production code "just to get past this"
- writing a fallback that hides a real error path (\`return data ?? STUB_DATA\` where STUB_DATA exists only to dodge an upstream failure)
- copy-pasting a stack-trace into a try/catch as the "fix"

If the real fix is out of scope for the current AC, **stop**. Surface the failure and let the orchestrator hand the slug back to planner. Do not "make it work" with a shim and commit. Reviewer will catch the shim, the slug will fail review, and you will redo the work properly. Save the round-trip.

## When you are tempted to add a fallback

Ask yourself: *"what real failure is this fallback hiding?"* If the answer is "I don't know" or "the test was flaky", the fallback is slop. Find the real failure first.

## Worked example — slop vs root-cause

❌ slop:

\`\`\`ts
function getUser(id: string) {
  try {
    return db.users.find(id);
  } catch (e) {
    if (process.env.NODE_ENV === "test") return { id, name: "test-user" }; // makes the test pass
    throw e;
  }
}
\`\`\`

✅ root-cause:

\`\`\`ts
// (test fixture seeds a user before calling getUser; production code untouched)
beforeEach(async () => { await db.users.insert({ id: "u-1", name: "Anna" }); });
\`\`\`

## What to surface as a finding (and stop)

- **Root cause is in someone else's slug.** Surface as \`block\`: "AC-N depends on \`<file>\` which is owned by \`<other slug>\`. Cannot complete without the other slug shipping first."
- **Test framework is broken.** Surface as \`block\`: "test runner exits with \`<exact-error>\` independent of the test under change."
- **Plan is wrong.** Surface as \`info\`: "AC-N as written cannot be implemented without touching \`<file>\`, but the plan rules out that file."
- **Dependency upgrade required.** Surface as \`info\`: "AC-N requires \`<lib>@>=X\`, current is \`<Y>\`. Recommend separate dep-bump slug."

In all four cases: stop, return the summary JSON, do **not** push code that "works around it".

## What this skill does NOT prevent

- Re-running a build / test after you actually changed code. That is normal TDD GREEN-cycle behaviour.
- Adding a real test fixture or mock library at the test boundary (\`vi.mock("./db")\` in the *test file*, not in production). The boundary matters.
- Documented \`// eslint-disable\` lines with a one-line justification AND a follow-up issue id. The justification is what makes it not slop.
- Running \`tsc --noEmit\` after \`npm test\` — that is a different tool, not a re-run of the same one.
`;

export const AUTO_TRIGGER_SKILLS: AutoTriggerSkill[] = [
  {
    id: "plan-authoring",
    fileName: "plan-authoring.md",
    description: "Auto-applies whenever the agent edits .cclaw/flows/<slug>/plan.md.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "create:.cclaw/flows/*/plan.md"],
    body: PLAN_AUTHORING
  },
  {
    id: "ac-traceability",
    fileName: "ac-traceability.md",
    description: "Enforces commit-helper invocation and AC↔commit chain.",
    triggers: ["before:git-commit", "before:git-push"],
    body: AC_TRACEABILITY
  },
  {
    id: "refinement",
    fileName: "refinement.md",
    description: "Activates when /cc detects an existing plan match.",
    triggers: ["existing-plan-detected"],
    body: REFINEMENT
  },
  {
    id: "parallel-build",
    fileName: "parallel-build.md",
    description: "Rules and execution playbook for the parallel-build topology.",
    triggers: ["topology:parallel-build"],
    body: PARALLEL_BUILD
  },
  {
    id: "security-review",
    fileName: "security-review.md",
    description: "Activates when the diff touches sensitive surfaces.",
    triggers: ["security-flag:true", "diff:auth|secrets|supply-chain|pii"],
    body: SECURITY_REVIEW
  },
  {
    id: "review-loop",
    fileName: "review-loop.md",
    description: "Wraps every reviewer / security-reviewer invocation.",
    triggers: ["specialist:reviewer", "specialist:security-reviewer"],
    body: REVIEW_LOOP
  },
  {
    id: "tdd-cycle",
    fileName: "tdd-cycle.md",
    description: "Mandatory always-on skill while stage=build. Enforces RED → GREEN → REFACTOR per AC, with watched-RED proof and full-suite GREEN evidence.",
    triggers: ["stage:build", "specialist:slice-builder"],
    body: TDD_CYCLE
  },
  {
    id: "commit-message-quality",
    fileName: "commit-message-quality.md",
    description: "Enforces commit-message conventions for commit-helper.mjs.",
    triggers: ["before:commit-helper"],
    body: COMMIT_MESSAGE_QUALITY
  },
  {
    id: "ac-quality",
    fileName: "ac-quality.md",
    description: "Three-check rubric for every AC entry; smell tests + numbering rules.",
    triggers: ["edit:.cclaw/flows/*/plan.md", "specialist:planner", "specialist:reviewer:text-review"],
    body: AC_QUALITY
  },
  {
    id: "refactor-safety",
    fileName: "refactor-safety.md",
    description: "Behaviour-preservation rules for pure-refactor slugs.",
    triggers: ["task:refactor", "pattern:refactor"],
    body: REFACTOR_SAFETY
  },
  {
    id: "breaking-changes",
    fileName: "breaking-changes.md",
    description: "Detect and document breaking changes; coexistence rules and CHANGELOG template.",
    triggers: ["diff:public-api", "frontmatter:breaking_change=true"],
    body: BREAKING_CHANGES
  },
  {
    id: "conversation-language",
    fileName: "conversation-language.md",
    description: "Always-on policy: reply in the user's language; never translate paths, AC ids, slugs, hook output, or frontmatter keys.",
    triggers: ["always-on"],
    body: CONVERSATION_LANGUAGE
  },
  {
    id: "anti-slop",
    fileName: "anti-slop.md",
    description: "Always-on guard against redundant verification, env-specific shims, and silent skip-and-pass fixes.",
    triggers: ["always-on", "task:build", "task:fix-only", "task:recovery"],
    body: ANTI_SLOP
  }
];
