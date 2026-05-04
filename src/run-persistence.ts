import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import {
  nextStage,
  createInitialCloseoutState,
  createInitialFlowState,
  FLOW_STATE_SCHEMA_VERSION,
  isDiscoveryMode,
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
import type { DiscoveryMode, FlowStage, FlowTrack } from "./types.js";

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
  /**
   * Free-form writer identifier persisted in the `.flow-state.guard.json`
   * sidecar. Helps operators trace which subsystem wrote a given state
   * (e.g. `advance-stage`, `start-flow`, `run-archive`). Defaults to
   * `cclaw-cli` when omitted.
   */
  writerSubsystem?: string;
}

export interface ReadFlowStateOptions {
  /**
   * Reserved compatibility switch from older runtimes. The repair layer was removed,
   * so this flag is now a no-op and only preserved for API stability.
   */
  repairFeatureSystem?: boolean;
}

const FLOW_STATE_REL_PATH = `${RUNTIME_ROOT}/state/flow-state.json`;
const FLOW_STATE_GUARD_REL_PATH = `${RUNTIME_ROOT}/.flow-state.guard.json`;
const FLOW_STATE_REPAIR_LOG_REL_PATH = `${RUNTIME_ROOT}/.flow-state-repair.log`;
const ARCHIVE_DIR_REL_PATH = `${RUNTIME_ROOT}/archive`;
const ACTIVE_ARTIFACTS_REL_PATH = `${RUNTIME_ROOT}/artifacts`;
const FLOW_STAGE_SET = new Set<string>(FLOW_STAGES);
const DEFAULT_WRITER_SUBSYSTEM = "cclaw-cli";
const DEFAULT_REPAIR_REASON_PATTERN = /^[a-z][a-z0-9_-]{2,}$/u;

export interface FlowStateGuardSidecar {
  sha256: string;
  writtenAt: string;
  writerSubsystem: string;
  runId: string;
}

export interface FlowStateGuardMismatchDetails {
  expectedSha: string;
  actualSha: string;
  lastWriter: string;
  writtenAt: string;
  runId: string;
  statePath: string;
  guardPath: string;
  repairCommand: string;
}

export class FlowStateGuardMismatchError extends Error {
  readonly expectedSha: string;
  readonly actualSha: string;
  readonly lastWriter: string;
  readonly writtenAt: string;
  readonly runId: string;
  readonly statePath: string;
  readonly guardPath: string;
  readonly repairCommand: string;
  constructor(details: FlowStateGuardMismatchDetails) {
    super(
      `flow-state guard mismatch: ${details.runId}\n` +
        `expected sha: ${details.expectedSha}\n` +
        `actual sha:   ${details.actualSha}\n` +
        `last writer:  ${details.lastWriter}@${details.writtenAt}\n` +
        `do not edit flow-state.json by hand. To recover, run:\n` +
        `  ${details.repairCommand}`
    );
    this.name = "FlowStateGuardMismatchError";
    this.expectedSha = details.expectedSha;
    this.actualSha = details.actualSha;
    this.lastWriter = details.lastWriter;
    this.writtenAt = details.writtenAt;
    this.runId = details.runId;
    this.statePath = details.statePath;
    this.guardPath = details.guardPath;
    this.repairCommand = details.repairCommand;
  }
}

function canonicalFlowStateShaFromRaw(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

function guardSidecarPath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_GUARD_REL_PATH);
}

function repairLogPath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REPAIR_LOG_REL_PATH);
}

