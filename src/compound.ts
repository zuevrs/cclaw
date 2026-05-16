import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT_FILE_NAMES,
  type ArtifactStage,
  activeArtifactDir,
  activeArtifactPath,
  shippedArtifactDir,
  shippedArtifactPath
} from "./artifact-paths.js";
import { FLOWS_ROOT } from "./constants.js";
import { readConfig } from "./config.js";
import { exists, ensureDir, removePath, writeFileSafe } from "./fs-utils.js";
import { readFlowState, resetFlowState, writeFlowState } from "./run-persistence.js";
import { manifestTemplate, templateBody } from "./content/artifact-templates.js";
import {
  appendKnowledgeEntry,
  findNearDuplicate,
  readKnowledgeLog,
  setOutcomeSignal,
  type KnowledgeEntry,
  type NearDuplicateMatch,
  type NearDuplicateOptions
} from "./knowledge-store.js";
import {
  findManualFixCandidates,
  findRevertedSlugs,
  parseCommitLog,
  parseRevertCommits,
  type ManualFixMatch,
  type RevertedSlugMatch
} from "./outcome-detection.js";
import type { AcceptanceCriterionState } from "./types.js";

export interface CompoundQualitySignals {
  /**
   * Stable signal name kept across the v8.14 rename. Pre-v8.14 it meant
   * "the retired `architect` specialist authored at least one decision in
   * `decisions.md`". v8.14+ it means "the `design` phase (Phase 4 — Decisions)
   * recorded at least one inline `D-N` row in `plan.md > ## Decisions`,
   * OR a legacy `decisions.md` exists on a pre-v8.14 resume". The field name
   * is preserved so shipped frontmatter, `knowledge.jsonl`, and downstream
   * tooling don't need migration.
   */
  hasArchitectDecision: boolean;
  reviewIterations: number;
  securityFlag: boolean;
  userRequestedCapture: boolean;
}

/**
 * synthetic git outputs and overrides for the outcome-loop
 * capture paths. Pass these in tests to make detection deterministic
 * without a live `git` repo; production callers leave the field absent
 * and let `runCompoundAndShip` shell out to the real `git` binary.
 *
 * Field semantics:
 *
 * - `revertGitLog` - the verbatim output of
 *   `git log --grep="^revert" --oneline -30`. When the value is `""`
 *   (empty string), no reverts are detected (different from absent,
 *   which falls through to a live `git` call). Use `""` to disable
 *   revert detection without disabling the rest of the probe object.
 * - `manualFixGitLog` - the verbatim output of a
 *   `git log --oneline --since=<24h-ago>` over the slug's
 *   `touchSurface`. Same `""` semantics as `revertGitLog`.
 * - `manualFixFiles` - a map keyed by SHA listing the files each
 *   commit in `manualFixGitLog` touched. Built upstream from
 *   `git log --name-only --pretty=format:"%H" --since=...`. Absent
 *   keys default to `[]` (no surface match, signal skipped).
 * - `disable` - shortcut to disable BOTH detection paths in tests
 *   that exercise non-outcome-loop behaviour. Equivalent to passing
 *   `revertGitLog: ""` AND `manualFixGitLog: ""`.
 */
export interface CompoundOutcomeProbes {
  revertGitLog?: string;
  manualFixGitLog?: string;
  manualFixFiles?: ReadonlyMap<string, readonly string[]>;
  disable?: true;
}

