import {
  CEREMONY_MODES,
  FLOW_STAGES,
  INVESTIGATOR_NEXT_STEPS,
  ONE_WAY_DOOR_CHOICES,
  POSTURES,
  RESEARCH_LENSES,
  RESEARCH_MODES,
  RESEARCH_STATES,
  ROUTING_CLASSES,
  SPECIALISTS,
  SURFACES,
  TASK_SHAPES,
  type AcceptanceCriterionState,
  type BuilderEnvelope,
  type BuildProfile,
  type CeremonyMode,
  type CriticEscalation,
  type CriticVerdict,
  type FlowStage,
  type InvestigatorNextStep,
  type OneWayDoorChoice,
  type OneWayDoorConfirmation,
  type PlanCriticVerdict,
  type Posture,
  type QaEvidenceTier,
  type QaVerdict,
  type ClarifyDimension,
  type ClarifyRoundState,
  CLARIFY_DIMENSIONS,
  type ResearchApproach,
  type ResearchLensId,
  type ResearchMode,
  type ResearchRevision,
  type ResearchState,
  type RoutingClass,
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

/** Narrow check for {@link TaskShape}; validates `triage.taskShape` on read (default `"build"` when absent). */
function isTaskShape(value: unknown): value is TaskShape {
  return typeof value === "string" && (TASK_SHAPES as readonly string[]).includes(value);
}

/** Narrow check for {@link InvestigatorNextStep}; validates `investigatorVerdict` on read. */
function isInvestigatorNextStep(value: unknown): value is InvestigatorNextStep {
  return typeof value === "string" && (INVESTIGATOR_NEXT_STEPS as readonly string[]).includes(value);
}

const RESEARCH_REVISION_KINDS = ["revise", "push-back", "accept"] as const;

function isResearchRevisionKind(value: unknown): value is ResearchRevision["kind"] {
  return typeof value === "string" && (RESEARCH_REVISION_KINDS as readonly string[]).includes(value);
}

function isClarifyDimension(value: unknown): value is ClarifyDimension {
  return typeof value === "string" && (CLARIFY_DIMENSIONS as readonly string[]).includes(value);
}

/** Narrow check for {@link OneWayDoorChoice}; validates `oneWayDoorConfirmation.userChoice` on read. */
function isOneWayDoorChoice(value: unknown): value is OneWayDoorChoice {
  return typeof value === "string" && (ONE_WAY_DOOR_CHOICES as readonly string[]).includes(value);
}

export const FLOW_STATE_SCHEMA_VERSION = 3;

/** v8.0 schema. Auto-migrated to v3 on read. */
export const LEGACY_V8_FLOW_STATE_SCHEMA_VERSION = 2;

export interface FlowStateV82 {
  schemaVersion: typeof FLOW_STATE_SCHEMA_VERSION;
  currentSlug: string | null;
  currentStage: FlowStage | null;
  ac: AcceptanceCriterionState[];
  /** Plan slices (work units; distinct from {@link ac} verification), strict-mode only. Optional; old + soft/inline flows lack it. */
  slices?: SliceState[];
  /**
   * Most recent specialist dispatch (audit only; routing reads
   * {@link currentStage}). Validator accepts any string for permissive reads of
   * old ids; narrow with {@link isSpecialist}.
   */
  lastSpecialist: SpecialistId | null;
  startedAt: string;
  /** Total reviewer dispatches this flow; monotonic, never user-reset. Drives review.md / ship.md. */
  reviewIterations: number;
  securityFlag: boolean;
  buildProfile?: BuildProfile;
  /**
   * Reviewer-cap tracker the user may reset; at 5 the review-cap picker gates
   * further dispatch (`keep-iterating-anyway` resets to 3 + stamps
   * `triage.iterationOverride`). Optional, default `0`; resumed flows start fresh.
   */
  reviewCounter?: number;
  /**
   * Counts critic dispatches; hard-capped at 2 (initial + one rerun on `fix and
   * re-review`; a third triggers the critic-cap picker). Optional; default `0`.
   */
  criticIteration?: number;
  /**
   * Verdict from the latest critic (`pass`/`iterate` → ship; `block-ship` →
   * picker). Absence + `currentStage: "review"` + `lastSpecialist: "reviewer"` is
   * the pre-critic migration signal.
   */
  criticVerdict?: CriticVerdict;
  /** Open-gap count (severity != fyi) from the latest critic; surfaced in ship.md on `iterate`, else advisory. */
  criticGapsCount?: number;
  /** Escalation from the latest critic (`none`/`light`/`full`); telemetry / compound-learning audit. */
  criticEscalation?: CriticEscalation;
  /**
   * Verdict from the latest plan-critic: `pass` → builder; `revise` → one
   * architect loop; `cancel` → picker. Absence = not run (branch on presence +
   * value, never absence-as-pass).
   */
  planCriticVerdict?: PlanCriticVerdict | null;
  /** Counts plan-critic dispatches; hard-capped at 1 (initial + one rerun on `revise`). Optional, default `0`. */
  planCriticIteration?: number;
  /** ISO timestamp of the latest plan-critic dispatch; telemetry. Absent = never ran. */
  planCriticDispatchedAt?: string;
  /**
   * Verdict from the latest qa-runner: `pass` → review; `iterate` → builder (cap
   * 1); `blocked` → picker. Absence = not run; `null` = ran-but-missing (the
   * absent-vs-null distinction matters for resume).
   */
  qaVerdict?: QaVerdict | null;
  /** Counts qa-runner dispatches; hard-capped at 1 (initial + one rerun on `iterate`). Optional, default `0`. */
  qaIteration?: number;
  /** ISO timestamp of the latest qa-runner dispatch; telemetry. Absent = never ran. */
  qaDispatchedAt?: string;
  /**
   * Evidence tier the qa-runner declared (mirrored from `qa.md`) for the
   * reviewer's `qa-evidence` axis; `null` on a `blocked` verdict with no tier
   * exercised.
   */
  qaEvidenceTier?: QaEvidenceTier | null;
  /**
   * Verdict from the latest investigator (debug-branch): one of `direct-fix` /
   * `needs-plan` / `more-investigation` / `not-a-bug`. Absence = the investigator
   * hop did not run (non-debug flow). See {@link InvestigatorNextStep}.
   */
  investigatorVerdict?: InvestigatorNextStep;
  /** Counts investigator dispatches; hard-capped at 1 (initial + one `more-investigation` rerun). Optional, default `0`. */
  investigatorIteration?: number;
  /** ISO timestamp of the latest investigator dispatch; telemetry. Absent = never ran. */
  investigatorDispatchedAt?: string;
  /** Triage decision for the active flow; `null` while none running. Persisted so resume never re-prompts. */
  triage: TriageDecision | null;
  /**
   * Pointer to a prior `/cc research <topic>` flow whose `research.md` loads as
   * task context; set at Hop 0 on the research handoff, cleared at ship. Optional;
   * default `null`/absent.
   */
  priorResearch?: {
    slug: string;
    topic: string;
    path: string;
  } | null;
  /**
   * Pointer to a prior **shipped** slug whose artifacts load as task context; set
   * on a refine (`/cc <slug> <task>`), cleared at ship (`artifactPaths.plan` mandatory). Default
   * `null`/absent; orthogonal to {@link priorResearch}.
   */
  parentContext?: ParentContext | null;
  /** Research orchestrator lifecycle state (research-mode only), stamped per Phase for resume. See {@link ResearchState}. Default `null`/absent. */
  researchState?: ResearchState | null;
  /** Append-only `/cc research` revision history mirrored in `research.md` (research-mode only, never mutated). Default `[]`; no structural cap. */
  revisions?: ResearchRevision[];
  /** Candidate framings stamped at the Approaches Gate (research Phase 1.5; see {@link ResearchApproach}). Research-mode only; immutable once stamped. */
  approaches?: ResearchApproach[];
  /** Zero-based indices into {@link FlowStateV82.approaches} the user selected; the full range = "all" (empty is back-compat only, NOT "all"). Research-mode only; immutable. */
  selectedApproaches?: number[];
  /**
   * Slice ids whose sub-builder worktree failed to fast-forward merge; a non-empty
   * array forces builder Status `BLOCKED` + stop-and-report. Default `[]`; cleared
   * at ship/cancel.
   */
  slice_merge_failures?: SliceId[];
  /**
   * Append-only per-round Clarify audit trail (scores, ambiguity, target,
   * question). Architect Phase −1 (cap 5) and research Phase 1 (cap 8) share the
   * exit `ambiguity < 0.25`. Default absent/`[]`; never mutated.
   */
  clarifyRounds?: ClarifyRoundState[];
  /**
   * One-way Door Gate confirmation — stamped on architect
   * `awaiting-one-way-confirmation` (a `Reversibility: one-way` D-N); a
   * `confirm`/`edit`/`cancel` pause before build, skipped on inline (`decisionIds`
   * set + `userChoice` absent = awaiting). Default `null`/absent.
   */
  oneWayDoorConfirmation?: OneWayDoorConfirmation | null;
  /**
   * Persisted builder dispatch envelope for cross-dispatch readers (resume /
   * reviewer audit / learning); `defenseInDepth: "yes"` = builder added the named
   * layers, `"no"`/absent = fix shipped alone. Default absent.
   */
  builderEnvelope?: BuilderEnvelope;
}

/**
 * Pointer to a parent shipped slug, set on a refine (`/cc <slug> <task>`). See
 * {@link FlowStateV82.parentContext}. `status` is a string union so the validator
 * can widen without a schema bump (today only `"shipped"`).
 */
export interface ParentContext {
  slug: string;
  status: "shipped";
  shippedAt?: string;
  artifactPaths: ParentArtifactPaths;
}

/**
 * Pre-derived absolute paths to a parent's shipped artifacts. `plan` is mandatory
 * (the refine gate); the rest are optional. Specialists `await exists(path)`
 * before reading — a missing artifact is a no-op skip, not an error.
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

/** @deprecated alias preserved for old import sites. Use {@link FlowStateV82}. */
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

/** @deprecated — use {@link isCeremonyMode}. Alias kept for old import sites. */
export const isAcMode = isCeremonyMode;

/** Narrow check for the (now single) discovery specialist `architect`; new state-validation paths should use {@link isSpecialist}. */
export function isDiscoverySpecialist(value: unknown): value is "architect" {
  return value === "architect";
}

/**
 * Recognise retired discovery ids (`brainstormer`/`design`/`ac-author`) so
 * migration can reset them to `null` on read; the current `architect` is excluded.
 */
export function isLegacyDiscoverySpecialist(
  value: unknown
): value is "brainstormer" | "design" | "ac-author" {
  return value === "brainstormer" || value === "design" || value === "ac-author";
}

/**
 * Recognise the legacy `planner` id so {@link rewriteLegacyPlanner} can reset
 * `lastSpecialist` to `null`.
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

/** @deprecated kept for source-level compatibility with old imports. */
export const createInitialFlowStateV8 = createInitialFlowState;

/**
 * Infer a TriageDecision for a v2 (pre-8.2) state migrating forward: v2 never
 * recorded triage, so map to `strict` ceremony with complexity from AC count +
 * security flag.
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
    userOverrode: false
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
    // optional back-reference to the verifying slices; permissive (old + soft/
    // inline flows lack it).
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
 * Validate `flow-state.slices`. Permissive on read so old state files round-trip;
 * new strict flows emit slices when plan.md has a `## Plan / Slices` table.
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
  // mode: which entry point started the flow; old files lack it (default "task").
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
  // orthogonal task shape; old files lack it (default "build"). Validator only
  // runs when present.
  if (triage.taskShape !== undefined && !isTaskShape(triage.taskShape)) {
    throw new Error(
      `Invalid triage.taskShape: ${String(triage.taskShape)} (expected "build" | "debug" | "research" | absent)`
    );
  }
  if (triage.designSurface !== undefined && typeof triage.designSurface !== "boolean") {
    throw new Error("triage.designSurface must be a boolean or absent");
  }
  if (triage.devexSurface !== undefined && typeof triage.devexSurface !== "boolean") {
    throw new Error("triage.devexSurface must be a boolean or absent");
  }
}

/**
 * Read pre-flight assumptions: `[]` when none ran (legacy/trivial), else the
 * recorded array (possibly empty if it ran with nothing to record).
 */
export function assumptionsOf(triage: TriageDecision | null | undefined): readonly string[] {
  const value = triage?.assumptions;
  if (value === null || value === undefined) return [];
  return value;
}

/**
 * Validate a flow-state object; throws on hard schema errors. Expects the current
 * (schemaVersion=3) shape — older v2 states are migrated forward first.
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
  if (
    state.investigatorVerdict !== undefined &&
    !isInvestigatorNextStep(state.investigatorVerdict)
  ) {
    throw new Error(`Invalid investigatorVerdict: ${String(state.investigatorVerdict)}`);
  }
  if (state.investigatorIteration !== undefined) {
    if (typeof state.investigatorIteration !== "number" || state.investigatorIteration < 0) {
      throw new Error("flow-state.investigatorIteration must be a non-negative number when present");
    }
    if (state.investigatorIteration > 1) {
      throw new Error(
        `flow-state.investigatorIteration must be 0 or 1 when present (one more-investigation cap); saw ${state.investigatorIteration}`
      );
    }
  }
  if (state.investigatorDispatchedAt !== undefined && typeof state.investigatorDispatchedAt !== "string") {
    throw new Error("flow-state.investigatorDispatchedAt must be a string or absent");
  }
  if (typeof state.securityFlag !== "boolean") {
    throw new Error("flow-state.securityFlag must be a boolean");
  }
  if (state.buildProfile !== undefined && state.buildProfile !== "default" && state.buildProfile !== "bootstrap") {
    throw new Error(`Invalid buildProfile: ${String(state.buildProfile)}`);
  }
  assertTriageOrNull(state.triage);
  // priorResearch: explicit-cleared sentinel; object with three string fields when present.
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
  // parentContext: explicit-cleared sentinel; non-empty `slug`, `status ===
  // "shipped"`, non-empty `artifactPaths.plan`, sibling paths optional strings.
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
      // Bounds-checked only when approaches[] is present on the same state
      // (tolerant of mid-flight transient writes; a test-only assertion enforces
      // tight bounds).
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
  if (state.clarifyRounds !== undefined) {
    if (!Array.isArray(state.clarifyRounds)) {
      throw new Error("flow-state.clarifyRounds must be an array when present");
    }
    for (const entry of state.clarifyRounds) {
      if (typeof entry !== "object" || entry === null) {
        throw new Error("flow-state.clarifyRounds entries must be objects");
      }
      const r = entry as Partial<ClarifyRoundState>;
      if (typeof r.round !== "number" || !Number.isInteger(r.round) || r.round < 1) {
        throw new Error(
          "flow-state.clarifyRounds[].round must be a positive integer (1-indexed round number)"
        );
      }
      if (!Array.isArray(r.dimensionScores)) {
        throw new Error("flow-state.clarifyRounds[].dimensionScores must be an array");
      }
      for (const score of r.dimensionScores) {
        if (typeof score !== "object" || score === null) {
          throw new Error("flow-state.clarifyRounds[].dimensionScores entries must be objects");
        }
        const s = score as Partial<ClarifyRoundState["dimensionScores"][number]>;
        if (!isClarifyDimension(s.dimension)) {
          throw new Error(
            `Invalid clarifyRounds dimension: ${String(s.dimension)} (expected one of ${CLARIFY_DIMENSIONS.join(" | ")})`
          );
        }
        if (typeof s.score !== "number" || Number.isNaN(s.score) || s.score < 0 || s.score > 1) {
          throw new Error(
            `clarifyRounds dimensionScores.score must be a number in [0, 1]; got ${String(s.score)}`
          );
        }
        if (typeof s.rationale !== "string") {
          throw new Error("clarifyRounds dimensionScores.rationale must be a string");
        }
      }
      if (
        typeof r.ambiguity !== "number" ||
        Number.isNaN(r.ambiguity) ||
        r.ambiguity < 0 ||
        r.ambiguity > 1
      ) {
        throw new Error(
          `clarifyRounds.ambiguity must be a number in [0, 1]; got ${String(r.ambiguity)}`
        );
      }
      if (!isClarifyDimension(r.targetedDimension)) {
        throw new Error(
          `Invalid clarifyRounds targetedDimension: ${String(r.targetedDimension)}`
        );
      }
      if (typeof r.question !== "string") {
        throw new Error("clarifyRounds.question must be a string");
      }
    }
  }
  if (state.oneWayDoorConfirmation !== undefined && state.oneWayDoorConfirmation !== null) {
    if (
      typeof state.oneWayDoorConfirmation !== "object" ||
      Array.isArray(state.oneWayDoorConfirmation)
    ) {
      throw new Error(
        "flow-state.oneWayDoorConfirmation must be an object, null, or absent"
      );
    }
    const conf = state.oneWayDoorConfirmation as Partial<OneWayDoorConfirmation>;
    if (!Array.isArray(conf.decisionIds)) {
      throw new Error("flow-state.oneWayDoorConfirmation.decisionIds must be an array");
    }
    for (const id of conf.decisionIds) {
      if (typeof id !== "string" || id.length === 0) {
        throw new Error(
          "flow-state.oneWayDoorConfirmation.decisionIds entries must be non-empty D-N strings"
        );
      }
    }
    if (conf.userChoice !== undefined && !isOneWayDoorChoice(conf.userChoice)) {
      throw new Error(
        `Invalid oneWayDoorConfirmation.userChoice: ${String(conf.userChoice)} (expected one of ${ONE_WAY_DOOR_CHOICES.join(" | ")})`
      );
    }
    if (conf.confirmedAt !== undefined && typeof conf.confirmedAt !== "string") {
      throw new Error(
        "flow-state.oneWayDoorConfirmation.confirmedAt must be a string or absent"
      );
    }
  }
  // builderEnvelope: optional/back-compat; when present must be an object whose
  // `defenseInDepth` is "yes"/"no"/absent (any other value is a hard error).
  if (state.builderEnvelope !== undefined) {
    if (
      typeof state.builderEnvelope !== "object" ||
      state.builderEnvelope === null ||
      Array.isArray(state.builderEnvelope)
    ) {
      throw new Error("flow-state.builderEnvelope must be an object or absent");
    }
    const env = state.builderEnvelope as Partial<BuilderEnvelope>;
    if (
      env.defenseInDepth !== undefined &&
      env.defenseInDepth !== "yes" &&
      env.defenseInDepth !== "no"
    ) {
      throw new Error(
        `Invalid builderEnvelope.defenseInDepth: ${String(env.defenseInDepth)} (expected "yes" | "no" | absent)`
      );
    }
  }
}

/** @deprecated alias preserved for old import sites. Use {@link assertFlowStateV82}. */
export const assertFlowStateV8 = assertFlowStateV82;

/** Older v7.x schema marker — used only for the hard-stop migration error. */
export const PRE_V8_LEGACY_SCHEMA_VERSIONS = new Set([1, "1", "1.0", undefined]);

/**
 * Migrate any in-memory flow-state value to the current schemaVersion and return
 * it. Throws {@link LegacyFlowStateError} for pre-v8 inputs (schemaVersion 1 or
 * unset).
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
 * Rewrite legacy `lastSpecialist` ids (`brainstormer`/`design`/`ac-author`) to
 * `null` so the orchestrator re-dispatches the current roster. Other retired ids
 * pass through the permissive validator unchanged.
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
 * Rewrite `lastSpecialist: "planner"` to `null` so an old state file resumes
 * cleanly. Runs on every read; shipped artifacts are not rewritten.
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
 * Rewrite `triage.acMode` to `triage.ceremonyMode` (semantics-preserving rename)
 * so an old state file resumes cleanly. When both are present, `ceremonyMode`
 * wins and `acMode` is dropped; shipped artifacts are not rewritten.
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
