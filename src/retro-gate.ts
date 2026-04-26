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

// Fallback window for compound-entry scanning when `retroDraftedAt` /
// `retroAcceptedAt` are not set (legacy runs or imports): use the retro
// artifact's mtime ± 7 days. 24h was too narrow for long-running retros
// that are edited over several days or runs imported from another
// machine with slightly different clocks; 7 days is still tight enough
// that entries from an unrelated future run are excluded.
const RETRO_ARTIFACT_MTIME_FALLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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
  let windowStartMs = parseIsoTimestamp(state.closeout.retroDraftedAt);
  let windowEndMs =
    parseIsoTimestamp(state.closeout.retroAcceptedAt) ?? parseIsoTimestamp(state.retro.completedAt);
  if (
    compoundEntries <= 0 &&
    hasRetroArtifact &&
    windowStartMs === null &&
    windowEndMs === null
  ) {
    try {
      const stats = await fs.stat(artifactFile);
      const anchor = stats.mtimeMs;
      if (Number.isFinite(anchor) && anchor > 0) {
        windowStartMs = anchor - RETRO_ARTIFACT_MTIME_FALLBACK_WINDOW_MS;
        windowEndMs = anchor + RETRO_ARTIFACT_MTIME_FALLBACK_WINDOW_MS;
      }
    } catch {
      // fallback scan remains disabled when mtime cannot be read
    }
  }
  const shouldFallbackScan =
    compoundEntries <= 0 && (windowStartMs !== null || windowEndMs !== null);
  if (shouldFallbackScan) {
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
      const knowledgeFile = path.join(projectRoot, RUNTIME_ROOT, "knowledge.jsonl");
      const { entries } = await readKnowledgeSafely(projectRoot);
      compoundEntries = 0;
      for (const parsed of entries) {
        compoundEntries += countIfEligible(parsed);
      }

      // Backward compatibility for historical/hand-edited rows that don't pass
      // strict knowledge schema validation but still carry retro evidence.
      if (compoundEntries === 0 && (await exists(knowledgeFile))) {
        const raw = stripBom(await fs.readFile(knowledgeFile, "utf8"));
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
            compoundEntries += countIfEligible(parsed);
          } catch {
            // ignore malformed lines for retro gate calculation
          }
        }
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
  //     (`retroSkipped === true` with a reason). `retroSkipped` is an
  //     operator-level override of the artifact requirement, so it must
  //     bypass `hasRetroArtifact` — otherwise a run that legitimately had
  //     nothing worth retro-ing dead-locks at closeout waiting for a
  //     file that will never exist.
  const retroSkipped = state.closeout.retroSkipped === true;
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
