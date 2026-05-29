import { existsSync, promises as fs } from "node:fs";
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

describe("v8.113 — anti-slop reviewer axis retired (the v8.105 cap-at-consider behavior is moot)", () => {
  // v8.105 hard-capped the anti-slop axis at `consider`. v8.113 cut the
  // advisory-only axis outright (capping it changed no ship decision, so
  // removing it changes none either). Full retirement coverage lives in
  // `tests/unit/v886-anti-slop-axis.test.ts`; these rows guard that the
  // v8.105 cap surface is gone too.
  it("reviewer prompt no longer carries the anti-slop axis row, stub, or cap-at-consider language", () => {
    expect(REVIEWER_PROMPT).not.toMatch(/Anti-slop axis \(gated/);
    expect(REVIEWER_PROMPT).not.toMatch(/`anti-slop`\s*\(\*\*gated\*\*/);
    expect(REVIEWER_PROMPT).not.toMatch(/cap-at-consider/);
    expect(REVIEWER_PROMPT).not.toMatch(/AS-N/);
  });

  it("the `reviewer-axis-anti-slop` companion skill is deleted from disk", () => {
    expect(
      existsSync(
        path.join(PROJECT_ROOT, "src/content/skills/reviewer-axis-anti-slop.md")
      )
    ).toBe(false);
  });
});

describe("v8.113 — assumption-coverage reviewer axis retired; builder `validates:` payload stays optional", () => {
  // v8.105 hard-capped the assumption-coverage axis at `consider`. v8.113
  // cut the advisory-only axis entirely. The assumption-VALIDATION
  // subsystem (KA-N rows, builder `validates: KA-N` payload, ship.md
  // `## Unvalidated assumptions`) SURVIVES — only the reviewer axis is gone.
  it("reviewer prompt no longer declares an assumption-coverage axis row or stub", () => {
    expect(REVIEWER_PROMPT).not.toMatch(/Assumption-coverage axis \(gated/);
    expect(REVIEWER_PROMPT).not.toMatch(/`assumption-coverage`\s*\(\*\*gated\*\*/);
    expect(REVIEWER_PROMPT).not.toMatch(/\bav=N\b/);
  });

  it("the `reviewer-axis-assumption-coverage` companion skill is deleted from disk", () => {
    expect(
      existsSync(
        path.join(
          PROJECT_ROOT,
          "src/content/skills/reviewer-axis-assumption-coverage.md"
        )
      )
    ).toBe(false);
  });

  it("builder prompt keeps the `validates:` payload truly optional (assumption-validation subsystem survives the axis cut)", () => {
    // Pre-v8.105: 'False-positive `validates:` claims are an A-1 finding
    // for the reviewer's `assumption-coverage` axis (severity=`required`).'
    // v8.105: axis caps at consider; builder's payload is truly optional.
    expect(BUILDER_PROMPT).toMatch(/The payload is \*\*truly optional\*\*/);
    expect(BUILDER_PROMPT).toMatch(/The payload is optional even for high-stakes rows/);
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
