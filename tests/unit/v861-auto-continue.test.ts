import { describe, expect, it } from "vitest";

import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.61 — /cc invocation is deterministic. The 10-row dispatch matrix
 * below replaces the legacy resume picker (`[r] resume / [s] save /
 * [n] new`). Each row maps an invocation + active-flow combination to a
 * single behaviour; the orchestrator never asks "resume or start?".
 *
 * These tests are tripwires for the matrix; the canonical contract
 * lives in the orchestrator body's Detect step and is documented as
 * reference in the `flow-resume` skill.
 */
describe("v8.61 — /cc auto-continue + auto-start dispatch matrix", () => {
  it("orchestrator body declares the deterministic /cc invocation matrix", () => {
    expect(START_COMMAND_BODY).toMatch(/invocation matrix/iu);
    expect(START_COMMAND_BODY).toMatch(/deterministic dispatch matrix|deterministic[\s\S]*matrix/iu);
  });

  describe("Row 1 — /cc (no args) + active flow → continue silently", () => {
    it("body covers the continue-silently behaviour for a bare /cc on an active flow", () => {
      expect(START_COMMAND_BODY).toMatch(/Continue silently|continue[\s\S]*silently|silently[\s\S]*continue/iu);
    });
  });

  describe("Row 2 — /cc (no args) + no active flow → error with start-options guidance", () => {
    it("body declares the no-active-flow error message", () => {
      expect(START_COMMAND_BODY).toMatch(/No active flow\./u);
      expect(START_COMMAND_BODY).toMatch(/\/cc <task>/u);
      expect(START_COMMAND_BODY).toMatch(/\/cc research/u);
      expect(START_COMMAND_BODY).toMatch(/\/cc extend/u);
    });
  });

  describe("Row 3 — /cc <task> + active flow → error guiding to /cc or /cc-cancel", () => {
    it("body declares the active-flow conflict error message", () => {
      expect(START_COMMAND_BODY).toMatch(/Active flow:/u);
      expect(START_COMMAND_BODY).toMatch(/Continue with `?\/cc`?/u);
      expect(START_COMMAND_BODY).toMatch(/Cancel with `?\/cc-cancel`?/u);
    });

    it("body forbids auto-cancel or queueing of the new task", () => {
      expect(START_COMMAND_BODY).toMatch(/do NOT auto-cancel|never auto-cancel|do not auto[-\s]cancel/iu);
    });
  });

  describe("Row 4 — /cc <task> + no active flow → start a new flow (dispatch triage)", () => {
    it("body declares the start-new-flow behaviour", () => {
      expect(START_COMMAND_BODY).toMatch(/Start a new flow|start[\s\S]*new flow|dispatch[\s\S]*triage/iu);
    });
  });

  describe("Rows 5-8 — research-mode and extend-mode follow the same shape", () => {
    it("body declares the research-mode + active-flow error path", () => {
      expect(START_COMMAND_BODY).toMatch(/research[\s\S]*active flow|active flow[\s\S]*research/iu);
    });

    it("body declares the extend-mode + active-flow error path", () => {
      expect(START_COMMAND_BODY).toMatch(/extend[\s\S]*active flow|active flow[\s\S]*extend/iu);
    });
  });

  describe("Rows 9-10 — /cc-cancel", () => {
    it("body declares /cc-cancel + active flow → cancel behaviour", () => {
      expect(START_COMMAND_BODY).toMatch(/\/cc-cancel[\s\S]*cancel[\s\S]*flow|cancel[\s\S]*active flow[\s\S]*\/cc-cancel/iu);
    });

    it("body declares /cc-cancel + no active flow → error message", () => {
      expect(START_COMMAND_BODY).toMatch(/No active flow to cancel\.|nothing to cancel/iu);
    });
  });

  describe("Resume picker prose is gone", () => {
    it("body does not carry the legacy resume picker prompts (r / s / n)", () => {
      expect(START_COMMAND_BODY).not.toMatch(/\[r\][\s\S]{0,40}resume/iu);
      expect(START_COMMAND_BODY).not.toMatch(/\[s\][\s\S]{0,40}save/iu);
      expect(START_COMMAND_BODY).not.toMatch(/\[n\][\s\S]{0,40}new/iu);
    });

    it("body explicitly states the orchestrator never asks 'resume or start?'", () => {
      // The body cites the phrase to retire it; the invariant is that the
      // orchestrator MUST NOT pose it as a question. We assert the prose
      // declaring the retirement explicitly.
      expect(START_COMMAND_BODY).toMatch(/never asks "resume or start\?"|retired[\s\S]*resume picker/iu);
    });
  });

  describe("Active-flow detection rule", () => {
    it("body specifies a flow is active when currentSlug is non-null (finalize resets the slug)", () => {
      expect(START_COMMAND_BODY).toMatch(/currentSlug != null/u);
      expect(START_COMMAND_BODY).toMatch(/finalize[\s\S]*reset|reset[\s\S]*finalize/iu);
    });
  });

  describe("flow-resume skill is the reference doc for the matrix", () => {
    it("flow-resume skill still exists as a reference document", () => {
      // The skill is the reference; the orchestrator body holds the canonical contract.
      // We don't assert against the skill body here — see v861-triage-subagent for that.
      expect(START_COMMAND_BODY).toMatch(/flow-resume/u);
    });
  });

  describe("Pause-resume runbook reflects v8.61 always-auto semantics", () => {
    it("pause-resume runbook does not surface a resume picker", () => {
      const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === "pause-resume");
      expect(r).toBeDefined();
      expect(r!.body).not.toMatch(/\[r\][\s\S]{0,40}resume/iu);
      expect(r!.body).not.toMatch(/Resume or start/iu);
    });
  });
});
