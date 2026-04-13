import { describe, expect, it } from "vitest";
import { parseArgs, parseHarnesses } from "../../src/cli.js";

describe("cli parser", () => {
  it("parses init with harness list", () => {
    const parsed = parseArgs(["init", "--harnesses=claude,cursor"]);
    expect(parsed.command).toBe("init");
    expect(parsed.harnesses).toEqual(["claude", "cursor"]);
  });

  it("throws for unknown harness", () => {
    expect(() => parseHarnesses("claude,unknown")).toThrowError(/Unknown harnesses/);
  });

  it("keeps runtime command surface installer-only", () => {
    expect(parseArgs(["new"]).command).toBeUndefined();
    expect(parseArgs(["runs"]).command).toBeUndefined();
    expect(parseArgs(["resume"]).command).toBeUndefined();
    expect(parseArgs(["archive"]).command).toBeUndefined();
  });
});
