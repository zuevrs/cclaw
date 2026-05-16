# Changelog


## 8.65.0 — Powerful research mode (5 lenses + open-ended dialogue)

### Why

`/cc research <topic>` shipped in v8.58 as an interim stub: a dispatch into the `architect` specialist in a standalone activation mode (Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose run silently against a research artifact). It produced `research.md`, but the artifact was effectively a plan-shaped document with the AC table removed. Three drifts had accumulated.

1. **Single-lens research underdelivers on uncertainty.** Real research questions span multiple orthogonal dimensions — technical feasibility, user value, system fit, prior attempts, what could go wrong. A single architect dispatch can touch each dimension, but it runs them sequentially against one author's context budget, and it inherits the architect's plan-shaped output mental model (Frame / Approaches / Decisions / Pre-mortem). The reference projects the user pointed at — gstack's `/plan-eng-review` / `/plan-design-review` / `/plan-ceo-review` / `/plan-qa-review` / `/plan-dx-review` quintet; obra-superpowers' brainstorming → writing-plans → subagent-driven-development chain; compound's continuous notebook + adversarial-reviewer — all converge on the same answer: multi-lens beats single-lens for research-grade exploration.
2. **No discovery surface.** v8.58 research mode dispatched the architect on the raw `/cc research <topic>` argument with no chance to scope, refine, or surface what the user already knew. The architect compensated by writing a generic Frame section that asked "what is this about?" instead of using that information to deepen the lens scans.
3. **Architect drift.** The architect's prompt carried two activation modes (intra-flow `task` and standalone `research`) plus a research-specific Phase 7 finalise branch. v8.62 already trimmed the picker; v8.65 finishes the job by removing research-mode entirely from the architect so its contract is single-purpose (plan authoring).

### What changed

**Deliverable 1 — Five research-only lens sub-agents** (new directory `src/content/research-lenses/`).

- `research-engineer` — technical feasibility lens. Covers overall feasibility + 5 sub-axes (technology fit, skills required, time horizon, reversibility, verification path), 2-3 candidate implementation paths with effort + trade-off tags, blockers (hard / soft severity), implementation-time risks, ranged effort estimate. May dispatch the existing `repo-research` helper for brownfield codebase context.
- `research-product` — user / product value lens. Covers user-value rating, primary + secondary beneficiaries, alternatives considered (always including the explicit "do nothing" baseline), market / domain context, open product questions.
- `research-architecture` — system-fit lens. Covers per-module surface impact with severity, coupling points (new-dependency / tighter-coupling / looser-coupling), boundaries crossed, scalability considerations, reusable in-repo patterns + precedents. May dispatch `repo-research` for brownfield architecture topics.
- `research-history` — memory lens. Reads `.cclaw/knowledge.jsonl` (cclaw's append-only ship log) + git log directly. Covers prior attempts (with `knowledge.jsonl:line` / git ref citations), lessons learned (verbatim quotes from prior `learnings.md`), outcome signal counts (`reverted` / `manual-fix` / `follow-up-bug`), git-archaeology highlights, directional drift.
- `research-skeptic` — adversarial lens. Covers failure modes (likelihood × impact matrix), edge cases (accidental), abuse cases (intentional), hidden costs (post-ship), explicit don't-proceed triggers when severity is irreversible and no obvious mitigation exists within scope.
- Each lens runs as an `on-demand` sub-agent. Engineer / product / architecture / skeptic lenses may optionally use a web-search MCP tool when one is available (e.g. `user-exa`); they fall back to training knowledge with a `Notes:` tag when no tool is wired into the harness. History lens is grounded purely in the project's own memory.
- Lenses are **research-only**: they live in a new `RESEARCH_LENSES` type-level collection (`src/types.ts`), are NOT in the `SPECIALISTS` array (which stays at 7), never become `lastSpecialist`, never appear in `triage.path`, and cannot be dispatched by any of the seven flow specialists.

**Deliverable 2 — Multi-lens main-context research orchestrator** (`src/content/start-command.ts`).

- Replaces the v8.58 / v8.62 architect-standalone-research dispatch with a four-phase main-context flow:
  - **Phase 0 — bootstrap.** Orchestrator parses the `/cc research <topic>` argument, generates the slug `<YYYYMMDD>-research-<topic-kebab>`, initialises `flow-state.json` with `currentSlug` + sentinel triage block (`mode: "research"`, `ceremonyMode: "strict"`, `path: ["plan"]`), creates the active flow dir.
  - **Phase 1 — open-ended discovery dialogue.** Orchestrator opens with the canonical seed prompt (`"Hi. What are you researching? Tell me what you know and what you don't."`) and runs an **uncapped** dialogue with the user. No question budget. No auto-advance. The user signals `ready` / `go ahead` / `finalize` / `let's go` / `that's enough` (or any variant the orchestrator reads as a transition signal) to proceed. The user can also pivot back into dialogue at any time during Phase 2 / 3.
  - **Phase 2 — parallel lens dispatch.** Orchestrator distils the dialogue into a 5-15 bullet `Dialogue summary`, then dispatches **all five lenses in parallel** with the topic + dialogue summary as shared envelope. Each lens returns a structured findings block in its slim summary.
  - **Phase 3 — synthesis.** Orchestrator pastes each lens's findings verbatim into the corresponding `## <Lens> lens` section of `research.md`, then authors the cross-lens `## Synthesis` section (convergence / divergence / trade-off space / confidence + coverage gaps) and the `## Recommended next step` section (one of `plan with /cc <task>` / `more research needed (specific area)` / `don't proceed (skeptic blocked: <reason>)`).
  - **Phase 4 — finalize.** `git mv` (or `mv` on no-git projects) into `.cclaw/flows/shipped/<slug>/research.md`. Reset `flow-state.json > currentSlug` to `null`. Surface the handoff prompt: `"research.md is ready at <path>. Recommended next: <verbatim recommendation>. Ready to plan? Run /cc <task> and I'll carry the research as priorResearch context."`
- Research mode continues to skip triage (no `complexity` / `ceremonyMode` heuristic runs; the orchestrator stamps the sentinel triage block so downstream readers continue to work). The `flowState.priorResearch` handoff for the optional research → task transition is preserved verbatim.

**Deliverable 3 — Multi-lens `research.md` template** (`src/content/artifact-templates.ts`).

- `RESEARCH_TEMPLATE` rewritten end-to-end. Frontmatter declares `mode: research`, `lenses: [engineer, product, architecture, history, skeptic]` (canonical roster + ordering; any lens whose dispatch timed out is marked `failed` rather than dropped, so coverage gaps are auditable from the artifact). Back-compat frontmatter fields (`ambiguity_score` / `ambiguity_dimensions` / `ambiguity_threshold` from v8.53) ship null by default to keep downstream readers compatible.
- Body sections: `## Discovery dialogue summary` (5-15 bullets distilled from Phase 1), `## Engineer lens` / `## Product lens` / `## Architecture lens` / `## History lens` / `## Skeptic lens` (one per dispatched lens, pasted verbatim from the lens's findings block), `## Synthesis` (orchestrator's cross-lens distillation), `## Recommended next step` (the orchestrator's finalise authoring; one of the three permitted recommendations with concrete reasoning).
- Removed: the v8.58 design-portion sections (Frame / Spec / Approaches / Selected Direction / Decisions / Pre-mortem / Not Doing / Open questions / `Summary — architect (research mode)`). Those belonged to the architect-as-researcher contract that the multi-lens orchestrator replaces.

**Deliverable 4 — Architect surgically decoupled from research mode** (`src/content/specialist-prompts/architect.ts`).

- Removed the v8.58 `## Activation modes` section entirely. Architect prompt declares intra-flow `mode: "task"` is the only mode it handles post-v8.65. Pre-v8.65 state files carrying `triage.mode == "research"` are handled by the orchestrator's Detect hop directly; the architect never sees a research-mode dispatch envelope.
- Removed the `Phase 7-research` / "finalises the research flow immediately" prose. Research finalisation lives in the orchestrator (Phase 4 above), not in the architect.
- Preserved: `flowState.priorResearch` consumption at Bootstrap. When the user follows up a shipped research slug with `/cc <task>`, the architect's Bootstrap reads `priorResearch.path` and includes the research artifact (per-lens findings + synthesis + recommendation) as Frame / Approaches / Decisions context.
- Triage prompt heuristics updated to suggest `/cc research <topic>` when the user signals "discuss first" / "design only" / "what do you think" intent.

**Deliverable 5 — Install layer wires the five lens contracts** (`src/install.ts`, `src/content/core-agents.ts`, `src/ui.ts`).

- New `RESEARCH_LENS_AGENTS` registry maps each lens id to its `kind: "research-lens"` agent record (id + title + activation + description + prompt). Source of truth for the lens roster is `RESEARCH_LENSES` in `src/types.ts`; metadata (title + description) lives in `src/content/research-lenses/index.ts`.
- New `writeResearchLensFiles` install step renders each lens contract via `renderResearchLensMarkdown` and writes it to `.cclaw/lib/research-lenses/<lens-id>.md`. The frontmatter carries `kind: research-lens` so harness UIs / readers can route lens contracts to a separate shelf from flow specialists (`.cclaw/lib/agents/`) and from the read-only research helpers (`repo-research` / `learnings-research`, both in `.cclaw/lib/agents/` with `kind: research-helper`).
- Lenses mirror into each harness's agent directory tree (same mirror logic that handles `.cclaw/lib/agents/`) so the harness's own agent registry sees the lens contracts when the orchestrator dispatches them.
- New `SyncResult.counts.researchLenses` field reports the count of installed lens contracts.
- Uninstall path (`removePath(RUNTIME_ROOT)` already covers `.cclaw/lib/research-lenses/` implicitly; smoke explicitly asserts the directory does not survive uninstall).

**Deliverable 6 — Tests + smoke** (new: `tests/unit/research-lenses.test.ts`, `tests/unit/v865-powerful-research.test.ts`; updated: `tests/unit/types.test.ts`, `tests/unit/v858-router-research.test.ts`, `tests/unit/v822-orchestrator-slim.test.ts`, `tests/unit/v831-path-aware-trimming.test.ts`, `tests/unit/v861-triage-subagent.test.ts`, `scripts/smoke-init.mjs`).

- `research-lenses.test.ts` (97 tests): per-lens structural invariants — every lens declares the canonical sections (Sub-agent context / Role / Scope / Inputs / Outputs / Slim summary / Hard rules / Composition / Activation), declares it is a research-only sub-agent (NOT in `SPECIALISTS`), declares the v8.65 multi-lens parallel dispatch contract + sibling lens names, declares the no-inter-lens-chatter rule, declares a Confidence calibration, declares the `Findings:` payload in the slim summary. Plus cross-lens invariants: the three lenses that may spawn helpers (engineer / product / architecture) explicitly forbid spawning another lens; research-history declares `You may spawn: nothing`; research-skeptic's spawn line does not name any sibling lens id.
- `v865-powerful-research.test.ts` (31 tests): the five lens source files exist; `RESEARCH_LENSES` enumerates exactly five ids and is disjoint from `SPECIALISTS`; `RESEARCH_LENS_AGENTS` registry surface; `RESEARCH_TEMPLATE` has the multi-lens structure; `start-command.ts` body documents the four-phase research orchestrator, names all five lenses, no longer actively dispatches the architect for research-mode (breadcrumb references allowed), declares the priorResearch handoff prompt; the architect no longer carries the v8.58 activation-modes section; install layer writes five lens contracts under `.cclaw/lib/research-lenses/`; sync is idempotent.
- Existing tests updated: v8.58 architect-mode tests rewritten to lock the v8.65 single-mode architect contract; v8.58 research template section-layout test rewritten to lock the v8.65 multi-lens layout (Discovery / Engineer / Product / Architecture / History / Skeptic / Synthesis / Recommended next step); body-length budget tests (v822 / v831 / v861) raised from 69000 / 72000 to 79000 / 81000 chars (v8.65 absorbs ~9k for the multi-lens orchestrator on top of v8.63's ~1k slice envelope bump) to absorb the multi-lens orchestrator's body prose (full per-lens contracts live in `.cclaw/lib/research-lenses/<lens>.md` so the body only carries orchestrator-side prose).
- Smoke (`scripts/smoke-init.mjs`) asserts the five lens contracts install under `.cclaw/lib/research-lenses/`, each carries `kind: research-lens` in its frontmatter, opens with the `# Research — ` title prefix, and is swept on uninstall.

### Migration

- Pre-v8.65 state files carrying `triage.mode == "research"`: handled transparently. The orchestrator's Detect hop reads the field on the next `/cc` invocation and routes the resume into the multi-lens orchestrator (Phase 1 dialogue if the slug is fresh; Phase 4 finalize if the architect-authored research-mode artifact already exists). No state-file migration required.
- Pre-v8.65 architect-authored `research.md` artifacts: continue to validate as research artifacts (frontmatter still carries `mode: research` + `topic:` + `generated_at:`). The `priorResearch` handoff reads the file path; both the pre-v8.65 single-author and the v8.65 multi-lens shape are accepted as Frame context by the follow-up architect's Bootstrap.
- Harness installs: a `cclaw install` on the upgraded CLI writes the five lens contracts to `.cclaw/lib/research-lenses/` and mirrors them into each enabled harness's agent directory tree. Existing `.cclaw/` state is untouched.

### How to verify

- `npx vitest run` — 1391 tests across 87 files pass.
- `npm run smoke:runtime` — init → sync → uninstall round-trip on a temp project; asserts the five lens contracts ship with `kind: research-lens` frontmatter and are swept on uninstall.
- Manual: `/cc research <some topic>` from a harness with cclaw installed. Verify Phase 1 dialogue is open-ended; the orchestrator transitions on a "ready" signal; the five lenses dispatch in parallel; `research.md` carries all six lens sections (discovery + 5 lenses) + synthesis + recommended next step; follow-up `/cc <task>` reads `priorResearch` and the architect's Bootstrap surfaces the research artifact.


## 8.63.0 — Separate slices (work-units) from AC (verification)

### Why

cclaw's `## Acceptance Criteria` table had been carrying three distinct concepts in one row since v8.40:

1. **Requirements.** What observable behaviour the slug must produce — the AC text itself.
2. **Work units.** Which test → which production code → which commits — the implementation plan, encoded via `touchSurface` + posture + `parallelSafe`.
3. **Verification.** Which test asserts the AC actually holds on the merged state — the verification line + RED/GREEN/REFACTOR commit chain.

The conflation made the AC table do too much. Reviewer prompts read AC-as-work-unit (per-AC TDD cycles, per-AC touchSurface enforcement, per-AC commit prefix `<type>(AC-N): ...`). Critic prompts read AC-as-requirement (does this verifiable plan criterion actually solve the user-stated problem?). Plan-critic prompts read AC-as-both (granularity at the AC level + dependency graph at the AC level + verification feasibility at the AC level). The references cclaw cites as design influences (compound, gsd-v1, addyosmani, mattpocock, oh-my-claudecode) all separate work-units from verification — they author one table for what-to-build and another for how-to-prove. cclaw was the outlier conflating the two into one table where work-unit slot and verification slot drifted into each other's prose.

The cost was modest but real: review-stage churn on "the AC's touchSurface lists a file the verify line never exercises" (work-unit drift inside an AC), build-stage churn on "this AC needs two slices but the AC table can only hold one row" (work-unit too big), critic-stage churn on "AC-3 promises what the user asked for but the AC's commit chain proves a different behaviour" (verification drift inside an AC). Splitting the table is the smallest move that resolves all three churn classes at once.

### What changed

**Deliverable 1 — Plan template split** (`src/content/artifact-templates.ts`).

- `PLAN_TEMPLATE` (strict) now has TWO distinct tables: `## Plan / Slices` (SL-N rows with `Surface`, `dependsOn`, `independent`, `posture`) and `## Acceptance Criteria (verification)` (AC-N rows with verification line, `touchSurface`, `parallelSafe`, and a `Verifies` column listing the slice ids this AC proves correct). Architect authors both; the dependency graph between them lives in the `Verifies` column.
- `PLAN_TEMPLATE_SOFT` unchanged — soft mode runs one TDD cycle for the whole feature; no slice/AC separation surfaces.

**Deliverable 2 — Types + flow-state validators** (`src/types.ts`, `src/flow-state.ts`).

- New `Slice` / `SliceState` types modelled symmetrically to the existing `AcceptanceCriterion` / `AcceptanceCriterionState`. Slice carries `id` (SL-N), `surface`, `dependsOn`, `independent`, `posture`, and an optional verification back-reference set. Flow-state validators accept the new fields permissively on read so pre-v8.63 flow-state.json files validate unchanged.

**Deliverable 3 — Architect contract authors both tables** (`src/content/specialist-prompts/architect.ts`).

- Architect's Compose phase now authors `## Plan / Slices` BEFORE `## Acceptance Criteria (verification)`, with the AC rows' `Verifies` column referencing slice ids. The architect's slim summary reports both counts (`5 slices, 3 AC`). Research-mode branch unchanged — research.md never had AC, will never have slices.

**Deliverable 4 — Builder runs per slice, verifies per AC** (`src/content/specialist-prompts/builder.ts`).

- Strict-mode builder cycles per slice (`<type>(SL-N): ...` commits), not per AC. After all slices in the plan have landed through REFACTOR, builder writes one `verify(AC-N): passing` commit per AC. The verify commit's diff is empty (when slice tests already cover the AC's observable behaviour — Path V1) OR contains test-files-only (when the AC needs broader verification — perf budget, integration, contract — Path V2). Production code lives in slice commits only; verify commits never touch `src/**` / `lib/**` / `app/**`.
- build.md is now two sections: `## Slice cycles` (SL-N rows with Discovery + RED proof + GREEN evidence + REFACTOR notes + commits) and `## AC verification` (AC-N rows with `Verifies` slice ids + Path V1/V2 + evidence + verify SHA).

**Deliverable 5 — Reviewer cross-checks both chains** (`src/content/specialist-prompts/reviewer.ts`).

- Posture-aware TDD check now keys off SL-N for the slice work chain. New AC verification chain check inspects `git log --grep="verify(AC-N): passing" --oneline` per AC (exactly one verify commit per AC; diff empty or test-files-only; landed AFTER all slices in the AC's `Verifies` list landed). Archived-flow legacy commit shapes (`red(AC-N)` / `green(AC-N)` / `refactor(AC-N)` / `refactor(AC-N) skipped: ...`) preserved verbatim for pre-v8.63 archived slugs — same posture recipe, AC-N token instead of SL-N.
- `edit-discipline` axis split into two sub-checks: slice work commits must touch only files in the slice's `Surface`; verify commits must touch only test files (or stay empty).

**Deliverable 6 — Critic §4b slice + AC coverage** (`src/content/specialist-prompts/critic.ts`).

- New §4b sub-section runs after §4 (Criterion check) in strict mode. Three checks: AC verification coverage (every AC has at least one `verify(AC-N): passing` commit), slice work coverage (every SL-N has at least one `(SL-N):` commit), slice → AC mapping integrity (every slice in an AC's `Verifies` list has its own work commits; orphan slices are `iterate`-severity findings). Archived-flow detection (no `## Plan / Slices` section) reverts to the legacy single-table check.

**Deliverable 7 — Plan-critic §4b slice-AC separation** (`src/content/specialist-prompts/plan-critic.ts`).

- New §4b sub-section gates ship on: both tables present, slice quality (well-bounded Surface, accurate `dependsOn`, `independent` flag matches actual surface overlap), AC verifiability (measurable assertion verb, populated `Verifies` column, slice references that actually exist), coverage gaps (AC without slices → `block-ship`; slice without verifying AC → `iterate` orphan).

**Deliverable 8 — Skill + runbook scrub** (`src/content/skills/slice-discipline.md` (new), `src/content/stage-playbooks.ts`, `src/content/start-command.ts`).

- New `slice-discipline.md` auto-trigger skill on `stage:build` codifies the per-slice TDD recipe plus the per-AC verify pass — read alongside `tdd-and-verification.md` by the builder.
- Build playbook updated: every work unit (SL-N for v8.63 new flows, AC-N for archived flows) goes through RED → GREEN → REFACTOR; new step 6.5 codifies the per-AC verify pass; existing AC-N examples retained for the archived-flow recipe.
- Start-command's plan-stage and build-stage dispatch envelopes carry v8.63 clarifiers ("write Slices + AC distinctly per the plan template"; "work per slice; emit `verify(AC-N): passing` after merged state passes").

**Deliverable 9 — Tripwire test** (`tests/unit/v863-slice-ac-separation.test.ts`).

- Pins the contract: `Slice` / `SliceState` exported from `src/types.ts`; PLAN_TEMPLATE contains both `## Plan / Slices` AND `## Acceptance Criteria` sections; architect contract mentions slices + AC distinctly; builder contract mentions per-slice TDD AND `verify(AC-N)` verification commits; reviewer contract mentions both slice and AC traceability chains.

### Clean break

Pre-v8.63 archive flows in `flows/shipped/` keep their single-AC-table format verbatim — no migration. Reviewer accepts the legacy `red(AC-N)` / `green(AC-N)` / `refactor(AC-N) skipped: ...` commit shapes when `plan.md` has no `## Plan / Slices` table (the archived-shape detector). New flows starting at v8.63 use the dual-table shape. Pre-v8.63 flow-state.json validates unchanged.


## 8.62.0 — Unified flow + kill `design` + remove `security-reviewer` + renames

### Why

By v8.61, three drifts had accumulated that the previous slugs were polishing around instead of fixing.

1. **Three flow shapes for one mental model.** v8.50-v8.58 had quietly settled into three branches under one `/cc <task>` entry point — `inline` (build inline), `soft` (`ac-author` Phase 0-1 + plan → build → review → critic → ship, no `design`), `strict` (`design` Phase 0-7 + `ac-author` + plan → build → review → critic → ship). Per-stage prose, skills, runbooks, and tests had to enumerate the branches every time they referenced the flow. The branches existed because v8.51 read `design`'s 7-phase ceremony as load-bearing for "large-risky" slugs; the work the user actually wants (Frame, Approaches, Decisions, Pre-mortem) is independent of who authors it.
2. **`design` is a hold-over from v8.41 multi-turn dialogue.** Phases 1 (Clarify) and 7 (Sign-off) were retired in spirit when v8.61 went always-auto — the orchestrator no longer pauses for picker output, so the design specialist had no UI surface for clarify questions or sign-off prompts. Phases 0/2-6 (Bootstrap / Frame / Approaches / Decisions / Pre-mortem / Compose) are pure authoring work that the planning specialist can do silently. Keeping `design` as a separate sub-agent forced a `design → ac-author` chain on strict slugs that added one dispatch + one slim summary + one context load with no decision actually surfaced to the orchestrator between them.
3. **`security-reviewer` and `reviewer` overlap on every security-flagged slug.** `reviewer` already carries a `security` axis as part of its ten-axis check. `security-reviewer` repeated the same axis with deeper threat-model + taint + secrets + supply-chain prose, gated on `security_flag: true`. The orchestrator dispatched both in sequence; their findings overlapped ~80% with a hand-off step that consumed budget without producing distinct value. The expanded prose belongs inside the `security` axis itself, not in a second sub-agent.

### What changed

**Deliverable 1 — Unified flow shape** (`src/content/start-command.ts`, `src/content/skills/triage-gate.md`, `src/content/runbooks-on-demand.ts`, `src/content/stage-playbooks.ts`).

- One shape for every `/cc <task>`: triage → architect → builder → reviewer → critic → ship. Plan-critic / qa-runner / builder fix-only / reviewer fix-only continue to slot in at the same hops as in v8.61.
- Depth scales WITHIN the flow, not by branching across flows. `ceremonyMode: inline` keeps the build-inline shortcut for trivial slugs (no plan.md, no specialist dispatches beyond triage). `ceremonyMode: soft` runs the architect with Bootstrap + Frame + Compose only (no Approaches / Decisions / Pre-mortem sections in the plan). `ceremonyMode: strict` runs the architect with the full Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose pass. The shape is identical; the architect picks which sections to author based on the triage decision.
- Reviewer axes scale with `surfaces[]` and `security_flag`. The orchestrator no longer dispatches a separate security sub-agent on `security_flag: true`; the reviewer dispatch envelope sets `walkSecurityChecklistVerbatim: true` and the reviewer's `security` axis carries the full threat-model + taint + secrets + supply-chain prose.

**Deliverable 2 — Kill `design`, rename `ac-author` → `architect`** (`src/content/specialist-prompts/architect.ts`, `src/types.ts`, `src/install.ts`).

- New `architect.ts` combines `ac-author.ts`'s existing responsibilities (Spec / AC / Edge cases / Topology / Feasibility / Traceability + posture handling) with the absorbed `design.ts` Phase 0/2-6 prose (Bootstrap stack/conventions read, Frame, Approaches, Selected Direction, Decisions, Pre-mortem, Compose synthesis pass). Single on-demand dispatch on every non-inline path. Runs silently — no mid-plan dialogue, no clarify questions, no sign-off picker. If the architect's pick turns out wrong, the reviewer surfaces it at review time and the fix-only loop runs.
- Research-mode branch: when dispatched with `mode: "research"` (from `/cc research <topic>`), the architect outputs `research.md` instead of `plan.md`, drops the AC table, and stops at the compose-equivalent.
- `SPECIALISTS` array: removed `design`, `ac-author`. Added `architect`. Length unchanged conceptually (the chain became a single specialist); see also Deliverable 4.
- `RETIRED_AGENT_FILES` (new in this slug, mirrors v8.60's `RETIRED_COMMAND_FILES`) carries `design.md`, `ac-author.md`, `slice-builder.md`, `security-reviewer.md` so pre-v8.62 installs get the dead specialist contracts swept on the next `cclaw install` / sync. The sweep emits a `Removed retired agent` progress event per removed file and is idempotent on clean installs.

**Deliverable 3 — Rename `slice-builder` → `builder`** (`src/content/specialist-prompts/builder.ts`, `src/install.ts`).

- File rename, export rename (`SLICE_BUILDER_PROMPT` → `BUILDER_PROMPT`, `sliceBuilderPrompt` → `builderPrompt`), internal name references "slice-builder" → "builder". TDD cycle (RED → GREEN → REFACTOR per AC) and AC-as-unit semantics preserved verbatim — the slice / AC separation is scheduled for v8.63, not here.

**Deliverable 4 — Remove `security-reviewer`, absorb into `reviewer.security`** (`src/content/specialist-prompts/reviewer.ts`, `src/content/start-command.ts`).

- `reviewer.ts`'s `security` axis grew ~70 lines absorbing the retired `security-reviewer.ts`'s threat-model checklist, taint analysis prose, secrets-handling rules, sensitive-change protocol (auth / billing / data-export / schema-migration), and supply-chain checks. The 5-tier severity scale (`critical` / `required` / `consider` / `nit` / `fyi`) is retained.
- Orchestrator drops the security-reviewer dispatch envelope entirely. The reviewer dispatch envelope adds `walkSecurityChecklistVerbatim: true` when `triage.security_flag === true`.

**Deliverable 5 — Specialist count 9 → 7** (`src/types.ts`, `src/content/core-agents.ts`, `tests/unit/types.test.ts`, `tests/unit/core-agents.test.ts`, `tests/unit/specialist-prompts.test.ts`, `tests/unit/install.test.ts`, `scripts/smoke-init.mjs`).

- Final roster: `triage`, `architect`, `builder`, `plan-critic`, `qa-runner`, `reviewer`, `critic`. Activation: every specialist is `on-demand` post-v8.62 (no main-context multi-turn protocol remaining).
- New tripwire test `tests/unit/v862-unified-flow.test.ts` asserts the roster, the absence of `design.ts` / `ac-author.ts` / `slice-builder.ts` / `security-reviewer.ts` on disk, the new authorship stamps in PLAN_TEMPLATE / PLAN_TEMPLATE_SOFT, the architect's absorbed phases, the reviewer's absorbed security prose, the absence of `design` / `security-reviewer` dispatch envelopes in `start-command.ts`, and the permissive `flow-state` validator behaviour on legacy `lastSpecialist` values.

**Deliverable 6 — Plan template authorship stamps** (`src/content/artifact-templates.ts`).

- `PLAN_TEMPLATE` (strict) and `PLAN_TEMPLATE_SOFT`: `_(Design Phase X)_` / `_(design)_` / `_(ac-author)_` authorship attributions rewritten to `_(Architect)_`. Soft template carries lighter "architect authors this" prose without explicit per-phase stamps. Ambiguity fields in frontmatter (`ambiguity_score`, `ambiguity_dimensions`, `ambiguity_threshold`) are retained for back-compat with v8.53 brownfield gates even though the procedural authoring beat is retired alongside the dead Phase 7 picker.

### Clean break

No migration code for pre-v8.62 state files carrying `lastSpecialist: "design"` / `"ac-author"` / `"slice-builder"` / `"security-reviewer"`. The `assertFlowStateV82` validator is permissive on `lastSpecialist` (any string accepted on read); new writes use the new specialist IDs. Existing flows in flight at upgrade time may need `/cc-cancel` + restart to clear stale dispatch envelopes. The user explicitly waived the migration; the alternative was carrying four dead specialist IDs through every read path forever.


## 8.61.0 — Triage to sub-agent + always-auto + `/cc` auto-continue

### Why

Three friction points the entry-point UX had accumulated by v8.59:

1. **Triage runs inline.** After v8.58's lightweight-router refactor, the router decides only 5 fields (`complexity` / `ceremonyMode` / `path` / `runMode` / `mode`) with zero questions by default. The full routing prose still lived in the orchestrator body as Hop 2 — ~200 lines that fired on every `/cc <task>` and consumed main-context tokens for a decision that has no codebase context.
2. **`runMode` toggle is noise.** `runMode: step` vs `runMode: auto` surfaced approval pickers at every plan / review / critic gate (`approve plan? [y/n]` / `accept review findings? [y/n]` / `accept critic verdict? [y/n]`). The toggle existed because earlier cclaw releases didn't trust the sub-agent slim summaries; v8.42+ critic + v8.51+ plan-critic both removed the structural reason to pause. The pickers became friction without value.
3. **`/cc` invocation has implicit forks.** Resume picker (`[r] resume / [s] save / [n] new`), `/cc <task>` on an active slug silently re-triages, etc. Every fork was a tiny decision the orchestrator made *for* the user and announced after the fact. The user-facing model needs to be deterministic: `/cc` always means continue, `/cc <task>` always means start.

### What changed

**Deliverable 1 — Triage moves to a sub-agent** (`src/content/specialist-prompts/triage.ts`, `src/content/start-command.ts`, `src/types.ts`, `src/install.ts`).

- New `triage` specialist (`src/content/specialist-prompts/triage.ts`) carrying the canonical routing contract — 5-field decision (complexity / ceremonyMode / path / runMode / mode), zero-question rule, override flag handling (`--inline` / `--soft` / `--strict`), heuristic table, no-git auto-downgrade, triage-inheritance rules for extend-mode, slim-summary shape. ~200 lines of prose lifted verbatim from the orchestrator's Hop 2.
- `SPECIALISTS` constant gains `triage` (length 8 → 9). Activation: `on-demand` (dispatched at Hop 2 of every fresh `/cc <task>`; research-mode and extend-mode skip per the orchestrator body's Detect step). Title / description registered in `src/content/core-agents.ts`.
- `src/install.ts` installs `.cclaw/lib/agents/triage.md` alongside the other 8 specialist contracts; smoke test expects 9 agent files.
- Orchestrator body (`src/content/start-command.ts`) drops the full Hop 2 prose and replaces it with a concise dispatch directive: "Dispatch the `triage` sub-agent with the raw `/cc` argument + project state. Receive the 5-field decision. Stamp `flow-state.json > triage`." Body size drops from ~74k to ~69k chars.

**Deliverable 2 — Always-auto mode** (`src/types.ts`, `src/flow-state.ts`, `src/content/start-command.ts`, `src/content/runbooks-on-demand.ts`, `src/content/skills/*.md`).

- The user-facing `step` / `auto` choice was retired. Every non-inline flow runs always-auto end-to-end. No approval pickers at plan / review / critic gates; the orchestrator chains stages automatically.
- `runMode` field in `TriageDecision` is now structurally `"auto"` on non-inline paths and `null` on inline / trivial paths. Legacy `step` values in pre-v8.61 state files fold to `auto` on read (`runModeOf` always returns `"auto"`). The v8.34 mid-flight `--mode=step` / `--mode=auto` toggle is preserved on the parser surface for back-compat but collapses to `auto` (one-line note `step-mode retired in v8.61; flow runs auto`).
- Failure routing matrix (user-locked decisions; canonical contract in the new `always-auto-failure-handling.md` runbook):
  - **Build failure** → auto-fix loop, up to 3 iterations. Failure after 3 → stop and report.
  - **Reviewer `critical` / `required-no-fix`** → auto-dispatch fix-only loop, up to 3 iterations. Failure after 3 → stop and report.
  - **Critic `block-ship`** → stop immediately and report. No auto-iteration (re-running on unchanged code returns the same verdict).
  - **Catastrophic** (git op fail, dispatch fail, missing tool) → stop and report.
  - **`Confidence: low`** from any specialist → stop and report.
- The "stop and report" status block is plain prose. Recovery is always `/cc` (continue from the saved state) or `/cc-cancel` (discard). No in-chat picker.

**Deliverable 3 — `/cc` auto-continue + auto-start dispatch matrix** (`src/content/start-command.ts`, `src/content/skills/flow-resume.md`).

- Deterministic 10-row matrix replaces the legacy resume picker:

| Invocation | Active flow? | Behaviour |
| --- | --- | --- |
| `/cc` (no args) | yes | Continue the active flow silently. |
| `/cc` (no args) | no | Error: "No active flow. Start with `/cc <task>` / `/cc research <topic>` / `/cc extend <slug> <task>`." |
| `/cc <task>` | yes | Error: "Active flow: `<slug>` (stage: `<stage>`). Continue with `/cc`. Cancel with `/cc-cancel`." No auto-cancel, no queuing. |
| `/cc <task>` | no | Start a new flow (dispatch triage). |
| `/cc research <topic>` | yes / no | Error / start (same shape). |
| `/cc extend <slug> <task>` | yes / no | Error / start (same shape). |
| `/cc-cancel` | yes | Cancel active flow (move artifacts to `flows/cancelled/<slug>/`, reset state). |
| `/cc-cancel` | no | Error: "No active flow to cancel." |

- Active-flow detection: read `.cclaw/state/flow-state.json`. A flow is **active** when `currentSlug != null` (finalize resets `currentSlug` to `null` after moving artifacts to `flows/shipped/<slug>/`).
- The `flow-resume` skill was rewritten as a reference doc for the matrix — the picker logic moved out, only the matrix mechanics, plain-prose error shape, silent-continue rule, and v8.61 retirement of the `runMode` toggle remain.

**Deliverable 4 — New on-demand runbook `always-auto-failure-handling.md`** (`src/content/runbooks-on-demand.ts`).

- 13th on-demand runbook. Carries the failure-routing matrix (verbatim from the user-locked decisions), the uniform stop-and-report status block shape, the auto-fix iteration counter (`autoFixIterations` on `FlowState`), recovery rules, and the catastrophic-failure subcases. Extracted from `start-command.ts` to keep the orchestrator body under its character budget.

**Deliverable 5 — Documentation + version bump**.

- README updated: `/cc` invocation matrix table, "If something goes wrong" recovery section, failure-handling matrix, worked-example updated to mention triage sub-agent + always-auto chain, specialist count 8 → 9, on-demand runbook count 12 → 13.
- Pre-v8.58 state files with `runMode: "step"` continue to validate (clean break — user explicitly waived back-compat). The value folds to `auto` on the next stage transition.
- Skill and runbook sweeps: `triage-gate.md`, `pause-resume.md`, `qa-and-browser.md`, `cap-reached-recovery`, `critic-steps`, `plan-critic`, `extend-mode` updated to remove `step`-mode branches and point to `always-auto-failure-handling.md` for hard-gate routing.

### Clean break

No migration of pre-v8.61 state files carrying `runMode: "step"`. Existing flows in flight at upgrade time may need `/cc-cancel` + restart to clear stale state. The user explicitly waived back-compat; the alternative was carrying a behavioural fork inside the orchestrator forever.

## 8.60.0 — Cleanup slug (command retirement + annotation scrub)

### Removed commands

- **`/cclaw-review`** and **`/cclaw-critic`** — utility escape valves around the full `/cc` flow; use cases proved too niche to maintain. Specialist contracts remain for in-flow review and critic steps only.
- **`/cc-idea`** — backlog primitive overlapped with `/cc research` in user mental model. Retired `src/content/idea-command.ts`, `src/content/utility-commands.ts`, harness command files, and `.cclaw/lib/templates/ideas.md` seed.

### Install / upgrade

- `RETIRED_COMMAND_FILES` (`cc-idea.md`, `cclaw-review.md`, `cclaw-critic.md`) swept from every enabled harness's commands directory on `cclaw install` / sync.
- Orphan command cleanup keeps only `cc.md` + `cc-cancel.md` per harness.
- `RETIRED_TEMPLATE_FILES` removes `ideas.md` from `.cclaw/lib/templates/` on upgrade.

### Version annotations

- Inline `// v8.X — …`, prompt-body `> **v8.X — …**`, and parenthetical `(v8.Y; …)` attributions scrubbed from `src/`. Functional mentions kept (`@deprecated`, `pre-v8.X`, migration gates, runtime deprecation messages). **CHANGELOG remains the single source of release history.**

### README

- New **When to use which command** table: `/cc <task>`, `/cc research <topic>`, `/cc extend <slug> <task>`, `/cc-cancel` (4 commands total, was 7).

## 8.59.0 — Continuation flow (`/cc extend <slug>`)

### Why

v8.58 just shipped the `priorResearch` pattern — a one-shot context handoff from a `/cc research <topic>` flow into the next `/cc <task>`. That closes one of the cold-start gaps: research → task. It does NOT close the bigger gap: **task → task**. cclaw still treats every fresh `/cc <task>` as if the project had no history. Slug A ships Monday; Tuesday's `/cc <follow-up>` does not know A exists — the user re-states context, decisions, and lessons by hand.

Reference patterns that scratch this itch (compound's `ce-pulse`, mattpocock's PRD progression, gstack's skill chaining, everyinc's implementation-units-reference-prior-shipped-units) converge on **explicit parent linkage with structured context loading**. v8.59 generalises the v8.58 `priorResearch` shape to any shipped slug — same orthogonal field on `FlowState`, same "specialists read the path on demand" discipline, only this time the source artifact is the parent's `plan.md` / `build.md` / `learnings.md` instead of a standalone `research.md`.

### What changed

**Deliverable 1 — `/cc extend <slug> <task>` entry point** (`src/content/start-command.ts`, `src/content/runbooks-on-demand.ts`).

- Hop 1 (Detect) gains an extend-mode fork that fires when the raw `/cc` argument starts with the literal token `extend ` (case-insensitive, exactly one space). Parses `<slug>` + `<task>`, validates the parent via `loadParentContext(projectRoot, slug)` (`src/parent-context.ts`), and on `ok: true` (a) builds a new flow slug from the `<task>` text, (b) stamps `flow-state.json > parentContext` with the resolved structured pointer (slug + status: "shipped" + optional shippedAt + artifactPaths), (c) seeds `refines: <parent-slug>` + `parent_slug: <parent-slug>` in plan.md frontmatter, and (d) runs the triage-inheritance sub-step before dispatching the first specialist. The fork fires before the v8.58 research-mode fork — `extend` always wins (the user wanting research that extends a parent runs `/cc research` directly).
- `loadParentContext` (new module `src/parent-context.ts`) returns a discriminated union: `{ ok: true; context }` on a shipped slug with a non-empty `plan.md`, or `{ ok: false; reason; slug; message }` on one of four failure modes (`in-flight`, `cancelled`, `missing`, `corrupted`). Best-effort `shippedAt` read from `ship.md` frontmatter (legacy pre-v8.12 shipped slugs without ship.md still resolve; the field is just absent). Optional artifact paths (`build` / `review` / `critic` / `qa` / `learnings`) are stat-checked and included only when present on disk.
- New on-demand runbook `extend-mode.md` (`src/content/runbooks-on-demand.ts`) carries the full procedure — argument parsing rules, four parent-validation error sub-cases, seven argument sub-cases (no slug / no task / collision / reverted-parent / ceremonyMode-flag / runMode-flag / research-suffix), triage-inheritance precedence rules (explicit flag > escalation > parent > router default), worked examples, multi-level chaining policy (immediate parent only; `findRefiningChain` opt-in), and backwards-compat notes. The orchestrator body keeps a one-paragraph pointer per spec; runbook is lazy-loaded on every `/cc extend` invocation.
- Triage inheritance: when `parentContext` is set at flow init, `ceremonyMode` / `runMode` / `surfaces` default to the parent's plan.md / ship.md frontmatter values. Four-level precedence: (1) explicit `--strict` / `--soft` / `--inline` or `--mode=auto` / `--mode=step` flag wins; (2) security-keyword escalation heuristic (`security` / `auth` / `migration` / `schema` / `payment` / `gdpr` / `pci`) auto-escalates soft/inline parent → strict for the new flow; (3) parent inheritance; (4) router default (the v8.58 lightweight-router heuristic fires for any field not pinned by 1-3). Audit log records `userOverrode: true` + `overrideField: [...]` when the chosen value differs from the parent's value.

**Deliverable 2 — `flowState.parentContext` state shape** (`src/flow-state.ts`, `src/parent-context.ts`).

- New `ParentContext` and `ParentArtifactPaths` interfaces. `ParentContext` carries `slug: string` (mandatory) + `status: "shipped"` (closed enum — only valid value in v8.59) + `shippedAt?: string` (optional, best-effort) + `artifactPaths: ParentArtifactPaths` (mandatory; `plan` always present, the other five optional). `assertFlowStateV82` validates the field when present and non-null; pre-v8.59 state files lack the field entirely and continue to validate. `parentContext: null` is explicit-cold-start (no parent); `parentContext` absent is the same in semantics but the field is opt-in for back-compat.
- `parentContext` is **orthogonal to** `priorResearch` (the v8.58 research → task handoff). The two fields may co-exist on a single flow (a `/cc extend` flow that also follows a shipped `/cc research`); specialists read both when both are present.
- Helper `listShippedSlugs(projectRoot)` lists every shipped slug under `.cclaw/flows/shipped/` that has both the canonical `YYYYMMDD-` date prefix AND a non-empty `plan.md` (excludes corrupted dirs). Used by the orchestrator to (a) sanity-check the project has any shipped slugs before suggesting `/cc extend`, and (b) future-proofing for nearest-neighbour suggestions in `"missing"` error messages.

**Deliverable 3 — Specialist consumption of `parentContext`** (`src/content/specialist-prompts/design.ts`, `src/content/specialist-prompts/ac-author.ts`, `src/content/specialist-prompts/reviewer.ts`, `src/content/specialist-prompts/critic.ts`).

- `design` Phase 0 (Bootstrap) — reads `parentContext.artifactPaths.plan` and focuses on the parent's `## Spec`, `## Decisions`, and `## Selected Direction` sections; surfaces "Building on prior decisions: …" in the Frame draft. Skips re-deciding D-N records the parent already settled. Phase 1 (Clarify) skips clarifications resolved by the parent's plan.md. Phase 5 (Pre-mortem; deep posture) augments with parent's `review.md` / `critic.md` open findings when those artifacts exist.
- `ac-author` Phase 0 (soft path) — surfaces "Extends slug: <name>. Prior testable conditions: …" (truncated to 3-5 bullets from the parent's `## Plan` or `## Testable conditions` section) in the assumption-confirmation ask. The user accepts inheritance (silence) or revises (one round).
- `ac-author` Phase 1.7 — new mandatory phase that fires when `flowState.parentContext` is set. Authors the `## Extends` section at the top of plan.md (after `# <slug>` heading, before `## Frame`) with the parent slug as `refines: <parent-slug>` + 1-line parent decision summary + clickable links to all present parent artifacts. The new helper `renderExtendsSection(input)` (`src/content/artifact-templates.ts`) renders the canonical block from a `ParentContext`-shaped input; deterministic bullet order (plan / build / qa / review / critic / learnings), graceful fallback for absent `shippedAt`.
- `reviewer` — new lightweight `## Parent-contradictions cross-check (v8.59)` section runs when `parentContext` is non-null. One-pass scan of the parent's `## Decisions` against the current diff + plan.md; silent reversals of a parent D-N are `required` findings (axis: correctness). Acknowledged reversals (the current plan.md's `## Open questions` names "Reverses parent decision D-N: <rationale>") are NOT findings. Multi-level chains are not walked — only the immediate parent.
- `critic` — §3 Skeptic lens adds a question: "does this contradict the parent slug's decisions?". One question, not a full audit; runs only when `parentContext` is non-null.

**Deliverable 4 — Plan template `## Extends` section + frontmatter `parent_slug`** (`src/content/artifact-templates.ts`).

- Both `PLAN_TEMPLATE` (strict) and `PLAN_TEMPLATE_SOFT` (soft) gain `parent_slug: null` in frontmatter. The field mirrors the orchestrator-level pointer; on cold-start flows it stays `null`. `parent_slug` is the v8.59-native field that downstream tooling can rely on without the legacy `refines:` ambiguity; both fields are kept in sync at extend init, with `parent_slug` authoritative on drift.
- Both templates' body carries a `## Extends` placeholder section between `# <slug>` and `## Frame` (strict) / `## Plan` (soft). ac-author Phase 1.7 either authors the section verbatim from `flowState.parentContext` or removes the placeholder entirely (cold-start `/cc <task>` flows drop the section).
- New `renderExtendsSection(input)` helper (`src/content/artifact-templates.ts`) returns the canonical `## Extends` block from a structured input (`parentSlug` + `shippedAt?` + `decisionSummary` + `planRelativePath` + `optionalArtifactRelativePaths`). Pure renderer; no filesystem dependency. Deterministic bullet order: plan, build, qa, review, critic, learnings.

**Deliverable 5 — Knowledge-store integration** (`src/knowledge-store.ts`).

- `findNearKnowledge` gains an optional `parentSlug?: string` field on `NearKnowledgeOptions`. When set AND the parent's entry exists in `knowledge.jsonl`, the entry is **prepended** to the result regardless of Jaccard similarity (parent is load-bearing context — `/cc extend` already told us the parent is relevant; we don't need Jaccard to re-prove it). The remaining `limit - 1` slots fill with the standard Jaccard-ranked hits.
- The lookup walks the full knowledge log (not just the recency window) when matching the parent's slug — an older parent referenced via `/cc extend` stays surfaceable even when it's outside the standard 100-entry window. Jaccard branch still respects the window.
- De-dup: a Jaccard hit sharing the parent's slug is filtered from the Jaccard pool (the parent appears exactly once, at index 0). The parent's `outcome_signal` does NOT apply to the prepend (a `reverted` parent is still loaded — the orchestrator already warned the user at extend init with the "parent slug was later reverted — proceed only if you understand the revert" one-liner).
- Graceful degrade: parent slug not in `knowledge.jsonl` → Jaccard-only result (same as pre-v8.59). Empty/blank `taskSummary` + `parentSlug` set → parent-only result (the parent is load-bearing even without a summary). Empty-string `parentSlug` throws (callers passing empty get a thrown error, not a silent no-op).
- Pre-v8.59 callers (no `parentSlug` option) get identical Jaccard-only behaviour. The option is purely additive.

**Deliverable 6 — Auto-detection deferred to v8.60+** (design decision D-7 in `.cclaw/flows/v859-continuation/design.md`).

- Pattern-matching task text for "extend <slug>" / "continue <slug>" / "build on <slug>" / "after <slug>" inside a plain `/cc <task>` flow is NOT shipped in v8.59. The v8.58 lightweight router is zero-question by default; adding a combined-form ask ("Looks like you're extending <slug>. Use parent context? [y/n]") would conflict with that contract. Users who want extend semantics use the explicit `/cc extend <slug>` entry point. Future auto-detection (when shipped) becomes a second path into the same init code; the explicit entry point stays unambiguous.

**Deliverable 7 — Tests + smoke** (`tests/unit/v859-continuation.test.ts` — new file, 64 tests; updates to `prompt-budgets.test.ts`, `v822-orchestrator-slim.test.ts`, `v831-path-aware-trimming.test.ts`, `scripts/smoke-init.mjs`).

- New `v859-continuation.test.ts` carries the tripwire suite — `ParentContext` / `ParentArtifactPaths` type surface (assignment-compat, mandatory-field validation, status=shipped-only invariant), `loadParentContext` on-disk validator (all four error reasons, best-effort shippedAt read, optional-artifact-path resolution, sparse-legacy-ship.md fallback, shipped-vs-cancelled precedence), `listShippedSlugs` (empty / non-canonical-prefix-filtering / missing-plan-filtering / sorted-output), `PARENT_ARTIFACT_FILE_NAMES` mapping, `renderExtendsSection` rendering (all fields populated / absent optional artifacts / shippedAt fallback / deterministic order / mandatory-field validation), plan-template frontmatter `parent_slug: null` + body `## Extends` placeholder, design / ac-author / reviewer / critic prompt wiring (each specialist references `flowState.parentContext`), orchestrator body Detect-hop fork + prior-context consumption pointer, `extend-mode.md` runbook content (heading + four reasons + precedence rules + multi-level policy + seven sub-cases), and `findNearKnowledge` parent-prepend (cap honoured, graceful degrade, no-double-include, ignores `reverted` signal, pre-v8.59 back-compat, empty-string rejection, out-of-window parent surfacing).
- `prompt-budgets.test.ts` raises `ac-author` budget 600 → 640 lines / 56000 → 60000 chars (Phase 1.7 parent-context linkage block adds ~18 lines and ~2.6k chars); raises `reviewer` budget 690 → 710 lines / 68000 → 71000 chars (parent-contradictions cross-check section adds ~10 lines and ~2k chars). Both budget raises documented inline with the v8.59 attribution.
- `v822-orchestrator-slim.test.ts` extends the `expectedRunbookFiles` array with `extend-mode.md` (12 on-demand runbooks total, up from 11). Raises the line budget 535 → 545 (~10 lines for the v8.59 Detect-hop pointer + prior-context consumption pointer), the body-char budget 67500 → 69000 (~1k chars), and the combined ceiling 160000 → 175000 (~9k chars for the new runbook).
- `v831-path-aware-trimming.test.ts` raises the path-conditional budgets: body alone 67500 → 69000 chars (matching the body-char raise above), inline path 67500 → 69000 chars (same), non-inline path 120000 → 122000 chars, large-risky path 165000 → 167000 chars.
- `scripts/smoke-init.mjs` gains a v8.59 continuation-mode pass: after init, asserts `extend-mode.md` is written under `.cclaw/lib/runbooks/` with the canonical `# On-demand runbook —` heading and documents all four `ParentContextErrorReason` values (`in-flight` / `cancelled` / `missing` / `corrupted`), the `loadParentContext` validator, `parentContext`, and the legacy `refines:` frontmatter for knowledge-store back-compat.
- Test count delta: **+64 new tests** (1212 → 1276 passing).

### Migration notes

**No breaking changes.** The continuation flow is opt-in via the explicit `/cc extend <slug> <task>` entry point; standard `/cc <task>` and `/cc research <topic>` invocations are unaffected. Pre-v8.59 state files (no `parentContext`) validate verbatim; readers default to absent/null meaning cold-start. Pre-v8.59 shipped slugs are valid extend targets even though their plan.md lacks the `parent_slug:` frontmatter field — the new flow's `parentContext.slug` is the canonical link, and the orchestrator does not write `parent_slug` retroactively to historical artifacts.

The `refines:` frontmatter (introduced pre-v8.59 for the knowledge-store chain and the qa-runner / plan-critic / design-Phase-6 skip gates) is preserved and kept in sync with `parent_slug` at extend init. Downstream consumers that read `refines:` see it populated on every extend-mode flow; downstream consumers that prefer the v8.59-native pointer read `parent_slug` instead. The two fields are kept in sync by the extend-init code path; user manual edits to plan.md after init can drift the values, in which case `parent_slug` is authoritative.

The v8.58 `priorResearch` pattern is preserved verbatim. A flow that consumed a research handoff (priorResearch is set) AND then invoked `/cc extend` (parentContext is set) reads BOTH context sources in specialists. The two fields are orthogonal and do not conflict.

## 8.58.0 — Lightweight router + research mode + design standalone

### Why

A v8.56 audit pass surfaced two structural problems with how the orchestrator handles the up-front routing step:

1. **The router was doing classification, not just routing.** "Triage" today decides `complexity` × `ceremonyMode` × `path` × `runMode` (pure routing), but it ALSO does surface detection, assumption capture, prior-learnings injection, and interpretation-fork extraction. ~50% of that overlap duplicates work the `design` specialist already does in Phase 0-2 (assumption capture in Bootstrap, clarifying questions in Clarify, scope framing in Frame). When `design` ran (`large-risky` tasks), the duplication was wasted work; when `design` did not run (`trivial` / `small-medium`), the orchestrator did the same work but with less codebase context. The combined-form structured ask added user-visible friction at the gate that the heuristics rarely needed (the v8.44 audit log showed `userOverrode == false` on ~85% of v8.49+ flows).
2. **There was no pre-task entry point.** Users sometimes start with unclear intent (research / brainstorm need) rather than a clear task. The 11-reference audit (gsd-v1 spec-phase, chachamaru plan_analyst, compound planner, addyosmani `/spec`, mattpocock `/triage` + `/to-prd`, obra-superpowers brainstorming, oh-my-claudecode analyst, oh-my-openagent Prometheus, ...) showed that every reference with this problem treated brainstorming as a **separate entry point**, not a sub-step inside routing. cclaw users with unclear intent had to exit cclaw, use the harness directly for research, then come back with a clarified task.

v8.58 closes both gaps with three coordinated changes that share one principle: **routing decides where to go; specialists decide what to do.**

### What changed

**Deliverable 1 — Router (Hop 2) reshape** (`src/content/start-command.ts`, `src/content/skills/triage-gate.md`, `src/types.ts`).

- The router is now **zero-question by default**. The legacy v8.14-v8.57 combined-form structured ask is removed; the router emits a one-line announcement (`─ small-medium / soft / plan → build → review → critic → ship · runMode=step · slug=<slug>`) and dispatches the first specialist. No `AskUserQuestion` invocation at this hop.
- **The router decides exactly five fields**: `complexity` (trivial / small-medium / large-risky) × `ceremonyMode` (inline / soft / strict) × `path` (FlowStage[]) × `runMode` (auto / step / null) × `mode` (task / research). Six fields the router used to decide moved to the specialist that consumes them: `surfaces` (design Phase 2 / ac-author Phase 1.5), `assumptions` (design Phase 0 / ac-author Phase 0), `priorLearnings` (design Phase 1 / ac-author Phase 0), `interpretationForks` (design Phase 1), `criticOverride` (no v8.58 writer; reserved for future explicit-flag promotion), `notes` (no v8.58 writer; specialist-owned annotations now).
- **Three new override flags** short-circuit the heuristic on explicit user intent: `/cc --inline <task>`, `/cc --soft <task>`, `/cc --strict <task>`. Flags are mutually exclusive (last-flag wins on conflict, with a one-line note); orthogonal to the v8.34 `--mode=auto` / `--mode=step` runMode toggle; do NOT bypass the no-git auto-downgrade (a no-git project with `--strict` still lands on `ceremonyMode: "soft"` with `downgradeReason: "no-git"`); record `userOverrode: true` in the v8.44 audit log when the choice differs from the heuristic.
- New `RESEARCH_MODES = ["task", "research"]` constant + `ResearchMode` type in `src/types.ts`. `TriageDecision.mode?: ResearchMode` field added; defaults to `"task"` on absence (pre-v8.58 state files read as task-mode automatically). The six soft-deprecated `TriageDecision` fields (surfaces, assumptions, priorLearnings, interpretationForks, criticOverride, notes) keep their type signatures with `@deprecated v8.58` JSDoc; readers continue to consume them verbatim on pre-v8.58 state files, and the v8.58 specialist write path repopulates them via `patchFlowState`.
- `triage-gate.md` skill is rewritten end-to-end for the v8.58 routing contract: documents the five-field router output, the seven moved-out fields, the three override flags, the no-git auto-downgrade interaction with override flags, four worked examples (trivial / small-medium / large-risky / override-flag / vague-prompt), and twelve common-rationalizations rows (router-skip-temptation, vague-prompt-ask-temptation, legacy-combined-form-temptation, mid-flight-toggle-shape, override-flag-on-resume, large-risky-padding, no-git-downgrade-with-strict, research-as-ceremonyMode-confusion, plus the cross-cutting `.cclaw/lib/anti-rationalizations.md` pointer).

**Deliverable 2 — Design specialist absorbs triage responsibilities** (`src/content/specialist-prompts/design.ts`).

- Phase 0 (Bootstrap) is now the **assumption-capture owner**. v8.58 fresh flows arrive with `triage.assumptions` absent; Phase 0 generates 3-7 stack / convention / target-platform assumptions and `patchFlowState`s `triage.assumptions`. Pre-v8.58 flows with seeded assumptions: Phase 0 reads them verbatim (back-compat) and supplements only if Phase 0's scan surfaces an undocumented assumption.
- Phase 1 (Clarify) is now the **interpretation-forks + prior-learnings owner**. Phase 1 surfaces ambiguities as clarifying questions and `patchFlowState`s `triage.interpretationForks` after the user disambiguates. Phase 1 also calls `findNearKnowledge(taskText)` (replaces the v8.18 orchestrator-side Hop 2.5 lookup) and `patchFlowState`s `triage.priorLearnings`. The v8.50 outcome-signal weighting and similarity threshold are preserved verbatim — only the call site moved.
- Phase 2 (Frame) is now the **surface-detection owner**. Phase 2 detects surfaces from file signals + task description, `patchFlowState`s `triage.surfaces`, and rewrites `triage.path` to insert `"qa"` between `"build"` and `"review"` when UI/web surfaces are detected and `ceremonyMode != "inline"` (the v8.52 qa-stage insertion contract is preserved verbatim — only the writer moved).
- Phase 7 (Sign-off) emits a **two-variant picker** depending on activation mode. Intra-flow (the historical default) — three-option `approve` / `request-changes` / `reject` (unchanged). Standalone research — two-option `accept research` / `revise` (new).

**Deliverable 3 — Design standalone mode (research mode)** (`src/content/specialist-prompts/design.ts`, `src/content/artifact-templates.ts`, `src/artifact-paths.ts`).

- New `### Activation modes (v8.58)` section at the top of the design specialist contract. Two modes share Phase 0-6 verbatim; only Phase 7 picker shape and the Phase 6 artifact-target differ.
  - **Intra-flow** (`triage.mode == "task"`, `ceremonyMode == "strict"`): writes Phase 6 Compose output to `plan.md`; hands off to `ac-author` after Phase 7 `approve`.
  - **Standalone research** (`triage.mode == "research"`): writes Phase 6 Compose output to `research.md`; finalises immediately after Phase 7 `accept research` (no ac-author handoff, no build / review / critic / ship). The research posture defaults to `deep` regardless of complexity heuristic (since the user explicitly invoked the brainstormer).
- New `RESEARCH_TEMPLATE` in `src/content/artifact-templates.ts` carries the v8.58 research-mode frontmatter (`mode: research`, `topic`, `generated_at`) and the design-portion section layout (Frame, Spec, Approaches, Selected Direction, Decisions, Pre-mortem, Not Doing, Open questions, Summary — no AC table / Topology / Traceability, since those belong to the follow-up `/cc <task>` flow that consumes this research). `researchTemplateForSlug(slug, topic, isoTimestamp)` helper fills the placeholders.
- New `"research"` entry in `ArtifactStage` (`src/artifact-paths.ts`) and `ARTIFACT_FILE_NAMES` (`research: "research.md"`). `activeArtifactPath(projectRoot, "research", slug)` resolves to `.cclaw/flows/<slug>/research.md`; `shippedArtifactPath` to `.cclaw/flows/shipped/<slug>/research.md`. The `"research"` artifact stage is NOT a `FlowStage` token — research flows have no build / review / critic / ship.

**Deliverable 4 — `/cc research <topic>` entry point** (`src/content/start-command.ts`, `src/flow-state.ts`).

- Hop 1 (Detect) gains a research-mode fork: if input starts with `research ` or carries `--research`, the orchestrator strips the trigger from the task text, builds a research-mode slug (`YYYYMMDD-research-<semantic-kebab>`), and skips the router entirely. The orchestrator stamps a sentinel `triage` block (`complexity: "large-risky"`, `ceremonyMode: "strict"`, `path: ["plan"]`, `mode: "research"`, `runMode: "step"`, `rationale: "research-mode entry point"`) and dispatches `design` standalone with a `Mode: research` flag in the dispatch envelope.
- After Phase 7 `accept research`, the orchestrator `git mv`s the artifact to `.cclaw/flows/shipped/<slug>/research.md` and surfaces a plain-prose handoff prompt: "Ready to plan? Run `/cc <clarified task description>` and I'll carry the research forward as context." The next `/cc <task>` invocation on the same project reads the most-recent shipped research slug and stamps it into `flow-state.json > priorResearch: { slug, topic, path }`.
- New `flowState.priorResearch?: { slug: string; topic: string; path: string } | null` field in `FlowStateV82`. `assertFlowStateV82` validates that present-and-non-null `priorResearch` has three non-empty string fields; pre-v8.58 state files lack the field entirely and continue to validate.
- `ac-author` Phase 0 / `design` Phase 0 on the follow-up flow read `priorResearch.path` and include the research artifact in their reads (no new specialist contract; the existing "Inputs you have access to" section adds the new path).

**Deliverable 5 — ac-author absorbs soft-path triage responsibilities** (`src/content/specialist-prompts/ac-author.ts`).

- Phase 0 (Assumption confirmation) is now the **soft-path assumption-capture owner**. On v8.58 fresh flows `triage.assumptions` is absent; Phase 0 generates and `patchFlowState`s the field. Phase 0 also reads `flowState.priorResearch.path` when present (v8.58 research → task handoff).
- New **Phase 1.5 (Surface scan)** between Phase 1 (Bootstrap) and Phase 2 (AC authoring). Detects surfaces from the task description + file signals, `patchFlowState`s `triage.surfaces`, and rewrites `triage.path` to insert `"qa"` when UI/web surfaces are detected (mirrors the design Phase 2 contract — only the call site differs).

**Deliverable 6 — Tests** (`tests/unit/v858-router-research.test.ts` — new file, 44 tests; updates to `prompt-budgets.test.ts`, `v818-knowledge-surfacing.test.ts`, `v821-preflight-fold.test.ts`, `v823-no-git-fallback.test.ts`, `v849-overcomplexity-sweep.test.ts`, `artifact-paths.test.ts`).

- New `v858-router-research.test.ts` carries the tripwire suite — RESEARCH_MODES type surface, soft-deprecated TriageDecision fields back-compat, flowState.priorResearch validation + migration, start-command lightweight-router prose (zero-question default, override flags, five fields the router decides, six fields the router stops deciding, research-mode entry-point fork, sentinel triage block shape, priorResearch handoff prose, qa-stage gating contract preservation, combined-form removal), design Phase 0/1/2 specialist-ownership prose, design standalone activation mode + Phase 6 research.md target + Phase 7 two-option picker, intra-flow three-option picker preservation, ac-author Phase 0 + Phase 1.5 soft-path ownership prose, research.md artifact template + path resolution + frontmatter shape, triage-gate skill v8.58 routing-contract prose, pre-v8.58 state-file back-compat (verbatim migration of seeded triage classification fields).
- `prompt-budgets.test.ts`: `design` prompt budget raised from 470 lines / 47000 chars to 530 lines / 61000 chars. The increase is justified by the four absorbed responsibilities (Phase 0 assumption-capture owner, Phase 1 interpretation-forks owner + prior-learnings owner, Phase 2 surface-detection owner) plus the new standalone activation mode (Phase 7 two-variant picker, research-posture defaulting, research.md artifact targeting).
- `v818-knowledge-surfacing.test.ts`: tests `(e)` and `(f)` updated to reflect the v8.58 ownership move — the test still asserts that `findNearKnowledge` is called and `triage.priorLearnings` is populated, but now in the context of the design Phase 1 / ac-author Phase 0 specialist-side lookup rather than the Hop 2.5 orchestrator-side lookup.
- `v821-preflight-fold.test.ts`: the test for design Phase 0's v8.21 fold updated to expect the v8.58 renamed term "Assumption-capture ownership" instead of "Assumption-surface ownership".
- `v823-no-git-fallback.test.ts`: the strict-mode no-git auto-downgrade explanation in `triage-gate.md` updated to include the `git log --grep="(AC-N):"` reviewer grep call.
- `v849-overcomplexity-sweep.test.ts`: passes after `triage-gate.md` gains the required cross-cutting `.cclaw/lib/anti-rationalizations.md` pointer.
- `artifact-paths.test.ts`: the `ARTIFACT_FILE_NAMES` exact-shape test expanded to include the new `research: "research.md"` entry; a new test locks the `activeArtifactPath` / `shippedArtifactPath` resolution for the `"research"` stage.

**Deliverable 7 — README rewrite** (`README.md`).

- Lead paragraph updated to mention the two-entry-point shape (`/cc <task>` + `/cc research <topic>`).
- New `## Modes` section documents both entry points: `/cc <task>` (with override flags + v8.58 routing simplification), `/cc research <topic>` (with `--research` alias + handoff prompt + sentinel triage block + Mermaid flow diagram showing the two-fork shape).
- "Why cclaw" gains two new bullets (Lightweight router + Research mode).
- "Worked example" Triage line updated to mention the v8.58 zero-question default and the moved-out classification work.
- "What you get" Specialists row updated to reflect design's two activation modes + ac-author's soft-path absorption.
- Artifact tree gains `research.md` (v8.58+, research-mode flows only).

### Migration

**Pre-v8.58 state files validate verbatim.** A `flow-state.json` written by cclaw ≤ v8.57 has its `triage.{surfaces, assumptions, priorLearnings, interpretationForks, criticOverride, notes}` fields populated by the orchestrator. `migrateFlowState` is a no-op for those fields — they stay readable on the soft-deprecated surface for one release, and the specialists continue to consume them verbatim. Pre-v8.58 state files lack the `triage.mode` field; readers default to `"task"`. Pre-v8.58 state files lack the `priorResearch` field; readers default to `undefined`.

**CLI invocations are forward-compatible.** `/cc <task>` continues to work unchanged. The new override flags (`--inline` / `--soft` / `--strict`) and the new entry point (`/cc research <topic>` / `/cc --research <topic>`) are opt-in. v8.57 utility commands (`/cclaw-review`, `/cclaw-critic`) are unaffected — they continue to install alongside `cc.md` / `cc-cancel.md` / `cc-idea.md` in every enabled harness's commands directory, and their runtime behaviour is independent of the router reshape.

**No artifact rename.** `plan.md` is unchanged. `research.md` is new (v8.58 only, research-mode flows). The existing build / qa / review / critic / plan-critic / ship artifacts are unchanged.

**Test count delta.** +44 v8.58 tests (`tests/unit/v858-router-research.test.ts`), +1 artifact-paths test (research path resolution), prompt-budgets test updated to reflect the design specialist's expanded scope. Net +45 tests over the v8.57 baseline.

### Removed surface

- v8.14-v8.57 **combined-form structured ask** at the router hop — removed. The router is zero-question by default; override flags carry the explicit-choice case. One breadcrumb sentence in `triage-gate.md` notes the removal so harness operators upgrading from v8.57 see the contract change.

### Files added / modified

**Added** (3 files): `src/content/artifact-templates.ts` (new `RESEARCH_TEMPLATE` + `researchTemplateForSlug`), `tests/unit/v858-router-research.test.ts` (44 tests, new), `.cclaw/flows/v858-router-research/design.md` (the Phase A design doc; preserved under `.cclaw/flows/shipped/` after this release ships per the dogfooding convention).

**Modified** (9 source files + 6 test files + 2 docs): `src/types.ts` (RESEARCH_MODES constant, ResearchMode type, TriageDecision.mode field, six soft-deprecated JSDoc rows), `src/flow-state.ts` (priorResearch field + assertion, isResearchMode helper, triage.mode validation), `src/content/start-command.ts` (Detect fork for research-mode, router rewrite for zero-question default, override flags, sentinel triage block for research, priorResearch handoff, v8.58 prior-learnings consumption note), `src/content/skills/triage-gate.md` (full rewrite for v8.58 routing contract), `src/content/specialist-prompts/design.ts` (activation modes header, Phase 0/1/2 absorption, Phase 6 research.md target, Phase 7 two-variant picker), `src/content/specialist-prompts/ac-author.ts` (Phase 0 assumption-capture owner on soft path, Phase 1.5 surface scan, priorResearch read), `src/content/artifact-templates.ts` (RESEARCH_TEMPLATE), `src/artifact-paths.ts` ("research" stage), `scripts/smoke-init.mjs` (research.md installation check). Tests: `tests/unit/prompt-budgets.test.ts`, `tests/unit/v818-knowledge-surfacing.test.ts`, `tests/unit/v821-preflight-fold.test.ts`, `tests/unit/v823-no-git-fallback.test.ts`, `tests/unit/v849-overcomplexity-sweep.test.ts`, `tests/unit/artifact-paths.test.ts`. Docs: `README.md`, `CHANGELOG.md`.

## 8.56.0 — Decenter AC: rename `acMode` → `ceremonyMode`, recontextualize AC as one element of the plan, neutral-tone README rewrite

### Why

A cross-reference audit (run after v8.55 landed) sampled how 11 reference projects — gsd-v1, chachamaru, compound, addyosmani, mattpocock, oh-my-claudecode, oh-my-openagent, gstack, and others — frame Acceptance Criteria. The pattern is consistent across the cohort: AC is **one element inside a larger plan/spec artifact**, not the organising concept around which the tool is named. cclaw's IMPLEMENTATION was already largely balanced — `plan.md` carries 14 sections (AC is section 10 of 14), the reviewer has 0/10 AC-named axes, and only 1/8 specialists is AC-named — but three surfaces leaked an AC-centric vocabulary:

1. **The config knob `acMode`** — unique among the 11 references; the rest call this dimension some shape of "ceremony" / "rigor" / "mode".
2. **Narrative phrasing "per-AC"** in prompts/skills/runbooks treated AC as the only unit-of-work, even when the underlying contract covers AC rows + Edge cases + NFR rows + Decisions.
3. **README framing** had drifted significantly between v8.48 and v8.55: 7 numeric drifts (specialist count, skill count, runbook count, reviewer axes, plan sections, postures, outcome signals) and 8 v8.48-v8.55 features were missing from the document entirely.

v8.56 fixes the vocabulary surface without changing any runtime contract. The technical trace mechanism `<type>(AC-N):` commit prefix is unchanged; the `## Acceptance Criteria` plan-section heading is unchanged (9/11 references use it verbatim); the `AcceptanceCriterionState` type name is unchanged; the `ac-author` specialist is **not** renamed.

### What changed

**Deliverable 1 — `acMode` → `ceremonyMode` rename with one-release legacy alias on read** (`src/types.ts`, `src/flow-state.ts`, `src/triage-audit.ts`, all specialist prompts, all skill bodies, all runbooks, all tests).

- `AC_MODES` constant → `CEREMONY_MODES`; `AcMode` type → `CeremonyMode`. The legacy `AC_MODES` and `AcMode` exports survive as deprecated re-exports for one release so downstream importers compile during the deprecation window.
- `TriageDecision.acMode` field → `TriageDecision.ceremonyMode`. `migrateFlowState` hoists `triage.acMode` to `triage.ceremonyMode` on read when the legacy key is present (pre-v8.56 `flow-state.json` files migrate transparently); when both keys appear, `ceremonyMode` wins and `acMode` is stripped.
- Snake-case YAML frontmatter on artifact templates: `ac_mode:` → `ceremony_mode:` in plan / build / critic / plan-critic / qa templates. The artifact-template comments note the legacy `ac_mode` key is accepted on read for one release.
- `isAcMode` predicate → `isCeremonyMode` (with `isAcMode` retained as a deprecated alias).
- Skill descriptions in `src/content/skills.ts` and auto-trigger condition strings (`ac_mode:strict` → `ceremony_mode:strict` in `ac-discipline` / `tdd-and-verification` / `debug-and-browser` / `qa-and-browser` / `source-driven` triggers).
- Test surface: 13 test files updated to use the new field names. One new test file `tests/unit/v856-ceremony-mode.test.ts` locks the safe-rename contract — verifies (a) canonical names are correct, (b) `migrateFlowState` rewrites legacy `triage.acMode` to `triage.ceremonyMode` and strips a stale companion `acMode` when both keys appear, (c) `readFlowState` normalises a pre-v8.56 on-disk file with `triage.acMode` into a v8.56-shaped triage.

**Deliverable 2 — narrative sweep: `per-AC` → `per-criterion`** (all prompts/skills/runbooks/templates).

- "per-AC TDD cycle" → "per-criterion TDD cycle".
- "per-AC commits" / "one commit per AC" → "per-criterion commits" / "one commit per criterion".
- "per-AC prefix" / "per-AC chain" / "per-AC ordering" / "per-AC traceability" → "per-criterion prefix" / "per-criterion chain" / "per-criterion ordering" / "per-criterion traceability".
- "per-AC evidence" / "per-AC verification" / "per-AC verified flag" → "per-criterion evidence" / "per-criterion verification" / "per-criterion verified flag".
- "AC mode" → "ceremony mode" (orchestrator prompts, triage-gate skill prose, flow-resume skill).
- "AC traceability" reviewer axis description → "plan traceability" (reviewer.ts, stage-playbooks ship section, cclaw-rules ambient surface).
- `AC-N` trace IDs are unchanged (commit prefix mechanism, technical trace; user explicit reject).
- The `## Acceptance Criteria` plan-section heading is unchanged (9/11 references use it verbatim; industry standard).

**Deliverable 3 — `ac-author` contract recontextualization** (`src/content/specialist-prompts/ac-author.ts`).

- Opening / role definition rewritten: "You write `plan.md` for the active slug. The plan carries seven outputs: Spec, Plan, Acceptance Criteria, Edge cases, Topology, Feasibility stamp, Traceability block. Acceptance Criteria is one of these outputs — not the primary deliverable, not the organising concept — and the spec / edge-case / topology / traceability sections carry the same authoring weight."
- The specialist is **not** renamed (user explicit reject; gsd-v1 precedent shows AC vocabulary can coexist with balanced framing).

**Deliverable 4 — reviewer axis text update** (`src/content/specialist-prompts/reviewer.ts`).

- "AC traceability" axis description text → "plan traceability" — the axis checks that commits trace back to plan items (AC IDs are one mechanism), not just to AC rows. The axis NAMES (`correctness`, `test-quality`, etc.) are unchanged.

**Deliverable 5 — critic §4 rename + scope expansion** (`src/content/specialist-prompts/critic.ts`).

- §4 title "Self-audit on AC quality" → "Criterion check (are the verifiable plan criteria the right criteria, not are they met?)".
- Scope **expanded** to cover every verifiable plan criterion: AC rows + Edge case entries + NFR rows (where measurable). The §4 table grows a `Source` column distinguishing AC / edge-case / NFR rows. Drift findings emit at class=`criterion-coverage` (AC rows) / `edge-case-drift` (edge cases) / `nfr-drift` (NFR rows).
- §2 first bullet renamed from "AC coverage gaps" to "Criterion-coverage gaps" for vocabulary symmetry with §4 and the §2 findings-table class enum.
- Critic template (`critic.md`) §4 narrative + table shape updated to match the expanded scope.

**Deliverable 6 — `ac-discipline` skill rename decision** (no file rename).

- Re-read `src/content/skills/ac-discipline.md`. The skill's content is narrowly scoped to AC table format/quality + the posture-driven commit-prefix contract — not to broader criterion discipline. **Decision: KEEP the file name.** Skill ID, `AUTO_TRIGGER_SKILLS` entry, and `EXPECTED_SKILL_FILES` smoke list unchanged.

**Deliverable 7 — README rewrite** (`README.md`).

- Tagline drops "TDD by default" lead → "A multi-stage planning + review harness for coding agents."
- AC enters only where structurally true (strict ceremony mode, per-criterion build cycle); NOT in tagline, NOT in first 2 "Why" bullets, NOT as the worked-example spine.
- All 7 numeric drifts fixed: 8 specialists (was "5 sub-agents + 1 main-context coordinator"), 21 skills (was "17"), 11 runbooks (was "13"), 10 reviewer axes — 8 base + 2 gated (was "seven-axis"), 14/6 plan template sections (was implicit "7"), 6 postures, 5 outcome signals.
- All 8 missing v8.48-v8.55 features now documented: `plan-critic` specialist (v8.51), `qa-runner` specialist (v8.52), 6 critic human-perspective lenses (v8.53), ambiguity score (v8.53), `outcome_signal` enum (v8.50), discipline skills (v8.48 — completion-discipline / pre-edit-investigation / receiving-feedback / edit-discipline axis), anti-rationalization catalog (v8.49), harness-embedded rules (v8.55).
- Neutral technical tone — no marketing prose, no "where cclaw wins" framing.

### Out of scope (explicit)

- Renaming the `ac-author` specialist (user explicit reject; AC vocabulary OK if rest is balanced — gsd-v1 precedent).
- Renaming the `## Acceptance Criteria` section in `plan.md` templates (industry standard, 9/11 references use it verbatim).
- Renaming the `AcceptanceCriterionState` type (accurately describes the record it stores).
- Changing the commit prefix `<type>(AC-N):` (technical trace mechanism the reviewer reads via `git log --grep`).

### Migration / back-compat

- **Existing `.cclaw/config.yaml`**: cclaw never stored `acMode` at the config level (the field has always lived on `flow-state.json > triage`); no config migration needed.
- **Existing `flow-state.json` files**: pre-v8.56 files carry `triage.acMode`; `migrateFlowState` rewrites them on first read to `triage.ceremonyMode` and persists the v8.56 shape on the next state write. The migration is a no-op when the file already carries `ceremonyMode`.
- **Existing shipped artifacts**: never modified. Shipped flows under `.cclaw/flows/shipped/<slug>/` carry the original `ac_mode:` frontmatter key; the prompts and skills accept this on read.
- **Downstream importers of `AC_MODES` / `AcMode`**: continue to work as deprecated aliases of `CEREMONY_MODES` / `CeremonyMode` for one release. Plan to migrate before v8.57.

## 8.55.0 — harness-embedded rules surface: cclaw ambient discipline in `.cursor/`, `.claude/`, `.codex/`, `.opencode/` namespaces

### Why

The cross-reference content-footprint audit (run between v8.53 and v8.54) flagged cclaw as the **only** reference among 11 that ships zero rules files. Every other reference (chachamaru, gsd-v1, OMC, compound, etc.) ships `CLAUDE.md` / `AGENTS.md` / `.cursor/rules/`. cclaw's deliberate `/cc`-only activation has a real cost: in projects where agents do not always invoke `/cc`, cclaw's Iron Laws, anti-rationalization catalog, and antipatterns DON'T apply — agents run "naked" with default harness behaviour.

v8.55 closes the gap without compromising the user's no-project-root-AGENTS/CLAUDE constraint. Every cclaw rules file lives inside a harness-namespaced directory (`.cursor/`, `.claude/`, `.codex/`, `.opencode/`); cclaw never touches `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md` at the project root (the user owns those files). For Cursor the rules auto-load via MDC `alwaysApply: true`; for the other three harnesses the install summary surfaces a one-line `@`-reference the user adds to their root memory file to activate ambient discipline.

### What changed

**Deliverable 1 — per-harness rules audit** (research; reflected in `src/install.ts` rules-layout docstrings).

Canonical rules locations confirmed against current 2026 docs:

- **Cursor** — `.cursor/rules/*.mdc` with YAML frontmatter (`description`, `globs`, `alwaysApply`). `alwaysApply: true` activates on every session start without user action.
- **Claude Code** — `./CLAUDE.md` (project root) or `./.claude/CLAUDE.md`. Subdirectory rules under `.claude/` load via `@path` reference from the root memory file. A standalone `.claude/cclaw-rules.md` requires the user to add `@.claude/cclaw-rules.md` to their CLAUDE.md.
- **Codex** — `./AGENTS.md` (project root) or `~/.codex/AGENTS.md`. Subdirectory rules under `.codex/` require the user to add `@.codex/cclaw-rules.md` to their AGENTS.md (or to root-level instructions).
- **OpenCode** — `./AGENTS.md` (project root) is auto-loaded; `.opencode/AGENTS.md` is also loaded as of PR #12096. Using `.opencode/cclaw-rules.md` keeps the file under cclaw's namespace and requires the user to add `@.opencode/cclaw-rules.md` to their AGENTS.md to avoid colliding with user-authored OpenCode rules.

**Deliverable 2 — content module** (`src/content/cclaw-rules.ts`; new file).

- Single source of truth for the harness-agnostic ambient rules body. Exports `CCLAW_RULES_MARKDOWN` (plain markdown for Claude / Codex / OpenCode) and `CCLAW_RULES_MDC` (the same body wrapped in Cursor's MDC frontmatter for `.cursor/rules/cclaw.mdc`).
- Sections (compact-content contract, ~42 lines rendered): Iron Laws (5 laws, sourced structurally from `IRON_LAWS` in `src/content/iron-laws.ts`) → top anti-rationalization categories (5 one-line summaries keyed by `SHARED_ANTI_RATIONALIZATIONS` category) → top antipatterns A-1..A-5 (one-line each; cross-referenced against `## A-N — Title` headings in `ANTIPATTERNS` via `extractAntipatternHeadings()`) → orientation paragraph naming `/cc <task description>` as the activation affordance → footer naming `.cclaw/lib/anti-rationalizations.md` and `.cclaw/lib/antipatterns.md` as the `/cc`-only full catalogs.
- Heavy content stays out of the ambient surface — full anti-rat rebuttals, A-1..A-7 full corrections, runbooks, specialist prompts, AC-trace commit-prefix enforcement all live in `.cclaw/lib/` and load only when `/cc` is invoked.

**Deliverable 3 — per-harness install logic** (`src/install.ts`).

- New `HarnessRulesLayout` interface on `HarnessLayout` (`path`, `format`, `autoLoad`, `activationHint`). Every harness layout gets a `rules` field naming its canonical path and activation contract.
- `writeHarnessAssets` writes the rules file at the harness-namespaced path: `.cursor/rules/cclaw.mdc` (MDC) / `.claude/cclaw-rules.md` / `.codex/cclaw-rules.md` / `.opencode/cclaw-rules.md` (plain markdown).
- Install emits one `Wrote harness rules` progress event per harness, with the auto-load / manual @-ref tag in the detail.
- Idempotent: re-running install overwrites the same path with the current content (the rules body is a projection of the cclaw catalogs, not user-editable on disk).
- `uninstallCclaw` removes the rules file from each enabled harness's path AND tidies an empty `.cursor/rules/` parent if cclaw was the sole inhabitant; the `.harness/` root directory survives because the user may keep other state there.

**Deliverable 4 — install summary surfaces per-harness activation** (`src/install.ts`, `src/cli.ts`).

- New exported helper `renderHarnessRulesGuidance(harnesses)` returns a multi-line block naming each installed harness with its native rules path and the action the user must take ("auto-load — no further action" for Cursor; "add `@.harness/cclaw-rules.md` to your CLAUDE.md / AGENTS.md" for the other three).
- The CLI install dispatcher (`dispatchInstallAction`) emits the block between the existing `renderSummary` counts table and the final `[cclaw] install complete.` line. Both the TUI menu and `--non-interactive install` paths flow through this dispatcher, so the message renders identically across surfaces.
- Every hint that names CLAUDE.md / AGENTS.md trails the explicit reminder "cclaw never writes CLAUDE.md / AGENTS.md" so the user knows the file is theirs to author.

**Deliverable 5 — tests** (`tests/unit/v855-harness-rules.test.ts`, new file; `scripts/smoke-init.mjs` extended).

- 38 new tripwires in `tests/unit/v855-harness-rules.test.ts`:
  - **Content module**: exports shape; ambient-rules heading; orientation paragraph names `/cc`; every Iron Law title present verbatim; Iron Laws heading (Karpathy); all 5 anti-rat category keys present as inline code; `ANTI_RAT_CATEGORY_SUMMARIES` covers the catalog exactly; antipatterns section heading; A-1..A-5 present; A-6 / A-7 NOT advertised as bullet items (range mention "A-1..A-7" in footer is allowed); both `/cc`-only catalog paths named; "How to activate" footer with `/cc <task description>`; body size within 20-160 line bracket.
  - **MDC variant**: starts with `---\n` fence; frontmatter carries `description:` and `alwaysApply: true`; post-frontmatter body is `CCLAW_RULES_MARKDOWN` verbatim; frontmatter omits `globs:` (rules are repo-wide).
  - **Cross-reference (no drift)**: `ANTIPATTERN_SUMMARIES` IDs are exactly A-1..A-5; every summary title matches the verbatim `## A-N — Title` heading in `ANTIPATTERNS`; rendered body includes each antipattern title verbatim.
  - **Per-harness install**: `HARNESS_LAYOUT_TABLE` carries `rules` for every supported harness with valid `path` / `format` / `autoLoad` / `activationHint`; Cursor uses MDC + auto-load at `.cursor/rules/cclaw.mdc`; the other three use plain markdown + manual @-ref at `.harness/cclaw-rules.md`; install writes the MDC body at `.cursor/rules/cclaw.mdc`; plain markdown at `.claude/`, `.codex/`, `.opencode/`; multi-harness install writes all four; idempotent install (re-run does not append); install NEVER creates project-root AGENTS.md / CLAUDE.md / GEMINI.md; install emits one progress event per harness rules file.
  - **Uninstall**: removes `.cursor/rules/cclaw.mdc`; removes empty `.cursor/rules/` parent dir; preserves user-authored sibling rules under `.cursor/rules/`; removes `.harness/cclaw-rules.md` for every enabled harness.
  - **Activation guidance**: empty string for zero harnesses; one hint per installed harness; Cursor hint names auto-load + the `.mdc` path; the other three hints name the `@`-reference target file; guidance carries the "cclaw never writes" reminder.
- `scripts/smoke-init.mjs` extended to assert `.cursor/rules/cclaw.mdc` exists on install, opens with `---\n`, carries `alwaysApply: true`, ships the Iron Laws section + `/cc <task description>` pointer; AND asserts uninstall removes both the file and the empty `.cursor/rules/` parent; AND the existing AGENTS.md / CLAUDE.md negative assertions now extend to GEMINI.md.
- Test count: 1077 → 1115 (+38 new tripwires; zero existing tests broken).

### Metrics

- **Files touched:** 6 modified, 2 new (`src/content/cclaw-rules.ts`, `tests/unit/v855-harness-rules.test.ts`).
- **Test count:** 1077 → 1115 (+38).
- **Rules body size:** ~42 lines rendered (compact-content contract; ambient surface is principles + `/cc` pointer, not duplicated heavy content).
- **Smoke green** end-to-end (init + idempotent install + uninstall) on the build.

### Migration

- Existing `.cclaw/` installs without rules files: the next `cclaw install` adds the per-harness rules file. No state to migrate; the rules body is a projection of the cclaw catalogs.
- Cursor: rules auto-load on next session start (`alwaysApply: true`); no user action required.
- Claude Code / Codex / OpenCode: install summary surfaces the one-line `@`-reference the user adds to their CLAUDE.md / AGENTS.md to activate ambient discipline. Until the user adds the reference, the harness still works exactly as before (silent no-op file on disk).
- Existing user-authored `.cursor/rules/*.mdc` sibling files: untouched. cclaw owns `.cursor/rules/cclaw.mdc` exclusively; any other `.mdc` in the directory survives install / uninstall.

### Constraints

- **No project-root file touched.** cclaw NEVER writes `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or any file at the project root. The user owns those.
- **Compact ambient surface.** The rules file carries only principles + `/cc` pointer. Heavy content (full anti-rat rebuttals, A-1..A-7 corrections, runbooks, specialist prompts) stays in `.cclaw/lib/` and loads only inside `/cc`.
- **Per-harness format flexibility.** Cursor takes MDC (the only auto-load surface among the four); the other three take plain markdown matching their `@`-reference loading contract.
- **Idempotency is the contract.** Re-running install overwrites the file rather than appending; the rules body is a projection, not a user-editable resource.

## 8.54.0 — consolidation pass: content cleanup + test slim + plan-critic gate widening + CI matrix simplification

### Why

Two audits (test redundancy + content footprint) flagged the same pattern: cclaw's prompt-content + test-suite surface had grown faster than its contract count, with redundant runbooks, zombie tests, and a CI matrix that no longer earns its keep after the v8.40 hooks removal. Rather than fragment the cleanup into many slugs, v8.54 lands one coherent consolidation pass with four deliverables that share a single theme — **make cclaw leaner without dropping coverage of contracts**.

A fifth driver: references (chachamaru's `plan_critic` Phase 0, gsd-v1's plan-checker) run plan-critic-style passes wider than cclaw. Pre-v8.54 cclaw's plan-critic gate (`complexity == "large-risky"`) was the narrowest in the reference cohort and under-fired on strict small-medium flows. v8.54 widens the gate to match the reference cohort while keeping trivial flows skipped.

### What changed

**Deliverable 1 — content consolidation** (`src/content/runbooks-on-demand.ts`, `src/content/stage-playbooks.ts`, `src/content/start-command.ts`, `src/content/specialist-prompts/plan-critic.ts`, `src/content/meta-skill.ts`, `src/install.ts`, `scripts/smoke-init.mjs`):

- **Merged `critic-stage.md` + `plan-critic-stage.md` → `critic-steps.md`.** Two runbooks that shared dispatch envelope and falsificationist pass shape are now one runbook with two sections: `## Pre-implementation pass (plan-critic, v8.51)` and `## Post-implementation pass (critic, v8.42)`. Shared content (predictions pattern, anti-rationalization pointer, iteration cap, slim summary format) lifts to top-level prose.
- **Merged `self-review-gate.md` + `ship-gate.md` → `handoff-gates.md`.** Two pre-handoff inspection gates fold into one runbook with sections `## Pre-reviewer dispatch gate (self-review)` and `## Pre-ship dispatch gate (ship-gate)`.
- **Lifted `discovery.md` + `plan-small-medium.md` into `PLAN_PLAYBOOK`.** Both plan-stage helpers for different complexity tiers now live as `## Path: small/medium` and `## Path: large-risky` sections inside the existing `plan` stage playbook. The two on-demand runbooks are retired; references in `start-command.ts` point at the stage playbook.
- **Retired dead directories.** `src/content/research-playbooks.ts` and `src/content/recovery.ts` exported empty arrays since v8.12 (no specialist or runbook consumer). Both source files are deleted; `RETIRED_LIB_DIRS` adds `research` and `recovery` so install upgrade removes the empty `.cclaw/lib/research/` and `.cclaw/lib/recovery/` directories from legacy projects.
- **Gated `decisions.md` template install behind `config.legacyArtifacts`.** v8.14+ flows inline D-N rows into `plan.md`; `decisions.md` was dead bytes on every fresh install. The artifact template now writes only when `config.legacyArtifacts == true`.
- **Tracked retired runbook filenames in `RETIRED_RUNBOOK_FILES`** so the orphan-cleanup pass removes the six retired runbook files from legacy `.cclaw/lib/runbooks/` directories on the next `cclaw sync` / install upgrade.

**Deliverable 2 — test slim aggressive** (`tests/unit/**`, `tests/helpers/counts.ts`, `tests/unit/retired-tokens.test.ts`):

- **Deleted zombie file `tests/unit/h4-content-depth.test.ts`** (-18 tests). All assertions were tied to v7-era ceremony retired in v8.14 (9 months prior); positive assertions duplicated in v8.46 / v8.47 tests.
- **Deleted `tests/unit/research-recovery-antipatterns.test.ts`** (tied to retired directories from deliverable 1).
- **Consolidated retired-tokens sweep into `tests/unit/retired-tokens.test.ts`.** The duplicate `.not.toContain("commit-helper")` / `.not.toContain("--phase=")` assertions previously scattered across `v840-cleanup`, `v823-no-git-fallback`, `tdd-cycle`, `stage-playbooks`, `specialist-prompts`, `skills`, etc. now live in a single parameterized sweep over every shipped LLM-facing surface (skills, specialists, runbooks, playbooks, agents, antipatterns, artifact templates, start-command). One entry in `RETIRED_TOKENS` extends the sweep automatically.
- **Lifted hardcoded counts to `tests/helpers/counts.ts`.** `COUNTS.specialists`, `COUNTS.agents`, `COUNTS.skills`, `COUNTS.postures`, `COUNTS.outcomeSignals`, `COUNTS.flowStages`, `COUNTS.harnesses`, `COUNTS.surfaces` are derived from the structural source-of-truth arrays in `src/types.ts` etc. Tests that previously asserted `length === 8` now assert `length === COUNTS.specialists`, removing the per-slug count-edit friction.
- **Aggressively slimmed recent vNN-files** to "1-2 anchors per contract, not per sentence":
  - `v8.52-qa-and-browser` 132 → 23 tests
  - `v8.53-critic-enhancements` 72 → 11 tests
  - `v8.51-plan-critic` 76 → 25 tests (already in earlier pass)
  - `v8.48-discipline-skills` 61 → 10 tests
  - `v8.47-design-phases-collapse` 32 → 12 tests (already in earlier pass)
  - `v8.88-cleanup` 38 → 6 tests
  - `v8.28-rename-planner-to-ac-author` 21 → 5 tests
  - `v8.13-cleanup` 32 → 13 tests
  - `v8.14-cleanup` 15 → 3 tests
  - `v8.11-cleanup` 22 → 4 tests
- **Net suite reduction: 1492 → 1077 tests (-415).**

**Deliverable 3 — plan-critic gate widening** (`src/content/start-command.ts`, `src/content/specialist-prompts/plan-critic.ts`, `src/content/runbooks-on-demand.ts` > `critic-steps.md`):

- Pre-v8.54 gate: `acMode == "strict"` AND `triage.complexity == "large-risky"` AND `triage.problemType != "refines"` AND AC count ≥ 2.
- **v8.54 gate**: `acMode == "strict"` AND `triage.complexity != "trivial"` AND `triage.problemType != "refines"` AND AC count ≥ 2.
- Rationale: chachamaru's `plan_critic` runs on every Phase 0; gsd-v1's plan-checker runs across complexity tiers. cclaw's prior `complexity == "large-risky"` requirement was the narrowest in the reference cohort and under-fired on strict small-medium flows. Trivial flows still skipped (no plan to critique).

**Deliverable 4 — CI matrix simplification** (`.github/workflows/ci.yml`):

- Pre-v8.54 matrix: `[ubuntu-latest, windows-latest, macos-latest] × [20.x, 22.x]` = 6 matrix runs (with macOS and Windows pinned to 20.x only, so 4 effective).
- **v8.54 matrix**: `ubuntu-latest × 20.x` + `windows-latest × 20.x` = 2 jobs.
- Rationale: hooks were retired in v8.40. The remaining platform-sensitive surface is path resolution (Windows backslashes), filesystem ops, and process spawn. Linux Node 20 covers 90% of users; Windows Node 20 catches the path-portability failures we've hit twice on the roadmap. macOS and Node 22 dropped — re-adding them requires a deliberate decision documented in this changelog.

### Metrics

- **Files touched:** 35 modified, 3 new (`tests/unit/v854-consolidation-pass.test.ts`, `tests/unit/retired-tokens.test.ts`, `tests/helpers/counts.ts`).
- **Test count:** 1492 → 1077 tests (-415, -28%).
- **Runbook count:** 19 → 11 on-demand runbooks (`-4` from consolidation + retirement, `-4` from lifts to PLAN_PLAYBOOK).
- **CI run-time:** halved (4 jobs → 2 jobs on matrix; the one-shot stages — coverage, audit, smoke, release-bundle — are unchanged).
- **Behavior tests preserved:** every Band A test (flow-state, knowledge-store, install, cli, harness-prompt, outcome-detection, compound) is green and unchanged.
- **Smoke green** end-to-end (init + sync + upgrade + uninstall) on the build.

### Migration

- Existing `.cclaw/` directories with old runbook filenames (`critic-stage.md`, `plan-critic-stage.md`, `self-review-gate.md`, `ship-gate.md`, `discovery.md`, `plan-small-medium.md`): `RETIRED_RUNBOOK_FILES` causes them to be removed on the next `cclaw sync` / install upgrade pass.
- Existing `.cclaw/lib/research/` and `.cclaw/lib/recovery/` directories: `RETIRED_LIB_DIRS` causes them to be removed on the same pass.
- Existing `decisions.md` artifact templates installed under fresh projects: unaffected (the template only stopped being written for NEW installs; the file on disk is untouched).
- Strict small-medium flows with ≥2 ACs: now trigger plan-critic where they previously did not. Iteration cap (1 revise loop max) is unchanged. The picker arms when revise iteration 1 fires are unchanged.
- CI: any branch protection rules referencing the dropped `Build and Test (macOS Node 20.x)` or `Build and Test (Node 22.x)` checks must be updated to reference only the kept checks.

### Constraints

- **CI simplification is one-way** — once the matrix shrinks, re-adding macOS / Node 22 requires an explicit decision documented here.
- **Anatomical tripwires preserved** — `posture-table-consistency`, skills anatomy (v8.26), iron-laws set, specialist-prompts shape all kept.
- **No bundling with rules surface** — that's v8.55+ scope (requires per-harness path design).

## 8.53.0 — critic enhancements: multi-perspective lenses + design ambiguity score (closes the v8.48-v8.53 roadmap)

### Why

The cross-reference flow audit that opened the v8.48-v8.53 sequence flagged two adjacent gaps in cclaw's discovery + review surfaces. Both are **additive refinements to existing specialists** (critic + design), not new stages — each closes a finding-class today's prompts cannot surface.

**Finding 1 — multi-perspective lenses (OMC's critic).** The v8.42 critic specialist absorbed compound's *adversarial technique* scaffold (assumption violation / composition failures / cascade construction / abuse cases) but never the *human-perspective lens* set. The four techniques find structural failure modes; the lenses find concrete reader-shoe gaps the techniques miss. Most-cited example: the **new-hire lens** ("I'm starting on this codebase tomorrow — can I understand this change without context?") catches "self-documenting variable name", "magic constant without inline cite", "function name doesn't describe what it does" — none of which the four techniques find because they're not about structural composition or assumption violation, they're about cognitive load on a fresh reader. cclaw's critic was silent on this class. v8.53 adds **six concrete reader-shoes** to §3 adversarial mode: three for plan-stage critique (executor / stakeholder / skeptic) and three for code-stage critique (security / new-hire / ops). Lenses are **gated to adversarial mode only** and the contract requires **≥3 lens findings** when the sweep runs.

**Finding 2 — ambiguity score (OMC's deep-interview rubric).** The v8.47 design specialist's Phase 7 picker (`approve` / `request-changes` / `reject`) has no signal about whether the design **as composed** is actually clear. The user might approve a fuzzy design without realising it's fuzzy — "let's improve search performance" reads concrete but is genuinely under-specified (which surface? which budget? which workload?). OMC's deep-interview rubric handles this with a weighted-dimension ambiguity score; the score surfaces a soft warning when the composite exceeds a threshold so the user sees the fuzz before approving. v8.53 ports the rubric into design Phase 6: **3 dimensions on greenfield** (goal / constraints / success) **or 4 dimensions on brownfield** (+ context — does the design ground itself in prior shipped slugs with concrete citations?). Composite is persisted to `plan.md` frontmatter alongside per-dimension scores; Phase 7 prefixes a **soft warning** (NEVER a hard gate) when the composite exceeds the threshold. Threshold default `0.2`, configurable via `.cclaw/config.yaml > design.ambiguity_threshold`.

Both items ship in **the same release** because both are additive refinements (no new stages, no new specialists, no orchestrator routing changes) and both close audit findings from the same OMC corpus. This release **CLOSES the v8.48-v8.53 roadmap**.

### What changed

**Item #1 — critic §3 human-perspective lens sweep** (`src/content/specialist-prompts/critic.ts`).

- New sub-section `### Human-perspective lenses (adversarial mode only)` inserted into §3 (Adversarial findings), AFTER the existing §3a-§3d technique blocks (assumption violation / composition failures / cascade construction / abuse cases). Lenses are **additive**, not a replacement — §3a-§3d still run as before in adversarial mode, with the lens sweep on top.
- Six lenses, split into two sets by the slug's primary artifact: plan-stage lenses fire when critiquing plan.md (executor / stakeholder / skeptic — each defined by a verbatim reader-shoe sentence in the prompt body); code-stage lenses fire when critiquing build.md + diff (security / new-hire / ops — same verbatim-shoe pattern).
- Output contract: critic.md MUST include findings from **at least 3 lenses** in adversarial mode. Findings ride the existing F-N numbering; the new findings table shape inserts a `Lens` column and uses the axis tag format `human-perspective:<lens>` (e.g. `human-perspective:new-hire`) so downstream readers — compound learning capture, ship.md Risks-carried-over — can filter by lens.
- Gating: lenses run in `adversarial` mode only. In `gap` mode (acMode soft / strict-without-trigger), §3 stays skipped end-to-end and the lens sweep does NOT run. Lenses do NOT activate adversarial mode independently — they ride the existing §8 trigger set. In `light` adversarial mode (soft + exactly one trigger fired), the lens sweep is capped at 3 lenses regardless of slug shape, mirroring the "ONE technique only" rule §3a-§3d already used.
- Token budget §3 sub-allowance bumped by ~2k (from ~6-8k to ~8-10k within the unchanged 12-18k overall mode cap and unchanged 20k hard cap). The bump is documented inline in the prompt's `## Token budget` section.
- Two v8.53 anti-rationalization rows added to the critic-specific anti-rat table (row count `8 → 10`): "I covered new-hire concerns in §1 already — no need to run the new-hire lens" (rebuttal: §1 is pre-commitment structural prediction, lenses are lens-based investigation — different surfaces, different finding classes) and "Security is the security-reviewer's job, not mine — skip the security lens" (rebuttal: the critic's security lens is a smoke check that cross-references security-reviewer; if your lens surfaces a NEW class of risk the threat-model checklist didn't enumerate, emit it as F-N — do NOT defer because "someone else owns this lane"). Cross-cutting rationalizations continue to reference `.cclaw/lib/anti-rationalizations.md` (v8.49 catalog).

**Item #2 — design Phase 6 ambiguity score + Phase 7 warning prefix** (`src/content/specialist-prompts/design.ts`).

- New sub-section `#### Ambiguity score (v8.53; computed at end of Phase 6, before Phase 6.5 or Phase 7)` inserted into Phase 6 (Compose + self-review), AFTER the 9-rule self-review checklist and BEFORE Phase 6.5 (ADR proposal). The sub-section runs SILENTLY in the same orchestrator turn — Phase 6's `[SILENT]` marker covers it.
- Scoring rubric: 3 dimensions on greenfield (Goal clarity weight `0.4` / Constraints clarity weight `0.3` / Success criteria clarity weight `0.3` — weights sum to `1.0`); 4 dimensions on brownfield (Goal `0.35` / Constraints `0.25` / Success `0.25` / Context `0.15` — weights sum to `1.0`). Each dimension scored `0.0` (perfectly clear) to `1.0` (entirely fuzzy); composite = weighted sum, clamped to `[0.0, 1.0]`, rounded to 2 decimal places. Brownfield is detected when `triage.problemType == "refines"` OR plan.md frontmatter `refines` is non-null.
- Each dimension's rubric is anchored to concrete plan.md content: Goal clarity reads `## Spec > Objective` and `## Frame` lead clause; Constraints clarity reads `## Spec > Boundaries`; Success criteria clarity reads `## Spec > Success`; Context clarity (brownfield only) reads Frame + Decision rationales for prior-slug citations.
- Composite + per-dimension breakdown + threshold persisted to `plan.md` frontmatter:
  - `ambiguity_score: 0.18` (composite)
  - `ambiguity_dimensions: { goal: 0.1, constraints: 0.2, success: 0.25 }` (greenfield) or `{ goal: 0.1, constraints: 0.2, success: 0.25, context: 0.4 }` (brownfield)
  - `ambiguity_threshold: 0.2` (resolved threshold the picker compared against)
- Phase 7 picker warning prefix (v8.53; soft signal). When `ambiguity_score > ambiguity_threshold`, the Phase 7 picker is prefixed with a verbatim warning line: `⚠ Composite ambiguity <score> exceeds threshold <threshold> — request-changes recommended for: <dimensions with per-dim score > 0.3, comma-separated>. This is informational; you can still approve below.`. The warning is **informational, never a hard gate** — the user can pick `approve` regardless. When no individual dimension exceeds `0.3` (composite cleared the threshold via several middling scores), the message reads `request-changes recommended for: composite (no single dimension above 0.3)` so the user sees structural shape rather than an empty list.
- Threshold default `0.2`; configurable via `.cclaw/config.yaml > design.ambiguity_threshold`. Out-of-range values (NaN, ±Infinity, < 0.0, > 1.0, non-numeric) silently fall back to `0.2`, and design Phase 6 emits a one-line note in `plan.md > ## Open questions` to keep the misconfig auditable.

**Item #3 — plan.md template carries the ambiguity frontmatter fields** (`src/content/artifact-templates.ts`).

- `PLAN_TEMPLATE` frontmatter block (the strict-mode template) gains three new keys: `ambiguity_score: null`, `ambiguity_dimensions: null`, `ambiguity_threshold: null`. The placeholder values mirror the pre-existing `feasibility_stamp: null` pattern (field declared, value `null` until the dispatching specialist fills it). The block carries an inline v8.53 comment naming both the greenfield (3-dim) and brownfield (4-dim) shapes so a reader knows what to expect.
- Backwards compat: legacy plan.md files authored before v8.53 do not carry these keys. The frontmatter parser (`src/artifact-frontmatter.ts`) uses an open-shape interface (`[key: string]: unknown`), so absent keys validate cleanly. Readers (Phase 7 picker / ac-author / reviewer) treat absent `ambiguity_score` as `"unknown"` and skip the threshold comparison; the picker fires with NO warning prefix in that case. Only NEW design sessions emit the score.

**Item #4 — config schema + helper function** (`src/config.ts`).

- New optional `design?: DesignConfig` block on `CclawConfig`. `DesignConfig` carries a single field today (`ambiguity_threshold?: number`) shaped to accept future design-phase knobs without churning the top-level config schema.
- New exported const `DEFAULT_AMBIGUITY_THRESHOLD = 0.2`.
- New exported helper `ambiguityThresholdOf(config)` returns the configured threshold with the documented fallback. Returns `0.2` when: config is null/undefined, `design` block is missing, `ambiguity_threshold` is absent, the configured value is NaN / ±Infinity, or the configured value is outside `[0.0, 1.0]`. The orchestrator and design Phase 6 read through this helper so the fallback policy lives in one place.

### Metrics

- **Files touched:** 6 modified, 1 new (`tests/unit/v853-critic-enhancements.test.ts`). The critic.ts prompt body grew ~5400 chars (lens sub-section + 2 anti-rat rows + token-budget bump documentation); the design.ts prompt body grew ~5800 chars (Phase 6 ambiguity score sub-section + Phase 7 warning-prefix block). All new content lives in the in-memory dispatch envelope; no new install-time assets.
- **Tests added:** 72 tripwires in `tests/unit/v853-critic-enhancements.test.ts` (6 critic §3 lens sub-section, 4 lens output contract, 3 lens sweep gating, 4 critic token budget bump, 5 critic anti-rationalization rows, 11 design Phase 6 ambiguity score calculation, 4 ambiguity score persistence, 6 Phase 7 picker warning logic, 2 configurable threshold, 12 config helper + DEFAULT constant, 8 plan.md template, 4 backwards compat, 5 cross-deliverable invariants). Total suite 1420 → 1492 tests, all green. Smoke green.
- **Body-budget cost:** design per-prompt budget bumped `460 → 470` lines and `42000 → 47000` chars (~12% relative bump, leaving ~4% headroom over the 45061-char actual). The critic prompt has no per-prompt budget in `prompt-budgets.test.ts`; the critic-specialist.test.ts 200-700 LOC bound continues to apply and the new prompt is ~375 lines (well within). No start-command body changes; the v8.53 surface area is entirely contained in the two specialist prompts + the template + the config helper.
- **Gate selectivity:** lenses fire only in `adversarial` mode (already a tight gate per the §8 trigger set); ambiguity score is computed on every large-risky design Phase 6 run BUT the Phase 7 warning fires only when `composite > threshold` (default `0.2`). Both deliverables are **OFF by default** for the common path: a clear design (composite ≤ 0.2) sees no warning; a slug whose review didn't trip any §8 trigger sees no adversarial mode and no lens sweep.

### Files touched

- `src/content/specialist-prompts/critic.ts` — adds the `### Human-perspective lenses (adversarial mode only)` sub-section under §3 (~3500 chars), bumps the §3 token sub-allowance documentation in `## Token budget`, adds two v8.53 anti-rat rows (new-hire / security-as-not-my-job) growing the critic-specific table from 8 → 10 rows.
- `src/content/specialist-prompts/design.ts` — adds the `#### Ambiguity score (v8.53; ...)` sub-section under Phase 6 (~4000 chars with the 3-dim greenfield + 4-dim brownfield rubric, weighted-sum formula, frontmatter emission shape, threshold lookup contract), adds the `Ambiguity warning prefix (v8.53; soft signal)` block to Phase 7 with the warning-prefix logic and the "informational, not a hard gate" guarantee.
- `src/content/artifact-templates.ts` — adds `ambiguity_score`, `ambiguity_dimensions`, `ambiguity_threshold` frontmatter keys (all `null` placeholders) to `PLAN_TEMPLATE` with a v8.53 introducing-release comment naming the greenfield / brownfield shapes.
- `src/config.ts` — adds the optional `design?: DesignConfig` block on `CclawConfig`, the `DEFAULT_AMBIGUITY_THRESHOLD` const, and the `ambiguityThresholdOf(config)` helper with the documented out-of-range fallback policy.
- `tests/unit/v853-critic-enhancements.test.ts` (**new**) — 72 tripwires pinning the contract of both deliverables: lens sub-section presence, all 6 lens names, plan-stage vs code-stage lens-set grouping, ≥3 lens findings requirement, axis tag format, F-N table shape with Lens column, light-adversarial cap, §3a-§3d preserved, v8.53 token-budget bump documentation, hard cap unchanged, anti-rat rows present + row count grew 8 → 10, ambiguity score sub-section header + v8.53 anchor, 0.0-1.0 range semantics, greenfield 3-dim + brownfield 4-dim rubric with weights, brownfield detection signal, weighted-sum formula, clamping + rounding, weights sum to 1.0 on both shapes, frontmatter persistence + all 3 keys + per-dim breakdown shape, brownfield-only `context` key, Phase 7 warning-prefix logic + "informational, not a hard gate", `request-changes recommended for` format, 0.3 per-dim visibility cutoff, empty-dimensions edge case, three-option picker preserved, configurable threshold path + default + out-of-range fallback, DEFAULT_AMBIGUITY_THRESHOLD const + ambiguityThresholdOf 8 fallback cases, plan.md template fields + null placeholders + v8.53 comment + YAML validity, backwards compat for legacy plans, cross-deliverable invariants (zero new specialists, zero new stages, both cite v8.53).
- `tests/unit/prompt-budgets.test.ts` — design per-prompt budget bump `460/42000 → 470/47000` chars with the v8.53 bump rationale documented in the inline comment.
- `CHANGELOG.md` — this entry.
- `package.json` — version bump `8.52.0 → 8.53.0`.

### Backwards compatibility

- **Pre-v8.53 `plan.md` files lack the `ambiguity_score` / `ambiguity_dimensions` / `ambiguity_threshold` frontmatter keys.** The frontmatter parser (`src/artifact-frontmatter.ts`) uses an open-shape interface (`ArtifactFrontmatter` has `[key: string]: unknown`), so absent keys validate cleanly. The Phase 7 picker treats absent values as `"unknown"` and fires the standard three-option picker with NO warning prefix; ac-author / reviewer / ship-stage readers similarly treat absence as a no-op signal.
- **Pre-v8.53 `.cclaw/config.yaml` files lack the `design.ambiguity_threshold` config key.** The new `ambiguityThresholdOf(config)` helper returns `0.2` (the documented default) when the field is absent; design Phase 6 reads through the helper so the fallback policy is uniform. No migration is required.
- **The v8.42 critic specialist's `gap` mode behaviour is unchanged in v8.53.** The lens sweep runs ONLY in `adversarial` mode; on the common path (acMode soft / strict with no §8 trigger firing), the critic prompt body is functionally identical to v8.52 — same §1-§8 sections, same severity vocabulary (`block-ship` / `iterate` / `fyi`), same verdict enum (`pass` / `iterate` / `block-ship`), same slim-summary shape.
- **The v8.47 design specialist's 2-turn pacing is unchanged in v8.53.** The ambiguity score sub-section is silent (runs inside the existing Phase 6 silent turn alongside the 9-rule self-review checklist); the Phase 7 warning prefix is a STRING addition to the existing structured-ask emission, not a new user pause. A v8.47 design flow with a clear composite (≤ 0.2) sees zero v8.53-visible changes.

### Constraints honoured

- **Lenses are additive to §3, not a new section.** §3a (Assumption violation), §3b (Composition failures), §3c (Cascade construction), §3d (Abuse cases) all stay in critic.ts verbatim; the lens sub-section is the fifth block.
- **Lenses are adversarial-only.** Gap mode never runs the lens sweep, gap-mode token budget is unchanged, gap-mode slim summary is unchanged.
- **Ambiguity score is a soft signal, never a hard gate.** The Phase 7 picker emits the same three options (`approve` / `request-changes` / `reject`) regardless of the composite; the warning prefix is informational text.
- **Backwards compat preserved.** Both items are no-ops on legacy plans / pre-v8.53 config files.
- **No bundling with future slugs — v8.53 CLOSES the v8.48-v8.53 roadmap.** The next release picks up a new audit class; nothing in v8.53's body anchors a "next slug in this thread" expectation.
- **Anti-rationalization rows reference the v8.49 catalog for cross-cutting concerns.** Only the two v8.53 critic-specific dodges (new-hire / security-as-not-my-job) land inline in critic.ts.
- **UTF-16BE fix applied.** The `tests/unit/v853-critic-enhancements.test.ts` file was written via the Write tool, which (on this environment) emits UTF-16BE; the file was iconv-converted to UTF-8 before commit so esbuild can parse it. Same fix pattern as prior slugs.

## 8.52.0 — qa-and-browser stage for UI surfaces (closes the behavioural-QA gap)

### Why

cclaw's existing reviewer scores the **diff**: AC↔commit traceability, edit-discipline, test-quality, complexity-budget, security, perf, and so on. For CLI / library / API / data / infra / docs work, that is the right surface — there is nothing to "run" beyond the test suite, and the diff carries every consequential change. **For UI / web work, the diff is the wrong surface.** A plan AC says "user clicks Submit and sees a toast"; the diff shows a `useToast()` hook added to `InviteForm.tsx`; the reviewer signs off on the change; the page ships with a runtime error nobody caught because nobody rendered it. The gap is structural — no specialist in the pre-v8.52 flow opens the running app.

The cross-reference audit that motivated v8.52 found two patterns elsewhere that close exactly this gap. **gstack** has `/qa` — a browser-driven QA stage that verifies behavioural specs against the rendered page (Playwright + screenshots). **affaan-m-ecc** has the Santa Loop — continuous iteration on UI bugs surfaced by browser-driven testing. cclaw v8.52 adds an **optional**, **gated** `qa` stage that runs the new `qa-runner` specialist between `build` and `review` on slugs whose `triage.surfaces` includes `"ui"` or `"web"` AND whose `acMode != "inline"`. The specialist uses whatever browser tooling the harness exposes (Playwright > browser-MCP > manual screenshots), captures per-AC evidence in `qa.md`, and emits a verdict the orchestrator routes on. The reviewer's new v8.52 `qa-evidence` axis (the 9th explicit axis, 10th with the gated `nfr-compliance`) cross-checks the artifact against the diff so a `pass` verdict with `Status: fail` rows or a silent tier downgrade fires `required` findings.

The stage is **structurally skipped** on every slug shape that does not benefit from it — CLI / library / API / data / infra / docs slugs see no `qa` token in `triage.path` and no qa-runner dispatch, preserving pre-v8.52 behaviour verbatim.

### What changed

**Item #1 — new specialist `qa-runner`** (`src/content/specialist-prompts/qa-runner.ts`, ~265 lines).

- Activation: `on-demand`. Single mode: `browser-verify` (no `debug` / `fix-only` split — debug-and-browser owns live-system diagnostic discipline; slice-builder owns all production fixes). Tools: Read + Write (`qa.md` + `tests/e2e/<slug>-<ac>.spec.ts` + screenshots under `flows/<slug>/qa-assets/`) + Bash (for test execution) + browser-* MCP tools when available. Token budget: 5-8k target, 10k hard cap.
- Body structure: Iron Law ("EVIDENCE FROM THE RENDERED PAGE ONLY"), `When to run` / `When NOT to run` blocks mirroring the gate verbatim, acMode-awareness (defensive — the gate restricts to non-inline), posture-awareness (`test-first` / `characterization-first` / `tests-as-deliverable` / `bootstrap`), 7-section investigation protocol (§1 Surfaces under QA / §2 Browser tool detection / §3 Pre-commitment predictions (3-5, BEFORE §4) / §4 Per-AC evidence / §5 Findings / §6 Verdict / §7 Hand-off), three-tier browser hierarchy (Tier 1 Playwright > Tier 2 browser-MCP > Tier 3 manual steps; record picked tier in `qa.md > frontmatter > evidence_tier`; silent downgrade fires reviewer `qa-evidence` axis), verdict semantics (`pass` / `iterate` / `blocked`), qa-runner-specific anti-rationalization rows (visual-check / playwright-overkill / css-cant-break / post-hoc-prediction) plus `verification` + `completion` rows referenced from the shared catalog.
- Output: exactly one artifact, `flows/<slug>/qa.md`, single-shot per dispatch (overwrites on re-dispatch, never appends). Returns a slim summary (≤7 lines) with `specialist: qa-runner`, `verdict`, `evidence_tier`, `ui_acs` breakdown, `iteration`, `confidence`, optional `notes`.
- Composition footer: declares qa-runner as `on-demand specialist`, names the `Do not spawn` lanes (no design / ac-author / plan-critic / reviewer / security-reviewer / slice-builder / critic / research-helper dispatches; orchestrator routes verdicts, qa-runner does not), names the `Stop condition` (file written + verdict frontmatter set + slim summary returned).
- The prompt explicitly names the **separation from `debug-and-browser`** — both touch browser tooling, but `debug-and-browser` is **diagnostic** discipline (stop-the-line ranked hypotheses on a broken system) and `qa-and-browser` is **acceptance** discipline (per-UI-AC evidence after a green build). The two ship as **sibling skills**, not a refactor.

**Item #2 — new skill `qa-and-browser.md`** (`src/content/skills/qa-and-browser.md`, ~140 lines).

- Registered in `AUTO_TRIGGER_SKILLS` with stages `["build", "qa", "review"]` and triggers covering `stage:qa`, `specialist:qa-runner`, `triage.surfaces:ui`, `triage.surfaces:web`, `ac_mode:strict|soft`, `touch-surface:ui`, `diff:tsx|jsx|vue|svelte|html|css`, `specialist:slice-builder`, `specialist:reviewer`. The skill fires on the build stage so the slice-builder is encouraged to commit a Playwright spec alongside the AC implementation; on the qa stage so qa-runner reads the full discipline; on review so the reviewer's `qa-evidence` axis re-reads the contract.
- Body declares: when to apply (stage = qa OR triage.surfaces ∩ {ui, web} ≠ ∅), when NOT to apply (CLI / library / API / data / infra / docs surfaces; inline acMode; pure-prose / docs-only diffs; `refines` slugs whose parent shipped with `qa.md > verdict: pass`; stop-the-line debugging mid-build — that's debug-and-browser's domain). Three-tier browser hierarchy with detection signals, pass criteria, and the canonical silent-downgrade prohibition. Evidence-required rubric (one per UI AC). Pre-commitment predictions before verification (3-5, mirrors plan-critic §6 + post-impl critic §1). Cite-not-duplicate references to `.cclaw/lib/anti-rationalizations.md` for cross-cutting rows; five qa-specific anti-rationalization rows that stay in the skill body. qa-runner artifact contract (7 sections). Verdict semantics. Composition (slice-builder reads for build-time encouragement; qa-runner reads for full discipline; reviewer reads for axis evaluation).
- Distinct from `debug-and-browser.md` (audit decision documented in the body header): the two are siblings, not a split; `debug-and-browser.md` keeps its v8.x content verbatim.

**Item #3 — new artifact template `qa.md`** (`src/content/artifact-templates.ts`, ~470 lines).

- Registered in `ARTIFACT_TEMPLATES` with `id: "qa"`, `fileName: "qa.md"`. Frontmatter fields: `slug`, `stage: qa`, `status: active`, `specialist: qa-runner`, `dispatched_at`, `iteration` (0 or 1), `surfaces` (copied from `triage.surfaces`), `evidence_tier` (playwright | browser-mcp | manual | pending), `ui_acs_total/pass/fail/pending`, `predictions_made`, `findings`, `verdict` (pending | pass | iterate | blocked), `token_budget_used`.
- Body sections: §1 Surfaces under QA (with optional `Out of scope (non-UI ACs)` block for mixed slugs) / §2 Browser tool detection (with the three-tier table + selected-tier rationale) / §3 Pre-commitment predictions (3-5 row table with Outcome column for confirmed / refuted / partial) / §4 Per-AC evidence (one block per UI AC with Surface / Verification / Evidence / Status rows; example evidence blocks for each tier — Playwright stdout / browser-MCP screenshots+observations / manual numbered steps) / §5 Findings (F-N table with Severity / AC / What failed / Recommended fix / Status; required / fyi vocabulary mirroring the reviewer's) / §6 Verdict (verdict + evidence_tier + Predictions counts + UI ACs counts + Findings counts + Iteration + Confidence + Confidence rationale) / §7 Hand-off (for iterate: cite each required finding by F-N + AC + recommended fix; for blocked: cite the picker arm + manual step the user must run; for pass: explicit "No hand-off required; proceed to review.") / Summary (Changes made / Things noticed but didn't touch / Potential concerns — mirrors the three-block pattern from existing critic + plan-critic templates).

**Item #4 — orchestrator integration** (`src/content/start-command.ts`, ~7k chars / ~20 lines net).

- Hop 2 triage surface-detection guidance — a new block listing the `Surface` vocabulary (`cli`, `library`, `api`, `ui`, `web`, `data`, `infra`, `docs`, `other`) plus keyword + file-pattern heuristics for each. The orchestrator writes the detected list verbatim to `triage.surfaces` during the same Hop 2 write that stamps `complexity` and `acMode`; the value is immutable for the lifetime of the flow (same immutability story as the other triage fields). When no signal fires, the orchestrator writes `["other"]` rather than an empty array so the qa-gate has a concrete value to evaluate.
- `triage.path` conditional `qa` token insertion — when `triage.surfaces ∩ {"ui", "web"} ≠ ∅` AND `triage.acMode != "inline"`, the orchestrator MUST insert `"qa"` between `"build"` and `"review"` in the path, yielding e.g. `["plan", "build", "qa", "review", "critic", "ship"]`. On any other surface combination (or on inline mode), the path stays pre-v8.52 verbatim; `"qa"` is structurally absent and the orchestrator advances `build → review` as before. Pre-v8.52 state files (whose `path` cannot contain `"qa"` because the stage did not exist) validate unchanged.
- `qa` stage entry in `FLOW_STAGES` — the const array grew from 5 stages (`plan`, `build`, `review`, `critic`, `ship`) to 6 (`plan`, `build`, `qa`, `review`, `critic`, `ship`). The `currentStage` validator accepts `"qa"` as a value; the stage-to-artifact map (`ARTIFACT_FILE_NAMES`) maps `"qa"` to `"qa.md"`.
- New `#### qa (v8.52+, optional UI-surface stage)` body section — pointer-style; declares the specialist, the surface gate, the inputs (read-only), the three-tier evidence hierarchy, the slim-summary shape, and lifts the full procedure (dispatch envelope, verdict routing, iteration cap, flow-state patches, reviewer cross-check, legacy migration) into `.cclaw/lib/runbooks/qa-stage.md`. The stage-to-specialist table grew by one row for the qa-runner / browser-verify / qa-and-browser mapping.
- `qa-runner` added to the `lastSpecialist` enum surface so resume reads it; the `SPECIALISTS` const array grew from 7 to 8.

**Item #5 — runbook `qa-stage.md`** (`src/content/runbooks-on-demand.ts`, ~10k chars).

- New on-demand runbook that the orchestrator opens on every `slice-builder` GREEN slim-summary return when the v8.52 surface gate evaluates to true. Documents the 3-AND gate (`triage.surfaces ∩ {ui, web} ≠ ∅` AND `triage.acMode != "inline"` AND `qaIteration < 1`), the dispatch envelope (required reads, inputs, output contract, forbidden actions), the verdict-handling routing table (verdict × iteration → orchestrator action), iteration cap enforcement (1 iterate loop max), `flow-state.json` patches (`currentStage` / `lastSpecialist` / `qaIteration` / `qaVerdict` / `qaEvidenceTier` / `qaDispatchedAt`), the reviewer cross-check via the `qa-evidence` axis (the 9th explicit axis, 10th with gated `nfr-compliance`), what qa-runner CANNOT do (read-only on production source; no production-code fixes; no other specialist dispatches; no silent Playwright install; no fake-pass when verification could not run), and the legacy migration for pre-v8.52 state files (a state with `currentStage: "build"` AND `lastSpecialist: "slice-builder"` AND no `qaVerdict` is treated as pre-qa intermediate; on the next `/cc`, if the slug satisfies the gate, the orchestrator dispatches qa-runner before advancing to reviewer).
- Distinct from `critic-stage.md` (v8.42, post-implementation Hop 4.5) and `plan-critic-stage.md` (v8.51, pre-implementation plan review). The runbook header includes the distinguishing prose so a reader can't conflate the three.
- Registered in `ON_DEMAND_RUNBOOKS` and written to `.cclaw/lib/runbooks/qa-stage.md` by install. The `ON_DEMAND_RUNBOOKS_INDEX_SECTION` got a new row for the qa-stage trigger.

**Item #6 — reviewer `qa-evidence` axis** (`src/content/specialist-prompts/reviewer.ts`, ~4k chars).

- The reviewer's axis count grew from 9 to 10 (8 explicit pre-v8.48; +1 `edit-discipline` in v8.48; +1 `qa-evidence` in v8.52, gated). The axes header was updated to "Ten-axis review"; the slim-summary axes counter format gained a `qae=N` token (only present when the qa gate fired — omitted entirely on structurally-skipped slugs to keep the counter readable on CLI / library / API / data / infra / docs slugs).
- The `qa-evidence` axis is **gated**: it fires only when the orchestrator dispatched qa-runner (`triage.surfaces ∩ {ui, web} ≠ ∅` AND `acMode != "inline"`). On any slug where the qa gate did not fire, the axis is structurally skipped; the iteration block notes `qa-evidence: skipped (no qa gate)`.
- When the qa gate did fire, the axis walks three sub-checks per UI-tagged AC: **Sub-check 1** — per-UI-AC evidence row present (AC id citation, Surface line, Evidence block matching the declared Verification tier, Status line); **Sub-check 2** — Status=pass requires verbatim behavioural match between the AC's verb and the evidence (a "page loaded" screenshot does NOT satisfy "user sees toast after submit"); **Sub-check 3** — evidence tier escalation (silent downgrade detection: `evidence_tier: manual` but Playwright shipped in package.json fires `required`; legitimate degradation when no tools were available fires `fyi`).
- Three qa-evidence-axis-specific anti-rationalization rows live in the reviewer body (small-AC / user-confirmed-manual / verdict-pass-rubber-stamp); cross-cutting verification / completion rows stay in the shared catalog. The reviewer's Inputs section gains `qa.md` as a v8.52 input.

**Item #7 — flow-state fields + validators** (`src/types.ts`, `src/flow-state.ts`).

- New types `QaVerdict = "pass" | "iterate" | "blocked"` and `QaEvidenceTier = "playwright" | "browser-mcp" | "manual"` exported from `src/types.ts`. Distinct from `CriticVerdict` (post-impl critic) and `PlanCriticVerdict` (pre-impl plan-critic) on purpose — three specialists, three verdict enums, no merge.
- New `SURFACES = ["cli", "library", "api", "ui", "web", "data", "infra", "docs", "other"] as const` + `Surface` type. Added to `TriageDecision` as `surfaces?: Surface[]` (optional for backwards compat; populated at triage time; absent = `["other"]` for legacy gate evaluation).
- Four new optional fields on `FlowStateV82`: `qaVerdict?: QaVerdict | null` (null = explicit not-yet-run / skipped); `qaIteration?: number` (hard-capped at 1; absent = 0); `qaDispatchedAt?: string` (ISO timestamp; pure telemetry); `qaEvidenceTier?: QaEvidenceTier | null` (null = blocked verdict with no tier exercised). All four are optional so pre-v8.52 state files validate without migration.
- `assertFlowStateV82` validates the four fields when present and rejects: invalid verdict values (including `revise` from plan-critic's vocabulary and `block-ship` from post-impl critic's), invalid evidence-tier values (e.g. `cypress`), `qaIteration` ∉ {0, 1} (the 1-iterate-loop cap is structural, not advisory), non-string `qaDispatchedAt`, non-number `qaIteration`, non-array `triage.surfaces`, and invalid surface tokens (e.g. `frontend`).

**Item #8 — install path + smoke** (`src/content/core-agents.ts`, `scripts/smoke-init.mjs`).

- `SPECIALIST_AGENTS` array grew from 7 to 8 (added `qa-runner` between `critic` and `slice-builder`). `CORE_AGENTS` grew from 9 to 10. Install path writes `.cclaw/lib/agents/qa-runner.md` alongside the other specialist contracts; install path also writes `.cclaw/lib/templates/qa.md`, `.cclaw/lib/runbooks/qa-stage.md`, and `.cclaw/lib/skills/qa-and-browser.md` (which `AUTO_TRIGGER_SKILLS` grew from 20 to 21 to include).
- `scripts/smoke-init.mjs` asserts every new install file exists (`qa-runner.md` agent + `qa.md` template + `qa-stage.md` runbook + `qa-and-browser.md` skill via the existing `AUTO_TRIGGER_SKILLS`-derived loop). Smoke runs `init → install → install → install → uninstall` and verifies the layout is clean at every step.

### Metrics

- **Files touched:** 15 modified, 3 new (`src/content/specialist-prompts/qa-runner.ts` + `src/content/skills/qa-and-browser.md` + `tests/unit/v852-qa-and-browser.test.ts`). The qa-runner prompt is ~265 lines / ~22k chars; the qa-and-browser skill is ~140 lines / ~14k chars; the qa-stage runbook is ~10k chars; the qa.md template is ~13k chars; combined v8.52 install-asset growth is ~59k chars (all of which lives on disk under `.cclaw/lib/`, NOT in the in-memory `/cc` body).
- **Tests added:** 132 tripwires in `tests/unit/v852-qa-and-browser.test.ts` (5 SURFACES enum + Surface type, 5 FLOW_STAGES + qa stage ordering + ARTIFACT_FILE_NAMES, 11 skill registration + anatomy, 11 specialist registry + agent shape, 6 prompt structural shape, 4 prompt gate (when to run / when NOT), 6 prompt verdict + routing, 7 prompt read-only contract, 6 prompt browser-tool hierarchy, 6 prompt pre-commitment + token budget, 2 prompt anti-rationalization, 9 qa.md template, 8 qa-stage runbook, 22 flow-state validators for qa fields, 7 triage.surfaces validators, 6 orchestrator wiring, 8 reviewer qa-evidence axis, 3 cross-specialist consistency). Total suite 1287 → 1420 tests, all green. Smoke green.
- **Body-budget cost:** start-command body grew ~7k chars / ~20 lines (~15% relative to v8.30 baseline). v8.22 body-only budget `57500 → 67500`; v8.22 combined body+runbooks ceiling `130000 → 160000`; v8.31 inline-path budget `57500 → 67500`; v8.31 line budget `505 → 535`; v8.31 ratio cap `1.28 → 1.50`. The body delta is intentionally small — ~95% of the new content lives in `runbooks/qa-stage.md` (gating, dispatch envelope, verdict routing, iteration cap, flow-state patches, reviewer cross-check, legacy migration) + the qa-runner.ts prompt body + the qa-and-browser.md skill, all lazy-loaded.
- **Reviewer-prompt cost:** the reviewer prompt grew ~4k chars / ~15 lines (~7%) for the qa-evidence axis (axis table row, three sub-check sections, three anti-rationalization rows, slim-summary counter update, `qa.md` named in Inputs). Per-prompt budget `62000 → 68000` (reviewer); the qa-runner prompt is a new entry with no historical baseline.
- **Gate selectivity:** 3-AND conditions (triage.surfaces ∩ {ui, web} ≠ ∅, acMode != inline, qaIteration < 1). The intent is that qa-runner fires on the slug shape that benefits most (UI / web work outside inline mode) and is structurally skipped on every other shape. Widening any of the three conditions is v8.53+ scope and requires a CHANGELOG note.

### Files touched

- `src/content/specialist-prompts/qa-runner.ts` (**new**) — full qa-runner prompt with iron law, gate, 7-section investigation protocol, three-tier browser hierarchy, verdict + routing, anti-rationalization, slim-summary contract.
- `src/content/specialist-prompts/index.ts` — adds `QA_RUNNER_PROMPT` import + export and entry in the `SPECIALIST_PROMPTS` record.
- `src/content/skills/qa-and-browser.md` (**new**) — full cross-cutting QA discipline skill (sibling of `debug-and-browser.md`).
- `src/content/skills.ts` — adds `qa-and-browser` to `AUTO_TRIGGER_SKILLS` with stages `["build", "qa", "review"]` and the v8.52 trigger set; adds `"qa"` to `AutoTriggerStage` + `AUTO_TRIGGER_DISPATCH_STAGES` + `buildAutoTriggerBlock`'s `known` set.
- `src/types.ts` — adds `qa-runner` to the `SPECIALISTS` const array (now length 8); adds `"qa"` to `FLOW_STAGES` const array (now length 6); adds `QaVerdict` / `QaEvidenceTier` types; adds `SURFACES` const array + `Surface` type; adds `surfaces?: Surface[]` to `TriageDecision`.
- `src/flow-state.ts` — adds `QA_VERDICTS` / `QA_EVIDENCE_TIERS` consts + `isQaVerdict` / `isQaEvidenceTier` / `isSurface` guards; adds four optional qa fields to `FlowStateV82`; updates `assertFlowStateV82` with the four new validators; updates `assertTriageOrNull` with the surfaces array validator.
- `src/content/core-agents.ts` — adds the `qa-runner` entry to `SPECIALIST_AGENTS` between `critic` and `slice-builder`.
- `src/content/artifact-templates.ts` — adds `qa` to the `ArtifactTemplate.id` union; adds the `QA_TEMPLATE` body; registers it in `ARTIFACT_TEMPLATES`.
- `src/content/runbooks-on-demand.ts` — adds the `QA_STAGE` body (~10k chars) and registers it in `ON_DEMAND_RUNBOOKS` (now length 15).
- `src/content/start-command.ts` — adds the qa-runner stage entry (Hop 2 surface-detection block, conditional `qa` token in `triage.path`, new stage-table row, `#### qa` body section, on-demand runbooks index entry, `lastSpecialist` enum entry).
- `src/content/specialist-prompts/reviewer.ts` — adds the v8.52 `qa-evidence` axis (axis table row, three sub-check sections, three anti-rationalization rows, slim-summary counter update with `qae=N`, `qa.md` named in Inputs); axis header renamed `Nine-axis review → Ten-axis review`.
- `src/artifact-paths.ts` — adds `"qa": "qa.md"` to `ARTIFACT_FILE_NAMES`.
- `scripts/smoke-init.mjs` — adds the v8.52 install-asset verifications (qa-runner.md agent + qa.md template + qa-stage.md runbook).
- `tests/unit/v852-qa-and-browser.test.ts` (**new**) — 132 tripwires covering registry, prompt structure, gate, verdict routing, read-only contract, browser-tool hierarchy, pre-commitment + token budget, anti-rationalization, artifact template, runbook, flow-state validators, triage.surfaces validators, orchestrator wiring, reviewer qa-evidence axis, cross-specialist consistency.
- `tests/unit/v822-orchestrator-slim.test.ts`, `tests/unit/v831-path-aware-trimming.test.ts` — body-budget bumps with v8.52 notes.
- `tests/unit/v848-discipline-skills.test.ts` — skill count bump (20 → 21) + reviewer axis count bump (Nine-axis → Ten-axis).
- `tests/unit/v813-cleanup.test.ts` — reviewer axis count bump (9 → 10 with the gated qa-evidence).
- `tests/unit/v819-skill-windowing.test.ts` — `AutoTriggerStage` known set updated to include `"qa"`.
- `tests/unit/prompt-budgets.test.ts` — reviewer per-prompt budget bump (62000 → 68000 chars, 660 → 690 lines).
- `tests/unit/specialist-prompts.test.ts` — relies on the new `## Modes` section in qa-runner.
- `tests/unit/core-agents.test.ts`, `tests/unit/critic-specialist.test.ts`, `tests/unit/types.test.ts`, `tests/unit/v814-cleanup.test.ts`, `tests/unit/v828-rename-planner-to-ac-author.test.ts`, `tests/unit/v851-plan-critic.test.ts`, `tests/integration/critic-hop.test.ts`, `tests/unit/artifact-paths.test.ts` — specialist count bumps from 7 → 8 with v8.52 notes (no semantic changes).
- `CHANGELOG.md` — this entry.
- `package.json` — version bump `8.51.0 → 8.52.0`.

### Backwards compatibility

- Pre-v8.52 `flow-state.json` files lack `qaVerdict` / `qaIteration` / `qaDispatchedAt` / `qaEvidenceTier`. Validators treat absent fields as null / 0 / undefined; no migration is required. On the first `/cc` after v8.52 install, a state file with `currentStage: "build"` AND `lastSpecialist: "slice-builder"` AND no `qaVerdict` is treated as pre-qa intermediate: if the slug satisfies the v8.52 gate (`triage.surfaces` includes ui / web AND `acMode != inline`), qa-runner dispatches on the next step; if it does not, the orchestrator advances to reviewer as today.
- Pre-v8.52 `flow-state.json > triage` blocks lack the `surfaces` field. Validators accept absent surfaces; the v8.52 gate treats absent / empty surfaces as the empty list and skips qa dispatch. The orchestrator does NOT retro-populate the field — leaving `surfaces` absent is the canonical "pre-v8.52 slug; qa was never on the table" signal.
- Pre-v8.52 `triage.path` arrays (which cannot contain `"qa"` because the stage did not exist) validate unchanged; the v8.52 `FLOW_STAGES` enum addition is a superset of the pre-v8.52 vocabulary.
- Existing shipped slugs (where `qaVerdict` is absent because qa-runner was never run) are review-able and finalize-able as before; no field on the shipped artifact references qa-runner outputs.
- The post-impl `critic` specialist (v8.42), the pre-impl `plan-critic` specialist (v8.51), and the qa-runner specialist (v8.52) coexist; the three verdict enums are distinct on purpose (`pass` | `iterate` | `block-ship` vs `pass` | `revise` | `cancel` vs `pass` | `iterate` | `blocked`) so dispatch-time and resume-time readers never collapse one vocabulary into another.
- The `debug-and-browser` skill is unchanged; the v8.52 `qa-and-browser` skill is a sibling, not a refactor or split.

### Constraints honoured

- **Gating is mandatory** — qa-runner runs ONLY when ALL three conditions hold (UI / web surface, non-inline mode, iteration < 1). CLI / library / API / data / infra / docs slugs skip entirely; inline-mode slugs skip entirely.
- **Browser tool availability degrades gracefully** — no browser MCP available means manual-tier evidence, not a failure. The qa-runner records `evidence_tier: manual` honestly; the reviewer's `qa-evidence` axis fires `fyi` on legitimate degradation, `required` on silent tier downgrade.
- **Max 1 iteration on iterate** — preventing oscillation between slice-builder fix-only and qa-runner re-runs.
- **`blocked` is a real verdict** — when browser tools are unavailable AND manual steps are required, the orchestrator surfaces the user picker (`proceed-without-qa-evidence` / `pause-for-manual-qa` / `skip-qa`); the qa-runner never pretends qa ran.
- **No bundling** with v8.53 (planned critic enhancements).
- **Anti-rationalizations referenced** from the v8.49 `.cclaw/lib/anti-rationalizations.md` catalog (`verification` + `completion` rows); qa-specific rows live in the qa-and-browser skill / qa-runner prompt only.
- **Sibling skill, not refactor** — `debug-and-browser.md` survives unchanged; `qa-and-browser.md` is a new sibling. The audit findings (cross-referenced in the qa-and-browser skill body) document the decision.

## 8.51.0 — pre-implementation plan-critic (chachamaru-style adversarial review before build)

### Why

cclaw's existing v8.42 `critic` specialist runs at Hop 4.5 — **after** the slice-builder writes code and the reviewer finishes its loop. By the time it speaks, the build has already consumed context implementing whatever the plan said to implement. If the plan itself was wrong (too-coarse ACs swallowing five concerns; a hidden dependency cycle the AC table doesn't surface; a parallel-build topology whose slices share files; a security-sensitive `touchSurface` the plan author didn't flag), the critic catches only the *consequence* — never the *cause*. The cause was already burnt into the build.

chachamaru's `plan_analyst` / `plan_critic` (see `agents.plan_critic` in their setup script, `sandbox = "workspace-read-only"`) runs at Phase 0 — **before** any implementation begins. Different lens, different problem class. cclaw v8.51 adds the pre-implementation pass alongside the existing post-implementation one; both specialists ship together because they catch different problem classes, and the v8.51 work explicitly does NOT collapse the two into a merged "critic" because their verdict vocabularies and dispatch contracts are different.

### What changed

**Item #1 — new specialist `plan-critic`** (`src/content/specialist-prompts/plan-critic.ts`, ~265 lines).

- Activation: `on-demand`. Single mode: `pre-impl-review` (no `gap` / `adversarial` split — that vocabulary belongs to the post-impl critic). Tools: Read + Bash (for git inspection); explicitly NOT Write/Edit/MultiEdit. Read-only on the codebase; the prompt body itself disallows source mutation. Token budget: 3-5k target, 7k hard cap.
- Body structure: Iron Law ("EVIDENCE FROM THE PLAN ONLY"), `When to run` / `When NOT to run` blocks that mirror the orchestrator gate verbatim, acMode-awareness (defensive — the gate restricts to `strict`), posture-awareness (per-AC posture from plan.md frontmatter; most-restrictive value stamped into `plan-critic.md > frontmatter > posture_inherited`), five-dimension investigation protocol (§1 goal coverage / §2 granularity / §3 dependency accuracy with surface-overlap graph / §4 parallelism feasibility / §5 risk catalog with NFR / security / migration / irreversibility sweeps), §6 pre-commitment predictions (3-5 predictions authored BEFORE §1-§5 detailed pass), §7 verdict (`pass` / `revise` / `cancel`), §8 anti-rationalization referencing the shared `.cclaw/lib/anti-rationalizations.md` catalog plus four plan-critic-unique rows.
- Output: exactly one artifact, `flows/<slug>/plan-critic.md`, single-shot per dispatch (overwrites on re-dispatch, never appends). Returns a slim summary (≤7 lines) with `specialist: plan-critic`, `verdict`, `findings` totals broken down by severity (block-ship / iterate / fyi), `iteration` (0 or 1), `confidence`, optional `notes`.
- Composition footer: declares plan-critic as `on-demand specialist`, names the four `Do not spawn` lanes (no design / ac-author / reviewer / slice-builder / critic / research-helper dispatches; orchestrator routes verdicts, plan-critic does not), names the `Stop condition` (file written + verdict frontmatter set + slim summary returned).
- The prompt explicitly names the **separation from the post-impl critic** (`block-ship` / `iterate` / `fyi` is the post-impl critic's vocabulary; plan-critic borrows those words as SEVERITY labels but the verdict enum is `pass` / `revise` / `cancel`; readers branch on which specialist is in flight, not on a merged verdict shape).

**Item #2 — tight gate in the orchestrator** (`src/content/start-command.ts` dispatch table).

- plan-critic runs ONLY when ALL of the following hold: `triage.acMode == "strict"` AND `triage.complexity == "large-risky"` AND `triage.problemType != "refines"` AND AC count ≥ 2. The gate is AND across all four; any other combination skips plan-critic and the orchestrator advances directly from ac-author's slim summary to slice-builder dispatch, as before v8.51.
- Stage mapping: plan-critic is a **sub-step** of the `plan` stage, NOT a new entry in `FLOW_STAGES` or `triage.path` (which stay at `plan` / `build` / `review` / `critic` / `ship`). `currentStage` stays `"plan"` while plan-critic is in flight; `lastSpecialist` rotates through `ac-author` → `plan-critic` → `ac-author` (on revise bounce) → `plan-critic` (iteration 1) → `slice-builder` (on pass).
- Verdict routing: `pass` → advance to slice-builder dispatch (no ceremony, `iterate` / `fyi` rows in plan-critic.md ride along as advisory notes). `revise` at iteration 0 → bounce to ac-author with the plan-critic.md §8 hand-off block prepended to the dispatch envelope's Inputs line; ac-author updates plan.md, then plan-critic is re-dispatched (iteration 1). `revise` at iteration 1 → surface user picker: `[cancel]` / `[accept-warnings-and-proceed]` / `[re-design]`. `cancel` at any iteration → surface user picker IMMEDIATELY: `[cancel-slug]` / `[re-design]` (no silent fallback). Iteration cap: 1 revise loop max (`planCriticIteration` ∈ {0, 1}; a third dispatch is structurally not allowed).

**Item #3 — runbook `plan-critic-stage.md`** (`src/content/runbooks-on-demand.ts`).

- New on-demand runbook (~6k chars) that the orchestrator opens on every `ac-author` slim-summary return when the gate evaluates to true. Documents the four AND conditions, the dispatch envelope (required reads, inputs, output contract, forbidden actions), the verdict-handling routing table (verdict × iteration → orchestrator action), iteration cap enforcement, `flow-state.json` patches (`currentStage` / `lastSpecialist` / `planCriticIteration` / `planCriticVerdict` / `planCriticDispatchedAt`), and the legacy migration for pre-v8.51 state files (a state file with `currentStage: "plan"` AND `lastSpecialist: "ac-author"` AND no `planCriticVerdict` field is treated as pre-plan-critic intermediate; on the next `/cc`, if the slug satisfies the gate, the orchestrator dispatches plan-critic before advancing to slice-builder).
- Distinct from `critic-stage.md` (v8.42, post-implementation, Hop 4.5). The runbook header includes a comparison table making the two stages' different inputs / outputs / verdicts explicit, so a reader can't conflate them.
- Registered in `ON_DEMAND_RUNBOOKS` and written to `.cclaw/lib/runbooks/plan-critic-stage.md` by install.

**Item #4 — artifact template `plan-critic.md`** (`src/content/artifact-templates.ts`).

- New template (~5k chars) registered in `ARTIFACT_TEMPLATES` with `id: "plan-critic"`, `fileName: "plan-critic.md"`. Frontmatter fields: `slug`, `stage: plan-critic`, `status: active`, `posture_inherited`, `ac_mode`, `ac_count`, `dispatched_at`, `iteration`, `predictions_made`, `findings`, `verdict`, `token_budget_used`.
- Body sections: §1 Goal coverage / §2 Granularity / §3 Dependency accuracy (with optional ASCII dependency diagram) / §4 Parallelism feasibility / §5 Risk catalog / §6 Pre-commitment predictions / §7 Verdict (verdict + counts breakdown + confidence + rationale) / §8 Hand-off (revise: specific changes for ac-author; cancel: recommended next step; pass: explicit "No hand-off required") / Summary (Changes made / Things noticed but didn't touch / Potential concerns — mirrors the three-block pattern from the existing critic template).
- The template explicitly names the severity vocabulary (`block-ship` / `iterate` / `fyi`) and the verdict enum (`pass` | `revise` | `cancel`), and labels both as plan-critic's OWN vocabulary (do not merge with the reviewer's `critical` / `required` / `consider` / `nit` / `fyi` ledger, and do not merge with the post-impl critic's verdict enum).

**Item #5 — flow-state fields + validators** (`src/types.ts`, `src/flow-state.ts`).

- New type `PlanCriticVerdict = "pass" | "revise" | "cancel"` exported from `src/types.ts`. Distinct from `CriticVerdict` on purpose (post-impl critic has `block-ship`; plan-critic has `cancel` because no build has run yet).
- Three new optional fields on `FlowStateV82`: `planCriticVerdict?: PlanCriticVerdict | null` (null = explicit not-yet-run / skipped); `planCriticIteration?: number` (hard-capped at 1; absent = 0); `planCriticDispatchedAt?: string` (ISO timestamp; pure telemetry, no branch reads on it). All three are optional so pre-v8.51 state files validate without migration; readers default to `null` / `0` / undefined.
- `assertFlowStateV82` validates the three fields when present and rejects: invalid verdict values (including `block-ship` and `iterate` from the post-impl critic's vocabulary), `planCriticIteration` ∉ {0, 1} (the 1-revise-loop cap is structural, not advisory), non-string `planCriticDispatchedAt`, and non-number `planCriticIteration`.

**Item #6 — install path + smoke** (`src/content/core-agents.ts`, `scripts/smoke-init.mjs`).

- `SPECIALIST_AGENTS` array grew from 6 to 7 (added `plan-critic` between `critic` and `slice-builder`). `CORE_AGENTS` grew from 8 to 9. Install path writes `.cclaw/lib/agents/plan-critic.md` alongside the other specialist contracts; install path also writes `.cclaw/lib/templates/plan-critic.md` and `.cclaw/lib/runbooks/plan-critic-stage.md`.
- `scripts/smoke-init.mjs` asserts every new install file exists (`plan-critic.md` agent + template + runbook). Smoke runs `init → install → install → install → uninstall` and verifies the layout is clean at every step.

### Metrics

- **Files touched:** 12 modified, 2 new (`src/content/specialist-prompts/plan-critic.ts` + `tests/unit/v851-plan-critic.test.ts`). The plan-critic prompt is ~265 lines / ~22k chars; the plan-critic-stage runbook is ~6k chars; the plan-critic.md template is ~5k chars; combined v8.51 install-asset growth is ~33k chars (all of which lives on disk under `.cclaw/lib/`, NOT in the in-memory `/cc` body).
- **Tests added:** 78 tripwires in `tests/unit/v851-plan-critic.test.ts` (10 registry membership, 6 prompt structural shape, 4 gate, 6 verdict routing, 6 read-only contract, 6 pre-commitment + token budget, 2 anti-rationalization, 6 artifact template, 7 runbook, 14 flow-state validators, 6 orchestrator wiring, 2 cross-specialist consistency, 3 environment sanity). Total suite 1209 → 1287 tests, all green. Smoke green.
- **Body-budget cost:** start-command body grew ~4k chars / ~15 lines (~9% relative to v8.30 baseline, ~7.5% relative to v8.50). v8.22 body-only budget `52500 → 57500`; v8.22 combined body+runbooks ceiling `117000 → 130000`; v8.31 inline-path budget `52500 → 57500`; v8.31 ratio cap `1.16 → 1.28`. The body delta is intentionally small — ~95% of the new content lives in `runbooks/plan-critic-stage.md` (gating table, dispatch envelope, verdict routing, iteration cap, flow-state patches, legacy migration) + the plan-critic.ts prompt body, both lazy-loaded.
- **Gate selectivity:** 4-AND conditions (acMode=strict, complexity=large-risky, problemType!=refines, AC count≥2). The intent is that plan-critic fires on the slug shape that benefits most (large-risky strict plans with multiple ACs, where granularity / dependency / parallelism are real surfaces) and is structurally skipped on every other shape. Widening any of the four conditions is v8.52+ scope and requires a CHANGELOG note.

### Files touched

- `src/content/specialist-prompts/plan-critic.ts` (**new**) — full plan-critic prompt with iron law, gate, 5-dimension protocol, §6 pre-commitment, §7 verdict + routing, §8 anti-rationalization, slim-summary contract.
- `src/content/specialist-prompts/index.ts` — adds `PLAN_CRITIC_PROMPT` import + export and entry in the `SPECIALIST_PROMPTS` record.
- `src/types.ts` — adds `plan-critic` to the `SPECIALISTS` const array (now length 7); adds `PlanCriticVerdict` type.
- `src/flow-state.ts` — adds `PLAN_CRITIC_VERDICTS` const + `isPlanCriticVerdict` guard; adds three optional fields to `FlowStateV82`; updates `assertFlowStateV82` with the three new validators.
- `src/content/core-agents.ts` — adds the `plan-critic` entry to `SPECIALIST_AGENTS` between `critic` and `slice-builder`.
- `src/content/artifact-templates.ts` — adds `plan-critic` to the `ArtifactTemplate.id` union; adds the `PLAN_CRITIC_TEMPLATE` body; registers it in `ARTIFACT_TEMPLATES`.
- `src/content/runbooks-on-demand.ts` — adds the `PLAN_CRITIC_STAGE` body (~6k chars) and registers it in `ON_DEMAND_RUNBOOKS` (now length 14).
- `src/content/start-command.ts` — adds the plan-critic sub-step pointer (paragraph above the dispatch table, new `plan` sub-step table row, `#### plan-critic` body section between `#### plan` and `#### build`, `lastSpecialist` enum entry).
- `scripts/smoke-init.mjs` — adds the v8.51 install-asset verifications (plan-critic.md template + agent + runbook).
- `tests/unit/v851-plan-critic.test.ts` (**new**) — 78 tripwires covering registry, prompt structure, gate, verdict routing, read-only contract, pre-commitment + token budget, anti-rationalization, artifact template, runbook, flow-state validators, orchestrator wiring, cross-specialist consistency.
- `tests/unit/v822-orchestrator-slim.test.ts`, `tests/unit/v831-path-aware-trimming.test.ts` — body-budget bumps with v8.51 notes (no semantic changes; the tests pin the new budgets).
- `tests/unit/core-agents.test.ts`, `tests/unit/critic-specialist.test.ts`, `tests/unit/types.test.ts`, `tests/unit/v814-cleanup.test.ts`, `tests/unit/v828-rename-planner-to-ac-author.test.ts`, `tests/integration/critic-hop.test.ts` — specialist count bumps from 6 → 7 with v8.51 notes (no semantic changes).
- `CHANGELOG.md` — this entry.
- `package.json` — version bump `8.50.0 → 8.51.0`.

### Backwards compatibility

- Pre-v8.51 `flow-state.json` files lack `planCriticVerdict` / `planCriticIteration` / `planCriticDispatchedAt`. Validators treat absent fields as null/0/undefined; no migration is required. On the first `/cc` after v8.51 install, a state file with `currentStage: "plan"` AND `lastSpecialist: "ac-author"` AND no `planCriticVerdict` is treated as pre-plan-critic intermediate: if the slug satisfies the gate, plan-critic dispatches on the next step; if it does not, the orchestrator advances to slice-builder as today.
- Existing shipped slugs (where `planCriticVerdict` is absent because plan-critic was never run) review-able and finalize-able as before; no field on the shipped artifact references plan-critic outputs.
- The post-impl `critic` specialist (v8.42) is unchanged; its verdict enum (`pass` / `iterate` / `block-ship`) and its dispatch stage (the `critic` step at Hop 4.5) are preserved verbatim. plan-critic and critic coexist; both run when their respective gates fire.

### Constraints honoured

- **Tight gating.** plan-critic does NOT run on inline / soft / trivial / small-medium / refines / single-AC flows. Wide gating would 2x ceremony for marginal-to-zero benefit; the 4-AND gate captures the slug shape where the cost is amortised by the value.
- **Read-only at prompt level.** The plan-critic frontmatter disallows Write / Edit / MultiEdit; the prompt body re-states the rule in `## What you do NOT do` and `## Composition`. Runtime sandbox enforcement is harness-level work for a future slug (the prompt-level discipline is the v8.51 boundary).
- **Max 1 revise loop.** `planCriticIteration` validators reject ∉ {0, 1}; the orchestrator surfaces the revise-cap picker on the second `revise` rather than dispatching plan-critic a third time.
- **No multi-perspective lenses.** That scope belongs to a future post-impl `critic.ts` expansion; plan-critic stays focused on the five dimensions.
- **No bundling.** v8.51 ships plan-critic and only plan-critic.
- **Anti-rationalization references.** plan-critic cites `.cclaw/lib/anti-rationalizations.md` (the shared catalog) by pointer for cross-cutting rationalizations and adds four plan-critic-unique rows in its §8 section. No duplication of catalog rows.

## 8.50.0 — knowledge outcome loop (outcome_signal + down-weight in findNearKnowledge)

### Why

`knowledge.jsonl` was **forward-only** pre-v8.50. Entries got written at compound time (gated on the four v8.18 quality signals) and read by `findNearKnowledge` at triage time (Jaccard over `tags ∪ touchSurface`), but there was no feedback path: once an entry shipped, nothing ever down-weighted it — not when the slug it captured was later reverted, not when a follow-up bug task referenced it, not when the same surface needed a hot-fix within the 24-hour-after-ship window. The result was that **bad knowledge stayed equally prominent to good knowledge**: a slug whose direction turned out to be wrong kept surfacing as a precedent for every nearby task, with the same Jaccard ranking it had on the day it shipped.

Findings from the cross-reference audit (compound / affaan-m-ecc / gstack patterns all converged on the same gap) flagged this as the highest-value closed-loop item left after v8.49's overcomplexity sweep. v8.50 closes the loop with automatic outcome telemetry and a multiplier that bites at the threshold gate.

### What changed

**Item #1 — `OUTCOME_SIGNALS` enum + three optional `KnowledgeEntry` fields** (new exports in `src/knowledge-store.ts`).

- New constant `OUTCOME_SIGNALS = ["unknown", "good", "manual-fix", "follow-up-bug", "reverted"] as const` (worst → best ordering is the array tail; multiplier ordering is the inverse).
- New type `OutcomeSignal = (typeof OUTCOME_SIGNALS)[number]`.
- New fields on `KnowledgeEntry` (all optional for back-compat):
  - `outcome_signal?: OutcomeSignal`
  - `outcome_signal_updated_at?: string` — ISO timestamp of the most recent signal write.
  - `outcome_signal_source?: string` — short free-text reason (`"revert detected on <sha>"`, `"follow-up-bug task references slug <slug> with keyword 'fix'"`, `"manual-fix detected: <subject> (sha <sha>, surface <path>)"`).
- `assertEntry` validates the three fields when present; absent fields validate cleanly (pre-v8.50 entries pass without migration).
- New helpers `outcomeSignalOf(entry)` and `outcomeMultiplier(entry)` default absent `outcome_signal` to `"unknown"` (neutral; multiplier `1.0`). Read sites use these helpers instead of open-coding the fallback.

**Item #2 — `findNearKnowledge` applies the outcome-signal multiplier** (updated scoring in `src/knowledge-store.ts > findNearKnowledge`).

- New exported constant `OUTCOME_SIGNAL_MULTIPLIERS: Readonly<Record<OutcomeSignal, number>>` with the tuned values: `good`=`1.0`, `unknown`=`1.0`, `manual-fix`=`0.75`, `follow-up-bug`=`0.5`, `reverted`=`0.2`. Frozen via `Object.freeze` so accidental mutation in callers is a no-op.
- The scoring loop now computes `adjusted = similarity * outcomeMultiplier(entry)` AFTER the Jaccard pass. The adjusted score gates the threshold (`adjusted < threshold` → excluded) AND drives sort order (`b.adjusted - a.adjusted`, tie-break on raw `b.similarity - a.similarity`). Pre-v8.50 entries without `outcome_signal` get multiplier `1.0` (no behaviour change at the gate; the absence-as-`"unknown"` rule is honoured by `outcomeMultiplier`).
- At the v8.18 baseline `threshold: 0.4`, the multipliers translate to: `manual-fix` → light down-weight (a candidate that would have scored exactly `0.4` now scores `0.3` and falls below); `follow-up-bug` → heavy down-weight (needs raw `0.8` to clear); `reverted` → near-exclusion (a perfect raw `1.0` lands at `0.2`, well below `0.4` — the only way a reverted entry surfaces is if the caller drops the threshold).
- New helper `setOutcomeSignal(projectRoot, targetSlug, signal, source, updatedAt)` — reads the whole `knowledge.jsonl` into memory, mutates the matched entry's three outcome fields, writes back via `writeFileSafe` (the existing atomic-rename pattern). Returns `true` on stamp, `false` on no-match / missing file. Other entries in the log are preserved verbatim — only the matched entry's three outcome fields are overwritten.

**Item #3 — Three automatic capture paths** (new module `src/outcome-detection.ts` + integration in `src/compound.ts` + orchestrator wiring in `src/content/start-command.ts`).

The pure detection helpers in `src/outcome-detection.ts` take serialised inputs (git-log strings, task-description strings, shipped-slug lists) and return match candidates. None touch the filesystem; integration helpers (`apply*` and `runCompoundAndShip > captureOutcomeSignals`) compose them with `readKnowledgeLog` + `setOutcomeSignal`. The pure/integration split makes every detector unit-testable with synthetic strings and no live repo.

**#3a — Revert detection** (`parseRevertCommits` + `findRevertedSlugs` + integration in `compound.ts > captureOutcomeSignals`).

- Runs at ship-compound time, AFTER the new entry is appended and BEFORE the artifact move.
- Pre-condition: `.git/` exists at projectRoot (the v8.23 no-git path skips silently).
- Probe: `git log --grep="^revert" --oneline -30 -i` (case-insensitive grep so both `Revert` and `revert:` surface).
- Parse heuristic: first line token = SHA; rest = subject; subject must start with `revert` or `Revert` (followed by `:`, whitespace, or quote). Quoted-original is extracted from the conventional `Revert "<original>"` shape.
- Match heuristic: each revert's `revertedSubject` (or raw `subject`) is scanned for slug-cased token references against the shipped-slug list. The current slug is excluded (a slug cannot revert itself — causality).
- On match, `setOutcomeSignal(slug, "reverted", "revert detected on <sha>", <iso-now>)` stamps the prior entry.
- The new entry CAN itself be flagged later (a future compound pass detects this slug's revert). Stamps are last-write-wins on the three outcome fields.

**#3b — Follow-up-bug detection** (`findFollowUpBugSlugs` + `applyFollowUpBugSignals`).

- Runs at **Hop 1 Detect (fresh `/cc` start)**, NOT at compound time. Wired into the start-command body so the orchestrator invokes `applyFollowUpBugSignals(projectRoot, triage.taskSummary, <iso-now>)` between triage persistence and the v8.18 prior-learnings lookup.
- Match heuristic (TWO signals required, AND):
  1. A slug-cased reference to a prior shipped slug (word-boundary match on the verbatim slug; case-sensitive). Slug-cased tokens (`20260514-foo`, `auth-bypass`) rarely appear in normal prose, so the false-positive rate is low.
  2. At least one bug keyword from the conservative `BUG_KEYWORDS` list: `bug`, `fix`, `broken`, `regression`, `crash`, `hotfix`, `hot-fix`, `revert`, `rollback`. Keyword match is word-boundary, case-insensitive.
- Both signals must fire — a refinement / rephrase task that names a prior slug WITHOUT bug intent does not stamp, and a generic bug task that does NOT name a prior slug has nothing to down-weight.
- On match, `setOutcomeSignal(slug, "follow-up-bug", "follow-up-bug task references slug <slug> with keyword '<keyword>'", <iso-now>)` stamps the referenced entry. Multiple keyword hits on the same slug stamp once (first-match-wins; `BUG_KEYWORDS` ordering puts the strongest signals first).
- The bug-keyword list is intentionally short. Adding `issue` or `problem` risks false-positives on framing prose ("the problem this slug solves is…"). Tune conservatively — under-detection is preferred to over-down-weighting good knowledge.

**#3c — Manual-fix detection** (`parseCommitLog` + `looksLikeFixCommit` + `findManualFixCandidates` + integration in `compound.ts > captureOutcomeSignals`).

- Runs at ship-compound time, alongside #3a.
- Probe: `git log --oneline --since="24 hours ago" -50` paired with `git log --name-only --pretty=format:"%H" --since="24 hours ago" -50` for the per-SHA touched-files map.
- Parse heuristic: each commit subject is matched against the regex `^(fix(\(AC-\d+\))?|hot-?fix|fixup!)([:!\s]|$)` (case-insensitive). Accepted shapes: `fix(AC-N): ...`, `fix: ...`, `hotfix: ...`, `hot-fix: ...`, `fixup! ...`.
- Surface match: each candidate commit's touched files are scanned against the slug's `touchSurface` declaration (path-prefix match — `src/auth/` catches `src/auth/oauth.ts`). Trailing slash is optional on surface declarations; the normaliser strips one if present.
- On match (any commit), `setOutcomeSignal(currentSlug, "manual-fix", "manual-fix detected: <subject> (sha <sha>, surface <path>)", <iso-now>)` stamps THIS slug (the one being captured).
- **Self-reporting limitation (honest):** the slug being shipped marks ITSELF when post-ship fixes land within the trailing 24h on its declared surface. We cannot tell from the commit alone whether the fix was a real defect (the slug shipped a bug) or a stylistic follow-up (the same author kept improving the module post-ship). The `manual-fix` multiplier (`0.75`) is deliberately a light down-weight to reflect this ambiguity — calling out the noise level rather than pretending the signal is decisive.

**Item #4 — `priorLearnings` payload surfaces `outcome_signal`** (specialist-prompt updates in `reviewer.ts`, `design.ts`, `ac-author.ts`, `critic.ts`).

- Every entry returned by `findNearKnowledge` carries its `outcome_signal` / `outcome_signal_updated_at` / `outcome_signal_source` fields verbatim (already part of the `KnowledgeEntry` shape; no extra serialisation work needed).
- Reviewer / design / ac-author / critic prompts now name `outcome_signal` in their `triage.priorLearnings` read section. The pattern: "the orchestrator already down-weighted these at lookup; their surface here means the raw similarity was strong enough to clear the down-weight. Treat down-weighted priors as cautionary precedent — name the signal verbatim when you cite the slug ('cf. shipped slug `<slug>` (`outcome_signal: reverted`) — treating as cautionary rather than precedent')."
- Critic's `## §8 escalation triggers` section adds a v8.50 note to the "High prior-learning density" trigger: an entry's `outcome_signal` of `reverted` / `follow-up-bug` / `manual-fix` is itself a known-bad marker.

### Metrics

- **Files touched:** 8 modified, 2 new (`src/outcome-detection.ts` + `tests/unit/v850-outcome-loop.test.ts`). +1097 insertions across modified files; +312 + +617 = +929 across the new files.
- **Tests added:** 56 tripwires in `tests/unit/v850-outcome-loop.test.ts` (7 AC-1, 11 AC-2 across the multiplier + setOutcomeSignal, 9 AC-3a + isSlugReference, 9 AC-3b, 7 AC-3c, 4 start-command + specialist prompts, 2 cross-item invariants, 3 runCompoundAndShip integration, 3 environment sanity). Total suite 1153 → 1209 tests, all green. Smoke green.
- **Body-budget cost:** start-command body grew ~1500 chars / +10 lines (~3.4% relative to v8.30 baseline). Three on-demand-runbook tripwires lifted with v8.50 notes: v8.22 body-only budget `51000 → 52500`; v8.22 combined body+runbooks ceiling `115000 → 117000`; v8.31 inline-path budget `51000 → 52500`; v8.31 ratio cap `1.13 → 1.16`.
- **Down-weight calibration at threshold = 0.4** (the v8.18 default): `manual-fix` bites at the threshold margin; `follow-up-bug` requires raw similarity ≥ 0.8 to clear; `reverted` requires raw similarity ≥ 2.0 (effectively excluded). Numbers tuned around how compound's knowledge writer populates `tags` / `touchSurface` and how the prior-learnings lookup tokenises `triage.taskSummary`.

### Files touched

- `src/knowledge-store.ts` — new `OUTCOME_SIGNALS` const + `OutcomeSignal` type + `OUTCOME_SIGNAL_MULTIPLIERS` const + `outcomeSignalOf` + `outcomeMultiplier` + `setOutcomeSignal` helpers. `KnowledgeEntry` gains three optional fields; `assertEntry` validates them. `findNearKnowledge` multiplies Jaccard by the entry's multiplier before threshold + sort.
- `src/outcome-detection.ts` (**new**, 312 lines) — pure detection helpers `parseRevertCommits` / `findRevertedSlugs` / `isSlugReference` / `findFollowUpBugSlugs` / `parseCommitLog` / `looksLikeFixCommit` / `findManualFixCandidates`, plus the integration helper `applyFollowUpBugSignals` that the orchestrator calls at Hop 1.
- `src/compound.ts` — new `CompoundOutcomeProbes` option type on `CompoundRunOptions` (synthetic git outputs for tests; absent in production = live git probes). New `captureOutcomeSignals` helper runs revert + manual-fix detection AFTER the new entry is appended; matches surface on `CompoundRunResult.revertedSlugMatches` / `manualFixMatches` for audit / test visibility. Live git probes (`runRevertProbe` / `runManualFixProbe`) shell out via `execFileSync` and degrade to `""` on any failure (missing `.git/`, binary not on PATH, non-zero exit).
- `src/content/start-command.ts` — new `### Follow-up-bug detection` section between triage persistence and prior-learnings lookup; `### Prior-learnings lookup` section updated with the v8.50 outcome-signal down-weight prose; `## Compound` section updated with the revert + manual-fix capture-path documentation.
- `src/content/specialist-prompts/reviewer.ts` — `## Prior learnings as priors` section adds the v8.50 outcome-signal weighting paragraph.
- `src/content/specialist-prompts/design.ts` — Phase 1 `triage.priorLearnings` read updates the field list to include `outcome_signal` and adds the v8.50 weighting paragraph.
- `src/content/specialist-prompts/ac-author.ts` — Phase 2 `triage.priorLearnings` read updates the field list and adds the v8.50 weighting paragraph.
- `src/content/specialist-prompts/critic.ts` — `## §8 escalation triggers > High prior-learning density` gains a v8.50 note that an `outcome_signal` of `reverted` / `follow-up-bug` / `manual-fix` is itself a known-bad marker.
- `tests/unit/v850-outcome-loop.test.ts` (**new**, 617 lines, 56 tripwires) — pins every v8.50 invariant.
- `tests/unit/v822-orchestrator-slim.test.ts` — body-only char budget `51000 → 52500`; combined body+runbooks ceiling `115000 → 117000`.
- `tests/unit/v831-path-aware-trimming.test.ts` — body-only char budget `51000 → 52500`; ratio cap `1.13 → 1.16`; inline-path budget `51000 → 52500`.
- `package.json` — version `8.49.0` → `8.50.0`.

### Backwards compatibility

- **Pre-v8.50 `knowledge.jsonl` entries without `outcome_signal` read cleanly.** `outcomeSignalOf(entry)` defaults absent to `"unknown"` (neutral; multiplier `1.0`). No migration required; the field is optional on `KnowledgeEntry` and `assertEntry` validates absence as valid.
- **`findNearKnowledge` behaviour on legacy entries is unchanged.** Every entry without `outcome_signal` gets multiplier `1.0`, so adjusted score == raw similarity (the pre-v8.50 ranking). The new signal-driven down-weight only fires on entries the capture paths have stamped.
- **CLI surface unchanged.** No new commands, no flag additions. The closed loop is fully automatic — revert detection and manual-fix detection at compound time, follow-up-bug detection at Hop 1. The user-explicitly-rejected CRUD CLI is intentionally absent.
- **Compound's primary contract is preserved.** All three capture paths are best-effort: missing `.git/` (the v8.23 no-git path), an unreadable `knowledge.jsonl`, or a per-entry `setOutcomeSignal` write failure degrade to "no signal stamped" rather than blocking ship. `runCompoundAndShip` never throws on the outcome loop.

### Known limitations (honest)

- **Manual-fix detection is self-reporting.** The slug being shipped marks itself if post-ship fix-prefix commits land within 24h on its `touchSurface`. We cannot distinguish a real defect (the slug shipped a bug) from a stylistic follow-up (the author kept improving the module). The `0.75` multiplier is deliberately a light down-weight to reflect this ambiguity. A future slug could promote this to a stronger signal once we have a way to classify post-ship fixes by intent.
- **No `good` capture path in v8.50.** The signal value exists in the enum for completeness, but no automatic path writes it — that would require active validation telemetry (e.g. "no fixes touched this slug's surface within 30 days post-ship") which we do not have yet. Entries default to `"unknown"` rather than `"good"`; the two carry the same multiplier (`1.0`) so the distinction is purely audit-trail.
- **Detection windows are deliberate point-in-time decisions.** Revert detection scans the last 30 commits at compound time; manual-fix detection scans the trailing 24h. Both miss late-binding signals (a revert 2 weeks later, a hot-fix at 25h post-ship). The cost of bigger windows is `git log` runtime; the calibration favours fast compounds over total recall.

## 8.49.0 — overcomplexity sweep (anti-rationalization consolidation + auto-trigger dedup + empty-commit elimination)

### Why

Three converging-evidence cleanup items had been accumulating across v8.13-v8.48:

1. **Anti-rationalization rows drifted across surfaces.** Cross-cutting rationalizations (`"I'll claim complete now, the reviewer will catch any gaps"`, `"while I'm here, I'll fix the adjacent thing"`, `"REFACTOR is unnecessary here"`) lived in 12+ files with diverging phrasings. The same conceptual rebuttal landed differently in `completion-discipline.md`, `commit-hygiene.md`, `tdd-and-verification.md`, the reviewer prompt, and the critic prompt — when the rebuttal lives in five places, the catalog has no source of truth.
2. **`buildAutoTriggerBlock(stage)` injected every skill's full description into every dispatched specialist prompt.** Per-dispatch token cost grew with every new skill added under v8.13-v8.48 (17 → 20 skills). The orchestrator-to-specialist hop carried 2-7K characters of skill description prose that the specialist could have looked up on disk.
3. **Empty `refactor(AC-N) skipped` commits polluted git log.** When REFACTOR had no opportunities for an AC, the slice-builder emitted a no-op commit (`git commit --allow-empty -m "refactor(AC-N) skipped: ..."`) to satisfy the per-AC chain check. The chain check needs a refactor signal, but the empty commit shape leaks "phase happened" semantics into git history that belongs in `build.md`.

v8.49 collapses all three into a single overcomplexity sweep — one anti-rationalization catalog, one compact auto-trigger pointer block + central skill index, and one `build.md` row token that replaces the empty-commit pattern.

### What changed

**Item #1 — Anti-rationalization consolidation** (new module + install path + skill pointers).

- New `src/content/anti-rationalizations.ts` exports `SHARED_ANTI_RATIONALIZATIONS: Record<Category, AntiRationalization[]>` keyed by five cross-cutting categories: `completion` (5 rows), `verification` (4 rows), `edit-discipline` (4 rows), `commit-discipline` (5 rows), `posture-bypass` (5 rows) — 23 canonical rows total. Each row pairs a quoted excuse with the conceptual rebuttal that previously drifted across surfaces.
- New `renderAntiRationalizationsCatalog()` renders the catalog as a Markdown body (one H2 per category, two-column table per H2). Pre-rendered as `ANTI_RATIONALIZATIONS_BODY` constant.
- `src/install.ts > writeAntiRationalizationsCatalog` writes the body to `.cclaw/lib/anti-rationalizations.md` during `syncCclaw`; the file is the single source of truth for cross-cutting rebuttals across every specialist + skill that previously inlined them.
- Specialist prompts (`reviewer.ts`, `design.ts`, `critic.ts`) and ten cross-cutting skill `.md` files each get a one-line pointer at the top of their `## Common rationalizations` / `## Anti-rationalization table` section: `**Cross-cutting rationalizations:** see `.cclaw/lib/anti-rationalizations.md` (category: <cat>)`. Each surface keeps its specialist-specific rows (design's pause-mid-flow rows, critic's pre-commitment row, reviewer's three edit-discipline rows, every skill's discipline-specific framings) — those stay where the discipline lives. Only the cross-cutting rows defer to the catalog.

**Item #2 — Auto-trigger index dedup** (compact pointer block + install-time index).

- `src/content/skills.ts > renderSkillBullet` reduced from a multi-line per-skill block (triggers + description + composition prose, ~250-400 chars per skill) to a single-line `id → file` pointer (~60 chars per skill). Stage-filtered `buildAutoTriggerBlock(stage)` shrinks measured per-stage:
  - `triage`: 2551 → 722 chars (72% reduction)
  - `plan`: 4726 → 979 chars (79% reduction)
  - `build`: 6447 → 1062 chars (84% reduction)
  - `review`: 5670 → 932 chars (84% reduction)
  - `ship`: 4472 → 813 chars (82% reduction)
  - `compound`: 2019 → 541 chars (73% reduction)
  - **Average per-dispatch reduction: ~79% (~6K → ~1K characters, ~1.5K → ~250 tokens at 4 chars/token).**
- New `renderSkillsIndex()` generates a comprehensive Markdown index of every auto-trigger skill (stage map + alphabetical entries with file path, stages, triggers, description). Pre-rendered as `SKILLS_INDEX_BODY` constant.
- `src/install.ts > writeSkillsIndex` writes the body to `.cclaw/lib/skills-index.md` during `syncCclaw`. Specialists now reference the index on-demand for full descriptions; the inline block carries only the compact pointer list.
- Every specialist prompt that calls `buildAutoTriggerBlock(stage)` (`slice-builder.ts`, `reviewer.ts`, `design.ts`, `critic.ts`, `ac-author.ts`, `security-reviewer.ts`) gets updated descriptive text explaining the new v8.49 compact pointer-index shape and pointing at `.cclaw/lib/skills-index.md` for full details.

**Item #3 — Empty `refactor(AC-N) skipped` commit elimination** (build.md row token + reviewer dual-accept).

- New default for skipped REFACTOR phases: write `Refactor: skipped — <one-line reason>` in the AC's `build.md` row REFACTOR notes column. No empty commit. The reviewer's git-log scan reads the row token; the chain check is satisfied.
- Legacy path (`git commit --allow-empty -m "refactor(AC-N) skipped: <reason>"`) is **still accepted** by the reviewer's TDD-integrity gate. Pre-v8.49 slugs with empty commits review cleanly without breakage.
- Reviewer's `test-first` and `characterization-first` posture checks (in `reviewer.ts`) document three accepted shapes for the refactor slot: real `refactor(AC-N):` commit, v8.49 `build.md` declaration (preferred), legacy `refactor(AC-N) skipped:` empty commit.
- Slice-builder prompt (`slice-builder.ts`) updates rule 4 (REFACTOR mandatory) to name all three paths; the worked example "REFACTOR explicitly skipped" leads with the `build.md` declaration form.
- `tdd-and-verification.md` skill body's "REFACTOR — mandatory pass" section, `(f) refactor_run_or_skipped_with_reason` gate, and "Common rationalizations" table all carry the new build.md path as the v8.49 default.
- `artifact-templates.ts > BUILD_TEMPLATE` shows the v8.49 row convention; "REFACTOR notes" + "Commits" sections explain the optional commit SHA when `Refactor: skipped` is declared in `build.md`. `BUILD_TEMPLATE_SOFT` carries the same v8.49 note.
- `stage-playbooks.ts > build` runbook documents the row declaration as default; "Mandatory gates per AC" (`refactor_completed_or_skipped_with_reason`, `commit_chain_intact`) accept the row declaration.
- `posture-validation.ts > POSTURE_COMMIT_PREFIXES` comment clarifies that the refactor slot can be satisfied by a build.md `Refactor: skipped` declaration (v8.49 default) in addition to `refactor(AC-N):` or legacy `refactor(AC-N) skipped:` commits.

### Metrics

- **Anti-rationalization consolidation:** 23 cross-cutting rows now live in one catalog (`src/content/anti-rationalizations.ts`, 249 lines). 13 surfaces (3 specialist prompts + 10 skill `.md` files) gained one-line pointers to the catalog instead of inlining the cross-cutting prose. The catalog is rendered to `.cclaw/lib/anti-rationalizations.md` at install (~7.8K chars).
- **Auto-trigger per-dispatch token cost:** ~79% reduction across all six stage blocks (build stage: 6447 → 1062 chars; review stage: 5670 → 932 chars). Full skill descriptions moved to a single 11.8K-char `.cclaw/lib/skills-index.md` written once at install (zero per-dispatch cost; agents read it on demand when a trigger fires).
- **Empty-commit elimination:** new flows record skipped REFACTOR phases in `build.md` rather than `git commit --allow-empty`. Reviewer accepts both shapes — no breakage for pre-v8.49 slugs already in flight or shipped.
- **Files touched:** 23 modified, 2 new (`src/content/anti-rationalizations.ts`, `tests/unit/v849-overcomplexity-sweep.test.ts`). +267 insertions / -49 deletions in modified files; +607 new lines across the two new files.
- **Tests added:** 22 tripwires in `tests/unit/v849-overcomplexity-sweep.test.ts` (5 AC-1, 6 AC-2, 7 AC-3, 4 cross-item invariants). Total suite 1131 → 1153 tests, all green.

### Files touched

- `src/content/anti-rationalizations.ts` (**new**, 249 lines) — shared catalog module: `SHARED_ANTI_RATIONALIZATIONS`, `renderAntiRationalizationsCatalog`, `ANTI_RATIONALIZATIONS_BODY`.
- `src/content/skills.ts` — `renderSkillBullet` reduced to one-line pointer; `buildAutoTriggerBlock` summary line points at `.cclaw/lib/skills-index.md`; new `renderSkillsIndex` + `SKILLS_INDEX_BODY` for the central index.
- `src/install.ts` — imports `ANTI_RATIONALIZATIONS_BODY` and `SKILLS_INDEX_BODY`; new `writeSkillsIndex` + `writeAntiRationalizationsCatalog` write the respective files to `.cclaw/lib/` during `syncCclaw`; progress events emitted for each.
- `src/content/specialist-prompts/slice-builder.ts` — rule 4 documents the three accepted refactor paths (build.md row, real commit, legacy empty commit); worked example for skipped REFACTOR leads with build.md declaration; descriptive text after `buildAutoTriggerBlock("build")` cites the v8.49 compact pointer-index + `.cclaw/lib/skills-index.md`.
- `src/content/specialist-prompts/reviewer.ts` — `test-first` and `characterization-first` posture checks accept all three refactor shapes; build.md row checked first; descriptive text cites `.cclaw/lib/skills-index.md`; anti-rationalization table cites `.cclaw/lib/anti-rationalizations.md`.
- `src/content/specialist-prompts/design.ts` — descriptive text after `buildAutoTriggerBlock("plan")` cites `.cclaw/lib/skills-index.md`; anti-rationalization table cites `.cclaw/lib/anti-rationalizations.md`.
- `src/content/specialist-prompts/critic.ts` — `Scope creep` → `Scope-creep` (aligns with the test regex pattern after auto-trigger block stripped the description prose carrying the hyphen); descriptive text after `buildAutoTriggerBlock("review")` cites `.cclaw/lib/skills-index.md`; anti-rationalization table cites `.cclaw/lib/anti-rationalizations.md`.
- `src/content/specialist-prompts/ac-author.ts` — descriptive text after `buildAutoTriggerBlock("plan")` cites `.cclaw/lib/skills-index.md`.
- `src/content/specialist-prompts/security-reviewer.ts` — descriptive text after `buildAutoTriggerBlock("review")` cites `.cclaw/lib/skills-index.md`.
- `src/content/skills/tdd-and-verification.md` — anti-rationalization table cites `.cclaw/lib/anti-rationalizations.md` (category `posture-bypass`); REFACTOR row in the rationalization table documents the build.md declaration as v8.49 default; "REFACTOR — mandatory pass" section + `(f) refactor_run_or_skipped_with_reason` gate accept the row token.
- `src/content/skills/completion-discipline.md`, `commit-hygiene.md`, `pre-edit-investigation.md`, `review-discipline.md`, `ac-discipline.md`, `receiving-feedback.md`, `debug-and-browser.md`, `triage-gate.md`, `api-evolution.md` — each gains a one-line catalog pointer at the top of its `## Common rationalizations` section.
- `src/content/artifact-templates.ts > BUILD_TEMPLATE` — TDD cycle log row format documents the v8.49 row convention; REFACTOR notes + Commits sections explain the optional refactor SHA. `BUILD_TEMPLATE_SOFT` carries the same note.
- `src/content/stage-playbooks.ts > build` runbook — "REFACTOR — keep behaviour, improve shape (mandatory)" + AC row table + "Common pitfalls" + "Mandatory gates per AC" all carry the v8.49 build.md path.
- `src/posture-validation.ts` — `POSTURE_COMMIT_PREFIXES` comment clarifies the third accepted refactor shape.
- `scripts/smoke-init.mjs` — asserts new install artifacts: `.cclaw/lib/skills-index.md` (with every `AUTO_TRIGGER_SKILL` id) and `.cclaw/lib/anti-rationalizations.md` (with all five category keys).
- `tests/unit/v849-overcomplexity-sweep.test.ts` (**new**, 358 lines, 22 tripwires) — pins every v8.49 invariant: build.md `Refactor: skipped` row in slice-builder + reviewer + tdd-and-verification + BUILD_TEMPLATE + build runbook; legacy empty-commit acceptance; compact auto-trigger block + skills-index references; 50%+ block-size reduction; 5 catalog categories with ≥3 rows each; quoted-excuse + truth shape; H2-per-category + two-column table rendering; specialist + skill catalog pointers; v8.30 top-8 two-column-table tripwire still passes; cross-item invariant (posture-bypass row references the v8.49 build.md path).
- `package.json` — version `8.48.0` → `8.49.0`.

### Backwards compatibility

- **Empty `refactor(AC-N) skipped` commits in pre-v8.49 slugs review cleanly.** The reviewer's TDD-integrity gate explicitly accepts the legacy path; no migration required for already-shipped slugs.
- **Skill `.md` files keep their `## Common rationalizations` sections.** v8.30 top-8 two-column-table tripwire is still green; the catalog pointer is additive, not replacing the per-skill table.
- **Specialist anti-rationalization tables preserve every specialist-specific row.** Design's 10 phase-skipping rows, critic's 8 pre-commitment / prediction rows, reviewer's 3 edit-discipline rows all stay in place. Only the catalog *cross-references* them.
- **All existing test budgets** (`prompt-budgets.test.ts`, `v822-orchestrator-slim.test.ts`, `v831-path-aware-trimming.test.ts`) pass without bumps — the dedup actively shrinks prompts, so budget headroom grows rather than shrinks.

## 8.48.0 — discipline skills triad + edit-discipline reviewer axis + per-AC verified flag

### Why

Three failure modes had been showing up across slugs in the v8.40-v8.47 baseline:

1. **Completion claims without fresh verification evidence.** Slice-builder slim summaries shipped `Stage: build ✅ complete` with no cited command output, no test result, no SHA proof. The rule "no completion claim without fresh evidence" was distributed across `iron-laws.ts`, `anti-slop.ts`, `tdd-and-verification.md`, and `summary-format.md` — when the rule lives in four places, it doesn't live anywhere.
2. **Sycophantic responses to review and critic findings.** "good point, you're right, let me address that" arrived as a one-line response to a `severity=required` row, followed by a fix attempt that re-opened the same finding on the next iteration. Anti-slop banned the bare token but did not install a structured response shape.
3. **Edits landing without the slice-builder having understood the target file.** The most common `axis=correctness` finding in v8.40-v8.47 was "the GREEN diff missed an invariant defined in the rest of the file" — the slice-builder had read the edit window, not the file. There was no pre-edit gate.

v8.48 ships three new auto-trigger skills (a "discipline skills triad"), an eighth reviewer axis to enforce one of them ex-post, and a per-AC verification flag that closes the loop at finalize.

### What changed

**Three new skills in `AUTO_TRIGGER_SKILLS` (17 → 20 skills).**

- **`completion-discipline.md` (always-on)** — single-purpose Iron Law concentrating "no completion claim without fresh verification evidence". Bans the sycophantic-completion vocabulary (`should work`, `looks good`, `probably works`, `I think this is done`) as the **whole** of a completion claim. Mandates that every `✅ complete` slim summary, every `Recommended next: continue`, every Findings row close, and every `ship.md > status: shipped` is paired with one of five fresh evidence shapes (command + exit code + log lines, test output excerpt, git-log proof, file:line citation, or row-close citation). Fires on `stages: ["always"]` because the rule applies to every specialist and every stage exit.
- **`receiving-feedback.md` (build / review / ship)** — anti-sycophancy gate for receiving review.md findings, critic.md gaps, security-reviewer findings, and user-named defects. Bans the bare-acknowledgement vocabulary (`good point`, `you're right`, `let me address that`, `I see your concern`, `great catch`) as the **whole** of a response. Installs a four-step response pattern: **Restate** the finding in own words, **Classify** it against the ship gate (block-ship / iterate / fyi), declare a **Plan** (fix / push-back-with-evidence / accept-warning), cite **Evidence**. The pattern is the durable record — it lands in `build.md`, `review.md`, or `ship.md`, not buried in a slim summary's `Notes:` line.
- **`pre-edit-investigation.md` (build only)** — GateGuard-style fact-forcing gate that fires before the slice-builder's FIRST `Write` / `Edit` / `MultiEdit` on any file. Three mandatory probes per file: `git log --oneline -10 -- <path>` (recent edits), `rg "<symbol>" --type <lang>` (usage sites), and a **full file read** (not just the edit window). Probe outputs land in `build.md`'s Discovery column. Fresh files (no git history) skip the gate with the literal token `new-file`. The reviewer's new `edit-discipline` axis enforces the rule ex-post — a Discovery cell missing any of the three probes (without the `new-file` token) is severity=required.

**Reviewer prompt grows from eight axes to nine** (the gated `nfr-compliance` axis stays gated; the new axis is the eighth non-gated axis). The new axis is **`edit-discipline`**:

- **Sub-check 1 — Touch-surface compliance.** Per-AC, the set of files touched by the AC's commits (`git log --grep="^[a-z]+(AC-[0-9]+)" --name-only`) must be a subset of the plan's `Touch surface` declaration for that AC. Files outside the declared surface fire severity=iterate findings; three or more open `edit-discipline` rows escalate to severity=required (the umbrella concern "build is drifting from declared scope"). Refactor commits may touch additional files only if the plan declares a `Refactor scope` for the AC.
- **Sub-check 2 — Pre-edit-investigation evidence.** Per non-fresh file in the AC's `touchSurface`, the Discovery cell must cite all three probes from `pre-edit-investigation.md`. Missing or partial probe citations fire severity=iterate findings.
- **Skip rules** — `acMode: inline` skips both sub-checks (no AC tracking); `acMode: soft` skips sub-check 1 (no AC commit prefixes); `triage.downgradeReason == "no-git"` skips both (no git log to inspect).
- The axis ships with two anti-rationalization rebuttals: "new helper files DO count toward Touch surface" and "schema touch during GREEN requires a plan amendment, not silent expansion".

The slim-summary axes counter format grows from seven letters to eight: `c=N tq=N r=N a=N cb=N s=N p=N ed=N`.

**Per-AC `AC verified:` line in every slim summary.** Each sub-agent returns one extra line:

- **slice-builder** — emits the truthful per-AC state (`AC-N=yes` only when RED+GREEN+REFACTOR landed, suite passes, Coverage line written, all five `self_review[]` rules attest `verified:true`; otherwise `=no`). Soft mode emits `feature=yes|no`.
- **reviewer** — restates slice-builder's claim, downgrading any AC with an open `required`/`critical` finding to `=no`. Reviewer's verdict is authoritative (slice-builder's claim is self-reported).
- **other specialists** (ac-author, design, critic, security-reviewer) emit `AC verified: n/a` (their stages don't change AC verification state).
- **inline mode** always emits `n/a`.

**Per-AC verified gate before finalize (orchestrator-only).** Before opening `runbooks/finalize.md`, the orchestrator parses the `AC verified:` line from both the latest slice-builder and reviewer slim summaries. Any `=no` outside `acMode: inline` refuses finalize and surfaces a structured ask (Bounce to slice-builder fix-only / Show slim summaries / Stay paused). There is no `accept-unverified-and-finalize` escape hatch — the slug stays active until every AC is `=yes` or the user types `/cc-cancel` to discard the flow.

### Skill anatomy compliance

Every new skill follows the v8.26 + v8.30 anatomy rubric: frontmatter (`name:` + `trigger:`), `# Skill: <id>` H1, Overview body, `When to use` heading, `When NOT to apply` heading, ≥2 depth sections (each new skill carries all four: Process, Common rationalizations, Red flags, Verification), worked examples. The v8.30 top-8 rationalizations-table rubric is not extended to these three new skills (the rubric is opt-in for skills outside the load-bearing top-8); each new skill carries the rationalization table anyway because the failure modes they catch are concretely rationalization-driven.

### Files touched

- `src/content/skills/completion-discipline.md` (new, ~145 lines) — always-on skill body.
- `src/content/skills/receiving-feedback.md` (new, ~193 lines) — build/review/ship skill body.
- `src/content/skills/pre-edit-investigation.md` (new, ~178 lines) — build skill body.
- `src/content/skills.ts` — three new `AUTO_TRIGGER_SKILLS` entries (id, fileName, description, triggers, stages, body via `readSkill`); skill count 17 → 20.
- `src/content/specialist-prompts/slice-builder.ts` — Hard rule #18 added (pre-edit-investigation gate mandatory; cites `.cclaw/lib/skills/pre-edit-investigation.md`; names the three probes + new-file token); RED phase Discovery section reshaped to require the three probes; slim summary template grows the `AC verified:` line + semantics paragraph (~600 chars).
- `src/content/specialist-prompts/reviewer.ts` — header bumped "Eight-axis review" → "Nine-axis review"; new `edit-discipline` axis added to the axis table with examples; new `### Edit-discipline axis details` H3 section with both sub-checks + skip rules + anti-rationalization rows; per-axis checklist gains `[edit-discipline]` block; axes counter format gains `ed=N`; dedup key axis list extended; slim summary grows the `AC verified:` line + semantics paragraph; JSON example updated.
- `src/content/start-command.ts` — `SUMMARY_RETURN_EXAMPLE` grows the `AC verified:` line; canonical `AC verified` semantics paragraph; hard-gate logic mentions the v8.48 finalize gate; Finalize section gains a one-paragraph pointer to the runbook's full Per-AC verified gate procedure.
- `src/content/runbooks-on-demand.ts > FINALIZE` — full Per-AC verified gate procedure lifted to the runbook (~1.7K chars): gate steps, edge cases, structured-ask shape, no-escape-hatch rationale. Step 1 of the standard finalize sequence cites the gate as a precondition.
- `tests/unit/v848-discipline-skills.test.ts` (new, ~365 lines, 61 tripwires) — pins every invariant of the v8.48 contract: three skills registered with correct stages; total count is 20; forbidden-phrase lists per skill match the brief verbatim; receiving-feedback four-step pattern + three classification values + three plan shapes; pre-edit-investigation three probes + fresh-file exception + Discovery surface; slice-builder cites pre-edit-investigation + names the three probes + names the `new-file` token; reviewer header bumped to "Nine-axis review" + edit-discipline axis row + `[edit-discipline]` checklist + `ed=N` counter + anti-rationalization rows; per-AC `AC verified:` line in start-command + slice-builder + reviewer + the three shapes (strict/soft/inline); orchestrator pre-finalize gate cites both summaries + skips on inline + refuses + no auto-rescue; new skills pass the v8.26 anatomy rubric (frontmatter, H1, Overview, When-to-use, When-NOT-to-apply, ≥2 depth sections); install layer references resolve.
- `tests/unit/v813-cleanup.test.ts` — axis-count regex extended `/Nine-axis review|Eight-axis review|Seven-axis review/` (was `/Eight-axis review|Seven-axis review/`).
- `tests/unit/prompt-budgets.test.ts` — slice-builder `maxChars` raised 60000 → 62000 (~3% growth) to absorb the pre-edit-investigation rule, the RED-phase Discovery probe block, and the `AC verified:` slim-summary line + semantics paragraph.
- `tests/unit/v822-orchestrator-slim.test.ts` (AC-4) — start-command body `maxChars` raised 49000 → 51000 (~4% growth) to absorb the `AC verified:` slim-summary line + semantics paragraph + finalize-precondition pointer; combined body + runbooks soft ceiling raised 110000 → 115000 (~4.5% growth) to absorb the full Per-AC verified gate procedure in `runbooks/finalize.md`.
- `tests/unit/v831-path-aware-trimming.test.ts` (AC-1, AC-2) — same start-command body 49000 → 51000 bump for body-only + inline-path budgets; baseline ratio raised 1.07 → 1.13 to give one slug of headroom past v8.30.
- `package.json` — version 8.47.0 → 8.48.0.
- `CHANGELOG.md` — this entry.

### Tests

1131 tests across 72 files, all green (+61 net from `v848-discipline-skills.test.ts`; +1 file count). Smoke runtime green (the 20 skill files mirror correctly into `.cclaw/lib/skills/` + `cclaw-meta.md`). TypeScript strict mode green throughout.

### Migration notes

- **No schema changes.** No new TypeScript types, no new YAML frontmatter keys, no new `flow-state.json` fields. The `AC verified:` line is prose in the slim summary; the orchestrator parses it at finalize time. The reviewer's `edit-discipline` axis is a new value in the existing `axis` column of the Findings table; no migration needed for in-flight `review.md` files.
- **In-flight flows continue.** Resuming a pre-v8.48 slug mid-build: slice-builder picks up the v8.48 pre-edit-investigation rule on its next dispatch (Discovery cells from prior iterations stay as they are; the reviewer flags missing probes if `edit-discipline` would have fired). The `AC verified:` line is missing from prior slim summaries — the orchestrator's gate treats this as `every AC = no` and surfaces a structured ask before finalize. The user picks fix-only (re-emit the slim summary with the line) or stay-paused (read the prior summaries first).
- **No new specialists; no changes to ac-author / critic / security-reviewer.** Only slice-builder and reviewer prompts changed; the new skills auto-inject via `buildAutoTriggerBlock(stage)`.
- **Budget tripwires bumped, not removed.** Six bumps total (prompt-budgets slice-builder 60k → 62k; v8.22 body 49k → 51k; v8.22 combined 110k → 115k; v8.31 body 49k → 51k; v8.31 inline 49k → 51k; v8.31 ratio 1.07 → 1.13). Each has an explicit `v8.48` rationale-in-message; the broader char-budget discipline is preserved.
- **No knowledge CLI.** Explicitly out of v8.48 scope.
- **No caveman / density changes.** Separate slug later.
- **Anti-rationalization consolidation deferred.** The brief explicitly scopes anti-rationalization consolidation to v8.49; the two anti-rationalization rows added to the reviewer in v8.48 are the edit-discipline-specific rows, not a consolidation pass.

## 8.47.0 — design phases UX collapse (6-10 user turns → 1-2 turns)

### Why

The pre-v8.47 design specialist (`src/content/specialist-prompts/design.ts`) ran a 7-phase user-collaborative protocol on the large-risky path (Bootstrap silently → Clarify 0-3 turns one-question-at-a-time → Frame 1 turn confirm → Approaches 1 turn pick A/B/C → Decisions N turns one-D-N-at-a-time → Pre-mortem 1 turn review → Compose silently → Sign-off 1 turn approve). That added up to **6-10 user turns** for a single large-risky slug BEFORE ac-author could even run.

Reference designs (gstack office-hours, superpowers brainstorming, addy spec-driven-development) achieve similar analytical depth in 1-3 user turns by batching clarifying questions and surfacing the full composed design only once for review. v8.47 imports that pacing into cclaw's design specialist without reducing conceptual depth — all 7 phases still execute, all plan.md sections still get written, the pre-mortem still runs on deep posture, ADR triggers still fire, prior learnings are still consulted.

### What changed

**Design specialist now pauses for user input at MOST twice per design flow:**

- **Phase 1 (Clarify) — conditional, single batched ask.** When clarifying questions are needed (the prompt has a real ambiguity that triage didn't resolve), design enumerates up to 3 questions and emits them in ONE batched `askUserQuestion` call. The pre-v8.47 pattern asked one question per turn (so 3 questions = 3 user turns); v8.47 batches them into one turn. When zero questions are needed, Phase 1 is skipped entirely — the user sees no Phase 1 surface at all.
- **Phase 7 (Sign-off) — mandatory, single review.** Design composes the full plan.md design portion (Frame, Spec, Non-functional when triggered, Approaches + Selected Direction, Decisions inline, Pre-mortem on deep, Not Doing, Open questions, Summary — design) and emits the rendered design with a three-option structured ask: `approve` / `request-changes` / `reject`.

**Phases 2-6 + 6.5 execute SILENTLY in the same orchestrator turn.** No `askUserQuestion` mid-flight. The phases still happen — design composes the Frame, analyzes 2-3 approaches and picks one with rationale, enumerates D-N decisions, runs the pre-mortem on deep posture, runs the self-review checklist, proposes ADRs on triggers — but it does all of that in one orchestrator turn between (a) the Phase 1 reply landing (or Phase 0 finishing when Phase 1 is skipped) and (b) the Phase 7 emit.

**`request-changes` revise loop is capped at 3 iterations.** The user describes what to change ("swap D-2 to use streaming", "Frame should mention the dashboard widget", "pre-mortem missed the rate-limit risk"); design re-runs the affected silent phase(s) internally, updates plan.md in place, re-runs the self-review checklist, and re-emits Phase 7 with the revised design plus a one-line diff summary. On the 4th revise request, design escalates explicitly — emits a picker with `approve as-is` / `reject` / `revise one more time` — to avoid silent infinite-loop dialogues.

**`reject` writes a `## Design rejected` note to plan.md** and surfaces the rejection to the orchestrator, which routes the user to `/cc-cancel` or re-triage.

### What's preserved (depth, not pacing)

- All 7 phases (Bootstrap, Clarify, Frame, Approaches, Decisions, Pre-mortem, Compose) + Phase 6.5 ADR + Phase 7 Sign-off still execute conceptually. Phase headers carry an explicit `[SILENT]` or `[ENDS TURN]` marker so the agent knows which phases pause the user and which run in the same orchestrator turn.
- All plan.md sections still get filled: `## Frame`, `## Spec` (v8.46 mandatory), `## Non-functional` when triggered, `## Approaches`, `## Selected Direction`, `## Decisions` (D-1..D-N inline), `## Pre-mortem` (deep posture only), `## Not Doing`, `## Open questions`, `## Summary — design`.
- ADR proposal logic (Phase 6.5) still runs when triggers fire (new public interface, persistence shape change, security boundary, new runtime dependency, architectural pattern + deep posture OR explicit `--adr`); proposed ADRs land at `docs/decisions/ADR-NNNN-<slug>.md` with status PROPOSED.
- Posture detection (guided vs deep) is unchanged. Pre-mortem still skips on guided posture.
- `triage.assumptions` handling stays correct: design Phase 0 + Phase 1 own the assumption surface on the large-risky path; pre-seeded assumptions are read as ground truth without re-prompting.
- Prior learnings (`triage.priorLearnings`) are still consulted in Phase 1 / Frame as background context.
- `repo-research` parallel dispatch in Phase 0 still works (brownfield + no prior `research-repo.md`).
- 9-rule self-review checklist still gates Phase 7 (including the v8.46 Spec rule).
- The Iron rule still forbids writing code / AC / pseudocode in design; v8.47 added one more clause: "if you find yourself wanting to pause mid-flight between Phases 2 and 6, STOP — those phases are SILENT in v8.47+".

### What's not preserved (intentional)

- **Fine-grained per-phase user steering.** Pre-v8.47, the user could redirect at every phase (revise frame, ask follow-up about approach, revise D-2 alternatives, add a pre-mortem entry). v8.47 collapses all of that into a single Phase 7 `request-changes` ask. The trade-off is the design as a whole gets reviewed once with full context rather than piecemeal — analogous to a code review on the final diff rather than commit-by-commit.

### Files touched

- `src/content/specialist-prompts/design.ts` (+144 / -168 net; 390 → 365 file lines; runtime `DESIGN_PROMPT` body grew from ~31500 chars → 41075 chars after the buildAutoTriggerBlock substitution) — the main rewrite. Opening summary updated ("single, multi-turn, user-collaborative phase" → "single, mostly-silent, two-turn-at-most user-collaborative phase"). Run-mode rewritten (was "ALWAYS step"; now "at most twice per flow — Phase 1 + Phase 7"). Iron rule gained a paragraph warning against silent-phase pauses. Phase headers gained explicit `[SILENT]` / `[ENDS TURN]` markers. Phase 1 instructions rewritten for batched ask (0-3 questions in one call). Phases 2-6 + 6.5 rewritten to remove all `askUserQuestion` references; each phase now writes its plan.md section then flows silently to the next. Phase 7 fully rewritten — three-option picker (`approve` / `request-changes` / `reject`), explicit revise-loop semantics with 3-iteration cap, explicit 4th-request escalation prose, `## Design rejected` handling on reject. Anti-rationalization table grew by 2 rows (pause-to-confirm-Frame / ask-mid-flight-about-D-2). Common pitfalls grew by 2 bullets (pause-between-silent-phases / request-changes-not-free-retry). Output schema and Composition sections updated for the new turn semantics.
- `src/content/start-command.ts` (+357 chars / 6 lines net) — large-risky plan section explicitly declares the v8.47+ two-turn-max pacing; Phase 1 reference updated to "batched 0-3 questions"; auto-mode hard-gate list mentions "Phase 1 conditional ask + Phase 7 mandatory sign-off fire regardless of runMode" instead of "per-phase pauses fire regardless of runMode".
- `src/content/runbooks-on-demand.ts` — `discovery.md` runbook updated to describe the v8.47 pacing (Phase 1 conditional + Phase 7 mandatory + revise loop with 3-iteration cap + reject path) instead of "design pauses end-of-turn between each of its internal phases"; `pause-resume.md` runbook reference to "per-phase pauses" updated to "Phase 1 + Phase 7 pauses"; `handoff-artifacts.md` runbook note about design's internal pauses updated to mention only Phase 1.
- `src/content/specialist-prompts/ac-author.ts` (no changes) — ac-author runs as a sub-agent AFTER design's Phase 7 `approve`; nothing about ac-author's contract changed. The plan.md it reads still has the same sections it had pre-v8.47.
- `tests/unit/v847-design-phases-collapse.test.ts` (new, +291 lines, 32 tripwires) — pins every invariant of the v8.47 contract: two-turn-max pacing declared, Phases 2-6 explicitly marked SILENT, Phase 1 + Phase 7 are the only ENDS-TURN phases, legacy "one phase per turn" / "ALWAYS step" framing removed, Phase 1 batched-ask shape (0-3 questions in one call, conditional skip, 3-question cap), Phase 7 three-option picker (approve / request-changes / reject) + 3-iteration revise cap + 4th-request escalation + Design rejected note, all 7 phases + Phase 6.5 + Phase 7 still in the prompt, all plan.md sections still authored, posture detection preserved, ADR logic preserved, prior learnings still consulted, repo-research parallel dispatch preserved, 9-rule self-review checklist preserved, Iron rule warns against silent-phase pauses, anti-rationalization table includes the new temptation rows, start-command's dispatch envelope reflects new pacing, discovery.md runbook describes the revise loop + reject path, ac-author untouched.
- `tests/unit/h4-content-depth.test.ts` (+5 / -2) — "ALWAYS step" assertion replaced with "two-turn-at-most" / "at MOST twice" assertion.
- `tests/unit/v811-cleanup.test.ts` (+10 / -7) — discovery-pause assertion updated for v8.47 pacing prose; the renamed describe block now reads "v8.11+v8.14+v8.47 — discovery phases run inside design; v8.47 two-turn-max pacing".
- `tests/unit/v88-cleanup.test.ts` (+5 / -2) — Phase 1 assertion updated for batched-ask language ("ONE batched" / "single batched" / "0-3 questions") instead of "ask one" / "ONE question per turn".
- `tests/unit/prompt-budgets.test.ts` — design `maxChars` bumped from 32000 → 42000 (~31% growth). See the test file comment for the per-section rationale.
- `tests/unit/v822-orchestrator-slim.test.ts` (AC-4) — start-command body `maxChars` bumped from 48000 → 49000 (~2% growth) to absorb v8.47's ~300-char addition to the large-risky plan section.
- `tests/unit/v831-path-aware-trimming.test.ts` (AC-1, AC-2) — same 48000 → 49000 bumps for the body-only budget and the inline-path budget (inline path reads body alone).

### Tests

1070 tests across 71 files, all green (+32 net from `v847-design-phases-collapse.test.ts`; +1 file count). Smoke runtime green. TypeScript strict mode green throughout.

### Migration notes

- **In-flight large-risky flows continue.** Resuming a pre-v8.47 design flow mid-Phase-N continues with the v8.47+ contract: the next orchestrator turn batches whatever phases remain and emits at Phase 7. The flow-state schema is unchanged; no migration is needed for `flow-state.json` or in-flight `plan.md` files.
- **New flows use the new pacing.** Any `/cc <task>` invocation post-v8.47 that triages to large-risky and dispatches design will pause for user input at most twice (Phase 1 if needed, Phase 7 always). The user observes a single sign-off review instead of six-to-ten per-phase confirmations.
- **No schema changes.** No new TypeScript types, no new YAML frontmatter keys, no new `flow-state.json` fields, no changes to `TriageDecision` or `AcceptanceCriterionState`. Phase 7's revise iteration count is recorded inline in plan.md under `## Open questions > revise_iterations: <N>` (a simple line, not a frontmatter field).
- **No new specialist; no changes to ac-author / slice-builder / reviewer / critic / security-reviewer.** Only design's prompt body changed. ac-author dispatch contract is identical post-v8.47.
- **Budget tripwires bumped, not removed.** Three tripwires moved (prompt-budgets design 32k → 42k; v8.22 + v8.31 start-command body 48k → 49k) with explicit rationale-in-message; the broader char-budget discipline is preserved.

## 8.46.0 — Spec section in plan.md + README accuracy rewrite

### Why

Two unrelated issues had been compounding on the small-medium path. **One:** Acceptance Criteria were silently doing double duty as both the requirement contract (what we're building) AND the pass/fail contract (how we know it's done). The Frame paragraph captured intent narratively, but downstream specialists (reviewer, critic) and the user had no single structured place to scan the requirement at a glance — they had to reread the Frame prose to answer "what was this slug supposed to do?". Large-risky plans had Frame + NFR rows, but small-medium plans had neither — just a Plan paragraph and an AC table. **Two:** the README had accreted multiple factual inaccuracies through v8.29-v8.45 — `npx cclaw-cli init` referenced after `init` was retired in v8.29, "five-axis review" in one paragraph contradicted "7-axis pass" two paragraphs later, `architect` decisions referenced after architect was retired in v8.14, and four `docs/*` links pointing to a directory that was removed in v8.29.

v8.46 closes both gaps in one slug.

### What changed

**Change 1 — `## Spec` section in `plan.md` (above `## Acceptance Criteria`).** Every plan.md now carries a four-bullet Spec section: Objective (what we're building and why, one short line), Success (high-level indicators a stakeholder would observe — not the AC bullets), Out of scope (explicit non-goals), Boundaries (per-slug "ask first" / "never do" notes layered on top of the iron-laws). The section is mandatory on every plan.md regardless of mode — both strict (large-risky) and soft (small-medium) — with one exception: the inline / trivial path has no plan.md, so no Spec. Each bullet MUST carry content or an explicit `none` / `n/a`; `<TBD>`, empty values, or pasting the user's prompt verbatim are not acceptable. The reviewer treats a missing / empty / `<TBD>` Spec section as a `required` finding (axis=correctness). On large-risky plans, `design` Phase 2 (Frame) authors the Spec alongside the existing NFR rows (Spec captures intent + scope; NFRs capture quality attributes — complementary, not duplicative). On small-medium plans, `ac-author` authors the Spec as part of its standard plan-body authoring. The 7-axis (+ gated `nfr-compliance`) review count is unchanged — Spec compliance is implicitly covered by the existing `correctness` / `architecture` / `complexity-budget` axes (build doesn't match Objective => correctness; scope creep past Out of scope => architecture / complexity-budget). No new schema fields, no new YAML keys, no new reviewer axis.

**Change 2 — README rewrite.** Audited every command, file path, and link in `README.md` against the live source. Fixed:

- **"five-axis review" → "seven-axis review"** in the Why section, matching the long-standing 7-axis claim (correctness · test-quality · readability · architecture · complexity-budget · security · perf) in the same file two paragraphs lower. The gated eighth axis (`nfr-compliance`, v8.25) is named explicitly when the table mentions it.
- **`npx cclaw-cli init` → `npx cclaw-cli@latest`** throughout the Quickstart and Harnesses sections. `init` was retired in v8.29 (TUI menu replaced bare subcommands). CI / scripted installs documented as `npx cclaw-cli@latest --non-interactive install [--harness=<id>[,<id>]]`.
- **"6 sub-agents" → "5 sub-agents + 1 main-context coordinator (design)"** in the Specialists row. `design` runs in main orchestrator context (multi-turn, user-collaborative) since v8.14 and is not a sub-agent.
- **"architect decision" → "design decision"** in the Compound learnings row. `architect` was retired in v8.14 and replaced by `design`. (The internal frontmatter field `has_architect_decision` is kept as a stable name across the rename; the user-facing prose now matches the v8.14+ specialist name.)
- **Four `docs/*` links removed.** `docs/scheme-of-work.md`, `docs/skills.md`, `docs/harnesses.md`, `docs/quality-gates.md`, `docs/config.md` — all references retired in v8.29 when the directory was removed. Replaced with pointers into `src/content/start-command.ts`, `src/content/specialist-prompts/`, `src/content/skills/`, `src/content/runbooks-on-demand.ts`, `src/content/artifact-templates.ts`. CHANGELOG.md is now the canonical release-history reference.
- **`cclaw init` / `cclaw sync` / `cclaw upgrade` / bare CLI subcommands removed.** The full CLI surface now shows two invocations — `npx cclaw-cli@latest` (TUI, default) and `npx cclaw-cli@latest --non-interactive <command>` (CI / scripts). The five non-interactive commands match `src/cli.ts > NON_INTERACTIVE_COMMANDS` exactly: `install`, `uninstall`, `knowledge`, `version`, `help`.
- **Worked-example boxes** are now explicitly framed as "illustrative — the actual orchestrator output is a sequence of slim-summary blocks under section headers, not boxed UI". Honest about what cclaw renders versus what makes a useful README example.
- **Skill count "17"** verified against `ls src/content/skills/ | wc -l` (17 .md files; v8.44 retired 5 unwired zombies — none of those were counted in the README anyway).
- **`## Spec` mentioned in the "What you get" Plan template row** so new users see the v8.46 addition in the feature table.

### Tests

1038 tests across 70 files, all green (+20 net, +1 file). Test updates:

- **New: `tests/unit/v846-spec-section.test.ts`** — 20 tripwires across the v8.46 contract: PLAN_TEMPLATE (strict + soft) carries `## Spec` with all four canonical bullets above `## Acceptance Criteria` / `## Testable conditions`; ac-author prompt declares Spec mandatory and gates its self-review on Spec presence; design Phase 2 authors the Spec and frames Spec vs NFR as complementary (intent vs quality); no new reviewer axis is introduced (7-axis count + gated `nfr-compliance` stable); no new frontmatter keys added.
- **Updated: `tests/unit/h4-content-depth.test.ts`** — plan-template assertion now also checks for `## Spec` alongside the existing `## Frame` / `## Approaches` / `## Acceptance Criteria` / `## Edge cases` / `## Topology` / `## Traceability block` checks.

### Files touched

- `src/content/artifact-templates.ts` (+33 / -1) — `PLAN_TEMPLATE` and `PLAN_TEMPLATE_SOFT` both gain the `## Spec` block (four bullets + prose preamble + reviewer-axis cross-reference). Position: between `## Plan` (or after `## Plan` paragraph for soft) and `## Acceptance Criteria` (or `## Testable conditions` for soft).
- `src/content/specialist-prompts/ac-author.ts` (+50 / -3) — new top-level "Spec section" subsection naming all four bullets with example shapes; strict-mode output schema reordered to list Spec between Plan and AC; soft-mode worked example carries a Spec block; strict-mode worked example carries a Spec block; self-review checklist gains rule #17 (Spec present and filled).
- `src/content/specialist-prompts/design.ts` (+24 / -8) — Phase 2 (Frame) authors the Spec section alongside the existing NFR rows; explicit Spec-vs-NFR framing (intent + scope vs quality attributes); Phase 6 compose-order list reordered to put `## Spec` immediately after `## Frame` and above `## Non-functional`; self-review checklist grows from 8 to 9 rules (rule #9 covers Spec).
- `tests/unit/v846-spec-section.test.ts` (new, +172) — 20 tripwires per the test plan above.
- `tests/unit/h4-content-depth.test.ts` (+2 / -1) — additional Spec-section assertion in the existing plan-template lean-shape test.
- `README.md` (+131 / -153, net -22) — accuracy rewrite per Change 2. 195 → 173 lines.
- `CHANGELOG.md` — this section.
- `package.json` — `8.45.0` → `8.46.0`.

### Migration notes

- **Backward compatible.** Existing in-flight `plan.md` files in user repos may not have `## Spec` — they continue to work. The template applies to new plan.md files going forward. If the user runs `/cc` on a resumed slug and `ac-author` edits the plan, it can add `## Spec` lazily (the prompt mentions this on the small-medium path).
- **No schema changes.** No new frontmatter keys, no new TypeScript types, no new YAML fields. The Spec section is a body-only addition.
- **No new reviewer axis.** 7-axis review (+ gated `nfr-compliance` from v8.25) is unchanged. Spec compliance is implicitly covered by the existing axes — a build that doesn't match the recorded Objective is a `correctness` finding; scope creep past `Out of scope` is an `architecture` / `complexity-budget` finding. The brief explicitly forbids adding an 8th un-gated axis.
- **Inline / trivial path unaffected.** Trivial slugs (`acMode: inline`) do not produce a `plan.md` and therefore have no Spec section.
- **design's 7-phase structure unchanged.** Phase 2 (Frame) gains one more sub-task (author the Spec section) but the seven phases (Bootstrap / Clarify / Frame / Approaches / Decisions / Pre-mortem / Compose+self-review / Sign-off) keep their boundaries.

### Out of scope (deferred)

- **`slug` → `task name` narrative rename.** Same reasoning as v8.45 — the term is the same identifier as the `slug:` frontmatter field; a surgical narrative-only rename produces inconsistent prose. Considered for a future vocabulary slug that addresses field names and prose together.
- **`acMode` → `review level` and `posture` → `TDD style` narrative renames.** Same reasoning as v8.45.

## 8.45.0 — User-facing surface polish: descriptive stage names, plain-English vocabulary, quickstart README

### Why

The v8.x orchestrator surface accreted invented jargon over a year of releases. New users hit a wall of cclaw-internal vocabulary on first contact: numbered "Hops" (1, 2, 2.5, 3, 4, 4.5, 5, 6) for the orchestrator steps, "Concern Ledger" for the reviewer's findings table, plus deep-dive terms like `slug`, `acMode`, and `posture` baked into user-facing narrative. The README compounded the friction by leading with a 3000-character architecture paragraph instead of `npx cclaw-cli init` + `/cc <task>`. v8.45 polishes the user-facing surface without touching behavior, schemas, or specialist contracts.

### What changed

**Descriptive stage names replace numbered Hops.** The orchestrator no longer labels its steps `Hop 1`..`Hop 7` (with `Hop 2.5` and `Hop 4.5` for half-steps). Every label is now a descriptive name a new reader can place: detect, triage, preflight, dispatch, pause/resume, critic step, ship step, compound, finalize. Section headers in `src/content/start-command.ts`, cross-references in `src/content/runbooks-on-demand.ts`, every specialist prompt's "Invoked by" line, every skill body's stage references, and every test assertion about stage headings updated in lockstep. The 7-stage flow is unchanged; only the labels changed.

**Plain-English vocabulary in narrative prose.** The reviewer's append-only finding table is now called the **Findings** table in user-facing narrative — both the artifact section header (`## Findings` in `review.md` template) and every prompt sentence that names the structure. Type names, frontmatter field names, enum values, and the `F-N` record format are unchanged. (Other vocab renames considered for v8.45 — `slug` → `task name`, `acMode` → `review level`, `posture` → `TDD style` — were left as a follow-up because the terms are tightly coupled to TypeScript field names, YAML frontmatter keys, and per-prompt technical references; surgical narrative-only renames would have introduced inconsistency without buying enough clarity. See `## Migration notes` below.)

**README rewritten as quickstart-first.** The previous README led with a 350-line architecture spec listing every release back to v8.0 inline. The new README is 195 lines: one-line tagline, 5-bullet "Why cclaw", 3-step quickstart (`npx cclaw-cli init` → `/cc <task>` → inspect `.cclaw/flows/<task-name>/`), a worked example walking through triage → plan → build → review → critic → ship for a real task, a brief "What you get" feature table, supported harnesses, configuration knobs, and pointers into `src/content/` and `docs/` for the curious. Show-don't-tell — actual user inputs and orchestrator outputs in ASCII boxes — and minimal jargon in the first half. Old depth content moved to `CHANGELOG.md` (this file) and the `docs/` pointers.

### Migration notes

- **No behavior changes.** Schema unchanged. Frontmatter field names (`slug:`, `acMode:`, `posture:`) unchanged. TypeScript types (`currentSlug`, `AcMode`, `Posture`) unchanged. Enum values (`inline` / `soft` / `strict`, `test-first` / `refactor-only` / …) unchanged. Record format (`F-1`, `D-1`, `G-1`) unchanged.
- **Existing flows continue to work.** `flow-state.json` schema is unchanged. Resumed flows with pre-v8.45 prompts on disk (whose section headers say "Hop 4") continue to resume correctly — the orchestrator never reads its own prompt back to navigate.
- **Old prompts referenced "Hop N" labels; new prompts use descriptive names.** Anyone reading shipped prompts for archaeology will see both vocabularies across release boundaries. The `CHANGELOG.md` history pre-v8.45 still uses the numbered vocabulary; the descriptive names appear in `src/content/` only from v8.45 onward.
- **Reviewer's findings table is now `## Findings` in `review.md`.** Pre-v8.45 `review.md` artifacts have `## Concern Ledger` headers; new artifacts have `## Findings`. The append-only invariant, the `F-N` record format, and the convergence detector are unchanged.
- **One budget tripwire shifted slightly.** `start-command.ts` body grew from 47905 → 47941 chars (one new stage's worth of readable headings: "Pause and resume" is longer than "Hop 4"). The ratio assertion against the v8.30 baseline (`tests/unit/v831-path-aware-trimming.test.ts > AC-1`) moved from `≤ 1.06` to `≤ 1.07` to absorb the +36-char readability cost. Char-count tripwires (≤ 48000 body, ≤ 110k combined with runbooks) are unchanged.

### Tests

1018 tests across 69 files, all green. Test updates:

- `tests/unit/start-command.test.ts` — stage sequence assertion now checks for descriptive headings (`## Detect`, `## Triage`, `## Dispatch`, `## Pause and resume`, `## Compound`) instead of `Hop N` labels.
- `tests/unit/v821-preflight-fold.test.ts` — "no separate Hop 2.5" assertion renamed to "no separate preflight step".
- `tests/unit/v822-orchestrator-slim.test.ts` — `## Hop 6 — Finalize` header assertion renamed to `## Finalize`.
- `tests/unit/v823-no-git-fallback.test.ts` — `Hop 1 git-check` assertions renamed to `Detect git-check`.
- `tests/unit/v831-path-aware-trimming.test.ts` — body ratio tripwire lifted from 1.06 → 1.07.
- `tests/unit/v818-knowledge-surfacing.test.ts` — `Hop 2 §3 — prior-learnings lookup` heading match updated to `### Prior-learnings lookup`.
- `tests/integration/critic-hop.test.ts` — `#### critic (Hop 4.5)` heading match updated to `#### critic (critic step)`.
- `tests/unit/v818-knowledge-surfacing.test.ts`, `tests/unit/v816-cleanup.test.ts`, `tests/unit/artifact-templates.test.ts`, `tests/unit/h4-content-depth.test.ts` — "Concern Ledger" assertions updated to "Findings".

### Files touched

- `src/content/start-command.ts` (76 line diff) — every stage section header + every "see Hop N" cross-reference + the introduction's 7-step list + the `## Findings` references.
- `src/content/runbooks-on-demand.ts` (46 line diff) — `Hop N` references in runbook titles and bodies; the finalize runbook header and the critic-stage runbook title.
- `src/content/specialist-prompts/{reviewer,critic,slice-builder,security-reviewer,design,ac-author}.ts` (~70 line diff) — "Invoked by: cclaw orchestrator Hop N" lines, critic.ts's "You run at Hop 4.5" opening, reviewer.ts's Concern Ledger references.
- `src/content/skills/{triage-gate,pre-flight-assumptions,flow-resume,documentation-and-adrs,summary-format,review-discipline}.md` (~60 line diff) — narrative Hop references and Concern Ledger references.
- `src/content/{artifact-templates,core-agents,skills,stage-playbooks}.ts` (~30 line diff) — template body headers + JSDoc stage references + the `## Findings` rename in the review template.
- `README.md` — full rewrite (367 → 195 lines).
- `CHANGELOG.md` — this section.
- `package.json` — `8.44.0` → `8.45.0`.

### Out of scope (deferred to v8.46+)

- Full `slug` → `task name` rename in narrative prose. The term is technically the same identifier as the `slug:` frontmatter field; a surgical rename without touching the field name produced inconsistent prose. Deferred until the field itself can be considered.
- `acMode` → `review level` and `posture` → `TDD style` narrative renames. Both terms appear in heavily technical contexts (field-name references, JSON examples, type signatures) that would have produced split vocabulary. Considered for a future "vocabulary v2" slug that addresses field names and prose together.
- The design specialist's 7 phases. The v8.45 brief explicitly excluded design from the polish pass (it's v8.46 territory).

## 8.13.0 — Power-and-economy release: speed/token wins, plan-build-review-ship power, verification loop, handoff artifacts, compound refresh, model-routing config, namespace router, two-reviewer loop

### Why

A multi-subagent audit (10+ parallel agents across the same eleven reference repos as v8.12 plus an internal review of cclaw's runtime + prompts) surfaced four classes of opportunity in the 8.12 baseline:

1. **Speed and token economy.** Sequential research-helper dispatch forced a round-trip the planner could batch. Two-question forms in Hop 2 triage cost a user round-trip per fresh flow. Three parallel reviewers re-parsed the same `git diff`. The discovery sub-phase always ran end-to-end even when triage confidence was high. Compound moved a hard-coded list of files instead of scanning the active flow directory.
2. **Stage power.** Plans had no per-AC `dependsOn` graph or `rollback` plan. There was no `feasibility_stamp` to gate build dispatch. Slice-builder enumerated tests but not refactor candidates and had no non-functional check between GREEN and REFACTOR. Reviewer used five axes when seven would let test-quality and complexity-budget produce independent signals. Ship had no CI smoke gate; release notes were free-form prose; learnings were silently skipped on non-trivial slugs that didn't trigger the gate.
3. **Missing capabilities.** No verification-loop skill (build → typecheck → lint → test → security → diff staged gate). No prompt-size budget tests. No handoff artefacts for cross-session resumption. No compound-refresh dedup pass. No token-cost telemetry. No anti-rationalization table on TDD-cycle. No `## What didn't work` section in ship. No discoverability self-check after compound.
4. **Architectural ceilings.** No category-based model routing (no way for harnesses to express "planner = powerful, learnings-research = fast"). No namespace router (`/cc-plan`, `/cc-build`, etc.) for harnesses with command palettes. No two-reviewer per-task loop for high-risk slugs.

### What changed

**T0 — Speed and token wins.** Planner dispatches `learnings-research` and `repo-research` in the same tool-call batch (do NOT serialise), saving one LLM round-trip per plan. Hop 2 triage uses a single multi-question `askUserQuestion` form (path + run-mode in one call), saving one user round-trip per fresh flow. Ship parallel reviewers receive a shared parsed-diff context — orchestrator parses `git diff` once and passes the result to all three reviewers. Discovery auto-skip heuristic for `triage.confidence: high` large-risky tasks goes straight from triage to planner, skipping brainstormer + architect (saves two specialist dispatches and two user pauses). `compound.runCompoundAndShip` scans the active flow directory dynamically for emitted files and moves them all to `shipped/<slug>/` (no orphans).

**T1 — Plan stage power.** `plan.md` template carries `dependsOn: []` and `rollback: "..."` per AC in frontmatter. Planner self-review enforces `dependsOn` is acyclic and produces a topological commit order. `feasibility_stamp: green | yellow | red` is computed from coverage of unknowns, schema impact, and risk concentration; a `red` stamp blocks build dispatch. Cross-specialist research cache section in `planner.ts` says `flows/<slug>/research-repo.md` and the learnings-research blob must NOT be re-dispatched by subsequent specialists when fresh.

**T1 — Build stage power.** Slice-builder runs non-functional checks per AC between GREEN and REFACTOR: branch-coverage delta, perf-smoke, plus triggered checks for schema/migration and API contract diff. Refactor-only AC require explicit `No-behavioural-delta` evidence (anchored test, before/after diff, no public-API drift). Refactor candidate inventory section enumerates duplication, long methods, shallow modules, feature envy, primitive obsession with explicit verdicts. Hard rule: never refactor while RED. Parallel-build fallback to inline-sequential is no longer silent — explicit warning, user accept-fallback required, `fallback_reason` recorded in `build.md`.

**T1 — Review stage power.** Reviewer uses seven axes (`correctness · test-quality · readability · architecture · complexity-budget · security · performance`); slim-summary axes counter is `c=N tq=N r=N a=N cb=N s=N p=N`. Auto-detect security-sensitive surfaces from the diff regardless of `security_flag` (auth, secrets, crypto, supply-chain, data exposure, IPC). Adversarial pre-mortem rerun on fix-only hot paths (same file/symbol surfaced findings in 3+ iterations) appends a `## Pre-mortem (adversarial, rerun)` section. 5-iteration cap produces a structured split-plan recovery: `Recommended split` block (separate AC, separate slug, separate ship) instead of nuking the flow.

**T1 — Ship stage power.** CI smoke gate is mandatory: lint + typecheck + unit-test before manifest stamp; three modes (strict / relevant / skip with `--ci-bypass=intentional`). Release-notes auto-gen from AC↔commit evidence into `ship.md` `## Release notes` section. Victory Detector requires `ci_smoke_passed = true`, `release_notes_filled = true`, and `learnings_captured_or_explicitly_skipped`. Mandatory `## What didn't work` section surfaces dead-end approaches, abandoned attempts, and rejected decisions. Learnings hard-stop on non-trivial slugs (≥4 AC) when the compound quality gate doesn't fire — explicit `Capture learnings? — yes / no / explain-why-not` ask, bypassable via `config.captureLearningsBypass`.

**T2 — New capabilities.** `verification-loop` skill (auto-trigger) runs `build/typecheck/lint/test/security` staged gate in strict / continuous / diff-only modes. `tests/unit/prompt-budgets.test.ts` enforces per-specialist line + char ceilings on every commit. `HANDOFF.json` + `.continue-here.md` written at every stage exit (machine-readable state + human-readable resume note, idempotent rewrites). Compound-refresh sub-step runs every 5th capture (gated by floor of 10 entries): dedup / keep / update / consolidate / replace over `.cclaw/knowledge.jsonl`; configurable via `config.compoundRefreshEvery` and `config.compoundRefreshFloor`. `scripts/analyze-token-usage.mjs` for post-flow telemetry. TDD-cycle skill anti-rationalization table (eight `rationalization | truth` rows). Discoverability self-check after compound writes — confirms at least one of `AGENTS.md` / `CLAUDE.md` / `README.md` references `knowledge.jsonl`.

**T3 — Architectural foundations.** `ModelPreferences` interface (per-specialist tier hints `fast` / `balanced` / `powerful`); optional, defaulted off. Namespace router (gsd pattern): documented `/cc-plan`, `/cc-build`, `/cc-review`, `/cc-ship`, `/cc-compound-refresh` routes mapping to `/cc --enter=<stage>` semantics — opt-in for harnesses with command palettes. Two-reviewer per-task loop (obra pattern): on the highest-risk band (`large-risky` + `security_flag: true`), reviewer splits into two passes — spec-review first (correctness + test-quality only), code-quality-review second (readability + architecture + complexity-budget + perf only); pass 2 short-circuits on `spec-block`. Single-pass remains the v8.12 default; two-pass triggers via `config.reviewerTwoPass` or the high-risk auto-trigger.

### Tests

`tests/unit/v813-cleanup.test.ts` — 31 new tripwire tests covering T0 speed wins (parallel research dispatch, multi-question triage, shared-diff context, discovery auto-skip), T1 plan/build/review/ship power (dependsOn + rollback, feasibility stamp, research cache prose, non-functional checks, refactor-only evidence, 7-axis review, security auto-detect, adversarial rerun, cap-reached split-plan, CI smoke gate, release-notes auto-gen, learnings hard-stop), T2 capabilities (verification-loop skill, handoff artifacts, compound-refresh, what-didn't-work, discoverability self-check, anti-rationalization table), T3 architectural foundations (ModelPreferences interface, namespace router, two-reviewer per-task loop).

`tests/unit/prompt-budgets.test.ts` — 9 new tests asserting per-specialist line + char ceilings (planner ≤ 380, slice-builder ≤ 360, reviewer ≤ 320, etc.) plus a soft combined ceiling.

Total: 444 tests across 42 files, all green. No prose-locked test rewrites — every change extended the spec rather than rewriting it.

### Migration

Drop-in upgrade from 8.12.x. New config keys are all optional and defaulted off:

- `modelPreferences?: ModelPreferences` — per-specialist tier hints; absent fields fall back to harness default.
- `compoundRefreshEvery?: number` (default 5), `compoundRefreshFloor?: number` (default 10) — set `compoundRefreshEvery: 0` to disable.
- `captureLearningsBypass?: boolean` (default false) — CI-friendly opt-out for the learnings hard-stop ask.
- `reviewerTwoPass?: boolean` (default false; auto-fires on `large-risky + security_flag: true`).
- `legacyArtifacts?: boolean` (default false; from v8.12) is unchanged.

Slugs shipped on v8.11 / v8.12 keep working — the orchestrator's existing-plan detection is unchanged. v8.13's new `dependsOn`, `rollback`, and `feasibility_stamp` fields appear only on plans authored on v8.13+ — older plans without them are still valid (the planner stamps them on the next refinement).

## 8.12.0 — Cleanup release: 12 Tier-0 bug fixes, antipatterns trimmed 33→7, orphan content libraries deleted, artefact layout collapsed 9→6, legacy-artifacts opt-in flag

### Why

A multi-axis audit against eleven reference repositories (`addyosmani-skills`, `affaan-m-ecc`, `chachamaru127-claude-code-harness`, `everyinc-compound`, `forrestchang-andrej-karpathy-skills`, `gsd-v1`, `gstack`, `mattpocock-skills`, `obra-superpowers`, `oh-my-claudecode`, `oh-my-openagent`) and an internal review of cclaw's own codebase surfaced four classes of weight cclaw was carrying from earlier releases:

1. **Twelve concrete Tier-0 bugs.** `Recommended next` enum drift across orchestrator + 4 specialists; `securityFlag` vs `security_flag` spelling duality in artefact frontmatter; the adversarial pre-mortem template prompting for a literal future date; `finalization_mode` stored in two places (frontmatter and body) that could disagree; `ship.md` not idempotently re-authored after late iterations; the ship-gate picker offering `Cancel` as a clickable row; discovery checkpoint questions never surfaced through the harness's structured ask; the decision-protocol short-form citing deleted worked examples; and three more documented in the v8.12 audit notes.

2. **Twenty-four unused antipatterns.** Of 33 antipatterns shipped in 8.11, only 7 (`A-2`, `A-3`, `A-15`, `A-16`, `A-17`, `A-21`, `A-22` in old numbering) were ever explicitly cited in reviewer hard rules or slice-builder gates. The other 26 were "reference reading" the meta-skill said to consult — but no spec line ever named a specific antipattern by ID for those.

3. **Orphan content libraries.** Same audit finding for reference patterns (only `auth-flow` and `security-hardening` were ever explicitly named; the other six were generic catalogue), recovery playbooks (no spec line ever named a specific recovery file), research playbooks (the dispatched `learnings-research` and `repo-research` specialists are kept; only the duplicate "browse if relevant" markdown library was orphan), and worked examples (early-adopter scaffolding; shipped flows under `flows/shipped/<slug>/` are now the canonical reference).

4. **Nine artefacts where six suffice.** `manifest.md` duplicated frontmatter that could live on `ship.md` itself. `pre-mortem.md` was a parallel artefact summarising the adversarial reviewer's reasoning — but the reasoning belonged in `review.md` next to the findings it produced. `research-learnings.md` was a write-then-immediately-quote-from cycle that the planner could short-circuit by reading the research helper's slim-summary blob directly.

### What changed

**#1 — Twelve Tier-0 bug fixes.** `Recommended next` is now the canonical orchestrator enum `<continue | review-pause | fix-only | cancel | accept-warns-and-ship>`; brainstormer + architect ship the discovery subset `<continue | cancel>`; security-reviewer ships the no-warn-accept subset `<continue | fix-only | cancel>`; reviewer ships the full canonical enum. `security_flag` (snake_case) is canonical across artefact frontmatter (`securityFlag` is gone). The reviewer's adversarial mode is now a `## Pre-mortem (adversarial)` section appended to `review.md`, not a separate file (legacy-artifacts opt-in restores the file). The pre-mortem template explicitly says *"do not write a literal future date — the scenario is rhetorical"*. The ship runbook teaches stamping `finalization_mode` onto `ship.md` frontmatter as the source of truth (the body's `Selected:` line is supplementary). The ship runbook teaches idempotent re-authoring of `ship.md` when late iterations land. The ship-gate picker example explicitly excludes `Cancel` as a clickable option. The orchestrator surfaces brainstormer / architect `checkpoint_question` via the harness's structured ask, not as fenced English. The decision-protocol short-form no longer cites the deleted `decision-permission-cache` worked example.

**#2 — Antipatterns trimmed 33 → 7 and renumbered to A-1..A-7.** Kept: `A-1` TDD phase integrity (was A-2), `A-2` work outside the AC (was A-3), `A-3` mocking-what-should-not-be-mocked (was A-15), `A-4` drive-by edits (was A-16), `A-5` deletion of pre-existing dead code (was A-17), `A-6` untagged debug logs (was A-21), `A-7` single-run flakiness conclusion (was A-22). The 24 deleted entries (A-1 through A-33 minus the seven) were never named by ID in any reviewer rule, slice-builder gate, or specialist contract. Citations across `skills.ts`, `slice-builder.ts`, `reviewer.ts` were updated in lockstep via a one-shot Node migration script. A migration mapping (`old A-N → new A-M`) is at the top of `antipatterns.md` for anyone returning to a v8.11-shipped slug.

**#3 — Orphan libraries deleted.** Reference patterns 8 → 2 (`auth-flow`, `security-hardening` only). Recovery playbooks 5 → 0 (orchestrator now handles recovery inline: pause → surface options → user-driven decision; the spec is in `recovery.ts` index note). Research playbooks 3 → 0 (the *dispatched* `learnings-research` and `repo-research` specialists are kept; only the markdown "browse-if-relevant" library is gone). Worked examples 8 → 0 (`flows/shipped/<slug>/` is now the canonical reference). The empty index files explain the v8.12 cleanup and link to `legacy-artifacts: true` for restoring the deleted libraries.

**#4 — Artefact layout collapsed 9 → 6.** `manifest.md` is gone — its data (slug, ship_commit, shipped_at, ac_count, review_iterations, security_flag, has_architect_decision, refines) is now stamped onto `ship.md`'s frontmatter, with an `## Artefact index` section listing every moved file. `compound.runCompoundAndShip` runs the new `stampShipFrontmatter` helper instead of `writeFile(manifest.md)`. `pre-mortem.md` is gone — appended to `review.md`. `research-learnings.md` is gone — `learnings-research` returns its 0-3 prior lessons inline as a `lessons={...}` blob in the slim-summary's `Notes` field; the planner copies the blob verbatim into `plan.md`'s `## Prior lessons` section. `cancel.md` replaces `manifest.md` for cancelled flows (the manifest concept is reserved for shipped slugs; `cancel.ts` writes `cancel.md` by default).

**#5 — `legacy-artifacts: true` opt-in flag.** New optional boolean in `.cclaw/config.yaml` (default `false`). When `true`, every deletion above is reverted: `compound.ts` writes a separate `manifest.md` alongside `ship.md`; `cancel.ts` writes `manifest.md` instead of `cancel.md`; the reviewer mirrors the pre-mortem section to a standalone `pre-mortem.md`; `learnings-research` writes `research-learnings.md`. The flag exists so downstream tooling that hard-coded paths to the old layout can keep working — there's no behavioural reason to set it on a fresh install. `compound.ts` and `cancel.ts` both branch on `readConfig().legacyArtifacts`.

**#6 — Install-summary hides empty rows.** `cclaw init` no longer prints `Research 0 · Recovery 0 · Examples 0` when those libraries are empty in default mode. `renderSummary` filters rows with `count > 0`. The progress emit lines (`✓ Wrote research`) are also conditional. The output looks clean again.

**#7 — README trim 421 → 308 lines.** Sections "What changed in 8.10.1" through "What changed in v8" moved to `CHANGELOG.md` (where they were duplicated anyway). README now covers v8.12 + v8.11 + a single "Earlier releases" pointer. The "Five recovery playbooks · Eight worked examples" frontmatter line was rewritten to match the v8.12 trimmed reality.

### Investigation notes (T1-E + T1-F skipped after closer look)

The audit also identified two extraction targets — `_subagent-envelope` shared section and `_brownfield-read-order` shared section — and two skills.ts dedupe targets — TDD canonical statement and sensitive-surface canonical. On closer inspection these turned out to be *tuned per-specialist contextual references*, not copy-paste duplicates. Each specialist's "Sub-agent context" section lists a different envelope (different files to read, different writes, different stop conditions). The two `Phase 2.5 — Pre-task read order` sections in `planner.ts` and `architect.ts` differ in their step-1, step-2, and step-4 wording — each tuned to its specialist's authoring purpose. Extracting any of these to a shared TS variable would either lose the per-callsite tuning or add role-conditional templating that's harder to read than the current setup. We left them alone and noted the decision in this CHANGELOG entry instead of papering over it with a "will refactor later" TODO.

### Tests

`tests/unit/v812-cleanup.test.ts` — 27 new tests covering Tier 0 enum normalisation, security_flag canonical spelling, pre-mortem section template, `finalization_mode` source-of-truth, ship.md idempotent re-author, A-1..A-7 renumber + back-compat mapping, A-N citation parity, orphan-library emptiness, decision-protocol broken-ref removal, artefact-collapse instructions, and `legacy-artifacts: true` config-flag plumbing.

Existing prose-locked tests rewritten to match the new ground truth (`reference-patterns.test.ts`, `research-recovery-antipatterns.test.ts`, `install-content-layer.test.ts`, `compound.test.ts`, `cancel.test.ts`, `tdd-cycle.test.ts`, `v88-cleanup.test.ts`). `examples.test.ts` deleted (no behaviour to lock now that `EXAMPLES` is empty).

Total: 404 tests across 40 files, all green. Net source diff: ~1300 lines deleted, ~470 lines added.

### Migration notes

- **No breaking changes for runtime behaviour.** Every spec line that read or wrote the deleted artefacts now branches on `legacyArtifacts: boolean`. The default false path produces fewer, larger artefacts; the legacy true path is a drop-in equivalent of v8.11.
- **Slugs shipped on v8.11 keep working.** Their `manifest.md`, `pre-mortem.md`, and `research-learnings.md` files stay where they are; the orchestrator's existing-plan detection reads `shipped/<slug>/ship.md` (default) OR `shipped/<slug>/manifest.md` (legacy) — either is sufficient to recognise an already-shipped slug.
- **Citations to old A-N IDs in v8.11 artefacts stay readable.** The v8.12 antipatterns file documents the renumber mapping at the top so anyone returning to a v8.11 slug can translate the IDs in an iteration block.

## 8.11.0 — Orchestrator-spec cleanup: discovery pauses, no-Cancel pickers, /cc as the only resume verb, dated slugs, language-neutral examples

### Why

A real session log (`/Users/zuevrs/Projects/test/1`) surfaced five concrete UX regressions in 8.10.1's orchestrator spec:

1. **Discovery sub-phase blew through the user's view in `auto` mode.** The orchestrator dispatched brainstormer → architect → planner without stopping, so the user couldn't see the brainstormer's selected_direction before architect's tradeoffs landed on top of it. The spec was contradictory: discovery was nominally "always pauses", but the auto-mode rules treated the whole `plan` stage as a single chainable unit.
2. **Structured asks were rendered in English even when the user wrote in Russian.** Every fenced `askUserQuestion(...)` example in the orchestrator and skills used literal English option strings (`"Proceed as recommended"`, `"Switch to trivial"`, `[r] Resume`, …). The agent dutifully copied them verbatim. The `conversation-language` skill's "translate option labels" footnote was not strong enough to overcome a literal copy-paste anchor.
3. **`/cc-cancel` was offered as a clickable option in three different pickers** (Hop 1 detect, Hop 2.5 pre-flight, Hop 4 hard gates, flow-resume picker). It is supposed to be a separate explicit user-typed command for nuking flow state. Putting it inside every picker turned a destructive command into a one-keystroke accident.
4. **Step-mode "pause" prose still said `I type "continue"`** in three places (start-command, triage-gate, flow-resume). The actual mechanic is `/cc` — the same verb that resumes any other paused flow. Two competing magic words is one too many.
5. **Slug names had no collision protection.** Two flows started on different days against similar topics produced colliding slugs (e.g. `auth-cleanup` from week 1 and `auth-cleanup` from week 3 both wrote into `flows/auth-cleanup/`). Findings, AC, and shipped artifacts could overwrite silently.

### What changed

**#1 — Discovery sub-phase pauses regardless of `runMode`.** `start-command.ts`'s Hop 4 explicitly says: when the dispatch you just received was the brainstormer or architect inside the discovery sub-phase of a `large-risky` plan, you render the slim summary and end the turn. The next `/cc` invocation continues with the next discovery step (architect after brainstormer; planner after architect). `auto` mode applies only to the plan → build → review → ship transitions, never to the brainstormer → architect → planner internal handoff. The auto-mode rules carve out the exception explicitly so the spec is no longer self-contradictory.

**#2 — Language-neutral intent-descriptor placeholders replace literal option strings.** Every fenced `askUserQuestion(...)` and slim-summary block in `start-command.ts`, `skills.ts` (triage-gate, pre-flight-assumptions, interpretation-forks, flow-resume), and `conversation-language.md` now uses `<option label conveying: ...>` notation. The agent cannot copy a literal English string because there is no literal English string to copy — the slot describes the intent and the agent must verbalise it in the user's language. Mechanical tokens (`/cc`, `/cc-cancel`, `plan`, `build`, `review`, `ship`, `step`, `auto`, slugs, file paths, JSON keys, `AC-N`, complexity / acMode keywords) stay in their original form regardless of conversation language. The `conversation-language` skill's worked example was rewritten as a language-neutral schema (no Russian, no English example strings — just `<...>` placeholders). The `brainstormer.ts` and `architect.ts` specialist prompts now explicitly say `checkpoint_question`, `What changed`, `Notes`, and `open_questions` values render in the user's conversation language; English example values are placeholders, not the wire format.

**#3 — `Cancel` is no longer a clickable option in any picker.** Removed `[c] Cancel — discard this flow` from Hop 1 detect (3 places — none/one/many active flows); removed `Cancel — re-think the request` from pre-flight assumptions and from interpretation forks; removed `[c] Cancel` from flow-resume; removed `Cancel — abort the flow now (move to cancelled/, reset state)` from Hop 4 hard gates. The picker option set is `[r] Resume / [s] Show / [n] New (when applicable)`. `/cc-cancel` is mentioned only in plain prose, only when the user looks stuck, and only when the orchestrator has already presented a non-destructive picker option. The always-ask rules explicitly forbid `Cancel` as a clickable option (with one carve-out: Hop 1 collision, where the user explicitly asked to switch tasks).

**#4 — Step mode = end of turn; `/cc` is the only resume verb.** Hop 4's `step` block was rewritten: render the slim summary, then end your turn. No "say `continue` to advance". No "type the magic word". The user sends `/cc` (the same single resume verb) and the orchestrator picks up where it left off. `triage-gate` Question 2's two options now read `Step (default) — pause after each stage; next /cc advances` and `Auto — chain plan → build → review → ship; stop only on hard gates` (intent shape; verbalised in the user's language at runtime). `flow-resume` describes `/cc` as the canonical resume command. The seven-hop summary in start-command says "`/cc` is the single resume verb across step mode, auto-mode hard gates, and the discovery sub-phase".

**#5 — Slug format `YYYYMMDD-<semantic-kebab>`.** Hop 2 Triage now mandates the date prefix on every new slug. Same-day collisions resolve by appending `-2`, `-3`, etc. (`20260510-billing-rewrite`, `20260510-billing-rewrite-2`). The date prefix is mandatory and ASCII regardless of conversation language. `orchestrator-routing.ts` got a new `semanticSlugTokens(slug)` helper that strips the leading `YYYYMMDD-` prefix before feeding tokens to the Jaccard match — same-topic flows on different days are now reliably matched (the date is signal for filename uniqueness, noise for semantic similarity). Cancelled / shipped flow paths inherit the dated slug naturally (`flows/cancelled/20260510-billing-rewrite/` etc.).

### Tests

`tests/unit/v811-cleanup.test.ts` — 23 new tests covering all five issues:

- `#1 discovery pauses` — the spec contains "discovery never auto-chains", `regardless of triage.runMode`, the per-step "renders the slim summary and ends the turn" rules, and the auto-mode carve-out for brainstormer/architect inside discovery.
- `#3 cancel removal` — flow-resume / pre-flight / interpretation-forks no longer expose `[c] Cancel`, `[4] Cancel`, or `Cancel — re-think`; the always-ask rules contain "/cc-cancel is never a clickable option"; cancel-command keeps the explicit-nuke prose.
- `#4 step mode + /cc` — start-command says "/cc is the single resume verb", contains the "End your turn" instruction, and no longer says `I type "continue" to advance`; triage-gate Question 2 prose is updated; flow-resume calls `/cc` the canonical resume command.
- `#5 slug format` — Hop 2 spells out `YYYYMMDD-<semantic-kebab>`, the same-day collision fallback, and the date-prefix-mandatory rule; `findMatchingPlans` correctly matches a YYYYMMDD- slug to a plain semantic task title; date-only task titles do not match plain semantic slugs (the date prefix is excluded from token comparison).
- `#2 language` — conversation-language exposes "Option labels in structured asks" and "Slim-summary text fields" rules and the language-neutral worked schema; the "Copying example strings verbatim" pitfall is documented; start-command's TRIAGE_ASK_EXAMPLE no longer contains literal `"Proceed as recommended"` / `"Switch to trivial …"` strings; flow-resume picker uses `<option text conveying: …>` for every row; brainstormer + architect prompts explicitly require `checkpoint_question` and slim-summary prose values to render in the user's conversation language.

The existing `start-command.test.ts` resume-path test was updated to match the new placeholder shape (`[r]` / `[s]` shortcut letters with intent descriptors instead of literal `Resume` / `Show` strings).

Total: 385 tests across 40 files, all green.

### What did not change

- Public CLI surface (`init`, `sync`, `upgrade`, `uninstall`, `help`, `version`).
- Stage layout, specialist roster, schema files, hook contracts, harness wiring.
- The `conversation-language` skill's core trigger condition or detection rules.
- `slugifyArtifactTopic` itself (the date prefix is added by the orchestrator at slug-mint time; `slugifyArtifactTopic` keeps producing the semantic part, which `findMatchingPlans` and the orchestrator both consume).
- All other tests (362 → 385 = +23 net).

### Migration

Drop-in upgrade from 8.10.x. The change is in the orchestrator + skill prompts, the orchestrator-routing helper, and one test update — no new CLI commands, no new config keys, no new dependencies, no breaking schema changes. Existing flows with non-dated slugs continue to work; the date prefix is only required when the orchestrator mints a new slug. Findings, AC, and shipped artifacts in non-dated existing flows are unaffected (the matching helper handles both forms).

If you have automation that scrapes `askUserQuestion(...)` blocks out of the orchestrator prompt for offline analysis, the option strings are now placeholder slots (`<option label conveying: ...>`) rather than literal English — this is intentional. The runtime asks rendered to the user contain real strings in the user's language; only the spec body uses placeholder notation.

## 8.10.1 — Picker erase-frame fix: banner/welcome survive picker render; no leftovers in scrollback

### Why

Real-world install run on `cclaw-cli@8.10.0` revealed two regressions in the freshly-shipped TUI:

1. **The full-screen clear at the top of the picker (`\u001b[2J\u001b[H`) was wiping the banner and welcome card** that had just been printed two function calls earlier. Users running `cclaw init` interactively saw the picker first — never the new ASCII logo, never the "Welcome to cclaw" intro. The whole point of the 8.10 banner work was silently nullified the moment the picker started rendering.
2. **The picker frame stayed in the terminal scrollback after `Enter`**. The `cleanup` function in `runPicker` reset raw mode and detached the keypress listener, but never erased the last-drawn picker frame. So users got: `cclaw — choose harness(es)…` block stuck above the install progress as visual leftover. Looked dirty, looked unfinished, hid signal under noise.

Both bugs are fixed by the same idea: stop using full-screen escapes, and let the picker manage only its own region.

### What changed

**F1 — Cursor-up + clear-line redraw replaces full-screen clear.** `harness-prompt.ts` ditches `stdout.write("\u001b[2J\u001b[H")` (clear screen + home cursor — clobbers everything above). Two new pure helpers do the work:

- `eraseLines(count): string` builds an ANSI sequence that walks the cursor up `count` rows and clears each one, then `\r` to column 0. Returns `""` for `count <= 0` so the very first picker render emits nothing harmful when there is no previous frame yet.
- `frameLineCount(frame): number` counts newline-terminated lines in a rendered frame string (every line ends with `\n`, so `split("\n").length - 1`).

`runPicker` now tracks `lastFrameHeight` across renders. On every redraw, it issues `eraseLines(lastFrameHeight)` first (no-op on the very first render — `lastFrameHeight` is still 0), then writes the new frame and updates the height. The banner and welcome card above the picker are never touched.

**F2 — Picker frame is erased on `cleanup`, not left in scrollback.** `cleanup()` now issues one final `eraseLines(lastFrameHeight)` before tearing down raw mode and detaching the listener. After `Enter` (or `Esc` / `Ctrl-C`), the picker disappears; install progress lines start at the row where the picker frame began. Whatever was above the picker (banner, welcome) stays. No more "ghost picker" stuck in the terminal scrollback.

**F3 — Vertical rhythm cleanup.** `renderBanner`, `renderSummary`, and `renderWelcome` in `src/ui.ts` now end with `\n\n` instead of `\n`, baking exactly one blank line of breathing room between every two sections. `renderWelcome` lost its leading `\n` (the banner's new trailing `\n\n` already provides the gap). Visible effect:

- `cclaw help` now shows a blank line between `cclaw vX.Y.Z — …` and `Usage: cclaw <command> [options]` instead of cramming them together.
- `init` / `sync` / `upgrade` show a blank line between the final `Commands  3` summary row and the `[cclaw] init complete.` info line — used to be flush against each other.
- `init` (auto-detect, no picker) shows a blank line between the welcome `Detected harness: cursor (pre-selected).` and the first `✓ Runtime root` progress event.

### What did not change

- Public CLI surface, hop sequence, stage layout, specialist roster, schema files.
- Picker key handling (`applyKey`, hotkey behaviour, message rendering).
- The pure `renderPickerFrame(state, detected, useColor): string` function — only the wrapper around it changed.
- All non-TTY paths (CI, smoke, npx with stdio piped). `eraseLines` is only emitted when `runPicker` actually runs, which requires `isInteractive() === true`.

### Migration

Drop-in patch from 8.10.0. No new commands, no new config keys, no new flags, no new dependencies. Anyone scripting against `cclaw init` / `sync` / `upgrade` stdout that depended on the previous trailing-`\n` rhythm will see one extra blank line between sections — the existing `[cclaw] … complete.` completion line is unchanged.

## 8.10.0 — Install UX polish: ASCII banner, progress feedback, summary, first-run welcome

### Why

`cclaw init` / `sync` / `upgrade` were silent for ~2 seconds. The orchestrator wrote 8 specialists, 24 skills, 11 templates, 4 stage runbooks, 8 reference patterns, 3 research playbooks, 5 recovery playbooks, 8 worked examples, anti-patterns, decision protocol, and harness assets — and the user saw nothing until a single `[cclaw] init complete. Harnesses: cursor` line at the end. The CLI also looked dated next to peer tools like `gsd-v1`: no banner, no version stamp on every invocation, no colour, monochrome plaintext picker. Worse, `cclaw --version` reported `8.7.0` even when the user had `8.9.0` installed from npm — `CCLAW_VERSION` in `src/constants.ts` was a hardcoded constant that nobody bumped during 8.8 / 8.9. A tool that lies about its own version is a tool you can't debug.

### What changed

**A1 — ASCII logo banner.** New `src/ui.ts` module renders a block-letter `CCLAW` banner (Unicode box-drawing characters, ~6 lines tall) followed by `cclaw vX.Y.Z — harness-first flow toolkit for coding agents`. Shown on `init` / `sync` / `upgrade` / `uninstall` / `help`. **Not** shown on `version` (just prints the bare version string — programmatic callers stay clean). Honours [`NO_COLOR`](https://no-color.org), `FORCE_COLOR`, and `stdout.isTTY` for the colour decision: piped output, CI logs, and `NO_COLOR=1` get plain ASCII; live TTYs get cyan. Logo characters are Unicode but render fine in any modern terminal even with colour off.

**A2 — Coloured help body.** `cclaw help` and `cclaw <unknown>` now render help with cyan flag names, dim descriptions, and yellow `Commands:` / `Options:` section headings. Help columns are auto-aligned per section. Same colour-stripping rules as the banner (NO_COLOR / FORCE_COLOR / TTY).

**A3 — Final summary block.** `init` / `sync` / `upgrade` print an `Installed` block at the end with one row per asset family (Agents, Skills, Templates, Runbooks, Patterns, Research, Recovery, Examples, Hooks, Commands) and counts. `uninstall` reports which harnesses were removed. Adjusts dynamically based on the active config.

**B1 — Per-step progress feedback.** `syncCclaw` now accepts an optional `onProgress: (event: ProgressEvent) => void` callback in `SyncOptions`. The CLI wires it to a `  ✓ <step> — <detail>` line printer (green check, dim detail). Twelve major install steps emit progress: runtime root, specialists, hooks, skills, templates, runbooks, patterns, research, recovery, examples, anti-patterns + decision protocol, harness assets, config write. Programmatic callers (smoke scripts, MCP wrappers, tests) can leave `onProgress` undefined to stay silent.

**B2 — First-run welcome.** On `cclaw init`, if `.cclaw/config.yaml` does not exist yet, the CLI shows a two-line welcome card before the picker / sync starts: `Welcome to cclaw — first-time setup`, followed by what's about to happen and which harnesses (if any) were auto-detected. Suppressed on re-init, sync, and upgrade where the config already exists.

**B3 — Polished harness picker.** `harness-prompt.ts` got a colour pass: cyan header, dim description column per harness (Anthropic Claude Code CLI agent / Cursor IDE agents / OpenCode terminal agent / OpenAI Codex CLI), green `[x]` for selected, dim `[ ]` for unselected, cyan `>` cursor pointer, dim cyan `(detected)` tag for auto-detected harnesses, dim hotkey legend. The picker frame renderer is now a pure `renderPickerFrame(state, detected, useColor): string` function so tests can assert on layout without spinning up a TTY.

**Bonus fix — `CCLAW_VERSION` is single-source-of-truth.** `src/constants.ts` no longer hardcodes the version string. `CCLAW_VERSION` now reads from `package.json` at module-load time using `import.meta.url`-relative path resolution. Works in dev (`src/constants.ts` → `../package.json`), in `dist/` (post-build), and in the published npm tarball (`node_modules/cclaw-cli/dist/...` → `node_modules/cclaw-cli/package.json`). `npm pack` always includes `package.json` regardless of the `files` allow-list, so this is safe at runtime. Version bumps now require updating exactly one file (`package.json`) and the constant — and every thing that imports it (`config.ts`, `cli.ts`, `install.ts`) — picks up the new value automatically. The stale "lock 8.7.0" prose-test in `constants.test.ts` is replaced with a parity check: `CCLAW_VERSION` must equal `package.json.version` and match `^\d+\.\d+\.\d+$`.

### What did not change

- Public CLI surface (commands, flags, harness IDs).
- Hop sequence, stage layout, specialist roster.
- `flow-state.json` schema, `knowledge.jsonl` schema, harness-config schemas.
- `antipatterns.ts`, specialist prompts, skills, runbooks, examples, recovery playbooks.
- Smoke test, hook event wiring, harness-detection markers.
- Any non-TTY behaviour: piped `init` / `sync` calls (CI, smoke, npx) get plain ASCII output and the same exit codes as before.

### Migration

Drop-in upgrade from 8.9. No new dependencies (the CLI ships with raw ANSI escapes; no `chalk` / `kleur` / `picocolors`). No new commands, no new config keys, no new flags. Consumers with strict CI logging that depend on a specific exact-line stdout grep should note that `init` / `sync` / `upgrade` now print 13–14 progress lines + a summary block before the existing `[cclaw] init complete.` line — the existing completion line is unchanged.

## 8.9.0 — Knowledge dedup, slice-builder coverage beat, flow-pressure feedback

### Why

Three concrete improvements distilled from a parallel audit of `addyosmani-skills` (post-30-Apr commits), `everyinc-compound`, and `gsd-v1` against `cclaw` v8.8. Most ideas in those references were rejected outright (multi-flow factories, marketplace converters, 30+ specialists, prose-lock contract tests, version-archaeology rhetoric — see [the rejection list in the v8.9 PR](https://github.com/zuevrs/cclaw/pull/234) for why). The three that survived address concrete failure modes that were already happening in real flows:

1. `knowledge.jsonl` was append-only with no dedup. After 50+ shipped flows the file was full of near-duplicate "rate-limit middleware bug fixed in src/auth/" entries that the `learnings-research` helper had to wade through.
2. The slice-builder loop had no explicit beat for "did the test I just wrote actually exercise the production change I just made?". GREEN passing was treated as proof of coverage; in practice GREEN sometimes passed because the test asserted the wrong branch or because pre-existing tests already covered the code path the AC was supposed to introduce.
3. Long flows (10+ AC, multiple fix iterations, repeated reviewer rounds) silently degraded mid-flow as `flows/<slug>/build.md` and `review.md` accumulated bytes. The agent had no signal that re-reading these on every dispatch was eating context.

### What changed

**A3 — `knowledge.jsonl` near-duplicate detection on append.** `KnowledgeEntry` now carries optional `touchSurface: string[]` and `dedupeOf: string | null` fields (back-compat: legacy entries without these still validate). New helper `findNearDuplicate(projectRoot, candidate, options?)` scans the most recent 50 entries (configurable) and computes Jaccard similarity over `tags ∪ touchSurface`; returns the highest-similarity match if it crosses the 0.6 threshold (configurable). `runCompoundAndShip` accepts `touchSurface`, `tags`, and `dedupOptions` in `CompoundRunOptions`, runs dedup before append, and stamps `dedupeOf: <earlier-slug>` on the new entry when a near-duplicate is found. The append remains append-only (no jsonl rewriting; concurrent-write safety preserved); the new entry just carries metadata pointing at the earlier match. `learnings-research` and human readers see the chain. The `CompoundRunResult` exposes the matched entry for orchestrator messaging. Caller can disable dedup via `dedupOptions: { disable: true }` for tests or special cases.

**A5 — Slice-builder coverage-assess beat between GREEN and REFACTOR.** New hard rule 17 in `slice-builder.ts`: after GREEN passes the full suite and before the REFACTOR commit, the slice-builder writes one explicit Coverage line per AC to `build.md` with one of three verdicts:

- `full` — every observable branch of the GREEN diff is covered by the RED test or pre-existing tests (with file:line refs).
- `partial` — at least one branch is uncovered, with a named reason ("covered by integration test we don't run here" / "edge case deferred to follow-up slug `<slug>`"). Anything else is a stop-the-line — write a second RED test before moving on.
- `refactor-only` — pure structural change, behaviour anchored by existing tests.

Silence is not acceptable; "looks fine" is not acceptable. The strict `BUILD_TEMPLATE` gains a `## Coverage assessment` table; the soft `BUILD_TEMPLATE_SOFT` gains a `**Coverage**:` bullet. The slice-builder's `self_review[]` array now carries five rule attestations (was four): `tests-fail-then-pass`, `build-clean`, `no-shims`, `touch-surface-respected`, **`coverage-assessed`**. The orchestrator's pause hop (`start-command.ts`) inspects all five before dispatching the reviewer; an absent or `verified: false` `coverage-assessed` entry triggers a fix-only bounce without paying for a reviewer cycle.

**B2 — Flow-pressure advisory in `session-start.mjs`.** The session-start hook now sums the byte size of every `flows/<slug>/*.md` artefact for the active slug and emits an advisory message at three thresholds:

- `≥30 KB` — *Elevated*: "let the orchestrator dispatch a fresh sub-agent for the next AC rather than continuing inline."
- `≥60 KB` — *High*: "finish the active slice in this session and resume from a clean session for the next AC."
- `≥100 KB` — *Critical*: "consider `/cc-cancel` and resplitting into smaller slugs, or finalising the current slug now and continuing in a follow-up flow."

The hook stays advisory: it logs to stdout (alongside the existing active-flow line) and never blocks. The agent reads this on every session start and adjusts its dispatch posture; humans see the same line in their terminal. No new hook file (the advice is folded into the existing `session-start.mjs` so installer surface stays the same), no new harness wiring.

### What did not change

- Public CLI surface (`/cc`, `/cc-cancel`, `/cc-idea`).
- Hop sequence, stage layout, specialist roster.
- `flow-state.json` schema (still v3; A3 changes only `knowledge.jsonl` shape).
- `antipatterns.ts` content (A-1 through A-33).
- Five-axis review and 5-tier severity scale.
- Hook event wiring (`session.start` / `session.stop` / `commit-helper`); B2 just adds advisory output to an existing hook.
- Any specialist's behaviour for flows with `touchSurface` and `tags` absent (A3 dedup is a no-op then; A5 still demands a verdict line; B2 advisory still fires when artefacts grow).

### Migration

Drop-in upgrade from 8.8. `KnowledgeEntry.touchSurface` / `tags` / `dedupeOf` are all optional, so legacy entries deserialize without error. Slice-builders running on 8.8 prompts will not write the Coverage line on the first run after upgrade; the orchestrator's pause-hop will bounce them to fix-only once and they will catch up. Session-start hook advisory messages appear on first session start after re-running `cclaw sync`.

## 8.8.0 — Cleanup release: bug fixes, test pruning, version-marker strip

### Why

8.7.0 shipped fast and accumulated debt: prompts kept references to the v7 path layout (`plans/<slug>.md`) that no longer exists, the `tdd-cycle` Anti-patterns section cited A-numbers that didn't match `antipatterns.ts` (phantom A-18 / A-19 / A-20), `interpretationForks` was added to the schema in 8.7 but never wired into specialist prompts (so it was a no-op), the slice-builder had a contradiction between the soft-mode commit table and hard-rule 6, severity terminology was a mix of `block` / `warn` / `info` / `critical` / `required` across files, the architect prompt had two consecutive bullets numbered "6.", and the TDD gate was named `red_test_recorded` in one place and `red_test_written` in another. The test suite had ballooned to 569 tests with ~287 of them being prose-locks against version strings (e.g. `expect(skill.body).toMatch(/v8\.7\+/)`) — they froze the wording of skill bodies without protecting any behaviour. Skill bodies and specialist prompts were also cluttered with `(v8.4+)` / `(v8.7+)` / `since v8.5` / `Severity legacy note` / `v7-era constraint` / `the v7 mistake` / `the v8.X bug` markers — useful at the moment of writing, noise to the agent reading the prompt at runtime.

### What changed

**B1 — `interpretationForks` is wired (no longer a no-op).** `flow-state.ts` `assertTriageOrNull` now validates `triage.interpretationForks` as `Array<string> | null | undefined`; new helper `interpretationForksOf(triage)` mirrors `assumptionsOf`. `brainstormer`, `planner`, `architect`, and `slice-builder` all read `triage.interpretationForks` from their dispatch envelopes and respect the chosen reading: brainstormer frames its output around it, planner copies it verbatim into `plan.md` next to assumptions and surfaces conflicts as feasibility blockers, architect copies it into `decisions.md` and surfaces conflicts as decision blockers, slice-builder uses it as an AC-interpretation constraint.

**B2 — TDD anti-patterns rebuilt against `antipatterns.ts`.** The `## Anti-patterns` section in the `tdd-cycle` skill now cites real A-numbers (A-2 phase integrity, A-3 `git add -A`, A-12 single-test green, A-13 horizontal slicing, A-14 pushing past failing test, A-15 mocking-what-should-not-be-mocked) — the phantom A-18 / A-19 / A-20 references are removed (those numbers either don't exist in `antipatterns.ts` or exist with completely different meanings since 8.7's renumbering). The "test file named after the AC id" rule is now a severity=`required` finding with the correct citation. New `v88-cleanup.test.ts` adds an A-N parity guard that scans every skill body, every specialist prompt, the start-command, every stage playbook, and the recovery playbook for `A-N` references and asserts each one exists in `antipatterns.ts`.

**B3 — Slice-builder commit-helper rule scoped to strict mode.** Hard rule 6 used to read "use `commit-helper`, never `git commit` directly" unconditionally, which contradicted the soft-mode commit table earlier in the same prompt that explicitly allowed plain `git commit`. Rule 6 now reads "In strict mode: use `commit-helper`. In soft mode: plain `git commit` is fine." — matching the table.

**B4 — Severity scale aligned with the reviewer's 5-tier vocabulary.** All three places that still spoke `block` / `warn` / `info` / `security-block` are migrated to the canonical `critical` / `required` / `consider` / `nit` / `fyi` scale: slice-builder hard rule 11 (env shims) now cites severity=`critical`; planner edge-case finding now cites severity=`required` (axis=correctness); security-reviewer's Output section, worked example, and JSON summary all use the 5-tier scale (`by_axis` + `by_severity` instead of legacy `block/warn/info` counts).

**B5 — v7 paths replaced everywhere.** 47 occurrences of `plans/<slug>.md` / `decisions/<slug>.md` / `builds/<slug>.md` / `reviews/<slug>.md` / `ships/<slug>.md` / `learnings/<slug>.md` across `skills.ts`, `reviewer.ts`, `security-reviewer.ts`, `slice-builder.ts`, `recovery.ts`, and `stage-playbooks.ts` are normalised to the current `flows/<slug>/<artifact>.md` layout. The active flow lives at `flows/<slug>/`; shipped flows live at `flows/shipped/<slug>/`. The legacy `plans/`, `decisions/`, `builds/`, `reviews/`, `ships/`, `learnings/` directory layout is gone — pre-v8 state files were already migrated by `start-command`'s normaliser, so there's no behaviour change, just text alignment.

**B6 — Architect `Sub-agent context` numbering is sequential 1-7.** The architect prompt had two consecutive bullets numbered "6." in the `Sub-agent context` section. Renumbered to 6 / 7.

**B7 — TDD gate name unified to `red_test_written`.** The `tdd-cycle` skill said `red_test_recorded` while `stage-playbooks.ts` said `red_test_written`. Picked `red_test_written` (more accurate — the gate verifies the RED commit exists, not just that the test was "recorded" somewhere). Test added to lock the choice.

**Tier 2 — Test pruning (569 → 298).** Six version-snapshot regression files (`v82-orchestrator-redesign.test.ts`, `v83-ask-runmode-deeper-tdd.test.ts`, `v84-confidence-assumptions-fiveaxis-pre-mortem.test.ts`, `v85-finalize-research-contracts.test.ts`, `v86-summary-adr-cache-readorder.test.ts`, `v87-surgical-debug-browser-forks.test.ts`) were almost entirely prose-locks ("the skill body contains the string `(v8.7+)`", "the prompt contains the substring `Severity legacy note`") and froze wording without protecting behaviour. Removed wholesale. The handful of tests in those files that *did* protect behaviour — `isRunMode` / `runModeOf` / `isSpecialist` / `assumptionsOf` / `interpretationForksOf` discriminator narrowing, `triage.assumptions` and `triage.interpretationForks` schema validation — were extracted and consolidated into `flow-state.test.ts`. Net: 287 tests removed, 7 critical behaviour tests preserved, 42 new `v88-cleanup.test.ts` tests added (B1-B7 verification + version-marker absence + A-N parity + path-normalisation guards). Final count: 298 tests across 37 files, all green.

**Tier 3 — Version-marker strip from skill bodies and specialist prompts.** All `(v8.X+)` / `(NEW sub-step, v8.X+)` / `since v8.X` / `Severity legacy note` / `v8.X maps these` / `v7-era` / `the v7 mistake` / `the v8.X bug` / `cclaw v8.X+ replaces` / `Cclaw v8 explicitly` markers stripped from `tdd-cycle`, `surgical-edit-hygiene`, `debug-loop`, `browser-verification`, `pre-flight-assumptions`, `iron-laws`, `api-and-interface-design`, `refactor-safety`, `breaking-changes`, `summary-format`, `documentation-and-adrs`, `source-driven`, every specialist prompt, and `start-command`. Engineering compatibility comments inside TS source (e.g. JSDoc explaining a field's migration shape, `start-command`'s pre-v8 hard-stop message, `assertTriageOrNull` migration validation) are preserved — those are read by humans editing the source, not by the agent at runtime. Version history exclusively lives in `CHANGELOG.md` from now on.

### What did not change

- Public CLI surface (`/cc`, `/cc-cancel`, `/cc-idea`, all flags).
- Hop sequence (`Detect → Triage → Pre-flight → Dispatch → Pause → Compound → Finalize`).
- Stage layout (`plan → build → review → ship`).
- Specialist roster (brainstormer, architect, planner, slice-builder, reviewer, security-reviewer, repo-research, learnings-research).
- `flow-state.json` schema — still `schemaVersion: 3` with `triage.assumptions` and `triage.interpretationForks`.
- `antipatterns.ts` content (A-1 through A-33).
- Five-axis review and 5-tier severity scale (this release just finished aligning the *speakers*).
- Behaviour of any specialist or skill — every change is a text alignment, naming unification, or schema validation tightening.

### Migration

Drop-in upgrade. No state migration needed; `triage.interpretationForks` is optional (string array or `null` or absent), so flows from 8.7 continue working.

## 8.7.0 — Surgical edit hygiene, debug-loop discipline, browser verification, ambiguity forks, iron-law deepening, API & interface design, simplification catalog, test-design checklist, deprecation patterns

### Why

A second audit against `addyosmani-skills`, `forrestchang-andrej-karpathy-skills`, and `mattpocock-skills` surfaced nine concrete gaps that 8.6 still carried — convergent across the three reference libraries:

1. **Drive-by edits to adjacent comments / formatting / imports were not flagged.** A diff for AC-3 could quietly normalise quote style across the file, reorder imports, and "improve" three nearby comments. The audit trail mixed AC implementation with cosmetic noise.
2. **Pre-existing dead code was deleted in-scope.** Slice-builders saw an unused export and removed it "while they were here", producing a diff that mixed the AC with cleanup of code the AC never owned.
3. **Debugging discipline was a single rule** (stop-the-line in `tdd-cycle`). There was no playbook for the *cheapest reproduction loop*, no protocol for ranking hypotheses before probing, no rule against untagged debug logs leaking into commits, and no multi-run protocol for non-determinism.
4. **UI work shipped without runtime verification.** The reviewer walked the diff but never opened the rendered page; new console errors, accessibility regressions, and layout breaks were invisible until production.
5. **Pre-flight surfaced default assumptions but not interpretations.** When the user prompt was ambiguous ("ускорь поиск", "improve the UI"), the orchestrator silently picked one reading, wrote assumptions for it, and shipped the wrong feature even when triage and assumptions looked clean.
6. **The Karpathy-attributed "Think Before Coding" iron law was a one-liner.** It said "read the codebase first" but did not encode the three deepening rules every Karpathy-style harness ships: stop-and-name-confusion, propose-simpler-when-visible, push-back-against-needless-complexity.
7. **Public-interface decisions had no checklist.** Architects wrote D-N entries without explicit Hyrum's-Law pinning (shape / order / silence / timing), without the one-version rule, without third-party-response validation rules, and without the two-adapter seam discipline mattpocock describes as "one adapter means a hypothetical seam".
8. **Refactor slugs had no simplification catalog.** "Make it simpler" was a feeling. Chesterton's Fence (don't remove what you don't understand), the Rule of 500 (codemod past the threshold), and the structural simplification patterns (guard clauses, options object, etc.) were missing.
9. **Test-design rules stopped at "test state, not interactions".** Three high-leverage rules were missing: one logical assertion per test, SDK-style boundary APIs over generic-fetcher mocks, and primitive-obsession / feature-envy as named smells.
10. **Deprecation-and-migration was a single skill** (`breaking-changes`). The Churn Rule (deprecator owns migration), the Strangler Pattern (canary-then-grow), and the Zombie Code lifecycle were missing.

### What changed

**S1 — Surgical-edit hygiene skill.** New always-on skill `surgical-edit-hygiene.md` triggered on every slice-builder commit. Three rules: **(a)** no drive-by edits to adjacent comments / formatting / imports outside the AC's scope; **(b)** remove only orphans your changes created (imports your edit made unused); **(c)** mention pre-existing dead code under \`## Summary → Noticed but didn't touch\` and never delete it in-scope. The diff scope test: every changed line must trace to an AC verification line. Slice-builder hard rule 14 mandates the skill; reviewer hard rules cite the verbatim finding templates.

Antipatterns: **A-16 — Drive-by edits to adjacent comments / formatting / imports** (severity \`consider\` for cosmetic, \`required\` when the drive-by also masks logic change); **A-17 — Deletion of pre-existing dead code without permission** (always \`required\`).

**S2 — Debug-loop skill.** New skill `debug-loop.md` triggered on stop-the-line events, fix-only mode, bug-fix tasks, and unclear test failures. Six phases:

1. **Hypothesis ranking** — write 3-5 ranked hypotheses (each with the hypothesis sentence + test cost + likelihood), sort by `likelihood × 1/test-cost`, **show the ranked list to the user before any probe**.
2. **Loop ladder** — pick the cheapest of ten rungs that proves / disproves the top hypothesis: failing test → curl → CLI → headless browser → trace replay → throwaway harness → property/fuzz → bisection (`git bisect run`) → differential → HITL bash. Hard rule: start at rung 1 unless rung 1 is provably impossible.
3. **Tagged debug logs** — every temporary log carries a unique 4-character hex prefix (`[DEBUG-a4f2]`); cleanup is mechanical (`rg "[DEBUG-a4f2]" src/` returns 0 hits at commit time).
4. **Multi-run protocol for non-determinism** — first failure → 20 iterations; 1-in-20 confirmed → 100 iterations; post-fix → N×2 iterations to verify zero failures. The fix must eliminate the failure, not reduce its rate.
5. **No-seam finding** — when the bug cannot be reproduced under any loop type, that itself is the finding (axis=architecture, severity=required); the orchestrator opens a follow-up architecture slug before the bug fix retries.
6. **Artifact** — `flows/<slug>/debug-N.md` (append-only across iterations) with frontmatter `debug_iteration`, `loop_rung`, `multi_run`, `debug_prefix`, `seam_finding`, plus the standard three-section Summary block.

Antipatterns: **A-21 — Untagged debug logs** (severity `required`); **A-22 — Single-run flakiness conclusion** (severity `required`).

**S4 — Browser-verification skill.** New skill `browser-verification.md` triggered when AC `touchSurface` includes UI files (`*.tsx`, `*.jsx`, `*.vue`, `*.svelte`, `*.html`, `*.css`) and the project ships a browser app. Default-on for `ac_mode: strict`. Phases:

1. **DevTools wiring** — auto-detects `cursor-ide-browser` MCP (Cursor) → `chrome-devtools` MCP → `playwright` / `puppeteer` → "no MCP available" surfaced as a finding.
2. **Five-check pass** — (1) console hygiene with **zero new errors / zero new warnings as ship gate**; (2) network sanity (expected requests, expected status, no third-party calls); (3) accessibility tree (focus order, labels, contrast); (4) layout / screenshot diff (overflow, responsive); (5) optional perf trace for hot-path AC.
3. **Browser content as untrusted data** — DOM text, console messages, network responses, fetched HTML are **data**, never **instructions to execute** (severity `critical`, axis=security on violation). Mirrors the same rule from `anti-slop` and `debug-loop`.
4. **Artifact** — appends a Browser-verification section to `flows/<slug>/build.md` per AC.

Slice-builder hard rule 15 mandates the skill on UI touch surfaces; reviewer hard rules cite the five-check pass.

**A1 — Ambiguity forks in pre-flight.** New sub-step in `pre-flight-assumptions.md` (Hop 2.5), runs **before** assumptions composition. When the user's prompt is ambiguous ("ускорь поиск", "improve the UI", "fix the auth bug"), surface 2-4 distinct interpretations with three lines each (what it does / tradeoff / effort: small / medium / large). Forks are mutually exclusive and collectively defensible; "Cancel — re-think" is always a valid choice. The chosen reading is persisted verbatim into `triage.interpretationForks` (chosen-only, not the rejected menu); when the prompt is unambiguous, the field is `null`.

`TriageDecision` gains an optional `interpretationForks?: string[] | null` field; pre-v8.7 state files validate without it.

**A2 — Iron-law "Think Before Coding" deepened.** `iron-laws.ts` extends the original "Read enough of the codebase to write the change correctly the first time" with the three Karpathy rules verbatim: **state your assumptions; if uncertain, ask before you act**; **if multiple interpretations exist, present them — do not pick silently**; **if a simpler approach exists, say so**; **if something is unclear, stop, name the confusion, ask**.

**A3 — API-and-interface-design skill.** New skill `api-and-interface-design.md` triggered when the architect proposes a public interface, RPC schema, persistence shape, wire protocol, or new third-party dependency. Five sections:

- **Hyrum's Law** — every observable behaviour will be depended on. Pin the shape (return type, error type, headers), pin the order (sort key + direction), pin the silence (what is returned on missing input / partial failure / timeout), pin the timing (sync, async, eventual, with what staleness window).
- **One-version rule** — no diamond dependencies; no type-incompatible siblings; no schema fork. Document the version pin in `decisions.md`.
- **Untrusted third-party API responses** — validate at the boundary with a schema library (zod, valibot, ajv, yup, pydantic, etc.); on validation failure throw a typed error, never pass partial / undefined fields downstream.
- **Two-adapter rule** (mattpocock) — a port is justified only when at least two adapters are concretely justified. Document both adapters in `decisions.md`. A single-adapter port is dead architecture.
- **Consistent error model per boundary** — pick one shape (Result type, throw + typed catch, RFC 7807 problem-details, error code enum), document it, never mix.

Architect prompt updated: Sub-agent context lists the skill as item 5; Phase 1 reads it when a candidate D-N matches the trigger; Composition footer mentions it.

Antipatterns: **A-23 — Hyrum's Law surface unpinned**, **A-24 — Unvalidated external response shape**, **A-25 — Hypothetical seam (one-adapter port)**.

**B1 — Code-simplification catalog in `refactor-safety.md`.** Three rules:

- **Chesterton's Fence** — before deleting a check, guard, branch, comment, option flag, or env-var default, walk the four-step protocol: (1) read git history (`git log -L`, `git blame`); (2) search for related tests; (3) search for callers / dependents; (4) if no reason can be identified, **ask** before removing. Antipattern **A-26 — Chesterton's Fence violation** (always `required`).
- **Rule of 500** — past 500 lines of mechanical change, invest in automation: codemod (`jscodeshift`, `ts-morph`, `libcst`), AST transform script, structural `sed`. Document the chosen automation in `decisions.md` (D-N) before running it. Antipattern **A-27 — Rule of 500 violation** (severity `consider`).
- **Structural simplification patterns** — eight named patterns (Guard clauses, Options object, Parameter object, Null object, Polymorphism, Extract class, Extract variable, Extract function) with one-line rules per pattern. Pattern names go in commit messages.

**B2 — Test-design checklist in `tdd-cycle.md`.** Three rules added under "Writing good tests":

- **One logical assertion per test** — multiple `expect()` are fine when they describe one outcome from multiple angles; not fine when they bundle two unrelated outcomes. Severity `consider` (axis=readability) on violation.
- **Prefer SDK-style boundary APIs over generic fetchers** — `getUser()` / `getOrders()` / `createInvoice()` over `fetch(endpoint, options)`. SDK-style methods can be mocked individually; generic fetchers force switch-on-URL mocks that lose type safety. Antipattern **A-28 — Generic-fetcher mock with switch-on-URL logic** (severity `consider`).
- **Smell catalogue** — primitive obsession (multiple `string` parameters with different meanings → typed value objects with brand types) and feature envy (`a.method()` reads / writes mostly fields of `b` → move method to `b`). Surfaced under `## Summary → Noticed but didn't touch`; AC scope does not expand to fix.

Antipatterns: **A-29 — Primitive obsession masquerading as type safety**, **A-30 — Feature envy**.

**B3 — Deprecation & migration patterns in `breaking-changes.md`.** Three patterns:

- **Churn Rule** — the deprecator owns the migration, not the consumer. Identify consumers (`rg`, dependency graph); pick a cost split (deprecator ships an adapter OR deprecator pairs with each consumer's owner to land migration commits); document the choice in `decisions.md`. Antipattern **A-31 — Churn Rule violation** (severity `required`).
- **Strangler Pattern** — five phases (0% old / 100%; 1% canary; 10% / 50% with parity monitoring; 100% with old fenced off; old removed). Each phase has explicit ship-gate criteria and rollback steps. Antipattern **A-32 — Big-bang migration** (severity `required`).
- **Zombie Code lifecycle** — code nobody owns but everybody depends on. Architect's response: assign an owner OR deprecate with a concrete migration plan. Antipattern **A-33 — Zombie code reliance** (severity `consider` → `required` on security-sensitive paths).

### Schema

`flow-state.json` stays at `schemaVersion: 3`. `TriageDecision` gains an optional `interpretationForks?: string[] | null` field; pre-v8.7 state files validate without it. The reading rule is `null` or absent → "no fork was needed; the prompt was unambiguous"; non-empty array → "the user picked these readings".

The orchestrator's pre-flight (Hop 2.5) gains a sub-step: ambiguity-check → if ambiguous, fork-question → persist chosen reading → continue with assumptions. Pre-v8.7 flow states keyed off the absence of `interpretationForks` continue without the fork sub-step.

### Tests

569 passing — 491 baseline plus a new `tests/unit/v87-surgical-debug-browser-forks.test.ts` (78 cases) covering: A2 iron-law deepening (stop / name / ask + propose simpler + multiple interpretations); A1 pre-flight ambiguity forks (2-4 readings, three-line shape, mutually exclusive + collectively defensible, persistence verbatim); S1 surgical-edit-hygiene skill registration + slice-builder rule 14 + reviewer wiring + antipatterns A-16 / A-17; S2 debug-loop skill (six phases, ten-rung ladder, tagged-log protocol, multi-run protocol, no-seam finding, debug-N.md artifact) + slice-builder rule 16 + reviewer wiring + antipatterns A-21 / A-22; S4 browser-verification skill (DevTools wiring, five-check pass, untrusted-data rule, artifact format) + slice-builder rule 15 + reviewer wiring; A3 api-and-interface-design skill (Hyrum, one-version, untrusted-3rd-party, two-adapter, consistent error model) + architect Sub-agent context wiring + antipatterns A-23 / A-24 / A-25; B1 simplification catalog in refactor-safety (Chesterton, Rule of 500, eight structural patterns) + antipatterns A-26 / A-27; B2 test-design checklist in tdd-cycle + antipatterns A-28 / A-29 / A-30; B3 deprecation patterns in breaking-changes + antipatterns A-31 / A-32 / A-33.

`npm run release:check` is green. `npm pack --dry-run` produces `cclaw-cli-8.7.0.tgz`.

### Compatibility

Backward compatible at the wire level. Existing 8.6 state files validate without changes. Existing in-flight slugs continue with saved `triage` and `lastSpecialist`; the next dispatch loads the new contracts (next plan/build/review runs through the new hard rules; next architect dispatch reads the api-and-interface-design skill when its triggers fire).

Existing shipped slugs are not retroactively migrated. New flows started after upgrade pick up all v8.7 behaviour automatically.

### Acknowledgements

Surgical-edit hygiene draws from `forrestchang-andrej-karpathy-skills` (CLAUDE.md "Surgical Changes — don't 'improve' adjacent code") and `addyosmani-skills` (`code-review-and-quality` dead-code hygiene). Debug-loop is the operational synthesis of `mattpocock-skills` `diagnose` (loop ladder + ranked hypotheses) and karpathy's "reproduce flaky tests N times". Browser verification draws from `addyosmani-skills` (`browser-testing-with-devtools`, "zero console errors as a shipping bar"). The ambiguity-fork sub-step encodes karpathy's "if multiple interpretations exist, present them — don't pick silently" rule. The api-and-interface-design skill bundles Hyrum's Law (industry folklore), the one-version rule (Google's monorepo doctrine via addyosmani), the untrusted-third-party-response rule (addyosmani `context-engineering`), and mattpocock's two-adapter seam rule (`improve-codebase-architecture`). Code-simplification, test-design checklist, and deprecation patterns are addyosmani's `code-simplification`, mattpocock's `tdd/tests` + `migrate-to-shoehorn`, and addyosmani's `deprecation-and-migration` respectively.

## 8.6.0 — Three-section summary, anti-sycophancy reviewer, self-review gate, ADR catalogue, SDD doc cache, mandatory pre-task read order

### Why

Two reference libraries — `addyosmani-skills` and `chachamaru127-claude-code-harness` — pointed at six concrete weaknesses 8.5 still carried even after the Hop 6 / contract-first / discovery cleanup:

1. **Specialist artifacts had no standard "I'm done" footer.** Each plan, build, review, and decisions file ended differently. Hand-offs lost track of "what was actually changed in this artifact, what was noticed-but-skipped, and what the author is still uncertain about". `addyosmani-skills`'s "Summary" block carries those three sections in one place.
2. **The reviewer found bugs but never said what was good.** Iteration outputs were a wall of findings; a clean diff and an axed-up diff rendered with the same shape. There was no anti-sycophancy contract — a real pass got the same template as a barely-passing one.
3. **The reviewer never attested to "I actually ran the tests".** Verification was implicit: the prompt said "run tests / build / security pre-screen", but the artifact didn't have to surface a yes/no plus evidence. Skipped checks were invisible.
4. **Slice-builder returns went straight to the reviewer even when work was incomplete.** A "tests passed but I didn't run the build" build still cost a full reviewer dispatch to bounce back. There was no pre-review gate where the slice-builder attests to its own work.
5. **Architectural decisions died inside flows.** `decisions.md` lived in `flows/<slug>/` and was archived to `flows/shipped/<slug>/decisions.md` after ship. There was no repo-wide catalogue. Anyone wanting "what's the canonical reason we use Postgres + pgvector for embeddings" had to hunt through shipped slugs.
6. **Source-driven mode re-fetched the same docs every flow.** A 12-flow project hitting React 19 docs paid the network cost 12 times. There was no cache, no etag/last-modified handling, no freshness rule.
7. **Architects and planners authored without a forced "look at the code first" step.** Phase 2.5 in 8.5 said "consider repo-research"; nothing said "before you propose a change to `src/auth/session.ts`, you MUST have read the file, its tests, the neighbour pattern, and the types".

### What changed

**A2 — Three-section Summary block in every primary artifact.** A new always-on skill `summary-format.md` defines the canonical block. Every specialist that authors a primary artifact (`plan.md`, `decisions.md`, `build.md`, `review.md`) now ends it with:

```
## Summary — <specialist>[ — iteration N]
### Changes made
- <one bullet per concrete change committed to this artifact, in past tense>
### Noticed but didn't touch
- <one bullet per finding/observation outside the artifact's scope>
### Potential concerns
- <one bullet per uncertainty, assumption-at-risk, or follow-up worth surfacing>
```

The skill is wired into the always-on autoload set and triggered by edits to plan / build / review / decisions files. Brainstormer, architect, planner, slice-builder, and reviewer all gained a phase that authors this block before returning, plus a self-review check that the block is present and non-empty. Reviewer adds one block per iteration (`## Summary — iteration 1`, `## Summary — iteration 2`, etc.). Closes weakness #1.

**A3 — Anti-sycophancy reviewer + verification story (mandatory).** Reviewer's iteration output now carries two new sections in addition to findings:

- `### What's done well` — at least one evidence-backed item per iteration. Format: `- <claim> — Evidence: <file:line | diff hunk | test name | manifest path>`. The reviewer prompt explicitly forbids generic praise ("looks clean", "well-structured", "good naming"); every item must cite a specific path:line or hunk and explain *why* it's done well in one sentence. Iterations with zero `What's done well` bullets are treated as a contract violation.
- `### Verification story` — three explicit yes/no rows the reviewer must answer before any finding is recorded:
  - `- Tests run: <yes | no> — <which suite, exit code or pass count, evidence>`
  - `- Build/typecheck run: <yes | no> — <which command, evidence>`
  - `- Security pre-screen run: <yes | no> — <which checks, evidence>`

`no` is a valid answer when a category truly doesn't apply (e.g. docs-only diff has no test suite to run); the reviewer must still write the row and justify the `no` in the evidence column. Hard rule: an iteration without all three rows is a contract violation. Closes weakness #2 + #3.

**A4 — Self-review gate before reviewer dispatch.** Slice-builder's strict-mode summary block now carries a `self_review[]` array with four mandatory rules:

- `tests-fail-then-pass` — verified that the new test went RED before implementation and GREEN after.
- `build-clean` — verified `tsc --noEmit` / `npm run build` / equivalent ran clean.
- `no-shims` — verified no temporary stubs, mocks-of-the-real-thing, or `// TODO unmock me` slipped in.
- `touch-surface-respected` — verified the diff did not touch files outside the planner-declared `touchSurface`.

Each rule has shape `{ rule, verified: <true | false>, evidence: "<concrete cite or short justification>" }`. Orchestrator's Hop 4 — Pause — gains a pre-reviewer gate: if any rule has `verified: false` OR `evidence` is empty, the orchestrator **bounces the slice back to the slice-builder in `fix-only` mode without dispatching the reviewer**. The bounce envelope tells the slice-builder which rule(s) failed, so the loop is `slice-builder → bounce → slice-builder → reviewer` rather than `slice-builder → reviewer (cheap finding) → slice-builder → reviewer`. Closes weakness #4 and saves a full reviewer round-trip per incomplete slice.

**B2 — Repo-wide ADR catalogue.** A new skill `documentation-and-adrs.md` describes a project-level Architectural Decision Record set living at `docs/decisions/ADR-NNNN-<slug>.md`. Lifecycle is three-state:

- `PROPOSED` — written by the architect during a `large-risky` flow when a decision deserves long-term durability (a stack pick, an architectural seam, a build-system convention, a security posture). The architect writes the ADR with `status: PROPOSED` next to authoring `decisions.md`. The ADR cites the originating flow slug.
- `ACCEPTED` — promoted by the orchestrator during Hop 6 — Finalize. After the slug ships, the orchestrator rewrites every PROPOSED ADR linked to that slug to `ACCEPTED`, commits, and includes the change in the ship commit. ADRs are NEVER promoted by a sub-agent.
- `SUPERSEDED` — set when a later ADR replaces this one. The superseding ADR adds a `supersedes: ADR-NNNN` field; the superseded ADR is updated to `status: SUPERSEDED`, with a `superseded-by: ADR-NNNN` back-link. Both edits happen in the same flow.

The orchestrator's `cancel` command is updated: cancelling a flow rewrites every PROPOSED ADR linked to that slug to `REJECTED` (status, not deletion). Closes weakness #5: ADRs survive flow cancellation as a record of "we considered X, decided not to do it for reason Y".

**B5 — SDD doc cache for source-driven mode.** The `source-driven.md` skill grew a "Cache lookup before fetch" section. Cache lives at `.cclaw/cache/sdd/<host>/<url-path>.{html,etag,last-modified}` (per-project, never shared across projects). Lookup rules:

- **Fresh hit** (`< 24h` since `last-modified` write): use cached content, write `cache_status: fresh-cache` next to the `cache_path` in the `## Sources` block.
- **Stale hit** (`> 24h` but file present): issue a conditional GET with `If-None-Match: <etag>` / `If-Modified-Since: <last-modified>`. On `304 Not Modified` the cache stays as-is and `cache_status: revalidated-cache` is written. On `200 OK` the cache is overwritten and `cache_status: refetched` is written. Network failure with stale cache writes `cache_status: stale-cache`; the reviewer treats `cache_status: stale-cache` as a finding (severity `consider`) so the user knows the docs may be out of date.
- **Miss**: fetch fresh, write `cache_status: fetched`.

`.cclaw/cache/` is added to `REQUIRED_GITIGNORE_PATTERNS`. The `## Sources` block in `decisions.md` and `plan.md` now carries `cache_path: <relative path>` and `cache_status: <one of fresh-cache | revalidated-cache | refetched | stale-cache | fetched>` per source. Closes weakness #6.

**B6 — Mandatory pre-task read order in architect and planner (brownfield).** Both prompts gained a `Phase 2.5 — Pre-task read order` step that runs before any authoring on brownfield repos. The order is non-negotiable:

1. **Target file(s)** — the file(s) the change will touch (the focus surface).
2. **Tests** — the test file(s) covering the focus surface, or the nearest analogous tests if none exist for the surface itself.
3. **Neighbour pattern** — the most analogous existing implementation in the same module / package.
4. **Types** — the type definitions the focus surface depends on (when the surface uses statically-typed code).

Architect's self-review checklist now requires every `D-N` decision to cite which read produced the supporting evidence. Planner's self-review checklist now requires every AC's `touchSurface` path to have been physically read as part of step 1, NOT picked from `repo-research.md`'s summary. Greenfield work writes "no existing files — N/A" against each step and continues. Closes weakness #7.

### Schema

`flow-state.json` stays at `schemaVersion: 3`. No flow-state field added.

`REQUIRED_GITIGNORE_PATTERNS` adds `.cclaw/cache/`. New installs and `cclaw upgrade` write the line; existing repos are unaffected by a single missing line until the next gitignore reconcile.

ADR files live outside `flow-state.json` at `docs/decisions/ADR-NNNN-<slug>.md`. The orchestrator scans for `status: PROPOSED` ADRs at ship time and at cancel time using a simple frontmatter parser; no schema field beyond the file convention.

The slice-builder's JSON summary block gains the `self_review` array. Old slim summaries without it are read as "self_review failed" and bounced — this is intentional, since 8.5 slice-builders should not return on 8.6 orchestrators (the upgrade path is to re-dispatch the slice). The summary block field stays optional in the validator for forward-compat.

### Tests

491 passing — 429 baseline plus a new `tests/unit/v86-summary-adr-cache-readorder.test.ts` (62 cases) covering: `summary-format` skill registration as always-on with edit triggers; brainstormer / architect / planner / slice-builder / reviewer authoring the three-section summary block; reviewer's `What's done well` evidence-backed format and forbid on generic praise; reviewer's three-row Verification story (tests / build / security with yes-no plus evidence); slice-builder's `self_review[]` array carrying all four rules with `verified` and `evidence`; orchestrator's pre-reviewer gate bouncing on any failed rule or empty evidence; orchestrator's bounce-envelope shape (`fix-only` mode, list of failed rules); `documentation-and-adrs` skill describing the three-state ADR lifecycle; orchestrator's Hop 6 promoting PROPOSED → ACCEPTED at ship; orchestrator's cancel rewriting PROPOSED → REJECTED; ADRs never deleted; supersede chain (`supersedes`/`superseded-by`); `source-driven` skill's cache section enumerating cache_status values, conditional GET semantics, 24h freshness rule; `.cclaw/cache/` in `REQUIRED_GITIGNORE_PATTERNS`; reviewer treating `cache_status: stale-cache` as a `consider` finding; architect's Phase 2.5 mandatory four-read order; planner's Phase 2.5 mandatory four-read order with AC `touchSurface` gating; greenfield N-A bypass for both prompts.

`npm run release:check` is green. `npm pack --dry-run` produces `cclaw-cli-8.6.0.tgz`.

### Compatibility

Backward compatible at the wire level. Existing 8.5 state files validate without changes. Existing in-flight slugs continue with the saved `triage` and `lastSpecialist` semantics; resume re-dispatches the next specialist with the new contracts (so the next plan / build / review will carry the new summary block, the next slice will carry `self_review[]`, the next architect dispatch will run Phase 2.5).

Existing shipped slugs are not retroactively migrated; their `decisions.md` / `plan.md` / `review.md` files keep their pre-8.6 endings.

Existing repos with no `.cclaw/cache/` directory are unaffected until the next source-driven dispatch creates the directory (and the next gitignore reconcile adds the ignore line).

### Acknowledgements

The three-section summary block draws inspiration from `addyosmani-skills`'s standard summary footer. The anti-sycophancy reviewer + verification story patterns are inspired by `chachamaru127-claude-code-harness`'s explicit "what was tested" + "what's good" review template. The repo-wide ADR catalogue is the canonical Michael Nygard ADR pattern, adapted to the `PROPOSED → ACCEPTED → SUPERSEDED` lifecycle with orchestrator-managed promotion. The pre-task read order draws from `chachamaru127`'s "look at the code before you propose changes to it" workflow.

## 8.5.0 — Hop 6 finalize, contract-first dispatch, deeper specialists, research helpers, discovery as plan sub-phase

### Why

A real test run on `/Users/zuevrs/Projects/test/` after the 8.4 release surfaced a small set of high-impact problems that v8.4's confidence/pre-mortem/five-axis additions didn't touch:

1. **Ship duplicated the flow.** After `ship`, both `flows/<slug>/` and `flows/shipped/<slug>/` existed. The orchestrator was instructing the sub-agent to "Copy (not move)" artifacts, leaving the active dir intact and creating a parallel copy in `shipped/`.
2. **Specialists ran shallow.** `brainstormer`, `architect`, `planner` were dispatched with ~30-line inline summaries instead of the 194-line / 256-line / 297-line contracts under `.cclaw/lib/agents/`. The detailed phase-by-phase workflows and self-review checklists were never loaded; sub-agents single-shot a response.
3. **`discovery` was contradictory.** The triage gate sometimes wrote `path: ["plan", "build", "review", "ship"]` and the README said `["discovery", "plan", "build", "review", "ship"]`. Both shapes appeared in the wild; the orchestrator handled both quietly, but the spec was self-contradicting.
4. **`pre-mortem.md` wasn't archived.** Adversarial pre-mortem (added in 8.4) wrote `pre-mortem.md` into `flows/<slug>/`, but `compound.runCompoundAndShip`'s `allStages` list didn't include it — so on ship-finalize the pre-mortem stayed in the active dir as residue.
5. **`lastSpecialist` wasn't updated mid-discovery.** After `architect` ran, `flow-state.lastSpecialist` was still `null` or `brainstormer`. Resume after a discovery checkpoint had no way to know which sub-step to skip.
6. **No mechanism for context gathering.** Greenfield tasks went straight to planner with zero repo grounding. Brownfield tasks crawled `knowledge.jsonl` inside the planner's context, eating tokens and re-implementing the same scoring heuristic from prompt-memory.

### What changed

**1. Hop 6 — Finalize (orchestrator-only, `git mv` semantics).** A new explicit hop replaces the one-line "After ship + compound, move every \`<stage>.md\` …" instruction. The orchestrator (NOT a sub-agent) runs `git mv` (or `mv` when files aren't tracked) on every artifact in the slug dir, asserts the active dir ends up empty, removes the empty dir, and resets `flow-state.json` to fresh defaults. The word **"copy" is forbidden** anywhere in the finalize step or in dispatch envelopes leading to it. Re-entrant finalize on resume detects an already-shipped slug (`shipped/<slug>/manifest.md` exists, active dir empty) and stops. The specifically-listed artifact set covers `plan.md`, `build.md`, `review.md`, `ship.md`, `decisions.md`, `learnings.md`, `pre-mortem.md`, `research-repo.md`, `research-learnings.md`. Fix #1 + #4 + closes the duplicate-flow regression.

**2. Mandatory contract reads in every dispatch envelope.** Every dispatch from the orchestrator now starts with two non-negotiable reads as the sub-agent's first lines:

```
Required first read: .cclaw/lib/agents/<specialist>.md  (your contract — modes, hard rules, output schema, worked examples; do NOT skip)
Required second read: .cclaw/lib/skills/<wrapper>.md  (your wrapping skill)
```

The orchestrator's "Always-ask rules" gain a hard rule: *"A sub-agent that skips either of those reads is acting on a hallucinated contract."* The brainstormer / architect / planner prompts also explicitly instruct themselves to read their contract file as Phase 1, so even harnesses that don't render the envelope verbatim still get the right behaviour. Fix #2.

**3. Brainstormer rewritten as an explicit 8-phase workflow.** The brainstormer prompt is now a literal multi-step recipe: Bootstrap → Posture pick → Repo signals scan → (optional) repo-research dispatch → Clarifying questions (one at a time, max 3) → Author Frame + Approaches + Selected + Not Doing + (Pre-Mortem) → 9-item self-review checklist → Return slim summary + JSON. The Phase 5 Q&A rules forbid batches and `[topic:…]` tags (re-affirming the v8 anti-pattern); Phase 7 self-review enumerates "Frame names a user", "verifiable success criterion", "Approaches rows are defensible", and 6 more concrete checks. The `deep` posture explicitly dispatches `repo-research` before authoring, the only specialist-initiated dispatch in the prompt. Fix #3.

**4. Two new read-only research helpers — `repo-research` and `learnings-research`.** Two lightweight on-demand sub-agents (under 250 lines of prompt each) that the planner / architect / brainstormer dispatch *before* authoring. They are NOT specialists: they never become `lastSpecialist`, never appear in `triage.path`, and the orchestrator never dispatches them directly. They write a single short markdown file (`flows/<slug>/research-repo.md` and `flows/<slug>/research-learnings.md`) and return a slim summary with confidence calibration.

- **`repo-research`** scans the project root manifest, `AGENTS.md` / `CLAUDE.md`, focus-surface dirs, and test conventions. Time-boxed to ~3 minutes. Returns "stack + 3-5 cited patterns + test conventions + risk areas + what I did NOT investigate". Cited path:line everywhere; no proposals; no code rewrites. Brownfield only — greenfield writes "no existing patterns" and stops.
- **`learnings-research`** scans `.cclaw/knowledge.jsonl`, scores entries on surface overlap + failure-mode hint + acmode parity, picks the top 1-3 with score ≥ 4, opens each candidate's `learnings.md`, and returns verbatim quotes the planner pastes into `plan.md`. Cap is 3; "no prior slugs apply" is a valid result. The whole "should the planner read knowledge.jsonl in-prompt?" pattern from 8.4 is replaced with a sub-agent dispatch — planner gets focused context without paying the search-and-rank token cost.

The planner's prompt now mandates the `learnings-research` dispatch in Phase 3 (every plan dispatch, greenfield + brownfield) and the `repo-research` dispatch in Phase 4 (only on brownfield). The architect may dispatch `repo-research` in Phase 3 when brainstormer didn't and the focus surface needs grounding; the brainstormer may dispatch it in Phase 4 only on `deep` posture. Fix #6.

**5. `discovery` is a sub-phase of `plan`, never a `triage.path` entry.** `triage.path` only ever holds the four canonical stages: `["plan", "build", "review", "ship"]` — full stop. On `large-risky`, the **plan stage expands** into `brainstormer → checkpoint → architect → checkpoint → planner` instead of dispatching `planner` directly. `currentStage` stays `"plan"` for all three; `lastSpecialist` rotates through `"brainstormer"` → `"architect"` → `"planner"`. The triage gate skill no longer offers `discovery → plan → build → review → ship` as a path option (that wording was the source of the contradiction). The "Available stage entries" path-validation rule is now single-stage: `triage.path ⊆ {plan, build, review, ship}`. Pre-v8.5 state files containing `"discovery"` in the path are normalised on read (the entry is stripped). Fix #3.

**6. `pre-mortem.md` is a first-class artifact stage.** `ArtifactStage` widens to include `"pre-mortem"`, `ARTIFACT_FILE_NAMES` adds `pre-mortem: "pre-mortem.md"`, `compound.runCompoundAndShip`'s `allStages` array gains `"pre-mortem"`. The Hop 6 finalize move list explicitly includes `pre-mortem.md`. Fix #4.

**7. `lastSpecialist` widened from `DiscoverySpecialistId | null` to `SpecialistId | null`, updated after every dispatch.** The flow-state validator now accepts `"reviewer"`, `"security-reviewer"`, and `"slice-builder"` as `lastSpecialist` values (in addition to the three discovery specialists). The orchestrator's dispatch loop step 5 spells out: "Patch `flow-state.json` after every dispatch (not only at end-of-stage): `lastSpecialist` = the id of the specialist that just returned." Resume from a discovery checkpoint reads `lastSpecialist == "architect"` and skips straight to the planner dispatch instead of restarting from brainstormer. The Composition footer of every specialist mentions that the orchestrator updates `lastSpecialist` after the slim summary returns; specialists do NOT mutate `flow-state.json` themselves. Fix #5.

### Specialist prompts deepened

**Brainstormer (194 → 280+ lines):** explicit 8-phase workflow, Phase 7 self-review checklist, Phase 4 deep-posture repo-research dispatch, two worked examples (full guided flow + compressed lean flow).

**Architect (256 → 320+ lines):** Phase 1 bootstrap (mandatory contract reads), Phase 2 assumptions cross-check, Phase 3 conditional repo-research dispatch, Phase 7 self-review checklist (8 concrete checks). The "## Assumptions (read first)" section is renamed to "Phase 2 — Assumptions cross-check" but keeps the same body.

**Planner (297 → 360+ lines):** explicit 8-phase workflow, Phase 3 mandatory `learnings-research` dispatch (replacing the in-prompt "read knowledge.jsonl yourself" pattern), Phase 4 conditional `repo-research` dispatch on brownfield only, Phase 6 verbatim copy of surfaced lessons from `research-learnings.md`, Phase 7 self-review checklist (10 concrete checks). The Composition footer enumerates which research helpers the planner may dispatch (`learnings-research` always; `repo-research` conditional) and which it may not (any specialist).

### Schema

`flow-state.json` stays at `schemaVersion: 3`. `lastSpecialist` widens but the on-disk shape is unchanged — old states with `lastSpecialist: "brainstormer" | "architect" | "planner" | null` validate as before, and new states with `"reviewer" | "security-reviewer" | "slice-builder"` validate as new valid values.

`ArtifactStage` adds `"pre-mortem"`. `ARTIFACT_FILE_NAMES["pre-mortem"]` = `"pre-mortem.md"`. `RESEARCH_AGENT_IDS` is a new exported constant: `["repo-research", "learnings-research"]`. `CORE_AGENTS` now includes both specialists (`SPECIALIST_AGENTS`) and research helpers (`RESEARCH_AGENTS`); install paths iterate the combined list.

### Tests

429 passing — 383 baseline plus a new `tests/unit/v85-finalize-research-contracts.test.ts` (46 cases) covering: Hop 6 finalize semantics (`git mv` mandate, "no copy" rule, post-condition empty-dir check, idempotent re-entrant finalize); contract-first dispatch envelopes (Required first read + Required second read in every envelope); brainstormer's 8-phase workflow with Phase 5 Q&A rules and Phase 7 self-review; research helper registration (`RESEARCH_AGENT_IDS`, `RESEARCH_AGENTS`, `SPECIALIST_AGENTS` separation); `repo-research` and `learnings-research` prompts being read-only with single-artifact output; planner Phase 3 `learnings-research` dispatch; planner Phase 4 brownfield-only `repo-research` dispatch; architect Phase 3 conditional `repo-research` dispatch; architect's "learnings-research is the planner's tool" forbid; orchestrator's "discovery is never a stage" rule; `pre-mortem.md` as a first-class `ArtifactStage`; `lastSpecialist` widening (every specialist id validates); orchestrator dispatch loop's "patch lastSpecialist after every dispatch" semantics; stage → wrapper-skill mapping in the orchestrator.

The pre-existing `v84-confidence-assumptions-fiveaxis-pre-mortem.test.ts` was lightly updated to match the new "Phase N" wording in planner / architect (the assumptions section moved into Phase 2; the prior-lessons section now references `research-learnings.md` instead of the in-prompt knowledge.jsonl scan).

### Migration

Existing v8.4 (and earlier v8.x) state files validate without changes. Existing in-flight slugs continue with the saved `lastSpecialist` and `currentStage` semantics; resume dispatches the next specialist as before. Existing shipped slugs are not retroactively migrated; the next ship invokes the new Hop 6 finalize semantics.

Pre-v8.5 state files that contain `"discovery"` in `triage.path` are normalised on read — the orchestrator strips the entry and continues with the remaining stages. No code runs on the entry, so the result is identical to the new "discovery as sub-phase" semantics.

The `RESEARCH_AGENTS` install adds two new files under `.cclaw/lib/agents/`: `repo-research.md` and `learnings-research.md`. Existing installs pick them up on the next `cclaw upgrade`.

### Acknowledgements

The 8-phase brainstormer workflow draws inspiration from `obra-superpowers/skills/brainstorming/SKILL.md` (9-step checklist, one-question-at-a-time, no batched questions). The research-helper pattern draws inspiration from `everyinc-compound/plugins/compound-engineering/skills/ce-plan/SKILL.md` (sub-phase dispatch of `repo-research-analyst` and `learnings-researcher` before planning) and `gstack/SKILL.md` (lightweight read-only context-gatherers). The "discovery as sub-phase, not a path entry" cleanup mirrors `addyosmani-skills`'s philosophy of keeping the orchestrator's vocabulary minimal.

## 8.4.0 — Confidence calibration, pre-flight assumptions, five-axis review, source-driven mode, adversarial pre-mortem, cross-flow learning, test-impact GREEN

### Why

8.3 made cclaw nicer to live with day-to-day (structured triage, step/auto, fan-out diagram, deeper TDD vocabulary). But three references — `addyosmani-skills`, `forrestchang-andrej-karpathy-skills`, `mattpocock-skills` — still pointed at things cclaw was *not* doing:

1. **Sub-agent slim summaries returned no confidence.** A clean `Stage: review ✅ complete` looked identical whether the reviewer walked the whole diff or skimmed it. The orchestrator had no signal to pause for human attention before chaining the next stage in `auto`.
2. **Triage answers "how big is this work?" but never "on what assumptions are we doing it?"** Defaults around stack version, file conventions, architecture tier, and out-of-scope items were silently assumed by every specialist. The single most common reason a small/medium build shipped the wrong feature.
3. **The reviewer found "issues" but didn't map them to axes.** A correctness bug and a nit-pick rendered with the same shape. Severity was a coarse `block | warn | info` triple — `addyosmani` carries five.
4. **Framework-specific code shipped from the model's training memory, not from current docs.** React 18 patterns in a React 19 codebase, deprecated Next.js APIs, Prisma migrations against last year's CLI surface. addyosmani's source-driven skill solves this; cclaw didn't have an equivalent.
5. **The ship gate was a single safety belt.** A reviewer who said "looks good" closed the loop. There was no second specialist actively looking for *failure modes* — data loss, races, regressions, blast radius.
6. **Plans were written from scratch every flow.** The append-only `knowledge.jsonl` carried lessons from every shipped slug, and nobody read it. Same mistakes shipped twice.
7. **TDD GREEN ran the full suite every cycle.** On a 50-AC project that meant a full multi-minute run between every micro-cycle; faster harnesses got abandoned.

### What changed

**D — Confidence calibration in slim summaries.** Every specialist (brainstormer, architect, planner, reviewer, security-reviewer, slice-builder) now emits `Confidence: <high | medium | low>` as a mandatory line in its slim summary. The specialist prompt explains *what each level means for that stage*: e.g. for the reviewer, `medium` = one axis was sampled, `low` = diff exceeded reviewability (>1000 lines or unrelated changes). The orchestrator's Hop 4 — *Pause* — treats `Confidence: low` as a **hard gate in both `step` and `auto` modes**: it renders the summary, refuses to chain the next stage, and offers `expand <stage>` (re-dispatch the same specialist with a richer envelope), `show`, `override` (resumes auto-chaining), or `cancel`.

**A — Pre-flight assumptions (Hop 2.5).** A new orchestrator hop runs **after triage, before the first specialist dispatch**, only on fresh starts on non-inline paths. The `pre-flight-assumptions.md` skill instructs the orchestrator to surface 3-7 numbered assumptions (stack + version, repo conventions, architecture defaults, out-of-scope items) using the harness's structured ask tool with four options (`Proceed` / `Edit one` / `Edit several` / `Cancel`). The user-confirmed list is persisted to `flow-state.json` under `triage.assumptions` (string array), and is **immutable for the lifetime of the flow**. Both `planner` and `architect` now have a "## Assumptions (read first)" section in their prompts: copy verbatim into `plan.md` / `decisions.md`, treat as authoritative, surface a feasibility blocker if a decision would break an assumption.

Resume semantics: skip Hop 2.5 entirely on resume (`triage.assumptions` already on disk). Skip on `inline` (no specialist dispatch happens, so there is nothing to ground).

**C — Five-axis review with five-tier severity.** The reviewer's `code` mode now mandates explicit coverage of five axes — `correctness`, `readability`, `architecture`, `security`, `performance` — every iteration. Each finding carries an `axis: <one>` and a `severity: <critical | required | consider | nit | fyi>` tag (replacing the old `block | warn | info` triple). Ship-gate semantics are now `acMode`-aware:

- `strict`: any open `critical` *or* `required` finding blocks ship.
- `soft`: any open `critical` finding blocks ship; `required`/`consider`/`nit`/`fyi` carry over to `learnings.md`.

The slim summary's `What changed` line gains an `axes:` breakdown (`c=N r=N a=N s=N p=N`) so the orchestrator and the user can see at a glance whether the review was lopsided. Legacy ledgers using `block | warn | info` are explicitly mapped to the new severities (block → critical | required, warn → consider | nit, info → fyi) in the reviewer prompt's "## Migration" section; pre-existing `flows/<slug>/review.md` files keep working.

**B — Source-driven mode.** A new always-on skill `source-driven.md` instructs `architect` and `planner` (and, indirectly, `slice-builder`) to:

1. **Detect** stack + versions from `package.json` / `pyproject.toml` / `Cargo.toml` / `go.mod` etc. before writing anything.
2. **Fetch** the relevant version-pinned official documentation page (deep-link, not the landing page).
3. **Implement** against the patterns documented at that URL — never against training memory.
4. **Cite** the URL inline, in `decisions.md` for D-N entries and in code comments where the API choice is non-obvious.

Source-driven is **default in `strict` mode for framework-specific work** (React hooks, Next.js routing, Prisma migrations, Tailwind utilities, Django views, Spring Boot annotations, etc.) and **opt-in for `soft`**. When official docs are unreachable or do not cover the case, the specialist writes `UNVERIFIED — implementing against training memory; consider re-checking when docs available` next to the affected line. The skill integrates with the `user-context7` MCP tool when present and falls back to direct `WebFetch` of `developer.<framework>.dev/...` URLs otherwise.

**E — Adversarial pre-mortem before ship (strict only).** Hop 5 — *Ship + Compound* — now dispatches `reviewer` mode=`adversarial` **in parallel** with `reviewer` mode=`release` (and, when `security_flag` is set, `security-reviewer` mode=`threat-model`). The adversarial reviewer is told to actively try to break the change: it picks the most pessimistic plausible reading of the diff and writes a `flows/<slug>/pre-mortem.md` artifact listing 3-7 likely failure modes (data-loss, race, regression, blast-radius, rollback-impossibility, accidental-scope, hidden-coupling). Uncovered risks become `required`/`critical` findings in `review.md`, escalating the ship gate. Soft mode skips this — it would be a false-positive factory.

**G — Cross-flow learning in the planner.** The planner's prompt now reads `.cclaw/knowledge.jsonl` at the start of every plan dispatch and surfaces 1-3 relevant prior entries — the lessons captured by `compound` from past shipped slugs — in a new `## Prior lessons` section in `plan.md`, citing `learnings/<slug>.md`. Filtering is by surface area (path overlap with the new plan), tag overlap, and recency. The orchestrator's Hop 3 dispatch envelope for `plan` now lists `.cclaw/knowledge.jsonl` as a planner input.

**F — Test-impact-aware GREEN.** The `tdd-cycle.md` skill's GREEN phase now distinguishes a fast inner loop from a safe outer loop:

1. **Affected-test suite first** — narrow vitest/jest/pytest pattern matching the AC's touch surface. Confirms the new test went green.
2. **Full relevant suite second** — the project's standard test command. Confirms nothing else regressed.

REFACTOR still always runs the **full** suite; the speed-up is local to GREEN. The mandatory gate `green_two_stage_suite` is added to `commit-helper.mjs --phase=green` guidance.

### Schema

`flow-state.json` stays at `schemaVersion: 3`. The new `triage.assumptions` field is optional (`assumptions?: string[] | null`) and 8.3 state files without it validate as before. The 8.2 → 8.3 → 8.4 migration is silent: `assumptions` defaults to an empty array via the new `assumptionsOf(triage)` helper.

The Concern Ledger gains `axis` and migrates `severity` from a 3-tier to a 5-tier vocabulary. The reviewer prompt documents the legacy mapping; existing review files are read-back-compatible.

### Tests

376 passing — 311 baseline plus a new `tests/unit/v84-confidence-assumptions-fiveaxis-pre-mortem.test.ts` (65 cases) covering: confidence in every specialist slim summary; orchestrator hard-gate on `Confidence: low` in both run modes; `triage.assumptions` schema and helper; pre-flight skill registration and orchestrator Hop 2.5 wiring (with skip rules for `inline` and resume); planner copying assumptions verbatim and surfacing prior lessons from `knowledge.jsonl`; architect respecting assumptions and surfacing feasibility blockers; reviewer five-axis enforcement and acMode-aware ship gates; legacy severity migration; source-driven skill registration with detect/fetch/implement/cite process and the `UNVERIFIED` marker; adversarial pre-mortem dispatched in parallel with release reviewer in strict ship; pre-mortem.md structure; tdd-cycle two-stage GREEN guidance; cross-flow learning end-to-end.

`npm run release:check` is green; `npm pack --dry-run` produces `cclaw-cli-8.4.0.tgz`; `scripts/smoke-init.mjs` succeeds.

### Compatibility

Backward compatible. 8.3 flow-state files validate, 8.3 review.md ledgers are read with severity migration, no orchestrator-visible breaking change. New behaviour is gated on `acMode` and on the presence of fresh assumptions; existing flows resume without re-prompting for assumptions.

## 8.3.0 — Structured triage ask, run-mode (step / auto), explicit parallel-build, deeper TDD

### Why

Three concrete things broke or felt thin in 8.2:

1. The triage block rendered as a code block in the harness instead of a structured "ask the user" interaction. Users saw four numbered options as plain text and had to scroll-and-type the number.
2. There was no choice between "pause after every stage" and "run plan → build → review → ship without pausing". Every flow forced a pause, even on `inline` / `soft` work the user had already scoped.
3. The orchestrator described build dispatch in one short bullet ("Parallel-build only if planner declared it AND `acMode == strict`") with no fan-out diagram, no envelope, and no merge sequence. Users could not tell whether large strict tasks would actually go to 5 worktrees.

A second-tier reason: the `tdd-cycle` skill described RED → GREEN → REFACTOR but never warned against horizontal slicing, never told the slice-builder to stop the line on an unexpected failure, and never explained when not to mock. Three references — `addyosmani-skills`, `forrestchang-andrej-karpathy-skills`, `mattpocock-skills` — converge on those three rules. We adopt them.

### What changed

**Triage as a structured ask, not a code block.** The `triage-gate.md` skill now tells the orchestrator to use the harness's structured question tool first — `AskUserQuestion` (Claude Code), `AskQuestion` (Cursor), the "ask" content block (OpenCode), `prompt` (Codex). Two questions in order: pick the path (4 options), then pick the run mode (2 options). The first question's prompt embeds the four heuristic facts (complexity + confidence, recommended path, why, AC mode) so the user sees everything in one ask. The fenced-block form remains as a fallback for harnesses without a structured ask facility.

**Run mode: `step` (default) vs `auto`.**

- `step` — pause after every stage, render slim summary, wait for `continue`. Same as 8.2; recommended for `strict` and unfamiliar work.
- `auto` — render slim summary and **immediately dispatch the next stage**. Stops only on hard gates: `block` finding, `cap-reached` (5 review iterations without convergence), security-reviewer finding, or about to run `ship`. The user types `auto` once during triage and means it; the orchestrator chains green stages from there.

The new field is `triage.runMode: "step" | "auto"`. Existing `triage` blocks in `flow-state.json` (8.2 shape) without `runMode` are read as `step` for backward compatibility — same behaviour as 8.2.

**Explicit parallel-build fan-out in Hop 3 build.** The `/cc` body now contains a full ASCII fan-out diagram for the strict-mode parallel-build path: `git worktree add` per slice, branch `cclaw/<slug>/s-N`, max 5 slices, one `slice-builder` sub-agent per slice with a sliced dispatch envelope (slug, slice id, AC ids it owns, working tree, branch, AC mode, touch surface), then a single `reviewer` mode=`integration`, then merge sequence. The skill `parallel-build.md` already documented this; the orchestrator now sees it at the dispatch site.

Hard rules clarified at the orchestrator level:

- More than 5 parallel slices is forbidden. If planner produced >5, planner merges thinner slices into fatter ones — never "wave 2".
- Slice-builders never read each other's worktrees mid-flight; conflict-detection raises an integration finding, never a hand merge.
- `auto` runMode does not skip the integration-reviewer ask on a block finding. Autopilot chains green stages, not decisions.

**TDD cycle deepening.** The `tdd-cycle.md` skill grew four sections, each grounded in a reference:

- *Vertical slicing — tracer bullets, never horizontal waves.* One test → one impl → repeat. The AC-2 test is shaped by what the AC-1 implementation revealed about the real interface. Horizontal RED-batch / GREEN-batch is now A-13 in the antipatterns library; `commit-helper.mjs --phase=red` for AC-2 already refuses if AC-1's chain isn't closed, but the rule is now explicit.
- *Stop-the-line rule.* When anything unexpected happens, stop adding code. Preserve evidence, reproduce in isolation, root-cause to a concrete file:line, fix once, re-run the full suite, then resume. Three failed attempts → surface a blocker. Never weaken the assertion to "make it work".
- *Prove-It pattern (bug fixes).* Reproduce the bug with a failing test FIRST. Confirm it fails for the right reason. Then fix. Then run the full suite. Then refactor.
- *Writing good tests.* Test state, not interactions; DAMP over DRY in tests; prefer real implementations over mocks; respect the test pyramid.

**Three new antipatterns.**

- A-13 — Horizontal slicing.
- A-14 — Pushing past a failing test.
- A-15 — Mocking what should not be mocked.

Citations land in `flows/<slug>/review.md` Concern Ledger findings; the strict-mode AC traceability gate already enforces the underlying TDD chain, the new entries make the why-it-failed copy explicit when the reviewer pushes back.

### Schema

`flow-state.json` stays at `schemaVersion: 3`. The new `triage.runMode` field is optional (TypeScript `runMode?: RunMode`) so 8.2 state files validate without rewriting. The `inferTriageFromLegacy` migration (v2 → v3) now sets `runMode: "step"` so the auto-migrated state matches the documented default. Idempotent.

### Tests

311 passing, including a new test file `tests/unit/v83-ask-runmode-deeper-tdd.test.ts` (33 cases) covering: `RunMode` type and `runModeOf` helper; flow-state schema accepting `runMode` and rejecting `autopilot`; v2 → v3 migration setting `runMode: step`; triage-gate skill referencing `AskUserQuestion` / `AskQuestion` and the run-mode question; orchestrator Hop 4 honoring both modes with the four hard gates; orchestrator Hop 3 fan-out diagram with worktrees + branches + 5-slice cap + integration reviewer; tdd-cycle skill containing vertical-slicing, stop-the-line, prove-it, and writing-good-tests sections; antipatterns library shipping A-13 / A-14 / A-15.

`npm run release:check` is green; `npm pack --dry-run` produces `cclaw-cli-8.3.0.tgz`; `scripts/smoke-init.mjs` succeeds.

### Compatibility

- Three slash commands (`/cc`, `/cc-cancel`, `/cc-idea`) keep the same surface.
- Schema 3 stays. The new `runMode` field is optional and defaults to `step` — 8.2 state files do not need to be rewritten.
- Strict mode stays byte-for-byte identical to 8.2 (and therefore 8.1) when the user picks `step` (the default).
- Interactive harness picker (8.1.1) and symlink-aware entry point (8.1.2) unchanged.

## 8.2.0 — Triage gate, sub-agent dispatch, graduated AC

### Why

Three problems with 8.1:

1. The orchestrator did not classify the task — it assumed every flow needed a full `plan → build → review → ship` ceremony with hard-gated Acceptance Criteria. Trivial edits paid the same overhead as risky migrations.
2. The user did not get a say in the path. There was no recommendation, no confirmation, no override.
3. The orchestrator wrote the plan, ran the build, and reviewed itself — all in the same context window. Specialists existed but they were not actually isolated; the orchestrator carried their reasoning back into its own thread, which leaked context and made resumes brittle.

8.2 fixes all three without adding new commands. The CLI surface stays at three slash commands: `/cc`, `/cc-cancel`, `/cc-idea`. Everything new happens inside `/cc`.

### What changed

**Triage gate (Hop 2 inside `/cc`).** A new always-on skill, `triage-gate.md`, runs at the start of every fresh flow. It scores the task on six heuristics — file count, surface (config / production / migration / security), reversibility, test coverage, ambiguity, presence of risk signals — and emits a structured block:

```
## Triage
- Complexity: small-medium
- Recommended path: plan → build → review → ship
- AC mode: soft
- Rationale: 2 source files, fully reversible, existing tests cover the surface.
```

The user replies with `accept`, `override <class>`, or `inline`. The decision is persisted into `flow-state.json` under `triage` and never re-asked for the same flow.

**Graduated AC modes.** Acceptance Criteria are no longer one-size-fits-all.

| Class           | `acMode`  | Plan body                         | Commit path                                              | TDD granularity                  |
| --------------- | --------- | --------------------------------- | -------------------------------------------------------- | -------------------------------- |
| `trivial`       | `inline`  | none                              | plain `git commit`                                       | optional                         |
| `small-medium`  | `soft`    | `plan-soft.md` — bullet list of testable conditions, no AC IDs | `git commit` (commit-helper acts as advisory passthrough) | one RED → GREEN → REFACTOR per feature |
| `large-risky`   | `strict`  | `plan.md` — full Acceptance Criteria table with IDs and topology | `commit-helper.mjs` — mandatory, blocks if AC ID / phase / chain wrong | per-AC RED → GREEN → REFACTOR    |

The strict mode is the same gate that shipped in 8.1. Soft and inline modes are new.

**Sub-agent dispatch (Hop 3 inside `/cc`).** Specialists now run as isolated sub-agent invocations. The orchestrator hands a sub-agent the slug, the stage, the `acMode`, the path to the input artifact, and the path to write the output artifact. The sub-agent writes the artifact to disk and returns a fixed 5-to-7-line *slim summary* (stage, status, artifact path, key counts, blockers). The orchestrator never sees the specialist's reasoning trace — it only sees the summary and the artifact on disk.

This means:

- The orchestrator context stays small no matter how deep the plan or how long the build log.
- Resume across sessions works by reading `flow-state.json + flows/<slug>/*.md`. No in-memory state is required.
- Parallel-build (max 5 worktrees) is still available, but only when `acMode == strict` and the planner explicitly declared `parallelSafe: true`.

**Resume (Hop 1 inside `/cc`).** A new always-on skill, `flow-resume.md`, fires when `/cc` is invoked while `flow-state.json` shows an active flow. It prints a 4-line summary (slug, stage, last commit, ACs done/total) and offers `r` resume / `s` show / `c` cancel / `n` start new. The `triage` decision survives across resumes — the user is not re-asked.

**Schema bump: flow-state.json v3.** The new `triage` field is the only addition. Existing v2 files (8.0 / 8.1) are auto-migrated on first read; the inferred `acMode` is `strict` so existing flows keep their old behaviour. Migrations are written back to disk so subsequent reads are fast.

**Specialist prompts.** All six specialists (`planner`, `slice-builder`, `reviewer`, `brainstormer`, `architect`, `security-reviewer`) gained:

- a *Sub-agent context* preamble describing the dispatch envelope they receive;
- an *acMode awareness* table where soft and strict diverge;
- a fixed *Slim summary* output contract;
- an updated *Composition* footer pointing at "cclaw orchestrator Hop 3 — Dispatch" so they know they are not allowed to spawn further specialists themselves.

**Templates.** New `plan-soft.md` and `build-soft.md` templates ship alongside the strict ones. `planTemplateForSlug` keeps returning the strict template when no `acMode` is wired through, so existing callers do not change behaviour.

**`/cc` body rewrite.** The orchestrator command body is now organized as five labelled hops — *Detect → Triage → Dispatch → Pause → Compound/Ship* — instead of an open-ended prose flow. Each hop has an explicit input, output, and stop condition.

### Migration

Automatic. Existing `.cclaw/state/flow-state.json` files written by 8.0 or 8.1 are read, migrated to schemaVersion 3 (with `triage: { acMode: "strict", ... }` synthesised from the existing slug + stage), and rewritten in place. No user action.

`commit-helper.mjs`, `session-start.mjs`, and `stop-handoff.mjs` all handle both schemaVersion 2 and 3 transparently. The migration is idempotent.

### Compatibility

- All three slash commands (`/cc`, `/cc-cancel`, `/cc-idea`) keep the exact same surface.
- `cclaw init` / `sync` / `upgrade` keep the interactive harness picker shipped in 8.1.1 and the symlink-aware entry point shipped in 8.1.2.
- Strict mode behaves byte-for-byte the same as 8.1, including parallel-build, AC traceability gate, and per-AC TDD enforcement.

### Tests

278 unit tests, all passing. New test file `tests/unit/v82-orchestrator-redesign.test.ts` (52 cases) covers triage skill registration, resume skill triggers, the 5-hop body, soft / strict template divergence, sub-agent context preambles in every specialist prompt, slim summary contracts, schema v2 → v3 migration, and `commit-helper.mjs` advisory-vs-strict branching.

## 8.1.2 — Hotfix: CLI never executed when invoked through a symlink (npx, `npm install -g`, macOS /tmp)

**Critical hotfix.** Versions 8.0.0, 8.1.0, and 8.1.1 silently exited 0
without doing anything when invoked through any symlink. That includes
the canonical entry point `npx cclaw-cli init`, because `npx` always
runs the binary through a symlink at
`~/.npm/_npx/<hash>/node_modules/.bin/cclaw-cli`. Users saw `Need to
install the following packages: cclaw-cli@8.1.x  Ok to proceed? (y) y`,
the package downloaded, and then nothing — no error, no picker, no
artifacts, exit 0. The interactive harness picker shipped in 8.1.1 was
never actually reached in real installs.

### Root cause

`src/cli.ts` was using the naive entry-point check
`import.meta.url === \`file://${process.argv[1]}\``. That comparison fails
in three real-world situations:

- **npx**: `argv[1]` keeps the symlink path (`.../.bin/cclaw-cli`),
  but `import.meta.url` resolves through to the real `dist/cli.js`.
- **`npm install -g cclaw-cli`**: same shape — global symlink in the
  bin dir, real file under `lib/node_modules/cclaw-cli/dist/cli.js`.
- **macOS `/tmp`**: `/tmp` is a symlink to `/private/tmp`, so even a
  direct invocation of a binary placed under `/tmp` shows
  `argv[1] = /tmp/...` while `import.meta.url = file:///private/tmp/...`.

When the comparison fails, the `if (isMain) { runCli(...) }` block is
skipped, the module finishes loading, and Node exits 0 because there's
nothing else to do.

### Fix

Restored the v7.x `isDirectExecution()` check that resolves both sides
through `fs.realpathSync` before comparing:

```ts
function isDirectExecution(): boolean {
  if (!process.argv[1]) return false;
  try {
    const entryPath = realpathSync(path.resolve(process.argv[1]));
    const modulePath = realpathSync(fileURLToPath(import.meta.url));
    return entryPath === modulePath;
  } catch {
    return false;
  }
}
```

Same logic the 7.x line shipped with for ten months without report.

### Regression test

New `tests/integration/cli-symlink.test.ts` (3 cases) executes the
**built `dist/cli.js` through a real symlink** under `os.tmpdir()` —
the exact shape `npx` produces — and asserts that:

1. `cclaw-cli version` prints `8.1.2`.
2. `cclaw-cli help` prints the help body with the harness-selection
   section.
3. `cclaw-cli init` actually creates `.cclaw/` and the harness
   commands (i.e. is **not** a silent exit-0 no-op).

Without this test the 8.0.0 / 8.1.0 / 8.1.1 bug is invisible: every
unit test calls `runCli(...)` directly and bypasses the entry-point
check; `scripts/smoke-init.mjs` calls
`execFileSync("node", [<absolute-path-to-cli.js>, "init"])` with no
symlink involved.

### What this does NOT change

- The interactive harness picker (8.1.1) and harness auto-detection
  (8.1.0) are unchanged. They were correct — they just couldn't run.
- All deep content (specialist prompts, skills, runbooks, templates)
  is byte-identical to 8.1.1.

## 8.1.1 — Restore the interactive harness picker

8.1.1 is a UX-only patch on top of 8.1.0. The harness auto-detection
shipped in 8.1.0 was correct in CI / non-TTY paths, but it removed the
interactive checkbox picker that operators rely on when they run
`npx cclaw-cli init` in a fresh project. This release puts that picker
back without giving up the auto-detect behaviour for non-TTY callers.

### Interactive harness picker (TTY)

- **`cclaw init` now opens a checkbox picker in any TTY.** Layout:
  one row per harness (`Claude Code → .claude/`, `Cursor → .cursor/`,
  `OpenCode → .opencode/`, `Codex → .codex/`), with auto-detected
  harnesses pre-selected and tagged `(detected)`. Controls: Up/Down or
  k/j to move, Space to toggle, `a` to select all, `n` to deselect all,
  Enter to confirm, Esc/Ctrl-C to cancel. Implemented in
  `src/harness-prompt.ts` (~190 LOC); the state machine
  (`createPickerState`, `applyKey`, `selectionToList`) is pure and
  unit-tested.
- **Resolution order is now:** (1) `--harness=<id>[,<id>]` flag,
  (2) existing `.cclaw/config.yaml`, (3) **interactive picker if
  stdin/stdout are a TTY** (default for `init`/`sync`/`upgrade` from a
  shell), (4) auto-detect from project markers, (5) hard error if
  nothing found.
- **Non-TTY callers (CI, piped input, `npm exec --yes`, programmatic
  callers) keep the deterministic 8.1.0 behaviour.** `SyncOptions`
  gains `interactive?: boolean` (default `false`); when omitted or
  false, the picker is skipped and resolution falls through to
  auto-detect or the existing `NO_HARNESS_DETECTED_MESSAGE` error.
  Smoke (`scripts/smoke-init.mjs`) and unit tests stay deterministic
  because they never set `interactive: true`.
- **Cancellation.** Pressing Esc/Ctrl-C inside the picker rejects with
  `Harness selection cancelled.` (exit code 1). The terminal is
  restored to its previous raw-mode state on every code path.

### Tests

- New `tests/unit/harness-prompt.test.ts` (16 cases) covering the pure
  state-machine: preselect normalization, cursor wrapping, toggle/all/
  none keys, Enter on empty selection, unknown-key no-op,
  `selectionToList` ordering, `isInteractive` TTY checks.
- `tests/unit/install.test.ts` adds two cases proving that
  programmatic callers (no `interactive` flag) and explicit
  `interactive: true` in non-TTY (Vitest) both fall back to
  auto-detect rather than hanging on stdin.

### What this does NOT change

- 8.1.0 deep content (composition footers, anti-slop, per-slug flow
  layout, harness markers, `.gitignore` management, no `AGENTS.md`
  generation) is untouched.
- Specialist prompts, skills, templates, runbooks are byte-for-byte
  identical to 8.1.0.

## 8.1.0 — Post-8.0 polish: composition discipline, anti-slop, lean cuts, per-slug flow layout

8.1.0 consolidates four post-release polish passes (H4 → H7) on top of
the v8 architectural rewrite shipped in 8.0.0. The runtime API is
unchanged; the changes are concentrated in the deep content layer
(specialist prompts, skills, templates, runbooks) and in the install
behaviour (harness auto-detection, no more `AGENTS.md` injection,
`.gitignore` management, per-slug flow directory). Earlier H1-H3 polish
remains under the 8.0.0 entry below.

### Composition footers, anti-slop, harness auto-detect, no AGENTS.md (seventh pass, H7)

This pass focuses on **specialist scope discipline**, **anti-slop guard
rails**, **honest harness selection**, and **keeping the project root
clean**.

- **Per-specialist Composition footer.** Every specialist prompt
  (`brainstormer`, `architect`, `planner`, `reviewer`, `security-reviewer`,
  `slice-builder`) now ends with a `## Composition` section that locks
  the specialist into its lane: who invokes them, which runbook/skill
  wraps them, what they may NOT spawn, what files they may NOT touch,
  and a hard stop condition. Adopted from addyosmani-skills'
  agent persona pattern. Eliminates the "specialist orchestrates other
  specialists" drift seen in v7 escalation chains. Contract test:
  `tests/unit/specialist-prompts.test.ts`.
- **Anti-slop skill (always-on).** New `lib/skills/anti-slop.md` —
  bans (a) re-running the same build/test/lint twice without a code
  change, and (b) environment-specific shims (`process.env.NODE_ENV`
  branches, `.skip`-ed tests, `@ts-ignore` / `eslint-disable` to
  silence real failures, hardcoded fixture-fallbacks in production
  code). Replaces these with two operating modes: **fix the root
  cause** or **surface as a `block` finding and stop**. Adopted from
  addyosmani-skills (anti-redundant-verification) and oh-my-claudecode
  (`generateSlopWarning` in `pre-tool-enforcer.mjs`). Triggers:
  `always-on, task:build, task:fix-only, task:recovery`.
- **Slice-builder hard rules updated.** Hard rules 10 and 11 now
  explicitly forbid redundant verification and env shims; the prompt
  references `anti-slop.md` from its inputs list.
- **Harness auto-detection on `cclaw init`.** `init` no longer silently
  defaults to `cursor`. Resolution order: (1) `--harness=<id>[,<id>]`
  flag if passed, (2) existing `.cclaw/config.yaml` if present,
  (3) auto-detect from project markers (`.claude/`, `.cursor/`,
  `.opencode/`, `.codex/`, `.agents/skills/`, `CLAUDE.md`,
  `opencode.json`, `opencode.jsonc`), (4) error with an actionable
  message if nothing found. New module: `src/harness-detect.ts` (~40
  LOC). Contract: `tests/unit/install.test.ts` covers each branch.
- **AGENTS.md / CLAUDE.md generation removed.** cclaw v8 no longer
  writes a routing block into `AGENTS.md`. Skills installed under
  `.{harness}/skills/cclaw/` (auto-triggered by `cclaw-meta.md`)
  carry the same routing information without polluting the project
  root. The `agents-block` artifact template, `writeAgentsBlock`,
  `removeAgentsBlock`, and `docs/agents-block.example.md` are removed.
  Pre-existing user-authored `AGENTS.md` is left untouched on init
  and uninstall.
- **`.gitignore` management for transient state.** `init` now
  appends `.cclaw/state/` and `.cclaw/worktrees/` to `.gitignore`
  (with a `# cclaw transient state` header). The artifact tree
  (`.cclaw/flows/`, `.cclaw/lib/`, `.cclaw/config.yaml`,
  `.cclaw/ideas.md`, `.cclaw/knowledge.jsonl`, `.cclaw/hooks/`) is
  intentionally NOT ignored — it must be committed for graphify
  indexing and team review. New module: `src/gitignore.ts`
  (~60 LOC). `uninstall` removes the cclaw lines but preserves
  user-authored gitignore entries; if cclaw was the only content,
  `.gitignore` is removed entirely.
- **CLI help text updated.** `cclaw help` now documents the harness
  resolution order explicitly, plus the marker list, plus the
  no-default behaviour.

### Per-slug flow layout + lib trims (sixth pass, H6)

The active flow tree no longer scatters one slug across six per-stage
directories. All artifacts for one slug live in a single folder:
`flows/<slug>/{plan,build,review,ship,decisions,learnings}.md`. Shipped
and cancelled slugs continue to use `flows/shipped/<slug>/...` and
`flows/cancelled/<slug>/...` (unchanged, that shape was already
per-slug). The library content was also trimmed.

- **`flows/` is per-slug, not per-stage.** `flows/plans/`, `flows/builds/`,
  `flows/reviews/`, `flows/ships/`, `flows/decisions/`, and
  `flows/learnings/` are gone. The active dir for slug `demo` is now
  `flows/demo/` and contains `plan.md`, `build.md`, etc. Existing-plan
  detection globs `flows/*/plan.md` (skipping `shipped/` and `cancelled/`).
  `findMatchingPlans` walks `flows/<dir>/plan.md` instead of one flat
  per-stage directory.
- **`PLAN_DIR` / `BUILD_DIR` / ... constants removed.** A single
  `ARTIFACT_FILE_NAMES` map drives both active and shipped paths.
  `ACTIVE_ARTIFACT_DIRS` and `SHIPPED_ARTIFACT_FILES` collapsed into
  one. `cancel.ts`, `compound.ts`, `install.ts`, `orchestrator-routing.ts`,
  and every content file with a literal path were updated.
- **Decision protocol short-form (B1).** `lib/decision-protocol.md`
  collapsed from 78 lines to ~25 lines covering only the "is this even
  a decision?" question. The full schema (FMT, pre-mortem, refs) is
  now owned by `lib/agents/architect.md`. The three worked decisions
  moved to `lib/examples/decision-permission-cache.md` (which already
  existed under another name).
- **Failure Mode Table conditional (B2).** FMT is now mandatory only
  when the decision touches a user-visible failure path (rendering,
  request/response, persisted data, payment/auth, third-party calls).
  Purely internal decisions write the explicit single line
  `Failure Mode Table: not applicable — no user-visible failure path`
  instead of forcing a table. Pre-mortem stays mandatory for
  product-grade and ideal tiers; minimum-viable may skip.
- **Antipatterns 17 → 12 (B3).** Merged `A-2`/`A-13`/`A-15`/`A-17`
  (TDD-phase failures) into `A-2 — TDD phase integrity broken`. Merged
  `A-3`/`A-16` (silent scope expansion + `git add -A`) into
  `A-3 — Work outside the AC`. Removed the standalone `A-12 — Architect
  with one option` since the new short-form decision-protocol covers it.
- **Examples 13 → 8 (B4).** Removed `plan-refinement`, `decision-record`
  (renamed to `decision-permission-cache`), `knowledge-line`,
  `refinement-detection`, `parallel-build-dispatch`, `review-cap-reached`.
  All were either covered by skill bodies and prompt transcripts or
  too thin to warrant a file.
- **Research playbooks 5 → 3 (B5).** Merged `read-before-write`,
  `reading-tests`, and `reading-dependencies` into a single
  `reading-codebase.md` (covers what to read, how to read tests, and
  how to read integration boundaries). `time-boxing.md` and
  `prior-slugs.md` are unchanged.

192 tests pass (up from 189). `release:check` (build, lint, tests,
smoke-init) is green. The on-disk layout is the visible shape of a
slug now: open `.cclaw/flows/demo/` and you see everything for `demo`.

### Lean cut + parallel-build cap (fifth pass, H5)

The fourth pass (H4) over-corrected by re-importing v7-era ceremony — a
forced Q&A loop with topic tags, an 8-field Problem Decision Record, a
"2-5 minute TDD step" rule, and an Acceptance Mapping table. This pass
deletes that ceremony and adds back the v7 "max 5 parallel slices with
git worktree" rule, which is the part of v7 that was actually load-
bearing.

- **Brainstormer trimmed.** Q&A Ralph loop with four forcing topics
  (`pain` / `direct-path` / `operator` / `no-go`), the 8-field PDR,
  How Might We, Embedded Grill, and Self-Review Notes are gone. The
  brainstormer now writes a `## Frame` paragraph (what is broken /
  who feels it / success looks like / out of scope), an optional
  `## Approaches` table (`baseline` + `challenger`, no Upside column),
  a `## Selected Direction` paragraph, and a `## Not Doing` list. It
  may ask **at most three** clarifying questions and only when the
  prompt has genuine ambiguity that wasn't pre-answered. 248 → 176
  lines.
- **Planner trimmed.** "2-5 minute TDD steps" is gone (caused
  hundred-slice plans). "Feature-atomic" jargon is gone. The
  Acceptance Mapping table, Constraints + Assumptions table, and
  Reproduction contract are gone. The planner now writes Plan +
  Acceptance Criteria (with `parallelSafe` + `touchSurface`) +
  Edge cases (one bullet per AC) + Topology. AC = one observable
  outcome; the TDD cycle lives **inside** the AC, not above it.
- **Plan template trimmed.** Q&A Log, Problem Decision Record, Premise
  check, How Might We, Embedded Grill, Acceptance Mapping, Constraints
  and Assumptions, Reproduction contract, Self-Review Notes are gone.
  The frontmatter loses `discovery_posture`, `frame_type`, and
  `qa_topics_covered`. 192 → 93 lines.
- **Test-file naming rule (was missing).** `slice-builder`,
  `tdd-cycle` skill, build runbook, and `/cc` Step 5 now state
  explicitly: **test files are named after the unit under test
  (`tests/unit/permissions.test.ts`), never after the AC id
  (`AC-1.test.ts`).** AC ids live inside `it('AC-1: …', …)` test names,
  in commit messages, and in the build log — not in the filename.
  This was a real failure mode in the wild.
- **Parallel-build cap restored to 5 slices + git worktree dispatch.**
  The v7 constraint that "all work fits in max 5 parallel sub-agents
  with git worktree" is back. A **slice = 1+ AC sharing a
  touchSurface**. If planner produces more than 5 slices, planner is
  required to merge thinner slices into fatter ones — never generate
  "wave 2", "wave 3". Each parallel slice runs in its own
  `.cclaw/worktrees/<slug>-<slice-id>` worktree on a
  `cclaw/<slug>/<slice-id>` branch when the harness supports
  sub-agent dispatch. Otherwise parallel-build degrades silently to
  inline-sequential. Below 4 AC the orchestrator picks `inline` even
  if AC look "parallelSafe" — dispatch overhead is not worth saving
  1-2 AC of wall-clock.
- **Sub-agent guidance added to `/cc`.** The orchestrator instruction
  now states explicitly when sub-agents help (parallel slice dispatch
  capped at 5; specialist context isolation for `architect`,
  `security-reviewer`, integration `reviewer`) and when they don't
  (trivial / small / medium slugs ≤4 AC; sequential work; routine
  work the orchestrator finishes in 1-2 turns).

The `lib/skills/review-loop.md` (Concern Ledger + convergence
detector), `lib/skills/conversation-language.md` (always-on user-
language policy), `lib/templates/decisions.md` (Architecture tier +
Failure Mode Table + Pre-mortem + Escape Hatch + Blast-radius Diff),
and `lib/templates/ship.md` (Preflight + Rollback triplet +
Finalization mode + Victory Detector) are kept untouched — they are
gated by specialist invocation, not paid on every slug.

### Grouped layout + recovered v7 depth (fourth pass, H4)

The flat `.cclaw/` layout (24 children at the root) is replaced with a
grouped layout. Every active artifact lives under `.cclaw/flows/`,
every reference document lives under `.cclaw/lib/`, and runtime stays
top-level:

```
.cclaw/
├── config.yaml
├── ideas.md
├── knowledge.jsonl       (after first ship)
├── state/                # flow-state.json
├── hooks/                # session-start, stop-handoff, commit-helper
├── flows/
│   ├── plans/<slug>.md
│   ├── builds/<slug>.md
│   ├── reviews/<slug>.md
│   ├── ships/<slug>.md
│   ├── decisions/<slug>.md
│   ├── learnings/<slug>.md
│   ├── shipped/<slug>/   (archived completed runs)
│   └── cancelled/<slug>/
└── lib/
    ├── agents/           # 6 specialist prompts
    ├── skills/           # 12 auto-trigger skills
    ├── templates/        # 10 templates
    ├── runbooks/         # 4 stage runbooks
    ├── patterns/         # 8 reference patterns
    ├── research/         # 5 research playbooks
    ├── recovery/         # 5 recovery playbooks
    ├── examples/         # 13 worked examples
    ├── antipatterns.md
    └── decision-protocol.md
```

This pass also recovers depth from the 7.x `spec`, `plan`, `brainstorm`,
`scope`, `design`, and `ship` stages that earlier v8 passes had skipped:

- **Conversation language policy.** New always-on skill
  `conversation-language.md`. The agent replies in the user's language
  but never translates `AC-N`, `D-N`, slugs, frontmatter keys, hook
  output, or specialist names — those are wire-protocol identifiers.
- **Review concern ledger + convergence detector.** Every
  `flows/reviews/<slug>.md` carries an append-only F-N ledger.
  Iteration N+1 must reread every open row, mark it
  `closed | open | superseded by F-K`, and append new findings as
  F-(max+1). The loop ends when (1) all rows closed, or (2) two
  consecutive iterations record zero new `block` findings AND every
  open row is `warn`, or (3) the 5-iteration hard cap fires with at
  least one open block row. This is the cclaw analogue of the
  Karpathy "Ralph loop" — short cycles, explicit ledger, hard stop.
- **Brainstormer Q&A Ralph loop + PDR + Approaches table.**
  Adaptive elicitation runs FIRST, one question at a time, with rows
  appended to a `Q&A Log` table tagged with
  `[topic:pain]`, `[topic:direct-path]`, `[topic:operator]`,
  `[topic:no-go]`. The artifact now also carries a Problem Decision
  Record, a Premise check, a "How Might We" reframe, an Approaches
  table with stable Role (`baseline | challenger | wild-card`) and
  Upside (`low | modest | high | higher`), a "Not Doing" list,
  optional Embedded Grill in `deep` posture, and Self-Review Notes.
- **Planner Acceptance Mapping + Edge cases per AC + Reproduction
  contract.** Every AC is now mapped: upstream signal (PDR field or
  D-N) → observable evidence → verification method → likely test
  level. Each AC gets at least one boundary AND one error edge case;
  the slice-builder's RED test for that AC must encode at least one.
  Bug-fix slugs add a Reproduction contract (symptom, repro steps,
  expected RED test, tied AC). AC frontmatter gains `parallelSafe`
  and `touchSurface` (path list) so `parallel-build` waves can verify
  disjoint surface before dispatch. Plan template now includes a
  Constraints + Assumptions Before Finalisation block with
  source/confidence/validation/disposition rows.
- **Architect tier + Failure Mode Table + Pre-mortem + Trivial
  Escape Hatch + Blast-radius Diff.** Architect picks one of three
  architecture tiers per slug — `minimum-viable`, `product-grade`
  (default), `ideal` — recorded in the decisions frontmatter. Every
  D-N now carries a Failure Mode Table
  (`Method | Exception | Rescue | UserSees`, with `UserSees`
  mandatory; silent-failure path is itself a row) and a three-bullet
  Pre-mortem. Trivial slugs (≤3 files, no new interfaces, no
  cross-module data flow) fill the Escape Hatch and skip the full
  D-N machinery. Architect diffs only the slug's blast radius
  against the baseline SHA, never re-audits the whole repo.
- **Ship preflight + rollback triplet + finalization enum + Victory
  Detector.** `flows/ships/<slug>.md` now requires fresh preflight
  output (tests / build / lint / typecheck / clean tree) recorded
  in this turn, repo-mode detection (`git` / `no-vcs`), git
  merge-base detection, the AC↔commit map with red/green/refactor
  SHAs from `flow-state.ac[].phases`, a rollback plan triplet
  (trigger / steps / verification — all three or it does not count),
  a monitoring checklist, and exactly one
  `finalization_mode ∈ { FINALIZE_MERGE_LOCAL, FINALIZE_OPEN_PR,
  FINALIZE_KEEP_BRANCH, FINALIZE_DISCARD_BRANCH, FINALIZE_NO_VCS }`.
  The Victory Detector blocks ship until every condition is met —
  including refusing `FINALIZE_MERGE_LOCAL` in a `no-vcs` repo.
- **Tests, smoke, docs.** 9 new tests covering the H4 content depth
  (185 total). `smoke-init.mjs` updated for the grouped layout and
  the new `conversation-language` skill. CHANGELOG and README record
  the migration.

## 8.0.0 — Lightweight harness-first redesign (breaking)

cclaw 8.0 is a complete rewrite. The 7.x stage machine is gone. The new
runtime is a thin harness installer plus generated `/cc` orchestration
with deep, harness-readable content (templates, specialist prompts,
auto-trigger skills, runbooks, reference patterns, research playbooks,
recovery playbooks, examples library, antipatterns, decision protocol).

### Build is the TDD stage (third pass)

Earlier passes renamed `tdd → build` per the locked vision but did not
carry the TDD cycle into the new build runtime. This pass restores it:

- New iron law: **NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST.**
- `commit-helper.mjs` now requires `--phase=red|green|refactor`. Phases
  are gated: GREEN without a prior RED is rejected, REFACTOR without
  RED+GREEN is rejected, RED commits that touch `src/` / `lib/` / `app/`
  are rejected. `--phase=refactor --skipped` is accepted only with an
  explicit `skipped: <reason>` message.
- `flow-state.json` AC entries gain a `phases: { red, green, refactor }`
  map. AC stays `pending` until all three phases are recorded; the
  combined `commit` now points at the GREEN SHA.
- `BUILD_TEMPLATE` now carries a six-column TDD log
  (Discovery / RED proof / GREEN evidence / REFACTOR notes / commits)
  plus dedicated Watched-RED proofs and Suite-evidence sections.
- Build runbook (`.cclaw/runbooks/build.md`) rewritten as a TDD
  playbook with the full cycle, mandatory gates, and fix-only flow.
- New auto-trigger skill `tdd-cycle.md` (always-on while stage=build,
  also triggered by specialist=slice-builder).
- `slice-builder` prompt rewritten end-to-end as TDD-aware:
  discovery → RED → GREEN → REFACTOR per AC, with watched-RED proof
  and full-suite GREEN evidence.
- `/cc` Step 5 expanded with a full TDD walk-through and three example
  commit-helper invocations.
- Antipatterns added: A-13 (skipping RED), A-14 (single-test green),
  A-15 (REFACTOR silently skipped), A-16 (`git add -A`),
  A-17 (production code in RED commit).
- New iron-law id `red-before-green` plus 9 new tests
  (`tests/unit/tdd-cycle.test.ts` and the updated `iron-laws` test).

Numbers: 167 → 176 tests; npm pack 98.8 KB → 109.3 KB; the runtime
core stays under 6 KLOC.

### Deep content layer (second pass)

### Deep content layer (second pass)

The second pass expanded the harness-facing content to match the depth
users had in 7.x while keeping the lightweight runtime:

- 6 specialist prompts: 70-130 lines → 150-280 lines each, with worked
  examples, edge cases, common pitfalls, strict output schema.
- 10 auto-trigger skills (was 6): added commit-message-quality,
  ac-quality, refactor-safety, breaking-changes, plus a `cclaw-meta`
  always-on skill that ties subsystems together.
- 4 stage runbooks under `.cclaw/runbooks/{plan,build,review,ship}.md`.
- 8 reference patterns under `.cclaw/patterns/`.
- 5 research playbooks under `.cclaw/research/`.
- 5 recovery playbooks under `.cclaw/recovery/`.
- 13 worked examples under `.cclaw/examples/`.
- antipatterns under `.cclaw/antipatterns.md` (12 named entries).
- decision protocol under `.cclaw/decisions/decision-protocol.md`.

Numbers (Cursor install):

- src/ LOC: 3,187 → 5,393 (+69%)
- content/ LOC: 1,714 → 3,841 (+124%)
- installed files: ~37 → 97
- installed bytes: ~58 KB → ~206 KB
- npm pack: 54.7 KB → 98.8 KB
- tests: 129 → 167

### Deep content layer (initial)

- **Frontmatter parser** — `src/artifact-frontmatter.ts` parses the YAML
  frontmatter on every artifact (`slug`, `stage`, `status`, `ac[]`,
  `last_specialist`, `refines`, `shipped_at`, `ship_commit`,
  `review_iterations`, `security_flag`) so the orchestrator can resume
  refinements from active or shipped plans. Includes AC body extraction
  and merge with frontmatter for re-sync.
- **knowledge.jsonl typed appender** — `src/knowledge-store.ts` validates
  every entry on read and exposes `findRefiningChain` so the orchestrator
  can show the full slug lineage for a refinement.
- **Cancel runtime** — `src/cancel.ts` moves active artifacts to
  `.cclaw/cancelled/<slug>/` with a manifest, resets `flow-state.json`,
  and supports resume-from-cancelled inside `/cc`.
- **Ten artifact templates** — `plan`, `build`, `review`, `ship`,
  `decisions`, `learnings`, `manifest`, `ideas`, `agents-block`,
  `iron-laws` shipped to `.cclaw/templates/` and used by the orchestrator
  to seed each artifact instead of placeholder paragraphs.
- **Six deep specialist prompts** — `brainstormer`, `architect`,
  `planner`, `reviewer`, `security-reviewer`, `slice-builder` rewritten
  as 70-130 line prompts with explicit output schemas, edge cases, and
  hard rules.
- **Six auto-trigger skills** — `plan-authoring`, `ac-traceability`,
  `refinement`, `parallel-build`, `security-review`, `review-loop`
  shipped to `.cclaw/skills/` and mirrored to the harness skills folder.
  Each skill is ≤2 KB and focuses on a single activity.
- **AGENTS.md routing block** — `cclaw init` injects (or updates) a
  cclaw-routing block in `AGENTS.md`; `cclaw uninstall` removes it
  cleanly without touching surrounding content.
- **Existing-plan detection now reads frontmatter** — surfaces
  `last_specialist`, AC progress (committed/pending/total), `refines`,
  and `security_flag` for every active / shipped / cancelled match.

### Highlights

- **Four stages** — `plan`, `build`, `review`, `ship`. The old
  `brainstorm`, `scope`, `design`, `spec`, `tdd` stage gates are removed.
- **Three slash commands** — `/cc <task>`, `/cc-cancel`, `/cc-idea`.
  `/cc-amend` and `/cc-compound` are deleted; refinement and learning
  capture happen automatically inside `/cc`.
- **Six on-demand specialists** — `brainstormer`, `architect`, `planner`,
  `reviewer` (multi-mode), `security-reviewer`, `slice-builder`. The
  remaining 12 roles from 7.x collapse into these. `doc-updater` is no
  longer a specialist; the orchestrator handles docs inline.
- **Mandatory AC traceability** — the only mandatory hook is
  `commit-helper.mjs`, which validates AC ids and updates flow-state
  with the produced commit SHA.
- **Karpathy iron laws** — Think Before Coding / Simplicity First /
  Surgical Changes / Goal-Driven Execution are baked into
  `src/content/iron-laws.ts` and surfaced in every `/cc` invocation.
- **Five Failure Modes** — DAPLab review checklist baked into
  `src/content/review-loop.ts`; hard cap at 5 review iterations.
- **Automatic compound** — after ship, the orchestrator captures
  `learnings/<slug>.md` only when the quality gate passes
  (architect/planner decision, ≥3 review iterations, security flag, or
  explicit user request). Active artifacts then move to
  `.cclaw/shipped/<slug>/` with a short `manifest.md`.

### Removed

- `src/run-archive.ts`, `src/managed-resources.ts`,
  `src/internal/compound-readiness.ts`,
  `src/internal/flow-state-repair.ts`,
  `src/internal/early-loop-status.ts`, `src/track-heuristics.ts`,
  `src/early-loop.ts`, `src/internal/waiver-grant.ts`,
  `src/tdd-cycle.ts`, all of `src/internal/advance-stage/`,
  `src/artifact-linter/` and most of `src/content/`.
- `state/delegation-events.jsonl`, `state/delegation-log.json`,
  `state/managed-resources.json`, `state/early-loop.json`,
  `state/early-loop-log.jsonl`, `state/subagents.json`,
  `state/compound-readiness.json`, `state/tdd-cycle-log.jsonl`,
  `state/iron-laws.json`, `.linter-findings.json`,
  `.flow-state.guard.json`, `.waivers.json`.
- The `archive/<date>-<slug>` directory layout (replaced by
  `shipped/<slug>/` without state snapshots).
- 14 of 18 specialists, ~700 of 1247 tests, ~83 KLOC of source.

### Schema changes

- `flow-state.json` `schemaVersion` is now `2`. The shape is:

  ```ts
  interface FlowStateV8 {
    schemaVersion: 2;
    currentSlug: string | null;
    currentStage: "plan" | "build" | "review" | "ship" | null;
    ac: Array<{ id: string; text: string; commit?: string;
                status: "pending" | "committed" }>;
    lastSpecialist: "brainstormer" | "architect" | "planner" | null;
    startedAt: string;
    reviewIterations: number;
    securityFlag: boolean;
  }
  ```

- `/cc` refuses to resume a `schemaVersion: 1` flow-state. See
  `docs/migration-v7-to-v8.md` for the recommended manual path.

### CLI

- `cclaw init`, `cclaw sync`, `cclaw upgrade`, `cclaw uninstall`,
  `cclaw version`, `cclaw help`. `cclaw plan / status / ship / migrate`
  are explicitly rejected with exit code `2`.

### Sizing target met

| Metric | 7.7.1 | 8.0.0 |
| --- | --- | --- |
| LOC `src/` | ~46 583 | ~1 800 |
| State files | 9 | 1 |
| State size on disk | ~150 KB | ~500 B |
| Specialists | 18 | 6 |
| Slash commands | 4 (planned) | 3 |
| Mandatory hooks | 5 | 1 |
| Default hook profile | `standard` | `minimal` |
| Stage gates | ~30 | 3 (AC traceability) |

### Migration

- No automatic migration from 7.x.
- Maintainers must run `npm publish` and
  `npm deprecate cclaw-cli@"<8.0.0" "8.0 is a breaking redesign. See
  docs/migration-v7-to-v8.md."` after release.
- See `docs/migration-v7-to-v8.md` for project-side steps.

## 7.7.1 — Inline-default for discovery-only waves

7.7.1 calibrates the 7.7.0 Execution Topology Router so trivial markdown /
docs / scaffold work no longer fans out into one slice-builder agent per
file. The pain that triggered this patch came from a real ebg-figma run:
W-01 had 3 markdown-only discovery spikes with `lane: scaffold`, the auto
router saw 3 independent units and chose `parallel-builders`, and the
controller dispatched 3 separate slice-builder agents to write 3 trivial
markdown files. The original plan explicitly says: do NOT launch subagents
for trivial units. 7.7.1 makes the router honor that.

- **Lane-aware router (`src/execution-topology.ts`).**
  Extended `ExecutionTopologyShape` with `discoveryOnlyUnits`. When
  `configuredTopology === "auto"`, strictness is not strict, the wave is
  not high-risk, has no path conflicts, and `discoveryOnlyUnits ===
  unitCount` with `unitCount >= 1`, the router now collapses the wave:
  `unitCount <= 3` → `topology: "inline"` (controller fulfils inline);
  `unitCount > 3` → `topology: "single-builder"` (one builder owns the
  whole wave). High-risk and explicit strict-micro/strict paths still
  bypass this branch; inline + high-risk remains unreachable.

- **Controller-inline mode in `wave-status`
  (`src/internal/wave-status.ts`).**
  `parseManagedWaveSliceMeta` now captures `lane` and `riskTier` per
  slice from the managed Parallel Execution Plan table and feeds
  `discoveryOnlyUnits` into `routeExecutionTopology`. When the router
  picks `inline`, `nextDispatch.mode` becomes the new value
  `controller-inline` and `nextDispatch.controllerHint` describes what
  the controller must do this turn ("Fulfill ready slices in this turn
  without dispatching slice-builder. Record delegation rows with
  role=controller (scheduled→completed) per slice."). The remaining
  `mode` values (`single-slice`, `wave-fanout`, `blocked`, `none`) keep
  their pre-7.7.1 contract.

- **Controller dispatch protocol updates.**
  `src/content/stages/tdd.ts`, `src/content/meta-skill.ts`, and
  `src/content/core-agents.ts` (slice-builder template) now make the
  three live cases explicit:
  - `topology=inline`: do NOT use `Task`; record lifecycle rows with
    `--dispatch-surface=role-switch
    --agent-definition-path=.cclaw/skills/tdd/SKILL.md`.
  - `topology=single-builder` with multiple ready slices: issue exactly
    ONE `Task` dispatch and let the single span own multi-slice TDD,
    emitting per-slice phase rows with the same `spanId`/`dispatchId`.
  - `topology=parallel-builders`: keep current fanout discipline, but
    only when at least one ready unit is non-discovery (otherwise the
    router collapses to inline/single-builder).
  Removed obsolete prose ("Routing AskQuestion: launch wave or single
  builder?") that wrapped routing in user-confirmation ceremony — the
  router decides, the controller acts.

- **Tests.**
  Added five new cases to `tests/unit/execution-topology.test.ts`
  (3-unit discovery → inline; 5-unit discovery → single-builder; mixed
  lanes keep parallel-builders; high-risk discovery never inlines under
  balanced; high-risk + strict goes strict-micro). Added
  `tests/unit/wave-status-discovery-only.test.ts` covering the
  end-to-end JSON envelope: 3-member scaffold lane → `topology: inline`
  + `mode: controller-inline` + populated `controllerHint`; 5-member
  docs lane → `topology: single-builder`; mixed lane → keeps
  `parallel-builders`; high-risk discovery → not inline. Existing
  `tests/unit/parallel-scheduler.test.ts` invariants
  (`validateFileOverlap`, `validateFanOutCap`, `MAX_PARALLEL_SLICE_BUILDERS`,
  `execution.maxBuilders` config-cap path) are unchanged.

- **No spec/safety regressions.** Preserved invariants: protected-path /
  orphan-changes / lockfile-twin / wave path-disjoint / phase-status
  validation; AC traceability; RED-before-GREEN; managed-per-slice commit
  shape; worker self-record contract (`acknowledged` + `completed` with
  GREEN evidence freshness); fan-out cap (`MAX_PARALLEL_SLICE_BUILDERS` +
  `execution.maxBuilders` override); strict-micro routing for
  `requiresStrictMicro` or `strictness === "strict"` configurations.

## 7.7.0 — Adaptive Execution Topology + TDD Calibration

7.7.0 changes the default TDD planning posture from "every 2-5 minute task is
its own schedulable agent" to feature-atomic implementation units with internal
2-5 minute RED/GREEN/REFACTOR steps. Strict micro-slice execution remains
available for high-risk work.

- **Execution Topology Router.**
  Added `src/execution-topology.ts` and new top-level config fields:
  `execution.topology`
  (`auto|inline|single-builder|parallel-builders|strict-micro`),
  `execution.strictness` (`fast|balanced|strict`), and
  `execution.maxBuilders`. Defaults are `auto`, `balanced`, and `5`.
  `auto` chooses the cheapest safe topology: inline only for low-risk
  inline-safe work, single-builder for one feature-atomic unit or conflicts,
  parallel-builders only for genuinely independent substantial units, and
  strict-micro for strict/high-risk posture.

- **Plan granularity policy.**
  Added top-level `plan.sliceGranularity` (`feature-atomic|strict-micro`) and
  `plan.microTaskPolicy` (`advisory|strict`) defaults. These keep planning
  policy out of the TDD commit/isolation/lockfile safety block while letting
  strict plans intentionally preserve one-tiny-task-per-slice execution.

- **Unit-level wave coverage.**
  Plan linting and wave parsing now accept `U-*` implementation units/slices as
  the schedulable Parallel Execution Plan surface. Legacy strict-micro plans can
  still cover every non-deferred `T-NNN` row. Same-wave path conflicts, invalid
  lanes, AC mapping, WAIT_FOR_CONFIRM, and stack-aware wiring aggregator gates
  remain hard safety checks.

- **Controller and worker guidance recalibrated.**
  Planning, TDD, meta-skill, generated subagent guidance, slice-builder agent
  text, templates, README, and config docs now describe feature-atomic units,
  inline/single-builder execution, controlled parallel builders, and strict
  micro-slice fallback while preserving RED-before-GREEN, AC traceability,
  path containment, lockfile twin, managed commit/worktree, and orphan-change
  invariants.

- **Tests.**
  Added focused coverage for topology routing, config parsing/defaults,
  unit-level wave parsing/status, feature-atomic plan acceptance, balanced-mode
  microtask-only advisories, strict-mode microtask allowance, and config-driven
  `maxBuilders`.

## 7.6.0 — Universal Plan-Stage Hardening + Lockfile/Wiring Awareness

7.6.0 is the universalisation pass that follows the 7.0.6 → 7.5.0 atomicity stack.
Every fix is stack-agnostic at the surface and routes stack-specific behavior
through the existing stack-adapter layer. The harness now works cleanly on Rust,
Node-TS, Python, Go, Java, Ruby, PHP, Swift, .NET, and Elixir projects and
degrades gracefully (no-op) when a stack is unknown. All five defects surfaced
in the real `hox` run (`run-moo5mbun-qne7vm` W-08).

- **Slice-id parser is no longer numeric-only.**
  Plan amendments needed to insert lettered sub-slices (`S-36a`, `S-36b`)
  between numeric ones, but the strict `/^S-\d+$/` parser silently dropped
  them from wave membership and forced renumbering. Added
  `src/util/slice-id.ts` with `parseSliceId`, `isSliceId`, `compareSliceIds`,
  and `sortSliceIds`. The new shape is `S-<integer>(<lowercase letter+>)?`,
  sorted numeric-first then lexical suffix
  (`S-1 < S-2 < S-10 < S-36 < S-36a < S-36b < S-37`). Audited and routed
  every slice-id consumer (`src/internal/wave-status.ts`,
  `src/internal/plan-split-waves.ts`, `src/artifact-linter/plan.ts`,
  `src/artifact-linter/tdd.ts`, `src/internal/cohesion-contract-stub.ts`,
  `src/tdd-cycle.ts`, `src/delegation.ts`) through the shared helper. Added
  `tests/unit/slice-id-parser.test.ts` and
  `tests/unit/wave-status-lettered-slice-ids.test.ts`.

- **Phase-event status validation enforced at the canonical writer + hook.**
  `delegation-record` previously accepted `--phase=red|green|refactor|doc
  --status=acknowledged` silently, leaving `slice-commit.mjs` waiting for a
  doc/completed event that never came (the hox S-41 phantom-open bug).
  `src/delegation.ts` now exports `validatePhaseEventStatus` and
  `PhaseEventRequiresTerminalStatusError`; `appendDelegation` rejects any
  row with `phase != null && status !== completed && status !== failed`,
  exits 2, and emits a corrected command hint. The same validation is
  inlined into the rendered `delegation-record.mjs` script
  (`src/content/hooks.ts`). The `slice-builder` agent template
  (`src/content/core-agents.ts`) now carries an unambiguous
  `(event → required --status flag)` table so workers cannot record
  phase-level acks. Added
  `tests/unit/delegation-phase-event-status.test.ts` and
  `tests/unit/delegation-record-phase-event-status.test.ts`.

- **Lockfile-twin auto-claim via stack-adapter (`lockfileTwinPolicy`).**
  When a slice modifies a manifest (Cargo.toml, package.json, pyproject.toml,
  …), `cargo build` / `npm install` / `poetry install` regenerates the
  lockfile and `slice-commit.mjs` previously rejected the drift as
  `slice_commit_path_drift`. Extended `src/stack-detection.ts` with a
  universal `StackAdapter` contract exposing `lockfileTwins` for rust, node
  (auto-detects npm/yarn/pnpm), python (auto-detects poetry/uv/pdm/Pipfile),
  go, ruby, php, swift, dotnet, and elixir. Java has no canonical lockfile
  and ships an empty list (no-op). New `tdd.lockfileTwinPolicy` config
  (`auto-include` default, `auto-revert`, `strict-fence`) controls behavior;
  `init`/`sync` writes the default into `.cclaw/config.yaml`. Slice-commit
  (`src/internal/slice-commit.ts`) now folds drifted twins into the managed
  commit (auto-include), restores them via `git restore` (auto-revert), or
  rejects them (strict-fence) with a `lockfileTwinPolicy` field on the error
  payload. Added `tests/unit/stack-adapter-lockfile-twins.test.ts` and
  `tests/integration/slice-commit-lockfile-twin.test.ts`.

- **New required plan gate: `plan_module_introducing_slice_wires_root`.**
  `plan_wave_paths_disjoint` passed for waves whose slices each claimed a
  single new module file but never the corresponding `lib.rs` /
  `__init__.py` / `index.ts` aggregator, leaving RED structurally
  unexpressible (the hox W-08 S-39/40/41 bug). Stack-adapter now exposes
  `wiringAggregator?: { aggregatorPattern; resolveAggregatorFor(filePath,
  repoState?) }` for Rust (`lib.rs`/`main.rs`/`mod.rs`), Node-TS
  (`index.{ts,tsx,js,jsx}` only when one already exists in the parent
  dir — barrel projects opt in), and Python (`__init__.py`, with PEP 420
  namespace-package layouts auto-skipped). The new linter
  (`src/artifact-linter/plan.ts`) checks every NEW path in each wave row
  against its required aggregator, walks the `dependsOn` graph for
  predecessor coverage, and emits actionable issues. Plan gate budget bumped
  from 7 → 8 (`tests/unit/gate-density.test.ts`); the gate is `required`
  for stacks with a wiring contract and advisory for stacks without.
  Added `tests/unit/plan-module-introducing-slice-wires-root.test.ts`
  covering rust, node-ts barrel/no-barrel, python `__init__.py`/PEP 420,
  and Go (no-op).

- **Bias audit — `start-flow` and gate-evidence stop hardcoding stacks.**
  Swept `src/` for hardcoded Rust-only / Node-only assumptions:
  `src/internal/advance-stage/start-flow.ts` no longer probes the literal
  trio `["package.json", "pyproject.toml", "Cargo.toml"]`; it now walks
  `stackAdapter.manifestGlobs`. `src/gate-evidence.ts` no longer hardcodes
  `pyproject.toml` / `go.mod` / `Cargo.toml` / `pom.xml` / `build.gradle`
  test-command discovery; it pulls from `stackAdapter.testCommandHints`
  (still keeping `pytest.ini` as an explicit fallback). Stage skill prose
  and runner comments that already carried parallel multi-stack examples
  were left intact.

- **Cross-slice coherence (uninhabited-stub liability tracking) deferred to
  7.7.0.** The `match e {}` / `unimplemented!()` /
  `throw new Error('TODO')` / `raise NotImplementedError` / `pass`-only
  AST-light analysis at phase=green is a separate architectural piece and
  was intentionally not included in 7.6.0.



7.5.0 closes the AC traceability loop across spec -> plan -> tdd -> ship so
every shipped acceptance criterion can be traced to a slice card and managed
commit evidence.

- **Spec gate: stable AC ids required.**
  Added `spec_ac_ids_present` in `src/artifact-linter/spec.ts` plus shared AC-id
  extraction helpers. The gate requires `AC-N` identifiers on every populated
  acceptance-criteria row.
- **Plan gate: bidirectional AC mapping enforced.**
  Added `plan_acceptance_mapped` in `src/artifact-linter/plan.ts` to require:
  every authored `T-NNN` task maps to at least one `AC-N`, and every spec AC id
  is covered by at least one plan task.
- **TDD gates: closes links + orphan-path guard.**
  Added `tdd_slice_closes_ac` and `slice_no_orphan_changes` in
  `src/artifact-linter/tdd.ts`. Slice cards now validate `Closes: AC-N` links
  against spec AC ids, and doc-phase closure checks enforce no staged/unstaged
  drift outside claimed paths.
- **Ship gate: AC-to-commit coverage.**
  Added `ship_all_acceptance_criteria_have_commits` and per-AC uncovered
  findings in `src/artifact-linter/ship.ts`. Ship now verifies each spec AC is
  mapped from `tdd-slices/S-*.md` and backed by at least one managed slice
  commit since run start.
- **Stage contracts + templates updated.**
  Stage schema and stage definitions now include new spec/tdd/ship gates. Ship
  artifacts now require a `Traceability Matrix` section in both stage metadata
  and canonical template output.
- **Tests.**
  Added:
  `tests/integration/ac-traceability-end-to-end.test.ts`,
  `tests/unit/ship-all-ac-have-commits.test.ts`,
  `tests/unit/slice-no-orphan-changes.test.ts`,
  plus updated regression fixtures in artifact/tdd e2e suites and gate-density
  budgets for the new required-gate counts.

## 7.4.0 — Live wave-status streaming with fallback

7.4.0 adds a live event-stream ingestion path for TDD wave orchestration while
keeping deterministic fallback to file-based delegation events when streams are
missing or stale.

- **New streaming parser module.**
  Added `src/streaming/event-stream.ts` with bounded JSONL buffering,
  `phase-completed` event validation, and file readers for stream-backed
  controller workflows.
- **`wave-status` live mode support.**
  `src/internal/wave-status.ts` now accepts stream modes (`auto|live|file`),
  prefers `.cclaw/state/slice-builder-stream.jsonl` in live/auto mode, and
  auto-falls back to `delegation-events.jsonl` when no parseable stream events
  are present.
- **Controller visibility warnings.**
  Wave reports now include explicit warnings for dropped stream lines and
  live-to-file fallback so operators can spot stream drift without silent
  behavior changes.
- **Slice-builder protocol updates.**
  `sliceBuilderProtocol()` now documents the JSON-line streaming contract for
  per-phase stdout events and the required fallback behavior when streaming is
  unavailable.
- **Tests.**
  Added:
  `tests/unit/event-stream-parser.test.ts`,
  `tests/integration/slice-builder-stream.test.ts`,
  and regression coverage to ensure legacy wave-status path-conflict behavior
  remains stable.

## 7.3.0 — Worktree isolation for slice commits

7.3.0 restores per-slice git worktree isolation so managed TDD commits no
longer rely on one shared working tree during parallel slice execution.

- **New worktree manager control plane.**
  Added `src/worktree-manager.ts` with explicit APIs:
  `createSliceWorktree(sliceId, baseRef, claimedPaths)`,
  `commitAndMergeBack(worktreePath, message)`, and
  `cleanupWorktree(worktreePath)`.
- **TDD config defaults now isolate by worktree.**
  Extended `tdd` config with:
  `isolationMode: worktree|in-place|auto` (default `worktree`) and
  `worktreeRoot` (default `.cclaw/worktrees`).
- **Managed slice commits now support worktree flow.**
  `internal slice-commit` adds `--prepare-worktree` and `--worktree-path` so
  DOC closure can commit inside a slice worktree, rebase onto current main
  head, fast-forward merge back, and clean up the worktree on success.
- **Graceful degradation + conflict signaling.**
  Missing/broken worktree support downgrades to an explicit
  `worktree-unavailable` skip payload (agent-required fallback signal), while
  merge-back conflicts now surface as `worktree_merge_conflict` and preserve the
  failing worktree for diagnostics.
- **Tests.**
  Added:
  `tests/unit/worktree-manager.test.ts`,
  `tests/integration/worktree-parallel-slice.test.ts`,
  `tests/integration/worktree-merge-conflict.test.ts`,
  plus config schema coverage for new TDD isolation keys.

## 7.2.0 — Generic stack discovery + hook drift checks

7.2.0 removes remaining hardcoded stack heuristics and tightens runtime
integrity around managed hook scripts so `sync` can verify drift without
mutating workspace state.

- **Shared stack-detection profiles.**
  Added `src/stack-detection.ts` as a single source of truth for stack review
  routing and discovery markers. `start-flow`, verify-time context discovery,
  and stage schema review routing now reuse the same profile data instead of
  duplicating hardcoded marker lists.
- **Generic GREEN evidence hints.**
  Updated `src/content/hooks.ts` runner guidance to be language-agnostic, with
  canonical pass-line examples for Node/TS, Python, Go, Rust, and Java/JVM.
  The validator now also accepts Maven/Surefire-style passing output.
- **Escape-flag cleanup completion.**
  Delegation hook UX now enforces `--override-cap` with `--reason`, removes the
  deprecated `--allow-fast-green` path in favor of
  `--green-mode=observational`, hardens deferred-refactor rationale quality, and
  emits `cclaw_allow_parallel_auto_flip` audit events when disjoint claimed
  paths auto-enable parallel fan-out.
- **`sync --check` hook drift detector.**
  Added byte-level canonical hook comparison to `sync`:
  `npx cclaw-cli sync --check` now validates generated managed hooks (including
  `delegation-record.mjs` and `slice-commit.mjs`) against their render sources
  and fails fast with actionable drift output.
- **Tests.**
  Added parser coverage for `sync --check` and sync drift coverage in
  `tests/unit/install-disabled-harness-cleanup.test.ts`.

## 7.1.1 — Plan Atomicity (wave disjointness + path-conflict surfacing)

7.1.1 hardens the planning contract so parallel waves are explicitly safe to
fan out, and makes `wave-status` report concrete overlap blockers instead of
always returning empty path conflicts.

- **New required plan gate: `plan_wave_paths_disjoint`.**
  The plan linter now parses same-wave rows inside
  `<!-- parallel-exec-managed-start -->` and fails when two slices in one wave
  overlap on `claimedPaths`.
- **`wave-status` conflict detection fixed.**
  `src/internal/wave-status.ts` now parses claimed paths from the managed
  parallel-exec table, computes same-wave overlaps for ready members, and
  returns:
  - `nextDispatch.mode: "blocked"` when overlap exists
  - `nextDispatch.pathConflicts: ["S-<n>:<path>", ...]` with concrete slices.
- **Lane and serial-consistency lint checks.**
  Added advisory checks in plan lint:
  - `plan_lane_meaningful`: lane values should be one of
    `production|test|docs|infra|scaffold|migration`.
  - `plan_parallelizable_consistency`: waves containing
    `parallelizable: false` slices should carry explicit sequential/serial mode
    hints in wave notes.
- **Parallel-exec mermaid advisory.**
  Added `plan_parallel_exec_mermaid_present` (advisory): encourages including a
  Mermaid `flowchart`/`gantt` with `W-*` and `S-*` nodes for visual validation.
- **Plan stage contract updated.**
  Plan stage checklist/gates now include same-wave path disjointness as a
  required gate, plus an explicit step to render parallel-exec Mermaid
  visualization during authoring.
- **Tests.**
  Added:
  `tests/unit/plan-wave-paths-disjoint.test.ts`,
  `tests/unit/wave-status-path-conflicts.test.ts`,
  `tests/unit/plan-lane-whitelist.test.ts`,
  and updated gate budget in `tests/unit/gate-density.test.ts`.

## 7.1.0 — Commit Atomicity (managed per-slice commits + git-log verification)

7.1.0 introduces explicit commit-ownership modes for TDD and wires a managed
per-slice commit path into the runtime so closed slices can be validated
against real git history instead of free-form SHA strings.

- **New hook: `.cclaw/hooks/slice-commit.mjs`.**
  Generated from `src/content/hooks.ts`, installed/synced alongside
  `delegation-record.mjs`, and routed to the new internal command
  `cclaw internal slice-commit`. It creates one commit for a slice span in
  `tdd.commitMode=managed-per-slice`, stages only claimed paths, and blocks
  path drift with `slice_commit_path_drift`.
- **Auto-call from `delegation-record` at DOC closure.**
  When `slice-builder` records `status=completed phase=doc`, the helper now
  invokes `slice-commit` before persisting the terminal row, so commit
  enforcement remains atomic with slice closure.
- **Config schema extension (`.cclaw/config.yaml`).**
  Added `tdd.commitMode` with modes:
  `managed-per-slice | agent-required | checkpoint-only | off`
  (default: `managed-per-slice`). `readConfig` validates this enum and
  `writeConfig` persists it.
- **Verification gate switched to real git checks in managed mode.**
  `tdd_verified_before_complete` now verifies, per closed slice in the active
  run, that git history contains a matching managed commit (slice-prefixed
  subject) when `.git` exists and commit mode is managed. Non-managed modes
  keep prior evidence semantics; `off` disables commit-reference enforcement.
- **Worker protocol update.**
  `sliceBuilderProtocol()` now states that workers must not hand-edit git for
  slice paths when `tdd.commitMode=managed-per-slice`; managed hook flow owns
  those commits.
- **Tests.**
  Added:
  `tests/integration/slice-commit-managed.test.ts` and
  `tests/unit/slice-commit-path-drift.test.ts`,
  plus managed-commit gate coverage in `tests/unit/gate-evidence.test.ts` and
  config schema coverage in `tests/unit/config.test.ts`.

## 7.0.6 — Containment

Closes three containment gaps surfaced by the hox W-07 / S-36 session under
7.0.5: a slice-builder hand-edited managed runtime files under `.cclaw/hooks/`,
the controller scheduled a second span on an already-closed slice, and the
TDD linter mis-flagged `tdd_slice_red_completed_before_green` because it
compared red/green timestamps across the slice's two spans instead of within
each span.

- **Managed runtime claimed-path protection at dispatch-time** (managed-path
  drift on S-36). `src/delegation.ts` now exposes `isManagedRuntimePath(path)`
  and rejects `status=scheduled` rows whose `claimedPaths` include protected
  runtime paths:
  `.cclaw/{hooks,agents,skills,commands,templates,seeds,rules,state}/`,
  `.cclaw/config.yaml`, `.cclaw/managed-resources.json`,
  `.cclaw/.flow-state.guard.json`. `.cclaw/artifacts/**` remains allowed
  (slice-builders legitimately write slice cards there). The new
  `DispatchClaimedPathProtectedError` + `validateClaimedPathsNotProtected`
  fire before overlap/cap checks in `appendDelegation`;
  `src/internal/advance-stage.ts` maps the error to
  `error: dispatch_claimed_path_protected — …` with exit code `2`.
- **Closed-slice re-dispatch prevention** (double span on S-36).
  `appendDelegation` now rejects a new `scheduled` span carrying `sliceId`
  with no `phase` when another span in the same run already completed
  RED+GREEN+REFACTOR+DOC for that slice. Surfaces as
  `SliceAlreadyClosedError` →
  `error: slice_already_closed — slice <id> already has a closed span (<spanId>); refusing to schedule new span <newSpanId> in run <runId>`,
  exit code `2`. REFACTOR coverage accepts both explicit refactor phases and
  `phase=green` with `refactorOutcome`. Replaying phase rows under the
  already-closed span is still a no-op (existing dedup absorbs them).
- **Multi-span RED/GREEN linter fix** (S-36 false
  `tdd_slice_red_completed_before_green`).
  `src/artifact-linter/tdd.ts::evaluateEventsSliceCycle` groups slice rows by
  `spanId` and validates the RED→GREEN→evidence→ordering→REFACTOR chain per
  span. A slice passes when at least one span has a complete clean cycle;
  when none pass, the most recent failing span's violation is surfaced.
  Legacy ledgers that scatter a single cycle across distinct phase-only
  spanIds keep working via a global aggregate fallback.
- **Tests.** Added
  `tests/unit/delegation-claimed-path-protection.test.ts`,
  `tests/unit/delegation-slice-redispatch-block.test.ts`, and extended
  `tests/unit/tdd-events-derive.test.ts` with multi-span cycle coverage
  (one-span-clean-passes, no-span-clean-fails-with-newest-violation).

## 7.0.5 — Ledger dedup must include `phase` (slice-builder GREEN/REFACTOR/DOC fix)

7.0.2 mandated that a single TDD slice-builder span reuse the same `spanId`
across the entire RED → GREEN → REFACTOR → DOC lifecycle. That mandate is
correct, but it interacted badly with a long-standing dedup bug in
`delegation-record`: the rendered hook (`src/content/hooks.ts > persistEntry`)
and the runtime helper (`src/delegation.ts > appendDelegation`) both keyed
ledger dedup on the pair `(spanId, status)` only.

A slice-builder lifecycle legitimately emits **four** rows with
`status=completed` — one each for `phase=red|green|refactor|doc`. Pre-7.0.5
the dedup treated the second through fourth `(spanId, "completed")` rows as
duplicates and silently dropped them from `delegation-log.json`, even though
they were appended to the audit stream `delegation-events.jsonl`. The
artifact linter for TDD reads only the ledger, so it reported
`tdd_slice_green_missing` (and `tdd_slice_builder_missing`) for slices
whose work had actually landed.

7.0.5 fixes the dedup key in both places to be the triple
`(spanId, status, phase ?? null)`. Same-`(spanId, status)` rows with
different phases now coexist in the ledger; an exact replay of the same
phase row remains idempotent (existing retried-hook semantics preserved).

- **`src/content/hooks.ts > persistEntry`** — append-path dedup updated to
  `entry.spanId === clean.spanId && entry.status === clean.status &&
  (entry.phase ?? null) === (clean.phase ?? null)`. The `replaceBySpanId`
  rerecord path is unchanged.
- **`src/delegation.ts > appendDelegation`** — same triple dedup applied
  to the runtime API used by tests and internal commands.
- **Regression test.** `tests/unit/delegation.test.ts` now covers a single
  slice-builder span emitting RED, GREEN, REFACTOR, DOC and asserts all
  four phase rows persist; an exact `(spanId, status, phase)` replay is
  still deduplicated.

No agent definitions, stage skills, or gates change in 7.0.5; this is a
runtime-only ledger-shape correctness release.

## 7.0.4 — Plan must author the FULL Parallel Execution Plan before TDD

In 7.0.3 the controller-dispatch mandate kept TDD honest about parallel
slice-builder fan-out, but the plan stage was still allowed to ship a
Parallel Execution Plan covering only a subset of the authored tasks. The
classic failure mode: 178 tasks in `## Task List`, only ~14 of them assigned
to slices in `<!-- parallel-exec-managed-start -->`, the first batch of
waves runs to completion, `stage-complete tdd` succeeds because there are
no open waves left, and the flow advances to review with ~150 tasks never
even dispatched.

7.0.4 closes that hole at the plan stage so TDD becomes a pure consumer
of waves the plan already authored.

- **New required gate `plan_parallel_exec_full_coverage`.** Every T-NNN
  task listed in `## Task List` must appear at least once inside the
  `<!-- parallel-exec-managed-start -->` block (typically as the
  `taskId` column of a slice row). Tasks may be excluded only by moving
  them under an explicit `## Deferred Tasks` or `## Backlog` section
  with a reason. Spike rows (`S-N`) are out of scope by design.
- **Plan checklist mandate.** The plan stage skill now instructs the
  planner to enumerate the full set of waves W-02..W-N up front — no
  `we'll author waves later`, `next batch only`, or open-ended Backlog
  handwave is acceptable before WAIT_FOR_CONFIRM.
- **Linter coverage.** `src/artifact-linter/plan.ts` parses the Task List
  body, parses the parallel-exec managed block, and reports any uncovered
  T-NNN ids as a required finding (`plan_parallel_exec_full_coverage`),
  matching the new required gate.
- **Gate density budget bumped.** Plan budget moves from 5 to 6 required
  gates to account for the new full-coverage gate.

## 7.0.3 — Controller dispatch discipline lifted to meta-skill; review army mandates

7.0.2 made TDD waves hard-mandate parallel `slice-builder` dispatch and
auto-advance, but the same failure modes were still possible at every other
stage (notably review): the controller would write findings into `07-review.md`
inline instead of delegating, and the `using-cclaw` meta-skill explicitly told
it NOT to auto-advance. 7.0.3 hoists the discipline to the meta-skill and
extends the mandate to review.

- **Meta-skill `Controller dispatch discipline` block.** `using-cclaw` now
  carries a top-level rule that applies to every stage with mandatory
  delegations: dispatch via the harness Task tool, fan-out parallel lenses in
  one controller message, record `scheduled`/`launched`/`acknowledged`/
  `completed` on the same span, and auto-advance after `stage-complete`.
- **Failure-guardrail flip.** The contradictory "Do not auto-advance after
  stage completion unless user asks" line is replaced with "DO auto-advance
  after `stage-complete` returns ok". The user no longer needs to retype `/cc`
  between stages.
- **New red flag.** "I'll just do the worker's job inline so we move faster"
  is now an explicit red flag in the routing brain.
- **Review orchestration primer.** The review skill now opens with the same
  shape as the TDD primer: controller never authors `## Layer 1 Findings`,
  `## Layer 2 Findings`, `## Lens Coverage`, or `## Final Verdict` content
  inline; `reviewer` and `security-reviewer` are dispatched in parallel as
  Task subagents in a single controller message; the controller only writes
  the reconciled multi-specialist verdict block after all lens spans return.

## 7.0.2 — Mandatory parallel slice-builder dispatch in TDD waves

The 7.0.0 wave-fanout model was described as a soft preference; in practice
the controller often did slice work inline in the chat instead of dispatching
parallel `slice-builder` Task calls, then stopped after each chunk waiting
for direction. 7.0.2 turns the protocol into hard mandates.

- **Controller-never-implements rule for TDD.** The TDD skill now opens with
  an explicit ban: the controller plans, dispatches, and reconciles —
  it never edits production code, tests, or runs language tooling itself.
  Every slice's RED → GREEN → REFACTOR → DOC cycle MUST happen inside an
  isolated `slice-builder` span dispatched via the harness Task tool.
- **Auto fan-out when paths disjoint.** When `wave-status --json` reports
  `mode: wave-fanout` and `pathConflicts: []`, the controller fans out the
  whole wave in a single tool batch — one `Task(subagent_type=…,
  description="slice-builder S-<id>")` per ready slice, side by side. No
  user confirmation question. AskQuestion only fires when paths overlap.
- **Auto-advance after stage-complete.** When `stage-complete` returns
  `ok` with a new `currentStage`, the controller immediately loads the
  next stage skill and continues — no waiting for the user to retype `/cc`.
- **Parallel-dispatch HARD-GATE relaxed for wave-fanout.** The blanket ban
  on parallel implementation now carves out the supported TDD wave-fanout
  path. Cohesion contracts are required only when fan-out touches shared
  interfaces or types — disjoint `claimedPaths` plus the
  `integration-overseer` post-fan-in audit cover the integration risk.

## 7.0.1 — Prune retired TDD agent files on sync

- `cclaw sync` and `upgrade` now delete `agents/test-author.md`,
  `agents/slice-implementer.md`, and `agents/slice-documenter.md` left over
  from earlier installs. The runtime materializes only `slice-builder` for
  TDD; this turns sync into a one-shot cleanup for projects upgrading from
  6.x.

## 7.0.0 — Clean slice-builder runtime

This release is a forward-looking clean cut of the toolkit. Every TDD-flow knob
that referred to a previous data-plane shape has been removed; the runtime is
a single coherent design built around parallel waves of `slice-builder` spans.

**Breaking (major):**

- **`slice-builder` is the only TDD worker.** `test-author`, `slice-implementer`,
  and `slice-documenter` agent files, skills, and audit rules are gone. Each
  parallel slice in a wave runs `slice-builder` end-to-end through
  RED → GREEN → REFACTOR → DOC inside one delegated span.
- **Parallel slice waves are the canonical TDD shape.** The controller dispatches
  the entire wave concurrently. A fan-out cap (default 5, override via
  `CCLAW_MAX_PARALLEL_SLICE_BUILDERS`) and `claimedPaths` overlap detection are
  enforced inline — overlapping spans are blocked with `DispatchOverlapError`
  instead of being serialized.
- **Removed migration / cutover surfaces.** `cclaw internal migrate-from-v6`,
  `tddCheckpointMode`, `tddCutoverSliceId`, `worktreeExecutionMode`,
  `legacyContinuation`, the integration-overseer/checkpoint setters, and the
  `v7-upgrade-guard` are gone. `flow-state.json` no longer carries those keys
  and `sync`/`upgrade` no longer rewrite older data-plane shapes — fresh
  installs are the supported entry point.
- **Linters and skills unified.** TDD linter findings reference `slice-builder`
  only (`tdd_slice_builder_missing`, `tdd_slice_doc_missing`). The TDD skill,
  start-command contract, and subagent guidance describe the
  `slice-builder` end-to-end cycle without optional appendices.

## 6.14.4 — Table-format wave parser + stream-mode lease closure

This is a SURGICAL hot-patch on top of v6.14.3 that fixes two production bugs surfaced by the live `npx cclaw-cli@6.14.3 upgrade && sync` migration on the hox project. Both are tightly scoped: no new helpers, no new flags, no skill-text changes (the v6.14.2 wording is correct — the parser plumbing underneath was the actual blocker).

### Bug 1 — `parseParallelExecutionPlanWaves` now accepts the markdown-table wave shape

The v6.14.2 wave-status helper (`cclaw-cli internal wave-status --json`) and four other call sites (`delegation.ts`, `artifact-linter/tdd.ts`, `install.ts`, `wave-status.ts`) all pass the managed `<!-- parallel-exec-managed-start -->` block through `src/internal/plan-split-waves.ts::parseParallelExecutionPlanWaves`. Up to v6.14.3 that parser only recognized two patterns:

1. `### Wave 04` headings (no trailing text, no `W-` prefix).
2. `**Members:** S-1, S-2, …` (or plain `Members: S-1, S-2`) bullet lines.

Hox-shape `05-plan.md` (and any plan written by `cclaw-cli sync` for projects with table-style waves) uses neither: the heading is `### Wave W-04 — после успешного fan-in W-03 (5 lanes, все disjoint)` and members are declared inside a 7-column markdown table:

```
| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-18 | T-010 | [] | .gitignore | true | low | gitignore |
| S-19 | T-011 | [] | rustfmt.toml, .cargo/config.toml | true | low | rustfmt |
…
```

Result: `wave-status --json` against hox returned `waves: []` and the `wave_plan_managed_block_missing` warning, even though the block contained 4 fully-populated waves (W-02..W-05). This made the v6.14.2 Fix 1 helper non-functional in production. Because the same parser is used to derive lane metadata in `delegation.ts`, the `tdd_slice_lane_metadata_missing` linter and the `applyV6142WorktreeCutoverIfNeeded` migration also went silently noisy on table-format projects.

v6.14.4 extends the parser:

- **Heading regex relaxed** — accepts `### Wave 04`, `### Wave W-04`, and `### Wave W-04 — trailing text` (case-insensitive). The `(?:W-)?(\d+)` group strips an optional `W-` prefix; the trailing-text region uses a word-boundary anchor instead of end-of-line.
- **`parseTableRowMember` (new helper)** — exported for testing. Takes a trimmed markdown-table row, returns `{ sliceId, unitId } | null`. Header rows (`| sliceId |`), separator rows (`|---|`), and rows whose first column is not `S-NN` are skipped silently. Column 2 (when present and non-empty) becomes the `unitId` verbatim, preserving hox's convention of recording task ids (`T-010`, `T-008a`, …) in the unit column. When column 2 is absent or empty, the legacy `S-NN → U-NN` derivation is used so non-table plans are bit-identical to v6.14.3.
- **Mixed format dedup** — when both `**Members:**` and a table reference the same slice in the same wave, the `**Members:**` declaration wins (line-order). Cross-wave duplicates still throw `WavePlanDuplicateSliceError`.
- **Empty waves preserved** — a heading-only wave (or a table with header rows but no `| S-NN |` data rows) is now returned with `members: []` instead of being silently dropped, so callers can surface the boundary explicitly.

The fix flows through to all five call sites without any change to their API.

### Bug 2 — `computeClosedBeforeLeaseExpiry` now recognizes stream-mode (per-slice) closure

Under `tddCheckpointMode: "per-slice"` (the default for fresh and upgraded `legacyContinuation: true` projects since v6.14.2), GREEN-only closure with `refactorOutcome` folded inline IS the slice's terminal row — no separate `phase=refactor` / `phase=refactor-deferred` / `phase=resolve-conflict` row is emitted. The wave-status helper already understood this (see `src/internal/wave-status.ts` lines ~200, ~220), but the lease-closure-detection helper used by the `tdd_lease_expired_unreclaimed` advisory in `src/artifact-linter/tdd.ts::computeClosedBeforeLeaseExpiry` did not.

Symptom: hox's S-17 has a `phase=green status=completed` event with `refactorOutcome: { mode: "deferred", rationale: "…" }` (visible in `.cclaw/state/delegation-events.jsonl`). S-17 is post-cutover (above `tddWorktreeCutoverSliceId: "S-16"`) so the legacy amnesty correctly does NOT apply. After the lease expired (1 hour after `completedTs`), `verify-current-state` started flagging `tdd_lease_expired_unreclaimed: S-17` as a required finding even though the slice was already closed by the green+refactorOutcome row.

v6.14.4 mirrors the same predicate already used in `wave-status.ts`:

- A `phase=green status=completed` event with `refactorOutcome.mode === "inline"` OR `"deferred"` is now treated as a terminal closure for the slice, with `completedTs` as the closure timestamp. If the closure timestamp precedes the latest `leasedUntil` for that slice, the slice goes into the `closedBeforeLeaseExpiry` set and the lease-expiry-unreclaimed advisory is exempted (it emits the `_legacy_exempt` advisory instead).
- All previously-recognized terminal phases (`refactor`, `refactor-deferred`, `resolve-conflict`) keep their current behavior — this is purely additive.

This is a closure-detection extension, NOT a new audit kind. No flag, no skill text change.

### Tests added

- **`tests/unit/parallel-exec-plan-parser.test.ts`** — eight new cases under `parseTableRowMember (v6.14.4)` and `parseParallelExecutionPlanWaves — markdown-table format (v6.14.4)`. The W-02..W-05 fixture is a literal copy of hox `.cclaw/artifacts/05-plan.md` lines 1363-1423 (not a synthesized abbreviation), specifically because v6.14.2 / v6.14.3 shipped the parser bug despite passing unit tests on hand-written `**Members:**` fixtures. Mixed-format / dedup / cross-wave-duplicate / empty-table / `dependsOn:[S-21]` brackets / `### Wave W-04 — trailing text` cases all use real-shape inputs.
- **`tests/e2e/wave-status-hox-shape.test.ts`** (new) — drives `runWaveStatus` end-to-end against the literal hox managed block. Asserts (a) `report.waves.length === 4`, (b) `W-04.members === ["S-18","S-19","S-20","S-21","S-22"]`, (c) `report.warnings` does NOT contain `wave_plan_managed_block_missing`, (d) `nextDispatch.waveId === "W-02"` initially, (e) advances to `W-04` once W-02/W-03 are closed via stream-mode (green+refactorOutcome) events. This is the regression test the v6.14.2 release should have shipped with — the operator-side GO/NO-GO check is now part of the CI suite.
- **`tests/unit/v6-14-4-stream-mode-lease-closure.test.ts`** (new) — four cases covering Bug 2: (1) `phase=green refactorOutcome.mode=inline` → no `tdd_lease_expired_unreclaimed`. (2) `phase=green refactorOutcome.mode=deferred` (literal hox S-17 shape) → no finding. (3) `phase=green` without `refactorOutcome` → still flagged (genuinely-stuck slice). (4) Legacy v6.13 separate `phase=refactor-deferred` row → still recognized (regression).

### Migration impact

None. Projects already on v6.14.3 should run:

```bash
npx cclaw-cli@6.14.4 upgrade
npx cclaw-cli sync
```

There are no new flow-state fields, no sidecar resets, and no skill-text rewrites. After upgrade, `cclaw-cli internal wave-status --json` will return the correct wave list for table-format plans (was previously returning `waves: []`), and `verify-current-state` will stop flagging `tdd_lease_expired_unreclaimed` for slices closed via stream-mode green+refactorOutcome rows.

## 6.14.3 — Legacy amnesty hardening + sidecar refresh on sync

This is a hot-patch on top of v6.14.2 that fixes two issues surfaced by the live `npx cclaw-cli@6.14.2 upgrade && sync` migration on the hox project. Both are tightly scoped to the v6.14.2 sync/linter changes; no skill text or hook contract changes.

### Fix A — `applyV614DefaultsIfNeeded` / `applyV6142WorktreeCutoverIfNeeded` / `applyTddCutoverIfNeeded` now refresh the SHA256 sidecar

Under v6.14.2 these three sync-time mutators wrote `flow-state.json` via `writeFileSafe` directly, leaving `.cclaw/.flow-state.guard.json` pointing at the *pre-stamp* digest. The first guarded hook after `sync`/`upgrade` (e.g. `cclaw internal verify-current-state`, `advance-stage`, `start-flow`) then failed with:

```
flow-state guard mismatch: <runId>
expected sha: <pre-stamp>
actual sha:   <post-stamp>
last writer:  flow-state-repair@…
do not edit flow-state.json by hand. To recover, run:
  cclaw-cli internal flow-state-repair --reason "manual_edit_recovery"
```

even though the operator never edited the file. v6.14.3 routes all three writers through `writeFlowState({ allowReset: true, writerSubsystem: ... })` so the sidecar is recomputed in the same locked operation. The `writerSubsystem` audit values are `sync-v6.12-tdd-cutover-stamp`, `sync-v6.14.2-stream-defaults`, and `sync-v6.14.2-worktree-cutover-stamp` so the repair-log audit trail names which sync step touched the file.

### Fix B — Legacy worktree exemption no longer requires *zero* metadata across all rows

v6.14.2 enforced an "all-or-nothing" rule in `src/artifact-linter/tdd.ts::isExemptLegacySlice`: a slice ≤ `tddWorktreeCutoverSliceId` qualified for amnesty *only* if every `slice-implementer` row for that slice recorded **zero** worktree-first metadata (no claim token, no lane id, no lease). The realistic hox-shape pattern carries the metadata on the GREEN row (added on the v6.14.x worktree-first flip) but lacks it on the later `refactor-deferred` terminal row — partial metadata, so the slice stayed flagged under three required findings (`tdd_slice_lane_metadata_missing`, `tdd_slice_claim_token_missing`, `tdd_lease_expired_unreclaimed`) even after `cclaw-cli sync` stamped the cutover boundary.

v6.14.3 drops the partial-metadata qualifier entirely. The rule is now: *if `legacyContinuation: true` AND the slice number is ≤ `tddWorktreeCutoverSliceId` (or `tddCutoverSliceId` fallback), the slice is exempt — period.* Slices ABOVE the boundary continue to enforce all three required findings, so post-cutover bugs are still caught. The dead `computeSliceWorktreeMetaState` helper was removed.

### Tests

`tests/unit/v6-14-2-features.test.ts` gains two new cases under `v6.14.3 Fix 3 follow-up — legacy worktree exemption covers partial-metadata slices`:

- *does NOT flag tdd_slice_claim_token_missing for slices ≤ tddWorktreeCutoverSliceId even when GREEN carried metadata but a later terminal row did not* — exercises the exact hox-shape S-14/S-15/S-16 pattern.
- *still flags slices ABOVE tddWorktreeCutoverSliceId so post-cutover bugs are not hidden* — confirms S-17 keeps emitting `tdd_slice_claim_token_missing` (required: true) when its terminal row lacks a claim token.

The `tdd-slice-lane-metadata-linter.test.ts` strict-enforcement tests (no `legacyContinuation`) still pass unchanged.

### Migration impact for hox-shape projects already on v6.14.2

Projects that have already run `npx cclaw-cli@6.14.2 upgrade && sync` and now see the guard-mismatch error need a one-time manual repair before proceeding:

```bash
npx cclaw-cli@6.14.3 upgrade
npx cclaw-cli@6.14.3 sync
# If the guard sidecar is still out of date from the v6.14.2 sync run:
npx cclaw-cli@6.14.3 internal flow-state-repair --reason="v6142_upgrade_post_stamp"
```

Fresh installs and projects upgrading directly from ≤v6.14.1 to v6.14.3 do not need the repair step — sync/upgrade keep the sidecar in lockstep on first write.

## 6.14.2 — Controller discipline (wave-status discovery, cutover semantics, legacy amnesty, GREEN evidence freshness, mode-field writers)

Real-world hox `/cc` runs on top of v6.14.1 surfaced four concrete failure modes that the v6.14.0/v6.14.1 stream-mode runtime + skill text could not catch on their own:

1. **Wave-plan blindness** — the controller correctly detected stream mode but had no deterministic primitive to find the next ready wave; it would page through 1400-line `05-plan.md` artifacts and stall when the managed `<!-- parallel-exec-managed-start -->` block scrolled off-context.
2. **`tddCutoverSliceId` misread** — the controller treated `flow-state.json::tddCutoverSliceId` as a pointer to the active slice and re-dispatched RED/GREEN/DOC for a slice that closed under v6.12 markdown.
3. **Worktree-first lane-metadata noise** — legacy hox-shape projects under `legacyContinuation: true` carry pre-worktree slice closures that fail `tdd_slice_lane_metadata_missing`, `tdd_slice_claim_token_missing`, and `tdd_lease_expired_unreclaimed` indefinitely; the v6.13 cutover was per-slice numeric and did not cleanly bound legacy-shape closures from new work. `tdd.cohesion_contract_missing` likewise blocked legacy hox-shape projects with no real cross-slice cohesion contract authored.
4. **GREEN evidence "fast-greens"** — the runtime accepted any string in `evidenceRefs[0]` on `slice-implementer --phase green --status=completed`, so workers could close a slice with stale evidence (or a one-line claim) without the test re-running between `acknowledged` and `completed`.

v6.14.2 closes all four with runtime + skill text + linter changes, plus three bonus mode-field writers so legacy-continuation projects can opt in/out of stream-mode defaults without hand-editing `flow-state.json` (which now hard-blocks via the SHA256 sidecar).

### Fix 1 — Wave-plan discovery primitive

- **`src/internal/wave-status.ts` (new)** + **`runWaveStatusCommand`** — `cclaw-cli internal wave-status [--json|--human]` reads the managed `<!-- parallel-exec-managed-start -->` block plus `wave-plans/wave-NN.md`, projects the active run's terminal slice closures (`refactor`, `refactor-deferred`, `resolve-conflict`, GREEN with `refactorOutcome` fold-inline), and returns a deterministic `{ activeRunId, currentStage, tddCutoverSliceId, tddWorktreeCutoverSliceId, legacyContinuation, waves[], nextDispatch, warnings[] }` report. `nextDispatch.mode` is `wave-fanout` (≥ 2 ready members), `single-slice` (1 ready), or `none`. Surfaces `wave_plan_managed_block_missing` / `wave_plan_parse_error` / `wave_plan_merge_conflict` warnings instead of silently returning empty.
- **TDD skill text** (`src/content/stages/tdd.ts`) — adds row 1 of the checklist: **"Wave dispatch — discovery hardened (v6.14.2): your FIRST tool call after entering TDD MUST be `cclaw-cli internal wave-status --json`"** with the explicit instruction that `05-plan.md` is opened *only* after `wave-status` names a slice that needs context. Existing v6.14.0 stream-style + v6.14.1 controller-discipline rows are preserved verbatim.
- **`src/internal/advance-stage.ts`** — registers `wave-status` (and the four other new subcommands) as known dispatch targets and surfaces them in the usage block.

### Fix 2 — `tddCutoverSliceId` semantics + advisory linter

- **TDD skill text** (`src/content/stages/tdd.ts`) — `requiredEvidence[5]` rewritten so `flow-state.json::tddCutoverSliceId` is named explicitly as a *historical boundary* set by `cclaw-cli sync`, NOT a pointer to the active slice. Includes the imperative "to find the active slice, run `cclaw-cli internal wave-status --json` (Fix 1, v6.14.2) — never derive it from `tddCutoverSliceId`."
- **`tdd_cutover_misread_warning` advisory** in `src/artifact-linter/tdd.ts::evaluateCutoverMisread` — fires when (a) the active run scheduled new RED/GREEN/DOC work for the slice id stored in `tddCutoverSliceId`, AND (b) that slice has already closed (terminal `refactor`/`refactor-deferred`/`resolve-conflict` row recorded for the same id, possibly under a prior run). `required: false` — never blocks `stage-complete`; clears the moment the controller pivots away.

### Fix 3 — Legacy worktree exemption + soft cohesion-contract + stub writer

- **`flow-state.json::tddWorktreeCutoverSliceId`** — new optional field defining the legacy-worktree-first amnesty boundary. Auto-stamped on `cclaw-cli sync` for `legacyContinuation: true` projects already in `worktree-first` mode but missing the boundary: scans the active-run delegation ledger for the highest slice id that *never* recorded worktree-first metadata (claim token / lane id / lease) on any of its phase rows; falls back to `tddCutoverSliceId` when no such slice is found. New `applyV6142WorktreeCutoverIfNeeded` in `src/install.ts`.
- **Softened legacy gates** in `src/artifact-linter/tdd.ts` — `tdd_slice_lane_metadata_missing`, `tdd_slice_claim_token_missing`, and `tdd_lease_expired_unreclaimed` are now exempted (and emit `_legacy_exempt` advisories instead) for slices that (1) sit at or below the `tddWorktreeCutoverSliceId` (or `tddCutoverSliceId` fallback) AND (2) never recorded any worktree-first metadata, OR for `tdd_lease_expired_unreclaimed` specifically: the slice closed before the lease expired. Fresh worktree-first projects (no `legacyContinuation`) continue to enforce all three rules globally.
- **`tdd.cohesion_contract_missing`** — softened to `required: false` under `legacyContinuation: true`; the rule remains mandatory for fresh projects. Suggestion text now points at the new stub writer.
- **`cclaw-cli internal cohesion-contract --stub [--force] [--reason="<short>"]`** — new writer at `src/internal/cohesion-contract-stub.ts`. Generates minimal `cohesion-contract.md` + `cohesion-contract.json` with `status.verdict: "advisory_legacy"` and the active-run slice ids prefilled, so legacy projects can clear the advisory without hand-authoring the document. Refuses to overwrite existing files unless `--force` is passed.

### Fix 4 — GREEN evidence freshness contract

- **Hook validation in `delegationRecordScript()`** (`src/content/hooks.ts`) — for `slice-implementer --phase=green --status=completed` events with a matching `phase=red` row in the active run, the hook enforces three new contracts on `evidenceRefs[0]`:
    1. **`green_evidence_red_test_mismatch`** — the value must contain the basename/stem of the RED span's first evidenceRef (substring, case-insensitive).
    2. **`green_evidence_passing_assertion_missing`** — the value must contain a recognized passing-runner line: `=> N passed; 0 failed`, `N passed; 0 failed`, `test result: ok` (cargo), `N passed in 0.42s` (pytest), or `ok pkg 0.12s` (go test).
    3. **`green_evidence_too_fresh`** — `completedTs - ackTs` must be ≥ `flow-state.json::tddGreenMinElapsedMs` (default 4000 ms; configurable via the new field).
- **Escape clause** — pass BOTH `--allow-fast-green --green-mode=observational` to skip all three checks for legitimate observational GREEN spans (cross-slice handoff, no-op verification). Both flags required; either alone is rejected by structural validation.
- **`flow-state.ts`** — adds `tddGreenMinElapsedMs?: number` and `DEFAULT_TDD_GREEN_MIN_ELAPSED_MS = 4000`; `effectiveTddGreenMinElapsedMs` reader handles invalid inputs.
- **TDD worker self-record contract** in `src/content/core-agents.ts` — `tddWorkerSelfRecordContract(...)` bumped from `(v6.14.1)` to `(v6.14.2)` with the freshness contract spelled out inline; the rendered agent markdown for `test-author`, `slice-implementer`, `slice-documenter`, and `integration-overseer` now names every reject code and the `--allow-fast-green --green-mode=observational` escape.
- **`src/content/hooks.ts` usage banner** — documents `--allow-fast-green` and `--green-mode=observational` so `--help` users see the contract.

### Bonus — Mode-field writer commands

Three new internal subcommands so legacy-continuation projects can opt out of stream-mode defaults without hand-editing `flow-state.json` (the SHA256 sidecar enforcement introduced in v6.14.0 makes manual edits a hard failure):

- **`cclaw-cli internal set-checkpoint-mode <per-slice|global-red> [--reason="<short>"]`** (`src/internal/set-checkpoint-mode.ts`) — writes `flow-state.json::tddCheckpointMode` and refreshes the SHA256 sidecar atomically. Reason is slugified into the `writerSubsystem` audit field.
- **`cclaw-cli internal set-integration-overseer-mode <conditional|always> [--reason="<short>"]`** (`src/internal/set-integration-overseer-mode.ts`) — writes `flow-state.json::integrationOverseerMode` and refreshes the sidecar.
- **`sync` auto-stamp migration** (`src/install.ts::applyV614DefaultsIfNeeded`) — projects with `legacyContinuation: true` and missing `tddCheckpointMode` / `integrationOverseerMode` are now stamped to **`per-slice`** / **`conditional`** (the v6.14 stream-mode defaults). v6.14.1 stamped these to `global-red` / `always` to preserve legacy hox behavior; v6.14.2 flips that default because legacy projects upgrading past v6.14.1 are intended to land on stream mode. Use the new writer commands above to opt back into `global-red` / `always` if you specifically need v6.13.x semantics.

### Migration notes for hox-shape projects

Run `npx cclaw-cli@6.14.2 upgrade` then `npx cclaw-cli sync`. After sync, expect the following in `flow-state.json`:

- `packageVersion: "6.14.2"`
- `tddCheckpointMode: "per-slice"` (auto-stamped if previously absent under `legacyContinuation: true`)
- `integrationOverseerMode: "conditional"` (auto-stamped if previously absent)
- `tddWorktreeCutoverSliceId: "<highest pre-worktree slice id>"` (auto-stamped for `worktree-first` legacy projects)
- `legacyContinuation: true` preserved; `worktreeExecutionMode: "worktree-first"` preserved.

`stage-complete tdd --json` will no longer fail with `tdd_slice_lane_metadata_missing` / `tdd_slice_claim_token_missing` / `tdd_lease_expired_unreclaimed` for slices closed before the cutover; remaining gate findings should be limited to the legitimate "TDD not yet complete — pending waves W-NN/W-MM" shape.

To revert to v6.14.1-style mandatory integration-overseer or `global-red` checkpoint:

```bash
npx cclaw-cli internal set-integration-overseer-mode always --reason="prefer mandatory dispatch"
npx cclaw-cli internal set-checkpoint-mode global-red --reason="prefer global RED checkpoint"
```

To clear `tdd.cohesion_contract_missing` advisory without hand-authoring a contract:

```bash
npx cclaw-cli internal cohesion-contract --stub --reason="legacy hox-shape project"
```

### Tests added

- **`tests/unit/v6-14-2-features.test.ts` (21 tests)** — wave-status helper (basic / closed-slice projection / missing managed block / cutover warning), Fix 1 + Fix 2 skill text checks, `tdd_cutover_misread_warning` advisory, both new mode-writer commands (parser + runner + sidecar refresh + internal command surface), `cohesion-contract --stub` (parser + writer + force semantics), GREEN evidence freshness contract (mismatch / missing-runner / too-fresh / observational escape), slice-implementer agent markdown documents the freshness contract.
- **`tests/e2e/tdd-auto-derive.test.ts` + `tests/e2e/slice-documenter-parallel.test.ts`** — updated to set `tddGreenMinElapsedMs: 0` in seeded `flow-state.json` and to provide passing-runner lines in `evidenceRefs[0]` so the freshness contract sees a realistic shape.
- **`tests/unit/tdd-controller-discipline.test.ts`** — version-regex relaxed from `(v6\.14\.1)` to `(v6\.14\.\d+)` so the v6.14.x stream stays green across patch bumps.

## 6.13.1 — Skill-text wave dispatch + mandatory worktree-first GREEN metadata

Follow-up to v6.13.0: real `/cc` runs could stay on the v6.12 single-slice ritual because the controller prioritized routing questions over the managed `## Parallel Execution Plan`, treated lane flags as optional hints, and wave detection only watched `wave-plans/wave-NN.md`. This release unifies wave sources, fixes plan parsing for markdown-bold bullets (`**Members:**`, `**dependsOn:**`, etc.), rewrites TDD/flow-start skill text, adds linters for ignored waves and missing GREEN lane metadata, and surfaces a sync hint when worktree-first mode sees a multi-member parallel plan.

### Phase A — Wave plan source unification

- **`parseParallelExecutionPlanWaves` + `extractMembersListFromLine`** (`src/internal/plan-split-waves.ts`) — Parses the managed Parallel Execution Plan block in `05-plan.md` (between `parallel-exec-managed` markers) with correct `**Members:**` line semantics; **`mergeParallelWaveDefinitions`** keeps Parallel Execution Plan primary and `wave-plans/` secondary with slice-level conflict errors.
- **`loadTddReadySlicePool` / `selectReadySlices`** (`src/delegation.ts`) — Consumes the merged manifest for scheduling-ready slices.

### Phase B — Skill-text rewrite

- **TDD skill** (`src/content/stages/tdd.ts`, `src/content/skills.ts`) — Rule 1: load Parallel Execution Plan + `wave-plans/` before routing; one AskQuestion when wave vs single-slice is a real choice; mandatory `--claim-token` / `--lane-id` / `--lease-until` on GREEN when `worktree-first`; provisional-then-finalize slice-documenter behavior spelled out.
- **`delegation-record` hook** (`src/content/hooks.ts`) — Fast `exit 2` with `dispatch_lane_metadata_missing` when worktree-first GREEN rows omit lane metadata.

### Phase C — Flow-start / `/cc` surface

- **`startCommandContract` / `startCommandSkillMarkdown`** (`src/content/start-command.ts`) — TDD resume path loads the Parallel Execution Plan and `wave-plans/` before slice routing; wave dispatch resume for partially closed waves.

### Phase D — Linter rules

- **`tdd_wave_plan_ignored`** (`src/artifact-linter/tdd.ts`) — Fires when an open wave has 2+ scheduler-ready slices but recent delegation tail shows `slice-implementer` for only one slice; lists missed members.
- **`tdd_slice_lane_metadata_missing`** — Fires under `worktree-first` when completed GREEN lacks `claimToken`, `ownerLaneId`, or `leasedUntil`.

### Phase E — Install / sync

- **`maybeLogParallelWaveDispatchHint`** (`src/install.ts`) — On sync/upgrade, prints a one-line hint when the active flow is `worktree-first` and the merged parallel plan has a multi-member wave. Existing `legacyContinuation` flows are not auto-flipped; operators use `cclaw internal set-worktree-mode` explicitly.

### Phase F — Tests

- **`tests/unit/parallel-exec-plan-parser.test.ts`** — Managed block parsing, duplicates, merge.
- **`tests/unit/tdd-wave-plan-ignored-linter.test.ts`**, **`tests/unit/tdd-slice-lane-metadata-linter.test.ts`** — New rule coverage.
- **`tests/e2e/start-command-wave-detection.test.ts`** — Start contract references wave plan + routing gate.
- **Updates** to `tests/e2e/tdd-wave-checkpoint.test.ts`, `tests/unit/plan-split-waves.test.ts`, and **`parseImplementationUnitParallelFields`** bold-bullet fix so `**dependsOn:**` / `**claimedPaths:**` lines parse like emitted plan templates.

## 6.13.0 — Worktree-First Multi-Slice Parallel TDD

Phases 0–7 ship conflict-aware planning, git-backed worktree lanes with claim/lease metadata, a DAG-ready `selectReadySlices` helper, deterministic `git apply --3way` fan-in at TDD stage-complete (never `-X ours/theirs`), `cclaw_fanin_*` audit rows, hardened TDD linters for worktree-first mode, `cclaw internal set-worktree-mode`, and `sync` migration that sets `legacyContinuation` when `05-plan.md` predates v6.13 parallel bullets. Phase 8 (sunset) is explicitly deferred to v6.14.

### Phase 0 — Spec + plan stage upgrades

- **`04-spec.md` template + `spec` stage** — Acceptance Criteria gain `parallelSafe` and `touchSurface` columns for slice planning. Advisory `spec_acs_not_sliceable` in `src/artifact-linter/spec.ts` when those columns are missing on standard expectations.
- **Plan artifacts** — Implementation units require `id`, `dependsOn`, `claimedPaths`, `parallelizable`, `riskTier`, optional `lane`; `plan-split-waves` builds conflict-aware waves (topo-sort + disjoint `claimedPaths`, default cap 5) and managed `## Parallel Execution Plan` blocks. New plan linter rules: `plan_units_missing_dependsOn`, `plan_units_missing_claimedPaths`, `plan_units_missing_parallel_metadata`, advisory `plan_no_parallel_lanes_detected`, degrading to advisory under `legacyContinuation` for existing units only.

### Phase 1 — Control plane (claims / leases)

- **`DelegationEntry`** extended with `claimToken`, `ownerLaneId`, `leasedUntil`, `leaseState`, `dependsOn`, `integrationState`, `resolve-conflict` phase; `DispatchClaimInvalidError` for mismatched terminal claims; `reclaimExpiredDelegationClaims` writes `cclaw_slice_lease_expired` audits.
- **`flow-state.json`** — optional `worktreeExecutionMode` (`single-tree` | `worktree-first`) and `legacyContinuation`; omitted mode stays `single-tree` via `effectiveWorktreeExecutionMode`; fresh runs from `start-flow` default `worktree-first`.
- **Hooks** — `delegation-record` accepts `--claim-token`, `--lane-id`, `--lease-until`, `--depends-on`, `--integration-state`.

### Phase 2 — Worktree lane manager

- **`src/worktree-types.ts`**, **`src/worktree-manager.ts`** — `createLane`, `verifyLaneClean`, `attachLane` / `detachLane`, `cleanupLane`, `pruneStaleLanes` under `.cclaw/worktrees/` with `cclaw/lane/<sliceId>-*` branches; submodule-safe cleanup; worktrees ignored as managed-generated noise in `managed-resources`.

### Phase 3 — Multi-slice scheduler

- **`selectReadySlices`** in `src/delegation.ts` — pure scheduler over `ReadySliceUnit[]` with legacy `parallelizable` filtering; numeric `U-*` ordering via `compareCanonicalUnitIds`.
- **`parseImplementationUnitParallelFields(..., { legacyParallelDefaultSerial })`** — defaults missing `parallelizable` bullets to `false` under legacy continuation.
- **TDD skill / stage text** — Wave Batch Mode v6.13+ describes RED checkpoint, parallel fan-out, per-lane refactor, deterministic fan-in; slice-documenter may stay provisional until GREEN.

### Phase 4 — Deterministic fan-in + resolver hints

- **`src/integration-fanin.ts`** — `fanInLane` uses merge-base when `baseRef` omitted, restores prior branch on apply failure; `runTddDeterministicFanInBeforeAdvance` merges lanes before leaving TDD; `recordCclawFanInAudit` / `readDelegationEvents().fanInAudits`; `buildResolveConflictDispatchHint`.
- **`advance-stage`** — after validation, before persisting state when leaving TDD, runs fan-in + `verifyTddWorktreeFanInClosure`.
- **`verifyTddWorktreeFanInClosure`** in `src/gate-evidence.ts` — lane-backed closed slices require `cclaw_fanin_applied`.

### Phase 5 — Linter / gates hardening

- **TDD linter** — `tdd_slice_claim_token_missing`, `tdd_slice_worktree_metadata_missing` (worktree-first), `tdd_fanin_conflict_unresolved` (delegation `integrationState` + `cclaw_fanin_conflict` audits), `tdd_lease_expired_unreclaimed`.

### Phase 6 — Rollout

- **`cclaw internal set-worktree-mode --mode=single-tree|worktree-first`** — `src/internal/set-worktree-mode.ts`.
- **Tests** — `select-ready-slices.test.ts`, `plan-v613-metadata.test.ts`, `fanin-audit.test.ts` (fan-in audits + closure).

### Phase 7 — Legacy continuation (hox)

- **`applyPlanLegacyContinuationIfNeeded`** in `src/install.ts` — when `05-plan.md` lacks v6.13 bullets on any unit, inserts legacy banner + empty Parallel Execution Plan stub and sets `flow-state.legacyContinuation` when state exists; plan linter degradation per Phase 0.

### Follow-ups (v6.13.1 candidates)

- Narrow `git clean` / conflict recovery UX if users report partial apply residue beyond `git checkout -- .`.
- E2e exercises that run full `git worktree` fan-in in CI (optional `git` skip patterns).

## 6.12.0 — TDD Velocity Honest (Decouple from discoveryMode + Mandatory Roles + Wave Checkpoint + Auto-cutover)

Follow-up to v6.11.0 that closes the back doors observed on a fresh hox flow run (slice S-11 went GREEN with no `--phase` events, no `slice-implementer` dispatch, no `slice-documenter`, and 12+ hand-edited per-slice sections in `06-tdd.md`). v6.12.0 makes that path impossible by promoting `slice-implementer` and `slice-documenter` to mandatory regardless of `discoveryMode`, adding three new linter rules (`tdd_slice_documenter_missing` decoupled from `deep`, `tdd_slice_implementer_missing`, `tdd_red_checkpoint_violation`) plus an advisory backslide rule (`tdd_legacy_section_writes_after_cutover`), rewriting the TDD skill to teach the per-slice ritual + wave batch mode imperatively, and shipping a one-shot `cclaw-cli sync` auto-cutover that pins legacy projects to a `tddCutoverSliceId` boundary so existing slices keep validating while new ones must use the new protocol.

### Phase R — Decouple slice-documenter from discoveryMode

- **Rule renamed `tdd_slice_documenter_missing_for_deep` → `tdd_slice_documenter_missing`** in `src/artifact-linter/tdd.ts`. The `discoveryMode === "deep"` branch is removed; the rule is now `required: true` on lean / guided / deep alike. `discoveryMode` keeps its meaning as the early-stage shaping knob (brainstorm / scope / design); TDD parallelism is uniform across all modes.
- **`src/content/stages/tdd.ts` Required Evidence** — the conditional bullet (`On discoveryMode=deep: per slice, a phase=doc event ...`) is replaced with a flat bullet that requires the `phase=doc` event regardless of mode. Brainstorm / scope / design skill files are untouched.

### Phase M — Mandatory slice-implementer + slice-documenter

- **`STAGE_AUTO_SUBAGENT_DISPATCH.tdd`** in `src/content/stage-schema.ts` — `slice-implementer` is promoted from `mode: "proactive"` to `mode: "mandatory"` ("Always for GREEN and REFACTOR phases. Controller MUST NOT write production code itself."). A new `slice-documenter` row is added at `mode: "mandatory"` ("Always in PARALLEL with `slice-implementer --phase green` for the same slice."). `defaultReturnSchemaForAgent` and `dispatchClassForRow` learn the new agent so worker payloads validate.
- **`StageSubagentName`** in `src/content/stages/schema-types.ts` gains the `"slice-documenter"` member.
- **New linter rule `tdd_slice_implementer_missing`** (`src/artifact-linter/tdd.ts::evaluateSliceImplementerCoverage`) — for every slice with a `phase=red` event carrying non-empty `evidenceRefs`, a matching `phase=green` event whose `agent === "slice-implementer"` is required. Catches "controller wrote GREEN itself", the most common backslide observed before v6.12.0.

### Phase Ritual — Per-Slice Ritual block + Checklist 14 rewrite

- **New top-of-skill `## Per-Slice Ritual (v6.12.0+)` block** rendered by `tddTopOfSkillBlock` in `src/content/skills.ts`, injected immediately after the `<EXTREMELY-IMPORTANT>` Iron Law and before `## Quick Start`. Imperative voice, literal `Task(...)` commands, explicit FORBIDDEN list (controller writing GREEN, controller writing per-slice prose, hand-editing auto-render blocks). One-line delegation-record signature.
- **Checklist step 14** in `src/content/stages/tdd.ts` is rewritten from "Record evidence — capture test discovery, system-wide impact check, RED failure, GREEN output, REFACTOR notes in the TDD artifact" to "**slice-documenter writes per-slice prose** (test discovery, system-wide impact check, RED/GREEN/REFACTOR notes, acceptance mapping, failure analysis) into `tdd-slices/S-<id>.md`. Controller does NOT touch this content." The DOC parallel-dispatch instruction is updated to mandatory in lockstep.
- **`watchedFailProofBlock`** in `src/content/skills.ts` is rewritten to describe the three-dispatch ritual and reaffirm that `slice-implementer` and `slice-documenter` are mandatory regardless of `discoveryMode`.
- **TDD `BEHAVIOR_ANCHORS` entry** in `src/content/examples.ts` is expanded from a Watched-RED-only example to a full slice cycle Bad/Good with mandatory parallel GREEN+DOC dispatch.

### Phase W — Wave Batch Mode + RED checkpoint

- **New top-of-skill `## Wave Batch Mode (v6.12.0+)` block** in `src/content/skills.ts`. Trigger: any `<artifacts-dir>/wave-plans/wave-NN.md` exists, OR 2+ slices have disjoint `claimedPaths`. Phase A — RED checkpoint (one message, all `test-author --phase red`); Phase B — GREEN+DOC fan-out (one message, paired implementer+documenter Tasks per slice); fan-in via `integration-overseer`. Cap = 5 `slice-implementer` lanes (10 subagents counting paired documenters) per `MAX_PARALLEL_SLICE_IMPLEMENTERS`.
- **New linter rule `tdd_red_checkpoint_violation`** (`src/artifact-linter/tdd.ts::evaluateRedCheckpoint`) — for every wave (explicit `wave-plans/wave-NN.md` manifest if present, otherwise implicit-wave fallback for 2+ contiguous reds), a `phase=green` event with `completedTs` BEFORE the wave's last `phase=red` `completedTs` is a `required: true` blocker. Sequential single-slice runs (red→green→red→green) form size-1 implicit waves and never fire.

### Phase L — Cutover backslide advisory

- **New advisory `tdd_legacy_section_writes_after_cutover`** (`src/artifact-linter/tdd.ts::evaluateLegacySectionBackslide`) — reads `flow-state.json::tddCutoverSliceId` (e.g. `"S-10"`) and surfaces an advisory `required: false` finding when slice ids `> cutover` appear in legacy per-slice sections of `06-tdd.md` (Test Discovery / RED Evidence / GREEN Evidence / Watched-RED Proof / Vertical Slice Cycle / Per-Slice Review / Failure Analysis / Acceptance Mapping). Post-cutover prose belongs in `tdd-slices/S-<id>.md`.

### Phase A — `cclaw-cli sync` auto-cutover for existing TDD flows

- **`FlowState.tddCutoverSliceId?: string`** added to `src/flow-state.ts`. `src/run-persistence.ts::coerceFlowState` rehydrates the field via a new `coerceTddCutoverSliceId` validator (canonical `S-<digits>` shape only).
- **New `applyTddCutoverIfNeeded`** in `src/install.ts` — when `cclaw-cli sync` (or `upgrade`) detects an `06-tdd.md` artifact without auto-render markers but with observable slice activity (`S-N` referenced ≥3 times), it inserts a one-line cutover banner, the v6.11.0 `<!-- auto-start: slices-index -->` and `<!-- auto-start: tdd-slice-summary -->` marker skeleton, mkdir's `tdd-slices/`, and stamps the highest legacy slice id into `flow-state.json::tddCutoverSliceId`. Idempotent: re-running sync is byte-stable once markers are present.

### Migration notes

- **Existing TDD flows mid-stage (hox-style)** — run `npx cclaw-cli@6.12.0 upgrade && npx cclaw-cli@6.12.0 sync`. The cutover marker pins legacy slices (≤ `tddCutoverSliceId`) so they keep validating via the legacy markdown table fallback. New slices (> `tddCutoverSliceId`) MUST use the new protocol: per-slice phase events, `slice-implementer` for GREEN/REFACTOR, `slice-documenter` for `phase=doc` writing into `tdd-slices/S-<id>.md`.
- **Breaking** — controllers that wrote GREEN themselves are now blocked by `tdd_slice_implementer_missing` (required: true). Mitigated by the cutover marker for legacy slices on existing projects, but new projects and new slices on existing projects must dispatch `slice-implementer` for every GREEN.
- **Breaking** — `tdd_slice_documenter_missing` is now required on lean / guided / deep. Previous v6.11.0 advisory behavior on non-deep modes is removed.
- **`flow-state.json::tddCutoverSliceId`** is additive and optional; existing files without the field continue to load. The field is canonical only when `S-<digits>` (e.g. `"S-10"`); other shapes are dropped on coerce.

### Tests

- **`tests/unit/tdd-slice-documenter-mandatory.test.ts`** — `tdd_slice_documenter_missing` is required on lean / guided / deep, and clears when `slice-documenter` records `phase=doc`.
- **`tests/unit/tdd-slice-implementer-mandatory.test.ts`** — `evaluateSliceImplementerCoverage` unit cases (controller-authored green flagged, slice-implementer-authored green accepted, empty-evidence reds ignored) plus a linter integration test that emits `tdd_slice_implementer_missing` when the controller writes GREEN itself.
- **`tests/unit/tdd-cutover-backslide-detection.test.ts`** — `tdd_legacy_section_writes_after_cutover` advisory emits when post-cutover slice ids appear in legacy sections, stays silent without a marker, stays silent when all slice ids are ≤ cutover.
- **`tests/unit/tdd-red-checkpoint-validation.test.ts`** — `evaluateRedCheckpoint` happy + unhappy paths for both implicit-wave and explicit-wave-manifest modes; sequential single-slice runs do not fire.
- **`tests/e2e/tdd-wave-checkpoint.test.ts`** — three slices, explicit `wave-plans/wave-01.md` manifest declaring W-01 membership, controller jumps S-1 to GREEN before S-3's RED → linter blocks with `tdd_red_checkpoint_violation`. Clean wave (all reds, then all greens) returns no finding.
- **`tests/e2e/sync-tdd-cutover.test.ts`** — fixture has legacy 06-tdd.md with S-1..S-10, `cclaw-cli sync` inserts banner + markers + `tdd-slices/` + `flow-state.tddCutoverSliceId="S-10"`, second sync is byte-stable, no-activity artifacts skip cleanly.
- **`tests/e2e/tdd-mandatory-roles-end-to-end.test.ts`** — full happy path for two slices: Phase A (test-author/RED for both) → Phase B (slice-implementer/GREEN + slice-documenter/DOC, paired per slice) → REFACTOR. Linter accepts the artifact: no `tdd_slice_implementer_missing`, no `tdd_slice_documenter_missing`, no `tdd_red_checkpoint_violation`.
- **Skill size budget** in `tests/unit/skill-size.test.ts` bumped 480 → 520 lines for the TDD-only top-of-skill ritual + wave batch mode blocks. Other stages unchanged.

## 6.11.0 — TDD Honest Velocity (Rollback + Auto-derive + Slice-documenter + Sharded Files)

Four-phase release that rolls back the v6.10.0 sidecar (Phase T1+T2) as architecturally wrong and replaces it with a delegation-events driven flow. The TDD linter now reads `.cclaw/state/delegation-events.jsonl` slice phase rows as the source of truth for Watched-RED Proof and Vertical Slice Cycle, auto-renders both blocks into `06-tdd.md`, supports a parallel `slice-documenter` agent for per-slice prose, and accepts sharded `tdd-slices/S-<id>.md` files alongside the thinned main artifact.

### Phase R — v6.10.0 sidecar rollback

- **Removed `cclaw-cli internal tdd-slice-record`** — the sub-command, its parser, and the entire `src/tdd-slices.ts` module (`TddSliceLedgerEntry`, `appendSliceEntry`, `readTddSliceLedger`, `foldTddSliceLedger`, lock paths) are gone. The dispatcher in `src/internal/advance-stage.ts` no longer references the sidecar.
- **Linter sidecar branch removed** — `lintTddStage` no longer reads `06-tdd-slices.jsonl` or emits the `tdd_slice_ledger_missing` advisory.
- **Sidecar tests removed** — `tests/unit/tdd-slice-record.test.ts`, `tests/unit/tdd-linter-sidecar.test.ts`, and `tests/e2e/tdd-sidecar.test.ts` are deleted. They are replaced by Phase D / Phase C / Phase S coverage below.
- **Runtime cleanup of `06-tdd-slices.jsonl`** — `src/install.ts` adds `06-tdd-slices.jsonl` to a new `DEPRECATED_ARTIFACT_FILES` list so `cclaw-cli sync` removes the file from existing installs (mirrors how `tdd-cycle-log.jsonl` was retired in v6.9.0).

#### Phase R — Migration notes

- **The v6.10.0 sidecar (`06-tdd-slices.jsonl`) is deprecated and removed by `cclaw-cli sync`.** No production users exist (it was opt-in for a single release). Running the next `sync` cleans the file; the slice phase data lives in `delegation-events.jsonl` from now on.
- **`cclaw-cli internal tdd-slice-record` is removed.** Replace any per-slice `--status` calls with controller dispatches: `test-author --slice S-N --phase red`, `slice-implementer --slice S-N --phase green`, then `--phase refactor` or `--phase refactor-deferred --refactor-rationale "<why>"`. The harness-generated `delegation-record` hook accepts the new flags (`--slice`, `--phase`, `--refactor-rationale`) and writes the slice phase event for you.

### Phase D — Auto-derive document sections

- **`DelegationEntry` gains optional `sliceId` and `phase` fields (D1)** — `src/delegation.ts` extends the entry with `sliceId?: string` and `phase?: "red" | "green" | "refactor" | "refactor-deferred" | "doc"`. `isDelegationEntry` validates both when present. The inline copy inside `src/content/hooks.ts::delegationRecordScript` is updated in lockstep.
- **`delegation-record` hook accepts `--slice`/`--phase`/`--refactor-rationale` (D2)** — generated script validates `--phase` against the enum, requires `--slice` to be a non-empty string, and hard-errors when `--phase=refactor-deferred` is passed without rationale via either `--refactor-rationale` or `--evidence-ref`. Rationale text gets merged into `evidenceRefs[]` so downstream linter logic finds it without a new field.
- **Skill / controller / subagent text refresh (D3)** — `src/content/stages/tdd.ts` checklist + interactionProtocol now describe the slice-tagged dispatch flow; `sliceImplementerEnhancedBody()` and `testAuthorEnhancedBody()` in `src/content/subagents.ts` instruct agents not to hand-edit the auto-rendered tables; `src/content/skills.ts::watchedFailProofBlock()` and the TDD entry in `BEHAVIOR_ANCHORS` (`src/content/examples.ts`) are updated to match.
- **Linter auto-derive in `lintTddStage` (D4)** — `src/artifact-linter/tdd.ts` reads `delegation-events.jsonl`, groups events by `sliceId`, and validates phase invariants (`phase=red` evidenceRefs/completedTs, monotonic `phase=green` after `phase=red`, REFACTOR present via `phase=refactor` or `phase=refactor-deferred` with rationale). When at least one slice carries phase events, the linter auto-renders `## Vertical Slice Cycle` between `<!-- auto-start: tdd-slice-summary -->` markers in `06-tdd.md`. Re-render is idempotent. With no slice phase events, the linter falls back to the legacy markdown table parsers.
- **RED/GREEN evidence validators auto-pass on phase events (D5)** — `validateTddRedEvidence` and `validateTddGreenEvidence` accept a `phaseEventsSatisfied` flag. `resolveTddEvidencePointerContext` in `src/artifact-linter.ts` reads delegation events and sets the flag when the active run has a `phase=red` (or `phase=green`) row with non-empty `evidenceRefs`. The existing `Evidence: <path>` and `Evidence: spanId:<id>` pointer mode (v6.10.0 T3) stays as a secondary fallback.
- **Trimmed `06-tdd.md` template (D6)** — the per-slice `## Watched-RED Proof` and `## Vertical Slice Cycle` tables are removed; auto-render markers (`<!-- auto-start: tdd-slice-summary -->` and `<!-- auto-start: slices-index -->`) are inserted in their place. `## Test Discovery` is now an overall narrative placeholder; per-slice details live in sharded slice files (Phase S). `## RED Evidence` and `## GREEN Evidence` headings remain as legacy-fallback slots: phase events auto-satisfy them, but legacy artifacts with hand-edited tables continue to validate through the original markdown path.

#### Phase D — Migration notes

- **`DelegationEntry.sliceId` and `DelegationEntry.phase` are optional and additive.** Existing ledgers and tools continue to round-trip without change.
- **`06-tdd.md` template lost the per-slice Watched-RED Proof + Vertical Slice Cycle blocks.** Existing artifacts that still have those tables filled in continue to validate via the legacy markdown fallback. Once the controller starts dispatching with `--slice/--phase`, the auto-rendered block becomes the source of truth.
- **The linter now treats `delegation-events.jsonl` as the primary source of truth for TDD slice phases.** `Evidence: <path|spanId:...>` markdown pointers and the legacy markdown tables remain valid fallbacks when no phase events are recorded.

### Phase C — `slice-documenter` parallel subagent

- **New `slice-documenter` agent in `src/content/core-agents.ts` (C1+C4)** — focused single-slice agent. Allowed paths: only `<artifacts-dir>/tdd-slices/S-<id>.md`. Return contract: `{ summaryMd: string, learnings: string[] }`. Definition is materialized to `agents/slice-documenter.md` by `cclaw-cli sync` like every other entry in `CCLAW_AGENTS`.
- **Parallel-with-implementer wiring (C2+C3)** — TDD stage skill (`src/content/stages/tdd.ts`) and shared TDD skill text (`src/content/skills.ts`) instruct the controller to dispatch `slice-documenter --slice S-N --phase doc` IN PARALLEL with `slice-implementer --phase green`. Because the documenter only touches `tdd-slices/S-<id>.md` and the implementer touches production code, the file-overlap scheduler auto-allows the parallel dispatch. `lintTddStage` adds the `tdd_slice_documenter_missing_for_deep` finding: `required: true` only when `discoveryMode=deep`, advisory otherwise.

#### Phase C — Migration notes

- **`slice-documenter` is opt-in.** Standard / lean / guided runs treat the missing `phase=doc` event as advisory; only `discoveryMode=deep` requires per-slice prose. Existing flat `06-tdd.md` flow remains valid for the other modes.

### Phase S — Sharded slice files

- **`tdd-slices/S-<id>.md` convention (S1+S2+S3)** — `src/content/templates.ts` adds a `tddSliceFileTemplate(sliceId)` helper with the canonical structure: `# Slice S-N`, `## Plan unit`, `## Acceptance criteria`, `## Why this slice`, `## What was tested`, `## What was implemented`, `## REFACTOR notes`, `## Learnings`. The main `06-tdd.md` template stays thin and exposes a `<!-- auto-start: slices-index -->` block that the linter populates with links to present slice files.
- **Linter multi-file support (S4)** — `lintTddStage` globs `<artifacts-dir>/tdd-slices/S-*.md`, validates required headings (`# Slice`, `## Plan unit`, `## REFACTOR notes`, `## Learnings`) per file, and emits `tdd_slice_file:<id>` findings (`required: true` only for slices that have a `phase=doc` event; advisory otherwise). The `## Slices Index` block is auto-rendered idempotently between markers and skipped entirely when no slice files exist.
- **`tdd-render` CLI (S5) — skipped.** The linter already auto-renders the slice summary directly into `06-tdd.md` on every lint pass, so the optional `cclaw-cli internal tdd-render` derived-view CLI was unnecessary for the live source of truth and was deferred. If a `06-tdd-rendered.md` artifact becomes useful later it can be added without touching the v6.11.0 contract.

#### Phase S — Migration notes

- **`tdd-slices/` is optional.** Existing flat `06-tdd.md` flow keeps working; the directory is only required when `slice-documenter` runs (mandatory on `discoveryMode=deep`, advisory otherwise). When the directory is absent or empty, the main `## Slices Index` auto-block stays untouched.

### Tests

- **New unit suite `tests/unit/tdd-events-derive.test.ts`** — covers events-only path (no markdown tables), idempotent auto-render, phase-order monotonicity, refactor-deferred rationale, legacy markdown fallback, RED/GREEN auto-pass on phase events, slice-documenter coverage on `discoveryMode=deep`, and `DelegationEntry.sliceId/phase` round-trip.
- **New e2e suite `tests/e2e/tdd-auto-derive.test.ts`** — drives the inline `delegation-record.mjs` script for three slices via `--slice/--phase`, asserts the linter renders `## Vertical Slice Cycle` populated with all three slices and accepts the artifact without filling markdown tables.
- **New e2e suite `tests/e2e/slice-documenter-parallel.test.ts`** — runs the full `scheduled → launched → acknowledged → completed` lifecycle for parallel `slice-implementer` (production code) and `slice-documenter` (`tdd-slices/S-1.md`) on the same slice. Confirms the file-overlap scheduler auto-promotes `allowParallel` without `--allow-parallel`, both lifecycles end up in `delegation-events.jsonl` and `delegation-log.json`, the linter passes on `discoveryMode=deep`, and `--phase=refactor-deferred` without rationale or evidence-ref blocks the dispatch.
- **New e2e suite `tests/e2e/sharded-slice-files.test.ts`** — three `tdd-slices/S-1.md`, `S-2.md`, `S-3.md` files lint clean and auto-render the `## Slices Index` block (idempotent on re-render). A second test confirms the linter blocks when a slice file referenced by a `phase=doc` event omits the required `## Plan unit`, `## REFACTOR notes`, or `## Learnings` headings (`tdd_slice_file:S-1` blocking finding).

## 6.10.0 — TDD Velocity (Sidecar + Parallel Scheduler + Wave Split)

Two-phase release that thins TDD documentation overhead and unlocks deliberate parallel slice execution. Phase T moves per-slice RED/GREEN/REFACTOR truth from the markdown tables in `06-tdd.md` into a structured append-only sidecar, recorded by a new internal CLI. The linter becomes sidecar-aware: when the sidecar is populated the markdown tables are auto-derived views; when it is empty the legacy markdown rules continue to fire. Phase P introduces a file-overlap scheduler and a fan-out cap so multiple `slice-implementer` subagents can run safely in parallel, plus a new `plan-split-waves` CLI to break large plans into manageable wave files.

### Phase T — TDD Documentation Thinning

- **`06-tdd-slices.jsonl` slice ledger sidecar (T1)** — new file under `<artifacts-dir>/06-tdd-slices.jsonl`. Each row carries `runId`, `sliceId`, `status` (`red|green|refactor-deferred|refactor-done`), `testFile`, `testCommand`, `claimedPaths`, optional `redObservedAt`/`greenAt`/`refactorAt` ISO timestamps, optional `redOutputRef`/`greenOutputRef`/`refactorRationale`, optional `acceptanceCriterionId`/`planUnitId`, and `schemaVersion: 1`. Implemented in `src/tdd-slices.ts` with `appendSliceEntry`, `readTddSliceLedger`, `foldTddSliceLedger`, and the new internal CLI sub-command `cclaw-cli internal tdd-slice-record`. Atomic append under `withDirectoryLock` plus a row-equivalence dedup makes retries idempotent. Status transitions inherit `testFile`/`testCommand`/`claimedPaths` from prior rows so `green`/`refactor-*` calls stay terse.
- **Linter sidecar awareness in `src/artifact-linter/tdd.ts` (T2)** — `lintTddStage` reads the sidecar before evaluating `Watched-RED Proof Shape` and `Vertical Slice Cycle Coverage`. With sidecar rows, validation runs against the JSONL: every entry with status ≥ `red` must carry `redObservedAt`, `testFile`, `testCommand`, `claimedPaths`; `green` must satisfy `greenAt ≥ redObservedAt`; `refactor-deferred` requires a non-empty `refactorRationale`; `refactor-done` requires `refactorAt ≥ greenAt`. With no sidecar rows, the legacy markdown table parsers stay in charge. A new advisory `tdd_slice_ledger_missing` (`required: false`) fires when the markdown tables are filled but the sidecar is empty, nudging the agent toward the new CLI without blocking the gate.
- **RED/GREEN evidence pointer mode (T3)** — `validateTddRedEvidence` and `validateTddGreenEvidence` accept a `TddEvidencePointerOptions` bag. When the markdown body carries `Evidence: <relative-or-abs-path>` or `Evidence: spanId:<id>` and the path resolves on disk or the spanId matches a `delegation-events.jsonl` row, the validator short-circuits without requiring pasted stdout. Sidecar `redOutputRef`/`greenOutputRef` auto-satisfy the markdown evidence rule even without an explicit pointer. The pointer resolver lives in `src/artifact-linter.ts::resolveTddEvidencePointerContext` so per-rule async work runs once.
- **Per-slice Execution Posture removed from `06-tdd.md` (T4)** — the per-slice checkpoint block was a duplicate of the plan-stage Execution Posture and the new sidecar; only the plan-stage block remains. Schema (`src/content/stages/tdd.ts`) and template (`src/content/templates.ts`) updated in lockstep.
- **`Acceptance Mapping` + `Failure Analysis` merged into `Acceptance & Failure Map` (T5)** — `06-tdd.md` now ships a single `## Acceptance & Failure Map` table with columns `Slice | Source ID | AC ID | Expected behavior | RED-link`. The RED-link column accepts a delegation `spanId:<id>`, an `<artifacts-dir>/<file>` path, or a sidecar `redOutputRef`. Schema entry switched to `Acceptance & Failure Map` (`required: false` standard, `required: true` quick), with the validation rule rewritten accordingly. Template, examples, and reference patterns updated to match.
- **Skill text + behavior anchor refresh (T6)** — `sliceImplementerEnhancedBody()` and `testAuthorEnhancedBody()` in `src/content/subagents.ts` now instruct the agent to call `cclaw-cli internal tdd-slice-record` after RED/GREEN/REFACTOR transitions instead of editing the Watched-RED / Vertical Slice Cycle markdown tables. `src/content/stages/tdd.ts` checklist mirrors the change. `src/content/skills.ts::watchedFailProofBlock()` adds a one-line directive to use the sidecar from v6.10.0 onward. The TDD entry in `BEHAVIOR_ANCHORS` (`src/content/examples.ts`) now contrasts manual table editing (bad) with the CLI invocation (good).

#### Phase T — Migration notes

- **Markdown tables remain optional and lint as before.** Existing TDD artifacts that still use the Watched-RED Proof / Vertical Slice Cycle / RED Evidence / GREEN Evidence markdown tables continue to pass the linter. The sidecar is opt-in: until you write rows via `cclaw-cli internal tdd-slice-record`, nothing changes for legacy runs.
- **Migration is opt-in.** A one-shot importer (`tdd-slices-import` from existing markdown tables) is **not** part of this release; it is deferred to v6.11. To migrate a stage, dispatch `cclaw-cli internal tdd-slice-record --slice <id> --status <red|green|refactor-done|refactor-deferred> ...` per slice and accept that the markdown tables become auto-derived. The advisory `tdd_slice_ledger_missing` will surface as a non-blocking finding while you migrate.
- **`Acceptance Mapping` and `Failure Analysis` headings are no longer schema rows in TDD.** Plans that included them before will keep the prose; the merged `Acceptance & Failure Map` is now the only schema-recognized name. Quick-track TDD upgrades the merged section to `required: true`.

### Phase P — Parallel Scheduling

- **File-overlap scheduler (P1)** — `DelegationEntry` gains an optional `claimedPaths: string[]` field (kept in sync with the inline copy in `src/content/hooks.ts::delegationRecordScript`). `validateFileOverlap` in `src/delegation.ts` runs before the legacy duplicate-dispatch guard for `slice-implementer` rows on the TDD stage: disjoint paths auto-set `allowParallel: true` so the new row bypasses `DispatchDuplicateError`; overlapping paths throw the new `DispatchOverlapError` with the conflicting paths and the existing spanId. The hook script accepts `--paths=<comma-separated>` and persists `claimedPaths` on the row. Plan parser already requires the `Files` field per Implementation Unit, so per-unit paths surface naturally.
- **Max active fan-out cap (P2)** — `MAX_PARALLEL_SLICE_IMPLEMENTERS = 5` in `src/delegation.ts`, with override via `process.env.CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS` (parsed integer, validated `>= 1`). The hook script accepts `--override-cap=N` for one-shot bypass. `validateFanOutCap` throws the new `DispatchCapError` when the active `slice-implementer` count would exceed the cap. The hook script contains an inline mirror of the same logic so the dispatch-record subprocess enforces the cap before writing.
- **`cclaw-cli internal plan-split-waves` (P3)** — `src/internal/plan-split-waves.ts` reads `<artifacts-dir>/05-plan.md`, parses `## Implementation Units`, and splits into `<artifacts-dir>/wave-plans/wave-NN.md` files. Flags: `--wave-size=<N>` (default 25), `--dry-run`, `--force`, `--json`. Plans with fewer than 50 units no-op with a JSON outcome `smallPlanNoOp: true`. Each wave file carries a `Source: 05-plan.md units U-X..U-Y` header. The plan artifact gains a managed `## Wave Plans` section between `<!-- wave-split-managed-start -->` / `<!-- wave-split-managed-end -->` markers; subsequent runs replace only the managed block and preserve all other content.
- **`plan_too_large_no_waves` advisory (P4)** — `lintPlanStage` emits this `required: false` finding when the plan has more than 50 implementation units AND `<artifacts-dir>/wave-plans/` is empty (or contains no `wave-NN.md`). The advisory text suggests running `plan-split-waves`; it never blocks stage-complete.

#### Phase P — Migration notes

- **`Files:` per-unit field is optional.** Existing plans without `Files: <a>, <b>` lines (or the legacy `- **Files (repo-relative; never absolute):**` block) continue to lint as today; the file-overlap scheduler simply has no `claimedPaths` to compare and the legacy duplicate-dispatch guard takes over.
- **Slice-implementer fan-out is now capped at 5.** The cap matches evanflow's parallel limit. To raise it for a single dispatch pass `--override-cap=N` to `delegation-record`; to raise it globally for the run, set `CCLAW_MAX_PARALLEL_SLICE_IMPLEMENTERS=10` (any integer ≥ 1) in the parent environment. Disjoint `claimedPaths` are still required regardless of the cap.
- **New CLI subcommand: `plan-split-waves`.** `cclaw-cli internal plan-split-waves --wave-size=25 --dry-run` previews the split without writing. The first non-dry-run invocation creates `wave-plans/` and adds the managed Wave Plans block to the plan; subsequent invocations refresh that block in place.

## 6.9.0 — Runtime Honesty (Purge + R7 Fix + Schema + Skill Align + TDD Hardening)

Five-phase release tightening the gap between what the runtime promises in skills/docs and what it actually does at execution time. Phase A removes large blocks of orphaned code so the runtime can no longer crash through unreachable paths. Phase B fixes the R7 regressions where stale ledger rows blocked fresh dispatches and `subagents.json` showed terminal spans as still active. Phase C repairs schema drift in `flow-state.json` and `early-loop.json`. Phase D re-aligns skill copy with the new runtime behavior (iron laws actually loaded, parallel-implementer rules stated explicitly, "Ralph-Loop" terminology disambiguated). Phase E hardens the TDD linter so claims about RED→GREEN→REFACTOR ordering, investigation evidence, layered review structure, supply-chain drift, and verification status are all checked rather than implied.

### Phase A — Dead-code Purge

- **`src/content/node-hooks.ts`** — `main()` only ever dispatches `session-start` and `stop-handoff` after Wave 22; all other handlers (`handlePromptGuard`, `handleWorkflowGuard`, `handlePreToolPipeline`, `handlePromptPipeline`, `handleContextMonitor`, `handleVerifyCurrentState`, `handlePreCompact`) and their helpers (`hasFailingRedEvidenceForPath`, `reviewCoverageComplete`, `strictLawSet`, `lawIsStrict`, `isTestPayload`, `isProductionPath`, path-matching utilities, and the orphaned `appendJsonLine`) have been removed. `mapHookNameToCodexEvent` and `parseHookKind` are trimmed to the surviving names. The hook-name array near the top of the file is reduced to `["session-start", "stop-handoff"]`.
- **`scheduleSessionDigestRefresh` removed** — the forked-child digest-refresh path was crashing on usage and is no longer invoked from `handleSessionStart`. The associated `session-start-refresh` hook event was unreachable; both the implementation and the dispatch entry are gone.
- **`src/install.ts`** — `managedGitRuntimeScript`, `managedGitRelayHook`, `syncManagedGitHooks`, and the `MANAGED_GIT_*` constants are removed. `init`/`sync`/`uninstall` no longer install `.cclaw/git-hooks/*`. A new `cleanupLegacyManagedGitHookRelays` helper purges the legacy directory on existing installs so they self-heal on the next `cclaw-cli sync`.
- **`src/gate-evidence.ts` `tdd-cycle-log.jsonl` block removed** — the substring-based JSONL order check is gone. The corresponding `parseTddCycleLog` / `validateTddCycleOrder` imports are dropped. The `tdd-cycle-log.jsonl` file (and the `tdd-cycle-log` skill folder) are added to `DEPRECATED_STATE_FILES` / `DEPRECATED_SKILL_FOLDERS_FULL` so existing installs purge them on sync.
- **Hook profile honored at `main()`** — `isHookDisabled` / `CCLAW_HOOK_PROFILE` / `CCLAW_DISABLED_HOOKS` are now consulted before dispatching `session-start` / `stop-handoff`. Disabled hooks exit `0` quietly. `tests/unit/node-hook-runtime.test.ts` exercises env-disable, profile-minimal, and config-disabled paths.

#### Phase A — Migration notes

- **Removed runtime hooks**: `prompt-guard`, `workflow-guard`, `pre-tool-pipeline`, `prompt-pipeline`, `context-monitor`, `verify-current-state`, `pre-compact`, and `session-start-refresh` are no longer dispatched. Harness configs (Codex / Claude / Cursor) that referenced these events should be regenerated; the runtime now only emits `SessionStart` and `Stop`. `docs/harnesses.md` reflects the trimmed event coverage.
- **Removed managed git hooks**: `.cclaw/git-hooks/*` is no longer installed. Existing checkouts will have these files removed on the next `cclaw-cli sync` via `cleanupLegacyManagedGitHookRelays`.

### Phase B — R7 Regression Fixes

- **`findActiveSpanForPair` strict `runId` matching** — `src/delegation.ts` no longer treats entries with empty/missing `runId` as belonging to the current run. The previous `entry.runId && entry.runId !== runId` filter let pre-runId legacy rows pollute the per-run fold, producing spurious `dispatch_duplicate` errors when starting a fresh `slice-implementer` cycle. The inline copy in `src/content/hooks.ts::delegationRecordScript` is updated in lockstep (the "keep in sync" comment still applies).
- **`writeSubagentTracker` runs under the `appendDelegation` lock for every status** — terminal events (`completed`, `stale`) now re-fold the tracker inside the same directory lock, so `subagents.json::active` cannot lag the ledger after a `scheduled → launched → completed` lifecycle.
- **New e2e: `tests/e2e/flow-tdd-cycles.test.ts`** — runs five sequential `slice-implementer` cycles for the same agent without `--supersede` or `--allow-parallel`. Every cycle covers `scheduled → launched → acknowledged → completed`, and the test asserts the ledger ends with 20 rows and `subagents.json::active` empty between cycles.
- **New unit cases in `tests/unit/dispatch-dedup.test.ts`** — synthetic ledger reproduces the R7 hox: a `run-1` `slice-implementer` lifecycle with empty/missing `runId` does NOT block a fresh `run-2` dispatch. A second case asserts `subagents.json` shows an empty `active` array after the full lifecycle for the same span.

#### Phase B — Migration notes

- Legacy ledgers with empty `runId` rows continue to read fine (treated as not-belonging-to-current-run on dispatch dedup); no rewrite is required. Operators who hit `dispatch_duplicate` on a fresh run after a 6.8.x install can now retry without manual ledger surgery.

### Phase C — Schema Repair

- **Hard-error on writing `early-loop` rows without `runId`** — `src/early-loop.ts` no longer falls back to `"active"` for missing `runId`; the CLI/hook surface now refuses to write a row without a real run identifier. Reads of legacy `.cclaw/state/early-loop-log.jsonl` files emit a structured warning and skip the row instead of bricking the read path.
- **`cclaw-cli internal flow-state-repair --early-loop`** — re-derives `state/early-loop.json` from `early-loop-log.jsonl` rather than trusting the on-disk file, normalizing it to the canonical `EarlyLoopStatus` shape. Unit-test coverage feeds it a hand-written legacy file from the R7 hox scenario and asserts the canonical fields are restored.
- **`completedStageMeta` retro-migration** — `repairFlowStateGuard` now invokes `backfillCompletedStageMeta` so any stage in `completedStages` that's missing from `completedStageMeta` is populated with `{ completedAt: <artifact mtime or now> }`. Brainstorm specifically gets a `completedStageMeta` entry on advancement going forward; the repair path is the safety net for runs created on older builds.
- **`qaLogFloor.blocking` pushes a structured `gates.issues` entry** — `src/gate-evidence.ts` no longer relies on the `qa_log_unconverged` linter rule alone to block; when the floor itself is blocking it emits a dedicated entry into `gates.issues`, making the harness signal source-of-truth. The linter rule remains as detail/fallback.

#### Phase C — Migration notes

- **`runId` fallback removed** — older runs that wrote `early-loop-log.jsonl` rows without `runId` are still readable (with structured warnings) but cannot be appended to until repaired. Run `cclaw-cli internal flow-state-repair --early-loop` to re-derive the canonical status file. New writes always require `runId`.
- **Backfill is idempotent** — calling `flow-state-repair` on a healthy install is a no-op; only stages missing from `completedStageMeta` are populated.

### Phase D — Skill / Code Align

- **Iron laws actually loaded into `session-start`** — `handleSessionStart` now appends `ironLawsSkillMarkdown()` from `src/content/iron-laws.ts` to the bootstrap digest, fulfilling the long-standing skill promise that iron laws are visible at session start.
- **`subagents.ts` parallel-implementer rule rewritten** — replaces the old "NEVER parallel implementation subagents" hard rule with the explicit conjunction: parallel implementers are allowed only when (a) lanes touch non-overlapping files, (b) the controller passes `--allow-parallel` on each ledger row, and (c) an `integration-overseer` is dispatched after the parallel lanes and writes cohesion-evidence into the artifact before the gate is marked passed. `src/content/stages/tdd.ts` mirrors the rule into the TDD interaction protocol.
- **"Ralph-Loop" terminology disambiguated** — `src/content/skills-elicitation.ts`, `src/content/stages/brainstorm.ts`, `src/content/stages/scope.ts`, and `src/content/stages/design.ts` now distinguish the **Q&A Ralph Loop** / Elicitation Convergence (used during questioning) from the **Early-Loop / Concern Ledger** (producer-critic concern fold during stage execution). The two were previously conflated in skill copy, leading to confusion when one of them was disabled.
- **Docs sweep** — `docs/harnesses.md` no longer references `PreToolUse` / `PostToolUse` / `UserPromptSubmit` / `PreCompact` event coverage or the removed handlers (`prompt guard`, `workflow guard`, `context monitor`, `verify-current-state`); the hook-event-casing table only lists `SessionStart` and `Stop`; the interpretation section explains that workflow discipline is now enforced via iron-laws at session-start rather than pre-tool blocking.

#### Phase D — Migration notes

- Cohesion contract and `--allow-parallel` ledger flag are now load-bearing. Implementer dispatchers that previously serialized "because the rule said no parallel" can now opt into parallel lanes if and only if all three conditions hold; the TDD linter (`tdd.cohesion_contract_missing` + `tdd.integration_overseer_missing`) already enforces the cohesion-contract side.

### Phase E — TDD Hardening

- **`parseVerticalSliceCycle` table parser** — `src/artifact-linter/tdd.ts` replaces the substring `RED`/`GREEN`/`REFACTOR` check with a real Markdown-table parser that validates monotonic `RED ts ≤ GREEN ts ≤ REFACTOR ts` per slice row. REFACTOR may be marked `deferred because <reason>` / `not needed because <reason>` / `n/a <reason>` / `skipped <reason>`; deferral without a rationale fails. Unit tests cover monotonic-OK, GREEN-before-RED rejection, deferred-with-rationale acceptance, and deferred-without-rationale rejection.
- **`extractAuthoredBody` applied inside `evaluateInvestigationTrace`** — the investigation-trace detector strips `<!-- linter-meta --> … <!-- /linter-meta -->` blocks, raw HTML comments, and `linter-rule` fenced blocks before scanning, so template-echoed example paths no longer produce false positives. Regression unit test injects a linter-meta paragraph that mentions `src/example/path.ts` and asserts the rule still fires `found=false` for prose-only authored content.
- **`Document Reviewer Structured Findings` raised to `required: true` in design** — `src/artifact-linter/design.ts` matches `plan.ts:217-225` and `spec.ts:141-148`. When the design Layered review references coherence/scope-guardian/feasibility reviewers, structured status + calibrated finding lines are now mandatory, not advisory.
- **`tdd_docs_drift_check` extended for supply-chain manifests** — `src/internal/detect-supply-chain-changes.ts` is added, scoped to `package.json` `dependencies`/`devDependencies`/`peerDependencies`/`optionalDependencies`, anything under `.github/workflows/**`, and anything under `.cursor/**`. `gate-evidence.ts` calls it alongside `detectPublicApiChanges`; if either trigger fires for the active TDD run and `doc-updater` was not dispatched, the gate is blocked with structured `gates.issues` entries. Unit tests cover deps-add, package.json non-deps edits ignored, workflow edits, `.cursor/**` edits, and a clean-no-change baseline.
- **`tdd_verification_pending` linter rule** — new `required: true` rule in `src/artifact-linter/tdd.ts` scans `## Verification Ladder` (or `Verification Status` / `Verification`) for any row whose cells contain literal `pending`. Rows must be promoted to `passed`, `n/a`, `failed`, `skipped`, or `deferred` (with rationale) before stage-complete. Unit tests cover `pending → block` and `passed → pass`.

#### Phase E — Migration notes

- **`Document Reviewer Structured Findings` raised from `required: false → true` in design** — design artifacts that mention layered-review reviewers but omit calibrated finding lines will now block stage-complete instead of producing an advisory finding. Fix by adding the structured reviewer-status block under `## Layered review` with explicit reviewer status + calibrated findings.
- **New blocking rule `tdd_verification_pending`** — TDD artifacts that leave `pending` cells in the Verification Ladder section will block stage-complete. Promote rows or mark them `n/a`/`deferred` with a one-line rationale.
- **Supply-chain manifest changes now require `doc-updater`** — TDD stages that touch `package.json` dependency keys, GitHub workflows, or `.cursor/**` configs without dispatching a completed `doc-updater` delegation will block stage-complete with `tdd_docs_drift_check`.

## 6.8.0 — Ledger Truth

Round 7 closes three pinpoint trust bugs in the v6.7.0 runtime that were reproducible on a clean install: stale `state/subagents.json` (active filter without per-`spanId` fold), no monotonic-timestamp validation on delegation-record writes, and silent acceptance of duplicate `scheduled` spans for the same `(stage, agent)` pair without a terminal row on the previous span.

### Subagents Fold

- **`computeActiveSubagents(entries)` in `src/delegation.ts`** — new exported helper that folds delegation entries to the latest row per `spanId` (newest of `completedTs ?? ackTs ?? launchedTs ?? endTs ?? startTs ?? ts`) and returns only spans whose latest status is still in `{scheduled, launched, acknowledged}`. Output is ordered by ascending `startTs ?? ts` so existing UI consumers see a stable presentation. `writeSubagentTracker` now calls `computeActiveSubagents` instead of the prior raw-status filter, so `state/subagents.json::active` no longer reports a span that already has a terminal row.
- **Inline-hook mirror** — the `delegation-record.mjs` hook generated from `src/content/hooks.ts` now applies the same fold inline (with a `// keep in sync with computeActiveSubagents in src/delegation.ts` marker) so node-side and inline writers stay coherent.

### Timestamp Validation

- **`validateMonotonicTimestamps(stamped, prior)` + `DelegationTimestampError`** — `appendDelegation` now validates per-row invariants (`startTs ≤ launchedTs ≤ ackTs ≤ completedTs`, equality allowed) and a cross-row invariant that per-span `ts` is non-decreasing. On violation the helper throws `DelegationTimestampError` with `field`, `actual`, `priorBound`. `runInternalCommand` translates the error into `exit 2` and a stderr line prefixed `error: delegation_timestamp_non_monotonic — <field>: <actual> < <bound>`.
- **Inline-hook mirror** — the inline `delegation-record.mjs` runs the same checks against rows already in the on-disk ledger and emits `{ ok: false, error: "delegation_timestamp_non_monotonic", details: { field, actual, bound } }` with `exit 2` when `--json` is set; bare error mode prints the same payload to stderr. Span `startTs` is now inherited from the first row for that `spanId` so user-supplied `--launched-ts`/`--ack-ts`/`--completed-ts` past timestamps remain coherent against the original schedule.

### Dispatch Dedup

- **`findActiveSpanForPair(stage, agent, runId, ledger)` + `DispatchDuplicateError`** — when `appendDelegation` writes a `scheduled` row, it folds prior entries to find any span on the same `(stage, agent)` whose latest status is still active. If one exists with a different `spanId`, the call throws `DispatchDuplicateError` carrying `existingSpanId`, `existingStatus`, `newSpanId`, and `pair`. `runInternalCommand` translates to `exit 2` + `error: dispatch_duplicate`.
- **`--supersede=<prevSpanId>` and `--allow-parallel` flags** — the `delegation-record.mjs` hook now accepts both flags. `--supersede=<prevSpanId>` first writes a synthetic `stale` terminal row for `<prevSpanId>` with `supersededBy=<newSpanId>` (and a matching event-log row) before recording the new scheduled span; passing the wrong id exits 2 with `dispatch_supersede_mismatch`. `--allow-parallel` skips the dedup check and tags the new row with `allowParallel: true`. New optional fields `allowParallel` and `supersededBy` were added to `DelegationEntry`.
- **Skill update** — the harness dispatch contract section in `src/content/skills.ts` now documents the supersede / allow-parallel choice and the two new error codes (`dispatch_duplicate`, `delegation_timestamp_non_monotonic`).

### Tests

- **`tests/unit/delegation-active-fold.test.ts`** — 7 cases covering scheduled→launched→completed (empty active), scheduled→launched (active is the launched row), two independent active spans, scheduled→completed (empty active), `startTs`-ascending stable order, missing `spanId` ignored, and `stale` treated as terminal.
- **`tests/unit/delegation-monotonic.test.ts`** — 6 cases covering `ackTs < launchedTs` rejection, `completedTs == launchedTs` accepted, `completedTs < launchedTs` rejected, all-equal timeline accepted, cross-row regression rejected, coherent multi-row timeline accepted.
- **`tests/unit/dispatch-dedup.test.ts`** — 6 cases covering `findActiveSpanForPair` happy path, terminal-only pair returns null, duplicate `scheduled` throws `DispatchDuplicateError`, `allowParallel` accepted, different-stage same-agent allowed, and the supersede flow leaves only the new span in the tracker.
- **`tests/e2e/hooks-lifecycle.test.ts`** — new e2e suite that spawns the inline `delegation-record.mjs` and asserts: full lifecycle ends with empty `active`, `--ack-ts` earlier than `--launched-ts` produces `delegation_timestamp_non_monotonic`, second scheduled write produces `dispatch_duplicate`, `--supersede=<prev>` rewrites the previous span as `stale` and lists only the new span in `active`, `--allow-parallel` lists both spans with `allowParallel: true`, and `--supersede=<wrongId>` emits `dispatch_supersede_mismatch`.

### Migration

- Legacy `state/subagents.json` files with stuck `scheduled`/`launched` rows for already-terminal spans self-heal on the next `delegation-record` write — the writer rebuilds the tracker via `computeActiveSubagents` over the entire current-run ledger. No manual intervention is required.

## 6.7.0 — Flow Trust And Linter Precision

Round 6 locks down the three sources of silent trust loss in the v6.x runtime: manual `flow-state.json` edits, proactive delegation waivers with no paper trail, and linter noise that either cannibalized templated meta-phrases or re-asked counterfactual forcing questions on simple work. The runtime hard-blocks on flow-state tampering and on waivers without an approval token; the linter now strips its own meta-phrases before scanning and tags each finding as `new`/`repeat:N`/`resolved` across runs.

### Runtime Honesty

- **Flow-state write-guard (`src/run-persistence.ts`)** — every `writeFlowState` / `writeFlowStateGuarded` call now pairs `.cclaw/state/flow-state.json` with a sha256 sidecar at `.cclaw/.flow-state.guard.json` (fields: `sha256`, `writtenAt`, `writerSubsystem`, `runId`). Guarded reads (`readFlowStateGuarded`) and the `verifyFlowStateGuard(projectRoot)` entry point throw `FlowStateGuardMismatchError` when the sidecar disagrees with the on-disk payload; raw `readFlowState` stays unguarded so the existing sanitizer/quarantine paths keep working. Every writer in `src/internal/advance-stage/*` now records its subsystem (`advance-stage`, `start-flow`, `rewind`, …) so mismatch messages surface the last legitimate writer.
- **Hook-level hard-block** — the generated `delegation-record.mjs` and the `node-hooks.ts` runtime (`session-start`, `stop-handoff`) now verify the sha256 sidecar inline before they act; `runInternalCommand` verifies it for `advance-stage`, `start-flow`, `cancel-run`, `rewind`, and the two `verify-*` subcommands. A hand-edited `flow-state.json` fails with exit code `2` and a clear stderr pointing at the repair command.
- **`cclaw-cli internal flow-state-repair --reason=<slug>`** — recomputes the sidecar from the current payload, appends an audit line to `.cclaw/.flow-state-repair.log`, and refuses bare or malformed reasons. Intended only after an intentional manual edit.

### Waiver Provenance

- **`cclaw-cli internal waiver-grant --stage=<stage> --reason=<slug>`** — issues a short-lived `WV-<stage>-<sha8>-<expSlug>` token (default TTL 30 minutes, max 120) persisted to `.cclaw/.waivers.json`. Prints both the token and the canonical `--accept-proactive-waiver=<token>` consumption command. Reasons must be short kebab-case slugs (`architect_unavailable`, `critic_offline`, …).
- **`--accept-proactive-waiver` now requires `=<token>`** — `src/internal/advance-stage/advance.ts` validates the token against `.cclaw/.waivers.json` (matching stage, not expired, not already consumed), moves the record to `consumed[]`, and writes `approvalToken` / `approvalReason` / `approvalIssuedAt` onto the proactive `DelegationEntry`. Bare `--accept-proactive-waiver` exits with code `2` and a human-readable error.
- **Advisory linter finding `waiver_legacy_provenance`** — fires when a stage's proactive waiver has no `approvalToken` (e.g. issued by a pre-6.7 runtime). Never hard-blocks; guides authors toward `waiver-grant` on the next proactive delegation.

### Linter Precision

- **`extractAuthoredBody(rawArtifact)`** — new helper in `src/artifact-linter/shared.ts` that strips `<!-- linter-meta --> ... <!-- /linter-meta -->` paired blocks, remaining HTML comments, and fenced code blocks tagged `` ```linter-rule ``` ``. Surviving line offsets are preserved so regex-based scanners stay stable. The `Plan-wide Placeholder Scan` now calls `extractAuthoredBody` before scanning so the template's own "Scanned tokens: `TODO`, `TBD`, `FIXME`..." phrase no longer self-triggers the rule.
- **Linter-meta markers in templates** — `src/content/templates.ts` wraps the `## Plan Quality Scan` meta-phrase block in `<!-- linter-meta -->` / `<!-- /linter-meta -->` so `extractAuthoredBody` can skip it cleanly. The `tests/e2e/docs-contracts.test.ts` contract now asserts that wrapping is in place.
- **Findings-dedup cache** — new `src/artifact-linter/findings-dedup.ts` fingerprints each finding as `sha8(stage | rule | normalizedDetail)` and persists the per-stage set to `.cclaw/.linter-findings.json`. `lintArtifact` classifies every finding as `{kind: "new"}`, `{kind: "repeat", count}`, or `{kind: "resolved"}` and emits a short header summary (`linter findings (stage=…): N new, N repeat, N resolved.`) on the `LintResult.dedup` field. Normalization stabilizes the digest by masking run-ids, timestamps, hex hashes, and numeric counts.

### Forcing Question Pruning

- **Brainstorm** no longer requires `[topic:do-nothing]`. The forcing-question list is now `pain`, `direct-path`, `operator`, `no-go`; the `What if we do nothing?` premise-check bullet is retired; `Do-nothing consequence` continues to live in the Problem Decision Record.
- **Scope** no longer requires `[topic:rollback]` or `[topic:failure-modes]`. The forcing-question list is now `in-out`, `locked-upstream`. Design's Failure Mode Table remains mandatory and is untouched.
- `src/content/skills-elicitation.ts` and `src/content/templates.ts` are synced; the retired topic IDs are removed from every example row, Q&A log placeholder, and topic-tag catalog.

### Tests

- **`tests/unit/run-persistence-guard.test.ts`**, **`tests/unit/flow-state-repair.test.ts`**, **`tests/e2e/hook-guard.test.ts`** — pin the sidecar write, guard mismatch error shape, repair log format, and hook-level hard-block for `session-start`, `stop-handoff`, `delegation-record`, and `stage-complete`.
- **`tests/unit/waiver-grant.test.ts`** — covers `issueWaiverToken` / `consumeWaiverToken` happy path, wrong-stage refusal, expired refusal, single-use semantics, CLI parser, and the `cclaw-cli internal waiver-grant` dispatcher.
- **`tests/unit/waiver-legacy-provenance.test.ts`** — verifies the advisory finding fires for token-less proactive waivers and stays silent when the waiver carries an `approvalToken`.
- **`tests/unit/extract-authored-body.test.ts`**, **`tests/unit/findings-dedup.test.ts`** — pin stripping semantics for linter-meta blocks, HTML comments, fenced `linter-rule` blocks, fingerprint stability, `new`/`repeat:N`/`resolved` classification, per-stage segregation, and header rendering.
- **`tests/unit/no-counterfactual-forcing.test.ts`** — regression test that asserts `extractForcingQuestions("brainstorm")` no longer contains `do-nothing`, `extractForcingQuestions("scope")` no longer contains `rollback` or `failure-modes`, the generated brainstorm / scope skills never emit `[topic:do-nothing|rollback|failure-modes]`, and the brainstorm skill drops the `What if we do nothing?` premise line.
- **Existing test updates** — `tests/unit/internal-advance-stage.test.ts`, `tests/unit/hooks-lifecycle.test.ts`, `tests/e2e/elicitation-floor.test.ts`, `tests/unit/delegation-record-repair.test.ts`, `tests/unit/qa-log-floor.test.ts` migrated to the new waiver-token contract, the loose `readFlowState`/guarded `readFlowStateGuarded` split, and the pruned brainstorm/scope topic lists.

### Migration

- Legacy waivers without `approvalToken` remain valid and are surfaced as advisory via `waiver_legacy_provenance`. The next successful proactive delegation should use `cclaw-cli internal waiver-grant` + `--accept-proactive-waiver=<token>`.
- Existing projects continue without manual repair. The first legitimate `stage-complete` (or any `writeFlowState`) after upgrade writes the `.cclaw/.flow-state.guard.json` sidecar. Projects without a sidecar are read in "legacy mode" — the first mismatch only fires after the sidecar exists.

## 6.6.0 — Agent Efficiency Round 5

Two coupled, content-only workstreams that bound investigation cost and anchor each stage to a concrete bad → good behavior. Pure prompt + advisory linter — no `FlowState` fields, no CLI flags, no schema fields, no harness changes. Standard / quick / medium tracks behave identically; the new linter rule is `required: false` and never blocks `stage-complete`.

### Skill Content

- **Investigation Discipline ladder** — every elicitation/spec/plan/tdd/review skill now embeds the same four-step ladder (`search → graph/impact → narrow read of 1-3 files → draft`) plus an explicit path-passing rule for delegations and three stop triggers (`> 3 files in one pass`, `loading file content into a delegation prompt instead of paths`, `starting a draft before any trace exists`). Rendered exactly once per of the seven `INVESTIGATION_DISCIPLINE_STAGES`. `ship` is excluded — it consumes the upstream trace, it does not produce one.
- **Behavior anchor block** — every stage skill now carries a single `## Behavior anchor` block with one bad-vs-good pair tied to a real artifact section in that stage's schema. Themes: brainstorm = silent scope creep in framing; scope = invented contract without user-signal trace; design = premature architecture without a codebase trace; spec = claim-without-evidence in acceptance criteria; plan = parallelization claim without disjoint units + interface contract; tdd = tautological assertion; review = drive-by refactor disguised as findings; ship = victory-by-confidence without runnable evidence.

### Templates

- **`INVESTIGATION_DISCIPLINE_BLOCK`** — new shared markdown constant in `src/content/templates.ts` (~25 lines, four ladder steps + path-passing rule + three stop triggers). Wired into `crossCuttingMechanicsBlock` in `src/content/skills.ts` once — the seven stage files reference it through one line in `interactionProtocol`, no prose duplication.
- **`BEHAVIOR_ANCHORS`** — new typed array in `src/content/examples.ts` (one entry per `FlowStage`, 8 total). Each artifact template (`01-brainstorm.md` … `08-ship.md`) now opens with one `> Behavior anchor (bad -> good) — <section>: ...` line rendered via `renderBehaviorAnchorTemplateLine(stage)`, so authors see the calibration the moment they open the template.
- **`behaviorAnchorFor(stage)`** + **`behaviorAnchorBlock(stage)`** — exported helpers used by the shared skill renderer and the unit tests; the rendered `## Behavior anchor` block contains the section anchor, the bad / good pair, and an optional rule hint.

### Linter Coverage

- **`evaluateInvestigationTrace(ctx, sectionName)`** — new advisory rule in `src/artifact-linter/shared.ts` exporting both the linter wrapper and the underlying `checkInvestigationTrace` detector. Empty / placeholder-only sections (template stubs, separator rows, `- None.`, lone ID-only data rows, table headers) are silent. Sections with substantive content but no recognizable file path / ref / `path:` marker / cclaw ID in the first non-empty rows emit a single advisory finding `[P3] investigation_path_first_missing` ("pass paths and refs, not pasted file contents"). The detector accepts typical TS/JS/MD/JSON paths, slash-bearing repo-root prefixes (`src/`, `tests/`, `docs/`, `.cclaw/`, …), `path:line` ranges, GitHub-style refs (`org/repo#123`, `org/repo@sha`), explicit `path:` / `ref:` markers, stable cclaw IDs (`R1`, `D-12`, `AC-3`, `T-4`, `S-2`, `DD-5`, `ADR-1`, `F-1`, …), and backticked path-like tokens.
- **Six stage linters wired** — `evaluateInvestigationTrace` now runs in `src/artifact-linter/{brainstorm,scope}.ts` against `Q&A Log`, `design.ts` against `Codebase Investigation`, `tdd.ts` against `Watched-RED Proof`, `plan.ts` against `Implementation Units`, and `review.ts` against `Changed-File Coverage`. All six calls are advisory only (`required: false`) and never block `stage-complete` or alter existing failure semantics.

### Tests

- **`tests/unit/investigation-discipline-block.test.ts`** — verifies the constant exists, contains exactly four numbered ladder steps, exactly three stop triggers, mentions path-passing, is not duplicated verbatim in any `src/content/stages/*.ts`, renders exactly once in each of the seven investigation-stage skills, and is absent from the `ship` skill.
- **`tests/unit/investigation-trace-evaluator.test.ts`** — exercises both `checkInvestigationTrace` and `evaluateInvestigationTrace` against missing sections, empty sections, placeholder-only template stubs, sections with TS/MD paths, `path:` markers, stable cclaw IDs, GitHub refs, `path:line` ranges, and prose-only content; confirms exactly one advisory `investigation_path_first_missing` finding fires only on the prose-only case.
- **`tests/unit/behavior-anchors.test.ts`** — verifies exactly one anchor per `FlowStage`, ≤ 40 words on each `bad` / `good` side, uniqueness across stages, that each anchor's `section` resolves to a real entry in `stageSchema(stage).artifactRules.artifactValidation`, that every rendered stage skill markdown contains `## Behavior anchor` exactly once with `- Bad:` / `- Good:` markers, and that every artifact template carries the matching one-line anchor pointer exactly once.
- **`tests/e2e/docs-contracts.test.ts`** — extended with two new contract checks: the Investigation Discipline ladder snippet ("Use this ladder before drafting or delegating") plus the path-passing rule render exactly once per of the seven investigation stages and never in `ship`; the `## Behavior anchor` block renders once per of the eight stage skills with both `Bad:` and `Good:` markers.

## 6.5.0 — Flow correctness round 3 (delegation-log lock, quiet success JSON, scope PD clarity)

### Reliability

- **delegation-log.json** — Generated `delegation-record.mjs` now acquires `delegation-log.json.lock` (atomic `mkdir`) with retry/backoff (~3s max), writes via temp file + `rename`, and releases the lock in `finally`. Lock timeout exits `2` with a clear stderr line. `delegation-events.jsonl` stays append-only without locking.

### Contracts

- **Harness Dispatch** — Shared skill text documents the canonical `delegation-record.mjs` flags (`--stage`, `--agent`, `--mode`, `--status`, `--span-id`, dispatch proof fields, optional `ack-ts` / `evidence-ref`, `--json`) plus lifecycle order and `--repair`.
- **Quiet helpers** — With `CCLAW_START_FLOW_QUIET=1` / `CCLAW_STAGE_COMPLETE_QUIET=1`, successful `start-flow` and `stage-complete` still print exactly **one line** of compact JSON on stdout (parseable); pretty-printed output remains when quiet is off.
- **Anti-false-completion** — Stage skills and templates require quoting that single-line success JSON shape; empty stdout is not a success signal for current tooling.
- **Scope expansion** — Linter finding title is `Product Discovery Delegation (Strategist Mode)` with explicit BEFORE `stage-complete` guidance; `docs/quality-gates.md` uses product-discovery (strategist mode) naming.

### Behavior

- **start-flow (quiet)** — Success line includes `ok`, `command`, `track`, `discoveryMode`, `currentStage`, `activeRunId`, `repoSignals` (no pretty-print).
- **stage-complete / advance-stage (quiet)** — Success line uses `command: "stage-complete"` with `stage`, `completedStages`, `currentStage`, and `runId`.
- **Scope stage skill** — Hard checklist gate: SELECTIVE / SCOPE EXPANSION requires completed `product-discovery` with evidence before completion.

## 6.4.0 — Flow UX round 2 (researcher everywhere, post-closure drift, ergonomics)

### Behavior

- **Proactive researcher gate** — brainstorm/scope/design now require a researcher proactive delegation record (or waiver) in **all** `discoveryMode`s (`lean`, `guided`, `deep`). Discretionary proactive lenses still drop off in `lean`/`guided` except rows marked `essentialAcrossModes` (researcher only today). Sparse or empty repos no longer skip this rule.
- **`start-flow` JSON** — successful stdout now echoes `repoSignals` alongside track/discovery metadata.
- **`early-loop` iteration cap** — derived `iteration` is clamped to `maxIterations`; `early-loop-status` applies a final write-time clamp with stderr notice if a corrupted status object slips through.

### Contracts

- **Stage schema typing** — `dependsOnInternalRepoSignals` removed; proactive rows support `essentialAcrossModes` instead. Researcher prompts document external plus internal search scope explicitly.
- **Label vocabulary** — closeout/substate protocol copy uses **no changes** wording for passive retro/compound options; adaptive elicitation documents that **skip** remains a stop-signal phrase in Q&A only.
- **Optional `## Amendments`** — documented convention for dated post-closure edits; linter advisory `stage_artifact_post_closure_mutation` compares artifact `mtime` to `completedStageMeta.completedAt`.

### Reliability

- **Learnings parse errors** — `parseLearningsSection` exposes `errors[]`; stage-complete.stderr and linter Learnings findings present the same multiline bullet list (`Errors:` + indented rows).
- **Flow persistence** — `completedStageMeta` is optional legacy-safe metadata recorded on stage advance; coercion round-trips through `run-persistence.ts`.

## 6.3.0 — Flow UX (start mode, validation summary, repo-aware proactive, repair-span)

### UX

- **`start-flow` + `/cc` contract** — discovery-mode answers are normalized (`trim`, lower-case) with invalid values re-asked; vague one-line prompts on empty repos must confirm `guided` before defaulting to `deep`.
- **`stage-complete` hook USAGE** — documents `--accept-proactive-waiver` and `--accept-proactive-waiver-reason` alongside existing waiver flags.
- **Validation failure banner** — human-readable `advance-stage` validation errors open with `(delegation=N, gates=M, closure=K)` counts; JSON diagnostics include matching `failureCounts`.
- **`delegation-record --repair`** — idempotent append of missing lifecycle phases for an existing `span-id` when audit lines are incomplete (`--repair-reason` required).

### Reliability

- **Repo signals** — `start-flow` records optional `repoSignals` in `flow-state.json` (shallow file scan, cap 200 files, skips `node_modules`/`.git`).
- **Deep-mode proactive `researcher`** — on sparse/empty repos (`fileCount < 5` and no README or package manifest), brainstorm/scope no longer demand a proactive researcher trace; substantive repos unchanged.
- **`--discovery-mode` parsing** — CLI and `coerceDiscoveryMode` accept `Lean`/`Deep`/etc. without falling back to `guided`.

### Contracts

- **Completion honesty** — templates and every stage skill state that a stage completion claim requires `stage-complete` exit 0 in the current turn (quote the success line; no inference from retries).
- **Stage schema** — `researcher` rows for brainstorm/scope carry `dependsOnInternalRepoSignals` for the trace gate logic above.

## 6.2.0 — Start mode unification (`discoveryMode`)

Behavioral redesign of the user-facing start axis around a single `discoveryMode`: **`lean` \| `guided` \| `deep`**. Track remains an internal concern (not exposed as a parallel “start mode” choice).

### Changed

- **Single `discoveryMode` start-mode axis** — one knob for how much discovery scaffolding to run at kickoff (`lean` / `guided` / `deep`).
- **Track stays internal** — pacing/heuristics still use track under the hood; users align on `discoveryMode` only.
- **Early-stage gate simplification** — fewer branching paths and clearer gating in early flow.
- **Q&A convergence contract aligned with runtime** — linter and advance-stage behavior stay consistent on when Q&A is considered converged.
- **Removed lite / standard / deep agent-facing wording in early stages** — replaced with tier-neutral or `discoveryMode`-aligned copy (incl. Approach Tier wording cleanup).

## 6.1.1 — Wave 24/25 Audit Follow-ups

Hotfix release. Auditing Wave 24 (v6.0.0) and Wave 25 (v6.1.0) end-to-end surfaced one real defect that left two shipped features dead in practice. Standard-track runs were never affected — the bug only matters once a flow-state file actually carries a `taskClass` classification.

### Fixed

- **`flow-state.json#taskClass` was silently dropped on persistence.** `coerceFlowState` in `src/run-persistence.ts` (the single read/write coercer used by both `readFlowState` and `writeFlowState`) never copied the `taskClass` field through. Wave 24 declared the field on `FlowState` and wired it into `mandatoryAgentsFor` + `shouldDemoteArtifactValidationByTrack`, but every flow-state round-trip stripped the value, so `flowState.taskClass` was always `undefined` at runtime. Effect: the Wave 24 `software-bugfix` mandatory-delegation skip and the Wave 25 W25-A artifact-validation demotion both fired only in unit tests that called helpers directly. `coerceFlowState` now sanitizes `taskClass` against the `MandatoryDelegationTaskClass` union (plus `null`) and preserves it across reads and writes; unknown values are dropped instead of leaking through.
- **`checkMandatoryDelegations` ignored `flowState.taskClass`.** The helper accepted `options.taskClass` but `buildValidationReport` in `src/internal/advance-stage/advance.ts` (the `cclaw advance-stage` entry point) never forwarded it. Even after the persistence fix above, the gate would have stayed broken. The helper now falls back to `flowState.taskClass` when the caller leaves `options.taskClass` undefined; explicit `null` still suppresses the lookup. `advance.ts` also threads `flowState.taskClass` through explicitly so the call site stays self-documenting.

### Internal

- Regression tests cover all three legs of the round-trip: `coerceFlowState` preserves valid task classes, drops unknown values, and survives both the `writeFlowState` path and a hand-edited `flow-state.json`. Two new `delegation.test.ts` cases verify that `checkMandatoryDelegations` respects `flowState.taskClass` when no override is passed and that an explicit `null` still wins. Total tests: 794 → 799.

## 6.1.0 — Lite-Tier Artifact Escape + Validator Ergonomics

Wave 25. The user ran a real test of the design stage on a 3-file static landing page (lite/quick-tier work, `taskClass=software-standard`, empty repo) and hit ~10 sequential validation failures, each requiring artifact edits or evidence-format guesswork. Wave 24 dropped mandatory _delegation_ gates for lite/quick/bugfix; Wave 25 extends the same escape to mandatory _artifact-validation_ rules, fixes envelope error consistency, and broadens diagram + edge-case detection so trivial work stops paying ceremony cost.

This release is **additive and non-breaking**: every Wave 24 contract is preserved. Standard tracks behave exactly as before.

### Added

- **Lite-tier artifact-validation escape (W25-A).** New `shouldDemoteArtifactValidationByTrack(track, taskClass?)` helper in `src/content/stage-schema.ts` mirrors Wave 24's `mandatoryAgentsFor` predicate — returns `true` for `track === "quick"` OR `taskClass === "software-bugfix"`. When `true`, the artifact linter demotes a curated list of advanced-only `required` findings (`Architecture Diagram`, `Data Flow`, `Stale Diagram Drift Check`, `Expansion Strategist Delegation`) from blocking → advisory. Findings remain in the result so callers can surface them as advisory hints; only `required` flips to `false`.
- **`artifact_validation_demoted_by_track` audit event.** Appended to `.cclaw/runs/active/delegation-events.jsonl` whenever the W25-A demotion fires, capturing `stage`, `track`, `taskClass`, `runId`, and the demoted `sections[]`. `readDelegationEvents` recognizes and skips this audit-only event (no `agent`/`spanId` payload).
- **`expansion_strategist_skipped_by_track` audit event (W25-F).** Appended when the scope-stage Expansion Strategist (`product-discovery`) delegation requirement is dropped for a small-fix lane, capturing `track`, `taskClass`, `runId`, and `selectedScopeMode`. Same audit-only treatment as the other Wave 24/25 audit events.
- **`reviewLoopEnvelopeExample(stage)` helper (W25-B).** Returns a complete, copy-pasteable JSON shape for the design/scope review-loop envelope with `stage` at the TOP level (not inside `payload`). Every `validateReviewLoopGateEvidence` error now embeds this example so agents stop guessing the envelope shape.
- **`tryAutoHydrateAndSelectReviewLoopGate` (W25-B).** When a review-loop gate (`design_diagram_freshness`, etc.) is auto-hydratable from the artifact AND the artifact section is present, the gate auto-passes — agents do NOT need to include it in `--passed` or `--evidence-json`. Resolves the contradiction between "missing --evidence-json entries for passed gates" and "omit this gate from manual evidence so stage-complete can auto-hydrate it".
- **Architecture Diagram multi-format sync/async detection (W25-C).** `DIAGRAM_ARROW_PATTERN` and `hasAsyncDiagramEdge` / `hasSyncDiagramEdge` now accept a wide range of representations: solid `-->`/`->`/`===>`/`--->`/`=>`/`→`/`⟶`/`↦`, dotted/async `-.->`/`-->>`/`~~>`/`- - ->`/`.....>`, plus `sync:`/`async:` cell-prefix labels and `[sync]`/`[async]` bracket labels. New `DIAGRAM_SYNC_ASYNC_ACCEPTED_PATTERNS` ships every accepted form in the error message so agents stop guessing.
- **Architecture Diagram conditional failure-edge enforcement (W25-C).** New `validateArchitectureDiagram(body, { sections })` enforces the failure-edge keyword rule ONLY when the artifact's `## Failure Mode Table` has at least one row OR the diagram body mentions external-dependency keywords (HTTP, DB, queue, cache, …). Static / no-network designs no longer need to invent fake `(timeout)` annotations.
- **Stale Diagram Audit filename parsing (W25-D).** `normalizeCodebaseInvestigationFileRef` strips parenthetical suffixes like ` (new)`, ` (deleted)`, ` (stub)`, ` (n/a)`, ` (renamed)`, ` (placeholder)`, ` (tbd)`, including stacked variants, before `fs.stat`. `(new)` rows are recorded as "new file, no stale diagrams to detect"; `(skip)`/`(deleted)`/`(stub)` rows and rows with a leading `#` or a `skip:` token in the Notes column are skipped entirely. The "could not read blast-radius file(s)" error now appends a one-line hint explaining how to mark new/skipped/deleted files.
- **Interaction Edge Case Matrix `N/A — <reason>` acceptance (W25-E).** The `Handled?` cell now accepts `N/A`, `N/A — reason`, `N/A – reason`, `N/A - reason`, and `N/A: reason` (em-dash, en-dash, hyphen, colon separators). When `N/A` is present, the deferred-item (`D-XX`) requirement is waived; a reason in the `Handled?` cell or a non-empty `Design response` cell satisfies justification. The error message for an unparseable `Handled?` cell now mentions the `N/A — <reason>` escape.
- **Interaction Edge Case Matrix lite-tier no-network demotion (W25-E).** When `shouldDemoteArtifactValidationByTrack` is true AND the design has no `Failure Mode Table` rows AND no external-dependency keywords in the Architecture Diagram body, the four network-dependent mandatory rows (`nav-away-mid-request`, `10K-result dataset`, `background-job abandonment`, `zombie connection`) are demoted to advisory. The `double-click` row stays mandatory. Successful runs annotate the result with the count of advisory rows for traceability.

### Fixed

- **Review-loop envelope auto-hydration contradiction (W25-B).** Fixed the prior agent-facing trap where omitting an auto-hydratable gate from `--passed` triggered "missing --evidence-json entries for passed gates" while including it triggered "omit this gate from manual evidence so stage-complete can auto-hydrate it". Auto-hydratable gates now consistently auto-pass when the artifact contains the matching review-loop envelope.
- **Stale Diagram Audit `fs.stat("index.html (new)")` failure (W25-D).** The audit no longer interprets parenthetical annotation suffixes as part of the filename — agents no longer have to `touch` placeholder files just to silence the audit.
- **Architecture Diagram failure-edge ceremony (W25-C).** A static landing page with no failure paths and no external dependencies no longer requires a fabricated `App -->|timeout| Fallback` arrow.
- **Interaction Edge Case `N/A` rejection (W25-E).** The `Handled?` cell no longer rejects `N/A` for cases that genuinely don't apply (e.g. `nav-away-mid-request` on a static page with no requests).
- **Expansion Strategist requirement on trivial scope (W25-F).** Lite-tier scope-stage runs in `SCOPE EXPANSION` / `SELECTIVE EXPANSION` mode no longer block on a missing `product-discovery` delegation — the requirement is dropped and audited.

### Internal

- `FlowState.taskClass` (Wave 25 plumbing) is now read by the artifact linter and surfaced through `StageLintContext` so per-stage linters (`scope`, `design`, …) can apply the same lite-tier predicate uniformly.
- `ValidateSectionBodyContext` extended with optional `sections` and `liteTier` so per-section validators can opt into cross-section context and lite-tier demotions without re-deriving the predicate.
- `validateArchitectureDiagram` extracted from the inline `validateSectionBody` switch to a dedicated function; `validateInteractionEdgeCaseMatrix` gained an `InteractionEdgeCaseValidationContext` parameter.
- New helpers in `src/delegation.ts`: `recordArtifactValidationDemotedByTrack`, `recordExpansionStrategistSkippedByTrack`. Both extend the Wave 24 `NON_DELEGATION_AUDIT_EVENTS` set so `readDelegationEvents` ignores them.
- `src/artifact-linter/design.ts` now exports `CodebaseInvestigationFileRef`, `normalizeCodebaseInvestigationFileRef`, and `collectCodebaseInvestigationFiles` so the W25-D parser is unit-testable in isolation.

### Test Coverage

Added 4 new unit-test files (42 new tests, suite total 752 → 794):

- `tests/unit/lite-artifact-validation-escape.test.ts` — W25-A predicate parity with `mandatoryAgentsFor`, W25-C multi-format sync/async + conditional failure-edge, W25-E `N/A — reason` and lite-tier no-network demotion.
- `tests/unit/stale-diagram-filename-parsing.test.ts` — W25-D suffix stripping, stacked suffixes, `#` skip, `skip:` notes, dedupe.
- `tests/unit/review-loop-envelope-errors.test.ts` — W25-B canonical envelope shape, error-message JSON example inclusion, top-level-stage hint.
- `tests/unit/expansion-strategist-track-skip.test.ts` — W25-F + W25-A audit-event helpers and `readDelegationEvents` integration.

### Migration

None required. All changes are additive; existing artifacts and standard-track flows behave exactly as in 6.0.0.

## 6.0.0 — Convergence i18n + drop mandatory delegations on lite

Wave 24. Two complementary fixes that unblock real-world flows:

1. **Topic-ID convergence** — Wave 23 extracted forcing-question topics as English keywords, so RU/UA/non-English Q&A logs were always reported "unconverged" even when the user had answered every forcing question. Wave 24 replaces the keyword fallback with mandatory `[topic:<id>]` tags. Convergence is now language-neutral.
2. **Track-aware mandatory delegation drop** — mandatory subagent gates were firing on lite-tier landing-page work and bugfixes, requiring hand-crafted `--waive-delegation` reasons. Wave 24 collapses the mandatory list to `[]` for `track === "quick"` OR `taskClass === "software-bugfix"` and records an audit-trail event.

### Breaking Changes

- **`[topic:<id>]` tag is now MANDATORY in `## Q&A Log` rows that address forcing questions.** The English keyword fallback is gone. The linter scans only for the explicit `[topic:<id>]` tag (case-insensitive id, ASCII-only) — typically stamped in the `Decision impact` cell. Stage forcing-question checklist rows now declare topics as `id: topic; id: topic; ...`. Brainstorm IDs: `pain`, `direct-path`, `do-nothing`, `operator`, `no-go`. Scope IDs: `in-out`, `locked-upstream`, `rollback`, `failure-modes`. Design IDs: `data-flow`, `seams`, `invariants`, `not-refactor`.
- **`extractForcingQuestions(stage)` return type changed.** Now returns `Array<{ id: string; topic: string }>` (`ForcingQuestionTopic[]`) instead of the old `string[]`. The function throws when a forcing-questions checklist row exists but its body does not match the new `id: topic; id: topic; ...` syntax — authors fix the stage definition rather than ship un-coverable topics.
- **`QaLogFloorOptions.forcingQuestions` accepts `ReadonlyArray<ForcingQuestionTopic | string>`** instead of just `string[]`. String entries are treated as raw topic IDs (the topic label defaults to the id).
- **`qa_log_unconverged` finding details now print pending topic IDs as a bracketed list** (e.g. `Forcing topic IDs pending: [pain, do-nothing, operator]`) plus a one-line tag instruction. The long prose explanation is gone.

### Removed

- `topicKeywords` helper, `isTopicAddressedByKeyword` helper, and the `STOP_WORDS` array in `src/artifact-linter/shared.ts`. The linter no longer tokenizes topic strings into English keywords.

### Added

- **`mandatoryAgentsFor(stage, track, taskClass?, complexityTier?)`** in `src/content/stage-schema.ts`. Returns `[]` when `track === "quick"` OR `taskClass === "software-bugfix"`, otherwise delegates to `mandatoryDelegationsForStage`. New `MandatoryDelegationTaskClass` union: `"software-standard" | "software-trivial" | "software-bugfix"`. Callers (`gate-evidence`, advance-stage validator, subagents.ts table generator, completion-parameters block) MUST go through this helper.
- **`parseForcingQuestionsRow(row, context?)`** in `src/artifact-linter/shared.ts`. Pure parser exposed for unit tests; returns `null` when the row is not a forcing-questions header, throws on malformed `id: topic` syntax or invalid kebab-case IDs.
- **`mandatory_delegations_skipped_by_track` audit event** appended to `.cclaw/runs/active/delegation-events.jsonl` when `mandatoryAgentsFor` collapses to `[]` despite the registered list being non-empty. Captures `stage`, `track`, `taskClass`, `runId`, `ts`. `readDelegationEvents` recognizes and skips this audit-only event (it is not a delegation lifecycle event).
- **`checkMandatoryDelegations(...)` return shape gained `skippedByTrack: boolean`.** Callers can render an "auto-skipped (lite track)" badge instead of a missing-delegations finding.
- **Adaptive-elicitation skill** gained a "Topic tagging (MANDATORY for forcing-question rows)" section with a Russian Q&A example demonstrating the `[topic:<id>]` convention.
- **`## Q&A Log` templates** for `01-brainstorm.md`, `02-scope.md`, `03-design.md` show an example row with `[topic:<id>]` and a note that the tag is mandatory for forcing-question rows.
- **Automatic stage delegation table** in `src/content/subagents.ts` now footnotes the track-aware skip: "Mandatory agents are skipped for `track === "quick"` OR `taskClass === "software-bugfix"`."

### Migration

- **Existing `## Q&A Log` artifacts that addressed forcing questions in prose only.** Stamp the matching `[topic:<id>]` tag in the `Decision impact` cell of the answering row, otherwise `qa_log_unconverged` will block `stage-complete`. Multiple tags allowed when one answer covers several topics. Stop-signal rows do NOT need a tag.
- **External tooling that called `extractForcingQuestions(stage)`** and indexed by string. Read `.id` (or `.topic`) from each `ForcingQuestionTopic` instead.
- **Custom callers of `mandatoryDelegationsForStage`.** Switch to `mandatoryAgentsFor(stage, track, taskClass?)` so the lite/bugfix skip is applied uniformly. Direct callers of the registry helper bypass the Wave 24 drop.
- **Harness UI parsers that read `delegation-events.jsonl`.** Either upgrade to the bundled `readDelegationEvents` (which now ignores audit events) or add `mandatory_delegations_skipped_by_track` to your event allow-list. Lines of this type are not delegation lifecycle events and have no `agent` field.

## 5.0.0 — Dedupe stages, Ralph-Loop convergence Q&A, trim review, forward idea evidence

### Breaking Changes

- **`qa_log_below_min` linter rule renamed to `qa_log_unconverged`.** The fixed-count Q&A floor (10 / 5 / 2 substantive rows for standard/medium/quick) is replaced with a Ralph-Loop convergence detector. Stage closes Q&A when ANY of the following hold:
  - All forcing-question topics from the stage's checklist (the `**<Stage> forcing questions (must be covered or explicitly waived)**` row) appear addressed in `## Q&A Log` (substring keyword match in question/answer columns).
  - The last 2 substantive rows have `decision_impact` tagged `skip` / `continue` / `no-change` / `done` (no new decision-changing rows — Ralph-Loop convergence).
  - An explicit user stop-signal row is recorded (`QA_LOG_STOP_SIGNAL_PATTERNS` keep working: `достаточно`, `хватит`, `enough`, `stop-signal`, `move on`, `досить`, `вистачить`, `рухаємось далі`, etc.).
  - `--skip-questions` flag was persisted (downgrades to advisory).
  - The stage exposes no forcing-questions row AND the artifact has at least one substantive row.
- **`CCLAW_ELICITATION_FLOOR=advisory` env override removed.** The Ralph-Loop convergence detector subsumes the use case; `--skip-questions` remains the documented escape hatch.
- **Lite-tier short-circuit removed.** `quick` track no longer relies on a "1 substantive row passes" rule; convergence semantics handle it (no forcing-questions row + 1 row = converged).
- **`min` and `liteShortCircuit` fields on `QaLogFloorResult` / `QaLogFloorSignal` are now legacy.** They always report `0` / `false` for harness UI compatibility. Harness UIs may render `questionBudgetHint(track, stage).recommended` separately as a soft hint.

### Removed — pure stage duplications (variant A "dedupe only")

The 8-stage structure (`brainstorm / scope / design / spec / plan / tdd / review / ship`) is unchanged. Pure duplications between stages are reassigned to a single owner; downstream stages cite via `Upstream Handoff`.

- **Premise → brainstorm-only.** Scope `## Premise Challenge` removed (replaced with optional `## Premise Drift` for new evidence). Scope cites brainstorm's Premise Check via `Upstream Handoff`. The `Premise Challenge` validator and `validatePremiseChallenge` linter helper are gone.
- **Architecture-tier choice → design-only.** Scope `## Implementation Alternatives` removed; scope only locks `## Scope Mode` (HOLD / SELECTIVE / EXPAND / REDUCE). Design owns the architecture tier in `## Architecture Decision Record (ADR)` + `## Engineering Lock`.
- **Out-of-scope → scope-only.** Design `## NOT in scope` removed; design's `Upstream Handoff` cites scope's `## Out of Scope`. Brainstorm's `## Not Doing` (different altitude — product non-goals) stays.
- **Repo audit → scope-only.** Design `## What Already Exists` replaced with `## Blast-radius Diff` (only `git diff` since the scope-artifact baseline SHA, not a full repo audit). Scope owns the full audit in `## Pre-Scope System Audit`.
- **Constraints / Assumptions split.** Scope owns external/regulatory/system/integration constraints in `## Scope Contract`. Spec owns testable assumptions in `## Assumptions Before Finalization` (with validation path + disposition); spec's `## Constraints and Assumptions` is now carry-forward-only.

### Trimmed — `review` / `tdd` overlap

- `tdd.Per-Slice Review` OWNS severity-classified findings WITHIN one slice (correctness, edge cases, regression for that slice).
- `review` OWNS whole-diff Layer 1 (spec compliance) plus Layer 2 cross-slice integration findings (cross-slice correctness, security sweep, dependency/version audit, observability, external-safety).
- Performance + architecture findings are CARRY-FORWARD from `03-design-<slug>.md` (`Performance Budget`, `Architecture Decision Record`); they are NOT re-derived in review.
- New `review.no_cross_artifact_duplication` linter rule (P1, required): when a finding ID (`F-NN`) appears in both `06-tdd.md > Per-Slice Review` and `07-review-army.json`, severity and disposition MUST match. Review may cite tdd findings; never re-classify them.
- The Performance Lens and Architecture Lens entries in `review.reviewLens` become carry-forward summaries that cite design instead of independent specialist passes.

### Added — `/cc-ideate` -> brainstorm evidence forwarding

- `cclaw internal start-flow` accepts new `--from-idea-artifact=<path>` and `--from-idea-candidate=I-<n>` flags. They persist `interactionHints.brainstorm.{fromIdeaArtifact, fromIdeaCandidateId, recordedAt}` into atomic flow-state on session start. `--from-idea-candidate` requires `--from-idea-artifact`.
- `StageInteractionHint` schema gained `fromIdeaArtifact?: string` and `fromIdeaCandidateId?: string`. Both round-trip through `sanitizeInteractionHints`.
- New brainstorm checklist row: **"Idea-evidence carry-forward (when applicable)."** When the hint is set, brainstorm reuses the chosen `I-#` row's `Title / Why-now / Expected impact / Risk / Counter-argument` as the `baseline` Approach + the seed of `## Selected Direction`. Only the higher-upside `challenger` row(s) are newly generated; the divergent + critique + rank work from `/cc-ideate` is not redone.
- New optional `## Idea Evidence Carry-forward` artifact section in `01-brainstorm-<slug>.md`. New brainstorm linter finding `brainstorm.idea_evidence_carry_forward` (P1, required) blocks `stage-complete` when the hint is set but the section is missing or fails to cite the artifact path / candidate id; suppressed entirely when the hint is absent.
- `/cc-ideate` skill Phase 6 ("Start /cc on the top recommendation") and the contract Phase 9 handoff prose now explicitly call out the new start-flow flags so the harness shim cannot drop the candidate evidence on the floor.

### Added — supporting infrastructure

- `extractForcingQuestions(stage)` helper exported from `src/artifact-linter/shared.ts`. Scans the stage's `executionModel.checklist` for the canonical forcing-questions row and tokenizes the comma-separated topics.
- `evaluateQaLogFloor` returns `forcingCovered: string[]`, `forcingPending: string[]`, and `noNewDecisions: boolean` for richer harness diagnostics.
- New `checkReviewTddNoCrossArtifactDuplication` exported from `artifact-linter` for the cross-artifact-duplication guard.

### Migration

- **Linter rule rename.** Any external tooling that grepped for `qa_log_below_min` in `cclaw` output must be updated to match `qa_log_unconverged`.
- **Removed env override.** Replace `CCLAW_ELICITATION_FLOOR=advisory` usages with the documented `--skip-questions` flag (or fold into the convergence path: append a stop-signal row).
- **Scope artifacts.** If your `02-scope-<slug>.md` carries `## Premise Challenge`, `## Implementation Alternatives`, leave them in place — they are no longer linter-required and are simply ignored. New scope artifacts should rely on `## Scope Contract` (with explicit `Constraints` and `Design handoff` bullets) and the optional `## Premise Drift` for new evidence.
- **Design artifacts.** `## NOT in scope` and `## What Already Exists` sections in legacy `03-design-<slug>.md` are no longer linter-required. New design artifacts use `## Blast-radius Diff` (cite the scope-artifact head SHA) and rely on scope for the out-of-scope contract.
- **Spec artifacts.** Migrate constraint statements from `## Constraints and Assumptions` to scope's `## Scope Contract > Constraints`; keep only testable assumptions in spec's `## Assumptions Before Finalization`.
- **Review artifacts.** Performance and architecture findings should now appear as carry-forward citations to `03-design-<slug>.md` rather than independent Layer 2 entries. If a finding ID is shared with tdd Per-Slice Review, severity and disposition MUST match (cross-artifact-duplication linter blocks otherwise).
- **`/cc-ideate` handoff.** Harness shims that translate `/cc <phrase>` into `start-flow` should plumb the originating idea artifact path and candidate id via the new flags. Without the flags, brainstorm still works the old way (no carry-forward enforced).

## 4.0.0 — Enforce adaptive elicitation

### Breaking Changes

- **Elicitation floor is now blocking.** A new `qa_log_below_min` artifact-linter rule blocks `stage-complete` for `brainstorm` / `scope` / `design` whenever `## Q&A Log` has fewer substantive rows than `questionBudgetHint(track, stage).min` (default `min: 10` for `standard`, `5` for `medium`, `2` for `quick`). Escape hatches: a recognized stop-signal row in any cell (RU/EN/UA: `достаточно`, `хватит`, `enough`, `stop-signal`, `move on`, `досить`, `вистачить`, `рухаємось далі`, etc.), `--skip-questions` flag (downgrades to advisory), or `quick` track with at least one substantive row (lite short-circuit).
- **Removed `No Scope Reduction Language` linter rule.** False positives on legitimate `v1.` / `for now` / `later` / `temporary` strings made it actively harmful. Scope reduction intent is now communicated via decision rationale, not pattern matching.
- **Removed `Locked Decisions Hash Integrity` (`LD#hash`) linter rule and the `LD#<sha8>` anchor contract.** Stable `D-XX` IDs replace the brittle hash-anchor scheme everywhere: artifact templates, cross-stage reference checks (`Locked Decision Reference Integrity` finding now keys off `D-XX`), wave carry-forward guidance, plan/spec/review/design prompts. Existing artifacts that still use `LD#hash` anchors will not trip a hash check anymore but should be migrated to `D-XX` for cross-stage traceability.

### Added — adaptive elicitation enforcement

- `adaptive-elicitation/SKILL.md` rewritten with a **Hard floor** anchor, explicit `## Anti-pattern (BAD examples)` section, mandatory one-question-at-a-time rule, and prohibition on running shell hash commands (`shasum`, `sha256sum`, `Get-FileHash`, `certutil`, `md5sum`) or pasting `cclaw` command lines into chat.
- Brainstorm / scope / design stage bodies inverted: **adaptive elicitation comes first, no exceptions, no subagent dispatch before**. Mandatory delegations (`product-discovery`, `critic`, `planner`, `architect`, `test-author`) now declare `runPhase: "post-elicitation"` and run only after the user approves the elicitation outcome. Sequence: Q&A loop → propose draft → user approval → mandatory delegation → `stage-complete`.
- `STAGE_AUTO_SUBAGENT_DISPATCH` schema gained an optional `runPhase: "pre-elicitation" | "post-elicitation" | "any"` field. Materialized stage skills render a new **Run Phase** column and a legend explaining the ordering contract.
- `evaluateQaLogFloor` helper exported from `src/artifact-linter/shared.ts` powers both the linter rule and the `gate-evidence.ts` `qaLogFloor` signal returned to the harness UI.
- `--skip-questions` flag on `advance-stage` is now read by the linter for the **current** stage (via `lintArtifact({ extraStageFlags })`) in addition to being persisted to the next stage's `interactionHints`.

### Added — Cursor zero-install baseline

- New `.cursor/rules/cclaw-guidelines.mdc` is materialized when the Cursor harness is enabled. The rule has `alwaysApply: true` and pins three baselines that survive even if a stage skill never loads:
  1. Q&A floor before drafting (brainstorm / scope / design).
  2. Mandatory subagents run after Q&A approval.
  3. Never echo `cclaw` command lines, `--evidence-json` payloads, or shell hash commands into chat.
- `AGENTS.md` (and `CLAUDE.md`) generated by `harness-adapters.ts` carries the same three-rule baseline so Claude / Codex / OpenCode harnesses receive identical guidance.

### Changed — UX hardening

- `stage-complete.mjs` defaults to quiet success (`CCLAW_STAGE_COMPLETE_QUIET=1`). Agents no longer paste the full helper command line into chat; they read the resulting JSON instead.
- `delegation-record.mjs` gained `--dispatch-surface` flag. Three legal fulfillment surfaces for mandatory delegations: `cursor-task` (harness-native Task tool, sets `fulfillmentMode: "generic-dispatch"`), `role-switch` (announces `## cclaw role-switch:` block, sets `fulfillmentMode: "role-switch"`), or `isolated` (cclaw subagent helper).

### Migration

- Projects with empty `## Q&A Log` in an active brainstorm / scope / design will see `stage-complete` fail until either the Q&A loop continues or an explicit user stop-signal row is recorded. Add a row like `| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |` to bypass.
- Replace any remaining `LD#<sha8>` anchors in scope artifacts with `D-XX` IDs; downstream design / plan / spec / review references must use `D-XX` to satisfy `Locked Decision Reference Integrity`.
- `brainstorm.md` / `scope.md` / `design.md` skill bodies now require Q&A first; agents that previously drafted-then-asked will need to re-read their stage skill on session start.
- Emergency override: `CCLAW_ELICITATION_FLOOR=advisory` env var downgrades `qa_log_below_min` to advisory globally (undocumented safety net; not a feature).

## 3.0.0 — Honest core

### Breaking Changes

- Reduced hook runtime surface from 9 handlers to 2 handlers only: `session-start` and `stop-handoff`.
- Removed all strict/profile/disabled-hook switching: `strictness`, `hookProfile`, `disabledHooks`, `CCLAW_STRICTNESS`, and profile-gated runtime paths no longer exist.
- Removed config knobs and parser support for: `gitHookGuards`, `vcs`, `tdd`, `tddTestGlobs`, `compound`, `earlyLoop`, `defaultTrack`, `languageRulePacks`, `trackHeuristics`, `sliceReview`, `ironLaws`, `optInAudits`, and `reviewLoop`.
- Removed hook artifacts for retired handlers (`prompt-guard.jsonl`, `workflow-guard.jsonl`, `context-monitor.json`, `session-digest.json`, etc.); runtime no longer emits them.
- Removed cclaw-managed git hook relays and language-pack materialization under `.cclaw/rules/lang/*`.

### Changed

- `.cclaw/config.yaml` is now harness-only: user-facing config contains only `harnesses`, while `version` and `flowVersion` are auto-managed stamps.
- `cclaw init` now writes the minimal 3-key config shape and no longer auto-detects/expands advanced config sections.
- Session-start runtime now rehydrates flow/knowledge context only and no longer runs background helper pipelines (`tdd-loop-status`, `early-loop-status`, `compound-readiness`).
- `stop-handoff` keeps safety bypass + max-2 dirty-tree hard-block cap, but no longer depends on strictness/profile toggles.
- Runtime integrity and downstream consumers now use hardened defaults instead of optional config branches for removed knobs.

### Migration

- Any removed key in `.cclaw/config.yaml` now fails fast with:
  - `key X is no longer supported in cclaw 3.0.0; see CHANGELOG.md`
- Remove retired keys and keep only:
  - `version`
  - `flowVersion`
  - `harnesses`

## 2.0.0

### Breaking Changes

- Fresh `cclaw init` no longer materializes `.cclaw/state/flow-state.json`; missing flow-state is now an expected fresh-init condition until a run is explicitly started.
- Hook contract schema bumped to `2` and legacy `pre-compact` compatibility wiring removed from generated hook manifests/schemas.
- Cursor/Codex hook routing now consolidates multiple guard calls into single in-process pipeline handlers (`pre-tool-pipeline`, `prompt-pipeline`).

### Added

- New shared `adaptive-elicitation` skill with harness-native one-question dialogue, stop-signal handling (RU/EN/UA), smart-skip, conditional grilling triggers, stage forcing-question sets, and irreversible override guardrails.
- New `## Q&A Log` contract for brainstorm/scope/design templates, with append-only turn logging guidance.
- New track/stage-aware `questionBudgetHint(track, stage)` guidance source for adaptive elicitation.
- New advisory lint finding `qa_log_missing` for brainstorm/scope/design artifacts when the Q&A dialogue section is missing or empty.
- New internal `--skip-questions` flag for `internal advance-stage`, persisted as successor-stage interaction hint and surfaced in session-start context.
- New session-start digest cache (`.cclaw/state/session-digest.json`) with debounced background refresh flow for ralph/early-loop/compound-readiness status lines.

### Changed

- `start-flow` helper defaults to quiet mode (`CCLAW_START_FLOW_QUIET=1`) to reduce harness chat noise.
- Stage skill guidance now explicitly preserves existing artifact structure (no wholesale template overwrites) and carries forward locked-decision traceability.
- Brainstorm/scope/design stage schemas now reference adaptive elicitation explicitly and include stage-level forcing-question expectations.
- `delegation-record --rerecord` now preserves/propagates `--evidence-ref` reliably across rerecord flows.
- Artifact linting now emits advisory duplicate-H2 findings and expanded Wave-20 regression coverage across hooks, manifests, templates, and stage skill contracts.

## 1.0.0

### Breaking Changes

- Removed legacy agent names with no compatibility aliases: `performance-reviewer`, `compatibility-reviewer`, `observability-reviewer`, `implementer`, `product-manager`, and `product-strategist`.
- Brainstorm/scope product delegation now routes through unified `product-discovery` (`discovery` + `strategist` modes).
- `enhancedAgentBody` overlap was removed; task-delegation guidance is now sourced directly from `core-agents` output.

### Added

- Wave 14 critic uplift: `critic` now follows a multi-perspective protocol with pre-commitment predictions, gap analysis, low-confidence self-audit routing into `openQuestions[]`, realist checks for major findings, and optional adversarial escalation.
- Added `critic-multi-perspective` subagent-context skill and bound critic dispatch rows in brainstorm/scope/design to this skill.
- Wave 15 document review lens: added `coherence-reviewer`, `scope-guardian-reviewer`, and `feasibility-reviewer` specialists plus context skills (`document-coherence-pass`, `document-scope-guard`, `document-feasibility-pass`).
- Extended dispatch matrix with proactive document-review routing across scope/spec/plan/design based on consistency, scope-drift, and feasibility triggers.
- Wave 17 orchestration uplift: added optional `cohesion-contract.md` + `cohesion-contract.json` templates and introduced `integration-overseer` for TDD fan-out reconciliation.
- Wave 18 orchestration uplift: added proactive `divergent-thinker` for brainstorm/scope option-space expansion and materialized the top-level `executing-waves` skill plus `.cclaw/wave-plans/.gitkeep` scaffold.

### Changed

- Added linter enforcement (`critic.predictions_missing`) for brainstorm/scope/design artifacts that include critic findings but omit required prediction validation blocks (`Pre-commitment predictions`, `Validated / Disproven`, `Open Questions`).
- Added layered-review enforcement for document reviewers in plan/spec/design artifacts: structured calibrated findings are required when these reviewers are cited, and FAIL/PARTIAL outcomes require explicit waiver.
- Wave 16A reviewer-lens consolidation: `reviewer` now carries mandatory inline `Lens Coverage` output (Performance/Compatibility/Observability), and review lint enforces this via `[P1] reviewer.lens_coverage_missing`.
- Removed proactive dispatch fan-out for dedicated performance/compatibility/observability reviewers; these lenses are now inline by default with optional deep-dive context skills (`review-perf-lens`, `review-compat-lens`, `review-observability-lens`).
- Wave 16B worker/discovery consolidation: `slice-implementer` now supports `TDD-bound` and `Generic` modes, and product discovery/strategy responsibilities are unified under `product-discovery`.
- TDD lint now enforces fan-out cohesion hygiene: when >1 completed `slice-implementer` rows exist for the active run, `.cclaw/artifacts/cohesion-contract.md` + parseable `.json` sidecar and a PASS/PASS_WITH_GAPS `integration-overseer` evidence row are required (`tdd.cohesion_contract_missing`, `tdd.integration_overseer_missing`).
- Ship-stage dispatch and lint now enforce architect cross-stage verification before finalization (`architect-cross-stage-verification`, `ship.cross_stage_cohesion_missing`, `ship.cross_stage_drift_detected`).
- Brainstorm lint now enforces multi-wave carry-forward drift audits when `.cclaw/wave-plans/` contains 2+ plans (`wave.drift_unaddressed`).

## 0.56.0

### Breaking Changes

- Slimmed the canonical knowledge schema to core fields only for new writes. New `appendKnowledge` / stage `## Learnings` harvest no longer persists legacy metadata keys (`domain`, `origin_run`, `universality`, `maturity`, `supersedes`, `superseded_by`).

### Changed

- Kept read compatibility for historical mixed-schema `.cclaw/knowledge.jsonl` rows while normalizing in-memory entries to the core schema shape.
- Simplified `retro-gate` to closeout-state-driven completion (`(retroAccepted || retroSkipped) && (compoundReviewed || compoundSkipped)`), removing knowledge-window scanning from gate evaluation.
- Expanded shared runtime snippets used by both generated Node hooks and OpenCode plugin (`flow summary`, `knowledge digest parsing`, `active artifacts path`) to reduce duplicated runtime logic.
- Added hook bundle infrastructure: `src/runtime/run-hook.entry.ts`, `build:hook-bundle`, `esbuild` dev dependency, and installer support that prefers bundled `dist/runtime/run-hook.mjs` with safe fallback to generated runtime source.

## 0.55.2

### Changed

- Finalized the artifact-linter split from Wave 12: moved shared helpers/validators into `src/artifact-linter/shared.ts`, moved design-only diagram drift/tier helpers into `src/artifact-linter/design.ts`, removed stage-module `// @ts-nocheck`, and slimmed `src/artifact-linter.ts` into a real orchestrator.
- Finalized the internal advance-stage split from Wave 12: removed `src/internal/advance-stage/core.ts`, turned `src/internal/advance-stage.ts` into the real `runInternalCommand` dispatcher, and moved parser/helper/review-loop/flow-state/runners logic into dedicated modules under `src/internal/advance-stage/`.
- Bumped package runtime version to `0.55.2` so package metadata matches the current changelog series.

## 0.55.1

### Changed

- Renamed plan-stage lint findings to `Plan Quality Scan: Placeholders` and `Plan Quality Scan: Scope Reduction` for consistency with the merged `Plan Quality Scan` template heading.

### Removed

- Removed the unused legacy `VibyConfig` type alias in favor of `CclawConfig`.

## 0.55.0

### Changed

- Simplified stage templates and validation contracts across brainstorm/scope/design/plan/review: merged plan scans into `Plan Quality Scan`, merged review pre-critic framing into `Pre-Critic Self-Review`, and replaced deep design triple-diagram sections with one `Deep Diagram Add-on` section that accepts `state-machine` or `rollback-flowchart` or `deployment-sequence` markers.
- Updated design diagram requirement enforcement to support the merged deep add-on marker contract while preserving standard-tier architecture/data-flow/error-flow requirements.
- Demoted `Vague to Fixed` (spec) and `Assertion Correctness Notes` (tdd) to template-only optional guidance (no schema-level artifact-validation row).
- Unified generated helper runtime bootstrapping: `stage-complete.mjs` now reuses the shared `internalHelperScript()` with a required positional `<stage>` argument.
- Slimmed iron-law skill output to focus full detail on the two runtime hook-enforced laws (`stop-clean-or-handoff`, `review-coverage-complete-before-ship`), while listing remaining laws as stage-owned advisory items.

### Removed

- Removed duplicate `Test Strategy` artifact-validation row in design stage schema.
- Removed retired brainstorm structural checks and template sections for `Forcing Questions`, `Premise List`, and `Anti-Sycophancy Stamp`.
- Removed retired scope sections/checks for `Failure Modes Registry`, `Reversibility Rating`, `Dream State Mapping`, and `Temporal Interrogation`.
- Removed retired design sections/checks for `ASCII Coverage Diagram`, plus orphaned design/review `Learning Capture Hint` blocks.
- Removed orphaned design template sections `Regression Iron Rule` and `Calibrated Findings` (plan retains the canonical versions).
- Removed unused seed-shelf runtime module/test pair (`src/content/seed-shelf.ts`, `tests/unit/seed-shelf.test.ts`) while preserving user-facing `.cclaw/seeds/` guidance in templates.
- Removed diagnostic-only `cclaw internal hook-manifest` command and its unit test surface.

## 0.54.0

### Added

- Added wave-9 TDD evidence enforcement: `Iron Law Acknowledgement`, `Watched-RED Proof`, and `Vertical Slice Cycle` are now required stage gates/sections; template now includes `Per-Slice Review` and `TDD Blocker Taxonomy`; lint adds a `Mock Preference Heuristic` recommendation when mocks/spies appear without explicit trust-boundary justification.
- Added wave-9 spec strengthening: `Spec Self-Review` is now a required gate/section, spec lint emits a `Single-Subsystem Scope` recommendation when `Architecture Modules` grows beyond one coherent subsystem boundary, and a proactive `spec-document-reviewer` specialist is available for plan-readiness review.
- Added wave-9 plan review structure: plan schema/template now supports recommended `Calibrated Findings` and `Regression Iron Rule` sections, with dedicated lint findings for canonical format and acknowledgement.

### Changed

- Promoted `Synthesis Sources`, `Behavior Contract`, and `Architecture Modules` into explicit spec artifact-validation rows (recommended) so schema/docs align with existing lint checks.
- Promoted `Implementation Units` into an explicit plan artifact-validation row (recommended) to match existing shape checks.

### Removed

- Removed spec template sections `Testing Strategy` and `Reviewer Concerns (convergence guard)` as orphaned/duplicative scaffolding.
- Removed plan template sections `High-Level Technical Design` and `Plan Self-Review` in favor of upstream design ownership plus calibrated/iron-rule review sections.
- Removed TDD template sections `Anti-Rationalization Checks` and `Learning Capture Hint` after promoting stronger required evidence sections.

## 0.53.0

### Added

- Added a `product-strategist` specialist and scope-mode enforcement: when scope selects `SCOPE EXPANSION` or `SELECTIVE EXPANSION`, artifact validation now requires a completed active-run `product-strategist` delegation row with non-empty evidence refs.
- Added wave-8 stage structure upgrades: brainstorm now includes a recommended `Embedded Grill` section, and design now includes a recommended compact `Long-Term Trajectory` section plus matching policy needles/templates.

### Changed

- Elevated design diagram freshness discipline: `optInAudits.staleDiagramAudit` is now default-on, design gates include `design_diagram_freshness`, and compact trivial-override slices without diagram markers are explicitly marked as a stale-audit skip instead of a hard failure.

## 0.52.0

### Breaking Changes

- Dropped legacy knowledge-entry compatibility aliases for the pre-cleanup idea source and old origin field. All knowledge rows must use canonical `source: "idea"` and `origin_run`.
- Removed installer cleanup/migration handling for pre-cleanup command/skill aliases from the retired next/idea-era shim set. Projects still carrying those legacy surfaces must run a manual `npx cclaw-cli uninstall && npx cclaw-cli init`.

## 0.51.28

### Fixed

- Made the artifact linter tolerate the actual shipped template shape: structural-field regexes for `Mode Block Token`, `Anti-Sycophancy Acknowledgement`, and `Regression Iron Rule Acknowledgement` now accept optional markdown emphasis (`*`, `**`, `_`) around both the field name and the value. Previously `- **Mode:** STARTUP` (the form the template ships and the agent fills in) failed validation because the regex only allowed plain whitespace between `Mode:` and the token.
- Extended `Approach Tier Classification` to recognize `lite` (alias for `Lightweight`) in addition to `Lightweight`, `Standard`, and `Deep`, so artifacts written verbatim from the `lite | standard | deep` template default are accepted. State-contract `approachTier` taxonomy now lists both spellings for downstream consumers.
- Added explicit placeholder detection for both `Mode Block` and `Approach Tier`: a line that lists ≥2 distinct tokens (the unfilled template placeholder, e.g. `Tier: lite | standard | deep`) now fails with a targeted message instead of silently passing on incidental token presence.

### Added

- Regression fixtures in `tests/unit/quality-gate-fixtures.test.ts` for the actual shipped template shape: bold-form `Mode Block` / `Anti-Sycophancy Stamp` / `Regression Iron Rule` pass; bold-form Mode placeholder fails; `Tier: lite` passes; `Tier: lite | standard | deep` placeholder fails. Earlier fixtures used the unbolded form (`- Mode: ENGINEERING`) which never exercised the runtime template.

## 0.51.27

### Fixed

- Hardened the delegation proof model with ledger schema v3 and a `legacy-inferred` fulfillment mode, so pre-v3 ledger rows are surfaced as `legacyRequiresRerecord` and explicitly upgraded via the `delegation-record.mjs --rerecord` helper instead of silently passing stage-complete.
- Locked the `delegation-record.mjs` helper down: `--dispatch-surface` now strictly validates against the `DELEGATION_DISPATCH_SURFACES` enum (rejecting legacy `task`), `--agent-definition-path` is verified against the harness-specific directory layout, and `--ack-ts` is mandatory for `event=completed` with isolated/generic surfaces.
- Split `stage-complete` diagnostics into granular categories (`missing`, `missingDispatchProof`, `legacyInferredCompletions`, `corruptEventLines`, `staleWorkers`, `waivedWithEvidence`) with per-failure `nextActions`, eliminating opaque "missing delegations" failures.
- Generated per-harness lifecycle recipes (OpenCode / Codex / Cursor / Claude) with the correct dispatch surface, neutral placeholders, and dispatch-surface table dynamically rendered from the runtime enum, keeping `docs/harnesses.md` in sync with `src/delegation.ts`.

### Changed

- Upgraded all eight stage templates (brainstorm → ship) and skills with universal, domain-neutral quality gates: mode selection blocks, premise-challenge / forcing questions, mandatory alternatives with calibrated confidence (1–10), STOP-per-issue protocol, anti-sycophancy framing, NO-PLACEHOLDERS rule, watched-RED proof for TDD, ASCII coverage diagrams for design, vertical-slice TDD with per-cycle refactor, and a 4-option ship gate. No domain-specific terminology (web, CRUD, dashboard, framework names) leaks into agent instructions, templates, or linter rules.
- Promoted reusable cross-cutting building blocks (`stopPerIssueBlock`, `confidenceCalibrationBlock`, `outsideVoiceSlotBlock`, `antiSycophancyBlock`, `noPlaceholdersBlock`, `watchedFailProofBlock`) in `src/content/skills.ts` so each stage skill composes the same mechanics consistently.
- Expanded the artifact linter with structural-only checks for every stage (presence of mode block, alternatives table columns, confidence-finding format, watched-RED evidence, etc.), keeping checks domain-neutral and agnostic to task type.

### Added

- `docs/quality-gates.md` mapping every cclaw section to its source pattern in `gstack`, `superpowers`, and `evanflow`, with diverse non-web examples (CLI utility, library, infra/migration).
- `tests/unit/quality-gate-fixtures.test.ts` with regression coverage for the helper (rejects `task`, validates path, requires `ack-ts`), the linter on diverse non-web task types across all 8 stages, and an end-to-end `--rerecord` flow that upgrades a legacy-inferred row to v3 and clears `legacyRequiresRerecord`.

## 0.51.25

### Fixed

- Added reference-grade subagent execution contracts with expanded specialist routing, worker lifecycle evidence, stricter delegation waivers, vertical-slice TDD guidance, managed recovery paths, and no-VCS verification support.
- Made the README a lighter operating front door with ASCII flow, recovery guidance, and subagent evidence framing, backed by a tracked `docs/scheme-of-work.md` flow contract.
- Added docs/generated contract regressions and refreshed generated guidance so status, recovery, track routing, and reference-pattern expectations stay aligned with runtime behavior.

## 0.51.24

### Fixed

- Upgraded brainstorm, scope, and design into an adaptive reference-grade flow with product/technical discovery, strategic scope contracts, and engineering-lock evidence.
- Strengthened staged specialist agents and review evidence so generated harness guidance requires anchored findings, changed-file coverage, security attestations, and dependency/version checks where relevant.
- Hardened runtime correctness around pre-push range detection, Codex hook readiness/wiring diagnostics, compound-before-archive checks, and knowledge/seed retrieval quality.

## 0.51.23

### Fixed

- Materialized generated stage command shims so stage skills no longer point agents at missing `.cclaw/commands/<stage>.md` files.
- Restored native subagent dispatch surfaces for OpenCode and Codex via generated `.opencode/agents/*.md` and `.codex/agents/*.toml` agent definitions, with role-switch retained only as a degraded fallback.
- Tightened harness delegation, hook/sync diagnostics, quick-track templates, and knowledge metadata regressions so installed runtime guidance matches validation behavior.

## 0.51.22

### Fixed

- Repaired audit-found flow contract gaps across runtime gates, generated templates, hooks, knowledge retrieval, delegation validation, and installer diagnostics.
- Added regressions for quick-track artifact scaffolds, retro/archive evidence validation, TDD refactor ordering, hook lifecycle coverage, init recovery, and canonical knowledge/delegation semantics.

## 0.51.19

### Fixed

- Materialized every subagent dispatch `skill` reference as a generated `.cclaw/skills/<skill>/SKILL.md` context skill, so mandatory/proactive routing no longer points agents at missing or deprecated skill folders.
- Added regression coverage that every dispatch `skill` reference is generated, every referenced agent exists in the core roster, install writes those context skills, and every required artifact validator section appears in that stage's canonical template.

## 0.51.18

### Fixed

- Aligned the brainstorm SKILL guidance and `Self-Review Notes` validation rule with the calibrated review format (`Status: Approved` | `Issues Found`, `Patches applied:`, `Remaining concerns:`); removed the legacy "or - None." shortcut that contradicted the structural validator and caused first-attempt stage-complete failures.
- Added a Context Loading step that points every stage skill at its canonical artifact template (`.cclaw/templates/<NN>-<stage>.md`) so agents draft per-row Approaches tables and the calibrated review block from the start instead of inventing layouts that fail validation.

## 0.51.17

### Fixed

- Relaxed the brainstorm calibrated `Self-Review Notes` validator: it now accepts `Status:` lines with trailing context, treats both inline notes and sub-bullets as valid for `Patches applied:` / `Remaining concerns:`, and reports per-line problems instead of one opaque message. The unfilled placeholder `Status: Approved | Issues Found` is now explicitly rejected with an actionable hint to pick exactly one value.
- Updated the brainstorm artifact template default to `Status: Approved` so freshly drafted artifacts pass validation without manual placeholder cleanup, while review-prompt documentation continues to show both canonical values.

## 0.51.16

### Fixed

- Fixed OpenCode hook execution so generated plugins spawn a real Node executable instead of accidentally re-entering the OpenCode CLI through `process.execPath`.
- Added active stage contracts and calibrated review prompts to session bootstrap context, making stage structure and self-review expectations visible before artifact drafting.
- Improved brainstorm validation feedback for transposed `Approaches` tables and enforced calibrated `Self-Review Notes` format when that section is present.
- Made managed `start-flow` record seed, origin-document, and stack-marker discovery in `00-idea.md`.
- Added automatic delegation-log waivers for untriggered proactive dispatch rows so skipped helper reviews remain auditable.

## 0.51.15

### Fixed

- Added real test-command discovery for verification gates: `tdd_verified_before_complete` and `review_trace_matrix_clean` now check gate evidence against discovered project test commands when available.
- Updated review templates and stage skills to record verification command discovery explicitly.

## 0.51.14

### Fixed

- Added cross-stage reference checks so downstream design/spec/plan/review artifacts must reference every scope `R#` requirement and `LD#hash` locked-decision anchor.
- Updated scope/design/spec/plan templates to use `LD#hash` decision anchors instead of the legacy `D-XX` convention.
- Added structural validation for `LD#<sha8>` locked-decision anchors, including uniqueness and table hash consistency.

## 0.51.13

### Fixed

- Added generated per-stage state contracts under `.cclaw/templates/state-contracts/*.json` with `requiredTopLevelFields`, `taxonomies`, and `derivedMarkdownPath` so machine-readable stage shape is explicit.
- Added calibrated review prompt files for brainstorm self-review, scope CEO review, and design engineering review under `.cclaw/skills/review-prompts/`.
- Added a macOS Node 20 PR-gate job alongside Linux and Windows, and added install smoke coverage for state contracts and review prompts.

## 0.51.12

### Fixed

- Replaced brainstorm challenger detection with structural `Approaches` table validation: `Role` must be `baseline`, `challenger`, or `wild-card`; `Upside` must be `low`, `modest`, `high`, or `higher`; exactly one challenger must have `high` or `higher` upside.
- Added structural `Requirements` priority validation for scope artifacts (`P0`, `P1`, `P2`, `P3`, or `DROPPED`) instead of leaving priority as unchecked prose.
- Updated brainstorm regressions to use canonical `Role`/`Upside` columns, including non-Latin artifact prose with stable machine-readable taxonomy fields.

## 0.51.11

### Fixed

- Removed the generic validation-rule keyword matcher entirely, so artifact prose is no longer checked by copied English/backticked words from schema descriptions.
- Made `Premise Challenge` bullet validation depend only on substantive row content, not question marks or English Q/A phrasing.
- Replaced the Russian-specific Scope Summary regression with a non-Latin-script regression spanning multiple scripts, so the guard protects all natural languages rather than one test case.

## 0.51.10

### Fixed

- Replaced the brittle keyword-grep on `Scope Summary` with structural validation that requires a canonical scope mode token (`SCOPE EXPANSION` / `SELECTIVE EXPANSION` / `HOLD SCOPE` / `SCOPE REDUCTION`) and a track-aware next-stage handoff, so non-English scope artifacts no longer fail validation for missing English keywords.
- Made `Premise Challenge` validation purely structural (≥3 substantive Q/A rows in a table or bullet list); answers may be in any language and the linter no longer requires the literal English question phrasing.
- Tightened `extractRequiredKeywords` to fire only on backticked machine-surface tokens, so descriptive prose in validation rules stops being mis-treated as required keywords.

### Changed

- Strengthened the `brainstorm` execution model and template with reference-grade structure: `Premise Check`, `How Might We` reframing, `Sharpening Questions` (decision-impact column), `Not Doing` list, `Self-Review Notes`, and a stable `Approaches` table with canonical `Role` (`baseline` | `challenger` | `wild-card`) and `Upside` (`low` | `modest` | `high` | `higher`) columns.
- Strengthened the `scope` execution model with an explicit premise + leverage check and mode-specific analysis matched to the chosen gstack mode (SCOPE EXPANSION / SELECTIVE EXPANSION / HOLD SCOPE / SCOPE REDUCTION); template now exposes `Strongest challenges resolved` and `Recommended path` as explicit Scope Summary fields.

## 0.51.3

### Fixed

- Aligned brainstorm artifact templates and generated skill validation guidance with the hidden linter checks for `Approach Reaction`, `Selected Direction`, and `challenger: higher-upside` rows.
- Made brainstorm artifact validation failures include actionable rule/details text instead of only opaque check names such as `Direction Reaction Trace`.
- Reinforced brainstorm interaction guidance so structured question tools ask one decision-changing question at a time instead of bundled multi-question forms.

## 0.51.2

### Fixed

- Fixed `internal advance-stage` and generated `stage-complete.mjs` compatibility with real shell usage by accepting both `--evidence-json=<json>` and `--evidence-json <json>` forms.
- Coerced boolean/object/number gate evidence JSON values into stored evidence strings so copied completion commands do not silently drop non-string evidence.
- Strengthened generated stage completion guidance to stop on helper failures instead of manually editing `flow-state.json`, preserving validation and `## Learnings` harvest.

## 0.51.1

### Fixed

- Made generated `stage-complete.mjs` advance stages through the local Node runtime instead of requiring a runtime `cclaw` binary in `PATH`, preserving gate validation and `## Learnings` harvest.
- Clarified generated prompts and docs so `cclaw-cli` is the installer/support surface while `/cc*` commands and Node hooks are the normal in-session runtime.
- Added a generated Conversation Language Policy so user-facing prose follows the user's language while stable commands, ids, schemas, and artifact headings remain canonical.
- Aligned normal-flow knowledge guidance around artifact-first `## Learnings` capture and reserved direct JSONL writes for explicit manual learning operations.

## 0.51.0

### Fixed

- Made `npx cclaw-cli sync` discoverable in CLI help, always print fixes for
  failing checks, and point recovery docs at existing local files.
- Fixed non-flow headless envelopes for `/cc-idea` and `/cc-view` so they no
  longer masquerade as brainstorm/review stage outputs.
- Made `sync --only` JSON and exit-code semantics scoped to the filtered
  checks while preserving `globalOk` for the full suite.
- Replaced bash-based Node probing in sync with platform-native command
  checks, and made hook wrappers loudly report skipped hooks when `node` is
  missing.

### Changed

- Added digest-first knowledge wording to session/research guidance and
  standardized resume wording on `/cc`.
- Centralized post-ship closeout substate guidance and strengthened
  verification-before-completion wording.
- Added a flow-state schema version for future migrations.
- Improved onboarding with Node 20+, repo-root install guidance, local docs
  pointers, and a static generated `AGENTS.md` block example.

## 0.50.0

Full phase-1 cleanup. This release removes the remaining heavy surfaces
that made a fresh install feel like a framework dump instead of a harness
workflow tool.

### Removed

- Removed the feature/worktree system, including the `feature-system`
  runtime, generated worktree state, and the user-facing feature command
  surface.
- Removed `/cc-ops` and its legacy subcommands. Flow progression and
  closeout now stay on `/cc`; explicit archival/reset stays on
  `cclaw archive`.
- Shrank generated commands to the four real entrypoints: `/cc`,
  `/cc`, `/cc-idea`, and `/cc-view`.
- Stopped scaffolding derived/cache state files on init. Runtime hooks now
  create optional diagnostics only when needed.
- Removed broad default utility skills and kept the generated skill surface
  focused on flow stages, cclaw routing, subagent/parallel dispatch,
  session, learnings, research playbooks, and opt-in language rule packs.
- Removed the internal eval harness, its CLI command, fixtures, docs,
  tests, and the unused `openai` runtime dependency.
- Removed stale generated-reference templates and docs that pointed users
  at `.cclaw/references`, `.cclaw/contexts`, worktrees, or `/cc-ops`.
- Removed the unused internal `knowledge-digest` subcommand and stopped
  materializing `knowledge-digest.md`; session bootstrap reads
  `knowledge.jsonl` directly.
- Removed saved `flow-state.snapshot.json` semantics from `/cc-view diff`.
  The view command is now read-only and uses visible git evidence instead
  of creating derived state.
- Removed the stale `.cclaw/features/**` preview line and remaining
  "active feature" wording from generated guidance after the feature
  system removal.
- Removed feature-system fields from new archive manifests; archives now
  record `runName` instead of `featureName` / `activeFeature`.
- Removed the legacy `/cc-learn` command surface from generated guidance.
  Knowledge work remains available through the `learnings` skill, while
  the visible slash-command surface stays at `/cc`, `/cc`,
  `/cc-idea`, and `/cc-view`.
- Removed an unused TDD batch walkthrough export and the large stage-skill
  golden snapshot file; contract tests now assert behavioral anchors instead
  of pinning generated prose.
- Stopped scaffolding the unused `stage-activity.jsonl` ledger. Fresh installs
  now start with only `flow-state.json` and `iron-laws.json` under
  `.cclaw/state`.
- Removed stale eval GitHub Actions workflows and `.gitignore` exceptions that
  still referenced deleted `.cclaw/evals` fixtures.
- Removed stale ignore/config entries for the deleted `docs/references` and
  `scripts/reference-sync.sh` reference-research surface.
- Consolidated `/cc-view` generated guidance into one `flow-view` skill with
  embedded `status`, `tree`, and `diff` subcommand sections. Sync now removes
  the old `flow-status`, `flow-tree`, and `flow-diff` skill folders.
- Removed obsolete standalone `status`, `tree`, and `diff` command contract
  generators that were only kept alive by tests after `/cc-view` consolidation.
- Converted view subcommand generators into embedded bodies without standalone
  skill frontmatter, matching the single generated `flow-view` surface.
- Replaced generated artifact template frontmatter `feature: <feature-id>` with
  `run: <run-id>` while keeping legacy `feature` frontmatter accepted for
  existing artifacts during migration.

### Changed

- Renamed the generated stop hook from `stop-checkpoint` to `stop-handoff`
  to match the simplified session model. Old managed `stop-checkpoint`
  entries are still recognized during sync cleanup.
- Renamed the stop safety law id to `stop-clean-or-handoff`; existing
  configs using the old checkpoint id are still honored.
- Simplified session bootstrap and stop behavior around artifact handoff
  instead of separate checkpoint/context/suggestion state files.
- Centralized legacy cleanup lists in init/sync so removed surfaces are
  easier to audit without changing upgrade cleanup behavior.
- Renamed pre-compact semantic coverage from digest wording to compatibility
  wording and aligned harness/view docs with `npx cclaw-cli sync`.
- Compact stage skills now fold inputs and required context into the existing
  context-loading block, reducing repeated generated sections while preserving
  the process map, gates, evidence, and artifact validation.
- Downstream stage artifacts now include a lightweight `Upstream Handoff`
  section for carried decisions, constraints, open questions, and drift
  reasons, so agents do not silently rewrite earlier stage choices.
- Knowledge JSONL entries now use `origin_run` instead of feature wording for
  new writes and generated guidance, while older pre-cleanup rows remained
  readable as an input alias at the time of this release.
- Codex legacy skill cleanup now removes any old `cclaw-cc*` folder by prefix
  instead of carrying a hardcoded list of obsolete command names.
- The generated meta-skill, shared stage guidance, `/cc`, and harness shims
  now show the whole flow explicitly: critical-path stages finish with
  `retro -> compound -> archive` through `/cc`.
- TDD dispatch guidance now presents one mandatory `test-author` evidence cycle
  for RED/GREEN/REFACTOR instead of implying three default subagents.
- Stage guidance now starts with a compact drift preamble, treats seed recall as
  reference context by default, and makes brainstorm/scope use lightweight
  compact paths before deeper checklists.
- Design/spec/plan guidance now adopts prompt-level investigator/critic, shadow
  alternative, acceptance mapping, and exact verification-command discipline
  without adding new runtime machinery.
- Review guidance now defaults to one reviewer plus mandatory security-reviewer,
  with adversarial review as a risk-triggered pass instead of ceremony for every
  large-ish diff.
- Generated status/docs/idea guidance now avoids stale waiver and legacy-layout
  wording in the primary user surface.
- Prompt-surface tests now prefer durable behavioral anchors over exact generated
  prose where schema and validator tests already cover the contract.
- Decision Protocol / structured-ask fallback wording is now shared across
  scope/design/review/ship/idea to reduce drift between stage prompts.
- Scope/design outside-voice loop guidance now renders from compact policy helpers
  in `review-loop.ts` instead of repeated prose blocks.
- Post-ship closeout wording is now sourced from shared closeout guidance
  helpers so /cc and meta-skill stay aligned on retro/compound/archive.
- /cc-idea knowledge scan guidance now matches the live knowledge schema
  (`rule|pattern|lesson|compound`, `origin_run`, trigger/action clustering).
- Track-aware render context now drives quick-track wording transforms for TDD/lint metadata, replacing duplicated brittle string-rewrite chains.
- Hook runtime compound-readiness summary now uses a shared inline formatter helper, with added parity coverage to reduce drift against canonical CLI wording.

### Preserved

- `retro -> compound -> archive` remains part of ship closeout through
  `/cc`.
- `cclaw archive` still archives active runs into `.cclaw/archive/`.
- Stage skills still keep decision, completion, verification, and
  closeout discipline, but now inline the needed guidance instead of
  making users chase generated reference files.

## 0.49.0

Dead-weight cut, pass 1. `.cclaw/` was shipping four scaffolded
directories whose content no runtime code ever consumed, no user ever
edited, and no test depended on beyond "file exists". Each added noise
to `ls .cclaw`, `npx cclaw-cli sync`, and `cclaw sync` without moving any
flow decision. This release removes them.

### Removed

- `.cclaw/adapters/manifest.json` — the "harness adapter provenance"
  file was never read outside of the three sync gates that verified
  its own existence. Dropped the file, its three
  `state:adapter_manifest_*` gates, and the init preview line.
- `.cclaw/custom-skills/` — opt-in scaffold for user-authored skills
  with a ~150-line README and a placeholder `example/SKILL.md`. In
  practice users either never opened the folder or put skills under
  `.cclaw/skills/` anyway. No routing layer ever discovered
  `custom-skills/*.md`. Dropped the dir, the install helper, the
  two template strings, and the using-cclaw meta-skill paragraph
  advertising it.
- `.cclaw/worktrees/` **empty scaffold** — the git-worktree feature
  itself (feature-system, using-git-worktrees skill, state/worktrees.json)
  stays in place for now, but init no longer pre-creates an empty
  top-level folder. Full feature removal is out of scope for this
  release.
- `.cclaw/contexts/*.md` — the four static mode guides
  (`default.md`, `execution.md`, `review.md`, `incident.md`) are gone.
  Context mode switching is still a first-class feature (tracked via
  `state/context-mode.json`, surfaced by session hooks, described in
  the `context-engineering` skill), but the mode bodies now live
  inline in the skill rather than as separate files. Session hooks
  already gracefully degrade when `contexts/<mode>.md` is missing
  (`existsSync` check), so users see no behavioral change beyond
  four fewer files per install and four fewer `contexts:mode:*`
  gates in `sync`.

### Why

Each of these folders was individually defensible but collectively
turned a fresh `cclaw init` into a 167-file dump across 15
top-level directories. Comparing against the reference implementations
under `~/Projects/cclaw/docs/references/` (obra-superpowers ships
14 skills / 3 commands; addyosmani-skills ships 21 skills flat;
everyinc-compound ships ~25 files total), cclaw was an order of
magnitude heavier without being an order of magnitude more useful.
This pass removes ~305 LOC of installer code and four user-visible
folders without changing any runtime behavior. Subsequent releases
will apply the same lens to `.cclaw/references/`, `.cclaw/evals/`,
`.cclaw/commands/`, `.cclaw/state/`, and `.cclaw/skills/`.

## 0.48.35

Second pass on the OpenCode plugin guard-UX fix. 0.48.34 covered the
obvious cases (read-only bypass, graceful degradation, killswitch,
actionable error), but a real-world `/cc` session still hit three
remaining failure modes:

1. `strictness: advisory` in `.cclaw/config.yaml` was ignored by the
   plugin — guard non-zero exits still threw.
2. OpenCode's `question` / `AskUserQuestion` tool (and friends) were
   not on the safe-tool whitelist, so track-selection prompts were
   blocked mid-flow.
3. Hook-runtime infrastructure failures (unrelated CLI help in
   stderr, crashes, missing binaries) were surfaced to the user as
   policy blocks with the yargs help text showing up as the "Reason".

### Fixed

- Plugin now reads the same strictness knob as the hook runtime
  (`CCLAW_STRICTNESS` env → `strictness:` key in
  `.cclaw/config.yaml` → library default `advisory`). In advisory
  mode — which is the default — guard refusals are logged as
  `advisory:` lines in `.cclaw/logs/opencode-plugin.log` and the tool
  call proceeds. Only `strictness: strict` ever throws.
- Safe-tool whitelist now exempts question / ask / `AskUserQuestion`
  / `ask_user_question` / `request_user_input` / prompt, think /
  thinking, todo / `TodoRead` / `TodoWrite` (with `find` added
  alongside ls/list). These tools cannot mutate project state or
  execute arbitrary code, so running guards on them was overhead at
  best and a blocker at worst.
- Hook infrastructure failures are no longer treated as policy
  blocks. A non-zero hook exit whose stderr looks like yargs help
  (`Usage:` / `Options:` / `-- name  [string]` lines), a Node crash
  fingerprint (`Cannot find module`, `(Reference|Syntax|Type|Range)Error`,
  `at file:line:col`, `node:internal`), a "command not found" shell
  message, or empty output now logs an `infra:` line and lets the
  tool through regardless of strictness. Strict mode still blocks on
  cleanly-structured guard refusals.
- Strict-mode block error now also points at switching to
  `strictness: advisory` in `.cclaw/config.yaml` as a recovery path
  alongside `CCLAW_DISABLE=1`.

### Changed

- `tests/unit/hooks-lifecycle.test.ts` grows three coverage cases
  (advisory-default log-only path, extended whitelist bypass across 9
  tool-name variants, infra-noise bypass under strict config) and
  the existing strict-block test now emits a short refusal reason so
  it still exercises the thrown path after the infra-noise
  heuristic tightened.

## 0.48.34

OpenCode guard UX fix. A user hitting a freshly-installed cclaw project
in OpenCode previously saw every tool call — including innocuous
`read`/`glob`/`grep` — blocked by the cryptic error
`cclaw OpenCode guard blocked tool.execute.before (prompt/workflow
guard non-zero exit).`, with `console.error` stderr spam overlapping
the TUI render. The failure mode was the same whether the guards had
legitimately refused a mutation, the hook runtime was missing, the
script crashed, or cclaw wasn't initialized in the project at all.
This release reshapes the plugin so users can actually use OpenCode.

### Fixed

- Read-only tools (`read`, `glob`, `grep`, `list`, `view`, `webfetch`,
  `websearch`) now bypass the prompt/workflow guard chain — they
  cannot mutate state or execute arbitrary code, so the guard spawn
  was pure overhead and a single point of failure for the whole
  session.
- Projects without `.cclaw/state/flow-state.json` or
  `.cclaw/hooks/run-hook.mjs` are treated as "cclaw not initialized"
  and no longer block tool calls; a one-shot advisory is recorded in
  the plugin log instead of throwing.
- Hot-path `console.error` calls in `runHookScript` and the event
  dispatcher are replaced with file-based logging to
  `.cclaw/logs/opencode-plugin.log` — eliminates the overlapping-text
  TUI artifact that made failing sessions unreadable.
- Guard block errors now name the failing guard, include the last
  ~400 bytes of its stderr as `Reason`, and suggest
  `npx cclaw-cli sync` + `CCLAW_DISABLE=1` recovery moves, replacing the
  uniform unactionable block message.

### Added

- `CCLAW_DISABLE=1` env killswitch (also honoured via `CCLAW_GUARDS=off`
  and `CCLAW_STRICTNESS=off|disabled|none`) lets users bypass the
  plugin's guards when they are stuck, without editing the generated
  plugin file. The bypass is logged once to the plugin log.
- `.cclaw/logs/opencode-plugin.log` — timestamped append-only
  diagnostic log for plugin-side hook failures, timeouts, unknown
  events, and the advisory states above. Best-effort; never blocks a
  hook on I/O failure.

### Changed

- Prompt-guard and workflow-guard now run in parallel via
  `Promise.all` on each mutating `tool.execute.before`, halving the
  steady-state guard latency (bounded already by
  `MAX_CONCURRENT_HOOKS = 2`, so no queue change needed).
- Per-hook timeout reduced from 20 s to 5 s. Typical guard runtime is
  well under 500 ms, so 5 s keeps real hooks working while capping the
  worst-case stall at a number a user will still tolerate.
- `tests/unit/hooks-lifecycle.test.ts` gains four coverage cases
  (read-only bypass, uninitialized project, `CCLAW_DISABLE`
  killswitch, actionable error shape) alongside the existing
  non-zero-exit block test.

## 0.48.33

Stage-flow consolidation, cross-platform notes, and inline-hook locality
release. Addresses three flow-quality issues flagged in the user-flow
audit: overlapping parallel instruction lists inside stage skills,
accidental platform-agnostic-by-default stage guidance, and inline JS
bodies buried in the 2000-line `node-hooks.ts` template.

### Changed

- Stage SKILL.md `## Process` now renders a **mermaid flowchart TD**
  derived from `executionModel.process` (or from
  `executionModel.processFlow` when a stage defines a custom
  non-linear graph), replacing the previous dedupe'd top-5 flat list.
  `## Interaction Protocol` keeps its dedupe'd top-5 list but opens with
  an explicit preamble stating the section is *behavioral rules*, not an
  alternative sequence of steps.
- Added optional `StageExecutionModel.processFlow` (custom mermaid body)
  and `StageExecutionModel.platformNotes` (rendered under a new
  `## Platform Notes` section). Bumped the stage-skill line budget from
  350 to 400 to accommodate the mermaid state-machine diagram and
  platform-notes block.
- Filled `platformNotes` for all eight stages with concrete cross-OS
  guidance — path separators, shell quoting, CRLF/LF drift, PowerShell
  vs POSIX env-var syntax, UTC timestamps, and release-flow signing
  differences — so agent-generated instructions stay portable.
- Extracted the inline JS bodies (`computeCompoundReadinessInline`,
  `computeRalphLoopStatusInline`, and shared helpers) out of
  `src/content/node-hooks.ts` into a dedicated
  `src/content/hook-inline-snippets.ts` module. Each snippet carries an
  explicit "mirrors X, parity enforced by Y" header.
  `tests/unit/ralph-loop-parity.test.ts` keeps the parity contract
  intact; `run-hook.mjs` output is byte-identical.

### Fixed

- `spec` checklist now includes the "present acceptance criteria in
  3-5-item batches, pause for ACK" step that previously only lived in
  the `process` duplicate list and would have silently dropped out of
  the rendered skill after the mermaid rewrite.

## 0.48.32

Stage-audit implementation release (Phase 6 completion). This cut finalizes the
remaining opt-in upgrades with config-driven toggles, a reusable seed shelf, and
an optional second-opinion path for review loops.

### Changed

- Replaced env-based scope/design audit toggles with config-driven switches under
  `.cclaw/config.yaml::optInAudits` (`scopePreAudit`, `staleDiagramAudit`) and
  updated lint/runtime tests accordingly.
- Added seed shelf support via `src/content/seed-shelf.ts` with collision-safe
  `SEED-YYYY-MM-DD-<slug>.md` naming, `trigger_when` matching, and seed-template
  rendering for deferred high-upside ideas.
- Extended `/cc` startup protocol with a dedicated seed-recall step so matching
  seeds are surfaced before routing when prompt triggers align.
- Added “plant as seed” guidance + template sections across idea, brainstorm,
  scope, and design artifacts to preserve promising non-selected directions.
- Extended review-loop internals with `createSecondOpinionDispatcher` and merged
  second-opinion scoring/findings behind
  `.cclaw/config.yaml::reviewLoop.externalSecondOpinion.*`.
- Added config schema/docs/tests for `reviewLoop.externalSecondOpinion` (`enabled`,
  `model`, `scoreDeltaThreshold`) and disagreement surfacing when score deltas
  exceed the configured threshold.

## 0.48.31

Phase-0 renderer migration to grouped v2 stage views. This cut switches stage
skill generation to a group-first layout and trims repetitive sections to keep
skill bodies concise.

### Changed

- Updated `stageSkillMarkdown` rendering to consume grouped metadata directly in
  fixed order: `philosophy` -> `executionModel` -> `artifactRules` ->
  `reviewLens`.
- Added explicit `## Complexity Tier` output in stage skills so active tier and
  tier-scoped mandatory delegations are visible at runtime.
- Moved `HARD-GATE` and anti-pattern rendering into the Philosophy block and
  moved outputs/review sections under Review Lens to match v2 schema semantics.
- Removed always-inline Good/Bad and Domain example blocks from stage skills
  while retaining the concise examples pointer section, reducing generated skill
  line counts across all stages while preserving stage instructions.
- Updated flow contract snapshots to match the new stage skill layout.

## 0.48.30

Phase-0 v2 schema migration completion for downstream stages. This cut ports the
remaining legacy stage literals (`spec`, `plan`, `tdd`, `review`, `ship`) to
the grouped `schemaShape: "v2"` format without changing runtime contracts.

### Changed

- Migrated `spec`, `plan`, `tdd`, `review`, and `ship` stage definitions to v2
  grouped sections (`philosophy`, `executionModel`, `artifactRules`,
  `reviewLens`) and added explicit `complexityTier: "standard"` defaults.
- Kept stage behavior/contracts stable by preserving existing content and gate
  metadata while moving fields into grouped sections only.
- Updated TDD quick-track variant generation to transform nested v2 fields
  (checklists, required gates/evidence, traceability, and review sections)
  instead of legacy top-level keys.

## 0.48.29

Phase-0 artifact slug rollout for brainstorm/scope/design. This cut introduces
runtime-aware artifact path resolution with legacy fallback and updates stage
contracts to use slugged artifact patterns.

### Changed

- Added `resolveArtifactPath(stage, context)` in `src/artifact-paths.ts` with:
  topic slugification, collision-safe write naming (`-2`, `-3`, ...), and
  read-time fallback to legacy file names during migration.
- Updated runtime artifact readers (`artifact-linter`, `gate-evidence`,
  `internal/advance-stage`) to resolve stage artifacts via the shared helper
  instead of fixed file names.
- Switched audited stage artifact targets to slug patterns:
  `01-brainstorm-<slug>.md`, `02-scope-<slug>.md`, `03-design-<slug>.md`, and
  propagated the new upstream references to downstream stage traces.
- Replaced strict path-to-stage mapping in `stage-schema` with numeric-prefix
  inference so cross-stage filtering keeps working with slugged file names.
- Added resolver coverage tests (slugification, legacy fallback, collision
  handling) plus integration coverage proving plan lint reads the active
  slugged scope artifact when legacy + new files coexist.

## 0.48.28

Phase-0 schema consolidation follow-up. This cut migrates stage policy anchors
to a lint-metadata sidecar and starts v2 literal adoption in audited stages.

### Changed

- Moved `policyNeedles` out of stage literals and runtime schema fields into a
  dedicated sidecar module at `src/content/stages/_lint-metadata/index.ts`.
- Updated stage command-contract rendering to source anchors from
  `stagePolicyNeedles(...)` backed by lint metadata, preserving command output
  while decoupling policy anchors from runtime stage objects.
- Migrated `brainstorm`, `scope`, and `design` stage literals to
  `schemaShape: "v2"` grouped inputs (`philosophy`, `executionModel`,
  `artifactRules`, `reviewLens`) with normalization in `stageSchema(...)`.
- Updated schema types and tests to support mixed legacy/v2 stage inputs and
  verify policy-needle track transforms through the new metadata source.

## 0.48.27

Phase-0 schema consolidation slice. This release introduces a v2 stage-schema
surface with grouped metadata views and tier-aware mandatory delegation policy.

### Changed

- Added `schemaShape: "v2"` metadata to stage schemas, plus grouped views for
  philosophy, execution model, artifact rules, and review lens fields while
  retaining backward-compatible top-level properties.
- Added first-class `complexityTier` support on `StageSchema` with explicit
  defaults for audited stages (`brainstorm`, `scope`, `design`) and a standard
  fallback for stages that have not opted in yet.
- Added `requiredAtTier` to mandatory auto-subagent policies and updated
  delegation resolution so mandatory requirements can be gated by complexity
  tier without weakening current standard/deep paths.
- Expanded `stage-schema` tests to verify v2 parity, complexity-tier fallback,
  and tier-gated mandatory delegation behavior.

## 0.48.26

Stage-audit implementation release. This cut upgrades the upstream shaping
surface (`/cc-idea`, brainstorm, scope, design) with stronger divergence,
adversarial review loops, and richer design-review coverage.

### Changed

- `/cc-idea` now runs explicit mode classification, frame-based divergent
  ideation, adversarial critique, and survivor-only ranking before handoff.
- Brainstorm stage now supports depth tiering, a concrete-requirements
  short-circuit, and a strict propose -> react -> recommend flow with a
  mandatory higher-upside challenger option.
- Scope stage now includes a pre-scope system audit, optional landscape/taste
  calibration, and a bounded outside-voice review loop with quality-score
  tracking.
- Design stage now emphasizes Security/Threat, Observability, and
  Deployment/Rollout lenses; adds Standard+ shadow/error-flow diagram
  expectations; and tightens failure-mode guidance around rescue visibility.
- Design artifact template (`03-design.md`) now matches the upgraded design
  process with sections for shadow/error flow, threat modeling, observability,
  and rollout planning.

## 0.48.24

Roll-up of the lock-aware knowledge read + diagnostics (PR #131)
and the `reference:*` sync severity demotion (PR #132). Both
landed on `main` under `0.48.23` but needed a version bump to
reach npm.


### Changed

- Sync/runtime severity for `reference:*` checks (currently the
  `flow-map.md` section anchors, including
  `reference:flow_map:compound_readiness`) is demoted from
  `error` to `warning`. These docs document the surface rather
  than gate it; a missing section means the generated overview
  is out of date, not that a runtime contract is broken. The
  remediation hint still points at `cclaw sync`, so CI surfaces
  drift without hard-failing.

### Fixed

- SessionStart now reads `knowledge.jsonl` while holding the
  **same** mutex CLI writers use in `appendKnowledge`
  (`.cclaw/state/.knowledge.lock`). Closes a latent race where a
  concurrent `/cc-ops knowledge` append could produce a partial
  snapshot visible to the digest / compound-readiness computations.
- SessionStart's ralph-loop and compound-readiness error handlers
  no longer silently swallow exceptions — failures are now recorded
  as breadcrumbs in `.cclaw/state/hook-errors.jsonl` (still
  soft-fail so hooks never block on a malformed derived state, but
  `npx cclaw-cli sync` can now surface chronic failures).
- Directory locks (`withDirectoryLock` / the hook-inline variant)
  now fail fast with a clear "Lock path exists but is not a
  directory" error when the configured lock path is occupied by
  a non-directory instead of burning the entire retry budget.
  This stabilizes the session-start breadcrumb test on Windows,
  where `fs.mkdir(path)` against a file returns `EEXIST` (same
  as a held lock) and the old code could loop for seconds before
  giving up.

- Compound-readiness is now computed consistently across CLI and
  runtime. Previously `cclaw internal compound-readiness` honored
  `config.compound.recurrenceThreshold` while the SessionStart hook
  hard-coded `threshold = 3`, so the two paths could report different
  `readyCount` values on the same knowledge file. The hook now
  inherits the configured threshold at install time
  (`nodeHookRuntimeScript({ compoundRecurrenceThreshold })`), and both
  paths also apply the documented **small-project relaxation**
  (`<5` archived runs → effective threshold = `min(base, 2)`) that
  had previously existed only in the `/cc-ops compound` skill
  instructions. The derived status now includes `baseThreshold`,
  `archivedRunsCount`, and `smallProjectRelaxationApplied` so
  consumers can tell which rule fired. Schema bumped to `2`.
- `cclaw internal compound-readiness --threshold` now rejects
  non-integer values (`2abc`, `2.9`, `""`, negative) with a loud
  error instead of silently truncating via `parseInt`.
- `runCompoundReadinessCommand` now surfaces a stderr warning when
  `readConfig` fails instead of swallowing the error. The command
  also reads knowledge lock-aware by default so an in-flight
  `appendKnowledge` cannot produce a partial snapshot.
- SessionStart reads `knowledge.jsonl` exactly once per invocation
  and shares the raw content between the digest and the
  compound-readiness recomputation, eliminating the redundant
  second read on large knowledge logs.
- `lastUpdatedAt` in `compound-readiness.json` is now normalized
  identically in canonical and inline paths (milliseconds stripped),
  removing spurious diff noise.
- Parity tests (`tests/unit/ralph-loop-parity.test.ts`) extended to
  cover the new schema fields and the small-project relaxation.
- Atomic write on Windows: `fs.rename` sometimes fails transiently with
  `EPERM`/`EBUSY`/`EACCES` when the target file is briefly held open by
  antivirus, indexer, or a sibling hook process. Both the CLI-side
  `writeFileSafe` (`src/fs-utils.ts`) and the inline hook
  `writeFileAtomic` (`src/content/node-hooks.ts`) now retry up to 6
  times with ~10–70ms backoff before falling back to a non-atomic
  copy+unlink (still safe because callers hold a directory lock).
  Closes the Windows CI regression surfaced by
  `tests/unit/hook-atomic-writes.test.ts`.
- `parseTddCycleLog` now accepts an `issues` sink and a `strict` flag.
  In strict mode (used by `cclaw internal tdd-red-evidence` and
  validation paths), rows missing `runId`, `stage`, or `slice` are
  rejected instead of silently back-filling `runId=active,
  stage=tdd, slice=S-unknown`, which used to glue unrelated lines
  into the current run. Soft mode keeps the legacy defaults but
  can now surface per-line reasons (JSON parse failure, invalid
  phase, missing fields) via the issues array.
- `cclaw internal tdd-red-evidence` now requires a scoped `runId`.
  If neither `--runId` nor `flowState.activeRunId` is available,
  the command fails loud with a clear error instead of silently
  matching across all historical runs. Closes a false-positive
  path where a past failing RED for the same file could satisfy
  the guard on the current run.
- Unified TDD path-matcher across the CLI (`tdd-red-evidence`),
  the library (`src/tdd-cycle.ts`), and the runtime hook
  (`node-hooks.ts`). A new `normalizeTddPath` + `pathMatchesTarget`
  pair lives in `tdd-cycle.ts`; the inline hook mirrors the same
  rules and now matches `endsWith('/'+target)` instead of strict
  equality. Fixes a blind spot where the hook silently failed to
  find matching RED evidence when the recorded file path carried
  a repo-root prefix.
- Slice-aware workflow guard: when a TDD production write has no
  explicit path info, the fallback now consults the canonical
  Ralph Loop status (`computeRalphLoopStatusInline`) and blocks
  unless at least one slice has an OPEN RED. Previously a flat
  red/green tally could unlock writes for a new slice just because
  an older slice had balanced out.
- Single Ralph Loop contract inside `/cc progression contract surfaces`. The
  command contract and the skill document previously carried two
  different paragraphs — one called Ralph Loop a "soft nudge, not a
  gate", the other said "Advance only when every planned slice is in
  `acClosed` and `redOpenSlices` is empty" (hard-gating language). Both
  sections now render the SAME canonical snippet
  (`ralphLoopContractSnippet()` / `RALPH_LOOP_CONTRACT_MARKER`) stating
  the resolved policy: Ralph Loop is a progress indicator + soft
  pre-advance nudge; hard gate enforcement flows through
  `flow-state.json` gates via `stage-complete.mjs`. A new
  behavior-backed parity test in
  `next-command parity regression tests` asserts the
  canonical paragraph appears byte-identical in both places, that no
  hard-gating wording is used against ralph-loop fields, and that the
  legacy wording is gone.
- Runtime hooks (`run-hook.mjs`) now write JSON state atomically (temp
  file + rename, with EXDEV fallback) and serialize concurrent writes
  to the same file via per-file directory locks. This closes a class
  of torn-write and interleaved-JSONL races that could leave
  `ralph-loop.json`, `compound-readiness.json`, `checkpoint.json`,
  and `stage-activity.jsonl` in partial states under parallel session
  events.
- `readFlowState()` in the hook runtime now records a breadcrumb to
  `.cclaw/state/hook-errors.jsonl` when `flow-state.json` exists but
  fails JSON.parse, instead of silently falling back to `{}`. Makes
  latent CLI↔hook drift surfaceable via `npx cclaw-cli sync`.
- `archiveRun()` now holds both the archive lock and the flow-state
  lock for the entire archive window. Internal `writeFlowState`
  calls pass `skipLock: true` so no nested-lock deadlock occurs. This
  eliminates lost-update races where a concurrent stage mutation
  between archive snapshot and reset would be silently clobbered.

### Added

- Hook manifest as single source of truth (`src/content/hook-manifest.ts`).
  The per-harness JSON documents (`.claude/hooks/hooks.json`,
  `.cursor/hooks.json`, `.codex/hooks.json`) and the semantic coverage
  table in `hook-events.ts` are now derived from one declarative manifest.
  New diagnostic: `cclaw internal hook-manifest [--harness <id>] [--json]`.
- Parity tests (`tests/unit/ralph-loop-parity.test.ts`) that seed a
  fixed TDD-cycle log / knowledge file and assert the inline
  implementations in the generated `run-hook.mjs` produce the same
  `ralph-loop.json` / `compound-readiness.json` as the canonical
  `computeRalphLoopStatus` and `computeCompoundReadiness` in core.
- Path-aware TDD guard routing via `tdd.testPathPatterns` and
  `tdd.productionPathPatterns`, including strict-mode blocking with the
  explicit message "Write a failing test first" when production edits happen
  before RED.
- Compound recurrence tuning via `compound.recurrenceThreshold` with
  small-project threshold relaxation (`<5` archived runs) and a
  `severity: critical` single-hit promotion override.
- Design-stage example snippet for the parallel research fleet workflow in
  `src/content/examples.ts`.

### Changed

- Compound command/skill contracts now document qualification source
  (`recurrence` vs `critical_override`) for every promoted cluster.
