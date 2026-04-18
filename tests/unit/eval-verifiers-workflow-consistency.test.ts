import { describe, expect, it } from "vitest";
import { verifyWorkflowConsistency } from "../../src/eval/verifiers/workflow-consistency.js";
import type {
  WorkflowConsistencyExpected,
  WorkflowStageName
} from "../../src/eval/types.js";

function artifacts(
  entries: Record<WorkflowStageName, string>
): Map<WorkflowStageName, string> {
  return new Map(Object.entries(entries) as Array<[WorkflowStageName, string]>);
}

describe("verifyWorkflowConsistency", () => {
  it("returns zero results when expected is undefined", () => {
    expect(
      verifyWorkflowConsistency(artifacts({} as Record<WorkflowStageName, string>), undefined)
    ).toEqual([]);
  });

  it("passes ids-flow when every source id appears in every target stage", () => {
    const expected: WorkflowConsistencyExpected = {
      idsFlow: [{ idPattern: "D-\\d+", from: "scope", to: ["design", "plan"] }]
    };
    const results = verifyWorkflowConsistency(
      artifacts({
        scope: "Decisions: D-01, D-02, D-03",
        design: "Designing around D-01, D-02, D-03 explicitly.",
        plan: "Plan steps use D-01 (step 1), D-02 (step 2), D-03 (step 3)."
      } as Record<WorkflowStageName, string>),
      expected
    );
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(results[0]?.details?.ids).toEqual(["D-01", "D-02", "D-03"]);
  });

  it("flags the first missing id per target stage", () => {
    const expected: WorkflowConsistencyExpected = {
      idsFlow: [{ idPattern: "D-\\d+", from: "scope", to: ["plan"] }]
    };
    const results = verifyWorkflowConsistency(
      artifacts({
        scope: "D-01, D-02, D-03",
        plan: "Plan references D-01 and D-03 only."
      } as Record<WorkflowStageName, string>),
      expected
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.missing).toEqual(["D-02"]);
  });

  it("marks ids-flow source-missing when the `from` stage has no artifact", () => {
    const expected: WorkflowConsistencyExpected = {
      idsFlow: [{ idPattern: "D-\\d+", from: "scope", to: ["plan"] }]
    };
    const results = verifyWorkflowConsistency(
      artifacts({ plan: "D-01" } as Record<WorkflowStageName, string>),
      expected
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toContain("source-missing");
  });

  it("placeholder-free uses default phrases when none provided", () => {
    const expected: WorkflowConsistencyExpected = {
      placeholderFree: { stages: ["brainstorm", "scope"] }
    };
    const results = verifyWorkflowConsistency(
      artifacts({
        brainstorm: "All good here.",
        scope: "Still TBD on the rollout window."
      } as Record<WorkflowStageName, string>),
      expected
    );
    expect(results.find((r) => r.id.endsWith("brainstorm"))?.ok).toBe(true);
    expect(results.find((r) => r.id.endsWith("scope"))?.ok).toBe(false);
    expect(results.find((r) => r.id.endsWith("scope"))?.message).toMatch(/TBD/i);
  });

  it("no-contradiction is vacuously satisfied when `must` is absent", () => {
    const expected: WorkflowConsistencyExpected = {
      noContradictions: [
        {
          stage: "scope",
          must: "language: typescript",
          forbid: "language: python",
          stages: ["plan"]
        }
      ]
    };
    const results = verifyWorkflowConsistency(
      artifacts({
        scope: "Scope doesn't mention the language.",
        plan: "Plan calls out language: python (should be fine — anchor missing)."
      } as Record<WorkflowStageName, string>),
      expected
    );
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.id).toContain("anchor-inactive");
  });

  it("no-contradiction flags `forbid` when anchor is present", () => {
    const expected: WorkflowConsistencyExpected = {
      noContradictions: [
        {
          stage: "scope",
          must: "language: typescript",
          forbid: "language: python",
          stages: ["design", "plan"]
        }
      ]
    };
    const results = verifyWorkflowConsistency(
      artifacts({
        scope: "language: typescript is the fixed constraint.",
        design: "design in language: typescript",
        plan: "plan switches to language: python"
      } as Record<WorkflowStageName, string>),
      expected
    );
    const plan = results.find((r) => r.id.endsWith(":plan"));
    expect(plan?.ok).toBe(false);
    const design = results.find((r) => r.id.endsWith(":design"));
    expect(design?.ok).toBe(true);
  });
});
