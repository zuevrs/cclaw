import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { TRIAGE_PROMPT } from "../../src/content/specialist-prompts/triage.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

const PLAN_TEMPLATE = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")?.body ?? "";
const PLAN_TEMPLATE_SOFT =
  ARTIFACT_TEMPLATES.find((t) => t.id === "plan-soft")?.body ?? "";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import {
  DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD,
  clarifyAmbiguityThresholdOf
} from "../../src/config.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";
import type { TriageDecision } from "../../src/types.js";

/**
 * v8.67 — Pre-plan clarify mode + assumption surface.
 *
 * Pins the contract end-to-end so any regression (orphaned skill,
 * dropped slim-summary line, missing `## Assumptions (correct me now)`
 * section, broken config knob, broken type field) lights up
 * immediately. Each `describe` block here corresponds to one of the
 * 11 implementation steps in the v8.67 spec.
 */

const SRC_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src"
);

describe("v8.67 — triage prompt surfaces the ambiguity_score", () => {
  it("AC-1 — triage prompt names the four signals that drive the score", () => {
    expect(TRIAGE_PROMPT).toMatch(/ambiguity[_ ]score/i);
    expect(TRIAGE_PROMPT).toMatch(/vague[- ]verbs?/i);
    expect(TRIAGE_PROMPT).toMatch(/missing[- ]?AC/i);
    expect(TRIAGE_PROMPT).toMatch(/multiple[- ]interpretations?/i);
    expect(TRIAGE_PROMPT).toMatch(/no[- ]concrete[- ]names?/i);
  });

  it("AC-1 — triage prompt anchors the 0-100 integer range", () => {
    expect(TRIAGE_PROMPT).toMatch(/0[\s\S]{0,40}100/);
  });

  it("AC-1 — slim summary template carries the `Ambiguity score:` line", () => {
    expect(TRIAGE_PROMPT).toMatch(/Ambiguity score:\s*<0-100>/);
  });

  it("AC-1 — slim summary template names the signal list inline", () => {
    expect(TRIAGE_PROMPT).toMatch(/signals:/i);
  });
});

describe("v8.67 — config knob clarify.ambiguity_threshold", () => {
  it("AC-2 — DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD is 60", () => {
    expect(DEFAULT_CLARIFY_AMBIGUITY_THRESHOLD).toBe(60);
  });

  it("AC-2 — clarifyAmbiguityThresholdOf returns the default on null/undefined", () => {
    expect(clarifyAmbiguityThresholdOf(null)).toBe(60);
    expect(clarifyAmbiguityThresholdOf(undefined)).toBe(60);
    expect(clarifyAmbiguityThresholdOf({})).toBe(60);
  });

  it("AC-2 — clarifyAmbiguityThresholdOf honours an explicit override", () => {
    expect(
      clarifyAmbiguityThresholdOf({
        clarify: { ambiguity_threshold: 40 }
      })
    ).toBe(40);
    expect(
      clarifyAmbiguityThresholdOf({
        clarify: { ambiguity_threshold: 85 }
      })
    ).toBe(85);
  });

  it("AC-2 — clarifyAmbiguityThresholdOf clamps out-of-range to default", () => {
    expect(
      clarifyAmbiguityThresholdOf({ clarify: { ambiguity_threshold: -5 } })
    ).toBe(60);
    expect(
      clarifyAmbiguityThresholdOf({ clarify: { ambiguity_threshold: 150 } })
    ).toBe(60);
    expect(
      clarifyAmbiguityThresholdOf({
        clarify: { ambiguity_threshold: Number.NaN }
      })
    ).toBe(60);
  });
});

describe("v8.67 — TriageDecision exposes ambiguityScore", () => {
  it("AC-3 — `ambiguityScore` is an optional number field that round-trips through TS structural typing", () => {
    const decision: TriageDecision = {
      complexity: "small-medium",
      ceremonyMode: "soft",
      path: ["plan", "build", "review", "critic", "ship"],
      mode: "task",
      rationale: "test",
      decidedAt: "2026-05-17T00:00:00.000Z",
      runMode: "auto",
      ambiguityScore: 73
    };
    expect(decision.ambiguityScore).toBe(73);

    const without: TriageDecision = {
      complexity: "trivial",
      ceremonyMode: "inline",
      path: ["build"],
      mode: "task",
      rationale: "test",
      decidedAt: "2026-05-17T00:00:00.000Z",
      runMode: null
    };
    expect(without.ambiguityScore).toBeUndefined();
  });
});

