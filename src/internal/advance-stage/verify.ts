import path from "node:path";
import { RUNTIME_ROOT } from "../../constants.js";
import { resolveArtifactPath } from "../../artifact-paths.js";
import { stageSchema } from "../../content/stage-schema.js";
import {
  checkMandatoryDelegations,
  readDelegationEvents,
  readDelegationLedger
} from "../../delegation.js";
import {
  verifyCompletedStagesGateClosure,
  verifyCurrentStageGateEvidence
} from "../../gate-evidence.js";
import {
  type FlowState,
  type StageGateState
} from "../../flow-state.js";
import { readFlowState } from "../../runs.js";
import { FLOW_STAGES, TRACK_STAGES, type FlowStage, type FlowTrack } from "../../types.js";
import { coerceCandidateFlowState } from "./flow-state-coercion.js";
import type {
  VerifyCurrentStateArgs,
  VerifyFlowStateDiffArgs
} from "./parsers.js";
import { buildValidationReport } from "./advance.js";
import type { Writable } from "node:stream";
import fs from "node:fs/promises";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

export async function runVerifyFlowStateDiff(
  projectRoot: string,
  args: VerifyFlowStateDiffArgs,
  io: InternalIo
): Promise<number> {
  let raw = args.afterJson;
  if (!raw && args.afterFile) {
    raw = await fs.readFile(args.afterFile, "utf8");
  }
  if (!raw) {
    io.stderr.write("cclaw internal verify-flow-state-diff: no candidate state payload.\n");
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    io.stderr.write(
      `cclaw internal verify-flow-state-diff: invalid JSON payload (${
        err instanceof Error ? err.message : String(err)
      }).\n`
    );
    return 1;
  }

  const current = await readFlowState(projectRoot);
  const candidate = coerceCandidateFlowState(parsed, current);
  const validation = await buildValidationReport(projectRoot, candidate);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  }
  if (!validation.ok) {
    io.stderr.write(
      `cclaw internal verify-flow-state-diff: candidate state is invalid for stage "${validation.stage}".\n`
    );
  }
  return validation.ok ? 0 : 1;
}

