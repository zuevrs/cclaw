import { existsSync, mkdtempSync } from "node:fs";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "cclaw-smoke-"));

try {
  execFileSync("node", [join(process.cwd(), "dist/cli.js"), "init"], {
    cwd: tempDir,
    stdio: "pipe"
  });
  execFileSync("node", [join(process.cwd(), "dist/cli.js"), "sync"], {
    cwd: tempDir,
    stdio: "pipe"
  });
  execFileSync("node", [join(process.cwd(), "dist/cli.js"), "upgrade"], {
    cwd: tempDir,
    stdio: "pipe"
  });
  execFileSync("node", [join(process.cwd(), "dist/cli.js"), "sync"], {
    cwd: tempDir,
    stdio: "pipe"
  });
  execFileSync("node", [join(process.cwd(), "dist/cli.js"), "uninstall"], {
    cwd: tempDir,
    stdio: "pipe"
  });
  if (existsSync(join(tempDir, ".cclaw"))) {
    throw new Error("smoke check failed: .cclaw still exists after uninstall");
  }
  if (existsSync(join(tempDir, ".claude/commands/cc-brainstorm.md"))) {
    throw new Error("smoke check failed: generated shim still exists after uninstall");
  }
  process.stdout.write(`[smoke] success in ${tempDir}\n`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
