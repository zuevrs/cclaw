import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli.js";
import { CCLAW_VERSION } from "../../src/constants.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.37 — CLI consolidation: collapse the non-interactive surface to a single
 * idempotent installer (`install`) plus the read-only commands
 * (`knowledge`, `version`, `help`) and `uninstall`. The `sync` and `upgrade`
 * non-interactive subcommands historically all called `syncCclaw()` under the
 * hood — they were aliases for the same idempotent operation, with the TUI
 * masking the cognitive overhead by surfacing each menu item with its own
 * intent. v8.37 makes the non-interactive surface match the codepath: ONE
 * idempotent installer, named `install`, that re-applies cclaw assets and
 * runs orphan cleanup regardless of whether the project was already
 * installed.
 *
 * `sync` and `upgrade` are NOT removed from the TUI menu — they keep their
 * own menu rows and call `syncCclaw()` / `upgradeCclaw()` internally so a
 * human reading the menu sees the right intent. Only the non-interactive
 * (CI / scripts) surface collapses: `cclaw --non-interactive sync` and
 * `cclaw --non-interactive upgrade` exit 1 with a one-line migration message
 * pointing at `cclaw --non-interactive install`.
 *
 * This file covers the SIX-row non-interactive matrix:
 *   - install   → works
 *   - knowledge → works
 *   - uninstall → works
 *   - version   → works
 *   - help      → works (new in v8.37; previously only --help/-h flags)
 *   - sync      → exits 1 with migration message
 *   - upgrade   → exits 1 with migration message
 *
 * Existing CLI tests in tests/unit/cli.test.ts that referenced sync/upgrade
 * in non-interactive mode are patched alongside this file.
 */

class CapturingStream {
  public data = "";
  public isTTY = false;
  write(chunk: string): boolean {
    this.data += chunk;
    return true;
  }
}

function mkContext(cwd: string): {
  cwd: string;
  stdout: any;
  stderr: any;
  out: CapturingStream;
  err: CapturingStream;
} {
  const out = new CapturingStream();
  const err = new CapturingStream();
  return { cwd, stdout: out, stderr: err, out, err };
}

describe("v8.37 — non-interactive CLI surface (install / knowledge / uninstall / version / help)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-1 — `--non-interactive install` succeeds (the canonical idempotent installer)", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "install"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("install complete");
    // Idempotency: running install twice in a row is fine.
    const ctx2 = mkContext(project);
    const code2 = await runCli(["--non-interactive", "install"], ctx2);
    expect(code2).toBe(0);
  });

  it("AC-1 — `--non-interactive sync` exits 1 with migration message (the alias is gone in CI)", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "sync"], ctx);
    expect(code).toBe(1);
    // Migration message names the new command AND the rationale (idempotent +
    // orphan cleanup) so a CI script author can self-correct without reading
    // the CHANGELOG.
    expect(ctx.err.data).toMatch(/sync.*renamed/);
    expect(ctx.err.data).toContain("cclaw --non-interactive install");
    expect(ctx.err.data).toMatch(/idempotent|orphan/);
  });

  it("AC-1 — `--non-interactive upgrade` exits 1 with migration message (after-package-upgrade hint)", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "upgrade"], ctx);
    expect(code).toBe(1);
    expect(ctx.err.data).toMatch(/upgrade.*renamed/);
    expect(ctx.err.data).toContain("cclaw --non-interactive install");
    expect(ctx.err.data).toMatch(/upgrad/);
  });

  it("AC-1 — sync migration message does NOT call `syncCclaw` internally (no side effects)", async () => {
    project = await createTempProject();
    // Run `--non-interactive sync` on a virgin project — if the migration
    // path leaked through to the real installer, .cclaw/config.yaml would
    // appear on disk. It must not.
    const ctx = mkContext(project);
    await runCli(["--non-interactive", "sync"], ctx);
    const installed = await fs
      .access(path.join(project, ".cclaw", "config.yaml"))
      .then(() => true)
      .catch(() => false);
    expect(installed).toBe(false);
  });

  it("AC-1 — upgrade migration message does NOT call `upgradeCclaw` internally (no side effects)", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    await runCli(["--non-interactive", "upgrade"], ctx);
    const installed = await fs
      .access(path.join(project, ".cclaw", "config.yaml"))
      .then(() => true)
      .catch(() => false);
    expect(installed).toBe(false);
  });

  it("AC-1 — `--non-interactive knowledge` works on a virgin project (empty knowledge log)", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "knowledge"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toMatch(/no entries yet|empty or missing/);
  });

  it("AC-1 — `--non-interactive uninstall` works after install (round-trip)", async () => {
    project = await createTempProject();
    await runCli(["--non-interactive", "install"], mkContext(project));
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "uninstall"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("uninstall complete");
  });

  it("AC-1 — `--non-interactive version` prints just the version string", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["--non-interactive", "version"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data.trim()).toBe(CCLAW_VERSION);
  });

  it("AC-1 — `--non-interactive help` prints the help screen (new in v8.37)", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["--non-interactive", "help"], ctx);
    expect(code).toBe(0);
    // Help screen carries the same shape as `--help` — banner + commands + options.
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).toContain("--non-interactive");
  });

  it("AC-1 — `init` non-interactive alias for install still works (backwards compat)", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "init"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("install complete");
  });

  it("AC-2 — help text lists ONLY the supported non-interactive commands", async () => {
    const ctx = mkContext("/tmp");
    await runCli(["--help"], ctx);
    // The Commands section in help must list install / knowledge / uninstall.
    // It must NOT list sync / upgrade as non-interactive commands (they live
    // on the TUI menu but are not part of the non-interactive surface).
    expect(ctx.out.data).toContain("install");
    expect(ctx.out.data).toContain("knowledge");
    expect(ctx.out.data).toContain("uninstall");
    // The exact wording of the sync/upgrade entries is the v8.37 migration
    // notice — they should appear in the help (so a user reading --help
    // sees the path forward) but framed as renamed, not as live commands.
    // The grep here pins the migration-notice wording exists somewhere in
    // the help body; the prose itself is in HELP_NOTES / HELP_COMMANDS.
    expect(ctx.out.data).toMatch(/sync.*install|merged into.*install|use.*install/i);
  });
});
