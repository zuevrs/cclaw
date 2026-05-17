import {
  CEREMONY_MODES,
  FLOW_STAGES,
  POSTURES,
  RESEARCH_LENSES,
  RESEARCH_MODES,
  RESEARCH_STATES,
  ROUTING_CLASSES,
  RUN_MODES,
  SPECIALISTS,
  SURFACES,
  TASK_SHAPES,
  type AcceptanceCriterionState,
  type BuildProfile,
  type CeremonyMode,
  type CriticEscalation,
  type CriticVerdict,
  type FlowStage,
  type PlanCriticVerdict,
  type Posture,
  type QaEvidenceTier,
  type QaVerdict,
  type ResearchApproach,
  type ResearchLensId,
  type ResearchMode,
  type ResearchRevision,
  type ResearchState,
  type RoutingClass,
  type RunMode,
  type SliceId,
  type SliceState,
  type SpecialistId,
  type Surface,
  type TaskShape,
  type TriageDecision
} from "./types.js";

const CRITIC_VERDICTS = ["pass", "iterate", "block-ship"] as const;
const CRITIC_ESCALATIONS = ["none", "light", "full"] as const;
const PLAN_CRITIC_VERDICTS = ["pass", "revise", "cancel"] as const;
const QA_VERDICTS = ["pass", "iterate", "blocked"] as const;
const QA_EVIDENCE_TIERS = ["playwright", "browser-mcp", "manual"] as const;
const SLICE_STATUSES = ["pending", "in-progress", "implemented", "verified", "skipped"] as const;

function isSliceStatus(value: unknown): value is SliceState["status"] {
  return typeof value === "string" && (SLICE_STATUSES as readonly string[]).includes(value);
}

function isPosture(value: unknown): value is Posture {
  return typeof value === "string" && (POSTURES as readonly string[]).includes(value);
}

function isCriticVerdict(value: unknown): value is CriticVerdict {
  return typeof value === "string" && (CRITIC_VERDICTS as readonly string[]).includes(value);
}

function isCriticEscalation(value: unknown): value is CriticEscalation {
  return typeof value === "string" && (CRITIC_ESCALATIONS as readonly string[]).includes(value);
}

function isPlanCriticVerdict(value: unknown): value is PlanCriticVerdict {
  return typeof value === "string" && (PLAN_CRITIC_VERDICTS as readonly string[]).includes(value);
}

function isQaVerdict(value: unknown): value is QaVerdict {
  return typeof value === "string" && (QA_VERDICTS as readonly string[]).includes(value);
}

function isQaEvidenceTier(value: unknown): value is QaEvidenceTier {
  return typeof value === "string" && (QA_EVIDENCE_TIERS as readonly string[]).includes(value);
}

function isSurface(value: unknown): value is Surface {
  return typeof value === "string" && (SURFACES as readonly string[]).includes(value);
}

function isResearchMode(value: unknown): value is ResearchMode {
  return typeof value === "string" && (RESEARCH_MODES as readonly string[]).includes(value);
}

function isResearchState(value: unknown): value is ResearchState {
  return typeof value === "string" && (RESEARCH_STATES as readonly string[]).includes(value);
}

function isResearchLens(value: unknown): value is ResearchLensId {
  return typeof value === "string" && (RESEARCH_LENSES as readonly string[]).includes(value);
}

/**
 * v8.77: narrow check for the {@link TaskShape} enum. Used by
 * {@link assertTriageOrNull} to validate `triage.taskShape` on read.
 * Pre-v8.77 state files lack the field; readers default to `"build"`
 * via the optional type signature (the validator only runs when the
 * field is present).
 */
function isTaskShape(value: unknown): value is TaskShape {
  return typeof value === "string" && (TASK_SHAPES as readonly string[]).includes(value);
}

const RESEARCH_REVISION_KINDS = ["revise", "push-back", "accept"] as const;

function isResearchRevisionKind(value: unknown): value is ResearchRevision["kind"] {
  return typeof value === "string" && (RESEARCH_REVISION_KINDS as readonly string[]).includes(value);
}

export const FLOW_STATE_SCHEMA_VERSION = 3;

/** v8.0–schema. Auto-migrated to v3 on read. */
export const LEGACY_V8_FLOW_STATE_SCHEMA_VERSION = 2;

