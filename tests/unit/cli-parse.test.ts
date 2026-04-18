import { describe, expect, it } from "vitest";
import { parseArgs, parseHarnesses, parseTrack, usage } from "../../src/cli.js";

describe("cli parser", () => {
  it("parses init with harness list", () => {
    const parsed = parseArgs(["init", "--harnesses=claude,cursor"]);
    expect(parsed.command).toBe("init");
    expect(parsed.harnesses).toEqual(["claude", "cursor"]);
  });

  it("parses init dry-run and interactive toggles", () => {
    const parsed = parseArgs(["init", "--dry-run", "--interactive"]);
    expect(parsed.command).toBe("init");
    expect(parsed.dryRun).toBe(true);
    expect(parsed.interactive).toBe(true);
  });

  it("parses init no-interactive toggle", () => {
    const parsed = parseArgs(["init", "--no-interactive"]);
    expect(parsed.interactive).toBe(false);
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

  it("parses archive retro override flags", () => {
    const parsed = parseArgs(["archive", "--skip-retro", "--retro-reason=manual override"]);
    expect(parsed.command).toBe("archive");
    expect(parsed.archiveSkipRetro).toBe(true);
    expect(parsed.archiveSkipRetroReason).toBe("manual override");
  });

  it("parses doctor reconcile gates flag", () => {
    const parsed = parseArgs(["doctor", "--reconcile-gates"]);
    expect(parsed.command).toBe("doctor");
    expect(parsed.reconcileGates).toBe(true);
  });

  it("parses doctor output flags", () => {
    const parsed = parseArgs(["doctor", "--json", "--explain", "--quiet", "--only=error,hook:"]);
    expect(parsed.command).toBe("doctor");
    expect(parsed.doctorJson).toBe(true);
    expect(parsed.doctorExplain).toBe(true);
    expect(parsed.doctorQuiet).toBe(true);
    expect(parsed.doctorOnly).toEqual(["error", "hook:"]);
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

  it("usage message documents the public user surface", () => {
    const text = usage();
    for (const cmd of ["init", "upgrade", "uninstall", "eval"]) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain("--help");
    expect(text).toContain("-h");
    expect(text).toContain("--version");
    expect(text).toContain("-v");
    expect(text).toContain("--harnesses");
    expect(text).toContain("--no-interactive");
  });

  it("usage message keeps operational surface out of the public help", () => {
    const text = usage();
    for (const hiddenCmd of ["sync", "doctor", "archive"]) {
      expect(text).not.toContain(`\n  ${hiddenCmd} `);
    }
    for (const hiddenFlag of [
      "--profile",
      "--track",
      "--interactive",
      "--reconcile-gates",
      "--skip-retro",
      "--retro-reason"
    ]) {
      expect(text).not.toContain(hiddenFlag);
    }
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
    expect(() => parseTrack("turbo")).toThrowError(/Supported: quick, medium, standard/);
  });

  it("leaves track undefined when flag not provided", () => {
    expect(parseArgs(["init"]).track).toBeUndefined();
  });

  it("accepts legacy --profile flag without failing (dropped in v0.31, silently ignored)", () => {
    const parsed = parseArgs(["init", "--profile=full"]);
    expect(parsed.command).toBe("init");
    expect((parsed as unknown as { profile?: unknown }).profile).toBeUndefined();
  });

});
