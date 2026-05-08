import {
  AC_MODES,
  FLOW_STAGES,
  ROUTING_CLASSES,
  RUN_MODES,
  type AcMode,
  type AcceptanceCriterionState,
  type BuildProfile,
  type DiscoverySpecialistId,
  type FlowStage,
  type RoutingClass,
  type RunMode,
  type TriageDecision
} from "./types.js";

export const FLOW_STATE_SCHEMA_VERSION = 3;

/** v8.0–v8.1 schema. Auto-migrated to v3 on read. */
export const LEGACY_V8_FLOW_STATE_SCHEMA_VERSION = 2;

export interface FlowStateV82 {
  schemaVersion: typeof FLOW_STATE_SCHEMA_VERSION;
  currentSlug: string | null;
  currentStage: FlowStage | null;
  ac: AcceptanceCriterionState[];
  lastSpecialist: DiscoverySpecialistId | null;
  startedAt: string;
  reviewIterations: number;
  securityFlag: boolean;
  buildProfile?: BuildProfile;
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

export function isDiscoverySpecialist(value: unknown): value is DiscoverySpecialistId {
  return value === "brainstormer" || value === "architect" || value === "planner";
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
  if (triage.runMode !== undefined && !isRunMode(triage.runMode)) {
    throw new Error(`Invalid triage.runMode: ${String(triage.runMode)}`);
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
 * v8.2 state files do not record runMode; treat them as `step` so existing
 * flows keep their pause-between-stages behaviour byte-for-byte.
 */
export function runModeOf(triage: TriageDecision | null | undefined): RunMode {
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
  if (state.lastSpecialist !== null && state.lastSpecialist !== undefined && !isDiscoverySpecialist(state.lastSpecialist)) {
    throw new Error(`Invalid lastSpecialist: ${String(state.lastSpecialist)}`);
  }
  if (typeof state.startedAt !== "string") throw new Error("flow-state.startedAt must be a string");
  if (typeof state.reviewIterations !== "number" || state.reviewIterations < 0) {
    throw new Error("flow-state.reviewIterations must be a non-negative number");
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
    assertFlowStateV82(raw);
    return raw;
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

function migrateFromV2(raw: Record<string, unknown>): FlowStateV82 {
  const ac = (raw.ac as AcceptanceCriterionState[]) ?? [];
  const securityFlag = Boolean(raw.securityFlag);
  const startedAt = typeof raw.startedAt === "string" ? raw.startedAt : new Date().toISOString();
  const triage = raw.currentSlug ? inferTriageFromLegacy({ ac, securityFlag, startedAt }) : null;
  return {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    currentSlug: (raw.currentSlug as string | null) ?? null,
    currentStage: (raw.currentStage as FlowStage | null) ?? null,
    ac,
    lastSpecialist: (raw.lastSpecialist as DiscoverySpecialistId | null) ?? null,
    startedAt,
    reviewIterations: typeof raw.reviewIterations === "number" ? raw.reviewIterations : 0,
    securityFlag,
    buildProfile: raw.buildProfile as BuildProfile | undefined,
    triage
  };
}
