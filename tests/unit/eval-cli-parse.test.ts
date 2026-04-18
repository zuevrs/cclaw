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

  it("parses --stage and --mode", () => {
    const parsed = parseArgs(["eval", "--stage=brainstorm", "--mode=agent"]);
    expect(parsed.evalStage).toBe("brainstorm");
    expect(parsed.evalMode).toBe("agent");
  });

  it("accepts legacy --tier values (A/B/C → fixture/agent/workflow)", () => {
    expect(parseArgs(["eval", "--tier=A"]).evalMode).toBe("fixture");
    expect(parseArgs(["eval", "--tier=B"]).evalMode).toBe("agent");
    expect(parseArgs(["eval", "--tier=C"]).evalMode).toBe("workflow");
  });

  it("accepts lowercase legacy tier values", () => {
    expect(parseArgs(["eval", "--tier=c"]).evalMode).toBe("workflow");
  });

  it("throws for unknown stage", () => {
    expect(() => parseArgs(["eval", "--stage=unknown"])).toThrow(/Unknown eval stage/);
  });

  it("throws for unknown --mode", () => {
    expect(() => parseArgs(["eval", "--mode=nonsense"])).toThrow(
      /Evaluation mode must be one of/
    );
  });

  it("throws for unknown --tier", () => {
    expect(() => parseArgs(["eval", "--tier=Z"])).toThrow(
      /Evaluation mode must be one of/
    );
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
    expect(text).toContain("--mode=<fixture|agent|workflow>");
    expect(text).toContain("--stage=<id>");
    expect(text).toContain("--judge");
    expect(text).toContain("--no-write");
    expect(text).toContain("Legacy --tier=A|B|C still works");
  });
});
