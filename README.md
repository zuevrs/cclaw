# cclaw

**cclaw is a lightweight harness-first flow toolkit for coding agents.** Three slash commands. Seven hops (`Detect → Triage → Pre-flight → Dispatch → Pause → Compound → Finalize`). Four stages (`plan → build → review → ship`, where **build IS a TDD cycle**: RED → GREEN → REFACTOR). Six on-demand specialists, every one of them dispatched with a **mandatory contract read** (`.cclaw/lib/agents/<name>.md` + wrapper skill) before it acts, all running as isolated sub-agents and emitting a calibrated `Confidence: high | medium | low` signal. Two read-only research helpers (`repo-research`, `learnings-research`) that every plan dispatch invokes before authoring, so plans are grounded in real repo signals and prior shipped lessons rather than training memory. Three Acceptance-Criteria modes (`inline` / `soft` / `strict`) so trivial edits do not pay the price of risky migrations. A five-axis review (`correctness · readability · architecture · security · performance`) with a five-tier severity vocabulary, a strict-mode adversarial pre-mortem before ship, and a source-driven mode that grounds framework code in current docs. A deep content layer of skills, templates, runbooks, patterns, examples, and recovery playbooks wrapped around a runtime under 1 KLOC — so Claude Code, Cursor, OpenCode, or Codex can move from idea to shipped change with a clear plan, the right amount of ceremony, and almost no orchestrator bloat.

```text
            idea
             │
             ▼
         /cc <task>
             │
   ┌─────────┴──────────────────────────────────────────┐
   │ Hop 1: Detect — fresh start? or resume active flow? │
   └─────────┬──────────────────────────────────────────┘
             │ fresh
             ▼
   ┌────────────────────────────────────────────────────┐
   │ Hop 2: Triage — auto-classify task,                │
   │ recommend path + acMode, runMode (step/auto)       │
   └─────────┬──────────────────────────────────────────┘
             │
             ▼
   ┌────────────────────────────────────────────────────┐
   │ Hop 2.5: Pre-flight — surface 3-7 assumptions      │
   │ (stack, conventions, defaults, out-of-scope);      │
   │ user confirms; persisted to triage.assumptions.    │
   │ skipped on inline + on resume                      │
   └─────────┬──────────────────────────────────────────┘
             │
   trivial   │   small-medium       │   large-risky
   acMode    │   acMode soft        │   acMode strict
   inline    │                      │
             ▼                      ▼                      ▼
        edit + commit        plan → build → review → ship   brainstorm? → architect? → plan → build → review → ship
        (no plan)            each stage in a fresh sub-agent  each stage in a fresh sub-agent, parallel-build allowed
                                     │                      │       five-axis review · adversarial pre-mortem
                                     └─────────┬────────────┘
                                               ▼
                                  compound (auto, gated by quality)
                                               │
                                               ▼
                                   active flows → shipped/<slug>/
```

Three slash commands (`/cc`, `/cc-cancel`, `/cc-idea`). Four stages (`plan → build → review → ship`). Six specialists, all on-demand, all running as sub-agents, all emitting `Confidence: high | medium | low`. Twenty-four auto-trigger skills including the always-on `triage-gate`, `flow-resume`, `pre-flight-assumptions`, `tdd-cycle`, `conversation-language`, `anti-slop`, and the strict-mode-default `source-driven`. Eleven templates including `plan-soft.md` and `build-soft.md` for the soft-mode path. Four runbooks. Two reference patterns (`auth-flow` + `security-hardening`; v8.12 trimmed the orphan six). Seven antipatterns (`A-1`..`A-7`; v8.12 deleted the 24 unused entries). Recovery / research / examples libraries are now empty by default — the orchestrator handles recovery inline; shipped flows under `flows/shipped/` are the canonical worked examples. `legacy-artifacts: true` in `.cclaw/config.yaml` brings all the deleted content back. Two mandatory gates in strict mode (AC traceability + TDD phase chain); soft mode keeps both as advisory; inline mode skips both.

## What changed in 8.13

