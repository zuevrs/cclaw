import fs from "node:fs/promises";
import path from "node:path";
import { COMMAND_FILE_ORDER, RUNTIME_ROOT } from "./constants.js";
import { createInitialFlowState, type FlowState } from "./flow-state.js";
import { ensureDir, exists, withDirectoryLock, writeFileSafe } from "./fs-utils.js";
import type { FlowStage } from "./types.js";

const FLOW_STATE_REL_PATH = `${RUNTIME_ROOT}/state/flow-state.json`;
const RUNS_DIR_REL_PATH = `${RUNTIME_ROOT}/runs`;
const ACTIVE_ARTIFACTS_REL_PATH = `${RUNTIME_ROOT}/artifacts`;
const RUN_META_FILE = "run.json";
const RUN_HANDOFF_FILE = "00-handoff.md";
const FLOW_STAGE_SET = new Set<string>(COMMAND_FILE_ORDER);

export interface CclawRunMeta {
  id: string;
  title: string;
  createdAt: string;
  archivedAt?: string;
  stateSnapshot?: Omit<FlowState, "activeRunId">;
}

interface CreateRunOptions {
  title?: string;
  seedFromActiveArtifacts?: boolean;
}

function flowStatePath(projectRoot: string): string {
  return path.join(projectRoot, FLOW_STATE_REL_PATH);
}

function flowStateLockPath(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state", ".flow-state.lock");
}

function runsRoot(projectRoot: string): string {
  return path.join(projectRoot, RUNS_DIR_REL_PATH);
}

function activeArtifactsPath(projectRoot: string): string {
  return path.join(projectRoot, ACTIVE_ARTIFACTS_REL_PATH);
}

function runRoot(projectRoot: string, runId: string): string {
  return path.join(runsRoot(projectRoot), requireSafeRunId(runId));
}

function runArtifactsPath(projectRoot: string, runId: string): string {
  return path.join(runRoot(projectRoot, runId), "artifacts");
}

function runMetaPath(projectRoot: string, runId: string): string {
  return path.join(runRoot(projectRoot, runId), RUN_META_FILE);
}

function runHandoffPath(projectRoot: string, runId: string): string {
  return path.join(runRoot(projectRoot, runId), RUN_HANDOFF_FILE);
}

function nowIso(): string {
  return new Date().toISOString();
}

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function buildRunId(date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = pad2(date.getUTCMonth() + 1);
  const dd = pad2(date.getUTCDate());
  const hh = pad2(date.getUTCHours());
  const min = pad2(date.getUTCMinutes());
  const ss = pad2(date.getUTCSeconds());
  const random = Math.random().toString(36).slice(2, 6);
  return `run-${yyyy}${mm}${dd}-${hh}${min}${ss}-${random}`;
}

function normalizeTitle(title: string | undefined): string {
  const trimmed = (title ?? "").trim();
  if (trimmed.length === 0) {
    return "New feature run";
  }
  return trimmed;
}

function isSafeRunId(value: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/u.test(value);
}

function sanitizeRunId(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return isSafeRunId(trimmed) ? trimmed : undefined;
}

function requireSafeRunId(runId: string): string {
  const safe = sanitizeRunId(runId);
  if (!safe) {
    throw new Error(`Invalid run id "${runId}"`);
  }
  return safe;
}

function snapshotState(state: FlowState): Omit<FlowState, "activeRunId"> {
  return {
    currentStage: state.currentStage,
    completedStages: [...state.completedStages],
    guardEvidence: { ...state.guardEvidence },
    stageGateCatalog: JSON.parse(JSON.stringify(state.stageGateCatalog)) as FlowState["stageGateCatalog"]
  };
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
  const next = {} as FlowState["stageGateCatalog"];
  for (const stage of COMMAND_FILE_ORDER) {
    const base = fallback[stage];
    next[stage] = {
      required: [...base.required],
      passed: [...base.passed],
      blocked: [...base.blocked]
    };
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return next;
  }

  const rawCatalog = value as Record<string, unknown>;
  for (const stage of COMMAND_FILE_ORDER) {
    const rawStage = rawCatalog[stage];
    if (!rawStage || typeof rawStage !== "object" || Array.isArray(rawStage)) {
      continue;
    }

    const typed = rawStage as Record<string, unknown>;
    const allowedGateIds = new Set(next[stage].required);
    next[stage] = {
      required: [...next[stage].required],
      passed: sanitizeStringArray(typed.passed).filter((gate) => allowedGateIds.has(gate)),
      blocked: sanitizeStringArray(typed.blocked).filter((gate) => allowedGateIds.has(gate))
    };
  }

  return next;
}