export async function runVerifyCurrentState(
  projectRoot: string,
  args: VerifyCurrentStateArgs,
  io: InternalIo
): Promise<number> {
  const current = await readFlowState(projectRoot);
  const validation = await buildValidationReport(projectRoot, current);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify(validation, null, 2)}\n`);
  }
  if (!validation.ok) {
    const unmetDelegations =
      validation.delegation.missing.length + validation.delegation.missingEvidence.length;
    const gatesWithoutEvidence = validation.gates.issues.filter((issue) =>
      issue.includes("missing guardEvidence entry")
    ).length;
    io.stderr.write(
      `cclaw: current stage has ${unmetDelegations} unmet mandatory delegations and ${gatesWithoutEvidence} gates without evidence.\n`
    );
    io.stderr.write(
      `cclaw internal verify-current-state: unresolved stage constraints for "${validation.stage}".\n`
    );
  }
  return validation.ok ? 0 : 1;
}

export function firstIncompleteStageForTrack(track: FlowTrack, completedStages: FlowStage[]): FlowStage {
  const completed = new Set(completedStages);
  const stages = TRACK_STAGES[track];
  return stages.find((stage) => !completed.has(stage)) ?? stages[stages.length - 1] ?? "brainstorm";
}

export function carriedCompletedStageCatalog(
  current: FlowState,
  fresh: FlowState,
  stage: FlowStage
): { catalog: StageGateState; evidence: Record<string, string> } {
  const previousCatalog = current.stageGateCatalog[stage];
  const freshCatalog = fresh.stageGateCatalog[stage];
  const allowed = new Set([...freshCatalog.required, ...freshCatalog.recommended]);
  const previousPassed = new Set(previousCatalog.passed.filter((gateId) => allowed.has(gateId)));
  const previousBlocked = new Set(previousCatalog.blocked.filter((gateId) => allowed.has(gateId)));
  const orderedAllowed = [...freshCatalog.required, ...freshCatalog.recommended];
  const evidence: Record<string, string> = {};
  const passed = orderedAllowed.filter((gateId) => {
    if (!previousPassed.has(gateId)) return false;
    const note = current.guardEvidence[gateId];
    if (typeof note !== "string" || note.trim().length === 0) return false;
    evidence[gateId] = note.trim();
    return true;
  });
  const passedSet = new Set(passed);
  return {
    catalog: {
      required: [...freshCatalog.required],
      recommended: [...freshCatalog.recommended],
      conditional: [],
      triggered: [],
      passed,
      blocked: orderedAllowed.filter((gateId) => previousBlocked.has(gateId) && !passedSet.has(gateId))
    },
    evidence
  };
}

export function completedStageClosureEvidenceIssues(flowState: FlowState): string[] {
  const issues: string[] = [];
  for (const stage of flowState.completedStages) {
    const schema = stageSchema(stage, flowState.track, flowState.discoveryMode, flowState.taskClass ?? null);
    const catalog = flowState.stageGateCatalog[stage];
    const required = schema.requiredGates
      .filter((gate) => gate.tier === "required")
      .map((gate) => gate.id);
    for (const gateId of required) {
      if (!catalog.passed.includes(gateId)) continue;
      const note = flowState.guardEvidence[gateId];
      if (typeof note !== "string" || note.trim().length === 0) {
        issues.push(`completed stage "${stage}" passed gate "${gateId}" is missing guardEvidence.`);
      }
    }
  }
  return issues;
}


export async function pathExists(projectRoot: string, relPath: string): Promise<boolean> {
  try {
    await fs.stat(path.join(projectRoot, relPath));
    return true;
  } catch {
    return false;
  }
}

export async function listExistingFiles(projectRoot: string, relPaths: string[]): Promise<string[]> {
  const matches: string[] = [];
  for (const relPath of relPaths) {
    try {
      const stat = await fs.stat(path.join(projectRoot, relPath));
      if (stat.isFile()) matches.push(relPath);
    } catch {
      // continue
    }
  }
  return matches;
}

export async function listFilesUnder(projectRoot: string, relDir: string, limit = 20): Promise<string[]> {
  const root = path.join(projectRoot, relDir);
  const out: string[] = [];
  async function walk(absDir: string): Promise<void> {
    if (out.length >= limit) return;
    let entries: Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= limit) return;
      if (entry.name.startsWith(".")) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
      } else if (entry.isFile()) {
        out.push(path.relative(projectRoot, abs).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  return out;
}

export async function discoverStartFlowContext(projectRoot: string): Promise<string[]> {
  const lines: string[] = [];

  const seedFiles = (await listFilesUnder(projectRoot, path.join(RUNTIME_ROOT, "seeds"), 10))
    .filter((relPath) => /^\.cclaw\/seeds\/SEED-.*\.md$/u.test(relPath));
  lines.push(
    seedFiles.length > 0
      ? `- Seed shelf scanned: ${seedFiles.join(", ")}.`
      : "- Seed shelf scanned: no `.cclaw/seeds/SEED-*.md` files found."
  );

  const originDirs = ["docs/prd", "docs/rfcs", "docs/adr", "docs/design", "specs", "prd", "rfc", "design"];
  const originRootFiles = ["PRD.md", "SPEC.md", "DESIGN.md", "REQUIREMENTS.md", "ROADMAP.md"];
  const originFiles = [
    ...(await listExistingFiles(projectRoot, originRootFiles)),
    ...(await Promise.all(originDirs.map((dir) => listFilesUnder(projectRoot, dir, 6)))).flat()
  ].slice(0, 20);
  lines.push(
    originFiles.length > 0
      ? `- Origin docs scanned: found ${originFiles.join(", ")}.`
      : "- Origin docs scanned: no PRD/RFC/ADR/design/spec files found in configured locations."
  );

  const stackMarkers = await listExistingFiles(projectRoot, [
    "package.json",
    "pyproject.toml",
    "requirements.txt",
    "requirements-dev.txt",
    ".python-version",
    "go.mod",
    "Cargo.toml",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "Dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".gitlab-ci.yml"
  ]);
  if (await pathExists(projectRoot, ".github/workflows")) {
    stackMarkers.push(".github/workflows/");
  }
  lines.push(
    stackMarkers.length > 0
      ? `- Stack markers scanned: found ${stackMarkers.join(", ")}.`
      : "- Stack markers scanned: no root stack markers found."
  );

  return lines;
}
