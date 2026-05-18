import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

/**
 * v8.83-token-axes — gated reviewer axes lifted to companion skills.
 *
 * The five gated reviewer axes (qa-evidence / design-quality /
 * security / nfr-compliance / edit-discipline) had their full bodies
 * lifted out of `reviewer.ts` into per-axis companion skills under
 * `src/content/skills/reviewer-axis-*.md`. reviewer.ts retains short
 * 5-line stubs that point at each companion skill; the heavy prose
 * (rubrics, sub-checks, severity matrices, anti-rationalizations)
 * lives in the skill body and loads only when the axis's gate fires.
 *
 * `buildAutoTriggerBlock(stage, gateEnvelope?)` was extended with an
 * optional second parameter so a runtime call-site (orchestrator
 * dispatch envelope construction) can filter the rendered block down
 * to only the gated axes whose flags are set. Legacy callers
 * (module-import-time call-sites such as the reviewer-prompt template
 * literal) bypass the predicate and continue to see every
 * stage-tagged skill.
 *
 * Tripwires below pin the v8.83 invariants so a future change that
 * silently re-inlines an axis body, drops a companion skill, or
 * regresses the gate-filtering contract lights up immediately.
 */

const REVIEWER_AXIS_SKILL_IDS = [
  "reviewer-axis-qa-evidence",
  "reviewer-axis-design-quality",
  "reviewer-axis-security",
  "reviewer-axis-nfr-compliance",
  "reviewer-axis-edit-discipline"
] as const;

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const REVIEWER_TS_PATH = path.join(
  PROJECT_ROOT,
  "src/content/specialist-prompts/reviewer.ts"
);

describe("v8.83 — five new reviewer-axis companion skill files exist on disk", () => {
  for (const id of REVIEWER_AXIS_SKILL_IDS) {
    it(`AC-1 — \`${id}.md\` is present under src/content/skills/`, async () => {
      const filePath = path.join(SKILLS_DIR, `${id}.md`);
      const stat = await fs.stat(filePath);
      expect(stat.isFile()).toBe(true);
      const body = await fs.readFile(filePath, "utf8");
      expect(body.length).toBeGreaterThan(500);
      expect(body.startsWith("---\n")).toBe(true);
      expect(body).toMatch(/^name:\s*reviewer-axis-/m);
      expect(body).toMatch(/^trigger:/m);
    });
  }
});

describe("v8.83 — AUTO_TRIGGER_SKILLS registers the five reviewer-axis skills with stage=review + gate predicate", () => {
  for (const id of REVIEWER_AXIS_SKILL_IDS) {
    it(`AC-2 — \`${id}\` is registered with stages ["review"] and a gate predicate`, () => {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === id);
      expect(skill, `expected AUTO_TRIGGER_SKILLS to register \`${id}\``).toBeDefined();
      expect(skill!.stages).toEqual(["review"]);
      expect(typeof skill!.gate).toBe("function");
      expect(skill!.body.length).toBeGreaterThan(500);
    });
  }

  it("AC-2 — every reviewer-axis skill's body contains its own filename in the file pointer (no body / id drift)", () => {
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === id)!;
      expect(skill.fileName).toBe(`${id}.md`);
      expect(skill.body).toContain(`# Skill: ${id}`);
    }
  });
});

describe("v8.83 — gate predicates wire to the canonical envelope flags", () => {
  const find = (id: (typeof REVIEWER_AXIS_SKILL_IDS)[number]) =>
    AUTO_TRIGGER_SKILLS.find((s) => s.id === id)!;

  it("AC-3 — `reviewer-axis-qa-evidence` gate fires on `walkQaEvidenceAxis: true`", () => {
    const gate = find("reviewer-axis-qa-evidence").gate!;
    expect(gate({ walkQaEvidenceAxis: true })).toBe(true);
    expect(gate({})).toBe(false);
    expect(gate({ walkQaEvidenceAxis: false })).toBe(false);
  });

  it("AC-3 — `reviewer-axis-design-quality` gate fires on `walkDesignQualityAxis: true`", () => {
    const gate = find("reviewer-axis-design-quality").gate!;
    expect(gate({ walkDesignQualityAxis: true })).toBe(true);
    expect(gate({})).toBe(false);
  });

  it("AC-3 — `reviewer-axis-security` gate fires on `securityFlag: true`", () => {
    const gate = find("reviewer-axis-security").gate!;
    expect(gate({ securityFlag: true })).toBe(true);
    expect(gate({})).toBe(false);
  });

  it("AC-3 — `reviewer-axis-nfr-compliance` gate fires on `planHasNonFunctional: true`", () => {
    const gate = find("reviewer-axis-nfr-compliance").gate!;
    expect(gate({ planHasNonFunctional: true })).toBe(true);
    expect(gate({})).toBe(false);
  });

  it("AC-3 — `reviewer-axis-edit-discipline` gate fires on `editDisciplineActive: true`", () => {
    const gate = find("reviewer-axis-edit-discipline").gate!;
    expect(gate({ editDisciplineActive: true })).toBe(true);
    expect(gate({})).toBe(false);
  });
});

