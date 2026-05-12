export const FLOW_STAGES = ["plan", "build", "review", "ship"] as const;
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

export const SPECIALISTS = [
  ...DISCOVERY_SPECIALISTS,
  "reviewer",
  "security-reviewer",
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

export type ReviewerMode = "code" | "text-review" | "integration" | "release" | "adversarial";
export type SecurityReviewerMode = "threat-model" | "sensitive-change";
export type SliceBuilderMode = "build" | "fix-only";

export type ArtifactStatus = "active" | "shipped";
export type AcceptanceCriterionStatus = "pending" | "committed";

export type TddPhase = "red" | "green" | "refactor";

export interface TddPhaseRecord {
  sha?: string;
  skipped?: boolean;
  reason?: string;
}

/**
 * v8.36 — per-AC `posture` annotation (everyinc-compound pattern).
 *
 * The ac-author stamps one of these six values on every AC stanza in
 * `plan.md` frontmatter. Slice-builder reads `posture` and selects the
 * commit ceremony; commit-helper.mjs uses it as the routing key for
 * the per-phase gate; reviewer uses it to scope posture-specific
 * checks (e.g. tests-as-deliverable skips the strict TDD-integrity
 * check because tests ARE the deliverable, not a precondition for
 * production code).
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

export function isPosture(value: unknown): value is Posture {
  return typeof value === "string" && (POSTURES as readonly string[]).includes(value);
}

export interface AcceptanceCriterionState {
  id: string;
  text: string;
  commit?: string;
  status: AcceptanceCriterionStatus;
  phases?: Partial<Record<TddPhase, TddPhaseRecord>>;
  /**
   * v8.36 — per-AC posture annotation. Absent means
   * {@link DEFAULT_POSTURE} ("test-first"). Validators reject unknown
   * string values.
   */
  posture?: Posture;
}

export type BuildProfile = "default" | "bootstrap";

export const ROUTING_CLASSES = ["trivial", "small-medium", "large-risky"] as const;
export type RoutingClass = (typeof ROUTING_CLASSES)[number];

/**
 * AC traceability and TDD enforcement modes (v8.2+).
 *
 * - `inline`: trivial change. No AC table, no commit hook, optional tests.
 * - `soft`: small/medium feature work. Bullet-list testable conditions in
 *   `plan.md` (no AC IDs); commit-helper does not block; one TDD cycle per
 *   feature is enough. Default for small/medium routing.
 * - `strict`: large/risky / security-flagged. AC IDs with commit trace,
 *   ship gate, RED → GREEN → REFACTOR per AC. Same as v8.1 behaviour.
 *
 * Selected at the triage gate; user can override.
 */
export const AC_MODES = ["inline", "soft", "strict"] as const;
export type AcMode = (typeof AC_MODES)[number];

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
 */
export interface TriageDecision {
  complexity: RoutingClass;
  acMode: AcMode;
  /** Stages the orchestrator promised to run, in order. Empty for trivial. */
  path: FlowStage[];
  /** Why this complexity was chosen. One short sentence. */
  rationale: string;
  /** ISO timestamp when triage was recorded. */
  decidedAt: string;
  /** Did the user override the orchestrator's recommendation? */
  userOverrode: boolean;
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
   */
  iterationOverride?: boolean | null;
  /**
   * v8.23 — set when Hop 1 (Detect) auto-downgraded `acMode` because the
   * project lacks a usable VCS. Today the only value is `"no-git"`, which
   * means the orchestrator detected the absence of `.git/` at projectRoot
   * and forced `acMode` from `strict` to `soft` (strict requires AC trace
   * commits, which require git). The field is purely informational — it
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
}

export interface CliContext {
  cwd: string;
  stdout: NodeJS.WriteStream;
  stderr: NodeJS.WriteStream;
}
