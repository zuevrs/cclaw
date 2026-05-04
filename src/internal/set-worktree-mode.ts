import type { Writable } from "node:stream";
import { readFlowState, writeFlowState } from "../runs.js";

export function parseSetWorktreeModeArgs(
  tokens: string[]
): { mode: "single-tree" | "worktree-first" } | null {
  let mode: "single-tree" | "worktree-first" | null = null;
  for (const token of tokens) {
    if (token.startsWith("--mode=")) {
      const raw = token.slice("--mode=".length).trim();
      if (raw === "single-tree" || raw === "worktree-first") {
        mode = raw;
      }
    }
  }
  if (!mode) return null;
  return { mode };
}

/**
 * Set `flow-state.json::worktreeExecutionMode` without advancing the stage DAG.
 */
export async function runSetWorktreeMode(
  projectRoot: string,
  tokens: string[],
  io: { stderr: Writable }
): Promise<number> {
  const parsed = parseSetWorktreeModeArgs(tokens);
  if (!parsed) {
    io.stderr.write(
      "cclaw internal set-worktree-mode: usage: --mode=single-tree|worktree-first\n"
    );
    return 1;
  }
  const state = await readFlowState(projectRoot);
  await writeFlowState(
    projectRoot,
    { ...state, worktreeExecutionMode: parsed.mode },
    { writerSubsystem: "set-worktree-mode" }
  );
  return 0;
}