export interface CompoundRunOptions {
  shipCommit: string;
  signals: CompoundQualitySignals;
  refines?: string | null;
  notes?: string;
  /**
   * Caller-provided union of file/directory paths the slug's AC list touched.
   * The compound layer does not derive this from flow-state because
   * `AcceptanceCriterionState` is intentionally text-only; supply it from
   * plan.md when the orchestrator/CLI invokes `runCompoundAndShip`. Optional;
   * absent leaves dedup to fall back to `tags`-only signature.
   */
  touchSurface?: string[];
  /** Extra tag set (axes / antipattern ids / etc) used by dedup signature. */
  tags?: string[];
  /** Override or disable the near-duplicate scan (e.g. for tests). */
  dedupOptions?: NearDuplicateOptions | { disable: true };
  /**
   * synthetic git probes for the outcome-loop capture paths.
   * Tests pass synthetic strings; production leaves this absent and
   * lets `runCompoundAndShip` invoke the real `git` binary at the
   * project root.
   */
  outcomeProbes?: CompoundOutcomeProbes;
}

export interface CompoundRunResult {
  slug: string;
  shippedDir: string;
  learningCaptured: boolean;
  movedArtifacts: ArtifactStage[];
  knowledgeEntry?: KnowledgeEntry;
  dedupeMatch?: NearDuplicateMatch | null;
  /**
   * outcome signals stamped on prior shipped slugs as a result
   * of revert detection during this compound pass. Empty array when no
   * revert reference matched a known shipped slug, when the probe was
   * disabled, or when no learning was captured this pass.
   */
  revertedSlugMatches?: RevertedSlugMatch[];
  /**
   * manual-fix candidates detected against THIS slug's
   * `touchSurface` in the trailing 24h window. The first match (when
   * any) is what `outcome_signal: "manual-fix"` was stamped from; the
   * array is surfaced for audit / test visibility.
   */
  manualFixMatches?: ManualFixMatch[];
}

export class CompoundError extends Error {}

export function shouldCaptureLearning(signals: CompoundQualitySignals): boolean {
  if (signals.userRequestedCapture) return true;
  if (signals.hasArchitectDecision) return true;
  if (signals.reviewIterations >= 3) return true;
  if (signals.securityFlag) return true;
  return false;
}

/**
 * run `git log` for the revert-detection probe. Best-effort:
 * a missing `.git/`, a binary that's not on PATH, or a non-zero exit
 * code degrades to `""` (no detection). We never throw - compound
 * MUST NOT fail because the outcome-loop probe couldn't run.
 */
