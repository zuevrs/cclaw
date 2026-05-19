import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { assertFlowStateV82, createInitialFlowState } from "../../src/flow-state.js";
import type { ClarifyRoundState } from "../../src/types.js";

/**
 * v8.105 — Polish: anti-slop scope-down + Clarify table hidden +
 * assumption-coverage non-blocking.
 *
 * Three small adjustments from the v8.105 over-engineering audit:
 *
 *   1. Anti-slop reviewer axis severity hard-capped at `consider`
 *      (never blocks ship). Findings still surface in review.md /
 *      learnings.md, but the axis never returns required / critical.
 *   2. Iterative-clarify (v8.78) keeps its per-dimension scoring
 *      math but no longer renders the per-round 4-row score table
 *      to the user; the "Round 4 — Contrarian mode" / "Round 5 —
 *      Simplifier mode" user-visible labels are removed; the math
 *      persists in `flow-state.json > clarifyRounds[]` for audit.
 *   3. Assumption-coverage reviewer axis severity hard-capped at
 *      `consider`; unvalidated high-stakes KA-N rows still surface
 *      in ship.md `## Unvalidated assumptions` but never block ship;
 *      builder's `validates: KA-N` commit-message payload is truly
 *      optional.
 */

const PROJECT_ROOT = path.resolve(process.cwd());

describe("v8.105 — anti-slop axis severity capped at consider (reviewer prompt + companion skill)", () => {
  it("reviewer prompt's anti-slop axis row + section both name the cap-at-consider rule", () => {
    expect(REVIEWER_PROMPT).toMatch(/v8\.105 cap-at-consider/);
    expect(REVIEWER_PROMPT).toMatch(/Anti-slop axis \(gated;\s*default-on;\s*v8\.86;\s*v8\.105 cap-at-consider\)/);
    expect(REVIEWER_PROMPT).toMatch(
      /severity hard-capped at `consider` regardless of grade/i
    );
    expect(REVIEWER_PROMPT).toMatch(/never blocks ship in any ceremonyMode/i);
    expect(REVIEWER_PROMPT).not.toMatch(
      /≤2\/10 → `?required`? with one-tier escalation to `?critical`?/
    );
  });

  it("anti-slop axis-table row examples assign severity=consider on all four below-6 dimensions (no required / critical leaks)", () => {
    const reviewerLines = REVIEWER_PROMPT.split("\n");
    const antiSlopRow = reviewerLines.find(
      (l) => l.includes("`anti-slop`") && l.includes("(**gated**)") && l.includes("v8.86")
    );
    expect(antiSlopRow, "reviewer.ts must carry an anti-slop axis-table row").toBeDefined();
    expect(antiSlopRow!).toMatch(/speculative-flexibility: 3\/10; severity=consider/);
    expect(antiSlopRow!).toMatch(/senior-test: 2\/10; severity=consider/);
    expect(antiSlopRow!).toMatch(/single-use-abstraction: 4\/10; severity=consider/);
    expect(antiSlopRow!).toMatch(/orphan-cleanup-discipline: 5\/10; severity=consider/);
    expect(antiSlopRow!).not.toMatch(/severity=required/);
    expect(antiSlopRow!).not.toMatch(/severity=critical/);
  });

  it("`reviewer-axis-anti-slop` companion skill caps Sub-check 5 severity at consider", async () => {
    const skill = await fs.readFile(
      path.join(PROJECT_ROOT, "src/content/skills/reviewer-axis-anti-slop.md"),
      "utf8"
    );
    expect(skill).toMatch(/cap-at-consider/);
    expect(skill).toMatch(/Every below-6 dimension grade maps to `severity = consider`/);
    expect(skill).toMatch(/v8\.105 collapses the ramp to a hard cap/);
    expect(skill).toMatch(/3-4\/10\*\*\s*—\s*severity = `consider`/);
    expect(skill).toMatch(/0-2\/10\*\*\s*—\s*severity = `consider`/);
    // The pre-v8.105 ramp is documented as the prior contract, but the
    // axis must no longer return required/critical itself.
    expect(skill).not.toMatch(/^\s*-\s+\*\*0-2\/10\*\*\s+—\s+severity = `required`/m);
    expect(skill).not.toMatch(/^\s*-\s+\*\*3-4\/10\*\*\s+—\s+severity = `required`/m);
  });
});