function coerceFlowState(
  parsed: Record<string, unknown>,
  activeRunIdOverride?: string
): FlowState {
  const overrideTrim = sanitizeRunId(activeRunIdOverride);
  const parsedActiveRun = sanitizeRunId(parsed.activeRunId);
  const seedRunId = overrideTrim ?? parsedActiveRun;
  const next = createInitialFlowState(seedRunId);

  return {
    activeRunId: overrideTrim ?? parsedActiveRun ?? next.activeRunId,
    currentStage: isFlowStage(parsed.currentStage) ? parsed.currentStage : next.currentStage,
    completedStages: sanitizeCompletedStages(parsed.completedStages),
    guardEvidence: sanitizeGuardEvidence(parsed.guardEvidence),
    stageGateCatalog: sanitizeStageGateCatalog(parsed.stageGateCatalog, next.stageGateCatalog)
  };
}

function createdAtFromRunId(runId: string): string | null {
  const match = /^run-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-[a-z0-9]+$/iu.exec(runId);
  if (!match) {
    return null;
  }
  const [, year, month, day, hour, minute, second] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second)
    )
  );
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  if (!(await exists(filePath))) return null;
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

async function listImmediateFiles(dirPath: string): Promise<string[]> {
  if (!(await exists(dirPath))) return [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => entry.name).sort();
}

async function clearImmediateFiles(dirPath: string): Promise<void> {
  if (!(await exists(dirPath))) return;
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      await fs.rm(path.join(dirPath, entry.name), { force: true });
    }
  }
}

async function copyImmediateFiles(fromDir: string, toDir: string): Promise<void> {
  await ensureDir(toDir);
  const fileNames = await listImmediateFiles(fromDir);
  for (const fileName of fileNames) {
    const sourcePath = path.join(fromDir, fileName);
    const targetPath = path.join(toDir, fileName);
    await fs.copyFile(sourcePath, targetPath);
  }
}

function handoffMarkdown(runMeta: CclawRunMeta, state: FlowState): string {
  return `# Run Handoff

## Run
- ID: ${runMeta.id}
- Title: ${runMeta.title}
- Created: ${runMeta.createdAt}
- Archived: ${runMeta.archivedAt ?? "active"}

## Flow Snapshot
- Active stage: ${state.currentStage}
- Completed stages: ${state.completedStages.join(", ") || "(none)"}
- Active run ID in flow-state: ${state.activeRunId}

## Paths
- Active artifacts: \`${RUNTIME_ROOT}/artifacts/\`
- Canonical run artifacts: \`${RUNTIME_ROOT}/runs/${runMeta.id}/artifacts/\`

## Resume
1. Continue with the stage command for \`${state.currentStage}\`
2. If needed, sync artifacts from \`${RUNTIME_ROOT}/runs/${runMeta.id}/artifacts/\`
`;
}

export async function readFlowState(projectRoot: string): Promise<FlowState> {
  const statePath = flowStatePath(projectRoot);
  const parsed = await readJsonFile<Record<string, unknown>>(statePath);
  if (!parsed || typeof parsed !== "object") {
    return createInitialFlowState();
  }

  return coerceFlowState(parsed);
}

export async function writeFlowState(projectRoot: string, state: FlowState): Promise<void> {
  await withDirectoryLock(flowStateLockPath(projectRoot), async () => {
    const safe = coerceFlowState({ ...(state as unknown as Record<string, unknown>) }, state.activeRunId);
    await writeFileSafe(flowStatePath(projectRoot), `${JSON.stringify(safe, null, 2)}\n`);
  });
}