8.13 is a power-and-economy release. After a multi-subagent audit (10+ parallel agents across the same eleven reference repos plus an internal review of cclaw's runtime + prompts), 40 actionable items were selected covering speed, token economy, stage power, and architectural foundations.

**Speed and token wins (T0).**

- The planner now dispatches `learnings-research` and `repo-research` (when triggered) **in the same tool-call batch**, saving one LLM round-trip on every plan invocation.
- The Hop 2 triage example now uses a **single multi-question form** (path + run-mode in one `askUserQuestion` call), saving one user round-trip on every fresh flow.
- The ship stage's parallel reviewers receive a **shared parsed-diff context**: the orchestrator parses `git diff` once and passes the result, so three reviewers no longer re-parse the same diff.
- The discovery sub-phase has an **auto-skip heuristic** for `triage.confidence: high` large-risky tasks — brainstormer + architect can be skipped when ambiguity is low, going straight from triage to planner. Saves two specialist dispatches and two user pauses.
- The compound + ship step now **scans the active flow directory dynamically**, moving every emitted file to `shipped/<slug>/` instead of a hard-coded list. No orphan artefacts left in `flows/<slug>/` after ship.

**Plan stage power (T1).**

- Each AC in `plan.md` now carries a `dependsOn: []` graph (acyclic, topological commit order) and a `rollback: "..."` strategy in frontmatter. Planner self-review enforces graph acyclicity.
- Plans carry a `feasibility_stamp: green | yellow | red` that the planner computes from coverage of unknowns, schema impact, and risk concentration. A `red` stamp **blocks build dispatch** until the plan is revised; `yellow` triggers a structured ask before continuing.
- The planner reuses `flows/<slug>/research-repo.md` and the `learnings-research` blob across subsequent specialists — must NOT re-dispatch research helpers when the cache is fresh.

**Build stage power (T1).**

- The slice-builder runs **non-functional checks per AC** between GREEN and REFACTOR: branch-coverage delta, perf-smoke check, plus triggered checks for schema/migration and API contract diff.
- Refactor-only AC now require `No-behavioural-delta` evidence (anchored test, before/after diff, no public-API drift) — the verdict is part of the build slim-summary.
- Slice-builder enumerates **refactor candidates** (duplication, long methods, shallow modules, feature envy, primitive obsession) with explicit verdicts, and forbids refactor while RED.
- Parallel-build fallback to inline-sequential is **no longer silent**: an explicit warning is rendered and the user must accept-fallback before continuing; `fallback_reason` is recorded in `build.md`.

**Review stage power (T1).**

- Reviewer now uses a **seven-axis review** (`correctness · test-quality · readability · architecture · complexity-budget · security · performance`). The slim-summary axes counter is `c=N tq=N r=N a=N cb=N s=N p=N`.
- Reviewer **auto-detects security-sensitive surfaces** from the diff (regardless of `security_flag` in triage): auth, secrets, crypto, supply-chain, data exposure, IPC.
- Adversarial pre-mortem **re-runs on fix-only hot paths** when the same file or symbol has surfaced findings in three or more iterations — surfaces a `## Pre-mortem (adversarial, rerun)` section appended to `review.md`.
- The 5-iteration cap now produces a **structured split-plan recovery**: the orchestrator surfaces a `Recommended split` block (separate AC, separate slug, separate ship) instead of nuking the flow.

**Ship stage power (T1).**

- The ship runbook **mandates a CI smoke gate**: lint + typecheck + unit-test (with `--reporter=verbose` on changed files) before the manifest is stamped. Three modes: `strict` (full CI mirror), `relevant` (changed-files only), `skip` (CI-bypass with `--ci-bypass=intentional` flag).
- The ship runbook **auto-generates release notes** from AC↔commit evidence: `## Release notes` section in `ship.md` populated from each AC's verification line + commit subject. The Victory Detector requires `release_notes_filled: true`.
- The `## What didn't work` section is mandatory in `ship.md` — surfaces dead-end approaches, abandoned attempts, and decisions that were considered and rejected. Future agents reading shipped slugs see the negative space, not just what shipped.
- The compound quality gate has a **learnings hard-stop on non-trivial slugs**: when the gate doesn't fire on a slug ≥4 AC, the orchestrator surfaces an explicit `Capture learnings? — yes / no / explain-why-not` prompt instead of silently skipping. Bypassable via `config.captureLearningsBypass: true` for autonomous pipelines.

**T2 capabilities.**

- New `verification-loop` skill — auto-trigger gate that runs `build → typecheck → lint → test → security → diff` in **strict / continuous / diff-only** modes between AC. Strict for ship; continuous for build phase; diff-only for fix-only flows.
- New `tests/unit/prompt-budgets.test.ts` — per-specialist line + char ceilings (planner ≤ 380 lines, slice-builder ≤ 360, reviewer ≤ 320, etc.) with a soft combined ceiling. Enforced on every commit; prevents prompt sprawl from accumulating.
- New **Handoff artifacts** (`HANDOFF.json` + `.continue-here.md`) written at every stage exit: machine-readable state + human-readable resume note. Idempotent rewrites — every checkpoint replaces the previous instance, no append-only history bloat.
- New **Compound-refresh sub-step** runs every 5th capture (gated by floor of 10 entries): dedup / keep / update / consolidate / replace actions over `.cclaw/knowledge.jsonl`. Configurable via `config.compoundRefreshEvery` and `config.compoundRefreshFloor`.
- New `scripts/analyze-token-usage.mjs` — post-flow telemetry (token estimate per slug + per artefact, supporting `--active`, `--shipped`, `--json`). Estimates use `chars / 4`.
- TDD-cycle skill carries an **anti-rationalization table** (`rationalization | truth` rows) — explicit list of the eight excuses agents will produce to skip the cycle, paired with the right answer. When you catch yourself thinking the left column, do the right column instead.
- New **Discoverability self-check** as a Hop 5 sub-step: after compound writes a `knowledge.jsonl` row, the orchestrator confirms that at least one of `AGENTS.md` / `CLAUDE.md` / `README.md` references the catalogue. If none do, it surfaces a structured ask before considering the flow truly shipped.

**T3 architectural foundations.**

- New `ModelPreferences` interface in `.cclaw/config.yaml`: per-specialist tier hints (`fast` / `balanced` / `powerful`). Optional, defaulted off — harnesses that support model routing can honour the tier in dispatch envelopes.
- New **namespace router** (gsd pattern, opt-in): documented `/cc-plan`, `/cc-build`, `/cc-review`, `/cc-ship`, `/cc-compound-refresh` routes that map back to `/cc --enter=<stage>` semantics. Harnesses with command palettes can surface stage shortcuts without inventing semantics.
- New **two-reviewer per-task loop** (obra pattern, opt-in): on the highest-risk band (`large-risky` + `security_flag: true`), the reviewer splits into two passes — spec-review first (correctness + test-quality only), code-quality-review second (readability + architecture + complexity-budget + perf only). Pass 2 short-circuits on `spec-block`. Single-pass remains the v8.12 default; two-pass triggers via `config.reviewerTwoPass: true` or auto-fires on the high-risk combo.

**Tests.** New `tests/unit/v813-cleanup.test.ts` (31 tripwire tests covering all T0/T1/T2/T3 invariants) + `tests/unit/prompt-budgets.test.ts` (9 prompt-size tests). 444 tests across 42 files, all green. No prose-locked test rewrites needed — every change extended the spec rather than rewriting it.

No breaking changes. Drop-in upgrade from 8.12.x. New config keys are all optional and defaulted off.

## What changed in 8.12

8.12 is a cleanup release. The audit against eleven reference repos (`addyosmani-skills`, `everyinc-compound`, `gsd-v1`, `gstack`, `mattpocock-skills`, `obra-superpowers`, `oh-my-claudecode`, etc.) found that cclaw was carrying a lot of dead weight from earlier releases. We deleted it.

- **Twelve Tier-0 bug fixes.** `Recommended next` enum normalised across the orchestrator and four specialists (each ships its tuned subset of `continue | review-pause | fix-only | cancel | accept-warns-and-ship`). `securityFlag` → `security_flag` (snake_case) in learnings frontmatter to match the artefact-frontmatter convention. The adversarial pre-mortem no longer prompts for a literal future date — it is a "scenario exercise" reasoning backwards from "this shipped and failed". `finalization_mode` frontmatter on `ship.md` is now the source of truth (the body's `Selected:` line is supplementary). `ship.md` is re-authored idempotently when late iterations land — no delta paragraphs, no stale counts. The ship-gate picker no longer offers a clickable `Cancel` row (`/cc-cancel` is a separate explicit user-typed command). Discovery checkpoint questions from brainstormer / architect render through the harness's structured ask, not as fenced English. The decision-protocol short-form no longer cites the deleted worked-examples library.

- **Antipattern catalogue trimmed 33 → 7.** The audit found that of 33 antipatterns shipped in 8.11, only 7 were ever explicitly cited by reviewer / slice-builder rules. The other 26 were "reference reading" the reviewer was supposed to consult but never named by ID. Deleted them. The remaining 7 (TDD phase integrity, work-outside-the-AC, mocking-what-should-not-be-mocked, drive-by edits, deletion of pre-existing dead code, untagged debug logs, single-run flakiness conclusion) are renumbered A-1 through A-7. A migration note in `antipatterns.md` carries the old → new mapping for anyone returning to a v8.11-shipped slug. Citations across `skills.ts`, `slice-builder.ts`, `reviewer.ts` were updated in lockstep.

- **Reference patterns trimmed 8 → 2.** Same audit finding: only `auth-flow` and `security-hardening` were explicitly named by orchestrator dispatch logic; the other six (`api-endpoint`, `schema-migration`, `ui-component`, `perf-fix`, `refactor`, `doc-rewrite`) were generic reading material. Deleted. Recovery playbooks (5 → 0), research playbooks (3 → 0), and worked examples (8 → 0) all went the same way — orphan content with no spec line ever naming a specific file. Recovery is now handled inline by the orchestrator (pause → surface options → user-driven decision), and shipped flows under `flows/shipped/<slug>/` are now the canonical worked examples.

- **Artefact layout collapsed 9 → 6.** `manifest.md` is gone — its frontmatter (slug, ship_commit, shipped_at, ac_count, review_iterations, security_flag, has_architect_decision, refines) is now stamped onto `ship.md` itself, with an `## Artefact index` section at the bottom listing every moved file. `pre-mortem.md` is gone — the adversarial pass appends a `## Pre-mortem (adversarial)` section to the same `review.md`. `research-learnings.md` is gone — the `learnings-research` helper now returns its 0-3 prior lessons inline as a `lessons={...}` blob in the slim-summary's `Notes` field, which the planner copies verbatim into `plan.md`'s `## Prior lessons` section. `cancel.md` replaces `manifest.md` for cancelled flows (the manifest concept is reserved for shipped slugs).

- **`legacy-artifacts: true` opt-in flag.** `.cclaw/config.yaml` accepts a new optional boolean. Default `false`. When set to `true`, every deletion above is reverted: shipped flows write a separate `manifest.md` alongside `ship.md`, the adversarial reviewer mirrors the pre-mortem section to a standalone `pre-mortem.md`, the learnings research helper writes `research-learnings.md`, and the deleted libraries (recovery / research / examples / 24 antipatterns / 6 patterns) come back. The flag exists for downstream tooling that hard-coded paths to the old layout — there is no behavioural reason to set it on a fresh install.

- **Install summary hides empty rows.** `cclaw init` no longer prints `Research 0 · Recovery 0 · Examples 0` when those libraries are empty in default mode. Rows with `count > 0` only.

The audit also surfaced two extraction targets (subagent-envelope shared section, brownfield-read-order shared section) and two skills.ts dedupe targets (TDD canonical statement, sensitive-surface canonical) that, on closer inspection, turned out to be tuned per-specialist contextual references rather than copy-paste duplicates. We left them alone — extraction would have lost the per-callsite tuning.

Net diff: ~1300 lines deleted, ~470 added. README trimmed from 421 to ~250 lines (8.10.1 through v8 history moved to `CHANGELOG.md`). All 377 tests green.

## What changed in 8.11

8.11 is a non-breaking orchestrator-spec cleanup release on top of 8.10.1. Five concrete UX regressions from a real session log got fixed:

- **Discovery sub-phase always pauses regardless of `runMode`.** In `large-risky` flows the brainstormer → architect → planner chain used to blow through in `auto` mode — the user never saw the brainstormer's `selected_direction` before architect's tradeoffs landed on top. Now each discovery step renders its slim summary and ends the turn; the user types `/cc` to advance. The auto-mode chain only applies to plan → build → review → ship transitions, never to discovery-internal handoffs.
- **`Cancel` is no longer a clickable option in any picker.** Hop 1 detect, Hop 2.5 pre-flight, Hop 4 hard gates, flow-resume picker, and interpretation forks all dropped their `Cancel` row. `/cc-cancel` is a separate explicit user-typed command for nuking flow state — the orchestrator surfaces it only in plain prose, only when the user looks stuck. Putting a destructive command behind a one-keystroke option was a footgun.
- **`/cc` is the single resume verb.** Step mode used to say `I type "continue" to advance` (three places: start-command, triage-gate, flow-resume) — two competing magic words for the same action. Now `step` mode = render slim summary, end the turn; the user sends `/cc` (the same verb that resumes any other paused flow). One mechanic, one verb.
- **Slug naming format is `YYYYMMDD-<semantic-kebab>`.** Hop 2 Triage now mandates a date prefix on every minted slug (`20260510-billing-rewrite`). Same-day collisions resolve by appending `-2`, `-3`, etc. The date prefix is mandatory and ASCII regardless of conversation language. `orchestrator-routing.semanticSlugTokens(slug)` strips the prefix before Jaccard matching, so same-topic flows on different days are still reliably matched against shipped artefacts.
- **Structured asks render in the user's conversation language.** Every fenced `askUserQuestion(...)` example in `start-command.ts`, `skills.ts` (triage-gate, pre-flight-assumptions, interpretation-forks, flow-resume), and `conversation-language.md` now uses `<option label conveying: ...>` placeholder notation instead of literal English option strings. The agent cannot copy a literal English string because there isn't one — the slot describes the intent and the agent must verbalise it in the user's language. Mechanical tokens (`/cc`, `/cc-cancel`, stage names, mode names, slugs, file paths, JSON keys, `AC-N`, complexity / acMode keywords) stay in their original form. The `conversation-language` skill's worked example was rewritten as a language-neutral schema. The `brainstormer.ts` and `architect.ts` specialist prompts now explicitly require `checkpoint_question`, `What changed`, `Notes`, and `open_questions` values to render in the user's language.

23 new tests (`tests/unit/v811-cleanup.test.ts`) cover all five fixes; the existing start-command resume test was updated to match the new placeholder shape. 385 tests across 40 files, all green.

No breaking changes, no new CLI commands, no new config keys, no new dependencies. Existing flows with non-dated slugs continue to work; the date prefix is only required for new slugs minted on or after 8.11.

## Earlier releases

The full release history (8.10.1 install-UX patches, 8.10 install-UX polish, 8.9 knowledge dedup + coverage beat, 8.8 cleanup, 8.7 surgical-edit hygiene + debug-loop + browser-verification, 8.6 three-section Summary + ADR catalogue, 8.5 Hop-6 Finalize + research helpers, 8.4 confidence calibration + pre-flight assumptions + five-axis review, 8.3 triage as structured ask + run-mode + parallel-build, 8.2 triage gate + graduated AC + sub-agent dispatch, v8.0 redesign and v7→v8 migration) lives in [CHANGELOG.md](CHANGELOG.md). The README only covers the two most recent releases (current + previous) so the headline keeps shrinking instead of growing.

## First 5 minutes

Requirements: Node.js 20+ and a git project.

```bash
cd /path/to/your/repo
npx cclaw-cli init                            # interactive picker; auto-detected harness pre-selected
npx cclaw-cli init --harness=claude,cursor,opencode,codex   # explicit, no picker
```

`init` resolves harnesses in this order:

1. `--harness=<id>[,<id>]` flag if passed.
2. Existing `.cclaw/config.yaml` (so subsequent `init` / `sync` / `upgrade` are deterministic).
3. **Interactive picker** when stdin/stdout are a TTY: a checkbox over the four harnesses with auto-detected ones pre-selected and tagged `(detected)`. Up/Down or k/j to move, Space to toggle, `a` to select all, `n` to deselect all, Enter to confirm, Esc/Ctrl-C to cancel.
4. Non-TTY (CI, piped input, `npm exec --yes`): auto-detect from project root markers: `.claude/`, `.cursor/`, `.opencode/`, `.codex/`, `.agents/skills/`, `CLAUDE.md`, `opencode.json`, `opencode.jsonc`.
5. If nothing detected and no flag passed → exit with an actionable error. cclaw never silently picks a harness for you.

Then work entirely inside your harness:

```text
/cc <task>          plan / build / review / ship — orchestrator routes everything
/cc-cancel          stop the active run cleanly (artifacts move to .cclaw/flows/cancelled/<slug>/)
/cc-idea            drop a half-formed idea into .cclaw/ideas.md (no flow started)
```

There is no `cclaw plan`, `cclaw status`, `cclaw ship`, or `cclaw migrate` CLI command. Flow control lives in `/cc` inside the harness.

## Six specialists, all on demand

| id | modes | when |
| --- | --- | --- |
| `brainstormer` | frame / scope / alternatives | ambiguous request, need a frame and scope |
| `architect` | architecture / feasibility | structural decisions or feasibility check |
| `planner` | research / work-breakdown / topology | breaking work into AC and choosing topology |
| `reviewer` | code / text-review / integration / release / adversarial | reviews of any kind |
| `security-reviewer` | threat-model / sensitive-change | auth / secrets / supply chain / data exposure |
| `slice-builder` | build / fix-only | implementing AC and applying scoped fixes |

Specialists are proposed only when the task is large, abstract, risky, security-sensitive, or spans multiple components. Trivial and small/medium tasks run inline. Each prompt is 150-280 lines and includes an explicit output schema, two or more worked examples, edge cases, common pitfalls, and hard rules (see `.cclaw/lib/agents/*.md` after install). The orchestrator pulls additional context from runbooks, patterns, examples, and recovery playbooks as needed; see [docs/skills.md](docs/skills.md) for the auto-trigger layer that wraps every invocation.

## Plan artifact, by example

```yaml
---
slug: approval-page
stage: plan
status: active
ac:
  - id: AC-1
    text: "User sees an approval status pill on the dashboard."
    status: pending
  - id: AC-2
    text: "Pending approvals show a tooltip with the approver's name."
    status: pending
last_specialist: null
refines: null
shipped_at: null
ship_commit: null
review_iterations: 0
security_flag: false
---

# approval-page

> One paragraph: what we are doing and why.

## Acceptance Criteria

| id | text | status | commit |
| --- | --- | --- | --- |
| AC-1 | User sees an approval status pill on the dashboard. | pending | — |
| AC-2 | Pending approvals show a tooltip with the approver's name. | pending | — |
```

The same shape applies to `build.md` (commit log), `review.md` (findings + Five Failure Modes pass), `ship.md` (release notes + push/PR refs), `decisions.md` (architect output), `learnings.md` (compound output). Templates live in `.cclaw/lib/templates/`.

## Artifact tree

```
.cclaw/
  config.yaml               cclaw config (harness, flow defaults)
  ideas.md                  append-only idea backlog (/cc-idea)
  knowledge.jsonl           cross-feature learnings index, append-only
  state/
    flow-state.json         ~500 bytes, schemaVersion: 2
  hooks/
    session-start.mjs       rehydrates flow state on harness boot
    stop-handoff.mjs        short reminder when stopping mid-flow
    commit-helper.mjs       atomic commit per AC + traceability + TDD phase gate
  flows/                    everything that comes out of a /cc run
    <slug>/                 one folder per active flow
      plan.md               current work + AC
      build.md              implementation log + TDD evidence
      review.md             Concern Ledger + iteration logs
      ship.md               preflight + AC↔commit map + rollback + finalization
      decisions.md          architect output (optional; only when architect ran)
      learnings.md          compound output (optional; only when gated)
    shipped/<slug>/         plan.md, build.md, review.md, ship.md,
                            decisions.md, learnings.md, manifest.md
    cancelled/<slug>/       when /cc-cancel is invoked
  lib/                      reference content shipped by the installer
    agents/                 6 specialist prompts (each ends with a Composition footer
                            locking it to its lane — no nested orchestration)
    skills/                 12 auto-trigger skills (2 always-on: conversation-language,
                            anti-slop; 10 stage- or event-gated)
    templates/              9 templates (plan, build, review, ship, decisions,
                            learnings, manifest, ideas, iron-laws)
    runbooks/               4 stage runbooks (plan, build, review, ship)
    patterns/               8 task-type playbooks
    research/               3 research playbooks
    recovery/               5 recovery playbooks
    examples/               8 worked examples
    antipatterns.md         12 named failure modes
    decision-protocol.md    short-form digest; full schema in lib/agents/architect.md
```

`.cclaw/state/` and `.cclaw/worktrees/` are appended to `.gitignore` on init (transient per-session data). The rest of `.cclaw/` is committable; graphify, team review, and the next agent all need it.

The split is deliberate. Active and archived flow artifacts go under `flows/` so the orchestrator never confuses them with the read-only library under `lib/`. Runtime (`state/`, `hooks/`) stays at the top so harness hooks can find it without traversal. Active flows are grouped by slug — open `flows/<slug>/` and every artifact for that flow is right there, instead of scattered across six per-stage subdirectories.

## AC traceability gate (mandatory)

Ship is blocked unless every AC in the active plan is `status: committed` with a real commit SHA. The `commit-helper.mjs` hook is the only supported way to commit during `/cc`:

```bash
git add path/to/changed/file
node .cclaw/hooks/commit-helper.mjs --ac=AC-1 --message="implement approval pill"
```

The hook checks that `AC-1` is declared in `plan.md`, refuses to run when `flow-state.json` schemaVersion is not `2`, runs `git commit`, captures the new SHA, and writes it back into `flow-state.json`. If you commit by hand, AC traceability breaks and ship will refuse.

## Compound learnings (automatic, gated)

After ship, cclaw automatically checks whether the run produced something worth remembering:

- a non-trivial decision was recorded by `architect` or `planner`, **or**
- review needed three or more iterations, **or**
- a security review ran or `security_flag` is true, **or**
- the user explicitly asked to capture (`/cc <task> --capture-learnings`).

If yes → `flows/<slug>/learnings.md` is written from the template, and one line is appended to `knowledge.jsonl` recording the slug, ship_commit, signals, and `refines` chain. If no → silently skipped, so the index stays signal-rich. Then everything moves to `flows/shipped/<slug>/` with a `manifest.md`.

## Parallel-build (cap: 5 slices, git worktree)

Inline is the default. Parallel-build is opt-in and only when planner declares it. Pre-conditions: ≥4 AC, ≥2 distinct touchSurface clusters, every AC `parallelSafe: true`, no AC depends on outputs of another AC in the same wave.

A **slice = 1+ AC with a shared touchSurface**. If planner produces more than 5 slices, planner must merge thinner slices into fatter ones — never generate "wave 2", "wave 3". The 5-slice cap is the v7-era constraint kept on purpose: orchestration cost grows non-linearly past 5 sub-agents, and 5 fits comfortably under every harness's sub-agent quota.

When the harness supports sub-agent dispatch, each parallel slice runs in its own worktree:

```bash
git worktree add .cclaw/worktrees/<slug>-slice-1 -b cclaw/<slug>/slice-1
git worktree add .cclaw/worktrees/<slug>-slice-2 -b cclaw/<slug>/slice-2
git worktree add .cclaw/worktrees/<slug>-slice-3 -b cclaw/<slug>/slice-3
```

Each slice-builder runs RED → GREEN → REFACTOR for every AC it owns sequentially inside its worktree. After the wave, `reviewer` in `integration` mode reads from each worktree's branch and the orchestrator merges them in. If the harness does not support sub-agent dispatch (or worktree creation fails), parallel-build degrades silently to inline-sequential — recorded but not an error.

For ≤4 AC the orchestrator picks `inline` even when AC look "parallelSafe". Dispatch overhead is not worth saving 1-2 AC of wall-clock.

## When sub-agents help (and when they don't)

Use a sub-agent for:

- **Parallel slice dispatch** during `parallel-build` (cap: 5).
- **Specialist context isolation** for `architect`, `security-reviewer`, integration `reviewer` when the harness supports it. A fresh sub-agent reads a small focused filebag instead of the orchestrator's full history.

Don't use a sub-agent for:

- Trivial / small / medium slugs (≤4 AC). Run inline.
- Sequential work that doesn't actually parallelize.
- Routine work the orchestrator can finish in 1-2 turns.

## Five Failure Modes + review Ralph loop

Reviews check the Five Failure Modes — hallucinated actions, scope creep, cascading errors, context loss, tool misuse — every iteration. The Five Failure Modes pass is wrapped by the `review-loop` auto-trigger skill so the agent cannot skip it.

Reviews are not single-shot. They are a Ralph loop with an explicit ledger:

1. Iteration 1 lists every finding as F-1, F-2, … in an append-only **Concern Ledger** at the top of `flows/<slug>/review.md`. Each row carries severity (`block` / `warn`), status (`open` / `closed` / `superseded`), and a `file:line` citation.
2. Iteration N+1 must reread every open row, mark it `closed | open | superseded by F-K`, and append new findings as F-(max+1). It cannot delete or rewrite earlier rows.
3. The loop ends when (a) every row is `closed`, (b) two consecutive iterations record zero new `block` findings AND every open row is `warn`, or (c) the 5-iteration hard cap fires with at least one open block row — at which point `/cc` stops and reports instead of looping forever.

A typical run converges in 1-3 iterations. The hard cap is a circuit breaker, not a target.

## Conversation language

cclaw replies in the user's language for prose. It NEVER translates wire-protocol identifiers — slugs, `AC-N`, `D-N`, `F-N`, frontmatter keys, file paths, hook output, specialist names, or commit tags. This is enforced by the always-on `conversation-language` skill so a Russian-speaking user, for example, gets Russian explanations but still sees `flow-state.json` and `AC-1` verbatim.

## Hooks (default profile: minimal)

Three hooks ship by default and only `commit-helper.mjs` is mandatory:

- `session-start.mjs` — rehydrates flow state and prints active slug
- `stop-handoff.mjs` — short reminder when stopping mid-flow
- `commit-helper.mjs` — atomic commit per AC + traceability check

## CLI commands

```bash
cclaw init                 # install assets in the current project
cclaw sync                 # reapply assets to match the current code
cclaw upgrade              # sync after upgrading the npm package
cclaw uninstall            # remove cclaw assets from the project
cclaw version              # print version
cclaw help                 # short help
```

Flow-control commands (`plan`, `status`, `ship`, `migrate`, `build`, `review`) are intentionally **not** part of the CLI. They live as `/cc` instructions inside the harness.

## More docs

- [docs/v8-vision.md](docs/v8-vision.md) — locked decisions, full kill-list, references review
- [docs/scheme-of-work.md](docs/scheme-of-work.md) — flow walk-through with all checkpoints
- [docs/skills.md](docs/skills.md) — six auto-trigger skills and what they enforce
- [docs/config.md](docs/config.md) — `.cclaw/config.yaml` reference
- [docs/harnesses.md](docs/harnesses.md) — what each harness installs
- [docs/quality-gates.md](docs/quality-gates.md) — AC traceability + Five Failure Modes
- [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md) — from cclaw 7.x

## License

MIT. See [LICENSE](LICENSE).