export interface FlowStateV82 {
  schemaVersion: typeof FLOW_STATE_SCHEMA_VERSION;
  currentSlug: string | null;
  currentStage: FlowStage | null;
  ac: AcceptanceCriterionState[];
  /**
   * Plan slices (work units) authored by the architect in
   * strict-mode plan.md. Distinct from {@link ac} (acceptance
   * criteria are verification; slices are work units). The builder
   * runs TDD per slice (commit prefix `<type>(SL-N): ...`); after
   * all slices land, the builder writes `verify(AC-N): passing`
   * commits to prove each AC.
   *
   * Optional in TypeScript: pre-v8.63 state files lack this field
   * entirely and continue to validate on read (clean break — only
   * new strict-mode flows starting at v8.63 emit slices). Soft/inline
   * flows do not populate slices either; the field stays absent.
   *
   * Validators on read accept the legacy permissive shape: each entry
   * MUST be an object with string `id` / `title`, an array of valid
   * {@link Surface} tokens, a `dependsOn` array of strings, a boolean
   * `independent`, and a {@link SliceStatus} `status`. Optional
   * `commit` / `posture` / `verifiesAcIds` are checked only when
   * present.
   */
  slices?: SliceState[];
  /**
   * Most recent specialist dispatch (audit / debugging surface; the
   * orchestrator's stage routing reads {@link currentStage}, not this
   * field). Typed as `SpecialistId` for new writes — the orchestrator
   * only writes current specialist ids — but the runtime validator
   * accepts any string for permissive reads of pre-v8.62 state files
   * (which may carry `"design"`, `"ac-author"`, `"slice-builder"`, or
   * `"security-reviewer"`). Callers that narrow further should use
   * {@link isSpecialist}; callers that only need the audit trail can
   * treat the field as `string | null`.
   */
  lastSpecialist: SpecialistId | null;
  startedAt: string;
  /**
   * Total reviewer dispatches in this flow's lifetime. Monotonically
   * increasing; never reset by user. Drives `review.md` Run summary,
   * compound-stage telemetry, and `ship.md` frontmatter.
   */
  reviewIterations: number;
  securityFlag: boolean;
  buildProfile?: BuildProfile;
  /**
   * cap-tracker that may be reset by the user. Increments on
   * every reviewer dispatch in parallel with {@link reviewIterations}.
   * When it reaches 5 the orchestrator does not dispatch another
   * reviewer until the user picks an option from the review-cap picker
   * (`cancel-and-replan` / `accept-warns-and-ship` / `keep-iterating-
   * anyway`). The third option resets `reviewCounter` to 3 — giving two
   * more rounds — and stamps `triage.iterationOverride: true` so the
   * extension is auditable.
   *
   * Optional in TypeScript so state files (which lack the field)
   * still validate; readers MUST default to `0` on absent. flows
   * resumed on start at 0 even if `reviewIterations` already
   * reflects prior dispatches — the cap is a fresh budget on resume,
   * which is the intentionally permissive fallback.
   */
  reviewCounter?: number;
  /**
   * counts critic dispatches for the active flow.
   *
   * Hard-capped at 2 (initial dispatch + at-most-one rerun when the user
   * picks `fix and re-review` at the block-ship picker). A third dispatch
   * is structurally not supported and triggers the critic-cap-reached
   * picker, mirroring the v8.20 5-iteration cap for reviewer.
   *
   * Optional in TypeScript so state files (which lack the field)
   * still validate; readers MUST default to `0` on absent. Distinct from
   * {@link reviewIterations} — critic dispatches do not increment the
   * reviewer counter, by design (see `.cclaw/flows/v842-critic-design/
   * design.md §9.0`).
   */
  criticIteration?: number;
  /**
   * verdict returned by the most-recent critic dispatch.
   *
   * `pass`/`iterate` allow the orchestrator to advance to Hop 5 (ship);
   * `block-ship` pauses for the user's block-ship picker. Absence means
   * critic has not run yet (legacy pre-v8.42 state or a freshly-created
   * flow). The flow-state reader uses absence + `currentStage: "review"`
   * + `lastSpecialist: "reviewer"` as the pre-v8.42 migration signal.
   */
  criticVerdict?: CriticVerdict;
  /**
   * open-gap count (severity != `fyi`) from the most-recent
   * critic dispatch. Surfaced in `ship.md > Risks carried over` for
   * `iterate` verdicts; otherwise advisory.
   */
  criticGapsCount?: number;
  /**
   * escalation level from the most-recent critic dispatch.
   *
   * `none` = pure gap mode; `light` = one §8 trigger fired in soft mode;
   * `full` = `adversarial` mode (strict mode + any §8 trigger). The
   * orchestrator stamps this for telemetry / compound-learning audit.
   */
  criticEscalation?: CriticEscalation;
  /**
   * verdict returned by the most-recent plan-critic dispatch.
   *
   * `pass` — plan was approved; advance to builder.
   * `revise` — bounce to architect for one revise loop (max).
   * `cancel` — structural plan problem; surface cancel/re-architect picker.
   *
   * Absence means plan-critic has not run yet (either pre-v8.51 state,
   * gating excluded the flow, or the dispatch hasn't fired). The
   * orchestrator's deterministic gate (ceremonyMode=strict + complexity=
   * large-risky + problemType!=refines + AC count>=2) is the canonical
   * "should this slug have a verdict?" check; downstream code branches
   * on presence + value, never on absence-as-implicit-pass.
   */
  planCriticVerdict?: PlanCriticVerdict | null;
  /**
   * counts plan-critic dispatches for the active flow.
   *
   * Hard-capped at 1: initial dispatch (=0 before fire / =1 after the
   * first return), at-most-one rerun on a `revise` verdict (=1 after
   * the second dispatch). A third dispatch is structurally not allowed
   * — the orchestrator surfaces the user picker instead of running
   * plan-critic for the third time.
   *
   * Optional in TypeScript so pre-v8.51 state files (which lack the
   * field) still validate; readers MUST default to `0` on absent.
   * Distinct from {@link criticIteration} — plan-critic dispatches do
   * not increment the post-impl critic counter, by design (different
   * stages, different verdicts).
   */
  planCriticIteration?: number;
  /**
   * ISO timestamp of the most-recent plan-critic dispatch.
   *
   * Stamped by the orchestrator immediately after the slim summary
   * returns (alongside `planCriticVerdict` / `planCriticIteration`).
   * Pure telemetry; downstream code does not branch on the value.
   *
   * Optional in TypeScript so pre-v8.51 state files (which lack the
   * field) still validate; absent means plan-critic never ran for
   * this slug.
   */
  planCriticDispatchedAt?: string;
  /**
   * verdict returned by the most-recent qa-runner dispatch.
   *
   * `pass` — every UI AC has evidence (Playwright / browser-MCP /
   *   manual-confirmed); advance to review.
   * `iterate` — at least one UI AC failed verification; bounce to
   *   builder with qa findings as additional context, max 1
   *   iteration enforced by {@link qaIteration}.
   * `blocked` — browser tooling unavailable AND manual steps required;
   *   surface user picker (`proceed-without-qa-evidence` /
   *   `pause-for-manual-qa` / `skip-qa`).
   *
   * Absence means qa-runner has not run yet (either pre-v8.52 state,
   * gating excluded the flow on non-UI surface, ceremonyMode=inline, or the
   * dispatch hasn't fired). `null` is explicitly accepted because the
   * orchestrator may write `null` to mark "qa ran but the slim summary
   * forgot the verdict" recovery cases — distinguishing absent-vs-null
   * matters for the resume picker.
   */
  qaVerdict?: QaVerdict | null;
  /**
   * counts qa-runner dispatches for the active flow.
   *
   * Hard-capped at 1: initial dispatch (=0 before fire / =1 after the
   * first return) and at-most-one rerun on an `iterate` verdict (=1
   * after the second dispatch). A third dispatch is structurally not
   * allowed — the orchestrator surfaces the user picker instead of
   * running qa for the third time.
   *
   * Optional in TypeScript so pre-v8.52 state files (which lack the
   * field) still validate; readers MUST default to `0` on absent.
   * Distinct from {@link reviewIterations} and {@link criticIteration};
   * qa dispatches do not increment any other counter.
   */
  qaIteration?: number;
  /**
   * ISO timestamp of the most-recent qa-runner dispatch.
   *
   * Stamped by the orchestrator immediately after the slim summary
   * returns (alongside {@link qaVerdict} / {@link qaIteration} /
   * {@link qaEvidenceTier}). Pure telemetry; downstream code does not
   * branch on the value.
   *
   * Optional in TypeScript so pre-v8.52 state files (which lack the
   * field) still validate; absent means qa-runner never ran for this
   * slug.
   */
  qaDispatchedAt?: string;
  /**
   * evidence tier the qa-runner declared in its slim summary,
   * mirrored from `qa.md` frontmatter. Drives the reviewer's
   * `qa-evidence` axis: `playwright` is the strongest tier (CI-runnable
   * test), `browser-mcp` is reviewable but session-bound, `manual` is
   * the weakest tier (user-confirmed steps only).
   *
   * `null` is accepted because the orchestrator may write `null` on a
   * `blocked` verdict where no tier was actually exercised (e.g.
   * browser tools unavailable + manual steps queued for the user).
   * Pre-v8.52 state files validate unchanged when absent.
   */
  qaEvidenceTier?: QaEvidenceTier | null;
  /**
   * Triage decision for the active flow. Null while no flow is running.
   * Persisted so resume never re-prompts the user.
   */
  triage: TriageDecision | null;
  /**
   * pointer to a prior `/cc research <topic>` flow whose
   * `research.md` should be loaded as context by the active task
   * flow's triage / architect. Written by the orchestrator at Hop 0
   * (Detect) when the user accepts the optional "ready to plan?"
   * handoff that the standalone architect (research mode) emits at
   * the tail of a research flow; cleared automatically when the
   * task flow ships.
   *
   * Shape:
   *   - `slug`: the research flow's slug (e.g. `2026-05-15-research-foo`)
   *     so the artifact path can be reconstructed
   *     (`.cclaw/flows/<slug>/research.md`).
   *   - `topic`: the research topic line, for surfacing in pickers
   *     and prompts (e.g. "Storage strategy for shared agent memory").
   *   - `path`: the absolute artifact path; redundant with `slug`
   *     but cached for fast surfacing without rebuilding the path.
   *
   * Optional in TypeScript: pre-v8.58 state files lack the field and
   * MUST validate unchanged; readers default to `null`/absent meaning
   * "no prior research linked". Distinct from a research-mode flow's
   * own state (which lives in the same `currentSlug` slot; the
   * research-vs-task distinction is recorded via `triage.mode`, not
   * via a separate slug field).
   */
  priorResearch?: {
    slug: string;
    topic: string;
    path: string;
  } | null;
  /**
   * pointer to a prior **shipped** slug whose plan/build/learnings
   * (and optional review/critic/qa) should be loaded as context by the
   * active task flow's architect / reviewer / critic. Stamped
   * by the orchestrator at Hop 0 (Detect) when the user invokes
   * `/cc extend <slug> <task>`; cleared automatically when the task
   * flow ships.
   *
   * Shape:
   *   - `slug`: the parent flow's slug (e.g. `20260514-auth-flow`), so
   *     specialists can rebuild artifact paths if needed.
   *   - `status`: `"shipped"` is the only valid value in v8.59. The
   *     `/cc extend` validator rejects in-flight / cancelled / missing
   *     parents at the entry point, so by the time this field is
   *     stamped the parent's shipped status is guaranteed. The field
   *     is preserved as a string union (not a literal) so v8.60+ can
   *     widen the validator (e.g. to support in-flight parents) without
   *     a schema bump.
   *   - `shippedAt`: best-effort ISO timestamp from the parent's
   *     `ship.md > frontmatter.shipped_at`. Optional because legacy
   *     shipped slugs may have authored `ship.md` without the field.
   *   - `artifactPaths`: pre-derived absolute paths to the parent's
   *     shipped artifacts. `plan` is mandatory (its presence was the
   *     validation gate at `/cc extend`); `build` / `review` / `critic`
   *     / `learnings` / `qa` are optional because they may be absent
   *     depending on the parent's path (e.g. an inline-mode parent
   *     has no `review.md`). Specialists `await exists(path)` before
   *     reading — a parent artifact that disappears between extend
   *     and dispatch is a no-op skip, not an error.
   *
   * Optional in TypeScript: pre-v8.59 state files lack the field and
   * MUST validate unchanged; readers default to `null`/absent meaning
   * "no parent linked, this is a cold-start /cc flow". Distinct from
   * {@link priorResearch} (the research→task handoff): the two
   * fields are orthogonal and can coexist on a single flow (a `/cc
   * extend <slug>` flow that also happens to follow a `/cc research`
   * ship picks up BOTH context sources).
   *
   * Design rationale lives at `.cclaw/flows/v859-continuation/design.md`.
   */
  parentContext?: ParentContext | null;
  /**
   * Research orchestrator lifecycle state. Set ONLY on
   * research-mode flows (`triage.mode == "research"`); absent on
   * `task` mode. The orchestrator's research-mode fork stamps this
   * field at every Phase boundary so a `/cc` continue after a
   * stop-and-report can resume the research lifecycle without
   * re-parsing `research.md`. See {@link ResearchState} for the
   * full state vocabulary and transitions.
   *
   * Pre-v8.71 research-mode state files lack this field; readers
   * MUST default to `null`/absent for back-compat. Pre-v8.71 research
   * flows ran the four-phase straight-line shape (discovery →
   * lens-dispatch → synthesis → finalize) without an explicit
   * lifecycle marker — resume on a stopped pre-v8.71 research flow
   * is a no-op (the orchestrator restarts from Phase 1 with the
   * dialogue summary on disk).
   */
  researchState?: ResearchState | null;
  /**
   * Append-only revision history for `/cc research` iterations
   * (introduced in v8.71; pre-v8.71 state files lack this field and
   * readers must treat it as an empty array for back-compat). Each
   * entry records one revise / push-back / accept invocation; the
   * array is the persistent audit trail mirrored verbatim under
   * `research.md > ## Revision history`. New writes append to the
   * array; entries are NEVER mutated or removed
   * (the orchestrator overwrites `change` on the next post-revision
   * synthesis pass only when the entry's prior `change` was absent).
   *
   * Set ONLY on research-mode flows. Pre-v8.71 state files lack
   * this field; readers MUST default to `[]` on absent. Cap: no
   * structural cap (the user can iterate as many times as they
   * want; the synthesis self-review pass surfaces a "high-iteration
   * warning" in the recommended-next-step paragraph after the 5th
   * revision).
   */
  revisions?: ResearchRevision[];
  /**
   * Candidate framings surfaced at the v8.76 Approaches Gate (research
   * mode Phase 1.5 — between Phase 1 discovery dialogue and Phase 2
   * lens dispatch). The orchestrator distils 2-3 framings from the
   * dialogue summary, surfaces them to the user, and stamps the array
   * here before the gate fires. See {@link ResearchApproach} for the
   * field semantics + worked example.
   *
   * Set ONLY on research-mode flows. Pre-v8.76 state files lack this
   * field; readers MUST default to absent / empty (`[]`). Pre-v8.76
   * research flows dispatched lenses against an implicit single
   * framing (whatever the orchestrator settled on during dialogue
   * distillation) — the absence of this field on legacy state is the
   * canonical "pre-Approaches-Gate" signal, not an error.
   *
   * Immutable for the flow's lifetime once stamped — re-framings are
   * surfaced as `/cc research push-back` invocations on the existing
   * v8.71 push-back machinery, NOT by mutating this array. The
   * audit trail keeps the original framings visible.
   */
  approaches?: ResearchApproach[];
  /**
   * Indices into {@link FlowStateV82.approaches} that the user
   * selected at the Approaches Gate. Stamped immediately after the
   * user's pick (or after the orchestrator stamps the default "all"
   * selection — every framing flows to every lens). The orchestrator
   * carries the selected framings forward in every lens dispatch
   * envelope as `framing: string[]` (the title-or-summary strings the
   * lenses see, not the indices).
   *
   * Conventions:
   *
   * - A non-empty array of zero-based indices into `approaches[]` (eg.
   *   `[0, 2]` selects framings A and C from a 3-framing surface).
   * - An array equal to `[0..approaches.length - 1]` (every index)
   *   is the canonical "all" selection — the orchestrator stamps
   *   this verbatim when the user says "all" or accepts the default.
   *   Readers MUST NOT special-case empty arrays as "all"; empty is
   *   reserved for back-compat with pre-v8.76 state files only.
   *
   * Set ONLY on research-mode flows. Pre-v8.76 state files lack this
   * field; readers MUST default to absent. Immutable once stamped
   * (re-selection is a `/cc research push-back` invocation, not a
   * mutation of this array).
   */
  selectedApproaches?: number[];
  /**
   * Slice ids whose sub-builder worktree branch failed to
   * fast-forward merge back into the parent after the per-slice TDD
   * cycle completed (see `src/slice-worktree.ts > mergeSliceWorktree`).
   *
   * The orchestrator stamps this field when {@link mergeSliceWorktree}
   * returns `false` on any slice in a parallel layer. A non-empty
   * array contaminates the dispatch-level builder Status to `BLOCKED`
   * (v8.68 protocol) and triggers the stop-and-report surface in
   * `runbooks/always-auto-failure-handling.md` with the failing
   * slice ids verbatim. Recovery is via `/cc` continue (after the
   * user resolves the merge by hand or accepts the partial landing)
   * or `/cc-cancel`.
   *
   * Optional + back-compat: pre-v8.73 strict flows ran every layer
   * in the shared working tree (no merge step), so readers MUST
   * tolerate absent values and treat them as the empty array. Cleared
   * at ship by the compound layer and at cancel by the cancel layer
   * (alongside the per-slice worktree teardown).
   */
  slice_merge_failures?: SliceId[];
}

