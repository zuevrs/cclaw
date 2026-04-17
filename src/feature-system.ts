import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";

const FEATURES_DIR_REL_PATH = `${RUNTIME_ROOT}/features`;
const ACTIVE_FEATURE_META_REL_PATH = `${RUNTIME_ROOT}/state/active-feature.json`;
const DEFAULT_FEATURE_ID = "default";
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;
const FEATURE_STATE_EXCLUDE_FROM_SNAPSHOT = new Set([
  "active-feature.json",
  ".flow-state.lock",
  ".delegation.lock"
]);

export interface ActiveFeatureMeta {
  activeFeature: string;
  updatedAt: string;
}

interface CopyDirOptions {
  exclude?: Set<string>;
  preserveTargetEntries?: Set<string>;
}

function featuresRoot(projectRoot: string): string {
  return path.join(projectRoot, FEATURES_DIR_REL_PATH);
}

function runtimeArtifactsRoot(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "artifacts");
}

function runtimeStateRoot(projectRoot: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "state");
}

export function activeFeatureMetaPath(projectRoot: string): string {
  return path.join(projectRoot, ACTIVE_FEATURE_META_REL_PATH);
}

export function featureRootPath(projectRoot: string, featureId: string): string {
  return path.join(featuresRoot(projectRoot), featureId);
}

export function featureArtifactsPath(projectRoot: string, featureId: string): string {
  return path.join(featureRootPath(projectRoot, featureId), "artifacts");
}

export function featureStatePath(projectRoot: string, featureId: string): string {
  return path.join(featureRootPath(projectRoot, featureId), "state");
}

function normalizedFeatureId(value: string): string {
  const candidate = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (!candidate) {
    return DEFAULT_FEATURE_ID;
  }
  const clipped = candidate.slice(0, 64);
  return FEATURE_ID_PATTERN.test(clipped) ? clipped : DEFAULT_FEATURE_ID;
}

async function clearDirectory(
  dirPath: string,
  preserveTargetEntries: Set<string> = new Set()
): Promise<void> {
  await ensureDir(dirPath);
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (preserveTargetEntries.has(entry.name)) {
      continue;
    }
    await fs.rm(path.join(dirPath, entry.name), { recursive: true, force: true });
  }
}

async function copyDirectoryContents(
  sourceDir: string,
  targetDir: string,
  options: CopyDirOptions = {}
): Promise<void> {
  const exclude = options.exclude ?? new Set<string>();
  const preserveTargetEntries = options.preserveTargetEntries ?? new Set<string>();
  await ensureDir(targetDir);
  await clearDirectory(targetDir, preserveTargetEntries);
  if (!(await exists(sourceDir))) {
    return;
  }

  let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  try {
    entries = await fs.readdir(sourceDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (exclude.has(entry.name)) {
      continue;
    }
    const from = path.join(sourceDir, entry.name);
    const to = path.join(targetDir, entry.name);
    if (entry.isDirectory()) {
      await fs.cp(from, to, { recursive: true, force: true });
      continue;
    }
    if (entry.isFile()) {
      await fs.copyFile(from, to);
    }
  }
}

async function dirHasEntries(dirPath: string, exclude: Set<string> = new Set()): Promise<boolean> {
  if (!(await exists(dirPath))) {
    return false;
  }
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.some((entry) => !exclude.has(entry.name));
  } catch {
    return false;
  }
}

async function readActiveFeatureMetaInternal(projectRoot: string): Promise<ActiveFeatureMeta> {
  const filePath = activeFeatureMetaPath(projectRoot);
  if (!(await exists(filePath))) {
    return {
      activeFeature: DEFAULT_FEATURE_ID,
      updatedAt: new Date().toISOString()
    };
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    const activeFeatureRaw = typeof parsed.activeFeature === "string"
      ? parsed.activeFeature
      : DEFAULT_FEATURE_ID;
    const updatedAtRaw = typeof parsed.updatedAt === "string"
      ? parsed.updatedAt
      : new Date().toISOString();
    return {
      activeFeature: normalizedFeatureId(activeFeatureRaw),
      updatedAt: updatedAtRaw
    };
  } catch {
    return {
      activeFeature: DEFAULT_FEATURE_ID,
      updatedAt: new Date().toISOString()
    };
  }
}

async function writeActiveFeatureMeta(projectRoot: string, meta: ActiveFeatureMeta): Promise<void> {
  const normalized: ActiveFeatureMeta = {
    activeFeature: normalizedFeatureId(meta.activeFeature),
    updatedAt: meta.updatedAt
  };
  await writeFileSafe(activeFeatureMetaPath(projectRoot), `${JSON.stringify(normalized, null, 2)}\n`);
}

async function ensureFeatureSnapshot(projectRoot: string, featureId: string): Promise<void> {
  const id = normalizedFeatureId(featureId);
  await ensureDir(featureArtifactsPath(projectRoot, id));
  await ensureDir(featureStatePath(projectRoot, id));
}

export async function readActiveFeature(projectRoot: string): Promise<string> {
  const meta = await readActiveFeatureMetaInternal(projectRoot);
  return normalizedFeatureId(meta.activeFeature);
}

