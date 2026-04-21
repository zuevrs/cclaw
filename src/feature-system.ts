import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RUNTIME_ROOT } from "./constants.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";

const execFileAsync = promisify(execFile);

const WORKTREES_DIR_REL_PATH = `${RUNTIME_ROOT}/worktrees`;
const LEGACY_FEATURES_DIR_REL_PATH = `${RUNTIME_ROOT}/features`;
const ACTIVE_FEATURE_META_REL_PATH = `${RUNTIME_ROOT}/state/active-feature.json`;
const WORKTREE_REGISTRY_REL_PATH = `${RUNTIME_ROOT}/state/worktrees.json`;
const DEFAULT_FEATURE_ID = "default";
const WORKTREE_REGISTRY_SCHEMA_VERSION = 1;
const FEATURE_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/u;

export interface ActiveFeatureMeta {
  activeFeature: string;
  updatedAt: string;
}

export type FeatureWorkspaceSource = "git-worktree" | "workspace" | "legacy-snapshot";

export interface FeatureWorkspaceEntry {
  featureId: string;
  branch: string;
  path: string;
  source: FeatureWorkspaceSource;
  createdAt: string;
}

export interface FeatureWorktreeRegistry {
  schemaVersion: 1;
  updatedAt: string;
  entries: FeatureWorkspaceEntry[];
}

export interface CreateFeatureOptions {
  cloneActive?: boolean;
  switchTo?: boolean;
}

export interface FeatureSystemAccessOptions {
  /**
   * When false, read metadata without auto-repair writes. Useful for pure
   * diagnostics (doctor) that should not mutate state as a side effect.
   */
  repair?: boolean;
}

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

function worktreesRoot(projectRoot: string): string {
  return path.join(projectRoot, WORKTREES_DIR_REL_PATH);
}

function legacyFeaturesRoot(projectRoot: string): string {
  return path.join(projectRoot, LEGACY_FEATURES_DIR_REL_PATH);
}

export function activeFeatureMetaPath(projectRoot: string): string {
  return path.join(projectRoot, ACTIVE_FEATURE_META_REL_PATH);
}

export function worktreeRegistryPath(projectRoot: string): string {
  return path.join(projectRoot, WORKTREE_REGISTRY_REL_PATH);
}

export function featureRootPath(projectRoot: string, featureId: string): string {
  return path.join(worktreesRoot(projectRoot), normalizedFeatureId(featureId));
}

export function featureArtifactsPath(projectRoot: string, featureId: string): string {
  return path.join(featureRootPath(projectRoot, featureId), RUNTIME_ROOT, "artifacts");
}

export function featureStatePath(projectRoot: string, featureId: string): string {
  return path.join(featureRootPath(projectRoot, featureId), RUNTIME_ROOT, "state");
}

export function resolveFeatureWorkspacePath(projectRoot: string, entry: FeatureWorkspaceEntry): string {
  if (entry.path === ".") {
    return projectRoot;
  }
  return path.resolve(projectRoot, entry.path);
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

function toRelativePath(projectRoot: string, absolutePath: string): string {
  const rel = path.relative(projectRoot, absolutePath);
  if (!rel || rel.trim().length === 0) {
    return ".";
  }
  return rel.split(path.sep).join("/");
}

function sanitizeWorkspaceSource(value: unknown): FeatureWorkspaceSource {
  if (value === "git-worktree" || value === "workspace" || value === "legacy-snapshot") {
    return value;
  }
  return "workspace";
}

function sanitizeRegistryEntry(raw: unknown): FeatureWorkspaceEntry | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const typed = raw as Record<string, unknown>;
  const featureIdRaw = typeof typed.featureId === "string" ? typed.featureId : "";
  const featureId = normalizedFeatureId(featureIdRaw);
  if (!FEATURE_ID_PATTERN.test(featureId)) {
    return null;
  }
  const branch = typeof typed.branch === "string" && typed.branch.trim().length > 0
    ? typed.branch.trim()
    : (featureId === DEFAULT_FEATURE_ID ? "workspace/default" : `workspace/${featureId}`);
  const pathRaw = typeof typed.path === "string" ? typed.path.trim() : "";
  const workspacePath = pathRaw.length > 0 ? pathRaw : ".";
  const createdAt = typeof typed.createdAt === "string" && typed.createdAt.trim().length > 0
    ? typed.createdAt.trim()
    : new Date().toISOString();
  return {
    featureId,
    branch,
    path: workspacePath,
    source: sanitizeWorkspaceSource(typed.source),
    createdAt
  };
}

