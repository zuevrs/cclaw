import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WORKFLOW_PATH = /(^|\/)\.github\/workflows\//u;
const CURSOR_CONFIG_PATH = /(^|\/)\.cursor\//u;
const PACKAGE_JSON_PATH = /(^|\/)package\.json$/u;

const SUPPLY_CHAIN_DEP_KEYS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies"
] as const;

async function resolveDiffBase(projectRoot: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD~1"], {
      cwd: projectRoot
    });
    const base = stdout.trim();
    return base.length > 0 ? base : null;
  } catch {
    return null;
  }
}

async function readFileAtRev(
  projectRoot: string,
  rev: string,
  filePath: string
): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["show", `${rev}:${filePath}`], {
      cwd: projectRoot,
      maxBuffer: 32 * 1024 * 1024
    });
    return stdout;
  } catch {
    return null;
  }
}

function dependencyMapsDiffer(
  before: Record<string, unknown> | undefined,
  after: Record<string, unknown> | undefined
): boolean {
  const beforeKeys = before ? Object.keys(before).sort() : [];
  const afterKeys = after ? Object.keys(after).sort() : [];
  if (beforeKeys.length !== afterKeys.length) return true;
  for (let i = 0; i < beforeKeys.length; i += 1) {
    if (beforeKeys[i] !== afterKeys[i]) return true;
    const k = beforeKeys[i] as string;
    if ((before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k]) {
      return true;
    }
  }
  return false;
}

async function packageJsonHasDependencyDiff(
  projectRoot: string,
  base: string,
  filePath: string
): Promise<boolean> {
  const beforeRaw = await readFileAtRev(projectRoot, base, filePath);
  const afterRaw = await readFileAtRev(projectRoot, "HEAD", filePath);
  // If either side is missing or unparseable, treat as changed (be conservative).
  if (beforeRaw === null || afterRaw === null) return true;
  let beforeJson: unknown;
  let afterJson: unknown;
  try {
    beforeJson = JSON.parse(beforeRaw);
  } catch {
    return true;
  }
  try {
    afterJson = JSON.parse(afterRaw);
  } catch {
    return true;
  }
  const beforeObj = beforeJson !== null && typeof beforeJson === "object"
    ? (beforeJson as Record<string, unknown>)
    : {};
  const afterObj = afterJson !== null && typeof afterJson === "object"
    ? (afterJson as Record<string, unknown>)
    : {};
  for (const key of SUPPLY_CHAIN_DEP_KEYS) {
    const beforeMap = (beforeObj[key] !== null && typeof beforeObj[key] === "object")
      ? (beforeObj[key] as Record<string, unknown>)
      : undefined;
    const afterMap = (afterObj[key] !== null && typeof afterObj[key] === "object")
      ? (afterObj[key] as Record<string, unknown>)
      : undefined;
    if (dependencyMapsDiffer(beforeMap, afterMap)) {
      return true;
    }
  }
  return false;
}

export interface SupplyChainChangeDetection {
  triggered: boolean;
  changedFiles: string[];
  reasons: string[];
}

export async function detectSupplyChainChanges(
  projectRoot: string
): Promise<SupplyChainChangeDetection> {
  const base = await resolveDiffBase(projectRoot);
  if (!base) {
    return { triggered: false, changedFiles: [], reasons: [] };
  }
  let changed: string[] = [];
  try {
    const range = `${base}..HEAD`;
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", range], {
      cwd: projectRoot
    });
    changed = stdout
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    return { triggered: false, changedFiles: [], reasons: [] };
  }
  const matchedFiles: string[] = [];
  const reasons: string[] = [];
  for (const filePath of changed) {
    if (WORKFLOW_PATH.test(filePath)) {
      matchedFiles.push(filePath);
      reasons.push(`.github/workflows changed: ${filePath}`);
      continue;
    }
    if (CURSOR_CONFIG_PATH.test(filePath)) {
      matchedFiles.push(filePath);
      reasons.push(`.cursor config changed: ${filePath}`);
      continue;
    }
    if (PACKAGE_JSON_PATH.test(filePath)) {
      // Only flag when supply-chain dependency keys differ.
      const depDiffers = await packageJsonHasDependencyDiff(projectRoot, base, filePath);
      if (depDiffers) {
        matchedFiles.push(filePath);
        reasons.push(`${filePath} dependencies/devDependencies/peerDependencies/optionalDependencies changed`);
      }
      continue;
    }
  }
  return {
    triggered: matchedFiles.length > 0,
    changedFiles: matchedFiles,
    reasons
  };
}
