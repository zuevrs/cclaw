import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export async function createTempProject(prefix = "cclaw-v8-"): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function removeProject(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