describe("v8.105 — assumption-coverage axis severity capped at consider", () => {
  it("reviewer prompt's assumption-coverage axis row + section both name the cap-at-consider rule", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /Assumption-coverage axis \(gated;\s*v8\.85;\s*v8\.105 cap-at-consider\)/
    );
    expect(REVIEWER_PROMPT).toMatch(
      /severity hard-capped at `consider` regardless of high-stakes label/i
    );
    expect(REVIEWER_PROMPT).toMatch(/never blocks ship/i);
    // The `validates: KA-N` payload contract must explicitly become
    // optional (no longer required for high-stakes rows).
    expect(REVIEWER_PROMPT).toMatch(/`?validates: KA-N`? commit-message payload is \*\*truly optional\*\*/);
  });

  it("`reviewer-axis-assumption-coverage` companion skill caps every sub-check at consider", async () => {
    const skill = await fs.readFile(
      path.join(PROJECT_ROOT, "src/content/skills/reviewer-axis-assumption-coverage.md"),
      "utf8"
    );
    expect(skill).toMatch(/cap-at-consider/);
    expect(skill).toMatch(
      /every assumption-coverage finding is severity = `consider`/i
    );
    expect(skill).toMatch(/builder's `?validates: KA-N`? commit-message payload is \*\*truly optional\*\*/);
    // No remaining `severity = required` on high-stakes Sub-check 1 / false-positive
    // Sub-check 2 / missing-section Sub-check 4 prose.
    expect(skill).not.toMatch(
      /A KA-N row carrying the `\(high-stakes\)` label[\s\S]*severity = `required`/m
    );
  });

  it("builder prompt drops the `required` ship-block on missing validates payloads (axis caps at consider)", () => {
    // Pre-v8.105: 'False-positive `validates:` claims are an A-1 finding
    // for the reviewer's `assumption-coverage` axis (severity=`required`).'
    // v8.105: axis caps at consider; builder's payload is truly optional.
    expect(BUILDER_PROMPT).toMatch(/The payload is \*\*truly optional\*\*/);
    expect(BUILDER_PROMPT).toMatch(/v8\.105 — the payload is optional even for high-stakes rows/);
    expect(BUILDER_PROMPT).not.toMatch(
      /False-positive `?validates:`? claims are an A-1 finding[^.]*severity=`required`/
    );
  });
});

describe("v8.105 — architect Phase −1 Clarify table hidden (math preserved)", () => {
  it("architect prompt still carries the per-dim scoring math (formula + threshold + clarifyRounds persistence)", () => {
    expect(ARCHITECT_PROMPT).toMatch(
      /goal\s*\*\s*0\.4\s*\+\s*constraints\s*\*\s*0\.3\s*\+\s*criteria\s*\*\s*0\.3\s*\+\s*context\s*\*\s*0\.0/
    );
    expect(ARCHITECT_PROMPT).toMatch(/ambiguity\s*<\s*0\.25/);
    expect(ARCHITECT_PROMPT).toMatch(/weakest\s+dimension/i);
    expect(ARCHITECT_PROMPT).toMatch(/clarifyRounds/);
  });

  it("architect prompt explicitly forbids rendering the per-round score table to the user", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Do NOT render the per-round score table to the user/);
    expect(ARCHITECT_PROMPT).toMatch(/v8\.105/);
    expect(ARCHITECT_PROMPT).toMatch(/the math is silent/i);
  });

  it("architect prompt does NOT carry the literal user-visible per-round table render block", () => {
    // The v8.78 user-visible table was a fenced markdown block with the
    // `| Dimension | Score | Weight | Why |` header followed by four
    // dimension rows and a trailing `Next target:` line. v8.105 removed
    // that block; only the orchestrator-internal description of the math
    // remains.
    expect(ARCHITECT_PROMPT).not.toMatch(
      /\|\s*goal\s*\|\s*<s_goal>\s*\|\s*0\.4\s*\|/
    );
    expect(ARCHITECT_PROMPT).not.toMatch(
      /\|\s*constraints\s*\|\s*<s_constraints>\s*\|\s*0\.3\s*\|/
    );
    expect(ARCHITECT_PROMPT).not.toMatch(
      /\|\s*\*\*Ambiguity\*\*\s*\|\s*\|\s*\|\s*\*\*<a>\*\*\s*\|/
    );
    expect(ARCHITECT_PROMPT).not.toMatch(/^Next target: <weakest-dimension>/m);
  });

  it("architect prompt drops user-visible `Round 4 — Contrarian mode` / `Round 5 — Simplifier mode` headers", () => {
    // The pre-v8.105 wording used user-visible round labels
    // ("Round 4 — Contrarian mode.", "Round 5 — Simplifier mode.")
    // as bolded list items the user would see in chat. v8.105 keeps
    // the stance discipline (orchestrator-internal) but drops the
    // user-visible labels — the user just sees the question.
    expect(ARCHITECT_PROMPT).not.toMatch(
      /\*\*Round 4 — Contrarian mode\.\*\*/
    );
    expect(ARCHITECT_PROMPT).not.toMatch(
      /\*\*Round 5 — Simplifier mode\.\*\*/
    );
    // The internal stance discipline is preserved — `contrarian` and
    // `simplifier` still appear, but as orchestrator-internal stance
    // descriptors rather than user-visible round labels.
    expect(ARCHITECT_PROMPT).toMatch(/contrarian/i);
    expect(ARCHITECT_PROMPT).toMatch(/simplifier/i);
  });
});

