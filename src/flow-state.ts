import {
  buildTransitionRules,
  orderedStageSchemas,
  stageGateIds,
  stageRecommendedGateIds
} from "./content/stage-schema.js";
import { DISCOVERY_MODES, FLOW_STAGES, FLOW_TRACKS, TRACK_STAGES } from "./types.js";
import type { DiscoveryMode, FlowStage, FlowTrack, TransitionRule } from "./types.js";

export const TRANSITION_RULES: TransitionRule[] = buildTransitionRules();
export const FLOW_STATE_SCHEMA_VERSION = 1;

/** Snapshot from `collectRepoSignals` at last successful `start-flow` (optional on older states). */
export interface RepoSignals {
  fileCount: number;
  hasReadme: boolean;
  hasPackageManifest: boolean;
  capturedAt: string;
}

export interface StageGateState {
  required: string[];
  recommended: string[];
  conditional: string[];
  /** Conditional gates currently considered active for blocking checks. */
  triggered: string[];
  passed: string[];
  blocked: string[];
}

export interface RewindRecord {
  id: string;
  fromStage: FlowStage;
  toStage: FlowStage;
  reason: string;
  timestamp: string;
  invalidatedStages: FlowStage[];
}

export interface StaleStageMarker {
  rewindId: string;
  reason: string;
  markedAt: string;
  acknowledgedAt?: string;
}

export interface RetroState {
  required: boolean;
  completedAt?: string;
  compoundEntries: number;
}

/**
 * Ship closeout substate machine.
 *
 * After ship completes, cclaw auto-chains post-ship review → archive.
 * Each step is interruptible: `/cc` reads `shipSubstate` and resumes
 * from the correct step even across sessions.
 *
 * - `idle` — ship not complete, or closeout not yet started.
 * - `post_ship_review` — unified closeout leg: retro acceptance/edit/no changes
 *   plus compound pass execution (or explicit no-additional-changes path).
 * - `ready_to_archive` — retro + compound done; archive is the next
 *   automatic step.
 * - `archived` — archive completed in this session (transient — archive
 *   resets flow-state so this value does not persist between runs).
 *
 * Layer separation (intentional):
 * - `next: "done"` in stage schema means "the flow stage chain ended".
 * - `shipSubstate: "archived"` is closeout-machine progress after ship.
 * - `shipSubstate: "idle"` is the default closeout value before ship.
 *
 * These are not duplicates: `done` lives in stage transitions; `archived` /
 * `idle` live in closeout lifecycle state.
 */
export const SHIP_SUBSTATES = [
  "idle",
  "post_ship_review",
  "ready_to_archive",
  "archived"
] as const;
export type ShipSubstate = (typeof SHIP_SUBSTATES)[number];

export interface CloseoutState {
  shipSubstate: ShipSubstate;
  retroDraftedAt?: string;
  retroAcceptedAt?: string;
  retroSkipped?: boolean;
  retroSkipReason?: string;
  compoundCompletedAt?: string;
  compoundSkipped?: boolean;
  compoundSkipReason?: string;
  compoundPromoted: number;
}

export function createInitialCloseoutState(): CloseoutState {
  return {
    shipSubstate: "idle",
    retroDraftedAt: undefined,
    retroAcceptedAt: undefined,
    retroSkipped: undefined,
    retroSkipReason: undefined,
    compoundCompletedAt: undefined,
    compoundSkipped: undefined,
    compoundSkipReason: undefined,
    compoundPromoted: 0
  };
}

