import fs from "node:fs/promises";
import path from "node:path";
import { COMMAND_FILE_ORDER, RUNTIME_ROOT } from "./constants.js";
import { createInitialFlowState, type FlowState } from "./flow-state.js";
import { ensureDir, exists, withDirectoryLock, writeFileSafe } from "./fs-utils.js";
import type { FlowStage } from "./types.js";

const FLOW_STATE_REL_PATH = `${RUNTIME_ROOT}/state/flow-state.json`;
const RUNS_DIR_REL_PATH = `${RUNTIME_ROOT}/runs`;
const ACTIVE_ARTIFACTS_REL_PATH = `${RUNTIME_ROOT}/artifacts`;
const FLOW_STAGE_SET = new Set<string>(COMMAND_FILE_ORDER);

export interface CclawRunMeta {
  id: string;
  title: string;
  createdAt: string;
}

export interface ArchiveRunResult {
  archiveId: string;
  archivePath: string;
  archivedAt: string;
  featureName: string;
  resetState: FlowState;
}

interface EnsureRunSystemOptions {
  createIfMissing?: boolean;
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

function coerceFlowState(parsed: Record<string, unknown>): FlowState {
  const next = createInitialFlowState();
  const activeRunIdRaw = parsed.activeRunId;
  const activeRunId = typeof activeRunIdRaw === "string" && activeRunIdRaw.trim().length > 0
    ? activeRunIdRaw.trim()
    : next.activeRunId;

  return {
    activeRunId,
    currentStage: isFlowStage(parsed.currentStage) ? parsed.currentStage : next.currentStage,
    completedStages: sanitizeCompletedStages(parsed.completedStages),
    guardEvidence: sanitizeGuardEvidence(parsed.guardEvidence),
    stageGateCatalog: sanitizeStageGateCatalog(parsed.stageGateCatalog, next.stageGateCatalog)
  };
}

function toArchiveDate(date = new Date()): string {
  const yyyy = date.getFullYear().toString();
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function slugifyFeatureName(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (slug.length === 0) {
    return "feature";
  }
  return slug.slice(0, 64);
}

async function inferFeatureNameFromArtifacts(projectRoot: string): Promise<string> {
  const ideaPath = path.join(projectRoot, ACTIVE_ARTIFACTS_REL_PATH, "00-idea.md");
  if (!(await exists(ideaPath))) {
    return "feature";
  }
  try {
    const raw = await fs.readFile(ideaPath, "utf8");
    const firstMeaningful = raw
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .find((line) => line.length > 0);
    if (!firstMeaningful) {
      return "feature";
    }
    return firstMeaningful.replace(/^[-#*\s]+/u, "").trim() || "feature";
  } catch {
    return "feature";
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

export async function readFlowState(projectRoot: string): Promise<FlowState> {
  const statePath = flowStatePath(projectRoot);
  if (!(await exists(statePath))) {
    return createInitialFlowState();
  }
  try {
    const parsed = JSON.parse(await fs.readFile(statePath, "utf8")) as Record<string, unknown>;
    return coerceFlowState(parsed);
  } catch {
    return createInitialFlowState();
  }
}

export async function writeFlowState(projectRoot: string, state: FlowState): Promise<void> {
  await withDirectoryLock(flowStateLockPath(projectRoot), async () => {
    const safe = coerceFlowState({ ...(state as unknown as Record<string, unknown>) });
    await writeFileSafe(flowStatePath(projectRoot), `${JSON.stringify(safe, null, 2)}\n`);
  });
}

export async function ensureRunSystem(
  projectRoot: string,
  _options: EnsureRunSystemOptions = {}
): Promise<FlowState> {
  await ensureDir(runsRoot(projectRoot));
  await ensureDir(activeArtifactsPath(projectRoot));
  const statePath = flowStatePath(projectRoot);
  const state = await readFlowState(projectRoot);
  if (!(await exists(statePath))) {
    await writeFlowState(projectRoot, state);
  }
  return state;
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

export async function archiveRun(projectRoot: string, featureName?: string): Promise<ArchiveRunResult> {
  await ensureRunSystem(projectRoot);
  const artifactsDir = activeArtifactsPath(projectRoot);
  const runsDir = runsRoot(projectRoot);
  await ensureDir(runsDir);
  await ensureDir(artifactsDir);

  const feature = (featureName?.trim() && featureName.trim().length > 0)
    ? featureName.trim()
    : await inferFeatureNameFromArtifacts(projectRoot);
  const archiveBaseId = `${toArchiveDate()}-${slugifyFeatureName(feature)}`;
  const archiveId = await uniqueArchiveId(projectRoot, archiveBaseId);
  const archivePath = path.join(runsDir, archiveId);
  const archiveArtifactsPath = path.join(archivePath, "artifacts");

  await ensureDir(archivePath);
  await fs.rename(artifactsDir, archiveArtifactsPath);
  await ensureDir(artifactsDir);

  const resetState = createInitialFlowState();
  await writeFlowState(projectRoot, resetState);
  const archivedAt = new Date().toISOString();

  return {
    archiveId,
    archivePath,
    archivedAt,
    featureName: feature,
    resetState
  };
}