/**
 * orchestrator-level pointer to a parent shipped slug, set when
 * the user invokes `/cc extend <slug> <task>`. See
 * {@link FlowStateV82.parentContext} for the full semantics.
 *
 * The `status` field is a string union (not a literal) so v8.60+ can
 * widen the validator without a schema bump. v8.59's validator accepts
 * `"shipped"` only.
 */
export interface ParentContext {
  slug: string;
  status: "shipped";
  shippedAt?: string;
  artifactPaths: ParentArtifactPaths;
}

/**
 * pre-derived absolute paths to a parent's shipped artifacts.
 * `plan` is mandatory (its presence was the validation gate); every
 * other field is optional because the parent may have shipped with a
 * shorter path (e.g. inline mode has no `review.md`).
 *
 * Specialists `await exists(path)` before reading — a parent artifact
 * that disappears between `/cc extend` and the first dispatch is a
 * no-op skip, not an error.
 */
export interface ParentArtifactPaths {
  plan: string;
  build?: string;
  review?: string;
  critic?: string;
  learnings?: string;
  qa?: string;
}

export type FlowState = FlowStateV82;

/** @deprecated alias preserved for v8.1 import sites. Use {@link FlowStateV82}. */
export type FlowStateV8 = FlowStateV82;

export class LegacyFlowStateError extends Error {
  constructor(message: string, public readonly observedSchemaVersion: unknown) {
    super(message);
    this.name = "LegacyFlowStateError";
  }
}

