import fs from "node:fs/promises";
import path from "node:path";
import { RUNTIME_ROOT } from "./constants.js";
import { exists } from "./fs-utils.js";

export interface TraceEntry {
  criterionId: string;
  taskIds: string[];
  testSlices: string[];
  reviewFindings: string[];
}

export interface TraceMatrix {
  entries: TraceEntry[];
  orphanedCriteria: string[];
  orphanedTasks: string[];
  orphanedTests: string[];
}

function activeArtifactPath(projectRoot: string, name: string): string {
  return path.join(projectRoot, RUNTIME_ROOT, "artifacts", name);
}

async function readArtifact(projectRoot: string, name: string): Promise<string | null> {
  const candidate = activeArtifactPath(projectRoot, name);
  if (await exists(candidate)) {
    return fs.readFile(candidate, "utf8");
  }
  return null;
}

function uniqPreserve(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

function criterionTokens(text: string): string[] {
  return text.match(/\bAC-\d+\b/g) ?? [];
}

/** AC-1, AC-12, etc. */
function parseAcceptanceCriterionIds(specMd: string): string[] {
  return uniqPreserve(criterionTokens(specMd));
}

/** Map task id -> AC ids mentioned on same table row or bullet line as the task. */
function parsePlanTaskAcLinks(planMd: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const lines = planMd.split(/\r?\n/);
  const taskRe = /\b(T-\d+)\b/;
  const acRe = /\b(AC-\d+)\b/g;

  for (const line of lines) {
    const tm = taskRe.exec(line);
    if (!tm) {
      continue;
    }
    const taskId = tm[1]!;
    const acs = [...line.matchAll(acRe)].map((m) => m[0]!);
    if (acs.length === 0) {
      continue;
    }
    const prev = map.get(taskId) ?? [];
    map.set(taskId, uniqPreserve([...prev, ...acs]));
  }
  return map;
}

/** All T-N ids appearing in the plan (best-effort). */
function parsePlanTaskIds(planMd: string): string[] {
  const re = /\bT-\d+\b/g;
  return uniqPreserve(planMd.match(re) ?? []);
}

/** Map slice id -> task ids on same line. */
function parseTddSliceTaskLinks(tddMd: string): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const sliceRe = /\b(S-\d+)\b/g;
  const taskRe = /\b(T-\d+)\b/g;
  const lines = tddMd.split(/\r?\n/);

  for (const line of lines) {
    const slices = [...line.matchAll(sliceRe)].map((m) => m[1]!);
    if (slices.length === 0) {
      continue;
    }
    const tasks = [...line.matchAll(taskRe)].map((m) => m[1]!);
    for (const s of slices) {
      const prev = map.get(s) ?? [];
      map.set(s, uniqPreserve([...prev, ...tasks]));
    }
  }
  return map;
}

function parseTddSliceIds(tddMd: string): string[] {
  return uniqPreserve(tddMd.match(/\bS-\d+\b/g) ?? []);
}

/** Body of Layer 1 spec compliance section in 07-review.md */
function extractLayer1Section(reviewMd: string): string {
  const lines = reviewMd.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+Layer\s*1/i.test(lines[i]!)) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) {
    return "";
  }
  const buf: string[] = [];
  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^##\s+/.test(line)) {
      break;
    }
    buf.push(line);
  }
  return buf.join("\n");
}

function layer1LinesForCriterion(layer1: string, criterionId: string): string[] {
  const out: string[] = [];
  for (const line of layer1.split(/\r?\n/)) {
    if (criterionTokens(line).includes(criterionId)) {
      out.push(line.trim());
    }
  }
  return out;
}

export async function buildTraceMatrix(projectRoot: string): Promise<TraceMatrix> {
  const spec = await readArtifact(projectRoot, "04-spec.md");
  const plan = await readArtifact(projectRoot, "05-plan.md");
  const tdd = await readArtifact(projectRoot, "06-tdd.md");
  const review = await readArtifact(projectRoot, "07-review.md");

  const criterionIds = spec ? parseAcceptanceCriterionIds(spec) : [];
  const taskToAcs = plan ? parsePlanTaskAcLinks(plan) : new Map<string, string[]>();
  const allTaskIds = plan ? parsePlanTaskIds(plan) : [];
  const sliceToTasks = tdd ? parseTddSliceTaskLinks(tdd) : new Map<string, string[]>();
  const allSliceIds = tdd ? parseTddSliceIds(tdd) : [];
  const layer1 = review ? extractLayer1Section(review) : "";

  const acToTasks = new Map<string, string[]>();
  for (const [task, acs] of taskToAcs) {
    for (const ac of acs) {
      const prev = acToTasks.get(ac) ?? [];
      if (!prev.includes(task)) {
        acToTasks.set(ac, [...prev, task]);
      }
    }
  }

  const entries: TraceEntry[] = criterionIds.map((criterionId) => {
    const taskIds = acToTasks.get(criterionId) ?? [];
    const testSlices: string[] = [];
    for (const [slice, tasks] of sliceToTasks) {
      if (tasks.some((t) => taskIds.includes(t))) {
        testSlices.push(slice);
      }
    }
    return {
      criterionId,
      taskIds: uniqPreserve(taskIds),
      testSlices: uniqPreserve(testSlices),
      reviewFindings: layer1LinesForCriterion(layer1, criterionId)
    };
  });

  const orphanedCriteria = criterionIds.filter((ac) => (acToTasks.get(ac) ?? []).length === 0);

  const tasksWithSlice = new Set<string>();
  for (const tasks of sliceToTasks.values()) {
    for (const t of tasks) {
      tasksWithSlice.add(t);
    }
  }
  const orphanedTasks = allTaskIds.filter((t) => !tasksWithSlice.has(t));

  const orphanedTests = allSliceIds.filter((s) => {
    const tasks = sliceToTasks.get(s) ?? [];
    if (tasks.length === 0) {
      return true;
    }
    return tasks.every((t) => {
      const acs = taskToAcs.get(t);
      return !acs || acs.length === 0;
    });
  });

  return {
    entries,
    orphanedCriteria,
    orphanedTasks,
    orphanedTests
  };
}
