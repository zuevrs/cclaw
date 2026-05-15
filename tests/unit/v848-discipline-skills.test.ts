import { describe, expect, it } from "vitest";

import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { COUNTS } from "../helpers/counts.js";

/**
 * v8.48 — discipline skills triad + edit-discipline reviewer axis +
 * per-AC verified flag in slim summary (slimmed in v8.54).
 *
 * Three skills added, one reviewer axis added, slim-summary contract
 * widened with `AC verified`. Per-skill anatomy rubrics and per-forbidden-
 * phrase repetition retired (the v8.26 anatomy test covers all skills
 * structurally). What stays is the v8.48 contract anchor.
 */

const findSkill = (id: string) =>
  AUTO_TRIGGER_SKILLS.find((s) => s.id === id);

describe("v8.48 — three new discipline skills registered", () => {
  it("completion-discipline / receiving-feedback / pre-edit-investigation are all registered with correct stages", () => {
    const completion = findSkill("completion-discipline");
    expect(completion).toBeDefined();
    expect(completion!.stages).toEqual(["always"]);

    const feedback = findSkill("receiving-feedback");
    expect(feedback).toBeDefined();
    expect(feedback!.stages).toEqual(["build", "review", "ship"]);

    const preEdit = findSkill("pre-edit-investigation");
    expect(preEdit).toBeDefined();
    expect(preEdit!.stages).toEqual(["build"]);
  });

  it("total skill count is governed by COUNTS.skills and stays in the v8.16 cleanup band", () => {
    expect(AUTO_TRIGGER_SKILLS.length).toBe(COUNTS.skills);
    expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(15);
    expect(AUTO_TRIGGER_SKILLS.length).toBeLessThanOrEqual(25);
  });
});

describe("v8.48 — completion-discipline carries the Iron Law and forbidden-phrase list", () => {
  it("body contains the Iron Law and at least three canonical forbidden completion-claim phrases", () => {
    const body = findSkill("completion-discipline")!.body;
    expect(body).toMatch(/Iron Law/);
    for (const phrase of ["should work", "looks good", "I think"]) {
      expect(body, `completion-discipline must forbid "${phrase}"`).toMatch(
        new RegExp(phrase, "i")
      );
    }
  });
});

describe("v8.48 — receiving-feedback carries the four-step pattern", () => {
  it("body cites Restate / Classify / Plan / Evidence as the response shape", () => {
    const body = findSkill("receiving-feedback")!.body;
    for (const step of ["Restate", "Classify", "Plan", "Evidence"]) {
      expect(body, `receiving-feedback must name step "${step}"`).toMatch(
        new RegExp(`\\b${step}\\b`)
      );
    }
  });
});

describe("v8.48 — pre-edit-investigation three-probe gate", () => {
  it("body cites the three mandatory probes (git log / rg / full-file read)", () => {
    const body = findSkill("pre-edit-investigation")!.body;
    expect(body).toMatch(/git log/);
    expect(body).toMatch(/\brg\b|ripgrep/);
    expect(body).toMatch(/full-file read|read the (?:full|entire) file/i);
  });
});

describe("v8.48 — slice-builder + reviewer integration", () => {
  it("slice-builder references pre-edit-investigation in its build-stage discipline", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/pre-edit-investigation/);
  });

  it("reviewer prompt declares edit-discipline as an axis (v8.48 added it; v8.52 widened the count)", () => {
    expect(REVIEWER_PROMPT).toMatch(/edit-discipline/i);
  });

  it("reviewer prompt declares qa-evidence as a gated axis (v8.52 sibling)", () => {
    expect(REVIEWER_PROMPT).toMatch(/qa-evidence/i);
  });
});

describe("v8.48 — slim-summary per-AC `verified` contract", () => {
  it("slice-builder slim summary mandates the `AC verified` line per AC (strict) or single token (soft)", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/AC verified/i);
  });

  it("orchestrator refuses to advance when any AC is verified=no outside ceremonyMode=inline", () => {
    expect(START_COMMAND_BODY).toMatch(/AC verified/i);
  });
});
