import fs from "node:fs/promises";
import path from "node:path";
import { resolveArtifactPath } from "../../artifact-paths.js";
import { RUNTIME_ROOT } from "../../constants.js";
import { ensureDir } from "../../fs-utils.js";
import {
  createInitialFlowState,
  type FlowState,
  type RepoSignals
} from "../../flow-state.js";
import { archiveRun, readFlowState, writeFlowState } from "../../runs.js";
import type { ArchiveDisposition } from "../../runs.js";
import { type FlowStage, type FlowTrack } from "../../types.js";
import {
  listExistingFiles,
  listFilesUnder,
  pathExists
} from "./helpers.js";
import { TRACK_STAGES } from "../../types.js";
import type { StartFlowArgs } from "./parsers.js";
import { buildValidationReport } from "./advance.js";
import {
  carriedCompletedStageCatalog,
  completedStageClosureEvidenceIssues,
  firstIncompleteStageForTrack
} from "./verify.js";
import type { Writable } from "node:stream";

interface InternalIo {
  stdout: Writable;
  stderr: Writable;
}

function resolveTaskClass(
  className: string | undefined,
  fallback?: FlowState["taskClass"]
): FlowState["taskClass"] {
  if (className === "software-standard" || className === "software-trivial" || className === "software-bugfix") {
    return className;
  }
  return fallback;
}

const REPO_SIGNAL_SKIP_DIRS = new Set(["node_modules", ".git"]);

/** One-pass repo snapshot (max ~200 files, skips `node_modules`/`.git`). */
export async function collectRepoSignals(projectRoot: string): Promise<RepoSignals> {
  const capturedAt = new Date().toISOString();
  const cap = 200;
  let fileCount = 0;

  async function visit(absDir: string, depth: number): Promise<void> {
    if (fileCount >= cap) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      if (fileCount >= cap) return;
      const name = ent.name;
      if (REPO_SIGNAL_SKIP_DIRS.has(name)) continue;
      const abs = path.join(absDir, name);
      if (ent.isFile()) {
        fileCount += 1;
        continue;
      }
      if (ent.isDirectory() && depth < 1) {
        await visit(abs, depth + 1);
      }
    }
  }

  let hasReadme = false;
  let hasPackageManifest = false;
  for (const fname of ["README.md", "readme.md", "Readme.md"]) {
    try {
      const st = await fs.stat(path.join(projectRoot, fname));
      if (st.isFile()) hasReadme = true;
    } catch {
      // ignore
    }
  }
  for (const manifest of ["package.json", "pyproject.toml", "Cargo.toml"]) {
    try {
      const st = await fs.stat(path.join(projectRoot, manifest));
      if (st.isFile()) hasPackageManifest = true;
    } catch {
      // ignore
    }
  }

  try {
    await visit(projectRoot, 0);
  } catch {
    fileCount = Math.min(fileCount, cap);
  }

  return { fileCount, hasReadme, hasPackageManifest, capturedAt };
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

export async function appendIdeaArtifact(projectRoot: string, args: StartFlowArgs, previous?: FlowState): Promise<void> {
  const artifactPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "00-idea.md");
  await fs.mkdir(path.dirname(artifactPath), { recursive: true });
  const now = new Date().toISOString();
  if (args.reclassify) {
    const entry = [
      "",
      `Reclassification: ${now}`,
      `- From: ${previous?.track ?? "unknown"}`,
      `- To: ${args.track}`,
      `- Class: ${args.className || "unspecified"}`,
      `- Discovery mode: ${args.discoveryMode}`,
      `- Reason: ${args.reason || "unspecified"}`
    ].join("\n") + "\n";
    await fs.appendFile(artifactPath, entry, "utf8");
    return;
  }
  const discoveredContext = await discoverStartFlowContext(projectRoot);
  const body = [
    "# Idea",
    `Class: ${args.className || "unspecified"}`,
    `Track: ${args.track}${args.reason ? ` (${args.reason})` : ""}`,
    `Discovery mode: ${args.discoveryMode}`,
    `Stack: ${args.stack || "unknown"}`,
    "",
    "## User prompt",
    args.prompt || "(not provided)",
    "",
    "## Discovered context",
    ...discoveredContext
  ].join("\n") + "\n";
  await fs.writeFile(artifactPath, body, "utf8");
}

