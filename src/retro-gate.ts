import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import type { FlowState } from "./flow-state.js";
import { exists, stripBom } from "./fs-utils.js";
import { readKnowledgeSafely } from "./knowledge-store.js";

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

function inInclusiveWindow(
  timestamp: number,
  windowStartMs: number | null,
  windowEndMs: number | null
): boolean {
  if (windowStartMs !== null && timestamp < windowStartMs) return false;
  if (windowEndMs !== null && timestamp > windowEndMs) return false;
  return true;
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
  let compoundEntries = 0;
  let windowStartMs = parseIsoTimestamp(state.closeout.retroDraftedAt);
  let windowEndMs =
    parseIsoTimestamp(state.closeout.retroAcceptedAt) ?? parseIsoTimestamp(state.retro.completedAt);
  const shouldScanCompoundEvidence = windowStartMs !== null || windowEndMs !== null;
  if (shouldScanCompoundEvidence) {
    const countIfEligible = (parsed: {
      type?: unknown;
      source?: unknown;
      stage?: unknown;
      created?: unknown;
    }): number => {
      if (parsed.type !== "compound") {
        return 0;
      }
      const created =
        typeof parsed.created === "string" ? parseIsoTimestamp(parsed.created) : null;
      if (created === null || !inInclusiveWindow(created, windowStartMs, windowEndMs)) {
        return 0;
      }
      const source = typeof parsed.source === "string"
        ? parsed.source.trim().toLowerCase()
        : null;
      const legacyRetroStage = parsed.stage === "retro";
      return source === "retro" || legacyRetroStage ? 1 : 0;
    };
    try {
      const { entries } = await readKnowledgeSafely(projectRoot);
      for (const parsed of entries) {
        compoundEntries += countIfEligible(parsed);
      }
    } catch {
      compoundEntries = 0;
    }
  }

  // A retro is considered complete when any of:
  //   - the retro artifact exists AND (at least one compound learning was
  //     promoted during the retro window OR compound was explicitly skipped
  //     after reviewing the draft), or
  //   - the operator explicitly skipped the retro step itself
  //     (`retroSkipped === true` with a non-empty reason). `retroSkipped` is an
  //     operator-level override of the artifact requirement, so it must
  //     bypass `hasRetroArtifact` — otherwise a run that legitimately had
  //     nothing worth retro-ing dead-locks at closeout waiting for a
  //     file that will never exist.
  const retroSkipReason = state.closeout.retroSkipReason?.trim() ?? "";
  const retroSkipped = state.closeout.retroSkipped === true && retroSkipReason.length > 0;
  const compoundSkipped = state.closeout.compoundSkipped === true;
  const artifactPathComplete = hasRetroArtifact && (compoundEntries > 0 || compoundSkipped);
  const completed = required ? retroSkipped || artifactPathComplete : true;
  return {
    required,
    completed,
    compoundEntries,
    hasRetroArtifact,
    skipped: retroSkipped
  };
}
