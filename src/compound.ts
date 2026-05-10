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
  type KnowledgeEntry,
  type NearDuplicateMatch,
  type NearDuplicateOptions
} from "./knowledge-store.js";
import type { AcceptanceCriterionState } from "./types.js";

export interface CompoundQualitySignals {
  hasArchitectDecision: boolean;
  reviewIterations: number;
  securityFlag: boolean;
  userRequestedCapture: boolean;
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
}

export interface CompoundRunResult {
  slug: string;
  shippedDir: string;
  learningCaptured: boolean;
  movedArtifacts: ArtifactStage[];
  knowledgeEntry?: KnowledgeEntry;
  dedupeMatch?: NearDuplicateMatch | null;
}

export class CompoundError extends Error {}

export function shouldCaptureLearning(signals: CompoundQualitySignals): boolean {
  if (signals.userRequestedCapture) return true;
  if (signals.hasArchitectDecision) return true;
  if (signals.reviewIterations >= 3) return true;
  if (signals.securityFlag) return true;
  return false;
}

function pendingAc(ac: AcceptanceCriterionState[]): AcceptanceCriterionState[] {
  return ac.filter((item) => item.status !== "committed");
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
 * v8.12 default: append a shipped-frontmatter block + Artefact index section
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
  legacyArtifacts: boolean
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

${moved.map((stage) => `- ${ARTIFACT_FILE_NAMES[stage]}`).join("\n")}
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

  const indexSection = `\n\n## Artefact index\n\n${moved
    .map((stage) => `- ${ARTIFACT_FILE_NAMES[stage]}`)
    .join("\n")}${legacyArtifacts ? "\n- manifest.md (legacy-artifacts opt-in)" : ""}\n`;
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

  const pending = pendingAc(state.ac);
  if (pending.length > 0) {
    throw new CompoundError(
      `Cannot ship ${slug}: AC traceability gate failed. Pending AC: ${pending.map((item) => item.id).join(", ")}.`
    );
  }

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
  for (const stage of allStages) {
    const source = activeArtifactPath(projectRoot, stage, slug);
    const destination = shippedArtifactPath(projectRoot, slug, stage);
    if (await moveIfExists(source, destination)) moved.push(stage);
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
    legacyArtifacts
  );

  if (legacyArtifacts) {
    await writeFileSafe(
      path.join(shippedDir, "manifest.md"),
      renderManifest(slug, options.shipCommit, shippedAt, state.ac, moved, options.refines)
    );
  }

  const activeDir = activeArtifactDir(projectRoot, slug);
  if (await exists(activeDir)) {
    const remaining = await fs.readdir(activeDir);
    if (remaining.length === 0) await removePath(activeDir);
  }

  await resetFlowState(projectRoot);

  return { slug, shippedDir, learningCaptured, movedArtifacts: moved, knowledgeEntry, dedupeMatch };
}

export async function defaultPathsToCheck(projectRoot: string): Promise<string[]> {
  return [path.join(projectRoot, FLOWS_ROOT)];
}
