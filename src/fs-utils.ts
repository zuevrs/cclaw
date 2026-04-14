import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DirectoryLockOptions {
  retries?: number;
  retryDelayMs?: number;
  staleAfterMs?: number;
}

/**
 * Acquire a lightweight lock by creating a directory.
 * The lock is removed in a finally block.
 */
export async function withDirectoryLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: DirectoryLockOptions = {}
): Promise<T> {
  const retries = options.retries ?? 200;
  const retryDelayMs = options.retryDelayMs ?? 20;
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  await ensureDir(path.dirname(lockPath));

  let acquired = false;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "EEXIST") {
        throw error;
      }

      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > staleAfterMs) {
          await fs.rm(lockPath, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Lock directory disappeared between retries.
      }
      await sleep(retryDelayMs);
    }
  }

  if (!acquired) {
    throw new Error(`Failed to acquire lock: ${lockPath}`);
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
  }
}

export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.writeFile(tempPath, content, "utf8");
  await fs.rename(tempPath, filePath);
}

export async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function removeIfExists(targetPath: string): Promise<void> {
  if (await exists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

export function resolveProjectPath(cwd: string, relativePath: string): string {
  return path.resolve(cwd, relativePath);
}
