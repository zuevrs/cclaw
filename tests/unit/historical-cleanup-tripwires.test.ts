import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { renderCancelCommand } from "../../src/content/cancel-command.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { LEGACY_SPECIALIST_IDS, SPECIALISTS } from "../../src/types.js";
import {
  RETIRED_COMMAND_FILES,
  syncCclaw,
} from "../../src/install.js";
import { createMenuState, renderMenuFrame } from "../../src/main-menu.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.110 — consolidated historical-cleanup tripwires.
 *
 * Merges five micro-test files (v811 / v814 / v816 / v839 / v860 cleanup)
 * into one. Each section preserves every assertion verbatim from the
 * original file; file count -4, coverage unchanged. The docstrings on each
 * `describe` block carry the original file's framing so the slug
 * annotations (v8.103, v8.106, v8.40, v8.62, v8.99, v8.100) remain visible
 * to the next reader.
 */

// v8.11 — cancel-vs-recovery contract + slug naming (slimmed in v8.54;
// v8.103 folded the dedicated Slug-naming heading into the Triage
// paragraph; v8.106 retired the flow-resume skill and re-pinned the
// Cancel-arm assertion against the detect-matrix runbook).

const startBody = renderStartCommand();
const cancelBody = renderCancelCommand();

describe("v8.11 — cancel-vs-recovery contract", () => {
  it("detect-matrix runbook (v8.106 successor of flow-resume skill) does NOT offer Cancel as a picker arm", () => {
    const detectMatrix = ON_DEMAND_RUNBOOKS.find((r) => r.id === "detect-matrix");
    expect(detectMatrix, "detect-matrix runbook must exist").toBeDefined();
    expect(detectMatrix!.body).not.toMatch(/\[c\]\s+Cancel/);
  });

  it("/cc-cancel is never a clickable option from start-command (explicit-only nuke)", () => {
    expect(startBody).toMatch(/\\?`?\/cc-cancel\\?`?\s+is\s+never\s+a\s+clickable\s+option/i);
  });

  it("cancel-command prose: stops the flow without finishing, never deletes artifacts", () => {
    expect(cancelBody).toMatch(/Stop the current flow without finishing it/);
    expect(cancelBody).toMatch(/never deletes artifacts/);
  });
});

describe("v8.11 — slug naming format (YYYYMMDD-<semantic-kebab>)", () => {
  it("start-command spells out the mandatory date-prefix slug format + collision fallback (v8.103 — heading folded into the Triage paragraph)", () => {
    expect(startBody).toMatch(/\\?`?YYYYMMDD-<semantic-kebab>\\?`?/);
    expect(startBody).toMatch(/append(ing)?\s+\\?`?-2\\?`?,\s*\\?`?-3\\?`?/);
  });
});

// v8.14 / v8.62 — discovery roster migration (brainstormer + retired
// design specialist; v8.62 reclaimed the `architect` id for the live
// specialist; decisions template stays installed only on
// legacy-artifacts: true).

describe("v8.14/v8.62 discovery-roster migration anchor", () => {
  it("legacy roster retires `brainstormer` and never shadows the live `architect` specialist (v8.62 reclaimed `architect`)", () => {
    expect(LEGACY_SPECIALIST_IDS as readonly string[]).toContain("brainstormer");
    expect(SPECIALISTS as readonly string[]).not.toContain("brainstormer");
    // v8.62 — `architect` is now a live SPECIALISTS member; the legacy
    // list must NOT shadow it.
    expect(LEGACY_SPECIALIST_IDS as readonly string[]).not.toContain("architect");
    expect(SPECIALISTS as readonly string[]).toContain("architect");
  });

  it("v8.62 — `architect` ships as an on-demand specialist (replacing v8.14's main-context `design`; mid-plan dialogue is dead, every specialist now runs as a sub-agent)", () => {
    const architect = CORE_AGENTS.find((agent) => agent.id === "architect");
    expect(architect?.activation).toBe("on-demand");
    // The retired v8.14 design specialist is gone.
    const design = CORE_AGENTS.find((agent) => agent.id === "design");
    expect(design).toBeUndefined();
  });

  it("decisions template stays installed only on legacy-artifacts: true (v8.14 inline + v8.54 gating; v8.62 unchanged)", () => {
    const decisions = ARTIFACT_TEMPLATES.find((template) => template.id === "decisions");
    expect(decisions?.body).toMatch(/legacy/iu);
    expect(decisions?.description).toMatch(/legacy-artifacts/iu);
  });
});

