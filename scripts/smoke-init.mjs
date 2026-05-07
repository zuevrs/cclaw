#!/usr/bin/env node
// Smoke test: init -> sync -> upgrade -> sync -> uninstall must leave the
// project clean. Verifies that init writes the v8 cursor command file and
// that uninstall removes both .cclaw and the harness slash command.
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "cclaw-smoke-"));

try {
  const cli = join(process.cwd(), "dist/cli.js");
  execFileSync("node", [cli, "init"], { cwd: tempDir, stdio: "pipe" });
  if (!existsSync(join(tempDir, ".cclaw"))) {
    throw new Error("smoke check failed: .cclaw missing after init");
  }
  if (!existsSync(join(tempDir, ".cursor", "commands", "cc.md"))) {
    throw new Error("smoke check failed: cursor /cc command missing after init");
  }
  for (const tpl of ["plan.md", "build.md", "review.md", "ship.md", "decisions.md", "learnings.md", "manifest.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "templates", tpl))) {
      throw new Error(`smoke check failed: template ${tpl} missing after init`);
    }
  }
  for (const skill of ["plan-authoring.md", "ac-traceability.md", "refinement.md", "parallel-build.md", "security-review.md", "review-loop.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "skills", skill))) {
      throw new Error(`smoke check failed: skill ${skill} missing after init`);
    }
  }
  if (!existsSync(join(tempDir, "AGENTS.md"))) {
    throw new Error("smoke check failed: AGENTS.md routing block missing after init");
  }
  execFileSync("node", [cli, "sync"], { cwd: tempDir, stdio: "pipe" });
  execFileSync("node", [cli, "upgrade"], { cwd: tempDir, stdio: "pipe" });
  execFileSync("node", [cli, "sync"], { cwd: tempDir, stdio: "pipe" });
  execFileSync("node", [cli, "uninstall"], { cwd: tempDir, stdio: "pipe" });
  if (existsSync(join(tempDir, ".cclaw"))) {
    throw new Error("smoke check failed: .cclaw still exists after uninstall");
  }
  if (existsSync(join(tempDir, ".cursor", "commands", "cc.md"))) {
    throw new Error("smoke check failed: cursor /cc command still exists after uninstall");
  }
  process.stdout.write(`[smoke] success in ${tempDir}\n`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
