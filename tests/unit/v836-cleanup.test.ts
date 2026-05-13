import { describe, expect, it } from "vitest";

import {
  IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION,
  isBehaviorAdding
} from "../../src/is-behavior-adding.js";
import { DEFAULT_POSTURE, POSTURES } from "../../src/types.js";
import { AC_AUTHOR_PROMPT, REVIEWER_PROMPT, SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/index.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import {
  POSTURE_COMMIT_PREFIXES,
  expectedCommitsForPosture,
  validatePostureTouchSurface
} from "../../src/posture-validation.js";

/**
 * v8.36 — `is_behavior_adding` predicate + `posture` field.
 *
 * Tripwires that guard the cross-cutting integration: a single change
 * to the predicate or the posture enum must keep five surfaces in sync
 * (TS module / ac-author prompt / slice-builder prompt / reviewer
 * prompt / tdd-and-verification skill). v8.40 retired the commit-helper
 * hook; the cross-check that used to live in the .mjs body now lives in
 * `src/posture-validation.ts` (reviewer-side, ex-post).
 *
 * If any single surface drifts, ONE of the tests below lights up — the
 * "cleanup" tag is the convention for these v8.<N>-cleanup test files.
 */

const TDD_SKILL = (() => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === "tdd-and-verification.md");
  if (!skill) throw new Error("tdd-and-verification skill not found");
  return skill.body;
})();

describe("v8.36 — predicate exports + cross-surface alignment", () => {
  it("predicate exclusion description names every protected category at least once", () => {
    for (const token of [
      "*.md",
      "*.json",
      "*.yml",
      "*.yaml",
      "*.toml",
      "*.ini",
      "*.cfg",
      "*.conf",
      ".env",
      "tests/**",
      "*.test.*",
      "*.spec.*",
      "__tests__/**",
      "docs/**",
      ".cclaw/**",
      ".github/**"
    ]) {
      expect(
        IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION,
        `predicate exclusion description must name "${token}" so docs and code stay aligned`
      ).toContain(token);
    }
  });

  it("predicate exclusion description matches the spec exactly (no silent additions)", () => {
    expect(IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION).toMatch(/^\*\.md \/ /);
    expect(IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION).toMatch(/\.github\/\*\*$/);
  });

  it("predicate behaves consistently with the prose: pure docs → false, source-only → true", () => {
    expect(isBehaviorAdding(["README.md"])).toBe(false);
    expect(isBehaviorAdding(["src/index.ts"])).toBe(true);
  });
});

describe("v8.36 — POSTURES enum is documented in user-facing prompts", () => {
  it("ac-author prompt names every posture value (heuristic table is the source of truth)", () => {
    for (const posture of POSTURES) {
      expect(
        AC_AUTHOR_PROMPT,
        `ac-author prompt must mention "${posture}" so the heuristic table covers every value`
      ).toContain(posture);
    }
  });

  it("slice-builder prompt names every posture value (ceremony section)", () => {
    for (const posture of POSTURES) {
      expect(
        SLICE_BUILDER_PROMPT,
        `slice-builder prompt must mention "${posture}" — ceremony selector lives here`
      ).toContain(posture);
    }
  });

  it("reviewer prompt names every posture value (posture-specific checks)", () => {
    for (const posture of POSTURES) {
      expect(
        REVIEWER_PROMPT,
        `reviewer prompt must mention "${posture}" — posture-aware checks live here`
      ).toContain(posture);
    }
  });

  it("tdd-and-verification skill carries the canonical posture-to-ceremony table", () => {
    for (const posture of POSTURES) {
      expect(
        TDD_SKILL,
        `tdd-and-verification.md must mention "${posture}" — it owns the canonical posture map`
      ).toContain(posture);
    }
    expect(TDD_SKILL).toMatch(/posture/i);
  });

  it("DEFAULT_POSTURE is referenced by name in the ac-author prompt (so legacy plans inherit it)", () => {
    expect(AC_AUTHOR_PROMPT).toContain(DEFAULT_POSTURE);
  });
});

