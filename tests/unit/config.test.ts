import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { configPath, readConfig, writeConfig } from "../../src/config.js";
import { createTempProject } from "../helpers/index.js";
describe("config", () => {
  it("keeps explicit empty harness list", async () => {
    const root = await createTempProject("config-empty");
    await writeConfig(root, {
      version: "0.1.0",
      flowVersion: "1.0.0",
      harnesses: []
    });
    const config = await readConfig(root);
    expect(config.harnesses).toEqual([]);
  });
  it("falls back to defaults on malformed yaml", async () => {
    const root = await createTempProject("config-malformed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "::: not valid yaml :::", "utf8");
    const config = await readConfig(root);
    expect(config.harnesses.length).toBeGreaterThan(0);
  });
  it("rejects invalid harness ids instead of silently defaulting", async () => {
    const root = await createTempProject("config-invalid");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "harnesses:\n  - claud\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/unknown harness id/);
    await expect(readConfig(root)).rejects.toThrow(/Supported harnesses: claude, cursor, opencode, codex/);
    await expect(readConfig(root)).rejects.toThrow(/After fixing, run: cclaw sync/);
  });
  it("rejects non-array harnesses with remediation guidance", async () => {
    const root = await createTempProject("config-invalid-shape");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "harnesses: claude\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/"harnesses" must be an array/);
    await expect(readConfig(root)).rejects.toThrow(/Example config:/);
  });

  it("rejects unknown top-level config keys", async () => {
    const root = await createTempProject("config-unknown-key");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nsurpriseMode: true\n",
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/unknown top-level key\(s\): surpriseMode/);
  });

  it("defaults defaultTrack to standard when not specified", async () => {
    const root = await createTempProject("config-default-track");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "harnesses:\n  - claude\n", "utf8");
    const config = await readConfig(root);
    expect(config.defaultTrack).toBe("standard");
  });

  it("accepts defaultTrack=quick", async () => {
    const root = await createTempProject("config-quick-track");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\ndefaultTrack: quick\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.defaultTrack).toBe("quick");
  });

  it("accepts defaultTrack=medium", async () => {
    const root = await createTempProject("config-medium-track");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\ndefaultTrack: medium\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.defaultTrack).toBe("medium");
  });

  it("rejects unknown defaultTrack values with remediation guidance", async () => {
    const root = await createTempProject("config-bad-track");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\ndefaultTrack: turbo\n",
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/"defaultTrack" must be one of: quick, medium, standard/);
    await expect(readConfig(root)).rejects.toThrow(/Supported tracks: quick, medium, standard/);
  });

  it("parses prompt guard and git hook settings", async () => {
    const root = await createTempProject("config-global-learnings");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\npromptGuardMode: strict\ngitHookGuards: true\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.promptGuardMode).toBe("strict");
    expect(config.gitHookGuards).toBe(true);
  });

  it("parses tdd enforcement settings", async () => {
    const root = await createTempProject("config-tdd-enforcement");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\ntddEnforcement: strict\ntddTestGlobs:\n  - \"**/*.test.ts\"\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.tddEnforcement).toBe("strict");
    expect(config.tddTestGlobs).toEqual(["**/*.test.ts"]);
  });

  it("parses trackHeuristics overrides", async () => {
    const root = await createTempProject("config-track-heuristics");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
trackHeuristics:
  fallback: medium
  priority:
    - quick
    - medium
  tracks:
    quick:
      triggers:
        - hotfix
      veto:
        - migration
`,
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.trackHeuristics?.fallback).toBe("medium");
    expect(config.trackHeuristics?.priority).toEqual(["quick", "medium"]);
    expect(config.trackHeuristics?.tracks?.quick?.triggers).toEqual(["hotfix"]);
    expect(config.trackHeuristics?.tracks?.quick?.veto).toEqual(["migration"]);
  });

  it("rejects invalid regex in trackHeuristics patterns", async () => {
    const root = await createTempProject("config-track-pattern-invalid");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
trackHeuristics:
  tracks:
    medium:
      patterns:
        - "(unclosed"
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/invalid regex/);
  });

  it("rejects invalid prompt guard modes", async () => {
    const root = await createTempProject("config-invalid-guard-mode");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "promptGuardMode: hard\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/"promptGuardMode" must be "advisory" or "strict"/);
  });

  it("parses sliceReview with sane defaults when enabled", async () => {
    const root = await createTempProject("config-slice-review");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
sliceReview:
  enabled: true
  filesChangedThreshold: 8
  touchTriggers:
    - "migrations/**"
    - "auth/**"
  enforceOnTracks:
    - standard
    - medium
`,
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.sliceReview?.enabled).toBe(true);
    expect(config.sliceReview?.filesChangedThreshold).toBe(8);
    expect(config.sliceReview?.touchTriggers).toEqual(["migrations/**", "auth/**"]);
    expect(config.sliceReview?.enforceOnTracks).toEqual(["standard", "medium"]);
  });

  it("fills sliceReview defaults when only enabled: true is provided", async () => {
    const root = await createTempProject("config-slice-review-defaults");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
sliceReview:
  enabled: true
`,
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.sliceReview?.enabled).toBe(true);
    expect(config.sliceReview?.filesChangedThreshold).toBe(5);
    expect(config.sliceReview?.touchTriggers).toEqual([]);
    expect(config.sliceReview?.enforceOnTracks).toEqual(["standard"]);
  });

  it("rejects non-integer or non-positive sliceReview.filesChangedThreshold", async () => {
    const root = await createTempProject("config-slice-review-bad-threshold");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
sliceReview:
  filesChangedThreshold: 0
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/must be a positive integer/);
  });

  it("rejects unknown track in sliceReview.enforceOnTracks", async () => {
    const root = await createTempProject("config-slice-review-bad-track");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
sliceReview:
  enforceOnTracks:
    - legendary
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/must contain only/);
  });

});
