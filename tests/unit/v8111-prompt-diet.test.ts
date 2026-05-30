import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";

/**
 * v8.111 — specialist diet + smart-decision sharpenings + cross-specialist
 * consolidation tripwires.
 *
 * Asserts:
 *  - Each of the 6 v8.111-touched runbook .md files exists (5 new + the
 *    unified refine-mode, which folded patch-mode in v8.113), carries the
 *    expected sections, and is registered in `ON_DEMAND_RUNBOOKS`.
 *  - The 4 lift sites in `builder.ts` carry the new short anchor (regex match
 *    for the pointer-line to the runbook) and DO NOT carry the long-form
 *    content the runbook now owns.
 *  - The 3 lift sites in `architect.ts` carry the new short anchor.
 *  - The 5 smart-decision wordings (C.1-C.5) appear verbatim in their target
 *    specialist prompts.
 *  - The new `pre-commitment-predictions` skill exists, is registered in
 *    `skills.ts`, and the three inline blocks (`plan-critic.ts`, `critic.ts`,
 *    `qa-runner.ts`) collapsed to a one-line anchor pointing at the skill.
 *  - `summary-format.md` carries the canonical confidence-band ladder and the
 *    five per-specialist Confidence blocks (architect, builder, reviewer,
 *    critic, investigator) collapsed to a one-line anchor pointing at the
 *    skill (triage is the documented exception and keeps its inline rules).
 *
 * The specialist-prompt assertions read from the evaluated `SPECIALIST_PROMPTS`
 * table (not the raw `.ts` source) so backticks inside the prompt template
 * literals are real backticks in the asserted string.
 */

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.resolve(REPO_ROOT, "src");
const RUNBOOK_DIR = path.resolve(SRC_ROOT, "content", "runbooks");
const SKILL_DIR = path.resolve(SRC_ROOT, "content", "skills");

async function readFile(p: string): Promise<string> {
  return await fs.readFile(p, "utf8");
}

