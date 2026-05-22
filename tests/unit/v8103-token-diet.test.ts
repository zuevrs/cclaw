import { describe, expect, it } from "vitest";

import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";

/**
 * v8.103 — Startup token diet.
 *
 * Cuts ~80k chars / ~20k tokens from start-command.ts orchestrator entry
 * by lifting duplicated content into existing + new on-demand runbooks:
 *   - new: runbooks/research-mode.md (full Phase 0-4 multi-lens flow)
 *   - new: runbooks/triage-gate.md (triage shape, audit, follow-up-bug
 *     detection, prior-context + prior-learnings consumption, debug
 *     hand-off, no-git downgrade audit trail)
 *   - augmented: existing critic-steps / debug-branch / one-way-door-gate
 *     runbooks unchanged; orchestrator pointers now name them.
 *
 * The diet also collapses 11 `#### <stage>` subsections into a slimmer
 * `### Stage details` block + a `Stage → specialist mapping` table with
 * a Contract column pointing at `agents/<id>.md` + relevant runbook.
 */

// v8.112 ceiling relaxation: +200 chars allowed for the documented
// cross-model convergence-loop (santa-loop) feature add. See
// `tests/unit/v883-token-runbooks.test.ts > V8102_ADDITIVE_CHARS` for
// the full justification — the carve-out covers a one-paragraph
// orchestrator-side contract anchor, NOT a re-inline of any lifted
// runbook body. Future feature adds must bump this ceiling explicitly.
const START_COMMAND_BODY_CEILING_CHARS = 50_200;

describe("v8.103 — startup token diet (orchestrator entry compression)", () => {
  it(`START_COMMAND_BODY chars < ${START_COMMAND_BODY_CEILING_CHARS} (was ~137 000) — body-level char ceiling`, () => {
    expect(
      START_COMMAND_BODY.length,
      `START_COMMAND_BODY is ${START_COMMAND_BODY.length} chars; expected < ${START_COMMAND_BODY_CEILING_CHARS}.`
    ).toBeLessThan(START_COMMAND_BODY_CEILING_CHARS);
  });

  it(`renderStartCommand() output chars < ${START_COMMAND_BODY_CEILING_CHARS} — rendered-output char ceiling`, () => {
    const out = renderStartCommand();
    expect(
      out.length,
      `renderStartCommand() is ${out.length} chars; expected < ${START_COMMAND_BODY_CEILING_CHARS}.`
    ).toBeLessThan(START_COMMAND_BODY_CEILING_CHARS);
  });

  it("new research-mode runbook exists with Phase 0-4 content + Approaches Gate + lens roster", () => {
    const rb = ON_DEMAND_RUNBOOKS.find((r) => r.id === "research-mode");
    expect(rb, "research-mode runbook must be registered").toBeDefined();
    expect(rb?.fileName).toBe("research-mode.md");
    expect(rb?.body.length).toBeGreaterThan(5000);
    expect(rb?.body).toMatch(/^# On-demand runbook — research-mode/m);
    expect(rb?.body).toMatch(/Phase 0/u);
    expect(rb?.body).toMatch(/Phase 1\b/u);
    expect(rb?.body).toMatch(/Phase 1\.5/u);
    expect(rb?.body).toMatch(/Phase 2/u);
    expect(rb?.body).toMatch(/Phase 3\b/u);
    expect(rb?.body).toMatch(/Phase 3\.5/u);
    expect(rb?.body).toMatch(/Phase 4/u);
    expect(rb?.body).toMatch(/Approaches Gate/u);
    for (const lens of [
      "research-engineer",
      "research-product",
      "research-architecture",
      "research-history",
      "research-skeptic",
      "research-design"
    ]) {
      expect(rb?.body).toContain(lens);
    }
  });

  it("new triage-gate runbook exists with shape + audit + follow-up-bug + prior-context + prior-learnings content", () => {
    const rb = ON_DEMAND_RUNBOOKS.find((r) => r.id === "triage-gate");
    expect(rb, "triage-gate runbook must be registered").toBeDefined();
    expect(rb?.fileName).toBe("triage-gate.md");
    expect(rb?.body.length).toBeGreaterThan(3000);
    expect(rb?.body).toMatch(/^# On-demand runbook — Triage/m);
    expect(rb?.body).toMatch(/persisted triage shape|Persisted triage shape/iu);
    expect(rb?.body).toMatch(/audit/iu);
    expect(rb?.body).toMatch(/follow-up-bug/u);
    expect(rb?.body).toMatch(/prior-context consumption/iu);
    expect(rb?.body).toMatch(/prior-learnings|learnings-research/iu);
    expect(rb?.body).toMatch(/applyFollowUpBugSignals/u);
    expect(rb?.body).toMatch(/OUTCOME_SIGNAL_MULTIPLIERS/u);
  });

  it("## On-demand runbooks index table surfaces every lifted runbook (research-mode + triage-gate + debug-branch + one-way-door-gate)", () => {
    for (const id of [
      "research-mode",
      "triage-gate",
      "debug-branch",
      "one-way-door-gate",
      "extend-mode",
      "patch-mode"
    ]) {
      expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain(`${id}.md`);
    }
  });

  it("Stage → specialist mapping table carries a Contract column pointing at agents/<id>.md", () => {
    // The Stage → specialist mapping table is rendered in start-command;
    // the Contract column points at agents/<id>.md + the relevant runbook
    // so the orchestrator can open both before dispatching.
    expect(START_COMMAND_BODY).toMatch(/Stage → specialist mapping/u);
    expect(START_COMMAND_BODY).toMatch(/\|\s*Contract\b[^|]*\|/u);
    expect(START_COMMAND_BODY).toMatch(/agents\/architect\.md/u);
    expect(START_COMMAND_BODY).toMatch(/agents\/builder\.md/u);
    expect(START_COMMAND_BODY).toMatch(/agents\/reviewer\.md/u);
    expect(START_COMMAND_BODY).toMatch(/agents\/critic\.md/u);
    expect(START_COMMAND_BODY).toMatch(/agents\/triage\.md/u);
  });

  it("start-command body references the new lift runbooks (research-mode.md + triage-gate.md)", () => {
    expect(START_COMMAND_BODY).toContain("research-mode.md");
    expect(START_COMMAND_BODY).toContain("triage-gate.md");
  });

  it("start-command body no longer inlines the lifted research-mode Phase 3.5 / Phase 4 ceremony", () => {
    // The full Phase 3.5 awaiting-user-review state machine + Phase 4
    // finalize prose live in runbooks/research-mode.md (or
    // runbooks/research-revision.md for sub-command detail). The body
    // keeps only a one-paragraph pointer naming the runbook.
    expect(START_COMMAND_BODY).not.toMatch(/##\s+§\s*7\s*—\s*Phase 3\.5/u);
    expect(START_COMMAND_BODY).not.toMatch(/##\s+§\s*8\s*—\s*Phase 4/u);
  });
});
