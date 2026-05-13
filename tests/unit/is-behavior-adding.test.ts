import { describe, expect, it } from "vitest";
import { isBehaviorAdding } from "../../src/is-behavior-adding.js";

/**
 * v8.36 — `is_behavior_adding(touchSurface)` predicate.
 *
 * File-extension-driven gate (gsd-v1 pattern). Returns `false` iff every
 * file in `touchSurface` matches the exclusion set: markdown / config
 * (json / yml / yaml / toml / ini / cfg / conf) / dotenv / tests
 * (tests/**, *.test.*, *.spec.*, __tests__/**) / docs / .cclaw /
 * .github. Otherwise returns `true` — the AC is shipping production
 * behaviour and the standard TDD ceremony applies.
 *
 * The predicate is exported from `src/is-behavior-adding.ts` so it
 * can be unit-tested as a pure function; v8.40 retired the
 * `commit-helper.mjs` hook that inlined the same logic, so the
 * predicate is now consumed only by `src/posture-validation.ts`
 * (reviewer-side ex-post cross-check).
 */
describe("v8.36 — is_behavior_adding predicate", () => {
  it("returns false for an empty touchSurface (nothing to verify; treat as non-behaviour)", () => {
    expect(isBehaviorAdding([])).toBe(false);
  });

  it("returns false for pure docs (README, CHANGELOG, docs/**)", () => {
    expect(isBehaviorAdding(["README.md"])).toBe(false);
    expect(isBehaviorAdding(["CHANGELOG.md", "docs/migration.md"])).toBe(false);
    expect(isBehaviorAdding(["docs/architecture/overview.md"])).toBe(false);
  });

  it("returns false for pure config (json / yml / yaml / toml / ini / cfg / conf)", () => {
    expect(isBehaviorAdding(["package.json"])).toBe(false);
    expect(isBehaviorAdding([".github/workflows/ci.yml"])).toBe(false);
    expect(isBehaviorAdding(["config/app.yaml", "config/db.toml"])).toBe(false);
    expect(isBehaviorAdding(["setup.cfg", "tsconfig.ini"])).toBe(false);
    expect(isBehaviorAdding(["nginx.conf"])).toBe(false);
  });

  it("returns false for dotenv files (.env, .env.production, etc.)", () => {
    expect(isBehaviorAdding([".env"])).toBe(false);
    expect(isBehaviorAdding([".env.production", ".env.local"])).toBe(false);
  });

  it("returns false for pure tests (tests/**, *.test.*, *.spec.*, __tests__/**)", () => {
    expect(isBehaviorAdding(["tests/unit/foo.test.ts"])).toBe(false);
    expect(isBehaviorAdding(["src/foo.test.ts", "src/bar.spec.ts"])).toBe(false);
    expect(isBehaviorAdding(["src/__tests__/bar.ts"])).toBe(false);
    expect(isBehaviorAdding(["tests/integration/api.test.ts", "tests/unit/util.test.ts"])).toBe(false);
  });

  it("returns false for .cclaw / .github paths", () => {
    expect(isBehaviorAdding([".cclaw/flows/foo/plan.md"])).toBe(false);
    expect(isBehaviorAdding([".github/CODEOWNERS"])).toBe(false);
  });

  it("returns true for a single production source file (.ts)", () => {
    expect(isBehaviorAdding(["src/lib/permissions.ts"])).toBe(true);
  });

  it("returns true for mixed source + tests (source-only would already be true)", () => {
    expect(isBehaviorAdding(["src/lib/permissions.ts", "tests/unit/permissions.test.ts"])).toBe(true);
  });

  it("returns true for mixed source + docs", () => {
    expect(isBehaviorAdding(["src/lib/permissions.ts", "docs/migration.md"])).toBe(true);
  });

  it("returns true for production code in non-standard locations (lib/, app/, packages/**)", () => {
    expect(isBehaviorAdding(["lib/foo.js"])).toBe(true);
    expect(isBehaviorAdding(["app/handlers/user.ts"])).toBe(true);
    expect(isBehaviorAdding(["packages/core/src/index.ts"])).toBe(true);
  });

  it("treats any single non-excluded file as behaviour-adding (mixed exclusion + source = true)", () => {
    expect(isBehaviorAdding(["README.md", "src/api.ts"])).toBe(true);
    expect(isBehaviorAdding(["package.json", "src/index.ts"])).toBe(true);
  });

  it("returns false when every file matches the exclusion set (multi-file pure-docs slug)", () => {
    expect(
      isBehaviorAdding([
        "README.md",
        "CHANGELOG.md",
        "docs/v8.md",
        ".github/workflows/ci.yml",
        "package.json"
      ])
    ).toBe(false);
  });
});
