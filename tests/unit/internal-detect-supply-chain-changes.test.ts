import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { detectSupplyChainChanges } from "../../src/internal/detect-supply-chain-changes.js";
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

describe("detectSupplyChainChanges", () => {
  it("flags package.json dependency additions", async () => {
    const root = await createTempProject("supply-chain-deps-add");
    await git(root, ["init"]);
    await writeProjectFile(
      root,
      "package.json",
      JSON.stringify({ name: "x", version: "0.0.0", dependencies: { foo: "1.0.0" } }, null, 2) + "\n"
    );
    await commitAll(root, "init");
    await writeProjectFile(
      root,
      "package.json",
      JSON.stringify(
        { name: "x", version: "0.0.0", dependencies: { foo: "1.0.0", bar: "2.0.0" } },
        null,
        2
      ) + "\n"
    );
    await commitAll(root, "add bar dep");

    const result = await detectSupplyChainChanges(root);
    expect(result.triggered).toBe(true);
    expect(result.changedFiles).toContain("package.json");
    expect(result.reasons.join(" ")).toMatch(/dependencies/u);
  });

  it("ignores package.json edits that do not touch dependency keys", async () => {
    const root = await createTempProject("supply-chain-noise");
    await git(root, ["init"]);
    await writeProjectFile(
      root,
      "package.json",
      JSON.stringify(
        { name: "x", version: "0.0.0", scripts: { test: "vitest" }, dependencies: { foo: "1.0.0" } },
        null,
        2
      ) + "\n"
    );
    await commitAll(root, "init");
    await writeProjectFile(
      root,
      "package.json",
      JSON.stringify(
        {
          name: "x",
          version: "0.0.1",
          scripts: { test: "vitest --run" },
          dependencies: { foo: "1.0.0" }
        },
        null,
        2
      ) + "\n"
    );
    await commitAll(root, "bump version + script");

    const result = await detectSupplyChainChanges(root);
    expect(result.triggered).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
  });

  it("flags GitHub workflow changes", async () => {
    const root = await createTempProject("supply-chain-workflows");
    await git(root, ["init"]);
    await writeProjectFile(root, ".github/workflows/ci.yml", "name: ci\non: [push]\njobs: {}\n");
    await commitAll(root, "init");
    await writeProjectFile(
      root,
      ".github/workflows/ci.yml",
      "name: ci\non: [push, pull_request]\njobs: {}\n"
    );
    await commitAll(root, "tweak triggers");

    const result = await detectSupplyChainChanges(root);
    expect(result.triggered).toBe(true);
    expect(result.changedFiles).toContain(".github/workflows/ci.yml");
  });

  it("flags .cursor config changes", async () => {
    const root = await createTempProject("supply-chain-cursor");
    await git(root, ["init"]);
    await writeProjectFile(root, ".cursor/rules/example.mdc", "old\n");
    await commitAll(root, "init");
    await writeProjectFile(root, ".cursor/rules/example.mdc", "new\n");
    await commitAll(root, "edit cursor rule");

    const result = await detectSupplyChainChanges(root);
    expect(result.triggered).toBe(true);
    expect(result.changedFiles).toContain(".cursor/rules/example.mdc");
  });

  it("returns false when no supply-chain files changed", async () => {
    const root = await createTempProject("supply-chain-no-change");
    await git(root, ["init"]);
    await writeProjectFile(root, "src/app.ts", "export const a = 1;\n");
    await commitAll(root, "init");
    await writeProjectFile(root, "src/app.ts", "export const a = 2;\n");
    await commitAll(root, "tweak app");

    const result = await detectSupplyChainChanges(root);
    expect(result.triggered).toBe(false);
    expect(result.changedFiles).toHaveLength(0);
  });

  it("returns false when repo has no HEAD~1", async () => {
    const root = await createTempProject("supply-chain-no-prev");
    await git(root, ["init"]);
    await writeProjectFile(root, "package.json", '{"name":"x"}\n');
    await commitAll(root, "init");

    await expect(detectSupplyChainChanges(root)).resolves.toEqual({
      triggered: false,
      changedFiles: [],
      reasons: []
    });
  });
});
