/**
 * v8.42 — `critic` stage inserted between `review` and `ship`. The critic
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
 * v8.52 adds `"qa"` between `build` and `review`. It is the only stage
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
 * v8.14: `brainstormer` + `architect` collapsed into a single `design`
 * specialist that runs in the MAIN orchestrator context with a multi-turn
 * user-collaborative protocol (Phases 0-7). The discovery sub-phase under
 * `plan` is now `design` -> `ac-author` (was `design` -> `planner` from
 * v8.14 through v8.27; renamed in v8.28 — see {@link LEGACY_PLANNER_ID}).
 * State files written before v8.14 with `lastSpecialist` pointing at the
 * removed ids are migrated to `null` on read so the orchestrator re-runs
 * the design phase from scratch.
 */
export const DISCOVERY_SPECIALISTS = ["design", "ac-author"] as const;
export type DiscoverySpecialistId = (typeof DISCOVERY_SPECIALISTS)[number];

/**
 * v8.42 — `critic` joins the specialist roster as an on-demand sub-agent
 * between `security-reviewer` and `slice-builder`. The order in this
 * array matters: it traces the canonical discovery → review → critic →
 * ship dispatch sequence the orchestrator follows. `critic` runs at
 * Hop 4.5 (between Hop 4 review and Hop 5 ship); the new
 * {@link FLOW_STAGES} entry `"critic"` is the stage value the
 * orchestrator stamps while the critic dispatch is in flight.
 *
 * v8.51 — `plan-critic` joins the roster between `ac-author` and
 * `slice-builder`. plan-critic is a **pre-implementation** adversarial
 * pass that runs only on the tight gate {ceremonyMode=strict, complexity=
 * large-risky, problemType!=refines, AC count>=2}. It walks the plan
 * itself (goal coverage / granularity / dependencies / parallelism /
 * risk catalog) before any code is written, and writes a single
 * `flows/<slug>/plan-critic.md` artifact. Distinct from the v8.42
 * `critic` specialist (post-implementation, walks what was built);
 * both ship in tandem because they catch different problem classes.
 */
export const SPECIALISTS = [
  ...DISCOVERY_SPECIALISTS,
  "plan-critic",
  "reviewer",
  "security-reviewer",
  "critic",
  "qa-runner",
  "slice-builder"
] as const;
export type SpecialistId = (typeof SPECIALISTS)[number];

/**
 * Removed in v8.14. Kept as a type-level reminder for migration paths and
 * `legacyArtifacts: true` opt-in mode. Do not add new entries.
 */
export const LEGACY_DISCOVERY_SPECIALISTS = ["brainstormer", "architect"] as const;
export type LegacyDiscoverySpecialistId = (typeof LEGACY_DISCOVERY_SPECIALISTS)[number];

/**
 * v8.28: `planner` specialist renamed to `ac-author` to disambiguate the
 * specialist role from the `plan` stage and `plan.md` artifact. The two
 * names coexist for **one release**:
 *
 * - on read, `flow-state.json` files with `lastSpecialist: "planner"` are
 *   rewritten to `"ac-author"` by `rewriteLegacyPlanner` in `flow-state.ts`;
 * - on write, the orchestrator and all specialist prompts emit `"ac-author"`;
 * - on dispatch, `SPECIALISTS` no longer carries `"planner"`, so the
 *   orchestrator cannot accidentally dispatch to the old id.
 *
 * The plan is to remove this legacy id in v8.29+ once one full release
 * cycle has aged out any in-flight state files. Until then, this constant
 * is the canonical place to spell the old name — every other reference
 * to `"planner"` in source has been removed.
 *
 * Shipped flow artifacts under `flows/shipped/<slug>/` keep their
 * historical text untouched — the migration only rewrites the active
 * `flow-state.json` field, not on-disk artifact prose.
 */
export const LEGACY_PLANNER_ID = "planner" as const;
export type LegacyPlannerId = typeof LEGACY_PLANNER_ID;