interface CoercedFlowStateResult {
  state: FlowState;
}

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

  if (prev.discoveryMode !== next.discoveryMode) {
    throw new InvalidStageTransitionError(
      prev.currentStage,
      next.currentStage,
      `cannot change discoveryMode from "${prev.discoveryMode}" to "${next.discoveryMode}" mid-run (activeRunId="${prev.activeRunId}"). Reclassify through start-flow or start a new run.`
    );
  }

  const newRewind = next.rewinds.length === prev.rewinds.length + 1
    ? next.rewinds[next.rewinds.length - 1]
    : undefined;
  const isManagedRewind = newRewind !== undefined
    && newRewind.fromStage === prev.currentStage
    && newRewind.toStage === next.currentStage
    && newRewind.invalidatedStages.includes(next.currentStage);
  const removedCompletedStages = prev.completedStages.filter((stage) => !next.completedStages.includes(stage));
  if (removedCompletedStages.length > 0 && !isManagedRewind) {
    throw new InvalidStageTransitionError(
      prev.currentStage,
      next.currentStage,
      `completedStages must be monotonic: stage(s) ${removedCompletedStages.map((stage) => `"${stage}"`).join(", ")} were previously completed but are missing from the new state.`
    );
  }
  if (isManagedRewind) {
    const invalidated = new Set(newRewind.invalidatedStages);
    const unexpectedRemoved = removedCompletedStages.filter((stage) => !invalidated.has(stage));
    const missingMarkers = newRewind.invalidatedStages.filter((stage) => {
      const marker = next.staleStages[stage];
      return !marker || marker.rewindId !== newRewind.id;
    });
    if (unexpectedRemoved.length > 0 || missingMarkers.length > 0) {
      throw new InvalidStageTransitionError(
        prev.currentStage,
        next.currentStage,
        `managed rewind state is inconsistent: unexpectedRemoved=${unexpectedRemoved.join(",") || "none"}; missingMarkers=${missingMarkers.join(",") || "none"}.`
      );
    }
    return;
  }

  if (prev.currentStage === next.currentStage) {
    return;
  }

  const naturalForward = nextStage(prev.currentStage, prev.track);
  const isNaturalForward = naturalForward === next.currentStage;
  const isReviewRewind = prev.currentStage === "review" && next.currentStage === "tdd";
  if (!isNaturalForward && !isReviewRewind) {
    throw new InvalidStageTransitionError(
      prev.currentStage,
      next.currentStage,
      `no transition rule allows "${prev.currentStage}" -> "${next.currentStage}" for track "${prev.track}". Use /cc to advance stages or archive the run to reset.`
    );
  }
}

function flowStatePath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REL_PATH);
}

function flowStateLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".flow-state.lock");
}

function archiveRoot(projectRoot: string): string {
  return path.join(projectRoot, ARCHIVE_DIR_REL_PATH);
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

function coerceDiscoveryMode(value: unknown): DiscoveryMode {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (isDiscoveryMode(normalized)) return normalized;
  }
  return "guided";
}

function coerceRepoSignals(value: unknown): FlowState["repoSignals"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const typed = value as Record<string, unknown>;
  const fileCountRaw = typed.fileCount;
  const fileCount =
    typeof fileCountRaw === "number" && Number.isFinite(fileCountRaw) && fileCountRaw >= 0
      ? Math.min(Math.floor(fileCountRaw), 1_000_000)
      : undefined;
  const capturedAt = typeof typed.capturedAt === "string" ? typed.capturedAt.trim() : "";
  if (fileCount === undefined || !capturedAt) {
    return undefined;
  }
  return {
    fileCount,
    hasReadme: typed.hasReadme === true,
    hasPackageManifest: typed.hasPackageManifest === true,
    capturedAt
  };
}

/**
 * Wave 24 follow-up (v6.1.1) — preserve `flow-state.json#taskClass`
 * across read/write round-trips. Before this audit fix the persistence
 * layer silently dropped the field, which made the Wave 24 bugfix-skip
 * (`mandatoryAgentsFor` short-circuit) and the Wave 25 artifact-validation
 * demotion both dead in practice: the only entry point that classified
 * a run was the unit-test harness passing `options.taskClass` directly
 * to `checkMandatoryDelegations`. The accepted union mirrors
 * `MandatoryDelegationTaskClass` plus `null` so callers can explicitly
 * clear the classification without dropping the property.
 */
