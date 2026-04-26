import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { createInitialFlowState, type FlowState } from "./flow-state.js";
import { ensureDir, exists, withDirectoryLock, writeFileSafe } from "./fs-utils.js";
import { readKnowledgeSafely } from "./knowledge-store.js";
import { evaluateRetroGate } from "./retro-gate.js";
import {
  ensureRunSystem,
  flowStateLockPathFor,
  readFlowState,
  writeFlowState
} from "./run-persistence.js";
import type { FlowStage } from "./types.js";

const RUNS_DIR_REL_PATH = `${RUNTIME_ROOT}/runs`;
const ACTIVE_ARTIFACTS_REL_PATH = `${RUNTIME_ROOT}/artifacts`;
const STATE_DIR_REL_PATH = `${RUNTIME_ROOT}/state`;

/** State filenames explicitly excluded from the archive snapshot. */
const STATE_SNAPSHOT_EXCLUDE = new Set<string>([
  ".flow-state.lock",
  ".delegation.lock"
]);
const DELEGATION_LOG_FILE = "delegation-log.json";
const TDD_CYCLE_LOG_FILE = "tdd-cycle-log.jsonl";
const RECONCILIATION_NOTICES_FILE = "reconciliation-notices.json";
const CRITICAL_STATE_SNAPSHOT_FILES = new Set<string>([
  "flow-state.json",
  DELEGATION_LOG_FILE,
  TDD_CYCLE_LOG_FILE,
  RECONCILIATION_NOTICES_FILE
]);

export interface CclawRunMeta {
  id: string;
  title: string;
  createdAt: string;
}

export interface ArchiveRunResult {
  archiveId: string;
  archivePath: string;
  archivedAt: string;
  runName: string;
  resetState: FlowState;
  snapshottedStateFiles: string[];
  /** Knowledge curation hint: total active entries + soft threshold (50). */
  knowledge: {
    activeEntryCount: number;
    softThreshold: number;
    overThreshold: boolean;
    knowledgePath: string;
  };
  retro: {
    required: boolean;
    completed: boolean;
    skipped: boolean;
    skipReason?: string;
    compoundEntries: number;
  };
}

export interface ArchiveManifest {
  version: 2;
  archiveId: string;
  archivedAt: string;
  runName: string;
  sourceRunId: string;
  sourceCurrentStage: FlowStage;
  sourceCompletedStages: FlowStage[];
  snapshottedStateFiles: string[];
  retro: ArchiveRunResult["retro"];
}

export interface ArchiveRunOptions {
  skipRetro?: boolean;
  skipRetroReason?: string;
}

function runsRoot(projectRoot: string): string {
  return path.join(projectRoot, RUNS_DIR_REL_PATH);
}

function activeArtifactsPath(projectRoot: string): string {
  return path.join(projectRoot, ACTIVE_ARTIFACTS_REL_PATH);
}

function stateDirPath(projectRoot: string): string {
  return path.join(projectRoot, STATE_DIR_REL_PATH);
}

function archiveLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".archive.lock");
}

