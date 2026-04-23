import fs from "node:fs/promises";
import path from "node:path";
import { stageSchema } from "./content/stage-schema.js";
import { RUNTIME_ROOT } from "./constants.js";
import { exists } from "./fs-utils.js";
import type { FlowStage, FlowTrack } from "./types.js";

const LEGACY_ARTIFACT_GRACE_CYCLES = 2;
const DEFAULT_TOPIC_SLUG = "topic";

export type ArtifactPathIntent = "read" | "write";

export interface ResolveArtifactPathContext {
  projectRoot: string;
  track?: FlowTrack;
  /**
   * Optional brainstorm topic used for `<slug>` interpolation.
   * When omitted, the resolver attempts to infer it from `00-idea.md`.
   */
  topic?: string;
  /**
   * - read: locate an existing artifact first (new slug shape, then legacy fallback).
   * - write: return a non-colliding writable path for a new artifact.
   */
  intent?: ArtifactPathIntent;
}

export interface ResolvedArtifactPath {
  stage: FlowStage;
  fileName: string;
  relPath: string;
  absPath: string;
  source: "existing" | "generated";
  legacy: boolean;
}

interface ArtifactSearchRoot {
  absDir: string;
  relPrefix: string;
}

interface ExistingArtifactCandidate {
  fileName: string;
  relPath: string;
  absPath: string;
  mtimeMs: number;
  legacy: boolean;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function splitExt(fileName: string): { stem: string; ext: string } {
  const ext = path.extname(fileName);
  if (!ext) {
    return { stem: fileName, ext: "" };
  }
  return { stem: fileName.slice(0, -ext.length), ext };
}

function appendCollisionSuffix(fileName: string, index: number): string {
  const { stem, ext } = splitExt(fileName);
  return `${stem}-${index}${ext}`;
}

export function isSlugArtifactPattern(filePattern: string): boolean {
  return filePattern.includes("<slug>");
}

export function legacyArtifactFileName(filePattern: string): string {
  if (!isSlugArtifactPattern(filePattern)) {
    return filePattern;
  }
  return filePattern.replace(/-<slug>/gu, "");
}

export function slugifyArtifactTopic(topic: string): string {
  const normalized = topic
    .toLowerCase()
    .trim()
    .replace(/[`"'“”‘’()[\]{}<>]/gu, " ")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+/u, "")
    .replace(/-+$/u, "");
  if (normalized.length === 0) {
    return DEFAULT_TOPIC_SLUG;
  }
  return normalized.slice(0, 48);
}

function slugPatternRegex(filePattern: string): RegExp {
  const [left, right] = filePattern.split("<slug>");
  return new RegExp(
    `^${escapeRegExp(left ?? "")}[a-z0-9]+(?:-[a-z0-9]+)*(?:-\\d+)?${escapeRegExp(right ?? "")}$`,
    "u"
  );
}

function searchRoots(projectRoot: string): ArtifactSearchRoot[] {
  return [
    {
      absDir: path.join(projectRoot, RUNTIME_ROOT, "artifacts"),
      relPrefix: path.join(RUNTIME_ROOT, "artifacts")
    },
    {
      absDir: projectRoot,
      relPrefix: ""
    }
  ];
}

function candidateFromRoot(root: ArtifactSearchRoot, fileName: string): {
  relPath: string;
  absPath: string;
} {
  return {
    relPath: root.relPrefix ? path.join(root.relPrefix, fileName) : fileName,
    absPath: path.join(root.absDir, fileName)
  };
}

async function inferTopicFromIdeaArtifact(projectRoot: string): Promise<string | null> {
  const ideaPath = path.join(projectRoot, RUNTIME_ROOT, "artifacts", "00-idea.md");
  if (!(await exists(ideaPath))) {
    return null;
  }
  try {
    const raw = await fs.readFile(ideaPath, "utf8");
    const lines = raw.split(/\r?\n/gu);
    const userPromptHeading = lines.findIndex((line) => /^##\s+user prompt\b/iu.test(line.trim()));
    if (userPromptHeading >= 0) {
      for (let i = userPromptHeading + 1; i < lines.length; i += 1) {
        const line = lines[i]!.trim();
        if (line.length === 0) continue;
        if (/^##\s+/u.test(line)) break;
        const candidate = line.replace(/^[-*>\s#]+/u, "").trim();
        if (candidate.length > 0) {
          return candidate;
        }
      }
    }
    const metadataLine = /^(?:class|track|stack|reclassification)\s*:/iu;
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length === 0) continue;
      if (metadataLine.test(trimmed)) continue;
      if (/^##\s+/u.test(trimmed)) continue;
      const candidate = trimmed.replace(/^[-*>\s#]+/u, "").trim();
      if (candidate.length > 0) {
        return candidate;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function resolvedTopicSlug(
  projectRoot: string,
  stage: FlowStage,
  explicitTopic?: string
): Promise<string> {
  if (explicitTopic && explicitTopic.trim().length > 0) {
    return slugifyArtifactTopic(explicitTopic);
  }
  const inferred = await inferTopicFromIdeaArtifact(projectRoot);
  if (inferred && inferred.trim().length > 0) {
    return slugifyArtifactTopic(inferred);
  }
  return slugifyArtifactTopic(stage);
}

async function collectExistingCandidates(
  projectRoot: string,
  filePattern: string,
  legacyFile: string | null
): Promise<ExistingArtifactCandidate[]> {
  const roots = searchRoots(projectRoot);
  const candidates: ExistingArtifactCandidate[] = [];
  const hasSlugPattern = isSlugArtifactPattern(filePattern);
  const matcher = hasSlugPattern ? slugPatternRegex(filePattern) : null;

  for (const root of roots) {
    if (hasSlugPattern && matcher) {
      let entries: string[] = [];
      try {
        entries = await fs.readdir(root.absDir);
      } catch {
        entries = [];
      }
      for (const entry of entries) {
        if (!matcher.test(entry)) continue;
        const { relPath, absPath } = candidateFromRoot(root, entry);
        let mtimeMs = 0;
        try {
          const stat = await fs.stat(absPath);
          mtimeMs = stat.mtimeMs;
        } catch {
          continue;
        }
        candidates.push({
          fileName: entry,
          relPath,
          absPath,
          mtimeMs,
          legacy: false
        });
      }
    } else {
      const { relPath, absPath } = candidateFromRoot(root, filePattern);
      if (await exists(absPath)) {
        let mtimeMs = 0;
        try {
          const stat = await fs.stat(absPath);
          mtimeMs = stat.mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        candidates.push({
          fileName: filePattern,
          relPath,
          absPath,
          mtimeMs,
          legacy: false
        });
      }
    }

    if (legacyFile && LEGACY_ARTIFACT_GRACE_CYCLES > 0) {
      const { relPath, absPath } = candidateFromRoot(root, legacyFile);
      if (await exists(absPath)) {
        let mtimeMs = 0;
        try {
          const stat = await fs.stat(absPath);
          mtimeMs = stat.mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        candidates.push({
          fileName: legacyFile,
          relPath,
          absPath,
          mtimeMs,
          legacy: true
        });
      }
    }
  }

  candidates.sort((a, b) => {
    if (b.mtimeMs !== a.mtimeMs) {
      return b.mtimeMs - a.mtimeMs;
    }
    if (a.legacy !== b.legacy) {
      return a.legacy ? 1 : -1;
    }
    return a.fileName.localeCompare(b.fileName);
  });
  return candidates;
}

export async function resolveArtifactPath(
  stage: FlowStage,
  context: ResolveArtifactPathContext
): Promise<ResolvedArtifactPath> {
  const track = context.track ?? "standard";
  const intent = context.intent ?? "read";
  const filePattern = stageSchema(stage, track).artifactFile;
  const hasSlugPattern = isSlugArtifactPattern(filePattern);
  const legacyFile = hasSlugPattern ? legacyArtifactFileName(filePattern) : null;
  const existing = await collectExistingCandidates(context.projectRoot, filePattern, legacyFile);
  if (intent === "read" && existing.length > 0) {
    const picked = existing[0]!;
    return {
      stage,
      fileName: picked.fileName,
      relPath: picked.relPath,
      absPath: picked.absPath,
      source: "existing",
      legacy: picked.legacy
    };
  }

  const artifactRoot = path.join(context.projectRoot, RUNTIME_ROOT, "artifacts");
  if (!hasSlugPattern) {
    return {
      stage,
      fileName: filePattern,
      relPath: path.join(RUNTIME_ROOT, "artifacts", filePattern),
      absPath: path.join(artifactRoot, filePattern),
      source: "generated",
      legacy: false
    };
  }

  const topicSlug = await resolvedTopicSlug(context.projectRoot, stage, context.topic);
  const baseFileName = filePattern.replace("<slug>", topicSlug);
  if (intent === "read") {
    return {
      stage,
      fileName: baseFileName,
      relPath: path.join(RUNTIME_ROOT, "artifacts", baseFileName),
      absPath: path.join(artifactRoot, baseFileName),
      source: "generated",
      legacy: false
    };
  }

  let candidate = baseFileName;
  let index = 2;
  // Keep incrementing while a matching file exists under active artifacts root.
  while (await exists(path.join(artifactRoot, candidate))) {
    candidate = appendCollisionSuffix(baseFileName, index);
    index += 1;
  }
  return {
    stage,
    fileName: candidate,
    relPath: path.join(RUNTIME_ROOT, "artifacts", candidate),
    absPath: path.join(artifactRoot, candidate),
    source: "generated",
    legacy: false
  };
}