export interface FlowState {
  /** Backward-compatible schema marker for future migrations. */
  schemaVersion: typeof FLOW_STATE_SCHEMA_VERSION;
  activeRunId: string;
  currentStage: FlowStage;
  completedStages: FlowStage[];
  guardEvidence: Record<string, string>;
  stageGateCatalog: Record<FlowStage, StageGateState>;
  /** Active flow track (determines which stages are in the critical path for this run). */
  track: FlowTrack;
  /** Run-level upstream shaping mode chosen once at start (`lean` / `guided` / `deep`). */
  discoveryMode: DiscoveryMode;
  /**
   * Wave 25 (v6.1.0) — optional task class for the active run.
   *
   * Mirrors the `MandatoryDelegationTaskClass` union used by Wave 24's
   * `mandatoryAgentsFor` helper. When set to `"software-bugfix"`, the
   * artifact-validation escape (`shouldDemoteArtifactValidationByTrack`)
   * collapses lite-tier-only checks (Architecture Diagram async/failure
   * edges, Interaction Edge Case mandatory rows, Stale Diagram Drift,
   * Expansion Strategist) from required → advisory.
   *
   * Persistence is best-effort: existing flow-state.json files written
   * before Wave 25 simply omit the field (treated as `null`).
   */
  taskClass?: "software-standard" | "software-trivial" | "software-bugfix" | null;
  /** Stages explicitly skipped for this track (empty for standard; populated for quick). */
  skippedStages: FlowStage[];
  /** Stages invalidated by rewind operations and awaiting explicit acknowledgement. */
  staleStages: Partial<Record<FlowStage, StaleStageMarker>>;
  /** Chronological rewind operations for the active run. */
  rewinds: RewindRecord[];
  /** Optional per-stage interaction hints carried from prior stage transitions. */
  interactionHints?: Partial<Record<FlowStage, StageInteractionHint>>;
  /** Mandatory retrospective gate status before archive. */
  retro: RetroState;
  /** Ship → post_ship_review → archive substate for resumable closeout. */
  closeout: CloseoutState;
  /** Repo shape signals captured at last successful start-flow (omit on legacy files). */
  repoSignals?: RepoSignals;
  /**
   * Best-effort stage completion timestamps (ISO strings) captured as stages
   * enter `completedStages`. Missing keys behave like legacy flows with no audit
   * clock for post-closure mutation hints.
   */
  completedStageMeta?: Partial<Record<FlowStage, { completedAt: string }>>;
  /**
   * v6.12.0 — TDD migration cutover marker. When `cclaw-cli sync` detects an
   * existing `06-tdd.md` with legacy per-slice tables but no auto-render
   * markers, it inserts the markers and records the highest legacy slice id
   * here (e.g. `"S-10"`). The TDD linter uses this value to:
   *   - exempt slices `<= cutoverSliceId` from new mandatory rules (legacy
   *     slices keep their markdown tables);
   *   - emit `tdd_legacy_section_writes_after_cutover` advisory when a slice
   *     id `> cutoverSliceId` appears in legacy per-slice sections of
   *     `06-tdd.md` (post-cutover prose belongs in `tdd-slices/S-<id>.md`).
   *
   * Optional + best-effort: omitted on fresh installs and on legacy files
   * sync hasn't visited yet.
   */
  tddCutoverSliceId?: string;
  /**
   * v6.14.2 — boundary slice id at which worktree-first protocol began
   * applying. `cclaw-cli sync` auto-stamps this when
   * `legacyContinuation: true` AND `worktreeExecutionMode: "worktree-first"`
   * AND the value is not already set.
   *
   * Detection rule (v6.14.2): the highest `S-N` among slices with at
   * least one completed `slice-implementer` row in the active run that
   * carries NONE of the worktree-first metadata fields (`claimToken`,
   * `ownerLaneId`, `leasedUntil`). When no such slice exists, sync
   * falls back to `tddCutoverSliceId` so legacy v6.12 cutover marks
   * still confer the exemption.
   *
   * Effect: closed slices whose numeric id is `<= tddWorktreeCutoverSliceId`
   * AND whose `slice-implementer` rows in the active run lack ALL
   * three worktree fields are exempt from `tdd_slice_lane_metadata_missing`,
   * `tdd_slice_claim_token_missing`, and `tdd_lease_expired_unreclaimed`.
   *
   * One-shot: subsequent sync runs leave the value untouched. Operators
   * may pin it earlier/later by direct edit + `cclaw-cli internal
   * flow-state-repair --reason=<slug>`.
   */
  tddWorktreeCutoverSliceId?: string;
  /**
   * v6.13.0 — when `worktree-first` (default for newly initialized runs),
   * slice-implementer work happens in isolated git worktrees with explicit
   * claims/leases and deterministic fan-in integration.
   *
   * Omitted on legacy `flow-state.json` files: treated as `single-tree` via
   * `effectiveWorktreeExecutionMode`.
   */
  worktreeExecutionMode?: "single-tree" | "worktree-first";
  /**
   * v6.13.0 — set by `cclaw-cli sync` when the plan predates parallel-metadata
   * fields. Relaxes some plan linters for existing implementation units and
   * defaults scheduler parallelism to opt-in only for those units.
   */
  legacyContinuation?: boolean;
  /**
   * v6.14.0 — TDD wave checkpoint mode (stream-style parallel TDD).
   *
   * - `per-slice` — default for new projects. Each lane runs RED→GREEN as
   *   soon as its `dependsOn` closes; the linter enforces RED-before-GREEN
   *   per slice only (`tdd_slice_red_completed_before_green`). No global
   *   barrier between Phase A REDs and Phase B GREENs.
   * - `global-red` — legacy v6.12/v6.13 behavior. ALL Phase A REDs in a
   *   wave must complete before ANY Phase B GREEN starts. Auto-applied
   *   for projects with `legacyContinuation: true` so hox-style runs
   *   continue to enforce the wave barrier.
   *
   * Omitted on legacy state files (treated as `"global-red"` for
   * `legacyContinuation: true` and `"per-slice"` otherwise via
   * `effectiveTddCheckpointMode`).
   */
  tddCheckpointMode?: "per-slice" | "global-red";
  /**
   * v6.14.0 — integration-overseer dispatch mode.
   *
   * - `conditional` — default for new projects. The controller calls
   *   `integrationCheckRequired(events)` after wave closeout; the
   *   integration-overseer is dispatched only when (a) two or more
   *   closed slices share import boundaries (heuristic: shared
   *   directory in `evidenceRefs`/`claimedPaths`), (b) any slice has
   *   `riskTier === "high"`, or (c) deterministic fan-in reported a
   *   `cclaw_fanin_conflict`. Otherwise the linter emits the audit
   *   row `cclaw_integration_overseer_skipped` and skips dispatch.
   * - `always` — legacy v6.13 behavior. Run integration-overseer
   *   after every multi-slice wave regardless of trigger.
   *
   * Omitted on legacy state files (treated as `"always"`).
   */
  integrationOverseerMode?: "conditional" | "always";
  /**
   * v6.14.2 — minimum elapsed milliseconds between `acknowledged` and
   * `completed` for a `slice-implementer --phase green` row. The hook
   * helper rejects fast-greens (`completedTs - ackTs < this`) with
   * `green_evidence_too_fresh` unless the dispatch carries
   * `--allow-fast-green --green-mode=observational`.
   *
   * Default 4000ms when omitted (see `effectiveTddGreenMinElapsedMs`).
   * Operators tuning the floor for very fast suites may set it lower
   * (e.g. `1500`) or set it to `0` to disable the check entirely while
   * keeping the other Fix 4 contracts (RED test name match, passing
   * assertion line) active.
   */
  tddGreenMinElapsedMs?: number;
}