function coerceTaskClass(
  value: unknown
): FlowState["taskClass"] {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (
    value === "software-standard" ||
    value === "software-trivial" ||
    value === "software-bugfix"
  ) {
    return value;
  }
  return undefined;
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

function sanitizeCompletedStageMeta(value: unknown): FlowState["completedStageMeta"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  const out: Partial<Record<FlowStage, { completedAt: string }>> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isFlowStage(key)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const record = raw as Record<string, unknown>;
    const ca = typeof record.completedAt === "string" ? record.completedAt.trim() : "";
    if (ca.length > 0) {
      out[key] = { completedAt: ca };
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
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

function sanitizeInteractionHints(
  value: unknown
): FlowState["interactionHints"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const out: NonNullable<FlowState["interactionHints"]> = {};
  for (const [stage, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isFlowStage(stage)) continue;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const typed = raw as Record<string, unknown>;
    const skipQuestions = typed.skipQuestions === true ? true : undefined;
    const sourceStage = isFlowStage(typed.sourceStage) ? typed.sourceStage : undefined;
    const recordedAt = typeof typed.recordedAt === "string" ? typed.recordedAt : undefined;
    const fromIdeaArtifact =
      typeof typed.fromIdeaArtifact === "string" && typed.fromIdeaArtifact.trim().length > 0
        ? typed.fromIdeaArtifact.trim()
        : undefined;
    const fromIdeaCandidateId =
      typeof typed.fromIdeaCandidateId === "string" && typed.fromIdeaCandidateId.trim().length > 0
        ? typed.fromIdeaCandidateId.trim()
        : undefined;
    if (
      skipQuestions !== true &&
      !sourceStage &&
      !recordedAt &&
      !fromIdeaArtifact &&
      !fromIdeaCandidateId
    ) {
      continue;
    }
    out[stage] = {
      ...(skipQuestions ? { skipQuestions } : {}),
      ...(sourceStage ? { sourceStage } : {}),
      ...(recordedAt ? { recordedAt } : {}),
      ...(fromIdeaArtifact ? { fromIdeaArtifact } : {}),
      ...(fromIdeaCandidateId ? { fromIdeaCandidateId } : {})
    };
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

function sanitizeCloseoutState(
  value: unknown
): CloseoutState {
  const fallback = createInitialCloseoutState();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  const typed = value as Record<string, unknown>;
  const rawShipSubstate = typeof typed.shipSubstate === "string" ? typed.shipSubstate : undefined;
  let shipSubstate: ShipSubstate;
  if (rawShipSubstate === "retro_review" || rawShipSubstate === "compound_review") {
    shipSubstate = "post_ship_review";
  } else {
    shipSubstate = isShipSubstate(rawShipSubstate) ? rawShipSubstate : fallback.shipSubstate;
  }
  const retroDraftedAt = typeof typed.retroDraftedAt === "string" ? typed.retroDraftedAt : undefined;
  const retroAcceptedAt = typeof typed.retroAcceptedAt === "string" ? typed.retroAcceptedAt : undefined;
  const retroSkipReason = typeof typed.retroSkipReason === "string"
    ? typed.retroSkipReason.trim() || undefined
    : undefined;
  const retroSkipped = typed.retroSkipped === true && retroSkipReason !== undefined
    ? true
    : undefined;
  const compoundCompletedAt = typeof typed.compoundCompletedAt === "string" ? typed.compoundCompletedAt : undefined;
  const compoundSkipReason = typeof typed.compoundSkipReason === "string"
    ? typed.compoundSkipReason.trim() || undefined
    : undefined;
  const compoundSkipped = typed.compoundSkipped === true && compoundSkipReason !== undefined
    ? true
    : undefined;
  const promotedRaw = typed.compoundPromoted;
  const compoundPromoted =
    typeof promotedRaw === "number" && Number.isFinite(promotedRaw) && promotedRaw >= 0
      ? Math.floor(promotedRaw)
      : 0;

  // Demote shipSubstate when its closeout invariants are violated on disk. A
  // hand-edited flow-state could claim `ready_to_archive` without completing
  // the compound leg, which would let `archive` skip durable closeout proof.
  const retroDone = retroAcceptedAt !== undefined || retroSkipped === true;
  const compoundDone =
    compoundCompletedAt !== undefined || compoundPromoted > 0 || compoundSkipped === true;
  if (shipSubstate === "ready_to_archive" && (!retroDone || !compoundDone)) {
    shipSubstate = "post_ship_review";
  }

  return {
    shipSubstate,
    retroDraftedAt,
    retroAcceptedAt,
    retroSkipped,
    retroSkipReason,
    compoundCompletedAt,
    compoundSkipped,
    compoundSkipReason,
    compoundPromoted
  };
}

function coerceFlowState(parsed: Record<string, unknown>): CoercedFlowStateResult {
  const track = coerceTrack(parsed.track);
  const discoveryMode = coerceDiscoveryMode(parsed.discoveryMode);
  const next = createInitialFlowState({ track, discoveryMode });
  const activeRunIdRaw = parsed.activeRunId;
  const activeRunId = typeof activeRunIdRaw === "string" && activeRunIdRaw.trim().length > 0
    ? activeRunIdRaw.trim()
    : next.activeRunId;

  const taskClass = coerceTaskClass(parsed.taskClass);
  const repoSignals = coerceRepoSignals(parsed.repoSignals);
  const completedStageMeta = sanitizeCompletedStageMeta(parsed.completedStageMeta);
  const tddCutoverSliceId = coerceTddCutoverSliceId(parsed.tddCutoverSliceId);
  const worktreeExecutionMode = coerceWorktreeExecutionMode(parsed.worktreeExecutionMode);
  const legacyContinuation =
    typeof parsed.legacyContinuation === "boolean" ? parsed.legacyContinuation : undefined;
  const state: FlowState = {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    activeRunId,
    currentStage: isFlowStage(parsed.currentStage) ? parsed.currentStage : next.currentStage,
    completedStages: sanitizeCompletedStages(parsed.completedStages),
    guardEvidence: sanitizeGuardEvidence(parsed.guardEvidence),
    stageGateCatalog: sanitizeStageGateCatalog(parsed.stageGateCatalog, next.stageGateCatalog),
    track,
    discoveryMode,
    ...(taskClass !== undefined ? { taskClass } : {}),
    ...(repoSignals ? { repoSignals } : {}),
    ...(completedStageMeta ? { completedStageMeta } : {}),
    ...(tddCutoverSliceId ? { tddCutoverSliceId } : {}),
    ...(worktreeExecutionMode !== undefined ? { worktreeExecutionMode } : {}),
    ...(legacyContinuation !== undefined ? { legacyContinuation } : {}),
    skippedStages: sanitizeSkippedStages(parsed.skippedStages, track),
    staleStages: sanitizeStaleStages(parsed.staleStages),
    rewinds: sanitizeRewinds(parsed.rewinds),
    interactionHints: sanitizeInteractionHints(parsed.interactionHints),
    retro: sanitizeRetroState(parsed.retro),
    closeout: sanitizeCloseoutState(parsed.closeout)
  };
  return { state };
}

/**
 * v6.12.0 — best-effort coercion for `tddCutoverSliceId`. Returns the value
 * only when it matches the canonical slice id shape `S-<digits>`; otherwise
 * returns null so the field is omitted from the rehydrated state.
 */
function coerceTddCutoverSliceId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^S-\d+$/u.test(trimmed) ? trimmed : null;
}

function coerceWorktreeExecutionMode(
  value: unknown
): FlowState["worktreeExecutionMode"] | undefined {
  if (value === "single-tree" || value === "worktree-first") return value;
  return undefined;
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

function buildRepairCommand(reason = "<manual_edit_recovery>"): string {
  return `cclaw-cli internal flow-state-repair --reason "${reason}"`;
}

async function readGuardSidecar(
  projectRoot: string
): Promise<FlowStateGuardSidecar | null> {
  const guardPath = guardSidecarPath(projectRoot);
  try {
    const raw = await fs.readFile(guardPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    const sha256 = typeof parsed.sha256 === "string" ? parsed.sha256 : "";
    const writtenAt = typeof parsed.writtenAt === "string" ? parsed.writtenAt : "";
    const writerSubsystem = typeof parsed.writerSubsystem === "string" ? parsed.writerSubsystem : "";
    const runId = typeof parsed.runId === "string" ? parsed.runId : "";
    if (!sha256 || !writtenAt || !writerSubsystem || !runId) {
      return null;
    }
    return { sha256, writtenAt, writerSubsystem, runId };
  } catch {
    return null;
  }
}

async function verifyFlowStateGuardFromRaw(
  projectRoot: string,
  statePath: string,
  rawContents: string
): Promise<void> {
  const sidecar = await readGuardSidecar(projectRoot);
  if (!sidecar) {
    // Legacy: flow-state.json was written by a pre-guard runtime, or sidecar
    // was intentionally reset. Permit the read so existing projects keep
    // working; the next legitimate stage-complete writes a fresh sidecar.
    return;
  }
  const actualSha = canonicalFlowStateShaFromRaw(rawContents);
  if (actualSha === sidecar.sha256) {
    return;
  }
  throw new FlowStateGuardMismatchError({
    expectedSha: sidecar.sha256,
    actualSha,
    lastWriter: sidecar.writerSubsystem,
    writtenAt: sidecar.writtenAt,
    runId: sidecar.runId,
    statePath,
    guardPath: guardSidecarPath(projectRoot),
    repairCommand: buildRepairCommand("manual_edit_recovery")
  });
}

/**
 * Verify the on-disk flow-state against the sha256 sidecar. Throws
 * `FlowStateGuardMismatchError` when manual editing is detected. Safe to
 * call on projects that have never written a sidecar: a missing sidecar is
 * treated as "legacy runtime" and the check silently succeeds.
 */
export async function verifyFlowStateGuard(
  projectRoot: string
): Promise<void> {
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) return;
  let raw: string;
  try {
    raw = await fs.readFile(statePath, "utf8");
  } catch {
    return;
  }
  await verifyFlowStateGuardFromRaw(projectRoot, statePath, raw);
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
  return coerceFlowState(parsed as Record<string, unknown>).state;
}

/**
 * Guarded read wrapper used by runtime hook scripts and the repair CLI.
 * Unlike `readFlowState`, it enforces the sha256 sidecar before returning:
 * a manual edit to flow-state.json fails fast with
 * `FlowStateGuardMismatchError`.
 */
export async function readFlowStateGuarded(
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
  await verifyFlowStateGuardFromRaw(projectRoot, statePath, raw);
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
  return coerceFlowState(parsed as Record<string, unknown>).state;
}

export async function writeFlowState(
  projectRoot: string,
  state: FlowState,
  options: WriteFlowStateOptions = {}
): Promise<void> {
  const writerSubsystem = options.writerSubsystem?.trim() || DEFAULT_WRITER_SUBSYSTEM;
  const doWrite = async (): Promise<void> => {
    const statePath = flowStatePath(projectRoot);
    if (!options.allowReset && (await exists(statePath))) {
      try {
        const rawExisting = await fs.readFile(statePath, "utf8");
        const parsed = JSON.parse(rawExisting) as Record<string, unknown>;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          const prev = coerceFlowState(parsed).state;
          validateFlowTransition(prev, state);
        }
      } catch (err) {
        if (err instanceof InvalidStageTransitionError) {
          throw err;
        }
        throw new Error(
          `cannot validate flow-state transition because ${FLOW_STATE_REL_PATH} is unreadable or corrupt (${
            err instanceof Error ? err.message : String(err)
          }). Run \`npx cclaw-cli sync\` and reconcile the state before retrying.`
        );
      }
    }
    const safe = coerceFlowState({ ...(state as unknown as Record<string, unknown>) }).state;
    const canonicalPayload = `${JSON.stringify(safe, null, 2)}\n`;
    const sha256 = canonicalFlowStateShaFromRaw(canonicalPayload);
    await writeFileSafe(statePath, canonicalPayload, { mode: 0o600 });
    const sidecar: FlowStateGuardSidecar = {
      sha256,
      writtenAt: new Date().toISOString(),
      writerSubsystem,
      runId: safe.activeRunId
    };
    await writeFileSafe(
      guardSidecarPath(projectRoot),
      `${JSON.stringify(sidecar, null, 2)}\n`,
      { mode: 0o600 }
    );
  };
  if (options.skipLock) {
    await doWrite();
  } else {
    await withDirectoryLock(flowStateLockPath(projectRoot), doWrite);
  }
}

/**
 * Named entry point for the write-guard workstream. Equivalent to
 * `writeFlowState`: the write always produces the sha256 sidecar via
 * the internal implementation so every existing writer inherits the
 * guard without rewriting callsites.
 */
export async function writeFlowStateGuarded(
  projectRoot: string,
  state: FlowState,
  options: WriteFlowStateOptions = {}
): Promise<void> {
  await writeFlowState(projectRoot, state, options);
}

export interface FlowStateRepairResult {
  sidecar: FlowStateGuardSidecar;
  repairLogPath: string;
  guardPath: string;
  /** Stages that were retro-backfilled into completedStageMeta during repair. */
  completedStageMetaBackfilled: FlowStage[];
}

/**
 * v6.9.0 — backfill missing `completedStageMeta` rows for any stage that
 * already lives in `completedStages` but has no audit timestamp. Uses the
 * stage's artifact mtime when available, otherwise the current time. This
 * runs as part of `flow-state-repair` so legacy v6.8 flow-state.json files
 * get their meta carried forward without a destructive rewrite.
 */
async function backfillCompletedStageMeta(
  projectRoot: string,
  state: FlowState
): Promise<{ state: FlowState; backfilled: FlowStage[] }> {
  const meta = { ...(state.completedStageMeta ?? {}) } as Partial<
    Record<FlowStage, { completedAt: string }>
  >;
  const backfilled: FlowStage[] = [];
  for (const stage of state.completedStages) {
    if (meta[stage] && typeof meta[stage]!.completedAt === "string" && meta[stage]!.completedAt.length > 0) {
      continue;
    }
    let completedAt = new Date().toISOString();
    try {
      const { resolveArtifactPath } = await import("./artifact-paths.js");
      const resolved = await resolveArtifactPath(stage, {
        projectRoot,
        track: state.track,
        intent: "read"
      });
      const stat = await fs.stat(resolved.absPath);
      completedAt = new Date(stat.mtimeMs).toISOString();
    } catch {
      // artifact missing or unreadable — fall back to "now" so the meta row
      // is at least consistently populated; operators can re-edit if needed.
    }
    meta[stage] = { completedAt };
    backfilled.push(stage);
  }
  if (backfilled.length === 0) {
    return { state, backfilled };
  }
  return { state: { ...state, completedStageMeta: meta }, backfilled };
}

/**
 * Recompute the write-guard sidecar from the current on-disk flow-state
 * contents and append an audit entry to `.cclaw/.flow-state-repair.log`.
 * The reason is required so no repair happens without an operator-visible
 * rationale. Intended to be called only from the explicit
 * `cclaw-cli internal flow-state-repair` subcommand.
 */
export async function repairFlowStateGuard(
  projectRoot: string,
  reason: string
): Promise<FlowStateRepairResult> {
  const trimmed = reason.trim();
  if (trimmed.length === 0) {
    throw new Error(
      "flow-state-repair requires --reason=<slug> (e.g. --reason=\"manual_edit_recovery\")."
    );
  }
  if (!DEFAULT_REPAIR_REASON_PATTERN.test(trimmed)) {
    throw new Error(
      "flow-state-repair --reason must match /^[a-z][a-z0-9_-]{2,}$/ (short lowercase slug)."
    );
  }
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    throw new Error(
      `flow-state-repair: ${FLOW_STATE_REL_PATH} does not exist; nothing to repair.`
    );
  }
  return withDirectoryLock(flowStateLockPath(projectRoot), async () => {
    let raw = await fs.readFile(statePath, "utf8");
    let runId = "unknown-run";
    let backfilledStages: FlowStage[] = [];
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const coerced = coerceFlowState(parsed).state;
      runId = coerced.activeRunId;
      const { state: nextState, backfilled } = await backfillCompletedStageMeta(
        projectRoot,
        coerced
      );
      backfilledStages = backfilled;
      if (backfilled.length > 0) {
        // Persist the migrated state inside the same lock window so the
        // sha sidecar below covers the post-migration bytes, not the
        // pre-migration ones.
        await writeFlowState(projectRoot, nextState, {
          allowReset: true,
          skipLock: true,
          writerSubsystem: "flow-state-repair-backfill"
        });
        raw = await fs.readFile(statePath, "utf8");
      }
    } catch {
      // parsing failure falls back to "unknown-run"; repair intentionally
      // accepts the contents as-is so operators can recover even from
      // borderline JSON after manual edits.
    }
    const sha256 = canonicalFlowStateShaFromRaw(raw);
    const sidecar: FlowStateGuardSidecar = {
      sha256,
      writtenAt: new Date().toISOString(),
      writerSubsystem: "flow-state-repair",
      runId
    };
    const guardPath = guardSidecarPath(projectRoot);
    await writeFileSafe(
      guardPath,
      `${JSON.stringify(sidecar, null, 2)}\n`,
      { mode: 0o600 }
    );
    const logPath = repairLogPath(projectRoot);
    await ensureDir(path.dirname(logPath));
    const backfillNote =
      backfilledStages.length > 0
        ? ` backfilledCompletedStageMeta=${backfilledStages.join(",")}`
        : "";
    const logLine = `${sidecar.writtenAt} reason=${trimmed} runId=${sidecar.runId} sha256=${sidecar.sha256}${backfillNote}\n`;
    await fs.appendFile(logPath, logLine, "utf8");
    return {
      sidecar,
      repairLogPath: logPath,
      guardPath,
      completedStageMetaBackfilled: backfilledStages
    };
  });
}

export function flowStateGuardSidecarPathFor(projectRoot: string): string {
  return guardSidecarPath(projectRoot);
}

export function flowStateRepairLogPathFor(projectRoot: string): string {
  return repairLogPath(projectRoot);
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
  options: EnsureRunSystemOptions = {}
): Promise<FlowState> {
  await ensureDir(archiveRoot(projectRoot));
  await ensureDir(activeArtifactsPath(projectRoot));
  const statePath = flowStatePath(projectRoot);
  const state = await readFlowState(projectRoot);
  const createIfMissing = options.createIfMissing !== false;
  if (createIfMissing && !(await exists(statePath))) {
    await writeFlowState(projectRoot, state, { allowReset: true });
  }
  return state;
}
