import fs from "node:fs/promises";
import path from "node:path";
import { activeArtifactDir, slugifyArtifactTopic } from "./artifact-paths.js";
import { exists, listMarkdownFiles, listSubdirs } from "./fs-utils.js";
import { SHIPPED_DIR_REL_PATH } from "./constants.js";
import type { RoutingClass } from "./types.js";

const STOP_WORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are",
  "with", "from", "this", "that", "it", "i", "we", "you", "be", "will",
  "make", "do", "have", "has", "should", "could", "would", "can", "let", "let's"
]);

const TRIVIAL_SIGNALS = /(?:typo|rename file|rename function|reformat|format only|fix indent|copy edit|copy-edit|wording|comment fix|wording in)/iu;
const LARGE_SIGNALS = /(?:refactor|migration|architecture|architectur(?:al|y)|multi[- ]component|across (?:the |multiple )|whole (?:project|app|service|backend|frontend)|across services|saga|distributed|threat model|security[- ]critical|payment|auth(?:entication)?|authoriz(?:ation|ation)|gdpr|pci|sso|sensitive data)/iu;

export interface ExistingPlanMatch {
  slug: string;
  origin: "active" | "shipped";
  filePath: string;
  score: number;
}

export interface RoutingClassification {
  class: RoutingClass;
  signals: string[];
}

export function classifyRouting(task: string): RoutingClassification {
  const text = task.trim();
  const signals: string[] = [];

  if (LARGE_SIGNALS.test(text)) signals.push("large-keyword");
  if (TRIVIAL_SIGNALS.test(text) && text.length < 200) signals.push("trivial-keyword");
  if (text.split(/\s+/u).length > 60) signals.push("long-prompt");
  if (/(\band\b.*){3,}/iu.test(text)) signals.push("multi-and");

  if (signals.includes("large-keyword") || signals.includes("multi-and") || signals.includes("long-prompt")) {
    return { class: "large-risky", signals };
  }
  if (signals.includes("trivial-keyword")) {
    return { class: "trivial", signals };
  }
  return { class: "small-medium", signals };
}

function tokenize(value: string, limit = 4096): Set<string> {
  return new Set(
    value
      .slice(0, limit)
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/gu, " ")
      .split(/\s+/u)
      .map((part) => part.trim())
      .filter((part) => part.length > 2 && !STOP_WORDS.has(part))
  );
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) if (right.has(value)) intersection += 1;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

async function readBody(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

export async function findMatchingPlans(projectRoot: string, task: string): Promise<ExistingPlanMatch[]> {
  const taskWords = tokenize(task);
  const slugFromTask = slugifyArtifactTopic(task);
  const taskSlugTokens = new Set(slugFromTask.split("-"));

  const matches: ExistingPlanMatch[] = [];

  const activeDir = activeArtifactDir(projectRoot, "plan");
  for (const filePath of await listMarkdownFiles(activeDir)) {
    const slug = path.basename(filePath, ".md");
    const slugScore = jaccard(taskSlugTokens, new Set(slug.split("-")));
    const bodyScore = jaccard(taskWords, tokenize(await readBody(filePath)));
    const score = Math.max(slugScore, bodyScore);
    if (score > 0.18) matches.push({ slug, origin: "active", filePath, score });
  }

  const shippedRoot = path.join(projectRoot, SHIPPED_DIR_REL_PATH);
  if (await exists(shippedRoot)) {
    for (const dir of await listSubdirs(shippedRoot)) {
      const planPath = path.join(dir, "plan.md");
      if (!(await exists(planPath))) continue;
      const slug = path.basename(dir);
      const slugScore = jaccard(taskSlugTokens, new Set(slug.split("-")));
      const bodyScore = jaccard(taskWords, tokenize(await readBody(planPath)));
      const score = Math.max(slugScore, bodyScore);
      if (score > 0.22) matches.push({ slug, origin: "shipped", filePath: planPath, score });
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}
