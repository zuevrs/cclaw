import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ensureDir, exists, listMarkdownFiles, listSubdirs, readJsonIfExists, removePath, writeFileSafe } from "../../src/fs-utils.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("fs-utils", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("writeFileSafe writes and creates parent dir", async () => {
    project = await createTempProject();
    await writeFileSafe(path.join(project, "a/b/c.txt"), "hello");
    expect(await exists(path.join(project, "a/b/c.txt"))).toBe(true);
  });

  it("readJsonIfExists returns null when file missing", async () => {
    project = await createTempProject();
    expect(await readJsonIfExists(path.join(project, "missing.json"))).toBeNull();
  });

  it("listMarkdownFiles lists *.md only", async () => {
    project = await createTempProject();
    await ensureDir(path.join(project, "x"));
    await writeFileSafe(path.join(project, "x", "a.md"), "a");
    await writeFileSafe(path.join(project, "x", "b.txt"), "b");
    const md = await listMarkdownFiles(path.join(project, "x"));
    expect(md.map((entry) => path.basename(entry))).toEqual(["a.md"]);
  });

  it("listSubdirs returns immediate child dirs", async () => {
    project = await createTempProject();
    await ensureDir(path.join(project, "y", "z"));
    const subs = await listSubdirs(project);
    expect(subs.map((entry) => path.basename(entry))).toContain("y");
  });

  it("removePath is idempotent", async () => {
    project = await createTempProject();
    await removePath(path.join(project, "missing"));
    expect(await exists(path.join(project, "missing"))).toBe(false);
  });
});
