import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSandbox, type Sandbox } from "../../src/eval/sandbox.js";
import {
  BUILTIN_TOOLS,
  toolsByName,
  toolsForRequest
} from "../../src/eval/tools/index.js";
import { readTool } from "../../src/eval/tools/read.js";
import { writeTool } from "../../src/eval/tools/write.js";
import { globTool } from "../../src/eval/tools/glob.js";
import { grepTool } from "../../src/eval/tools/grep.js";
import type { ToolContext } from "../../src/eval/tools/types.js";

describe("sandbox tool registry", () => {
  it("advertises unique names and the OpenAI function wire format", () => {
    const names = BUILTIN_TOOLS.map((t) => t.descriptor.name).sort();
    expect(names).toEqual(["glob", "grep", "read_file", "write_file"]);
    const map = toolsByName();
    expect(map.size).toBe(4);
    const body = toolsForRequest() as Array<{
      type: string;
      function: { name: string; parameters: { type: string } };
    }>;
    expect(body.every((entry) => entry.type === "function")).toBe(true);
    expect(body.every((entry) => entry.function.parameters.type === "object")).toBe(
      true
    );
  });

  it("rejects duplicate tool names in a custom list", () => {
    expect(() => toolsByName([readTool, readTool])).toThrow(/duplicate tool name/);
  });
});

describe("sandbox tool invocations", () => {
  let projectRoot: string;
  let baseDir: string;
  let sandbox: Sandbox;
  let ctx: ToolContext;

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tools-proj-"));
    baseDir = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-tools-base-"));
    sandbox = await createSandbox({ projectRoot, baseDir, idOverride: "t" });
    ctx = { sandbox, maxResultBytes: 4 * 1024 };
    await fs.mkdir(path.join(sandbox.root, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(sandbox.root, "docs/guide.md"),
      ["# Guide", "", "alpha TODO", "beta", "alpha"].join("\n"),
      "utf8"
    );
    await fs.writeFile(path.join(sandbox.root, "README.md"), "hello\nworld\n", "utf8");
  });

  afterEach(async () => {
    await sandbox.dispose();
    await fs.rm(projectRoot, { recursive: true, force: true });
    await fs.rm(baseDir, { recursive: true, force: true });
  });

  it("read_file returns the requested slice and marks truncation", async () => {
    const short = await readTool.invoke(
      JSON.stringify({ path: "README.md" }),
      ctx
    );
    if (!short.ok) throw new Error("expected success");
    expect(short.content).toContain("hello");
    expect(short.details?.bytes).toBeGreaterThan(0);

    const sliced = await readTool.invoke(
      JSON.stringify({ path: "docs/guide.md", offset: 3, limit: 1 }),
      ctx
    );
    if (!sliced.ok) throw new Error("expected success");
    expect(sliced.content.trim()).toBe("alpha TODO");
    expect(sliced.details?.lines).toBe(1);
  });

  it("read_file denies escape attempts and reports deniedPath", async () => {
    const denied = await readTool.invoke(
      JSON.stringify({ path: "../outside.txt" }),
      ctx
    );
    if (denied.ok) throw new Error("expected denial");
    expect(denied.details?.deniedPath).toBe("../outside.txt");
    expect(denied.error).toMatch(/outside the sandbox|realpath/);
  });

  it("read_file rejects malformed arguments", async () => {
    const missing = await readTool.invoke("", ctx);
    expect(missing.ok).toBe(false);
    const wrongType = await readTool.invoke(
      JSON.stringify({ path: 123 }),
      ctx
    );
    expect(wrongType.ok).toBe(false);
    const badOffset = await readTool.invoke(
      JSON.stringify({ path: "README.md", offset: -1 }),
      ctx
    );
    expect(badOffset.ok).toBe(false);
  });

  it("write_file creates parents and writes payload", async () => {
    const result = await writeTool.invoke(
      JSON.stringify({
        path: "build/artifact.md",
        content: "# artifact\n"
      }),
      ctx
    );
    if (!result.ok) throw new Error(`expected success, got: ${result.error}`);
    const written = await fs.readFile(
      path.join(sandbox.root, "build/artifact.md"),
      "utf8"
    );
    expect(written).toBe("# artifact\n");
    expect(result.details?.bytes).toBe(Buffer.byteLength("# artifact\n"));
  });

  it("write_file refuses to escape via absolute path", async () => {
    const denied = await writeTool.invoke(
      JSON.stringify({ path: "/tmp/pwn.txt", content: "pwn" }),
      ctx
    );
    if (denied.ok) throw new Error("expected denial");
    expect(denied.details?.deniedPath).toBe("/tmp/pwn.txt");
  });

  it("write_file enforces per-invocation content ceiling", async () => {
    const overflow = await writeTool.invoke(
      JSON.stringify({
        path: "large.bin",
        content: "x".repeat(ctx.maxResultBytes * 4 + 1)
      }),
      ctx
    );
    expect(overflow.ok).toBe(false);
    expect((overflow as { error: string }).error).toMatch(/exceeds per-invocation ceiling/);
  });

  it("glob matches nested patterns and sorts results", async () => {
    const result = await globTool.invoke(
      JSON.stringify({ pattern: "**/*.md" }),
      ctx
    );
    if (!result.ok) throw new Error("expected success");
    const normalized = result.content.replace(/\\/gu, "/");
    expect(normalized).toContain("README.md");
    expect(normalized).toContain("docs/guide.md");
  });

  it("glob returns (no matches) when nothing matches", async () => {
    const result = await globTool.invoke(
      JSON.stringify({ pattern: "*.nope" }),
      ctx
    );
    if (!result.ok) throw new Error("expected success");
    expect(result.content).toBe("(no matches)");
  });

  it("grep returns path:line:text hits and respects maxMatches", async () => {
    const result = await grepTool.invoke(
      JSON.stringify({ pattern: "alpha", maxMatches: 2 }),
      ctx
    );
    if (!result.ok) throw new Error("expected success");
    const hits = result.content.split("\n");
    expect(hits).toHaveLength(2);
    expect(hits[0].replace(/\\/gu, "/")).toMatch(/docs\/guide\.md:\d+:alpha/);
  });

  it("grep rejects invalid regex", async () => {
    const bad = await grepTool.invoke(
      JSON.stringify({ pattern: "(" }),
      ctx
    );
    expect(bad.ok).toBe(false);
  });

  it("grep is case-insensitive when opted in", async () => {
    const hits = await grepTool.invoke(
      JSON.stringify({ pattern: "HELLO", caseInsensitive: true }),
      ctx
    );
    if (!hits.ok) throw new Error("expected success");
    expect(hits.content).toMatch(/README\.md:\d+:hello/);
  });
});
