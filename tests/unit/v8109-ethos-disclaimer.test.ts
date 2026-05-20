import { describe, expect, it } from "vitest";
import {
  ARCHITECT_PROMPT,
  BUILDER_PROMPT,
  CRITIC_PROMPT,
  ETHOS_DISCLAIMER,
  INVESTIGATOR_PROMPT,
  PLAN_CRITIC_PROMPT,
  QA_RUNNER_PROMPT,
  REVIEWER_PROMPT,
  SPECIALIST_PROMPTS,
  TRIAGE_PROMPT
} from "../../src/content/specialist-prompts/index.js";

/**
 * v8.109 — ETHOS_DISCLAIMER extracted to a shared constant in
 * `src/content/specialist-prompts/ethos-disclaimer.ts`. All 8
 * specialist prompts now reference the canonical one-line pointer
 * verbatim. Pre-v8.109 the line was duplicated across 6 of 8
 * prompts (with phrasing drift risk) and missing from reviewer +
 * investigator.
 */
describe("v8.109 — ETHOS_DISCLAIMER shared constant", () => {
  it("the constant cites the five cclaw principles + the `.cclaw/lib/cclaw-ethos.md` path", () => {
    expect(ETHOS_DISCLAIMER).toContain("Boil the Lake");
    expect(ETHOS_DISCLAIMER).toContain("Search Before Building");
    expect(ETHOS_DISCLAIMER).toContain("Surgical Edits");
    expect(ETHOS_DISCLAIMER).toContain("User Sovereignty");
    expect(ETHOS_DISCLAIMER).toContain("3 knowledge layers");
    expect(ETHOS_DISCLAIMER).toContain(".cclaw/lib/cclaw-ethos.md");
    expect(ETHOS_DISCLAIMER).toContain("Required ethos read");
  });

  it("all 8 specialist prompts contain the ETHOS_DISCLAIMER substring", () => {
    const prompts = {
      triage: TRIAGE_PROMPT,
      investigator: INVESTIGATOR_PROMPT,
      architect: ARCHITECT_PROMPT,
      builder: BUILDER_PROMPT,
      "plan-critic": PLAN_CRITIC_PROMPT,
      "qa-runner": QA_RUNNER_PROMPT,
      reviewer: REVIEWER_PROMPT,
      critic: CRITIC_PROMPT
    };
    for (const [id, body] of Object.entries(prompts)) {
      expect(body, `${id} prompt should contain ETHOS_DISCLAIMER`).toContain(ETHOS_DISCLAIMER);
    }
  });

  it("SPECIALIST_PROMPTS map carries the disclaimer in every entry", () => {
    for (const [id, body] of Object.entries(SPECIALIST_PROMPTS)) {
      expect(body, `${id} prompt should contain ETHOS_DISCLAIMER`).toContain(ETHOS_DISCLAIMER);
    }
  });

  it("the disclaimer appears exactly once per prompt (no drift / no inlined duplicate)", () => {
    for (const [id, body] of Object.entries(SPECIALIST_PROMPTS)) {
      const count = body.split(ETHOS_DISCLAIMER).length - 1;
      expect(count, `${id} prompt should contain the disclaimer exactly once`).toBe(1);
    }
  });
});
