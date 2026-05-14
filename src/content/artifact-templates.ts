export interface ArtifactTemplate {
  id:
    | "plan"
    | "plan-soft"
    | "build"
    | "build-soft"
    | "review"
    | "critic"
    | "ship"
    | "decisions"
    | "learnings"
    | "manifest"
    | "ideas";
  fileName: string;
  description: string;
  body: string;
}

const PLAN_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
ac:
  - id: AC-1
    text: "Replace with the first observable outcome (something a user or test can verify)."
    status: pending
    parallelSafe: true
    touchSurface: []
    dependsOn: []
    rollback: "Replace with revert/disable strategy if this AC ships and breaks."
    posture: test-first  # v8.36 — one of: test-first | characterization-first | tests-as-deliverable | refactor-only | docs-only | bootstrap
  - id: AC-2
    text: "Replace with the second observable outcome, or delete this entry if one AC is enough."
    status: pending
    parallelSafe: true
    touchSurface: []
    dependsOn: []
    rollback: "Replace with revert/disable strategy if this AC ships and breaks."
    posture: test-first
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
feasibility_stamp: null  # green | yellow | red — set by ac-author before AC lock-in (T1-2)
---

# SLUG-PLACEHOLDER

> One short paragraph: what we are doing and why. If the goal does not fit in 4 lines, the request is probably too large — split it.

## Frame

