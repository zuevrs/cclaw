import fs from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it, vi } from "vitest";
import {
  configPath,
  detectLanguageRulePacks,
  readConfig,
  writeConfig
} from "../../src/config.js";
import { initCclaw } from "../../src/install.js";
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
  it("throws on malformed yaml instead of silently defaulting", async () => {
    const root = await createTempProject("config-malformed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "::: not valid yaml :::", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/Invalid cclaw config/);
    await expect(readConfig(root)).rejects.toThrow(/failed to parse YAML|top-level config must be a YAML mapping\/object/);
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

  it("parses strictness + git hook settings", async () => {
    const root = await createTempProject("config-strictness-githooks");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nstrictness: strict\ngitHookGuards: true\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.strictness).toBe("strict");
    expect(config.gitHookGuards).toBe(true);
  });

  it("parses tdd test path settings under single strictness knob", async () => {
    const root = await createTempProject("config-tdd-paths");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nstrictness: strict\ntddTestGlobs:\n  - \"**/*.test.ts\"\n",
      "utf8"
    );
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const config = await readConfig(root);
      expect(config.strictness).toBe("strict");
      expect(config.tddTestGlobs).toEqual(["**/*.test.ts"]);
      expect(warningSpy).not.toHaveBeenCalled();
    } finally {
      warningSpy.mockRestore();
    }
  });

  it("parses nested tdd path patterns", async () => {
    const root = await createTempProject("config-tdd-path-patterns");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
tdd:
  testPathPatterns:
    - "**/*.unit.ts"
  productionPathPatterns:
    - "src/**"
`,
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.tdd?.testPathPatterns).toEqual(["**/*.unit.ts"]);
    expect(config.tdd?.productionPathPatterns).toEqual(["src/**"]);
    // Legacy alias stays populated for older callers.
    expect(config.tddTestGlobs).toEqual([
      "**/*.test.*",
      "**/tests/**",
      "**/__tests__/**"
    ]);
  });

  it("lets tdd.testPathPatterns override legacy tddTestGlobs", async () => {
    const root = await createTempProject("config-tdd-override-legacy");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
tddTestGlobs:
  - "**/*.legacy.ts"
tdd:
  testPathPatterns:
    - "**/*.modern.ts"
`,
      "utf8"
    );
    const warningSpy = vi.spyOn(process, "emitWarning").mockImplementation(() => {});
    try {
      const config = await readConfig(root);
      expect(config.tddTestGlobs).toEqual(["**/*.legacy.ts"]);
      expect(config.tdd?.testPathPatterns).toEqual(["**/*.modern.ts"]);
      expect(warningSpy).toHaveBeenCalledWith(
        expect.stringContaining("Both \"tddTestGlobs\" (deprecated) and \"tdd.testPathPatterns\" are set"),
        expect.objectContaining({ code: "CCLAW_CONFIG_DEPRECATED_TDD_TEST_GLOBS" })
      );
    } finally {
      warningSpy.mockRestore();
    }
  });

  it("rejects malformed nested tdd config", async () => {
    const root = await createTempProject("config-tdd-malformed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
tdd:
  testPathPatterns: "**/*.test.ts"
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/"tdd.testPathPatterns" must be an array of strings/);
  });

  it("rejects unknown nested tdd keys", async () => {
    const root = await createTempProject("config-tdd-unknown-key");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
tdd:
  unsupported: true
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/"tdd" has unknown key\(s\): unsupported/);
  });

  it("parses compound recurrence tuning config", async () => {
    const root = await createTempProject("config-compound-recurrence");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
compound:
  recurrenceThreshold: 4
`,
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.compound?.recurrenceThreshold).toBe(4);
  });

  it("rejects malformed compound recurrence config", async () => {
    const root = await createTempProject("config-compound-bad-threshold");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
compound:
  recurrenceThreshold: 0
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(
      /"compound.recurrenceThreshold" must be a positive integer/
    );
  });

  it("rejects unknown compound keys", async () => {
    const root = await createTempProject("config-compound-unknown-key");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
compound:
  mode: aggressive
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/"compound" has unknown key\(s\): mode/);
  });

  it("parses trackHeuristics overrides (triggers + veto + fallback)", async () => {
    const root = await createTempProject("config-track-heuristics");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
trackHeuristics:
  fallback: medium
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
    expect(config.trackHeuristics?.tracks?.quick?.triggers).toEqual(["hotfix"]);
    expect(config.trackHeuristics?.tracks?.quick?.veto).toEqual(["migration"]);
  });

  it("rejects the removed trackHeuristics.priority field", async () => {
    const root = await createTempProject("config-track-priority-removed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
trackHeuristics:
  priority:
    - quick
    - standard
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/no longer supported/);
  });

  it("rejects the removed trackHeuristics.tracks.*.patterns field", async () => {
    const root = await createTempProject("config-track-patterns-removed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
trackHeuristics:
  tracks:
    medium:
      patterns:
        - "^epic:"
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/no longer supported/);
  });

  it("rejects retired guard-mode config keys with a migration hint", async () => {
    const root = await createTempProject("config-retired-guard-keys");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "promptGuardMode: hard\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(
      /promptGuardMode.*were removed; use the single `strictness: advisory\|strict` knob/
    );

    await fs.writeFile(configPath(root), "tddEnforcement: strict\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/tddEnforcement.*were removed/);

    await fs.writeFile(configPath(root), "workflowGuardMode: strict\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/workflowGuardMode.*were removed/);
  });

  it("rejects retired ironLaws.mode with a migration hint", async () => {
    const root = await createTempProject("config-ironlaws-mode-retired");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nironLaws:\n  mode: strict\n",
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(
      /"ironLaws\.mode" was removed.*strictness/
    );
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

  it("parses optInAudits toggles", async () => {
    const root = await createTempProject("config-opt-in-audits");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `harnesses:
  - claude
optInAudits:
  scopePreAudit: true
  staleDiagramAudit: false
`,
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.optInAudits?.scopePreAudit).toBe(true);
    expect(config.optInAudits?.staleDiagramAudit).toBe(false);
  });

  it("rejects malformed optInAudits config", async () => {
    const root = await createTempProject("config-opt-in-audits-malformed");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "optInAudits: true\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/"optInAudits" must be an object/);
  });

  it("rejects unknown optInAudits keys", async () => {
    const root = await createTempProject("config-opt-in-audits-unknown-key");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      `optInAudits:
  staleDiagramAudit: true
  randomAudit: true
`,
      "utf8"
    );
    await expect(readConfig(root)).rejects.toThrow(/"optInAudits" has unknown key\(s\): randomAudit/);
  });

  // -- advisory-by-default: single `strictness` knob ------------------------

  it("strictness=strict is accepted as the single enforcement knob", async () => {
    const root = await createTempProject("config-strictness-strict");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(
      configPath(root),
      "harnesses:\n  - claude\nstrictness: strict\n",
      "utf8"
    );
    const config = await readConfig(root);
    expect(config.strictness).toBe("strict");
  });

  it("strictness defaults to advisory when no knob is provided", async () => {
    const root = await createTempProject("config-strictness-default");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "harnesses:\n  - claude\n", "utf8");
    const config = await readConfig(root);
    expect(config.strictness).toBe("advisory");
  });

  it("rejects invalid strictness values", async () => {
    const root = await createTempProject("config-strictness-bad");
    await fs.mkdir(path.join(root, ".cclaw"), { recursive: true });
    await fs.writeFile(configPath(root), "strictness: paranoid\n", "utf8");
    await expect(readConfig(root)).rejects.toThrow(/"strictness" must be "advisory" or "strict"/);
  });

  // -- v0.43.0: minimal default template --------------------------------

  it("cclaw init writes a minimal config.yaml (no advisory noise)", async () => {
    const root = await createTempProject("config-init-minimal");
    await initCclaw({ projectRoot: root });

    const onDisk = parse(await fs.readFile(configPath(root), "utf8")) as Record<string, unknown>;
    const keys = Object.keys(onDisk).sort();
    // Allowed keys in the minimal default template. `languageRulePacks` is
    // only present when auto-detection found something (not guaranteed for a
    // temp project), so assert it's either absent or a non-empty array.
    const minimalCore = ["flowVersion", "gitHookGuards", "harnesses", "strictness", "version"];
    for (const required of minimalCore) {
      expect(keys).toContain(required);
    }
    const unexpectedAdvanced = [
      "promptGuardMode",
      "tddEnforcement",
      "tddTestGlobs",
      "tdd",
      "compound",
      "defaultTrack",
      "trackHeuristics",
      "sliceReview",
      "optInAudits"
    ];
    for (const advanced of unexpectedAdvanced) {
      expect(keys).not.toContain(advanced);
    }
    if ("languageRulePacks" in onDisk) {
      expect(Array.isArray(onDisk.languageRulePacks)).toBe(true);
      expect((onDisk.languageRulePacks as unknown[]).length).toBeGreaterThan(0);
    }
  });

  // -- v0.43.0: languageRulePacks auto-detect ---------------------------

  it("detectLanguageRulePacks returns [] when no manifest is present", async () => {
    const root = await createTempProject("detect-lang-empty");
    const packs = await detectLanguageRulePacks(root);
    expect(packs).toEqual([]);
  });

  it("detectLanguageRulePacks picks typescript from package.json devDependency", async () => {
    const root = await createTempProject("detect-lang-ts");
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "demo", devDependencies: { typescript: "5.0.0" } }),
      "utf8"
    );
    const packs = await detectLanguageRulePacks(root);
    expect(packs).toContain("typescript");
  });

  it("detectLanguageRulePacks picks python from pyproject.toml", async () => {
    const root = await createTempProject("detect-lang-py");
    await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname='demo'\n", "utf8");
    const packs = await detectLanguageRulePacks(root);
    expect(packs).toContain("python");
  });

  it("detectLanguageRulePacks picks go from go.mod", async () => {
    const root = await createTempProject("detect-lang-go");
    await fs.writeFile(path.join(root, "go.mod"), "module demo\n", "utf8");
    const packs = await detectLanguageRulePacks(root);
    expect(packs).toContain("go");
  });

  it("detectLanguageRulePacks is robust to a malformed package.json", async () => {
    const root = await createTempProject("detect-lang-bad-pkg");
    await fs.writeFile(path.join(root, "package.json"), "{ not json", "utf8");
    const packs = await detectLanguageRulePacks(root);
    expect(packs).toEqual([]);
  });

});
