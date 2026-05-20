import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = join(__dirname, "..", "..");

/**
 * v8.109 — README `## Configuration` expanded to a full table covering
 * every documented knob in `src/config.ts`. Pre-v8.109 the section was
 * a 6-line snippet that named 3 of 9 knobs and silently dropped the
 * rest (e.g. `clarify.ambiguity_threshold`, `compoundRefreshEvery`,
 * `legacyArtifacts`, …).
 */
describe("v8.109 — README ## Configuration table covers every knob", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
  const configIdx = readme.indexOf("## Configuration");
  const nextSectionIdx = readme.indexOf("\n## ", configIdx + 1);
  const section = readme.slice(configIdx, nextSectionIdx > 0 ? nextSectionIdx : undefined);

  it("section starts with a markdown table header", () => {
    expect(section).toMatch(/\| Knob \| Default \| Purpose \|/u);
    expect(section).toMatch(/\| --- \| --- \| --- \|/u);
  });

  it("documents every knob from src/config.ts", () => {
    const required = [
      "harnesses",
      "legacyArtifacts",
      "compoundRefreshEvery",
      "compoundRefreshFloor",
      "captureLearningsBypass",
      "modelPreferences",
      "clarify.ambiguity_threshold",
      "critic.cross_model",
      "critic.cross_model_min_context"
    ];
    for (const knob of required) {
      expect(section, `README Configuration table should cite ${knob}`).toContain(knob);
    }
  });

  it("cites the v8.108 cross-model budget default of 16000", () => {
    expect(section).toMatch(/16000/u);
  });

  it("cites the v8.67 clarify ambiguity threshold default of 60", () => {
    expect(section).toContain("60");
  });
});
