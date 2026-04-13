import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureGitignore } from "../../src/gitignore.js";

describe("gitignore patcher", () => {
  it("is idempotent", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-gitignore-"));
    const gitignore = path.join(root, ".gitignore");
    await fs.writeFile(gitignore, "node_modules/\n", "utf8");

    await ensureGitignore(root);
    const once = await fs.readFile(gitignore, "utf8");
    await ensureGitignore(root);
    const twice = await fs.readFile(gitignore, "utf8");

    expect(once).toBe(twice);
    expect(twice).toContain(".cclaw/");
  });
});
