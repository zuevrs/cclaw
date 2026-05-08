import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { runCli } from "../../src/cli.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

class CapturingStream {
  public data = "";
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

  it("prints version", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli(["version"], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data.trim()).toBe("8.1.1");
  });

  it("prints help when no command provided", async () => {
    const ctx = mkContext("/tmp");
    const code = await runCli([], ctx);
    expect(code).toBe(0);
    expect(ctx.out.data).toContain("cclaw v8.1.1");
    expect(ctx.out.data).toContain("Flow control");
  });

  it("rejects flow CLI commands as a v8 design choice", async () => {
    const ctx = mkContext("/tmp");
    const planCode = await runCli(["plan"], ctx);
    expect(planCode).toBe(2);
    expect(ctx.err.data).toContain("not a CLI command in v8");
  });

  it("init installs runtime and exits 0", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    const code = await runCli(["init"], ctx);
    expect(code).toBe(0);
    const cc = await fs.readFile(path.join(project, ".cursor", "commands", "cc.md"), "utf8");
    expect(cc).toContain("/cc");
  });

  it("rejects unknown harness in --harness=", async () => {
    project = await createTempProject();
    const ctx = mkContext(project);
    await expect(runCli(["init", "--harness=bogus"], ctx)).rejects.toThrow(/Unknown harnesses/);
  });
});
