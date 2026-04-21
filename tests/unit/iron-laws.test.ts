import { describe, expect, it } from "vitest";
import {
  IRON_LAWS,
  ironLawRuntimeDocument,
  normalizeStrictLawIds
} from "../../src/content/iron-laws.js";

describe("iron laws", () => {
  it("materializes runtime document with strict global mode", () => {
    const runtime = ironLawRuntimeDocument({ mode: "strict" });
    expect(runtime.mode).toBe("strict");
    expect(runtime.laws.length).toBe(IRON_LAWS.length);
    expect(runtime.laws.every((law) => law.strict)).toBe(true);
  });

  it("applies per-law strict overrides in advisory mode", () => {
    const runtime = ironLawRuntimeDocument({
      mode: "advisory",
      strictLaws: ["tdd-red-before-write", "ship-preflight-required"]
    });
    const strictIds = runtime.laws.filter((law) => law.strict).map((law) => law.id);
    expect(strictIds.sort()).toEqual(["ship-preflight-required", "tdd-red-before-write"]);
  });

  it("normalizes strict law id list", () => {
    const ids = normalizeStrictLawIds([
      "tdd-red-before-write",
      "unknown-law",
      "tdd-red-before-write",
      "ship-preflight-required"
    ]);
    expect(ids.sort()).toEqual(["ship-preflight-required", "tdd-red-before-write"]);
  });
});