// v8.16 — thematic skills merge (13 sources -> 6 merged ids; 17
// auto-trigger skills baseline; slimmed in v8.99 to dangling-ref +
// trigger tripwires + provenance + count band).

// ac-discipline was itself absorbed into commit-hygiene in the consolidation
// pass; its provenance snippets are now asserted under commit-hygiene below.
const MERGED_SKILL_IDS = [
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
  // commit-hygiene absorbed surgical-edit-hygiene (v8.16) AND ac-discipline
  // (consolidation pass) — assert both lineages' load-bearing snippets.
  "commit-hygiene": [
    "Surgical Changes",
    "`git add -A` is forbidden.",
    "Three checks per AC:",
    "git log --grep",
  ],
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

// v8.39 — TUI menu cleanup (slimmed in v8.100 to renderMenuFrame
// integration tests only; source-grep tripwires dropped because they
// didn't catch real regressions).

describe("v8.39 cleanup — rendered menu surfaces the v8.39 shape", () => {
  it("rendered menu frame does NOT surface the retired row labels", () => {
    const installedFrame = renderMenuFrame(createMenuState(true), { useColor: false });
    const freshFrame = renderMenuFrame(createMenuState(false), { useColor: false });
    const retiredLabels = ["Sync", "Upgrade", "Browse knowledge", "Show version"];
    for (const frame of [installedFrame, freshFrame]) {
      for (const label of retiredLabels) {
        expect(
          frame,
          `rendered frame must not surface retired label \`${label}\` after v8.39`
        ).not.toContain(label);
      }
    }
  });

  it("hotkey legend renders the actual range (currently `1-3`, not the stale `1-7`)", () => {
    const frame = renderMenuFrame(createMenuState(false), { useColor: false });
    expect(frame).toContain("1-3 to jump");
    expect(frame).not.toContain("1-7 to jump");
  });
});

// v8.60 — command retirement wiring (slimmed in v8.100 to the two
// syncCclaw integration tests that exercise the retire-and-sweep wiring;
// prompt/content-grep tripwires dropped because they didn't catch real
// regressions).

describe("v8.60 — command retirement", () => {
  it("install writes only cc.md and cc-cancel.md (retired commands swept)", async () => {
    const project = await createTempProject();
    try {
      const staleDir = path.join(project, ".cursor", "commands");
      await fs.mkdir(staleDir, { recursive: true });
      for (const file of RETIRED_COMMAND_FILES) {
        await fs.writeFile(path.join(staleDir, file), "# stale\n", "utf8");
      }

      await syncCclaw({ cwd: project, harnesses: ["cursor"] });

      const dir = path.join(project, ".cursor", "commands");
      const installed = (await fs.readdir(dir)).sort();
      expect(installed).toEqual(["cc-cancel.md", "cc.md"]);
      for (const retired of RETIRED_COMMAND_FILES) {
        await expect(fs.access(path.join(dir, retired))).rejects.toBeTruthy();
      }

      await expect(fs.access(path.join(project, ".cclaw", "lib", "templates", "ideas.md"))).rejects.toBeTruthy();
    } finally {
      await removeProject(project);
    }
  });

  it("SyncResult.counts.commands is 2", async () => {
    const project = await createTempProject();
    try {
      const result = await syncCclaw({ cwd: project, harnesses: ["cursor"] });
      expect(result.counts.commands).toBe(2);
    } finally {
      await removeProject(project);
    }
  });
});
