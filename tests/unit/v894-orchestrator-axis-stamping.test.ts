import { describe, expect, it } from "vitest";

import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.94 — Orchestrator-side stamping prose for new envelope flags
 * (Phase C audit gaps G-3, G-4, G-5 — all LOW).
 *
 * The reviewer-axis envelope flags introduced by v8.84 / v8.85 /
 * v8.86 each declared an orchestrator-side stamping contract in
 * their CHANGELOG / reviewer.ts stubs ("the orchestrator stamps
 * walkXAxis: true on the dispatch envelope when the gate condition
 * fires"), but `src/content/start-command.ts` — the prose the
 * orchestrator agent actually reads on every `/cc` — carried only
 * the v8.70 `walkDesignQualityAxis` stamping bullet. The three
 * newer flags had no parallel "Auto-activate" bullet, so the
 * documented contract was unbacked at the orchestrator layer.
 *
 * v8.94 closes the gap by adding three parallel "Auto-activate"
 * bullets right after the v8.70 design-quality bullet in
 * start-command.ts's `#### review` section, matching its shape
 * verbatim:
 *
 *   - Auto-activate scope-drift axis (v8.84) — stamps
 *     `walkScopeDriftAxis: true` when plan.md > ## Not Doing
 *     (and why) is non-empty.
 *   - Auto-activate assumption-coverage axis (v8.85) — stamps
 *     `walkAssumptionCoverageAxis: true` when plan.md > ## Key
 *     assumptions to validate has ≥1 bullet leading with a KA-N id.
 *   - Auto-activate anti-slop axis (v8.86, default-on) — stamps
 *     `walkAntiSlopAxis: true` on every reviewer dispatch unless
 *     explicitly disabled.
 *
 * Tripwires below pin those invariants so a future edit that
 * silently drops any of the three stamping bullets, or regresses
 * the parallel "Auto-activate <axis> axis (vX.Y)" prose shape
 * across all four envelope flags, lights up immediately.
 */

describe("v8.94 — start-command.ts stamps walkScopeDriftAxis (G-3)", () => {
  it("AC-1 — names the `walkScopeDriftAxis: true` envelope flag", () => {
    expect(START_COMMAND_BODY).toContain("walkScopeDriftAxis: true");
  });

  it("AC-2 — ties the stamping condition to plan.md `## Not Doing (and why)`", () => {
    const scopeDriftBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "scope-drift"
    );
    expect(scopeDriftBullet).toMatch(/## Not Doing/);
  });

  it("AC-3 — points the reviewer at the companion skill body", () => {
    const scopeDriftBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "scope-drift"
    );
    expect(scopeDriftBullet).toMatch(/reviewer-axis-scope-drift/);
  });
});

describe("v8.94 — start-command.ts stamps walkAssumptionCoverageAxis (G-4)", () => {
  it("AC-1 — names the `walkAssumptionCoverageAxis: true` envelope flag", () => {
    expect(START_COMMAND_BODY).toContain("walkAssumptionCoverageAxis: true");
  });

  it("AC-2 — ties the stamping condition to plan.md `## Key assumptions to validate`", () => {
    const acBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "assumption-coverage"
    );
    expect(acBullet).toMatch(/## Key assumptions to validate/);
  });

  it("AC-3 — references the `KA-N` id requirement (v8.85 stable assumption-row id)", () => {
    const acBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "assumption-coverage"
    );
    expect(acBullet).toMatch(/KA-N/);
  });

  it("AC-4 — points the reviewer at the companion skill body", () => {
    const acBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "assumption-coverage"
    );
    expect(acBullet).toMatch(/reviewer-axis-assumption-coverage/);
  });
});

