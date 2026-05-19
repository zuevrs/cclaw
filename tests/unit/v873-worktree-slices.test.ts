import path from "node:path";
import { describe, expect, it } from "vitest";

import * as sliceWorktree from "../../src/slice-worktree.js";

/**
 * v8.73 — Worktree-isolated parallel slices.
 *
 * Slimmed in v8.100: kept only the `sliceWorktree.*` lifecycle helper
 * tests (createSliceWorktree, mergeSliceWorktree, cleanupSliceWorktree,
 * cleanupSliceWorktreeAsync, sliceWorktreePath, sliceWorktreeBranch,
 * SliceWorktreeError). The builder/plan-critic prompt-greps and the
 * compound/cancel/types/flow-state source-file greps were removed.
 */
describe("v8.73 — slice-worktree.ts exports lifecycle helpers", () => {
  it("exports createSliceWorktree, mergeSliceWorktree, cleanupSliceWorktree", () => {
    expect(typeof sliceWorktree.createSliceWorktree).toBe("function");
    expect(typeof sliceWorktree.mergeSliceWorktree).toBe("function");
    expect(typeof sliceWorktree.cleanupSliceWorktree).toBe("function");
  });

  it("exports the async cleanup sibling for orchestrator hooks", () => {
    expect(typeof sliceWorktree.cleanupSliceWorktreeAsync).toBe("function");
  });

  it("exports the pure path computation so callers can predict the worktree dir", () => {
    expect(typeof sliceWorktree.sliceWorktreePath).toBe("function");
    const projectRoot = path.join(path.sep, "tmp", "projects", "myrepo");
    const result = sliceWorktree.sliceWorktreePath(
      projectRoot,
      "v123-slug",
      "SL-2"
    );
    expect(result).toBe(path.join(path.sep, "tmp", "projects", "myrepo-v123-slug-SL-2"));
  });

  it("namespaces the disposable branch under cclaw/", () => {
    expect(typeof sliceWorktree.sliceWorktreeBranch).toBe("function");
    const result = sliceWorktree.sliceWorktreeBranch("v123-slug", "SL-3");
    expect(result).toBe("cclaw/v123-slug-SL-3");
  });

  it("exports the SliceWorktreeError class for callers that catch", () => {
    expect(typeof sliceWorktree.SliceWorktreeError).toBe("function");
    const err = new sliceWorktree.SliceWorktreeError("boom");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("SliceWorktreeError");
  });
});
