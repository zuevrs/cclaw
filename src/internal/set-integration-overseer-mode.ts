import type { Writable } from "node:stream";
import { readFlowState, writeFlowState } from "../runs.js";

export interface SetIntegrationOverseerModeArgs {
  mode: "conditional" | "always";
  reason: string | null;
}

export function parseSetIntegrationOverseerModeArgs(
  tokens: string[]
): SetIntegrationOverseerModeArgs | null {
  let mode: "conditional" | "always" | null = null;
  let reason: string | null = null;
  let positional: string | null = null;
  for (const token of tokens) {
    if (token.startsWith("--mode=")) {
      const raw = token.slice("--mode=".length).trim();
      if (raw === "conditional" || raw === "always") {
        mode = raw;
      } else {
        return null;
      }
      continue;
    }
    if (token.startsWith("--reason=")) {
      const raw = token.slice("--reason=".length).trim();
      if (raw.length > 0) reason = raw;
      continue;
    }
    if (token.startsWith("--")) {
      return null;
    }
    if (positional === null) {
      positional = token.trim();
      continue;
    }
    return null;
  }
  if (mode === null && positional !== null) {
    if (positional === "conditional" || positional === "always") {
      mode = positional;
    } else {
      return null;
    }
  }
  if (mode === null) return null;
  return { mode, reason };
}

/**
 * v6.14.2 — set `flow-state.json::integrationOverseerMode` without
 * advancing the stage DAG. Mirrors `set-worktree-mode` and
 * `set-checkpoint-mode`.
 */
export async function runSetIntegrationOverseerMode(
  projectRoot: string,
  tokens: string[],
  io: { stderr: Writable }
): Promise<number> {
  const parsed = parseSetIntegrationOverseerModeArgs(tokens);
  if (!parsed) {
    io.stderr.write(
      "cclaw internal set-integration-overseer-mode: usage: <conditional|always> [--reason=\"<short>\"] " +
        "(or --mode=<conditional|always>)\n"
    );
    return 1;
  }
  const state = await readFlowState(projectRoot);
  const writerSubsystem = parsed.reason
    ? `set-integration-overseer-mode:${slugifyReason(parsed.reason)}`
    : "set-integration-overseer-mode";
  await writeFlowState(
    projectRoot,
    { ...state, integrationOverseerMode: parsed.mode },
    { writerSubsystem }
  );
  return 0;
}

function slugifyReason(reason: string): string {
  return (
    reason
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 60) || "unspecified"
  );
}