describe("v8.40 — posture-validation helper owns the predicate-as-cross-check", () => {
  it("POSTURE_COMMIT_PREFIXES has an entry for every posture", () => {
    for (const posture of POSTURES) {
      expect(POSTURE_COMMIT_PREFIXES[posture]).toBeDefined();
      expect(POSTURE_COMMIT_PREFIXES[posture].length).toBeGreaterThan(0);
    }
  });

  it("test-first posture expects red → green → refactor commit prefixes", () => {
    expect(POSTURE_COMMIT_PREFIXES["test-first"]).toEqual(["red", "green", "refactor"]);
  });

  it("docs-only posture expects a single docs commit prefix", () => {
    expect(POSTURE_COMMIT_PREFIXES["docs-only"]).toEqual(["docs"]);
  });

  it("tests-as-deliverable posture expects a single test commit prefix", () => {
    expect(POSTURE_COMMIT_PREFIXES["tests-as-deliverable"]).toEqual(["test"]);
  });

  it("refactor-only posture expects a single refactor commit prefix", () => {
    expect(POSTURE_COMMIT_PREFIXES["refactor-only"]).toEqual(["refactor"]);
  });

  it("bootstrap posture expects green → refactor (AC-1 escape; AC-2+ uses test-first)", () => {
    // The bootstrap entry covers AC-1's reduced ceremony (no preceding
    // RED). The reviewer prompt handles the AC-2+ promotion to the
    // standard test-first sequence.
    expect(POSTURE_COMMIT_PREFIXES["bootstrap"]).toEqual(["green", "refactor"]);
  });

  it("expectedCommitsForPosture builds full prefix strings like 'red(AC-3):'", () => {
    expect(expectedCommitsForPosture("test-first", "AC-3")).toEqual([
      "red(AC-3):",
      "green(AC-3):",
      "refactor(AC-3):"
    ]);
    expect(expectedCommitsForPosture("docs-only", "AC-7")).toEqual(["docs(AC-7):"]);
  });

  it("validatePostureTouchSurface flags docs-only AC with src/ in touchSurface", () => {
    const error = validatePostureTouchSurface("docs-only", ["src/index.ts", "README.md"]);
    expect(error).not.toBeNull();
    expect(error).toMatch(/docs-only/i);
  });

  it("validatePostureTouchSurface accepts docs-only AC with pure docs touchSurface", () => {
    const error = validatePostureTouchSurface("docs-only", ["README.md", "docs/getting-started.md"]);
    expect(error).toBeNull();
  });

  it("validatePostureTouchSurface flags tests-as-deliverable AC with src/ in touchSurface", () => {
    const error = validatePostureTouchSurface("tests-as-deliverable", [
      "tests/unit/api.test.ts",
      "src/api.ts"
    ]);
    expect(error).not.toBeNull();
    expect(error).toMatch(/tests-as-deliverable/i);
  });

  it("validatePostureTouchSurface accepts tests-as-deliverable AC with test-only touchSurface", () => {
    const error = validatePostureTouchSurface("tests-as-deliverable", [
      "tests/unit/api.test.ts",
      "tests/integration/api.spec.ts"
    ]);
    expect(error).toBeNull();
  });

  it("validatePostureTouchSurface returns null for postures it doesn't cross-check (test-first / refactor-only / characterization-first / bootstrap)", () => {
    expect(validatePostureTouchSurface("test-first", ["src/foo.ts"])).toBeNull();
    expect(validatePostureTouchSurface("refactor-only", ["src/foo.ts"])).toBeNull();
    expect(validatePostureTouchSurface("characterization-first", ["src/foo.ts"])).toBeNull();
    expect(validatePostureTouchSurface("bootstrap", ["src/foo.ts"])).toBeNull();
  });
});
