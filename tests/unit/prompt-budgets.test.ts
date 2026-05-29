import { describe, expect, it } from "vitest";

import { SPECIALIST_PROMPTS, RESEARCH_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * Agent-facing size ratchet.
 *
 * Every string that ships to an LLM (specialist prompts, the orchestrator
 * body, on-demand runbooks, artifact templates, auto-trigger skills) carries
 * a hard ceiling. The ceiling sits ~15% above the current size, so ordinary
 * edits pass but runaway growth fails CI and forces a deliberate decision.
 *
 * This is the guardrail that keeps cclaw lean: prompts may only grow when a
 * new capability justifies it.
 *
 * To raise a budget:
 *   1. Make the growth a deliberate, reviewed change.
 *   2. Re-measure and update the number here in the same commit, leaving
 *      ~15% headroom over the new size.
 *
 * Do NOT record per-version growth notes in this file — the ceiling number
 * is the contract; git history is the changelog.
 */

interface Budget {
  id: string;
  body: string;
  maxLines: number;
  maxChars: number;
}

const lines = (s: string): number => s.split("\n").length;

const SPECIALIST_BUDGETS: ReadonlyArray<Omit<Budget, "body"> & { body: string }> = [
  { id: "architect", body: SPECIALIST_PROMPTS.architect, maxLines: 810, maxChars: 98000 },
  { id: "builder", body: SPECIALIST_PROMPTS.builder, maxLines: 920, maxChars: 110000 },
  { id: "reviewer", body: SPECIALIST_PROMPTS.reviewer, maxLines: 580, maxChars: 79000 },
  { id: "critic", body: SPECIALIST_PROMPTS.critic, maxLines: 585, maxChars: 68000 },
  { id: "investigator", body: SPECIALIST_PROMPTS.investigator, maxLines: 575, maxChars: 79000 },
  { id: "plan-critic", body: SPECIALIST_PROMPTS["plan-critic"], maxLines: 605, maxChars: 63000 },
  { id: "qa-runner", body: SPECIALIST_PROMPTS["qa-runner"], maxLines: 310, maxChars: 30000 },
  { id: "triage", body: SPECIALIST_PROMPTS.triage, maxLines: 350, maxChars: 48000 },
  { id: "start-command", body: START_COMMAND_BODY, maxLines: 346, maxChars: 55000 }
];

const RESEARCH_BUDGETS: ReadonlyArray<Omit<Budget, "body"> & { body: string }> = [
  { id: "learnings-research", body: RESEARCH_PROMPTS.find((p) => p.id === "learnings-research")!.body, maxLines: 150, maxChars: 9000 },
  { id: "repo-research", body: RESEARCH_PROMPTS.find((p) => p.id === "repo-research")!.body, maxLines: 140, maxChars: 8000 }
];

// Per-item maxima + corpus totals. The per-item max catches one file
// bloating; the total catches death-by-a-thousand-cuts across the corpus.
const RUNBOOK_MAX_CHARS = 33000;
const RUNBOOK_TOTAL_CHARS = 300000;
const TEMPLATE_MAX_CHARS = 31000;
const TEMPLATE_TOTAL_CHARS = 125000;
const SKILL_MAX_CHARS = 66000;
const SKILL_TOTAL_CHARS = 520000;
const SPECIALIST_COMBINED_MAX_LINES = 8000;

const overBudget = (id: string, kind: string, actual: number, max: number): string =>
  `${id} ${kind} is ${actual} (budget ${max}). If this growth is justified, re-measure and raise the budget in tests/unit/prompt-budgets.test.ts (leave ~15% headroom).`;

describe("agent-facing size ratchet", () => {
  it.each([...SPECIALIST_BUDGETS, ...RESEARCH_BUDGETS])(
    "$id stays under its line + char budget",
    ({ id, body, maxLines, maxChars }) => {
      expect(lines(body), overBudget(id, "lines", lines(body), maxLines)).toBeLessThanOrEqual(maxLines);
      expect(body.length, overBudget(id, "chars", body.length, maxChars)).toBeLessThanOrEqual(maxChars);
    }
  );

  it("each on-demand runbook stays under the per-runbook char budget", () => {
    for (const r of ON_DEMAND_RUNBOOKS) {
      const id = r.id ?? r.fileName;
      expect(r.body.length, overBudget(`runbook:${id}`, "chars", r.body.length, RUNBOOK_MAX_CHARS)).toBeLessThanOrEqual(
        RUNBOOK_MAX_CHARS
      );
    }
  });

  it("each artifact template stays under the per-template char budget", () => {
    for (const t of ARTIFACT_TEMPLATES) {
      expect(t.body.length, overBudget(`template:${t.id}`, "chars", t.body.length, TEMPLATE_MAX_CHARS)).toBeLessThanOrEqual(
        TEMPLATE_MAX_CHARS
      );
    }
  });

  it("each auto-trigger skill stays under the per-skill char budget", () => {
    for (const k of AUTO_TRIGGER_SKILLS) {
      const body = k.body ?? "";
      expect(body.length, overBudget(`skill:${k.id}`, "chars", body.length, SKILL_MAX_CHARS)).toBeLessThanOrEqual(
        SKILL_MAX_CHARS
      );
    }
  });

  it("corpus totals stay under their ceilings (no death-by-a-thousand-cuts)", () => {
    const runbookTotal = ON_DEMAND_RUNBOOKS.reduce((a, r) => a + r.body.length, 0);
    const templateTotal = ARTIFACT_TEMPLATES.reduce((a, t) => a + t.body.length, 0);
    const skillTotal = AUTO_TRIGGER_SKILLS.reduce((a, k) => a + (k.body ?? "").length, 0);
    expect(runbookTotal, overBudget("runbooks (corpus)", "chars", runbookTotal, RUNBOOK_TOTAL_CHARS)).toBeLessThanOrEqual(
      RUNBOOK_TOTAL_CHARS
    );
    expect(templateTotal, overBudget("templates (corpus)", "chars", templateTotal, TEMPLATE_TOTAL_CHARS)).toBeLessThanOrEqual(
      TEMPLATE_TOTAL_CHARS
    );
    expect(skillTotal, overBudget("skills (corpus)", "chars", skillTotal, SKILL_TOTAL_CHARS)).toBeLessThanOrEqual(
      SKILL_TOTAL_CHARS
    );
  });

  it("combined specialist + research prompt body stays under the soft line ceiling", () => {
    const total = [...SPECIALIST_BUDGETS, ...RESEARCH_BUDGETS]
      .map(({ body }) => lines(body))
      .reduce((a, b) => a + b, 0);
    expect(
      total,
      `Combined specialist + research prompt body is ${total} lines (soft ceiling ${SPECIALIST_COMBINED_MAX_LINES}). ` +
        `If you cross this, restructure into shared interpolated fragments rather than raising the ceiling.`
    ).toBeLessThanOrEqual(SPECIALIST_COMBINED_MAX_LINES);
  });
});
