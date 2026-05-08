import fs from "node:fs/promises";
import path from "node:path";
import { slugifyArtifactTopic } from "./artifact-paths.js";
import { exists, listSubdirs } from "./fs-utils.js";
import {
  CANCELLED_DIR_REL_PATH,
  FLOWS_ROOT,
  SHIPPED_DIR_REL_PATH
} from "./constants.js";
import { parseArtifact, type ArtifactFrontmatter } from "./artifact-frontmatter.js";
import type { AcceptanceCriterionState, RoutingClass } from "./types.js";

const STOP_WORDS = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "is", "are",
  "with", "from", "this", "that", "it", "i", "we", "you", "be", "will",
  "make", "do", "have", "has", "should", "could", "would", "can", "let", "let's"
]);

const TRIVIAL_SIGNALS = /(?:typo|rename file|rename function|reformat|format only|fix indent|copy edit|copy-edit|wording|comment fix|wording in)/iu;
const LARGE_SIGNALS = /(?:refactor|migration|architecture|architectur(?:al|y)|multi[- ]component|across (?:the |multiple )|whole (?:project|app|service|backend|frontend)|across services|saga|distributed|threat model|security[- ]critical|payment|auth(?:entication)?|authoriz(?:ation|ation)|gdpr|pci|sso|sensitive data)/iu;

export interface ExistingPlanMatch {
  slug: string;
  origin: "active" | "shipped" | "cancelled";
  filePath: string;
  score: number;
  frontmatter?: ArtifactFrontmatter;
  acProgress?: { committed: number; pending: number; total: number };
  lastSpecialist?: ArtifactFrontmatter["last_specialist"];
  refines?: string | null;
  securityFlag?: boolean;
}

export interface RoutingClassification {
  class: RoutingClass;
  signals: string[];
  notes: string[];
}

export function classifyRouting(task: string): RoutingClassification {
  const text = task.trim();
  const signals: string[] = [];
  const notes: string[] = [];

  if (LARGE_SIGNALS.test(text)) signals.push("large-keyword");
  if (TRIVIAL_SIGNALS.test(text) && text.length < 200) signals.push("trivial-keyword");
  if (text.split(/\s+/u).length > 60) signals.push("long-prompt");
  if (/(\band\b.*){3,}/iu.test(text)) signals.push("multi-and");

  if (signals.includes("large-keyword")) notes.push("matched architectural / sensitive keyword");
  if (signals.includes("multi-and")) notes.push("multiple `and` connectors suggest >1 task");
  if (signals.includes("long-prompt")) notes.push("prompt longer than 60 words");
  if (signals.includes("trivial-keyword")) notes.push("matched trivial keyword");

  if (signals.includes("large-keyword") || signals.includes("multi-and") || signals.includes("long-prompt")) {
    return { class: "large-risky", signals, notes };
  }
  if (signals.includes("trivial-keyword")) {
    return { class: "trivial", signals, notes };
  }
  return { class: "small-medium", signals, notes };
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

function summariseAc(ac?: AcceptanceCriterionState[]): { committed: number; pending: number; total: number } {
  if (!Array.isArray(ac)) return { committed: 0, pending: 0, total: 0 };
  const committed = ac.filter((item) => item.status === "committed").length;
  return { committed, pending: ac.length - committed, total: ac.length };
}

async function tryParseFrontmatter(filePath: string): Promise<ArtifactFrontmatter | null> {
  const raw = await readBody(filePath);
  if (!raw) return null;
  try {
    return parseArtifact(raw, filePath).frontmatter;
  } catch {
    return null;
  }
}

async function buildMatch(
  filePath: string,
  origin: ExistingPlanMatch["origin"],
  taskSlugTokens: Set<string>,
  taskWords: Set<string>
): Promise<ExistingPlanMatch | null> {
  const slug = path.basename(path.dirname(filePath));
  const slugScore = jaccard(taskSlugTokens, new Set(slug.split("-")));
  const body = await readBody(filePath);
  const bodyScore = jaccard(taskWords, tokenize(body));
  const score = Math.max(slugScore, bodyScore);
  const threshold = origin === "active" ? 0.15 : 0.16;
  if (score < threshold) return null;
  const frontmatter = (await tryParseFrontmatter(filePath)) ?? undefined;
  return {
    slug,
    origin,
    filePath,
    score,
    frontmatter,
    acProgress: frontmatter ? summariseAc(frontmatter.ac) : undefined,
    lastSpecialist: frontmatter?.last_specialist ?? null,
    refines: frontmatter?.refines ?? null,
    securityFlag: frontmatter?.security_flag === true
  };
}

const RESERVED_FLOW_DIRS = new Set(["shipped", "cancelled"]);

export async function findMatchingPlans(projectRoot: string, task: string): Promise<ExistingPlanMatch[]> {
  const taskWords = tokenize(task);
  const slugFromTask = slugifyArtifactTopic(task);
  const taskSlugTokens = new Set(slugFromTask.split("-"));

  const matches: ExistingPlanMatch[] = [];

  const flowsRoot = path.join(projectRoot, FLOWS_ROOT);
  if (await exists(flowsRoot)) {
    for (const dir of await listSubdirs(flowsRoot)) {
      const dirName = path.basename(dir);
      if (RESERVED_FLOW_DIRS.has(dirName)) continue;
      const planPath = path.join(dir, "plan.md");
      if (!(await exists(planPath))) continue;
      const match = await buildMatch(planPath, "active", taskSlugTokens, taskWords);
      if (match) matches.push(match);
    }
  }

  const shippedRoot = path.join(projectRoot, SHIPPED_DIR_REL_PATH);
  if (await exists(shippedRoot)) {
    for (const dir of await listSubdirs(shippedRoot)) {
      const planPath = path.join(dir, "plan.md");
      if (!(await exists(planPath))) continue;
      const match = await buildMatch(planPath, "shipped", taskSlugTokens, taskWords);
      if (match) matches.push(match);
    }
  }

  const cancelledRoot = path.join(projectRoot, CANCELLED_DIR_REL_PATH);
  if (await exists(cancelledRoot)) {
    for (const dir of await listSubdirs(cancelledRoot)) {
      const planPath = path.join(dir, "plan.md");
      if (!(await exists(planPath))) continue;
      const match = await buildMatch(planPath, "cancelled", taskSlugTokens, taskWords);
      if (match) matches.push(match);
    }
  }

  return matches.sort((a, b) => b.score - a.score);
}

export interface RoutingProposal {
  classification: RoutingClassification;
  matches: ExistingPlanMatch[];
}

export async function proposeRouting(projectRoot: string, task: string): Promise<RoutingProposal> {
  const classification = classifyRouting(task);
  const matches = await findMatchingPlans(projectRoot, task);
  return { classification, matches };
}