export function isFlowStage(value: unknown): value is FlowStage {
  return typeof value === "string" && (FLOW_STAGES as readonly string[]).includes(value);
}

export function isRoutingClass(value: unknown): value is RoutingClass {
  return typeof value === "string" && (ROUTING_CLASSES as readonly string[]).includes(value);
}

export function isCeremonyMode(value: unknown): value is CeremonyMode {
  return typeof value === "string" && (CEREMONY_MODES as readonly string[]).includes(value);
}

/**
 * @deprecated v8.56 — use {@link isCeremonyMode}. Kept as an alias so
 * pre-v8.56 import sites continue to work. Slated for removal once one
 * full release cycle has aged out external imports.
 */
export const isAcMode = isCeremonyMode;

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value);
}

/**
 * Narrow check for the (now single) discovery specialist. v8.62 collapsed
 * `design` + `ac-author` into `architect`, so this predicate now matches
 * exactly one id. Kept for backward compatibility with callers that only
 * care about discovery sub-phase routing; new state-validation paths
 * should use {@link isSpecialist}.
 */
export function isDiscoverySpecialist(value: unknown): value is "architect" {
  return value === "architect";
}

/**
 * Retired discovery / plan-phase specialist ids. Recognise the legacy
 * ids so migration paths can rewrite them to `null` (forcing the
 * orchestrator to re-dispatch `architect` from scratch) instead of
 * crashing on read.
 *
 * - `brainstormer` (v8.14): retired discovery-side specialist; pre-v8.14
 *   state files may still carry it.
 * - `design` (v8.62): retired; the Phase 0/2-6 work absorbed into
 *   `architect`. Pre-v8.62 strict-path state files may still carry it.
 * - `ac-author` (v8.62): retired; the Plan/AC/Spec authoring absorbed
 *   into `architect`. Pre-v8.62 soft- and strict-path state files may
 *   still carry it.
 *
 * NOTE: `architect` is the **current** specialist post-v8.62; it is NOT
 * a legacy id and the predicate intentionally excludes it.
 */
export function isLegacyDiscoverySpecialist(
  value: unknown
): value is "brainstormer" | "design" | "ac-author" {
  return value === "brainstormer" || value === "design" || value === "ac-author";
}

/**
 * v8.28 renamed the `planner` specialist to `ac-author`. v8.62 retired
 * `ac-author` (absorbed into `architect`). Recognise the legacy id on
 * read so {@link rewriteLegacyPlanner} can reset `lastSpecialist` to
 * `null` and let the orchestrator re-dispatch the current specialist
 * roster from scratch. Mirrors the v8.62 behaviour of
 * {@link rewriteLegacyDiscoverySpecialist} (also resets to `null`).
 *
 * See {@link LEGACY_PLANNER_ID} in `types.ts` for the canonical
 * single-source spelling of the old name.
 */
export function isLegacyPlanner(value: unknown): value is "planner" {
  return value === "planner";
}

export function isSpecialist(value: unknown): value is SpecialistId {
  return typeof value === "string" && (SPECIALISTS as readonly string[]).includes(value);
}

export function createInitialFlowState(nowIso = new Date().toISOString()): FlowStateV82 {
  return {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    currentSlug: null,
    currentStage: null,
    ac: [],
    lastSpecialist: null,
    startedAt: nowIso,
    reviewIterations: 0,
    reviewCounter: 0,
    securityFlag: false,
    triage: null
  };
}

/** @deprecated kept for source-level compatibility with v8.1 imports. */
export const createInitialFlowStateV8 = createInitialFlowState;

/**
 * Infer a TriageDecision for a v2 (pre-8.2) state being migrated forward.
 *
 * v2 states never recorded a triage. To preserve their behaviour we map
 * them to `strict` ceremony mode (they relied on per-criterion TDD), with
 * complexity inferred from the AC count and security flag.
 */
function inferTriageFromLegacy(state: {
  ac: AcceptanceCriterionState[];
  securityFlag: boolean;
  startedAt: string;
}): TriageDecision {
  const acCount = state.ac.length;
  let complexity: RoutingClass;
  if (state.securityFlag || acCount > 5) {
    complexity = "large-risky";
  } else if (acCount > 0) {
    complexity = "small-medium";
  } else {
    complexity = "small-medium";
  }
  return {
    complexity,
    ceremonyMode: "strict",
    path: ["plan", "build", "review", "ship"],
    rationale: "Auto-migrated from cclaw 8.0/8.1 flow-state (no triage recorded; preserved as strict).",
    decidedAt: state.startedAt,
    userOverrode: false,
    runMode: "auto"
  };
}

