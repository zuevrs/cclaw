import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";

/**
 * v8.63 — separate slices (work-units) from AC (verification).
 *
 * Before v8.63 cclaw had ONE `## Acceptance Criteria` table that
 * conflated three concepts: requirements (WHAT exists), work-units
 * (HOW we build), verification (HOW we prove done). v8.63 splits the
 * work-unit and verification concepts into two distinct tables:
 *
 *   `## Plan / Slices`              — SL-N work units (HOW to build)
 *   `## Acceptance Criteria (verification)` — AC-N verification rows
 *                                       with a `Verifies` column
 *                                       back-referencing slices
 *
 * The architect authors both. The builder works per slice (TDD per
 * slice, `<type>(SL-N): ...` commits). After all slices land, the
 * builder writes one `verify(AC-N): passing` commit per AC proving
 * the AC's behaviour holds on the merged state. The reviewer
 * inspects both chains (per-slice posture recipe + per-AC verify
 * commit) at handoff. The critic's §4b and plan-critic's §4b add
 * coverage-gap checks across both tables.
 *
 * Each tripwire below pins one invariant of the split. Any of them
 * lighting up means v8.63's contract has drifted.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");

describe("v8.63 — Slice / SliceState types exported from src/types.ts", () => {
  it("Slice + SliceState appear in src/types.ts exports", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, "src", "types.ts"), "utf8");
    expect(body, "Slice interface must be exported from src/types.ts").toMatch(
      /export\s+interface\s+Slice\b/
    );
    expect(body, "SliceState interface must be exported from src/types.ts").toMatch(
      /export\s+interface\s+SliceState\b/
    );
    expect(body, "SliceId template literal type pins SL-N shape").toMatch(
      /export\s+type\s+SliceId\s*=\s*`SL-\$\{number\}`/
    );
  });
});

describe("v8.63 — PLAN_TEMPLATE contains both Plan / Slices AND Acceptance Criteria sections", () => {
  const PLAN_TEMPLATE = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")?.body;

  it("PLAN_TEMPLATE entry exists", () => {
    expect(PLAN_TEMPLATE, "plan template must exist in ARTIFACT_TEMPLATES").toBeDefined();
  });

  it("PLAN_TEMPLATE contains the v8.63 `## Plan / Slices` section", () => {
    expect(PLAN_TEMPLATE, "PLAN_TEMPLATE must contain the new `## Plan / Slices` section").toMatch(
      /^##\s+Plan\s*\/\s*Slices/m
    );
  });

  it("PLAN_TEMPLATE contains the `## Acceptance Criteria` section (verification table)", () => {
    expect(
      PLAN_TEMPLATE,
      "PLAN_TEMPLATE must contain the `## Acceptance Criteria` section (verification rows)"
    ).toMatch(/^##\s+Acceptance Criteria/m);
  });

  it("PLAN_TEMPLATE description in ARTIFACT_TEMPLATES advertises the dual-table layout", () => {
    const planEntry = ARTIFACT_TEMPLATES.find((t) => t.id === "plan");
    expect(planEntry?.description, "plan template description must call out the dual-table v8.63 layout").toMatch(
      /dual-table|two tables|Plan\s*\/\s*Slices/i
    );
  });
});

describe("v8.63 — Architect contract mentions slices + AC distinctly", () => {
  it("architect prompt names the `## Plan / Slices` section verbatim", () => {
    expect(ARCHITECT_PROMPT, "architect must author the slices table").toMatch(
      /Plan\s*\/\s*Slices/
    );
  });

  it("architect prompt names the SL-N slice id token", () => {
    expect(ARCHITECT_PROMPT, "architect must use the SL-N slice id token").toMatch(/SL-N/);
  });

  it("architect prompt references the `## Acceptance Criteria` verification table", () => {
    expect(ARCHITECT_PROMPT, "architect must author the AC verification table").toMatch(
      /Acceptance Criteria/
    );
  });
});

describe("v8.63 — Builder contract mentions per-slice TDD AND verify(AC-N) verification commits", () => {
  it("builder prompt uses red(SL-N) / green(SL-N) / refactor(SL-N) for per-slice TDD work commits", () => {
    expect(BUILDER_PROMPT).toMatch(/red\(SL-N\)/);
    expect(BUILDER_PROMPT).toMatch(/green\(SL-N\)/);
    expect(BUILDER_PROMPT).toMatch(/refactor\(SL-N\)/);
  });

  it("builder prompt uses verify(AC-N) for the per-AC verification pass", () => {
    expect(BUILDER_PROMPT).toMatch(/verify\(AC-N\):\s*passing/);
  });

  it("builder prompt documents that verify commits never touch production code", () => {
    expect(
      BUILDER_PROMPT,
      "builder must warn that verify(AC-N) commits are empty OR test-files-only"
    ).toMatch(/verify.*(empty|test[- ]files? only|never touches? production|production code in)/i);
  });
});

describe("v8.63 — Reviewer contract mentions slice + AC traceability", () => {
  it("reviewer prompt references SL-N for slice work chain inspection", () => {
    expect(REVIEWER_PROMPT, "reviewer must scan the slice work chain via SL-N").toMatch(/SL-N/);
  });

  it("reviewer prompt references verify(AC-N) for the AC verification chain", () => {
    expect(REVIEWER_PROMPT, "reviewer must scan the verify(AC-N) chain").toMatch(
      /verify\(AC-N\)/
    );
  });

  it("reviewer prompt preserves the legacy `red(AC-` / `green(AC-` / `refactor(AC-N) skipped` shapes for pre-v8.63 archived flows", () => {
    expect(REVIEWER_PROMPT, "reviewer must accept legacy archived-flow red(AC-N) commit").toMatch(/red\(AC-/);
    expect(REVIEWER_PROMPT, "reviewer must accept legacy archived-flow green(AC-N) commit").toMatch(/green\(AC-/);
    expect(
      REVIEWER_PROMPT,
      "reviewer must accept legacy archived-flow `refactor(AC-N) skipped: ...` empty-marker"
    ).toMatch(/refactor\(AC-N\)\s*skipped/);
  });
});

describe("v8.63 — Critic §4b + plan-critic §4b coverage gates", () => {
  it("critic prompt contains §4b slice + AC coverage block", () => {
    expect(CRITIC_PROMPT, "critic must have §4b coverage check for slices + AC").toMatch(
      /§4b|4b\.\s*Slice/
    );
  });

  it("plan-critic prompt contains §4b slice-AC separation block", () => {
    expect(
      PLAN_CRITIC_PROMPT,
      "plan-critic must have §4b slice-AC separation check (slice quality / AC verifiability / coverage gap)"
    ).toMatch(/§4b|4b\.\s*Slice/);
  });
});

describe("v8.63 — slice-discipline skill is registered as an auto-trigger skill", () => {
  it("AUTO_TRIGGER_SKILLS contains a slice-discipline entry", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.fileName === "slice-discipline.md");
    expect(skill, "slice-discipline.md must be registered as an auto-trigger skill").toBeDefined();
    expect(skill?.stages, "slice-discipline must fire on plan / build / review stages").toEqual(
      expect.arrayContaining(["build"])
    );
  });
});
