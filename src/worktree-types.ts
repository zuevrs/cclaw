/**
 * Git worktree lane identifiers and refs used by the v6.13 worktree-first
 * multi-slice executor. Lanes isolate slice-implementer working trees from
 * the integration checkout.
 */

/**
 * Stable lane id (e.g. `lane-S-3-a1b2c3`) under `.cclaw/worktrees/<laneId>/`.
 */
export type WorktreeLaneId = string;

/**
 * Git ref (branch name, tag, or commit sha) used as the lane baseline.
 */
export type GitBaseRef = string;

/**
 * Git ref describing the lane HEAD after local commits (often a branch tip).
 */
export type GitHeadRef = string;

/**
 * Absolute or repo-root-relative working directory for a `git/worktree`.
 */
export type WorktreeWorkdir = string;

/**
 * Metadata for one active lane tied to a TDD slice.
 */
export interface WorktreeLaneInfo {
  /** Lane id; directory basename under `.cclaw/worktrees/`. */
  laneId: WorktreeLaneId;
  /** Slice this lane is bound to (e.g. `S-12`). */
  sliceId: string;
  /** Integration baseline the lane was created from. */
  baseRef: GitBaseRef;
  /** Optional named branch inside the lane worktree. */
  branchName?: string;
  /** Resolved filesystem path to the worktree root. */
  workdir: WorktreeWorkdir;
}