function assertAcArray(value: unknown): asserts value is AcceptanceCriterionState[] {
  if (!Array.isArray(value)) throw new Error("flow-state.ac must be an array");
  for (const item of value) {
    if (typeof item !== "object" || item === null) throw new Error("flow-state.ac entries must be objects");
    const ac = item as Partial<AcceptanceCriterionState>;
    if (typeof ac.id !== "string" || typeof ac.text !== "string") {
      throw new Error("flow-state.ac entries require string id and text");
    }
    if (ac.status !== "pending" && ac.status !== "committed") {
      throw new Error(`Invalid AC status: ${String(ac.status)}`);
    }
    if (ac.phases !== undefined) {
      if (typeof ac.phases !== "object" || ac.phases === null) {
        throw new Error("flow-state.ac.phases must be an object when present");
      }
      for (const phaseKey of Object.keys(ac.phases)) {
        if (phaseKey !== "red" && phaseKey !== "green" && phaseKey !== "refactor") {
          throw new Error(`Invalid TDD phase key: ${phaseKey}`);
        }
      }
    }
    // optional back-reference to the slices that verify this AC.
    // Permissive: pre-v8.63 state files lack this field, and even
    // post-v8.63 soft/inline flows leave it absent.
    if (ac.verifiedBy !== undefined) {
      if (!Array.isArray(ac.verifiedBy)) {
        throw new Error("flow-state.ac.verifiedBy must be an array when present");
      }
      for (const sliceId of ac.verifiedBy) {
        if (typeof sliceId !== "string" || sliceId.length === 0) {
          throw new Error("flow-state.ac.verifiedBy entries must be non-empty strings");
        }
      }
    }
  }
}

/**
 * Validate `flow-state.slices` array. Permissive on read so pre-v8.63
 * state files (which lack the field entirely) continue to round-trip;
 * new strict-mode flows MUST emit slices when the architect's
 * plan.md contains a `## Plan / Slices` table.
 */
function assertSliceArray(value: unknown): asserts value is SliceState[] {
  if (!Array.isArray(value)) throw new Error("flow-state.slices must be an array when present");
  for (const item of value) {
    if (typeof item !== "object" || item === null) {
      throw new Error("flow-state.slices entries must be objects");
    }
    const slice = item as Partial<SliceState>;
    if (typeof slice.id !== "string" || slice.id.length === 0) {
      throw new Error("flow-state.slices entries require a non-empty string id");
    }
    if (typeof slice.title !== "string") {
      throw new Error("flow-state.slices entries require a string title");
    }
    if (!Array.isArray(slice.surface)) {
      throw new Error("flow-state.slices entries require a surface array");
    }
    for (const s of slice.surface) {
      if (!isSurface(s)) throw new Error(`Invalid slice.surface entry: ${String(s)}`);
    }
    if (!Array.isArray(slice.dependsOn)) {
      throw new Error("flow-state.slices entries require a dependsOn array");
    }
    for (const dep of slice.dependsOn) {
      if (typeof dep !== "string" || dep.length === 0) {
        throw new Error("flow-state.slices.dependsOn entries must be non-empty strings");
      }
    }
    if (typeof slice.independent !== "boolean") {
      throw new Error("flow-state.slices entries require boolean independent");
    }
    if (!isSliceStatus(slice.status)) {
      throw new Error(`Invalid slice.status: ${String(slice.status)}`);
    }
    if (slice.posture !== undefined && !isPosture(slice.posture)) {
      throw new Error(`Invalid slice.posture: ${String(slice.posture)}`);
    }
    if (slice.commit !== undefined && typeof slice.commit !== "string") {
      throw new Error("flow-state.slices.commit must be a string when present");
    }
    if (slice.verifiesAcIds !== undefined) {
      if (!Array.isArray(slice.verifiesAcIds)) {
        throw new Error("flow-state.slices.verifiesAcIds must be an array when present");
      }
      for (const acId of slice.verifiesAcIds) {
        if (typeof acId !== "string" || acId.length === 0) {
          throw new Error("flow-state.slices.verifiesAcIds entries must be non-empty strings");
        }
      }
    }
    if (slice.worktreePath !== undefined) {
      if (typeof slice.worktreePath !== "string" || slice.worktreePath.length === 0) {
        throw new Error(
          "flow-state.slices.worktreePath must be a non-empty string when present"
        );
      }
    }
  }
}

function assertTriageOrNull(value: unknown): asserts value is TriageDecision | null {
  if (value === null) return;
  if (typeof value !== "object") throw new Error("flow-state.triage must be an object or null");
  const triage = value as Partial<TriageDecision>;
  if (!isRoutingClass(triage.complexity)) {
    throw new Error(`Invalid triage.complexity: ${String(triage.complexity)}`);
  }
  if (!isCeremonyMode(triage.ceremonyMode)) {
    throw new Error(`Invalid triage.ceremonyMode: ${String(triage.ceremonyMode)}`);
  }
  if (!Array.isArray(triage.path)) {
    throw new Error("triage.path must be an array of stage names");
  }
  for (const stage of triage.path) {
    if (!isFlowStage(stage)) throw new Error(`Invalid triage.path stage: ${String(stage)}`);
  }
  if (typeof triage.rationale !== "string") throw new Error("triage.rationale must be a string");
  if (typeof triage.decidedAt !== "string") throw new Error("triage.decidedAt must be a string");
  if (
    triage.userOverrode !== undefined &&
    typeof triage.userOverrode !== "boolean"
  ) {
    throw new Error("triage.userOverrode must be a boolean or absent");
  }
  if (triage.runMode !== undefined && triage.runMode !== null && !isRunMode(triage.runMode)) {
    throw new Error(`Invalid triage.runMode: ${String(triage.runMode)}`);
  }
  // orchestrator stamps at Hop 1 (Detect) to record which entry point
  // started the flow. Pre-v8.58 state files lack the field; readers
  // default to `"task"` (the historical single-mode behaviour).
  if (triage.mode !== undefined && !isResearchMode(triage.mode)) {
    throw new Error(`Invalid triage.mode: ${String(triage.mode)} (expected "task" or "research" or absent)`);
  }
  if (
    triage.autoExecuted !== undefined &&
    triage.autoExecuted !== null &&
    typeof triage.autoExecuted !== "boolean"
  ) {
    throw new Error("triage.autoExecuted must be a boolean, null, or absent");
  }
  if (triage.assumptions !== undefined && triage.assumptions !== null) {
    if (!Array.isArray(triage.assumptions)) {
      throw new Error("triage.assumptions must be an array, null, or absent");
    }
    for (const entry of triage.assumptions) {
      if (typeof entry !== "string") {
        throw new Error("triage.assumptions entries must be strings");
      }
    }
  }
  if (triage.interpretationForks !== undefined && triage.interpretationForks !== null) {
    if (!Array.isArray(triage.interpretationForks)) {
      throw new Error("triage.interpretationForks must be an array, null, or absent");
    }
    for (const entry of triage.interpretationForks) {
      if (typeof entry !== "string") {
        throw new Error("triage.interpretationForks entries must be strings");
      }
    }
  }
  if (
    triage.iterationOverride !== undefined &&
    triage.iterationOverride !== null &&
    typeof triage.iterationOverride !== "boolean"
  ) {
    throw new Error("triage.iterationOverride must be a boolean, null, or absent");
  }
  if (
    triage.downgradeReason !== undefined &&
    triage.downgradeReason !== null &&
    typeof triage.downgradeReason !== "string"
  ) {
    throw new Error("triage.downgradeReason must be a string, null, or absent");
  }
  if (triage.priorLearnings !== undefined && triage.priorLearnings !== null) {
    if (!Array.isArray(triage.priorLearnings)) {
      throw new Error("triage.priorLearnings must be an array, null, or absent");
    }
    for (const entry of triage.priorLearnings) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("triage.priorLearnings entries must be objects");
      }
      const slug = (entry as { slug?: unknown }).slug;
      if (typeof slug !== "string" || slug.length === 0) {
        throw new Error("triage.priorLearnings entries must include a string slug");
      }
    }
  }
  if (triage.criticOverride !== undefined && typeof triage.criticOverride !== "boolean") {
    throw new Error("triage.criticOverride must be a boolean or absent");
  }
  if (triage.notes !== undefined && typeof triage.notes !== "string") {
    throw new Error("triage.notes must be a string or absent");
  }
  if (triage.surfaces !== undefined) {
    if (!Array.isArray(triage.surfaces)) {
      throw new Error("triage.surfaces must be an array of surface tokens or absent");
    }
    for (const entry of triage.surfaces) {
      if (!isSurface(entry)) {
        throw new Error(`Invalid triage.surfaces entry: ${String(entry)}`);
      }
    }
  }
  // v8.77: orthogonal task shape. Pre-v8.77 state files lack the field;
  // readers default to `"build"` (validator only runs when present).
  if (triage.taskShape !== undefined && !isTaskShape(triage.taskShape)) {
    throw new Error(
      `Invalid triage.taskShape: ${String(triage.taskShape)} (expected "build" | "debug" | "research" | absent)`
    );
  }
}

