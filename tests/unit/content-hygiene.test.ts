import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * Content hygiene lints — prevent the two classes of rot we cleaned in the
 * v8.113 simplification pass from creeping back:
 *
 *   1. ORPHAN SKILLS — a `src/content/skills/<x>.md` file that no
 *      `AUTO_TRIGGER_SKILLS` entry registers (dead weight the build copies
 *      but nothing installs), or a registration pointing at a missing file.
 *   2. DEAD CONFIG — a `CclawConfig` field declared in the type but
 *      referenced nowhere (neither read by TS nor surfaced in any
 *      agent-facing string). Every knob must be live or documented.
 */

const repoRoot = process.cwd();

describe("content hygiene — no orphan skills", () => {
  const skillsDir = path.resolve(repoRoot, "src/content/skills");
  const filesOnDisk = readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
  const registeredFiles = AUTO_TRIGGER_SKILLS.map((s) => s.fileName);

  it("every skill .md on disk is registered in AUTO_TRIGGER_SKILLS", () => {
    for (const file of filesOnDisk) {
      expect(
        registeredFiles,
        `${file} sits in src/content/skills/ but no AUTO_TRIGGER_SKILLS entry registers it. ` +
          `Register it (with a gate or stage), or delete the orphan file.`
      ).toContain(file);
    }
  });

  it("every AUTO_TRIGGER_SKILLS registration points at a file that exists", () => {
    for (const file of registeredFiles) {
      expect(
        filesOnDisk,
        `AUTO_TRIGGER_SKILLS registers ${file} but src/content/skills/${file} does not exist.`
      ).toContain(file);
    }
  });

  it("skill ids are unique (no duplicate registration)", () => {
    const ids = AUTO_TRIGGER_SKILLS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("content hygiene — no dead config keys", () => {
  /**
   * Registry of every `CclawConfig` field (top-level + nested-block leaf
   * knobs). Adding a config field? Add it here too. Each must be referenced
   * somewhere in `src/` outside `config.ts` — either read by TS, or named in
   * an agent-facing prompt/runbook/template string (LLM-read knobs).
   */
  const CONFIG_KEYS = [
    "flowVersion",
    "legacyArtifacts",
    "modelPreferences",
    "compoundRefreshEvery",
    "compoundRefreshFloor",
    "captureLearningsBypass",
    "ambiguity_threshold",
    "cross_model",
    "cross_model_min_context"
  ];

  const srcDir = path.resolve(repoRoot, "src");
  const configFile = path.resolve(srcDir, "config.ts");

  const collect = (dir: string): string[] => {
    const out: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...collect(full));
      else if ((full.endsWith(".ts") || full.endsWith(".md")) && full !== configFile) out.push(full);
    }
    return out;
  };

  const corpus = collect(srcDir)
    .map((f) => readFileSync(f, "utf8"))
    .join("\n");

  it.each(CONFIG_KEYS)("config key `%s` is referenced outside config.ts (not dead)", (key) => {
    expect(
      corpus.includes(key),
      `CclawConfig declares \`${key}\` but nothing outside config.ts references it. ` +
        `Either wire/document it, or remove the dead field (and drop it from CONFIG_KEYS here).`
    ).toBe(true);
  });
});
