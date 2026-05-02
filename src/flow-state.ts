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
 * - `post_ship_review` — unified closeout leg: retro acceptance/edit/skip
 *   plus compound pass execution (or explicit skip).
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
