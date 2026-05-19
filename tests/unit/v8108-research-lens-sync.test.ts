import { describe, expect, it } from "vitest";

import { RESEARCH_LENS_PROMPTS } from "../../src/content/research-lenses/index.js";

/**
 * v8.108 — F-2: research-lens drift fix.
 *
 * `research-engineer.ts` and `research-product.ts` (and architecture +
 * design as carriers of the same paragraph) cited the everyinc-compound
 * `ce-web-researcher` methodology with its rigid budget numbers
 * verbatim: "2-4 broad scoping queries, 3-6 targeted, 1-3 follow-ups;
 * cap ~10 queries / ~5 fetches".
 *
 * Upstream removed those numbers in PR #836 / `6fa1277e` and replaced
 * the rigid-budget paragraph with iterative phasing + "Bias toward
 * stopping early" stop-heuristics. The cclaw lenses cite the upstream
 * methodology explicitly — keeping the rigid numbers after upstream
 * dropped them was an unintentional drift; v8.108 syncs.
 *
 * The four affected lenses (engineer / product / architecture / design)
 * all carried the same paragraph shape. The history lens reads
 * compound-knowledge only (no web fetch) and is unaffected; the skeptic
 * lens did not carry the drifted paragraph.
 */

const AFFECTED_LENSES = [
  "research-engineer",
  "research-product",
  "research-architecture",
  "research-design"
] as const;

describe("v8.108 F-2 — rigid budget numbers removed from upstream-drifted lenses", () => {
  for (const lens of AFFECTED_LENSES) {
    it(`${lens}: prompt body no longer carries "2-4 broad" / "3-6 targeted" / "1-3 follow-ups" / "~10 queries" / "~5 fetches" verbatim (upstream removed in 6fa1277e)`, () => {
      const body = RESEARCH_LENS_PROMPTS[lens];
      expect(body).not.toMatch(/2-4 broad/u);
      expect(body).not.toMatch(/3-6 targeted/u);
      expect(body).not.toMatch(/1-3 follow-ups/u);
      expect(body).not.toMatch(/~10 queries/u);
      expect(body).not.toMatch(/~5 fetches/u);
    });
  }
});

describe("v8.108 F-2 — upstream stopping-heuristic phrasing synced into each affected lens", () => {
  for (const lens of AFFECTED_LENSES) {
    it(`${lens}: prompt body carries the upstream "Bias toward stopping early" phrasing + the three canonical stop-heuristic signals (successive searches surface same sources / another query wouldn't change synthesis / signal genuinely thin)`, () => {
      const body = RESEARCH_LENS_PROMPTS[lens];
      expect(body).toMatch(/Bias toward stopping early/u);
      expect(body).toMatch(/successive searches[\s\S]{0,80}same sources/u);
      expect(body).toMatch(/would not change the synthesis meaningfully/u);
      expect(body).toMatch(/genuinely thin/u);
    });
  }
});

describe("v8.108 F-2 — upstream commit citation present in synced paragraph", () => {
  for (const lens of AFFECTED_LENSES) {
    it(`${lens}: cites upstream PR #836 / 6fa1277e so the audit trail is anchored to the specific upstream change`, () => {
      const body = RESEARCH_LENS_PROMPTS[lens];
      expect(body).toMatch(/ce-web-researcher/u);
      expect(body).toMatch(/6fa1277e/u);
      expect(body).toMatch(/#836/u);
    });
  }
});

describe("v8.108 F-2 — cclaw-specific lens structure preserved (no regression beyond the rigid-numbers paragraph)", () => {
  for (const lens of AFFECTED_LENSES) {
    it(`${lens}: still declares the v8.69 first-class web-search dispatch with MCP preference + citation discipline + graceful fallback + Sources section`, () => {
      const body = RESEARCH_LENS_PROMPTS[lens];
      expect(body).toMatch(/Knowledge sourcing|web research|web-search/u);
      expect(body).toMatch(/user-exa|user-context7|MCP/u);
      expect(body).toMatch(/[Cc]itation discipline|cite/u);
      expect(body).toMatch(/[Gg]raceful fallback|fall back|training knowledge/u);
      expect(body).toMatch(/### Sources|## Sources|`Sources` section/u);
    });
  }
});
