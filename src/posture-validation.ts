/**
 * v8.40 — posture-aware TDD validation helpers used by the reviewer
 * during ex-post inspection of the build's git log.
 *
 * Before v8.40 the same predicate logic lived inline inside
 * `commit-helper.mjs` (which mechanically rejected commits whose
 * touchSurface contradicted the declared posture). v8.40 retired the
 * hook and made TDD ordering a prompt-and-prefix contract; this module
 * is where the reviewer (and any orchestrator-side tooling) pulls the
 * same rules from.
 *
 * Three exports:
 *
 *  - `isBehaviorAdding` (re-exported from `./is-behavior-adding.js`):
 *    `true` iff `touchSurface` contains at least one non-excluded
 *    (production) file. The reviewer cross-checks this against the
 *    AC's declared posture — a `docs-only` AC whose touchSurface
 *    contains a `src/**` file is an A-1 finding.
 *
 *  - `POSTURE_COMMIT_PREFIXES`: per-posture map of expected commit
 *    message prefixes. The reviewer's git-log inspection asserts the
 *    set of commits found for `(AC-N)` matches the posture's recipe.
 *
 *  - `expectedCommitsForPosture`: given a posture and an AC id, returns
 *    the ordered list of `<prefix>(AC-N):` subjects the reviewer
 *    expects to see in `git log` (in order). Missing entries are A-1
 *    findings; entries in the wrong order are A-1 findings; commits
 *    with unrecognised prefixes for the posture are A-1 findings.
 */

import {
  IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION,
  isBehaviorAdding
} from "./is-behavior-adding.js";
import type { Posture } from "./types.js";

export { isBehaviorAdding, IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION };

/**
 * Per-posture commit-message-prefix recipe.
 *
 * Each entry is an ORDERED list of subject-line prefixes the reviewer
 * expects to see in the git log for an AC of this posture (the AC id
 * is appended to each prefix at inspection time). The reviewer
 * iterates the list and runs `git log --grep="^<prefix>(AC-N):"` for
 * each entry; missing commits are A-1 findings (axis=correctness).
 *
 * Special cases the reviewer prompt also knows about:
 *  - `bootstrap` AC-1 omits the leading `red` prefix (the bootstrap
 *    escape). AC-2+ uses the full `test-first` recipe.
 *  - `refactor` commits may carry the literal `refactor(AC-N) skipped:`
 *    subject (Path B); the reviewer accepts that as a satisfied
 *    `refactor` slot.
 */
export const POSTURE_COMMIT_PREFIXES: Readonly<Record<Posture, readonly string[]>> = {
  "test-first": ["red", "green", "refactor"],
  "characterization-first": ["red", "green", "refactor"],
  "tests-as-deliverable": ["test"],
  "refactor-only": ["refactor"],
  "docs-only": ["docs"],
  bootstrap: ["green", "refactor"]
};

/**
 * Construct the ordered list of subject-line prefixes (with AC id
 * appended) the reviewer expects to find in the git log for one AC.
 *
 * Returns subjects like `red(AC-3):` / `green(AC-3):` / `refactor(AC-3):`
 * — these are the literal regex anchors the reviewer uses with
 * `git log --grep="^<subject>"`.
 */
export function expectedCommitsForPosture(
  posture: Posture,
  acId: string
): readonly string[] {
  const prefixes = POSTURE_COMMIT_PREFIXES[posture];
  return prefixes.map((prefix) => `${prefix}(${acId}):`);
}

/**
 * Validate that an AC's declared posture is consistent with the
 * `touchSurface` it touches. Used by the reviewer as the canonical
 * cross-check the old `commit-helper.mjs --phase=docs` hook used to
 * perform mechanically.
 *
 * Returns `null` when the combination is valid; otherwise returns a
 * short human-readable explanation the reviewer can quote in its
 * finding body.
 *
 * Rules:
 *  - `docs-only` MUST have a touchSurface where every entry matches
 *    the exclusion set (no source files). Source files in the diff
 *    contradict the posture and produce an A-1 finding.
 *  - `tests-as-deliverable` MUST have a touchSurface where every
 *    entry matches the exclusion set (tests / fixtures / docs).
 *    A `src/**` or `lib/**` file in the diff means the AC was
 *    delivering production behaviour, not tests; the reviewer cites
 *    A-1 with the suggestion to re-classify as `test-first`.
 *  - All other postures are unrestricted: their touchSurface may
 *    contain any mix of production and test files; the per-posture
 *    commit ordering is the gate, not the file-set.
 */
export function validatePostureTouchSurface(
  posture: Posture,
  touchSurface: readonly string[]
): string | null {
  if (posture === "docs-only" && isBehaviorAdding(touchSurface)) {
    return `posture=docs-only contradicts touchSurface containing source files: ${touchSurface.join(
      ", "
    )}. Either restrict the diff to ${IS_BEHAVIOR_ADDING_EXCLUSION_DESCRIPTION} or re-classify the AC's posture to test-first / characterization-first.`;
  }
  if (posture === "tests-as-deliverable" && isBehaviorAdding(touchSurface)) {
    return `posture=tests-as-deliverable contradicts touchSurface containing source files: ${touchSurface.join(
      ", "
    )}. The AC declared the test IS the deliverable; a production file in the diff means the AC is shipping behaviour. Re-classify as test-first or characterization-first.`;
  }
  return null;
}