describe("v8.83 — reviewer.ts no longer contains the lifted axis bodies (asserted via unique phrases)", () => {
  // Unique phrases that lived inside the original axis bodies. After
  // extraction, these phrases live ONLY in the companion skill files —
  // not in reviewer.ts. The tripwire fires if a future change re-inlines
  // any of the bodies back into the prompt.

  const LIFTED_BODY_PHRASES_BY_AXIS: Array<{
    axis: string;
    phrases: string[];
  }> = [
    {
      axis: "edit-discipline",
      phrases: [
        "But the new file was just a helper, doesn't count toward the slice's Surface.",
        "But I had to touch the schema to fix a type error that surfaced during GREEN.",
        "But the pre-edit probes were noise — the file is small."
      ]
    },
    {
      axis: "qa-evidence",
      phrases: [
        "But the AC was so small, a Playwright spec is overkill — manual was fine.",
        "But the manual steps were confirmed by the user — that's stronger than a Playwright spec.",
        "is the **independent cross-check** that the evidence rows actually substantiate that verdict"
      ]
    },
    {
      axis: "security",
      phrases: [
        "Mark all five threat-model items as `n/a` with one-line justification each",
        "Conflating a threat-model `flag` (documented trade-off) with a `critical`/`required`-severity finding",
        "Skipping the supply-chain check on TS / JS projects with package.json changes"
      ]
    },
    {
      axis: "nfr-compliance",
      phrases: [
        "NFR authoring is an architect Frame-phase decision, not a reviewer responsibility",
        "do not synthesize budgets, do not check against external defaults"
      ]
    },
    {
      axis: "design-quality",
      phrases: [
        "It's a small diff — design quality doesn't matter at this scale.",
        "I'll grade everything 7/10 to avoid emitting findings — the diff is fine.",
        "Accessibility is the user's responsibility — I just ship the visual design."
      ]
    }
  ];

  for (const { axis, phrases } of LIFTED_BODY_PHRASES_BY_AXIS) {
    for (const phrase of phrases) {
      it(`AC-4 — reviewer.ts does NOT contain the lifted ${axis} phrase "${phrase.slice(0, 60)}${phrase.length > 60 ? "…" : ""}"`, () => {
        expect(
          REVIEWER_PROMPT,
          `reviewer.ts re-inlined the ${axis} axis body (phrase: "${phrase}"). The v8.83 lift moves this prose into \`src/content/skills/reviewer-axis-${axis}.md\`; reviewer.ts must carry only the 5-line stub pointer.`
        ).not.toContain(phrase);
      });
    }
  }
});

describe("v8.83 — reviewer.ts carries a 5-line stub for each of the five axes", () => {
  const AXIS_STUBS: Array<{ heading: RegExp; pointerSkillId: string }> = [
    {
      heading: /^###\s+Edit-discipline axis/m,
      pointerSkillId: "reviewer-axis-edit-discipline"
    },
    {
      heading: /^###\s+qa-evidence axis/m,
      pointerSkillId: "reviewer-axis-qa-evidence"
    },
    {
      heading: /^###\s+Security axis/m,
      pointerSkillId: "reviewer-axis-security"
    },
    {
      heading: /^###\s+nfr-compliance axis/m,
      pointerSkillId: "reviewer-axis-nfr-compliance"
    },
    {
      heading: /^###\s+Design-quality axis/m,
      pointerSkillId: "reviewer-axis-design-quality"
    }
  ];

  for (const { heading, pointerSkillId } of AXIS_STUBS) {
    it(`AC-5 — reviewer.ts carries an axis-stub heading for \`${pointerSkillId}\` pointing at the companion skill`, () => {
      expect(
        heading.test(REVIEWER_PROMPT),
        `reviewer.ts is missing the stub heading for ${pointerSkillId}`
      ).toBe(true);
      // The stub body MUST cite the companion skill's filename so the
      // agent can load it on demand. We use the skill id (not the full
      // path) because the prompt may carry either shape.
      expect(REVIEWER_PROMPT).toContain(pointerSkillId);
    });
  }
});

