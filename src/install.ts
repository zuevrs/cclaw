import fs from "node:fs/promises";
import path from "node:path";
import {
  CANCELLED_DIR_REL_PATH,
  CCLAW_VERSION,
  FLOWS_ROOT,
  HOOKS_REL_PATH,
  LIB_ROOT,
  RUNTIME_ROOT,
  SHIPPED_DIR_REL_PATH,
  STATE_REL_PATH
} from "./constants.js";
import { CORE_AGENTS, renderAgentMarkdown } from "./content/core-agents.js";
import { ARTIFACT_TEMPLATES, planTemplateForSlug, templateBody } from "./content/artifact-templates.js";
import { AUTO_TRIGGER_SKILLS, SKILLS_INDEX_BODY } from "./content/skills.js";
import { ANTI_RATIONALIZATIONS_BODY } from "./content/anti-rationalizations.js";
import { CCLAW_RULES_MARKDOWN, CCLAW_RULES_MDC } from "./content/cclaw-rules.js";
import { REFERENCE_PATTERNS, REFERENCE_PATTERNS_INDEX } from "./content/reference-patterns.js";
import { STAGE_PLAYBOOKS, STAGE_PLAYBOOKS_INDEX } from "./content/stage-playbooks.js";
import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "./content/runbooks-on-demand.js";
import { ANTIPATTERNS } from "./content/antipatterns.js";
import { DECISION_PROTOCOL } from "./content/decision-protocol.js";
import { META_SKILL } from "./content/meta-skill.js";
import { renderStartCommand } from "./content/start-command.js";
import { renderCancelCommand } from "./content/cancel-command.js";
import { renderIdeaCommand } from "./content/idea-command.js";
import { UTILITY_COMMAND_FILES } from "./content/utility-commands.js";
import { ensureDir, exists, removePath, writeFileSafe } from "./fs-utils.js";
import { ensureRunSystem } from "./run-persistence.js";
import { createDefaultConfig, readConfig, renderConfig, type CclawConfig } from "./config.js";
import {
  CONTEXT_MD_FILE_NAME,
  CONTEXT_MD_TEMPLATE,
  contextGlossaryPath
} from "./context-glossary.js";
import { detectHarnesses, NO_HARNESS_DETECTED_MESSAGE } from "./harness-detect.js";
import { ensureGitignorePatterns, removeGitignorePatterns } from "./gitignore.js";
import { isInteractive, runPicker } from "./harness-prompt.js";
import { HARNESS_IDS, type HarnessId } from "./types.js";
import { ironLawsMarkdown } from "./content/iron-laws.js";
import type { ProgressEvent, SummaryCounts } from "./ui.js";

/**
 * v8.55 — per-harness layout for the ambient cclaw rules surface that
 * lives outside `/cc`. Each harness gets its own activation contract;
 * the field captures both the file path and the activation mode so the
 * install summary can render the correct per-harness guidance.
 *
 * - `path` — repository-relative file path the installer writes / the
 *   uninstaller removes. ALL paths live inside the harness's namespaced
 *   directory (`.cursor/`, `.claude/`, `.codex/`, `.opencode/`); the
 *   installer NEVER touches project-root `AGENTS.md` / `CLAUDE.md` /
 *   `GEMINI.md` (the user owns those files).
 * - `format` — `"mdc"` for Cursor (YAML frontmatter + markdown body) /
 *   `"markdown"` for the other three (plain markdown body, no
 *   frontmatter).
 * - `autoLoad` — `true` when the harness's native rules system loads
 *   the file on session start without further user action (Cursor MDC
 *   with `alwaysApply: true`). `false` when the user must add a
 *   one-line `@.harness/cclaw-rules.md` reference from their root
 *   memory file (CLAUDE.md / AGENTS.md) for the rules to activate. The
 *   install summary surfaces per-harness activation steps based on
 *   this field.
 * - `activationHint` — verbatim one-line activation step rendered by
 *   the install summary. Each harness gets a custom hint matching its
 *   native rules system; the install summary concatenates these into
 *   the post-install message so the user sees exactly what to do per
 *   harness.
 */
export interface HarnessRulesLayout {
  path: string;
  format: "mdc" | "markdown";
  autoLoad: boolean;
  activationHint: string;
}

export interface HarnessLayout {
  id: HarnessId;
  commandsDir: string;
  agentsDir: string;
  skillsDir: string;
  rules: HarnessRulesLayout;
}

