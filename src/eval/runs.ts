/**
 * Run bookkeeping for backgrounded `cclaw eval` invocations.
 *
 * A backgrounded run writes three artifacts under `.cclaw/evals/runs/<id>/`:
 *
 *   - `run.json`  — status metadata (pid, started/ended ISO timestamps,
 *                    exit code, argv, cwd). Updated at start and at exit.
 *   - `run.log`   — combined stdout+stderr of the child process. This is
 *                    what `cclaw eval runs tail` streams.
 *   - `run.pid`   — just the pid, written atomically so `runs status`
 *                    can probe liveness without parsing JSON.
 *
 * The `id` is a short alphanumeric string (8 chars + ISO timestamp prefix)
 * chosen so sorting directory entries by name produces a chronological
 * listing without any extra work.
 */
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { EVALS_ROOT } from "../constants.js";
import { exists } from "../fs-utils.js";

export const RUNS_DIR = "runs";

export interface EvalRunStatus {
  id: string;
  startedAt: string;
  endedAt?: string;
  pid: number;
  argv: string[];
  cwd: string;
  exitCode?: number;
  state: "running" | "succeeded" | "failed";
}

export function runsRoot(projectRoot: string): string {
  return path.join(projectRoot, EVALS_ROOT, RUNS_DIR);
}

export function runDir(projectRoot: string, id: string): string {
  return path.join(runsRoot(projectRoot), id);
}

export function runLogPath(projectRoot: string, id: string): string {
  return path.join(runDir(projectRoot, id), "run.log");
}

export function runStatusPath(projectRoot: string, id: string): string {
  return path.join(runDir(projectRoot, id), "run.json");
}

/**
 * Generate a short, lexicographically-sortable run id. The timestamp
 * prefix means `ls -1` already returns the runs in chronological order
 * which keeps the `runs list` subcommand trivial.
 */
export function generateRunId(now: Date = new Date()): string {
  const ts = now.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const suffix = randomBytes(3).toString("hex");
  return `${ts}-${suffix}`;
}

export async function ensureRunDir(
  projectRoot: string,
  id: string
): Promise<string> {
  const dir = runDir(projectRoot, id);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function writeRunStatus(
  projectRoot: string,
  status: EvalRunStatus
): Promise<void> {
  await ensureRunDir(projectRoot, status.id);
  await fs.writeFile(
    runStatusPath(projectRoot, status.id),
    `${JSON.stringify(status, null, 2)}\n`,
    "utf8"
  );
}

export async function readRunStatus(
  projectRoot: string,
  id: string
): Promise<EvalRunStatus | null> {
  const file = runStatusPath(projectRoot, id);
  if (!(await exists(file))) return null;
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as EvalRunStatus;
  } catch {
    return null;
  }
}

/**
 * List run ids under `.cclaw/evals/runs/`, most recent first. Directory
 * entries that don't contain a `run.json` are skipped (half-initialized
 * or manually mkdir'd folders).
 */
export async function listRuns(projectRoot: string): Promise<EvalRunStatus[]> {
  const root = runsRoot(projectRoot);
  if (!(await exists(root))) return [];
  const entries = await fs.readdir(root, { withFileTypes: true });
  const out: EvalRunStatus[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const status = await readRunStatus(projectRoot, entry.name);
    if (status) out.push(status);
  }
  out.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return out;
}

/**
 * Resolve `"latest"` (or undefined) to the most recent run id.
 * Returns `null` when there are no runs.
 */
export async function resolveRunId(
  projectRoot: string,
  hint: string | undefined
): Promise<string | null> {
  if (hint && hint !== "latest") {
    const status = await readRunStatus(projectRoot, hint);
    return status ? hint : null;
  }
  const runs = await listRuns(projectRoot);
  return runs[0]?.id ?? null;
}

/**
 * Cheap liveness probe for an EvalRunStatus. A `run.json` can be stale
 * (process crashed mid-commit), so we double-check with `kill(pid, 0)`
 * before trusting the `state: "running"` field.
 */
export function isRunAlive(status: EvalRunStatus): boolean {
  if (status.state !== "running") return false;
  try {
    process.kill(status.pid, 0);
    return true;
  } catch {
    return false;
  }
}