/**
 * Effective worktree mode: legacy state files without the field keep
 * single-tree scheduling to avoid breaking existing runs on upgrade.
 */
export function effectiveWorktreeExecutionMode(state: FlowState): "single-tree" | "worktree-first" {
  return state.worktreeExecutionMode ?? "single-tree";
}

/**
 * Effective v6.14 TDD checkpoint mode: legacy state files without the
 * field default to `global-red` when `legacyContinuation: true` (hox)
 * and `per-slice` otherwise. Explicit values always win.
 */
export function effectiveTddCheckpointMode(
  state: FlowState
): "per-slice" | "global-red" {
  if (state.tddCheckpointMode === "per-slice" || state.tddCheckpointMode === "global-red") {
    return state.tddCheckpointMode;
  }
  return state.legacyContinuation === true ? "global-red" : "per-slice";
}

/**
 * Effective v6.14 integration-overseer mode: legacy state files without
 * the field default to `always` (matches v6.13 behavior).
 */
export function effectiveIntegrationOverseerMode(
  state: FlowState
): "conditional" | "always" {
  return state.integrationOverseerMode === "conditional" ? "conditional" : "always";
}

export const DEFAULT_TDD_GREEN_MIN_ELAPSED_MS = 4000;

/**
 * v6.14.2 — effective minimum GREEN elapsed window in milliseconds.
 * Returns the per-project override when present and finite; otherwise
 * the documented 4000ms default. Negative values or NaN fall through
 * to the default so a hand-edited `flow-state.json` cannot accidentally
 * disable the check via `-1` or `"oops"`.
 */
export function effectiveTddGreenMinElapsedMs(state: FlowState): number {
  const raw = state.tddGreenMinElapsedMs;
  if (typeof raw !== "number") return DEFAULT_TDD_GREEN_MIN_ELAPSED_MS;
  if (!Number.isFinite(raw)) return DEFAULT_TDD_GREEN_MIN_ELAPSED_MS;
  if (raw < 0) return DEFAULT_TDD_GREEN_MIN_ELAPSED_MS;
  return Math.floor(raw);
}

export interface StageInteractionHint {
  skipQuestions?: boolean;
  sourceStage?: FlowStage;
  recordedAt?: string;
  /**
   * Wave 23 (v5.0.0) — `/cc-ideate` handoff carry-forward.
   * When a brainstorm run is started from a `/cc-ideate` recommendation,
   * `start-flow` records the originating idea artifact so brainstorm can
   * reuse the divergent + critique + rank work instead of re-generating it.
   *
   * `fromIdeaArtifact` is a workspace-relative POSIX path to
   * `.cclaw/ideas/idea-YYYY-MM-DD-<slug>.md` (or wherever `/cc-ideate`
   * wrote its artifact). `fromIdeaCandidateId` is the chosen `I-#` row.
   */
  fromIdeaArtifact?: string;
  fromIdeaCandidateId?: string;
}

export interface InitialFlowStateOptions {
  activeRunId?: string;
  track?: FlowTrack;
  discoveryMode?: DiscoveryMode;
}

export function isFlowTrack(value: unknown): value is FlowTrack {
  return typeof value === "string" && (FLOW_TRACKS as readonly string[]).includes(value);
}