export async function listFeatures(projectRoot: string): Promise<string[]> {
  const root = featuresRoot(projectRoot);
  if (!(await exists(root))) {
    return [];
  }
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && FEATURE_ID_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

export async function ensureFeatureSystem(projectRoot: string): Promise<ActiveFeatureMeta> {
  await ensureDir(featuresRoot(projectRoot));
  await ensureDir(runtimeArtifactsRoot(projectRoot));
  await ensureDir(runtimeStateRoot(projectRoot));

  const existing = await readActiveFeatureMetaInternal(projectRoot);
  const activeFeature = normalizedFeatureId(existing.activeFeature);
  await ensureFeatureSnapshot(projectRoot, activeFeature);

  const runtimeArtifactsHasData = await dirHasEntries(runtimeArtifactsRoot(projectRoot));
  const runtimeStateHasData = await dirHasEntries(
    runtimeStateRoot(projectRoot),
    new Set(["active-feature.json"])
  );
  const featureArtifactsHasData = await dirHasEntries(featureArtifactsPath(projectRoot, activeFeature));
  const featureStateHasData = await dirHasEntries(featureStatePath(projectRoot, activeFeature));

  if ((runtimeArtifactsHasData || runtimeStateHasData) && !featureArtifactsHasData && !featureStateHasData) {
    await copyDirectoryContents(
      runtimeArtifactsRoot(projectRoot),
      featureArtifactsPath(projectRoot, activeFeature)
    );
    await copyDirectoryContents(
      runtimeStateRoot(projectRoot),
      featureStatePath(projectRoot, activeFeature),
      { exclude: FEATURE_STATE_EXCLUDE_FROM_SNAPSHOT }
    );
  } else if ((!runtimeArtifactsHasData && !runtimeStateHasData) && (featureArtifactsHasData || featureStateHasData)) {
    await copyDirectoryContents(
      featureArtifactsPath(projectRoot, activeFeature),
      runtimeArtifactsRoot(projectRoot)
    );
    await copyDirectoryContents(
      featureStatePath(projectRoot, activeFeature),
      runtimeStateRoot(projectRoot),
      { preserveTargetEntries: new Set(["active-feature.json"]) }
    );
  }

  const normalized: ActiveFeatureMeta = {
    activeFeature,
    updatedAt: new Date().toISOString()
  };
  await writeActiveFeatureMeta(projectRoot, normalized);
  return normalized;
}

export async function syncActiveFeatureSnapshot(projectRoot: string): Promise<void> {
  const activeFeature = await readActiveFeature(projectRoot);
  await ensureFeatureSnapshot(projectRoot, activeFeature);
  await copyDirectoryContents(runtimeArtifactsRoot(projectRoot), featureArtifactsPath(projectRoot, activeFeature));
  await copyDirectoryContents(runtimeStateRoot(projectRoot), featureStatePath(projectRoot, activeFeature), {
    exclude: FEATURE_STATE_EXCLUDE_FROM_SNAPSHOT
  });
}

export async function switchActiveFeature(projectRoot: string, featureId: string): Promise<ActiveFeatureMeta> {
  await ensureFeatureSystem(projectRoot);
  const current = await readActiveFeature(projectRoot);
  const target = normalizedFeatureId(featureId);
  if (current === target) {
    const unchanged: ActiveFeatureMeta = {
      activeFeature: current,
      updatedAt: new Date().toISOString()
    };
    await writeActiveFeatureMeta(projectRoot, unchanged);
    return unchanged;
  }

  await syncActiveFeatureSnapshot(projectRoot);
  await ensureFeatureSnapshot(projectRoot, target);
  await copyDirectoryContents(featureArtifactsPath(projectRoot, target), runtimeArtifactsRoot(projectRoot));
  await copyDirectoryContents(featureStatePath(projectRoot, target), runtimeStateRoot(projectRoot), {
    preserveTargetEntries: new Set(["active-feature.json"])
  });

  const nextMeta: ActiveFeatureMeta = {
    activeFeature: target,
    updatedAt: new Date().toISOString()
  };
  await writeActiveFeatureMeta(projectRoot, nextMeta);
  return nextMeta;
}

export interface CreateFeatureOptions {
  cloneActive?: boolean;
  switchTo?: boolean;
}

export async function createFeature(
  projectRoot: string,
  rawFeatureId: string,
  options: CreateFeatureOptions = {}
): Promise<string> {
  await ensureFeatureSystem(projectRoot);
  const featureId = normalizedFeatureId(rawFeatureId);
  if (featureId === DEFAULT_FEATURE_ID && rawFeatureId.trim().length > 0 && rawFeatureId.trim().toLowerCase() !== "default") {
    throw new Error(`Unable to create feature from "${rawFeatureId}" — use letters, numbers, and dashes.`);
  }
  const featureDir = featureRootPath(projectRoot, featureId);
  if (await exists(featureDir)) {
    throw new Error(`Feature "${featureId}" already exists.`);
  }

  await ensureFeatureSnapshot(projectRoot, featureId);
  if (options.cloneActive === true) {
    const activeFeature = await readActiveFeature(projectRoot);
    await syncActiveFeatureSnapshot(projectRoot);
    await copyDirectoryContents(
      featureArtifactsPath(projectRoot, activeFeature),
      featureArtifactsPath(projectRoot, featureId)
    );
    await copyDirectoryContents(
      featureStatePath(projectRoot, activeFeature),
      featureStatePath(projectRoot, featureId)
    );
  }

  if (options.switchTo === true) {
    await switchActiveFeature(projectRoot, featureId);
  }
  return featureId;
}
