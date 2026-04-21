import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { detectPublicApiChanges } from "../../src/internal/detect-public-api-changes.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

const execFileAsync = promisify(execFile);

async function git(projectRoot: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd: projectRoot });
}

async function commitAll(projectRoot: string, message: string): Promise<void> {
  await git(projectRoot, ["add", "."]);
  await git(projectRoot, [
    "-c",
    "user.name=cclaw-test",
    "-c",
    "user.email=cclaw-test@example.com",
    "commit",
    "-m",
    message
  ]);
}

describe("detectPublicApiChanges", () => {
  it("returns false when repo has no HEAD~1", async () => {
    const root = await createTempProject("public-api-no-head-prev");
    await git(root, ["init"]);
    await writeProjectFile(root, "README.md", "first\n");
    await commitAll(root, "init");

    await expect(detectPublicApiChanges(root)).resolves.toEqual({
      triggered: false,
      changedFiles: []
    });
  });

  it("detects public-surface file changes between HEAD~1 and HEAD", async () => {
    const root = await createTempProject("public-api-hit");
    await git(root, ["init"]);
    await writeProjectFile(root, "src/config.ts", "export const A = 1;\n");
    await commitAll(root, "initial");
    await writeProjectFile(root, "src/config.ts", "export const A = 2;\n");
    await commitAll(root, "touch config");

    const result = await detectPublicApiChanges(root);
    expect(result.triggered).toBe(true);
    expect(result.changedFiles).toContain("src/config.ts");
  });

  it("ignores non-public file changes", async () => {
    const root = await createTempProject("public-api-noise");
    await git(root, ["init"]);
    await writeProjectFile(root, "src/private-worker.ts", "export const x = 1;\n");
    await commitAll(root, "initial");
    await writeProjectFile(root, "src/private-worker.ts", "export const x = 2;\n");
    await commitAll(root, "private tweak");

    const result = await detectPublicApiChanges(root);
    expect(result).toEqual({
      triggered: false,
      changedFiles: []
    });
  });

  it("returns false when called outside of a git repository", async () => {
    const root = await createTempProject("public-api-not-git");
    await writeProjectFile(root, "src/config.ts", "export const y = 1;\n");
    await expect(detectPublicApiChanges(root)).resolves.toEqual({
      triggered: false,
      changedFiles: []
    });
  });
});

describe("detectPublicApiChanges command-error fallback", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unmock("node:child_process");
  });

  it("returns false when git diff fails after base is resolved", async () => {
    vi.doMock("node:child_process", () => ({
      execFile: (
        _command: string,
        args: string[],
        _options: unknown,
        callback: (error: Error | null, stdout?: string, stderr?: string) => void
      ) => {
        if (args[0] === "rev-parse") {
          callback(null, "base-sha\n", "");
          return;
        }
        callback(new Error("diff failed"), "", "");
      }
    }));

    const mod = await import("../../src/internal/detect-public-api-changes.js");
    const result = await mod.detectPublicApiChanges("/tmp/irrelevant");
    expect(result).toEqual({
      triggered: false,
      changedFiles: []
    });
  });
});
