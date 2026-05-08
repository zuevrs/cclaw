import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export interface TempProjectOptions {
  prefix?: string;
  /**
   * Harness marker directories to seed in the project root before init.
   * Defaults to [".cursor"] so cclaw's auto-detect picks Cursor as the
   * harness. Pass an empty array to test the no-harness-detected path.
   */
  harnessMarkers?: string[];
}

export async function createTempProject(options: TempProjectOptions = {}): Promise<string> {
  const prefix = options.prefix ?? "cclaw-v8-";
  const markers = options.harnessMarkers ?? [".cursor"];
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  for (const marker of markers) {
    await fs.mkdir(path.join(dir, marker), { recursive: true });
  }
  return dir;
}

export async function removeProject(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
