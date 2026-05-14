import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SPECIALISTS, LEGACY_PLANNER_ID } from "../../src/types.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import {
  AC_AUTHOR_PROMPT,
  DESIGN_PROMPT,
  REVIEWER_PROMPT,
  SECURITY_REVIEWER_PROMPT,
  SLICE_BUILDER_PROMPT,
} from "../../src/content/specialist-prompts/index.js";
import {
  isLegacyPlanner,
  migrateFlowState,
  FLOW_STATE_SCHEMA_VERSION,
} from "../../src/flow-state.js";
import { SPECIALIST_AGENTS, renderAgentMarkdown } from "../../src/content/core-agents.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";

/**
 * v8.28 — rename `planner` specialist → `ac-author`.
 *
 * The biggest mechanical sweep in the v8.22-v8.28 roadmap: file rename,
 * symbol rename, type rename, prompt-body sweep across 30+ files, plus a
 * `rewriteLegacyPlanner` migration that mirrors the v8.14
 * `rewriteLegacyDiscoverySpecialist` shape (semantics-preserving rewrite,
 * not a `null` reset — the planner contract was unchanged, only the id).
 *
 * These tripwires lock the rename so a future refactor cannot accidentally
 * resurrect the old id or break the migration story for in-flight state
 * files.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const FILES_THAT_MENTION_PLANNER_LEGITIMATELY = new Set<string>([
  // The single-source spelling of the legacy id.
  path.join("src", "types.ts"),
  // The migration predicate + rewriter.
  path.join("src", "flow-state.ts"),
  // Config schema retains the `planner` alias for one release.
  path.join("src", "config.ts"),
  // Migration tripwire test (this file).
  path.join("tests", "unit", "v828-rename-planner-to-ac-author.test.ts"),
]);

describe("v8.28 — SPECIALISTS array carries `ac-author`, not `planner`", () => {
  it("AC-1: `ac-author` is a member of SPECIALISTS", () => {
    expect((SPECIALISTS as readonly string[]).includes("ac-author")).toBe(true);
  });

  it("AC-1: `planner` is NOT a member of SPECIALISTS", () => {
    expect((SPECIALISTS as readonly string[]).includes("planner")).toBe(false);
  });

  it("AC-1: SPECIALISTS order is design, ac-author, plan-critic, reviewer, security-reviewer, critic, qa-runner, slice-builder (v8.42 inserted critic between security-reviewer and slice-builder; v8.51 inserted plan-critic between ac-author and reviewer; v8.52 inserted qa-runner between critic and slice-builder)", () => {
    expect([...SPECIALISTS]).toEqual([
      "design",
      "ac-author",
      "plan-critic",
      "reviewer",
      "security-reviewer",
      "critic",
      "qa-runner",
      "slice-builder",
    ]);
  });
});

describe("v8.28 — SPECIALIST_PROMPTS keyed at `ac-author`", () => {
  it("AC-2: SPECIALIST_PROMPTS[`ac-author`] is a non-empty prompt body", () => {
    expect(typeof SPECIALIST_PROMPTS["ac-author"]).toBe("string");
    expect(SPECIALIST_PROMPTS["ac-author"].length).toBeGreaterThan(1000);
  });

  it("AC-2: SPECIALIST_PROMPTS has no `planner` key (type-level guarantee + runtime check; v8.42 added critic key; v8.51 added plan-critic key; v8.52 added qa-runner key)", () => {
    expect(Object.keys(SPECIALIST_PROMPTS)).not.toContain("planner");
    expect(Object.keys(SPECIALIST_PROMPTS).sort()).toEqual([
      "ac-author",
      "critic",
      "design",
      "plan-critic",
      "qa-runner",
      "reviewer",
      "security-reviewer",
      "slice-builder",
    ]);
  });

  it("AC-2: AC_AUTHOR_PROMPT exported symbol matches SPECIALIST_PROMPTS[`ac-author`]", () => {
    expect(AC_AUTHOR_PROMPT).toBe(SPECIALIST_PROMPTS["ac-author"]);
  });
});

describe("v8.28 — `# ac-author` header in the renamed prompt body", () => {
  it("AC-3: AC_AUTHOR_PROMPT starts with `# ac-author`, not `# planner`", () => {
    expect(AC_AUTHOR_PROMPT).toMatch(/^# ac-author/u);
    expect(AC_AUTHOR_PROMPT).not.toMatch(/^# planner/u);
  });

  it("AC-3: AC_AUTHOR_PROMPT body refers to itself as `ac-author`", () => {
    expect(AC_AUTHOR_PROMPT).toMatch(/cclaw ac-author/u);
  });

  it("AC-3: AC_AUTHOR_PROMPT does not contain the literal word `planner` (case-insensitive)", () => {
    expect(AC_AUTHOR_PROMPT).not.toMatch(/\bplanner\b/iu);
  });
});

describe("v8.28 — agents/ac-author.md is the install target (not agents/planner.md)", () => {
  it("AC-4: SPECIALIST_AGENTS has an entry with id `ac-author`", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === "ac-author");
    expect(agent).toBeDefined();
    expect(agent?.title).toMatch(/AC|author/iu);
  });

  it("AC-4: SPECIALIST_AGENTS has NO entry with id `planner`", () => {
    expect(SPECIALIST_AGENTS.find((a) => a.id === "planner")).toBeUndefined();
  });

  it("AC-4: renderAgentMarkdown(ac-author) emits frontmatter `name: ac-author`", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === "ac-author")!;
    const md = renderAgentMarkdown(agent);
    expect(md).toMatch(/^---\nname: ac-author\n/u);
    expect(md).not.toMatch(/name: planner/u);
  });
});

describe("v8.28 — LEGACY_PLANNER_ID + rewriteLegacyPlanner migration", () => {
  it("AC-5: LEGACY_PLANNER_ID constant equals `\"planner\"` (the canonical legacy spelling)", () => {
    expect(LEGACY_PLANNER_ID).toBe("planner");
  });

  it("AC-5: isLegacyPlanner returns true for `\"planner\"` and false for `\"ac-author\"`", () => {
    expect(isLegacyPlanner("planner")).toBe(true);
    expect(isLegacyPlanner("ac-author")).toBe(false);
    expect(isLegacyPlanner(null)).toBe(false);
    expect(isLegacyPlanner(undefined)).toBe(false);
  });

  it("AC-5: migrateFlowState rewrites `lastSpecialist: \"planner\"` → `\"ac-author\"`", () => {
    const legacy = {
      schemaVersion: FLOW_STATE_SCHEMA_VERSION,
      currentSlug: "20260511-legacy-planner-flow",
      currentStage: "plan" as const,
      ac: [],
      lastSpecialist: "planner",
      startedAt: "2026-05-11T20:00:00.000Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null,
    };
    const migrated = migrateFlowState(legacy);
    expect(migrated.lastSpecialist).toBe("ac-author");
  });

  it("AC-5: migrateFlowState does NOT rewrite valid `lastSpecialist` values (v8.42 added critic)", () => {
    for (const id of ["ac-author", "design", "reviewer", "security-reviewer", "critic", "slice-builder", null] as const) {
      const state = {
        schemaVersion: FLOW_STATE_SCHEMA_VERSION,
        currentSlug: null,
        currentStage: null,
        ac: [],
        lastSpecialist: id,
        startedAt: "2026-05-11T20:00:00.000Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null,
      };
      const migrated = migrateFlowState(state);
      expect(migrated.lastSpecialist).toBe(id);
    }
  });
});

describe("v8.28 — no orphan `planner` references in shipped source / tests", () => {
  it("AC-6: every remaining `planner` mention in src/ is inside an allow-listed legacy-alias / migration file", () => {
    // Walk src/ and tests/, find every file mentioning `planner`, check membership.
    const files = walkFiles(REPO_ROOT, ["src", "tests"], [".ts", ".md"]);
    const offenders: string[] = [];
    for (const abs of files) {
      const rel = path.relative(REPO_ROOT, abs);
      const body = readFileSync(abs, "utf8");
      if (/\bplanner\b/iu.test(body) && !FILES_THAT_MENTION_PLANNER_LEGITIMATELY.has(rel)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("AC-6: the `ac-author` prompt body itself has zero `planner` references (verified separately for clarity)", () => {
    expect(AC_AUTHOR_PROMPT).not.toMatch(/\bplanner\b/iu);
  });

  it("AC-6: every other specialist prompt body has zero `planner` references (v8.42 added critic)", () => {
    expect(DESIGN_PROMPT).not.toMatch(/\bplanner\b/iu);
    expect(REVIEWER_PROMPT).not.toMatch(/\bplanner\b/iu);
    expect(SECURITY_REVIEWER_PROMPT).not.toMatch(/\bplanner\b/iu);
    expect(SLICE_BUILDER_PROMPT).not.toMatch(/\bplanner\b/iu);
    expect(SPECIALIST_PROMPTS.critic).not.toMatch(/\bplanner\b/iu);
  });

  it("AC-6: every skill body has zero `planner` references (prose ↔ specialist references all renamed)", () => {
    for (const skill of AUTO_TRIGGER_SKILLS) {
      expect(skill.body, `skill ${skill.id} still mentions planner`).not.toMatch(/\bplanner\b/iu);
    }
  });
});

describe("v8.28 — config schema accepts both new and legacy modelPreferences keys", () => {
  // The shape is type-level; here we test the comment / contract by reading
  // the config.ts source and verifying the legacy alias is documented.
  it("AC-7: config.ts ModelPreferences declares the `planner` legacy alias for one release", () => {
    const configBody = readFileSync(path.join(REPO_ROOT, "src", "config.ts"), "utf8");
    expect(configBody).toMatch(/planner\?\s*:\s*ModelTier/u);
    expect(configBody).toMatch(/Legacy alias from pre-v8\.28|v8\.14[\u2013-]v8\.27/u);
  });
});

function walkFiles(root: string, subdirs: string[], extensions: string[]): string[] {
  const results: string[] = [];
  for (const sub of subdirs) {
    walkInto(path.join(root, sub), extensions, results);
  }
  return results;
}

function walkInto(dir: string, extensions: string[], out: string[]) {
  const fs = require("node:fs") as typeof import("node:fs");
  let entries: import("node:fs").Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkInto(full, extensions, out);
    } else if (e.isFile() && extensions.some((ext) => e.name.endsWith(ext))) {
      out.push(full);
    }
  }
}
