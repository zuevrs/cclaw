import path from "node:path";
import {
  BUILD_DIR,
  DECISION_DIR,
  LEARNING_DIR,
  PLAN_DIR,
  REVIEW_DIR,
  RUNTIME_ROOT,
  SHIPPED_DIR_REL_PATH,
  SHIP_DIR
} from "./constants.js";
import type { FlowStage } from "./types.js";

export type ArtifactStage = FlowStage | "decisions" | "learnings";

export const ACTIVE_ARTIFACT_DIRS: Record<ArtifactStage, string> = {
  plan: PLAN_DIR,
  build: BUILD_DIR,
  review: REVIEW_DIR,
  ship: SHIP_DIR,
  decisions: DECISION_DIR,
  learnings: LEARNING_DIR
};

export const SHIPPED_ARTIFACT_FILES: Record<ArtifactStage, string> = {
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

export function activeArtifactDir(projectRoot: string, stage: ArtifactStage): string {
  return path.join(projectRoot, RUNTIME_ROOT, ACTIVE_ARTIFACT_DIRS[stage]);
}

export function activeArtifactPath(projectRoot: string, stage: ArtifactStage, slug: string): string {
  return path.join(activeArtifactDir(projectRoot, stage), `${slug}.md`);
}

export function shippedArtifactDir(projectRoot: string, slug: string): string {
  return path.join(projectRoot, SHIPPED_DIR_REL_PATH, slug);
}

export function shippedArtifactPath(projectRoot: string, slug: string, stage: ArtifactStage): string {
  return path.join(shippedArtifactDir(projectRoot, slug), SHIPPED_ARTIFACT_FILES[stage]);
}