const HARNESS_LAYOUTS: Record<HarnessId, HarnessLayout> = {
  claude: {
    id: "claude",
    commandsDir: ".claude/commands",
    agentsDir: ".claude/agents",
    skillsDir: ".claude/skills/cclaw",
    rules: {
      path: ".claude/cclaw-rules.md",
      format: "markdown",
      autoLoad: false,
      activationHint:
        "Claude Code: add `@.claude/cclaw-rules.md` to your CLAUDE.md to activate ambient rules (cclaw never writes CLAUDE.md)."
    }
  },
  cursor: {
    id: "cursor",
    commandsDir: ".cursor/commands",
    agentsDir: ".cursor/agents",
    skillsDir: ".cursor/skills/cclaw",
    rules: {
      path: ".cursor/rules/cclaw.mdc",
      format: "mdc",
      autoLoad: true,
      activationHint:
        "Cursor: rules auto-load from `.cursor/rules/cclaw.mdc` (`alwaysApply: true`); no further action needed."
    }
  },
  opencode: {
    id: "opencode",
    commandsDir: ".opencode/commands",
    agentsDir: ".opencode/agents",
    skillsDir: ".opencode/skills/cclaw",
    rules: {
      path: ".opencode/cclaw-rules.md",
      format: "markdown",
      autoLoad: false,
      activationHint:
        "OpenCode: add `@.opencode/cclaw-rules.md` to your AGENTS.md to activate ambient rules (cclaw never writes AGENTS.md)."
    }
  },
  codex: {
    id: "codex",
    commandsDir: ".codex/commands",
    agentsDir: ".codex/agents",
    skillsDir: ".codex/skills/cclaw",
    rules: {
      path: ".codex/cclaw-rules.md",
      format: "markdown",
      autoLoad: false,
      activationHint:
        "Codex: add `@.codex/cclaw-rules.md` to your AGENTS.md to activate ambient rules (cclaw never writes AGENTS.md)."
    }
  }
};

/**
 * v8.40 — files cclaw used to ship under `.cclaw/hooks/` but no longer
 * writes. The installer removes each on every `cclaw install` (and the
 * whole `.cclaw/hooks/` directory after the files are gone) so existing
 * v8.38/v8.39 projects upgrade cleanly. Idempotent; emits one progress
 * event per removed entry.
 *
 * v8.40 retired all hooks: `session-start.mjs` (advisory ping) and
 * `commit-helper.mjs` (mechanical TDD gate). The Iron Law is now a
 * prompt rule + git-log inspection in the reviewer; no `.mjs` ships
 * under `.cclaw/hooks/` and the directory itself is removed when
 * empty.
 *
 * Earlier retired entries kept in the list so an install that skipped
 * the v8.38 cleanup (e.g. upgrade from v8.36 straight to v8.40) still
 * gets a clean hooks dir before it disappears.
 */
const RETIRED_HOOK_FILES: readonly string[] = [
  "session-start.mjs",
  "commit-helper.mjs",
  "stop-handoff.mjs"
];

/**
 * Per-harness hook config files that earlier cclaw versions wrote to
 * wire `session-start.mjs` into the harness session.start event. v8.40
 * removes both the hook and its wiring; this list drives the install
 * cleanup so a project upgraded from v8.38/v8.39 ends up with no
 * cclaw-owned hooks file in the harness root.
 */
const RETIRED_HARNESS_HOOK_FILES: readonly { dir: string; fileName: string }[] = [
  { dir: ".claude/hooks", fileName: "hooks.json" },
  { dir: ".cursor", fileName: "hooks.json" },
  { dir: ".codex", fileName: "hooks.json" },
  { dir: ".opencode/plugins", fileName: "cclaw-plugin.mjs" }
];

export interface SyncOptions {
  cwd: string;
  harnesses?: HarnessId[];
  /**
   * When true (default for `init` from a real TTY), `cclaw` shows the
   * interactive harness picker if no `--harness` flag and no existing
   * `.cclaw/config.yaml` are available. Set to false in CI/non-TTY paths
   * (smoke scripts, programmatic callers) to fall back to auto-detect or
   * a hard error if nothing is found.
   */
  interactive?: boolean;
  /**
   * v8.17 — skip the orphan-skill scan that runs after the install layer
   * writes `.cclaw/lib/skills/*.md`. Default `false` (scan runs and
   * `fs.rm`s any `.md` file in that directory not in
   * `AUTO_TRIGGER_SKILLS` ∪ {`cclaw-meta.md`}). Use only as an emergency
   * escape hatch — the scan is loud (one progress event per removed
   * file) and idempotent, so the common case is "let it run". Surfaced
   * as `cclaw <sync|upgrade|init> --skip-orphan-cleanup` on the CLI.
   */
  skipOrphanCleanup?: boolean;
  /**
   * v8.35 — when true, write a CONTEXT.md stub at the project root if
   * one does not already exist. Default `false`: CONTEXT.md is an
   * opt-in convention, the install layer must never overwrite a file
   * the user (or another tool) authored. Surfaced behind the
   * `--with-context` CLI flag.
   *
   * An existing CONTEXT.md is preserved verbatim regardless of this
   * option's value — the install layer never mutates an existing
   * project-root markdown file.
   */
  withContext?: boolean;
  /**
   * Optional progress callback invoked once per major install step
   * (agents written, hooks installed, etc.). The CLI wires this to a
   * `✓` line printer; programmatic callers (smoke, tests, MCP wrappers)
   * can leave it undefined to stay silent.
   */
  onProgress?: (event: ProgressEvent) => void;
}

