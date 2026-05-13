import {
  AC_MODES,
  FLOW_STAGES,
  ROUTING_CLASSES,
  RUN_MODES,
  SPECIALISTS,
  type AcMode,
  type AcceptanceCriterionState,
  type BuildProfile,
  type CriticEscalation,
  type CriticVerdict,
  type FlowStage,
  type RoutingClass,
  type RunMode,
  type SpecialistId,
  type TriageDecision
} from "./types.js";

const CRITIC_VERDICTS = ["pass", "iterate", "block-ship"] as const;
const CRITIC_ESCALATIONS = ["none", "light", "full"] as const;

function isCriticVerdict(value: unknown): value is CriticVerdict {
  return typeof value === "string" && (CRITIC_VERDICTS as readonly string[]).includes(value);
}

function isCriticEscalation(value: unknown): value is CriticEscalation {
  return typeof value === "string" && (CRITIC_ESCALATIONS as readonly string[]).includes(value);
}

export const FLOW_STATE_SCHEMA_VERSION = 3;

/** v8.0–v8.1 schema. Auto-migrated to v3 on read. */
export const LEGACY_V8_FLOW_STATE_SCHEMA_VERSION = 2;

export interface FlowStateV82 {
  schemaVersion: typeof FLOW_STATE_SCHEMA_VERSION;
  currentSlug: string | null;
  currentStage: FlowStage | null;
  ac: AcceptanceCriterionState[];
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
   * v8.20 — cap-tracker that may be reset by the user. Increments on
   * every reviewer dispatch in parallel with {@link reviewIterations}.
   * When it reaches 5 the orchestrator does not dispatch another
   * reviewer until the user picks an option from the review-cap picker
   * (`cancel-and-replan` / `accept-warns-and-ship` / `keep-iterating-
   * anyway`). The third option resets `reviewCounter` to 3 — giving two
   * more rounds — and stamps `triage.iterationOverride: true` so the
   * extension is auditable.
   *
   * Optional in TypeScript so v8.19 state files (which lack the field)
   * still validate; readers MUST default to `0` on absent. v8.19 flows
   * resumed on v8.20 start at 0 even if `reviewIterations` already
   * reflects prior dispatches — the cap is a fresh budget on resume,
   * which is the intentionally permissive fallback.
   */
  reviewCounter?: number;
  /**
   * v8.42 — counts critic dispatches for the active flow.
   *
   * Hard-capped at 2 (initial dispatch + at-most-one rerun when the user
   * picks `fix and re-review` at the block-ship picker). A third dispatch
   * is structurally not supported and triggers the critic-cap-reached
   * picker, mirroring the v8.20 5-iteration cap for reviewer.
   *
   * Optional in TypeScript so v8.41 state files (which lack the field)
   * still validate; readers MUST default to `0` on absent. Distinct from
   * {@link reviewIterations} — critic dispatches do not increment the
   * reviewer counter, by design (see `.cclaw/flows/v842-critic-design/
   * design.md §9.0`).
   */
  criticIteration?: number;
  /**
   * v8.42 — verdict returned by the most-recent critic dispatch.
   *
   * `pass`/`iterate` allow the orchestrator to advance to Hop 5 (ship);
   * `block-ship` pauses for the user's block-ship picker. Absence means
   * critic has not run yet (legacy pre-v8.42 state or a freshly-created
   * flow). The flow-state reader uses absence + `currentStage: "review"`
   * + `lastSpecialist: "reviewer"` as the pre-v8.42 migration signal.
   */
  criticVerdict?: CriticVerdict;
  /**
   * v8.42 — open-gap count (severity != `fyi`) from the most-recent
   * critic dispatch. Surfaced in `ship.md > Risks carried over` for
   * `iterate` verdicts; otherwise advisory.
   */
  criticGapsCount?: number;
  /**
   * v8.42 — escalation level from the most-recent critic dispatch.
   *
   * `none` = pure gap mode; `light` = one §8 trigger fired in soft mode;
   * `full` = `adversarial` mode (strict mode + any §8 trigger). The
   * orchestrator stamps this for telemetry / compound-learning audit.
   */
  criticEscalation?: CriticEscalation;
  /**
   * Triage decision for the active flow. Null while no flow is running.
   * Persisted so resume never re-prompts the user.
   */
  triage: TriageDecision | null;
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

export function isAcMode(value: unknown): value is AcMode {
  return typeof value === "string" && (AC_MODES as readonly string[]).includes(value);
}

export function isRunMode(value: unknown): value is RunMode {
  return typeof value === "string" && (RUN_MODES as readonly string[]).includes(value);
}

/**
 * Narrow check for the discovery specialists (v8.14+: `design`, `ac-author`).
 * Kept for backward compatibility with callers that only care about
 * discovery sub-phase routing; new state-validation paths should use
 * {@link isSpecialist}.
 */
export function isDiscoverySpecialist(value: unknown): value is "design" | "ac-author" {
  return value === "design" || value === "ac-author";
}

/**
 * v8.14 retired `brainstormer` and `architect`. Recognise the legacy ids so
 * migration paths can rewrite them to `null` (forcing a re-run of the
 * `design` phase) instead of crashing on read.
 */
export function isLegacyDiscoverySpecialist(value: unknown): value is "brainstormer" | "architect" {
  return value === "brainstormer" || value === "architect";
}

/**
 * v8.28 renamed the `planner` specialist to `ac-author`. Recognise the
 * legacy id on read so a `flow-state.json` written by v8.14–v8.27 cclaw
 * with `lastSpecialist: "planner"` is auto-rewritten to `"ac-author"`
 * inside {@link rewriteLegacyPlanner}, mirroring the v8.14 discovery-
 * specialist migration shape (`rewriteLegacyDiscoverySpecialist`). The
 * planner contract was a one-shot dispatcher with no per-phase
 * checkpointing — the rename preserves semantics, so the right migration
 * is a direct rewrite to the new id rather than a `null` reset.
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
 * them to `strict` AC mode (they relied on per-AC TDD), with complexity
 * inferred from the AC count and security flag.
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
    acMode: "strict",
    path: ["plan", "build", "review", "ship"],
    rationale: "Auto-migrated from cclaw 8.0/8.1 flow-state (no triage recorded; preserved as strict).",
    decidedAt: state.startedAt,
    userOverrode: false,
    runMode: "step"
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
  }
}

function assertTriageOrNull(value: unknown): asserts value is TriageDecision | null {
  if (value === null) return;
  if (typeof value !== "object") throw new Error("flow-state.triage must be an object or null");
  const triage = value as Partial<TriageDecision>;
  if (!isRoutingClass(triage.complexity)) {
    throw new Error(`Invalid triage.complexity: ${String(triage.complexity)}`);
  }
  if (!isAcMode(triage.acMode)) {
    throw new Error(`Invalid triage.acMode: ${String(triage.acMode)}`);
  }
  if (!Array.isArray(triage.path)) {
    throw new Error("triage.path must be an array of stage names");
  }
  for (const stage of triage.path) {
    if (!isFlowStage(stage)) throw new Error(`Invalid triage.path stage: ${String(stage)}`);
  }
  if (typeof triage.rationale !== "string") throw new Error("triage.rationale must be a string");
  if (typeof triage.decidedAt !== "string") throw new Error("triage.decidedAt must be a string");
  if (typeof triage.userOverrode !== "boolean") {
    throw new Error("triage.userOverrode must be a boolean");
  }
  if (triage.runMode !== undefined && triage.runMode !== null && !isRunMode(triage.runMode)) {
    throw new Error(`Invalid triage.runMode: ${String(triage.runMode)}`);
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
 * Read a triage decision's interpretation forks (chosen reading sentence(s)
 * from the ambiguity-fork sub-step at Hop 2.5).
 *
 * Returns:
 * - `[]` when no fork sub-step ran (unambiguous prompt, trivial path, or
 *   legacy state). Callers treat this as "no surfaced ambiguity".
 * - the recorded array (typically a single sentence — the user's chosen
 *   interpretation; multi-element only when the user explicitly picked a
 *   compound reading).
 */
export function interpretationForksOf(triage: TriageDecision | null | undefined): readonly string[] {
  const value = triage?.interpretationForks;
  if (value === null || value === undefined) return [];
  return value;
}

/**
 * Read a triage decision's runMode with the documented default.
 *
 * v8.2 state files do not record runMode; treat them as `step` so existing
 * flows keep their pause-between-stages behaviour byte-for-byte.
 */
export function runModeOf(triage: TriageDecision | null | undefined): RunMode {
  // v8.14: triage.runMode is `null` on inline / trivial paths (no stages
  // to chain). Treat null and undefined the same way and return "step"; the
  // inline path never reads this value before completing, so the fallback
  // is purely defensive.
  return triage?.runMode ?? "step";
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
  if (state.lastSpecialist !== null && state.lastSpecialist !== undefined && !isSpecialist(state.lastSpecialist)) {
    throw new Error(`Invalid lastSpecialist: ${String(state.lastSpecialist)}`);
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
  if (typeof state.securityFlag !== "boolean") {
    throw new Error("flow-state.securityFlag must be a boolean");
  }
  if (state.buildProfile !== undefined && state.buildProfile !== "default" && state.buildProfile !== "bootstrap") {
    throw new Error(`Invalid buildProfile: ${String(state.buildProfile)}`);
  }
  assertTriageOrNull(state.triage);
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
    const rewritten = rewriteLegacyPlanner(rewriteLegacyDiscoverySpecialist(raw));
    assertFlowStateV82(rewritten);
    return rewritten;
  }
  if (raw.schemaVersion === LEGACY_V8_FLOW_STATE_SCHEMA_VERSION) {
    const migrated = migrateFromV2(raw);
    assertFlowStateV82(migrated);
    return migrated;
  }
  throw new LegacyFlowStateError(
    `Unsupported flow-state schema. cclaw v8.2 only migrates from schemaVersion 2 (v8.0/v8.1). Saw ${String(raw.schemaVersion)}. Delete .cclaw/state/flow-state.json to start fresh.`,
    raw.schemaVersion
  );
}

/**
 * v8.14: rewrite `lastSpecialist: "brainstormer" | "architect"` to `null` so
 * the orchestrator re-runs the unified `design` phase. State files written
 * by pre-v8.14 cclaw on an active flow are valid in every other respect;
 * only the specialist id changed. We do NOT try to map brainstormer ->
 * design / architect -> design here because either case usually means
 * the discovery phase needs to be redone end-to-end (the existing plan.md
 * has the old brainstormer/architect output split across two files and the
 * v8.14 design phase expects inline sections in plan.md only).
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
 * v8.28: rewrite `lastSpecialist: "planner"` to `"ac-author"` so a
 * `flow-state.json` written by v8.14–v8.27 cclaw resumes cleanly under
 * the renamed specialist id. Unlike `rewriteLegacyDiscoverySpecialist`
 * (which resets to `null` because the v8.14 discovery split / merge
 * meant the previous artifacts could not be reused), the v8.28 rename
 * is **semantics-preserving** — the planner / ac-author contract is the
 * same, only the id changed — so the rewrite is a direct mapping.
 *
 * The transformation runs on **every read** of a current-schema state
 * file, so a long-resumed flow with `lastSpecialist: "planner"` on disk
 * sees the in-memory value flip to `"ac-author"` immediately; the next
 * write (any state mutation) persists the new id. Shipped flow
 * artifacts under `flows/shipped/<slug>/` are NOT rewritten — they keep
 * their historical text untouched, per the v8.28 migration story.
 *
 * Slated for removal in v8.29+ once one full release cycle has aged
 * out any in-flight state files. See {@link LEGACY_PLANNER_ID} for the
 * canonical legacy-id spelling.
 */
function rewriteLegacyPlanner(
  raw: Record<string, unknown>
): Record<string, unknown> {
  if (isLegacyPlanner(raw.lastSpecialist)) {
    return { ...raw, lastSpecialist: "ac-author" };
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
      ? "ac-author"
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
