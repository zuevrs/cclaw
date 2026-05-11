import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.16 lock-in tests. The release merges 13 source skills into 6 thematic
 * groups, leaving 17 auto-trigger skills total (was 24 in v8.15).
 *
 * Each tripwire test pins one invariant of the merge so a future change that
 * forgets the move (re-adds a deleted id, drops a verbatim snippet, miswires
 * a specialist prompt) lights up immediately.
 */

const MERGED_SKILL_IDS = [
  "ac-discipline",
  "commit-hygiene",
  "tdd-and-verification",
  "api-evolution",
  "review-discipline",
  "debug-and-browser",
] as const;

const DELETED_SOURCE_IDS = [
  "ac-quality",
  "ac-traceability",
  "commit-message-quality",
  "surgical-edit-hygiene",
  "tdd-cycle",
  "verification-loop",
  "refactor-safety",
  "api-and-interface-design",
  "breaking-changes",
  "review-loop",
  "security-review",
  "debug-loop",
  "browser-verification",
] as const;

/**
 * For each merged skill, 2-3 verbatim snippets from each source that must
 * survive the merge. These are the load-bearing parts the reviewer and
 * slice-builder cite — finding templates, anti-rationalization rows,
 * threat-model checklist items, etc.
 */
const PROVENANCE_SNIPPETS: Record<(typeof MERGED_SKILL_IDS)[number], string[]> = {
  "ac-discipline": [
    // from ac-quality
    "Three checks per AC:",
    "Independently committable",
    'tests/unit/search.test.ts: \'returns BM25-ranked hits\'',
    // from ac-traceability
    "commit-helper.mjs",
    "node .cclaw/hooks/commit-helper.mjs --ac=AC-N --message=",
    "runCompoundAndShip` refuses to ship a strict-mode slug with any pending AC",
  ],
  "commit-hygiene": [
    // from commit-message-quality
    "Imperative voice",
    "Subject ≤72 characters",
    'fix: F-2 separate rejected token',
    // from surgical-edit-hygiene
    "Surgical Changes",
    "A-4 — Drive-by edits to adjacent comments / formatting / imports",
    "A-5 — Deletion of pre-existing dead code without permission",
    "`git add -A` is forbidden.",
  ],
  "tdd-and-verification": [
    // from tdd-cycle
    "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST",
    "Iron Law",
    "Anti-rationalization table",
    "rationalization | truth",
    "vertical / tracer bullet",
    // from verification-loop
    "build/typecheck/lint/test/security",
    "Never skip a gate to \"save time\"",
    "Verification log",
    // from refactor-safety
    "Chesterton's Fence",
    "Rule of 500",
    "behaviour-preserving",
  ],
  "api-evolution": [
    // from api-and-interface-design
    "Hyrum's Law",
    "one-version rule",
    "two-adapter rule",
    "Untrusted third-party API responses",
    // from breaking-changes
    "Churn Rule",
    "Strangler Pattern",
    "Zombie code",
    "BREAKING:",
  ],
  "review-discipline": [
    // from review-loop
    "Concern Ledger",
    "Five Failure Modes",
    "Hallucinated actions",
    "Scope creep",
    "Cascading errors",
    "Context loss",
    "Tool misuse",
    "convergence detector",
    // from security-review
    "Threat-model checklist",
    "Authentication",
    "Authorization",
    "Supply chain",
    "Data exposure",
  ],
  "debug-and-browser": [
    // from debug-loop
    "Hypothesis ranking",
    "loop ladder",
    "Tagged debug logs",
    "Multi-run protocol",
    "no seam",
    // from browser-verification
    "DevTools",
    "Console hygiene",
    "Accessibility",
    "Browser content as untrusted data",
    "five-check pass",
  ],
};

