import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createTempProject,
  writeProjectFile,
  readProjectFile,
  projectPathExists
} from "../helpers/index.js";

describe("test helpers", () => {
  it("createTempProject creates a unique directory under os.tmpdir() with the given tag", async () => {
    const a = await createTempProject("helper-self-test");
    const b = await createTempProject("helper-self-test");
    expect(a).not.toBe(b);
    const aStat = await fs.stat(a);
    const bStat = await fs.stat(b);
    expect(aStat.isDirectory()).toBe(true);
    expect(bStat.isDirectory()).toBe(true);
    expect(a.startsWith(os.tmpdir())).toBe(true);
    expect(path.basename(a).startsWith("cclaw-helper-self-test-")).toBe(true);
  });

  it("createTempProject sanitizes unsafe characters in the tag", async () => {
    const dir = await createTempProject("weird/tag name!");
    expect(path.basename(dir)).toMatch(/^cclaw-weird-tag-name--[A-Za-z0-9]+$/);
  });

  it("writeProjectFile creates parent dirs and projectPathExists/readProjectFile round-trip", async () => {
    const root = await createTempProject("helper-io");
    const written = await writeProjectFile(root, "nested/deep/file.txt", "hello world");
    expect(written).toBe(path.join(root, "nested/deep/file.txt"));
    expect(await projectPathExists(root, "nested/deep/file.txt")).toBe(true);
    expect(await projectPathExists(root, "nested/missing.txt")).toBe(false);
    expect(await readProjectFile(root, "nested/deep/file.txt")).toBe("hello world");
  });
});
