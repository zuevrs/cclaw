import { describe, expect, it } from "vitest";
import { verifyRules } from "../../src/eval/verifiers/rules.js";

const FIXTURE = `---
stage: scope
author: cclaw
---
# Scope

## Decisions

- D-01: Cookie storage for theme.
- D-02: Tailwind class strategy.
- D-03: SSR hint in root layout.

## Risks

- Third-party embeds ignoring the attribute.
- Theme flash during reload.
`;

describe("verifyRules - no expectations", () => {
  it("returns [] when expected is undefined", () => {
    expect(verifyRules(FIXTURE, undefined)).toEqual([]);
  });

  it("returns [] when expected is empty object", () => {
    expect(verifyRules(FIXTURE, {})).toEqual([]);
  });
});

describe("verifyRules - mustContain / mustNotContain", () => {
  it("passes required phrases and reports misses", () => {
    const results = verifyRules(FIXTURE, {
      mustContain: ["Tailwind class strategy", "NotPresent"]
    });
    expect(results).toHaveLength(2);
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.id).toBe("rules:contains:tailwind-class-strategy");
    expect(results[1]?.ok).toBe(false);
    expect(results[1]?.id).toBe("rules:contains:notpresent");
  });

  it("is case-insensitive for substring checks", () => {
    const results = verifyRules(FIXTURE, { mustContain: ["tAILwind CLASS"] });
    expect(results[0]?.ok).toBe(true);
  });

  it("flags forbidden phrases with occurrence counts", () => {
    const results = verifyRules(FIXTURE, {
      mustNotContain: ["SSR hint", "absent-phrase"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.occurrences).toBe(1);
    expect(results[1]?.ok).toBe(true);
  });
});

describe("verifyRules - regex", () => {
  it("counts matches for required patterns", () => {
    const results = verifyRules(FIXTURE, {
      regexRequired: [{ pattern: "D-\\d+", description: "Decision ids" }]
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.details?.matches).toBe(3);
    expect(results[0]?.id).toBe("rules:regex-required:decision-ids");
  });

  it("fails when required pattern does not match", () => {
    const results = verifyRules(FIXTURE, {
      regexRequired: [{ pattern: "Z-\\d+" }]
    });
    expect(results[0]?.ok).toBe(false);
  });

  it("fails when forbidden pattern matches", () => {
    const results = verifyRules(FIXTURE, {
      regexForbidden: [{ pattern: "D-\\d+", description: "decisions should move to rules" }]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.matches).toBe(3);
  });

  it("throws a helpful error on invalid regex", () => {
    expect(() =>
      verifyRules(FIXTURE, {
        regexRequired: [{ pattern: "(", description: "broken" }]
      })
    ).toThrow(/Invalid regex/);
  });
});

describe("verifyRules - min/max occurrences", () => {
  it("passes min occurrence floor", () => {
    const results = verifyRules(FIXTURE, {
      minOccurrences: { "D-0": 3 }
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.details?.occurrences).toBe(3);
  });

  it("fails when floor not met", () => {
    const results = verifyRules(FIXTURE, {
      minOccurrences: { "D-0": 10 }
    });
    expect(results[0]?.ok).toBe(false);
  });

  it("passes max occurrence ceiling", () => {
    const results = verifyRules(FIXTURE, {
      maxOccurrences: { "## Risks": 1 }
    });
    expect(results[0]?.ok).toBe(true);
  });

  it("fails when ceiling exceeded", () => {
    const results = verifyRules(FIXTURE, {
      maxOccurrences: { "D-0": 2 }
    });
    expect(results[0]?.ok).toBe(false);
  });
});

describe("verifyRules - uniqueBulletsInSection", () => {
  it("passes when section bullets are unique", () => {
    const results = verifyRules(FIXTURE, {
      uniqueBulletsInSection: ["Decisions"]
    });
    expect(results[0]?.ok).toBe(true);
    expect(results[0]?.details?.bullets).toBe(3);
  });

  it("reports duplicate bullets", () => {
    const dupFixture = `# Scope

## Decisions

- D-01: Cookie
- D-01: Cookie
- D-02: Another
`;
    const results = verifyRules(dupFixture, {
      uniqueBulletsInSection: ["Decisions"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.duplicates).toEqual([
      { entry: "d-01: cookie", count: 2 }
    ]);
  });

  it("fails when section not found", () => {
    const results = verifyRules(FIXTURE, {
      uniqueBulletsInSection: ["NotASection"]
    });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.found).toBe(false);
  });

  it("only counts top-level bullets", () => {
    const nested = `# F

## Items

- outer
  - inner-a
  - inner-a
- outer
`;
    const results = verifyRules(nested, { uniqueBulletsInSection: ["Items"] });
    expect(results[0]?.ok).toBe(false);
    expect(results[0]?.details?.bullets).toBe(2);
    expect(results[0]?.details?.duplicates).toEqual([
      { entry: "outer", count: 2 }
    ]);
  });
});

describe("verifyRules - composite", () => {
  it("emits one result per rule across every category", () => {
    const results = verifyRules(FIXTURE, {
      mustContain: ["Scope"],
      mustNotContain: ["TBD"],
      regexRequired: [{ pattern: "D-\\d+" }],
      regexForbidden: [{ pattern: "Z-\\d+" }],
      minOccurrences: { "D-0": 1 },
      maxOccurrences: { "D-0": 10 },
      uniqueBulletsInSection: ["Decisions"]
    });
    expect(results).toHaveLength(7);
    expect(results.every((r) => r.ok)).toBe(true);
  });
});
