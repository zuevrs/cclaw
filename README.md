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

Three slash commands (`/cc`, `/cc-cancel`, `/cc-idea`). Four stages (`plan → build → review → ship`). Six specialists, all on-demand, all running as sub-agents, all emitting `Confidence: high | medium | low`. Seventeen skills including the always-on `triage-gate`, `flow-resume`, `pre-flight-assumptions`, `tdd-cycle`, `conversation-language`, `anti-slop`, and the strict-mode-default `source-driven`. Ten templates including `plan-soft.md` and `build-soft.md` for the soft-mode path. Four runbooks. Eight reference patterns. Three research playbooks. Five recovery playbooks. Eight worked examples. Two mandatory gates in strict mode (AC traceability + TDD phase chain); soft mode keeps both as advisory; inline mode skips both.

## What changed in 8.9

8.9 is a non-breaking improvement release on top of 8.8. Three concrete additions distilled from a parallel audit of `addyosmani-skills`, `everyinc-compound`, and `gsd-v1` against cclaw v8.8 — most of those references' ideas were rejected (multi-flow factories, marketplace converters, 30+ specialists, prose-lock contract tests, version-archaeology rhetoric). The three that survived address concrete failure modes already happening in real flows.

- **`knowledge.jsonl` near-duplicate detection on append.** `KnowledgeEntry` carries optional `touchSurface[]` and `dedupeOf` fields. New `findNearDuplicate(projectRoot, candidate, options?)` helper computes Jaccard similarity (default 0.6 threshold) over `tags ∪ touchSurface` against the most recent 50 entries. `runCompoundAndShip` runs dedup before append and stamps `dedupeOf: <earlier-slug>` on near-duplicates. The append stays append-only — `learnings-research` and human readers see the chain via `dedupeOf`, the file never gets rewritten, concurrent-write safety preserved. Stops `knowledge.jsonl` from snowballing across 50+ shipped flows with near-identical "rate-limit middleware bug fixed in `src/auth/`" entries.
- **Slice-builder coverage-assess beat between GREEN and REFACTOR.** New hard rule 17 in `slice-builder.ts`: after GREEN passes the full suite and before REFACTOR is committed, the slice-builder writes one explicit Coverage line per AC to `build.md` with verdict `full` / `partial` / `refactor-only`. Silence and "looks fine" are not acceptable. Strict `BUILD_TEMPLATE` gains a `## Coverage assessment` table; soft `BUILD_TEMPLATE_SOFT` gains a `**Coverage**:` bullet. The slice-builder's `self_review[]` array now carries five rules (was four): the new `coverage-assessed` rule joins `tests-fail-then-pass` / `build-clean` / `no-shims` / `touch-surface-respected`. The orchestrator's pause hop bounces the slice in fix-only mode if the rule has `verified: false` or empty evidence — no reviewer cycle paid for an under-evidenced slice.
- **Flow-pressure advisory in `session-start.mjs`.** The hook now sums the byte size of every `flows/<slug>/*.md` artefact for the active slug and emits an advisory message at three thresholds: `≥30 KB` (elevated → "let the orchestrator dispatch a fresh sub-agent for the next AC"), `≥60 KB` (high → "finish the active slice and resume from a clean session"), `≥100 KB` (critical → "consider `/cc-cancel` and resplitting"). Advisory only — never blocks. Folded into the existing `session-start.mjs` so installer surface stays the same; no new hook file, no new harness wiring.

No breaking changes. Drop-in upgrade — `touchSurface` / `tags` / `dedupeOf` are optional fields, slice-builders running on 8.8 prompts will catch up on the first fix-only bounce, session-start advisory appears after `cclaw sync`.

## What changed in 8.8

8.8 is a non-breaking cleanup release on top of 8.7. Seven concrete bugs found in an audit against `mattpocock/skills` post-30-Apr commits and `cclaw`'s own codebase, paired with two pruning passes the user explicitly asked for: "too many tests and they're not useful" + "the tool is cluttered with v8 / v7 / A1 / etc all over the place".