async function snapshotStateDirectory(
  projectRoot: string,
  destinationRoot: string
): Promise<string[]> {
  const sourceDir = stateDirPath(projectRoot);
  if (!(await exists(sourceDir))) {
    return [];
  }
  await ensureDir(destinationRoot);
  const copied: string[] = [];
  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return [];
  }
  for (const entry of entries) {
    if (STATE_SNAPSHOT_EXCLUDE.has(entry.name)) continue;
    if (entry.name.startsWith(".") && !entry.name.endsWith(".json")) continue;
    const from = path.join(sourceDir, entry.name);
    const to = path.join(destinationRoot, entry.name);
    try {
      if (entry.isDirectory()) {
        await fs.cp(from, to, { recursive: true });
        copied.push(`${entry.name}/`);
      } else if (entry.isFile()) {
        await fs.copyFile(from, to);
        copied.push(entry.name);
      }
    } catch (error) {
      if (CRITICAL_STATE_SNAPSHOT_FILES.has(entry.name)) {
        const details = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Archive snapshot failed for critical state file "${entry.name}" (${details}).`
        );
      }
      // Non-critical snapshot files are best-effort and may be skipped.
    }
  }
  return copied.sort((a, b) => a.localeCompare(b));
}

async function resetCarryoverStateFiles(projectRoot: string, activeRunId: string): Promise<void> {
  const stateDir = stateDirPath(projectRoot);
  await ensureDir(stateDir);
  await writeFileSafe(
    path.join(stateDir, DELEGATION_LOG_FILE),
    `${JSON.stringify({ runId: activeRunId, entries: [] }, null, 2)}\n`,
    { mode: 0o600 }
  );
  await writeFileSafe(path.join(stateDir, TDD_CYCLE_LOG_FILE), "", { mode: 0o600 });
  await writeFileSafe(
    path.join(stateDir, RECONCILIATION_NOTICES_FILE),
    `${JSON.stringify({ schemaVersion: 1, notices: [] }, null, 2)}\n`,
    { mode: 0o600 }
  );
}

async function restoreStateSnapshot(projectRoot: string, archiveStatePath: string): Promise<void> {
  if (!(await exists(archiveStatePath))) return;
  const stateDir = stateDirPath(projectRoot);
  await ensureDir(stateDir);
  const entries = await fs.readdir(archiveStatePath, { withFileTypes: true });
  for (const entry of entries) {
    const from = path.join(archiveStatePath, entry.name);
    const to = path.join(stateDir, entry.name);
    if (entry.isDirectory()) {
      await fs.rm(to, { recursive: true, force: true });
      await fs.cp(from, to, { recursive: true });
    } else if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

function toArchiveDate(date = new Date()): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function slugifyRunName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (slug.length === 0) {
    return "run";
  }
  return slug.slice(0, 64);
}

async function inferRunNameFromArtifacts(projectRoot: string): Promise<string> {
  const ideaPath = path.join(projectRoot, ACTIVE_ARTIFACTS_REL_PATH, "00-idea.md");
  if (!(await exists(ideaPath))) {
    return "run";
  }
  try {
    const raw = await fs.readFile(ideaPath, "utf8");
    const firstMeaningful = raw
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstMeaningful) {
      return "run";
    }
    return firstMeaningful.replace(/^[-#*\s]+/u, "").trim() || "run";
  } catch {
    return "run";
  }
}

async function uniqueArchiveId(projectRoot: string, baseId: string): Promise<string> {
  let index = 1;
  let candidate = baseId;
  while (await exists(path.join(runsRoot(projectRoot), candidate))) {
    index += 1;
    candidate = `${baseId}-${index}`;
  }
  return candidate;
}

export async function listRuns(projectRoot: string): Promise<CclawRunMeta[]> {
  const root = runsRoot(projectRoot);
  if (!(await exists(root))) {
    return [];
  }
  const entries = await fs.readdir(root, { withFileTypes: true });
  const runs: CclawRunMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const runPath = path.join(root, entry.name);
    let createdAt = new Date().toISOString();
    try {
      const stat = await fs.stat(runPath);
      createdAt = stat.birthtime?.toISOString?.() ?? stat.mtime.toISOString();
    } catch {
      // keep fallback timestamp
    }
    runs.push({
      id: entry.name,
      title: entry.name,
      createdAt
    });
  }
  return runs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function archiveRun(
  projectRoot: string,
  runName?: string,
  options: ArchiveRunOptions = {}
): Promise<ArchiveRunResult> {
  await ensureRunSystem(projectRoot);
  // Hold BOTH archive.lock and flow-state.lock for the entire archive:
  // the outer archive lock serializes two concurrent archives; the
  // inner flow-state lock prevents CLI / hook paths from mutating
  // flow-state between the archive snapshot and the subsequent reset,
  // which used to cause lost-update races.
  return withDirectoryLock(archiveLockPath(projectRoot), async () => {
  return withDirectoryLock(flowStateLockPathFor(projectRoot), async () => {
  const artifactsDir = activeArtifactsPath(projectRoot);
  const runsDir = runsRoot(projectRoot);
  await ensureDir(runsDir);
  await ensureDir(artifactsDir);

  const archiveRunName = (runName?.trim() && runName.trim().length > 0)
    ? runName.trim()
    : await inferRunNameFromArtifacts(projectRoot);
  const archiveBaseId = `${toArchiveDate()}-${slugifyRunName(archiveRunName)}`;
  const archiveId = await uniqueArchiveId(projectRoot, archiveBaseId);
  const archivePath = path.join(runsDir, archiveId);
  const archiveArtifactsPath = path.join(archivePath, "artifacts");

  let sourceState = await readFlowState(projectRoot);
  const retroGate = await evaluateRetroGate(projectRoot, sourceState);
  const shipCompleted = sourceState.completedStages.includes("ship");
  const skipRetro = options.skipRetro === true;
  const skipRetroReason = options.skipRetroReason?.trim();
  if (skipRetro && (!skipRetroReason || skipRetroReason.length === 0)) {
    throw new Error("archive --skip-retro requires --retro-reason=<text>.");
  }
  const retroSkippedInCloseout =
    sourceState.closeout.retroSkipped === true &&
    typeof sourceState.closeout.retroSkipReason === "string" &&
    sourceState.closeout.retroSkipReason.trim().length > 0;
  const readyForArchive = sourceState.closeout.shipSubstate === "ready_to_archive";
  const inShipCloseout = sourceState.currentStage === "ship";
  if (inShipCloseout && skipRetro) {
    throw new Error(
      "Archive blocked: --skip-retro is not allowed while current stage is ship. " +
      "Complete closeout to ready_to_archive via /cc-next."
    );
  }
  if (inShipCloseout && !readyForArchive) {
    throw new Error(
      "Archive blocked: closeout is not ready_to_archive. " +
      "Resume /cc-next until closeout reaches ready_to_archive."
    );
  }
  if (shipCompleted && !readyForArchive && !skipRetro) {
    throw new Error(
      "Archive blocked: closeout is not ready_to_archive. " +
      "Resume /cc-next until closeout reaches ready_to_archive, " +
      "or run `cclaw archive --skip-retro --retro-reason=<text>` for CLI-only flows."
    );
  }
  if (retroGate.required && !retroGate.completed && !skipRetro && !retroSkippedInCloseout) {
    throw new Error(
      "Archive blocked: retro gate is required after ship completion. " +
      "Run /cc-next (auto-runs retro) or, for CLI-only flows, re-run `cclaw archive --skip-retro --retro-reason=<text>`."
    );
  }
  if (retroGate.completed) {
    const completedAt = sourceState.retro.completedAt ?? new Date().toISOString();
    sourceState = {
      ...sourceState,
      retro: {
        required: retroGate.required,
        completedAt,
        compoundEntries: retroGate.compoundEntries
      }
    };
    await writeFlowState(projectRoot, sourceState, { allowReset: true, skipLock: true });
  }
  const retroSummary: ArchiveRunResult["retro"] = {
    required: retroGate.required,
    completed: retroGate.completed,
    skipped: skipRetro || retroSkippedInCloseout,
    skipReason: skipRetro
      ? skipRetroReason
      : retroSkippedInCloseout
        ? sourceState.closeout.retroSkipReason
        : undefined,
    compoundEntries: retroGate.compoundEntries
  };

  await ensureDir(archivePath);

  // Drop an `.archive-in-progress` sentinel immediately so that a crash
  // between the artifact rename and the final manifest write leaves a
  // recoverable marker (doctor surfaces these; re-running archive on an
  // orphan attempts to complete or roll back). The sentinel is removed
  // only after the manifest lands successfully.
  const sentinelPath = path.join(archivePath, ".archive-in-progress");
  const archivedAt = new Date().toISOString();
  await writeFileSafe(
    sentinelPath,
    `${JSON.stringify({ archiveId, startedAt: archivedAt, sourceRunId: sourceState.activeRunId }, null, 2)}\n`
  );

  const stateBeforeReset = sourceState;
  let artifactsMoved = false;
  let stateReset = false;
  try {
    await fs.rename(artifactsDir, archiveArtifactsPath);
    artifactsMoved = true;
    await ensureDir(artifactsDir);

    const archiveStatePath = path.join(archivePath, "state");
    const snapshottedStateFiles = await snapshotStateDirectory(projectRoot, archiveStatePath);

    const resetState = createInitialFlowState();
    await writeFlowState(projectRoot, resetState, { allowReset: true, skipLock: true });
    stateReset = true;
    await resetCarryoverStateFiles(projectRoot, resetState.activeRunId);

    const manifest: ArchiveManifest = {
      version: 2,
      archiveId,
      archivedAt,
      runName: archiveRunName,
      sourceRunId: sourceState.activeRunId,
      sourceCurrentStage: sourceState.currentStage,
      sourceCompletedStages: sourceState.completedStages,
      snapshottedStateFiles,
      retro: retroSummary
    };
    await writeFileSafe(
      path.join(archivePath, "archive-manifest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );
    // Manifest landed — sentinel is no longer needed.
    await fs.unlink(sentinelPath).catch(() => undefined);

    const knowledgeStats = await readKnowledgeStats(projectRoot);
    return {
      archiveId,
      archivePath,
      archivedAt,
      runName: archiveRunName,
      resetState,
      snapshottedStateFiles,
      knowledge: knowledgeStats,
      retro: retroSummary
    };
  } catch (err) {
    // Best-effort rollback: if artifacts were moved but the subsequent
    // steps failed, put artifacts back so the user is not left without
    // a working run. The sentinel is intentionally left behind for
    // inspection; doctor surfaces it.
    if (artifactsMoved) {
      try {
        await fs.rm(artifactsDir, { recursive: true, force: true });
        await fs.rename(archiveArtifactsPath, artifactsDir);
      } catch {
        // Rollback failed — sentinel + orphaned archive dir will be
        // surfaced by doctor and can be reconciled manually.
      }
    }
    if (stateReset) {
      try {
        await restoreStateSnapshot(projectRoot, path.join(archivePath, "state"));
        await writeFlowState(projectRoot, stateBeforeReset, { allowReset: true, skipLock: true });
      } catch {
        // If rollback of state fails, keep sentinel + archive remnants for
        // manual reconciliation.
      }
    }
    throw err;
  }
  });
  }, {
    retries: 400,
    retryDelayMs: 25,
    staleAfterMs: 120_000
  });
}

const KNOWLEDGE_SOFT_THRESHOLD = 50;

async function readKnowledgeStats(projectRoot: string): Promise<ArchiveRunResult["knowledge"]> {
  const { entries } = await readKnowledgeSafely(projectRoot);
  const activeEntryCount = entries.length;
  return {
    activeEntryCount,
    softThreshold: KNOWLEDGE_SOFT_THRESHOLD,
    overThreshold: activeEntryCount > KNOWLEDGE_SOFT_THRESHOLD,
    knowledgePath: `${RUNTIME_ROOT}/knowledge.jsonl`
  };
}

/**
 * Counts entries in the canonical JSONL knowledge store. An "active" entry is one
 * non-empty line that parses as JSON with the required `type` field belonging to the
 * allowed set. Malformed lines are ignored (not counted) but do not throw so that a
 * hand-edited file cannot break doctor/archive flows.
 */
export function countActiveKnowledgeEntries(text: string): number {
  const allowed = new Set(["rule", "pattern", "lesson", "compound"]);
  let count = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.length === 0) continue;
    try {
      const parsed = JSON.parse(line) as { type?: unknown };
      if (typeof parsed.type === "string" && allowed.has(parsed.type)) {
        count += 1;
      }
    } catch {
      // Skip malformed lines silently; curation surfaces them separately.
    }
  }
  return count;
}
