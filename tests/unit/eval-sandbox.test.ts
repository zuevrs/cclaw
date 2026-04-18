import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandbox, SandboxEscapeError } from "../../src/eval/sandbox.js";

async function mkProjectRoot(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), `cclaw-sandbox-${prefix}-`));
  return dir;
}

describe("createSandbox", () => {
  let projectRoot: string;
  let baseDir: string;

  beforeEach(async () => {
    projectRoot = await mkProjectRoot("proj");
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-sandbox-base-"));
  });

  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("creates an isolated directory and disposes cleanly", async () => {
    const sandbox = await createSandbox({ projectRoot, baseDir, idOverride: "abc" });
    const expected = await fs.realpath(path.join(baseDir, "cclaw-eval-abc"));
    expect(sandbox.root).toBe(expected);
    await fs.writeFile(path.join(sandbox.root, "hello.txt"), "hi", "utf8");
    await sandbox.dispose();
    await expect(fs.stat(sandbox.root)).rejects.toThrow();
  });

  it("seeds context files relative to the project root, preserving subdirectories", async () => {
    const srcDir = path.join(projectRoot, ".cclaw/skills/brainstorming");
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(path.join(srcDir, "SKILL.md"), "# skill\n", "utf8");
    await fs.writeFile(path.join(projectRoot, "README.md"), "# readme\n", "utf8");

    const sandbox = await createSandbox({
      projectRoot,
      baseDir,
      idOverride: "ctx",
      contextFiles: [".cclaw/skills/brainstorming/SKILL.md", "README.md"]
    });

    const copiedSkill = path.join(
      sandbox.root,
      ".cclaw/skills/brainstorming/SKILL.md"
    );
    const copiedReadme = path.join(sandbox.root, "README.md");
    expect(await fs.readFile(copiedSkill, "utf8")).toBe("# skill\n");
    expect(await fs.readFile(copiedReadme, "utf8")).toBe("# readme\n");
    await sandbox.dispose();
  });

  it("rejects absolute and parent-escape paths", async () => {
    const sandbox = await createSandbox({ projectRoot, baseDir, idOverride: "escape" });
    await expect(sandbox.resolve("/etc/passwd")).rejects.toBeInstanceOf(SandboxEscapeError);
    await expect(sandbox.resolve("../../../etc/passwd")).rejects.toBeInstanceOf(
      SandboxEscapeError
    );
    await expect(sandbox.resolve("")).rejects.toBeInstanceOf(SandboxEscapeError);
    await sandbox.dispose();
  });

  it("rejects paths that realpath out of the sandbox via symlink", async () => {
    const sandbox = await createSandbox({ projectRoot, baseDir, idOverride: "sym" });
    const outsideDir = path.join(baseDir, "outside");
    await fs.mkdir(outsideDir, { recursive: true });
    await fs.writeFile(path.join(outsideDir, "secrets.txt"), "hunter2", "utf8");
    await fs.symlink(outsideDir, path.join(sandbox.root, "link"));
    await expect(sandbox.resolve("link/secrets.txt")).rejects.toBeInstanceOf(
      SandboxEscapeError
    );
    await sandbox.dispose();
  });

  it("allows resolve() on a missing file when allowMissing=true for writes", async () => {
    const sandbox = await createSandbox({ projectRoot, baseDir, idOverride: "mk" });
    const absolute = await sandbox.resolve("drafts/artifact.md", { allowMissing: true });
    expect(absolute.startsWith(sandbox.root)).toBe(true);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, "hello", "utf8");
    expect(await fs.readFile(absolute, "utf8")).toBe("hello");
    await sandbox.dispose();
  });

  it("refuses context_files that escape the project root", async () => {
    await fs.writeFile(path.join(path.dirname(projectRoot), "secret.txt"), "x", "utf8");
    await expect(
      createSandbox({
        projectRoot,
        baseDir,
        idOverride: "ctx-escape",
        contextFiles: ["../secret.txt"]
      })
    ).rejects.toThrow(/outside the project/);
  });
});
