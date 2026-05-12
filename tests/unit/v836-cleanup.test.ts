import { describe, expect, it } from "vitest";

import { COMMIT_HELPER_HOOK_SPEC, NODE_HOOKS } from "../../src/content/node-hooks.js";
import {
  IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION,
  isBehaviorAdding
} from "../../src/is-behavior-adding.js";
import { DEFAULT_POSTURE, POSTURES } from "../../src/types.js";
import { AC_AUTHOR_PROMPT, REVIEWER_PROMPT, SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/index.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.36 — `is_behavior_adding` predicate + `posture` field.
 *
 * Tripwires that guard the cross-cutting integration: a single change
 * to the predicate or the posture enum must keep all six surfaces in
 * sync (TS module / commit-helper hook body / ac-author prompt /
 * slice-builder prompt / reviewer prompt / tdd-and-verification skill).
 *
 * If any single surface drifts, ONE of the tests below lights up — the
 * "cleanup" tag is the convention for these v8.<N>-cleanup test files.
 */

const COMMIT_HELPER_BODY = COMMIT_HELPER_HOOK_SPEC.body;

const TDD_SKILL = (() => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === "tdd-and-verification.md");
  if (!skill) throw new Error("tdd-and-verification skill not found");
  return skill.body;
})();

describe("v8.36 — predicate exports + cross-surface alignment", () => {
  it("predicate exclusion description names every protected category at least once", () => {
    // The description is documentation but anchored by the test so a
    // partial update (e.g. dropping `.toml`) flips this assertion.
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
    // Lock the description string to its canonical body so a future
    // edit MUST be accompanied by an explicit Decisions.md entry.
    expect(IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION).toMatch(/^\*\.md \/ /);
    expect(IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION).toMatch(/\.github\/\*\*$/);
  });

  it("predicate behaves consistently with the prose: pure docs → false, source-only → true", () => {
    // Spot-check the canonical cases that the description names.
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
    // The mapping table title is fixed so the file stays greppable.
    expect(TDD_SKILL).toMatch(/posture/i);
  });

  it("DEFAULT_POSTURE is referenced by name in the ac-author prompt (so legacy plans inherit it)", () => {
    expect(AC_AUTHOR_PROMPT).toContain(DEFAULT_POSTURE);
  });
});

describe("v8.36 — commit-helper hook body carries the posture-aware gate", () => {
  it("hook body inlines an is_behavior_adding predicate identical in spirit to the TS module", () => {
    // We can't import from a sibling .mjs string, but we can assert
    // the function name + key extension rules live in the body so
    // any future divergence is caught here.
    expect(COMMIT_HELPER_BODY).toContain("isBehaviorAdding");
    for (const ext of [".md", ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf"]) {
      expect(
        COMMIT_HELPER_BODY,
        `hook predicate must consider "${ext}" as an exclusion`
      ).toContain(ext);
    }
    expect(COMMIT_HELPER_BODY).toContain("tests/");
    expect(COMMIT_HELPER_BODY).toContain("__tests__");
    expect(COMMIT_HELPER_BODY).toContain("docs/");
    expect(COMMIT_HELPER_BODY).toContain(".cclaw/");
    expect(COMMIT_HELPER_BODY).toContain(".github/");
    expect(COMMIT_HELPER_BODY).toMatch(/\.env/);
  });

  it("hook body reads the AC's `posture` field (with a default fallback)", () => {
    expect(COMMIT_HELPER_BODY).toMatch(/posture/);
    // The default branch must literally name `test-first` so a future
    // refactor that drops it surfaces here.
    expect(COMMIT_HELPER_BODY).toContain("test-first");
  });

  it("hook body documents the six posture values in its header comment so a user reading the .mjs file alone can self-correct", () => {
    for (const posture of POSTURES) {
      expect(
        COMMIT_HELPER_BODY,
        `hook body must mention "${posture}" — the .mjs file is installed standalone and must be readable on its own`
      ).toContain(posture);
    }
  });

  it("hook body has a tests-as-deliverable branch that accepts a single `test(AC-N)` commit", () => {
    expect(COMMIT_HELPER_BODY).toContain("tests-as-deliverable");
    // The hook must accept the `test` phase as the single commit for
    // this posture; the recorded SHA goes under `green` per the spec.
    expect(COMMIT_HELPER_BODY).toMatch(/\btest\b/);
  });

  it("hook body has a refactor-only branch that skips the RED requirement", () => {
    expect(COMMIT_HELPER_BODY).toContain("refactor-only");
  });

  it("hook body has a docs-only branch that accepts a single `docs(AC-N)` commit + refuses source files", () => {
    expect(COMMIT_HELPER_BODY).toContain("docs-only");
    expect(COMMIT_HELPER_BODY).toMatch(/docs\(AC|docs phase|--phase=docs/);
    // The cross-check error message names the contradiction.
    expect(COMMIT_HELPER_BODY).toMatch(/contradicts|source file/i);
  });

  it("hook body promotes bootstrap from the legacy `buildProfile` field into a posture branch", () => {
    expect(COMMIT_HELPER_BODY).toContain("bootstrap");
    // Backward compat: the legacy `buildProfile === "bootstrap"`
    // override is still recognised so in-flight projects with the
    // pre-v8.36 field continue to work.
    expect(COMMIT_HELPER_BODY).toContain("buildProfile");
  });

  it("hook body still hard-fails strict mode when git is unavailable (regression-guard for v8.23)", () => {
    expect(COMMIT_HELPER_BODY).toMatch(/strict[\s\S]*?process\.exit\(2\)/);
  });

  it("hook body still rejects production files in the RED commit (regression-guard for test-first posture)", () => {
    expect(COMMIT_HELPER_BODY).toContain("RED phase rejects production files");
  });
});