describe("v8.111 runbook .md files exist and carry the expected sections", () => {
  it("builder-self-review-gate.md exists with per-slice + per-AC JSON block sections", async () => {
    const body = await readFile(path.resolve(RUNBOOK_DIR, "builder-self-review-gate.md"));
    expect(body).toMatch(/# Builder self-review gate/);
    expect(body).toMatch(/Per-slice JSON block/);
    expect(body).toMatch(/Per-AC JSON block/);
    expect(body).toMatch(/self_review/);
    expect(body).toMatch(/tests-fail-then-pass/);
  });

  it("builder-tdd-walkthrough.md exists with bash transcripts", async () => {
    const body = await readFile(path.resolve(RUNBOOK_DIR, "builder-tdd-walkthrough.md"));
    expect(body).toMatch(/# Builder TDD walkthrough/);
    expect(body).toMatch(/red\(SL-1\)/);
    expect(body).toMatch(/green\(SL-1\)/);
    expect(body).toMatch(/verify\(AC-1\): passing/);
  });

  it("parallel-worktree.md exists with topological-layer worked example", async () => {
    const body = await readFile(path.resolve(RUNBOOK_DIR, "parallel-worktree.md"));
    expect(body).toMatch(/# Parallel worktree dispatch/);
    expect(body).toMatch(/createSliceWorktree/);
    expect(body).toMatch(/mergeSliceWorktree/);
    expect(body).toMatch(/cleanupSliceWorktree/);
    expect(body).toMatch(/topologicalLayers/);
  });

  it("clarify-protocol.md exists with 4-dimension scoring + gap-lens table + anti-rationalization", async () => {
    const body = await readFile(path.resolve(RUNBOOK_DIR, "clarify-protocol.md"));
    expect(body).toMatch(/# Clarify protocol/);
    expect(body).toMatch(/Per-dimension ambiguity scoring/);
    expect(body).toMatch(/Gap-lens table/);
    expect(body).toMatch(/Challenge-mode stance rotation/);
    expect(body).toMatch(/Anti-rationalization/);
    expect(body).toMatch(/ambiguity = 1 - \(goal \* 0\.4 \+ constraints \* 0\.3 \+ criteria \* 0\.3 \+ context \* 0\.0\)/);
  });

  it("plan-md-templates.md exists with soft + strict worked examples", async () => {
    const body = await readFile(path.resolve(RUNBOOK_DIR, "plan-md-templates.md"));
    expect(body).toMatch(/# plan\.md worked-example templates/);
    expect(body).toMatch(/Worked example — small\/medium, soft mode/);
    expect(body).toMatch(/Worked example — large-risky, strict mode/);
  });

  it("refine-mode.md exists (v8.113 — folds the former patch-mode + extend-mode), and carries the lifted builder protocol section", async () => {
    const body = await readFile(path.resolve(RUNBOOK_DIR, "refine-mode.md"));
    expect(body).toMatch(/^# On-demand runbook — refine-mode entry point/m);
    expect(body).toMatch(/Builder protocol \(lifted from/);
  });
});

describe("v8.111 runbooks register in ON_DEMAND_RUNBOOKS", () => {
  const expectedRunbookIds = [
    "builder-self-review-gate",
    "builder-tdd-walkthrough",
    "parallel-worktree",
    "clarify-protocol",
    "plan-md-templates",
    "refine-mode"
  ];

  for (const id of expectedRunbookIds) {
    it(`registers ${id}`, () => {
      const found = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === id);
      expect(found, `${id} should be registered in ON_DEMAND_RUNBOOKS`).toBeDefined();
      expect(found?.body.length, `${id} body should be non-empty`).toBeGreaterThan(100);
    });
  }
});

describe("v8.111 builder.ts lift anchors (A.1-A.4)", () => {
  const builder = SPECIALIST_PROMPTS.builder;

  it("A.4 — parallel-worktree anchor (lifted from L273-313)", () => {
    expect(builder).toMatch(/parallel-worktree\.md/);
    expect(builder).toMatch(/createSliceWorktree/);
    expect(builder).toMatch(/mergeSliceWorktree/);
    expect(builder).toMatch(/cleanupSliceWorktree/);
    expect(builder).not.toMatch(/topologicalLayers\(\) returns \[\[SL-1, SL-2\], \[SL-3\]\]/);
  });

  it("A.5 — hard rules deduped to 6 + skills pointer", () => {
    expect(builder).toMatch(/Cross-cutting discipline auto-loaded via skills/);
    expect(builder).toMatch(/No redundant verification/);
    expect(builder).toMatch(/No environment shims/);
  });

  it("A.3 — TDD walkthrough anchor (lifted from L616-672)", () => {
    expect(builder).toMatch(/builder-tdd-walkthrough\.md/);
    expect(builder).not.toMatch(/\[master a1b2c3d\] red\(SL-1\)/);
  });

  it("A.2 — patch-mode anchor now points at the unified refine-mode.md (v8.113)", () => {
    expect(builder).toMatch(/refine-mode\.md/);
    const refineModeMentions = (builder.match(/refine-mode\.md/g) ?? []).length;
    expect(refineModeMentions, "refine-mode.md should still be referenced at least once").toBeGreaterThanOrEqual(1);
    // The deleted patch-mode.md runbook should no longer be referenced.
    expect(builder).not.toMatch(/patch-mode\.md/);
  });

  it("A.1 — self-review-gate anchor (lifted from L878-963)", () => {
    expect(builder).toMatch(/builder-self-review-gate\.md/);
    expect(builder).toMatch(/self_review\[\]\.verified/);
    expect(builder).not.toMatch(/```json\s*\n\s*\{\s*\n\s*"specialist": "builder",\s*\n\s*"mode": "build\|fix-only",\s*\n\s*"kind": "slice"/);
  });
});

describe("v8.111 architect.ts lift anchors (B.1, B.2, B.3)", () => {
  const architect = SPECIALIST_PROMPTS.architect;

  it("B.1 — Clarify protocol anchor (lifted from L50-160)", () => {
    expect(architect).toMatch(/clarify-protocol\.md/);
    expect(architect).toMatch(/ambiguity = 1 − weighted_sum/);
    expect(architect).toMatch(/ambiguity < 0\.25/);
    expect(architect).toMatch(/clarify_opens\s*=\s*\(triage\.ambiguityScore >= clarify_threshold\) AND \(triage\.ceremonyMode != "inline"\)/);
    expect(architect).toMatch(/## Assumptions \(correct me now\)/);
    expect(architect).not.toMatch(/Round 4 — Contrarian mode:/);
  });

  it("B.2 — plan.md templates anchor (lifted from L703-816)", () => {
    expect(architect).toMatch(/plan-md-templates\.md/);
    expect(architect).not.toMatch(/Worked example — small\/medium, soft mode, intra-flow[\s\S]{0,200}permission-tooltip/);
  });

  it("B.3 — Phase 10 self-review checklist collapsed to 10-row table", () => {
    expect(architect).toMatch(/### Phase 10 — Self-review checklist/);
    const phase10Block = architect.split("### Phase 10 — Self-review checklist")[1]?.split("###")[0] ?? "";
    expect(phase10Block).toMatch(/\| # \| Category \| Check \| Modes \| Diagnostic \|/);
    expect(phase10Block).not.toMatch(/22\. \*\*`Rollback` is present/);
    expect(phase10Block).not.toMatch(/24\. \*\*Prior lessons section is present/);
  });
});

describe("v8.111 smart-decision sharpenings (C.1-C.5)", () => {
  it("C.1 — builder.ts defines 'attempt' as edit + RED-rerun + GREEN-rerun cycle", () => {
    const body = SPECIALIST_PROMPTS.builder;
    expect(body).toMatch(/An "attempt" is one \(edit \+ RED-rerun \+ GREEN-rerun\) cycle that \*\*changes the edit shape from the prior attempt\*\*/);
    expect(body).toMatch(/Re-running the same edit twice = 1 attempt for cap purposes/);
    expect(body).toMatch(/The cap prevents thrashing on a stuck approach, not honest re-verification of flaky tests/);
  });

  it("C.2 — critic.ts hunting-mode bias check carries the 1.5× complexity baseline + attestation", () => {
    const body = SPECIALIST_PROMPTS.critic;
    expect(body).toMatch(/Count your current `block-ship` \+ `iterate` findings/);
    expect(body).toMatch(/1\.5× the slug's `triage\.complexity` baseline \(`trivial` = 0; `small-medium` = 2; `large-risky` = 4\)/);
    expect(body).toMatch(/bias-check: I would have raised this with zero prior findings open/);
    expect(body).toMatch(/Block-ship findings on data-loss \/ security \/ payment are exempt/);
  });

  it("C.3 — architect.ts defines 'not defensible' approach with three filters", () => {
    const body = SPECIALIST_PROMPTS.architect;
    expect(body).toMatch(/An approach is 'not defensible' iff ANY of:/);
    expect(body).toMatch(/it violates an iron-law for this slug's surface/);
    expect(body).toMatch(/cite the disqualifying clause for each rejected alternative/);
  });

  it("C.4 — investigator.ts direct-fix gate has all four conditions", () => {
    const body = SPECIALIST_PROMPTS.investigator;
    expect(body).toMatch(/`direct-fix`.{1,80}Recommend iff ALL of:/);
    expect(body).toMatch(/≤3 file:line refs total/);
    expect(body).toMatch(/all refs sit under the \*\*same directory\*\*/);
    expect(body).toMatch(/null guard \/ typo \/ missing import \/ off-by-one \/ type-coercion \/ missing-await \/ missing-return/);
    expect(body).toMatch(/zero schema \/ API-shape \/ auth-boundary touches/);
  });

  it("C.5 — reviewer.ts What's done well band 1-5", () => {
    const body = SPECIALIST_PROMPTS.reviewer;
    expect(body).toMatch(/Default emit ONE specific item/);
    expect(body).toMatch(/Emit 2-3 when the slug touched multiple distinct axes/);
    expect(body).toMatch(/Emit 4-5 ONLY when the diff is large-risky AND at least 4 axes/);
    expect(body).toMatch(/Citing the same surface in two items is sycophancy/);
  });
});

describe("v8.111 D.1 — pre-commitment-predictions skill exists + registered + 3 inline drops", () => {
  it("skill file pre-commitment-predictions.md exists with expected headings", async () => {
    const body = await readFile(path.resolve(SKILL_DIR, "pre-commitment-predictions.md"));
    expect(body).toMatch(/# Skill: pre-commitment-predictions/);
    expect(body).toMatch(/3-5 predictions, no more, no less/);
    expect(body).toMatch(/confirmed.*refuted.*partial/i);
    expect(body).toMatch(/Refuted is information/i);
    expect(body).toMatch(/Rationalization rebuttals/);
  });

  it("registers in AUTO_TRIGGER_SKILLS with correct id + stages + triggers", () => {
    const found = AUTO_TRIGGER_SKILLS.find((s) => s.id === "pre-commitment-predictions");
    expect(found, "pre-commitment-predictions should be registered").toBeDefined();
    expect(found?.stages).toEqual(expect.arrayContaining(["plan", "review", "qa"]));
    expect(found?.triggers).toEqual(
      expect.arrayContaining(["specialist:plan-critic", "specialist:critic", "specialist:qa-runner"])
    );
    expect(found?.body.length).toBeGreaterThan(500);
  });

  it("plan-critic.ts §1 collapsed to the skill anchor", () => {
    const body = SPECIALIST_PROMPTS["plan-critic"];
    expect(body).toMatch(/Pre-commitment: 3-5 predictions before reading the rest — see `\.cclaw\/lib\/skills\/pre-commitment-predictions\.md`/);
    expect(body).not.toMatch(/Hard rules for §1 \(apply to all modes\):/);
  });

  it("critic.ts §1 collapsed to the skill anchor", () => {
    const body = SPECIALIST_PROMPTS.critic;
    expect(body).toMatch(/Pre-commitment: 3-5 predictions before reading the rest — see `\.cclaw\/lib\/skills\/pre-commitment-predictions\.md`/);
    expect(body).not.toMatch(/Hard rules for §1:[\s\S]{0,200}3-5 predictions, no more, no less/);
  });

  it("qa-runner.ts §3 collapsed to the skill anchor", () => {
    const body = SPECIALIST_PROMPTS["qa-runner"];
    expect(body).toMatch(/Pre-commitment: 3-5 predictions before reading the rest — see `\.cclaw\/lib\/skills\/pre-commitment-predictions\.md`/);
    expect(body).not.toMatch(/Hard rules for §3:[\s\S]{0,200}3-5 predictions, no more, no less/);
  });
});

describe("v8.111 D.2 — confidence-band ladder pushed into summary-format.md", () => {
  it("summary-format.md carries the canonical Confidence ladder section", async () => {
    const body = await readFile(path.resolve(SKILL_DIR, "summary-format.md"));
    expect(body).toMatch(/## Confidence ladder/);
    expect(body).toMatch(/\*\*`high`\*\*/);
    expect(body).toMatch(/\*\*`medium`\*\*/);
    expect(body).toMatch(/\*\*`low`\*\*/);
    expect(body).toMatch(/hard gate/);
    expect(body).toMatch(/Triage exception/);
  });

  const specialistsThatDropInline: Array<{ id: keyof typeof SPECIALIST_PROMPTS; previousFingerprint: RegExp }> = [
    { id: "architect", previousFingerprint: /`Confidence` reports how sure you are that this plan/ },
    { id: "builder", previousFingerprint: /`Confidence` is your honest read on whether the build will survive review/ },
    { id: "reviewer", previousFingerprint: /`Confidence` reflects how thoroughly you reviewed the diff/ },
    { id: "critic", previousFingerprint: /`Confidence` rules:\s*\n\s*- \*\*high\*\* — you ran the full protocol within budget/ },
    { id: "investigator", previousFingerprint: /`Confidence` rules \(same as every other specialist\):\s*\n\s*- `high` — the synthesis is unambiguous/ }
  ];

  for (const { id, previousFingerprint } of specialistsThatDropInline) {
    it(`${id} drops its inline Confidence block in favour of the summary-format anchor`, () => {
      const body = SPECIALIST_PROMPTS[id];
      expect(body).toMatch(/`Confidence` follows the canonical ladder in `\.cclaw\/lib\/skills\/summary-format\.md > Confidence ladder`/);
      expect(body).not.toMatch(previousFingerprint);
    });
  }

  it("triage.ts keeps its inline Confidence rules (documented exception; low is NOT a hard gate at triage)", () => {
    const body = SPECIALIST_PROMPTS.triage;
    expect(body).toMatch(/`Confidence` rules:/);
    expect(body).toMatch(/orchestrator does not treat `Confidence: low` as a hard gate at triage/);
  });
});

describe("v8.111 specialist prompts still build into SPECIALIST_PROMPTS table", () => {
  it("every specialist prompt body is non-empty after the diet", () => {
    for (const [id, body] of Object.entries(SPECIALIST_PROMPTS)) {
      expect(body.length, `${id} prompt should be non-empty`).toBeGreaterThan(1000);
    }
  });
});
