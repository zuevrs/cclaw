import { describe, expect, it } from "vitest";
import { parseArgs, parseHarnesses, parseTrack, usage } from "../../src/cli.js";

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

  it("recognizes --help and -h at any position", () => {
    expect(parseArgs(["--help"]).showHelp).toBe(true);
    expect(parseArgs(["-h"]).showHelp).toBe(true);
    expect(parseArgs(["init", "--help"]).showHelp).toBe(true);
    expect(parseArgs(["init"]).showHelp).toBeUndefined();
  });

  it("recognizes --version and -v at any position", () => {
    expect(parseArgs(["--version"]).showVersion).toBe(true);
    expect(parseArgs(["-v"]).showVersion).toBe(true);
    expect(parseArgs(["doctor", "-v"]).showVersion).toBe(true);
    expect(parseArgs(["doctor"]).showVersion).toBeUndefined();
  });

  it("usage message documents every installer command and global flag", () => {
    const text = usage();
    for (const cmd of ["init", "sync", "doctor", "archive", "upgrade", "uninstall"]) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain("--help");
    expect(text).toContain("-h");
    expect(text).toContain("--version");
    expect(text).toContain("-v");
    expect(text).toContain("--track");
  });

  it("parses init with --track=quick", () => {
    const parsed = parseArgs(["init", "--track=quick"]);
    expect(parsed.command).toBe("init");
    expect(parsed.track).toBe("quick");
  });

  it("parses init with --track=standard", () => {
    const parsed = parseArgs(["init", "--track=standard"]);
    expect(parsed.track).toBe("standard");
  });

  it("throws for unknown track id", () => {
    expect(() => parseTrack("turbo")).toThrowError(/Unknown track: turbo/);
    expect(() => parseTrack("turbo")).toThrowError(/Supported: quick, standard/);
  });

  it("leaves track undefined when flag not provided", () => {
    expect(parseArgs(["init"]).track).toBeUndefined();
  });
});
