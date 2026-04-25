import type { FlowTrack } from "../types.js";

export interface TrackRenderContext {
  track: FlowTrack;
  usesPlanTerminology: boolean;
  traceabilitySourceNoun: string;
  traceabilityIdNoun: string;
  traceabilitySliceNoun: string;
  upstreamArtifactLabel: string;
  upstreamArtifactPath: string;
}

function artifactFileName(path: string): string {
  return path.split("/").pop() ?? path;
}

export function trackRenderContext(track: FlowTrack): TrackRenderContext {
  if (track === "quick") {
    return {
      track,
      usesPlanTerminology: false,
      traceabilitySourceNoun: "acceptance criterion",
      traceabilityIdNoun: "acceptance criterion ID",
      traceabilitySliceNoun: "acceptance slice",
      upstreamArtifactLabel: "spec artifact",
      upstreamArtifactPath: ".cclaw/artifacts/04-spec.md"
    };
  }
  return {
    track,
    usesPlanTerminology: true,
    traceabilitySourceNoun: "plan task",
    traceabilityIdNoun: "plan task ID",
    traceabilitySliceNoun: "plan slice",
    upstreamArtifactLabel: "plan artifact",
    upstreamArtifactPath: ".cclaw/artifacts/05-plan.md"
  };
}

/**
 * Render track-aware terminology for text that defaults to standard-track plan
 * wording. Keep this centralized so quick-track rewrites do not drift across
 * stage content generators.
 */
export function renderTrackTerminology(value: string, context: TrackRenderContext): string {
  if (context.usesPlanTerminology) {
    return value;
  }
  return value
    .replace(/\btask from the plan\b/giu, `${context.traceabilitySourceNoun} from the spec`)
    .replace(/\bplan task ID\b/giu, context.traceabilityIdNoun)
    .replace(/\bplan task\b/giu, context.traceabilitySourceNoun)
    .replace(/\bplan row\b/giu, "acceptance row")
    .replace(/\btraceable to plan slice\b/giu, `traceable to ${context.traceabilitySliceNoun}`)
    .replace(/\bplan slice\b/giu, context.traceabilitySliceNoun)
    .replace(/\bplan artifact\b/giu, context.upstreamArtifactLabel)
    .replace(/05-plan\.md/gu, artifactFileName(context.upstreamArtifactPath));
}
