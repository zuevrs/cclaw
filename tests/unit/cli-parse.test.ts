import { describe, expect, it } from "vitest";
import { parseArchiveDisposition, parseArgs, parseHarnessSelectionAnswer, parseHarnesses, parseTrack, usage } from "../../src/cli.js";
import { createHarnessChecklistState, updateHarnessChecklistState } from "../../src/harness-selection.js";

describe("cli parser", () => {
  it("parses init with harness list", () => {
    const parsed = parseArgs(["init", "--harnesses=claude,cursor"]);
    expect(parsed.command).toBe("init");
    expect(parsed.harnesses).toEqual(["claude", "cursor"]);
  });

  it("parses sync with harness list", () => {
    const parsed = parseArgs(["sync", "--harnesses=claude,cursor"]);
    expect(parsed.command).toBe("sync");
    expect(parsed.harnesses).toEqual(["claude", "cursor"]);
  });

  it("parses sync interactive flag", () => {
    const parsed = parseArgs(["sync", "--interactive"]);
    expect(parsed.command).toBe("sync");
    expect(parsed.interactive).toBe(true);
  });

  it("parses sync --check flag", () => {
    const parsed = parseArgs(["sync", "--check"]);
    expect(parsed.command).toBe("sync");
    expect(parsed.syncCheck).toBe(true);
  });

  it("rejects empty harness lists", () => {
    expect(() => parseHarnesses("")).toThrowError(/Select at least one harness/);
    expect(() => parseArgs(["sync", "--harnesses="])).toThrowError(/Select at least one harness/);
  });

  it("parses guided harness selection answers without zero-harness option", () => {
    expect(parseHarnessSelectionAnswer("")).toEqual({ kind: "accept" });
    expect(parseHarnessSelectionAnswer("all")).toEqual({ kind: "all" });
    expect(parseHarnessSelectionAnswer("1,3")).toEqual({ kind: "toggle", indexes: [1, 3] });
    expect(parseHarnessSelectionAnswer("none")).toEqual({
      kind: "invalid",
      message: "Zero harnesses is not supported. Select at least one harness."
    });
    expect(parseHarnessSelectionAnswer("9")).toEqual({
      kind: "invalid",
      message: "Invalid selection. Use numbers 1-4, comma-separated."
    });
  });


  it("updates native checklist state with movement, toggles, select-all, confirm, and cancel", () => {
    let state = createHarnessChecklistState(["claude"], ["claude", "cursor", "codex"]);
    expect(state.selected).toEqual(["claude"]);
    expect(state.cursor).toBe(0);

    state = updateHarnessChecklistState(state, "\u001b[B").state;
    expect(state.cursor).toBe(1);

    state = updateHarnessChecklistState(state, " ").state;
    expect(state.selected).toEqual(["claude", "cursor"]);

    state = updateHarnessChecklistState(state, "k").state;
    expect(state.cursor).toBe(0);

    state = updateHarnessChecklistState(state, " ").state;
    expect(state.selected).toEqual(["cursor"]);

    state = updateHarnessChecklistState(state, "j").state;
    expect(state.cursor).toBe(1);
    state = updateHarnessChecklistState(state, " ").state;
    expect(state.selected).toEqual([]);
    const emptyConfirm = updateHarnessChecklistState(state, "\r");
    expect(emptyConfirm.outcome).toBeUndefined();
    expect(emptyConfirm.state.message).toBe("Select at least one harness.");

    const all = updateHarnessChecklistState(emptyConfirm.state, "a");
    expect(all.state.selected).toEqual(["claude", "cursor", "codex"]);
    expect(updateHarnessChecklistState(all.state, "\r").outcome).toBe("confirm");
    expect(updateHarnessChecklistState(all.state, "\u001b").outcome).toBe("cancel");
    expect(updateHarnessChecklistState(all.state, "\u0003").outcome).toBe("cancel");
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

  it("parses archive disposition flags", () => {
    const parsed = parseArgs(["archive", "--disposition=cancelled", "--reason=deprioritized"]);
    expect(parsed.command).toBe("archive");
    expect(parsed.archiveDisposition).toBe("cancelled");
    expect(parsed.archiveDispositionReason).toBe("deprioritized");
    expect(parseArchiveDisposition("abandoned")).toBe("abandoned");
    expect(() => parseArchiveDisposition("done")).toThrowError(/Unknown archive disposition/);
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
  });

  it("usage message documents the public user surface", () => {
    const text = usage();
    for (const cmd of ["init", "sync", "archive", "upgrade", "uninstall"]) {
      expect(text).toContain(cmd);
    }
    expect(text).toContain("--help");
    expect(text).toContain("-h");
    expect(text).toContain("--version");
    expect(text).toContain("-v");
    expect(text).toContain("--harnesses");
    expect(text).toContain("--check");
    expect(text).toContain("--no-interactive");
    expect(text).toContain("--disposition");
    expect(text).toContain("--reason");
    expect(text).toContain("README.md and generated .cclaw/skills/*.md");
  });

  it("usage message keeps internal maintainer switches out of public help", () => {
    const text = usage();
    for (const hiddenFlag of [
      "--profile",
      "--track"
    ]) {
      expect(text).not.toContain(hiddenFlag);
    }
  });

  it("rejects command-specific flags on the wrong command", () => {
    expect(() => parseArgs(["archive", "--json"])).toThrowError(/not supported/);
    expect(() => parseArgs(["sync", "--dry-run"])).toThrowError(/not supported/);
    expect(() => parseArgs(["sync", "--track=quick"])).toThrowError(/not supported/);
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