/**
 * Read a triage decision's pre-flight assumptions.
 *
 * Returns:
 * - `[]` when no pre-flight ran (legacy state, trivial path, or older
 *   `step`/`auto` flow-state with no assumptions field). Callers should
 *   treat this as "no captured assumptions, do not surface anything".
 * - the recorded array (possibly empty if the pre-flight ran but the user
 *   confirmed there were no assumptions to record — rare but valid).
 */
export function assumptionsOf(triage: TriageDecision | null | undefined): readonly string[] {
  const value = triage?.assumptions;
  if (value === null || value === undefined) return [];
  return value;
}

/**
 * Read a triage decision's runMode with the documented default.
 *
 * The user-facing `step` / `auto` choice was retired in v8.61; the
 * orchestrator no longer branches on this value. Pre-v8.61 state files
 * carrying `runMode: "step"` continue to validate via the optional type
 * signature (back-compat), but the helper always returns `"auto"` so
 * any remaining call site reads a single value. Inline paths still
 * write `runMode: null`; the helper folds null / undefined / "step"
 * alike to `"auto"`.
 */
export function runModeOf(_triage: TriageDecision | null | undefined): RunMode {
  return "auto";
}

/**
 * Validate a flow-state object. Throws on hard schema errors.
 *
 * v8.2 (schemaVersion=3) is the current shape. v8.0–v8.1 (schemaVersion=2)
 * states are auto-migrated forward in {@link readMigratedFlowState}; this
 * assertion expects the migrated shape.
 */