describe("v8.16 thematic skills merge", () => {
  describe("Skill set shape after merge", () => {
    it("ships exactly 17 auto-trigger skills (down from 24 in v8.15)", () => {
      expect(AUTO_TRIGGER_SKILLS.length).toBe(17);
    });

    it("skill count stays in the [15, 18] range mandated by the v8.16 brief", () => {
      expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(15);
      expect(AUTO_TRIGGER_SKILLS.length).toBeLessThanOrEqual(18);
    });
  });

  describe("Merged skills exist with expected ids", () => {
    for (const expectedId of MERGED_SKILL_IDS) {
      it(`registers the merged skill \`${expectedId}\``, () => {
        const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === expectedId);
        expect(skill).toBeDefined();
        expect(skill!.fileName).toBe(`${expectedId}.md`);
        expect(skill!.body.startsWith("---\n")).toBe(true);
        expect(skill!.body).toMatch(new RegExp(`name:\\s*${expectedId}`));
      });
    }
  });

  describe("Deleted source skills do not reappear", () => {
    for (const deletedId of DELETED_SOURCE_IDS) {
      it(`does NOT register the retired skill \`${deletedId}\``, () => {
        const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === deletedId);
        expect(skill).toBeUndefined();
      });
    }
  });

  describe("Content provenance — no verbatim snippet was dropped", () => {
    for (const mergedId of MERGED_SKILL_IDS) {
      const snippets = PROVENANCE_SNIPPETS[mergedId];
      for (const snippet of snippets) {
        it(`\`${mergedId}\` body still contains: ${snippet.slice(0, 50)}${snippet.length > 50 ? "…" : ""}`, () => {
          const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === mergedId);
          expect(skill).toBeDefined();
          expect(skill!.body).toContain(snippet);
        });
      }
    }
  });

  describe("Trigger semantics preserved", () => {
    it("ac-discipline inherits ac-quality + ac-traceability triggers (union, deduped)", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "ac-discipline")!;
      for (const trigger of [
        "edit:.cclaw/flows/*/plan.md",
        "specialist:planner",
        "specialist:reviewer:text-review",
        "before:git-commit",
        "before:git-push",
        "ac_mode:strict",
      ]) {
        expect(skill.triggers).toContain(trigger);
      }
    });

    it("commit-hygiene inherits commit-message-quality + surgical-edit-hygiene triggers", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "commit-hygiene")!;
      for (const trigger of [
        "before:commit-helper",
        "always-on",
        "specialist:slice-builder",
        "before:git-commit",
      ]) {
        expect(skill.triggers).toContain(trigger);
      }
    });

    it("tdd-and-verification inherits tdd-cycle + verification-loop + refactor-safety triggers", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "tdd-and-verification")!;
      for (const trigger of [
        "stage:build",
        "specialist:slice-builder",
        "specialist:reviewer",
        "stage:review",
        "stage:ship",
        "task:refactor",
        "pattern:refactor",
      ]) {
        expect(skill.triggers).toContain(trigger);
      }
    });

    it("api-evolution inherits api-and-interface-design + breaking-changes triggers", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "api-evolution")!;
      for (const trigger of [
        "specialist:design",
        "decision:public-interface",
        "decision:new-dependency",
        "touch-surface:public-api",
        "diff:public-api",
        "frontmatter:breaking_change=true",
      ]) {
        expect(skill.triggers).toContain(trigger);
      }
    });

    it("review-discipline inherits review-loop + security-review triggers", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "review-discipline")!;
      for (const trigger of [
        "specialist:reviewer",
        "specialist:security-reviewer",
        "security-flag:true",
        "diff:auth|secrets|supply-chain|pii",
      ]) {
        expect(skill.triggers).toContain(trigger);
      }
    });

    it("debug-and-browser inherits debug-loop + browser-verification triggers", () => {
      const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "debug-and-browser")!;
      for (const trigger of [
        "stop-the-line",
        "specialist:slice-builder:fix-only",
        "task:bug-fix",
        "test-failed-unclear-reason",
        "ac_mode:strict",
        "touch-surface:ui",
        "diff:tsx|jsx|vue|svelte|html|css",
      ]) {
        expect(skill.triggers).toContain(trigger);
      }
    });
  });

  describe("Specialist prompt `lib/skills/<id>.md` references resolve to live skills", () => {
    it("every cited skill file in slice-builder, reviewer, security-reviewer, start-command resolves to a registered id", async () => {
      const fileNames = new Set(AUTO_TRIGGER_SKILLS.map((s) => s.fileName));
      const sources = await Promise.all([
        import("../../src/content/specialist-prompts/slice-builder.js"),
        import("../../src/content/specialist-prompts/reviewer.js"),
        import("../../src/content/specialist-prompts/security-reviewer.js"),
        import("../../src/content/specialist-prompts/planner.js"),
        import("../../src/content/specialist-prompts/design.js"),
        import("../../src/content/start-command.js"),
      ]);
      const corpus = sources
        .map((mod) => Object.values(mod).filter((v): v is string => typeof v === "string").join("\n"))
        .join("\n");
      const cited = new Set<string>();
      const re = /\.cclaw\/lib\/skills\/([a-z-]+\.md)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(corpus)) !== null) {
        cited.add(m[1]!);
      }
      for (const fileName of cited) {
        // `cclaw-meta.md` is the meta-skill — it ships alongside the
        // auto-trigger skills but is not in AUTO_TRIGGER_SKILLS.
        if (fileName === "cclaw-meta.md") continue;
        expect(fileNames, `cited \`lib/skills/${fileName}\` must be a live AUTO_TRIGGER_SKILLS entry`).toContain(fileName);
      }
    });

    it("no specialist prompt cites a deleted (pre-v8.16) skill file", async () => {
      const deletedFileNames = DELETED_SOURCE_IDS.map((id) => `${id}.md`);
      const sources = await Promise.all([
        import("../../src/content/specialist-prompts/slice-builder.js"),
        import("../../src/content/specialist-prompts/reviewer.js"),
        import("../../src/content/specialist-prompts/security-reviewer.js"),
        import("../../src/content/specialist-prompts/planner.js"),
        import("../../src/content/specialist-prompts/design.js"),
      ]);
      const corpus = sources
        .map((mod) => Object.values(mod).filter((v): v is string => typeof v === "string").join("\n"))
        .join("\n");
      for (const deletedFileName of deletedFileNames) {
        expect(corpus, `specialist prompts must not cite the retired \`lib/skills/${deletedFileName}\``).not.toMatch(
          new RegExp(`\\.cclaw/lib/skills/${deletedFileName.replace(".", "\\.")}`),
        );
      }
    });
  });

  describe("Install layer writes exactly the registered count", () => {
    it("AUTO_TRIGGER_SKILLS.length stays at 17, the basis for the install loop", () => {
      // install.ts iterates AUTO_TRIGGER_SKILLS and writes one .md per entry
      // plus cclaw-meta.md; the resulting on-disk count is N+1 = 18.
      expect(AUTO_TRIGGER_SKILLS.length).toBe(17);
    });
  });
});
