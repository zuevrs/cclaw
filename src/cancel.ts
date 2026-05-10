import fs from "node:fs/promises";
import path from "node:path";
import {
  ARTIFACT_FILE_NAMES,
  type ArtifactStage,
  activeArtifactDir,
  activeArtifactPath
} from "./artifact-paths.js";
import { CANCELLED_DIR_REL_PATH } from "./constants.js";
import { readConfig } from "./config.js";
import { ensureDir, exists, removePath, writeFileSafe } from "./fs-utils.js";
import { syncFrontmatter } from "./artifact-frontmatter.js";
import { readFlowState, resetFlowState } from "./run-persistence.js";
import type { FlowStage } from "./types.js";

export interface CancelOptions {
  reason?: string;
  cancelledAt?: string;
}

export interface CancelResult {
  slug: string;
  cancelledDir: string;
  movedArtifacts: ArtifactStage[];
  reason: string;
}

export class CancelError extends Error {}

export function cancelledArtifactDir(projectRoot: string, slug: string): string {
  return path.join(projectRoot, CANCELLED_DIR_REL_PATH, slug);
}

async function moveIfExists(source: string, destination: string): Promise<boolean> {
  if (!(await exists(source))) return false;
  await ensureDir(path.dirname(destination));
  await fs.rename(source, destination);
  return true;
}

const ALL_STAGES: ArtifactStage[] = ["plan", "build", "review", "ship", "decisions", "learnings"];

export async function cancelActiveRun(
  projectRoot: string,
  options: CancelOptions = {}
): Promise<CancelResult> {
  const state = await readFlowState(projectRoot);
  if (!state.currentSlug) {
    throw new CancelError("No active slug; nothing to cancel.");
  }
  const slug = state.currentSlug;
  const reason = options.reason?.trim() || "user cancelled";
  const cancelledAt = options.cancelledAt ?? new Date().toISOString();

  for (const stage of ["plan", "build", "review", "ship"] as FlowStage[]) {
    const filePath = activeArtifactPath(projectRoot, stage, slug);
    if (await exists(filePath)) {
      try {
        await syncFrontmatter(projectRoot, slug, stage, {});
      } catch {
        // ignore frontmatter parse errors during cancel; we still move the file
      }
    }
  }

  const target = cancelledArtifactDir(projectRoot, slug);
  await ensureDir(target);

  const moved: ArtifactStage[] = [];
  for (const stage of ALL_STAGES) {
    const source = activeArtifactPath(projectRoot, stage, slug);
    const destination = path.join(target, ARTIFACT_FILE_NAMES[stage]);
    if (await moveIfExists(source, destination)) moved.push(stage);
  }

  const cancelArtifact = `---\nslug: ${slug}\nstage: cancelled\nstatus: cancelled\ncancelled_at: ${cancelledAt}\nreason: ${JSON.stringify(reason)}\n---\n\n# ${slug} — cancelled\n\n${reason}\n\n## Artifacts\n\n${moved.map((stage) => `- ${ARTIFACT_FILE_NAMES[stage]}`).join("\n") || "_No artifacts were active at cancel time._"}\n`;
  // v8.12 default: cancellation receipt lives in `cancel.md` (the "manifest"
  // concept is reserved for shipped slugs, and ship's manifest is now
  // collapsed into `ship.md` frontmatter). Users on `legacyArtifacts: true`
  // still get the file under the old `manifest.md` name for back-compat.
  const config = await readConfig(projectRoot);
  const legacyArtifacts = Boolean(config?.legacyArtifacts);
  const fileName = legacyArtifacts ? "manifest.md" : "cancel.md";
  await writeFileSafe(path.join(target, fileName), cancelArtifact);

  const activeDir = activeArtifactDir(projectRoot, slug);
  if (await exists(activeDir)) {
    const remaining = await fs.readdir(activeDir);
    if (remaining.length === 0) await removePath(activeDir);
  }

  await resetFlowState(projectRoot);

  return { slug, cancelledDir: target, movedArtifacts: moved, reason };
}

export async function listCancelled(projectRoot: string): Promise<string[]> {
  const dir = path.join(projectRoot, CANCELLED_DIR_REL_PATH);
  if (!(await exists(dir))) return [];
  const entries = await fs.readdir(dir, { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}