describe("v8.94 — start-command.ts stamps walkAntiSlopAxis (G-5, default-on)", () => {
  it("AC-1 — names the `walkAntiSlopAxis: true` envelope flag", () => {
    expect(START_COMMAND_BODY).toContain("walkAntiSlopAxis: true");
  });

  it("AC-2 — frames the gate as default-on (every reviewer dispatch unless explicitly disabled)", () => {
    const antiSlopBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "anti-slop"
    );
    expect(antiSlopBullet).toMatch(/default-on/i);
    expect(antiSlopBullet).toMatch(/every/i);
  });

  it("AC-3 — names an explicit disable route (config knob or CLI flag)", () => {
    const antiSlopBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "anti-slop"
    );
    expect(antiSlopBullet).toMatch(/walkAntiSlopAxis.*false|--no-anti-slop|anti_slop: false/);
  });

  it("AC-4 — points the reviewer at the companion skill body", () => {
    const antiSlopBullet = extractAutoActivateBullet(
      START_COMMAND_BODY,
      "anti-slop"
    );
    expect(antiSlopBullet).toMatch(/reviewer-axis-anti-slop/);
  });
});

describe("v8.94 — all four envelope flags appear in a consistent `Auto-activate <axis> axis (vX.Y)` pattern", () => {
  const AUTO_ACTIVATE_PATTERN = /\*\*Auto-activate ([a-z-]+) axis \(v8\.\d+(?:, [a-z-]+)?\)\.\*\*/g;

  it("AC-1 — all four expected axis names appear as `Auto-activate <axis> axis (vX.Y)` bullets", () => {
    const matches = [...START_COMMAND_BODY.matchAll(AUTO_ACTIVATE_PATTERN)].map(
      (m) => m[1]
    );
    expect(matches).toEqual(
      expect.arrayContaining([
        "design-quality",
        "scope-drift",
        "assumption-coverage",
        "anti-slop"
      ])
    );
  });

  it("AC-2 — each Auto-activate bullet names the envelope flag it stamps", () => {
    const axisToFlag: Record<string, string> = {
      "design-quality": "walkDesignQualityAxis",
      "scope-drift": "walkScopeDriftAxis",
      "assumption-coverage": "walkAssumptionCoverageAxis",
      "anti-slop": "walkAntiSlopAxis"
    };
    for (const [axis, flag] of Object.entries(axisToFlag)) {
      const bullet = extractAutoActivateBullet(START_COMMAND_BODY, axis);
      expect(bullet, `bullet for ${axis} should name ${flag}`).toContain(flag);
    }
  });

  it("AC-3 — the four Auto-activate bullets sit contiguously in the `#### review` section", () => {
    const reviewSectionStart = START_COMMAND_BODY.indexOf("#### review");
    expect(reviewSectionStart).toBeGreaterThan(0);
    const reviewSectionEnd = START_COMMAND_BODY.indexOf(
      "#### critic",
      reviewSectionStart
    );
    expect(reviewSectionEnd).toBeGreaterThan(reviewSectionStart);
    const reviewSection = START_COMMAND_BODY.slice(
      reviewSectionStart,
      reviewSectionEnd
    );
    const bulletsInSection = [
      ...reviewSection.matchAll(AUTO_ACTIVATE_PATTERN)
    ].map((m) => m[1]);
    expect(bulletsInSection).toEqual([
      "design-quality",
      "scope-drift",
      "assumption-coverage",
      "anti-slop"
    ]);
  });
});

/**
 * Extract the `- **Auto-activate <axis> axis (vX.Y)...** ...` bullet
 * for a given axis name from START_COMMAND_BODY. Returns the bullet
 * text from the start marker up to the next `\n- ` or `\n#` boundary,
 * whichever comes first.
 */
function extractAutoActivateBullet(body: string, axis: string): string {
  const startMarker = `**Auto-activate ${axis} axis (`;
  const start = body.indexOf(startMarker);
  if (start === -1) {
    throw new Error(`Auto-activate bullet for axis '${axis}' not found in body`);
  }
  const tail = body.slice(start);
  const nextBullet = tail.search(/\n- |\n#/);
  return nextBullet === -1 ? tail : tail.slice(0, nextBullet);
}
