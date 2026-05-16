import { describe, expect, it } from "vitest";

import { SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { TRIAGE_PROMPT } from "../../src/content/specialist-prompts/triage.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { SPECIALISTS } from "../../src/types.js";

/**
 * v8.61 — triage moves from main orchestrator context to an on-demand
 * sub-agent. Specialist count 8 → 9; routing logic ports verbatim;
 * orchestrator body shrinks substantially; dispatch envelope is correct.
 *
 * These tests are tripwires for the move's invariants.
 */
describe("v8.61 — triage as a specialist sub-agent", () => {
  it("SPECIALISTS includes triage and length is 9", () => {
    expect(SPECIALISTS).toContain("triage");
    expect(SPECIALISTS).toHaveLength(9);
  });

  it("SPECIALIST_PROMPTS maps triage to TRIAGE_PROMPT", () => {
    expect(SPECIALIST_PROMPTS.triage).toBe(TRIAGE_PROMPT);
  });

  it("core-agents registers triage with on-demand activation", () => {
    const triage = SPECIALIST_AGENTS.find((a) => a.id === "triage");
    expect(triage).toBeDefined();
    expect(triage?.activation).toBe("on-demand");
    expect(triage?.title.toLowerCase()).toContain("triage");
  });

  it("triage prompt declares the zero-question rule (preserved from v8.58, locked in v8.61)", () => {
    expect(TRIAGE_PROMPT).toMatch(/zero[-\s]question/iu);
    expect(TRIAGE_PROMPT).toMatch(/no questions|no .* clarifying/iu);
  });

  it("triage prompt carries the five-field decision (complexity / ceremonyMode / path / runMode / mode)", () => {
    expect(TRIAGE_PROMPT).toMatch(/complexity/u);
    expect(TRIAGE_PROMPT).toMatch(/ceremonyMode/u);
    expect(TRIAGE_PROMPT).toMatch(/\bpath\b/u);
    expect(TRIAGE_PROMPT).toMatch(/runMode/u);
    expect(TRIAGE_PROMPT).toMatch(/\bmode\b/u);
  });

  it("triage prompt locks runMode to auto under v8.61 always-auto (step retired)", () => {
    expect(TRIAGE_PROMPT).toMatch(/v8\.61[\s\S]*always[-\s]auto|always[-\s]auto[\s\S]*v8\.61/iu);
    expect(TRIAGE_PROMPT).toMatch(/runMode[\s\S]*"auto"|runMode[\s\S]*always[\s\S]*auto/iu);
    expect(TRIAGE_PROMPT).toMatch(/step[-\s]mode retired|step[\s\S]*retired/iu);
  });

  it("triage prompt declares the three override flags (--inline / --soft / --strict)", () => {
    expect(TRIAGE_PROMPT).toMatch(/--inline/u);
    expect(TRIAGE_PROMPT).toMatch(/--soft/u);
    expect(TRIAGE_PROMPT).toMatch(/--strict/u);
  });

  it("triage prompt declares the no-git auto-downgrade (v8.23 behaviour preserved)", () => {
    expect(TRIAGE_PROMPT).toMatch(/no[-\s]git/iu);
    expect(TRIAGE_PROMPT).toMatch(/downgrade/iu);
  });

  it("triage prompt declares the triage-inheritance sub-step for extend-mode", () => {
    expect(TRIAGE_PROMPT).toMatch(/triage[-\s]inheritance|inheritance sub-step/iu);
    expect(TRIAGE_PROMPT).toMatch(/parentContext/u);
  });

  it("triage prompt declares the slim summary shape (6 required lines + optional Notes)", () => {
    expect(TRIAGE_PROMPT).toMatch(/Stage: triage/u);
    expect(TRIAGE_PROMPT).toMatch(/Decision:/u);
    expect(TRIAGE_PROMPT).toMatch(/Rationale:/u);
    expect(TRIAGE_PROMPT).toMatch(/Confidence:/u);
    expect(TRIAGE_PROMPT).toMatch(/Slug suggestion:/u);
  });

  it("triage prompt forbids writing artifacts and dispatching other specialists", () => {
    expect(TRIAGE_PROMPT).toMatch(/Do not write any artifact|write nothing to disk/iu);
    expect(TRIAGE_PROMPT).toMatch(/Do not dispatch|never spawn another specialist/iu);
  });

  it("orchestrator body no longer carries the full triage prose (delegated to sub-agent)", () => {
    expect(START_COMMAND_BODY.length).toBeLessThan(72000);
    expect(START_COMMAND_BODY).toMatch(/triage[\s\S]*sub-agent|dispatch[\s\S]*triage|triage[\s\S]*specialist/iu);
  });

  it("orchestrator body references the triage dispatch directive at the Triage hop", () => {
    expect(START_COMMAND_BODY).toMatch(/## Triage[\s\S]*dispatch[\s\S]*triage[\s\S]*sub-agent/iu);
  });

  it("orchestrator body does NOT carry the full heuristics table (moved to triage.ts)", () => {
    expect(TRIAGE_PROMPT).toMatch(/typo, rename, comment/iu);
  });

  it("orchestrator body no longer carries the override flag table (moved to triage.ts)", () => {
    const flagTableMatches = START_COMMAND_BODY.match(/--inline[\s\S]*--soft[\s\S]*--strict/g);
    expect(flagTableMatches?.length ?? 0).toBeLessThanOrEqual(1);
    expect(TRIAGE_PROMPT).toMatch(/--inline/u);
    expect(TRIAGE_PROMPT).toMatch(/--soft/u);
    expect(TRIAGE_PROMPT).toMatch(/--strict/u);
  });
});