describe("v8.105 — research-mode runbook Phase 1 Clarify table hidden (math preserved)", () => {
  const RESEARCH_MODE_RUNBOOK = ON_DEMAND_RUNBOOKS.find((r) => r.id === "research-mode")!.body;

  it("research-mode runbook still carries the per-dim scoring math + 8-round cap + go force-exit", () => {
    expect(RESEARCH_MODE_RUNBOOK).toMatch(
      /goal\s*\*\s*0\.4\s*\+\s*constraints\s*\*\s*0\.3\s*\+\s*criteria\s*\*\s*0\.3\s*\+\s*context\s*\*\s*0\.0/
    );
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/ambiguity\s*<\s*0\.25/);
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/8\s+rounds?/i);
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/\/cc research go/);
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/clarifyRounds/);
  });

  it("research-mode runbook explicitly forbids rendering the per-round score table", () => {
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/Do NOT render the per-round score table to the user/);
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/v8\.105/);
  });

  it("research-mode runbook does NOT carry the literal user-visible per-round table render block", () => {
    expect(RESEARCH_MODE_RUNBOOK).not.toMatch(
      /\|\s*goal\s*\|\s*<s_goal>\s*\|\s*0\.4\s*\|/
    );
    expect(RESEARCH_MODE_RUNBOOK).not.toMatch(
      /\|\s*\*\*Ambiguity\*\*\s*\|\s*\|\s*\|\s*\*\*<a>\*\*\s*\|/
    );
    expect(RESEARCH_MODE_RUNBOOK).not.toMatch(/^Next target: <weakest-dimension>/m);
  });

  it("research-mode runbook drops user-visible `Round 4 — Contrarian mode` / `Round 5 — Simplifier mode` headers", () => {
    expect(RESEARCH_MODE_RUNBOOK).not.toMatch(
      /\*\*Round 4 — Contrarian mode\.\*\*/
    );
    expect(RESEARCH_MODE_RUNBOOK).not.toMatch(
      /\*\*Round 5 — Simplifier mode\.\*\*/
    );
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/contrarian/i);
    expect(RESEARCH_MODE_RUNBOOK).toMatch(/simplifier/i);
  });
});

describe("v8.105 — flow-state schema still supports clarifyRounds[] (math persists for audit)", () => {
  it("a fresh flow state accepts a v8.78-shaped clarifyRounds[] entry verbatim — v8.105 changed the user-visible render only", () => {
    const state = createInitialFlowState("2026-05-19T00:00:00Z");
    const round: ClarifyRoundState = {
      round: 3,
      dimensionScores: [
        { dimension: "goal", score: 0.8, rationale: "pinned" },
        { dimension: "constraints", score: 0.5, rationale: "partial" },
        { dimension: "criteria", score: 0.7, rationale: "AC named" },
        { dimension: "context", score: 0.6, rationale: "repo known" }
      ],
      ambiguity: 1 - (0.8 * 0.4 + 0.5 * 0.3 + 0.7 * 0.3 + 0.6 * 0.0),
      targetedDimension: "constraints",
      question: "What's out of scope for this slug?"
    };
    const withRounds = { ...state, clarifyRounds: [round] };
    expect(() => assertFlowStateV82(withRounds)).not.toThrow();
    expect(withRounds.clarifyRounds).toHaveLength(1);
    expect(withRounds.clarifyRounds![0].dimensionScores).toHaveLength(4);
    // The math threshold (0.25) is the canonical exit signal; verify the
    // formula computes the right ambiguity for this fixture
    // (0.8*0.4 + 0.5*0.3 + 0.7*0.3 + 0.6*0.0 = 0.68 → ambiguity 0.32).
    expect(withRounds.clarifyRounds![0].ambiguity).toBeCloseTo(0.32, 2);
  });
});

describe("v8.105 — CHANGELOG + version bump", () => {
  it("CHANGELOG.md carries the v8.105 entry naming all three polish changes", async () => {
    const changelog = await fs.readFile(path.join(PROJECT_ROOT, "CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/v8\.105/);
    expect(changelog).toMatch(/anti-slop/i);
    expect(changelog).toMatch(/clarify/i);
    expect(changelog).toMatch(/assumption-coverage/i);
    expect(changelog).toMatch(/cap-at-consider|consider/i);
  });

  it("package.json is at or above 8.105.0", async () => {
    const pkg = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    const [major, minor] = pkg.version
      .split(".")
      .map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(105);
  });
});
