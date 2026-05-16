export interface ArtifactTemplate {
  id:
    | "plan"
    | "plan-soft"
    | "build"
    | "build-soft"
    | "review"
    | "critic"
    | "plan-critic"
    | "qa"
    | "ship"
    | "decisions"
    | "learnings"
    | "manifest"
    /**
     * `research.md` template for standalone research-mode
     * flows (`/cc research <topic>`). Written by the `architect`
     * specialist when activated in standalone mode; same section
     * layout as the architect-authored prefix of `plan.md`
     * (Frame / Approaches / Decisions / Pre-mortem / Compose) but
     * with research-specific frontmatter (mode / topic / generated_at)
     * and no AC table / topology / traceability.
     */
    | "research";
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
# parent_slug mirrors the orchestrator-level pointer set when the
# flow was initialised via /cc extend <slug> <task>. The orchestrator's
# Detect hop seeds this field at slug-init when flowState.parentContext is
# set; architect Bootstrap (when run) confirms the value. Distinct from
# the refines: field above: refines is the legacy/manual link
# (also written by the v8.59 extend init for back-compat with the
# knowledge-store chain + qa-runner skip / plan-critic skip / architect
# ambiguity-score brownfield gates), while parent_slug is the
# native pointer that downstream tooling can rely on without
# ambiguity. The two values are kept in sync at extend init; if they
# drift (e.g. user manual edit), parent_slug is authoritative.
parent_slug: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
feasibility_stamp: null  # green | yellow | red — set by architect before AC lock-in (T1-2)
# Architect Compose-phase ambiguity score. Composite (0.0-1.0) across 3 dimensions
# (greenfield: goal / constraints / success) or 4 dimensions (brownfield: + context).
# Informational signal (no mid-plan picker in v8.62 unified flow); never a hard gate. Absent on pre-v8.53 plans.
ambiguity_score: null
ambiguity_dimensions: null
ambiguity_threshold: null
---

# SLUG-PLACEHOLDER

> One short paragraph: what we are doing and why. If the goal does not fit in 4 lines, the request is probably too large — split it.

## Extends

_(present only when this flow was initialised via \`/cc extend <slug> <task>\`. The architect (Bootstrap) authors this section verbatim from \`flowState.parentContext\`. Drop the entire section on cold-start \`/cc <task>\` flows. Format:_

_\`refines: <parent-slug>\` (shipped \`<parent.shippedAt>\` if known). Parent decision summary: one-line synthesis of the highest-blast-radius D-N from the parent's plan.md, or "see parent's plan for context" when no decisions were recorded._

_Parent artifacts (one bullet per artifact, only those present on disk):_

_- [plan](../shipped/<parent-slug>/plan.md)_
_- [build](../shipped/<parent-slug>/build.md) — when present_
_- [review](../shipped/<parent-slug>/review.md) — when present_
_- [critic](../shipped/<parent-slug>/critic.md) — when present_
_- [qa](../shipped/<parent-slug>/qa.md) — when present_
_- [learnings](../shipped/<parent-slug>/learnings.md) — when present_

_The relative paths use \`../shipped/<parent-slug>/\` to walk from the active \`flows/<new-slug>/\` directory to the parent's shipped directory. The reviewer's parent-contradictions cross-check reads this section to validate the new flow does not silently undo a parent decision.)_

## Frame

_(Architect: Frame. 2-5 sentences: what is broken or missing today, who feels it, what success looks like a user or test can verify, what is explicitly out of scope. Cite real evidence — \`file:path:line\`, ticket id, conversation excerpt — when you have it. If the orchestrator runs inline (architect skipped), leave a one-line summary here.)_

## Non-functional

_(Architect: Frame, strict mode only. Authored when the slug is product-grade tier OR carries irreversibility — e.g. data-migration, public API, auth/payment surface, performance hot-path. Soft-mode plans skip the Frame phase and therefore have no NFR section. Optional and may be entirely absent on legacy plans. When the slug has no NFR concerns, write "none specified" inline against each axis rather than dropping the section — explicit "none" beats implicit silence for the reviewer's \`nfr-compliance\` axis gate.)_

- **performance:** _budgets (p50/p95/p99 latency, throughput, memory, bundle KB) or "none specified"._
- **compatibility:** _browser / runtime / Node / OS / dependency-version constraints, or "none"._
- **accessibility:** _a11y baseline (WCAG level, keyboard, screen-reader, contrast), or "none" for non-UI slugs._
- **security:** _auth / data-classification / compliance baseline; defer threat modelling to the \`reviewer\`'s \`security\` axis when \`security_flag: true\` — this row is the high-level posture only._

## Approaches

_(Architect: Approaches, strict mode only. Optional even on strict. Drop dead options before showing the table; do not pad to 3 rows for symmetry.)_

| Role | Approach | Trade-off | Reuse / reference |
| --- | --- | --- | --- |
| baseline | _approach_ | _trade-off_ | _reference_ |
| challenger | _approach_ | _trade-off_ | _reference_ |

## Selected Direction

_(Architect: Approaches closing paragraph when Approaches exists; cites the picked row and why.)_

## Decisions

_(Architect: Decisions, strict mode only. One D-N row per decision. Each row is independently citable. Replaces the separate \`decisions.md\` file from pre-v8.14 flows; on \`legacy-artifacts: true\` the separate file is still emitted.)_

- **D-1 — _short title_** — Context: _why this is a decision, not a default_. Options: _A / B / C with one-line tradeoff each_. Pick: _A_. Rationale: _why A over B, C in this slug_. Blast radius: _what changes if D-1 is reversed_. ADR: _none | proposed | promoted (path)_.

## Pre-mortem

_(Architect: Pre-mortem, strict mode only. 2-4 ways this plan could fail; each line names the failure, the symptom, and the mitigation already encoded in the plan/AC.)_

- _failure_ → _symptom_ → _mitigation in AC-N / D-N_.

## Not Doing

_(Architect: Frame / Compose — 3-5 bullets explicitly out of scope. Protects against silent enlargement.)_

- _explicit non-commitment_
- _explicit non-commitment_

## Plan

_(AC author authors this. AC-aligned, not horizontal-layer. Each unit ships an end-to-end vertical slice for one AC.)_

- **Phase 1 — Foundation (AC-1).**
  - Concrete change with file:path:line reference.
- **Phase 2 — Wiring (AC-2, AC-3).**
  - Concrete change with file:path:line reference.

## Spec

_(mandatory on every plan.md (strict and soft). Four bullets capture the requirement-side contract that AC alone do not carry: intent + scope + non-goals + per-slug constraints. Always authored by the architect; on strict-mode plans the Frame phase adds NFR rows alongside this section. Each bullet MUST be filled — write "none" or "n/a" when genuinely nothing applies; \`<TBD>\` or empty values are not acceptable. Existing legacy plans without this section continue to work; the section appears only on plans authored on v8.46+.)_

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
- \`dependsOn\` is a list of AC ids that must be \`status: committed\` before this AC enters builder. Use \`none\` (or empty) when the AC has no predecessors. The reviewer cross-checks the dependency graph against the AC commit order — out-of-order commits are a \`required\` finding.
- \`touchSurface\` is the list of repo-relative paths the AC is allowed to modify.
- \`rollback\` is the explicit revert / disable / migration-rollback strategy if this AC ships and breaks in production. Required in strict mode; one short sentence per AC. "Same as AC-N" is acceptable for siblings that share the same rollback path. \`none\` is **not** acceptable — every AC has a rollback story, even if it is "revert the single commit".
- \`posture\` is one of \`test-first\` (default) | \`characterization-first\` | \`tests-as-deliverable\` | \`refactor-only\` | \`docs-only\` | \`bootstrap\`. The builder reads this field to select the commit ceremony (which posture-driven prefix sequence to write); the reviewer's \`src/posture-validation.ts:POSTURE_COMMIT_PREFIXES\` mapping is the canonical source for which prefixes are expected per posture, and \`src/posture-validation.ts:validatePostureTouchSurface\` cross-checks the \`docs-only\` and \`tests-as-deliverable\` postures against the touchSurface. See \`.cclaw/lib/skills/tdd-and-verification.md\` for the posture-to-ceremony mapping. Default is \`test-first\` (standard RED → GREEN → REFACTOR cycle).

Each AC must point at a real \`file:line\` or destination path.

## Feasibility stamp

_(AC author-authored before AC lock-in. One of \`green\` / \`yellow\` / \`red\`; copy into frontmatter \`feasibility_stamp\`.)_

- **green** — surface ≤3 modules, all AC have direct test analogues, no new dependencies, dependency chain ≤2 hops.
- **yellow** — surface 4-6 modules, OR one AC depends on a not-yet-existing test fixture, OR one new dependency (with rationale), OR dependency chain 3-5 hops.
- **red** — surface ≥7 modules, OR multiple AC depend on not-yet-existing fixtures/types, OR ≥2 new dependencies, OR dependency chain ≥6 hops, OR security flag set without an architect D-N covering the sensitive surface. **Red feasibility blocks build dispatch in strict mode** until the architect re-decomposes (likely splitting into multiple slugs) or re-enters the Decisions phase to record the missing D-N.

The stamp is computed once per plan, before builder enters. The reviewer cross-checks the stamp against the realised diff at review time; an \`actual_complexity > stamp\` is a \`consider\`-severity finding for future calibration.

## Edge cases

_(Architect-authored. One bullet per AC naming the non-happy-path the builder's RED test must encode.)_

- **AC-1** — _empty input / boundary / error response_.
- **AC-2** — _hover under 100ms / missing fixture / etc_.

## Topology

_(AC author topology mode. Default: \`inline\`. \`parallel-build\` is opt-in; see lib/skills/parallel-build.md for rules.)_

- topology: inline
- slices: _none_

## Traceability block

- AC-1 → commit pending
- AC-2 → commit pending

This block is filled in by the builder as each AC's commits land (one SHA per phase: \`red\` → \`green\` → \`refactor\`); the reviewer's posture-aware \`git log --grep="(AC-N):" --oneline\` scan reconciles it against the actual git history at handoff and ship time. Do not edit by hand once an AC's row in \`build.md\` carries SHAs.
`;

const PLAN_TEMPLATE_SOFT = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
ceremony_mode: soft
last_specialist: null
refines: null
# see PLAN_TEMPLATE above for parent_slug semantics. Same field,
# same authority rules (extend init seeds; architect Bootstrap confirms;
# parent_slug wins on drift).
parent_slug: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# SLUG-PLACEHOLDER

> One short paragraph: what we are doing and why. If the goal does not fit in 4 lines, the request is probably too large — split it or re-triage to large-risky.

## Extends

_(present only when this flow was initialised via \`/cc extend <slug> <task>\`. The architect (Bootstrap) authors this section verbatim from \`flowState.parentContext\` on soft flows. Drop the entire section on cold-start \`/cc <task>\` flows. Format is identical to the strict PLAN_TEMPLATE — \`refines: <parent-slug>\` line + parent decision summary + bulleted artifact links. See PLAN_TEMPLATE comment for the exact shape.)_

## Plan

_(AC author authors this. One short paragraph describing the change end-to-end. No phases, no AC IDs.)_

## Spec

_(mandatory. Four bullets capturing the requirement-side contract. Each bullet MUST be filled — "none" or "n/a" are acceptable when genuinely nothing applies; \`<TBD>\` and empty values are not. The architect authors this on small-medium (soft) plans.)_

- **Objective**: _what we are building and why, in one short line._
- **Success**: _how we know it is done — high-level indicators, NOT the testable conditions below._
- **Out of scope**: _explicit non-goals; "none" if not applicable._
- **Boundaries**: _per-slug "ask first" / "never do" notes; "none" if iron-laws cover it._

## Testable conditions

_(Bullet list. Each line is a behaviour the builder's tests must verify. Conditions are observable; if you can't name a test or manual step that proves it, drop the bullet.)_

- _Condition 1 — observable behaviour, e.g. "Pill renders the request status (Pending / Approved / Denied)."_
- _Condition 2._
- _Condition 3._

## Verification

_(One block per layer. Tests file paths, manual steps, runner command.)_

- \`tests/unit/<module>.test.ts\` — covers all listed conditions in one test file.
- Manual: _open <url>, perform <action>, observe <outcome>_.

## Touch surface

_(Files the builder is allowed to modify. Used by reviewer to flag scope creep.)_

- \`src/<module>/<file>.ts\`
- \`tests/unit/<module>.test.ts\`

## Notes

_(Optional. The architect's Approaches / Decisions / Pre-mortem phases do NOT run for soft-mode (small/medium) flows; if you discover the work needs structural decisions, alternative comparison, or threat modelling mid-flight, surface back to the orchestrator and ask to re-triage as strict so the architect's full Frame → Compose pass can run.)_
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
| AC-1 | _file:path:line refs from discovery_ | _failing test name + 1-3 line failure excerpt_ | _full-suite command + PASS summary_ | _shape change applied, or "Refactor: skipped — <reason>" (default; no empty commit needed)_ | _red SHA, green SHA, refactor SHA (omit when REFACTOR notes declares "Refactor: skipped")_ |

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

_(Per AC: one-line shape change applied, or explicit "Refactor: skipped — <reason>" (default — no empty commit needed; the reviewer reads this row), or legacy "skipped: <reason>" empty-commit marker. Silence is not acceptable; the gate forces the question.)_

- AC-1: extracted \`hasViewEmail\` helper from inline check.
- AC-2: Refactor: skipped — 8-line addition, idiomatic; nothing to extract.

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
- \`git commit -m "refactor(AC-1): …"\` → _SHA_ (real refactor) **OR** omit the refactor commit entirely and declare \`Refactor: skipped — <reason>\` in the AC's REFACTOR notes column above (default). The legacy \`git commit --allow-empty -m "refactor(AC-1) skipped: <reason>"\` empty-marker is still accepted for backwards compat on already-shipped slugs.

## Notes

_(Surprises, deviations from the plan, tests added, refactors that came up, paths considered and discarded, etc.)_
`;

const BUILD_TEMPLATE_SOFT = `---
slug: SLUG-PLACEHOLDER
stage: build
status: active
ceremony_mode: soft
last_commit: null
---

# Build log — SLUG-PLACEHOLDER

This is the soft-mode build log. One TDD cycle covers all listed conditions; commits are plain \`git commit -m "<feat|fix|...>: <one-line>"\` with no per-criterion prefix (the reviewer reads this file plus the feature-level commit at ship time).

> **Iron Law:** NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST. The RED failure is the spec.

## Plan summary

_(One paragraph mirroring \`flows/SLUG-PLACEHOLDER/plan.md\` Plan section.)_

## Build log

- **Tests added**: _\`tests/unit/<module>.test.ts\` — N tests, mirroring the listed conditions._
- **Discovery**: _\`src/<module>/<file>.ts:<line>\`, \`tests/unit/<existing>.test.ts:<line>\`._
- **RED**: _\`<runner command>\` → N failing (expected). Cite the assertion that fails (≤3 lines)._
- **GREEN**: _One sentence on the minimal change. \`<full-suite command>\` → all passing._
- **Coverage**: _Verdict \`full\` / \`partial\` / \`refactor-only\` + which branches are anchored by which test file:line. \`partial\` is valid (name the uncovered branch + reason); absent line is not._
- **REFACTOR**: _One-line shape change applied, or "Refactor: skipped — <reason>" (default; no empty commit needed). Legacy "skipped: <reason>" empty-marker commit is still accepted._
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

This is the review log. \`reviewer\` (the ten-axis reviewer, with security threat-modelling absorbed from the former \`security-reviewer\`) appends findings here. The loop is producer ↔ critic: iteration N proposes findings, \`builder\` (mode=fix-only) closes them, iteration N+1 re-checks. The loop ends when the convergence detector fires (see review-discipline skill).

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

- **block** — at least one open block row. builder (fix-only) addresses them; re-review next iteration.
- **warn** — convergence signal #2 fired. Open warns carry over. Ship may proceed.
- **clear** — signal #1 (all closed) or signal #2 (warn-only convergence). Ready for ship.
- **cap-reached** — signal #3. Stop; orchestrator surfaces remaining open rows to the user; user picks \`/cc-cancel\` or \`accept warns and ship\` (only valid if every open row is severity=warn).
`;

const CRITIC_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: critic
status: active
posture_inherited: PLAN-POSTURE-PLACEHOLDER  # most-restrictive AC posture from plan.md frontmatter
ceremony_mode: CEREMONY-MODE-PLACEHOLDER      # inline | soft | strict (mirrors flow-state.json > triage.ceremonyMode; legacy ac_mode read accepted for one release)
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
| P-2 | _e.g. "AC-1 commits include a drive-by edit to an adjacent file"_ | _e.g. "plan.md touchSurface lists 2 files; architect D-1 ruled out broader refactor"_ | _git diff --stat citation_ | _confirmed / refuted / partial_ |
| P-3 | _e.g. "Pre-mortem from the architect was skipped; high-irreversibility decisions exist without failure-mode coverage"_ | _e.g. "frontmatter \`posture: guided\`; D-2 introduces a schema change with no rollback line"_ | _plan.md \`## Pre-mortem\` absence / D-2 body_ | _confirmed / refuted / partial_ |

## 2. Gap analysis (what's missing)

_(The OMC "What's Missing" section. Walk the slug and ask, for each item, "what is absent?" — criterion-coverage gaps, edge-case coverage gaps, NFR coverage gaps, decision implementation gaps, scope creep, untested edge cases, false assumptions.)_

| G-N | Class | Severity | Anchor | Description | Suggested patch | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G-1 | _criterion-coverage / edge-case-drift / nfr-drift / decision / scope-creep / untested / false-assumption_ | _block-ship / iterate / fyi_ | _plan.md > AC-N \\| build.md row \\| file:line_ | _what is missing and why it matters_ | _smallest correct change to close the gap_ | _open / closed-by-iteration_ |

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

## 4. Criterion check (are the verifiable plan criteria the right criteria, not are they met?)

_(Goal-backward, per criterion. Re-read the user's original prompt and verify each verifiable plan criterion actually solves the user-stated problem. scope: every row in the AC table, every entry in \`## Edge cases\`, and every measurable row in \`## Non-functional\`.)_

| Criterion | Source | User asked for | Criterion promises | Aligned? | Drift note (if any) |
| --- | --- | --- | --- | --- | --- |
| AC-1 | ac | _e.g. "make the invite list refresh when a user clicks Refresh"_ | _e.g. "InviteList component re-fetches /api/invites on click of the Refresh button"_ | _yes / partial / no_ | _e.g. "AC asks for re-fetch; user said 'refresh' which could mean re-render with cached data."_ |
| EC-1 | edge-case | _e.g. "race when two refreshes click within 50ms"_ | _e.g. "second click cancels in-flight request"_ | _yes / partial / no_ | _e.g. "still allows double-fetch; debounce not actually wired."_ |
| NFR-1 | nfr | _e.g. "p95 list load under 200ms on 1k invites"_ | _e.g. "useMemo + windowed render"_ | _yes / partial / no_ | _e.g. "missing perf measurement; budget not verified."_ |

## 5. Goal-backward verification (slug-level)

1. **Goal stated** (from \`plan.md > ## Frame\`): _<one sentence>_
2. **What shipped** (from \`build.md > ## TDD cycle log\` + \`review.md > Findings\` closed rows): _<one sentence>_
3. **Outcome:** _\`solved\` / \`partial\` / \`drifted\`_
4. **Gap (if partial or drifted):** _<one sentence; emit a G-N finding in §2 — class=criterion-coverage for partial, class=scope-creep for drifted>_

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

const PLAN_CRITIC_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: plan-critic
status: active
posture_inherited: PLAN-POSTURE-PLACEHOLDER  # most-restrictive AC posture from plan.md frontmatter
ceremony_mode: CEREMONY-MODE-PLACEHOLDER      # always "strict" — gate enforces; placeholder is a reminder; legacy ac_mode key read accepted for one release
ac_count: 0                                   # AC count from plan.md
dispatched_at: DISPATCHED-AT-PLACEHOLDER      # ISO timestamp at dispatch time
iteration: 0                                  # 0 on first dispatch; 1 after one revise loop (max)
predictions_made: 0                           # count of pre-commitment predictions in §6
findings: 0                                   # total §1+§2+§3+§4+§5 findings (excluding §6 predictions)
verdict: pending                              # pending | pass | revise | cancel
token_budget_used: 0                          # orchestrator stamps this from the sub-agent return
---

# Plan critic — SLUG-PLACEHOLDER

This artifact captures the pre-implementation plan-critic pass over the slug. plan-critic runs BETWEEN \`architect\` and \`builder\`, only on the tight gate \`{ceremonyMode=strict, complexity=large-risky, problemType!=refines, AC count>=2}\`. It walks the plan itself (goal coverage / granularity / dependencies / parallelism / risk catalog) before any code is written. Distinct from the post-implementation \`critic\` (which runs at Hop 4.5, after build/review); both ship together because they catch different problem classes.

plan-critic is read-only on the codebase. Every finding cites \`plan.md > §section\` or the user's \`/cc <task>\` prompt verbatim. The plan-critic is structurally cheaper than the post-impl critic — there is no build.md or review.md to read.

> **Iron Law (plan-critic):** EVIDENCE FROM THE PLAN ONLY. Every finding cites a row, column, or section of \`plan.md\` (or the user's \`/cc <task>\` prompt). A finding that cites the not-yet-existing diff is out of scope.

## §1. Goal coverage

_(Trace each Spec / Frame goal element to ≥1 AC. Catalog absences as G-N rows with severity.)_

| G-N | Class | Severity | Anchor | Description | Suggested fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| G-1 | _goal-coverage_ | _block-ship / iterate / fyi_ | _plan.md > ## Spec > Objective_ | _what is missing or drifted_ | _smallest correct change_ | _open_ |

**Severity definitions** (plan-critic's own vocabulary; do NOT merge with reviewer's \`critical\`/\`required\` ledger and do NOT merge with the post-impl critic's \`block-ship\`/\`iterate\`/\`fyi\` — plan-critic findings exist BEFORE build):

- **\`block-ship\`** — closing this gap requires re-running the architect Frame/Approaches/Decisions pass or re-authoring the plan from scratch. \`cancel\` verdict territory.
- **\`iterate\`** — gap is real but addressable in one architect revise cycle. \`revise\` verdict territory.
- **\`fyi\`** — gap is information-only; no action expected.

## §2. Granularity

_(For each AC: is the text appropriately sized to be ONE observable behaviour? Flag too-coarse (1 AC covering ≥5 unrelated concerns) and too-fine (one AC for a trivial mechanical change). One row per granularity finding.)_

| G-N | AC | Class | Severity | Symptom | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| G-2 | AC-3 | _too-coarse / too-fine_ | _iterate / fyi_ | _e.g. "AC-3 covers backend index + ranker + frontend badge + integration test; touchSurface spans 3 layers"_ | _split into AC-3a + AC-3b + AC-3c_ |

## §3. Dependency accuracy

_(Build the surface-overlap graph from the AC table's touchSurface column; compare to the declared \`dependsOn\` graph. Three failure modes: missing edge / cycle / stale reference.)_

\`\`\`text
_(Optional ASCII dependency diagram when the surface overlap is non-trivial; omit when the graph is trivially correct.)_

AC-1 ─┐
      ├─→ AC-3 ─→ AC-5
AC-2 ─┘
AC-4 (leaf)
\`\`\`

| G-N | Class | Severity | AC-i | AC-j | Description | Suggested fix |
| --- | --- | --- | --- | --- | --- | --- |
| G-3 | _missing-edge / cycle / stale-reference_ | _iterate / block-ship_ | AC-2 | AC-3 | _e.g. "AC-2 and AC-3 both touch src/cache/refresh.ts; AC-2 has no dependsOn entry"_ | _declare AC-3 dependsOn AC-2_ |

## §4. Parallelism feasibility

_(Applies only when \`plan.md > ## Topology\` is \`parallel-build\`. For \`inline\` topology, write \`Topology is inline; §4 not applicable.\` and move on. Otherwise: check slice disjointness, slice count cap (5), AC-to-slice mapping completeness.)_

| G-N | Class | Severity | Slices | Description | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| G-4 | _slice-overlap / slice-count-cap / unmapped-AC_ | _iterate_ | slice-1, slice-2 | _e.g. "slice-1 and slice-2 both list tests/integration/search.spec.ts"_ | _merge slice-1 + slice-2 OR move the shared file to a third slice_ |

## §5. Risk catalog

_(What risks does the plan NOT surface? NFR gaps, security implications, missing migration plans, irreversibility. Cap at 5 findings total; if you have more, the plan has structural problems best escalated via \`block-ship\` on the most severe one.)_

| G-N | Class | Severity | Anchor | Description | Suggested fix |
| --- | --- | --- | --- | --- | --- |
| G-5 | _nfr-gap / security-unflagged / migration-unplanned / irreversibility_ | _iterate / block-ship_ | _plan.md > ## Non-functional_ | _e.g. "performance: p95 < 200ms declared but no AC verification line exercises perf"_ | _add a perf-test verification to AC-2_ |

## §6. Pre-commitment predictions

_(Authored BEFORE the critic reads plan.md in detail. 3-5 predictions in plan-critic mode. Each prediction names a verification path and a final outcome.)_

| # | Prediction | Rationale (from Spec / prompt / priors) | Verified-against-plan | Outcome |
| --- | --- | --- | --- | --- |
| P-1 | _e.g. "AC-3's touchSurface overlaps AC-2 without a dependsOn declaration"_ | _e.g. "AC-2 and AC-3 both mention src/cache/refresh.ts in the Plan section"_ | _§3 anchor citation_ | _confirmed / refuted / partial_ |
| P-2 | _e.g. "The Spec Out-of-scope bullet about 'no schema changes' contradicts AC-4 which touches migrations/"_ | _e.g. "Spec line vs AC-4 touchSurface"_ | _§1 anchor citation_ | _confirmed / refuted / partial_ |
| P-3 | _e.g. "Parallel-build topology is declared but slice-1 and slice-2 share the integration test file"_ | _e.g. "topology block vs slice declarations"_ | _§4 anchor citation_ | _confirmed / refuted / partial_ |

## §7. Verdict

\`\`\`text
Verdict: <pass | revise | cancel>
Predictions: <N made; N_confirmed confirmed, N_refuted refuted, N_partial partial>
Goal coverage gaps: <N total; N_block_ship block-ship, N_iterate iterate, N_fyi fyi>
Granularity findings: <N total; same breakdown>
Dependency findings: <N total; same breakdown>
Parallelism findings: <N total; same breakdown — n/a if topology=inline>
Risk catalog findings: <N total; same breakdown>
Iteration: <N>/1
Confidence: <high | medium | low>
Confidence rationale: <one line; required when Confidence != high>
\`\`\`

**Verdict rules:**

- **\`pass\`** — no \`block-ship\`-severity findings; minor \`iterate\` or \`fyi\` rows are OK. Plan is buildable; orchestrator advances to builder.
- **\`revise\`** — at least one \`iterate\`-severity finding (AND zero \`block-ship\` rows). Bounce to architect for ONE revision cycle (max). Iteration 0 → 1; if a second plan-critic dispatch ALSO returns \`revise\`, the orchestrator surfaces a user picker.
- **\`cancel\`** — at least one \`block-ship\`-severity finding (or a §3 cycle, or a §1 goal-coverage gap that requires re-architect). Surface a user picker immediately: \`[cancel-slug]\` / \`[re-architect]\`.

## §8. Hand-off

_(For \`revise\`: specific changes the architect must make on the next dispatch, ordered by severity. The architect reads this section verbatim from plan-critic.md when re-dispatched on iteration 1.)_

_(For \`cancel\`: recommended next step for the user — re-architect with which constraints clarified, or cancel and split the slug.)_

_(For \`pass\`: write \`No hand-off required — builder dispatches as today.\`)_

### Changes architect must make (revise verdict only)

- _G-N (cite anchor verbatim) → architect action: <e.g. "split AC-3 into AC-3a (backend) + AC-3b (frontend)">_

### Recommended next step (cancel verdict only)

- _re-architect with the surfaced constraints, OR cancel the slug — user decides_

## Summary — plan-critic

### Changes made

- _N predictions recorded (M confirmed, K refuted, L partial)._
- _N goal-coverage findings catalogued (M block-ship, K iterate, L fyi)._
- _N granularity / dependency / parallelism / risk findings catalogued._
- _Verdict: pass | revise | cancel._

### Things I noticed but didn't touch

- _Anything observed during reading that is outside plan-critic's lane (e.g. "the Approaches table dismissed Option B with a thin rationale — outside plan-critic's lane to relitigate; flagging for the user's re-architect pass if cancel verdict fires")._

### Potential concerns

- _Anything the plan-critic could not verify and the orchestrator may want to surface to the user (e.g. "P-2 relied on a project convention I could not confirm from plan.md alone; recommend the user verify before iteration 1")._
`;

const QA_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: qa
status: active
specialist: qa-runner
dispatched_at: DISPATCHED-AT-PLACEHOLDER       # ISO timestamp at dispatch time
iteration: 0                                    # 0 on first dispatch; 1 after one iterate loop (max)
surfaces: []                                    # copied from triage.surfaces — list of "ui" / "web" tokens detected
evidence_tier: pending                          # playwright | browser-mcp | manual | pending (pre-§2)
ui_acs_total: 0                                 # count of UI-tagged ACs covered by this qa pass
ui_acs_pass: 0                                  # count whose Status == pass
ui_acs_fail: 0                                  # count whose Status == fail
ui_acs_pending: 0                               # count whose Status == pending-user (manual tier)
predictions_made: 0                             # count of §3 pre-commitment predictions
findings: 0                                     # total §5 findings (failures only)
verdict: pending                                # pending | pass | iterate | blocked
token_budget_used: 0                            # orchestrator stamps this from the sub-agent return
---

# QA report — SLUG-PLACEHOLDER

This artifact captures the qa-runner pass over the slug. qa-runner runs BETWEEN \`build\` and \`review\`, only when \`triage.surfaces\` includes \`ui\` or \`web\` AND \`triage.ceremonyMode != "inline"\`. It walks the **rendered page** with whichever browser tooling is available (Playwright > browser-MCP > manual) and emits one evidence row per UI-tagged AC. Distinct from the reviewer (which walks the diff) and from \`debug-and-browser.md\` (which drives stop-the-line debugging on a live system).

qa-runner is read-only on production source. Every \`Status: pass\` row cites a real test exit code, a saved screenshot path, or a numbered manual-steps block — never "looks good to me".

> **Iron Law (qa-runner):** EVIDENCE FROM THE RENDERED PAGE ONLY. A \`Status: pass\` row without a citation is structurally invalid; the reviewer's \`qa-evidence\` axis fires \`required\` on it.

## §1. Surfaces under QA

_(Copy \`triage.surfaces\` from \`flow-state.json\`. Cite which AC ids carry each UI surface — read \`plan.md\` AC table > \`touchSurface\` column to assign. Non-UI surfaces from a mixed slug are out of scope for qa-runner; list them under "Out of scope".)_

- _UI surfaces: e.g. \`ui\` (AC-1, AC-3), \`web\` (AC-2)_
- _Out of scope (non-UI ACs covered by review only): e.g. AC-4 (\`api\`), AC-5 (\`library\`)_

## §2. Browser tool detection

_(Decide \`evidence_tier\` BEFORE authoring any evidence. Pick the strongest available tier; record the decision below and stamp it into the frontmatter \`evidence_tier\` field.)_

| Tier | Tool | Detection signal | Decision |
| --- | --- | --- | --- |
| 1 | Playwright (\`@playwright/test\` or wrapper script) | \`package.json > devDependencies > @playwright/test\` OR \`scripts.test:e2e\` | _yes / no_ |
| 2 | \`cursor-ide-browser\` MCP | dispatch envelope's MCP catalog | _yes / no_ |
| 2 | \`chrome-devtools\` MCP | dispatch envelope's MCP catalog | _yes / no_ |
| 2 | \`browser-use\` MCP | dispatch envelope's MCP catalog | _yes / no_ |
| 3 | Manual steps | always available (last resort) | _yes (fallback)_ |

**Selected tier:** _<playwright | browser-mcp | manual>_
**Rationale:** _<one sentence — why this tier and not the next-stronger one (if Tier 1 was skipped despite being available, the reviewer's qa-evidence axis will fire required)>_

## §3. Pre-commitment predictions (3-5)

_(Authored BEFORE you run any verification. 3-5 predictions of what is most likely to fail when you actually render the page. Each prediction names a verification path and a final outcome. For \`evidence_tier == playwright\`, the spec's \`expect()\` calls are themselves structured predictions; you may declare "Predictions encoded as the four \`expect()\` calls in tests/e2e/<spec>.spec.ts; outcomes recorded inline" and skip rewriting them here.)_

| # | Prediction | Rationale (from plan.md / build.md / prompt / priors) | Verification path | Outcome |
| --- | --- | --- | --- | --- |
| P-1 | _e.g. "AC-3's toast will not render because build.md GREEN cited only the click handler, not the toast component"_ | _e.g. "build.md TDD log shows the click handler unit-tested in isolation; no integration test exercises the toast"_ | _Playwright spec asserts toast text after submit click_ | _confirmed / refuted / partial_ |
| P-2 | _e.g. "Dark-mode contrast on the new badge component will fail WCAG AA"_ | _e.g. "plan.md NFR > accessibility names WCAG AA; AC-2 added a new badge but build.md does not cite a contrast check"_ | _browser-mcp screenshot + a11y panel inspection_ | _confirmed / refuted / partial_ |
| P-3 | _e.g. "Form submission will leak a console error because plan.md AC-1 rollback names a fetch error path that build.md did not exercise"_ | _e.g. "plan.md AC-1 rollback line vs build.md AC-1 GREEN evidence"_ | _DevTools Console tab observation_ | _confirmed / refuted / partial_ |

## §4. Per-AC evidence

_(One block per UI-tagged AC. Status semantics: \`pass\` requires evidence to ACTUALLY show the AC's behavioural clause met — verbatim verb match. A "page loaded" screenshot does NOT satisfy "user sees toast after submit". \`fail\` means evidence shows the behaviour not met; \`pending-user\` is reserved for \`evidence_tier == manual\` until the user confirms.)_

### AC-1: _<ac summary copied verbatim from plan.md AC table>_

- **Surface:** _<ui | web | mixed: ui+api | …>_
- **Verification:** _<playwright | browser-mcp | manual>_
- **Evidence:**
  - For \`playwright\`: \`tests/e2e/<slug>-<ac>.spec.ts\` — exit code: 0 — last 3 lines:
    \`\`\`text
    Running 1 test using 1 worker
      ✓ user sees toast after submitting form (1.4s)
    1 passed (1.5s)
    \`\`\`
  - For \`browser-mcp\`: \`flows/<slug>/qa-assets/AC-1-1.png\` + observations: _<one paragraph: what was clicked, what rendered, what was inspected (console / network / a11y)>_
  - For \`manual\`: numbered steps below
    \`\`\`text
    1. Open http://localhost:3000/invites.
    2. Click the "Refresh" button in the top-right.
    3. Expect the list to re-fetch within 1s; toast "Refreshed" appears at the bottom-right for 3s.
    \`\`\`
- **Status:** _<pass | fail | pending-user>_

### AC-2: _<ac summary>_

_(Repeat the block above for each UI-tagged AC. If a single AC has multiple UI behavioural clauses, you may number the Evidence rows AC-2-1, AC-2-2 — keep the Status row at the AC level (pass iff every numbered row is pass).)_

## §5. Findings (failures only)

_(One F-N row per AC whose \`Status\` is \`fail\`. \`required\` blocks the iterate hand-off — builder MUST address; \`fyi\` rides into review as a secondary observation. Rows whose Status is \`pass\` produce NO findings; §4 evidence is the proof.)_

| F-N | Severity | AC | What failed | Recommended fix | Status |
| --- | --- | --- | --- | --- | --- |
| F-1 | _required / fyi_ | AC-3 | _e.g. "Toast did not render after submit click; DevTools Console showed 'TypeError: showToast is not a function' at src/components/InviteForm.tsx:42"_ | _e.g. "Wire up the useToast() hook; the form imports the type but not the function. See plan.md AC-3 rollback line for the fallback UI."_ | _open_ |

## §6. Verdict

\`\`\`text
Verdict: <pass | iterate | blocked>
Evidence tier: <playwright | browser-mcp | manual>
Predictions: <N made; N_confirmed confirmed, N_refuted refuted, N_partial partial>
UI ACs verified: <N total; N_pass pass, N_fail fail, N_pending pending-user>
Findings: <N total; N_required required, N_fyi fyi>
Iteration: <N>/1
Confidence: <high | medium | low>
Confidence rationale: <one line; required when Confidence != high>
\`\`\`

**Verdict rules:**

- **\`pass\`** — every UI AC has \`Status: pass\`; no \`required\` findings. Orchestrator advances to review. The reviewer's \`qa-evidence\` axis re-reads this artifact.
- **\`iterate\`** — at least one UI AC has \`Status: fail\` AND the §5 \`Recommended fix\` column articulates what would make it pass. Orchestrator bounces to builder with §7 Hand-off as additional context. Hard-capped at one iterate (\`qaIteration: 0 → 1\`); a second iterate surfaces the user picker.
- **\`blocked\`** — browser tools unavailable AND at least one UI AC requires manual user action; OR every UI AC has \`Status: pending-user\` with \`evidence_tier: manual\`. Orchestrator surfaces the user picker (\`proceed-without-qa-evidence\` / \`pause-for-manual-qa\` / \`skip-qa\`).

## §7. Hand-off

_(For \`iterate\`: cite each \`required\` finding by F-N + AC + recommended fix. builder reads this verbatim when re-dispatched in fix-only mode.)_

_(For \`blocked\`: cite the picker arm the user should pick and what manual step they must run; OR what blocker must be lifted before qa can re-run.)_

_(For \`pass\`: write \`No hand-off required; proceed to review.\`)_

### For iterate verdict — builder fix-only context

- _F-1 (AC-3) → wire up the \`useToast()\` hook in \`src/components/InviteForm.tsx:42\`; rerun build, then re-dispatch qa-runner (iteration 1)._

### For blocked verdict — user picker context

- _No browser tools available; manual steps for AC-3 require a logged-in user session. Recommend the user pick \`[pause-for-manual-qa]\` and follow the §4 manual steps; once confirmed, the orchestrator stamps \`Status: pass\` on AC-3 and flips verdict to \`pass\`._

## Summary — qa-runner

### Changes made

- _N UI ACs covered (M pass, K fail, L pending-user)._
- _N predictions recorded (M confirmed, K refuted, L partial)._
- _N findings catalogued (M required, K fyi)._
- _Evidence tier: <playwright | browser-mcp | manual>._
- _Verdict: pass | iterate | blocked._

### Things I noticed but didn't touch

- _Anything observed during the qa pass that is outside qa-runner's lane (e.g. "the dev server emitted a 'sourcemap missing' console warning unrelated to the slug; flagging for a future infra slug, not raising as F-N here")._

### Potential concerns

- _Anything the qa-runner could not verify and the orchestrator may want to surface to the user (e.g. "AC-2's mobile viewport behaviour was untested because the available browser MCP did not expose viewport resizing; recommend a manual phone check before ship")._
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

This table mirrors \`flows/SLUG-PLACEHOLDER/plan.md > Acceptance Criteria\` with the final SHAs reconstructed from \`git log --grep="(AC-N):" --oneline\` for every AC in the plan. The ship-stage reviewer (\`mode=release\`) is the canonical gate: a missing or incomplete posture-driven commit sequence is reported as an A-1 finding (severity=required, axis=correctness) and blocks ship until the builder produces the missing commits in a fix-only iteration.

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

> **Legacy template (pre-v8.14).** On v8.14+ flows decisions live inline in \`plan.md\` under \`## Decisions\` (one D-N row each, authored by the \`architect\` during the Decisions phase). This separate \`decisions.md\` file is only installed when \`legacy-artifacts: true\` in \`.cclaw/config.yaml\`, and is read-only on resume for slugs that pre-date v8.14.

The \`architect\` (Decisions phase), and any reviewer running in \`text-review\` mode on a legacy resume, records decisions here. Each decision is independently citable.

## Architecture tier

_(Architect: Decisions picks one tier per slug, recorded once at the top of this file. Tier sets the depth bar for the whole D-N set.)_

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
  has_architect_decision: false  # true when the architect's Decisions phase recorded ≥1 D-N inline in plan.md
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

/**
 * `research.md` template for standalone research-mode flows
 * (`/cc research <topic>` / `/cc --research <topic>`). The artifact is
 * written by the `architect` specialist when activated in standalone
 * research mode (`triage.mode == "research"`); same section layout as
 * the architect-authored prefix of `plan.md` (Frame / Approaches /
 * Selected Direction / Decisions / Pre-mortem / Not Doing / Open
 * questions / Summary), but with a research-specific frontmatter block
 * (mode / topic / generatedAt) instead of the intra-flow plan
 * frontmatter, and no AC table, Topology, or Traceability block (those
 * belong to a follow-up `/cc <task>` flow that consumes this research
 * via `flowState.priorResearch`).
 *
 * The frontmatter `mode: research` field is the disambiguator between
 * this artifact and `plan.md` — readers that walk `flows/shipped/`
 * branch on this field to decide whether the slug shipped a research
 * artifact (no AC; no build / review / critic / ship stages ran) or a
 * normal plan (full pipeline).
 */
const RESEARCH_TEMPLATE = `---
slug: SLUG-PLACEHOLDER
stage: plan
status: active
mode: research
topic: TOPIC-PLACEHOLDER
generated_at: GENERATED-AT-PLACEHOLDER
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
# Architect Compose-phase ambiguity score also applies to research-mode
# composition. Same composite (0.0-1.0) across 3 dimensions (greenfield)
# or 4 dimensions (brownfield); informational signal only in v8.62
# unified flow (no mid-plan picker); never a hard gate.
ambiguity_score: null
ambiguity_dimensions: null
ambiguity_threshold: null
---

# Research — SLUG-PLACEHOLDER

> Topic: **TOPIC-PLACEHOLDER**.
>
> This artifact is the output of a \`/cc research <topic>\` flow — the
> \`architect\` specialist's standalone research-mode pass (Bootstrap
> → Frame → Approaches → Decisions → Pre-mortem → Compose, run in a
> single on-demand dispatch). No build / review / critic / ship
> stages run; the flow finalises to
> \`.cclaw/flows/shipped/<slug>/research.md\`.
>
> Optional handoff: the next \`/cc <task>\` invocation on this project
> reads the most-recent shipped research slug and stamps it into
> \`flow-state.json > priorResearch\` so the follow-up flow's
> Architect Bootstrap reads carry this
> research as context.

## Frame

_(Architect: Frame, mandatory in research mode. 2-5 sentences: what is unclear or under-explored today, who feels it, what success looks like for the RESEARCH outcome — a sharper task description, a chosen architectural direction, a vetted set of approaches — rather than for a shipped feature. What is explicitly out of scope for THIS research. Cite real evidence — \`file:path:line\`, prior shipped slugs, ticket id — when you have it.)_

## Spec

_(Architect: Frame, mandatory in research mode. Four bullets — Objective / Success / Out of scope / Boundaries — adapted for research outcomes rather than shippable features.)_

- **Objective** — _what we are researching and why, in one short line. Often a restatement of the topic from the user's prompt._
- **Success** — _high-level indicators that the research is done — what the user would observe (e.g. "user has a clear pick between approach A and B with named trade-offs"; "open questions reduced from 5 to 2")._
- **Out of scope** — _explicit non-goals derived from this Frame + the user's topic. Mirrors the \`## Not Doing\` section below at a higher altitude._
- **Boundaries** — _per-research "ask first" / "never do" constraints layered on top of the iron-laws. Examples: "do not propose changes outside the current monorepo", "stay within the existing auth provider"._

## Non-functional

_(Architect: Frame, optional. Compose the four NFR rows when the research touches a product-grade tier OR carries irreversibility (data migration, public API change, auth / payment surface, performance hot-path, accessibility-sensitive UI). Skip the section entirely when neither trigger fires.)_

- **performance:** _budgets that bound the eventual implementation (e.g. "any chosen approach must hold p95 < 200ms over 100 RPS")._
- **compatibility:** _runtime / dependency-version constraints (e.g. "must support Node 20+", "must not require a new database")._
- **accessibility:** _a11y baseline that bounds the chosen approach for UI research._
- **security:** _auth / data-classification / compliance baseline; defer threat modelling to a follow-up flow if depth is needed._

## Approaches

_(Architect: Approaches, mandatory in research mode. 2-3 candidate approaches to the Frame, each with name / what it is / trade-offs / effort / best-when. Drop dead options; do not pad to 3 rows for symmetry.)_

| Approach | What it is | Trade-offs | Effort | Best when |
| --- | --- | --- | --- | --- |
| _name_ | _one sentence_ | _2-4 bullets_ | _small/medium/large_ | _scenario_ |

## Selected Direction

_(Architect: Approaches, mandatory in research mode. One paragraph naming the picked option + rationale, including why the rejected alternatives lost. On research mode this is a RECOMMENDATION, not a commitment — the follow-up \`/cc <task>\` flow that consumes this research can pick a different approach and the research stays valid as the analysis that led to the choice.)_

## Decisions

_(Architect: Decisions, optional. For each structural decision the selected approach implies (≥2 defensible options + blast-radius + visible failure modes), append a D-N record. On research mode these are RECOMMENDATIONS — the follow-up task flow's architect can re-derive D-N inline in plan.md, optionally citing the research's D-N as prior art.)_

### Decision D-1: _one-line title_

- **Choice:** _what we're recommending — one sentence._
- **Blast-radius:** _files affected, surface touched, rollback cost — 2-4 bullets._
- **Failure modes:**
  - _mode 1 — what goes wrong, what the user sees_
  - _mode 2 — what goes wrong, what the user sees_
- **Alternatives considered:**
  - _alt A — why rejected_
  - _alt B — why rejected_
- **Refs:** _file:path:line, prior shipped slugs, doc URLs if framework-specific._

## Pre-mortem

_(Architect: Pre-mortem, optional in research mode. 3-7 failure modes ranked by likelihood × impact. For research mode, the failure modes are about the RECOMMENDED approach landing badly in the follow-up implementation: "we picked approach A, three months later it's a regret because <X>".)_

- **Failure mode 1 — _name_:** _what happened (1-2 sentences); earliest signal; mitigation._

## Not Doing

_(Architect: Compose, mandatory in research mode. 3-5 concrete bullets that bound the research's scope. On research mode this is explicit about what the research will NOT cover — e.g. "Not deciding on the migration timeline — that's a separate \`/cc <task>\` after the architecture pick lands".)_

- _bullet 1_
- _bullet 2_

## Open questions

_(Compiled across Frame / Approaches / Decisions / Pre-mortem — any unresolved ambiguity, deferred decision, or "user input needed" point. On research mode, leaving open questions is normal — the follow-up task flow's architect may resolve them at Bootstrap or Frame.)_

- _open question 1_

## Summary — architect (research mode)

### Findings

- _one bullet per major finding from the research — what we learned that the user did not know going in._

### Recommendations

- _one bullet per recommended decision — what we suggest the user / follow-up flow do, and why._

### Open questions left for the follow-up flow

- _one bullet per question that did NOT get resolved here and SHOULD be addressed when the user picks a follow-up \`/cc <task>\`._
`;

export const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  { id: "plan", fileName: "plan.md", description: "Strict-mode plan template (AC table, parallelSafe, touchSurface, traceability block).", body: PLAN_TEMPLATE },
  { id: "plan-soft", fileName: "plan-soft.md", description: "Soft-mode plan template (bullet-list testable conditions, no AC IDs).", body: PLAN_TEMPLATE_SOFT },
  { id: "build", fileName: "build.md", description: "Strict-mode build log (six-column TDD table, RED proofs, GREEN suite evidence).", body: BUILD_TEMPLATE },
  { id: "build-soft", fileName: "build-soft.md", description: "Soft-mode build log (single-cycle summary, plain git commit).", body: BUILD_TEMPLATE_SOFT },
  { id: "review", fileName: "review.md", description: "Review template with iteration table, findings table, and Five Failure Modes pass.", body: REVIEW_TEMPLATE },
  { id: "critic", fileName: "critic.md", description: "critic template — critic step falsificationist pass. Frontmatter (slug, stage=critic, posture_inherited, ceremony_mode, mode, predictions_made, gaps_found, escalation_level, verdict). Body: pre-commitment predictions, gap analysis, adversarial findings (gap mode skips), Criterion check, goal-backward verification, realist check, verdict, summary. Single-shot — re-dispatch overwrites.", body: CRITIC_TEMPLATE },
  { id: "plan-critic", fileName: "plan-critic.md", description: "plan-critic template — pre-implementation adversarial pass between architect and builder. Frontmatter (slug, stage=plan-critic, posture_inherited, ceremony_mode, ac_count, dispatched_at, iteration, predictions_made, findings, verdict). Body: goal coverage, granularity, dependency accuracy, parallelism feasibility, risk catalog, pre-commitment predictions, verdict (pass | revise | cancel), hand-off, summary. Single-shot — re-dispatch overwrites on the 1 allowed revise loop. Verdict: pass (advance to builder), revise (bounce to architect once), cancel (user picker).", body: PLAN_CRITIC_TEMPLATE },
  { id: "qa", fileName: "qa.md", description: "qa-runner template — behavioural-QA pass for UI surfaces between build and review. Frontmatter (slug, stage=qa, specialist=qa-runner, dispatched_at, iteration, surfaces, evidence_tier, ui_acs_total/pass/fail/pending, predictions_made, findings, verdict). Body: surfaces under QA, browser tool detection, §3 pre-commitment predictions (3-5), per-criterion evidence (one block per UI-tagged AC with Status pass/fail/pending-user), findings (failures only), verdict (pass | iterate | blocked), hand-off, summary. Single-shot — re-dispatch overwrites on the 1 allowed iterate loop. Verdict: pass (advance to review), iterate (bounce to builder once), blocked (user picker — browser tools unavailable AND manual steps required).", body: QA_TEMPLATE },
  { id: "ship", fileName: "ship.md", description: "Ship notes template with AC↔commit map, push/PR section, release notes paragraph.", body: SHIP_TEMPLATE },
  { id: "decisions", fileName: "decisions.md", description: "Legacy decision-record template (D-N entries). v8.14+ inlines D-N rows in plan.md > ## Decisions; this template is only installed when legacy-artifacts: true.", body: DECISIONS_TEMPLATE },
  { id: "learnings", fileName: "learnings.md", description: "Compound learning capture template with belief/outcome/follow-up sections.", body: LEARNINGS_TEMPLATE },
  { id: "manifest", fileName: "manifest.md", description: "Shipped manifest template; lists AC, artifacts, refines link.", body: MANIFEST_TEMPLATE },
  // by the `architect` specialist in standalone research activation;
  // finalised to `.cclaw/flows/shipped/<slug>/research.md`. The
  // frontmatter `mode: research` field is the disambiguator between
  // this artifact and `plan.md` — readers that walk `flows/shipped/`
  // branch on this field to decide which artifact shape the slug
  // shipped.
  { id: "research", fileName: "research.md", description: "research-mode artifact — standalone `architect` specialist output for `/cc research <topic>` flows. Same section layout as the architect-authored prefix of plan.md (Frame / Spec / NFR / Approaches / Selected Direction / Decisions / Pre-mortem / Not Doing / Open questions / Summary), plus the research-specific frontmatter (mode: research, topic, generated_at). No AC table, no Topology, no Traceability — those belong to the follow-up `/cc <task>` flow that consumes this research via `flowState.priorResearch`. Ambiguity score still emitted (informational; no mid-plan picker in v8.62).", body: RESEARCH_TEMPLATE }
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

/**
 * render the standalone research-mode artifact for a fresh
 * `/cc research <topic>` flow. The orchestrator calls this immediately
 * after stamping the sentinel triage block (`triage.mode == "research"`)
 * and before dispatching the architect in standalone research mode;
 * the templated file lands at `.cclaw/flows/<slug>/research.md` for
 * the architect's Bootstrap pass to pick up. The placeholders match
 * the template body verbatim:
 *
 * - `SLUG-PLACEHOLDER` — the research-mode slug (always
 *   `YYYYMMDD-research-<semantic-kebab>` per the Detect step's
 *   research-mode fork; the `-research-` infix is mandatory).
 * - `TOPIC-PLACEHOLDER` — the topic line, i.e. the user's
 *   `/cc research <topic>` argument with the `research ` / `--research`
 *   trigger stripped. The orchestrator passes it verbatim so the
 *   user's framing is preserved in the artifact frontmatter.
 * - `GENERATED-AT-PLACEHOLDER` — ISO-8601 timestamp at which the
 *   orchestrator stamped the template (research flow start).
 */
export function researchTemplateForSlug(
  slug: string,
  topic: string,
  generatedAtIso: string
): string {
  return templateBody("research", {
    "SLUG-PLACEHOLDER": slug,
    "TOPIC-PLACEHOLDER": topic,
    "GENERATED-AT-PLACEHOLDER": generatedAtIso
  });
}

export function manifestTemplate(slug: string, shipCommit: string, shippedAt: string): string {
  return templateBody("manifest", {
    "SLUG-PLACEHOLDER": slug,
    "SHIP-COMMIT-PLACEHOLDER": shipCommit,
    "SHIPPED-AT-PLACEHOLDER": shippedAt
  });
}

/**
 * render the `## Extends` section that the architect (Bootstrap)
 * writes at the top of plan.md when `flowState.parentContext` is set.
 * The function takes the structured `ParentContext` (the orchestrator
 * stamped it into flow-state at extend init) and an optional
 * `decisionSummary` (a one-line synthesis of the parent's highest-
 * blast-radius D-N; the architect composes this from the parent's
 * plan.md `## Decisions` section, or falls back to a default sentence
 * when no D-N records exist).
 *
 * The relative artifact links use the `../shipped/<parent-slug>/`
 * pattern (walking from `.cclaw/flows/<new-slug>/plan.md` up to
 * `.cclaw/flows/shipped/<parent-slug>/`); the new slug is not needed
 * here because the relative path is symmetric.
 *
 * The output is one Markdown block ready to splice into plan.md
 * between the H1 title and the `## Frame` heading. No trailing
 * newline — the caller adds whatever separator their splicer needs.
 *
 * The function does NOT read parent artifacts to compose the summary
 * — that's the architect's job (the parent's plan.md is in the new
 * flow's read-set at extend init via `parentContext.artifactPaths.plan`).
 * This is a pure rendering helper; supply the summary text from
 * upstream.
 */
export interface ExtendsSectionInput {
  parentSlug: string;
  shippedAt?: string;
  /**
   * One-line synthesis of the parent's highest-blast-radius D-N (e.g.
   * "switched session storage from Redis to Postgres for durability
   * (D-2 in parent's plan)"), OR the parent's `## Selected Direction`
   * one-liner when no D-N records exist, OR `"see parent's plan for
   * context"` when both are absent. Trimmed; never empty.
   */
  decisionSummary: string;
  /**
   * Map of artifact-key → relative path. The keys are the optional
   * artifacts (`build` / `review` / `critic` / `qa` / `learnings`);
   * `plan` is implicit (always present, always linked). Pass only the
   * keys whose underlying file exists — `loadParentContext` already
   * filtered out missing artifacts in `parentContext.artifactPaths`.
   *
   * Each value is the path as it should appear in the rendered link
   * (typically `../shipped/<parent-slug>/<artifact>.md`). The helper
   * does NOT compute paths; the caller passes them so this function
   * stays a pure renderer with no filesystem dependency.
   */
  optionalArtifactRelativePaths: Partial<Record<"build" | "review" | "critic" | "qa" | "learnings", string>>;
  /**
   * Relative path to the parent's plan.md, e.g.
   * `../shipped/20260514-auth-flow/plan.md`. Always rendered (the
   * `plan` artifact is mandatory; its presence was the validation
   * gate at `/cc extend`).
   */
  planRelativePath: string;
}

export function renderExtendsSection(input: ExtendsSectionInput): string {
  const {
    parentSlug,
    shippedAt,
    decisionSummary,
    optionalArtifactRelativePaths,
    planRelativePath
  } = input;
  if (typeof parentSlug !== "string" || parentSlug.length === 0) {
    throw new Error("renderExtendsSection: parentSlug must be a non-empty string");
  }
  if (typeof decisionSummary !== "string" || decisionSummary.trim().length === 0) {
    throw new Error("renderExtendsSection: decisionSummary must be a non-empty string");
  }
  if (typeof planRelativePath !== "string" || planRelativePath.length === 0) {
    throw new Error("renderExtendsSection: planRelativePath must be a non-empty string");
  }
  const shippedAtFragment = shippedAt && shippedAt.length > 0 ? `shipped ${shippedAt}` : "shipped date unknown";
  const lines: string[] = [];
  lines.push("## Extends");
  lines.push("");
  lines.push(
    `\`refines: ${parentSlug}\` (${shippedAtFragment}). Parent decision summary: ${decisionSummary.trim()}`
  );
  lines.push("");
  lines.push("Parent artifacts:");
  lines.push(`- [plan](${planRelativePath})`);
  const ORDER: ReadonlyArray<keyof typeof optionalArtifactRelativePaths> = [
    "build",
    "qa",
    "review",
    "critic",
    "learnings"
  ];
  for (const key of ORDER) {
    const value = optionalArtifactRelativePaths[key];
    if (typeof value === "string" && value.length > 0) {
      lines.push(`- [${key}](${value})`);
    }
  }
  return lines.join("\n");
}
