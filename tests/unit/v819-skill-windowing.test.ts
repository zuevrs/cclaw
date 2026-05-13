import { describe, expect, it } from "vitest";
import {
  AUTO_TRIGGER_DISPATCH_STAGES,
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  buildAutoTriggerBlockForStage,
  type AutoTriggerStage
} from "../../src/content/skills.js";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { AC_AUTHOR_PROMPT } from "../../src/content/specialist-prompts/ac-author.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { SECURITY_REVIEWER_PROMPT } from "../../src/content/specialist-prompts/security-reviewer.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";

/**
 * v8.19 skill-windowing — every specialist dispatch used to embed the
 * full list of 17 auto-trigger skills. v8.19 tags each skill with the
 * stages it is relevant for (`triage`, `plan`, `build`, `review`,
 * `ship`, `compound`, `always`) and gates the rendered block by stage,
 * so each dispatch only carries the subset that applies to its hop.
 *
 * The token-budget assertion at the bottom locks in a minimum 20%
 * reduction per stage versus the legacy full-set block; a future
 * un-tag (every skill regressing to `["always"]`) would silently put
 * us back at the v8.18 footprint, and these tests would catch it.
 */
describe("v8.19 skill-windowing — stage-scoped skill loading", () => {
  describe("AC-1 — data shape", () => {
    it("AUTO_TRIGGER_SKILLS ships ≥17 entries (stage tagging is additive; v8.27 added code-simplification → 18)", () => {
      expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(17);
    });

    it("every skill carries a stages array (no legacy untagged drift)", () => {
      const untagged = AUTO_TRIGGER_SKILLS.filter((s) => s.stages === undefined);
      expect(untagged.map((s) => s.id)).toEqual([]);
    });

    it("every stages entry is a known AutoTriggerStage value", () => {
      const known = new Set<AutoTriggerStage>([
        "triage",
        "plan",
        "build",
        "review",
        "ship",
        "compound",
        "always"
      ]);
      for (const skill of AUTO_TRIGGER_SKILLS) {
        for (const stage of skill.stages ?? []) {
          expect(known.has(stage)).toBe(true);
        }
      }
    });
  });

  describe("AC-2 — final stage mapping (post-body sweep)", () => {
    function stagesById(id: string): ReadonlyArray<AutoTriggerStage> {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === id);
      if (!skill) throw new Error(`unknown skill id ${id}`);
      return skill.stages ?? ["always"];
    }

    it("triage-gate is triage-only (gate runs once at Hop 1)", () => {
      expect(stagesById("triage-gate")).toEqual(["triage"]);
    });

    it("flow-resume is always-on (resume can fire at any hop)", () => {
      expect(stagesById("flow-resume")).toEqual(["always"]);
    });

    it("pre-flight-assumptions covers triage and plan (Hop 2.5 + ac-author Phase 0)", () => {
      expect(stagesById("pre-flight-assumptions")).toEqual(["triage", "plan"]);
    });

    it("plan-authoring is plan-only (auto-applies on plan.md edits)", () => {
      expect(stagesById("plan-authoring")).toEqual(["plan"]);
    });

    it("ac-discipline rides plan + build + review (AC authoring, AC↔commit, AC reviews)", () => {
      expect(stagesById("ac-discipline")).toEqual(["plan", "build", "review"]);
    });

    it("tdd-and-verification rides build + review + ship (the verification gate wraps every handoff)", () => {
      expect(stagesById("tdd-and-verification")).toEqual(["build", "review", "ship"]);
    });

    it("commit-hygiene rides build + ship (slice-builder commits + reviewer release pass)", () => {
      expect(stagesById("commit-hygiene")).toEqual(["build", "ship"]);
    });

    it("review-discipline is review-only", () => {
      expect(stagesById("review-discipline")).toEqual(["review"]);
    });

    it("conversation-language / anti-slop / summary-format / flow-resume are always-on", () => {
      expect(stagesById("conversation-language")).toEqual(["always"]);
      expect(stagesById("anti-slop")).toEqual(["always"]);
      expect(stagesById("summary-format")).toEqual(["always"]);
      expect(stagesById("flow-resume")).toEqual(["always"]);
    });

    it("documentation-and-adrs lives in plan + ship (design Phase 6.5 + ship promotion)", () => {
      expect(stagesById("documentation-and-adrs")).toEqual(["plan", "ship"]);
    });

    it("api-evolution lives in plan + review (design-phase decisions + reviewer's Hyrum check)", () => {
      expect(stagesById("api-evolution")).toEqual(["plan", "review"]);
    });

    it("refinement lives in triage + plan (replan detection + plan refinement)", () => {
      expect(stagesById("refinement")).toEqual(["triage", "plan"]);
    });
  });

  describe("AC-3 — buildAutoTriggerBlock filter behaviour", () => {
    it("called with no argument returns the legacy full block (all 17 skills)", () => {
      const block = buildAutoTriggerBlock();
      for (const skill of AUTO_TRIGGER_SKILLS) {
        expect(block).toContain(`**${skill.id}**`);
      }
    });

    it("called with stage 'triage' includes triage-tagged + always-tagged skills only", () => {
      const block = buildAutoTriggerBlock("triage");
      expect(block).toContain("**triage-gate**");
      expect(block).toContain("**pre-flight-assumptions**");
      expect(block).toContain("**flow-resume**");
      expect(block).toContain("**conversation-language**");
      expect(block).not.toContain("**parallel-build**");
      expect(block).not.toContain("**commit-hygiene**");
      expect(block).not.toContain("**review-discipline**");
      expect(block).not.toContain("**tdd-and-verification**");
    });

    it("called with stage 'review' includes review-tagged + always-tagged skills only", () => {
      const block = buildAutoTriggerBlock("review");
      expect(block).toContain("**review-discipline**");
      expect(block).toContain("**ac-discipline**");
      expect(block).toContain("**tdd-and-verification**");
      expect(block).toContain("**anti-slop**");
      expect(block).not.toContain("**triage-gate**");
      expect(block).not.toContain("**plan-authoring**");
      expect(block).not.toContain("**pre-flight-assumptions**");
      expect(block).not.toContain("**parallel-build**");
    });

    it("always-tagged skills appear in every dispatch stage block", () => {
      const alwaysSkills = AUTO_TRIGGER_SKILLS.filter((s) => (s.stages ?? []).includes("always"));
      expect(alwaysSkills.length).toBeGreaterThan(0);
      for (const stage of AUTO_TRIGGER_DISPATCH_STAGES) {
        const block = buildAutoTriggerBlock(stage);
        for (const skill of alwaysSkills) {
          expect(block, `${skill.id} should ride stage ${stage} (always-on)`).toContain(
            `**${skill.id}**`
          );
        }
      }
    });

    it("unknown stage falls back to the full block (legacy-safe behaviour)", () => {
      // @ts-expect-error — exercising the JS-callable runtime fallback path.
      const block = buildAutoTriggerBlock("not-a-stage");
      for (const skill of AUTO_TRIGGER_SKILLS) {
        expect(block).toContain(`**${skill.id}**`);
      }
    });

    it("buildAutoTriggerBlockForStage('plan') matches buildAutoTriggerBlock('plan')", () => {
      expect(buildAutoTriggerBlockForStage("plan")).toBe(buildAutoTriggerBlock("plan"));
    });
  });

  describe("AC-4 — specialist prompts embed the right stage block", () => {
    it("design prompt includes the plan-stage block heading", () => {
      expect(DESIGN_PROMPT).toContain("## Active skills (stage: `plan`)");
    });

    it("ac-author prompt includes the plan-stage block heading", () => {
      expect(AC_AUTHOR_PROMPT).toContain("## Active skills (stage: `plan`)");
    });

    it("reviewer prompt includes the review-stage block heading", () => {
      expect(REVIEWER_PROMPT).toContain("## Active skills (stage: `review`)");
    });

    it("security-reviewer prompt includes the review-stage block heading", () => {
      expect(SECURITY_REVIEWER_PROMPT).toContain("## Active skills (stage: `review`)");
    });

    it("slice-builder prompt includes the build-stage block heading", () => {
      expect(SLICE_BUILDER_PROMPT).toContain("## Active skills (stage: `build`)");
    });

    it("design / ac-author prompts list pre-flight-assumptions (plan-stage skill)", () => {
      expect(DESIGN_PROMPT).toContain("**pre-flight-assumptions**");
      expect(AC_AUTHOR_PROMPT).toContain("**pre-flight-assumptions**");
    });

    it("reviewer prompt does NOT list plan-only skills (plan-authoring is plan-only)", () => {
      expect(REVIEWER_PROMPT).not.toContain("**plan-authoring**");
    });

    it("slice-builder prompt does NOT list pre-flight-assumptions (plan-only)", () => {
      expect(SLICE_BUILDER_PROMPT).not.toContain("**pre-flight-assumptions**");
    });
  });

  describe("AC-5 — token-budget assertion (20%+ reduction per dispatch stage)", () => {
    const fullBlock = buildAutoTriggerBlock();
    const fullLength = fullBlock.length;

    for (const stage of AUTO_TRIGGER_DISPATCH_STAGES) {
      it(`stage '${stage}' block is at least 20% smaller than the legacy full block`, () => {
        const stageBlock = buildAutoTriggerBlock(stage);
        const ratio = stageBlock.length / fullLength;
        // 20% reduction → stage block ≤ 80% of the full block length.
        expect(ratio).toBeLessThanOrEqual(0.8);
        // Sanity: the block is non-empty (the meta-summary line alone is ~100 chars).
        expect(stageBlock.length).toBeGreaterThan(50);
      });
    }
  });

  describe("AC-7 — install-time behaviour unchanged", () => {
    it("AUTO_TRIGGER_SKILLS array length is ≥17 (install loop writes N + cclaw-meta; v8.27 added code-simplification → 18)", () => {
      expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(17);
    });

    it("every skill still has a unique fileName (install writes each file once)", () => {
      const files = AUTO_TRIGGER_SKILLS.map((s) => s.fileName);
      expect(new Set(files).size).toBe(files.length);
    });

    it("every skill still has a non-empty body (install writes byte-for-byte)", () => {
      for (const skill of AUTO_TRIGGER_SKILLS) {
        expect(skill.body.length).toBeGreaterThan(0);
      }
    });
  });
});
