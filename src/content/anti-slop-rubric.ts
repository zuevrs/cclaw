/**
 * Single source of truth for the four anti-slop dimensions (added in the
 * v8.86 release).
 *
 * One consumer today, one shape ready for two tomorrow:
 *
 * - {@link "src/content/specialist-prompts/reviewer.ts" | REVIEWER_PROMPT} —
 *   the v8.86 gated `anti-slop` reviewer axis. Walks the rendered diff
 *   against the four dimensions and grades each one 0-10 with an
 *   explicit "what a 10 looks like" anchor; below-6 grades become `AS-N`
 *   findings appended to the iteration block's Findings table.
 *   Block-ship on strict at severity ≥ medium.
 *
 * Why one const, not "next slug bakes the rubric into the prompt": the
 * v8.75 design-quality and v8.82 devex-quality rubrics showed that
 * consumers fragment fast — the moment a second surface (pre-build
 * `plan-simplicity` lens, research-anti-slop probe, learnings table)
 * picks up the same vocabulary, the literal table drifts. The lift here
 * is pre-emptive: when a future v8.x adds a builder-side `simplicity`
 * check or a `research-anti-slop` lens, they share these helpers and the
 * dimensions cannot drift across surfaces.
 *
 * The four dimensions are the cclaw projection of Andrej Karpathy's
 * "Simplicity First" principle (Karpathy-skills marketplace; see
 * `forrestchang/andrej-karpathy-skills > CLAUDE.md > Simplicity First`).
 * Karpathy frames it as: "Minimum code that solves the problem. Nothing
 * speculative. No features beyond what was asked. No abstractions for
 * single-use code. No 'flexibility' or 'configurability' that wasn't
 * requested." The four cclaw dimensions decompose that prose into
 * observable, gradable axes:
 *
 *   1. **Senior-test** — would a senior engineer say this is
 *      overcomplicated? (Karpathy's litmus test, made first-class.)
 *   2. **Speculative-flexibility** — extension points / config layers /
 *      abstractions added without a concrete current consumer.
 *   3. **Single-use-abstraction** — helpers used exactly once but
 *      parameterized or wrapped in a class as if they had ≥2 callers.
 *   4. **Orphan-cleanup-discipline** — dead code, unused imports, leftover
 *      file scaffolding from a previous slug or earlier iteration of
 *      THIS slug that was not removed.
 *
 * The exported {@link renderAntiSlopRubricTable} produces the verbatim
 * markdown the reviewer prompt embeds; surface-specific wrapping
 * (intro / "translate to the Findings table" rules / verdict shape)
 * lives in the consuming specialist's prompt body.
 */

/**
 * One dimension of the anti-slop rubric. The four dimensions are
 * stable and immutable; new dimensions require a major version bump
 * (changing the rubric shape would invalidate every prior shipped
 * slug's anti-slop findings).
 *
 * - `key` — short identifier used in headings / grep / test assertions.
 *   Hyphenated kebab-case for stability across markdown rendering.
 * - `name` — display name used in the rendered table row and in finding
 *   bodies ("Senior-test: 4/10 ...").
 * - `summary` — one-line "what it covers" cell, second column of the
 *   rubric table.
 * - `anchor10` — "what a 10 looks like" reference, third column. Each
 *   anchor names the concrete state a finished diff would commit to;
 *   below-6 grades land when the diff's shape falls short.
 */
export interface AntiSlopDimension {
  readonly key: string;
  readonly name: string;
  readonly summary: string;
  readonly anchor10: string;
}

