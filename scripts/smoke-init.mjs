#!/usr/bin/env node
// Smoke test: init -> sync -> upgrade -> sync -> uninstall must leave the
// project clean. Verifies the grouped layout: state/, hooks/, flows/*, lib/*.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "cclaw-smoke-"));

try {
  const cli = join(process.cwd(), "dist/cli.js");

  // Verify auto-detect error path: no harness markers + no --harness flag should fail.
  let detected = false;
  try {
    execFileSync("node", [cli, "init"], { cwd: tempDir, stdio: "pipe" });
  } catch (err) {
    detected = String(err?.stderr ?? err?.message ?? "").includes("No harness detected");
  }
  if (!detected) {
    throw new Error("smoke check failed: init should error when no harness marker is present and no --harness flag is given");
  }

  // Seed a Cursor marker; auto-detect should now pick it up.
  mkdirSync(join(tempDir, ".cursor"), { recursive: true });
  execFileSync("node", [cli, "init"], { cwd: tempDir, stdio: "pipe" });
  if (!existsSync(join(tempDir, ".cclaw"))) {
    throw new Error("smoke check failed: .cclaw missing after init");
  }
  if (!existsSync(join(tempDir, ".cursor", "commands", "cc.md"))) {
    throw new Error("smoke check failed: cursor /cc command missing after init");
  }
  for (const dir of ["state", "hooks", "flows"]) {
    if (!existsSync(join(tempDir, ".cclaw", dir))) {
      throw new Error(`smoke check failed: top-level .cclaw/${dir}/ missing after init`);
    }
  }
  for (const dir of ["shipped", "cancelled"]) {
    if (!existsSync(join(tempDir, ".cclaw", "flows", dir))) {
      throw new Error(`smoke check failed: .cclaw/flows/${dir}/ missing after init`);
    }
  }
  for (const stale of ["plans", "builds", "reviews", "ships", "decisions", "learnings"]) {
    if (existsSync(join(tempDir, ".cclaw", "flows", stale))) {
      throw new Error(`smoke check failed: stale per-stage flow dir .cclaw/flows/${stale}/ should not exist after init`);
    }
  }
  for (const dir of ["agents", "skills", "templates", "runbooks", "patterns", "research", "recovery", "examples"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", dir))) {
      throw new Error(`smoke check failed: .cclaw/lib/${dir}/ missing after init`);
    }
  }
  // v8.12: artefact templates ship `manifest.md` for legacy-artifacts: true
  // path (template is preserved for back-compat) but the runtime no longer
  // writes `manifest.md` by default — `ship.md` carries the manifest data
  // in its frontmatter.
  for (const tpl of ["plan.md", "build.md", "review.md", "ship.md", "decisions.md", "learnings.md", "manifest.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "templates", tpl))) {
      throw new Error(`smoke check failed: template ${tpl} missing after init`);
    }
  }
  for (const skill of ["plan-authoring.md", "ac-traceability.md", "refinement.md", "parallel-build.md", "security-review.md", "review-loop.md", "commit-message-quality.md", "ac-quality.md", "refactor-safety.md", "breaking-changes.md", "cclaw-meta.md", "tdd-cycle.md", "conversation-language.md", "anti-slop.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "skills", skill))) {
      throw new Error(`smoke check failed: skill ${skill} missing after init`);
    }
  }
  for (const runbook of ["plan.md", "build.md", "review.md", "ship.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "runbooks", runbook))) {
      throw new Error(`smoke check failed: runbook ${runbook} missing after init`);
    }
  }
  // v8.12 trimmed reference patterns 8 → 2.
  for (const pattern of ["auth-flow.md", "security-hardening.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "patterns", pattern))) {
      throw new Error(`smoke check failed: pattern ${pattern} missing after init`);
    }
  }
  for (const stalePattern of ["api-endpoint.md", "schema-migration.md", "ui-component.md", "perf-fix.md", "refactor.md", "doc-rewrite.md"]) {
    if (existsSync(join(tempDir, ".cclaw", "lib", "patterns", stalePattern))) {
      throw new Error(`smoke check failed: deleted pattern ${stalePattern} should not be present after v8.12`);
    }
  }
  // v8.12 deleted all 5 recovery, 3 research, 8 examples libraries.
  // Each directory now ships only its index.md note explaining the cleanup.
  for (const dir of ["recovery", "research", "examples"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", dir, "index.md"))) {
      throw new Error(`smoke check failed: ${dir}/index.md missing after init`);
    }
  }
  if (!existsSync(join(tempDir, ".cclaw", "lib", "antipatterns.md"))) {
    throw new Error("smoke check failed: lib/antipatterns.md missing after init");
  }
  if (!existsSync(join(tempDir, ".cclaw", "lib", "decision-protocol.md"))) {
    throw new Error("smoke check failed: lib/decision-protocol.md missing after init");
  }
  if (existsSync(join(tempDir, "AGENTS.md"))) {
    throw new Error("smoke check failed: AGENTS.md should NOT be created by cclaw init");
  }
  if (existsSync(join(tempDir, "CLAUDE.md"))) {
    throw new Error("smoke check failed: CLAUDE.md should NOT be created by cclaw init");
  }
  if (!existsSync(join(tempDir, ".gitignore"))) {
    throw new Error("smoke check failed: .gitignore not created by init");
  }
  const gitignoreBody = readFileSync(join(tempDir, ".gitignore"), "utf8");
  for (const expected of [".cclaw/state/", ".cclaw/worktrees/"]) {
    if (!gitignoreBody.includes(expected)) {
      throw new Error(`smoke check failed: .gitignore missing pattern ${expected}`);
    }
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
