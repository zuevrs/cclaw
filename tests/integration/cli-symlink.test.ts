import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CCLAW_VERSION } from "../../src/constants.js";

// Regression for the silent no-op bug shipped in 8.0.0 / 8.1.0 / 8.1.1:
//
//   npx cclaw-cli init   # exits 0, prints nothing, creates nothing
//
// Root cause was the naive entry-point check
// `import.meta.url === `file://${process.argv[1]}``, which fails any time
// argv[1] is a symlink (npx, npm install -g) or a path that crosses a
// symlink-bearing directory like macOS `/tmp` -> `/private/tmp`. The fix
// resolves both sides through realpath. These tests exercise the *built*
// CLI exactly the way npx invokes it.

// Always invoke through `node <linkPath>` rather than `<linkPath>` directly:
//
// - On POSIX, executing the symlink relies on shebang. That works, but it
//   also works when invoked through `node`. Both routes produce the same
//   argv[1] mismatch we need to test.
// - On Windows, .js symlinks cannot be exec'd directly (ENOENT from
//   execFileSync). npx itself ships a .cmd wrapper that launches `node`
//   internally, so going through `node` mirrors the real npx surface.
//
// What matters for the regression: argv[1] is the symlink path, and
// import.meta.url is the realpath of dist/cli.js. The pre-fix
// isMain check returned false in this shape and silently exited 0.

describe("cli (real binary, real symlink)", () => {
  const distCli = path.resolve(process.cwd(), "dist/cli.js");
  let tempDir: string;
  let linkPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-cli-symlink-"));
    linkPath = path.join(tempDir, "cclaw-link");
    try {
      await fs.symlink(distCli, linkPath);
    } catch (err) {
      // Windows requires admin or developer-mode for symlink(); fall back to
      // a hard link, which still exposes the same realpath() mismatch.
      if ((err as NodeJS.ErrnoException).code === "EPERM" || (err as NodeJS.ErrnoException).code === "EACCES") {
        await fs.link(distCli, linkPath);
      } else {
        throw err;
      }
    }
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("prints version when invoked via a symlink (npx layout)", () => {
    const out = execFileSync(process.execPath, [linkPath, "version"], { encoding: "utf8" });
    expect(out.trim()).toBe(CCLAW_VERSION);
  });

  it("prints help when invoked via a symlink (smoke for direct-execution path)", () => {
    const out = execFileSync(process.execPath, [linkPath, "help"], { encoding: "utf8" });
    expect(out).toContain(`cclaw v${CCLAW_VERSION}`);
    expect(out).toContain("Harness selection:");
  });

  it("init through a symlink actually creates the runtime (not a silent exit-0 no-op)", async () => {
    await fs.mkdir(path.join(tempDir, ".cursor"), { recursive: true });
    execFileSync(process.execPath, [linkPath, "init"], { cwd: tempDir, stdio: "pipe" });
    const stat = await fs.stat(path.join(tempDir, ".cclaw"));
    expect(stat.isDirectory()).toBe(true);
    const cc = await fs.readFile(path.join(tempDir, ".cursor", "commands", "cc.md"), "utf8");
    expect(cc).toContain("/cc");
  });
});
