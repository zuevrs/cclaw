import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_PREFERENCES,
  MODEL_TIERS,
  type ModelPreferenceKey,
  type ModelTier
} from "../../src/config.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";

/**
 * v8.94 — Model-tier sync tripwire (Phase C G-7 fix).
 *
 * Closes the Phase-C v8.87 audit gap "TypeScript helpers
 * `resolveModelPreferences` / `modelTierFor` are never imported (though the
 * runbook-table LLM-consumer path works)". The TS helpers in
 * `src/config.ts` were exported in v8.87 but no production module reads
 * them — the LLM consumes the policy via the dispatch-envelope runbook's
 * mirrored markdown table (`## Model-tier hint (v8.87)` in
 * `runbooks-on-demand.ts`).
 *
 * Resolution path C (default): keep both surfaces — the runbook table is
 * the LLM-facing source of truth, the TS helpers are reserved for future
 * programmatic callers — and pin them to identical values via THIS
 * tripwire. Drift either direction (table edit not mirrored in
 * `DEFAULT_MODEL_PREFERENCES`, or vice versa) fails the build.
 *
 * Parsing strategy: locate the `## Model-tier hint` heading inside the
 * `dispatch-envelope` runbook body, then walk the following markdown
 * table row-by-row:
 *
 *   `| <specialist segment> | \`<tier>\` |`
 *
 * The specialist segment is `/`-separated backticked ids, with optional
 * parenthetical qualifier text (e.g. `\`builder\` (formerly
 * \`slice-builder\` pre-v8.62)`). We strip parentheticals BEFORE
 * extracting backticked tokens so legacy aliases mentioned only as
 * historical context (`slice-builder`) do NOT enter the parsed set —
 * `DEFAULT_MODEL_PREFERENCES` only carries the live v8.62 ids plus the
 * two research helpers, and the runbook qualifier text is a doc hint,
 * not a policy entry.
 */

const TIER_TOKENS = new Set(MODEL_TIERS as readonly string[]);

function dispatchEnvelopeBody(): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === "dispatch-envelope");
  if (!r) throw new Error("dispatch-envelope runbook missing");
  return r.body;
}

/**
 * Parse the `## Model-tier hint` markdown table from the dispatch-envelope
 * runbook body into a flat `Map<specialist, tier>`. Returns `null` when
 * the section / table cannot be located so the test fails loudly with a
 * descriptive message instead of a silent empty map.
 */
function parseRunbookTierTable(body: string): Map<string, ModelTier> | null {
  const headingIdx = body.indexOf("## Model-tier hint");
  if (headingIdx < 0) return null;
  // The table is the first markdown table after the heading; stop at the
  // next blank line that follows the table rows OR at the next `##`.
  const after = body.slice(headingIdx);
  const nextSectionIdx = after.indexOf("\n## ", 1);
  const section = nextSectionIdx >= 0 ? after.slice(0, nextSectionIdx) : after;

  const out = new Map<string, ModelTier>();
  for (const rawLine of section.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    // Skip the header row (`| Specialist | Default tier |`) and the
    // separator row (`| --- | --- |`).
    if (/^\|\s*Specialist\s*\|/i.test(line)) continue;
    if (/^\|\s*-+\s*\|\s*-+\s*\|$/.test(line)) continue;

    const cells = line
      .slice(1, -1)
      .split("|")
      .map((c) => c.trim());
    if (cells.length < 2) continue;

    const [specialistCell, tierCell] = cells;
    // Strip parenthetical qualifiers — these are doc hints, not policy.
    const cleaned = specialistCell.replace(/\([^)]*\)/g, " ");
    const ids = Array.from(cleaned.matchAll(/`([^`]+)`/g)).map((m) => m[1]);
    if (ids.length === 0) continue;

    const tierMatch = tierCell.match(/`([^`]+)`/);
    if (!tierMatch) continue;
    const tier = tierMatch[1];
    if (!TIER_TOKENS.has(tier)) continue;

    for (const id of ids) {
      out.set(id, tier as ModelTier);
    }
  }
  return out;
}

