import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath } from "../artifact-paths.js";
import { exists, writeFileSafe } from "../fs-utils.js";
import { readFlowState } from "../runs.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

/**
 * v6.10.0 (P3) — split a large `05-plan.md` Implementation Units section
 * into wave-NN.md sub-files so an executor can carry one wave at a time
 * without re-reading the whole plan.
 *
 * Threshold contract:
 *   - total units < SMALL_PLAN_THRESHOLD → no-op, exit 0.
 *   - total units >= SMALL_PLAN_THRESHOLD → split into waves of `--wave-size`
 *     (default 25).
 *
 * Files written:
 *   - `<artifacts-dir>/wave-plans/wave-NN.md` per wave (1-indexed).
 *   - In-place update to `05-plan.md` adding (or refreshing) a
 *     `## Wave Plans` section between
 *     `<!-- wave-split-managed-start -->` and `<!-- wave-split-managed-end -->`
 *     markers. Outside-marker content is preserved verbatim.
 *
 * `--dry-run` prints the plan but does not write. `--force` overwrites
 * existing wave files; without it, the command refuses to clobber.
 */

export interface PlanSplitWavesArgs {
  waveSize: number;
  dryRun: boolean;
  force: boolean;
  json: boolean;
}

export const PLAN_SPLIT_DEFAULT_WAVE_SIZE = 5;
export const PLAN_SPLIT_SMALL_PLAN_THRESHOLD = 50;
const WAVE_PLANS_DIR = "wave-plans";
const WAVE_MANAGED_START = "<!-- wave-split-managed-start -->";
const WAVE_MANAGED_END = "<!-- wave-split-managed-end -->";
const PARALLEL_EXEC_MANAGED_START = "<!-- parallel-exec-managed-start -->";
const PARALLEL_EXEC_MANAGED_END = "<!-- parallel-exec-managed-end -->";

export interface ParsedImplementationUnit {
  id: string;
  /**
   * The full markdown body of this unit, starting at the
   * `### Implementation Unit U-N` heading and ending right before the
   * next unit heading (or the next `## ` H2, or end of file).
   */
  body: string;
  /** Repo-relative path declarations from the optional `Files:` line. */
  paths: string[];
}

export interface ImplementationUnitParallelFields {
  unitId: string;
  dependsOn: string[];
  claimedPaths: string[];
  parallelizable: boolean;
  riskTier: "low" | "standard" | "high";
  lane?: string;
}

export interface ParseImplementationUnitParallelOptions {
  /**
   * Legacy continuation (v6.13.0): when the plan predates explicit parallel
   * bullets, units without a `parallelizable:` line default to serial eligibility
   * in the scheduler (`parallelizable: false`).
   */
  legacyParallelDefaultSerial?: boolean;
}

/**
 * Parse v6.13 parallel-metadata bullets from an implementation unit body.
 * Missing keys use conservative defaults (`dependsOn: []`, `parallelizable: true`
 * unless `legacyParallelDefaultSerial` is set).
 */
