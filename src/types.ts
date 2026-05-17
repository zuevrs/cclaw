/**
 * `critic` stage inserted between `review` and `ship`. The critic
 * runs at Hop 4.5 (after the reviewer returns `clear`/`warn`, before the
 * ship gate begins) and writes `critic.md`. The stage value is gated by
 * `ceremonyMode`: `inline` skips critic entirely; `soft` runs critic in
 * `gap` mode; `strict` runs the full critic protocol with adversarial
 * escalation per the trigger set in `.cclaw/lib/agents/critic.md`.
 *
 * Legacy migration: pre-v8.42 state files where `currentStage == "review"`
 * AND `lastSpecialist == "reviewer"` AND no `criticVerdict` field is set
 * are auto-treated as legacy-pre-critic on the next `/cc` — the
 * orchestrator dispatches critic before advancing to ship. See
 * `src/flow-state.ts` for the migration shape.
 */
/**
 * Canonical ordered set of stage tokens the orchestrator may emit in
 * `triage.path` and {@link FlowState.currentStage}. The order also defines
 * the canonical run sequence (each stage's `currentStage` mark is
 * legal only after every prior stage's preconditions are met).
 *
 * adds `"qa"` between `build` and `review`. It is the only stage
 * the orchestrator dispatches conditionally: only when
 * `triage.surfaces` includes `"ui"` or `"web"` AND `ceremonyMode != "inline"`.
 * Non-UI slugs skip directly from `build` to `review`, preserving the
 * pre-v8.52 path verbatim.
 */