export interface SyncResult {
  installedHarnesses: HarnessId[];
  configPath: string;
  /**
   * Counts of every asset family written during this sync. Surfaced so
   * the CLI can render an "Installed: ..." summary block, and so tests
   * can assert against concrete numbers without re-reading the disk.
   */
  counts: SummaryCounts;
}

export async function ensureRuntimeRoot(projectRoot: string): Promise<void> {
  const root = path.join(projectRoot, RUNTIME_ROOT);
  for (const dir of [
    STATE_REL_PATH,
    FLOWS_ROOT,
    SHIPPED_DIR_REL_PATH,
    CANCELLED_DIR_REL_PATH,
    LIB_ROOT,
    path.join(LIB_ROOT, "agents"),
    path.join(LIB_ROOT, "skills"),
    path.join(LIB_ROOT, "templates"),
    path.join(LIB_ROOT, "runbooks"),
    path.join(LIB_ROOT, "patterns")
  ]) {
    await ensureDir(path.join(projectRoot, dir));
  }
  await writeFileSafe(
    path.join(root, ".gitkeep"),
    "cclaw runtime root. Generated by cclaw-cli; safe to keep in version control.\n"
  );
}

async function writeAgentFiles(projectRoot: string): Promise<void> {
  for (const agent of CORE_AGENTS) {
    const agentPath = path.join(projectRoot, LIB_ROOT, "agents", `${agent.id}.md`);
    await writeFileSafe(agentPath, renderAgentMarkdown(agent));
  }
}

async function writeRuntimeSkills(projectRoot: string): Promise<void> {
  for (const skill of AUTO_TRIGGER_SKILLS) {
    const target = path.join(projectRoot, LIB_ROOT, "skills", skill.fileName);
    await writeFileSafe(target, skill.body);
  }
}

/**
 * v8.22 — generic orphan-`.md`-file garbage collector for a managed
 * subdirectory under `.cclaw/lib/`. Lifted out of v8.17's
 * skill-specific `cleanupOrphanSkills` so the same loud, idempotent
 * scan can run against `lib/skills/` (v8.17) and `lib/runbooks/`
 * (v8.22, when this PR adds 10 on-demand runbook files alongside the
 * 4 stage-runbooks shipped since v8.4).
 *
 * Scope (intentionally narrow; identical contract to v8.17):
 *  - Only `.md` files directly inside `<projectRoot>/<dirRelPath>`.
 *  - Subdirectories survive (someone may have stashed personal notes
 *    in a subfolder; we don't recurse).
 *  - Non-`.md` files survive (someone added a `something.txt` — that's
 *    not a managed file, leave it).
 *  - Nothing outside the named directory is ever touched.
 *
 * Loudness contract: emits one `Removed orphan <noun>` progress event
 * per removed file, then one `Cleaned orphan <noun-plural>` summary
 * event when N > 0. On a healthy install (N = 0) the scan emits
 * nothing — zero noise. The per-file `detail` is the file basename; the
 * summary `detail` starts with `<N> orphan <noun ...> removed` so the
 * v8.17 regex `/^N orphan skill files? /` continues to match.
 *
 * Idempotent: running `cclaw sync` twice in a row on a clean install
 * produces zero orphan events on the second pass.
 */
async function cleanupOrphans(
  projectRoot: string,
  dirRelPath: string,
  expected: Set<string>,
  noun: { singular: string; plural: string },
  emit: (step: string, detail?: string) => void
): Promise<number> {
  const dir = path.join(projectRoot, dirRelPath);
  if (!(await exists(dir))) return 0;
  const entries = await fs.readdir(dir, { withFileTypes: true });
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    if (expected.has(entry.name)) continue;
    await fs.rm(path.join(dir, entry.name), { force: true });
    emit(`Removed orphan ${noun.singular}`, entry.name);
    removed += 1;
  }
  if (removed > 0) {
    const word = removed === 1 ? `${noun.singular} file` : `${noun.singular} files`;
    emit(`Cleaned orphan ${noun.plural}`, `${removed} orphan ${word} removed`);
  }
  return removed;
}

/**
 * v8.17 wrapper: orphan-clean `.cclaw/lib/skills/`. Expected set is
 * `AUTO_TRIGGER_SKILLS` ∪ {`cclaw-meta.md`}.
 */
async function cleanupOrphanSkills(
  projectRoot: string,
  emit: (step: string, detail?: string) => void
): Promise<number> {
  const expected = new Set<string>([
    "cclaw-meta.md",
    ...AUTO_TRIGGER_SKILLS.map((s) => s.fileName)
  ]);
  return cleanupOrphans(
    projectRoot,
    path.join(LIB_ROOT, "skills"),
    expected,
    { singular: "skill", plural: "skills" },
    emit
  );
}

