import { describe, expect, it } from "vitest";

import {
  ARCHITECT_PROMPT,
  REVIEWER_PROMPT,
  BUILDER_PROMPT,
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
 *
 * v8.62 — roster collapse:
 *   * `design` retired, fully absorbed into `architect`; the prior `design`
 *     budget (530 lines / 61000 chars) and prior `ac-author` budget (640
 *     lines / 60000 chars) collapse into a single `architect` line.
 *   * `slice-builder` renamed to `builder` (same budget envelope).
 *   * `security-reviewer` retired, threat-model / taint / secrets / supply-
 *     chain prose absorbed into `reviewer`'s `security` axis (~+100 lines /
 *     +12k chars over the v8.59 reviewer body).
 */

interface PromptBudget {
  id: string;
  body: string;
  maxLines: number;
  maxChars: number;
}

const PROMPT_BUDGETS: PromptBudget[] = [
  {
    id: "architect",
    body: ARCHITECT_PROMPT,
    // v8.62 — `architect` is the v8.59 `ac-author` body (~640 lines / 60k
    // chars) PLUS the dead `design` specialist's Phase 0/2-6 prose
    // (Bootstrap / Frame / Approaches / Decisions / Pre-mortem / Compose)
    // PLUS the standalone research-mode branch lifted from `design`'s
    // Phase 7 picker variant. v8.61 already dropped mid-plan dialogue, so
    // Phase 1 (Clarify) and Phase 7 (Sign-off) are NOT carried over. The
    // resulting body lands well inside the combined `design` + `ac-author`
    // envelope thanks to the dropped dialogue prose, but allocate a single
    // generous budget here so a future expansion of the Posture table or
    // a new posture variant does not immediately blow the ceiling. The
    // 1200-line / 110000-char budget matches the design.md escalation
    // trigger ("Architect file grows past 1200 lines after B1 — STOP and
    // report") so this test fires alongside the implementation tripwire.
    maxLines: 1200,
    maxChars: 110000
  },
  {
    id: "reviewer",
    body: REVIEWER_PROMPT,
    // v8.59 raised the reviewer budget to 710 lines / 71000 chars. v8.62
    // bumps to 850 lines / 85000 chars to absorb the former
    // `security-reviewer` specialist's threat-model + taint + secrets +
    // supply-chain checklist into reviewer's existing `security` axis.
    // The integrated section grows the security-axis prose ~+100 lines /
    // ~+12k chars (full threat-model coverage, sensitive-change protocol,
    // Z-N severity, security-axis bypass guardrails). Growth justified in
    // CHANGELOG.md (v8.62 — unified flow + kill design + remove
    // security-reviewer).
    //
    // v8.70 — design-quality reviewer axis (gated): the eleventh axis
    // grades seven design dimensions 0-10 with explicit "what a 10 looks
    // like" references; below-6 grades become findings. The new section
    // adds the per-dimension rubric, gating rule, AI-slop check, severity
    // ladder, skip rules, and anti-rationalization rows. Growth lands
    // ~+65 lines / ~+10k chars over the v8.62 envelope; budget raised to
    // 1100 lines / 100000 chars (≈26% line headroom + ≈5% char headroom
    // over current ~811 lines / ~95k chars). The 1100-line ceiling matches
    // the v8.70 slug spec's escalation trigger ("stop and report if
    // design-quality axis prose pushes reviewer.ts past 1100 lines"), so
    // this assertion fires alongside the implementation tripwire. Growth
    // justified in CHANGELOG.md (v8.70 — design-quality reviewer axis).
    maxLines: 1100,
    maxChars: 100000
  },
  {
    id: "builder",
    body: BUILDER_PROMPT,
    // v8.62 — `builder` is the v8.48 `slice-builder` body verbatim (rename
    // only; AC-as-unit semantics unchanged). The 720-line / 62000-char
    // envelope carries over from v8.59.
    //
    // v8.63 — slice / AC separation: the builder now runs two passes
    // (per-slice TDD work pass + per-AC verification pass), with two
    // distinct JSON self-review blocks (five rules per slice + three rules
    // per AC) and a new "AC verification pass" prose section. Growth lands
    // ~+90 lines / ~+7k chars over the v8.62 envelope; budget raised to
    // 780 lines / 76000 chars (≈11% headroom over current). Growth justified
    // in CHANGELOG.md (v8.63 — separate slices from AC).
    //
    // v8.64 — parallel-by-default for multi-slice tasks: new "Topological
    // layer dispatch" section codifies the parent-builder contract +
    // sub-builder contract (inlined, not split to a new file). Growth lands
    // ~+85 lines / ~+5k chars over the v8.63 envelope; budget raised to
    // 870 lines / 82000 chars (≈6% headroom over current 757 lines / 77k
    // chars). Growth justified in CHANGELOG.md (v8.64 — parallel-by-default
    // for multi-slice tasks).
    //
    // v8.68 — two-stage per-slice review (spec-compliance → code-quality) +
    // structured implementer status protocol (DONE / DONE_WITH_CONCERNS /
    // NEEDS_CONTEXT / BLOCKED): new "Per-slice review loop" section codifies
    // the two-stage gate (mirrors obra-superpowers subagent-driven-development);
    // new "Status protocol" section + per-slice JSON `status` field surface
    // the structured status the orchestrator routes deterministically. Slim
    // summary grew by one line (`Status:`); build.md slice table grew by one
    // column (`Per-slice review`). Growth lands ~+10 lines / ~+9k chars
    // over the v8.64 envelope; budget raised to 890 lines / 92000 chars
    // (≈2% line headroom, ≈2% char headroom over current 868 lines / 90k
    // chars). Growth justified in CHANGELOG.md (v8.68 — two-stage per-slice
    // review + structured implementer status).
    //
    // v8.73 — worktree-isolated parallel slices: new "Worktree-per-independent-
    // slice" step in the parallel dispatch protocol, new "Merge fast-forward
    // + CI gate" step, new "Worktree lifecycle helpers (v8.73)" table
    // referencing src/slice-worktree.ts as canonical, and the rewritten
    // "Interaction with existing parallel-build topology" section
    // documenting the convergence. The worked-example block is rewritten
    // to walk the worktree lifecycle end-to-end. Growth lands ~+18 lines /
    // ~+5k chars over the v8.68 envelope; budget raised to 920 lines /
    // 100000 chars (≈4% line headroom, ≈5% char headroom over current
    // 886 lines / 95366 chars). Growth justified in CHANGELOG.md (v8.73 —
    // worktree-isolated parallel slices).
    //
    // v8.77 — debug-branch direct-fix mode: new "Debug-branch direct-fix
    // flow" section codifying the protocol when the orchestrator dispatches
    // builder with `priorInvestigation` envelope field set AND no plan.md
    // (the direct-fix verdict path). Section covers: read investigation.md
    // as plan-substitute, RED-before-GREEN against the cited symptom, fix
    // bounded to `## Fix scope` file:line refs, `fix(<scope>):` commit
    // prefix, short build.md body, hard rules against scope creep. Also
    // adds an `investigation.md` entry to Inputs and an `investigation-
    // discipline.md` skill reference. Growth lands ~+50 lines / ~+8k chars
    // over the v8.73 envelope; budget raised to 970 lines / 110000 chars
    // (≈6% line headroom, ≈6% char headroom over current size). Growth
    // justified in CHANGELOG.md (v8.77 — investigator debug-branch).
    //
    // v8.102 — patch-mode flow: new "Patch-mode flow (v8.102; when envelope
    // carries `patchMode: true`)" section codifies the post-ship micro-edit
    // protocol — read parent's plan.md as contract, skip slice topology /
    // per-slice review / AC verify discipline, write ONE commit prefixed
    // `patch(<slug>):`, append `patch-N.md` to parent's shipped dir. Section
    // also names the patch-mode slim-summary shape and the patch-mode hard
    // rules (no production-code changes outside cited file:line refs; one
    // commit only; skip ship-gate ask). Growth lands ~+60 lines / ~+7k
    // chars over the v8.77 envelope; budget raised to 1060 lines / 120000
    // chars (≈7% line headroom, ≈8% char headroom over current size).
    // Growth justified in CHANGELOG.md (v8.102 — /cc patch post-ship
    // micro-edit mode).
    maxLines: 1060,
    maxChars: 120000
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