export function parseImplementationUnitParallelFields(
  unit: ParsedImplementationUnit,
  options?: ParseImplementationUnitParallelOptions
): ImplementationUnitParallelFields {
  const text = unit.body;
  const pick = (label: string): string | undefined => {
    const re = new RegExp(`^[-*]\\s*\\*{0,2}${label}\\*{0,2}\\s*:\\s*(.*)$`, "imu");
    for (const rawLine of text.split(/\r?\n/u)) {
      const line = rawLine.trim();
      const m = re.exec(line);
      if (m) return m[1]?.trim();
    }
    return undefined;
  };
  const id = pick("id") ?? unit.id;
  const depRaw = pick("dependsOn") ?? pick("depends on") ?? "";
  const dependsOn = depRaw
    .split(/,/u)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !/^none$/iu.test(s));
  const pathsRaw = pick("claimedPaths") ?? pick("claimed paths") ?? "";
  const claimedPaths =
    pathsRaw.length > 0
      ? pathsRaw
        .split(",")
        .map((s) => s.replace(/[`\s]/gu, "").trim())
        .filter((s) => s.length > 0)
      : [...unit.paths];
  const explicitParallel = pick("parallelizable");
  const parallelRaw = (explicitParallel ?? "true").toLowerCase();
  let parallelizable = parallelRaw === "true" || parallelRaw === "yes" || parallelRaw === "y";
  if (options?.legacyParallelDefaultSerial && explicitParallel === undefined) {
    parallelizable = false;
  }
  const riskRaw = (pick("riskTier") ?? pick("risk tier") ?? "standard").toLowerCase();
  const riskTier: ImplementationUnitParallelFields["riskTier"] =
    riskRaw === "low" ? "low" : riskRaw === "high" ? "high" : "standard";
  const laneRaw = pick("lane");
  const lane = laneRaw && laneRaw.length > 0 ? laneRaw : undefined;
  return { unitId: id, dependsOn, claimedPaths, parallelizable, riskTier, lane };
}

function unitBodyHasV613ParallelBullet(body: string, label: string): boolean {
  const re = new RegExp(`^[-*]\\s*\\*{0,2}${label}\\*{0,2}\\s*:`, "imu");
  return body.split(/\r?\n/u).some((raw) => re.test(raw.trim()));
}

/**
 * True when the plan has implementation units but any unit is missing v6.13.0
 * `dependsOn` / `claimedPaths` / `parallelizable` / `riskTier` bullets.
 */
export function planArtifactLacksV613ParallelMetadata(planMarkdown: string): boolean {
  const units = parseImplementationUnits(planMarkdown);
  if (units.length === 0) return false;
  const labels = ["dependsOn", "claimedPaths", "parallelizable", "riskTier"] as const;
  return units.some((u) => !labels.every((lab) => unitBodyHasV613ParallelBullet(u.body, lab)));
}

export function compareCanonicalUnitIds(a: string, b: string): number {
  const ma = /^U-(\d+)$/u.exec(a);
  const mb = /^U-(\d+)$/u.exec(b);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  return a.localeCompare(b);
}

function topoSortPlanUnits(
  meta: ImplementationUnitParallelFields[]
): ImplementationUnitParallelFields[] {
  const idSet = new Set(meta.map((m) => m.unitId));
  const incoming = new Map<string, number>();
  for (const m of meta) incoming.set(m.unitId, 0);
  for (const m of meta) {
    for (const d of m.dependsOn) {
      if (!idSet.has(d)) continue;
      incoming.set(m.unitId, (incoming.get(m.unitId) ?? 0) + 1);
    }
  }
  const queue = meta
    .filter((m) => (incoming.get(m.unitId) ?? 0) === 0)
    .sort((a, b) => compareCanonicalUnitIds(a.unitId, b.unitId));
  const out: ImplementationUnitParallelFields[] = [];
  while (queue.length > 0) {
    const m = queue.shift()!;
    out.push(m);
    for (const other of meta) {
      if (!other.dependsOn.includes(m.unitId)) continue;
      const v = (incoming.get(other.unitId) ?? 0) - 1;
      incoming.set(other.unitId, v);
      if (v === 0) {
        queue.push(other);
        queue.sort((a, b) => compareCanonicalUnitIds(a.unitId, b.unitId));
      }
    }
  }
  if (out.length !== meta.length) {
    return [...meta].sort((a, b) => compareCanonicalUnitIds(a.unitId, b.unitId));
  }
  return out;
}

/**
 * Group implementation units into waves: topological order, then greedy
 * placement with disjoint `claimedPaths` and `cap` members per wave.
 */
export function buildConflictAwareWavesFromUnits(
  units: ParsedImplementationUnit[],
  cap: number
): ParsedImplementationUnit[][] {
  const metaList = units.map((u) => parseImplementationUnitParallelFields(u));
  const ordered = topoSortPlanUnits(metaList);
  const unitById = new Map(units.map((u) => [parseImplementationUnitParallelFields(u).unitId, u]));
  const waves: ParsedImplementationUnit[][] = [];
  const allMetaIds = new Set(metaList.map((m) => m.unitId));
  for (const m of ordered) {
    const u = unitById.get(m.unitId);
    if (!u) continue;
    let placed = false;
    for (let wi = 0; wi < waves.length; wi++) {
      const wave = waves[wi]!;
      if (wave.length >= cap) continue;
      const priorIds = new Set(
        waves
          .slice(0, wi)
          .flat()
          .map((wu) => parseImplementationUnitParallelFields(wu).unitId)
      );
      const depsOk = m.dependsOn.every((d) => priorIds.has(d) || !allMetaIds.has(d));
      if (!depsOk) continue;
      const pathsInWave = new Set<string>();
      for (const wu of wave) {
        for (const p of parseImplementationUnitParallelFields(wu).claimedPaths) {
          pathsInWave.add(p);
        }
      }
      const clash = m.claimedPaths.some((p) => pathsInWave.has(p));
      if (clash) continue;
      wave.push(u);
      placed = true;
      break;
    }
    if (!placed) {
      waves.push([u]);
    }
  }
  return waves;
}

export function buildParallelExecutionPlanSection(
  waves: ParsedImplementationUnit[][],
  cap: number
): string {
  const lines: string[] = [];
  lines.push(PARALLEL_EXEC_MANAGED_START);
  lines.push("## Parallel Execution Plan");
  lines.push("");
  lines.push(`- **Cap:** ${cap} parallel units per wave (conflict-aware via \`claimedPaths\`).`);
  lines.push("");
  for (let i = 0; i < waves.length; i += 1) {
    const w = waves[i]!;
    const ids = w.map((unit) => parseImplementationUnitParallelFields(unit).unitId);
    const union = new Set<string>();
    for (const unit of w) {
      for (const p of parseImplementationUnitParallelFields(unit).claimedPaths) {
        union.add(p);
      }
    }
    lines.push(`### Wave ${padWaveIndex(i + 1)}`);
    lines.push(`- **Members:** ${ids.join(", ")}`);
    lines.push(`- **Claimed paths union:** ${[...union].sort().join(", ") || "(none)"}`);
    lines.push("");
  }
  lines.push(PARALLEL_EXEC_MANAGED_END);
  return lines.join("\n");
}

/**
 * Replace or append the managed Parallel Execution Plan block.
 */
export function upsertParallelExecutionPlanSection(
  planMarkdown: string,
  managedBlock: string
): string {
  const startIdx = planMarkdown.indexOf(PARALLEL_EXEC_MANAGED_START);
  const endIdx = planMarkdown.indexOf(PARALLEL_EXEC_MANAGED_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = planMarkdown.slice(0, startIdx);
    const after = planMarkdown.slice(endIdx + PARALLEL_EXEC_MANAGED_END.length);
    const joined = `${before}${managedBlock}${after}`;
    return joined.endsWith("\n") ? joined : `${joined}\n`;
  }
  const trimmed = planMarkdown.replace(/\s+$/u, "");
  return `${trimmed}\n\n${managedBlock}\n`;
}

/**
 * Parse `## Implementation Units` section into individual unit blocks.
 * Recognizes the canonical heading shape in the TDD-velocity plan template
 * (`### Implementation Unit U-<n>`). Tolerant of `Files:` listed either
 * inline or as a `- **Files (...):**` bullet block.
 */
export function parseImplementationUnits(planMarkdown: string): ParsedImplementationUnit[] {
  const units: ParsedImplementationUnit[] = [];
  const headingRegex = /(^|\n)###\s+Implementation Unit\s+(U-\d+)\b/gu;
  const matches: Array<{ id: string; start: number; headingEnd: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(planMarkdown)) !== null) {
    const offset = match[1] === "" ? 0 : 1; // strip the leading newline if present
    matches.push({
      id: match[2]!,
      start: match.index + offset,
      headingEnd: match.index + match[0].length
    });
  }
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i]!;
    const next = matches[i + 1];
    let endIndex = next ? next.start : planMarkdown.length;
    // If a higher-level H2 (`## ...`) appears before the next unit, end at the H2.
    const tail = planMarkdown.slice(current.headingEnd, endIndex);
    const sectionBreak = /\n##\s+\S/u.exec(tail);
    if (sectionBreak) {
      endIndex = current.headingEnd + sectionBreak.index + 1; // include the trailing newline
    }
    const body = planMarkdown.slice(current.start, endIndex).replace(/\s+$/u, "");
    units.push({
      id: current.id,
      body,
      paths: extractPathsLine(body)
    });
  }
  return units;
}

