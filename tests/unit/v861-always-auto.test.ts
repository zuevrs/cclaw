import { describe, expect, it } from "vitest";

import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { runModeOf } from "../../src/flow-state.js";

function runbookBody(id: string): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === id);
  if (!r) throw new Error(`No on-demand runbook with id=${id}`);
  return r.body;
}

/**
 * v8.61 — always-auto mode. The user-facing step / auto choice is retired;
 * every non-inline flow runs always-auto end-to-end with no approval
 * pickers at plan / review / critic gates. Hard failures route per a
 * fixed matrix; the stop-and-report status block is the recovery surface.
 *
 * Tripwire shape: anywhere the orchestrator or a runbook still asks the
 * user "approve plan? [y/n]" / "accept review? [y/n]" / "accept critic
 * verdict? [y/n]", these tests should fail.
 */
describe("v8.61 — always-auto mode", () => {
  describe("runModeOf folds every legacy value to auto", () => {
    it("returns auto for runMode: null", () => {
      expect(runModeOf({ triage: null } as never)).toBe("auto");
    });

    it("returns auto for undefined runMode", () => {
      expect(runModeOf({ triage: { ceremonyMode: "soft" } } as never)).toBe("auto");
    });

    it("returns auto for legacy runMode: step (pre-v8.61 state files)", () => {
      expect(
        runModeOf({
          triage: { ceremonyMode: "soft", runMode: "step" }
        } as never)
      ).toBe("auto");
    });

    it("returns auto for runMode: auto", () => {
      expect(
        runModeOf({
          triage: { ceremonyMode: "soft", runMode: "auto" }
        } as never)
      ).toBe("auto");
    });
  });

  describe("orchestrator body removes step-mode picker prose", () => {
    it("does not carry an approve-plan picker", () => {
      expect(START_COMMAND_BODY).not.toMatch(/approve plan\?[\s\S]{0,5}\[y\/n\]/iu);
    });

    it("does not carry an accept-review picker", () => {
      expect(START_COMMAND_BODY).not.toMatch(/accept (findings|review)\?[\s\S]{0,5}\[y\/n\]/iu);
    });

    it("does not carry an accept-critic-verdict picker", () => {
      expect(START_COMMAND_BODY).not.toMatch(/accept critic[\s\S]{0,20}\[y\/n\]/iu);
    });

    it("declares always-auto chain as the orchestrator's default behaviour", () => {
      expect(START_COMMAND_BODY).toMatch(/always[-\s]auto/iu);
    });
  });

  describe("always-auto failure handling matrix lives in a dedicated runbook", () => {
    it("ON_DEMAND_RUNBOOKS includes always-auto-failure-handling", () => {
      const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === "always-auto-failure-handling");
      expect(r).toBeDefined();
    });

    it("runbook routes build failure → auto-fix loop capped at 3 iterations", () => {
      const body = runbookBody("always-auto-failure-handling");
      expect(body).toMatch(/build[\s\S]*?(auto[-\s]fix|fix[-\s]only)[\s\S]*?3|3[\s\S]*?build[\s\S]*?(auto[-\s]fix|fix[-\s]only)/iu);
    });

    it("runbook routes reviewer critical / required-no-fix → auto-fix loop capped at 3 iterations", () => {
      const body = runbookBody("always-auto-failure-handling");
      expect(body).toMatch(/review(er)?[\s\S]*?(critical|required[-\s]no[-\s]fix)[\s\S]*?3|3[\s\S]*?review(er)?[\s\S]*?(critical|required[-\s]no[-\s]fix)/iu);
    });

    it("runbook routes critic block-ship → stop immediately (no auto-iteration)", () => {
      const body = runbookBody("always-auto-failure-handling");
      expect(body).toMatch(/critic[\s\S]*?block[-\s]ship[\s\S]*?stop[\s\S]*?(immediately|no[\s\S]*?auto)/iu);
    });

    it("runbook routes catastrophic failures → stop and report", () => {
      const body = runbookBody("always-auto-failure-handling");
      expect(body).toMatch(/catastrophic|git[\s\S]*?fail|dispatch[\s\S]*?fail/iu);
      expect(body).toMatch(/stop[\s\S]*?report|report[\s\S]*?stop/iu);
    });

    it("runbook declares the uniform stop-and-report status block shape", () => {
      const body = runbookBody("always-auto-failure-handling");
      expect(body).toMatch(/Stopped at|status block/iu);
      expect(body).toMatch(/\/cc-cancel/u);
      expect(body).toMatch(/\/cc/u);
    });
  });

  describe("orchestrator body references the always-auto failure handling runbook", () => {
    it("body cites always-auto-failure-handling.md", () => {
      expect(START_COMMAND_BODY).toContain("always-auto-failure-handling");
    });
  });

  describe("pause-resume runbook reflects always-auto (no step-mode branch)", () => {
    it("pause-resume runbook declares always-auto as the only mode", () => {
      const body = runbookBody("pause-resume");
      expect(body).toMatch(/always[-\s]auto/iu);
      expect(body).toMatch(/step[\s\S]*retired|retired[\s\S]*step/iu);
    });
  });
});