/**
 * v8.22 wrapper: orphan-clean `.cclaw/lib/runbooks/`. Expected set is
 * the 4 `STAGE_PLAYBOOKS` filenames + `index.md` + the surviving
 * `ON_DEMAND_RUNBOOKS` filenames. Loud-and-idempotent like the v8.17
 * skill scan; emits `Removed orphan runbook` and `Cleaned orphan
 * runbooks` so callers can distinguish runbook events from skill
 * events.
 *
 * v8.54 — the merged-away runbook files (self-review-gate.md,
 * ship-gate.md, discovery.md, plan-small-medium.md, critic-stage.md,
 * plan-critic-stage.md) are not in the expected set, so the orphan
 * scan removes them on upgrade. The `RETIRED_RUNBOOK_FILES` constant
 * documents the closed list for the smoke check and tests.
 */
async function cleanupOrphanRunbooks(
  projectRoot: string,
  emit: (step: string, detail?: string) => void
): Promise<number> {
  const expected = new Set<string>([
    "index.md",
    ...STAGE_PLAYBOOKS.map((p) => p.fileName),
    ...ON_DEMAND_RUNBOOKS.map((r) => r.fileName)
  ]);
  return cleanupOrphans(
    projectRoot,
    path.join(LIB_ROOT, "runbooks"),
    expected,
    { singular: "runbook", plural: "runbooks" },
    emit
  );
}

async function writeTemplates(projectRoot: string, legacyArtifacts: boolean): Promise<void> {
  for (const template of ARTIFACT_TEMPLATES) {
    if (template.id === "decisions" && !legacyArtifacts) {
      continue;
    }
    const target = path.join(projectRoot, LIB_ROOT, "templates", template.fileName);
    await writeFileSafe(target, template.body);
  }
  if (!legacyArtifacts) {
    const decisionsLegacyPath = path.join(projectRoot, LIB_ROOT, "templates", "decisions.md");
    if (await exists(decisionsLegacyPath)) {
      await fs.rm(decisionsLegacyPath, { force: true });
    }
  }
  await writeFileSafe(
    path.join(projectRoot, LIB_ROOT, "templates", "iron-laws.md"),
    ironLawsMarkdown()
  );
}

async function writeIdeasSeed(projectRoot: string): Promise<void> {
  const target = path.join(projectRoot, RUNTIME_ROOT, "ideas.md");
  if (await exists(target)) return;
  await writeFileSafe(target, templateBody("ideas"));
}

async function writeStageRunbooks(projectRoot: string): Promise<void> {
  const dir = path.join(projectRoot, LIB_ROOT, "runbooks");
  for (const playbook of STAGE_PLAYBOOKS) {
    await writeFileSafe(path.join(dir, playbook.fileName), playbook.body);
  }
  for (const runbook of ON_DEMAND_RUNBOOKS) {
    await writeFileSafe(path.join(dir, runbook.fileName), runbook.body);
  }
  const combinedIndex = `${STAGE_PLAYBOOKS_INDEX}\n${ON_DEMAND_RUNBOOKS_INDEX_SECTION}`;
  await writeFileSafe(path.join(dir, "index.md"), combinedIndex);
}

async function writeReferencePatterns(projectRoot: string): Promise<void> {
  const dir = path.join(projectRoot, LIB_ROOT, "patterns");
  for (const pattern of REFERENCE_PATTERNS) {
    await writeFileSafe(path.join(dir, pattern.fileName), pattern.body);
  }
  await writeFileSafe(path.join(dir, "index.md"), REFERENCE_PATTERNS_INDEX);
}

async function writeAntipatterns(projectRoot: string): Promise<void> {
  await writeFileSafe(path.join(projectRoot, LIB_ROOT, "antipatterns.md"), ANTIPATTERNS);
}

async function writeDecisionProtocol(projectRoot: string): Promise<void> {
  await writeFileSafe(
    path.join(projectRoot, LIB_ROOT, "decision-protocol.md"),
    DECISION_PROTOCOL
  );
}

async function writeMetaSkill(projectRoot: string): Promise<void> {
  await writeFileSafe(
    path.join(projectRoot, LIB_ROOT, "skills", "cclaw-meta.md"),
    META_SKILL
  );
}

/**
 * v8.49 — write the auto-trigger skills index to `.cclaw/lib/skills-index.md`.
 * v8.49 collapses the per-dispatch specialist prompt block to a compact
 * one-line-per-skill pointer; the full per-skill description + trigger
 * list lives in this index, written once at install time so specialists
 * can read it on demand instead of the prompt carrying it verbatim.
 *
 * The index is grouped by stage (so a stage-dispatched specialist can
 * read the relevant section) AND carries an alphabetical entry per
 * skill (so an out-of-stage citation has somewhere to land). Both
 * sections are derived from `AUTO_TRIGGER_SKILLS` so renaming /
 * adding / removing a skill ripples through automatically.
 */
async function writeSkillsIndex(projectRoot: string): Promise<void> {
  await writeFileSafe(
    path.join(projectRoot, LIB_ROOT, "skills-index.md"),
    SKILLS_INDEX_BODY
  );
}

