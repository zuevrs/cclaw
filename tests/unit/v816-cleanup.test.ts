import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.16 lock-in tests. The release merges 13 source skills into 6 thematic
 * groups, leaving 17 auto-trigger skills total (was 24 in v8.15).
 *
 * Slimmed in v8.99 test-slim-down A2: kept the dangling-skill-ref tripwires
 * (specialist prompts must only cite live skills) plus a small number of
 * canonical v8.16 invariants (shape, merged/deleted ids, provenance, the
 * two highest-value trigger tripwires). Drops the per-snippet × per-skill
 * × per-trigger fan-out that was prompt-grep coverage.
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

const PROVENANCE_SNIPPETS: Record<(typeof MERGED_SKILL_IDS)[number], string[]> = {
  "ac-discipline": ["Three checks per AC:", "git log --grep"],
  "commit-hygiene": ["Surgical Changes", "`git add -A` is forbidden."],
  "tdd-and-verification": [
    "NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST",
    "build/typecheck/lint/test/security",
    "Chesterton's Fence",
  ],
  "api-evolution": ["Hyrum's Law", "Strangler Pattern", "BREAKING:"],
  "review-discipline": ["Findings", "Five Failure Modes", "Threat-model checklist"],
  "debug-and-browser": ["Hypothesis ranking", "Tagged debug logs", "DevTools"],
};

describe("v8.16 thematic skills merge", () => {
  it("auto-trigger skill count stays in the [15, 35] band (v8.16 floor of 17 merged skills + room for additive imports)", () => {
    expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(15);
    expect(AUTO_TRIGGER_SKILLS.length).toBeLessThanOrEqual(35);
    expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(17);
  });

  it("every merged skill id is registered with the expected fileName + frontmatter", () => {
    for (const expectedId of MERGED_SKILL_IDS) {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === expectedId);
      expect(skill, `merged skill \`${expectedId}\` must be registered`).toBeDefined();
      expect(skill!.fileName).toBe(`${expectedId}.md`);
      expect(skill!.body.startsWith("---\n")).toBe(true);
      expect(skill!.body).toMatch(new RegExp(`name:\\s*${expectedId}`));
    }
  });

  it("no retired pre-v8.16 source skill id reappears in AUTO_TRIGGER_SKILLS", () => {
    for (const deletedId of DELETED_SOURCE_IDS) {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === deletedId);
      expect(skill, `retired skill \`${deletedId}\` must not reappear`).toBeUndefined();
    }
  });

  it("merged skill bodies still contain the load-bearing verbatim snippets from each source skill (provenance check)", () => {
    for (const mergedId of MERGED_SKILL_IDS) {
      const skill = AUTO_TRIGGER_SKILLS.find((entry) => entry.id === mergedId)!;
      for (const snippet of PROVENANCE_SNIPPETS[mergedId]) {
        expect(skill.body, `\`${mergedId}\` must contain ${snippet.slice(0, 50)}`).toContain(snippet);
      }
    }
  });

  // v8.40 + v8.62 tripwires — the highest-value trigger invariants the merge
  // must preserve. Per-skill trigger fan-out tests dropped in v8.99 slim-down.
  it("commit-hygiene does NOT carry the retired `before:commit-helper` trigger (v8.40 retired commit-helper)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "commit-hygiene")!;
    expect(skill.triggers).not.toContain("before:commit-helper");
    expect(skill.triggers).toContain("specialist:builder");
  });

  it("review-discipline absorbed the security-review axis (v8.62) — does NOT name `specialist:security-reviewer`", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((e) => e.id === "review-discipline")!;
    expect(skill.triggers).toContain("specialist:reviewer");
    expect(skill.triggers).not.toContain("specialist:security-reviewer");
  });

  // Dangling-skill-ref tripwires — PRESERVED per v8.99 slim-down plan.
  it("every `.cclaw/lib/skills/<id>.md` reference in architect, builder, reviewer, start-command resolves to a live AUTO_TRIGGER_SKILLS entry", async () => {
    const fileNames = new Set(AUTO_TRIGGER_SKILLS.map((s) => s.fileName));
    const sources = await Promise.all([
      import("../../src/content/specialist-prompts/architect.js"),
      import("../../src/content/specialist-prompts/builder.js"),
      import("../../src/content/specialist-prompts/reviewer.js"),
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
      if (fileName === "cclaw-meta.md") continue;
      expect(fileNames, `cited \`lib/skills/${fileName}\` must be a live AUTO_TRIGGER_SKILLS entry`).toContain(fileName);
    }
  });

  it("no specialist prompt cites a deleted (pre-v8.16) skill file", async () => {
    const deletedFileNames = DELETED_SOURCE_IDS.map((id) => `${id}.md`);
    const sources = await Promise.all([
      import("../../src/content/specialist-prompts/architect.js"),
      import("../../src/content/specialist-prompts/builder.js"),
      import("../../src/content/specialist-prompts/reviewer.js"),
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