/**
 * Lightweight read-only research helpers, dispatched by `ac-author` or by the
 * `design` phase (mostly on `deep` posture, in Phase 2 Frame or Phase 4
 * Decisions) BEFORE the dispatcher writes its artifact. They exist to
 * gather context (live repo signals; prior cclaw lessons) so the
 * dispatcher does not have to crawl the codebase or knowledge log itself.
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

export type InstallableAgentId = SpecialistId | ResearchAgentId;

/**
 * v8.42 — verdict the critic returns in its slim summary. Drives Hop 4.5
 * routing: `pass` → continue to Hop 5 ship; `iterate` → continue to
 * ship with the iterate-severity gaps carried over to `ship.md > Risks
 * carried over`; `block-ship` → orchestrator pauses and surfaces the
 * block-ship picker (`fix and re-review` / `accept-and-ship`).
 */
export type CriticVerdict = "pass" | "iterate" | "block-ship";

/**
 * v8.42 — escalation level stamped in `critic.md > frontmatter >
 * escalation_level`. `none` = pure gap mode; `light` = one adversarial
 * technique enabled (soft mode with exactly one trigger firing);
 * `full` = all four adversarial techniques plus the §5 devil's-advocate
 * sweep (strict mode with any trigger firing).
 */
export type CriticEscalation = "none" | "light" | "full";

/**
 * v8.52 — verdict the qa-runner specialist returns in its slim summary.
 * Drives the qa stage routing (between `build` and `review` on the tight
 * gate {triage.surfaces includes "ui" or "web" AND ceremonyMode != "inline"}):
 *
 * - `pass` — every UI AC has evidence (Playwright test result / browser
 *   MCP screenshot / manual-steps confirmation); proceed to review.
 * - `iterate` — at least one UI AC failed verification; bounce back to
 *   slice-builder with qa findings as additional context, max 1 iteration
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
 * v8.52 — evidence tier captured by the qa-runner in `qa.md` frontmatter
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
 * Drives the reviewer's `qa-evidence` axis (v8.52) cross-check: for any
 * AC with surface in {`ui`, `web`}, the reviewer expects `qa.md` with a
 * matching evidence row.
 */
export type QaEvidenceTier = "playwright" | "browser-mcp" | "manual";

/**
 * v8.52 — runtime surfaces a task may touch. Populated by the
 * orchestrator at triage (Hop 2) from the task description and the
 * touched-files signal, stamped under `triage.surfaces`. Drives the
 * v8.52 qa-runner gate (qa-runner dispatches only when `surfaces`
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
 * v8.51 — verdict the pre-implementation plan-critic returns in its
 * slim summary. Drives the plan-critic step routing (between
 * `ac-author` and `slice-builder` on the tight gate {ceremonyMode=strict,
 * complexity=large-risky, problemType!=refines, AC count>=2}):
 *
 * - `pass` — advance to slice-builder dispatch (no ceremony).
 * - `revise` (iteration 0) — bounce to ac-author with plan-critic
 *   findings prepended; ac-author updates plan.md and the orchestrator
 *   re-dispatches plan-critic (iteration 1).
 * - `revise` (iteration 1) — orchestrator surfaces the user picker
 *   (cancel / accept-warnings-and-proceed / re-design); no third
 *   plan-critic dispatch is allowed (1 revise loop max).
 * - `cancel` (any iteration) — structural plan problem (goal-coverage
 *   gap requiring re-design, dependency cycle that can't be untangled);
 *   orchestrator surfaces the cancel picker (cancel-slug / re-design)
 *   immediately, no silent fallback.
 *
 * Distinct from {@link CriticVerdict} on purpose: the post-impl critic
 * has a `block-ship` verdict (build/review already ran); plan-critic
 * has `cancel` (build hasn't run yet so "block-ship" would be a
 * category error). Both enums coexist; readers branch on which
 * specialist is in flight, not on a merged verdict shape.
 */
export type PlanCriticVerdict = "pass" | "revise" | "cancel";

export type ArtifactStatus = "active" | "shipped";
export type AcceptanceCriterionStatus = "pending" | "committed";

export type TddPhase = "red" | "green" | "refactor";

