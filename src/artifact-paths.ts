import path from "node:path";
import { FLOWS_ROOT, SHIPPED_DIR_REL_PATH } from "./constants.js";
import type { FlowStage } from "./types.js";

export type ArtifactStage = FlowStage | "decisions" | "learnings";

export const ARTIFACT_FILE_NAMES: Record<ArtifactStage, string> = {
  plan: "plan.md",
  build: "build.md",
  review: "review.md",
  ship: "ship.md",
  decisions: "decisions.md",
  learnings: "learnings.md"
};

export function slugifyArtifactTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .trim()
    .replace(/[`"'()[\]{}<>]/gu, " ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  return (slug || "task").slice(0, 64);
}

export function activeArtifactDir(projectRoot: string, slug: string): string {
  return path.join(projectRoot, FLOWS_ROOT, slug);
}

export function activeArtifactPath(projectRoot: string, stage: ArtifactStage, slug: string): string {
  return path.join(activeArtifactDir(projectRoot, slug), ARTIFACT_FILE_NAMES[stage]);
}

export function shippedArtifactDir(projectRoot: string, slug: string): string {
  return path.join(projectRoot, SHIPPED_DIR_REL_PATH, slug);
}

export function shippedArtifactPath(projectRoot: string, slug: string, stage: ArtifactStage): string {
  return path.join(shippedArtifactDir(projectRoot, slug), ARTIFACT_FILE_NAMES[stage]);
}