export const ANTI_SLOP_DIMENSIONS: readonly AntiSlopDimension[] = [
  {
    key: "senior-test",
    name: "senior-test",
    summary:
      "would a senior engineer reading this diff say it is overcomplicated? does the diff size match the change's conceptual size? are 200 lines doing the work of 50? would a smaller version of the same diff pass the AC's behavioural test?",
    anchor10:
      "diff size matches the conceptual size of the change (a one-line conditional fix lands as a one-line diff; a new endpoint lands at the minimal surface needed for the AC's verbs, not the maximal surface a 'proper' endpoint 'should' have); the simpler-thing was considered and named in build.md OR the AC genuinely requires the larger shape; a senior reviewer reading the diff would say 'this is the minimum that works', not 'this could be half the size'; the diff does NOT introduce new abstraction / state / config that the simpler-thing wouldn't have needed; the AC's behavioural test would still pass on a 30%-smaller version of the same diff only if that smaller version exists in build.md's reasoning"
  },
  {
    key: "speculative-flexibility",
    name: "speculative-flexibility",
    summary:
      "does the diff add extension points, hooks, callback signatures, config layers, or 'pluggable' interfaces that have no concrete current consumer? are options exposed because 'someone might need them' rather than because the AC required them? does the change ship configurability that wasn't asked for?",
    anchor10:
      "every options object key / config row / callback parameter / 'pluggable' interface in the diff has at least one current concrete consumer naming it; no `options?: { ... }` parameter with all-optional fields and zero callers passing them; no `Strategy` / `Provider` / `Factory` abstraction whose only concrete implementation is the one the AC needed; no environment-driven branching (`if (process.env.X) ...`) without a current consumer setting `X`; no exported configuration surface that the rest of the codebase does not currently read; the diff says 'this is the shape today' not 'this is the shape that would scale if we needed to'"
  },
  {
    key: "single-use-abstraction",
    name: "single-use-abstraction",
    summary:
      "does the diff introduce a helper / class / module / hook used exactly once but parameterized or layered as if it had ≥2 callers? is there an `XManager` / `XService` / `XProvider` whose body is a thin wrapper around a single function? are there ≥3 levels of indirection where ≤1 would do? is the abstraction backing a hypothetical future consumer rather than a current one?",
    anchor10:
      "every helper / class / module / hook introduced by the diff is called by ≥2 distinct call sites OR the AC explicitly required the abstraction (e.g. an interface extracted to enable mocking in a named test); no `extractFooHelper` whose body is two lines used in one place; no class whose body is a single method called from one call site (a function would have sufficed); indirection depth matches the actual reuse pattern (a single-use helper is inlined or named at one level; a true cross-cutting concern earns multiple levels); a senior reviewer reading the diff would NOT ask 'why is this a separate function / class / module?'"
  },
  {
    key: "orphan-cleanup-discipline",
    name: "orphan-cleanup-discipline",
    summary:
      "did the diff remove orphans IT created (imports / variables / functions / files made unused by THIS change)? did the diff leave dead code / unused exports / leftover scaffolding from an earlier iteration of this slug? did the diff respect 'remove only your own mess' — i.e. NOT delete pre-existing dead code unrelated to the AC?",
    anchor10:
      "every import / variable / function / file orphaned BY this diff is removed in the same diff (unused imports stripped; functions that lost their only caller deleted; type aliases that lost their only reference removed); no leftover scaffolding from an earlier iteration of THIS slug (a half-written helper that was later inlined; a feature flag that was removed but its config row stayed); pre-existing dead code that THIS diff did not create is NOT silently deleted — it is either mentioned in build.md's `## Summary > Things I noticed but didn't touch` OR left untouched; the diff's deletions trace cleanly to either (a) orphan cleanup from this diff's own additions, OR (b) explicit AC-scoped removal"
  }
] as const;

/**
 * Render the four-dimension rubric table as the exact markdown the
 * reviewer prompt embeds. Three columns: dimension name, "what it
 * covers", "what a 10 looks like". The leading header + separator are
 * emitted so the consumer can drop the result into the prompt body
 * verbatim.
 *
 * The function takes NO arguments — the dimensions are immutable. Any
 * future consumer can render the same table without drifting.
 */
export function renderAntiSlopRubricTable(): string {
  const header =
    "| dimension | what it covers | what a 10 looks like |\n| --- | --- | --- |";
  const rows = ANTI_SLOP_DIMENSIONS.map(
    (d) => `| **${d.name}** | ${d.summary} | ${d.anchor10} |`
  ).join("\n");
  return `${header}\n${rows}`;
}
