import { describe, expect, it } from "vitest";
import { STAGE_PLAYBOOKS, STAGE_PLAYBOOKS_INDEX } from "../../src/content/stage-playbooks.js";

describe("stage playbooks", () => {
  it("ships runbooks for all four stages", () => {
    const ids = STAGE_PLAYBOOKS.map((entry) => entry.id).sort();
    expect(ids).toEqual(["build", "plan", "review", "ship"]);
  });

  it("each runbook is non-trivial (>= 1500 chars)", () => {
    for (const playbook of STAGE_PLAYBOOKS) {
      expect(playbook.body.length).toBeGreaterThan(1500);
    }
  });

  it("plan runbook documents AC quality bar", () => {
    const plan = STAGE_PLAYBOOKS.find((entry) => entry.id === "plan");
    expect(plan?.body).toContain("AC quality bar");
    expect(plan?.body).toContain("observable");
    expect(plan?.body).toContain("independently committable");
  });

  it("build runbook references per-AC commit prefixes and fix-only flow (v8.40: commit-helper retired)", () => {
    const build = STAGE_PLAYBOOKS.find((entry) => entry.id === "build");
    expect(build?.body).toContain("Fix-only flow");
    expect(build?.body).toContain("red(AC-");
    expect(build?.body).toContain("green(AC-");
    expect(build?.body).not.toContain("commit-helper");
  });

  it("review runbook lists the Five Failure Modes and the hard cap", () => {
    const review = STAGE_PLAYBOOKS.find((entry) => entry.id === "review");
    expect(review?.body).toContain("Five Failure Modes");
    expect(review?.body).toContain("Hard cap");
  });

  it("ship runbook covers the AC traceability gate and push approval rule", () => {
    const ship = STAGE_PLAYBOOKS.find((entry) => entry.id === "ship");
    expect(ship?.body).toContain("AC traceability gate");
    expect(ship?.body).toContain("Always ask before pushing");
  });

  it("STAGE_PLAYBOOKS_INDEX lists each runbook file", () => {
    for (const playbook of STAGE_PLAYBOOKS) {
      expect(STAGE_PLAYBOOKS_INDEX).toContain(playbook.fileName);
    }
  });
});
