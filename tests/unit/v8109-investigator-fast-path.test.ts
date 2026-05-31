import { describe, expect, test } from "vitest";
import { INVESTIGATOR_PROMPT } from "../../src/content/specialist-prompts/investigator.js";

describe("v8.109 — investigator trivial-bug fast-path parses file refs (B.8)", () => {
  test("Phase 0.4 criterion 1 says 'explicit file reference' (not substring count)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/explicit file reference/i);
    expect(INVESTIGATOR_PROMPT).toContain("path/to/file.ext:LINE");
  });

  test("Phase 0.4 enumerates the canonical file-reference shapes", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/file:line citation/i);
    expect(INVESTIGATOR_PROMPT).toMatch(/backtick-quoted relative path/i);
    expect(INVESTIGATOR_PROMPT).toMatch(/stack traces/i);
  });

  test("Phase 0.4 requires set-based dedupe with size === 1", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/set size must be exactly 1/i);
  });

  test("defense-in-depth bypass guard explicitly precedes the activation gate", () => {
    const orderingIdx = INVESTIGATOR_PROMPT.indexOf("Order of evaluation");
    const bypassIdx = INVESTIGATOR_PROMPT.indexOf(
      "Mandatory non-skip on defense-in-depth signals",
    );
    const activationIdx = INVESTIGATOR_PROMPT.indexOf("Activation gate (CONDITIONAL");
    expect(orderingIdx).toBeGreaterThan(-1);
    expect(activationIdx).toBeGreaterThan(orderingIdx);
    expect(bypassIdx).toBeGreaterThan(-1);
    expect(INVESTIGATOR_PROMPT).toMatch(/defense-in-depth bypass guard.*ALWAYS runs FIRST/);
  });

  test("preserves the #311 lesson reference", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/#311/);
  });

  test("bypass guard names recurrence ≥3 and catastrophic-if-prod signals", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/Recurrence count ≥ 3/);
    expect(INVESTIGATOR_PROMPT).toMatch(/Catastrophic-if-prod keywords/);
  });
});