describe("v8.67 — architect prompt declares the Clarify phase entry condition", () => {
  it("AC-4 — architect prompt introduces a Phase −1 / Clarify section", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Phase\s*[−-]1/);
    expect(ARCHITECT_PROMPT).toMatch(/Clarify/);
  });

  it("AC-4 — architect prompt names the entry gate (ambiguityScore + threshold + ceremonyMode)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/ambiguityScore/);
    expect(ARCHITECT_PROMPT).toMatch(/ambiguity_threshold/);
    expect(ARCHITECT_PROMPT).toMatch(/ceremonyMode/);
    expect(ARCHITECT_PROMPT).toMatch(/inline/);
  });

  it("AC-4 — architect prompt pins one-question-at-a-time + max 5 cap", () => {
    expect(ARCHITECT_PROMPT).toMatch(/one[- ]question[- ]at[- ]a[- ]time/i);
    expect(ARCHITECT_PROMPT).toMatch(/(max|maximum)\s*5/i);
  });

  it("AC-4 — architect prompt names the early-exit signals", () => {
    expect(ARCHITECT_PROMPT).toMatch(/\bgo\b/);
    expect(ARCHITECT_PROMPT).toMatch(/\bready\b/);
    expect(ARCHITECT_PROMPT).toMatch(/\bproceed\b/);
  });
});

describe("v8.67 — PLAN_TEMPLATE carries the ## Assumptions (correct me now) section", () => {
  it("AC-5 — strict PLAN_TEMPLATE contains the literal section heading", () => {
    expect(PLAN_TEMPLATE).toMatch(/## Assumptions \(correct me now\)/);
  });

  it("AC-5 — soft PLAN_TEMPLATE contains the literal section heading", () => {
    expect(PLAN_TEMPLATE_SOFT).toMatch(/## Assumptions \(correct me now\)/);
  });

  it("AC-5 — strict PLAN_TEMPLATE positions Assumptions before Frame (top-of-file rule)", () => {
    const assumptionsIdx = PLAN_TEMPLATE.indexOf(
      "## Assumptions (correct me now)"
    );
    const frameIdx = PLAN_TEMPLATE.indexOf("## Frame");
    expect(assumptionsIdx).toBeGreaterThan(0);
    expect(frameIdx).toBeGreaterThan(assumptionsIdx);
  });

  it("AC-5 — soft PLAN_TEMPLATE positions Assumptions before the Plan section", () => {
    const assumptionsIdx = PLAN_TEMPLATE_SOFT.indexOf(
      "## Assumptions (correct me now)"
    );
    const planIdx = PLAN_TEMPLATE_SOFT.indexOf("## Plan");
    expect(assumptionsIdx).toBeGreaterThan(0);
    expect(planIdx).toBeGreaterThan(assumptionsIdx);
  });

  it("AC-5 — both templates name the (architect inference) labelling rule", () => {
    expect(PLAN_TEMPLATE).toMatch(/\(architect inference\)/);
    expect(PLAN_TEMPLATE_SOFT).toMatch(/\(architect inference\)/);
  });
});

describe("v8.67 — orchestrator emits the post-plan ack-window prose", () => {
  it("AC-6 — start-command body mentions the v8.67 Clarify gate explicitly", () => {
    expect(START_COMMAND_BODY).toMatch(/v8\.67/);
    expect(START_COMMAND_BODY).toMatch(/Clarify/);
    expect(START_COMMAND_BODY).toMatch(/ambiguityScore/);
    expect(START_COMMAND_BODY).toMatch(/ambiguity_threshold/);
  });

  it("AC-6 — start-command body emits the ack-window prose pointing at ## Assumptions (correct me now)", () => {
    expect(START_COMMAND_BODY).toMatch(/Plan written to/);
    expect(START_COMMAND_BODY).toMatch(/## Assumptions \(correct me now\)/);
    expect(START_COMMAND_BODY).toMatch(/\/cc-cancel/);
    expect(START_COMMAND_BODY).toMatch(/\bproceed to build\b/);
  });

  it("AC-6 — renderStartCommand stays identical to the exported body string", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });
});

describe("v8.67 — ambiguity-discipline skill is wired and installs to disk", () => {
  it("AC-7 — AUTO_TRIGGER_SKILLS includes ambiguity-discipline", () => {
    const ids = AUTO_TRIGGER_SKILLS.map((s) => s.id);
    expect(ids).toContain("ambiguity-discipline");
  });

  it("AC-7 — the ambiguity-discipline entry targets the triage + plan stages", () => {
    const skill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.id === "ambiguity-discipline"
    );
    expect(skill).toBeDefined();
    expect(skill?.stages ?? []).toEqual(
      expect.arrayContaining(["triage", "plan"])
    );
  });

  it("AC-7 — the ambiguity-discipline source markdown ships in src/content/skills/", async () => {
    const file = path.join(
      SRC_ROOT,
      "content/skills",
      "ambiguity-discipline.md"
    );
    await expect(fs.access(file)).resolves.not.toThrow();
  });

  it("AC-7 — `cclaw init` writes ambiguity-discipline.md into the install layer", async () => {
    const project = await createTempProject({ prefix: "v867-clarify-" });
    try {
      await initCclaw({ cwd: project, interactive: false });
      const installed = path.join(
        project,
        ".cclaw",
        "lib",
        "skills",
        "ambiguity-discipline.md"
      );
      const body = await fs.readFile(installed, "utf8");
      expect(body).toMatch(/Skill: ambiguity-discipline/);
      expect(body).toMatch(/## Assumptions \(correct me now\)/);
    } finally {
      await removeProject(project);
    }
  });
});
