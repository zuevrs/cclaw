import { describe, expect, it } from "vitest";
import {
  compareSliceIds,
  isSliceId,
  parseSliceId,
  sortSliceIds,
  SLICE_ID_REGEX
} from "../../src/util/slice-id.js";

describe("slice-id parser", () => {
  it("accepts plain numeric ids", () => {
    expect(parseSliceId("S-1")).toEqual({ id: "S-1", numeric: 1, suffix: "" });
    expect(parseSliceId("S-184")).toEqual({ id: "S-184", numeric: 184, suffix: "" });
  });

  it("accepts lettered sub-slice ids", () => {
    expect(parseSliceId("S-36a")).toEqual({ id: "S-36a", numeric: 36, suffix: "a" });
    expect(parseSliceId("S-36b")).toEqual({ id: "S-36b", numeric: 36, suffix: "b" });
    expect(parseSliceId("S-12abc")).toEqual({ id: "S-12abc", numeric: 12, suffix: "abc" });
    expect(parseSliceId("S-7a1")).toEqual({ id: "S-7a1", numeric: 7, suffix: "a1" });
  });

  it("normalizes case for the suffix and accepts surrounding markdown decorations", () => {
    expect(parseSliceId("`S-36A`")?.id).toBe("S-36a");
    expect(parseSliceId("[S-36b]")?.id).toBe("S-36b");
    expect(parseSliceId('"S-2"')?.id).toBe("S-2");
  });

  it("rejects non-slice tokens", () => {
    expect(parseSliceId("S-")).toBeNull();
    expect(parseSliceId("T-001")).toBeNull();
    expect(parseSliceId("S-1.0")).toBeNull();
    expect(parseSliceId("S-1-extra")).toBeNull();
    expect(parseSliceId("S-A")).toBeNull();
    expect(parseSliceId(undefined)).toBeNull();
    expect(parseSliceId(42 as unknown)).toBeNull();
  });

  it("isSliceId mirrors parseSliceId boolean shape", () => {
    expect(isSliceId("S-36a")).toBe(true);
    expect(isSliceId("S-36 ")).toBe(true);
    expect(isSliceId("nope")).toBe(false);
  });

  it("regex source is anchored and case-insensitive", () => {
    expect(SLICE_ID_REGEX.test("S-36a")).toBe(true);
    expect(SLICE_ID_REGEX.test("s-36a")).toBe(true);
    expect(SLICE_ID_REGEX.test("xx S-36a")).toBe(false);
  });
});

describe("slice-id sort order", () => {
  it("orders numeric chunks first then lexical suffix", () => {
    const input = ["S-37", "S-36b", "S-36", "S-10", "S-2", "S-36a", "S-1"];
    expect(sortSliceIds(input)).toEqual(["S-1", "S-2", "S-10", "S-36", "S-36a", "S-36b", "S-37"]);
  });

  it("orders mixed (slice, non-slice) tokens deterministically", () => {
    const input = ["S-2", "junk", "S-1"];
    const sorted = [...input].sort(compareSliceIds);
    expect(sorted).toEqual(["S-1", "S-2", "junk"]);
  });

  it("sub-slice with same numeric chunk sorts after the parent", () => {
    expect(compareSliceIds("S-36", "S-36a")).toBeLessThan(0);
    expect(compareSliceIds("S-36a", "S-36")).toBeGreaterThan(0);
    expect(compareSliceIds("S-36a", "S-36b")).toBeLessThan(0);
    expect(compareSliceIds("S-36b", "S-36a")).toBeGreaterThan(0);
    expect(compareSliceIds("S-36a", "S-36a")).toBe(0);
  });
});
