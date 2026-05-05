import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import {
  classifyCodexHooksFlag,
  codexConfigPath,
  patchCodexHooksFlag
} from "../../src/codex-feature-flag.js";

// These are unit tests for the tiny TOML-surgery module that release
// uses to flip `[features] codex_hooks = true` in `~/.codex/config.toml`
// on behalf of the user. They deliberately do not touch the filesystem;
// the classify/patch pair is pure. The interactive prompt wiring in
// `cli.ts` is covered by the integration tests.

describe("codexConfigPath", () => {
  it("defaults to $HOME/.codex/config.toml when CODEX_HOME is unset", () => {
    const env = { ...process.env };
    delete env.CODEX_HOME;
    expect(codexConfigPath(env)).toBe(path.join(os.homedir(), ".codex/config.toml"));
  });

  it("honors CODEX_HOME when set to a non-empty value", () => {
    const env = { ...process.env, CODEX_HOME: "/tmp/custom-codex" };
    expect(codexConfigPath(env)).toBe(path.join("/tmp/custom-codex", "config.toml"));
  });

  it("treats whitespace-only CODEX_HOME as unset", () => {
    const env = { ...process.env, CODEX_HOME: "   " };
    expect(codexConfigPath(env)).toBe(path.join(os.homedir(), ".codex/config.toml"));
  });
});

describe("classifyCodexHooksFlag", () => {
  it("reports missing-file for null input", () => {
    expect(classifyCodexHooksFlag(null)).toBe("missing-file");
  });

  it("reports missing-section for a non-empty file with no [features]", () => {
    const toml = `# Codex config\nmodel = "gpt-5.1"\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("missing-section");
  });

  it("reports missing-key when [features] exists without codex_hooks", () => {
    const toml = `[features]\nrollout = true\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("missing-key");
  });

  it("reports disabled for explicit false", () => {
    const toml = `[features]\ncodex_hooks = false\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("disabled");
  });

  it("reports disabled for non-boolean non-true values", () => {
    const toml = `[features]\ncodex_hooks = "off"\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("disabled");
  });

  it("reports enabled for true", () => {
    const toml = `[features]\ncodex_hooks = true\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("enabled");
  });

  it("ignores comments when resolving the flag", () => {
    const toml = `[features]\n# codex_hooks = false\ncodex_hooks = true # enable cclaw\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("enabled");
  });

  it("only inspects keys inside the [features] section", () => {
    const toml = `[other]\ncodex_hooks = true\n\n[features]\n# no key here\n`;
    expect(classifyCodexHooksFlag(toml)).toBe("missing-key");
  });
});

describe("patchCodexHooksFlag", () => {
  it("returns unchanged when already enabled", () => {
    const input = `[features]\ncodex_hooks = true\n`;
    const result = patchCodexHooksFlag(input);
    expect(result.changed).toBe(false);
    expect(result.updated).toBe(input);
  });

  it("creates a fresh config when given null", () => {
    const result = patchCodexHooksFlag(null);
    expect(result.changed).toBe(true);
    expect(result.updated).toBe("[features]\ncodex_hooks = true\n");
  });

  it("appends the [features] section to an existing config", () => {
    const input = `model = "gpt-5.1"\n`;
    const result = patchCodexHooksFlag(input);
    expect(result.changed).toBe(true);
    expect(result.updated).toBe(`model = "gpt-5.1"\n\n[features]\ncodex_hooks = true\n`);
  });

  it("inserts the key under an existing empty [features] section", () => {
    const input = `[features]\n`;
    const result = patchCodexHooksFlag(input);
    expect(result.changed).toBe(true);
    expect(result.updated).toBe(`[features]\ncodex_hooks = true\n`);
  });

  it("inserts the key immediately after the [features] header when another section follows", () => {
    const input = `[features]\nrollout = true\n\n[other]\nkey = 1\n`;
    const result = patchCodexHooksFlag(input);
    expect(result.changed).toBe(true);
    // The existing `rollout = true` line must survive; codex_hooks is
    // placed before the next section header so it stays in [features].
    expect(result.updated).toContain("[features]\nrollout = true\ncodex_hooks = true");
    expect(result.updated).toContain("[other]\nkey = 1");
  });

  it("rewrites an existing non-true value in place", () => {
    const input = `[features]\ncodex_hooks = false # was disabled\n`;
    const result = patchCodexHooksFlag(input);
    expect(result.changed).toBe(true);
    expect(result.updated).toBe(`[features]\ncodex_hooks = true\n`);
  });

  it("preserves indentation when rewriting", () => {
    const input = `[features]\n  codex_hooks = false\n`;
    const result = patchCodexHooksFlag(input);
    expect(result.updated).toBe(`[features]\n  codex_hooks = true\n`);
  });
});
