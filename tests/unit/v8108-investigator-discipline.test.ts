import { describe, expect, it } from "vitest";

import { INVESTIGATOR_PROMPT } from "../../src/content/specialist-prompts/index.js";

/**
 * v8.108 — F-9: investigator hypothesis discipline.
 *
 * Aligns cclaw's `investigator.ts` (v8.77 three-lane + v8.81 audit
 * + defense-in-depth + post-mortem) with everyinc-compound ce-debug
 * `6fc57c50` improvements:
 *
 * 1. **Concrete observation (falsifier) per hypothesis** — every lane's
 *    Hypothesis must carry the specific observation that would prove
 *    it wrong. cclaw's surface is the falsifier dual of upstream's
 *    "concrete observation that supports it" — symmetric anchor.
 * 2. **Phase 0.4 trivial-bug fast-path** — single-file + clear-cause
 *    keyword + one-line fix skips the lanes. MUST preserve the v8.81 +
 *    #311 defense-in-depth gate: recurrence ≥ 3 OR catastrophic-if-prod
 *    keywords force the full lane discipline regardless of fast-path
 *    criteria.
 * 3. **Phase 1.5 rationalization-phrase spotter** — 7 canonical phrases
 *    flagged as low-confidence advisory after lanes return; non-blocking,
 *    but the synthesis recalibrates confidence in light of the signal.
 */

describe("v8.108 F-9 — concrete-observation falsifier per hypothesis", () => {
  it("CONTRACT — the lane format declares the concrete-observation requirement (Popperian falsifier: a specific named observation that would PROVE the hypothesis wrong), with the gsd-style citation forms (logs / git log / file content / command output)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(
      /Concrete observation that would FALSIFY this hypothesis/u
    );
    const idx = INVESTIGATOR_PROMPT.indexOf(
      "Concrete observation that would FALSIFY this hypothesis"
    );
    const block = INVESTIGATOR_PROMPT.slice(idx, idx + 2000);
    expect(block).toMatch(/logs/u);
    expect(block).toMatch(/git log/u);
    expect(block).toMatch(/file content/u);
    expect(block).toMatch(/command output/u);
    expect(block).toMatch(/falsifi(er|ed|es)/iu);
    expect(block).toMatch(/Popperian|falsifier|prove.{0,20}wrong/u);
  });

  it("CITATION — investigator prompt cites everyinc-compound ce-debug 6fc57c50 as the upstream pattern for the concrete-observation discipline", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/6fc57c50/u);
    expect(INVESTIGATOR_PROMPT).toMatch(/ce-debug/u);
  });
});

