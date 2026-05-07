import fs from "node:fs/promises";
import path from "node:path";
import {
  ACTIVE_ARTIFACT_DIRS,
  type ArtifactStage,
  activeArtifactPath,
  shippedArtifactDir,
  shippedArtifactPath
} from "./artifact-paths.js";
import { KNOWLEDGE_LOG_REL_PATH } from "./constants.js";
import { ensureDir, exists, writeFileSafe } from "./fs-utils.js";
import { readFlowState, resetFlowState, writeFlowState } from "./run-persistence.js";
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
}

export interface CompoundRunResult {
  slug: string;
  shippedDir: string;
  learningCaptured: boolean;
  movedArtifacts: ArtifactStage[];
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

function manifestBody(
  slug: string,
  shipCommit: string,
  ac: AcceptanceCriterionState[],
  moved: ArtifactStage[]
): string {
  const acLines = ac
    .map((item) => `- ${item.id}: ${item.text}${item.commit ? ` (commit ${item.commit})` : ""}`)
    .join("\n");
  const movedLines = moved
    .map((stage) => `- ${stage}.md`)
    .join("\n");
  return `---\nslug: ${slug}\nstatus: shipped\nship_commit: ${shipCommit}\nshipped_at: ${new Date().toISOString()}\n---\n\n# ${slug} — shipped manifest\n\n## Acceptance Criteria\n\n${acLines}\n\n## Artifacts\n\n${movedLines}\n`;
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

  const learningCaptured = shouldCaptureLearning(options.signals);

  if (learningCaptured) {
    const learningPath = activeArtifactPath(projectRoot, "learnings", slug);
    if (!(await exists(learningPath))) {
      const stub = `---\nslug: ${slug}\nstage: learnings\nstatus: active\n---\n\n# ${slug} — learnings\n\n_(orchestrator: replace with the lessons learned: decisions, trade-offs, surprises, follow-ups)._\n`;
      await writeFileSafe(learningPath, stub);
    }

    const knowledgePath = path.join(projectRoot, KNOWLEDGE_LOG_REL_PATH);
    const entry = JSON.stringify({
      slug,
      ship_commit: options.shipCommit,
      shipped_at: new Date().toISOString(),
      signals: options.signals
    });
    if (!(await exists(knowledgePath))) {
      await writeFileSafe(knowledgePath, `${entry}\n`);
    } else {
      await fs.appendFile(knowledgePath, `${entry}\n`, "utf8");
    }
  }

  await writeFlowState(projectRoot, {
    ...state,
    currentStage: "ship"
  });

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
    manifestBody(slug, options.shipCommit, state.ac, moved)
  );

  await resetFlowState(projectRoot);

  return { slug, shippedDir, learningCaptured, movedArtifacts: moved };
}

export async function defaultPathsToCheck(projectRoot: string): Promise<string[]> {
  const out: string[] = [];
  for (const stage of Object.keys(ACTIVE_ARTIFACT_DIRS) as ArtifactStage[]) {
    out.push(path.join(projectRoot, ".cclaw", ACTIVE_ARTIFACT_DIRS[stage]));
  }
  return out;
}
