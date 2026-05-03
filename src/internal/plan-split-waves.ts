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

export const PLAN_SPLIT_DEFAULT_WAVE_SIZE = 25;
export const PLAN_SPLIT_SMALL_PLAN_THRESHOLD = 50;
const WAVE_PLANS_DIR = "wave-plans";
const WAVE_MANAGED_START = "<!-- wave-split-managed-start -->";
const WAVE_MANAGED_END = "<!-- wave-split-managed-end -->";

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

  const waves: ParsedImplementationUnit[][] = [];
  for (let i = 0; i < units.length; i += args.waveSize) {
    waves.push(units.slice(i, i + args.waveSize));
  }
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
    const updatedPlan = upsertWavePlansSection(raw, managed);
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