describe("v8.108 F-9 — trivial-bug fast-path (Phase 0.4)", () => {
  const phase04Idx = INVESTIGATOR_PROMPT.indexOf("### Phase 0.4");
  const phase05Idx = INVESTIGATOR_PROMPT.indexOf("### Phase 0.5");
  const phase04 = INVESTIGATOR_PROMPT.slice(phase04Idx, phase05Idx);

  it("STRUCTURE — Phase 0.4 fires BEFORE Phase 0.5 assumption audit (the fast-path is the earliest gate; runs before the audit's belief-table is even composed)", () => {
    expect(phase04Idx).toBeGreaterThan(0);
    expect(phase05Idx).toBeGreaterThan(phase04Idx);
    expect(phase04).toMatch(/Trivial-bug fast-path/u);
  });

  it("GATE — Phase 0.4 names the single-file + clear-cause-keyword + one-line-fix criteria (all three must hold)", () => {
    expect(phase04).toMatch(/[Ee]xactly ONE file|single-file|one file path/u);
    expect(phase04).toMatch(/clear-cause keyword/u);
    expect(phase04).toMatch(/one-line edit|one-line fix|single-symbol rename/u);
  });

  it("CLEAR-CAUSE KEYWORDS — Phase 0.4 enumerates the canonical clear-cause classes (null pointer / typo / missing import / off-by-one / wrong type)", () => {
    expect(phase04).toMatch(/null pointer/u);
    expect(phase04).toMatch(/typo/u);
    expect(phase04).toMatch(/missing import/u);
    expect(phase04).toMatch(/off-by-one/u);
    expect(phase04).toMatch(/wrong type/u);
  });

  it("DEFENSE-IN-DEPTH PRESERVATION — Phase 0.4 explicitly preserves the v8.81 + #311 critical fix: recurrence ≥ 3 OR catastrophic-if-prod keywords FORCE the full lane discipline (the fast-path does NOT bypass defense-in-depth)", () => {
    expect(phase04).toMatch(/[Rr]ecurrence count ≥ 3|recurrence ≥ 3|≥3 other files/u);
    expect(phase04).toMatch(/[Cc]atastrophic-if-prod/u);
    expect(phase04).toMatch(/data loss|security breach|payment/u);
    expect(phase04).toMatch(
      /(NEVER fires|does NOT (fire|bypass)|mandatory|MUST run|force.{0,30}lane|fall back to (the )?full)/iu
    );
    expect(phase04).toMatch(/v8\.81|#311/u);
  });

  it("ACTION — Phase 0.4 declares the SKIP behaviour for Phase 0.5 / Phase 1 / Phase 2 when the fast-path fires, and the slim summary's required Notes naming the fast-path firing", () => {
    expect(phase04).toMatch(/SKIP Phase 0\.5/u);
    expect(phase04).toMatch(/SKIP Phase 1/u);
    expect(phase04).toMatch(/cause-code=fast-path/u);
    expect(phase04).toMatch(/cause-config=fast-path/u);
    expect(phase04).toMatch(/cause-measurement=fast-path/u);
    expect(phase04).toMatch(/Next step:\s*direct-fix/u);
    expect(phase04).toMatch(/Notes:[\s\S]{0,40}(mandatory|fast-path fired)/u);
  });

  it("SAFETY — Phase 0.4 explicitly says when in doubt, do NOT fire (the lane discipline on a true trivial bug is cheap; misfire is costly)", () => {
    expect(phase04).toMatch(/[Ww]hen in doubt/u);
    expect(phase04).toMatch(/do NOT fire|fall back|safe default/u);
  });
});

describe("v8.108 F-9 — rationalization-phrase spotter (Phase 1.5)", () => {
  const phase15Idx = INVESTIGATOR_PROMPT.indexOf("### Phase 1.5");
  const phase2Idx = INVESTIGATOR_PROMPT.indexOf("### Phase 2 — Synthesis");
  const phase15 = INVESTIGATOR_PROMPT.slice(phase15Idx, phase2Idx);

  it("STRUCTURE — Phase 1.5 fires AFTER lanes (Phase 1) and BEFORE synthesis (Phase 2) — the closing check on hypothesis language sits between evidence collection and cross-lane distillation", () => {
    const phase1Idx = INVESTIGATOR_PROMPT.indexOf("### Phase 1 — Hypothesis lane fan-out");
    expect(phase1Idx).toBeGreaterThan(0);
    expect(phase15Idx).toBeGreaterThan(phase1Idx);
    expect(phase2Idx).toBeGreaterThan(phase15Idx);
    expect(phase15).toMatch(/Rationalization-phrase spotter/u);
  });

  it("CANONICAL 7 PHRASES — Phase 1.5 names the seven canonical rationalization phrases verbatim (this should / I think / probably / might be / seems to / likely / appears to)", () => {
    expect(phase15).toMatch(/`this should`/u);
    expect(phase15).toMatch(/`I think`/u);
    expect(phase15).toMatch(/`probably`/u);
    expect(phase15).toMatch(/`might be`/u);
    expect(phase15).toMatch(/`seems to`/u);
    expect(phase15).toMatch(/`likely`/u);
    expect(phase15).toMatch(/`appears to`/u);
  });

  it("ADVISORY — Phase 1.5 declares the spotter as ADVISORY (non-blocking), tags lanes with `low-confidence` when a phrase fires, and requires the slim summary's Notes to name the lane + the phrase", () => {
    expect(phase15).toMatch(/advisory|NOT blocking|non-blocking/iu);
    expect(phase15).toMatch(/low-confidence/u);
    expect(phase15).toMatch(
      /Notes:[\s\S]{0,200}(lane|cause-code|cause-config|cause-measurement)[\s\S]{0,200}phrase/u
    );
    expect(phase15).toMatch(/mandatory/u);
  });

  it("DEFINITE LANGUAGE — Phase 1.5 cites the canonical definite-language shape (named path + named cause + observed state + named scope) so high-confidence hypotheses have a positive contract, not just an absence-of-rationalization contract", () => {
    expect(phase15).toMatch(/definite language|definite-language/u);
    expect(phase15).toMatch(/named cause|named scope|named path|observed state/u);
  });

  it("CITATION — Phase 1.5 cites the upstream ce-debug 6fc57c50 rationalization preview (the load-time preview of rationalization phrases that the upstream commit introduced)", () => {
    expect(phase15).toMatch(/6fc57c50/u);
    expect(phase15).toMatch(/ce-debug/u);
  });
});

describe("v8.108 F-9 — preserves v8.77 + v8.81 contract (no regression)", () => {
  it("REGRESSION — investigator prompt still declares the v8.77 three-lane fan-out (cause-code / cause-config / cause-measurement), the v8.81 assumption audit (always runs unless fast-path), the v8.81 defense-in-depth phase, the v8.81 post-mortem phase, and the four-verdict slim-summary contract (direct-fix / needs-plan / more-investigation / not-a-bug)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/cause-code/u);
    expect(INVESTIGATOR_PROMPT).toMatch(/cause-config/u);
    expect(INVESTIGATOR_PROMPT).toMatch(/cause-measurement/u);
    expect(INVESTIGATOR_PROMPT).toMatch(/Phase 0\.5 — Assumption audit/u);
    expect(INVESTIGATOR_PROMPT).toMatch(/Phase 4 — Defense-in-depth tier/u);
    expect(INVESTIGATOR_PROMPT).toMatch(/Phase 5 — Post-mortem/u);
    for (const verdict of ["direct-fix", "needs-plan", "more-investigation", "not-a-bug"]) {
      expect(INVESTIGATOR_PROMPT).toMatch(new RegExp(`\\b${verdict}\\b`, "u"));
    }
  });
});
