import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

describe("slice-commit managed mode", () => {
  it("creates a per-slice commit for claimed paths", async () => {
    const root = await createTempProject("slice-commit-managed");
    await git(root, ["init"]);
    await git(root, ["config", "user.email", "tests@example.com"]);
    await git(root, ["config", "user.name", "Test Runner"]);
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src/slice.ts"), "export const v = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "src/outside.ts"), "export const x = 1;\n", "utf8");
    await git(root, ["add", "."]);
    await git(root, ["commit", "-m", "init"]);

    await fs.writeFile(path.join(root, "src/slice.ts"), "export const v = 2;\n", "utf8");

    const script = path.join(root, ".cclaw/hooks/slice-commit.mjs");
    const { stdout } = await execFileAsync(
      process.execPath,
      [
        script,
        "--json",
        "--slice=S-1",
        "--span-id=span-S-1",
        "--task-id=T-1",
        "--title=close slice S-1",
        "--claimed-paths=src/slice.ts"
      ],
      { cwd: root }
    );
    const payload = JSON.parse(stdout.trim()) as {
      ok?: boolean;
      commitSha?: string;
    };
    expect(payload.ok).toBe(true);
    expect(typeof payload.commitSha).toBe("string");
    expect(payload.commitSha?.length).toBeGreaterThanOrEqual(7);

    const subject = await git(root, ["log", "-1", "--pretty=%s"]);
    expect(subject).toContain("S-1/T-1:");

    const changedFiles = await git(root, ["show", "--name-only", "--pretty=format:", "HEAD"]);
    const files = changedFiles
      .split(/\r?\n/gu)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    expect(files).toContain("src/slice.ts");
    expect(files).not.toContain("src/outside.ts");
  });
});

