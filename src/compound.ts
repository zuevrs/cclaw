import fs from "node:fs/promises";
import path from "node:path";
import {
  ACTIVE_ARTIFACT_DIRS,
  type ArtifactStage,
  activeArtifactPath,
  shippedArtifactDir,
  shippedArtifactPath
} from "./artifact-paths.js";
import { exists, ensureDir, writeFileSafe } from "./fs-utils.js";
import { readFlowState, resetFlowState, writeFlowState } from "./run-persistence.js";
import { manifestTemplate, templateBody } from "./content/artifact-templates.js";
import { appendKnowledgeEntry, type KnowledgeEntry } from "./knowledge-store.js";
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
}

export interface CompoundRunResult {
  slug: string;
  shippedDir: string;
  learningCaptured: boolean;
  movedArtifacts: ArtifactStage[];
  knowledgeEntry?: KnowledgeEntry;
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
  const stageFiles: Record<ArtifactStage, string> = {
    plan: "plan.md",
    build: "build.md",
    review: "review.md",
    ship: "ship.md",
    decisions: "decisions.md",
    learnings: "learnings.md"
  };
  const movedLines = moved.map((stage) => `- ${stageFiles[stage]}`).join("\n");
  const refinesBlock = refines
    ? `## Refines\n\nThis run refines [${refines}](../${refines}/manifest.md).\n`
    : "";
  return base
    .replace(/## Acceptance Criteria[\s\S]*?(?=\n## Artifacts)/u, `## Acceptance Criteria\n\n${acLines}\n\n`)
    .replace(/## Artifacts[\s\S]*?(?=\n## Refines)/u, `## Artifacts\n\n${movedLines}\n\n`)
    .replace(/## Refines[\s\S]*?(?=\n## Knowledge index)/u, refinesBlock || `## Refines\n\n_None._\n\n`);
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
  if (learningCaptured) {
    const learningPath = activeArtifactPath(projectRoot, "learnings", slug);
    if (!(await exists(learningPath))) {
      await writeFileSafe(learningPath, templateBody("learnings", { "SLUG-PLACEHOLDER": slug }));
    }
    knowledgeEntry = {
      slug,
      ship_commit: options.shipCommit,
      shipped_at: shippedAt,
      signals: { ...options.signals },
      refines: options.refines ?? null,
      notes: options.notes
    };
    await appendKnowledgeEntry(projectRoot, knowledgeEntry);
  }

  await writeFlowState(projectRoot, { ...state, currentStage: "ship" });

  const shippedDir = shippedArtifactDir(projectRoot, slug);
  await ensureDir(shippedDir);

  const moved: ArtifactStage[] = [];
  const allStages: ArtifactStage[] = ["plan", "build", "review", "ship", "decisions", "learnings"];
  for (const stage of allStages) {
    const source = activeArtifactPath(projectRoot, stage, slug);
    const destination = shippedArtifactPath(projectRoot, slug, stage);
    if (await moveIfExists(source, destination)) moved.push(stage);
  }

  await writeFileSafe(
    path.join(shippedDir, "manifest.md"),
    renderManifest(slug, options.shipCommit, shippedAt, state.ac, moved, options.refines)
  );

  await resetFlowState(projectRoot);

  return { slug, shippedDir, learningCaptured, movedArtifacts: moved, knowledgeEntry };
}

export async function defaultPathsToCheck(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const stage of Object.keys(ACTIVE_ARTIFACT_DIRS) as ArtifactStage[]) {
    out.push(path.join(projectRoot, ".cclaw", ACTIVE_ARTIFACT_DIRS[stage]));
  }
  return out;
}
