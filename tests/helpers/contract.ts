/**
 * Structural contract assertion helpers.
 *
 * cclaw's prompt suite historically pinned behaviour with thousands of raw
 * substring assertions (`expect(PROMPT).toContain("some long sentence")`).
 * Those break on any rewording and make prompts expensive to simplify — the
 * test fails on prose drift, not on a real contract violation.
 *
 * These helpers express the *durable* contract instead: which sections a
 * prompt must contain and which machine tokens (ids, frontmatter keys,
 * commit prefixes) other components depend on. A prompt can be rewritten,
 * shortened, or reordered freely as long as its structural contract holds —
 * which is exactly what makes aggressive prompt simplification safe.
 *
 * Migration guidance: when you find yourself pinning a whole sentence, ask
 * "what is the actual contract?" — usually a section heading or a token —
 * and assert that with `missingSections` / `missingTokens` instead.
 */

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * True when `body` contains a markdown heading (level 1–4) whose text starts
 * with `heading`. Prefix match, so `"Output schema"` matches
 * `"## Output schema (strict)"`.
 */
export function hasSection(body: string, heading: string): boolean {
  return new RegExp(`^#{1,4} ${escapeRegExp(heading)}`, "mu").test(body);
}

/** The subset of `headings` that are absent from `body` (empty = all present). */
export function missingSections(body: string, headings: readonly string[]): string[] {
  return headings.filter((heading) => !hasSection(body, heading));
}

/** The subset of literal `tokens` absent from `body` (empty = all present). */
export function missingTokens(body: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => !body.includes(token));
}
