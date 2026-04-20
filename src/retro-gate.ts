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
  let compoundEntries = state.retro.compoundEntries;
  const windowStartMs = parseIsoTimestamp(state.closeout.retroDraftedAt);
  const windowEndMs =
    parseIsoTimestamp(state.closeout.retroAcceptedAt) ?? parseIsoTimestamp(state.retro.completedAt);
  const shouldFallbackScan =
    compoundEntries <= 0 && (windowStartMs !== null || windowEndMs !== null);
  const knowledgeFile = path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl");
  if (shouldFallbackScan && (await exists(knowledgeFile))) {
    try {
      const raw = await fs.readFile(knowledgeFile, "utf8");
      compoundEntries = 0;
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as {
            type?: unknown;
            source?: unknown;
            stage?: unknown;
            created?: unknown;
          };
          if (parsed.type !== "compound") {
            continue;
          }
          const created =
            typeof parsed.created === "string" ? parseIsoTimestamp(parsed.created) : null;
          if (created === null || !inInclusiveWindow(created, windowStartMs, windowEndMs)) {
            continue;
          }
          const source = typeof parsed.source === "string"
            ? parsed.source.trim().toLowerCase()
            : null;
          const legacyRetroStage = parsed.stage === "retro";
          if (source === "retro" || legacyRetroStage) {
            compoundEntries += 1;
          }
        } catch {
          // ignore malformed lines for retro gate calculation
        }
      }
    } catch {
      compoundEntries = 0;
    }
  }

  // A retro is considered complete when either:
  //   - at least one compound learning was promoted during the retro window, or
  //   - the operator explicitly skipped retro or compound (`retroSkipped` /
  //     `compoundSkipped` recorded in the closeout substate) after reviewing
  //     the draft. Previously the gate required `compoundEntries > 0`
  //     unconditionally, which dead-locked ship closeout whenever the retro
  //     yielded no new patterns worth promoting.
  const explicitSkip = Boolean(
    state.closeout.retroSkipped || state.closeout.compoundSkipped
  );
  const completed = required
    ? hasRetroArtifact && (compoundEntries > 0 || explicitSkip)
    : true;
  return {
    required,
    completed,
    compoundEntries,
    hasRetroArtifact
  };
}
