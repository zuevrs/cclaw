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

function mkContext(cwd: string): { cwd: string; stdout: any; stderr: any; out: CapturingStream; err: CapturingStream } {
  const out = new CapturingStream();
  const err = new CapturingStream();
  return { cwd, stdout: out, stderr: err, out, err };
}

describe("cli", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("prints version (no banner) for `cclaw version`", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["version"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data.trim()).toBe(CCLAW_VERSION);
    expect(ctx.out.data).not.toMatch(/██████/);
  });

  it("prints help (with banner + version + tagline) when no command provided", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli([], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).toContain("Flow control");
    expect(ctx.out.data).toContain("harness-first flow toolkit");
  });

  it("rejects flow CLI commands as a v8 design choice", async () => {
    const ctx = mkContext("/tmp");
    const planCode = await runCli(["plan"], ctx);
    expect(planCode).toBe(2);
    expect(ctx.err.data).toContain("not a CLI command in v8");
  });

  it("init installs runtime, prints welcome + progress + summary", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["init"], ctx);
    expect(code).toBe(0);
    const cc = await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8");
    expect(cc).toContain("/cc");
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).toContain("Welcome to cclaw");
    expect(ctx.out.data).toContain("✓ Wrote specialists");
    expect(ctx.out.data).toContain("Installed");
    expect(ctx.out.data).toContain("Harnesses: cursor");
  });

  it("sync on an already-installed project skips welcome but shows progress + summary", async () => {
    project = await createTempProject();
    await runCli(["init"], mkContext(project));
    const ctx = mkContext(project);
    const code = await runCli(["sync"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(ctx.out.data).not.toContain("Welcome to cclaw");
    expect(ctx.out.data).toContain("✓ Wired harnesses");
    expect(ctx.out.data).toContain("Installed");
  });

  it("rejects unknown harness in --harness=", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    await expect(runCli(["init", "--harness=bogus"], ctx)).rejects.toThrow(/Unknown harnesses/);
  });

  it("uninstall reports which harnesses were removed", async () => {
    project = await createTempProject();
    await runCli(["init"], mkContext(project));
    const ctx = mkContext(project);
    const code = await runCli(["uninstall"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("uninstall complete");
    expect(ctx.out.data).toContain("cursor");
  });
});