/**
 * @deprecated v8.40+ — legacy v8.36-v8.39 record shape populated by the
 * (now-retired) commit-helper hook. The phase SHA was recorded under
 * `AcceptanceCriterionState.phases[phase]`; v8.40 dropped the mechanical
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
 * v8.36 — per-criterion `posture` annotation (everyinc-compound pattern).
 *
 * The ac-author stamps one of these six values on every AC stanza in
 * `plan.md` frontmatter. Slice-builder reads `posture` and selects the
 * commit ceremony (which posture-driven subject-line prefix sequence to
 * write); reviewer reads `src/posture-validation.ts:POSTURE_COMMIT_PREFIXES`
 * to scope posture-specific checks (e.g. tests-as-deliverable skips the
 * strict TDD-integrity check because tests ARE the deliverable, not a
 * precondition for production code).
 *
 * The order is the canonical heuristic order from the v8.36 spec:
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
 * Backward compatibility: plans authored before v8.36 do not carry a
 * posture field; the slice-builder treats absence as `test-first` so
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
   * v8.36 — per-criterion posture annotation. Absent means
   * {@link DEFAULT_POSTURE} ("test-first"). Validators reject unknown
   * string values.
   */
  posture?: Posture;
}

export type BuildProfile = "default" | "bootstrap";

export const ROUTING_CLASSES = ["trivial", "small-medium", "large-risky"] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

/**
 * Plan-traceability and TDD ceremony modes (v8.2+; reviewer-enforced
 * since v8.40; renamed `acMode` → `ceremonyMode` in v8.56 to align with
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
 * - `step` (default): pause after every stage. The orchestrator renders the
 *   slim summary and waits for the user to type "continue". The original
 *   v8.2 behaviour, recommended for `strict` and unfamiliar work.
 * - `auto`: render the slim summary and immediately dispatch the next stage
 *   without asking. Stops only on hard gates (block findings, security flag,
 *   ship). Recommended for `inline` / `soft` work the user has already
 *   scoped tightly.
 *
 * Selected at the triage gate; user can override per flow.
 */
export const RUN_MODES = ["step", "auto"] as const;
export type RunMode = (typeof RUN_MODES)[number];

/**
 * Decision recorded at the triage gate that opens every new flow.
 * Persisted in flow-state.json so resumes never re-trigger triage.
 *
 * v8.56 — `acMode` renamed to `ceremonyMode` to align cclaw's vocabulary
 * with how reference projects treat AC as one element of a plan rather
 * than the organizing concept around which the entire flow is named.
 * Pre-v8.56 state files with `triage.acMode` are hoisted to
 * `triage.ceremonyMode` on read; see `flow-state.ts > rewriteLegacyAcMode`.
 */
