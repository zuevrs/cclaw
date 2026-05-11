#!/usr/bin/env node
// Smoke test: init -> sync -> upgrade -> sync -> uninstall must leave the
// project clean. Verifies the grouped layout: state/, hooks/, flows/*, lib/*.
//
// v8.17 generalisation:
//  - The expected list of `.cclaw/lib/skills/*.md` files is derived from
//    `AUTO_TRIGGER_SKILLS` (imported from the built `dist/`), not
//    hardcoded here. Any future thematic merge / split / rename ripples
//    through automatically — the next slug authoring just edits
//    `src/content/skills.ts` and runs `npm run smoke:runtime`.
//  - A new orphan-cleanup smoke check plants a stale `.md` file in the
//    install's skills dir, runs `cclaw sync`, and asserts the orphan
//    was removed. Catches install-layer regressions where the v8.17
//    `cleanupOrphanSkills` step is accidentally bypassed.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const { AUTO_TRIGGER_SKILLS } = await import(
  new URL("../dist/content/skills.js", import.meta.url).href
);
const EXPECTED_SKILL_FILES = [
  ...AUTO_TRIGGER_SKILLS.map((s) => s.fileName),
  "cclaw-meta.md"
].sort();

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
  // v8.17: derive the expected list from `AUTO_TRIGGER_SKILLS` so future
  // thematic merges / splits don't require touching this script. Assert
  // the directory contains EXACTLY that set (no orphans, nothing missing).
  for (const skill of EXPECTED_SKILL_FILES) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "skills", skill))) {
      throw new Error(`smoke check failed: skill ${skill} missing after init`);
    }
  }
  const { readdirSync } = await import("node:fs");
  const skillsOnDisk = readdirSync(join(tempDir, ".cclaw", "lib", "skills"))
    .filter((name) => name.endsWith(".md"))
    .sort();
  for (const onDisk of skillsOnDisk) {
    if (!EXPECTED_SKILL_FILES.includes(onDisk)) {
      throw new Error(`smoke check failed: unexpected skill file ${onDisk} after init — not in AUTO_TRIGGER_SKILLS ∪ {cclaw-meta.md}`);
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
  // v8.17: orphan-cleanup smoke check. Plant a stale .md file in the
  // skills dir, run `cclaw sync`, and assert that the orphan was
  // removed and that the install.ts cleanup step emitted at least one
  // `Removed orphan skill` line on stdout.
  const orphanPath = join(tempDir, ".cclaw", "lib", "skills", "v816-retired-fixture.md");
  writeFileSync(orphanPath, "---\nname: v816-retired-fixture\n---\nsmoke fixture\n", "utf8");
  const syncOut = execFileSync("node", [cli, "sync"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] });
  if (existsSync(orphanPath)) {
    throw new Error("smoke check failed: v8.17 orphan-cleanup did not remove .cclaw/lib/skills/v816-retired-fixture.md after sync");
  }
  const syncStdout = String(syncOut);
  if (!syncStdout.includes("Removed orphan skill") || !syncStdout.includes("v816-retired-fixture.md")) {
    throw new Error(`smoke check failed: v8.17 orphan-cleanup did not print "Removed orphan skill — v816-retired-fixture.md" on sync; got:\n${syncStdout}`);
  }
  if (!syncStdout.includes("Cleaned orphan skills")) {
    throw new Error(`smoke check failed: v8.17 orphan-cleanup did not print summary "Cleaned orphan skills" on sync; got:\n${syncStdout}`);
  }
  // v8.17: --skip-orphan-cleanup escape hatch. Plant another orphan,
  // run sync with the flag, assert the orphan survives + the warning
  // line shows up.
  const orphanSkipPath = join(tempDir, ".cclaw", "lib", "skills", "v816-skip-fixture.md");
  writeFileSync(orphanSkipPath, "---\nname: v816-skip-fixture\n---\nskip-flag fixture\n", "utf8");
  const skipOut = execFileSync(
    "node",
    [cli, "sync", "--skip-orphan-cleanup"],
    { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (!existsSync(orphanSkipPath)) {
    throw new Error("smoke check failed: --skip-orphan-cleanup should preserve orphan .md files but v816-skip-fixture.md was removed");
  }
  if (!String(skipOut).includes("Skipped orphan cleanup")) {
    throw new Error(`smoke check failed: --skip-orphan-cleanup did not print warning; got:\n${String(skipOut)}`);
  }
  // Clean up the skip-flag fixture so the next sync/uninstall passes are clean.
  rmSync(orphanSkipPath, { force: true });
  // Re-run sync to assert idempotency: zero orphan output on a clean install.
  const idempotentOut = String(
    execFileSync("node", [cli, "sync"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] })
  );
  if (idempotentOut.includes("Removed orphan skill") || idempotentOut.includes("Cleaned orphan skills")) {
    throw new Error(`smoke check failed: v8.17 orphan-cleanup should be idempotent (zero orphan events on a clean install); got:\n${idempotentOut}`);
  }
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
