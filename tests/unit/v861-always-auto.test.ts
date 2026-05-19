import { describe, expect, it } from "vitest";

import { runModeOf } from "../../src/flow-state.js";

/**
 * v8.61 — always-auto mode. Slimmed in v8.100.
 *
 * Kept only the `runModeOf` wiring tests that exercise the legacy
 * runMode value folding. The orchestrator body and runbook prompt-grep
 * tripwires were removed.
 */
describe("v8.61 — runModeOf folds every legacy value to auto", () => {
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
