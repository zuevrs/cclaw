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
    expect(parseArgs(["archive"]).command).toBe("archive");
  });

  it("parses archive name flag", () => {
    const parsed = parseArgs(["archive", "--name=release-safety"]);
    expect(parsed.command).toBe("archive");
    expect(parsed.archiveName).toBe("release-safety");
  });

  it("parses doctor reconcile gates flag", () => {
    const parsed = parseArgs(["doctor", "--reconcile-gates"]);
    expect(parsed.command).toBe("doctor");
    expect(parsed.reconcileGates).toBe(true);
  });
});
