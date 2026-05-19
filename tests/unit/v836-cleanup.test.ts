import { describe, expect, it } from "vitest";

import { isBehaviorAdding } from "../../src/is-behavior-adding.js";
import { POSTURES } from "../../src/types.js";
import {
  POSTURE_COMMIT_PREFIXES,
  expectedCommitsForPosture,
  validatePostureTouchSurface
} from "../../src/posture-validation.js";

/**
 * v8.36 — `is_behavior_adding` predicate + `posture` wiring.
 *
 * Slimmed in v8.100: kept the predicate behavior tests and the
 * posture-validation wiring tests. The cross-prompt POSTURES greps
 * (architect / builder / reviewer / tdd skill mentions) were removed.
 */
describe("v8.36 — isBehaviorAdding predicate behaviour", () => {
  it("predicate: pure docs → false, source-only → true", () => {
    expect(isBehaviorAdding(["README.md"])).toBe(false);
    expect(isBehaviorAdding(["src/index.ts"])).toBe(true);
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
