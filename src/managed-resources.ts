import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { CCLAW_VERSION, RUNTIME_ROOT } from "./constants.js";
import { HARNESS_IDS, type HarnessId } from "./types.js";
import type { WriteFileSafeOptions } from "./fs-utils.js";

export const MANAGED_RESOURCE_MANIFEST_REL_PATH = `${RUNTIME_ROOT}/state/managed-resources.json`;

export interface ManagedResourceEntry {
  path: string;
  sha256: string;
  owner: "cclaw";
  harness?: HarnessId | "core";
  packageVersion: string;
  prunable: boolean;
  safeToOverwrite: boolean;
  updatedAt: string;
  lastBackupPath?: string;
  previousSha256?: string;
}

export interface ManagedResourceManifest {
  version: 1;
  generatedAt: string;
  packageVersion: string;
  resources: ManagedResourceEntry[];
}

interface ManagedResourceSessionOptions {
  projectRoot: string;
  operation: string;
}

export interface ManagedResourceValidationIssue {
  index?: number;
  path?: string;
  field: string;
  message: string;
}

const MANAGED_RESOURCE_HARNESSES = new Set<string>(["core", ...HARNESS_IDS]);
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/iu;

let activeSession: ManagedResourceSession | null = null;

function sha256(content: string | Buffer): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function normalizeRelPath(projectRoot: string, filePath: string): string | null {
  const rel = path.relative(projectRoot, filePath).replace(/\\/gu, "/");
  if (rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) return null;
  return rel;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

async function atomicWrite(filePath: string, content: string, options: WriteFileSafeOptions = {}): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.writeFile(tempPath, content, {
    encoding: "utf8",
    ...(options.mode !== undefined ? { mode: options.mode } : {})
  });
  await fs.rename(tempPath, filePath);
  if (options.mode !== undefined) {
    await fs.chmod(filePath, options.mode).catch(() => undefined);
  }
}

function inferHarness(relPath: string): ManagedResourceEntry["harness"] {
  if (relPath.startsWith(".claude/")) return "claude";
  if (relPath.startsWith(".cursor/")) return "cursor";
  if (relPath.startsWith(".opencode/")) return "opencode";
  if (relPath.startsWith(".codex/") || relPath.startsWith(".agents/skills/")) return "codex";
  return "core";
}

export function isManagedGeneratedPath(relPath: string): boolean {
  if (relPath === MANAGED_RESOURCE_MANIFEST_REL_PATH) return false;
  if (relPath === `${RUNTIME_ROOT}/config.yaml`) return false;
  if (relPath === `${RUNTIME_ROOT}/knowledge.jsonl`) return false;
  if (relPath.startsWith(`${RUNTIME_ROOT}/artifacts/`)) return false;
  if (relPath.startsWith(`${RUNTIME_ROOT}/runs/`)) return false;
  if (relPath === `${RUNTIME_ROOT}/state/flow-state.json`) return false;
  if (relPath === `${RUNTIME_ROOT}/state/.init-in-progress`) return false;
  if (relPath.startsWith(`${RUNTIME_ROOT}/state/upgrade-backups/`)) return false;
  if (relPath.startsWith(`${RUNTIME_ROOT}/state/sync-backups/`)) return false;

  if (relPath === "AGENTS.md" || relPath === "CLAUDE.md") return true;
  if (relPath === `${RUNTIME_ROOT}/state/iron-laws.json`) return true;
  for (const prefix of [
    `${RUNTIME_ROOT}/commands/`,
    `${RUNTIME_ROOT}/skills/`,
    `${RUNTIME_ROOT}/templates/`,
    `${RUNTIME_ROOT}/rules/`,
    `${RUNTIME_ROOT}/agents/`,
    `${RUNTIME_ROOT}/hooks/`,
    ".claude/commands/",
    ".cursor/commands/",
    ".opencode/commands/",
    ".opencode/agents/",
    ".codex/agents/",
    ".agents/skills/"
  ]) {
    if (relPath.startsWith(prefix)) return true;
  }
  return relPath === ".claude/hooks/hooks.json" ||
    relPath === ".cursor/hooks.json" ||
    relPath === ".cursor/rules/cclaw-workflow.mdc" ||
    relPath === ".codex/hooks.json" ||
    relPath === ".opencode/plugins/cclaw-plugin.mjs";
}

function validationIssue(index: number | undefined, field: string, message: string, pathValue?: unknown): ManagedResourceValidationIssue {
  return {
    ...(index !== undefined ? { index } : {}),
    ...(typeof pathValue === "string" ? { path: pathValue } : {}),
    field,
    message
  };
}

