import { describe, expect, it } from "vitest";
import { REFERENCE_PATTERNS, REFERENCE_PATTERNS_INDEX } from "../../src/content/reference-patterns.js";

describe("reference patterns", () => {
  it("ships eight task patterns", () => {
    const ids = REFERENCE_PATTERNS.map((entry) => entry.id).sort();
    expect(ids).toEqual([
      "api-endpoint",
      "auth-flow",
      "doc-rewrite",
      "perf-fix",
      "refactor",
      "schema-migration",
      "security-hardening",
      "ui-component"
    ]);
  });

  it("each pattern has triggers, AC shape, specialists, and pitfalls sections", () => {
    for (const pattern of REFERENCE_PATTERNS) {
      expect(pattern.triggers.length).toBeGreaterThan(0);
      expect(pattern.body).toContain("AC shape");
      expect(pattern.body).toContain("Specialists to invoke");
      expect(pattern.body).toContain("Common pitfalls");
    }
  });

  it("auth-flow names threat-model + sensitive-change modes", () => {
    const auth = REFERENCE_PATTERNS.find((entry) => entry.id === "auth-flow");
    expect(auth?.body).toContain("threat-model");
    expect(auth?.body).toContain("sensitive-change");
  });

  it("REFERENCE_PATTERNS_INDEX lists every pattern", () => {
    for (const pattern of REFERENCE_PATTERNS) {
      expect(REFERENCE_PATTERNS_INDEX).toContain(pattern.fileName);
    }
  });
});