export async function runStartFlow(
  projectRoot: string,
  args: StartFlowArgs,
  io: InternalIo
): Promise<number> {
  const current = await readFlowState(projectRoot);
  const hasProgress = current.completedStages.length > 0;
  if (!args.reclassify && hasProgress && !args.forceReset) {
    io.stderr.write(
      "cclaw internal start-flow: refusing to reset an active flow with completed stages without --force-reset. Ask the user before resetting.\n"
    );
    return 1;
  }

  const nextTaskClass = resolveTaskClass(args.className, current.taskClass);

  let nextState: FlowState;
  if (args.reclassify) {
    const completedInNewTrack = current.completedStages.filter((stage) =>
      TRACK_STAGES[args.track].includes(stage)
    );
    const fresh = createInitialFlowState({ activeRunId: current.activeRunId, track: args.track, discoveryMode: args.discoveryMode });
    const stageGateCatalog = { ...fresh.stageGateCatalog };
    const guardEvidence: Record<string, string> = {};
    for (const stage of completedInNewTrack) {
      const carried = carriedCompletedStageCatalog(current, fresh, stage);
      stageGateCatalog[stage] = carried.catalog;
      Object.assign(guardEvidence, carried.evidence);
    }
    nextState = {
      ...fresh,
      ...(nextTaskClass !== undefined ? { taskClass: nextTaskClass } : {}),
      completedStages: completedInNewTrack,
      currentStage: firstIncompleteStageForTrack(args.track, completedInNewTrack),
      guardEvidence,
      stageGateCatalog,
      rewinds: current.rewinds,
      staleStages: current.staleStages
    };
    const validation = await buildValidationReport(projectRoot, nextState);
    const evidenceIssues = completedStageClosureEvidenceIssues(nextState);
    if (!validation.completedStages.ok || evidenceIssues.length > 0) {
      io.stderr.write(
        "cclaw internal start-flow: reclassification would leave completed stages without valid gate closure.\n"
      );
      const issues = [...validation.completedStages.issues, ...evidenceIssues];
      if (issues.length > 0) {
        io.stderr.write(`- completed-stage closure issues: ${issues.join(" | ")}\n`);
      }
      return 1;
    }
  } else {
    nextState = createInitialFlowState({ track: args.track, discoveryMode: args.discoveryMode });
    if (nextTaskClass !== undefined) {
      nextState = { ...nextState, taskClass: nextTaskClass };
    }
  }

  if (args.fromIdeaArtifact) {
    const existingHints = nextState.interactionHints ?? {};
    const existingBrainstorm = existingHints.brainstorm ?? {};
    nextState.interactionHints = {
      ...existingHints,
      brainstorm: {
        ...existingBrainstorm,
        fromIdeaArtifact: args.fromIdeaArtifact,
        ...(args.fromIdeaCandidateId ? { fromIdeaCandidateId: args.fromIdeaCandidateId } : {}),
        recordedAt: new Date().toISOString()
      }
    };
  }

  const repoSignals = await collectRepoSignals(projectRoot);
  nextState = { ...nextState, repoSignals };

  await writeFlowState(projectRoot, nextState, { allowReset: true });
  await appendIdeaArtifact(projectRoot, args, current);
  if (!args.quiet) {
    io.stdout.write(`${JSON.stringify({
      ok: true,
      command: "start-flow",
      reclassify: args.reclassify,
      track: nextState.track,
      discoveryMode: nextState.discoveryMode,
      taskClass: nextState.taskClass ?? null,
      currentStage: nextState.currentStage,
      skippedStages: nextState.skippedStages,
      activeRunId: nextState.activeRunId,
      repoSignals
    }, null, 2)}\n`);
  }
  return 0;
}
