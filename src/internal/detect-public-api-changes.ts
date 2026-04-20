import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const PUBLIC_SURFACE_PATH_PATTERNS = [
  /(^|\/)(cli|types?|config)\.[cm]?[jt]s$/iu,
  /(^|\/)(openapi|swagger|schema)(\/|[-_.])/iu,
  /(^|\/)(api|commands?|flags?)(\/|[-_.])/iu,
  /(^|\/)(package|tsconfig)\.json$/iu
];

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

export interface PublicApiChangeDetection {
  triggered: boolean;
  changedFiles: string[];
}

export async function detectPublicApiChanges(
  projectRoot: string
): Promise<PublicApiChangeDetection> {
  const base = await resolveDiffBase(projectRoot);
  if (!base) {
    return { triggered: false, changedFiles: [] };
  }
  try {
    const range = `${base}..HEAD`;
    const { stdout } = await execFileAsync("git", ["diff", "--name-only", range], {
      cwd: projectRoot
    });
    const changedFiles = stdout
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter((filePath) => PUBLIC_SURFACE_PATH_PATTERNS.some((pattern) => pattern.test(filePath)));
    return {
      triggered: changedFiles.length > 0,
      changedFiles
    };
  } catch {
    return { triggered: false, changedFiles: [] };
  }
}