- **B1 — `interpretationForks` is wired (no longer a no-op).** 8.7 added `triage.interpretationForks` to `flow-state.json` and the structured-ask UI but never plumbed it through the specialist prompts. `brainstormer`, `planner`, `architect`, and `slice-builder` now all read it from the dispatch envelope and respect the chosen reading; planner and architect copy it verbatim next to assumptions in `plan.md` / `decisions.md` and surface conflicts as feasibility / decision blockers. `flow-state.ts` `assertTriageOrNull` now validates the field shape; new `interpretationForksOf(triage)` helper mirrors `assumptionsOf`.
- **B2 — TDD anti-patterns rebuilt against `antipatterns.ts`.** The `## Anti-patterns` section in `tdd-cycle` now cites the actual catalogued A-numbers (A-2 phase integrity, A-3 `git add -A`, A-12 single-test green, A-13 horizontal slicing, A-14 pushing past failing test, A-15 mocking-what-should-not-be-mocked) — phantom A-18 / A-19 / A-20 references removed (those numbers don't exist or got renumbered with totally different meanings in 8.7). New A-N parity test scans every skill body, every specialist prompt, the start-command, all stage playbooks, and the recovery playbook to catch this from regressing.
- **B3 — Slice-builder hard rule 6 scoped to strict mode.** Used to read "use `commit-helper`, never `git commit` directly" unconditionally — which contradicted the soft-mode commit table earlier in the same prompt. Now reads "In strict mode: `commit-helper`. In soft mode: plain `git commit` is fine." Matches the table.
- **B4 — Severity scale aligned with the reviewer.** Slice-builder env-shim rule, planner edge-case finding, security-reviewer Output section, worked example, and JSON summary all migrated from the legacy `block` / `warn` / `info` / `security-block` vocabulary to the canonical 5-tier `critical` / `required` / `consider` / `nit` / `fyi` scale. Security-reviewer JSON summary now reports `by_axis` + `by_severity` instead of legacy 3-tier counts.
- **B5 — v7 paths replaced everywhere (47 occurrences across 6 files).** `plans/<slug>.md` / `decisions/<slug>.md` / `builds/<slug>.md` / `reviews/<slug>.md` / `ships/<slug>.md` / `learnings/<slug>.md` → `flows/<slug>/<artifact>.md`. The active flow lives at `flows/<slug>/`, shipped flows at `flows/shipped/<slug>/` — the v7 directory layout is gone, this release just aligns the prompt text with the actual layout.
- **B6 — Architect `Sub-agent context` numbering fixed.** Two bullets numbered "6." → renumbered 6 / 7.
- **B7 — TDD gate name unified to `red_test_written`.** Was `red_test_recorded` in `tdd-cycle` and `red_test_written` in `stage-playbooks` — picked the latter (more accurate; the gate verifies the RED commit exists, not just that "a test was recorded"). Test added to lock it.
- **Tier 2 — Test suite pruned 569 → 298.** Six version-snapshot regression files (`v82-` through `v87-`) were almost entirely prose-locks (`expect(skill.body).toMatch(/v8\.7\+/)`) that froze wording without protecting behaviour. Removed wholesale; the 7 tests that *did* protect behaviour (discriminator narrowing, schema validation) were extracted and consolidated into `flow-state.test.ts`. New `v88-cleanup.test.ts` (42 tests) replaces the deleted suites with targeted regression guards: B1-B7 verification, version-marker absence, A-N parity, path-normalisation. Net: 287 tests removed, 49 added (7 extracted + 42 new), 298 total, all green, faster runs.
- **Tier 3 — Version markers stripped from skill bodies and specialist prompts.** `(v8.4+)` / `(v8.7+)` / `(NEW sub-step, v8.7+)` / `since v8.5` / `Severity legacy note` / `v7-era constraint` / `the v7 mistake` / `the v8.X bug` / `cclaw v8.X+ replaces` / `Cclaw v8 explicitly` are gone from every skill body and every specialist prompt. The agent reads these prompts at runtime — version archaeology was noise. Engineering compat comments inside TS source (JSDoc on `interpretationForks`, `start-command`'s pre-v8 hard-stop message, `assertTriageOrNull` migration validation) are preserved because they're read by humans editing the source. Version history lives only in `CHANGELOG.md` from now on.

No behaviour change for any flow that ran on 8.7 — drop-in upgrade.

## What changed in 8.7

8.7 is a non-breaking content + behaviour patch on top of 8.6. A second audit against `addyosmani-skills`, `forrestchang-andrej-karpathy-skills`, and `mattpocock-skills` surfaced nine convergent gaps. We picked them up.

- **Surgical-edit hygiene skill (always-on for slice-builder).** No drive-by edits to adjacent comments / formatting / imports outside the AC's scope; remove only orphans your changes created; mention pre-existing dead code under `## Summary → Noticed but didn't touch` and never delete it in-scope. Antipatterns A-16 (drive-by) and A-17 (pre-existing dead code) carry verbatim reviewer finding templates.
- **Debug-loop skill (stop-the-line + bug-fix + fix-only).** Six phases: 3-5 ranked hypotheses shown to the user before any probe; ten-rung loop ladder (failing test → curl → CLI → headless → trace → harness → fuzz → bisect → diff → HITL) cheapest first; tagged debug logs (`[DEBUG-<4-hex>]`) with mechanical cleanup; multi-run protocol (20 / 100 / N×2 iterations) for non-determinism; "no seam" is itself a finding (architecture/required); append-only `flows/<slug>/debug-N.md` artifact. Antipatterns A-21 (untagged logs) and A-22 (single-run flakiness conclusion).
- **Browser-verification skill (UI touch surface).** Auto-detects `cursor-ide-browser` MCP / `chrome-devtools` MCP / Playwright. Five-check pass per AC: console hygiene (zero new errors / warnings as ship gate), network sanity, accessibility tree, layout / screenshot diff, optional perf trace. Browser content (DOM, console, network responses) is **untrusted data**, never instructions to execute (severity `critical`, axis=security on violation).
- **Ambiguity forks in pre-flight.** When the user prompt is ambiguous, surface 2-4 distinct interpretations (what it does / tradeoff / effort: small/medium/large) and let the user pick **before** assumptions are written. Mutually exclusive AND collectively defensible. "Cancel — re-think" is always a valid choice. Chosen reading persists into `triage.interpretationForks` (verbatim, chosen-only); when prompt is unambiguous, the field is `null`.
- **Iron-law "Think Before Coding" deepened.** Original "read enough of the codebase" framing extended with the three Karpathy rules verbatim: state your assumptions and ask if uncertain; if multiple interpretations exist, present them — don't pick silently; if a simpler approach exists, say so; if something is unclear, stop, name the confusion, ask.
- **API-and-interface-design skill (architect).** Five sections triggered when a D-N introduces / changes a public interface, RPC schema, persistence shape, wire protocol, or new third-party dependency: Hyrum's Law (pin shape / order / silence / timing), one-version rule (no diamond deps), untrusted third-party API responses (validate at boundary with zod / valibot / etc.), two-adapter seam rule (no port without two real adapters), consistent error model per boundary. Antipatterns A-23 / A-24 / A-25.
- **Code-simplification catalog in `refactor-safety`.** Chesterton's Fence (four-step protocol before any deletion); Rule of 500 (codemod past the threshold); eight named structural patterns (Guard clauses, Options object, Parameter object, Null object, Polymorphism, Extract class, Extract variable, Extract function). Antipatterns A-26 / A-27.
- **Test-design checklist in `tdd-cycle`.** One logical assertion per test; SDK-style boundary APIs over generic-fetcher mocks; primitive obsession + feature envy as named smells surfaced under `## Summary → Noticed but didn't touch`. Antipatterns A-28 / A-29 / A-30.
- **Deprecation & migration in `breaking-changes`.** Churn Rule (deprecator owns migration); Strangler Pattern (five phases with canary + parity); Zombie Code lifecycle (assign owner OR deprecate with concrete plan; never silently extend). Antipatterns A-31 / A-32 / A-33.

## What changed in 8.6

8.6 is a non-breaking content + behaviour patch on top of 8.5. Two reference libraries — `addyosmani-skills` and `chachamaru127-claude-code-harness` — pointed at six things 8.5 still didn't do. We picked them up.

- **Three-section Summary block in every primary artifact.** A new always-on skill `summary-format.md` defines the canonical block. Every `plan.md`, `decisions.md`, `build.md`, and `review.md` now ends with `## Summary — <specialist>[ — iteration N]` containing `### Changes made`, `### Noticed but didn't touch`, and `### Potential concerns`. Each is a bullet list. The reviewer adds one block per iteration.
- **Anti-sycophancy reviewer + verification story.** The reviewer's iteration output now carries `### What's done well` (≥1 evidence-backed item per iteration, with file:line / hunk / test name; no generic praise) and `### Verification story` (three explicit yes/no rows: tests run, build/typecheck run, security pre-screen run, each with concrete evidence). An iteration without all three Verification rows or with zero `What's done well` bullets is a contract violation.
- **Self-review gate before reviewer dispatch.** Slice-builder's strict-mode summary block now carries `self_review[]` with four mandatory rules: `tests-fail-then-pass`, `build-clean`, `no-shims`, `touch-surface-respected`. Each carries `verified: <true | false>` and `evidence`. The orchestrator's Hop 4 — *Pause* — bounces the slice back to the slice-builder in `fix-only` mode (no reviewer dispatched) if any rule has `verified: false` or empty `evidence`. Saves a full reviewer round-trip on incomplete slices.
- **Repo-wide ADR catalogue.** A new skill `documentation-and-adrs.md` describes Architectural Decision Records living at `docs/decisions/ADR-NNNN-<slug>.md`. Lifecycle is `PROPOSED → ACCEPTED → SUPERSEDED` (plus `REJECTED` on flow cancel). The architect proposes (writes `status: PROPOSED` ADRs alongside `decisions.md` during `large-risky` flows). The orchestrator promotes `PROPOSED → ACCEPTED` during Hop 6 — Finalize. The orchestrator rewrites `PROPOSED → REJECTED` on `/cc-cancel`. ADRs are NEVER deleted.
- **SDD doc cache for source-driven mode.** `source-driven.md` grew a "Cache lookup before fetch" section. Cache lives at `.cclaw/cache/sdd/<host>/<url-path>.{html,etag,last-modified}` (per-project, gitignored). Lookup rules: fresh (`< 24h`) → `cache_status: fresh-cache`; stale + 304 → `cache_status: revalidated-cache`; stale + 200 → `cache_status: refetched`; network failure with stale cache → `cache_status: stale-cache` (treated as a `consider` finding by the reviewer); miss → `cache_status: fetched`. `.cclaw/cache/` added to `REQUIRED_GITIGNORE_PATTERNS`.
- **Mandatory pre-task read order in architect and planner (brownfield).** Both prompts gained a `Phase 2.5 — Pre-task read order` step that runs before any authoring on brownfield repos: target file → tests → neighbour pattern → types. Architect's self-review checklist now requires every `D-N` decision to cite which read produced the supporting evidence. Planner's self-review checklist now requires every AC's `touchSurface` path to have been physically read in step 1, NOT picked from `repo-research.md`'s summary. Greenfield writes "no existing files — N/A" against each step and continues.

## What changed in 8.5

8.5 picked up six things that broke in a real test run: ship duplicating the flow dir, specialists being dispatched without their full contracts, `discovery` rendering as both a stage entry and a sub-phase, `pre-mortem.md` not being archived, `lastSpecialist` not updating mid-discovery, and no mechanism for grounding plans in repo signals + prior shipped lessons.

- **Hop 6 — Finalize (orchestrator-only, `git mv` semantics).** A new explicit hop replaces the one-line ship-finalize instruction. The orchestrator runs `git mv` (or `mv` when files aren't tracked) on every artifact, asserts the active dir empties out, and resets `flow-state.json`. The word "copy" is forbidden anywhere in finalize.
- **Mandatory contract reads in every dispatch envelope.** Every dispatch envelope now starts with two non-negotiable reads: `.cclaw/lib/agents/<specialist>.md` (the contract) + `.cclaw/lib/skills/<wrapper>.md` (the wrapping skill). A sub-agent that skips either is acting on a hallucinated contract.
- **Brainstormer rewritten as an explicit 8-phase workflow.** Bootstrap → Posture pick → Repo signals scan → (optional) repo-research dispatch → Clarifying questions (one at a time, max 3) → Author → 9-item self-review checklist → Return slim summary + JSON.
- **Two read-only research helpers — `repo-research` and `learnings-research`.** Lightweight on-demand sub-agents the planner / architect / brainstormer dispatch *before* authoring. `repo-research` scans manifests, `AGENTS.md`/`CLAUDE.md`, focus-surface dirs, test conventions. `learnings-research` scans `knowledge.jsonl`, scores entries, picks 1-3 with score ≥ 4, opens each candidate's `learnings.md`. They never become `lastSpecialist`.
- **`discovery` is a sub-phase of `plan`, never a `triage.path` entry.** `triage.path ⊆ {plan, build, review, ship}`. On `large-risky`, the plan stage expands into `brainstormer → checkpoint → architect → checkpoint → planner` instead of dispatching `planner` directly. Pre-v8.5 state files containing `"discovery"` in the path are normalised on read.
- **`pre-mortem.md` is a first-class artifact stage.** `ArtifactStage` widens; `compound.runCompoundAndShip`'s `allStages` array gains `"pre-mortem"`; the Hop 6 finalize move list includes it.
- **`lastSpecialist` widened from `DiscoverySpecialistId` to `SpecialistId`.** Updated after every dispatch, not only at end-of-stage.

## What changed in 8.4

8.4 is a non-breaking content + behaviour patch on top of 8.3, picking up seven things three reference skill libraries do that cclaw 8.3 didn't.

- **Confidence calibration in slim summaries.** Every specialist emits `Confidence: high | medium | low`. The orchestrator's Hop 4 — *Pause* — treats `Confidence: low` as a **hard gate in both `step` and `auto` modes**: it pauses, refuses to chain, and offers `expand <stage>` (re-dispatch with a richer envelope), `show`, `override`, or `cancel`.
- **Pre-flight assumptions (Hop 2.5).** A new orchestrator hop runs after triage, before the first specialist dispatch, on every fresh non-inline flow. It surfaces 3-7 numbered assumptions (stack + version, repo conventions, architecture defaults, out-of-scope items) using the harness's structured ask, persists them to `triage.assumptions` (string array), and makes them immutable for the lifetime of the flow. Both `planner` and `architect` read them verbatim before authoring; a decision that would break an assumption surfaces as a feasibility blocker, not a silent override.
- **Five-axis review.** The reviewer's `code` mode now mandates five axes — `correctness`, `readability`, `architecture`, `security`, `performance` — every iteration. Findings carry `axis` and a five-tier `severity: critical | required | consider | nit | fyi`. Ship gates: `strict` blocks on any open `critical` or `required`; `soft` blocks only on `critical`. Legacy `block | warn | info` ledgers are migrated forward by the reviewer prompt.
- **Source-driven mode.** A new always-on skill `source-driven.md` instructs `architect` and `planner` (and indirectly `slice-builder`) to detect stack + versions, fetch the version-pinned official doc page, implement against documented patterns, and cite URLs in `decisions.md` and code comments. Default in **strict mode for framework-specific work**, opt-in for `soft`. Integrates with the `user-context7` MCP tool when available, falls back to `WebFetch`. When docs are unreachable: write `UNVERIFIED — implementing against training memory` next to the affected line.
- **Adversarial pre-mortem before ship (strict only).** Hop 5 — *Ship + Compound* — now dispatches `reviewer` mode=`adversarial` **in parallel** with `reviewer` mode=`release`. The adversarial reviewer picks the most pessimistic plausible reading and writes `flows/<slug>/pre-mortem.md` listing 3-7 likely failure modes (data-loss, race, regression, blast-radius, rollback-impossibility, accidental-scope, hidden-coupling). Uncovered risks become `required`/`critical` findings, escalating the ship gate.
- **Cross-flow learning in the planner.** The planner reads `.cclaw/knowledge.jsonl` at every dispatch and surfaces 1-3 relevant prior entries — lessons captured by `compound` from past shipped slugs — in a new `## Prior lessons` section in `plan.md`, citing `learnings/<slug>.md`. Filtering: surface-area overlap, tag overlap, recency.
- **Test-impact-aware GREEN.** The `tdd-cycle.md` skill's GREEN phase now distinguishes a fast inner loop (affected-test pattern) from a safe outer loop (full project suite). REFACTOR still always runs the full suite. Mandatory gate `green_two_stage_suite` is added to `commit-helper.mjs --phase=green` guidance.

## What changed in 8.3

8.3 is a non-breaking content + UX patch on top of 8.2.

- **Triage as a structured ask, not a code block.** The orchestrator now uses the harness's structured question tool (`AskUserQuestion` / `AskQuestion` / `prompt`) to render the triage. Two questions, in order: pick the path, then pick the run mode. The fenced form remains as a fallback only.
- **Run mode: `step` (default) vs `auto`.** `step` pauses after every stage and waits for `continue` (8.2 behaviour). `auto` chains plan → build → review → ship without pausing; stops only on block findings, cap-reached, security findings, or before `ship`. New optional field `triage.runMode` in `flow-state.json`.
- **Explicit parallel-build fan-out in Hop 3.** The `/cc` body now carries a full ASCII fan-out diagram for the strict-mode parallel-build path — `git worktree` per slice, max 5 slices, one `slice-builder` sub-agent per slice, integration reviewer, merge sequence. The skill `parallel-build.md` already had this; the orchestrator now sees it at the dispatch site.
- **TDD cycle deepening.** Four new sections in `tdd-cycle.md`: vertical slicing / tracer bullets, stop-the-line rule, Prove-It pattern for bug fixes, writing-good-tests rules (state-not-interactions, DAMP over DRY, real-over-mock, test pyramid). Three new antipatterns: A-13 horizontal slicing, A-14 pushing past a failing test, A-15 mocking what should not be mocked.

## What changed in 8.2

8.2 is a non-breaking redesign of the `/cc` orchestrator on top of 8.1.

- **Triage gate.** Every fresh flow runs the `triage-gate` skill, which classifies the task as `trivial` / `small-medium` / `large-risky` from six heuristics, recommends a path and an `acMode`, and asks the user to accept or override. The decision is persisted into `flow-state.json` so resumes never re-prompt.
- **Graduated AC.** Acceptance Criteria are no longer one-size-fits-all. `inline` (trivial) skips them entirely. `soft` (small-medium) uses a bullet list of testable conditions with no AC IDs and an advisory commit-helper. `strict` (large-risky) is the 8.1 behaviour byte-for-byte: AC IDs, mandatory `commit-helper.mjs --ac-id=AC-N --phase=red|green|refactor`, per-AC TDD chain.
- **Sub-agent dispatch.** `plan`, `build`, `review`, and `ship` each run in a fresh sub-agent invocation. The orchestrator hands a slim envelope (slug / stage / acMode / artifact paths) and gets back a fixed 5-to-7-line summary plus the artifact on disk. No specialist reasoning leaks into the orchestrator context.
- **Resume.** Invoking `/cc` while a flow is active triggers the `flow-resume` skill: 4-line summary plus `r` resume / `s` show / `c` cancel / `n` start new. The triage decision is preserved across sessions.
- **Schema bump.** `flow-state.json` is now `schemaVersion: 3` with a `triage` field. Existing v2 files are auto-migrated on first read with `acMode: strict` so existing flows behave exactly as in 8.1.

## What changed in v8

cclaw v8.0 was a breaking redesign of the v7 stage machine. We dropped the 7.x stage machine: no more `brainstorm` / `scope` / `design` / `spec` / `tdd` mandatory stages, no more 18 specialists, no more 9 state files, no more 30 stage gates. v7.x runs are not migrated; see [docs/migration-v7-to-v8.md](docs/migration-v7-to-v8.md).

What we kept and made deeper:

- plans with **acceptance criteria + YAML frontmatter** (`slug`, `stage`, `status`, `ac[]`, `last_specialist`, `refines`, `shipped_at`, `ship_commit`, `review_iterations`, `security_flag`);
- **build is a TDD stage** — every AC goes through RED → GREEN → REFACTOR; `commit-helper.mjs --phase=red|green|refactor` enforces the cycle (production files in RED are rejected, GREEN without prior RED is rejected, REFACTOR is mandatory);
- **AC ↔ commit traceability** enforced by `commit-helper.mjs`;
- **artifact templates** for every stage (`plan`, `build`, `review`, `ship`, `decisions`, `learnings`, `manifest`, `ideas`, `iron-laws`);
- **twelve auto-trigger skills** — plan-authoring, AC traceability, refinement, parallel-build, security-review, review-loop, commit-message-quality, AC-quality, refactor-safety, breaking-changes, conversation-language (always-on), anti-slop (always-on), plus a meta-skill that ties them together;
- **stage runbooks** (`.cclaw/lib/runbooks/{plan,build,review,ship}.md`) — strict checklists per stage with common pitfalls;
- **reference patterns** (`.cclaw/lib/patterns/`) — eight task-type playbooks (api-endpoint, auth-flow, schema-migration, ui-component, perf-fix, refactor, security-hardening, doc-rewrite) the orchestrator opens before authoring AC;
- **research playbooks** (`.cclaw/lib/research/`) — reading the codebase (files + tests + integration boundaries), time-boxing, using prior shipped slugs;
- **recovery playbooks** (`.cclaw/lib/recovery/`) — AC traceability break, review hard cap reached, parallel-build slice conflict, frontmatter corruption, schemaVersion mismatch;
- **examples library** (`.cclaw/lib/examples/`) — eight real-looking plan / build / review / ship / decision / learning / commit-helper artifacts;
- **antipatterns** (`.cclaw/lib/antipatterns.md`) — twelve known failure modes the reviewer cites as findings;
- **decision protocol** (`.cclaw/lib/decision-protocol.md`) — short-form digest of "is this even a decision?"; full D-N schema lives in `lib/agents/architect.md`, worked decisions in `lib/examples/`;
- **resumable refinement** via frontmatter on shipped slugs (`refines: <old-slug>`);
- durable artifacts your team and graph tools (Graphify, GitNexus, etc.) can index.

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
