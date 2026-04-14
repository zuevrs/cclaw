import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "../../src/config.js";
describe("config", () => {
  it("keeps explicit empty harness list", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-config-empty-"));
    await writeConfig(root, {
      version: "0.1.0",
      flowVersion: "1.0.0",
      harnesses: []
    });
    const config = await readConfig(root);
    expect(config.harnesses).toEqual([]);
  });
  it("falls back to defaults on malformed yaml", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-config-malformed-"));
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "::: not valid yaml :::", "utf8");
    const config = await readConfig(root);
    expect(config.harnesses.length).toBeGreaterThan(0);
  });
  it("rejects invalid harness ids instead of silently defaulting", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-config-invalid-"));
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "harnesses:\n  - claud\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/unknown harness id/);
    await expect(readConfig(root)).rejects.toThrow(/Supported harnesses: claude, cursor, opencode, codex/);
    await expect(readConfig(root)).rejects.toThrow(/After fixing, run: cclaw sync/);
  });
  it("rejects non-array harnesses with remediation guidance", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-config-invalid-shape-"));
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "harnesses: claude\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/"harnesses" must be an array/);
    await expect(readConfig(root)).rejects.toThrow(/Example config:/);
  });

  it("rejects unknown top-level config keys", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-config-unknown-key-"));
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nsurpriseMode: true\n",
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/unknown top-level key\(s\): surpriseMode/);
  });
});
