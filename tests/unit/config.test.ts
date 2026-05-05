import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "../../src/config.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

describe("config", () => {
  it("defaults to harness-only config when file is missing", async () => {
    const root = await createTempProject("config-default-minimal");
    const config = await readConfig(root);
    expect(config.harnesses.length).toBeGreaterThan(0);
    expect(config.version.length).toBeGreaterThan(0);
    expect(config.flowVersion.length).toBeGreaterThan(0);
  });

  it("rejects explicit empty harness list", async () => {
    const root = await createTempProject("config-empty");
    await writeConfig(root, {
      version: "0.1.0",
      flowVersion: "1.0.0",
      harnesses: []
    });
    await expect(readConfig(root)).rejects.toThrow(/"harnesses" must include at least one harness/);
  });

  it("rejects unknown top-level config keys with migration hint", async () => {
    const root = await createTempProject("config-unknown-key");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nsurpriseMode: true\n",
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(
      /no longer supported in cclaw 3.0.0; see CHANGELOG\.md/
    );
  });

  it("throws on malformed yaml instead of silently defaulting", async () => {
    const root = await createTempProject("config-malformed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "::: not valid yaml :::", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/Invalid cclaw config/);
    await expect(readConfig(root)).rejects.toThrow(
      /failed to parse YAML|top-level config must be a YAML mapping\/object/
    );
  });

  it("reads explicit tdd.commitMode from config", async () => {
    const root = await createTempProject("config-commit-mode-explicit");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\ntdd:\n  commitMode: checkpoint-only\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.tdd?.commitMode).toBe("checkpoint-only");
  });

  it("rejects invalid tdd.commitMode values", async () => {
    const root = await createTempProject("config-commit-mode-invalid");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\ntdd:\n  commitMode: fast-and-loose\n",
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/tdd\.commitMode/);
  });

  it("cclaw init writes harnesses + version stamps + tdd defaults", async () => {
    const root = await createTempProject("config-init-minimal");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    const raw = await fs.readFile(configPath(root), "utf8");
    const parsed = parse(raw) as Record<string, unknown>;
    expect(Object.keys(parsed).sort()).toEqual(["flowVersion", "harnesses", "tdd", "version"]);
    expect(parsed.harnesses).toEqual(["claude"]);
    expect(parsed.tdd).toEqual({ commitMode: "managed-per-slice" });
  });
});
