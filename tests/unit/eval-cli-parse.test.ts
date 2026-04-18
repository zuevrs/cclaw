import { describe, expect, it } from "vitest";
import { parseArgs, usage } from "../../src/cli.js";

describe("cli parser: eval command", () => {
  it("parses bare `eval` command", () => {
    const parsed = parseArgs(["eval"]);
    expect(parsed.command).toBe("eval");
  });

  it("parses --dry-run flag", () => {
    const parsed = parseArgs(["eval", "--dry-run"]);
    expect(parsed.command).toBe("eval");
    expect(parsed.dryRun).toBe(true);
  });

  it("parses --schema-only / --rules / --judge flags", () => {
    const parsed = parseArgs(["eval", "--schema-only", "--rules", "--judge"]);
    expect(parsed.evalSchemaOnly).toBe(true);
    expect(parsed.evalRules).toBe(true);
    expect(parsed.evalJudge).toBe(true);
  });

  it("parses --stage and --tier", () => {
    const parsed = parseArgs(["eval", "--stage=brainstorm", "--tier=B"]);
    expect(parsed.evalStage).toBe("brainstorm");
    expect(parsed.evalTier).toBe("B");
  });

  it("accepts lowercase tier values", () => {
    const parsed = parseArgs(["eval", "--tier=c"]);
    expect(parsed.evalTier).toBe("C");
  });

  it("throws for unknown stage", () => {
    expect(() => parseArgs(["eval", "--stage=unknown"])).toThrow(/Unknown eval stage/);
  });

  it("throws for unknown tier", () => {
    expect(() => parseArgs(["eval", "--tier=Z"])).toThrow(/Unknown eval tier/);
  });

  it("--json routes to evalJson for eval command", () => {
    const parsed = parseArgs(["eval", "--json"]);
    expect(parsed.evalJson).toBe(true);
    expect(parsed.doctorJson).toBeUndefined();
  });

  it("--json routes to doctorJson for doctor command", () => {
    const parsed = parseArgs(["doctor", "--json"]);
    expect(parsed.doctorJson).toBe(true);
    expect(parsed.evalJson).toBeUndefined();
  });

  it("parses --no-write", () => {
    const parsed = parseArgs(["eval", "--no-write"]);
    expect(parsed.evalNoWrite).toBe(true);
  });

  it("documents eval command in usage()", () => {
    const text = usage();
    expect(text).toContain("cclaw eval");
    expect(text).toContain("--schema-only");
    expect(text).toContain("--tier=<A|B|C>");
    expect(text).toContain("--stage=<id>");
    expect(text).toContain("--judge");
    expect(text).toContain("--no-write");
  });
});
