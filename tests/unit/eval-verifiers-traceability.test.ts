import { describe, expect, it } from "vitest";
import { verifyTraceability } from "../../src/eval/verifiers/traceability.js";

const SCOPE = `---
stage: scope
---
# Scope

## Decisions

- D-01: Cookie.
- D-02: Tailwind.
- D-03: SSR hint.
`;

const PLAN_COMPLETE = `# Plan

- Implements D-01, D-02, and D-03.
`;

const PLAN_PARTIAL = `# Plan

- Implements D-01 only.
`;

const TDD_COMPLETE = `# TDD

Covers D-01, D-02, D-03.
`;

describe("verifyTraceability - no expectations", () => {
  it("returns [] when expected is undefined", () => {
    expect(verifyTraceability("x", {}, undefined)).toEqual([]);
  });
});

describe("verifyTraceability - source resolution", () => {
  it("uses the primary artifact when source is self", () => {
    const results = verifyTraceability(SCOPE, { plan: PLAN_COMPLETE }, {
      idPattern: "D-\\d+",
      source: "self",
      requireIn: ["plan"]
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.id).toBe("traceability:self->plan");
    expect((results[0]?.details as { sourceIds: string[] }).sourceIds).toEqual([
      "D-01",
      "D-02",
      "D-03"
    ]);
  });

  it("uses an extra fixture when source is a label", () => {
    const results = verifyTraceability("# primary has no ids", { scope: SCOPE, plan: PLAN_COMPLETE }, {
      idPattern: "D-\\d+",
      source: "scope",
      requireIn: ["plan"]
    });
    expect(results[0]?.ok).toBe(true);
  });

  it("fails when source fixture is unknown", () => {
    const results = verifyTraceability("x", {}, {
      idPattern: "D-\\d+",
      source: "scope",
      requireIn: ["self"]
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toBe("traceability:source:scope:missing");
  });

  it("fails when source yields zero ids", () => {
    const results = verifyTraceability("# no decisions here", {}, {
      idPattern: "D-\\d+",
      source: "self",
      requireIn: ["self"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toBe("traceability:source:self:empty");
  });
});

describe("verifyTraceability - target checks", () => {
  it("fails when a target is missing ids and lists them", () => {
    const results = verifyTraceability(SCOPE, { plan: PLAN_PARTIAL }, {
      idPattern: "D-\\d+",
      source: "self",
      requireIn: ["plan"]
    });
    expect(results).toHaveLength(1);
    expect(results[0]?.ok).toBe(false);
    expect((results[0]?.details as { missing: string[] }).missing).toEqual([
      "D-02",
      "D-03"
    ]);
  });

  it("emits one result per requireIn target in order", () => {
    const results = verifyTraceability(SCOPE, {
      plan: PLAN_COMPLETE,
      tdd: TDD_COMPLETE
    }, {
      idPattern: "D-\\d+",
      source: "self",
      requireIn: ["plan", "tdd"]
    });
    expect(results.map((r) => r.id)).toEqual([
      "traceability:self->plan",
      "traceability:self->tdd"
    ]);
  });

  it("flags unknown target labels without crashing", () => {
    const results = verifyTraceability(SCOPE, {}, {
      idPattern: "D-\\d+",
      source: "self",
      requireIn: ["ghost"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.id).toBe("traceability:target:ghost:missing");
  });

  it("throws helpful error on invalid id regex", () => {
    expect(() =>
      verifyTraceability(SCOPE, {}, {
        idPattern: "(",
        source: "self",
        requireIn: ["self"]
      })
    ).toThrow(/Invalid traceability id_pattern/);
  });
});

describe("verifyTraceability - body semantics", () => {
  it("strips frontmatter before searching source and targets", () => {
    const frontmatterArtifact = "---\nref: D-99\n---\n# Body has D-01\n";
    const results = verifyTraceability(frontmatterArtifact, {}, {
      idPattern: "D-\\d+",
      source: "self",
      requireIn: ["self"]
    });
    expect((results[0]?.details as { sourceIds: string[] }).sourceIds).toEqual([
      "D-01"
    ]);
  });
});
