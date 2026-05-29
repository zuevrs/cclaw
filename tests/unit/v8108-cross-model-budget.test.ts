import { describe, expect, it } from "vitest";

import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/index.js";

/**
 * v8.108 — F-1: cross-model critic prompt-budget awareness.
 *
 * v8.72's `## Cross-model second opinion` dispatch (Codex / Gemini MCP)
 * had zero pre-dispatch budget awareness — a small-context second-opinion
 * model on a `securityFlag` / `Reversibility: one-way` slug would
 * silently truncate the assembled prompt and return findings against an
 * incomplete view. v8.108 adds the gsd-v1 #3081 / `6a5fa591`
 * priority-drop + refuse-and-skip pattern to the critic.ts §3.5 block,
 * plus the `critic.cross_model_min_context` config knob (default 16000
 * characters ≈ 4k tokens).
 *
 * The dispatch itself is LLM-executed (the critic specialist runs in a
 * sub-agent and reads these instructions verbatim from the prompt
 * body), so the tests below are tripwires on the prompt body's
 * declarations — the same shape as v8.72's existing cross-model gate
 * tests in `critic-specialist.test.ts`.
 */

describe("v8.108 F-1 — critic prompt declares pre-dispatch budget awareness in §3.5", () => {
  const sectionIdx = CRITIC_PROMPT.indexOf("§3.5. Cross-model second opinion");
  const sectionEnd = CRITIC_PROMPT.indexOf("§4. Criterion check");
  const section = CRITIC_PROMPT.slice(sectionIdx, sectionEnd);

  it("CONTRACT — §3.5 names `critic.cross_model_min_context` (the config knob) and the 16000-char default", () => {
    expect(sectionIdx).toBeGreaterThan(0);
    expect(sectionEnd).toBeGreaterThan(sectionIdx);
    expect(section).toMatch(/critic\.cross_model_min_context/);
    expect(section).toMatch(/16000/);
    expect(section).toMatch(/4 chars(\b|\/|\s)|chars\s*\/\s*4|chars-per-token|characters[\s\S]{0,80}4/iu);
  });

  it("SCENARIO A (within budget) — §3.5 declares the no-trim no-disclosure path when `estimate ≤ budget`", () => {
    expect(section).toMatch(/estimate ≤ budget/u);
    expect(section).toMatch(/dispatch[\s\S]{0,40}as-is/u);
    expect(section).toMatch(/no disclosure/u);
  });

  it("SCENARIO B (over budget, min-set fits) — §3.5 declares the priority-drop trim list in the canonical order (priorLearnings → researchExcerpts → plan.md → review.md), the min-set definition, and the disclosure stamp in critic.md frontmatter", () => {
    expect(section).toMatch(/priority-drop|priority drop/iu);
    const trim = section.indexOf("First drop");
    expect(trim).toBeGreaterThan(0);
    const trimBlock = section.slice(trim, trim + 2500);
    const lIdx = trimBlock.indexOf("priorLearnings");
    const rIdx = trimBlock.indexOf("researchExcerpts");
    const pIdx = trimBlock.indexOf("plan.md");
    const rvIdx = trimBlock.indexOf("review.md");
    expect(lIdx).toBeGreaterThan(0);
    expect(rIdx).toBeGreaterThan(lIdx);
    expect(pIdx).toBeGreaterThan(rIdx);
    expect(rvIdx).toBeGreaterThan(pIdx);

    expect(trimBlock).toMatch(/top-3|top 3/u);
    expect(trimBlock).toMatch(/AC[ -]?N|D[ -]?N/u);
    expect(trimBlock).toMatch(/Plan summary|slim plan|slim summary/iu);
    expect(trimBlock).toMatch(/axis-verdict|axis verdicts/iu);

    expect(section).toMatch(/min(imum)?[ -]?set/u);
    expect(section).toMatch(/critic\.md body \+ axisGate \+ skillsBlock \+ slim plan/u);
    expect(section).toMatch(/cross_model_trim_disclosure/u);
    expect(section).toMatch(/frontmatter/u);
  });

  it("SCENARIO C (min-set overflow) — §3.5 declares the refuse-and-skip branch, stamps `cross_model_skipped_reason: budget` in critic.md frontmatter, declares the §7 rollup line, and explicitly states ship is NOT blocked by a budget refuse", () => {
    expect(section).toMatch(/REFUSE-and-SKIP|refuse-and-skip|refuse and skip/iu);
    expect(section).toMatch(/cross_model_skipped_reason:\s*budget/u);
    expect(section).toMatch(/(?:does NOT block ship|not.{0,30}block ship|ship.{0,30}not.{0,30}block)/iu);
    expect(section).toMatch(/Cross-model:\s*skipped \(budget overflow\)/u);
    expect(section).toMatch(/Confidence:\s*medium/u);
  });

  it("CITATION — §3.5 cites the gsd-v1 #3081 / `6a5fa591` pattern explicitly so the audit trail is anchored", () => {
    expect(section).toMatch(/gsd-v1[\s\S]{0,30}(#3081|6a5fa591)/u);
  });

  it("DECISION TREE — §3.5 carries the three-branch decision tree verbatim (estimate ≤ budget / estimate > budget AND min-set ≤ budget / min-set > budget)", () => {
    expect(section).toMatch(/estimate ≤ budget[\s\S]{0,120}dispatch as-is/u);
    expect(section).toMatch(/estimate > budget AND min-set ≤ budget[\s\S]{0,120}(trim|priority-drop)/u);
    expect(section).toMatch(/min-set > budget[\s\S]{0,120}(refuse|skip)/u);
  });
});

describe("v8.108 F-1 — preserves v8.72/v8.74 cross-model gate contract (no regression)", () => {
  it("REGRESSION — the §3.5 block still declares crossModelCritic flag, the Reversibility:one-way primary trigger, the --critic-cross-model user flag, the `Cross-model unavailable: skipped.` MCP-absent fallback, and X-F-N findings numbering", () => {
    expect(CRITIC_PROMPT).toMatch(/crossModelCritic/u);
    expect(CRITIC_PROMPT).toMatch(/Reversibility:\s*one-way/u);
    expect(CRITIC_PROMPT).toMatch(/--critic-cross-model/u);
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/u);
    expect(CRITIC_PROMPT).toMatch(/X-F-N/u);
    expect(CRITIC_PROMPT).toMatch(/## Cross-model second opinion/u);
  });
});