/**
 * Write the shared anti-rationalization catalog (v8.49) to
 * `.cclaw/lib/anti-rationalizations.md`. Specialists and skills reference
 * rows from this file by category (`completion`, `verification`,
 * `edit-discipline`, `commit-discipline`, `posture-bypass`) instead of
 * inlining the cross-cutting rebuttals into every prompt.
 *
 * The body is sourced from `content/anti-rationalizations.ts` so adding /
 * removing a category or row ripples through at install time.
 */
async function writeAntiRationalizationsCatalog(
  projectRoot: string
): Promise<void> {
  await writeFileSafe(
    path.join(projectRoot, LIB_ROOT, "anti-rationalizations.md"),
    ANTI_RATIONALIZATIONS_BODY
  );
}

/**
 * v8.55 — render the ambient rules body for the harness's native rules
 * system. Cursor takes the MDC variant (frontmatter + body); the other
 * three harnesses take the plain markdown body. The same compact
 * content rides every harness; only the wrapper format differs to
 * match each system's native loading contract.
 */
function rulesBodyFor(layout: HarnessLayout): string {
  return layout.rules.format === "mdc" ? CCLAW_RULES_MDC : CCLAW_RULES_MARKDOWN;
}

async function writeHarnessAssets(projectRoot: string, layout: HarnessLayout): Promise<void> {
  await ensureDir(path.join(projectRoot, layout.commandsDir));
  await writeFileSafe(path.join(projectRoot, layout.commandsDir, "cc.md"), renderStartCommand());
  await writeFileSafe(path.join(projectRoot, layout.commandsDir, "cc-cancel.md"), renderCancelCommand());
  await writeFileSafe(path.join(projectRoot, layout.commandsDir, "cc-idea.md"), renderIdeaCommand());
  // v8.57 — utility slash commands. Direct-callable shims that expose
  // the reviewer / critic specialists outside the full /cc flow. Each
  // file ships next to cc.md / cc-cancel.md / cc-idea.md so the harness
  // surfaces them through the same slash-command discovery mechanism.
  for (const utility of UTILITY_COMMAND_FILES) {
    await writeFileSafe(
      path.join(projectRoot, layout.commandsDir, utility.fileName),
      utility.render()
    );
  }

  await ensureDir(path.join(projectRoot, layout.agentsDir));
  for (const agent of CORE_AGENTS) {
    await writeFileSafe(
      path.join(projectRoot, layout.agentsDir, `${agent.id}.md`),
      renderAgentMarkdown(agent)
    );
  }

  await ensureDir(path.join(projectRoot, layout.skillsDir));
  for (const skill of AUTO_TRIGGER_SKILLS) {
    await writeFileSafe(path.join(projectRoot, layout.skillsDir, skill.fileName), skill.body);
  }

  // v8.55 — ambient rules surface. Each harness gets the rules body
  // wrapped in its native format (Cursor MDC vs plain markdown) at its
  // namespaced path. Idempotent: re-running install overwrites the
  // file with the current content rather than appending; the cclaw
  // catalog is the source of truth, the disk file is a projection.
  await writeFileSafe(
    path.join(projectRoot, layout.rules.path),
    rulesBodyFor(layout)
  );
}

/**
 * v8.44 — retired `.cclaw/lib/` subdirectories. The installer removes
 * each on every `cclaw install` (and emits one progress event per
 * removed dir) so existing v8.43 / earlier projects upgrade cleanly.
 *
 * v8.44 retired `examples` — the `.cclaw/lib/examples/` directory was
 * written by install since v8.0 but no agent code path programmatically
 * read from it. The v8.12 cleanup already emptied the EXAMPLES content
 * module; v8.44 takes out the directory + writer + smoke assertion.
 *
 * v8.54 retired `research` and `recovery` — both modules exported empty
 * arrays since v8.12 (no specialist or runbook ever read from
 * `.cclaw/lib/research/` or `.cclaw/lib/recovery/`). The cleanup pass
 * removes the lingering empty directories on upgrade.
 */
const RETIRED_LIB_DIRS: readonly string[] = ["examples", "research", "recovery"];

/**
 * v8.54 — retired on-demand runbook files. Earlier installs wrote these
 * under `.cclaw/lib/runbooks/`. v8.54 merged or lifted their content
 * into surviving runbooks (handoff-gates.md, critic-steps.md, plan.md
 * "Path: small/medium" / "Path: large-risky" sections). The orphan
 * cleaner removes the stale `.md` files on upgrade.
 */
const RETIRED_RUNBOOK_FILES: readonly string[] = [
  "self-review-gate.md",
  "ship-gate.md",
  "discovery.md",
  "plan-small-medium.md",
  "critic-stage.md",
  "plan-critic-stage.md"
];

