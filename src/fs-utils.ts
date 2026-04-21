import fs from "node:fs/promises";
import path from "node:path";

export async function ensureDir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Strip a leading UTF-8 BOM (U+FEFF) if present. Many editors (VS Code on
 * Windows, Notepad, some CI tools) silently prepend a BOM when saving
 * UTF-8; when the file is then split on `\n` the first line keeps the
 * invisible BOM and `JSON.parse` rejects it, which caused the first
 * knowledge.jsonl entry to be silently dropped on load. Treat BOM as a
 * no-op at read time so the rest of the pipeline sees clean UTF-8.
 */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
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
  let lastError: unknown = null;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      await fs.mkdir(lockPath);
      acquired = true;
      break;
    } catch (error) {
      lastError = error;
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
    const details = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Failed to acquire lock: ${lockPath} (attempts=${retries}, retryDelayMs=${retryDelayMs}, staleAfterMs=${staleAfterMs}, lastError=${details})`
    );
  }

  try {
    return await fn();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true }).catch((cleanupError) => {
      // Lock cleanup failure should not shadow the original operation result,
      // but keep a diagnostic breadcrumb for flaky FS environments.
      const details = cleanupError instanceof Error ? cleanupError.message : String(cleanupError);
      // eslint-disable-next-line no-console
      console.warn(`cclaw lock cleanup failed for ${lockPath}: ${details}`);
    });
  }
}

export async function writeFileSafe(filePath: string, content: string): Promise<void> {
  await ensureDir(path.dirname(filePath));
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  );
  await fs.writeFile(tempPath, content, "utf8");
  try {
    await fs.rename(tempPath, filePath);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    // `rename` fails with EXDEV when the temp file and target live on
    // different filesystems (container bind mounts, tmpfs + rootfs,
    // cross-volume setups). Fall back to copy + unlink so atomic writes
    // still work — copyFile is not fully atomic but is the best we can
    // do across devices, and we remove the temp even if copy fails.
    if (code === "EXDEV") {
      try {
        await fs.copyFile(tempPath, filePath);
      } finally {
        await fs.unlink(tempPath).catch(() => undefined);
      }
      return;
    }
    // Other errors: try to clean up the temp to avoid littering the
    // directory with orphaned `.tmp-<pid>-*` files, then rethrow.
    await fs.unlink(tempPath).catch(() => undefined);
    throw error;
  }
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