/**
 * Pull repo-relative paths from a `Files:` line or the `Files (...)` bullet
 * block. Both shapes appear in the wild; the parser extracts after the colon
 * and splits on commas. Empty/whitespace items are dropped.
 */
export function extractPathsLine(unitBody: string): string[] {
  const lines = unitBody.split(/\r?\n/u);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const filesMatch = /^[-*]?\s*\*?\*?Files\s*(?:\([^)]*\))?\s*:\*?\*?\s*(.*)$/iu.exec(line);
    if (!filesMatch) continue;
    const remainder = filesMatch[1]!.trim();
    if (remainder.length === 0) continue;
    return remainder
      .split(",")
      .map((item) => item.replace(/[`*]/gu, "").trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

export function parsePlanSplitWavesArgs(tokens: string[]): PlanSplitWavesArgs {
  let waveSize = PLAN_SPLIT_DEFAULT_WAVE_SIZE;
  let dryRun = false;
  let force = false;
  let json = false;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const next = tokens[i + 1];
    if (token === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--json") {
      json = true;
      continue;
    }
    if (token === "--wave-size" || token.startsWith("--wave-size=")) {
      let raw = "";
      if (token.startsWith("--wave-size=")) {
        raw = token.slice("--wave-size=".length);
      } else {
        if (next === undefined || next.startsWith("--")) {
          throw new Error("--wave-size requires an integer value.");
        }
        raw = next;
        i += 1;
      }
      const trimmed = raw.trim();
      if (!/^[0-9]+$/u.test(trimmed)) {
        throw new Error("--wave-size must be a positive integer.");
      }
      waveSize = Number(trimmed);
      if (waveSize < 1) {
        throw new Error("--wave-size must be >= 1.");
      }
      continue;
    }
    throw new Error(`Unknown flag for internal plan-split-waves: ${token}`);
  }
  return { waveSize, dryRun, force, json };
}

interface PlanSplitOutcome {
  ok: true;
  command: "plan-split-waves";
  totalUnits: number;
  waveCount: number;
  waveSize: number;
  smallPlanNoOp: boolean;
  dryRun: boolean;
  waveFiles: string[];
  planUpdated: boolean;
}

function padWaveIndex(index: number): string {
  return index.toString().padStart(2, "0");
}

function buildWaveFileBody(
  waveIndex: number,
  units: ParsedImplementationUnit[],
  sourceLabel: string
): string {
  const idsRange = `${units[0]!.id}..${units[units.length - 1]!.id}`;
  return [
    `# Wave ${padWaveIndex(waveIndex)}`,
    "",
    `Source: ${sourceLabel} units ${idsRange}`,
    "",
    "## Implementation Units",
    "",
    units.map((unit) => unit.body.trim()).join("\n\n"),
    ""
  ].join("\n");
}

function buildWavePlansSection(
  waveFiles: string[]
): string {
  const lines: string[] = [];
  lines.push(WAVE_MANAGED_START);
  lines.push("## Wave Plans");
  lines.push("");
  for (let i = 0; i < waveFiles.length; i += 1) {
    lines.push(`- Wave ${padWaveIndex(i + 1)}: \`${waveFiles[i]!}\``);
  }
  lines.push("");
  lines.push(WAVE_MANAGED_END);
  return lines.join("\n");
}

/**
 * Replace any existing managed Wave Plans block with the new one, or append
 * it at the end of the file when no markers are present yet. The helper
 * never touches text outside the markers.
 */
export function upsertWavePlansSection(
  planMarkdown: string,
  managedBlock: string
): string {
  const startIdx = planMarkdown.indexOf(WAVE_MANAGED_START);
  const endIdx = planMarkdown.indexOf(WAVE_MANAGED_END);
  if (startIdx >= 0 && endIdx > startIdx) {
    const before = planMarkdown.slice(0, startIdx);
    const after = planMarkdown.slice(endIdx + WAVE_MANAGED_END.length);
    const joined = `${before}${managedBlock}${after}`;
    return joined.endsWith("\n") ? joined : `${joined}\n`;
  }
  const trimmed = planMarkdown.replace(/\s+$/u, "");
  return `${trimmed}\n\n${managedBlock}\n`;
}

export async function runPlanSplitWaves(
  projectRoot: string,
  args: PlanSplitWavesArgs,
  io: InternalIo
): Promise<number> {
  const flow = await readFlowState(projectRoot).catch(() => null);
  const track = flow?.track;
  const planResolved = await resolveArtifactPath("plan", {
    projectRoot,
    track,
    intent: "read"
  });
  if (!(await exists(planResolved.absPath))) {
    io.stderr.write(`cclaw internal plan-split-waves: plan artifact not found at ${planResolved.relPath}.\n`);
    return 1;
  }
  const raw = await fs.readFile(planResolved.absPath, "utf8");
  const units = parseImplementationUnits(raw);

  if (units.length < PLAN_SPLIT_SMALL_PLAN_THRESHOLD) {
    const outcome: PlanSplitOutcome = {
      ok: true,
      command: "plan-split-waves",
      totalUnits: units.length,
      waveCount: 0,
      waveSize: args.waveSize,
      smallPlanNoOp: true,
      dryRun: args.dryRun,
      waveFiles: [],
      planUpdated: false
    };
    if (args.json) {
      io.stdout.write(`${JSON.stringify(outcome)}\n`);
    } else {
      io.stdout.write(
        `plan is small (${units.length} unit(s), threshold ${PLAN_SPLIT_SMALL_PLAN_THRESHOLD}); no wave split needed.\n`
      );
    }
    return 0;
  }

  const waves = buildConflictAwareWavesFromUnits(units, args.waveSize);
  const artifactsDir = path.dirname(planResolved.absPath);
  const wavePlansAbsDir = path.join(artifactsDir, WAVE_PLANS_DIR);
  const waveFileNames = waves.map((_, idx) => `${WAVE_PLANS_DIR}/wave-${padWaveIndex(idx + 1)}.md`);

  if (!args.dryRun && !args.force) {
    for (const fileName of waveFileNames) {
      const abs = path.join(artifactsDir, fileName);
      if (await exists(abs)) {
        io.stderr.write(
          `cclaw internal plan-split-waves: wave file already exists: ${path.relative(projectRoot, abs)}. Pass --force to overwrite.\n`
        );
        return 1;
      }
    }
  }

  if (!args.dryRun) {
    await fs.mkdir(wavePlansAbsDir, { recursive: true });
    for (let i = 0; i < waves.length; i += 1) {
      const fileName = waveFileNames[i]!;
      const body = buildWaveFileBody(i + 1, waves[i]!, planResolved.fileName);
      await writeFileSafe(path.join(artifactsDir, fileName), body);
    }
    const managed = buildWavePlansSection(waveFileNames);
    let updatedPlan = upsertWavePlansSection(raw, managed);
    const parallelBlock = buildParallelExecutionPlanSection(waves, args.waveSize);
    updatedPlan = upsertParallelExecutionPlanSection(updatedPlan, parallelBlock);
    if (updatedPlan !== raw) {
      await writeFileSafe(planResolved.absPath, updatedPlan);
    }
  }

  const outcome: PlanSplitOutcome = {
    ok: true,
    command: "plan-split-waves",
    totalUnits: units.length,
    waveCount: waves.length,
    waveSize: args.waveSize,
    smallPlanNoOp: false,
    dryRun: args.dryRun,
    waveFiles: waveFileNames,
    planUpdated: !args.dryRun
  };
  if (args.json) {
    io.stdout.write(`${JSON.stringify(outcome)}\n`);
  } else if (args.dryRun) {
    io.stdout.write(
      `dry run: would split ${units.length} unit(s) into ${waves.length} wave file(s) of size ${args.waveSize}:\n`
    );
    for (const fileName of waveFileNames) {
      io.stdout.write(`  - ${fileName}\n`);
    }
  } else {
    io.stdout.write(
      `wrote ${waves.length} wave file(s) under ${path.relative(projectRoot, wavePlansAbsDir)} and refreshed Wave Plans section in ${planResolved.relPath}.\n`
    );
  }
  return 0;
}