export const FLOW_STAGES = ["plan", "build", "qa", "review", "critic", "ship"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

export const HARNESS_IDS = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * v8.62: `design` (the v8.14 multi-turn brainstormer) and `ac-author`
 * (the v8.28 plan author) collapsed into a single `architect` specialist
 * that runs as an **on-demand** sub-agent (no mid-plan user dialogue —
 * v8.61 always-auto removed every picker). The `plan` stage's
 * discovery surface is now just `architect`; there is no `design then
 * ac-author` chain. The reason for collapsing: v8.61 already deleted
 * `design`'s sign-off picker (Phase 7) and clarify dialogue (Phase 1);
 * a "main-context coordinator" specialist that never asks the user
 * questions is structurally the same as an "on-demand sub-agent" — the
 * split was carrying no weight. The `mode: "research"` envelope flag
 * still routes a standalone non-AC dispatch through the same architect
 * (writes `research.md` instead of `plan.md`).
 *
 * Pre-v8.62 state files with `lastSpecialist == "design"` or
 * `lastSpecialist == "ac-author"` are handled permissively by
 * `flow-state.ts` validators (string field, no hard migration) — the
 * orchestrator simply re-dispatches architect on the next `/cc`.
 */
export const DISCOVERY_SPECIALISTS = ["architect"] as const;
export type DiscoverySpecialistId = (typeof DISCOVERY_SPECIALISTS)[number];

/**
 * v8.62: specialist count drops 9 → 7. Removed: `design` (absorbed into
 * `architect`) and `security-reviewer` (absorbed into `reviewer`'s
 * `security` axis). Renamed: `ac-author` → `architect`; `slice-builder`
 * → `builder`. Surviving roster: `triage`, `architect`, `builder`,
 * `plan-critic`, `qa-runner`, `reviewer`, `critic`. The order in this
 * array traces the canonical pipeline (triage → plan → build → qa →
 * review → critic → ship).
 *
 * v8.75: specialist count grows 7 → 8 with the addition of `plan-design`,
 * a pre-implementation design-coherence pass that walks plan.md against
 * the seven-dimension design-quality rubric (the same rubric the v8.70
 * reviewer applies post-build; lifted into a shared const at
 * `src/content/design-quality-rubric.ts` so both surfaces stay in
 * lock-step). plan-design runs after plan-critic (or directly after
 * architect when plan-critic's strict gate is off) and ONLY when the
 * orchestrator detects a UI / design / frontend / UX surface in
 * ceremonyMode ∈ {soft, strict}. plan-design appends `PD-N` findings to
 * plan.md's `## Plan-design findings` section; below-6 grades become
 * findings; severity ≥ medium blocks ship in strict mode.
 *
 * Background on the joiners that remain:
 * - `critic` (v8.42) is an on-demand sub-agent that runs at the critic
 *   stage between `review` and `ship`. It walks what was built (gap
 *   analysis + adversarial lenses).
 * - `plan-critic` (separate from `critic`) is a pre-implementation
 *   adversarial pass that runs at the plan stage on the tight gate
 *   {ceremonyMode=strict, complexity=large-risky, problemType!=refines,
 *   AC count>=2}. It walks the plan itself (goal coverage / granularity
 *   / dependencies / parallelism / risk catalog) before any code is
 *   written and writes `flows/<slug>/plan-critic.md`.
 * - `plan-design` (v8.75) is a pre-implementation design-coherence pass
 *   that runs at the plan stage when triage detects a design surface
 *   and ceremonyMode is not inline. Walks plan.md against the
 *   seven-dimension rubric shared with the reviewer's `design-quality`
 *   axis; below-6 grades become `PD-N` findings appended to plan.md.
 */
export const SPECIALISTS = [
  "triage",
  "architect",
  "builder",
  "plan-critic",
  "plan-design",
  "qa-runner",
  "reviewer",
  "critic"
] as const;
export type SpecialistId = (typeof SPECIALISTS)[number];

/**
 * Pre-v8.62 specialist ids that no longer exist. Kept as a type-level
 * reminder for permissive validators that accept old `lastSpecialist`
 * strings on read without migrating. Do not add new entries.
 *
 * - `design` / `ac-author`: absorbed into {@link DISCOVERY_SPECIALISTS}'s
 *   `architect` (v8.62).
 * - `slice-builder`: renamed to `builder` (v8.62; AC-as-unit-of-work
 *   semantics unchanged).
 * - `security-reviewer`: absorbed into `reviewer`'s `security` axis
 *   (v8.62; full threat-model + sensitive-change protocol moved to
 *   the reviewer prompt).
 * - `brainstormer`: removed v8.14, kept here for the same back-compat
 *   reason.
 */
export const LEGACY_SPECIALIST_IDS = [
  "design",
  "ac-author",
  "slice-builder",
  "security-reviewer",
  "brainstormer"
] as const;
export type LegacySpecialistId = (typeof LEGACY_SPECIALIST_IDS)[number];

/**
 * @deprecated v8.62 — use {@link LEGACY_SPECIALIST_IDS}. Kept as a
 * re-export so pre-v8.62 import sites continue to type-check.
 *
 * Note: the second entry historically named the v8.14 retired
 * "architect" id, which is a NAME COLLISION with the v8.62 current
 * `architect` specialist (different concept). New code MUST NOT use
 * this constant; consult {@link LEGACY_SPECIALIST_IDS} instead, which
 * names the post-v8.62 retired ids (`design`, `ac-author`, `slice-builder`,
 * `security-reviewer`, `brainstormer`) and leaves the current
 * `architect` out of the legacy list.
 */
export const LEGACY_DISCOVERY_SPECIALISTS = ["brainstormer"] as const;
export type LegacyDiscoverySpecialistId = (typeof LEGACY_DISCOVERY_SPECIALISTS)[number];

/**
 * v8.28: `planner` specialist renamed to `ac-author`. v8.62: `ac-author`
 * renamed to `architect` (absorbing `design`'s Phase 0/2-6 work).
 * The original `"planner"` token is kept here as a canonical legacy id
 * for permissive validators that may still encounter it in very old
 * `flow-state.json` files.
 *
 * Permissive read path: `lastSpecialist` is a string field; the
 * validator does not enforce membership in `SPECIALISTS`, so old values
 * (`planner`, `ac-author`, `design`, `slice-builder`, `security-reviewer`)
 * round-trip on read without rewrites. The orchestrator re-dispatches
 * the current specialist set on the next `/cc`.
 *
 * Shipped flow artifacts under `flows/shipped/<slug>/` keep their
 * historical text untouched.
 */
export const LEGACY_PLANNER_ID = "planner" as const;
export type LegacyPlannerId = typeof LEGACY_PLANNER_ID;

/**
 * Lightweight read-only research helpers, dispatched by the `architect`
 * (mostly during Frame / Decisions / Pre-mortem on strict mode) BEFORE
 * the architect writes its artifact. They exist to gather context
 * (live repo signals; prior cclaw lessons) so the architect does not
 * have to crawl the codebase or knowledge log itself.
 *
 * Research helpers are not in {@link SpecialistId} on purpose:
 *
 * - they never become \`lastSpecialist\` (no checkpoint between them);
 * - they are not a stage in any \`triage.path\`;
 * - they cannot be dispatched by the orchestrator directly — only by a
 *   specialist who needs their output.
 */
export const RESEARCH_AGENT_IDS = ["repo-research", "learnings-research"] as const;
export type ResearchAgentId = (typeof RESEARCH_AGENT_IDS)[number];

/**
 * Research-only sub-agents dispatched by the research orchestrator
 * (the main-context flow that powers `/cc research <topic>`). The lenses
 * run in parallel after the open-ended discovery dialogue completes; each
 * one returns a structured per-lens findings block that the orchestrator
 * folds into the final `research.md`.
 *
 * Lenses are **NOT** in {@link SPECIALISTS} on purpose:
 *
 * - they never become `lastSpecialist` (no checkpoint between them — the
 *   orchestrator either waits for ALL five to return or proceeds with
 *   partial findings on timeout);
 * - they are not a stage in any `triage.path` (research mode bypasses
 *   triage entirely; the orchestrator stamps sentinel values);
 * - they cannot be dispatched by any of the seven flow specialists —
 *   only by the research orchestrator in the main-context research
 *   slice.
 *
 * Each lens has its own contract file under
 * `.cclaw/lib/research-lenses/<lens-id>.md`. Lenses are independent: no
 * lens cites another lens, no lens chains into another lens. The
 * orchestrator owns the cross-lens synthesis pass that writes the final
 * `## Synthesis` section of `research.md`.
 *
 * The six lenses cover the orthogonal dimensions reference projects
 * (gstack `plan-*-review` quintet; obra-superpowers brainstorming →
 * subagent-driven-development chain; compound continuous-notebook +
 * adversarial-reviewer; everyinc-compound `ce-design-lens-reviewer`)
 * settled on:
 *
 * - `research-engineer` — technical feasibility, stack fit,
 *   implementation paths, rough effort.
 * - `research-product` — user value, who benefits, alternatives,
 *   market context.
 * - `research-architecture` — fit with existing system, surface area,
 *   coupling, scalability.
 * - `research-history` — prior attempts via `.cclaw/knowledge.jsonl` +
 *   git log; lessons learned + outcome signals.
 * - `research-skeptic` — adversarial pass: failure modes, edge cases,
 *   abuse cases, hidden costs.
 * - `research-design` (v8.76) — UI / UX / positioning / affordances
 *   lens for topics that touch design surfaces. Walks the same
 *   seven-dimension design-quality rubric (shared with the v8.75
 *   plan-design specialist and the v8.70 reviewer's design-quality
 *   axis) at the research framing stage — surfaces dimensions
 *   implicated, existing patterns to study, anti-patterns to avoid
 *   (including canonical AI-slop signals), and open design questions.
 *   Dispatched on `standard+` depth when the topic signals UI / UX /
 *   design / frontend / positioning / affordances; force-toggleable
 *   via `/cc research --lens=design` / `--lens=-design`.
 *
 * Each lens may dispatch the existing `repo-research` helper for
 * codebase-specific context (engineer + architecture lenses do so by
 * default on brownfield projects); web search via MCP is optional
 * for engineer / product / architecture / skeptic / design lenses
 * (design lens is first-class on web search). The history lens is
 * memory-only (reads `.cclaw/knowledge.jsonl` directly).
 */
export const RESEARCH_LENSES = [
  "research-engineer",
  "research-product",
  "research-architecture",
  "research-history",
  "research-skeptic",
  "research-design"
] as const;
export type ResearchLensId = (typeof RESEARCH_LENSES)[number];

export type InstallableAgentId = SpecialistId | ResearchAgentId | ResearchLensId;

/**
 * verdict the critic returns in its slim summary. Drives Hop 4.5
 * routing: `pass` → continue to Hop 5 ship; `iterate` → continue to
 * ship with the iterate-severity gaps carried over to `ship.md > Risks
 * carried over`; `block-ship` → orchestrator pauses and surfaces the
 * block-ship picker (`fix and re-review` / `accept-and-ship`).
 */
export type CriticVerdict = "pass" | "iterate" | "block-ship";

/**
 * escalation level stamped in `critic.md > frontmatter >
 * escalation_level`. `none` = pure gap mode; `light` = one adversarial
 * technique enabled (soft mode with exactly one trigger firing);
 * `full` = all four adversarial techniques plus the §5 devil's-advocate
 * sweep (strict mode with any trigger firing).
 */
export type CriticEscalation = "none" | "light" | "full";

/**
 * Status the builder specialist emits at every slice boundary (strict
 * mode) and at end-of-feature (soft mode). Drives the orchestrator's
 * always-auto chain decision when the builder slim summary returns —
 * each status has a deterministic handler in
 * `.cclaw/lib/runbooks/always-auto-failure-handling.md`:
 *
 * - `DONE` — proceed to the next slice (strict) or to qa/review (soft).
 *   The slice cleared both spec-compliance and code-quality reviews
 *   (strict mode per-slice gates) with no open concerns. This is the
 *   common path; no orchestrator surface action.
 * - `DONE_WITH_CONCERNS` — work completed but the builder flagged
 *   forward-looking risks the reviewer should see. Orchestrator appends
 *   the concerns to `build.md > ## Concerns` and proceeds; the reviewer
 *   reads the section as additional finding seeds.
 * - `NEEDS_CONTEXT` — the builder cannot proceed without information
 *   that wasn't in the dispatch envelope (missing file, unclear
 *   requirement, unknown convention). Orchestrator stops, surfaces the
 *   specific context need verbatim to the user, and awaits `/cc`
 *   continue (with the new context provided in the next prompt) or
 *   `/cc-cancel`.
 * - `BLOCKED` — the builder hit an unresolvable obstacle (per-slice
 *   review failed twice, posture mismatch, dependency missing,
 *   architectural concern). Orchestrator stops, surfaces the blocker
 *   plus the builder's recommended resolution (provide more context /
 *   break the slice smaller / escalate to architect), and awaits `/cc`
 *   continue or `/cc-cancel`.
 *
 * The slim summary's `Notes:` line carries the human-readable detail
 * for `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`; orchestrator
 * surfaces it verbatim in the stop-and-report status block.
 *
 * Pre-v8.68 builder slim summaries lack the status line — back-compat
 * readers default to `DONE` on absent (matches the existing always-auto
 * chain behaviour).
 */
export const BUILDER_STATUSES = [
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED"
] as const;
export type BuilderStatus = (typeof BUILDER_STATUSES)[number];

/**
 * verdict the qa-runner specialist returns in its slim summary.
 * Drives the qa stage routing (between `build` and `review` on the tight
 * gate {triage.surfaces includes "ui" or "web" AND ceremonyMode != "inline"}):
 *
 * - `pass` — every UI AC has evidence (Playwright test result / browser
 *   MCP screenshot / manual-steps confirmation); proceed to review.
 * - `iterate` — at least one UI AC failed verification; bounce back to
 *   builder with qa findings as additional context, max 1 iteration
 *   enforced by `qaIteration` (cap=1).
 * - `blocked` — browser tooling unavailable AND manual steps required;
 *   surface user picker (`proceed-without-qa-evidence` /
 *   `pause-for-manual-qa` / `skip-qa`). Distinct from `iterate`: blocked
 *   means qa could not run at all, not that it ran and failed.
 *
 * Distinct from {@link CriticVerdict} and {@link PlanCriticVerdict}: qa
 * runs at a different stage (between build + review), against UI
 * surfaces only, with its own evidence-tier rubric.
 */
export type QaVerdict = "pass" | "iterate" | "blocked";

/**
 * evidence tier captured by the qa-runner in `qa.md` frontmatter
 * and mirrored to `flow-state.json > qaEvidenceTier`. Records which
 * verification path the specialist took for the bulk of the UI ACs:
 *
 * - `playwright` — committed Playwright test that runs in CI;
 *   machine-verifiable evidence. Preferred when the project already
 *   ships Playwright or an equivalent e2e harness.
 * - `browser-mcp` — exploratory verification via a browser MCP
 *   (cursor-ide-browser, chrome-devtools, browser-use, etc.) with
 *   captured screenshots / observations. Reviewable but not re-runnable
 *   in CI without rerunning the MCP session.
 * - `manual` — last resort. qa-runner emits a `## Manual QA steps`
 *   block in qa.md and asks the user to confirm. The verdict is
 *   `blocked` until the user confirms.
 *
 * Drives the reviewer's `qa-evidence` axis cross-check: for any
 * AC with surface in {`ui`, `web`}, the reviewer expects `qa.md` with a
 * matching evidence row.
 */
export type QaEvidenceTier = "playwright" | "browser-mcp" | "manual";

/**
 * runtime surfaces a task may touch. Populated by the
 * orchestrator at triage (Hop 2) from the task description and the
 * touched-files signal, stamped under `triage.surfaces`. Drives the
 * qa-runner gate (qa-runner dispatches only when `surfaces`
 * includes `"ui"` or `"web"` AND `ceremonyMode != "inline"`).
 *
 * Multiple values per slug are expected — a /cc that builds an HTTP
 * endpoint + a Vue component touches both `"api"` and `"ui"`. The
 * orchestrator emits the union of detected surfaces, not a single
 * primary classification.
 *
 * Backwards compat: when `surfaces` is absent or empty, the
 * orchestrator treats the slug as `["other"]` (the no-QA-gating fallback);
 * pre-v8.52 flow-state files validate unchanged.
 *
 * Surface vocabulary:
 *
 * - `cli` — command-line tool / bin scripts.
 * - `library` — published code consumed by other code (npm package
 *   internals, exported modules, SDK surface).
 * - `api` — HTTP / RPC / GraphQL endpoint touched (request/response
 *   shape, route handler, middleware).
 * - `ui` — visual UI surface (React/Vue/Svelte component, HTML/CSS
 *   diff, page rendering). Gates qa-runner dispatch in non-inline mode.
 * - `web` — alias for `ui` when the diff is web-specific (kept as a
 *   separate token because some authoring contexts emit "web" verbatim
 *   from the prompt; the qa-runner gate treats both as equivalent).
 * - `data` — persistence / migration / schema surface (SQL, ORM
 *   models, fixtures).
 * - `infra` — deployment / CI / runtime config (Dockerfile, GitHub
 *   Actions, Terraform).
 * - `docs` — markdown / docs-only diff with no runtime behaviour
 *   change.
 * - `other` — fallback when no canonical surface fits, and the
 *   default value the validator applies when the field is absent.
 */
export const SURFACES = [
  "cli",
  "library",
  "api",
  "ui",
  "web",
  "data",
  "infra",
  "docs",
  "other"
] as const;
export type Surface = (typeof SURFACES)[number];

/**
 * verdict the pre-implementation plan-critic returns in its
 * slim summary. Drives the plan-critic step routing (between
 * `architect` and `builder` on the tight gate {ceremonyMode=strict,
 * complexity=large-risky, problemType!=refines, AC count>=2}):
 *
 * - `pass` — advance to builder dispatch (no ceremony).
 * - `revise` (iteration 0) — bounce to architect with plan-critic
 *   findings prepended; architect updates plan.md and the orchestrator
 *   re-dispatches plan-critic (iteration 1).
 * - `revise` (iteration 1) — orchestrator surfaces the user picker
 *   (cancel / accept-warnings-and-proceed / re-architect); no third
 *   plan-critic dispatch is allowed (1 revise loop max).
 * - `cancel` (any iteration) — structural plan problem (goal-coverage
 *   gap requiring re-author, dependency cycle that can't be untangled);
 *   orchestrator surfaces the cancel picker (cancel-slug / re-architect)
 *   immediately, no silent fallback.
 *
 * Distinct from {@link CriticVerdict} on purpose: the post-impl critic
 * has a `block-ship` verdict (build/review already ran); plan-critic
 * has `cancel` (build hasn't run yet so "block-ship" would be a
 * category error). Both enums coexist; readers branch on which
 * specialist is in flight, not on a merged verdict shape.
 */
export type PlanCriticVerdict = "pass" | "revise" | "cancel";

/**
 * verdict the v8.75 pre-implementation plan-design specialist returns in
 * its slim summary. Drives the plan-design step routing (between
 * `plan-critic` (when its strict gate fires) or `architect` (when
 * plan-critic is skipped) and `builder` on the design-surface gate
 * {triage.designSurface == true OR triage.surfaces ∩ {ui, design,
 * frontend, ux} ≠ ∅; ceremonyMode ∈ {soft, strict}}):
 *
 * - `pass` — zero open `medium` / `high` PD-N rows; advance to builder
 *   dispatch (no ceremony).
 * - `revise` (iteration 0) — at least one `medium` row open AND zero
 *   `high` rows; bounce to architect with the open PD-N rows prepended
 *   to the dispatch envelope, then re-dispatch plan-design (iteration
 *   1). Max 1 revise loop.
 * - `revise` (iteration 1) — second revise; orchestrator surfaces the
 *   stop-and-report status block (no third dispatch).
 * - `block` (any iteration) — at least one `high` row OR (strict mode)
 *   at least one `medium` row AND the block-ship-on-strict floor
 *   engaged; orchestrator surfaces the stop-and-report status block
 *   immediately.
 *
 * Distinct from {@link PlanCriticVerdict} on purpose: plan-critic has a
 * `cancel` verdict (structural plan problem requiring re-author); plan-
 * design caps at `block` because the worst case at plan-time is "the
 * plan does not commit to the design work" — a fix-by-architect amend,
 * not a re-author. Distinct from {@link CriticVerdict} on purpose: the
 * post-impl critic has a `block-ship` verdict that fires after build /
 * review; plan-design fires BEFORE the build so the wording diverges
 * (`block` not `block-ship` because the build hasn't run yet — calling
 * it `block-ship` would mislead readers into thinking the diff exists).
 */
export type PlanDesignVerdict = "pass" | "revise" | "block";

/**
 * Severity of a single `PD-N` (plan-design finding) row appended to
 * plan.md's `## Plan-design findings` section by the v8.75 plan-design
 * specialist. The ladder mirrors the reviewer's `design-quality` axis
 * severity progression with one tier capped off — there is no
 * `critical` tier at plan-time because the worst case at plan-time is
 * "the plan does not commit to the work" rather than "the rendered
 * diff is shipping broken behaviour".
 *
 * - `low` — default for any dimension grading exactly 5/10. Carries to
 *   learnings as advisory; does NOT block ship even in strict mode.
 * - `medium` — dimension grading exactly 4/10; OR any accessibility
 *   grade ≤ 5 (one-tier escalation, mirroring the reviewer's axis
 *   accessibility prior); OR the AI-slop umbrella finding in strict
 *   mode. Blocks ship in strict mode (the v8.75 block-ship-on-strict
 *   floor); surfaces but does not block in soft mode.
 * - `high` — dimension grading ≤ 3/10; OR any accessibility grade ≤ 2
 *   (legal / inclusion baseline; blocks regardless of mode). Blocks
 *   ship in strict; in soft mode the orchestrator surfaces the stop-
 *   and-report status block when ≥ 2 `high` rows accumulate.
 *
 * Validators accept the string verbatim on read; new writes MUST use
 * one of the three values. Pre-v8.75 state files cannot carry this
 * field at all (the plan-design specialist did not exist), so back-
 * compat is structural: readers simply find no `PD-N` rows.
 */
export type PlanDesignSeverity = "low" | "medium" | "high";

/**
 * Reversibility classification per `D-N` decision in `plan.md > ##
 * Decisions` (architect-authored, strict mode). Borrowed from Bezos's
 * one-way/two-way door framing: the cost of getting it wrong scales
 * with whether the decision can be cheaply undone.
 *
 * - `one-way` — irreversible (or expensive enough to be effectively
 *   so): data migrations, public-API removals, schema rewrites,
 *   destructive auth/cryptography changes, payment-side commits. Pays
 *   off slow, deliberate review BEFORE the build lands. The v8.74
 *   cross-model critic auto-fires on any `D-N` with this value.
 * - `two-way` — easily reversible: feature flags, internal-API
 *   changes behind compatibility shims, behaviour tweaks captured
 *   behind a kill switch. Optimise for speed; revert is cheap.
 * - `mostly-two-way` — reversible but with friction: schema columns
 *   added (drop is cheap, but data written under the new shape is
 *   not); new dependencies (removal is mechanical but spreads); UI
 *   surfaces shipped to users (rollback is possible but visible).
 *   The middle ground exists because the binary one-way/two-way split
 *   under-served too many real decisions.
 *
 * The architect MUST stamp one of these three values on every D-N in
 * strict mode; plan-critic §A flags a missing `Reversibility:` field
 * as a `block-ship` finding (class `decision-missing-reversibility`).
 */
export type Reversibility = "one-way" | "two-way" | "mostly-two-way";

/**
 * Architect-authored D-N record from `plan.md > ## Decisions` (strict
 * mode only). The markdown body is authoritative — this interface
 * exists so parsers / readers (plan-critic, critic §3.5 cross-model
 * trigger, learnings capture) can type-check the fields they consume.
 *
 * Fields mirror the D-N row template in
 * {@link "src/content/artifact-templates.ts" | PLAN_TEMPLATE}:
 * id (e.g. `D-1`), title, context, options (rendered as `A / B / C`),
 * pick, rationale, blastRadius, reversibility (v8.74), adr status.
 */
export interface Decision {
  id: string;
  title: string;
  context: string;
  options: string;
  pick: string;
  rationale: string;
  blastRadius: string;
  reversibility: Reversibility;
  adr?: string;
}

export type ArtifactStatus = "active" | "shipped";
export type AcceptanceCriterionStatus = "pending" | "committed";

/**
 * Branded id type for acceptance criteria. Used by
 * {@link SliceState.verifiesAcIds} and {@link AcceptanceCriterionState.verifiedBy}
 * back-references so the slice↔AC mapping is type-checked at writer
 * sites (slim summaries, plan-md parsers). The validator on read only
 * checks that the value is a string matching `AC-N` shape; readers
 * MUST accept `string` and downcast (legacy state files predate the
 * brand).
 */
export type AcceptanceCriterionId = `AC-${number}`;

export type TddPhase = "red" | "green" | "refactor";

/**
 * @deprecated v8.40+ — legacy v8.36-v8.39 record shape populated by the
 * (now-retired) commit-helper hook. The phase SHA was recorded under
 * `AcceptanceCriterionState.phases[phase]`; dropped the mechanical
 * gate and the AC↔SHA chain is no longer written. The interface stays so
 * old `flow-state.json` files (with `phases` data) still validate on
 * read; readers MUST treat the field as advisory only and prefer
 * `git log --grep="(AC-N):" --oneline` for the canonical chain view.
 */
export interface TddPhaseRecord {
  sha?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * per-criterion `posture` annotation (everyinc-compound pattern).
 *
 * The architect stamps one of these six values on every AC stanza in
 * `plan.md` frontmatter. Builder reads `posture` and selects the
 * commit ceremony (which posture-driven subject-line prefix sequence to
 * write); reviewer reads `src/posture-validation.ts:POSTURE_COMMIT_PREFIXES`
 * to scope posture-specific checks (e.g. tests-as-deliverable skips the
 * strict TDD-integrity check because tests ARE the deliverable, not a
 * precondition for production code).
 *
 * The order is the canonical heuristic order from the spec:
 *   - test-first (default) is first so legacy plans pick it up;
 *   - characterization-first sits next because it is the closest
 *     cousin (still RED-first, just on existing rather than new code);
 *   - tests-as-deliverable / refactor-only / docs-only / bootstrap
 *     are the "tests are not new behaviour" branches.
 */
export const POSTURES = [
  "test-first",
  "characterization-first",
  "tests-as-deliverable",
  "refactor-only",
  "docs-only",
  "bootstrap"
] as const;
export type Posture = (typeof POSTURES)[number];

/**
 * Default posture for AC frontmatter that omits the field.
 *
 * Backward compatibility: plans authored before do not carry a
 * posture field; the builder treats absence as `test-first` so
 * the original RED → GREEN → REFACTOR ceremony continues to apply
 * unchanged.
 */
export const DEFAULT_POSTURE: Posture = "test-first";

export interface AcceptanceCriterionState {
  id: string;
  text: string;
  commit?: string;
  status: AcceptanceCriterionStatus;
  /**
   * @deprecated v8.40+ — legacy v8.36 + v8.39 field populated by the
   * (now-retired) commit-helper hook. v8.40+ no longer reads or writes
   * this field; the AC↔SHA chain is reconstructed ex-post by the
   * reviewer via `git log --grep="(AC-N):" --oneline`. The field stays
   * on the type so old `flow-state.json` files validate on read; new
   * flows leave it absent.
   */
  phases?: Partial<Record<TddPhase, TddPhaseRecord>>;
  /**
   * per-criterion posture annotation. Absent means
   * {@link DEFAULT_POSTURE} ("test-first"). Validators reject unknown
   * string values.
   */
  posture?: Posture;
  /**
   * Back-reference from this AC to the slices that verify it. Each
   * slice id matches the `SL-N` shape (see {@link SliceId}). The
   * architect populates this field when authoring the `##
   * Acceptance Criteria (verification)` table in plan.md; reviewer /
   * plan-critic / critic read it to validate slice↔AC coverage.
   *
   * Optional for back-compat: pre-v8.63 state files lack this field
   * entirely. New strict-mode flows MUST emit at least one slice id
   * per AC (otherwise plan-critic surfaces a coverage-gap finding).
   * Soft/inline flows leave it absent (slice tables are strict-only).
   */
  verifiedBy?: SliceId[];
}

/**
 * Branded id type for plan slices (work units). Slices are the unit
 * of work the builder TDDs against; one or more slices verify each
 * acceptance criterion. The `SL-N` shape mirrors `AC-N` so the two
 * tables in plan.md read symmetrically. Validators on read accept
 * the permissive `string` shape (no rewrite) — pre-v8.63 state
 * files lack slices entirely, so the brand only constrains new
 * writes.
 */
export type SliceId = `SL-${number}`;

/**
 * Lifecycle status for a plan slice.
 *
 * - `pending` — author wrote the slice into plan.md but builder has
 *   not started TDD on it yet.
 * - `in-progress` — builder dispatched on this slice (RED, GREEN, or
 *   REFACTOR commits may be present but the cycle isn't complete).
 * - `implemented` — slice's TDD cycle is complete and the slice's
 *   commit chain landed; AC verification hasn't run yet.
 * - `verified` — implementation landed AND every AC that lists this
 *   slice in `verifies` has a corresponding `verify(AC-N): passing`
 *   commit on top of the slice chain.
 * - `skipped` — slice was authored but the builder marked it
 *   intentionally not implemented (e.g. cancelled mid-flow, or the
 *   slice turned out to be subsumed by another). The reviewer's
 *   `plan-traceability` axis treats `skipped` as an explicit
 *   non-commit signal rather than a missing commit.
 */
export type SliceStatus = "pending" | "in-progress" | "implemented" | "verified" | "skipped";

/**
 * A plan slice as authored by the architect in plan.md's `## Plan
 * / Slices` table. Slices are work units (HOW to build); acceptance
 * criteria (in the separate `## Acceptance Criteria` table) are
 * verification (HOW we know it works).
 *
 * The `Slice` shape is the in-memory representation parsers emit
 * from plan.md; the persisted form on `flow-state.json` is
 * {@link SliceState} (adds `status` + `commit` lifecycle fields).
 *
 * Architect's responsibility: determine `dependsOn` accurately.
 * Heuristic: slice A depends on slice B iff A's implementation
 * needs to read or write the same files / symbols / features that
 * B introduces. Empty `dependsOn` ⇒ `independent: true`.
 */
export interface Slice {
  id: SliceId;
  title: string;
  surface: Surface[];
  dependsOn: SliceId[];
  independent: boolean;
  posture?: Posture;
}

/**
 * Persisted slice state. Mirrors {@link Slice} fields and adds the
 * builder's lifecycle stamps:
 *
 * - `status` — see {@link SliceStatus}. Default is `pending` when
 *   architect writes the plan; builder transitions on dispatch.
 * - `commit` — first commit SHA (or short hash) on this slice's
 *   TDD chain. Used by the reviewer's `plan-traceability` axis to
 *   prove an implementation commit exists per slice.
 * - `verifiesAcIds` — convenience back-reference: the AC ids whose
 *   `verifiedBy` lists this slice. Optional; readers MUST tolerate
 *   absence and recompute from {@link AcceptanceCriterionState.verifiedBy}
 *   on the fly.
 *
 * Optional on {@link FlowStateV82}; pre-v8.63 state files lack the
 * slices field entirely and continue to validate on read.
 */
export interface SliceState {
  id: SliceId;
  title: string;
  surface: Surface[];
  dependsOn: SliceId[];
  independent: boolean;
  status: SliceStatus;
  posture?: Posture;
  commit?: string;
  verifiesAcIds?: AcceptanceCriterionId[];
  /**
   * Absolute path to the sibling git worktree the sub-builder
   * worked in (when this slice landed in a parallel layer of ≥2
   * independent slices). Stamped by the builder when
   * {@link createSliceWorktree} returns; cleared by the orchestrator's
   * ship / cancel cleanup hook after {@link cleanupSliceWorktree}.
   *
   * Optional + back-compat: pre-v8.73 strict flows ran every layer in
   * the shared working tree, so readers MUST tolerate absent values
   * and treat them as "this slice was implemented inline" (no
   * worktree to clean up). Single-slice layers and soft-mode flows
   * also leave the field absent — the worktree shape is reserved
   * for layers of ≥2 independent slices where the parallel
   * dispatch needs isolation.
   *
   * Validators on read only check that the value is a string when
   * present; relative vs absolute is not enforced because Windows
   * resume paths may carry either shape across drive remaps.
   */
  worktreePath?: string;
}

export type BuildProfile = "default" | "bootstrap";

export const ROUTING_CLASSES = ["trivial", "small-medium", "large-risky"] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

/**
 * flow mode dimension on `TriageDecision`. Distinguishes a normal
 * `/cc <task>` flow ("task" mode, the historical default and the only
 * mode pre-v8.58) from a `/cc research <topic>` flow ("research" mode, a
 * pre-task brainstormer entry point that invokes the `architect`
 * specialist in standalone mode).
 *
 * - `task` (default; pre-v8.58 behaviour) — the user wants to build
 *   something. Triage routes through the full pipeline
 *   (plan → build → qa? → review → critic → ship). All existing
 *   specialists fire under their existing gates.
 * - `research` (v8.58; rewired to architect in v8.62) — the user wants
 *   to brainstorm/research BEFORE committing to a task. Triage is
 *   skipped (the orchestrator's Hop 1 Detect forks on the `research `
 *   prefix or `--research` flag); only the `architect` specialist runs,
 *   in its standalone-mode variant (architect dispatches with
 *   `mode: "research"` envelope marker → silent Bootstrap → Frame →
 *   Approaches → Decisions → Pre-mortem → Compose synthesis pass; no
 *   AC table, no Plan/Spec/Topology/Feasibility/Traceability sections).
 *   Output is `.cclaw/flows/<slug>/research.md`; no plan handoff. v8.65
 *   will rebuild this as a multi-lens dedicated research specialist.
 *
 * Pre-v8.58 state files do not carry this field; readers MUST default
 * to `"task"` on absent.
 */
export const RESEARCH_MODES = ["task", "research"] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

/**
 * Research depth tier (v8.69). Selected at the research-mode entry
 * point — either explicitly via the `--light` / `--standard` /
 * `--deep-product` flag on `/cc research <topic>`, or auto-classified
 * by the triage sub-agent's `research_depth` heuristic when no flag is
 * present.
 *
 * - `light` — 2-lens research pass for fast clarification questions
 *   ("which library does X?", "is Y still recommended?", "what does
 *   the team currently use?"). Dispatches `research-engineer` +
 *   `research-skeptic` only, then runs the synthesis self-review and
 *   finalises. Cheaper / faster turn-around for narrowly-scoped
 *   clarifications. Skips product / architecture / history lenses
 *   because the user is not exploring a new product surface.
 * - `standard` (default; pre-v8.69 behaviour) — full 5-lens pass
 *   (engineer / product / architecture / history / skeptic) for
 *   technical exploration. The orchestrator picks this when the
 *   research is about an existing surface or a feature-tier change
 *   ("evaluate Redis vs in-memory cache for the search endpoint",
 *   "should we move auth to JWT?"). Same 4-phase flow as
 *   pre-v8.69 research mode.
 * - `deep-product` — 5-lens pass + extra probes for greenfield /
 *   pivot wording ("should we build...", "what if we replace...",
 *   "evaluate switching from..."). Engineer / architecture / history
 *   lenses run unchanged; product + skeptic lenses receive folded-in
 *   `durability` (skeptic) + `thesis` (product) + `adjacent-product`
 *   (product) probes from the everyinc-compound brainstorming Phase
 *   1.2 deep-product gap lenses. The probes do NOT spawn additional
 *   lenses — they are extra prompt content the product + skeptic
 *   lenses fold into their structured findings.
 *
 * Pre-v8.69 state files do not carry this field; readers MUST default
 * to `"standard"` on absent. Immutable for the research flow's lifetime
 * (research-depth flow doesn't flip mid-run).
 */
export const RESEARCH_DEPTHS = ["light", "standard", "deep-product"] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/**
 * Default research depth used when the orchestrator's Detect-hop
 * research-mode fork sees no explicit `--light` / `--standard` /
 * `--deep-product` flag AND no triage `research_depth` classification
 * applies (e.g. legacy research-mode invocations that pre-date the
 * flag, or harnesses that bypass triage entirely). Matches the
 * pre-v8.69 behaviour: 5-lens standard pass.
 */
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = "standard";

/**
 * Lifecycle state for the `/cc research <topic>` orchestrator (v8.71).
 *
 * v8.65 / v8.69 ran research as a four-phase straight-line flow
 * (discovery → lens-dispatch → synthesis → finalize). v8.71 inserts
 * an explicit user-review gate between synthesis and finalize so the
 * user can audit `research.md`, request targeted revisions, or push
 * back on individual claims before the artifact ships. The state is
 * persisted on `FlowState.researchState` and tracks where the
 * research orchestrator is in its lifecycle:
 *
 * - `discovery` — Phase 1 open-ended dialogue is in flight (the
 *   orchestrator is asking follow-up questions until the user signals
 *   "ready").
 * - `lens-dispatch` — Phase 2 parallel lens dispatch is in flight
 *   (one or more of the depth-tier lens set has not yet returned).
 * - `synthesis` — Phase 3 synthesis + self-review pass is in flight
 *   (the orchestrator is composing the cross-lens distillation, the
 *   recommended-next-step section, and the four-scan self-review).
 * - `awaiting-user-review` — Phase 3 has finished and `research.md`
 *   is on disk; the orchestrator is waiting for the user to invoke
 *   one of `/cc research revise <area>` / `/cc research push-back
 *   <claim>` / `/cc research accept`. The flow is paused (no
 *   sub-agents in flight) and the `currentSlug` still points at the
 *   research slug.
 * - `revising` — The user invoked `/cc research revise <area>` or
 *   `/cc research push-back <claim>`; the orchestrator is
 *   re-dispatching the targeted lens(es), re-running the synthesis
 *   self-review, and rewriting `research.md`. After the revision
 *   lands the state transitions back to `awaiting-user-review` (the
 *   user can iterate again) until the user invokes
 *   `/cc research accept`.
 * - `accepted` — The user invoked `/cc research accept`; the
 *   orchestrator finalises (`git mv` to `flows/shipped/<slug>/`,
 *   reset `currentSlug`) and emits the handoff prompt. Terminal
 *   state — the next `/cc <task>` invocation reads the shipped slug
 *   as `priorResearch` context.
 *
 * Pre-v8.71 research-mode state files lack this field; readers MUST
 * default to `null`/absent (the pre-v8.71 four-phase flow has no
 * persisted lifecycle marker — research either ships or is
 * cancelled, never paused mid-flow). New writes stamp the field at
 * every Phase boundary so resume-via-`/cc` reads the canonical
 * lifecycle position without re-parsing artifacts.
 */
export const RESEARCH_STATES = [
  "discovery",
  "lens-dispatch",
  "synthesis",
  "awaiting-user-review",
  "revising",
  "accepted"
] as const;
export type ResearchState = (typeof RESEARCH_STATES)[number];

/**
 * One revision entry on a `/cc research <topic>` flow (v8.71).
 *
 * Every `/cc research revise <area>` and `/cc research push-back
 * <claim>` invocation appends one entry to `FlowState.revisions[]`
 * and the matching row to `research.md > ## Revision history`. The
 * entry is the persistent audit trail so a reader can reconstruct
 * the iteration arc — what was challenged, which lens(es) re-ran,
 * and what concretely changed in the synthesis or per-lens
 * sections.
 *
 * - `kind` — which sub-command triggered the revision: `revise`
 *   (broad; re-dispatches every lens whose section is named in the
 *   `area` argument), `push-back` (targeted; re-dispatches the
 *   skeptic plus the lens that authored the cited claim), or
 *   `accept` (terminal; closes out the revision history with the
 *   handoff prompt — written exactly once and only as the last
 *   entry).
 * - `at` — ISO-8601 timestamp the orchestrator stamped when it
 *   started processing the revision.
 * - `area` — the user's argument verbatim (the `<area>` for
 *   `revise`, the `<claim>` for `push-back`, or the empty string
 *   for `accept`). Preserved verbatim so the audit row mirrors what
 *   the user typed.
 * - `lensesRedispatched` — which lens ids re-ran for this
 *   revision (zero entries on `accept`; one or more entries on
 *   `revise` / `push-back`). The orchestrator computes this from
 *   the depth-tier lens set ∩ the area mapping.
 * - `change` — one-sentence description of what the revision
 *   actually changed in `research.md` (e.g. "rewrote Engineer >
 *   Implementation paths to reflect new fastify v6 release"). The
 *   orchestrator authors this from the post-revision synthesis
 *   pass; pre-revision state files where the orchestrator has not
 *   yet finished the change MUST leave the field absent.
 */
export interface ResearchRevision {
  kind: "revise" | "push-back" | "accept";
  at: string;
  area: string;
  lensesRedispatched: ResearchLensId[];
  change?: string;
}

/**
 * One candidate framing surfaced at the v8.76 Approaches Gate (research
 * mode Phase 1.5 — between the open-ended discovery dialogue and the
 * parallel lens dispatch).
 *
 * The Approaches Gate is the research-mode analogue of the
 * obra-superpowers brainstorming Phase 2-3 "2-3 approach options before
 * committing" and the addyosmani idea-refine Phase 1.3 Cluster +
 * Stress-test discipline. Without it, the lenses dispatch against a
 * single implicit framing of the topic (whatever the orchestrator
 * settled on during the dialogue distillation), and downstream
 * findings inherit that framing's blind spots. Surfacing 2-3 distinct
 * framings BEFORE the lenses fire lets the user pick the framing that
 * matches their actual question — or accept the "all" default to have
 * every lens dispatch carry every framing in its envelope.
 *
 * Each framing is a DIFFERENT framing of the same research question
 * (not 2-3 conclusions, not 2-3 implementation candidates — those are
 * scoped to the lenses themselves). Examples for the topic "add
 * caching to the search endpoint":
 *
 *   - framing A: "treat caching as an infra primitive — Redis vs
 *     in-memory vs HTTP cache; the question is which substrate";
 *   - framing B: "treat caching as a search-quality lever — what we
 *     cache, how invalidation works, when to bust; the question is
 *     correctness";
 *   - framing C: "treat caching as an organizational gate — who owns
 *     the cache, who pages when it's stale; the question is governance".
 *
 * Each framing changes which dimensions every lens emphasises. The
 * user picks one (or accepts "all" — the default; every framing flows
 * to every lens in its envelope) and the orchestrator carries the
 * selected framing(s) forward in every lens dispatch envelope as
 * `framing: string[]`.
 *
 * Fields:
 *
 * - `id` — short stable identifier (e.g. `A` / `B` / `C` or
 *   `infra-primitive` / `search-quality` / `governance`). The
 *   orchestrator stamps single-letter IDs when no semantic shortname
 *   is obvious; downstream readers MUST NOT assume the id matches a
 *   specific pattern.
 * - `title` — short title (4-8 words) the orchestrator surfaces to
 *   the user at the Approaches Gate.
 * - `summary` — one-paragraph description of the framing: what
 *   question this framing makes load-bearing, what gets de-emphasised
 *   if the user picks it, which downstream lens dispatches will see
 *   the biggest shape change.
 *
 * Pre-v8.76 research-mode state files lack this field; readers MUST
 * default to absent / empty. New writes stamp `approaches[]` at the
 * end of Phase 1 (immediately before the Approaches Gate fires) and
 * `selectedApproaches[]` immediately after the user picks (or accepts
 * "all").
 */
export interface ResearchApproach {
  id: string;
  title: string;
  summary: string;
}

/**
 * Plan-traceability and TDD ceremony modes (v8.2+; reviewer-enforced
 * since v8.40; renamed `acMode` → `ceremonyMode` in to align with
 * how reference projects treat AC as one element of a plan rather than
 * the organizing concept around which the entire flow is named).
 *
 * - `inline`: trivial change. No AC table, no per-criterion prefixes,
 *   optional tests.
 * - `soft`: small/medium feature work. Bullet-list testable conditions in
 *   `plan.md` (no AC IDs); one TDD cycle per feature is enough.
 *   Default for small/medium routing.
 * - `strict`: large/risky / security-flagged. AC IDs with posture-driven
 *   commit-message prefixes (`red(AC-N): ...` / `green(AC-N): ...` /
 *   `refactor(AC-N): ...` / `test(AC-N): ...` / `docs(AC-N): ...`); the
 *   reviewer ex-post verifies ordering via `git log --grep="(AC-N):"`.
 *   Ship gate is the reviewer's release pass (no separate `runCompoundAndShip`
 *   pending-AC gate).
 *
 * Selected at the triage gate; user can override. Pre-v8.56 state files
 * with `triage.acMode` are hoisted to `triage.ceremonyMode` on read by
 * {@link rewriteLegacyAcMode} in `flow-state.ts`.
 */
export const CEREMONY_MODES = ["inline", "soft", "strict"] as const;
export type CeremonyMode = (typeof CEREMONY_MODES)[number];

/**
 * @deprecated v8.56 — use {@link CEREMONY_MODES}. Kept as a re-export so
 * pre-v8.56 import sites continue to type-check while downstream consumers
 * (tests, plugins, etc.) update to the new name. Slated for removal once
 * one full release cycle has aged out external imports.
 */
export const AC_MODES = CEREMONY_MODES;

/**
 * @deprecated v8.56 — use {@link CeremonyMode}. Type alias preserved so
 * pre-v8.56 import sites continue to type-check.
 */
export type AcMode = CeremonyMode;

/**
 * How aggressively the orchestrator advances through the flow.
 *
 * The user-facing `step` / `auto` choice was retired in v8.61. Every
 * non-inline flow now runs `auto` end-to-end with no approval pickers at
 * the plan / review / critic gates; hard failures route through the
 * always-auto failure matrix (build → auto-fix loop capped 3; reviewer
 * critical → auto-fix loop capped 3; critic block-ship → stop
 * immediately; catastrophic → stop and report). Recovery is via `/cc`
 * (continue) or `/cc-cancel` (discard).
 *
 * - `auto` — the only writeable value on current orchestrator writes. On
 *   inline / trivial paths `triage.runMode` is `null` because there are
 *   no stages to chain.
 * - `step` — preserved in the type signature for back-compat so pre-v8.61
 *   state files (which may carry `runMode: "step"`) continue to validate
 *   on read. The orchestrator no longer branches on this value —
 *   pre-v8.61 flows that resume on current versions behave as `auto`
 *   regardless. Clean break per the v8.61 CHANGELOG; users with
 *   in-flight v8.60 flows carrying `step` should expect auto behaviour
 *   on the next `/cc`.
 *
 * Selected by the triage sub-agent (see
 * `src/content/specialist-prompts/triage.ts`); user override flags
 * (`--mode=auto` / `--mode=step`) are accepted for back-compat but both
 * collapse to `auto` (step mode retired in v8.61).
 */
export const RUN_MODES = ["step", "auto"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * Decision recorded at the triage gate that opens every new flow.
 * Persisted in flow-state.json so resumes never re-trigger triage.
 *
 * `acMode` renamed to `ceremonyMode` to align cclaw's vocabulary
 * with how reference projects treat AC as one element of a plan rather
 * than the organizing concept around which the entire flow is named.
 * Pre-v8.56 state files with `triage.acMode` are hoisted to
 * `triage.ceremonyMode` on read; see `flow-state.ts > rewriteLegacyAcMode`.
 *
 * triage shrinks to a **lightweight router**. New writes carry
 * only the canonical routing fields (complexity / ceremonyMode / path /
 * runMode / mode); the classification fields (surfaces / assumptions /
 * priorLearnings / interpretationForks / criticOverride / notes) are
 * soft-deprecated — they remain on the type as optional `@deprecated
 * v8.58` fields so pre-v8.58 state files continue to validate, but new
 * orchestrator writes leave them absent. The work each represented
 * moved to the architect (post-v8.62 unified flow). The legacy fields
 * stay on the type for one release; slated for removal in v8.63+
 * once one full release cycle has aged out any in-flight state files.
 * The qa-gate continues to read `triage.surfaces` literally; the
 * WRITER moved (from triage step to the architect's Frame/Spec write
 * step), the field itself remains the source of truth for the qa-runner
 * dispatch decision.
 */
export interface TriageDecision {
  complexity: RoutingClass;
  /**
   * TDD ceremony mode for the flow: `inline` (trivial; no plan, single
   * commit), `soft` (one TDD cycle per feature, plain commits), or
   * `strict` (per-criterion RED → GREEN → REFACTOR with posture-driven
   * commit prefixes the reviewer verifies ex-post). Selected at triage;
   * immutable for the flow's lifetime. rename of `acMode`; legacy
   * field is hoisted on read for one release.
   */
  ceremonyMode: CeremonyMode;
  /** Stages the orchestrator promised to run, in order. Empty for trivial. */
  path: FlowStage[];
  /** Why this complexity was chosen. One short sentence. */
  rationale: string;
  /** ISO timestamp when triage was recorded. */
  decidedAt: string;
  /**
   * Did the user override the orchestrator's recommendation?
   *
   * @deprecated v8.44 — write-only audit telemetry has been relocated to
   * `.cclaw/state/triage-audit.jsonl` (see `src/triage-audit.ts >
   * appendTriageAudit`). New orchestrator prompts emit a per-decision
   * audit line instead of stuffing the bit into the routing state. The
   * field stays in the schema as optional so v8.0-state files
   * still validate on read; new flows should leave it absent and let
   * the audit log carry the signal. Slated for removal once no
   * supported flow-state.json schema version writes it.
   */
  userOverrode?: boolean;
  /**
   * Collapsed to `"auto"` for every non-inline path and `null` for
   * inline (the user-facing `step` / `auto` choice was retired in
   * v8.61). The orchestrator no longer branches on this value at the
   * plan / review / critic gates. Pre-v8.61 state files carrying
   * `runMode: "step"` continue to validate (the type still admits both
   * values from {@link RUN_MODES} for back-compat) but run as `auto`
   * on the next `/cc`.
   *
   * Optional in TypeScript so v8.2 state files (which lack `runMode`)
   * still validate; readers consume the field for back-compat audit
   * trails only.
   *
   * On v8.14+ inline / trivial flows, `runMode` is written as `null`
   * because there are no stages to chain.
   */
  runMode?: RunMode | null;
  /**
   * v8.58 — flow mode dimension. `"task"` (default; pre-v8.58 behaviour;
   * full pipeline through plan → build → qa? → review → critic → ship)
   * or `"research"` (v8.58; rewired to architect in v8.62; standalone
   * architect specialist only, outputs `research.md`, no plan handoff).
   * Pre-v8.58 state files lack this field; readers MUST default to
   * `"task"` on absent. Selected by the orchestrator's Hop 1 Detect
   * step based on the task prefix / flag (`research ` / `--research`)
   * — NOT by the triage classification heuristic. Immutable for the
   * lifetime of the flow (research-mode flows do not flip to task-mode
   * mid-run).
   */
  mode?: ResearchMode;
  /**
   * Pre-flight assumptions surfaced at Hop 2.5 (between triage and first
   * dispatch). Each entry is one short sentence the orchestrator was about
   * to silently default to (stack pick, lib version, file layout, target
   * platform, code-style preference). The user either acknowledged or
   * corrected these before any sub-agent ran.
   *
   * Optional and skipped entirely on the inline path. On soft/strict, the
   * pre-flight skill writes 3-7 entries here; subsequent flows in the same
   * project may seed defaults from the most recent shipped slug's
   * `assumptions:` block.
   *
   * Reading rule: `null` or absent means "no pre-flight ran" (legacy state
   * or trivial path). An empty array means "ran and the user accepted no
   * assumptions are needed", which is rare but valid.
   *
   * @deprecated v8.58 — the orchestrator no longer writes this field at
   * the triage step. The assumption-capture surface moved to the
   * architect's Bootstrap step (v8.62 unified flow; pre-v8.62 was split
   * across design Phase 0 / ac-author Phase 0). The architect writes
   * the captured list to `plan.md` under `## Assumptions` rather than
   * to `triage.assumptions`. Kept on the type as optional + deprecated
   * so pre-v8.58 state files continue to validate; readers (specialists,
   * resume paths) still consume the field when it is present (back-compat
   * with a flow paused mid-plan). Slated for removal in v8.63+
   * once one full release cycle has aged out in-flight state files.
   */
  assumptions?: string[] | null;
  /**
   * Interpretation forks recorded at Hop 2.5 (sub-step before the
   * assumptions question). **Legacy field.** On pre-v8.14 flows the
   * orchestrator surfaced 2-4 distinct interpretations of an ambiguous
   * prompt and let the user pick. v8.14-v8.60 handled ambiguity inside
   * the `design` specialist's Phase 1 (Clarify). v8.61 removed Phase 1
   * (always-auto, no mid-plan dialogue) and v8.62 absorbed `design`
   * into `architect`; the architect now resolves ambiguity silently
   * using best judgment, surfacing assumptions in `plan.md` instead of
   * asking the user. The field stays in the schema so legacy state
   * files validate; new flows leave it `null`/absent.
   *
   * Each entry is the verbatim chosen-interpretation sentence (so
   * downstream specialists see the user's framing, not the orchestrator's
   * paraphrase). When the prompt was unambiguous and forks were not
   * surfaced, the field is `null` or absent.
   *
   * @deprecated v8.58 — the orchestrator no longer writes this field.
   * v8.61 + v8.62 closed the surface entirely (no more clarify dialogue
   * anywhere in the pipeline). Kept on the type as optional + deprecated
   * for one release.
   */
  interpretationForks?: string[] | null;
  /**
   * `true` only on the zero-question fast path: trivial complexity
   * with high confidence, where the orchestrator skipped the structured
   * triage ask entirely and went straight to the inline edit. The
   * one-sentence announce-and-execute path leaves an explicit audit trail
   * in the flag (downstream tooling and `/cc-cancel` rollback flows look at
   * this to distinguish "user accepted explicitly" from "user did not see a
   * gate").
   *
   * `false` on every other path (combined-form ask answered, custom path,
   * legacy state). Optional for backward compat.
   *
   * @deprecated v8.44 — write-only audit telemetry relocated to
   * `.cclaw/state/triage-audit.jsonl` (see `src/triage-audit.ts >
   * appendTriageAudit`). The "did we take the zero-question fast path?"
   * signal now lives in the audit log entry's `autoExecuted` column;
   * downstream readers do not branch on this field, so leaving it
   * absent on new flows is safe. Field kept in schema for backward
   * compat with v8.14-state files.
   */
  autoExecuted?: boolean | null;
  /**
   * prior shipped slugs whose tag/surface profile matched the
   * current task at triage time. Populated by the orchestrator between
   * Hop 2 (triage persistence) and Hop 2.5 (pre-flight) via
   * `findNearKnowledge(triage.taskSummary, …)`. Read by `architect`
   * and `reviewer` as background context (the spec calls them
   * "what we already know nearby" / "priors when scoring findings").
   *
   * Persistence rule: **omit the field entirely when empty** — the
   * orchestrator stamps `triage.priorLearnings` only when at least one
   * hit cleared the Jaccard threshold. An absent field is the canonical
   * "no prior learnings" signal; downstream specialists check presence,
   * not array length.
   *
   * Stored as the array of raw `KnowledgeEntry` rows (slug, summary,
   * notes, tags, touchSurface, signals, …) — `unknown[]` here because the
   * full KnowledgeEntry shape lives in `knowledge-store.ts` and importing
   * it would create a cycle. Validators only check that each entry is a
   * plain object with a string `slug`; the entry's own assertions handle
   * deeper shape checks when readers parse it.
   *
   * @deprecated v8.58 — the orchestrator no longer performs the Hop 2.5
   * prior-learnings lookup. The architect dispatches `learnings-research`
   * on demand, which reads `knowledge.jsonl` directly. Kept on the type
   * as optional + deprecated for one release so pre-v8.58 state files
   * (which may carry the field) continue to validate. Specialists that
   * read this field still consume it verbatim when present (back-compat
   * resume path); when absent on new flows the architect runs its own
   * lookup.
   */
  priorLearnings?: unknown[] | null;
  /**
   * `true` when the user picked `keep-iterating-anyway` at the
   * 5-iteration review cap, which reset `reviewCounter` to 3 and bought
   * two more review rounds. Telemetry stamp so a future "why did this
   * flow take 7 review iterations?" audit can answer without re-reading
   * the entire iteration log.
   *
   * Optional, defaults to absent / `false`. Set exactly once per flow at
   * the moment the override picker fires; never cleared by ship.
   * Backward compat: state files without the field validate
   * unchanged.
   *
   * @deprecated v8.44 — write-only audit telemetry relocated to
   * `.cclaw/state/triage-audit.jsonl` (see `src/triage-audit.ts >
   * appendTriageAudit`). The "did the user buy two extra review
   * rounds?" signal now lives in the audit log entry's
   * `iterationOverride` column. Field kept in schema for backward
   * compat with v8.20-state files; new orchestrator prompts
   * append an audit line at the moment the override picker fires
   * instead of writing here.
   */
  iterationOverride?: boolean | null;
  /**
   * set when Hop 1 (Detect) auto-downgraded `ceremonyMode` because the
   * project lacks a usable VCS. Today the only value is `"no-git"`, which
   * means the orchestrator detected the absence of `.git/` at projectRoot
   * and forced `ceremonyMode` from `strict` to `soft` (strict requires per-criterion
   * trace commits, which require git). The field is purely informational — it
   * leaves an audit trail for "why is this large-risky slug running in
   * soft mode?". Downstream readers can branch on its presence to
   * suppress git-only affordances (parallel-build worktrees, inline-path
   * `git commit`).
   *
   * Optional, omitted on flows that did not downgrade. `null` is also
   * accepted for forward-compat callers that explicitly clear the field.
   * Pre-v8.23 flows without the field validate unchanged.
   *
   * Reserved values: `"no-git"`. Future Hop 1 health checks may add
   * additional reasons (e.g. `"detached-head"`); validators only check
   * type (`string | null | absent`), not membership in a fixed enum, so
   * a new reason can be introduced without a schema bump.
   */
  downgradeReason?: string | null;
  /**
   * set by the orchestrator when the user picks
   * `[2] accept-and-ship` at the Hop 4.5 block-ship picker (see
   * `.cclaw/lib/runbooks/critic-stage.md > Verdict handling`). The
   * critic returned `block-ship` and the user chose to ship anyway. The
   * field is a pure audit-trail boolean — downstream readers do not
   * branch on it; it just records that a critic block was overridden
   * for this slug so a future "why did this slug ship with critic
   * blocks open?" audit can answer without re-reading review.md /
   * critic.md.
   *
   * Optional, omitted on the common path (critic `pass` / `iterate` or
   * user accepted the picker's `[1] fix and re-review` arm). Stamped
   * exactly once per slug, at the moment the picker fires; never
   * cleared by ship. Strict in shape — `true` is the only meaningful
   * value, so the validator rejects `null` to keep the audit trail
   * unambiguous (absent = no override; `true` = override). Pre-v8.43
   * flows without the field validate unchanged.
   *
   * @deprecated v8.58 — relocated to the v8.44 audit-log telemetry
   * surface (`.cclaw/state/triage-audit.jsonl`) so the triage object
   * stays a pure routing decision. The orchestrator no longer writes
   * this field; the audit-log entry captures the override signal
   * instead (mirroring the relocation of `userOverrode` /
   * `autoExecuted` / `iterationOverride`). Kept on the type as
   * optional + deprecated for one release.
   */
  criticOverride?: boolean;
  /**
   * free-text per-decision notes attached to the triage. The
   * critic uses this to record skip rationale (e.g. the
   * `docs-only-trivial` exemption skip reason cited in
   * `.cclaw/lib/agents/critic.md > Skip conditions`). Originally
   * referenced in prose as `triageNotes` in the critic prompt;
   * lifts it into the canonical `triage.notes` slot on the
   * `TriageDecision` so the field has a declared home and a typed
   * validator entry.
   *
   * Optional, omitted on flows with nothing to record. Validators
   * accept only `string` when present; `null` is rejected to keep the
   * "absent = no note" semantics unambiguous. Pre-v8.43 flows without
   * the field validate unchanged.
   *
   * @deprecated v8.58 — the orchestrator's lightweight router no
   * longer writes narrative notes at triage. Critic skip rationale
   * continues to land in `.cclaw/state/triage-audit.jsonl` via the
   * audit-log surface; specialists capture narrative context
   * in their own artifacts (`plan.md`, `research.md`). Kept on the
   * type as optional + deprecated for one release; readers (resume
   * paths, critic) still consume the field verbatim when present.
   */
  notes?: string;
  /**
   * surfaces this slug touches. Drives the qa-runner
   * gate: qa dispatches only when `surfaces` includes `"ui"` or
   * `"web"` AND `ceremonyMode != "inline"`. See {@link Surface} for
   * the vocabulary.
   *
   * Multiple values per slug are expected — a /cc that builds an HTTP
   * endpoint plus a Vue component emits `["api", "ui"]`. The writer
   * emits the union of detected surfaces, not a single primary
   * classification.
   *
   * the **writer** of this field moved from the triage step
   * (orchestrator Hop 2, pre-v8.58) to the architect (post-v8.62
   * unified flow; pre-v8.62 was split across design Phase 2 / ac-author
   * Phase 1):
   *   - **strict / soft path**: architect writes the surfaces list to
   *     `flow-state.json` via a `patchFlowState` call after authoring
   *     `## Frame` + `## Spec`.
   *   - **inline path**: not written; downstream readers fall back to
   *     a permissive default (no surface-specific routing fires).
   * The field itself is NOT deprecated — the qa-runner gate
   * reads it literally and `surfaces` remains the canonical signal
   * for visual-review opt-in. Only the WRITER moved.
   *
   * Backwards compat: when absent or empty, the orchestrator and the
   * qa gate treat the slug as `["other"]` (no QA gating). Pre-v8.52
   * state files without this field validate unchanged.
   */
  surfaces?: Surface[];
  /**
   * Ambiguity score (v8.67) the triage sub-agent computes from the raw
   * task input. Integer in `[0, 100]`; higher = more ambiguous. Drives
   * the architect's Clarify-phase entry gate: when
   * `ambiguityScore >= config.clarify.ambiguity_threshold` (default 60)
   * AND `ceremonyMode != "inline"`, the architect runs a Clarify phase
   * BEFORE writing `plan.md` (one question per turn, max 5, until the
   * user signals "go" / "ready" / "proceed" or ambiguity resolves).
   *
   * Heuristic sources the triage prompt names verbatim:
   * - vague verbs without targets ("improve", "make better", "fix
   *   bugs"),
   * - missing acceptance criteria (no concrete pass/fail signal in the
   *   prompt),
   * - multiple plausible interpretations (the same task wording could
   *   land 2+ different implementations),
   * - no concrete file/function names in the prompt.
   *
   * Optional + back-compat: pre-v8.67 state files lack this field and
   * the architect treats absence as `0` (no clarify). Triage writers
   * MUST clamp values outside `[0, 100]` to the nearest bound rather
   * than throwing.
   */
  ambiguityScore?: number;
  /**
   * Research depth tier (v8.69). Set ONLY on research-mode flows
   * (`triage.mode == "research"`); absent on `task` mode. The
   * orchestrator's research-mode fork stamps this field at the same
   * time it stamps the sentinel triage block — either from the
   * explicit `--light` / `--standard` / `--deep-product` flag on the
   * `/cc research <topic>` argument, or from the triage sub-agent's
   * `research_depth` auto-classification (the standard `/cc <task>`
   * triage gate is bypassed in research mode, so the
   * auto-classification runs as part of the research-mode fork's
   * Detect step rather than at the triage hop). See
   * {@link ResearchDepth} for tier semantics.
   *
   * Pre-v8.69 research-mode state files lack this field; readers MUST
   * default to {@link DEFAULT_RESEARCH_DEPTH} (`"standard"`) on absent
   * so resumes of in-flight research flows behave identically to
   * pre-v8.69. Task-mode flows leave this field absent unconditionally
   * — the research depth has no meaning outside `/cc research`.
   *
   * Immutable for the flow's lifetime (research depth does not flip
   * mid-run; `/cc-cancel` + a fresh `/cc research` is the only way to
   * change tier).
   */
  research_depth?: ResearchDepth;
}

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