function dedupeEntries(entries: FeatureWorkspaceEntry[]): FeatureWorkspaceEntry[] {
  const byId = new Map<string, FeatureWorkspaceEntry>();
  for (const entry of entries) {
    if (!byId.has(entry.featureId)) {
      byId.set(entry.featureId, entry);
    }
  }
  return [...byId.values()].sort((a, b) => a.featureId.localeCompare(b.featureId));
}

async function runGit(projectRoot: string, args: string[]): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd: projectRoot });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: typeof err.stdout === "string" ? err.stdout.trim() : "",
      stderr: typeof err.stderr === "string" && err.stderr.trim().length > 0
        ? err.stderr.trim()
        : (err.message ?? "git command failed")
    };
  }
}

async function isGitRepository(projectRoot: string): Promise<boolean> {
  const result = await runGit(projectRoot, ["rev-parse", "--is-inside-work-tree"]);
  return result.ok && result.stdout === "true";
}

async function currentBranch(projectRoot: string): Promise<string> {
  const result = await runGit(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]);
  return result.ok && result.stdout.length > 0 ? result.stdout : "HEAD";
}

async function defaultStartPoint(projectRoot: string): Promise<string> {
  const remoteHead = await runGit(projectRoot, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
  if (remoteHead.ok && remoteHead.stdout.length > 0) {
    return remoteHead.stdout.replace(/^origin\//u, "");
  }
  return currentBranch(projectRoot);
}

function buildDefaultEntry(source: FeatureWorkspaceSource, branch: string): FeatureWorkspaceEntry {
  return {
    featureId: DEFAULT_FEATURE_ID,
    branch,
    path: ".",
    source,
    createdAt: new Date().toISOString()
  };
}

async function readRegistry(projectRoot: string): Promise<FeatureWorktreeRegistry> {
  const filePath = worktreeRegistryPath(projectRoot);
  if (!(await exists(filePath))) {
    return {
      schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: []
    };
  }
  try {
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
    const entriesRaw = Array.isArray(parsed.entries) ? parsed.entries : [];
    const entries = dedupeEntries(
      entriesRaw
        .map((entry) => sanitizeRegistryEntry(entry))
        .filter((entry): entry is FeatureWorkspaceEntry => entry !== null)
    );
    const updatedAt = typeof parsed.updatedAt === "string" && parsed.updatedAt.trim().length > 0
      ? parsed.updatedAt.trim()
      : new Date().toISOString();
    return {
      schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
      updatedAt,
      entries
    };
  } catch {
    return {
      schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      entries: []
    };
  }
}

async function writeRegistry(projectRoot: string, registry: FeatureWorktreeRegistry): Promise<void> {
  const normalized: FeatureWorktreeRegistry = {
    schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
    updatedAt: registry.updatedAt,
    entries: dedupeEntries(registry.entries)
  };
  await writeFileSafe(worktreeRegistryPath(projectRoot), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
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
  await writeFileSafe(activeFeatureMetaPath(projectRoot), `${JSON.stringify(normalized, null, 2)}\n`, { mode: 0o600 });
}

function registryHasFeature(registry: FeatureWorktreeRegistry, featureId: string): boolean {
  return registry.entries.some((entry) => entry.featureId === featureId);
}

function findEntry(registry: FeatureWorktreeRegistry, featureId: string): FeatureWorkspaceEntry | undefined {
  return registry.entries.find((entry) => entry.featureId === featureId);
}

async function listLegacySnapshotIds(projectRoot: string): Promise<string[]> {
  const root = legacyFeaturesRoot(projectRoot);
  if (!(await exists(root))) {
    return [];
  }
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && FEATURE_ID_PATTERN.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

async function ensureRegistryState(projectRoot: string): Promise<{
  registry: FeatureWorktreeRegistry;
  activeMeta: ActiveFeatureMeta;
}> {
  await ensureDir(path.join(projectRoot, RUNTIME_ROOT, "state"));
  await ensureDir(worktreesRoot(projectRoot));

  const gitRepo = await isGitRepository(projectRoot);
  const source: FeatureWorkspaceSource = gitRepo ? "git-worktree" : "workspace";
  const branch = gitRepo ? await currentBranch(projectRoot) : "workspace/default";

  const currentRegistry = await readRegistry(projectRoot);
  const entries = [...currentRegistry.entries];
  if (!entries.some((entry) => entry.featureId === DEFAULT_FEATURE_ID)) {
    entries.push(buildDefaultEntry(source, branch));
  }

  const legacyFeatureIds = await listLegacySnapshotIds(projectRoot);
  for (const legacyId of legacyFeatureIds) {
    if (entries.some((entry) => entry.featureId === legacyId)) {
      continue;
    }
    entries.push({
      featureId: legacyId,
      branch: `legacy/${legacyId}`,
      path: `${LEGACY_FEATURES_DIR_REL_PATH}/${legacyId}`,
      source: "legacy-snapshot",
      createdAt: new Date().toISOString()
    });
  }

  const registry: FeatureWorktreeRegistry = {
    schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: dedupeEntries(entries)
  };
  await writeRegistry(projectRoot, registry);

  const active = await readActiveFeatureMetaInternal(projectRoot);
  const normalizedActive = registryHasFeature(registry, active.activeFeature)
    ? active.activeFeature
    : DEFAULT_FEATURE_ID;
  const activeMeta: ActiveFeatureMeta = {
    activeFeature: normalizedActive,
    updatedAt: new Date().toISOString()
  };
  await writeActiveFeatureMeta(projectRoot, activeMeta);
  return { registry, activeMeta };
}

async function readRegistryStateReadonly(projectRoot: string): Promise<{
  registry: FeatureWorktreeRegistry;
  activeMeta: ActiveFeatureMeta;
}> {
  const currentRegistry = await readRegistry(projectRoot);
  const entries = [...currentRegistry.entries];

  const gitRepo = await isGitRepository(projectRoot);
  const source: FeatureWorkspaceSource = gitRepo ? "git-worktree" : "workspace";
  const branch = gitRepo ? await currentBranch(projectRoot) : "workspace/default";
  if (!entries.some((entry) => entry.featureId === DEFAULT_FEATURE_ID)) {
    entries.push(buildDefaultEntry(source, branch));
  }

  const legacyFeatureIds = await listLegacySnapshotIds(projectRoot);
  for (const legacyId of legacyFeatureIds) {
    if (entries.some((entry) => entry.featureId === legacyId)) {
      continue;
    }
    entries.push({
      featureId: legacyId,
      branch: `legacy/${legacyId}`,
      path: `${LEGACY_FEATURES_DIR_REL_PATH}/${legacyId}`,
      source: "legacy-snapshot",
      createdAt: new Date().toISOString()
    });
  }

  const registry: FeatureWorktreeRegistry = {
    schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
    updatedAt: currentRegistry.updatedAt,
    entries: dedupeEntries(entries)
  };
  const active = await readActiveFeatureMetaInternal(projectRoot);
  return {
    registry,
    activeMeta: {
      activeFeature: registryHasFeature(registry, active.activeFeature)
        ? active.activeFeature
        : DEFAULT_FEATURE_ID,
      updatedAt: active.updatedAt
    }
  };
}
async function resolveFeatureSystemState(
  projectRoot: string,
  options: FeatureSystemAccessOptions = {}
): Promise<{ registry: FeatureWorktreeRegistry; activeMeta: ActiveFeatureMeta }> {
  if (options.repair === false) {
    return readRegistryStateReadonly(projectRoot);
  }
  return ensureRegistryState(projectRoot);
}

export async function ensureFeatureSystem(
  projectRoot: string,
  options: FeatureSystemAccessOptions = {}
): Promise<ActiveFeatureMeta> {
  const { activeMeta } = await resolveFeatureSystemState(projectRoot, options);
  return activeMeta;
}

export async function readFeatureWorktreeRegistry(
  projectRoot: string,
  options: FeatureSystemAccessOptions = {}
): Promise<FeatureWorktreeRegistry> {
  const { registry } = await resolveFeatureSystemState(projectRoot, options);
  return registry;
}

export async function readActiveFeature(
  projectRoot: string,
  options: FeatureSystemAccessOptions = {}
): Promise<string> {
  const meta = await ensureFeatureSystem(projectRoot, options);
  return normalizedFeatureId(meta.activeFeature);
}

export async function listFeatures(
  projectRoot: string,
  options: FeatureSystemAccessOptions = {}
): Promise<string[]> {
  const registry = await readFeatureWorktreeRegistry(projectRoot, options);
  return registry.entries.map((entry) => entry.featureId).sort((a, b) => a.localeCompare(b));
}

export async function syncActiveFeatureSnapshot(projectRoot: string): Promise<void> {
  await ensureFeatureSystem(projectRoot);
}

export async function switchActiveFeature(projectRoot: string, featureId: string): Promise<ActiveFeatureMeta> {
  const registry = await readFeatureWorktreeRegistry(projectRoot);
  const target = normalizedFeatureId(featureId);
  if (!registryHasFeature(registry, target)) {
    throw new Error(`Feature "${target}" is not registered. Create it first with /cc-ops feature new ${target}.`);
  }
  const nextMeta: ActiveFeatureMeta = {
    activeFeature: target,
    updatedAt: new Date().toISOString()
  };
  await writeActiveFeatureMeta(projectRoot, nextMeta);
  return nextMeta;
}

export async function createFeature(
  projectRoot: string,
  rawFeatureId: string,
  options: CreateFeatureOptions = {}
): Promise<string> {
  const registry = await readFeatureWorktreeRegistry(projectRoot);
  const featureId = normalizedFeatureId(rawFeatureId);
  if (
    featureId === DEFAULT_FEATURE_ID &&
    rawFeatureId.trim().length > 0 &&
    rawFeatureId.trim().toLowerCase() !== "default"
  ) {
    throw new Error(`Unable to create feature from "${rawFeatureId}" — use letters, numbers, and dashes.`);
  }
  if (registryHasFeature(registry, featureId)) {
    throw new Error(`Feature "${featureId}" already exists.`);
  }

  const isGit = await isGitRepository(projectRoot);
  let entry: FeatureWorkspaceEntry;
  if (isGit) {
    const workspacePath = featureRootPath(projectRoot, featureId);
    if (await exists(workspacePath)) {
      throw new Error(`Worktree path already exists: ${workspacePath}`);
    }
    await ensureDir(path.dirname(workspacePath));

    const branch = `feature/${featureId}`;
    const localBranchRef = `refs/heads/${branch}`;
    const branchCheck = await runGit(projectRoot, ["show-ref", "--verify", "--quiet", localBranchRef]);
    if (branchCheck.ok) {
      const addExisting = await runGit(projectRoot, ["worktree", "add", workspacePath, branch]);
      if (!addExisting.ok) {
        throw new Error(`Unable to attach worktree for branch "${branch}": ${addExisting.stderr}`);
      }
    } else {
      const startPoint = options.cloneActive === false
        ? await defaultStartPoint(projectRoot)
        : "HEAD";
      const addNew = await runGit(projectRoot, ["worktree", "add", "-b", branch, workspacePath, startPoint]);
      if (!addNew.ok) {
        throw new Error(`Unable to create worktree "${featureId}" on branch "${branch}": ${addNew.stderr}`);
      }
    }

    entry = {
      featureId,
      branch,
      path: toRelativePath(projectRoot, workspacePath),
      source: "git-worktree",
      createdAt: new Date().toISOString()
    };
  } else {
    const workspacePath = featureRootPath(projectRoot, featureId);
    await ensureDir(workspacePath);
    entry = {
      featureId,
      branch: `workspace/${featureId}`,
      path: toRelativePath(projectRoot, workspacePath),
      source: "workspace",
      createdAt: new Date().toISOString()
    };
  }

  const nextRegistry: FeatureWorktreeRegistry = {
    schemaVersion: WORKTREE_REGISTRY_SCHEMA_VERSION,
    updatedAt: new Date().toISOString(),
    entries: dedupeEntries([...registry.entries, entry])
  };
  await writeRegistry(projectRoot, nextRegistry);

  if (options.switchTo === true) {
    await switchActiveFeature(projectRoot, featureId);
  }

  return featureId;
}

export async function activeFeatureWorkspacePath(projectRoot: string): Promise<string> {
  const registry = await readFeatureWorktreeRegistry(projectRoot);
  const active = await readActiveFeature(projectRoot);
  const entry = findEntry(registry, active);
  if (!entry) {
    return projectRoot;
  }
  return resolveFeatureWorkspacePath(projectRoot, entry);
}