export function assertFlowStateV82(value: unknown): asserts value is FlowStateV82 {
  if (typeof value !== "object" || value === null) throw new Error("flow-state must be an object");
  const state = value as Partial<FlowStateV82> & { schemaVersion?: unknown; currentStage?: unknown };
  if (state.schemaVersion !== FLOW_STATE_SCHEMA_VERSION) {
    throw new LegacyFlowStateError(
      `Unsupported flow-state schema (saw ${String(state.schemaVersion)}, expected ${FLOW_STATE_SCHEMA_VERSION}). Run cclaw upgrade or delete .cclaw/state/flow-state.json to start fresh.`,
      state.schemaVersion
    );
  }
  if (state.currentSlug !== null && state.currentSlug !== undefined && typeof state.currentSlug !== "string") {
    throw new Error("flow-state.currentSlug must be a string or null");
  }
  if (state.currentStage !== null && state.currentStage !== undefined && !isFlowStage(state.currentStage)) {
    throw new Error(`Invalid currentStage: ${String(state.currentStage)}`);
  }
  assertAcArray(state.ac);
  if (state.slices !== undefined) {
    assertSliceArray(state.slices);
  }
  if (
    state.lastSpecialist !== null &&
    state.lastSpecialist !== undefined &&
    typeof state.lastSpecialist !== "string"
  ) {
    throw new Error(`flow-state.lastSpecialist must be a string or null`);
  }
  if (typeof state.startedAt !== "string") throw new Error("flow-state.startedAt must be a string");
  if (typeof state.reviewIterations !== "number" || state.reviewIterations < 0) {
    throw new Error("flow-state.reviewIterations must be a non-negative number");
  }
  if (state.reviewCounter !== undefined) {
    if (typeof state.reviewCounter !== "number" || state.reviewCounter < 0) {
      throw new Error("flow-state.reviewCounter must be a non-negative number when present");
    }
  }
  if (state.criticIteration !== undefined) {
    if (typeof state.criticIteration !== "number" || state.criticIteration < 0) {
      throw new Error("flow-state.criticIteration must be a non-negative number when present");
    }
  }
  if (state.criticVerdict !== undefined && !isCriticVerdict(state.criticVerdict)) {
    throw new Error(`Invalid criticVerdict: ${String(state.criticVerdict)}`);
  }
  if (state.criticGapsCount !== undefined) {
    if (typeof state.criticGapsCount !== "number" || state.criticGapsCount < 0) {
      throw new Error("flow-state.criticGapsCount must be a non-negative number when present");
    }
  }
  if (state.criticEscalation !== undefined && !isCriticEscalation(state.criticEscalation)) {
    throw new Error(`Invalid criticEscalation: ${String(state.criticEscalation)}`);
  }
  if (
    state.planCriticVerdict !== undefined &&
    state.planCriticVerdict !== null &&
    !isPlanCriticVerdict(state.planCriticVerdict)
  ) {
    throw new Error(`Invalid planCriticVerdict: ${String(state.planCriticVerdict)}`);
  }
  if (state.planCriticIteration !== undefined) {
    if (typeof state.planCriticIteration !== "number" || state.planCriticIteration < 0) {
      throw new Error("flow-state.planCriticIteration must be a non-negative number when present");
    }
    if (state.planCriticIteration > 1) {
      throw new Error(
        `flow-state.planCriticIteration must be 0 or 1 when present (one revise-loop cap); saw ${state.planCriticIteration}`
      );
    }
  }
  if (state.planCriticDispatchedAt !== undefined && typeof state.planCriticDispatchedAt !== "string") {
    throw new Error("flow-state.planCriticDispatchedAt must be a string or absent");
  }
  if (
    state.qaVerdict !== undefined &&
    state.qaVerdict !== null &&
    !isQaVerdict(state.qaVerdict)
  ) {
    throw new Error(`Invalid qaVerdict: ${String(state.qaVerdict)}`);
  }
  if (state.qaIteration !== undefined) {
    if (typeof state.qaIteration !== "number" || state.qaIteration < 0) {
      throw new Error("flow-state.qaIteration must be a non-negative number when present");
    }
    if (state.qaIteration > 1) {
      throw new Error(
        `flow-state.qaIteration must be 0 or 1 when present (one iterate-loop cap); saw ${state.qaIteration}`
      );
    }
  }
  if (state.qaDispatchedAt !== undefined && typeof state.qaDispatchedAt !== "string") {
    throw new Error("flow-state.qaDispatchedAt must be a string or absent");
  }
  if (
    state.qaEvidenceTier !== undefined &&
    state.qaEvidenceTier !== null &&
    !isQaEvidenceTier(state.qaEvidenceTier)
  ) {
    throw new Error(`Invalid qaEvidenceTier: ${String(state.qaEvidenceTier)}`);
  }
  if (typeof state.securityFlag !== "boolean") {
    throw new Error("flow-state.securityFlag must be a boolean");
  }
  if (state.buildProfile !== undefined && state.buildProfile !== "default" && state.buildProfile !== "bootstrap") {
    throw new Error(`Invalid buildProfile: ${String(state.buildProfile)}`);
  }
  assertTriageOrNull(state.triage);
  // explicit-cleared sentinel. When present-and-non-null it must be a
  // plain object with three string fields. Pre-v8.58 state files lack
  // the field entirely; readers default to `null`/absent.
  if (state.priorResearch !== undefined && state.priorResearch !== null) {
    if (typeof state.priorResearch !== "object" || Array.isArray(state.priorResearch)) {
      throw new Error("flow-state.priorResearch must be an object, null, or absent");
    }
    const pr = state.priorResearch as { slug?: unknown; topic?: unknown; path?: unknown };
    if (typeof pr.slug !== "string" || pr.slug.length === 0) {
      throw new Error("flow-state.priorResearch.slug must be a non-empty string");
    }
    if (typeof pr.topic !== "string" || pr.topic.length === 0) {
      throw new Error("flow-state.priorResearch.topic must be a non-empty string");
    }
    if (typeof pr.path !== "string" || pr.path.length === 0) {
      throw new Error("flow-state.priorResearch.path must be a non-empty string");
    }
  }
  // explicit-cleared sentinel. When present-and-non-null it must be a
  // plain object whose `slug` is a non-empty string, `status` is
  // exactly `"shipped"` (only valid value; widened in v8.60+),
  // and `artifactPaths.plan` is a non-empty string (presence of
  // plan.md was the validation gate at `/cc extend`). Optional
  // sibling artifact paths (build/review/critic/learnings/qa) must be
  // strings when present. Pre-v8.59 state files lack the field
  // entirely; readers default to `null`/absent.
  if (state.parentContext !== undefined && state.parentContext !== null) {
    if (typeof state.parentContext !== "object" || Array.isArray(state.parentContext)) {
      throw new Error("flow-state.parentContext must be an object, null, or absent");
    }
    const pc = state.parentContext as {
      slug?: unknown;
      status?: unknown;
      shippedAt?: unknown;
      artifactPaths?: unknown;
    };
    if (typeof pc.slug !== "string" || pc.slug.length === 0) {
      throw new Error("flow-state.parentContext.slug must be a non-empty string");
    }
    if (pc.status !== "shipped") {
      throw new Error(
        `flow-state.parentContext.status must be "shipped" (only valid value); got ${JSON.stringify(pc.status)}`
      );
    }
    if (pc.shippedAt !== undefined && typeof pc.shippedAt !== "string") {
      throw new Error("flow-state.parentContext.shippedAt must be a string or absent");
    }
    if (typeof pc.artifactPaths !== "object" || pc.artifactPaths === null || Array.isArray(pc.artifactPaths)) {
      throw new Error("flow-state.parentContext.artifactPaths must be an object");
    }
    const ap = pc.artifactPaths as Record<string, unknown>;
    if (typeof ap.plan !== "string" || ap.plan.length === 0) {
      throw new Error("flow-state.parentContext.artifactPaths.plan must be a non-empty string");
    }
    for (const optional of ["build", "review", "critic", "learnings", "qa"] as const) {
      const value = ap[optional];
      if (value !== undefined && (typeof value !== "string" || value.length === 0)) {
        throw new Error(
          `flow-state.parentContext.artifactPaths.${optional} must be a non-empty string when present`
        );
      }
    }
  }
  if (state.researchState !== undefined && state.researchState !== null && !isResearchState(state.researchState)) {
    throw new Error(
      `Invalid researchState: ${String(state.researchState)} (expected one of ${RESEARCH_STATES.join(" | ")} | null | absent)`
    );
  }
  if (state.revisions !== undefined) {
    if (!Array.isArray(state.revisions)) {
      throw new Error("flow-state.revisions must be an array when present");
    }
    for (const rev of state.revisions) {
      if (typeof rev !== "object" || rev === null) {
        throw new Error("flow-state.revisions entries must be objects");
      }
      const r = rev as Partial<ResearchRevision>;
      if (!isResearchRevisionKind(r.kind)) {
        throw new Error(
          `Invalid revision.kind: ${String(r.kind)} (expected revise | push-back | accept)`
        );
      }
      if (typeof r.at !== "string" || r.at.length === 0) {
        throw new Error("flow-state.revisions[].at must be a non-empty ISO timestamp string");
      }
      if (typeof r.area !== "string") {
        throw new Error("flow-state.revisions[].area must be a string (empty for accept; verbatim user arg for revise / push-back)");
      }
      if (!Array.isArray(r.lensesRedispatched)) {
        throw new Error("flow-state.revisions[].lensesRedispatched must be an array");
      }
      for (const lens of r.lensesRedispatched) {
        if (!isResearchLens(lens)) {
          throw new Error(`Invalid revision.lensesRedispatched entry: ${String(lens)}`);
        }
      }
      if (r.change !== undefined && typeof r.change !== "string") {
        throw new Error("flow-state.revisions[].change must be a string when present");
      }
    }
  }
  if (state.approaches !== undefined) {
    if (!Array.isArray(state.approaches)) {
      throw new Error("flow-state.approaches must be an array when present");
    }
    for (const approach of state.approaches) {
      if (typeof approach !== "object" || approach === null) {
        throw new Error("flow-state.approaches entries must be objects");
      }
      const a = approach as Partial<ResearchApproach>;
      if (typeof a.id !== "string" || a.id.length === 0) {
        throw new Error("flow-state.approaches[].id must be a non-empty string");
      }
      if (typeof a.title !== "string" || a.title.length === 0) {
        throw new Error("flow-state.approaches[].title must be a non-empty string");
      }
      if (typeof a.summary !== "string" || a.summary.length === 0) {
        throw new Error("flow-state.approaches[].summary must be a non-empty string");
      }
    }
  }
  if (state.selectedApproaches !== undefined) {
    if (!Array.isArray(state.selectedApproaches)) {
      throw new Error("flow-state.selectedApproaches must be an array when present");
    }
    const approachCount = Array.isArray(state.approaches) ? state.approaches.length : 0;
    for (const idx of state.selectedApproaches) {
      if (typeof idx !== "number" || !Number.isInteger(idx) || idx < 0) {
        throw new Error(
          "flow-state.selectedApproaches entries must be non-negative integers (indices into approaches[])"
        );
      }
      // Soft validation: bounds-checked when approaches[] is present on the same state.
      // Tolerant on mid-flight transient writes where selectedApproaches lands before
      // approaches is fully validated. Test-only assertion enforces tight bounds.
      if (approachCount > 0 && idx >= approachCount) {
        throw new Error(
          `flow-state.selectedApproaches index ${idx} out of bounds for approaches.length=${approachCount}`
        );
      }
    }
  }
  if (state.slice_merge_failures !== undefined) {
    if (!Array.isArray(state.slice_merge_failures)) {
      throw new Error("flow-state.slice_merge_failures must be an array when present");
    }
    for (const sliceId of state.slice_merge_failures) {
      if (typeof sliceId !== "string" || sliceId.length === 0) {
        throw new Error(
          "flow-state.slice_merge_failures entries must be non-empty slice id strings (SL-N)"
        );
      }
    }
  }
}