export interface TriageDecision {
  complexity: RoutingClass;
  /**
   * TDD ceremony mode for the flow: `inline` (trivial; no plan, single
   * commit), `soft` (one TDD cycle per feature, plain commits), or
   * `strict` (per-criterion RED → GREEN → REFACTOR with posture-driven
   * commit prefixes the reviewer verifies ex-post). Selected at triage;
   * immutable for the flow's lifetime. v8.56 rename of `acMode`; legacy
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
   * field stays in the schema as optional so v8.0-v8.43 state files
   * still validate on read; new flows should leave it absent and let
   * the audit log carry the signal. Slated for removal once no
   * supported flow-state.json schema version writes it.
   */
  userOverrode?: boolean;
  /**
   * Step-by-step (default) or autopilot. Persisted across resumes so the
   * user only picks once per flow.
   *
   * Optional in TypeScript so v8.2 state files (which lack `runMode`) still
   * validate; readers MUST default to `step` on absent (non-inline paths).
   *
   * On v8.14+ flows that take the inline / trivial path, `runMode` is
   * written as `null` because there are no stages to chain — the
   * step-vs-auto choice is structurally meaningless when
   * `triage.path == ["build"]`.
   */
  runMode?: RunMode | null;
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
   */
  assumptions?: string[] | null;
  /**
   * Interpretation forks recorded at Hop 2.5 (sub-step before the
   * assumptions question). **Legacy field.** On pre-v8.14 flows the
   * orchestrator surfaced 2-4 distinct interpretations of an ambiguous
   * prompt and let the user pick. v8.14+ handles ambiguity inside the
   * `design` specialist's Phase 1 (Clarify), which can ask live follow-up
   * questions instead of relying on a one-shot fork list. The field stays
   * in the schema so legacy state files validate; new flows leave it
   * `null`/absent and lean on design Phase 1 instead.
   *
   * Each entry is the verbatim chosen-interpretation sentence (so
   * downstream specialists see the user's framing, not the orchestrator's
   * paraphrase). When the prompt was unambiguous and forks were not
   * surfaced, the field is `null` or absent.
   */
  interpretationForks?: string[] | null;
  /**
   * `true` only on the v8.14 zero-question fast path: trivial complexity
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
   * compat with v8.14-v8.43 state files.
   */
  autoExecuted?: boolean | null;
  /**
   * v8.18 — prior shipped slugs whose tag/surface profile matched the
   * current task at triage time. Populated by the orchestrator between
   * Hop 2 (triage persistence) and Hop 2.5 (pre-flight) via
   * `findNearKnowledge(triage.taskSummary, …)`. Read by `design`,
   * `ac-author`, and `reviewer` as background context (the spec calls them
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
   */
  priorLearnings?: unknown[] | null;
  /**
   * v8.20 — `true` when the user picked `keep-iterating-anyway` at the
   * 5-iteration review cap, which reset `reviewCounter` to 3 and bought
   * two more review rounds. Telemetry stamp so a future "why did this
   * flow take 7 review iterations?" audit can answer without re-reading
   * the entire iteration log.
   *
   * Optional, defaults to absent / `false`. Set exactly once per flow at
   * the moment the override picker fires; never cleared by ship.
   * Backward compat: v8.19 state files without the field validate
   * unchanged.
   *
   * @deprecated v8.44 — write-only audit telemetry relocated to
   * `.cclaw/state/triage-audit.jsonl` (see `src/triage-audit.ts >
   * appendTriageAudit`). The "did the user buy two extra review
   * rounds?" signal now lives in the audit log entry's
   * `iterationOverride` column. Field kept in schema for backward
   * compat with v8.20-v8.43 state files; new orchestrator prompts
   * append an audit line at the moment the override picker fires
   * instead of writing here.
   */
  iterationOverride?: boolean | null;
  /**
   * v8.23 — set when Hop 1 (Detect) auto-downgraded `ceremonyMode` because the
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
   * v8.43 — set by the orchestrator when the user picks
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
   */
  criticOverride?: boolean;
  /**
   * v8.43 — free-text per-decision notes attached to the triage. The
   * critic uses this to record skip rationale (e.g. the
   * `docs-only-trivial` exemption skip reason cited in
   * `.cclaw/lib/agents/critic.md > Skip conditions`). Originally
   * referenced in prose as `triageNotes` in the v8.42 critic prompt;
   * v8.43 lifts it into the canonical `triage.notes` slot on the
   * `TriageDecision` so the field has a declared home and a typed
   * validator entry.
   *
   * Optional, omitted on flows with nothing to record. Validators
   * accept only `string` when present; `null` is rejected to keep the
   * "absent = no note" semantics unambiguous. Pre-v8.43 flows without
   * the field validate unchanged.
   */
  notes?: string;
  /**
   * v8.52 — surfaces this slug touches, populated by the orchestrator
   * at Hop 2 from the task description plus the touched-files signal.
   * Drives the v8.52 qa-runner gate: qa dispatches only when
   * `surfaces` includes `"ui"` or `"web"` AND `ceremonyMode != "inline"`.
   * See {@link Surface} for the vocabulary.
   *
   * Multiple values per slug are expected — a /cc that builds an HTTP
   * endpoint plus a Vue component emits `["api", "ui"]`. The orchestrator
   * writes the union of detected surfaces, not a single primary
   * classification.
   *
   * Backwards compat: when absent or empty, the orchestrator and the
   * qa gate treat the slug as `["other"]` (no QA gating). Pre-v8.52
   * state files without this field validate unchanged.
   */
  surfaces?: Surface[];
}

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
