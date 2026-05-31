import { describe, expect, it } from "vitest";

import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.125 — bounded parallel-review fan-out.
 *
 * Parallel review is size-gated, opt-in, and capped at 5 partitions — the
 * same posture as `parallel-build`. These tests pin the load-bearing
 * invariants so a future edit can't silently make review fan out on small
 * diffs, drop the cap, partition the security axis, or remove the
 * mandatory post-merge integration sweep / fallback.
 */
describe("v8.125 — parallel-review runbook wiring", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "parallel-review");

  it("registers the parallel-review runbook with a non-trivial body", () => {
    expect(runbook, "parallel-review must be in ON_DEMAND_RUNBOOKS").toBeDefined();
    expect(runbook!.fileName).toBe("parallel-review.md");
    expect(runbook!.body.length).toBeGreaterThan(1500);
  });

  it("is size-gated: strict-only, large-diff thresholds, ≥2 disjoint clusters, dispatch+git", () => {
    const body = runbook!.body;
    expect(body).toContain('triage.ceremonyMode == "strict"');
    expect(body).toMatch(/≥\s*12 changed files OR ≥\s*400 changed lines/u);
    expect(body).toMatch(/≥\s*2 disjoint clusters/u);
    // The gate is the SOLE trigger — small/medium diffs never fan out.
    expect(body).toMatch(/sole.+trigger/iu);
  });

  it("caps partitions at 5 and forbids cascading waves", () => {
    const body = runbook!.body;
    expect(body).toMatch(/≤\s*5 partitions/u);
    expect(body).toMatch(/never.+cascade/iu);
  });

  it("keeps the security axis whole-diff (never per-partition)", () => {
    const body = runbook!.body;
    expect(body).toMatch(/security.+(whole|entire).+diff/isu);
    expect(body).toMatch(/never per-partition/iu);
  });

  it("merges deterministically: worst-of decision + mandatory integration sweep", () => {
    const body = runbook!.body;
    expect(body).toMatch(/worst of the partition decisions/iu);
    expect(body).toContain("block` > `warn` > `clear`");
    expect(body).toMatch(/Five Failure Modes/u);
    expect(body).toMatch(/mandatory/iu);
  });

  it("counts a partitioned iteration as ONE against the 5-cap (no flow-state churn)", () => {
    const body = runbook!.body;
    expect(body).toMatch(/one.+iteration against the/iu);
    expect(body).toMatch(/No new flow-state field/iu);
  });

  it("falls back silently to a single sequential reviewer", () => {
    const body = runbook!.body;
    expect(body).toMatch(/degrades to a single sequential reviewer/iu);
    expect(body).toMatch(/never reduces review depth/iu);
  });
});

describe("v8.125 — parallel-review cross-references", () => {
  it("the review stage playbook anchors §1a and points at the runbook", () => {
    const review = STAGE_PLAYBOOKS.find((p) => p.id === "review");
    expect(review).toBeDefined();
    const body = review!.body;
    expect(body).toContain("## 1a. Optional parallel-review fan-out (size-gated)");
    expect(body).toContain("runbooks/parallel-review.md");
    // The anchor must keep the cap + whole-diff security invariants visible.
    expect(body).toMatch(/≤\s*5 partition reviewers/u);
  });

  it("the cockpit render surfaces a parallel-review clause only when it fans out", () => {
    expect(START_COMMAND_BODY).toContain("Parallel review");
    expect(START_COMMAND_BODY).toMatch(/reviewed N partitions in parallel/u);
  });
});
