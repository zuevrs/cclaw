import { describe, expect, it } from "vitest";

import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import {
  BUILDER_STATUSES,
  type BuilderStatus
} from "../../src/types.js";

/**
 * v8.68 — Two-stage per-slice review + structured implementer status.
 *
 * Slimmed in v8.101 (Phase A4): kept only the unique-value wiring + a
 * representative prompt-grep canary per surface. Mutation testing showed
 * the prompt-grep block was already covered by the wiring assertions
 * (BUILDER_STATUSES, AUTO_TRIGGER_SKILLS lookup, ON_DEMAND_RUNBOOKS
 * lookup) plus a single anchor regex per area.
 */

describe("v8.68 — BuilderStatus type + enum wiring", () => {
  it("BUILDER_STATUSES carries exactly the four canonical statuses, in spec order", () => {
    expect([...BUILDER_STATUSES]).toEqual([
      "DONE",
      "DONE_WITH_CONCERNS",
      "NEEDS_CONTEXT",
      "BLOCKED"
    ]);
  });

  it("BuilderStatus type derives from the enum (compile-time round-trip)", () => {
    const all: BuilderStatus[] = [
      "DONE",
      "DONE_WITH_CONCERNS",
      "NEEDS_CONTEXT",
      "BLOCKED"
    ];
    expect(all).toEqual([...BUILDER_STATUSES]);
  });
});

describe("v8.68 — builder prompt declares the per-slice review surface", () => {
  it("builder prompt declares the two-stage per-slice review with status protocol", () => {
    expect(BUILDER_PROMPT).toMatch(/## Per-slice review loop \(strict mode/);
    expect(BUILDER_PROMPT).toMatch(/Stage 1 — \*\*spec-compliance\*\*/);
    expect(BUILDER_PROMPT).toMatch(/Stage 2 — \*\*code-quality\*\*/);
    expect(BUILDER_PROMPT).toMatch(/## Status protocol/);
  });

  it("builder prompt names every BuilderStatus enum value verbatim (status-handler table)", () => {
    for (const status of BUILDER_STATUSES) {
      expect(BUILDER_PROMPT).toContain(`\`${status}\``);
    }
  });

  it("builder prompt declares the JSON self_review block with status + per_slice_review fields", () => {
    expect(BUILDER_PROMPT).toMatch(
      /"status": "DONE \| DONE_WITH_CONCERNS \| NEEDS_CONTEXT \| BLOCKED"/
    );
    expect(BUILDER_PROMPT).toMatch(/"per_slice_review":/);
  });
});

describe("v8.68 — builder status protocol is wired into AUTO_TRIGGER_SKILLS (absorbed by summary-format)", () => {
  it("summary-format skill (which absorbed structured-status) is wired into AUTO_TRIGGER_SKILLS and rides every stage", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "summary-format");
    expect(skill).toBeDefined();
    expect(skill?.fileName).toBe("summary-format.md");
    expect(skill?.stages).toContain("always");
    // structured-status was folded in; it is no longer a standalone skill.
    expect(AUTO_TRIGGER_SKILLS.find((s) => s.id === "structured-status")).toBeUndefined();
  });

  it("summary-format skill body declares the four statuses + monotone aggregation rule (absorbed from structured-status)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "summary-format")!;
    for (const status of BUILDER_STATUSES) {
      expect(skill.body).toContain(`### \`${status}\``);
    }
    expect(skill.body).toMatch(/monotone/);
  });
});

describe("v8.68 — orchestrator handles structured statuses deterministically", () => {
  it("start-command body names the structured statuses in always-auto failure handling", () => {
    expect(START_COMMAND_BODY).toMatch(/NEEDS_CONTEXT/);
    expect(START_COMMAND_BODY).toMatch(/BLOCKED/);
    expect(START_COMMAND_BODY).toMatch(/DONE_WITH_CONCERNS/);
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("always-auto-failure-handling runbook declares per-status orchestrator response", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    );
    expect(rb).toBeDefined();
    expect(rb!.body).toMatch(/builder `Status: NEEDS_CONTEXT`/);
    expect(rb!.body).toMatch(/builder `Status: BLOCKED`/);
    expect(rb!.body).toMatch(/builder `Status: DONE_WITH_CONCERNS`/);
    expect(rb!.body).toMatch(/monotone/);
  });
});