function validateSha256(value: unknown): boolean {
  return typeof value === "string" && SHA256_HEX_PATTERN.test(value);
}

export function validateManagedResourceEntry(value: unknown, index?: number): ManagedResourceValidationIssue[] {
  const issues: ManagedResourceValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [validationIssue(index, "entry", "entry must be an object")];
  }

  const entry = value as Partial<ManagedResourceEntry>;
  if (typeof entry.path !== "string" || entry.path.trim().length === 0) {
    issues.push(validationIssue(index, "path", "path must be a non-empty string", entry.path));
  } else if (entry.path.startsWith("../") || entry.path === ".." || path.isAbsolute(entry.path)) {
    issues.push(validationIssue(index, "path", "path must be project-relative", entry.path));
  } else if (!isManagedGeneratedPath(entry.path)) {
    issues.push(validationIssue(index, "path", "path must be a known generated cclaw surface", entry.path));
  }

  if (!validateSha256(entry.sha256)) {
    issues.push(validationIssue(index, "sha256", "sha256 must be a 64-character hex digest", entry.path));
  }
  if (entry.owner !== "cclaw") {
    issues.push(validationIssue(index, "owner", 'owner must be "cclaw"', entry.path));
  }
  if (typeof entry.harness !== "string" || !MANAGED_RESOURCE_HARNESSES.has(entry.harness)) {
    issues.push(validationIssue(index, "harness", `harness must be one of: core, ${HARNESS_IDS.join(", ")}`, entry.path));
  }
  if (typeof entry.packageVersion !== "string" || entry.packageVersion.trim().length === 0) {
    issues.push(validationIssue(index, "packageVersion", "packageVersion must be a non-empty string", entry.path));
  }
  if (typeof entry.prunable !== "boolean") {
    issues.push(validationIssue(index, "prunable", "prunable must be a boolean", entry.path));
  }
  if (typeof entry.safeToOverwrite !== "boolean") {
    issues.push(validationIssue(index, "safeToOverwrite", "safeToOverwrite must be a boolean", entry.path));
  }
  if (typeof entry.updatedAt !== "string" || entry.updatedAt.trim().length === 0) {
    issues.push(validationIssue(index, "updatedAt", "updatedAt must be a non-empty string", entry.path));
  }
  if (entry.lastBackupPath !== undefined && (typeof entry.lastBackupPath !== "string" || entry.lastBackupPath.trim().length === 0)) {
    issues.push(validationIssue(index, "lastBackupPath", "lastBackupPath must be a non-empty string when present", entry.path));
  }
  if (entry.previousSha256 !== undefined && !validateSha256(entry.previousSha256)) {
    issues.push(validationIssue(index, "previousSha256", "previousSha256 must be a 64-character hex digest when present", entry.path));
  }
  return issues;
}

export function validateManagedResourceManifest(value: unknown): ManagedResourceValidationIssue[] {
  const issues: ManagedResourceValidationIssue[] = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [validationIssue(undefined, "manifest", "manifest must be an object")];
  }
  const manifest = value as Partial<ManagedResourceManifest>;
  if (manifest.version !== 1) {
    issues.push(validationIssue(undefined, "version", "version must be 1"));
  }
  if (typeof manifest.generatedAt !== "string" || manifest.generatedAt.trim().length === 0) {
    issues.push(validationIssue(undefined, "generatedAt", "generatedAt must be a non-empty string"));
  }
  if (typeof manifest.packageVersion !== "string" || manifest.packageVersion.trim().length === 0) {
    issues.push(validationIssue(undefined, "packageVersion", "packageVersion must be a non-empty string"));
  }
  if (!Array.isArray(manifest.resources)) {
    issues.push(validationIssue(undefined, "resources", "resources must be an array"));
    return issues;
  }
  manifest.resources.forEach((entry, index) => {
    issues.push(...validateManagedResourceEntry(entry, index));
  });
  return issues;
}

export function isValidManagedResourceEntry(value: unknown): value is ManagedResourceEntry {
  return validateManagedResourceEntry(value).length === 0;
}

export async function readManagedResourceManifest(projectRoot: string): Promise<ManagedResourceManifest | null> {
  const manifestPath = path.join(projectRoot, MANAGED_RESOURCE_MANIFEST_REL_PATH);
  if (!(await exists(manifestPath))) return null;
  const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Partial<ManagedResourceManifest>;
  if (parsed.version !== 1 || !Array.isArray(parsed.resources)) return null;
  const resources = parsed.resources.filter(isValidManagedResourceEntry);
  return {
    version: 1,
    generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : new Date(0).toISOString(),
    packageVersion: typeof parsed.packageVersion === "string" ? parsed.packageVersion : "unknown",
    resources
  };
}

