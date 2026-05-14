#!/usr/bin/env node
// Smoke test: init -> install -> install -> install -> uninstall must leave
// the project clean. Verifies the grouped layout: state/, hooks/, flows/*,
// lib/*.
//
// v8.17 generalisation:
//  - The expected list of `.cclaw/lib/skills/*.md` files is derived from
//    `AUTO_TRIGGER_SKILLS` (imported from the built `dist/`), not
//    hardcoded here. Any future thematic merge / split / rename ripples
//    through automatically — the next slug authoring just edits
//    `src/content/skills.ts` and runs `npm run smoke:runtime`.
//  - A new orphan-cleanup smoke check plants a stale `.md` file in the
//    install's skills dir, runs `cclaw --non-interactive install`, and
//    asserts the orphan was removed. Catches install-layer regressions
//    where the v8.17 `cleanupOrphanSkills` step is accidentally bypassed.
//
// v8.37 consolidation: `--non-interactive sync` and `--non-interactive
// upgrade` were collapsed into `--non-interactive install` (the
// underlying `syncCclaw()` / `upgradeCclaw()` calls were aliases for the
// same idempotent installer with orphan cleanup). The smoke script
// migrated to `install` — re-running `install` on an already-installed
// project does the same orphan-cleanup + reapply work the retired
// commands did, so the assertions below are unchanged in spirit.
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
    execFileSync("node", [cli, "--non-interactive", "init"], { cwd: tempDir, stdio: "pipe" });
  } catch (err) {
    detected = String(err?.stderr ?? err?.message ?? "").includes("No harness detected");
  }
  if (!detected) {
    throw new Error("smoke check failed: init should error when no harness marker is present and no --harness flag is given");
  }

  // Seed a Cursor marker; auto-detect should now pick it up.
  mkdirSync(join(tempDir, ".cursor"), { recursive: true });
  execFileSync("node", [cli, "--non-interactive", "init"], { cwd: tempDir, stdio: "pipe" });
  if (!existsSync(join(tempDir, ".cclaw"))) {
    throw new Error("smoke check failed: .cclaw missing after init");
  }
  if (!existsSync(join(tempDir, ".cursor", "commands", "cc.md"))) {
    throw new Error("smoke check failed: cursor /cc command missing after init");
  }
  for (const dir of ["state", "flows"]) {
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
  for (const dir of ["agents", "skills", "templates", "runbooks", "patterns", "research", "recovery"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", dir))) {
      throw new Error(`smoke check failed: .cclaw/lib/${dir}/ missing after init`);
    }
  }
  // v8.44 retired .cclaw/lib/examples/ — the directory should NOT exist on a fresh install.
  if (existsSync(join(tempDir, ".cclaw", "lib", "examples"))) {
    throw new Error("smoke check failed: .cclaw/lib/examples/ was retired in v8.44 but is still present after init");
  }
  // v8.44 added .cclaw/state/triage-audit.jsonl — the write-only audit log for
  // triage telemetry that used to live on TriageDecision (userOverrode,
  // autoExecuted, iterationOverride). Install touches the file empty so a
  // fresh project has a defined append target.
  if (!existsSync(join(tempDir, ".cclaw", "state", "triage-audit.jsonl"))) {
    throw new Error("smoke check failed: .cclaw/state/triage-audit.jsonl was added in v8.44 but is not present after init");
  }
  // v8.12: artefact templates ship `manifest.md` for legacy-artifacts: true
  // path (template is preserved for back-compat) but the runtime no longer
  // writes `manifest.md` by default — `ship.md` carries the manifest data
  // in its frontmatter.
  // v8.42 — `critic.md` template was added alongside the new adversarial
  // critic specialist. Hop 4.5 dispatches `critic` between `reviewer` and
  // `ship`; the template is the artifact's source-of-truth shape and
  // ships unconditionally (acMode-gated on dispatch, not install).
  for (const tpl of ["plan.md", "build.md", "review.md", "critic.md", "ship.md", "decisions.md", "learnings.md", "manifest.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "templates", tpl))) {
      throw new Error(`smoke check failed: template ${tpl} missing after init`);
    }
  }
  // v8.42 — assert the critic specialist's agent file is written too.
  // CORE_AGENTS now includes `critic` (6 total: design, ac-author,
  // reviewer, security-reviewer, critic, slice-builder).
  if (!existsSync(join(tempDir, ".cclaw", "lib", "agents", "critic.md"))) {
    throw new Error("smoke check failed: v8.42 critic.md agent file missing after init");
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
  // v8.12 deleted all 5 recovery and 3 research library entries; each
  // directory now ships only its `index.md` note. v8.44 removed
  // `examples/` outright (no agent code path ever read from it).
  for (const dir of ["recovery", "research"]) {
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
  // v8.49 - the auto-trigger sweep moved per-skill descriptions out of every
  // dispatched specialist prompt into a single central file
  // `.cclaw/lib/skills-index.md`. Install must write the file; uninstall must
  // remove it (covered by the .cclaw-tree wipe at the end of this script).
  if (!existsSync(join(tempDir, ".cclaw", "lib", "skills-index.md"))) {
    throw new Error("smoke check failed: v8.49 added lib/skills-index.md but it is missing after init");
  }
  const skillsIndexBody = readFileSync(
    join(tempDir, ".cclaw", "lib", "skills-index.md"),
    "utf8"
  );
  for (const skill of AUTO_TRIGGER_SKILLS) {
    if (!skillsIndexBody.includes("`" + skill.id + "`")) {
      throw new Error(
        `smoke check failed: v8.49 skills-index.md is missing the entry for skill \`${skill.id}\``
      );
    }
  }
  // v8.49 - the anti-rationalization consolidation moved cross-cutting
  // rationalization rows into a single catalog. Install must write
  // `.cclaw/lib/anti-rationalizations.md` with the five known categories.
  if (!existsSync(join(tempDir, ".cclaw", "lib", "anti-rationalizations.md"))) {
    throw new Error("smoke check failed: v8.49 added lib/anti-rationalizations.md but it is missing after init");
  }
  const antiRatBody = readFileSync(
    join(tempDir, ".cclaw", "lib", "anti-rationalizations.md"),
    "utf8"
  );
  for (const category of ["completion", "verification", "edit-discipline", "commit-discipline", "posture-bypass"]) {
    if (!antiRatBody.includes("`" + category + "`")) {
      throw new Error(
        `smoke check failed: v8.49 anti-rationalizations.md is missing category \`${category}\``
      );
    }
  }
  // v8.40 — full hooks removal. session-start.mjs and commit-helper.mjs
  // were retired alongside stop-handoff.mjs; .cclaw/hooks/ should not
  // exist on a fresh install. TDD enforcement moved to a prompt-only
  // contract verified by the reviewer via `git log --grep`.
  if (existsSync(join(tempDir, ".cclaw", "hooks"))) {
    throw new Error("smoke check failed: .cclaw/hooks/ was retired in v8.40 but is still present after init");
  }
  for (const retired of ["session-start.mjs", "commit-helper.mjs", "stop-handoff.mjs"]) {
    if (existsSync(join(tempDir, ".cclaw", "hooks", retired))) {
      throw new Error(`smoke check failed: ${retired} was retired but is still present after init`);
    }
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
  // v8.17 + v8.37: orphan-cleanup smoke check. Plant a stale .md file
  // in the skills dir, run `cclaw --non-interactive install` (which in
  // v8.37 replaced the old `sync` and `upgrade` commands; install on an
  // already-installed project is idempotent and runs the same
  // orphan-cleanup pass `sync` ran pre-v8.37), and assert that the
  // orphan was removed and that the install.ts cleanup step emitted at
  // least one `Removed orphan skill` line on stdout.
  const orphanPath = join(tempDir, ".cclaw", "lib", "skills", "v816-retired-fixture.md");
  writeFileSync(orphanPath, "---\nname: v816-retired-fixture\n---\nsmoke fixture\n", "utf8");
  const syncOut = execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] });
  if (existsSync(orphanPath)) {
    throw new Error("smoke check failed: v8.17 orphan-cleanup did not remove .cclaw/lib/skills/v816-retired-fixture.md after install (idempotent re-run)");
  }
  const syncStdout = String(syncOut);
  if (!syncStdout.includes("Removed orphan skill") || !syncStdout.includes("v816-retired-fixture.md")) {
    throw new Error(`smoke check failed: v8.17 orphan-cleanup did not print "Removed orphan skill — v816-retired-fixture.md" on install (idempotent re-run); got:\n${syncStdout}`);
  }
  if (!syncStdout.includes("Cleaned orphan skills")) {
    throw new Error(`smoke check failed: v8.17 orphan-cleanup did not print summary "Cleaned orphan skills" on install (idempotent re-run); got:\n${syncStdout}`);
  }
  // v8.17: --skip-orphan-cleanup escape hatch. Plant another orphan,
  // run install with the flag, assert the orphan survives + the warning
  // line shows up.
  const orphanSkipPath = join(tempDir, ".cclaw", "lib", "skills", "v816-skip-fixture.md");
  writeFileSync(orphanSkipPath, "---\nname: v816-skip-fixture\n---\nskip-flag fixture\n", "utf8");
  const skipOut = execFileSync(
    "node",
    [cli, "--non-interactive", "install", "--skip-orphan-cleanup"],
    { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (!existsSync(orphanSkipPath)) {
    throw new Error("smoke check failed: --skip-orphan-cleanup should preserve orphan .md files but v816-skip-fixture.md was removed");
  }
  if (!String(skipOut).includes("Skipped orphan cleanup")) {
    throw new Error(`smoke check failed: --skip-orphan-cleanup did not print warning; got:\n${String(skipOut)}`);
  }
  // Clean up the skip-flag fixture so the next install/uninstall passes are clean.
  rmSync(orphanSkipPath, { force: true });
  // v8.40 — retired-hook cleanup smoke check. Plant every retired hook
  // file (session-start, commit-helper, stop-handoff) under .cclaw/hooks/
  // and assert the next install removes each file plus the directory
  // itself, and emits one `Removed retired hook` progress event per
  // file. v8.40 retired the entire hook system: cclaw no longer ships
  // any .mjs hook under .cclaw/hooks/.
  await import("node:fs").then(({ mkdirSync }) =>
    mkdirSync(join(tempDir, ".cclaw", "hooks"), { recursive: true })
  );
  const retiredHooks = ["session-start.mjs", "commit-helper.mjs", "stop-handoff.mjs"];
  for (const hookName of retiredHooks) {
    writeFileSync(
      join(tempDir, ".cclaw", "hooks", hookName),
      `#!/usr/bin/env node\n// stale ${hookName} fixture\nprocess.exit(0);\n`,
      "utf8"
    );
  }
  const retiredHookOut = String(
    execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] })
  );
  for (const hookName of retiredHooks) {
    if (existsSync(join(tempDir, ".cclaw", "hooks", hookName))) {
      throw new Error(
        `smoke check failed: v8.40 retired-hook cleanup did not remove .cclaw/hooks/${hookName} after install`
      );
    }
    if (!retiredHookOut.includes(`Removed retired hook`) || !retiredHookOut.includes(hookName)) {
      throw new Error(
        `smoke check failed: v8.40 retired-hook cleanup did not print "Removed retired hook — ${hookName}" on install; got:\n${retiredHookOut}`
      );
    }
  }
  if (existsSync(join(tempDir, ".cclaw", "hooks"))) {
    throw new Error("smoke check failed: v8.40 retired-hook cleanup left .cclaw/hooks/ directory behind after removing all files");
  }
  // v8.44 — retired-lib-dir cleanup smoke check. Plant a stale
  // `.cclaw/lib/examples/` directory (the v8.43 install layer wrote
  // this; v8.44 retired it) and assert the next install removes it +
  // emits a `Removed retired lib dir` progress event.
  const staleExamplesDir = join(tempDir, ".cclaw", "lib", "examples");
  mkdirSync(staleExamplesDir, { recursive: true });
  writeFileSync(join(staleExamplesDir, "stale.md"), "stale fixture\n", "utf8");
  const retiredLibOut = String(
    execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] })
  );
  if (existsSync(staleExamplesDir)) {
    throw new Error("smoke check failed: v8.44 retired-lib-dir cleanup did not remove .cclaw/lib/examples/ after install");
  }
  if (!retiredLibOut.includes("Removed retired lib dir") || !retiredLibOut.includes(".cclaw/lib/examples")) {
    throw new Error(
      `smoke check failed: v8.44 retired-lib-dir cleanup did not print "Removed retired lib dir — .cclaw/lib/examples" on install; got:\n${retiredLibOut}`
    );
  }

  // Re-run install to assert idempotency: zero orphan output on a clean install.
  const idempotentOut = String(
    execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] })
  );
  if (idempotentOut.includes("Removed orphan skill") || idempotentOut.includes("Cleaned orphan skills")) {
    throw new Error(`smoke check failed: v8.17 orphan-cleanup should be idempotent (zero orphan events on a clean install); got:\n${idempotentOut}`);
  }
  if (idempotentOut.includes("Removed retired hook")) {
    throw new Error(`smoke check failed: v8.38 retired-hook cleanup should be idempotent (zero retired-hook events on a clean install); got:\n${idempotentOut}`);
  }
  if (idempotentOut.includes("Removed retired lib dir")) {
    throw new Error(`smoke check failed: v8.44 retired-lib-dir cleanup should be idempotent (zero retired-lib-dir events on a clean install); got:\n${idempotentOut}`);
  }
  // v8.37 — `sync` / `upgrade` non-interactive commands were collapsed
  // into `install`. The retired names now exit 1 with a migration hint;
  // the smoke script runs `install` three more times (the pre-v8.37
  // sequence was install -> upgrade -> sync -> uninstall; the v8.37
  // sequence is install -> install -> install -> uninstall, all
  // idempotent).
  execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: "pipe" });
  execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: "pipe" });
  execFileSync("node", [cli, "--non-interactive", "uninstall"], { cwd: tempDir, stdio: "pipe" });
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
