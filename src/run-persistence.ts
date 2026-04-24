import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import {
  canTransition,
  createInitialCloseoutState,
  createInitialFlowState,
  isFlowTrack,
  skippedStagesForTrack,
  SHIP_SUBSTATES,
  type CloseoutState,
  type FlowState,
  type ShipSubstate
} from "./flow-state.js";
import {
  ensureDir,
  exists,
  withDirectoryLock,
  writeFileSafe
} from "./fs-utils.js";
import { FLOW_STAGES } from "./types.js";
import type { FlowStage, FlowTrack } from "./types.js";

export class InvalidStageTransitionError extends Error {
  constructor(
    public readonly from: FlowStage,
    public readonly to: FlowStage,
    message: string
  ) {
    super(message);
    this.name = "InvalidStageTransitionError";
  }
}

export interface WriteFlowStateOptions {
  /**
   * When true, skip prior-state validation. Used for run archival, initial
   * bootstrap, or explicit recovery; never set from normal stage handlers.
   */
  allowReset?: boolean;
  /**
   * When true, skip the internal directory-lock acquisition. The caller
   * MUST already hold `flowStateLockPath(projectRoot)` for the duration
   * of this call. Used by run-archive to keep the full archive +
   * flow-state reset inside one atomic lock window.
   */
  skipLock?: boolean;
}

export interface ReadFlowStateOptions {
  /**
   * Reserved compatibility switch for callers that previously opted out of
   * feature-system repair writes. The feature-system layer was removed, so this
   * flag is now a no-op and only preserved for API stability.
   */
  repairFeatureSystem?: boolean;
}

const FLOW_STATE_REL_PATH = `${RUNTIME_ROOT}/state/flow-state.json`;
const RUNS_DIR_REL_PATH = `${RUNTIME_ROOT}/runs`;
const ACTIVE_ARTIFACTS_REL_PATH = `${RUNTIME_ROOT}/artifacts`;
const FLOW_STAGE_SET = new Set<string>(FLOW_STAGES);

function validateFlowTransition(prev: FlowState, next: FlowState): void {
  if (prev.activeRunId !== next.activeRunId) {
    // New run — only reset paths may change the runId, but those set allowReset.
    throw new InvalidStageTransitionError(
      prev.currentStage,
      next.currentStage,
      `cannot change activeRunId from "${prev.activeRunId}" to "${next.activeRunId}" without allowReset.`
    );
  }

  // Track is immutable within a single run: stage schemas, gate sets, and
  // cross-stage reads all branch on track. Silently flipping the track
  // mid-run would let completed stages satisfy one gate tier and the
  // current stage re-read the catalog under a different tier.
  if (prev.track !== next.track) {
    throw new InvalidStageTransitionError(
      prev.currentStage,
      next.currentStage,
      `cannot change track from "${prev.track}" to "${next.track}" mid-run (activeRunId="${prev.activeRunId}"). Archive the run and start a new one to switch tracks.`
    );
  }

  for (const completed of prev.completedStages) {
    if (!next.completedStages.includes(completed)) {
      throw new InvalidStageTransitionError(
        prev.currentStage,
        next.currentStage,
        `completedStages must be monotonic: stage "${completed}" was previously completed but is missing from the new state.`
      );
    }
  }

  if (prev.currentStage === next.currentStage) {
    return;
  }

  if (!canTransition(prev.currentStage, next.currentStage)) {
    throw new InvalidStageTransitionError(
      prev.currentStage,
      next.currentStage,
      `no transition rule allows "${prev.currentStage}" -> "${next.currentStage}". Use /cc-next to advance stages or archive the run to reset.`
    );
  }
}

function flowStatePath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REL_PATH);
}

function flowStateLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".flow-state.lock");
}

function runsRoot(projectRoot: string): string {
  return path.join(projectRoot, RUNS_DIR_REL_PATH);
}

function activeArtifactsPath(projectRoot: string): string {
  return path.join(projectRoot, ACTIVE_ARTIFACTS_REL_PATH);
}

function isFlowStage(value: unknown): value is FlowStage {
  return typeof value === "string" && FLOW_STAGE_SET.has(value);
}

function sanitizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function sanitizeCompletedStages(value: unknown): FlowStage[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const unique = new Set<FlowStage>();
  const stages: FlowStage[] = [];
  for (const item of value) {
    if (isFlowStage(item) && !unique.has(item)) {
      unique.add(item);
      stages.push(item);
    }
  }
  return stages;
}

function sanitizeGuardEvidence(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === "string") {
      next[key] = raw;
    }
  }
  return next;
}

function sanitizeStageGateCatalog(
  value: unknown,
  fallback: FlowState["stageGateCatalog"]
): FlowState["stageGateCatalog"] {
  const uniqueStrings = (items: string[]): string[] => [...new Set(items)];
  const next = {} as FlowState["stageGateCatalog"];
  for (const stage of FLOW_STAGES) {
    const base = fallback[stage];
    next[stage] = {
      required: [...base.required],
      recommended: [...base.recommended],
      conditional: [...base.conditional],
      triggered: [...base.triggered],
      passed: [...base.passed],
      blocked: [...base.blocked]
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }

  const rawCatalog = value as Record<string, unknown>;
  for (const stage of FLOW_STAGES) {
    const rawStage = rawCatalog[stage];
    if (!rawStage || typeof rawStage !== "object" || Array.isArray(rawStage)) {
      continue;
    }
    const typed = rawStage as Record<string, unknown>;
    const stageState = next[stage];
    const allowedGateIds = new Set([
      ...stageState.required,
      ...stageState.recommended,
      ...stageState.conditional
    ]);
    const conditionalGateIds = new Set(stageState.conditional);
    const passed = sanitizeStringArray(typed.passed).filter((gate) => allowedGateIds.has(gate));
    const blocked = sanitizeStringArray(typed.blocked).filter((gate) => allowedGateIds.has(gate));
    const triggeredFromState = sanitizeStringArray(typed.triggered).filter((gate) =>
      conditionalGateIds.has(gate)
    );
    const touchedConditionals = [...passed, ...blocked].filter((gate) => conditionalGateIds.has(gate));
    next[stage] = {
      required: [...stageState.required],
      recommended: [...stageState.recommended],
      conditional: [...stageState.conditional],
      triggered: uniqueStrings([...triggeredFromState, ...touchedConditionals]),
      passed,
      blocked
    };
  }

  return next;
}

function coerceTrack(value: unknown): FlowTrack {
  return isFlowTrack(value) ? value : "standard";
}

function sanitizeSkippedStages(value: unknown, track: FlowTrack): FlowStage[] {
  const trackDefault = skippedStagesForTrack(track);
  if (!Array.isArray(value)) {
    return trackDefault;
  }
  const seen = new Set<FlowStage>();
  const out: FlowStage[] = [];
  for (const raw of value) {
    if (isFlowStage(raw) && !seen.has(raw)) {
      seen.add(raw);
      out.push(raw);
    }
  }
  return out.length > 0 ? out : trackDefault;
}

function sanitizeStaleStages(
  value: unknown
): FlowState["staleStages"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: FlowState["staleStages"] = {};
  for (const [stage, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isFlowStage(stage)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const typed = raw as Record<string, unknown>;
    const rewindId = typeof typed.rewindId === "string" ? typed.rewindId : "";
    const reason = typeof typed.reason === "string" ? typed.reason : "";
    const markedAt = typeof typed.markedAt === "string" ? typed.markedAt : "";
    const acknowledgedAt = typeof typed.acknowledgedAt === "string" ? typed.acknowledgedAt : undefined;
    if (!rewindId || !reason || !markedAt) {
      continue;
    }
    out[stage] = {
      rewindId,
      reason,
      markedAt,
      acknowledgedAt
    };
  }
  return out;
}

function sanitizeRewinds(value: unknown): FlowState["rewinds"] {
  if (!Array.isArray(value)) {
    return [];
  }
  const out: FlowState["rewinds"] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      continue;
    }
    const typed = raw as Record<string, unknown>;
    if (
      typeof typed.id !== "string" ||
      !isFlowStage(typed.fromStage) ||
      !isFlowStage(typed.toStage) ||
      typeof typed.reason !== "string" ||
      typeof typed.timestamp !== "string"
    ) {
      continue;
    }
    const invalidatedStages = Array.isArray(typed.invalidatedStages)
      ? typed.invalidatedStages.filter((stage): stage is FlowStage => isFlowStage(stage))
      : [];
    out.push({
      id: typed.id,
      fromStage: typed.fromStage,
      toStage: typed.toStage,
      reason: typed.reason,
      timestamp: typed.timestamp,
      invalidatedStages
    });
  }
  return out;
}