function runRevertProbe(projectRoot: string): string {
  if (!gitAvailable(projectRoot)) return "";
  try {
    return execFileSync(
      "git",
      ["log", "--grep=^revert", "--oneline", "-30", "-i"],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    return "";
  }
}

/**
 * run `git log` for the manual-fix probe. Same best-effort
 * rules as {@link runRevertProbe}; an empty `touchSurface` short-
 * circuits the call so we don't pull the whole repo's last-24h log
 * when the slug never declared a surface.
 *
 * Returns `{ log, files }`:
 *
 * - `log` is the `--oneline` shape the {@link parseCommitLog} helper
 *   parses.
 * - `files` is the per-SHA touched-files map the
 *   {@link findManualFixCandidates} helper needs to confirm a
 *   commit hit the slug's surface. Built from a second `git log
 *   --name-only --pretty=format:"%H"` call so the two outputs share
 *   the same set of commits.
 */
function runManualFixProbe(
  projectRoot: string,
  touchSurface: readonly string[]
): { log: string; files: Map<string, string[]> } {
  if (!gitAvailable(projectRoot) || touchSurface.length === 0) {
    return { log: "", files: new Map() };
  }
  let oneline = "";
  let nameOnly = "";
  try {
    oneline = execFileSync(
      "git",
      ["log", "--oneline", "--since=24 hours ago", "-50"],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    return { log: "", files: new Map() };
  }
  try {
    nameOnly = execFileSync(
      "git",
      ["log", "--name-only", "--pretty=format:%H", "--since=24 hours ago", "-50"],
      { cwd: projectRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }
    );
  } catch {
    return { log: oneline, files: new Map() };
  }
  return { log: oneline, files: parseNameOnlyLog(nameOnly) };
}

/**
 * parse `git log --name-only --pretty=format:%H` output into a
 * per-SHA file map. The format alternates SHA lines with file-list
 * lines separated by blank lines; this is the shape git emits when
 * `--name-only` is paired with a custom pretty-format.
 *
 * Exported only via internal use; the parsing is fragile enough that
 * tests for it live alongside the integration tests rather than as a
 * separately-exported helper.
 */
function parseNameOnlyLog(raw: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  if (typeof raw !== "string" || raw.length === 0) return out;
  let currentSha: string | null = null;
  for (const line of raw.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      currentSha = null;
      continue;
    }
    if (currentSha === null) {
      currentSha = trimmed;
      if (!out.has(currentSha)) out.set(currentSha, []);
      continue;
    }
    const bucket = out.get(currentSha);
    if (bucket) bucket.push(trimmed);
  }
  return out;
}

/**
 * does `<projectRoot>/.git/` exist? Cheap pre-check so we
 * don't spawn `git` on plain working trees (the no-git path).
 */
function gitAvailable(projectRoot: string): boolean {
  try {
    return existsSync(path.join(projectRoot, ".git"));
  } catch {
    return false;
  }
}

async function moveIfExists(source: string, destination: string): Promise<boolean> {
  if (!(await exists(source))) return false;
  await ensureDir(path.dirname(destination));
  await fs.rename(source, destination);
  return true;
}

function renderManifest(
  slug: string,
  shipCommit: string,
  shippedAt: string,
  ac: AcceptanceCriterionState[],
  moved: ArtifactStage[],
  refines?: string | null
): string {
  const base = manifestTemplate(slug, shipCommit, shippedAt);
  const acLines = ac
    .map((item) => `- ${item.id}: ${item.text}${item.commit ? ` (commit ${item.commit})` : ""}`)
    .join("\n");
  const movedLines = moved.map((stage) => `- ${ARTIFACT_FILE_NAMES[stage]}`).join("\n");
  const refinesBlock = refines
    ? `## Refines\n\nThis run refines [${refines}](../${refines}/manifest.md).\n`
    : "";
  return base
    .replace(/## Acceptance Criteria[\s\S]*?(?=\n## Artifacts)/u, `## Acceptance Criteria\n\n${acLines}\n\n`)
    .replace(/## Artifacts[\s\S]*?(?=\n## Refines)/u, `## Artifacts\n\n${movedLines}\n\n`)
    .replace(/## Refines[\s\S]*?(?=\n## Knowledge index)/u, refinesBlock || `## Refines\n\n_None._\n\n`);
}

/**
 * default: append a shipped-frontmatter block + Artefact index section
 * to the existing `ship.md` so its frontmatter carries everything the old
 * `manifest.md` did. We do not rewrite the body — `slice-builder` and the
 * orchestrator authored the AC↔commit map and Summary section earlier;
 * we only ensure the frontmatter is stamped and an "## Artefact index"
 * section exists at the bottom.
 */
async function stampShipFrontmatter(
  shippedDir: string,
  slug: string,
  shipCommit: string,
  shippedAt: string,
  signals: CompoundQualitySignals,
  acCount: number,
  moved: ArtifactStage[],
  refines: string | null | undefined,
  legacyArtifacts: boolean,
  extraMoved: string[] = []
): Promise<void> {
  const shipPath = path.join(shippedDir, "ship.md");
  if (!(await exists(shipPath))) {
    // ship.md was never authored by the orchestrator (rare; usually hop-6
    // refused to advance). Synthesize a minimal one so the manifest data
    // still survives in a single artefact.
    const minimal = `---
slug: ${slug}
stage: shipped
status: shipped
ship_commit: ${shipCommit}
shipped_at: ${shippedAt}
ac_count: ${acCount}
review_iterations: ${signals.reviewIterations}
security_flag: ${signals.securityFlag}
has_architect_decision: ${signals.hasArchitectDecision}
${refines ? `refines: ${refines}\n` : ""}---

# ${slug} — shipped

_(ship.md was not authored before finalize; minimal stub written by compound.)_

## Artefact index

${moved.map((stage) => `- ${ARTIFACT_FILE_NAMES[stage]}`).join("\n")}${
      extraMoved.length > 0
        ? "\n" + extraMoved.map((name) => `- ${name}`).join("\n")
        : ""
    }
${legacyArtifacts ? "- manifest.md (legacy-artifacts opt-in)" : ""}
`;
    await writeFileSafe(shipPath, minimal);
    return;
  }
  const raw = await fs.readFile(shipPath, "utf8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/u);
  let fmBody: string;
  let docBody: string;
  if (fmMatch) {
    fmBody = fmMatch[1]!;
    docBody = fmMatch[2]!;
  } else {
    // Body-only ship.md (no frontmatter): synthesise a minimal
    // frontmatter so the manifest data is captured. We never silently
    // discard the existing body.
    fmBody = `slug: ${slug}\nstage: ship\nstatus: active`;
    docBody = `\n${raw}`;
  }

  const stampedFm = fmBody
    .replace(/^stage:\s*.*$/m, "stage: shipped")
    .replace(/^status:\s*.*$/m, "status: shipped");
  const augment: Record<string, string | number | boolean | null> = {
    ship_commit: shipCommit,
    shipped_at: shippedAt,
    ac_count: acCount,
    review_iterations: signals.reviewIterations,
    security_flag: signals.securityFlag,
    has_architect_decision: signals.hasArchitectDecision
  };
  if (refines) augment.refines = refines;
  let nextFm = stampedFm;
  for (const [key, value] of Object.entries(augment)) {
    if (new RegExp(`^${key}:`, "m").test(nextFm)) {
      nextFm = nextFm.replace(new RegExp(`^${key}:.*$`, "m"), `${key}: ${value}`);
    } else {
      nextFm = `${nextFm}\n${key}: ${value}`;
    }
  }

  const knownLines = moved.map((stage) => `- ${ARTIFACT_FILE_NAMES[stage]}`).join("\n");
  const extraLines =
    extraMoved.length > 0 ? "\n" + extraMoved.map((name) => `- ${name}`).join("\n") : "";
  const legacyLine = legacyArtifacts ? "\n- manifest.md (legacy-artifacts opt-in)" : "";
  const indexSection = `\n\n## Artefact index\n\n${knownLines}${extraLines}${legacyLine}\n`;
  const bodyHasIndex = /^## Artefact index$/m.test(docBody);
  const nextBody = bodyHasIndex
    ? docBody
    : `${docBody.replace(/\n+$/u, "")}${indexSection}`;

  await writeFileSafe(shipPath, `---\n${nextFm}\n---\n${nextBody}`);
}

export async function runCompoundAndShip(
  projectRoot: string,
  options: CompoundRunOptions
): Promise<CompoundRunResult> {
  const state = await readFlowState(projectRoot);
  if (!state.currentSlug) throw new CompoundError("No active slug; cannot ship.");
  const slug = state.currentSlug;

  const shippedAt = new Date().toISOString();
  const learningCaptured = shouldCaptureLearning(options.signals);

  let knowledgeEntry: KnowledgeEntry | undefined;
  let dedupeMatch: NearDuplicateMatch | null = null;
  if (learningCaptured) {
    const learningPath = activeArtifactPath(projectRoot, "learnings", slug);
    if (!(await exists(learningPath))) {
      await writeFileSafe(learningPath, templateBody("learnings", { "SLUG-PLACEHOLDER": slug }));
    }
    const baseEntry: KnowledgeEntry = {
      slug,
      ship_commit: options.shipCommit,
      shipped_at: shippedAt,
      signals: { ...options.signals },
      refines: options.refines ?? null,
      notes: options.notes,
      touchSurface: options.touchSurface,
      tags: options.tags
    };
    const dedupOpts = options.dedupOptions;
    if (dedupOpts && "disable" in dedupOpts && dedupOpts.disable) {
      dedupeMatch = null;
    } else {
      dedupeMatch = await findNearDuplicate(
        projectRoot,
        baseEntry,
        dedupOpts && !("disable" in dedupOpts) ? dedupOpts : {}
      );
    }
    knowledgeEntry = dedupeMatch ? { ...baseEntry, dedupeOf: dedupeMatch.entry.slug } : baseEntry;
    await appendKnowledgeEntry(projectRoot, knowledgeEntry);
  }

  // entry is appended (so the manual-fix path can stamp its own
  // entry) but BEFORE the artifact move (so a downstream `readKnowledgeLog`
  // sees the stamped signal immediately). We don't capture
  // follow-up-bug here - that path runs at fresh-slug-start, not at
  // ship-compound. See `src/content/start-command.ts` for the
  // orchestrator wiring of #3b.
  const { revertedSlugMatches, manualFixMatches } = await captureOutcomeSignals(
    projectRoot,
    slug,
    options.touchSurface ?? [],
    options.outcomeProbes,
    shippedAt
  );

  await writeFlowState(projectRoot, { ...state, currentStage: "ship" });

  const shippedDir = shippedArtifactDir(projectRoot, slug);
  await ensureDir(shippedDir);

  const moved: ArtifactStage[] = [];
  const allStages: ArtifactStage[] = [
    "plan",
    "build",
    "review",
    "ship",
    "decisions",
    "learnings",
    "pre-mortem"
  ];
  const knownArtifactFileNames = new Set<string>();
  for (const stage of allStages) {
    const source = activeArtifactPath(projectRoot, stage, slug);
    const destination = shippedArtifactPath(projectRoot, slug, stage);
    if (await moveIfExists(source, destination)) moved.push(stage);
    knownArtifactFileNames.add(ARTIFACT_FILE_NAMES[stage]);
  }

  // T0-10: scan the active dir for any *additional* artifacts the slug emitted
  // (research-repo.md, research-learnings.md on legacy mode, cancel.md, future
  // handoff.json / continue-here.md, hooks output, etc.) and move them too.
  // Without this, those files stay behind in the active dir and become orphans
  // when flow-state resets. The fixed `allStages` list above covers the
  // canonical 7 artefact ids; the scan covers everything else by name.
  const extraMoved: string[] = [];
  const activeDir = activeArtifactDir(projectRoot, slug);
  if (await exists(activeDir)) {
    const entries = await fs.readdir(activeDir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (knownArtifactFileNames.has(entry.name)) continue;
      const source = path.join(activeDir, entry.name);
      const destination = path.join(shippedDir, entry.name);
      if (await moveIfExists(source, destination)) extraMoved.push(entry.name);
    }
  }

  const config = await readConfig(projectRoot);
  const legacyArtifacts = Boolean(config?.legacyArtifacts);

  await stampShipFrontmatter(
    shippedDir,
    slug,
    options.shipCommit,
    shippedAt,
    options.signals,
    state.ac.length,
    moved,
    options.refines ?? null,
    legacyArtifacts,
    extraMoved
  );

  if (legacyArtifacts) {
    await writeFileSafe(
      path.join(shippedDir, "manifest.md"),
      renderManifest(slug, options.shipCommit, shippedAt, state.ac, moved, options.refines)
    );
  }

  if (await exists(activeDir)) {
    const remaining = await fs.readdir(activeDir);
    if (remaining.length === 0) await removePath(activeDir);
  }

  await resetFlowState(projectRoot);

  return {
    slug,
    shippedDir,
    learningCaptured,
    movedArtifacts: moved,
    knowledgeEntry,
    dedupeMatch,
    revertedSlugMatches,
    manualFixMatches
  };
}

/**
 * run revert-detection and manual-fix-detection against the
 * just-shipped slug. Stamps `outcome_signal` via `setOutcomeSignal`
 * on every match found.
 *
 * Returns `{ revertedSlugMatches, manualFixMatches }` so the caller
 * can surface the matches in {@link CompoundRunResult} for audit /
 * test visibility. Empty arrays when probes are disabled OR when
 * `knowledge.jsonl` is empty (no entries to stamp against).
 *
 * Failure handling: this function MUST NOT throw. If a probe call
 * fails (git missing, jsonl unreadable, setOutcomeSignal write
 * fails) the loop continues and the caller sees an empty match
 * list. The outcome loop is additive telemetry; compound's primary
 * contract (move artifacts, reset flow-state) is sacrosanct.
 */
async function captureOutcomeSignals(
  projectRoot: string,
  currentSlug: string,
  touchSurface: readonly string[],
  probes: CompoundOutcomeProbes | undefined,
  shippedAt: string
): Promise<{ revertedSlugMatches: RevertedSlugMatch[]; manualFixMatches: ManualFixMatch[] }> {
  if (probes?.disable === true) {
    return { revertedSlugMatches: [], manualFixMatches: [] };
  }
  let shippedSlugs: string[] = [];
  try {
    const entries = await readKnowledgeLog(projectRoot);
    shippedSlugs = entries.map((entry) => entry.slug);
  } catch {
    return { revertedSlugMatches: [], manualFixMatches: [] };
  }
  if (shippedSlugs.length === 0) {
    return { revertedSlugMatches: [], manualFixMatches: [] };
  }

  // Revert detection - matches reverts in the trailing git log to
  // prior shipped slugs in knowledge.jsonl. The new entry we just
  // appended is excluded by construction: a slug cannot revert
  // itself (the revert commit would have to predate the slug's own
  // ship, which is impossible in a single timeline).
  let revertLog: string;
  if (probes?.revertGitLog !== undefined) {
    revertLog = probes.revertGitLog;
  } else {
    revertLog = runRevertProbe(projectRoot);
  }
  const reverts = parseRevertCommits(revertLog);
  const revertedSlugMatches = findRevertedSlugs(
    reverts,
    shippedSlugs.filter((slug) => slug !== currentSlug)
  );
  for (const match of revertedSlugMatches) {
    try {
      await setOutcomeSignal(projectRoot, match.slug, "reverted", match.source, shippedAt);
    } catch {
      // Swallow per-entry write failures so one bad row doesn't kill
      // the loop. The matches array still surfaces the attempted
      // stamp for audit.
    }
  }

  // Manual-fix detection - looks at THIS slug's touchSurface for
  // post-ship fix(AC-N) / hotfix-shape commits in the trailing 24h.
  // Self-reporting (the slug we just shipped marks itself), which is
  // the honest-but-noisy default - see the CHANGELOG entry's
  // limitations section.
  let manualFixLog: string;
  let manualFixFiles: ReadonlyMap<string, readonly string[]>;
  if (probes?.manualFixGitLog !== undefined) {
    manualFixLog = probes.manualFixGitLog;
    manualFixFiles = probes.manualFixFiles ?? new Map();
  } else {
    const probe = runManualFixProbe(projectRoot, touchSurface);
    manualFixLog = probe.log;
    manualFixFiles = probe.files;
  }
  const commits = parseCommitLog(manualFixLog);
  const manualFixMatches = findManualFixCandidates(commits, touchSurface, manualFixFiles);
  if (manualFixMatches[0]) {
    const first = manualFixMatches[0];
    try {
      await setOutcomeSignal(projectRoot, currentSlug, "manual-fix", first.source, shippedAt);
    } catch {
      // Same swallow rationale as the revert loop above.
    }
  }

  return { revertedSlugMatches, manualFixMatches };
}

export async function defaultPathsToCheck(projectRoot: string): Promise<string[]> {
  return [path.join(projectRoot, FLOWS_ROOT)];
}
