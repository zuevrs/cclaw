import path from "node:path";
import { FLOWS_ROOT, SHIPPED_DIR_REL_PATH } from "./constants.js";
import type { FlowStage } from "./types.js";

/**
 * v8.58 — `"research"` joins the artifact stage set as the standalone
 * research-mode artifact name. `"research"` is NOT a `FlowStage` token
 * (the flow-state machine does not have a `research` stage — research
 * flows have `triage.path: ["plan"]` as a sentinel and finalise
 * straight from design Phase 7 `accept research` without touching
 * build / review / critic / ship), but the artifact path machinery
 * does need a name for the file. Adding it here lets
 * `activeArtifactPath(projectRoot, "research", slug)` resolve to
 * `.cclaw/flows/<slug>/research.md` without a special case.
 */
export type ArtifactStage = FlowStage | "decisions" | "learnings" | "pre-mortem" | "research";

export const ARTIFACT_FILE_NAMES: Record<ArtifactStage, string> = {
  plan: "plan.md",
  build: "build.md",
  qa: "qa.md",
  review: "review.md",
  critic: "critic.md",
  ship: "ship.md",
  decisions: "decisions.md",
  learnings: "learnings.md",
  "pre-mortem": "pre-mortem.md",
  research: "research.md"
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