async function removeRetiredLibDirs(
  projectRoot: string,
  emit: (step: string, detail?: string) => void
): Promise<void> {
  for (const dirName of RETIRED_LIB_DIRS) {
    const target = path.join(projectRoot, LIB_ROOT, dirName);
    if (await exists(target)) {
      await fs.rm(target, { recursive: true, force: true });
      emit("Removed retired lib dir", `${LIB_ROOT}/${dirName}`);
    }
  }
}

/**
 * v8.40 — clean up the now-retired `.cclaw/hooks/` directory plus its
 * historical `.mjs` files, and the per-harness hook-config files that
 * pointed at `session-start.mjs`. Idempotent: emits one progress
 * event per removed entry, nothing on a clean install.
 *
 * Strategy:
 *  1. Delete each known retired hook file under `.cclaw/hooks/`.
 *  2. If `.cclaw/hooks/` is now empty, remove the directory itself
 *     (the v8.40 install no longer needs it).
 *  3. For every harness, remove the cclaw-owned hooks config file
 *     (`.claude/hooks/hooks.json`, `.cursor/hooks.json`,
 *     `.codex/hooks.json`, `.opencode/plugins/cclaw-plugin.mjs`).
 *     The harness's own root dir survives (the harness may have
 *     other state); only the cclaw artefact is scrubbed.
 *
 * The function NEVER fails on a missing path; cleanup is best-effort
 * and idempotent.
 */
async function removeRetiredHookArtefacts(
  projectRoot: string,
  emit: (step: string, detail?: string) => void
): Promise<void> {
  const hooksDir = path.join(projectRoot, HOOKS_REL_PATH);
  for (const fileName of RETIRED_HOOK_FILES) {
    const target = path.join(hooksDir, fileName);
    if (await exists(target)) {
      await fs.rm(target, { force: true });
      emit("Removed retired hook", fileName);
    }
  }
  if (await exists(hooksDir)) {
    const remaining = await fs.readdir(hooksDir).catch(() => [] as string[]);
    if (remaining.length === 0) {
      await fs.rm(hooksDir, { recursive: true, force: true });
      emit("Removed retired hooks dir", HOOKS_REL_PATH);
    }
  }
  for (const { dir, fileName } of RETIRED_HARNESS_HOOK_FILES) {
    const target = path.join(projectRoot, dir, fileName);
    if (await exists(target)) {
      await fs.rm(target, { force: true });
      emit("Removed retired hook wiring", `${dir}/${fileName}`);
    }
  }
}

async function writeConfig(projectRoot: string, config: CclawConfig): Promise<string> {
  const configPath = path.join(projectRoot, RUNTIME_ROOT, "config.yaml");
  await writeFileSafe(configPath, renderConfig(config));
  return configPath;
}

/**
 * v8.35 — write the CONTEXT.md stub at the project root when the user
 * opts in via `--with-context` and the file does not already exist.
 *
 * Returns `"created" | "exists" | "skipped"` so the install summary can
 * report what happened. The install layer NEVER overwrites an existing
 * CONTEXT.md — the file belongs to the user and may have been authored
 * by them or another tool (mattpocock-style glossary, a non-cclaw
 * project convention, etc.).
 */
async function maybeWriteContextStub(
  projectRoot: string,
  withContext: boolean
): Promise<"created" | "exists" | "skipped"> {
  if (!withContext) return "skipped";
  const target = contextGlossaryPath(projectRoot);
  try {
    await fs.access(target);
    return "exists";
  } catch {
    await writeFileSafe(target, CONTEXT_MD_TEMPLATE);
    return "created";
  }
}

async function resolveHarnesses(
  projectRoot: string,
  fromOptions: HarnessId[] | undefined,
  fromConfig: HarnessId[] | undefined,
  interactive: boolean
): Promise<HarnessId[]> {
  if (fromOptions && fromOptions.length > 0) return fromOptions;
  if (fromConfig && fromConfig.length > 0) return fromConfig;
  const detected = await detectHarnesses(projectRoot);
  if (interactive && isInteractive()) {
    return runPicker({ detected });
  }
  if (detected.length > 0) return detected;
  throw new Error(NO_HARNESS_DETECTED_MESSAGE);
}

