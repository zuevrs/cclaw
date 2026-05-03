import { describe, expect, it } from "vitest";
import {
  extractEvidencePointers,
  validateTddGreenEvidence,
  validateTddRedEvidence
} from "../../src/artifact-linter/shared.js";

describe("extractEvidencePointers", () => {
  it("returns the value for a bare `Evidence:` line", () => {
    expect(extractEvidencePointers("Evidence: docs/red-output.txt")).toEqual([
      "docs/red-output.txt"
    ]);
  });

  it("recognises bullet-prefixed pointer lines", () => {
    expect(extractEvidencePointers("- Evidence: artifacts/foo.log")).toEqual([
      "artifacts/foo.log"
    ]);
  });

  it("recognises spanId pointer lines", () => {
    expect(extractEvidencePointers("Evidence: spanId:abc123")).toEqual([
      "spanId:abc123"
    ]);
  });

  it("returns multiple pointers across lines", () => {
    expect(
      extractEvidencePointers(
        ["Evidence: a/b.log", "noise", "- Evidence: spanId:xyz"].join("\n")
      )
    ).toEqual(["a/b.log", "spanId:xyz"]);
  });

  it("ignores lines that don't carry the pointer", () => {
    expect(
      extractEvidencePointers("This is some commentary about the failure.")
    ).toEqual([]);
  });
});

describe("validateTddRedEvidence (T3 pointer mode)", () => {
  it("auto-satisfies when sidecar has a redOutputRef for the slice", () => {
    const result = validateTddRedEvidence("", { sidecarAutoSatisfy: true });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/06-tdd-slices\.jsonl/);
  });

  it("auto-satisfies when an Evidence: pointer was resolved", () => {
    const result = validateTddRedEvidence("(empty)", { pointerSatisfied: true });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/pointer/i);
  });

  it("falls back to legacy markers when no pointer/sidecar context", () => {
    const result = validateTddRedEvidence("", {});
    expect(result.ok).toBe(false);
  });

  it("legacy markers still pass", () => {
    const body = [
      "command: npm test",
      "FAIL  tests/foo.spec.ts",
      "AssertionError: expected true"
    ].join("\n");
    const result = validateTddRedEvidence(body, {});
    expect(result.ok).toBe(true);
  });
});

describe("validateTddGreenEvidence (T3 pointer mode)", () => {
  it("auto-satisfies when sidecar has a greenOutputRef", () => {
    const result = validateTddGreenEvidence("", { sidecarAutoSatisfy: true });
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/06-tdd-slices\.jsonl/);
  });

  it("auto-satisfies via Evidence: pointer", () => {
    const result = validateTddGreenEvidence("(empty)", { pointerSatisfied: true });
    expect(result.ok).toBe(true);
  });

  it("falls back to legacy markers when no pointer/sidecar context", () => {
    const result = validateTddGreenEvidence("", {});
    expect(result.ok).toBe(false);
  });

  it("legacy markers still pass", () => {
    const body = [
      "command: npm test",
      "PASS tests/foo.spec.ts",
      "Tests:  1 passed"
    ].join("\n");
    const result = validateTddGreenEvidence(body, {});
    expect(result.ok).toBe(true);
  });
});