describe("v8.83 — buildAutoTriggerBlock(stage, gateEnvelope) gate-filters reviewer-axis skills", () => {
  it("AC-6 — buildAutoTriggerBlock(\"review\") (no gate envelope) emits ALL five reviewer-axis pointers (legacy bypass)", () => {
    const block = buildAutoTriggerBlock("review");
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      expect(
        block,
        `legacy stage-only call must emit \`${id}\` (gate predicates only fire when a gateEnvelope is passed)`
      ).toContain(id);
    }
  });

  it("AC-6 — buildAutoTriggerBlock(\"review\", {}) (empty gate envelope) emits ZERO reviewer-axis pointers", () => {
    const block = buildAutoTriggerBlock("review", {});
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      expect(
        block,
        `empty gate envelope must filter \`${id}\` out (every gate predicate returns false on {})`
      ).not.toContain(id);
    }
  });

  it("AC-6 — buildAutoTriggerBlock with all five gate flags set emits all five reviewer-axis pointers", () => {
    const env: GateEnvelope = {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true
    };
    const block = buildAutoTriggerBlock("review", env);
    for (const id of REVIEWER_AXIS_SKILL_IDS) {
      expect(block).toContain(id);
    }
  });

  it("AC-6 — buildAutoTriggerBlock with only `walkQaEvidenceAxis` emits qa-evidence and excludes the other four", () => {
    const block = buildAutoTriggerBlock("review", { walkQaEvidenceAxis: true });
    expect(block).toContain("reviewer-axis-qa-evidence");
    expect(block).not.toContain("reviewer-axis-design-quality");
    expect(block).not.toContain("reviewer-axis-security");
    expect(block).not.toContain("reviewer-axis-nfr-compliance");
    expect(block).not.toContain("reviewer-axis-edit-discipline");
  });

  it("AC-6 — non-gated review-stage skills (e.g. `review-discipline`) are unaffected by the gate envelope", () => {
    const blockUnfiltered = buildAutoTriggerBlock("review");
    const blockEmpty = buildAutoTriggerBlock("review", {});
    expect(blockUnfiltered).toContain("review-discipline");
    expect(blockEmpty).toContain("review-discipline");
    // Always-on skills must still be in the gate-filtered block (they
    // ride every stage block via stages: ["always"], no gate predicate).
    expect(blockEmpty).toContain("anti-slop");
  });
});

describe("v8.83 — reviewer.ts size is meaningfully smaller post-extraction (sanity check on savings)", () => {
  it("AC-7 — reviewer.ts source file size dropped from ~93k chars to under 83k chars after the five-axis lift (post-v8.84 + v8.85 stub headroom; +v8.96.1 G-2 superset-hint paragraph)", async () => {
    const source = await fs.readFile(REVIEWER_TS_PATH, "utf8");
    // Loose sanity check — the original was ~93k chars. After
    // extracting the five gated-axis bodies, the file should drop by
    // at least ~10k chars (the combined axis prose). We assert a
    // generous ceiling rather than a precise count so future additive
    // edits (v8.84 scope-drift stub, v8.85 assumption-coverage stub +
    // 13-axis recapture, v8.96.1 superset-hint paragraph wired to
    // runbooks/dispatch-skills-index.md) don't constantly tickle this
    // tripwire. v8.96.1 lifted ceiling 82000 → 83000 to absorb the
    // Phase C G-2 superset-note paragraph (~600 chars) that points
    // sub-agents at the runtime-resolved per-envelope skills slice.
    expect(
      source.length,
      `reviewer.ts is ${source.length} chars; the v8.83 lift expected post-extraction size to be under 83000 chars (down from ~92976 chars pre-extraction; v8.96.1 lifted ceiling 82000 → 83000 for the G-2 superset-note paragraph). A regression here means an axis body was silently re-inlined.`
    ).toBeLessThan(83000);
  });
});

describe("v8.83 — version bump", () => {
  it("AC-8 — package.json bumps to at least 8.86.0 (the v8.83-token-axes slug ships after the Wave 1 patch lane)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(86);
  });

  it("AC-8 — CHANGELOG.md carries an entry naming the v8.83-token-axes work", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.83-token-axes|gated reviewer axes/i);
  });
});

describe("v8.83 — README skills count bumps to reflect the five new reviewer-axis skills", () => {
  it("AC-9 — README references the current AUTO_TRIGGER_SKILLS.length (post-v8.83 baseline = 32; v8.84 adds scope-drift → 33)", async () => {
    const readme = await fs.readFile(
      path.join(PROJECT_ROOT, "README.md"),
      "utf-8"
    );
    // The README count should match AUTO_TRIGGER_SKILLS.length post-lift.
    // We assert against the live count so adding a sixth reviewer-axis
    // skill (v8.84 scope-drift) does not re-light this tripwire — the
    // count tracks the structural total, not a frozen v8.83 literal.
    const expected = `${AUTO_TRIGGER_SKILLS.length}`;
    expect(
      readme,
      `README.md must reflect the post-v8.83 skill count (currently ${expected}). The literal moved from "32 skills" to "${expected} skills" when scope-drift landed.`
    ).toMatch(new RegExp(`\\b${expected}\\b\\s*(?:skills|auto-trigger)`, "u"));
  });
});