export async function syncCclaw(options: SyncOptions): Promise<SyncResult> {
  const projectRoot = options.cwd;
  const emit = (step: string, detail?: string): void => {
    options.onProgress?.({ step, detail });
  };

  await ensureRuntimeRoot(projectRoot);
  const existing = await readConfig(projectRoot);
  const harnesses = await resolveHarnesses(
    projectRoot,
    options.harnesses,
    existing?.harnesses,
    options.interactive ?? false
  );
  for (const harness of harnesses) {
    if (!HARNESS_IDS.includes(harness)) {
      throw new Error(`Unknown harness: ${harness}. Supported: ${HARNESS_IDS.join(", ")}`);
    }
  }
  const config = existing
    ? { ...existing, version: CCLAW_VERSION, flowVersion: "8" as const, harnesses }
    : createDefaultConfig(harnesses);
  await ensureRunSystem(projectRoot);
  emit("Runtime root", `.cclaw/{state,hooks,flows,lib}`);

  await writeAgentFiles(projectRoot);
  emit("Wrote specialists", `${CORE_AGENTS.length} agents → .cclaw/lib/agents/`);

  await removeRetiredHookArtefacts(projectRoot, emit);

  await writeRuntimeSkills(projectRoot);
  await writeMetaSkill(projectRoot);
  emit("Wrote skills", `${AUTO_TRIGGER_SKILLS.length + 1} skills → .cclaw/lib/skills/`);

  await writeSkillsIndex(projectRoot);
  emit("Wrote skills index", `skills-index.md → .cclaw/lib/`);

  await writeAntiRationalizationsCatalog(projectRoot);
  emit(
    "Wrote anti-rationalizations catalog",
    `anti-rationalizations.md → .cclaw/lib/`
  );

  if (options.skipOrphanCleanup) {
    emit(
      "Skipped orphan cleanup",
      "--skip-orphan-cleanup set; stale .md files in .cclaw/lib/skills/ will not be removed"
    );
  } else {
    await cleanupOrphanSkills(projectRoot, emit);
  }

  const legacyArtifacts = Boolean(config.legacyArtifacts);
  await writeTemplates(projectRoot, legacyArtifacts);
  const templateCount = legacyArtifacts
    ? ARTIFACT_TEMPLATES.length + 1
    : ARTIFACT_TEMPLATES.length; // -1 decisions.md skipped, +1 iron-laws.md added
  emit("Wrote templates", `${templateCount} templates → .cclaw/lib/templates/`);

  await writeStageRunbooks(projectRoot);
  emit(
    "Wrote runbooks",
    `${STAGE_PLAYBOOKS.length} stage + ${ON_DEMAND_RUNBOOKS.length} on-demand → .cclaw/lib/runbooks/`
  );

  if (options.skipOrphanCleanup) {
    emit(
      "Skipped orphan cleanup",
      "--skip-orphan-cleanup set; stale .md files in .cclaw/lib/runbooks/ will not be removed"
    );
  } else {
    await cleanupOrphanRunbooks(projectRoot, emit);
  }

  await writeReferencePatterns(projectRoot);
  emit("Wrote patterns", `${REFERENCE_PATTERNS.length} reference patterns → .cclaw/lib/patterns/`);

  await removeRetiredLibDirs(projectRoot, emit);

  await writeAntipatterns(projectRoot);
  await writeDecisionProtocol(projectRoot);
  await writeIdeasSeed(projectRoot);
  emit("Wrote anti-patterns + decision protocol", "antipatterns.md + decision-protocol.md");

  for (const harness of harnesses) {
    await writeHarnessAssets(projectRoot, HARNESS_LAYOUTS[harness]);
  }
  emit("Wired harnesses", `${harnesses.join(", ")} → commands · agents · skills · rules`);
  // v8.55 — emit one progress event per harness rules file so the
  // operator sees which path each rules file landed at. Cursor's MDC
  // file is the only auto-load path; the other three require a
  // one-line `@`-reference from the user's root memory file, which
  // the install summary spells out below.
  for (const harness of harnesses) {
    const layout = HARNESS_LAYOUTS[harness];
    const autoLoadTag = layout.rules.autoLoad ? "auto-load" : "manual @-ref";
    emit("Wrote harness rules", `${layout.rules.path} (${autoLoadTag})`);
  }

  await ensureGitignorePatterns(projectRoot);
  const configPath = await writeConfig(projectRoot, config);
  emit("Wrote .cclaw/config.yaml", `harnesses: ${harnesses.join(", ")}`);

  const contextOutcome = await maybeWriteContextStub(projectRoot, options.withContext ?? false);
  if (contextOutcome === "created") {
    emit("Wrote CONTEXT.md stub", `${CONTEXT_MD_FILE_NAME} (project domain glossary, edit and commit)`);
  } else if (contextOutcome === "exists") {
    emit(
      "Preserved CONTEXT.md",
      `${CONTEXT_MD_FILE_NAME} already exists; left untouched (install never overwrites)`
    );
  }

  const counts: SummaryCounts = {
    harnesses: [...harnesses],
    agents: CORE_AGENTS.length,
    skills: AUTO_TRIGGER_SKILLS.length + 1,
    templates: templateCount,
    runbooks: STAGE_PLAYBOOKS.length + ON_DEMAND_RUNBOOKS.length,
    patterns: REFERENCE_PATTERNS.length,
    research: 0,
    recovery: 0,
    examples: 0,
    hooks: 0,
    // v8.57 — three flow commands (cc, cc-cancel, cc-idea) plus the new
    // utility command count from UTILITY_COMMAND_FILES (currently 2:
    // cclaw-review, cclaw-critic). Sourcing from the constant means a
    // future v8.58 utility command flips the count automatically.
    commands: 3 + UTILITY_COMMAND_FILES.length
  };
  return { installedHarnesses: harnesses, configPath, counts };
}

