/**
 * v8.36 — `is_behavior_adding(touchSurface)` predicate.
 *
 * File-extension-driven gate that auto-detects non-behaviour-adding ACs
 * (gsd-v1 pattern). Returns `false` iff every file in `touchSurface`
 * matches the exclusion set below — i.e. the diff is pure docs / config
 * / tests / scaffolding and the standard "production code without a
 * failing test first" rule does not apply.
 *
 * Returns `true` whenever ANY file in `touchSurface` falls outside the
 * exclusion set; that single non-excluded file is enough to trigger
 * the full RED → GREEN → REFACTOR ceremony for the AC.
 *
 * v8.36–v8.39: the predicate was inlined into the `commit-helper.mjs`
 * hook body for mechanical enforcement. v8.40 retired the hook;
 * enforcement is now ex-post via the reviewer's git-log inspection,
 * and this is the only copy of the rule. The reviewer cites this
 * helper (via `src/posture-validation.ts`) when validating posture
 * declarations against actual `touchSurface` contents.
 *
 * The posture field (set by ac-author in plan.md AC frontmatter) is
 * the **annotation** that declares the ceremony; the predicate is the
 * **double-check** — `posture=docs-only` combined with a `touchSurface`
 * that contains a source file is a contradiction, and the reviewer
 * surfaces it as an A-1 finding (severity=required, axis=correctness).
 */

/**
 * Exclusion-matching tests in priority order. A `touchSurface` entry
 * counts as "excluded" iff it matches at least one of these rules.
 *
 * Kept as a flat list of plain predicates rather than a glob-matcher
 * dependency so the hook body can inline an identical literal copy
 * without bringing the user a runtime cost.
 */
function isExcludedFile(path: string): boolean {
  const lower = path.toLowerCase();
  const base = lower.split("/").pop() ?? lower;
  // dotenv: `.env`, `.env.production`, `.env.local`, …
  if (base === ".env" || base.startsWith(".env.")) return true;
  // markdown / config extensions
  if (/\.(md|json|ya?ml|toml|ini|cfg|conf)$/u.test(lower)) return true;
  // test surfaces
  if (lower.startsWith("tests/")) return true;
  if (lower.includes("/__tests__/") || lower.startsWith("__tests__/")) return true;
  if (/\.(test|spec)\.[a-z0-9.]+$/u.test(lower)) return true;
  // docs / harness / CI dotfolders
  if (lower.startsWith("docs/")) return true;
  if (lower.startsWith(".cclaw/")) return true;
  if (lower.startsWith(".github/")) return true;
  return false;
}

/**
 * Returns `true` when at least one entry in `touchSurface` is OUTSIDE
 * the exclusion set (i.e. the diff is touching production behaviour);
 * returns `false` for an empty list or for a list where every entry
 * matches the exclusion set.
 *
 * @param touchSurface - List of repo-relative file paths that the AC
 * is allowed to modify. Pass the AC's `touchSurface` array verbatim.
 */
export function isBehaviorAdding(touchSurface: readonly string[]): boolean {
  if (touchSurface.length === 0) return false;
  return touchSurface.some((entry) => !isExcludedFile(entry));
}

/**
 * Exported for the `v836-cleanup` tripwire so the hook body's inlined
 * copy can be compared against the canonical TS implementation
 * without duplicating the rule list in two test files.
 */
export const IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION =
  "*.md / *.json / *.yml / *.yaml / *.toml / *.ini / *.cfg / *.conf / .env* / tests/** / **/*.test.* / **/*.spec.* / __tests__/** / docs/** / .cclaw/** / .github/**";
