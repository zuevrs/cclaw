import { describe, expect, it } from "vitest";
import { STAGE_PLAYBOOKS, STAGE_PLAYBOOKS_INDEX } from "../../src/content/stage-playbooks.js";

/**
 * Slimmed in v8.101 test-slim-down A4 from 7 single-anchor its() to 2
 * packed wiring tests (registry shape + per-playbook canonical anchors).
 */

describe("stage playbooks — registry shape", () => {
  it("WIRING — STAGE_PLAYBOOKS ships runbooks for all four stages (plan/build/review/ship), each body is non-trivial (≥1500 chars), and STAGE_PLAYBOOKS_INDEX surfaces each fileName", () => {
    const ids = STAGE_PLAYBOOKS.map((entry) => entry.id).sort();
    expect(ids).toEqual(["build", "plan", "review", "ship"]);
    for (const playbook of STAGE_PLAYBOOKS) {
      expect(playbook.body.length).toBeGreaterThan(1500);
      expect(STAGE_PLAYBOOKS_INDEX).toContain(playbook.fileName);
    }
  });
});

describe("stage playbooks — per-stage canonical anchors", () => {
  it("BEHAVIOR — plan playbook documents AC quality bar (observable + independently committable); build playbook references per-AC commit prefixes (Fix-only flow + red/green(AC-); review playbook lists the Five Failure Modes + Hard cap; ship playbook covers the Plan traceability gate + 'Always ask before pushing'", () => {
    const plan = STAGE_PLAYBOOKS.find((entry) => entry.id === "plan")!;
    expect(plan.body).toContain("AC quality bar");
    expect(plan.body).toContain("observable");
    expect(plan.body).toContain("independently committable");

    const build = STAGE_PLAYBOOKS.find((entry) => entry.id === "build")!;
    expect(build.body).toContain("Fix-only flow");
    expect(build.body).toContain("red(AC-");
    expect(build.body).toContain("green(AC-");

    const review = STAGE_PLAYBOOKS.find((entry) => entry.id === "review")!;
    expect(review.body).toContain("Five Failure Modes");
    expect(review.body).toContain("Hard cap");

    const ship = STAGE_PLAYBOOKS.find((entry) => entry.id === "ship")!;
    expect(ship.body).toContain("Plan traceability gate");
    expect(ship.body).toContain("Always ask before pushing");
  });
});