export async function initCclaw(options: SyncOptions): Promise<SyncResult> {
  return syncCclaw(options);
}

export async function uninstallCclaw(options: { cwd: string }): Promise<void> {
  const projectRoot = options.cwd;
  const config = await readConfig(projectRoot);
  const harnesses = config?.harnesses ?? (HARNESS_IDS as readonly HarnessId[]);
  await removePath(path.join(projectRoot, RUNTIME_ROOT));
  for (const harness of harnesses as HarnessId[]) {
    const layout = HARNESS_LAYOUTS[harness];
    // v8.57 — utility command files (`cclaw-review.md`, `cclaw-critic.md`)
    // ship alongside the cc.md / cc-cancel.md / cc-idea.md trio; uninstall
    // sweeps them via the same per-harness commands directory pass.
    const utilityFiles = UTILITY_COMMAND_FILES.map((u) => u.fileName);
    for (const filename of ["cc.md", "cc-cancel.md", "cc-idea.md", ...utilityFiles]) {
      await removePath(path.join(projectRoot, layout.commandsDir, filename));
    }
    for (const agent of CORE_AGENTS) {
      await removePath(path.join(projectRoot, layout.agentsDir, `${agent.id}.md`));
    }
    await removePath(path.join(projectRoot, layout.skillsDir));
    // v8.55 — remove the harness-namespaced rules file written by
    // `writeHarnessAssets`. For Cursor this is `.cursor/rules/cclaw.mdc`;
    // for the other three it is `.harness/cclaw-rules.md`. The cleanup
    // is idempotent (removePath is force: true).
    await removePath(path.join(projectRoot, layout.rules.path));
    // Tidy empty parent directories the rules file may have been the
    // only inhabitant of (e.g. `.cursor/rules/`). The harness-root
    // directory survives because the user may have other state.
    const rulesParent = path.dirname(path.join(projectRoot, layout.rules.path));
    if (await exists(rulesParent)) {
      const remaining = await fs.readdir(rulesParent);
      if (remaining.length === 0) await removePath(rulesParent);
    }
    if (await exists(path.join(projectRoot, layout.commandsDir))) {
      const remaining = await fs.readdir(path.join(projectRoot, layout.commandsDir));
      if (remaining.length === 0) await removePath(path.join(projectRoot, layout.commandsDir));
    }
    if (await exists(path.join(projectRoot, layout.agentsDir))) {
      const remaining = await fs.readdir(path.join(projectRoot, layout.agentsDir));
      if (remaining.length === 0) await removePath(path.join(projectRoot, layout.agentsDir));
    }
  }
  // v8.40 — scrub the retired `.cclaw/hooks/` directory and per-harness
  // hook-config artefacts. Belt-and-suspenders: uninstall already
  // removes the whole `.cclaw/` tree above (so `.cclaw/hooks/` goes
  // with it), but the per-harness hooks.json / cclaw-plugin.mjs survive
  // outside `.cclaw/` and must be cleaned up explicitly.
  const noop = () => undefined;
  await removeRetiredHookArtefacts(projectRoot, noop);
  await removeGitignorePatterns(projectRoot);
}

export async function upgradeCclaw(options: SyncOptions): Promise<SyncResult> {
  return syncCclaw(options);
}

export function planSeedForSlug(slug: string): string {
  return planTemplateForSlug(slug);
}

/**
 * v8.55 — render the per-harness rules activation guidance block the
 * CLI prints after a successful install. The block names each enabled
 * harness with its native rules path and the action the user has to
 * take (none for Cursor; one-line `@`-reference for the other three).
 *
 * The function takes a list of installed harnesses (the canonical
 * order from {@link HARNESS_IDS}) and returns a multi-line string the
 * caller appends to the install summary. Returning an empty string
 * when there are no harnesses keeps the integration site (cli.ts)
 * simple — it can always concatenate without a guard.
 *
 * Format:
 *
 *   Ambient rules — activation per harness:
 *     • Cursor: rules auto-load from `.cursor/rules/cclaw.mdc` ...
 *     • Claude Code: add `@.claude/cclaw-rules.md` to your CLAUDE.md ...
 *     • Codex: add `@.codex/cclaw-rules.md` to your AGENTS.md ...
 *     • OpenCode: add `@.opencode/cclaw-rules.md` to your AGENTS.md ...
 */
export function renderHarnessRulesGuidance(
  harnesses: readonly HarnessId[]
): string {
  if (harnesses.length === 0) return "";
  const lines = harnesses.map(
    (harness) => `    • ${HARNESS_LAYOUTS[harness].rules.activationHint}`
  );
  return `\n  Ambient rules — activation per harness:\n${lines.join("\n")}\n`;
}

export const HARNESS_LAYOUT_TABLE = HARNESS_LAYOUTS;
export {
  RETIRED_HOOK_FILES,
  RETIRED_HARNESS_HOOK_FILES,
  RETIRED_LIB_DIRS,
  RETIRED_RUNBOOK_FILES
};