export class ManagedResourceSession {
  private readonly projectRoot: string;
  private readonly operation: string;
  private readonly timestamp: string;
  private readonly previous = new Map<string, ManagedResourceEntry>();
  private readonly touched = new Map<string, ManagedResourceEntry>();

  private constructor(options: ManagedResourceSessionOptions, previous: ManagedResourceManifest | null) {
    this.projectRoot = options.projectRoot;
    this.operation = options.operation;
    this.timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
    for (const entry of previous?.resources ?? []) {
      this.previous.set(entry.path, entry);
    }
  }

  static async create(options: ManagedResourceSessionOptions): Promise<ManagedResourceSession> {
    const previous = await readManagedResourceManifest(options.projectRoot).catch(() => null);
    return new ManagedResourceSession(options, previous);
  }

  shouldManage(filePath: string): boolean {
    const rel = normalizeRelPath(this.projectRoot, filePath);
    return rel !== null && isManagedGeneratedPath(rel);
  }

  async writeFileSafe(filePath: string, content: string, options: WriteFileSafeOptions = {}): Promise<void> {
    const rel = normalizeRelPath(this.projectRoot, filePath);
    if (rel === null || !isManagedGeneratedPath(rel)) {
      await atomicWrite(filePath, content, options);
      return;
    }

    const nextHash = sha256(content);
    const previous = this.previous.get(rel);
    let previousSha256: string | undefined;
    let lastBackupPath: string | undefined;

    if (await exists(filePath)) {
      const current = await fs.readFile(filePath);
      const currentHash = sha256(current);
      previousSha256 = currentHash;
      const knownPrevious = previous?.sha256;
      if (currentHash !== nextHash && (knownPrevious === undefined || currentHash !== knownPrevious)) {
        const backupRoot = path.join(
          this.projectRoot,
          RUNTIME_ROOT,
          "state",
          this.operation === "upgrade" ? "upgrade-backups" : "sync-backups",
          this.timestamp
        );
        const backupPath = path.join(backupRoot, rel);
        await ensureDir(path.dirname(backupPath));
        await fs.copyFile(filePath, backupPath);
        lastBackupPath = normalizeRelPath(this.projectRoot, backupPath) ?? undefined;
      }
    }

    await atomicWrite(filePath, content, options);
    this.touched.set(rel, {
      path: rel,
      sha256: nextHash,
      owner: "cclaw",
      harness: inferHarness(rel),
      packageVersion: CCLAW_VERSION,
      prunable: true,
      safeToOverwrite: true,
      updatedAt: new Date().toISOString(),
      ...(lastBackupPath ? { lastBackupPath } : {}),
      ...(previousSha256 && previousSha256 !== nextHash ? { previousSha256 } : {})
    });
  }

  async commit(): Promise<ManagedResourceManifest> {
    const resourcesByPath = new Map<string, ManagedResourceEntry>(this.previous);
    for (const [rel, entry] of this.touched) {
      resourcesByPath.set(rel, entry);
    }
    const resources: ManagedResourceEntry[] = [];
    for (const entry of resourcesByPath.values()) {
      if (await exists(path.join(this.projectRoot, entry.path))) {
        resources.push(entry);
      }
    }
    const manifest: ManagedResourceManifest = {
      version: 1,
      generatedAt: new Date().toISOString(),
      packageVersion: CCLAW_VERSION,
      resources: resources.sort((a, b) => a.path.localeCompare(b.path))
    };
    await atomicWrite(
      path.join(this.projectRoot, MANAGED_RESOURCE_MANIFEST_REL_PATH),
      `${JSON.stringify(manifest, null, 2)}\n`,
      { mode: 0o600 }
    );
    return manifest;
  }
}

export function getActiveManagedResourceSession(): ManagedResourceSession | null {
  return activeSession;
}

export function setActiveManagedResourceSession(session: ManagedResourceSession | null): void {
  activeSession = session;
}

export function isManagedResourcePath(projectRoot: string, filePath: string): boolean {
  const rel = normalizeRelPath(projectRoot, filePath);
  return rel !== null && isManagedGeneratedPath(rel);
}

export function hashManagedResourceContent(content: string | Buffer): string {
  return sha256(content);
}
