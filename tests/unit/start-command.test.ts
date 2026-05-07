import { describe, expect, it } from "vitest";
import { renderStartCommand } from "../../src/content/start-command.js";

describe("start command (/cc) markdown", () => {
  const body = renderStartCommand();

  it("explains the four-stage flow plan/build/review/ship", () => {
    for (const stage of ["plan", "build", "review", "ship"]) {
      expect(body).toContain(stage);
    }
  });

  it("describes existing-plan detection (active and shipped)", () => {
    expect(body).toMatch(/existing[- ]plan/i);
    expect(body).toMatch(/shipped/);
    expect(body).toMatch(/amend.*rewrite.*new/i);
  });

  it("calls out Phase 0 calibration", () => {
    expect(body).toMatch(/Phase 0/);
    expect(body).toMatch(/targeted change/i);
  });

  it("requires explicit user approval for push and PR", () => {
    expect(body).toMatch(/Push and PR/);
    expect(body).toMatch(/explicit user approval/i);
  });

  it("describes the automatic compound + active->shipped move", () => {
    expect(body).toMatch(/Compound \(automatic\)/);
    expect(body).toMatch(/Active . shipped move/u);
  });

  it("references the failure-mode checklist and the hard cap of 5", () => {
    expect(body).toMatch(/Five Failure Modes/i);
    expect(body).toMatch(/5/);
  });
});
