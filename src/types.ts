/**
 * Canonical ordered stage set the orchestrator emits in `triage.path` and
 * {@link FlowState.currentStage}; the order is also the canonical run sequence.
 * `qa` is conditional (`triage.surfaces` includes `"ui"`/`"web"` AND
 * `ceremonyMode != "inline"`); `critic` runs at Hop 4.5 between review and ship.
 */
export const FLOW_STAGES = ["plan", "build", "qa", "review", "critic", "ship"] as const;
export type FlowStage = (typeof FLOW_STAGES)[number];

export const HARNESS_IDS = ["claude", "cursor", "opencode", "codex"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

/**
 * Plan-stage discovery roster — a single on-demand `architect` sub-agent (no
 * mid-plan user dialogue). A `mode: "research"` envelope routes a standalone
 * non-AC dispatch through the same architect (writes `research.md`).
 */
export const DISCOVERY_SPECIALISTS = ["architect"] as const;
export type DiscoverySpecialistId = (typeof DISCOVERY_SPECIALISTS)[number];

/**
 * Canonical specialist roster, ordered along the pipeline. `plan-critic` is one
 * specialist exposing three rubric scaffolds (`generic`/`design`/`devex`),
 * dispatched once per slug with the active `rubrics` set for one merged verdict
 * (`PD-N`/`DX-N` finding ids preserved). `investigator` runs read-only on debug
 * flows before the architect; `critic` is the post-impl pass before ship.
 */
export const SPECIALISTS = [
  "triage",
  "investigator",
  "architect",
  "builder",
  "plan-critic",
  "qa-runner",
  "reviewer",
  "critic"
] as const;
export type SpecialistId = (typeof SPECIALISTS)[number];

/**
 * The three plan-critic rubric scaffolds: `generic` (structural plan audit,
 * default), `design` (seven-dimension design-quality), `devex` (six-dimension
 * DevEx). The orchestrator dispatches plan-critic once with the active subset;
 * it walks them in one pass and returns one worst-of merged verdict. Absent or
 * empty defaults to `["generic"]`.
 */
export const PLAN_CRITIC_RUBRIC_MODES = ["generic", "design", "devex"] as const;
export type PlanCriticRubricMode = (typeof PLAN_CRITIC_RUBRIC_MODES)[number];

export const DEFAULT_PLAN_CRITIC_RUBRIC_MODE: PlanCriticRubricMode = "generic";

/**
 * Task shape the triage sub-agent classifies into:
 * - `build` (default) — add/change/refactor production code; normal pipeline.
 * - `debug` — investigate a regression on existing code; routes through the
 *   investigator BEFORE the architect, whose recommendation then drives routing.
 * - `research` — reserved sentinel for `/cc research` (triage never emits it).
 *
 * Orthogonal to {@link RoutingClass} (only inserts the investigator hop).
 * Readers default to `"build"` on absent; immutable for the flow's lifetime.
 */
export const TASK_SHAPES = ["build", "debug", "research"] as const;
export type TaskShape = (typeof TASK_SHAPES)[number];

export const DEFAULT_TASK_SHAPE: TaskShape = "build";

/**
 * Next-step recommendation the investigator emits; drives post-investigator
 * routing:
 * - `direct-fix` — trivial root cause; skip architect, dispatch builder.
 * - `needs-plan` — non-trivial; dispatch architect with `priorInvestigation`.
 * - `more-investigation` — insufficient evidence; re-dispatch with the cited
 *   probe (cap: 2 dispatches per slug).
 * - `not-a-bug` — symptom is expected; surface the reframe and end the turn.
 */
export const INVESTIGATOR_NEXT_STEPS = [
  "direct-fix",
  "needs-plan",
  "more-investigation",
  "not-a-bug"
] as const;
export type InvestigatorNextStep = (typeof INVESTIGATOR_NEXT_STEPS)[number];

/**
 * The three parallel hypothesis lanes the investigator runs on every bug-shaped
 * slug (each read-only, returning a findings block the orchestrator synthesises):
 * `cause-code` (code-path/regression/dependency), `cause-config`
 * (config/env/flag/version), `cause-measurement` (instrumentation/flakiness).
 * Not in {@link SPECIALISTS} — they are sub-dispatches of the investigator.
 */
export const INVESTIGATOR_LANES = [
  "cause-code",
  "cause-config",
  "cause-measurement"
] as const;
export type InvestigatorLaneId = (typeof INVESTIGATOR_LANES)[number];

/**
 * Builder dispatch envelope, mirrored to `flow-state.json > builderEnvelope`
 * for cross-dispatch readers. New fields MUST be optional (older state files
 * lack the whole object). `defenseInDepth` mirrors the investigator's
 * slim-summary line; `"yes"` makes the builder implement every named layer as
 * part of the root-cause fix, `"no"`/absent ships the fix alone.
 */
export interface BuilderEnvelope {
  defenseInDepth?: "yes" | "no";
}

/**
 * Specialist ids no longer in the roster, kept so permissive validators accept
 * old `lastSpecialist` strings on read without migrating (`design`/`ac-author`
 * → `architect`; `slice-builder` → `builder`; `security-reviewer` → reviewer
 * `security` axis; `plan-design`/`plan-devex` → plan-critic rubric modes;
 * `brainstormer` retired). Do not add new entries.
 */
export const LEGACY_SPECIALIST_IDS = [
  "design",
  "ac-author",
  "slice-builder",
  "security-reviewer",
  "brainstormer",
  "plan-design",
  "plan-devex"
] as const;
export type LegacySpecialistId = (typeof LEGACY_SPECIALIST_IDS)[number];

/**
 * @deprecated — use {@link LEGACY_SPECIALIST_IDS}. Re-export kept so old import
 * sites type-check; the entry name-collides with the current `architect`
 * specialist, so new code MUST NOT use it.
 */
export const LEGACY_DISCOVERY_SPECIALISTS = ["brainstormer"] as const;
export type LegacyDiscoverySpecialistId = (typeof LEGACY_DISCOVERY_SPECIALISTS)[number];

/**
 * Canonical legacy id for the original `planner` specialist (later `ac-author`,
 * now `architect`). Kept for permissive validators that may still encounter it
 * in very old `flow-state.json` files (`lastSpecialist` is a permissive string).
 */
export const LEGACY_PLANNER_ID = "planner" as const;
export type LegacyPlannerId = typeof LEGACY_PLANNER_ID;

/**
 * Read-only research helpers the `architect` dispatches before writing its
 * artifact (live repo signals; prior cclaw lessons). Not in {@link SpecialistId}:
 * they never become `lastSpecialist`, are not a stage, and can only be
 * dispatched by a specialist that needs their output.
 */
export const RESEARCH_AGENT_IDS = ["repo-research", "learnings-research"] as const;
export type ResearchAgentId = (typeof RESEARCH_AGENT_IDS)[number];

/**
 * Research-only sub-agents the research orchestrator (`/cc research <topic>`)
 * runs in parallel; each returns a per-lens findings block folded into
 * `research.md`. Lenses are independent and NOT in {@link SPECIALISTS} (never
 * `lastSpecialist`, not a stage, only the research orchestrator dispatches them);
 * each has a contract under `.cclaw/lib/research-lenses/<lens-id>.md`.
 * - `research-engineer` — technical feasibility, stack fit, effort.
 * - `research-product` — user value, alternatives, market.
 * - `research-architecture` — fit with existing system, coupling, scale.
 * - `research-history` — prior attempts + lessons (`knowledge.jsonl` + git log).
 * - `research-skeptic` — adversarial: failure modes, edge/abuse cases, costs.
 * - `research-design` — UI/UX/positioning lens, on `standard+` depth when the
 *   topic signals design surfaces (force-toggle via `/cc research --lens=design`).
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
 * Critic slim-summary verdict driving Hop 4.5 routing: `pass` → ship; `iterate`
 * → ship with gaps carried to `ship.md`; `block-ship` → pause for the
 * block-ship picker.
 */
export type CriticVerdict = "pass" | "iterate" | "block-ship";

/**
 * Critic escalation level in `critic.md` frontmatter: `none` = pure gap mode;
 * `light` = one adversarial technique (soft, one trigger); `full` = all
 * techniques + the §5 devil's-advocate sweep (strict, any trigger).
 */
export type CriticEscalation = "none" | "light" | "full";

/**
 * Status the builder emits at each slice boundary (strict) / end-of-feature
 * (soft); each has a handler in `always-auto-failure-handling.md`:
 * - `DONE` — proceed to next slice / qa / review.
 * - `DONE_WITH_CONCERNS` — completed; concerns appended to `build.md`.
 * - `NEEDS_CONTEXT` — cannot proceed without missing info; stop and surface it.
 * - `BLOCKED` — unresolvable obstacle; stop and surface blocker + resolution.
 *
 * The slim-summary `Notes:` line carries the detail; readers default to `DONE`.
 */
export const BUILDER_STATUSES = [
  "DONE",
  "DONE_WITH_CONCERNS",
  "NEEDS_CONTEXT",
  "BLOCKED"
] as const;
export type BuilderStatus = (typeof BUILDER_STATUSES)[number];

/**
 * qa-runner verdict at the qa stage (gate: surfaces includes `"ui"`/`"web"` AND
 * `ceremonyMode != "inline"`): `pass` → review; `iterate` → bounce to builder
 * (cap 1 via `qaIteration`); `blocked` → qa could not run, surface picker.
 * Distinct from {@link CriticVerdict} / {@link PlanCriticVerdict}.
 */
export type QaVerdict = "pass" | "iterate" | "blocked";

/**
 * Evidence tier the qa-runner records in `qa.md` (mirrored to `qaEvidenceTier`):
 * `playwright` (CI-runnable test, strongest), `browser-mcp` (reviewable, not
 * re-runnable), `manual` (last resort; verdict stays `blocked` until the user
 * confirms). Drives the reviewer's `qa-evidence` axis cross-check.
 */
export type QaEvidenceTier = "playwright" | "browser-mcp" | "manual";

/**
 * Runtime surfaces a task may touch, stamped under `triage.surfaces`. Drives the
 * qa-runner gate (`ui`/`web` + non-inline). Multiple values per slug expected
 * (the union); absent/empty is treated as `["other"]` (no QA gating).
 * - `cli` — command-line tool / bin scripts.
 * - `library` — published/exported code consumed by other code.
 * - `api` — HTTP/RPC/GraphQL endpoint.
 * - `ui` — visual UI surface; gates qa-runner in non-inline mode.
 * - `web` — alias for `ui`; the qa gate treats both as equivalent.
 * - `data` — persistence/migration/schema.
 * - `infra` — deployment/CI/runtime config.
 * - `docs` — docs-only diff, no runtime change.
 * - `other` — fallback, and the validator default when absent.
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
 * Pre-impl plan-critic verdict — the worst-of merge across the active rubrics
 * (`cancel` > `block` > `revise` > `pass`); `generic` mode emits
 * `pass`/`revise`/`cancel`, `design`/`devex` modes emit `pass`/`revise`/`block`.
 * Routing: `pass` → builder; `revise` → bounce to architect, re-dispatch once
 * (1 loop max per mode); `cancel`/`block` → picker / stop-and-report. Distinct
 * from {@link CriticVerdict} (post-impl, has `block-ship`).
 */
export type PlanCriticVerdict = "pass" | "revise" | "cancel" | "block";

/**
 * @deprecated — plan-design merged into plan-critic `rubricMode: "design"`;
 * branch on {@link PlanCriticVerdict}. Alias kept so old readers type-check.
 */
export type PlanDesignVerdict = "pass" | "revise" | "block";

/**
 * Severity of a `PD-N` plan-design finding (no `critical` tier at plan-time):
 * `low` = dimension 5/10 (advisory); `medium` = 4/10, or accessibility ≤ 5, or
 * strict-mode AI-slop (blocks in strict); `high` = ≤ 3/10, or accessibility ≤ 2
 * (blocks regardless of mode; ≥ 2 `high` rows stop-and-report in soft). New
 * writes use one of the three values.
 */
export type PlanDesignSeverity = "low" | "medium" | "high";

/**
 * @deprecated — plan-devex merged into plan-critic `rubricMode: "devex"`;
 * branch on {@link PlanCriticVerdict}. Alias kept so old readers type-check.
 */
export type PlanDevexVerdict = "pass" | "revise" | "block";

/**
 * Severity of a `DX-N` plan-devex finding; mirrors {@link PlanDesignSeverity}
 * with two escalations (getting-started one tier sharper; upgrade-path on
 * breaking changes caps at `high`): `low` = 5/10; `medium` = 4/10 or
 * getting-started ≤ 5 (blocks in strict); `high` = ≤ 3/10 or upgrade-path ≤ 3
 * on a breaking change (blocks regardless of mode). New writes use one value.
 */
export type PlanDevexSeverity = "low" | "medium" | "high";

/**
 * Reversibility per `D-N` decision (one-way/two-way door framing):
 * - `one-way` — irreversible/expensive (migrations, public-API removals, schema
 *   rewrites, destructive auth/crypto, payments). Auto-fires the cross-model critic.
 * - `two-way` — easily reversible (flags, shimmed internal-API changes).
 * - `mostly-two-way` — reversible with friction (added columns, new deps, shipped UI).
 *
 * The architect stamps one per D-N in strict mode; plan-critic flags a missing
 * `Reversibility:` field as a block-ship finding.
 */
export type Reversibility = "one-way" | "two-way" | "mostly-two-way";

/**
 * Architect-authored D-N record from `plan.md > ## Decisions` (strict mode). The
 * markdown body is authoritative; this interface lets readers (plan-critic,
 * the critic cross-model trigger, learnings) type-check the fields they consume.
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
 * Branded AC id (`AC-N`). Backs the slice↔AC mapping. The read validator only
 * checks the `AC-N` shape; readers MUST accept `string` and downcast (legacy
 * state files predate the brand).
 */
export type AcceptanceCriterionId = `AC-${number}`;

export type TddPhase = "red" | "green" | "refactor";

/**
 * @deprecated — legacy per-phase SHA record from the retired commit-helper hook.
 * Kept so old `flow-state.json` files validate; treat as advisory and prefer
 * `git log --grep="(AC-N):" --oneline` for the canonical chain.
 */
export interface TddPhaseRecord {
  sha?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * Per-criterion `posture` the architect stamps on every AC. Builder reads it to
 * select the commit ceremony; reviewer reads `POSTURE_COMMIT_PREFIXES` to scope
 * posture-specific checks (e.g. `tests-as-deliverable` skips the strict
 * TDD-integrity check). Order is the canonical heuristic order — `test-first`
 * (default) first so legacy plans pick it up.
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

/** Default posture when AC frontmatter omits the field (RED → GREEN → REFACTOR). */
export const DEFAULT_POSTURE: Posture = "test-first";

export interface AcceptanceCriterionState {
  id: string;
  text: string;
  commit?: string;
  status: AcceptanceCriterionStatus;
  /**
   * @deprecated — legacy field from the retired commit-helper hook. Kept so old
   * `flow-state.json` files validate; new flows leave it absent and reconstruct
   * the AC↔SHA chain via `git log --grep="(AC-N):"`.
   */
  phases?: Partial<Record<TddPhase, TddPhaseRecord>>;
  /** Per-criterion posture. Absent means {@link DEFAULT_POSTURE}; validators reject unknown values. */
  posture?: Posture;
  /**
   * Back-reference to the slices (`SL-N`) that verify this AC; read by
   * reviewer/plan-critic/critic for coverage. Optional/back-compat: soft/inline
   * and old state files leave it absent; new strict flows emit ≥ 1 slice per AC.
   */
  verifiedBy?: SliceId[];
}

/**
 * Branded plan-slice id (`SL-N`). Slices are the unit of work the builder TDDs
 * against; one or more verify each AC. The read validator accepts the permissive
 * `string` shape (the brand only constrains new writes).
 */
export type SliceId = `SL-${number}`;

/**
 * Lifecycle status for a plan slice.
 * - `pending` — authored, builder not started.
 * - `in-progress` — builder dispatched; TDD cycle incomplete.
 * - `implemented` — TDD cycle complete and commits landed; AC verify not yet run.
 * - `verified` — implemented AND every verifying AC has a `verify(AC-N): passing` commit.
 * - `skipped` — authored but intentionally not implemented (explicit non-commit signal).
 */
export type SliceStatus = "pending" | "in-progress" | "implemented" | "verified" | "skipped";

/**
 * A plan slice as authored by the architect (work unit — HOW to build; ACs are
 * verification). In-memory shape parsers emit from plan.md; the persisted form
 * is {@link SliceState}. `dependsOn` must be accurate (A depends on B iff A
 * reads/writes files/symbols B introduces); empty ⇒ `independent: true`.
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
 * Persisted slice state — {@link Slice} fields plus builder lifecycle stamps:
 * `status` (default `pending`), `commit` (first SHA on the slice's TDD chain,
 * used by the reviewer's `plan-traceability` axis), `verifiesAcIds` (back-ref;
 * recompute from {@link AcceptanceCriterionState.verifiedBy} if absent).
 * Optional on {@link FlowStateV82}; old state files lack slices.
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
   * Absolute path to the sibling git worktree a sub-builder used when this slice
   * landed in a parallel layer of ≥ 2 independent slices. Stamped on
   * {@link createSliceWorktree}; cleared after {@link cleanupSliceWorktree}.
   * Optional/back-compat: absent means implemented inline (single-slice layers,
   * soft mode, old state files). Validators only check it is a string.
   */
  worktreePath?: string;
}

export type BuildProfile = "default" | "bootstrap";

export const ROUTING_CLASSES = ["trivial", "small-medium", "large-risky"] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

/**
 * Flow mode on `TriageDecision`: `task` (default; full pipeline plan → build →
 * qa? → review → critic → ship) or `research` (`/cc research <topic>`; triage is
 * skipped via the Detect-hop `research ` prefix fork, only the standalone
 * `architect` runs and writes `research.md`, no plan handoff). Readers default
 * to `"task"` on absent.
 */
export const RESEARCH_MODES = ["task", "research"] as const;
export type ResearchMode = (typeof RESEARCH_MODES)[number];

/**
 * Research depth tier, auto-classified by triage's `research_depth` heuristic:
 * `light` (2-lens engineer+skeptic, fast clarifications), `standard` (default;
 * full 5-lens), `deep-product` (5-lens + extra product/skeptic probes folded
 * into existing lenses for greenfield/pivot wording). Readers default to
 * `"standard"`; immutable for the flow's lifetime.
 */
export const RESEARCH_DEPTHS = ["light", "standard", "deep-product"] as const;
export type ResearchDepth = (typeof RESEARCH_DEPTHS)[number];

/** Default research depth when auto-classification has no signal: 5-lens standard. */
export const DEFAULT_RESEARCH_DEPTH: ResearchDepth = "standard";

/**
 * Lifecycle state for the `/cc research <topic>` orchestrator, persisted on
 * `FlowState.researchState` so a `/cc` continue resumes without re-parsing:
 * - `discovery` — Phase 1 open-ended dialogue in flight.
 * - `lens-dispatch` — Phase 2 parallel lenses in flight.
 * - `synthesis` — Phase 3 synthesis + self-review in flight.
 * - `awaiting-user-review` — `research.md` on disk; paused for revise/push-back/accept.
 * - `revising` — targeted lens(es) re-running; returns to `awaiting-user-review`.
 * - `accepted` — finalised (moved to `flows/shipped/<slug>/`); terminal.
 *
 * Readers default to `null`/absent (the pre-lifecycle four-phase flow).
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
 * One `/cc research` revision entry, appended to `FlowState.revisions[]` and
 * `research.md > ## Revision history` as the audit trail.
 * - `kind` — `revise` (re-dispatch lenses named in `area`), `push-back`
 *   (re-dispatch skeptic + the lens that authored the claim), `accept` (terminal,
 *   written once and last).
 * - `at` — ISO-8601 timestamp; `area` — user argument verbatim (empty for `accept`).
 * - `lensesRedispatched` — lens ids that re-ran (none on `accept`).
 * - `change` — one-sentence description; absent until post-revision synthesis fills it.
 */
export interface ResearchRevision {
  kind: "revise" | "push-back" | "accept";
  at: string;
  area: string;
  lensesRedispatched: ResearchLensId[];
  change?: string;
}

/**
 * One candidate framing surfaced at the Approaches Gate (research Phase 1.5).
 * Each is a different framing of the same question (not a conclusion); the user
 * picks one or accepts "all", and the selection rides each lens envelope as
 * `framing: string[]`.
 * - `id` — short stable id (e.g. `A`); readers MUST NOT assume a pattern.
 * - `title` — 4-8 word title surfaced at the gate.
 * - `summary` — one paragraph: what the framing makes load-bearing / de-emphasises.
 *
 * Readers default to absent/empty; stamped at the end of Phase 1.
 */
export interface ResearchApproach {
  id: string;
  title: string;
  summary: string;
}

/**
 * Plan-traceability / TDD ceremony mode (reviewer-enforced):
 * - `inline` — trivial; no AC table, optional tests.
 * - `soft` — small/medium; bullet-list testable conditions (no AC IDs), one TDD
 *   cycle per feature. Default for small/medium routing.
 * - `strict` — large/risky/security; AC IDs with posture-driven commit prefixes
 *   the reviewer verifies ex-post via `git log --grep="(AC-N):"`.
 *
 * Selected at triage (user can override). Legacy `triage.acMode` is hoisted to
 * `ceremonyMode` on read by {@link rewriteLegacyAcMode}.
 */
export const CEREMONY_MODES = ["inline", "soft", "strict"] as const;
export type CeremonyMode = (typeof CEREMONY_MODES)[number];

/** @deprecated — use {@link CEREMONY_MODES}. Re-export kept so old import sites type-check. */
export const AC_MODES = CEREMONY_MODES;

/** @deprecated — use {@link CeremonyMode}. Alias kept so old import sites type-check. */
export type AcMode = CeremonyMode;

/**
 * How aggressively the orchestrator advances the flow. The user-facing
 * `step`/`auto` choice was retired; every non-inline flow runs `auto`
 * end-to-end (hard failures route through the always-auto failure matrix), and
 * inline paths write `null`. `auto` is the only writeable value on non-inline
 * paths; `step` is accepted on read for back-compat and treated as `auto`.
 * Computed deterministically (no user-facing flag).
 */
export const RUN_MODES = ["step", "auto"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * Decision recorded at the triage gate that opens every flow; persisted so
 * resumes never re-trigger triage. Triage is a lightweight router — new writes
 * carry only the routing fields (complexity / ceremonyMode / path / runMode /
 * mode). The classification fields below are soft-deprecated (kept optional so
 * old state files validate); their work moved to the architect. The qa-gate
 * still reads `triage.surfaces` literally — only that field's writer moved.
 */
export interface TriageDecision {
  complexity: RoutingClass;
  /**
   * TDD ceremony mode: `inline`/`soft`/`strict`. Selected at triage; immutable
   * for the flow's lifetime. Rename of `acMode` (hoisted on read).
   */
  ceremonyMode: CeremonyMode;
  /** Stages the orchestrator promised to run, in order. Empty for trivial. */
  path: FlowStage[];
  /** Why this complexity was chosen. One short sentence. */
  rationale: string;
  /** ISO timestamp when triage was recorded. */
  decidedAt: string;
  /**
   * Did the user override the recommendation?
   * @deprecated — audit telemetry relocated to `triage-audit.jsonl`; kept
   * optional so old state files validate.
   */
  userOverrode?: boolean;
  /**
   * `"auto"` on non-inline paths, `null` on inline. The `step`/`auto` choice was
   * retired; pre-existing `runMode: "step"` still validates but runs as `auto`.
   * Optional so older state files validate.
   */
  runMode?: RunMode | null;
  /**
   * Flow mode: `"task"` (default) or `"research"` (standalone architect, outputs
   * `research.md`). Set by the Hop 1 Detect step from the task prefix, not the
   * triage heuristic. Readers default to `"task"`; immutable for the lifetime.
   */
  mode?: ResearchMode;
  /**
   * Pre-flight assumptions. Reading rule: `null`/absent = no pre-flight ran;
   * empty array = ran with nothing to record.
   * @deprecated — capture moved to the architect's Bootstrap step (`plan.md > ##
   * Assumptions`); kept optional, consumed when present (mid-plan resume).
   */
  assumptions?: string[] | null;
  /**
   * Legacy ambiguity-fork interpretations (verbatim chosen-interpretation
   * sentences; `null`/absent when none). The architect now resolves ambiguity
   * silently.
   * @deprecated — surface closed; kept optional so legacy state validates.
   */
  interpretationForks?: string[] | null;
  /**
   * `true` only on the zero-question fast path (trivial + high confidence);
   * `false`/absent otherwise.
   * @deprecated — signal relocated to the audit log; kept optional for back-compat.
   */
  autoExecuted?: boolean | null;
  /**
   * Prior shipped slugs whose tag/surface profile matched at triage time, stored
   * as raw `KnowledgeEntry` rows (`unknown[]` to avoid an import cycle; validators
   * only check each is an object with a string `slug`). Omitted when empty
   * (presence, not length, is the signal).
   * @deprecated — the architect now runs its own `learnings-research` lookup;
   * kept optional, consumed verbatim when present.
   */
  priorLearnings?: unknown[] | null;
  /**
   * `true` when the user picked `keep-iterating-anyway` at the 5-iteration review
   * cap (reset `reviewCounter` to 3). Optional, defaults absent/`false`.
   * @deprecated — signal relocated to the audit log; kept for back-compat.
   */
  iterationOverride?: boolean | null;
  /**
   * Set when Hop 1 auto-downgraded `ceremonyMode` for lack of a usable VCS; only
   * value today is `"no-git"` (forced `strict` → `soft`). Informational audit
   * trail; readers may branch on presence to suppress git-only affordances.
   * Optional/`null` when no downgrade; validators check type only, so new reasons
   * need no schema bump.
   */
  downgradeReason?: string | null;
  /**
   * `true` when the user picked `accept-and-ship` at the Hop 4.5 block-ship
   * picker (critic block overridden). Audit-only; stamped once, never cleared;
   * the validator rejects `null` (absent = no override).
   * @deprecated — relocated to the audit-log telemetry surface; kept optional.
   */
  criticOverride?: boolean;
  /**
   * Free-text per-decision triage notes (e.g. critic skip rationale). Optional;
   * validators accept only `string` when present (`null` rejected).
   * @deprecated — the lightweight router no longer writes notes; kept optional,
   * consumed verbatim when present.
   */
  notes?: string;
  /**
   * Surfaces this slug touches; drives the qa-runner gate (`ui`/`web` +
   * non-inline). See {@link Surface}. Multiple values per slug expected (the
   * union). NOT deprecated — the canonical visual-review signal; only its writer
   * moved (triage → architect Frame/Spec). Absent/empty → `["other"]` (no gating).
   */
  surfaces?: Surface[];
  /**
   * Ambiguity score the triage sub-agent computes from the raw task; integer
   * `[0, 100]`, higher = more ambiguous. Gates the architect's Clarify phase
   * (`>= clarify.ambiguity_threshold`, default 60, AND non-inline). Readers treat
   * absent as `0`; writers clamp out-of-range values to the nearest bound.
   */
  ambiguityScore?: number;
  /**
   * Research depth tier — set ONLY on research-mode flows (absent on `task`),
   * derived from the topic wording. See {@link ResearchDepth}. Readers default to
   * {@link DEFAULT_RESEARCH_DEPTH} on absent; immutable for the lifetime.
   */
  research_depth?: ResearchDepth;
  /**
   * Task shape: `"build"` (default), `"debug"` (investigator hop before
   * architect), or `"research"` (reserved sentinel; triage never emits it).
   * Orthogonal to {@link RoutingClass}. Detection: bug-shape keywords AND
   * repo-anchored evidence both present → `debug`. Readers default to
   * {@link DEFAULT_TASK_SHAPE}; immutable for the lifetime.
   */
  taskShape?: TaskShape;
  /**
   * Developer-experience surface flag set by triage's devex-detection step and
   * read by the plan-devex dispatch gate. `true` when the task touches
   * SDK/API/CLI/library/public-interface surface; `false` for UI/data/infra/docs
   * only. Readers default to `false` on absent; immutable for the lifetime.
   */
  devexSurface?: boolean;
}

/**
 * Ambiguity dimensions the Clarify protocol scores after each user answer:
 * `goal` (primary-objective clarity; weight 0.4), `constraints` (boundary/
 * non-goal; 0.3), `criteria` (success/verification; 0.3), `context` (repo/
 * existing-system; 0.0 — informational, not gating; persisted for audit).
 */
export const CLARIFY_DIMENSIONS = [
  "goal",
  "constraints",
  "criteria",
  "context"
] as const;
export type ClarifyDimension = (typeof CLARIFY_DIMENSIONS)[number];

/**
 * One per-dimension Clarify score. `score` is a float in `[0.0, 1.0]` (1.0 =
 * fully clear, 0.0 = wide open); `rationale` is a one-sentence explanation.
 * Validators clamp `score` to range on write.
 */
export interface ClarifyDimensionScore {
  dimension: ClarifyDimension;
  score: number;
  rationale: string;
}

/**
 * One round of iterative Clarify dialogue; the array is the append-only audit
 * trail (rounds never mutated). Only the question reaches the user; scores
 * persist for audit.
 * - `round` — 1-indexed.
 * - `dimensionScores` — one entry per {@link CLARIFY_DIMENSIONS} value, in order.
 * - `ambiguity` — scalar `[0.0, 1.0]` (lower = clearer); math-gated exit fires < 0.25.
 * - `targetedDimension` — dimension the next question targets (ignored on terminal rounds).
 * - `question` — the question actually asked this round, verbatim.
 */
export interface ClarifyRoundState {
  round: number;
  dimensionScores: ClarifyDimensionScore[];
  ambiguity: number;
  targetedDimension: ClarifyDimension;
  question: string;
}

/**
 * Math-gated Clarify exit threshold: `ambiguity < 0.25` ends the dialogue (in
 * addition to "user ready" / round-cap exits), i.e. a weighted-score sum > 0.75
 * across the gating dimensions.
 */
export const CLARIFY_EXIT_AMBIGUITY_THRESHOLD = 0.25;

/**
 * Round caps for iterative Clarify: architect Phase −1 caps at 5; research mode
 * Phase 1 at 8 (more axes to pin). Both share
 * {@link CLARIFY_EXIT_AMBIGUITY_THRESHOLD}.
 */
export const CLARIFY_ARCHITECT_ROUND_CAP = 5;
export const CLARIFY_RESEARCH_ROUND_CAP = 8;

/**
 * Canonical `Recommended next` enum the orchestrator parses from specialist slim
 * summaries. `awaiting-one-way-confirmation` is emitted by the architect when
 * the plan has a `Reversibility: one-way` D-N and triggers a structured user
 * pause before plan-critic. Specialists with their own dialect (critic,
 * plan-critic, investigator) document those inline — this enum is the
 * orchestrator's parse target, not a hard constraint.
 */
export const RECOMMENDED_NEXT = [
  "continue",
  "review-pause",
  "fix-only",
  "cancel",
  "accept-warns-and-ship",
  "awaiting-one-way-confirmation"
] as const;
export type RecommendedNext = (typeof RECOMMENDED_NEXT)[number];

/**
 * User choice at the One-way Door Gate (the pause between architect and
 * plan-critic when the plan has a `Reversibility: one-way` D-N): `confirm`
 * (accept and proceed), `edit` (stop-and-report asking the user to revise
 * `plan.md`, then re-/cc), `cancel` (route to `/cc-cancel`).
 */
export const ONE_WAY_DOOR_CHOICES = ["confirm", "edit", "cancel"] as const;
export type OneWayDoorChoice = (typeof ONE_WAY_DOOR_CHOICES)[number];

/**
 * Persisted One-way Door Gate state on `flow-state.json > oneWayDoorConfirmation`;
 * stamped when the architect returns `awaiting-one-way-confirmation`, cleared on
 * `/cc-cancel`/finalize.
 * - `decisionIds` — the `D-N` ids flagged `Reversibility: one-way`.
 * - `userChoice` — the user's pick; absent while awaiting. The "awaiting user"
 *   signal is `currentStage == "plan"` AND `lastSpecialist == "architect"` AND
 *   this set with `userChoice` absent.
 * - `confirmedAt` — ISO timestamp; telemetry.
 *
 * Readers default to `null`/absent; immutable for the flow's lifetime.
 */
export interface OneWayDoorConfirmation {
  decisionIds: string[];
  userChoice?: OneWayDoorChoice;
  confirmedAt?: string;
}

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
