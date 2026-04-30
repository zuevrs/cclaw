import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import type { FlowState } from "./flow-state.js";
import { exists } from "./fs-utils.js";

function activeArtifactsPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "artifacts");
}

function retroArtifactPath(projectRoot: string): string {
  return path.join(activeArtifactsPath(projectRoot), "09-retro.md");
}

export interface RetroGateStatus {
  required: boolean;
  completed: boolean;
  compoundEntries: number;
  hasRetroArtifact: boolean;
  skipped: boolean;
}

function parseIsoTimestamp(value: string | undefined): number | null {
  if (!value || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function evaluateRetroGate(
  projectRoot: string,
  state: FlowState
): Promise<RetroGateStatus> {
  const required = state.completedStages.includes("ship");
  const artifactFile = retroArtifactPath(projectRoot);
  let hasRetroArtifact = false;
  if (await exists(artifactFile)) {
    try {
      const raw = await fs.readFile(artifactFile, "utf8");
      hasRetroArtifact = raw.trim().length > 0;
    } catch {
      hasRetroArtifact = false;
    }
  }
  const retroSkipReason = state.closeout.retroSkipReason?.trim() ?? "";
  const retroSkipped = state.closeout.retroSkipped === true && retroSkipReason.length > 0;
  const retroAccepted =
    hasRetroArtifact && parseIsoTimestamp(state.closeout.retroAcceptedAt) !== null;
  const compoundSkipped = state.closeout.compoundSkipped === true;
  const compoundReviewed =
    parseIsoTimestamp(state.closeout.compoundCompletedAt) !== null ||
    state.closeout.compoundPromoted > 0;
  const compoundEntries = compoundReviewed ? Math.max(0, Math.floor(state.closeout.compoundPromoted)) : 0;
  // Keep retro-gate deterministic from closeout state only:
  // retroComplete = (retroAccepted || retroSkipped) && (compoundReviewed || compoundSkipped)
  const completed = required ? (retroAccepted || retroSkipped) && (compoundReviewed || compoundSkipped) : true;
  return {
    required,
    completed,
    compoundEntries,
    hasRetroArtifact,
    skipped: retroSkipped
  };
}