describe("v8.94 — model-tier TS helpers ↔ runbook table sync (G-7 tripwire)", () => {
  it("AC-1 — the `## Model-tier hint` table parses into a non-empty map", () => {
    const parsed = parseRunbookTierTable(dispatchEnvelopeBody());
    expect(parsed, "table section / rows could not be located").not.toBeNull();
    expect(parsed!.size).toBeGreaterThan(0);
  });

  it("AC-1 — every parsed tier value is in the canonical MODEL_TIERS union", () => {
    const parsed = parseRunbookTierTable(dispatchEnvelopeBody());
    expect(parsed).not.toBeNull();
    for (const [id, tier] of parsed!) {
      expect(
        TIER_TOKENS.has(tier),
        `runbook row for ${id} carries non-canonical tier ${tier}`
      ).toBe(true);
    }
  });

  it("AC-2 — every DEFAULT_MODEL_PREFERENCES entry has a matching runbook row with the same tier", () => {
    const parsed = parseRunbookTierTable(dispatchEnvelopeBody());
    expect(parsed).not.toBeNull();
    for (const [key, tier] of Object.entries(DEFAULT_MODEL_PREFERENCES) as [
      ModelPreferenceKey,
      ModelTier
    ][]) {
      const runbookTier = parsed!.get(key);
      expect(
        runbookTier,
        `specialist \`${key}\` is in DEFAULT_MODEL_PREFERENCES (tier=${tier}) but not in the runbook table`
      ).toBeDefined();
      expect(
        runbookTier,
        `tier drift for \`${key}\`: DEFAULT_MODEL_PREFERENCES says ${tier} but runbook says ${runbookTier}`
      ).toBe(tier);
    }
  });

  it("AC-2 — every runbook row maps to a key present in DEFAULT_MODEL_PREFERENCES", () => {
    const parsed = parseRunbookTierTable(dispatchEnvelopeBody());
    expect(parsed).not.toBeNull();
    const defaults = DEFAULT_MODEL_PREFERENCES as Record<string, ModelTier>;
    for (const [id, tier] of parsed!) {
      expect(
        defaults[id],
        `runbook row \`${id}\` (tier=${tier}) has no entry in DEFAULT_MODEL_PREFERENCES`
      ).toBeDefined();
      expect(
        defaults[id],
        `tier drift for \`${id}\`: runbook says ${tier} but DEFAULT_MODEL_PREFERENCES says ${defaults[id]}`
      ).toBe(tier);
    }
  });

  it("AC-3 — the parsed table covers exactly the same key set as DEFAULT_MODEL_PREFERENCES", () => {
    const parsed = parseRunbookTierTable(dispatchEnvelopeBody());
    expect(parsed).not.toBeNull();
    const runbookKeys = Array.from(parsed!.keys()).sort();
    const defaultKeys = Object.keys(DEFAULT_MODEL_PREFERENCES).sort();
    expect(runbookKeys).toEqual(defaultKeys);
  });

  it("AC-4 — legacy alias `slice-builder` mentioned in qualifier text does NOT leak into the parsed set", () => {
    // The runbook row `\`builder\` (formerly \`slice-builder\` pre-v8.62)`
    // is the canonical place where the legacy alias is documented. The
    // alias must stay in the parenthetical and never enter
    // DEFAULT_MODEL_PREFERENCES — the resolver collapses it onto
    // `builder` at lookup time (see `modelTierFor("slice-builder", ...)`).
    const parsed = parseRunbookTierTable(dispatchEnvelopeBody());
    expect(parsed).not.toBeNull();
    expect(parsed!.has("slice-builder")).toBe(false);
    expect(
      (DEFAULT_MODEL_PREFERENCES as Record<string, ModelTier | undefined>)[
        "slice-builder"
      ]
    ).toBeUndefined();
  });
});
