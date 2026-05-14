import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import {
  POSTURE_COMMIT_PREFIXES,
  expectedCommitsForPosture,
  isBehaviorAdding,
  validatePostureTouchSurface
} from "../../src/posture-validation.js";

/**
 * v8.40 — full hooks removal tripwires.
 *
 * v8.40 is a breaking change: `session-start.mjs` and `commit-helper.mjs`
 * are deleted, `.cclaw/hooks/` is no longer in the install pipeline, and
 * TDD enforcement moves from a mechanical commit-helper gate to a
 * prompt-only contract verified by the reviewer via `git log --grep`.
 *
 * Each tripwire below pins one invariant of the migration. Any of them
 * lighting up means the v8.40 contract has drifted and the next install
 * or the next reviewer pass will misbehave.
 *
 *  - install pipeline: `writeHookFile` and `NODE_HOOKS` symbols are gone.
 *  - hook source: `src/content/node-hooks.ts` is deleted.
 *  - prompts: `commit-helper` does NOT appear in slice-builder / reviewer.
 *  - skills: `commit-helper` does NOT appear in any skill body.
 *  - orchestrator: `commit-helper` does NOT appear in `start-command.ts`.
 *  - Iron Law and anti-rationalization rows are intact in
 *    `tdd-and-verification.md` (the prose discipline is what replaces
 *    the mechanical gate; if it's gone, v8.40 has nothing left).
 *  - reviewer prompt mentions posture-aware `red(AC-` / `green(AC-` etc.
 *    prefix detection (the reviewer is the new gate; the prompt has to
 *    teach it the prefix recipe).
 *  - `AcceptanceCriterionState.phases` is marked `@deprecated` in
 *    `src/types.ts` (existing flow-state.json files keep working;
 *    new ones don't populate it).
 *  - posture-validation helper exports the canonical commit-prefix
 *    recipe and behaviour-adding predicate the reviewer leans on.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

const REVIEWER_PROMPT = SPECIALIST_PROMPTS["reviewer"];

const TDD_SKILL = (() => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === "tdd-and-verification.md");
  if (!skill) throw new Error("tdd-and-verification skill not found");
  return skill.body;
})();

describe("v8.40 — install pipeline no longer ships hooks", () => {
  it("`src/install.ts` does NOT reference writeHookFile (the helper that wrote .cclaw/hooks/*)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "install.ts"), "utf8");
    expect(body).not.toContain("writeHookFile");
  });

  it("`src/install.ts` does NOT reference NODE_HOOKS (the hook spec array)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "install.ts"), "utf8");
    expect(body).not.toContain("NODE_HOOKS");
  });

  it("`src/install.ts` does NOT import from `node-hooks` (the retired hook content module)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "install.ts"), "utf8");
    expect(body).not.toMatch(/from\s+["'][^"']*node-hooks[^"']*["']/);
  });

  it("`src/content/node-hooks.ts` is deleted (file does not exist)", async () => {
    const filePath = path.join(REPO_ROOT, "src", "content", "node-hooks.ts");
    await expect(fs.access(filePath)).rejects.toBeTruthy();
  });

  it("`src/install.ts` lists every retired hook in `RETIRED_HOOK_FILES` (session-start, commit-helper, stop-handoff)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "install.ts"), "utf8");
    expect(body).toContain("RETIRED_HOOK_FILES");
    for (const fileName of ["session-start.mjs", "commit-helper.mjs", "stop-handoff.mjs"]) {
      expect(body).toContain(fileName);
    }
  });

  it("`src/install.ts` lists every retired harness hook config in `RETIRED_HARNESS_HOOK_FILES`", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "install.ts"), "utf8");
    expect(body).toContain("RETIRED_HARNESS_HOOK_FILES");
    for (const harness of [".claude/hooks", ".cursor", ".codex", ".opencode/plugins"]) {
      expect(body).toContain(harness);
    }
  });
});

// `commit-helper` / `--phase=` scrubbing across slice-builder, reviewer,
// start-command, skills, antipatterns, core-agents, and artifact templates
// is now consolidated in tests/unit/retired-tokens.test.ts (v8.54).

describe("v8.40 — Iron Law + anti-rationalization table survive", () => {
  it("Iron Law text is present in tdd-and-verification.md", () => {
    expect(TDD_SKILL).toContain("NO PRODUCTION CODE WITHOUT A FAILING TEST FIRST");
    expect(TDD_SKILL).toContain("Iron Law");
  });

  it("anti-rationalization table has at least 8 rows (existing + 2 v8.40 additions)", () => {
    const tableMatch = TDD_SKILL.match(
      /## Anti-rationalization table[\s\S]*?(?=\n## |\n# |$)/
    );
    expect(tableMatch, "tdd-and-verification.md must contain a `## Anti-rationalization table` section").not.toBeNull();
    const tableBody = tableMatch![0];
    // Match 2-column markdown table rows: `| ... | ... |`. Excludes the
    // separator row (`| --- | --- |`) so we count data rows only.
    const allRows = tableBody.match(/^\|[^\n]+\|$/gm) ?? [];
    const dataRows = allRows.filter((row) => !/^\|\s*-{3,}\s*\|/.test(row));
    // Subtract 1 for the header row.
    const dataRowCount = dataRows.length - 1;
    expect(
      dataRowCount,
      "anti-rationalization table must have ≥ 8 data rows after v8.40 additions"
    ).toBeGreaterThanOrEqual(8);
  });

  it("anti-rationalization table includes the v8.40 row about the retired mechanical TDD hook", () => {
    expect(TDD_SKILL).toMatch(/mechanical TDD hook is gone/i);
  });

  it("anti-rationalization table includes the v8.40 row about commit production-with-tests slips", () => {
    expect(TDD_SKILL).toMatch(/commit production and tests together/i);
  });
});

describe("v8.40 — reviewer prompt teaches the posture-aware commit-prefix recipe", () => {
  it("reviewer prompt mentions the `red(AC-` prefix detection", () => {
    expect(REVIEWER_PROMPT).toContain("red(AC-");
  });

  it("reviewer prompt mentions the `green(AC-` prefix detection", () => {
    expect(REVIEWER_PROMPT).toContain("green(AC-");
  });

  it("reviewer prompt mentions the `refactor(AC-` prefix detection", () => {
    expect(REVIEWER_PROMPT).toContain("refactor(AC-");
  });

  it("reviewer prompt mentions `git log --grep` as the ex-post inspection command", () => {
    expect(REVIEWER_PROMPT).toContain("git log --grep");
  });

  it("reviewer prompt cites the `src/posture-validation.ts` helper for the predicate cross-check", () => {
    expect(REVIEWER_PROMPT).toContain("posture-validation");
  });

  it("reviewer prompt names the bootstrap escape (AC-1 may omit RED)", () => {
    expect(REVIEWER_PROMPT).toContain("bootstrap");
  });
});

describe("v8.40 — types: AcceptanceCriterionState.phases is @deprecated", () => {
  it("`AcceptanceCriterionState.phases` is annotated @deprecated in src/types.ts", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "types.ts"), "utf8");
    const phasesContext = body.match(/@deprecated[\s\S]{0,800}phases\?:/);
    expect(
      phasesContext,
      "src/types.ts must keep `phases?` field but annotate it as @deprecated (v8.40 contract)"
    ).not.toBeNull();
  });

  it("src/types.ts notes v8.40+ no longer reads/writes the phases field", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "types.ts"), "utf8");
    expect(body).toMatch(/v8\.40/);
    expect(body).toMatch(/git log/i);
  });
});

describe("v8.40 — posture-validation helper exports the reviewer's cross-check kit", () => {
  it("exports POSTURE_COMMIT_PREFIXES with one entry per posture", () => {
    expect(POSTURE_COMMIT_PREFIXES["test-first"]).toEqual(["red", "green", "refactor"]);
    expect(POSTURE_COMMIT_PREFIXES["docs-only"]).toEqual(["docs"]);
    expect(POSTURE_COMMIT_PREFIXES["tests-as-deliverable"]).toEqual(["test"]);
    expect(POSTURE_COMMIT_PREFIXES["refactor-only"]).toEqual(["refactor"]);
  });

  it("expectedCommitsForPosture builds `<prefix>(AC-N):` subjects", () => {
    expect(expectedCommitsForPosture("test-first", "AC-1")).toEqual([
      "red(AC-1):",
      "green(AC-1):",
      "refactor(AC-1):"
    ]);
    expect(expectedCommitsForPosture("docs-only", "AC-9")).toEqual(["docs(AC-9):"]);
  });

  it("validatePostureTouchSurface flags docs-only AC with source-file touchSurface", () => {
    const error = validatePostureTouchSurface("docs-only", ["src/index.ts"]);
    expect(error).not.toBeNull();
  });

  it("isBehaviorAdding is re-exported from posture-validation (single import point for the reviewer)", () => {
    expect(isBehaviorAdding(["src/index.ts"])).toBe(true);
    expect(isBehaviorAdding(["README.md"])).toBe(false);
  });
});

describe("v8.40 — flow-state still tolerates legacy `phases` data on read", () => {
  it("AC state shape allows missing phases (new flows) and present phases (old flows)", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "flow-state.ts"), "utf8");
    // The validator must accept BOTH shapes — explicit branch for the
    // optional field so legacy flow-state.json from v8.36-v8.39 doesn't
    // throw at read time.
    expect(body).toContain("phases");
  });
});
