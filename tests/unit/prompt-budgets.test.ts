import { describe, expect, it } from "vitest";

import {
  DESIGN_PROMPT,
  AC_AUTHOR_PROMPT,
  REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  SLICE_BUILDER_PROMPT,
  RESEARCH_PROMPTS
} from "../../src/content/specialist-prompts/index.js";

/**
 * Per-prompt size budgets — T2-2 (gsd-v1, obra patterns).
 *
 * Each specialist prompt body has a hard upper bound. The test fails when a
 * prompt grows past its budget and forces a deliberate "is this growth
 * justified?" decision rather than letting prompts drift past the LLM's
 * comfortable working-context window for that specialist's role.
 *
 * When a budget needs raising:
 *   1. Justify the growth in the same PR (CHANGELOG entry naming the new
 *      capability).
 *   2. Update the budget here in the same commit.
 *   3. Re-measure: budgets should leave 15-25% headroom over current size.
 *
 * Budgets are expressed in BOTH lines and characters because long lines
 * (e.g., a prose paragraph) inflate chars without inflating lines, and
 * short lines (e.g., a code block) inflate lines without inflating chars.
 * Both axes catch different runaway-growth patterns.
 */

interface PromptBudget {
  id: string;
  body: string;
  maxLines: number;
  maxChars: number;
}

const PROMPT_BUDGETS: PromptBudget[] = [
  {
    id: "design",
    body: DESIGN_PROMPT,
    maxLines: 460,
    maxChars: 32000
  },
  {
    id: "ac-author",
    body: AC_AUTHOR_PROMPT,
    maxLines: 600,
    maxChars: 56000
  },
  {
    id: "reviewer",
    body: REVIEWER_PROMPT,
    maxLines: 660,
    maxChars: 62000
  },
  {
    id: "security-reviewer",
    body: SECURITY_REVIEWER_PROMPT,
    maxLines: 240,
    maxChars: 19000
  },
  {
    id: "slice-builder",
    body: SLICE_BUILDER_PROMPT,
    // v8.40 raised the slice-builder budget from 56000 to 60000 chars.
    // The full hooks removal moved mechanical commit-helper enforcement
    // out of the .mjs file and into prompt-level discipline: the prompt
    // now teaches the posture-driven commit-prefix recipe, the reviewer's
    // git-log inspection contract, the strict-mode commit-shape table,
    // and the v8.40-specific anti-rationalization rows that previously
    // lived in the hook's error messages. The growth is justified in
    // CHANGELOG.md (v8.40 — full hooks removal).
    maxLines: 720,
    maxChars: 60000
  }
];

const RESEARCH_BUDGETS: PromptBudget[] = [
  {
    id: "learnings-research",
    body: RESEARCH_PROMPTS.find((p) => p.id === "learnings-research")!.body,
    maxLines: 150,
    maxChars: 9000
  },
  {
    id: "repo-research",
    body: RESEARCH_PROMPTS.find((p) => p.id === "repo-research")!.body,
    maxLines: 140,
    maxChars: 8000
  }
];

describe("specialist prompt size budgets", () => {
  it.each(PROMPT_BUDGETS)("$id stays under its line + char budget", ({ id, body, maxLines, maxChars }) => {
    const lines = body.split("\n").length;
    const chars = body.length;
    expect(
      lines,
      `${id} prompt has ${lines} lines (budget ${maxLines}). If this growth is justified, raise the budget in tests/unit/prompt-budgets.test.ts and document the new capability in CHANGELOG.md.`
    ).toBeLessThanOrEqual(maxLines);
    expect(
      chars,
      `${id} prompt has ${chars} chars (budget ${maxChars}). If this growth is justified, raise the budget in tests/unit/prompt-budgets.test.ts and document the new capability in CHANGELOG.md.`
    ).toBeLessThanOrEqual(maxChars);
  });

  it.each(RESEARCH_BUDGETS)("research helper $id stays under its budget", ({ id, body, maxLines, maxChars }) => {
    const lines = body.split("\n").length;
    const chars = body.length;
    expect(lines, `${id} research prompt: ${lines} lines (budget ${maxLines})`).toBeLessThanOrEqual(maxLines);
    expect(chars, `${id} research prompt: ${chars} chars (budget ${maxChars})`).toBeLessThanOrEqual(maxChars);
  });

  it("no specialist prompt exceeds the soft prompt-context ceiling (8000 lines combined)", () => {
    const totalLines = [...PROMPT_BUDGETS, ...RESEARCH_BUDGETS]
      .map(({ body }) => body.split("\n").length)
      .reduce((a, b) => a + b, 0);
    expect(
      totalLines,
      `Combined specialist + research prompt body is ${totalLines} lines. The soft ceiling is 8000 — if you cross this, restructure into shared fragments rather than raising the ceiling.`
    ).toBeLessThanOrEqual(8000);
  });
});
