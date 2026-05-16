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
  // v8.60 — only cc.md + cc-cancel.md ship; retired commands must not appear.
  const commandsDir = join(tempDir, ".cursor", "commands");
  for (const cmd of ["cc-cancel.md"]) {
    if (!existsSync(join(commandsDir, cmd))) {
      throw new Error(`smoke check failed: ${cmd} missing after init`);
    }
  }
  for (const retiredCmd of ["cc-idea.md", "cclaw-review.md", "cclaw-critic.md"]) {
    if (existsSync(join(commandsDir, retiredCmd))) {
      throw new Error(`smoke check failed: retired command ${retiredCmd} must not install after init`);
    }
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
  for (const dir of ["agents", "skills", "templates", "runbooks", "patterns"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", dir))) {
      throw new Error(`smoke check failed: .cclaw/lib/${dir}/ missing after init`);
    }
  }
  // v8.44 retired .cclaw/lib/examples/ — the directory should NOT exist on a fresh install.
  if (existsSync(join(tempDir, ".cclaw", "lib", "examples"))) {
    throw new Error("smoke check failed: .cclaw/lib/examples/ was retired in v8.44 but is still present after init");
  }
  // v8.54 retired .cclaw/lib/research/ and .cclaw/lib/recovery/ — both modules
  // exported empty arrays since v8.12 and no specialist or runbook ever
  // read from them. The directories should NOT exist on a fresh install.
  for (const retiredDir of ["research", "recovery"]) {
    if (existsSync(join(tempDir, ".cclaw", "lib", retiredDir))) {
      throw new Error(`smoke check failed: .cclaw/lib/${retiredDir}/ was retired in v8.54 but is still present after init`);
    }
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
  // v8.51 — `plan-critic.md` template was added alongside the new
  // pre-implementation plan-critic specialist. Runs between `architect`
  // and `builder` on the tight gate {acMode=strict, complexity=
  // large-risky, problemType!=refines, AC count>=2}; the template is
  // the artifact's source-of-truth shape and ships unconditionally
  // (gate-gated on dispatch, not install).
  // v8.52 — `qa.md` template was added alongside the new behavioural-QA
  // qa-runner specialist. The qa stage dispatches qa-runner between
  // `build` and `review` on the surface gate (triage.surfaces includes
  // ui/web AND acMode != inline); the template is the artifact's
  // source-of-truth shape and ships unconditionally (gate-gated on
  // dispatch, not install).
  // v8.54: decisions.md is gated behind config.legacyArtifacts; default install
  // does NOT write the legacy decisions template (v8.14+ inlines D-N rows in
  // plan.md > ## Decisions).
  // v8.58 — `research.md` template was added alongside the new standalone
  // research-mode entry point (`/cc research <topic>`). v8.62: the
  // `architect` specialist (renamed from `ac-author` and absorbing the
  // dead `design` specialist's responsibilities) writes to `research.md`
  // (instead of plan.md) when activated in standalone research mode; the
  // artifact carries the same section layout as the architect-authored
  // prefix of plan.md but with the research-specific frontmatter
  // (mode: research / topic / generated_at). Ships unconditionally — the
  // template is the artifact's source-of-truth shape regardless of whether
  // the project ever invokes research-mode.
  for (const tpl of ["plan.md", "build.md", "review.md", "critic.md", "plan-critic.md", "qa.md", "ship.md", "learnings.md", "manifest.md", "research.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "templates", tpl))) {
      throw new Error(`smoke check failed: template ${tpl} missing after init`);
    }
  }
  if (existsSync(join(tempDir, ".cclaw", "lib", "templates", "decisions.md"))) {
    throw new Error("smoke check failed: decisions.md template was gated behind config.legacyArtifacts in v8.54 but is still present on default install");
  }
  // v8.42 — assert the critic specialist's agent file is written too.
  // v8.51 — assert the plan-critic specialist's agent file is written
  // too. v8.62: CORE_AGENTS now includes `plan-critic` (7 specialists
  // total: triage, architect, builder, plan-critic, qa-runner,
  // reviewer, critic).
  if (!existsSync(join(tempDir, ".cclaw", "lib", "agents", "critic.md"))) {
    throw new Error("smoke check failed: v8.42 critic.md agent file missing after init");
  }
  if (!existsSync(join(tempDir, ".cclaw", "lib", "agents", "plan-critic.md"))) {
    throw new Error("smoke check failed: v8.51 plan-critic.md agent file missing after init");
  }
  // v8.52 — qa-runner specialist. v8.62: SPECIALIST_AGENTS now contains
  // 7 specialists (triage, architect, builder, plan-critic, qa-runner,
  // reviewer, critic). The agent file ships unconditionally; the
  // orchestrator gates the qa stage at dispatch on triage.surfaces ∩
  // {ui, web} ≠ ∅ AND acMode != inline.
  if (!existsSync(join(tempDir, ".cclaw", "lib", "agents", "qa-runner.md"))) {
    throw new Error("smoke check failed: v8.52 qa-runner.md agent file missing after init");
  }
  // v8.62 — unified flow specialist roster. `architect` (renamed from
  // `ac-author`, absorbing the dead `design` specialist's Phase 0-6
  // responsibilities) and `builder` (renamed from `slice-builder`) are
  // the canonical names; the retired files (`design.md`, `ac-author.md`,
  // `slice-builder.md`, `security-reviewer.md`) must NOT install on a
  // fresh project and must be swept on upgrade (covered by the
  // retired-agent cleanup smoke check below).
  for (const v862Agent of ["architect.md", "builder.md"]) {
    if (!existsSync(join(tempDir, ".cclaw", "lib", "agents", v862Agent))) {
      throw new Error(`smoke check failed: v8.62 ${v862Agent} agent file missing after init`);
    }
  }
  for (const retiredAgent of ["design.md", "ac-author.md", "slice-builder.md", "security-reviewer.md"]) {
    if (existsSync(join(tempDir, ".cclaw", "lib", "agents", retiredAgent))) {
      throw new Error(`smoke check failed: v8.62 retired agent ${retiredAgent} must not install on fresh project`);
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
  // v8.54 — `plan-critic-stage.md` and `critic-stage.md` were merged into
  // `critic-steps.md` (one runbook covers both the pre-impl plan-critic
  // and post-impl critic dispatches). Assert the merged runbook exists
  // and the source runbooks do NOT.
  if (!existsSync(join(tempDir, ".cclaw", "lib", "runbooks", "critic-steps.md"))) {
    throw new Error("smoke check failed: v8.54 critic-steps.md runbook missing after init");
  }
  for (const retired of ["plan-critic-stage.md", "critic-stage.md", "self-review-gate.md", "ship-gate.md", "discovery.md", "plan-small-medium.md"]) {
    if (existsSync(join(tempDir, ".cclaw", "lib", "runbooks", retired))) {
      throw new Error(`smoke check failed: v8.54 retired runbook ${retired} is still present after init`);
    }
  }
  // v8.54 — `self-review-gate.md` and `ship-gate.md` were merged into
  // `handoff-gates.md`. Assert the merged runbook exists.
  if (!existsSync(join(tempDir, ".cclaw", "lib", "runbooks", "handoff-gates.md"))) {
    throw new Error("smoke check failed: v8.54 handoff-gates.md runbook missing after init");
  }
  // v8.52 — `qa-stage.md` on-demand runbook was added alongside the new
  // behavioural-QA qa-runner specialist. The runbook is lazy-loaded by
  // the orchestrator on every builder GREEN return when the surface
  // gate fires (triage.surfaces ∩ {ui, web} ≠ ∅ AND acMode != inline);
  // install writes the file unconditionally (gate-gated on dispatch).
  if (!existsSync(join(tempDir, ".cclaw", "lib", "runbooks", "qa-stage.md"))) {
    throw new Error("smoke check failed: v8.52 qa-stage.md runbook missing after init");
  }
  // v8.59 — `extend-mode.md` on-demand runbook was added alongside the
  // new `/cc extend <slug>` continuation-flow entry point. The runbook
  // is lazy-loaded by the orchestrator on every `/cc` whose argument
  // starts with `extend ` (case-insensitive, exactly one space); it
  // covers the full Detect-hop procedure (argument parsing, parent
  // validation via `loadParentContext`, slug-init patches for
  // `parentContext` + `refines:` + `parent_slug:`, triage-inheritance
  // precedence rules, the seven argument sub-cases, multi-level chaining
  // policy, and worked examples). Install writes the file unconditionally;
  // it is only consumed on extend-mode dispatches.
  const extendModeRunbook = join(tempDir, ".cclaw", "lib", "runbooks", "extend-mode.md");
  if (!existsSync(extendModeRunbook)) {
    throw new Error("smoke check failed: v8.59 extend-mode.md runbook missing after init");
  }
  const extendModeBody = readFileSync(extendModeRunbook, "utf8");
  if (!extendModeBody.startsWith("# On-demand runbook —")) {
    throw new Error("smoke check failed: v8.59 extend-mode.md must open with the canonical `# On-demand runbook —` heading");
  }
  for (const reason of ["in-flight", "cancelled", "missing", "corrupted"]) {
    if (!extendModeBody.includes(reason)) {
      throw new Error(`smoke check failed: v8.59 extend-mode.md must document the ParentContextErrorReason \`${reason}\``);
    }
  }
  if (!extendModeBody.includes("loadParentContext")) {
    throw new Error("smoke check failed: v8.59 extend-mode.md must reference the loadParentContext validator");
  }
  if (!extendModeBody.includes("parentContext")) {
    throw new Error("smoke check failed: v8.59 extend-mode.md must reference the flow-state.json > parentContext field");
  }
  if (!extendModeBody.includes("refines:")) {
    throw new Error("smoke check failed: v8.59 extend-mode.md must reference the legacy `refines:` frontmatter for back-compat with knowledge-store");
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
  // v8.54 removed lib/recovery/ and lib/research/ outright — both modules
  // exported empty arrays since v8.12 and the orphan index.md files were
  // unused. Directories must not exist on a fresh install (asserted
  // above) and on upgrade the retired-lib-dir cleanup removes them.
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
  if (existsSync(join(tempDir, "GEMINI.md"))) {
    throw new Error("smoke check failed: GEMINI.md should NOT be created by cclaw init (v8.55 ambient rules live ONLY in harness-namespaced paths)");
  }
  // v8.55 — harness-embedded ambient rules surface. cclaw writes a
  // compact rules file (Iron Laws + 5 anti-rat categories + A-1..A-5
  // + /cc activation pointer) to each enabled harness's native rules
  // location. Cursor takes the MDC variant with `alwaysApply: true`;
  // the other three harnesses take plain markdown at
  // `.harness/cclaw-rules.md`. Auto-detect on the smoke project picks
  // Cursor (seeded via `.cursor/` marker), so the smoke asserts the
  // Cursor MDC contract.
  const cursorRulesPath = join(tempDir, ".cursor", "rules", "cclaw.mdc");
  if (!existsSync(cursorRulesPath)) {
    throw new Error("smoke check failed: v8.55 .cursor/rules/cclaw.mdc missing after init");
  }
  const cursorRulesBody = readFileSync(cursorRulesPath, "utf8");
  if (!cursorRulesBody.startsWith("---\n")) {
    throw new Error("smoke check failed: v8.55 .cursor/rules/cclaw.mdc must open with an MDC `---` fence");
  }
  if (!cursorRulesBody.match(/^alwaysApply:\s*true\s*$/m)) {
    throw new Error("smoke check failed: v8.55 .cursor/rules/cclaw.mdc must carry `alwaysApply: true` in its frontmatter");
  }
  if (!cursorRulesBody.includes("Iron Laws (Karpathy)")) {
    throw new Error("smoke check failed: v8.55 .cursor/rules/cclaw.mdc must carry the Iron Laws section");
  }
  if (!cursorRulesBody.includes("/cc <task description>")) {
    throw new Error("smoke check failed: v8.55 .cursor/rules/cclaw.mdc must carry the /cc activation pointer");
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

  // v8.62 — retired agent cleanup. Plant pre-v8.62 specialist agent files
  // under .cclaw/lib/agents/ (design / ac-author / slice-builder /
  // security-reviewer) and assert the next install removes each and emits
  // a `Removed retired agent` progress event per file.
  const retiredAgents = ["design.md", "ac-author.md", "slice-builder.md", "security-reviewer.md"];
  for (const retiredAgent of retiredAgents) {
    writeFileSync(
      join(tempDir, ".cclaw", "lib", "agents", retiredAgent),
      `---\nname: ${retiredAgent.replace(/\.md$/, "")}\n---\nstale ${retiredAgent} fixture\n`,
      "utf8"
    );
  }
  const retiredAgentOut = String(
    execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] })
  );
  for (const retiredAgent of retiredAgents) {
    if (existsSync(join(tempDir, ".cclaw", "lib", "agents", retiredAgent))) {
      throw new Error(
        `smoke check failed: v8.62 retired-agent cleanup did not remove .cclaw/lib/agents/${retiredAgent} after install`
      );
    }
    if (!retiredAgentOut.includes(`Removed retired agent`) || !retiredAgentOut.includes(retiredAgent)) {
      throw new Error(
        `smoke check failed: v8.62 retired-agent cleanup did not print "Removed retired agent — ${retiredAgent}" on install; got:\n${retiredAgentOut}`
      );
    }
  }

  // v8.60 — retired command cleanup. Plant pre-v8.60 slash-command files and
  // assert the next install removes them + emits progress events.
  const staleCommandsDir = join(tempDir, ".cursor", "commands");
  for (const retiredCmd of ["cc-idea.md", "cclaw-review.md", "cclaw-critic.md"]) {
    writeFileSync(join(staleCommandsDir, retiredCmd), "# stale\n", "utf8");
  }
  writeFileSync(join(tempDir, ".cclaw", "lib", "templates", "ideas.md"), "# stale ideas\n", "utf8");
  const retiredCmdOut = String(
    execFileSync("node", [cli, "--non-interactive", "install"], { cwd: tempDir, stdio: ["ignore", "pipe", "pipe"] })
  );
  for (const retiredCmd of ["cc-idea.md", "cclaw-review.md", "cclaw-critic.md"]) {
    if (existsSync(join(staleCommandsDir, retiredCmd))) {
      throw new Error(`smoke check failed: v8.60 did not remove stale ${retiredCmd} on install`);
    }
  }
  if (existsSync(join(tempDir, ".cclaw", "lib", "templates", "ideas.md"))) {
    throw new Error("smoke check failed: v8.60 did not remove stale ideas.md template on install");
  }
  if (!retiredCmdOut.includes("Removed retired command")) {
    throw new Error(
      `smoke check failed: v8.60 retired-command cleanup did not print "Removed retired command" on install; got:\n${retiredCmdOut}`
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
  if (idempotentOut.includes("Removed retired agent")) {
    throw new Error(`smoke check failed: v8.62 retired-agent cleanup should be idempotent (zero retired-agent events on a clean install); got:\n${idempotentOut}`);
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
  for (const retiredCmd of ["cc-idea.md", "cclaw-review.md", "cclaw-critic.md"]) {
    if (existsSync(join(tempDir, ".cursor", "commands", retiredCmd))) {
      throw new Error(
        `smoke check failed: retired command ${retiredCmd} still exists after uninstall`
      );
    }
  }
  // v8.55 — uninstall must remove the harness-namespaced rules file
  // AND the (now-empty) `.cursor/rules/` parent dir cclaw owned. The
  // `.cursor/` root dir itself survives because the user may keep
  // other Cursor state there.
  if (existsSync(join(tempDir, ".cursor", "rules", "cclaw.mdc"))) {
    throw new Error("smoke check failed: v8.55 .cursor/rules/cclaw.mdc still exists after uninstall");
  }
  if (existsSync(join(tempDir, ".cursor", "rules"))) {
    throw new Error("smoke check failed: v8.55 uninstall left empty .cursor/rules/ behind");
  }
  process.stdout.write(`[smoke] success in ${tempDir}\n`);
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
