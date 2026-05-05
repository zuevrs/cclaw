import { describe, expect, it } from "vitest";
import {
  INVESTIGATION_TRACE_PATH_PATTERNS,
  checkInvestigationTrace,
  evaluateInvestigationTrace,
  type LintFinding
} from "../../src/artifact-linter/shared.js";
import type { StageLintContext } from "../../src/artifact-linter/shared.js";
import { extractH2Sections, parseFrontmatter } from "../../src/artifact-linter/shared.js";

const RULE_ID = "investigation_path_first_missing";

function buildContext(markdown: string): StageLintContext {
  const sections = extractH2Sections(markdown);
  const findings: LintFinding[] = [];
  return {
    projectRoot: "/tmp/no-such-project",
    stage: "design",
    track: "standard",
    discoveryMode: "guided",
    raw: markdown,
    absFile: "/tmp/no-such-project/.cclaw/artifacts/03-design-fixture.md",
    sections,
    findings,
    parsedFrontmatter: parseFrontmatter(markdown),
    brainstormShortCircuitBody: null,
    brainstormShortCircuitActivated: false,
    scopePreAuditEnabled: false,
    staleDiagramAuditEnabled: false,
    isTrivialOverride: false,
    overrideSet: null,
    activeStageFlags: [],
    taskClass: null
  };
}

function findingsByRule(findings: LintFinding[], ruleId: string): LintFinding[] {
  return findings.filter((finding) => finding.section === ruleId);
}

describe("checkInvestigationTrace (detector core)", () => {
  it("returns null when section body is null (section missing)", () => {
    expect(checkInvestigationTrace(null)).toBeNull();
  });

  it("returns null when section is empty", () => {
    expect(checkInvestigationTrace("")).toBeNull();
  });

  it("returns null when section is whitespace only", () => {
    expect(checkInvestigationTrace("\n\n   \n")).toBeNull();
  });

  it("returns null when section has only placeholder/template rows", () => {
    const body = `
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet |
|---|---|---|---|
| S-1 |  |  |  |
- None.
`;
    expect(checkInvestigationTrace(body)).toBeNull();
  });

  it("returns ok=true when content cites a TS file path", () => {
    const result = checkInvestigationTrace(
      "Investigated `src/services/notifications.ts:42` for blast radius."
    );
    expect(result?.ok).toBe(true);
  });

  it("returns ok=true when content cites a markdown doc path", () => {
    const result = checkInvestigationTrace(
      "Cited docs/quality-gates.md for the contract; no other reads."
    );
    expect(result?.ok).toBe(true);
  });

  it("returns ok=true when content cites an explicit `path:` marker", () => {
    const result = checkInvestigationTrace("path: src/foo/bar.ts (read lines 10-30)");
    expect(result?.ok).toBe(true);
  });

  it("returns ok=true when content cites a stable cclaw ID", () => {
    const result = checkInvestigationTrace("Carrying forward decision D-12 + AC-3 from upstream.");
    expect(result?.ok).toBe(true);
  });

  it("returns ok=true when content cites a GitHub-style ref", () => {
    const result = checkInvestigationTrace("Tracked in cursor/cclaw#456 (linked from upstream).");
    expect(result?.ok).toBe(true);
  });

  it("returns ok=true when content cites a path:line range", () => {
    const result = checkInvestigationTrace("src/api/router.ts:128-160 — current handler.");
    expect(result?.ok).toBe(true);
  });

  it("returns ok=false (advisory finding) for prose-only content with no path/ref", () => {
    const result = checkInvestigationTrace(
      "We talked through the problem and decided to refactor the notification service so it handles retries better. The team agreed on the new approach during standup."
    );
    expect(result?.ok).toBe(false);
    expect(result?.details ?? "").toMatch(/pass paths and refs, not/iu);
  });

  it("ignores placeholder rows but evaluates the first substantive prose row", () => {
    const body = `
| Slice | Test name | Observed at (ISO ts) | Failure reason snippet |
|---|---|---|---|
| S-1 |  |  |  |
We will rerun the suite after the refactor lands and write up findings later.
`;
    const result = checkInvestigationTrace(body);
    expect(result?.ok).toBe(false);
  });
});

describe("INVESTIGATION_TRACE_PATH_PATTERNS regex set", () => {
  it("matches typical TS/JS/MD paths", () => {
    const samples = [
      "src/foo/bar.ts",
      "tests/unit/foo.test.ts",
      "docs/quality-gates.md",
      "scripts/init.mjs"
    ];
    for (const sample of samples) {
      const matched = INVESTIGATION_TRACE_PATH_PATTERNS.some((pattern) => pattern.test(sample));
      expect(matched, `expected to match path: ${sample}`).toBe(true);
    }
  });

  it("rejects pure prose with no slashes, refs, or IDs", () => {
    const matched = INVESTIGATION_TRACE_PATH_PATTERNS.some((pattern) =>
      pattern.test("Discussed the architecture briefly with the team.")
    );
    expect(matched).toBe(false);
  });
});

describe("evaluateInvestigationTrace (linter wrapper)", () => {
  it("pushes no finding when the section is missing", () => {
    const ctx = buildContext("# Design\n\nNo investigation section here.\n");
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    expect(findingsByRule(ctx.findings, RULE_ID)).toHaveLength(0);
  });

  it("pushes no finding when the section is empty", () => {
    const ctx = buildContext("# Design\n\n## Codebase Investigation\n\n");
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    expect(findingsByRule(ctx.findings, RULE_ID)).toHaveLength(0);
  });

  it("pushes no finding when the section is placeholder-only", () => {
    const ctx = buildContext(`# Design

## Codebase Investigation
| File | Current responsibility | Patterns discovered | Existing fit / reuse candidate |
|---|---|---|---|
|  |  |  |  |
- None.
`);
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    expect(findingsByRule(ctx.findings, RULE_ID)).toHaveLength(0);
  });

  it("pushes a passing advisory finding when the section cites file paths", () => {
    const ctx = buildContext(`# Design

## Codebase Investigation
- src/services/notifications.ts (publish path)
- tests/integration/notifications.test.ts (consistency coverage)
`);
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    const matched = findingsByRule(ctx.findings, RULE_ID);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.required).toBe(false);
    expect(matched[0]!.found).toBe(true);
  });

  it("pushes exactly one failing advisory finding when the section is prose-only", () => {
    const ctx = buildContext(`# Design

## Codebase Investigation
We need to refactor the notifications service so it can handle retries
correctly. The team has discussed this during standup and agreed on the
high-level direction.
`);
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    const matched = findingsByRule(ctx.findings, RULE_ID);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.required).toBe(false);
    expect(matched[0]!.found).toBe(false);
    expect(matched[0]!.rule).toMatch(/investigation_path_first_missing/u);
    expect(matched[0]!.details).toMatch(/pass paths and refs/iu);
  });

  it("strips linter-meta blocks before evaluating, avoiding template-echo false positives", () => {
    const ctx = buildContext(`# Design

## Codebase Investigation
<!-- linter-meta -->
This is a linter-meta scaffold paragraph that mentions src/example/path.ts as part of the rule template, not actual evidence the author authored.
<!-- /linter-meta -->
We had a long discussion about the notification flow but no specific paths or references were cited; needs follow-up.
`);
    evaluateInvestigationTrace(ctx, "Codebase Investigation");
    const matched = findingsByRule(ctx.findings, RULE_ID);
    expect(matched).toHaveLength(1);
    expect(matched[0]!.found).toBe(false);
    expect(matched[0]!.details).toMatch(/pass paths and refs/iu);
  });
});