_(Design Phase 2, when invoked. 2-5 sentences: what is broken or missing today, who feels it, what success looks like a user or test can verify, what is explicitly out of scope. Cite real evidence — \`file:path:line\`, ticket id, conversation excerpt — when you have it. If the orchestrator runs inline without design, leave a one-line summary here.)_

## Non-functional

_(Design Phase 2 authors this when invoked AND the slug is product-grade tier OR carries irreversibility — e.g. data-migration, public API, auth/payment surface, performance hot-path. v8.25 contract: large-risky only (soft-mode plans skip design Phase 2 and therefore have no NFR section). Optional and may be entirely absent on legacy plans. When the slug has no NFR concerns, write "none specified" inline against each axis rather than dropping the section — explicit "none" beats implicit silence for the reviewer's \`nfr-compliance\` axis gate.)_

- **performance:** _budgets (p50/p95/p99 latency, throughput, memory, bundle KB) or "none specified"._
- **compatibility:** _browser / runtime / Node / OS / dependency-version constraints, or "none"._
- **accessibility:** _a11y baseline (WCAG level, keyboard, screen-reader, contrast), or "none" for non-UI slugs._
- **security:** _auth / data-classification / compliance baseline; defer threat modelling to \`security-reviewer\` when \`security_flag: true\` — this row is the high-level posture only._

## Approaches

_(Design Phase 3, optional. Filled in \`guided\` or \`deep\` posture. Drop dead options before showing the table; do not pad to 3 rows for symmetry.)_

| Role | Approach | Trade-off | Reuse / reference |
| --- | --- | --- | --- |
| baseline | _approach_ | _trade-off_ | _reference_ |
| challenger | _approach_ | _trade-off_ | _reference_ |

## Selected Direction

_(Design Phase 3 closing paragraph when Approaches exists; cites the picked row and why.)_

## Decisions

_(Design Phase 4, when invoked. One D-N row per decision. Each row is independently citable. Replaces the separate \`decisions.md\` file from pre-v8.14 flows; on \`legacy-artifacts: true\` the separate file is still emitted.)_

- **D-1 — _short title_** — Context: _why this is a decision, not a default_. Options: _A / B / C with one-line tradeoff each_. Pick: _A_. Rationale: _why A over B, C in this slug_. Blast radius: _what changes if D-1 is reversed_. ADR: _none | proposed | promoted (path)_.

## Pre-mortem

_(Design Phase 5, optional. 2-4 ways this plan could fail; each line names the failure, the symptom, and the mitigation already encoded in the plan/AC.)_

- _failure_ → _symptom_ → _mitigation in AC-N / D-N_.

## Not Doing

_(Design Phase 2 / Phase 7 — 3-5 bullets explicitly out of scope. Protects against silent enlargement.)_

- _explicit non-commitment_
- _explicit non-commitment_

## Plan

_(AC author authors this. AC-aligned, not horizontal-layer. Each unit ships an end-to-end vertical slice for one AC.)_

- **Phase 1 — Foundation (AC-1).**
  - Concrete change with file:path:line reference.
- **Phase 2 — Wiring (AC-2, AC-3).**
  - Concrete change with file:path:line reference.

## Spec

_(v8.46 — mandatory on every plan.md (strict and soft). Four bullets capture the requirement-side contract that AC alone do not carry: intent + scope + non-goals + per-slug constraints. On small-medium plans the ac-author fills this section; on large-risky plans design Phase 2 (Frame) fills it alongside the NFR rows. Each bullet MUST be filled — write "none" or "n/a" when genuinely nothing applies; \`<TBD>\` or empty values are not acceptable. Existing legacy plans without this section continue to work; the section appears only on plans authored on v8.46+.)_

- **Objective**: _what we are building and why, in one short line._
- **Success**: _how we know it is done — high-level indicators (e.g. "users can rename a task without losing comments"), NOT the AC bullets below._
- **Out of scope**: _explicit non-goals derived from triage + framing. Write "none" if not applicable._
- **Boundaries**: _per-slug "ask first" / "never do" notes layered on top of the iron-laws (e.g. "do not break public API", "preserve current cache keys"). Write "none" when iron-laws cover it._

The reviewer's existing axes (correctness, architecture, complexity-budget) implicitly cover the Spec section — a build that does not match the recorded Objective is a \`correctness\` finding; scope creep past \`Out of scope\` is an \`architecture\` or \`complexity-budget\` finding. No new reviewer axis is introduced; the 7-axis (+ gated NFR) count is stable.

## Acceptance Criteria

| id | text | status | parallelSafe | dependsOn | touchSurface | rollback | posture | commit |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| AC-1 | _Replace with the first observable outcome._ | pending | true | _none_ | _list of repo paths_ | _revert / disable / migration-rollback strategy_ | test-first | — |
| AC-2 | _Replace or delete._ | pending | true | _AC-1_ | _list of repo paths_ | _revert / disable / migration-rollback strategy_ | test-first | — |

The AC block is the source of truth. Every strict-mode commit produced inside the flow references exactly one AC id via a posture-driven subject-line prefix (\`red(AC-N): ...\` / \`green(AC-N): ...\` / \`refactor(AC-N): ...\` / \`test(AC-N): ...\` / \`docs(AC-N): ...\`); the reviewer reconstructs the AC↔commit chain ex-post via \`git log --grep="(AC-N):" --oneline\` at handoff and ship time.

- \`parallelSafe: false\` opts the AC out of parallel-build dispatch.
- \`dependsOn\` is a list of AC ids that must be \`status: committed\` before this AC enters slice-builder. Use \`none\` (or empty) when the AC has no predecessors. The reviewer cross-checks the dependency graph against the AC commit order — out-of-order commits are a \`required\` finding.
- \`touchSurface\` is the list of repo-relative paths the AC is allowed to modify.
- \`rollback\` is the explicit revert / disable / migration-rollback strategy if this AC ships and breaks in production. Required in strict mode; one short sentence per AC. "Same as AC-N" is acceptable for siblings that share the same rollback path. \`none\` is **not** acceptable — every AC has a rollback story, even if it is "revert the single commit".
- \`posture\` (v8.36) is one of \`test-first\` (default) | \`characterization-first\` | \`tests-as-deliverable\` | \`refactor-only\` | \`docs-only\` | \`bootstrap\`. The slice-builder reads this field to select the commit ceremony (which posture-driven prefix sequence to write); the reviewer's \`src/posture-validation.ts:POSTURE_COMMIT_PREFIXES\` mapping is the canonical source for which prefixes are expected per posture, and \`src/posture-validation.ts:validatePostureTouchSurface\` cross-checks the \`docs-only\` and \`tests-as-deliverable\` postures against the touchSurface. See \`.cclaw/lib/skills/tdd-and-verification.md\` for the posture-to-ceremony mapping. Default is \`test-first\` (standard RED → GREEN → REFACTOR cycle).

Each AC must point at a real \`file:line\` or destination path.

## Feasibility stamp

_(AC author-authored before AC lock-in. One of \`green\` / \`yellow\` / \`red\`; copy into frontmatter \`feasibility_stamp\`.)_

- **green** — surface ≤3 modules, all AC have direct test analogues, no new dependencies, dependency chain ≤2 hops.
- **yellow** — surface 4-6 modules, OR one AC depends on a not-yet-existing test fixture, OR one new dependency (with rationale), OR dependency chain 3-5 hops.
- **red** — surface ≥7 modules, OR multiple AC depend on not-yet-existing fixtures/types, OR ≥2 new dependencies, OR dependency chain ≥6 hops, OR security flag set without a design D-N covering the sensitive surface. **Red feasibility blocks build dispatch in strict mode** until the ac-author re-decomposes (likely splitting into multiple slugs) or the orchestrator re-enters design Phase 4 to record the missing D-N.

The stamp is computed once per plan, before slice-builder enters. The reviewer cross-checks the stamp against the realised diff at review time; an \`actual_complexity > stamp\` is a \`consider\`-severity finding for future calibration.

## Edge cases

_(AC author-authored. One bullet per AC naming the non-happy-path the slice-builder's RED test must encode.)_

- **AC-1** — _empty input / boundary / error response_.
- **AC-2** — _hover under 100ms / missing fixture / etc_.

## Topology

_(AC author topology mode. Default: \`inline\`. \`parallel-build\` is opt-in; see lib/skills/parallel-build.md for rules.)_

- topology: inline
- slices: _none_

## Traceability block

- AC-1 → commit pending
- AC-2 → commit pending

This block is filled in by the slice-builder as each AC's commits land (one SHA per phase: \`red\` → \`green\` → \`refactor\`); the reviewer's posture-aware \`git log --grep="(AC-N):" --oneline\` scan reconciles it against the actual git history at handoff and ship time. Do not edit by hand once an AC's row in \`build.md\` carries SHAs.
`;

const PLAN_TEMPLATE_SOFT = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
ac_mode: soft
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# SLUG-PLACEHOLDER

> One short paragraph: what we are doing and why. If the goal does not fit in 4 lines, the request is probably too large — split it or re-triage to large-risky.

## Plan

_(AC author authors this. One short paragraph describing the change end-to-end. No phases, no AC IDs.)_

## Spec

_(v8.46 — mandatory. Four bullets capturing the requirement-side contract. Each bullet MUST be filled — "none" or "n/a" are acceptable when genuinely nothing applies; \`<TBD>\` and empty values are not. The ac-author authors this on small-medium (soft) plans.)_

- **Objective**: _what we are building and why, in one short line._
- **Success**: _how we know it is done — high-level indicators, NOT the testable conditions below._
- **Out of scope**: _explicit non-goals; "none" if not applicable._
- **Boundaries**: _per-slug "ask first" / "never do" notes; "none" if iron-laws cover it._

## Testable conditions

_(Bullet list. Each line is a behaviour the slice-builder's tests must verify. Conditions are observable; if you can't name a test or manual step that proves it, drop the bullet.)_

- _Condition 1 — observable behaviour, e.g. "Pill renders the request status (Pending / Approved / Denied)."_
- _Condition 2._
- _Condition 3._

## Verification

_(One block per layer. Tests file paths, manual steps, runner command.)_

- \`tests/unit/<module>.test.ts\` — covers all listed conditions in one test file.
- Manual: _open <url>, perform <action>, observe <outcome>_.

## Touch surface

_(Files the slice-builder is allowed to modify. Used by reviewer to flag scope creep.)_

- \`src/<module>/<file>.ts\`
- \`tests/unit/<module>.test.ts\`

## Notes

_(Optional. The \`design\` phase does NOT run for soft-mode (small/medium) flows; if you discover the work needs structural decisions, alternative comparison, or threat modelling mid-flight, surface back to the orchestrator and ask to re-triage as large-risky so design Phase 1-7 can run.)_
`;

const BUILD_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: build
status: active
build_iterations: 0
last_commit: null
tdd_cycle: enforced
---

# Build log — SLUG-PLACEHOLDER

This is the TDD implementation journal. Every AC goes through RED → GREEN → REFACTOR (or its posture-specific shape); every phase is a separate commit with a posture-driven subject-line prefix (\`red(AC-N): ...\` / \`green(AC-N): ...\` / \`refactor(AC-N): ...\` / \`refactor(AC-N) skipped: ...\` / \`test(AC-N): ...\` / \`docs(AC-N): ...\`) the reviewer reads via \`git log --grep="(AC-N):" --oneline\`.

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

## Plan summary

_(One paragraph mirroring \`plans/SLUG-PLACEHOLDER.md\` Plan section.)_

## TDD cycle log

For every AC, append one row with **all six columns filled** before the AC is considered done.

| AC | Discovery | RED proof | GREEN evidence | REFACTOR notes | commits |
| --- | --- | --- | --- | --- | --- |
| AC-1 | _file:path:line refs from discovery_ | _failing test name + 1-3 line failure excerpt_ | _full-suite command + PASS summary_ | _shape change or "skipped: reason"_ | _red SHA, green SHA, refactor SHA (or "skipped")_ |

## Watched-RED proofs

\`\`\`text
_(Per AC: command run, test name, 1-3 line failure excerpt that proves RED failed for the right reason.)_
_AC-1: npm test src/lib/permissions.ts -- -t "renders email"_
_         AssertionError: expected 'anna@example.com' got undefined_
\`\`\`

## GREEN suite evidence

\`\`\`text
_(Per AC: command run, PASS/FAIL summary of the FULL relevant suite — not the single test.)_
_AC-1: npm test src/lib/__       47 passed, 0 failed (in 1.8s)_
\`\`\`

## REFACTOR notes

_(Per AC: one-line shape change applied, or explicit "skipped: <reason>". Silence is not acceptable; the gate forces the question.)_

- AC-1: extracted \`hasViewEmail\` helper from inline check.

## Coverage assessment

_(Per AC, written between GREEN and REFACTOR. One row per AC. Verdict is one of \`full\` / \`partial\` / \`refactor-only\`. \`partial\` is a valid verdict — name the uncovered branch and the reason; an absent row is **not** a valid verdict and the reviewer treats it as severity=\`required\`, axis=correctness.)_

| AC | Verdict | Branches covered (file:line) | Branches uncovered + reason |
| --- | --- | --- | --- |
| AC-1 | _full_ | _src/lib/permissions.ts:18 truthy branch (RED test); src/lib/permissions.ts:24 falsy branch (pre-existing test tests/unit/permissions.test.ts:11)_ | _none_ |

## Fix iterations (after a review block)

_(Append one fix-iteration block per review iteration that returned \`block\`. Same TDD cycle applies; same AC id is reused; finding F-N is cited in the message.)_

### Fix iteration 1 — review block 1

| F-N | AC | phase | commit | files | note |
| --- | --- | --- | --- | --- | --- |
| F-2 | AC-1 | red | _SHA_ | _tests/...:line_ | _what the new RED encodes_ |
| F-2 | AC-1 | green | _SHA_ | _src/...:line_ | _minimal fix_ |
| F-2 | AC-1 | refactor (skipped) | — | — | _reason_ |

## Commits

- \`git commit -m "red(AC-1): …"\` → _SHA_ (test files only)
- \`git commit -m "green(AC-1): …"\` → _SHA_ (production diff)
- \`git commit -m "refactor(AC-1): …"\` → _SHA_  OR  \`git commit --allow-empty -m "refactor(AC-1) skipped: <reason>"\` → _SHA_ (empty marker)

## Notes

_(Surprises, deviations from the plan, tests added, refactors that came up, paths considered and discarded, etc.)_
`;

const BUILD_TEMPLATE_SOFT = `---
slug: SLUG-PLACEHOLDER
stage: build
status: active
ac_mode: soft
last_commit: null
---

# Build log — SLUG-PLACEHOLDER

This is the soft-mode build log. One TDD cycle covers all listed conditions; commits are plain \`git commit -m "<feat|fix|...>: <one-line>"\` with no per-AC prefix (the reviewer reads this file plus the feature-level commit at ship time).

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

## Plan summary

_(One paragraph mirroring \`flows/SLUG-PLACEHOLDER/plan.md\` Plan section.)_

## Build log

- **Tests added**: _\`tests/unit/<module>.test.ts\` — N tests, mirroring the listed conditions._
- **Discovery**: _\`src/<module>/<file>.ts:<line>\`, \`tests/unit/<existing>.test.ts:<line>\`._
- **RED**: _\`<runner command>\` → N failing (expected). Cite the assertion that fails (≤3 lines)._
- **GREEN**: _One sentence on the minimal change. \`<full-suite command>\` → all passing._
- **Coverage**: _Verdict \`full\` / \`partial\` / \`refactor-only\` + which branches are anchored by which test file:line. \`partial\` is valid (name the uncovered branch + reason); absent line is not._
- **REFACTOR**: _One-line shape change applied, or "skipped: <reason>"._
- **Commit**: _\`<one-line message>\` (\`<SHA>\`)._
- **Follow-ups**: _\`info\` items deferred to a separate slug, or "none"._

## Notes

_(Surprises, deviations from the plan, paths considered and discarded, etc.)_
`;

const REVIEW_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: review
status: active
review_iterations: 0
iteration: 0
total_findings: 0
deduped_from: 0
modes_run:
  - code
findings_block: []
ledger_open: 0
ledger_closed: 0
zero_block_streak: 0
---

# Review — SLUG-PLACEHOLDER

This is the review log. \`reviewer\` (and \`security-reviewer\`, when relevant) append findings here. The loop is producer ↔ critic: iteration N proposes findings, \`slice-builder\` (mode=fix-only) closes them, iteration N+1 re-checks. The loop ends when the convergence detector fires (see review-discipline skill (v8.16 merge of review-loop + security-review)).

## Run summary

| iteration | mode | reviewer | result | new_block | closed_block |
| --- | --- | --- | --- | --- | --- |
| 1 | code | reviewer | _pending_ | _N_ | _N_ |

Hard cap: 5 iterations. After the 5th, stop and surface what remains in the ledger.

## Findings (append-only)

Stable global ids per slug. Rows are never edited or deleted, only appended. Closing a row requires a citation to the fix evidence (commit SHA, test name, or new file:line).

| ID | Opened in | Mode | Severity | Status | Closed in | Citation |
| --- | --- | --- | --- | --- | --- | --- |
| F-1 | 1 | code | _block / warn_ | _open / closed_ | _N or –_ | \`path:line\` or commit SHA |

Severity rules:

- \`block\` — must close before ship.
- \`warn\` — may ship; carries to \`ships/<slug>.md\` and \`learnings/<slug>.md\`.

## Iteration logs

\`\`\`markdown
## Iteration N — <mode> — <ISO timestamp>

Ledger reread:
- F-K: <closed | open | superseded by F-L> — <citation>

New findings:
- F-M <severity> — \`<path:line>\` — <description> → <proposed fix>

Five Failure Modes:
- Hallucinated actions: no / yes (cite)
- Scope creep: no / yes (cite)
- Cascading errors: no / yes (cite)
- Context loss: no / yes (cite)
- Tool misuse: no / yes (cite)

Decision: <block | warn | clear | cap-reached>
\`\`\`

## Convergence detector

The loop ends when ANY signal fires:

1. All ledger rows closed → \`clear\`.
2. Two consecutive iterations with zero new \`block\` findings AND every open row is \`warn\` → \`clear\` (warn carry-over).
3. Hard cap reached with at least one open \`block\` row → \`cap-reached\`.

Tie-breaker: if iteration 5 closes the last block row, return \`clear\` (signal #1) regardless of cap.

## Decision values

- **block** — at least one open block row. slice-builder (fix-only) addresses them; re-review next iteration.
- **warn** — convergence signal #2 fired. Open warns carry over. Ship may proceed.
- **clear** — signal #1 (all closed) or signal #2 (warn-only convergence). Ready for ship.
- **cap-reached** — signal #3. Stop; orchestrator surfaces remaining open rows to the user; user picks \`/cc-cancel\` or \`accept warns and ship\` (only valid if every open row is severity=warn).
`;

const CRITIC_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: critic
status: active
posture_inherited: PLAN-POSTURE-PLACEHOLDER  # most-restrictive AC posture from plan.md frontmatter
ac_mode: AC-MODE-PLACEHOLDER                  # inline | soft | strict (mirrors flow-state.json > triage.acMode)
generated_at: GENERATED-AT-PLACEHOLDER        # ISO timestamp at dispatch time
mode: gap                                     # gap | adversarial
predictions_made: 0                           # count of pre-commitment predictions in §1
gaps_found: 0                                 # count of gaps in §2 + §3 + §4 + §5
escalation_level: none                        # none | light | full
escalation_triggers: []                       # list of trigger strings — see critic prompt body §8
verdict: pending                              # pending | pass | iterate | block-ship
token_budget_used: 0                          # orchestrator stamps this from the sub-agent return
critic_iteration: 1                           # 1 on first dispatch; only ever 2 on a single rerun (hard cap)
---

# Critic — SLUG-PLACEHOLDER

This artifact captures the adversarial critic pass over the slug. The critic runs at the critic step — after the reviewer clears, before the ship gate begins. The critic is a **separate stance** from the reviewer: the reviewer asks "does the code meet the AC?"; the critic asks "is the AC the right AC, what could we have missed, and what would I predict goes wrong?"

The critic is read-only on the codebase. Every finding cites a \`file:line\` or a backtick-quoted excerpt from \`plan.md\` / \`build.md\` / \`review.md\`.

> **Iron Law (critic):** EVIDENCE BEFORE CLAIMS. A prediction without a citation is speculation; a gap without a cited absence is hand-waving. The critic must show its work.

## 1. Pre-commitment predictions

_(Authored BEFORE the critic reads \`build.md\` and \`review.md\` in detail. 3-5 predictions in gap mode; 5-7 in adversarial mode. Each prediction names a verification path and a final outcome.)_

| # | Prediction | Rationale (from plan.md / prompt / priors) | Verified-against-build | Outcome |
| --- | --- | --- | --- | --- |
| P-1 | _e.g. "AC-2's edge case 'empty input' is not exercised by any test"_ | _e.g. "plan.md AC-2 verification line names handle_empty but build.md TDD log has no AC-2 RED for empty input"_ | _file:line citation from build.md_ | _confirmed / refuted / partial_ |
| P-2 | _e.g. "AC-1 commits include a drive-by edit to an adjacent file"_ | _e.g. "plan.md touchSurface lists 2 files; design Phase 4 D-1 ruled out broader refactor"_ | _git diff --stat citation_ | _confirmed / refuted / partial_ |
| P-3 | _e.g. "Pre-mortem from design Phase 5 was skipped; high-irreversibility decisions exist without failure-mode coverage"_ | _e.g. "frontmatter \`posture: guided\`; D-2 introduces a schema change with no rollback line"_ | _plan.md \`## Pre-mortem\` absence / D-2 body_ | _confirmed / refuted / partial_ |

## 2. Gap analysis (what's missing)

_(The OMC "What's Missing" section. Walk the slug and ask, for each item, "what is absent?" — AC-coverage gaps, edge-case coverage gaps, NFR coverage gaps, decision implementation gaps, scope creep, untested edge cases, false assumptions.)_

| G-N | Class | Severity | Anchor | Description | Suggested patch | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G-1 | _AC-coverage / edge-case / NFR / decision / scope-creep / untested / false-assumption_ | _block-ship / iterate / fyi_ | _plan.md > AC-N \\| build.md row \\| file:line_ | _what is missing and why it matters_ | _smallest correct change to close the gap_ | _open / closed-by-iteration_ |

**Severity definitions** (critic's own vocabulary; do NOT merge with reviewer's \`critical\`/\`required\`/\`consider\`/\`nit\`/\`fyi\` ledger):

- **\`block-ship\`** — closing this gap requires re-opening build or review. The slug is structurally not done.
- **\`iterate\`** — gap is real but addressable in a fix-only iteration after ship (captured in learnings.md, carried as a follow-up).
- **\`fyi\`** — gap is information-only; no action expected.

## 3. Adversarial findings (gap + adversarial mode only)

_(Skipped in gap mode unless escalation fires. Emitted in full in adversarial mode. Four techniques: assumption violation, composition failures, cascade construction, abuse cases.)_

### 3a. Assumption violation

| F-N | Assumption | Violation scenario | Code path that breaks | Severity |
| --- | --- | --- | --- | --- |
| F-1 | _e.g. "src/api/list.ts:14 assumes the upstream API returns non-empty JSON"_ | _e.g. "API returns 204 No Content during deployment"_ | _e.g. "src/api/list.ts:18 — \`JSON.parse(empty)\` throws; no try/catch"_ | _block-ship / iterate / fyi_ |

### 3b. Composition failures

| F-N | Boundary | Mismatch | Failure consequence | Severity |
| --- | --- | --- | --- | --- |
| F-2 | _e.g. "src/auth/middleware.ts ↔ src/api/list.ts"_ | _e.g. "middleware throws AuthError, caller catches Error (parent), error message leaks"_ | _e.g. "internal stack trace returned to user"_ | _block-ship / iterate / fyi_ |

### 3c. Cascade construction

| F-N | Trigger | Chain | Final failure state | Severity |
| --- | --- | --- | --- | --- |
| F-3 | _e.g. "src/cache/refresh.ts:42 — initial fetch times out"_ | _e.g. "retry logic at :47 → 5 retries → all timeout → fallback to stale → stale returned for 5min"_ | _e.g. "5min window of stale data during real outage"_ | _block-ship / iterate / fyi_ |

### 3d. Abuse cases

| F-N | Pattern | Trigger | Bad outcome | Severity |
| --- | --- | --- | --- | --- |
| F-4 | _e.g. "user submits same form rapidly"_ | _e.g. "no debounce, no idempotency key"_ | _e.g. "duplicate orders created"_ | _block-ship / iterate / fyi_ |

## 4. Self-audit on AC quality (is the AC the right AC, not is it met?)

_(Goal-backward, per-AC. Re-read the user's original prompt and verify each AC actually solves the user-stated problem.)_

| AC | User asked for | AC promises | Aligned? | Drift note (if any) |
| --- | --- | --- | --- | --- |
| AC-1 | _e.g. "make the invite list refresh when a user clicks Refresh"_ | _e.g. "InviteList component re-fetches /api/invites on click of the Refresh button"_ | _yes / partial / no_ | _e.g. "AC asks for re-fetch; user said 'refresh' which could mean re-render with cached data."_ |

## 5. Goal-backward verification (slug-level)

1. **Goal stated** (from \`plan.md > ## Frame\`): _<one sentence>_
2. **What shipped** (from \`build.md > ## TDD cycle log\` + \`review.md > Findings\` closed rows): _<one sentence>_
3. **Outcome:** _\`solved\` / \`partial\` / \`drifted\`_
4. **Gap (if partial or drifted):** _<one sentence; emit a G-N finding in §2 — class=AC-coverage for partial, class=scope-creep for drifted>_

## 6. Realist check (mandatory)

_(Pressure-test the severity of every \`block-ship\` and \`iterate\` finding. Downgrade only with a real-world \`Mitigated by\` — NEVER downgrade data loss, security breach, or financial impact findings.)_

For each \`block-ship\` and \`iterate\` finding (G-N and F-N alike):

1. **Realistic worst case.** What would actually happen — not the theoretical maximum?
2. **Mitigating factors.** Existing tests, deployment gates, monitoring, feature flags, prior shipped slugs — do any substantially contain the blast radius?
3. **Detection time.** Immediately, within hours, or silently?
4. **Hunting-mode bias check.** "Am I inflating severity because I found momentum during the review?"

Recalibrations (cite verbatim — "G-2 downgraded block-ship → iterate (Mitigated by: ...)"):

- _<list>_

## 7. Verdict

\`\`\`text
Verdict: <pass | iterate | block-ship>
Predictions: <N made; N_confirmed confirmed, N_refuted refuted, N_partial partial>
Gaps found: <N total; N_block_ship block-ship, N_iterate iterate, N_fyi fyi>
Adversarial findings: <N total (gap mode: 0); N_block_ship / N_iterate / N_fyi>
Goal-backward: <solved | partial | drifted>
Escalation: <none | light | full>; <triggers cited verbatim>
Realist recalibrations: <list, e.g. "G-2 downgraded block-ship → iterate (Mitigated by: ...)">
Confidence: <high | medium | low>
Confidence rationale: <one line; required when Confidence != high>
\`\`\`

## 8. Summary — critic

### Changes made

- _N predictions recorded (M confirmed, K refuted, L partial)._
- _N gaps catalogued (M block-ship, K iterate, L fyi)._
- _N adversarial findings (gap mode: skipped this section)._
- _Goal-backward verdict: <one word>._

### Things I noticed but didn't touch

- _Anything observed during reading that is outside the critic's lane (e.g. "the review.md Findings table has a closed row whose citation looks weak; flagging for next reviewer pass, not raising as gap here")._

### Potential concerns

- _Anything the critic could not verify and the orchestrator may want to surface to the user (e.g. "P-3 was about a runtime path I could not exercise from read-only context; recommend manual verification before ship")._
`;

const SHIP_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: ship
status: active
ship_commit: null
push_approved: false
pr_url: null
finalization_mode: null
preflight_passed: false
rollback_recorded: false
repo_mode: git
---

# Ship notes — SLUG-PLACEHOLDER

This artifact is written just before \`runCompoundAndShip()\` archives the run. It must contain enough information for downstream operators to understand what shipped without opening every other artifact.

> **Iron Law:** NO MERGE WITHOUT GREEN PREFLIGHT, A WRITTEN ROLLBACK, AND EXACTLY ONE SELECTED FINALIZATION MODE. No exceptions for urgency. If no VCS is available, use \`FINALIZE_NO_VCS\` explicitly instead of inventing git steps.

## Summary

_(2-4 lines: what changed, who needs to know.)_

## Preflight checks (mandatory; fresh output in this artifact)

Every check below must produce fresh output in this section. Pasting "tests passed yesterday" does not count.

| Check | Command | Result | Notes |
| --- | --- | --- | --- |
| tests | _e.g._ \`npm test\` | _pass / fail_ | _file paths or test names_ |
| build | _e.g._ \`npm run build\` | _pass / fail_ | _output stderr lines_ |
| linter | _e.g._ \`npm run lint\` | _pass / fail_ | _file paths_ |
| type-check | _e.g._ \`npm run typecheck\` or \`tsc --noEmit\` | _pass / fail_ | _error count_ |
| clean tree | \`git status --porcelain\` | _empty / non-empty_ | _file paths_ |

Set \`preflight_passed: true\` in the frontmatter only when every row is pass/empty.

## Repository mode detection

Run \`test -d .git && echo git || echo no-vcs\`. Result: _git / no-vcs_.

If no-vcs, the only valid finalization mode is \`FINALIZE_NO_VCS\`; document the manual handoff target and rollback owner in the relevant sections.

## Merge-base detection (git mode only)

Run \`git merge-base HEAD <base-branch>\`. If the base has diverged significantly, flag for rebase-first BEFORE proceeding to finalization.

\`\`\`bash
$ git merge-base HEAD main
<sha>

$ git rev-list --count <sha>..main
N commits behind main
\`\`\`

If \`N > 0\` and any of those commits touch this slug's \`touchSurface\`, rebase first. Re-run preflight after the rebase; do not trust the prior preflight result.

## AC ↔ commit map

| AC | text (one line) | red SHA | green SHA | refactor SHA | description |
| --- | --- | --- | --- | --- | --- |
| AC-1 | _AC text_ | _sha_ | _sha_ | _sha or skipped_ | _short description_ |

This table mirrors \`flows/SLUG-PLACEHOLDER/plan.md > Acceptance Criteria\` with the final SHAs reconstructed from \`git log --grep="(AC-N):" --oneline\` for every AC in the plan. The ship-stage reviewer (\`mode=release\`) is the canonical gate: a missing or incomplete posture-driven commit sequence is reported as an A-1 finding (severity=required, axis=correctness) and blocks ship until the slice-builder produces the missing commits in a fix-only iteration.

## Rollback plan (mandatory)

The rollback plan has three explicit fields; missing any one blocks ship:

- **Trigger conditions (what tells you it is broken):** _e.g._ error rate on /api/list > 1% over 5 min; latency p95 > 800ms over 10 min; user-visible 5xx in dashboard.
- **Rollback steps (exact commands or git operations):** _e.g._ \`git revert <ship_commit>; git push origin main\`. For non-git: \`scp release/<slug>-prev.tar.gz <host>:/srv/app && systemctl restart app\`.
- **Verification (how to confirm rollback worked):** _e.g._ /healthz returns 200; error rate back to baseline within 5 min; smoke test \`curl /api/list | jq '.items | length'\` returns N.

Set \`rollback_recorded: true\` in the frontmatter only when all three fields are filled with concrete content.

## Monitoring checklist

- Error rate on _/path_: baseline _N_/min, alert above _M_/min for _T_ min.
- Latency p95 on _/path_: baseline _Nms_, alert above _Mms_ for _T_ min.
- Business metric: _e.g._ search_quality_score (rolling 1h average should not drop > 5%).
- If no monitoring exists for the affected surface, flag in Risks section below.

## Push / PR

- push: _pending — orchestrator must explicitly ask the user before running \`git push\`._
- PR: _pending — only created if the user explicitly says "open a PR"._

When push is approved, record the upstream branch + PR URL above.

## Finalization mode (exactly ONE)

Pick exactly one. Setting \`finalization_mode\` to anything other than these five values is rejected:

- **FINALIZE_MERGE_LOCAL** — merge into the base branch locally; no PR.
- **FINALIZE_OPEN_PR** — push and open a PR with this artifact's Summary + AC↔commit map as the body.
- **FINALIZE_KEEP_BRANCH** — push the branch but leave the merge to a downstream operator.
- **FINALIZE_DISCARD_BRANCH** — delete the branch entirely (requires typed confirmation in the orchestrator turn).
- **FINALIZE_NO_VCS** — no VCS available; record manual handoff target and rollback owner.

Selected: _<one mode>_
Rationale: _<one sentence>_

## Breaking changes / migration

_(If none, write "none". If any, link to migration notes — typically docs/migration-… or a release-notes file.)_

## Release notes (one paragraph)

_(Suitable for CHANGELOG.md. Avoid TODOs and references that won't make sense to readers without internal context.)_

## Risks carried over

_(List any \`warn\`-severity ledger rows from \`flows/SLUG-PLACEHOLDER/review.md\` and any \`open\` assumptions from the plan. Each line says: id, source, why we are shipping anyway.)_

- _e.g._ F-2 (warn) — \`tests/integration/list.test.ts:31\` — no negative test for empty page; tracked in \`flows/SLUG-PLACEHOLDER/learnings.md\`.

## Victory Detector

Ship is allowed only when ALL of these are true:

- valid review verdict (\`clear\` or \`warn\` with convergence signal #2)
- preflight_passed=true with fresh output
- rollback_recorded=true with all three fields filled
- finalization_mode set to exactly one enum value
- repo_mode matches the chosen finalization (\`no-vcs\` repo cannot pick \`FINALIZE_MERGE_LOCAL\`)

If any field is stale or missing, keep \`status: blocked\` and iterate.
`;

const DECISIONS_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
decision_count: 0
architecture_tier: null
---

# Decisions — SLUG-PLACEHOLDER

> **Legacy template (pre-v8.14).** On v8.14+ flows decisions live inline in \`plan.md\` under \`## Decisions\` (one D-N row each, authored by the \`design\` phase in Phase 4). This separate \`decisions.md\` file is only installed when \`legacy-artifacts: true\` in \`.cclaw/config.yaml\`, and is read-only on resume for slugs that pre-date v8.14.

The \`design\` phase (Phase 4 — Decisions), and any reviewer running in \`text-review\` mode on a legacy resume, records decisions here. Each decision is independently citable.

## Architecture tier

_(Design Phase 4 picks one tier per slug, recorded once at the top of this file. Tier sets the depth bar for the whole D-N set.)_

- **minimum-viable** — solve only the immediate failure mode; ignore future-proofing. Use for hot-fixes, small enhancements, doc-only.
- **product-grade** — production-ready quality bar; includes failure modes, monitoring hooks, rollback plan. Default for most slugs.
- **ideal** — invest in long-term shape (clean abstractions, full failure-mode coverage, perf budgets, security review). Use only when explicitly requested or when the change is foundational.

Selected tier: _<minimum-viable | product-grade | ideal>_
Rationale: _<one sentence>_

## Trivial-Change Escape Hatch

_(If the change is ≤3 files, no new interfaces, no cross-module data flow, write a one-paragraph mini-decision here and skip the full D-N machinery. Otherwise write \`Not applicable.\`.)_

## Blast-radius Diff

_(Only the paths this slug touches, not the whole repo. Cite \`git diff\` against the slug's baseline SHA. Skip for trivial changes.)_

\`\`\`text
$ git diff <baseline-sha>..HEAD --stat
src/api/list.ts        | 12 +
tests/unit/list.test.ts |  6 +
\`\`\`

## D-1 — _decision title_

- **Context:** _what makes this a real decision instead of a default._
- **Considered options:**
  - Option A — _summary_
  - Option B — _summary_
  - Option C — _summary_
- **Selected:** Option _X_
- **Rationale:** _why X beats A / B / C right now._
- **Rejected because:** _short reason per rejected option._
- **Consequences:** _what becomes easier; what becomes harder; what we will revisit._
- **Refs:** _file:path:line, AC-N, related external link._

### Failure Mode Table

_(Only when this decision touches a user-visible failure path — rendering, request/response, persisted data, payment/auth, third-party calls. If the decision is purely internal, replace this section with the single line \`Failure Mode Table: not applicable — no user-visible failure path\`. When present, \`UserSees\` is mandatory in every row; silent failure paths must show "UserSees=nothing — recorded in <metric>".)_

| # | Method | Exception | Rescue | UserSees |
| --- | --- | --- | --- | --- |
| 1 | \`scoring.bm25\` | doc length missing in index | fallback to plain TF | warning toast: "Search ranking degraded" |

### Pre-mortem

_(Imagine this decision shipped and failed. What did it look like in the failure scenario? Three bullets max. Mandatory at product-grade and ideal tiers; minimum-viable may skip.)_

- _Failure scenario 1_
- _Failure scenario 2_
- _Failure scenario 3_
`;

const LEARNINGS_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: ship
status: active
captured_by: orchestrator
quality_gate: passed
signals:
  has_architect_decision: false  # stable signal name kept for back-compat; v8.14+: true when design Phase 4 recorded ≥1 D-N inline in plan.md
  review_iterations: 0
  security_flag: false
  user_requested_capture: false
---

# Learnings — SLUG-PLACEHOLDER

The compound phase writes this only when at least one quality signal is present. If you are reading this in an active run, the orchestrator decided this run is worth remembering.

## What we believed at the start

_(What was the going-in assumption when \`/cc\` was invoked?)_

## What turned out to be true

_(Confirmed beliefs.)_

## What turned out to be wrong

_(Discoveries that contradicted the assumption.)_

## Decisions worth remembering

- D-N (link to \`flows/SLUG-PLACEHOLDER/plan.md > ## Decisions\` on v8.14+ flows; legacy \`decisions.md\` link on pre-v8.14 resumes)

## Patterns we should keep

_(Reusable patterns we saw work.)_

## Anti-patterns we should avoid

_(Reusable patterns we saw fail.)_

## Follow-ups

- _(Items intentionally deferred. Each one becomes a separate \`/cc <task>\` later.)_
`;

const MANIFEST_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: shipped
status: shipped
ship_commit: SHIP-COMMIT-PLACEHOLDER
shipped_at: SHIPPED-AT-PLACEHOLDER
artifacts:
  - plan.md
---

# SLUG-PLACEHOLDER — shipped manifest

This file is the entry point for any future agent that wants to understand what shipped under this slug.

## Acceptance Criteria

- AC-1: _description_ (commit \`SHIP-COMMIT-PLACEHOLDER\`)

## Artifacts

- plan.md — original plan
- build.md — implementation log
- review.md — review findings
- ship.md — release notes
- decisions.md — legacy architectural-decisions file (only present on pre-v8.14 slugs; v8.14+ inlines D-N rows under \`plan.md > ## Decisions\`)
- learnings.md — lessons captured by compound (if quality gate passed)

## Refines

_(If this run refined a previous slug, link to its shipped manifest here.)_

## Knowledge index

This slug is referenced from \`.cclaw/knowledge.jsonl\` whenever the compound quality gate captured a learning.
`;

const IDEAS_TEMPLATE = `# .cclaw/ideas.md

This file is a free-form idea backlog. Entries are appended by \`/cc-idea\` and never auto-promoted to plans. To act on an idea, invoke \`/cc <task>\` describing it.

Each entry begins with an ISO timestamp, then a single-line summary, then the body.
`;

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  { id: "plan", fileName: "plan.md", description: "Strict-mode plan template (AC table, parallelSafe, touchSurface, traceability block).", body: PLAN_TEMPLATE },
  { id: "plan-soft", fileName: "plan-soft.md", description: "Soft-mode plan template (bullet-list testable conditions, no AC IDs).", body: PLAN_TEMPLATE_SOFT },
  { id: "build", fileName: "build.md", description: "Strict-mode build log (six-column TDD table, RED proofs, GREEN suite evidence).", body: BUILD_TEMPLATE },
  { id: "build-soft", fileName: "build-soft.md", description: "Soft-mode build log (single-cycle summary, plain git commit).", body: BUILD_TEMPLATE_SOFT },
  { id: "review", fileName: "review.md", description: "Review template with iteration table, findings table, and Five Failure Modes pass.", body: REVIEW_TEMPLATE },
  { id: "critic", fileName: "critic.md", description: "v8.42 critic template — critic step falsificationist pass. Frontmatter (slug, stage=critic, posture_inherited, ac_mode, mode, predictions_made, gaps_found, escalation_level, verdict). Body: pre-commitment predictions, gap analysis, adversarial findings (gap mode skips), AC self-audit, goal-backward verification, realist check, verdict, summary. Single-shot — re-dispatch overwrites.", body: CRITIC_TEMPLATE },
  { id: "ship", fileName: "ship.md", description: "Ship notes template with AC↔commit map, push/PR section, release notes paragraph.", body: SHIP_TEMPLATE },
  { id: "decisions", fileName: "decisions.md", description: "Legacy decision-record template (D-N entries). v8.14+ inlines D-N rows in plan.md > ## Decisions; this template is only installed when legacy-artifacts: true.", body: DECISIONS_TEMPLATE },
  { id: "learnings", fileName: "learnings.md", description: "Compound learning capture template with belief/outcome/follow-up sections.", body: LEARNINGS_TEMPLATE },
  { id: "manifest", fileName: "manifest.md", description: "Shipped manifest template; lists AC, artifacts, refines link.", body: MANIFEST_TEMPLATE },
  { id: "ideas", fileName: "ideas.md", description: "Append-only idea backlog seed.", body: IDEAS_TEMPLATE }
];

export function templateBody(id: ArtifactTemplate["id"], replacements: Record<string, string> = {}): string {
  const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === id);
  if (!template) throw new Error(`Unknown artifact template: ${id}`);
  let body = template.body;
  for (const [key, value] of Object.entries(replacements)) {
    body = body.split(key).join(value);
  }
  return body;
}

export function planTemplateForSlug(slug: string): string {
  return templateBody("plan", { "SLUG-PLACEHOLDER": slug });
}

export function manifestTemplate(slug: string, shipCommit: string, shippedAt: string): string {
  return templateBody("manifest", {
    "SLUG-PLACEHOLDER": slug,
    "SHIP-COMMIT-PLACEHOLDER": shipCommit,
    "SHIPPED-AT-PLACEHOLDER": shippedAt
  });
}