function sanitizeRetroState(value: unknown): FlowState["retro"] {
  const fallback: FlowState["retro"] = {
    required: false,
    completedAt: undefined,
    compoundEntries: 0
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const typed = value as Record<string, unknown>;
  const required = typeof typed.required === "boolean" ? typed.required : false;
  const completedAt = typeof typed.completedAt === "string" ? typed.completedAt : undefined;
  const compoundEntriesRaw = typed.compoundEntries;
  const compoundEntries =
    typeof compoundEntriesRaw === "number" && Number.isFinite(compoundEntriesRaw) && compoundEntriesRaw >= 0
      ? Math.floor(compoundEntriesRaw)
      : 0;
  return {
    required,
    completedAt,
    compoundEntries
  };
}

function isShipSubstate(value: unknown): value is ShipSubstate {
  return typeof value === "string" && (SHIP_SUBSTATES as readonly string[]).includes(value);
}

function sanitizeCloseoutState(value: unknown): CloseoutState {
  const fallback = createInitialCloseoutState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const typed = value as Record<string, unknown>;
  let shipSubstate = isShipSubstate(typed.shipSubstate) ? typed.shipSubstate : fallback.shipSubstate;
  const retroDraftedAt = typeof typed.retroDraftedAt === "string" ? typed.retroDraftedAt : undefined;
  const retroAcceptedAt = typeof typed.retroAcceptedAt === "string" ? typed.retroAcceptedAt : undefined;
  const retroSkipped = typeof typed.retroSkipped === "boolean" ? typed.retroSkipped : undefined;
  const retroSkipReason = typeof typed.retroSkipReason === "string" ? typed.retroSkipReason : undefined;
  const compoundCompletedAt = typeof typed.compoundCompletedAt === "string" ? typed.compoundCompletedAt : undefined;
  const compoundSkipped = typeof typed.compoundSkipped === "boolean" ? typed.compoundSkipped : undefined;
  const promotedRaw = typed.compoundPromoted;
  const compoundPromoted =
    typeof promotedRaw === "number" && Number.isFinite(promotedRaw) && promotedRaw >= 0
      ? Math.floor(promotedRaw)
      : 0;

  // Demote shipSubstate when its retro invariant is violated on disk. A
  // hand-edited flow-state could claim `ready_to_archive` or `compound_review`
  // without ever going through the retro step, which would let `archive`
  // proceed and skip the gate. Compound completion is not independently
  // tracked in all flows (some runs rely on knowledge.jsonl + the retro
  // window), so we only demote when the retro leg is missing outright.
  const retroDone = retroAcceptedAt !== undefined || retroSkipped === true;
  if (!retroDone && (shipSubstate === "ready_to_archive" || shipSubstate === "compound_review")) {
    shipSubstate = "retro_review";
  }

  return {
    shipSubstate,
    retroDraftedAt,
    retroAcceptedAt,
    retroSkipped,
    retroSkipReason,
    compoundCompletedAt,
    compoundSkipped,
    compoundPromoted
  };
}

function coerceFlowState(parsed: Record<string, unknown>): FlowState {
  const track = coerceTrack(parsed.track);
  const next = createInitialFlowState({ track });
  const activeRunIdRaw = parsed.activeRunId;
  const activeRunId = typeof activeRunIdRaw === "string" && activeRunIdRaw.trim().length > 0
    ? activeRunIdRaw.trim()
    : next.activeRunId;

  return {
    activeRunId,
    currentStage: isFlowStage(parsed.currentStage) ? parsed.currentStage : next.currentStage,
    completedStages: sanitizeCompletedStages(parsed.completedStages),
    guardEvidence: sanitizeGuardEvidence(parsed.guardEvidence),
    stageGateCatalog: sanitizeStageGateCatalog(parsed.stageGateCatalog, next.stageGateCatalog),
    track,
    skippedStages: sanitizeSkippedStages(parsed.skippedStages, track),
    staleStages: sanitizeStaleStages(parsed.staleStages),
    rewinds: sanitizeRewinds(parsed.rewinds),
    retro: sanitizeRetroState(parsed.retro),
    closeout: sanitizeCloseoutState(parsed.closeout)
  };
}

export class CorruptFlowStateError extends Error {
  readonly statePath: string;
  readonly quarantinedPath: string;
  constructor(statePath: string, quarantinedPath: string, cause: unknown) {
    super(
      `Corrupt flow-state.json detected at ${statePath}. ` +
        `Quarantined to ${quarantinedPath}. ` +
        `Inspect the quarantined file, reconcile by hand, then re-run your command ` +
        `or delete ${statePath} to start over. ` +
        `Underlying error: ${cause instanceof Error ? cause.message : String(cause)}`
    );
    this.name = "CorruptFlowStateError";
    this.statePath = statePath;
    this.quarantinedPath = quarantinedPath;
    if (cause instanceof Error) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function quarantineTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/gu, "-");
}

async function quarantineCorruptState(statePath: string, cause: unknown): Promise<never> {
  const quarantinedPath = `${statePath}.corrupt-${quarantineTimestamp()}.json`;
  try {
    await fs.rename(statePath, quarantinedPath);
  } catch (renameErr) {
    try {
      const raw = await fs.readFile(statePath, "utf8");
      await fs.writeFile(quarantinedPath, raw, "utf8");
      await fs.unlink(statePath).catch(() => undefined);
    } catch {
      throw new CorruptFlowStateError(statePath, quarantinedPath, renameErr);
    }
  }
  throw new CorruptFlowStateError(statePath, quarantinedPath, cause);
}

export async function readFlowState(
  projectRoot: string,
  options: ReadFlowStateOptions = {}
): Promise<FlowState> {
  void options;
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    return createInitialFlowState();
  }
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch (readErr) {
    throw new CorruptFlowStateError(statePath, statePath, readErr);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (parseErr) {
    await quarantineCorruptState(statePath, parseErr);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    await quarantineCorruptState(
      statePath,
      new Error("flow-state.json did not deserialize to a JSON object")
    );
  }
  return coerceFlowState(parsed as Record<string, unknown>);
}

export async function writeFlowState(
  projectRoot: string,
  state: FlowState,
  options: WriteFlowStateOptions = {}
): Promise<void> {
  const doWrite = async (): Promise<void> => {
    const statePath = flowStatePath(projectRoot);
    if (!options.allowReset && (await exists(statePath))) {
      try {
        const raw = await fs.readFile(statePath, "utf8");
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const prev = coerceFlowState(parsed);
          validateFlowTransition(prev, state);
        }
      } catch (err) {
        if (err instanceof InvalidStageTransitionError) {
          throw err;
        }
        throw new Error(
          `cannot validate flow-state transition because ${FLOW_STATE_REL_PATH} is unreadable or corrupt (${
            err instanceof Error ? err.message : String(err)
          }). Run \`cclaw doctor\` and reconcile the state before retrying.`
        );
      }
    }
    const safe = coerceFlowState({ ...(state as unknown as Record<string, unknown>) });
    await writeFileSafe(statePath, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });
  };
  if (options.skipLock) {
    await doWrite();
  } else {
    await withDirectoryLock(flowStateLockPath(projectRoot), doWrite);
  }
}

/**
 * Exposed path helper so callers that need to serialize a multi-step
 * state operation with flow-state writes (e.g. run archival) can
 * acquire the SAME lock directory used internally by `writeFlowState`.
 */
export function flowStateLockPathFor(projectRoot: string): string {
  return flowStateLockPath(projectRoot);
}

interface EnsureRunSystemOptions {
  createIfMissing?: boolean;
}

export async function ensureRunSystem(
  projectRoot: string,
  _options: EnsureRunSystemOptions = {}
): Promise<FlowState> {
  await ensureDir(runsRoot(projectRoot));
  await ensureDir(activeArtifactsPath(projectRoot));
  const statePath = flowStatePath(projectRoot);
  const state = await readFlowState(projectRoot);
  if (!(await exists(statePath))) {
    await writeFlowState(projectRoot, state, { allowReset: true });
  }
  return state;
}