export function isDiscoveryMode(value: unknown): value is DiscoveryMode {
  return typeof value === "string" && (DISCOVERY_MODES as readonly string[]).includes(value);
}

export function trackStages(track: FlowTrack): FlowStage[] {
  return [...TRACK_STAGES[track]];
}

export function skippedStagesForTrack(track: FlowTrack): FlowStage[] {
  const inTrack = new Set(TRACK_STAGES[track]);
  return FLOW_STAGES.filter((stage) => !inTrack.has(stage));
}

export function firstStageForTrack(track: FlowTrack): FlowStage {
  const stages = TRACK_STAGES[track];
  return stages[0] ?? "brainstorm";
}

export function createRunId(date = new Date()): string {
  return `run-${date.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createInitialFlowState(
  activeRunIdOrOptions: string | InitialFlowStateOptions = {},
  maybeTrack?: FlowTrack
): FlowState {
  const options: InitialFlowStateOptions =
    typeof activeRunIdOrOptions === "string"
      ? { activeRunId: activeRunIdOrOptions, track: maybeTrack }
      : activeRunIdOrOptions;

  const activeRunId = options.activeRunId ?? createRunId();
  const track: FlowTrack = options.track ?? "standard";
  const discoveryMode: DiscoveryMode = options.discoveryMode ?? "guided";
  const skippedStages = skippedStagesForTrack(track);

  const stageGateCatalog = {} as Record<FlowStage, StageGateState>;
  for (const schema of orderedStageSchemas(track)) {
    stageGateCatalog[schema.stage] = {
      required: stageGateIds(schema.stage, track),
      recommended: stageRecommendedGateIds(schema.stage, track),
      conditional: [],
      triggered: [],
      passed: [],
      blocked: []
    };
  }

  return {
    schemaVersion: FLOW_STATE_SCHEMA_VERSION,
    activeRunId,
    currentStage: firstStageForTrack(track),
    completedStages: [],
    guardEvidence: {},
    stageGateCatalog,
    track,
    discoveryMode,
    skippedStages,
    staleStages: {},
    rewinds: [],
    interactionHints: {},
    retro: {
      required: false,
      completedAt: undefined,
      compoundEntries: 0
    },
    closeout: createInitialCloseoutState()
  };
}

export function canTransition(from: FlowStage, to: FlowStage): boolean {
  return TRANSITION_RULES.some((rule) => rule.from === from && rule.to === to);
}

export function getAvailableTransitions(
  from: FlowStage,
  track: FlowTrack = "standard"
): TransitionRule[] {
  const natural = nextStage(from, track);
  const fromRules = TRANSITION_RULES.filter((rule) => rule.from === from);
  if (!natural) {
    return fromRules;
  }
  return fromRules.sort((a, b) => {
    if (a.to === natural && b.to !== natural) return -1;
    if (b.to === natural && a.to !== natural) return 1;
    return a.to.localeCompare(b.to);
  });
}

export function getTransitionGuards(
  from: FlowStage,
  to: FlowStage,
  track: FlowTrack = "standard"
): string[] {
  // Natural forward edge on this track: derive guards fresh from the
  // track-specific gate schema. `TRANSITION_RULES` collapses shared edges
  // across tracks (first-registered wins), so reading guards directly
  // from the track-aware schema avoids silently dropping gates that only
  // the current track requires (e.g. `tdd_traceable_to_plan` on standard
  // gets lost if quick was registered first).
  const ordered = TRACK_STAGES[track];
  const fromIdx = ordered.indexOf(from);
  if (fromIdx >= 0 && ordered[fromIdx + 1] === to) {
    return stageGateIds(from, track);
  }
  // Non-neighbour edges (e.g. `review -> tdd` with `review_verdict_blocked`)
  // carry special guards not derivable from a stage's gate catalog; fall
  // back to the pre-computed rule table.
  const match = TRANSITION_RULES.find((rule) => rule.from === from && rule.to === to);
  return match ? [...match.guards] : [];
}

export function nextStage(stage: FlowStage, track: FlowTrack = "standard"): FlowStage | null {
  const ordered = TRACK_STAGES[track];
  const index = ordered.indexOf(stage);
  if (index < 0) {
    return null;
  }
  if (index === ordered.length - 1) {
    return null;
  }
  return ordered[index + 1];
}

export function previousStage(stage: FlowStage, track: FlowTrack = "standard"): FlowStage | null {
  const ordered = TRACK_STAGES[track];
  const index = ordered.indexOf(stage);
  if (index === 0) {
    return null;
  }
  if (index < 0) {
    const fallback = FLOW_STAGES.indexOf(stage);
    if (fallback <= 0) {
      return null;
    }
    return FLOW_STAGES[fallback - 1];
  }
  return ordered[index - 1];
}
