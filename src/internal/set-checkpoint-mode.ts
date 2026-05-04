import type { Writable } from "node:stream";
import { readFlowState, writeFlowState } from "../runs.js";

export interface SetCheckpointModeArgs {
  mode: "per-slice" | "global-red";
  reason: string | null;
}

export function parseSetCheckpointModeArgs(
  tokens: string[]
): SetCheckpointModeArgs | null {
  let mode: "per-slice" | "global-red" | null = null;
  let reason: string | null = null;
  let positional: string | null = null;
  for (const token of tokens) {
    if (token.startsWith("--mode=")) {
      const raw = token.slice("--mode=".length).trim();
      if (raw === "per-slice" || raw === "global-red") {
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
      // unknown flag — let the caller surface usage.
      return null;
    }
    if (positional === null) {
      positional = token.trim();
      continue;
    }
    return null;
  }
  if (mode === null && positional !== null) {
    if (positional === "per-slice" || positional === "global-red") {
      mode = positional;
    } else {
      return null;
    }
  }
  if (mode === null) return null;
  return { mode, reason };
}

/**
 * v6.14.2 — set `flow-state.json::tddCheckpointMode` without advancing
 * the stage DAG. Mirrors `set-worktree-mode`. The `--reason` flag is
 * optional but recommended for the audit trail; it is currently passed
 * through to the writer subsystem string so operators can grep the
 * `.flow-state.guard.json` sidecar.
 */
export async function runSetCheckpointMode(
  projectRoot: string,
  tokens: string[],
  io: { stderr: Writable }
): Promise<number> {
  const parsed = parseSetCheckpointModeArgs(tokens);
  if (!parsed) {
    io.stderr.write(
      "cclaw internal set-checkpoint-mode: usage: <per-slice|global-red> [--reason=\"<short>\"] " +
        "(or --mode=<per-slice|global-red>)\n"
    );
    return 1;
  }
  const state = await readFlowState(projectRoot);
  const writerSubsystem = parsed.reason
    ? `set-checkpoint-mode:${slugifyReason(parsed.reason)}`
    : "set-checkpoint-mode";
  await writeFlowState(
    projectRoot,
    { ...state, tddCheckpointMode: parsed.mode },
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
