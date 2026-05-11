import { describe, expect, it } from "vitest";

import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.26 — skill anatomy enforcement.
 *
 * addyosmani-style skills follow a consistent anatomy: Overview / When to
 * Use / Process / Common Rationalizations / Red Flags / Verification.
 * Cclaw's 17 skills evolved organically and have uneven structure — some
 * carry every anatomy section under custom headings, others miss one or
 * two slots. The audit produced a per-skill gap list; v8.26 patches the
 * gaps and installs this tripwire so a future refactor cannot silently
 * drop a section.
 *
 * The rubric is intentionally permissive — equivalent heading names
 * count. For example, "Common pitfalls" satisfies "Red flags",
 * "Anti-rationalization table" satisfies "Common rationalizations",
 * "Worked example" satisfies "Verification". The four "depth" slots
 * (Process, Rationalizations, Red Flags, Verification) require **at
 * least two of the four** — short reference docs (e.g.
 * `refinement.md`, `pre-flight-assumptions.md`) can carry stub headings
 * with a one-line pointer body instead of bloating with new content.
 */

const ALL_SKILLS = AUTO_TRIGGER_SKILLS.map((s) => ({
  fileName: s.fileName,
  body: s.body,
}));

interface AnatomyResult {
  hasOverview: boolean;
  hasWhen: boolean;
  hasProcess: boolean;
  hasRationalizations: boolean;
  hasRedFlags: boolean;
  hasVerification: boolean;
  depthCount: number;
}

const WHEN_HEADING = /^##\s+(When |Applies\b|Triggers\b)/m;
const PROCESS_HEADING =
  /^##\s+(Process\b|Phase \d|Rules\b|Rules for |The (three|four|five) (phases|steps|rules)|How to run|Heuristics\b|.*-step process|Format\b|Execution\b|Steps\b|How to invoke|How to apply|How to detect|Detection\b|The four-step process\b|Resume rules\b|Pre-conditions\b|Plan stage on |Phase 1 |Phase 2 |Phase 3 |Phase 4 |Phase 5 |Phase 6 )/m;
const RATIONALIZATIONS_HEADING =
  /^##\s+(Anti-rationalization|Common rationalizations|Anti-patterns\b|What to refuse|Rationalizations\b|Smell check\b)/m;
const RED_FLAGS_HEADING =
  /^##\s+(Red flags\b|Common pitfalls\b|Hard rules\b|Forbidden\b|Iron rule\b|Two iron rules\b|Stop-the-line\b|Anti-patterns\b|Smell check\b|Hyrum's Law\b)/m;
const VERIFICATION_HEADING =
  /^##\s+(Verification\b|Worked example|Gates\b|.*checklist|Verification log|How .*verifies|Test-design checklist|Outcome\b)/m;