/** @deprecated alias preserved for v8.1 import sites. Use {@link assertFlowStateV82}. */
export const assertFlowStateV8 = assertFlowStateV82;

/** Older v7.x schema marker — used only for the hard-stop migration error. */
export const PRE_V8_LEGACY_SCHEMA_VERSIONS = new Set([1, "1", "1.0", undefined]);

/**
 * Migrate any in-memory flow-state value to the current schemaVersion.
 *
 * Returns the migrated object. The caller is expected to write it back to
 * disk before any further mutation. Throws {@link LegacyFlowStateError} if
 * the input is from a pre-v8 release (schemaVersion 1 or unset).
 */
export function migrateFlowState(value: unknown): FlowStateV82 {
  if (typeof value !== "object" || value === null) {
    throw new Error("flow-state must be an object");
  }
  const raw = value as Record<string, unknown> & { schemaVersion?: unknown };
  if (raw.schemaVersion === FLOW_STATE_SCHEMA_VERSION) {
    const rewritten = rewriteLegacyAcMode(rewriteLegacyPlanner(rewriteLegacyDiscoverySpecialist(raw)));
    assertFlowStateV82(rewritten);
    return rewritten;
  }
  if (raw.schemaVersion === LEGACY_V8_FLOW_STATE_SCHEMA_VERSION) {
    const migrated = migrateFromV2(raw);
    assertFlowStateV82(migrated);
    return migrated;
  }
  throw new LegacyFlowStateError(
    `Unsupported flow-state schema. cclaw only migrates from schemaVersion 2 (v8.0/v8.1). Saw ${String(raw.schemaVersion)}. Delete .cclaw/state/flow-state.json to start fresh.`,
    raw.schemaVersion
  );
}

/**
 * Rewrite legacy `lastSpecialist` strings to `null` so the orchestrator
 * re-dispatches the current specialist roster (architect / builder /
 * etc.) instead of crashing on read.
 *
 * Covered legacy ids:
 * - `brainstormer` (v8.14 retired discovery-side specialist)
 * - `design` (v8.62 retired; absorbed into `architect`)
 * - `ac-author` (v8.62 retired; absorbed into `architect`)
 *
 * Other v8.62-retired ids (`slice-builder`, `security-reviewer`) are
 * NOT rewritten here — they pass through the permissive validator as
 * plain strings (no rewrite) per the v8.62 "clean break" contract.
 * The orchestrator's stage routing reads `currentStage`, not
 * `lastSpecialist`, so the stale audit value does not break dispatch.
 */
function rewriteLegacyDiscoverySpecialist(
  raw: Record<string, unknown>
): Record<string, unknown> {
  if (isLegacyDiscoverySpecialist(raw.lastSpecialist)) {
    return { ...raw, lastSpecialist: null };
  }
  return raw;
}

/**
 * v8.28: rewrite `lastSpecialist: "planner"` so a `flow-state.json`
 * written by v8.14–cclaw resumes cleanly. Originally rewrote to
 * `"ac-author"`; v8.62 retired `ac-author` (absorbed into `architect`)
 * and the user spec calls for "no migration code — clean break", so the
 * rewrite now maps to `null` (mirroring
 * {@link rewriteLegacyDiscoverySpecialist}). The orchestrator
 * re-dispatches `architect` from scratch on the next `/cc`.
 *
 * The transformation runs on **every read** of a current-schema state
 * file. Shipped flow artifacts under `flows/shipped/<slug>/` are NOT
 * rewritten — they keep their historical text untouched.
 *
 * See {@link LEGACY_PLANNER_ID} for the canonical legacy-id spelling.
 */
function rewriteLegacyPlanner(
  raw: Record<string, unknown>
): Record<string, unknown> {
  if (isLegacyPlanner(raw.lastSpecialist)) {
    return { ...raw, lastSpecialist: null };
  }
  return raw;
}

/**
 * v8.56: rewrite `triage.acMode` to `triage.ceremonyMode` so a
 * `flow-state.json` written by pre-v8.56 cclaw resumes cleanly under the
 * renamed field. The rename is **semantics-preserving** — the contract
 * (`inline` / `soft` / `strict`) is identical, only the field name
 * changed — so the rewrite is a direct hoist. Following the same pattern
 * as {@link rewriteLegacyPlanner}, the transformation runs on **every
 * read** of a current-schema state file; the next write persists the new
 * field name. Shipped flow artifacts under `flows/shipped/<slug>/` are
 * NOT rewritten — they keep their historical text untouched.
 *
 * When BOTH `acMode` and `ceremonyMode` are present (mid-flight resume of
 * a project that already migrated), `ceremonyMode` wins and the legacy
 * `acMode` is dropped silently. This matches the planner rewrite
 * shape; cclaw never relies on conflicting fields surviving.
 *
 * Slated for removal in v8.57+ once one full release cycle has aged out
 * any in-flight state files.
 */
function rewriteLegacyAcMode(
  raw: Record<string, unknown>
): Record<string, unknown> {
  if (typeof raw.triage !== "object" || raw.triage === null) return raw;
  const triage = raw.triage as Record<string, unknown>;
  if ("acMode" in triage && !("ceremonyMode" in triage)) {
    const rewrittenTriage: Record<string, unknown> = { ...triage, ceremonyMode: triage.acMode };
    delete rewrittenTriage.acMode;
    return { ...raw, triage: rewrittenTriage };
  }
  if ("acMode" in triage && "ceremonyMode" in triage) {
    const rewrittenTriage: Record<string, unknown> = { ...triage };
    delete rewrittenTriage.acMode;
    return { ...raw, triage: rewrittenTriage };
  }
  return raw;
}

function migrateFromV2(raw: Record<string, unknown>): FlowStateV82 {
  const ac = (raw.ac as AcceptanceCriterionState[]) ?? [];
  const securityFlag = Boolean(raw.securityFlag);
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString();
  const triage = raw.currentSlug ? inferTriageFromLegacy({ ac, securityFlag, startedAt }) : null;
  const lastSpecialistRaw = raw.lastSpecialist;
  const lastSpecialist = isLegacyDiscoverySpecialist(lastSpecialistRaw)
    ? null
    : isLegacyPlanner(lastSpecialistRaw)
      ? null
      : ((lastSpecialistRaw as SpecialistId | null) ?? null);
  return {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    currentSlug: (raw.currentSlug as string | null) ?? null,
    currentStage: (raw.currentStage as FlowStage | null) ?? null,
    ac,
    lastSpecialist,
    startedAt,
    reviewIterations: typeof raw.reviewIterations === "number" ? raw.reviewIterations : 0,
    securityFlag,
    buildProfile: raw.buildProfile as BuildProfile | undefined,
    triage
  };
}
