import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli.js";
import { CCLAW_VERSION } from "../../src/constants.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

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

describe("cli (v8.29 TUI-first surface)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("prints version when --version flag is passed (no banner)", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["--version"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data.trim()).toBe(CCLAW_VERSION);
    expect(ctx.out.data).not.toMatch(/██████/);
  });

  it("prints version when -v flag is passed", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["-v"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data.trim()).toBe(CCLAW_VERSION);
  });

  it("prints help (with banner + version + tagline) when --help flag is passed", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["--help"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).toContain("harness-first flow toolkit");
    expect(ctx.out.data).toContain("TUI menu");
    expect(ctx.out.data).toContain("--non-interactive");
  });

  it("prints help when -h flag is passed", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["-h"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
  });

  it("no-arg invocation without a TTY errors with the --non-interactive escape hatch hint", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli([], ctx);
    expect(code).toBe(2);
    expect(ctx.err.data).toContain("needs an interactive terminal");
    expect(ctx.err.data).toContain("--non-interactive");
  });

  it("--non-interactive with no subcommand errors", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["--non-interactive"], ctx);
    expect(code).toBe(2);
    expect(ctx.err.data).toContain("--non-interactive requires a subcommand");
  });

  it("bare `cclaw init` (no --non-interactive) errors and points at the TUI / escape hatch", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["init"], ctx);
    expect(code).toBe(2);
    expect(ctx.err.data).toContain("no longer a bare subcommand");
    expect(ctx.err.data).toContain("--non-interactive init");
  });

  it("bare `cclaw sync` errors with the same message", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["sync"], ctx);
    expect(code).toBe(2);
    expect(ctx.err.data).toContain("no longer a bare subcommand");
    expect(ctx.err.data).toContain("--non-interactive sync");
  });

  it("bare `cclaw knowledge` errors with the same message", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["knowledge"], ctx);
    expect(code).toBe(2);
    expect(ctx.err.data).toContain("no longer a bare subcommand");
  });

  it("rejects flow CLI commands (plan / status / ship / migrate / build / review)", async () => {
    for (const cmd of ["plan", "status", "ship", "migrate", "build", "review"]) {
      const ctx = mkContext("/tmp");
      const code = await runCli([cmd], ctx);
      expect(code).toBe(2);
      expect(ctx.err.data).toContain("not a CLI command in v8");
    }
  });

  it("--non-interactive install creates the runtime + prints welcome + progress + summary", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "install"], ctx);
    expect(code).toBe(0);
    const cc = await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8");
    expect(cc).toContain("/cc");
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).toContain("Welcome to cclaw");
    expect(ctx.out.data).toContain("✓ Wrote specialists");
    expect(ctx.out.data).toContain("Installed");
    expect(ctx.out.data).toContain("Harnesses: cursor");
  });

  it("--non-interactive init is preserved as a backwards-compatible alias for install", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "init"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("install complete");
    expect(await fs.access(path.join(project, ".cursor", "commands", "cc.md"))).toBeUndefined();
  });

  it("--non-interactive can appear before OR after the subcommand", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["install", "--non-interactive"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("install complete");
  });

  it("--non-interactive sync on an already-installed project exits 1 with v8.37 migration message", async () => {
    // v8.37 — `--non-interactive sync` was collapsed into `install` because
    // both ultimately called the same idempotent installer + orphan-cleanup
    // path under the hood. The migration message names the new command so a
    // CI script author can self-correct without reading the CHANGELOG. The
    // pre-v8.37 behaviour (re-run the installer silently) is preserved via
    // `--non-interactive install`, which is idempotent on an already-installed
    // project. See `tests/unit/cli-non-interactive.test.ts` for the full
    // v8.37 surface matrix.
    project = await createTempProject();
    await runCli(["--non-interactive", "install"], mkContext(project));
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "sync"], ctx);
    expect(code).toBe(1);
    expect(ctx.err.data).toMatch(/sync.*renamed/);
    expect(ctx.err.data).toContain("cclaw --non-interactive install");
  });

  it("--non-interactive install on an already-installed project is idempotent (the post-v8.37 path that replaces sync)", async () => {
    // Repeat-install is the new way to do what `--non-interactive sync` did
    // before v8.37. The first install is the welcome-bearing one; the second
    // is silent on Welcome but still shows progress + summary because
    // install is idempotent.
    project = await createTempProject();
    await runCli(["--non-interactive", "install"], mkContext(project));
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "install"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).not.toContain("Welcome to cclaw");
    expect(ctx.out.data).toContain("Installed");
  });

  it("rejects unknown harness in --harness=", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    await expect(
      runCli(["--non-interactive", "install", "--harness=bogus"], ctx)
    ).rejects.toThrow(/Unknown harnesses/);
  });

  it("--non-interactive uninstall reports which harnesses were removed", async () => {
    project = await createTempProject();
    await runCli(["--non-interactive", "install"], mkContext(project));
    const ctx = mkContext(project);
    const code = await runCli(["--non-interactive", "uninstall"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("uninstall complete");
    expect(ctx.out.data).toContain("cursor");
  });
});
