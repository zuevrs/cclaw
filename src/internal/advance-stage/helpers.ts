import fs from "node:fs/promises";
import path from "node:path";
import { exists } from "../../fs-utils.js";
import { FLOW_STAGES, type FlowStage } from "../../types.js";
import { type StageGateState } from "../../flow-state.js";


export function unique<T extends string>(values: T[]): T[] {
  return [...new Set(values)];
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function parseStringList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export function isFlowStageValue(value: unknown): value is FlowStage {
  return typeof value === "string" && (FLOW_STAGES as readonly string[]).includes(value);
}

export function parseGuardEvidence(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (trimmed.length === 0) continue;
    next[key] = trimmed;
  }
  return next;
}

export function emptyGateState(): StageGateState {
  return {
    required: [],
    recommended: [],
    conditional: [],
    triggered: [],
    passed: [],
    blocked: []
  };
}

export function stringifyGateEvidenceValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "passed" : "failed";
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function parseEvidenceByGate(raw: string | undefined): Record<string, string> {
  if (!raw || raw.trim().length === 0) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `--evidence-json must be valid JSON object: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("--evidence-json must deserialize to an object.");
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const normalized = stringifyGateEvidenceValue(value).trim();
    if (normalized.length === 0) continue;
    next[key] = normalized;
  }
  return next;
}

export function parseCsv(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
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
