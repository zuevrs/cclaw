import { describe, expect, it } from "vitest";

import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.83 — Token compression: orchestrator runbook duplicates.
 *
 * Slimmed in v8.101 (Phase A4): kept only the unique-value wiring tests
 * per the A2 "2-3 unique-value rule". The detail prompt-grep tripwires
 * (which assertion-per-section) are out-of-scope of mutation testing
 * (target = runbooks-on-demand.ts + start-command.ts, neither in stryker
 * scope), so we keep only:
 *   - 1 wiring lookup per new runbook (id + fileName + non-trivial body)
 *   - 1 cross-reference test ensuring start-command references each lift
 *   - 1 char-reduction regression guard (AC-7, the canary for re-inline)
 */

// The v8.82 main-branch baseline of the rendered START_COMMAND_BODY. AC-7
// is the regression gate that lights up if a future slug re-inlines a
// lifted runbook body.
const V882_BASELINE_CHARS = 141769;

const LIFTED_RUNBOOKS = ["detect-matrix", "approaches-gate", "one-way-door-gate"] as const;

describe("v8.83 — runbooks-on-demand.ts gains three new lift runbooks", () => {
  it("each lifted runbook is registered with id, fileName, non-trivial body, and runbook header", () => {
    for (const id of LIFTED_RUNBOOKS) {
      const rb = ON_DEMAND_RUNBOOKS.find((r) => r.id === id);
      expect(rb, `runbook ${id} must be registered`).toBeDefined();
      expect(rb?.fileName).toBe(`${id}.md`);
      expect(rb?.body.length).toBeGreaterThan(2000);
      expect(rb?.body).toMatch(/^# On-demand runbook — /m);
    }
  });

  it("every lifted runbook is surfaced in the on-demand runbooks index section", () => {
    for (const id of LIFTED_RUNBOOKS) {
      expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain(`${id}.md`);
    }
  });

  it("start-command body references every lifted runbook by file name + the unchanged debug-branch runbook", () => {
    for (const id of LIFTED_RUNBOOKS) {
      expect(START_COMMAND_BODY).toContain(`${id}.md`);
    }
    expect(START_COMMAND_BODY).toContain("debug-branch.md");
  });
});

describe("v8.83 — start-command body no longer carries the lifted duplicate prose", () => {
  // Each phrase below was inlined verbatim in start-command on the v8.82
  // baseline AND in the corresponding runbook. The phrases are picked to
  // be (a) long enough to be ungame-able and (b) unique to the runbook
  // body, so matching them would mean re-inlining the lifted block.
  it("AC-6 — start-command body no longer inlines the long-form lifted block markers", () => {
    expect(START_COMMAND_BODY).not.toContain(
      "Stamp `flow-state.json > approaches`** as a {@link ResearchApproach}"
    );
    expect(START_COMMAND_BODY).not.toContain(
      "**Only one obvious framing emerges from the dialogue**"
    );
    expect(START_COMMAND_BODY).not.toMatch(
      /\|\s*`direct-fix`\s*\|\s*Skip architect entirely\.\s*Dispatch/u
    );
  });
});

describe("v8.83 — start-command body shrinks measurably vs the v8.82 baseline (re-inline canary)", () => {
  it("AC-7 — start-command body is at least 2.5% smaller than the v8.82 baseline", () => {
    const reduction =
      (V882_BASELINE_CHARS - START_COMMAND_BODY.length) / V882_BASELINE_CHARS;
    expect(
      reduction,
      `start-command body: ${V882_BASELINE_CHARS} → ${START_COMMAND_BODY.length} chars (${(reduction * 100).toFixed(2)}%). Threshold: ≥2.5%.`
    ).toBeGreaterThanOrEqual(0.025);
  });
});