export async function listRuns(projectRoot: string): Promise<CclawRunMeta[]> {
  const root = runsRoot(projectRoot);
  if (!(await exists(root))) return [];

  const dirs = await fs.readdir(root, { withFileTypes: true });
  const metas: CclawRunMeta[] = [];
  for (const dir of dirs) {
    if (!dir.isDirectory()) continue;
    const runId = dir.name;
    if (!isSafeRunId(runId)) continue;
    const meta = await readJsonFile<CclawRunMeta>(runMetaPath(projectRoot, runId));
    if (meta && typeof meta.id === "string" && meta.id === runId) {
      metas.push(meta);
      continue;
    }
    let fallbackCreatedAt = createdAtFromRunId(runId);
    if (!fallbackCreatedAt) {
      try {
        const stat = await fs.stat(path.join(root, runId));
        fallbackCreatedAt = stat.birthtime?.toISOString?.() ?? stat.mtime.toISOString();
      } catch {
        fallbackCreatedAt = null;
      }
    }

    metas.push({
      id: runId,
      title: runId,
      createdAt: fallbackCreatedAt ?? nowIso()
    });
  }

  return metas.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

async function ensureRunMetadata(projectRoot: string, meta: CclawRunMeta): Promise<void> {
  await writeFileSafe(runMetaPath(projectRoot, meta.id), `${JSON.stringify(meta, null, 2)}\n`);
}

async function persistRunStateSnapshot(projectRoot: string, runId: string, state: FlowState): Promise<void> {
  const meta = await readJsonFile<CclawRunMeta>(runMetaPath(projectRoot, runId));
  if (!meta) return;
  const safeState = coerceFlowState({ ...(state as unknown as Record<string, unknown>) }, state.activeRunId);
  await ensureRunMetadata(projectRoot, {
    ...meta,
    stateSnapshot: snapshotState(safeState)
  });
}


async function syncActiveArtifactsToRun(projectRoot: string, runId: string): Promise<void> {
  const fromDir = activeArtifactsPath(projectRoot);
  const toDir = runArtifactsPath(projectRoot, runId);
  await ensureDir(toDir);
  await clearImmediateFiles(toDir);
  await copyImmediateFiles(fromDir, toDir);
}

async function loadRunArtifactsToActive(projectRoot: string, runId: string): Promise<void> {
  const fromDir = runArtifactsPath(projectRoot, runId);
  const toDir = activeArtifactsPath(projectRoot);
  await ensureDir(toDir);
  await clearImmediateFiles(toDir);
  await copyImmediateFiles(fromDir, toDir);
}

async function createRun(projectRoot: string, options?: CreateRunOptions): Promise<CclawRunMeta> {
  const runId = buildRunId();
  const meta: CclawRunMeta = {
    id: runId,
    title: normalizeTitle(options?.title),
    createdAt: nowIso()
  };

  await ensureDir(runRoot(projectRoot, runId));
  await ensureRunMetadata(projectRoot, meta);
  const runArtifactsDir = runArtifactsPath(projectRoot, runId);
  await ensureDir(runArtifactsDir);
  if (options?.seedFromActiveArtifacts && (await exists(activeArtifactsPath(projectRoot)))) {
    await copyImmediateFiles(activeArtifactsPath(projectRoot), runArtifactsDir);
  }

  return meta;
}

async function ensureRunHandoff(projectRoot: string, runId: string): Promise<void> {
  const state = await readFlowState(projectRoot);
  const meta = await readJsonFile<CclawRunMeta>(runMetaPath(projectRoot, runId));
  if (!meta) return;
  await writeFileSafe(runHandoffPath(projectRoot, runId), handoffMarkdown(meta, state));
}

export async function ensureRunSystem(projectRoot: string): Promise<FlowState> {
  await ensureDir(runsRoot(projectRoot));
  await ensureDir(activeArtifactsPath(projectRoot));

  let state = await readFlowState(projectRoot);
  let activeRunId = state.activeRunId;

  const activeRunExists =
    activeRunId.trim().length > 0 && (await exists(runArtifactsPath(projectRoot, activeRunId)));
  if (!activeRunExists) {
    const activeHasArtifacts = (await listImmediateFiles(activeArtifactsPath(projectRoot))).length > 0;
    const initialRun = await createRun(projectRoot, {
      title: activeHasArtifacts ? "Migrated active run" : "Initial feature run",
      seedFromActiveArtifacts: activeHasArtifacts
    });
    activeRunId = initialRun.id;
    state = { ...state, activeRunId };
    await writeFlowState(projectRoot, state);
  }

  const runArtifactsDir = runArtifactsPath(projectRoot, activeRunId);
  await ensureDir(runArtifactsDir);

  if ((await listImmediateFiles(activeArtifactsPath(projectRoot))).length === 0) {
    await loadRunArtifactsToActive(projectRoot, activeRunId);
  } else {
    await syncActiveArtifactsToRun(projectRoot, activeRunId);
  }

  await persistRunStateSnapshot(projectRoot, activeRunId, state);
  await ensureRunHandoff(projectRoot, activeRunId);
  return state;
}

export async function startNewFeatureRun(projectRoot: string, title?: string): Promise<CclawRunMeta> {
  await ensureRunSystem(projectRoot);
  const state = await readFlowState(projectRoot);
  await syncActiveArtifactsToRun(projectRoot, state.activeRunId);
  await persistRunStateSnapshot(projectRoot, state.activeRunId, state);
  await ensureRunHandoff(projectRoot, state.activeRunId);

  const nextRun = await createRun(projectRoot, {
    title,
    seedFromActiveArtifacts: false
  });
  const nextState: FlowState = {
    ...createInitialFlowState(nextRun.id),
    activeRunId: nextRun.id
  };
  await writeFlowState(projectRoot, nextState);
  await persistRunStateSnapshot(projectRoot, nextRun.id, nextState);
  await loadRunArtifactsToActive(projectRoot, nextRun.id);
  await ensureRunHandoff(projectRoot, nextRun.id);
  return nextRun;
}

export async function resumeRun(projectRoot: string, runId: string): Promise<CclawRunMeta> {
  await ensureRunSystem(projectRoot);
  const safeRunId = requireSafeRunId(runId);
  const targetMeta = await readJsonFile<CclawRunMeta>(runMetaPath(projectRoot, safeRunId));
  if (!targetMeta) {
    throw new Error(`Run "${safeRunId}" not found under ${RUNTIME_ROOT}/runs/`);
  }

  const state = await readFlowState(projectRoot);
  await syncActiveArtifactsToRun(projectRoot, state.activeRunId);
  await persistRunStateSnapshot(projectRoot, state.activeRunId, state);
  await ensureRunHandoff(projectRoot, state.activeRunId);

  const nextState: FlowState = targetMeta.stateSnapshot
    ? coerceFlowState(
        {
          ...createInitialFlowState(safeRunId),
          ...(targetMeta.stateSnapshot as unknown as Record<string, unknown>),
          activeRunId: safeRunId
        },
        safeRunId
      )
    : coerceFlowState(
        {
          ...createInitialFlowState(safeRunId),
          activeRunId: safeRunId
        },
        safeRunId
      );

  await writeFlowState(projectRoot, nextState);
  await persistRunStateSnapshot(projectRoot, safeRunId, nextState);
  await loadRunArtifactsToActive(projectRoot, safeRunId);
  await ensureRunHandoff(projectRoot, safeRunId);
  return targetMeta;
}

export async function archiveRun(
  projectRoot: string,
  runId?: string
): Promise<{ archived: CclawRunMeta; active: CclawRunMeta }> {
  await ensureRunSystem(projectRoot);
  const state = await readFlowState(projectRoot);
  const targetRunId = runId ? requireSafeRunId(runId) : state.activeRunId;
  const targetMeta = await readJsonFile<CclawRunMeta>(runMetaPath(projectRoot, targetRunId));
  if (!targetMeta) {
    throw new Error(`Run "${targetRunId}" not found under ${RUNTIME_ROOT}/runs/`);
  }

  if (targetRunId === state.activeRunId) {
    await syncActiveArtifactsToRun(projectRoot, targetRunId);
    await persistRunStateSnapshot(projectRoot, targetRunId, state);
  }

  const archivedMeta: CclawRunMeta = {
    ...targetMeta,
    archivedAt: nowIso()
  };
  await ensureRunMetadata(projectRoot, archivedMeta);
  await ensureRunHandoff(projectRoot, targetRunId);

  if (targetRunId !== state.activeRunId) {
    const activeMeta = await readJsonFile<CclawRunMeta>(runMetaPath(projectRoot, state.activeRunId));
    if (!activeMeta) {
      throw new Error(`Active run "${state.activeRunId}" is missing metadata`);
    }
    return { archived: archivedMeta, active: activeMeta };
  }

  const nextRun = await createRun(projectRoot, {
    title: "Post-archive run",
    seedFromActiveArtifacts: false
  });
  const nextState: FlowState = {
    ...createInitialFlowState(nextRun.id),
    activeRunId: nextRun.id
  };
  await writeFlowState(projectRoot, nextState);
  await persistRunStateSnapshot(projectRoot, nextRun.id, nextState);
  await loadRunArtifactsToActive(projectRoot, nextRun.id);
  await ensureRunHandoff(projectRoot, nextRun.id);
  return { archived: archivedMeta, active: nextRun };
}