function audit(body: string): AnatomyResult {
  // Overview heuristic: there must be non-empty body content between the
  // frontmatter end (`---` line followed by content) / the `# Skill` H1
  // and the first `##` heading. The leading paragraph is the implicit
  // Overview slot used across every cclaw skill.
  const firstH2Idx = body.search(/^##\s/m);
  const overviewWindow = firstH2Idx === -1 ? body : body.slice(0, firstH2Idx);
  const overviewContent = overviewWindow
    .replace(/^---[\s\S]*?\n---\n/m, "")
    .replace(/^#\s.*$/m, "")
    .replace(/^# Skill:.*$/m, "")
    .trim();
  const hasOverview = overviewContent.length >= 20;

  const hasWhen = WHEN_HEADING.test(body);
  const hasProcess = PROCESS_HEADING.test(body);
  const hasRationalizations = RATIONALIZATIONS_HEADING.test(body);
  const hasRedFlags = RED_FLAGS_HEADING.test(body);
  const hasVerification = VERIFICATION_HEADING.test(body);

  const depthCount =
    (hasProcess ? 1 : 0) +
    (hasRationalizations ? 1 : 0) +
    (hasRedFlags ? 1 : 0) +
    (hasVerification ? 1 : 0);

  return {
    hasOverview,
    hasWhen,
    hasProcess,
    hasRationalizations,
    hasRedFlags,
    hasVerification,
    depthCount,
  };
}

describe("v8.26 skill anatomy enforcement — Overview + When + ≥2 depth sections per skill", () => {
  it("AC-1 — every skill has an Overview section (leading paragraph above first ## heading)", () => {
    for (const skill of ALL_SKILLS) {
      const result = audit(skill.body);
      expect(
        result.hasOverview,
        `${skill.fileName} lacks an Overview body (the leading paragraph between frontmatter and the first ## heading)`
      ).toBe(true);
    }
  });

  it("AC-1 — every skill has a `When` heading (When to use / When to apply / When to invoke / Applies / Triggers)", () => {
    for (const skill of ALL_SKILLS) {
      const result = audit(skill.body);
      expect(
        result.hasWhen,
        `${skill.fileName} lacks a When-to-use heading (e.g. "## When to use", "## When to apply", "## When to invoke", "## When this skill applies", "## Triggers")`
      ).toBe(true);
    }
  });

  it("AC-1 — every skill has at least TWO depth sections from {Process, Rationalizations, Red Flags, Verification}", () => {
    for (const skill of ALL_SKILLS) {
      const result = audit(skill.body);
      expect(
        result.depthCount,
        `${skill.fileName} has only ${result.depthCount} of the four depth sections ` +
          `(Process: ${result.hasProcess}, Rationalizations: ${result.hasRationalizations}, ` +
          `Red Flags: ${result.hasRedFlags}, Verification: ${result.hasVerification}). ` +
          `The rubric requires at least 2 of 4. Equivalents accepted: ` +
          `"## Rules" / "## Phase N" / "## Heuristics" satisfy Process; ` +
          `"## Anti-rationalization" / "## Anti-patterns" / "## What to refuse" satisfy Rationalizations; ` +
          `"## Common pitfalls" / "## Hard rules" / "## Iron rule" satisfy Red Flags; ` +
          `"## Worked example" / "## Verification" / "## Gates" / "## Outcome" satisfy Verification.`
      ).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("v8.26 skill anatomy enforcement — short skills carry stub headings (no body bloat)", () => {
  const SHORT_SKILLS = ["plan-authoring.md", "refinement.md", "pre-flight-assumptions.md"];

  it("AC-2 — short skills are still required to pass the anatomy rubric (stubs are acceptable)", () => {
    for (const fileName of SHORT_SKILLS) {
      const skill = ALL_SKILLS.find((s) => s.fileName === fileName);
      if (!skill) throw new Error(`Expected short skill ${fileName}`);
      const result = audit(skill.body);
      expect(
        result.hasOverview && result.hasWhen && result.depthCount >= 2,
        `${fileName} should pass the anatomy rubric via stub headings (one-line bodies are fine; bloat is not)`
      ).toBe(true);
    }
  });

  it("AC-2 — short skills stay short (line budget protects against accidental bloat)", () => {
    const BUDGETS: Record<string, number> = {
      "plan-authoring.md": 60,
      "refinement.md": 60,
      "pre-flight-assumptions.md": 80,
    };
    for (const [fileName, budget] of Object.entries(BUDGETS)) {
      const skill = ALL_SKILLS.find((s) => s.fileName === fileName);
      if (!skill) throw new Error(`Expected short skill ${fileName}`);
      const lines = skill.body.split("\n").length;
      expect(
        lines,
        `${fileName} grew to ${lines} lines (budget ${budget}). v8.26 stubs should be 1-2 lines per missing heading; bloat means a future maintainer needs to relocate content to a sibling skill.`
      ).toBeLessThanOrEqual(budget);
    }
  });
});

describe("v8.26 skill anatomy enforcement — preserves original skill content (no body rewrites)", () => {
  it("AC-3 — every skill still has its original Skill heading (`# Skill: <name>`)", () => {
    for (const skill of ALL_SKILLS) {
      expect(
        skill.body,
        `${skill.fileName} lost its top-level "# Skill: <name>" heading — v8.26 patches are additive only`
      ).toMatch(/^# Skill: /m);
    }
  });

  it("AC-3 — every skill body remains non-empty (>200 chars)", () => {
    for (const skill of ALL_SKILLS) {
      expect(skill.body.length).toBeGreaterThan(200);
    }
  });
});

describe("v8.26 skill anatomy enforcement — audit table is recordable (for human review)", () => {
  it("AC-4 — full audit table can be computed for every skill (manually inspectable)", () => {
    const rows = ALL_SKILLS.map((s) => {
      const r = audit(s.body);
      return {
        name: s.fileName,
        overview: r.hasOverview,
        when: r.hasWhen,
        process: r.hasProcess,
        rationalizations: r.hasRationalizations,
        redFlags: r.hasRedFlags,
        verification: r.hasVerification,
        depth: r.depthCount,
      };
    });
    expect(rows.length).toBe(17);
    for (const row of rows) {
      expect(row.overview, `${row.name} audit overview failed`).toBe(true);
      expect(row.when, `${row.name} audit when failed`).toBe(true);
      expect(row.depth, `${row.name} audit depth (${row.depth}) < 2`).toBeGreaterThanOrEqual(2);
    }
  });
});
