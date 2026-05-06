import type {
  ExecutionStrictnessProfile,
  ExecutionTopology
} from "./types.js";

export interface ExecutionTopologyShape {
  /** Ready implementation units/slices the controller could execute now. */
  unitCount: number;
  /** Ready units with no declared dependency/path conflict against each other. */
  independentUnitCount?: number;
  /** Ready units large enough to justify isolated builder overhead. */
  substantialUnitCount?: number;
  /** True when same-wave path ownership overlaps or is unknown-dangerous. */
  hasPathConflicts?: boolean;
  /** True for migrations, public contracts, security, data loss, or broad API changes. */
  highRisk?: boolean;
  /** True when a plan or controller explicitly requests micro-slice discipline. */
  requiresStrictMicro?: boolean;
  /** True when the controller can safely execute the unit inline in the current harness. */
  inlineSafe?: boolean;
  /**
   * 7.7.1 — count of ready units classified as discovery-only/scaffold/docs
   * lanes that are not high-risk and have no path conflicts. When this equals
   * `unitCount`, the auto router collapses the wave into `inline` (small
   * batch) or `single-builder` (large batch) so trivial markdown spikes never
   * fan out into one slice-builder span per file.
   */
  discoveryOnlyUnits?: number;
}

export interface ExecutionTopologyDecision {
  topology: Exclude<ExecutionTopology, "auto">;
  maxBuilders: number;
  reason: string;
}

export interface RouteExecutionTopologyOptions {
  configuredTopology?: ExecutionTopology;
  strictness?: ExecutionStrictnessProfile;
  maxBuilders?: number;
  shape: ExecutionTopologyShape;
}

const DEFAULT_MAX_BUILDERS = 5;

function normalizeMaxBuilders(value: number | undefined): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1
    ? value
    : DEFAULT_MAX_BUILDERS;
}

/**
 * Choose the cheapest safe execution topology for a ready TDD surface.
 *
 * Safety invariants are intentionally conservative: explicit strict-micro wins,
 * path conflicts prevent fan-out, and parallel builders require multiple
 * independent substantial units plus a builder cap above one.
 */
export function routeExecutionTopology(
  options: RouteExecutionTopologyOptions
): ExecutionTopologyDecision {
  const configured = options.configuredTopology ?? "auto";
  const strictness = options.strictness ?? "balanced";
  const maxBuilders = normalizeMaxBuilders(options.maxBuilders);
  const shape = options.shape;

  if (configured !== "auto") {
    return {
      topology: configured,
      maxBuilders,
      reason: `configured execution.topology=${configured}`
    };
  }

  if (shape.requiresStrictMicro || strictness === "strict") {
    return {
      topology: "strict-micro",
      maxBuilders,
      reason: shape.requiresStrictMicro
        ? "plan requested strict micro-slice execution"
        : "strict execution profile selected"
    };
  }

  const unitCount = Math.max(0, shape.unitCount);
  if (unitCount === 0) {
    return {
      topology: "inline",
      maxBuilders,
      reason: "no ready units; controller can reconcile inline"
    };
  }

  if (shape.hasPathConflicts) {
    return {
      topology: "single-builder",
      maxBuilders,
      reason: "path conflicts require serialized execution"
    };
  }

  // 7.7.1 — lane-aware short-circuit. When every ready unit is a non-high-risk
  // discovery/scaffold/docs lane with no path conflicts, never fan out: the
  // controller should fulfil a small batch inline, or hand the whole wave to a
  // single builder when the batch is large enough that one inline turn would
  // bloat the controller transcript.
  const discoveryOnly = shape.discoveryOnlyUnits ?? 0;
  if (
    !shape.highRisk &&
    discoveryOnly === unitCount &&
    unitCount >= 1
  ) {
    if (unitCount <= 3) {
      return {
        topology: "inline",
        maxBuilders,
        reason: "discovery-only ready set; controller can fulfill inline"
      };
    }
    return {
      topology: "single-builder",
      maxBuilders,
      reason: "discovery-only ready set is large; one builder owns the wave"
    };
  }

  const independent = shape.independentUnitCount ?? unitCount;
  const substantial = shape.substantialUnitCount ?? unitCount;
  if (maxBuilders > 1 && independent >= 2 && substantial >= 2) {
    return {
      topology: "parallel-builders",
      maxBuilders,
      reason: "multiple independent substantial units are ready"
    };
  }

  if (unitCount === 1 && shape.inlineSafe && !shape.highRisk) {
    return {
      topology: "inline",
      maxBuilders,
      reason: "single low-risk inline-safe unit"
    };
  }

  return {
    topology: "single-builder",
    maxBuilders,
    reason: unitCount === 1
      ? "single ready unit keeps builder evidence isolated"
      : "ready units are not safely parallelizable"
  };
}
