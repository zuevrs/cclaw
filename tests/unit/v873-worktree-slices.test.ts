import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";
import * as sliceWorktree from "../../src/slice-worktree.js";

/**
 * v8.73 — Worktree-isolated parallel slices.
 *
 * Each independent-layer sub-builder dispatch materialises its own git
 * worktree (`../<projectName>-<slug>-<sliceId>` on disposable branch
 * `cclaw/<slug>-<sliceId>`) so concurrent TDD cycles cannot race on
 * the shared working tree. The plan-critic §4b independence check is
 * tightened to require literal zero-file-overlap as the only
 * acceptable proof of independence; partial-path overlap (a slice's
 * `Surface` containing a parent dir of another slice's file) is the
 * same `block-ship` finding. Ship + cancel hooks call the cleanup
 * helper per stamped `worktreePath`.
 *
 * Tripwires:
 *   1. `src/slice-worktree.ts` exports `createSliceWorktree`,
 *      `mergeSliceWorktree`, `cleanupSliceWorktree`.
 *   2. Builder prompt mentions worktree-per-independent-slice on
 *      multi-slice layers + the v8.73 fast-forward CI gate.
 *   3. Plan-critic prompt mentions zero-file-overlap as the
 *      independence proof and partial-path overlap as a block-ship.
 *   4. Compound + cancel layers invoke `cleanupSliceWorktreeAsync`
 *      per stamped `worktreePath` so ship and cancel both drop
 *      sibling worktrees.
 *   5. SliceState carries optional `worktreePath?: string` and
 *      FlowState carries optional `slice_merge_failures?: SliceId[]`.
 *   6. package.json >= 8.73.0 + CHANGELOG carries the v8.73 entry.
 */

const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");

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
    // Use path.join in the expected value so the assertion is
    // platform-portable (Windows uses `\\` separators); the contract
    // is "sibling directory with -<slug>-<sliceId> suffix on the
    // base name", not a specific separator shape.
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

describe("v8.73 — builder mentions worktree-per-independent-slice on multi-slice layers", () => {
  it("declares the worktree-per-independent-slice step in the parallel dispatch protocol", () => {
    expect(BUILDER_PROMPT).toMatch(/Worktree-per-independent-slice/i);
    expect(BUILDER_PROMPT).toMatch(/v8\.73/);
    expect(BUILDER_PROMPT).toContain("createSliceWorktree");
  });

  it("scopes the worktree dispatch to layers of >=2 slices (single-slice layers stay inline)", () => {
    expect(BUILDER_PROMPT).toMatch(/multi-slice layer|≥2 slices|≥2 independent|2 or more slices/i);
    expect(BUILDER_PROMPT).toMatch(/Single-slice layers|N==1|size 1 → inline|single-slice/i);
  });

  it("names the worktreePath envelope field sub-builders must cd into", () => {
    expect(BUILDER_PROMPT).toContain("worktreePath");
  });

  it("mentions fast-forward merge + CI gate after layer completes", () => {
    expect(BUILDER_PROMPT).toMatch(/fast-forward merge/i);
    expect(BUILDER_PROMPT).toContain("mergeSliceWorktree");
    expect(BUILDER_PROMPT).toMatch(/CI gate/i);
  });

  it("routes merge-conflict despite plan-critic clearance to BLOCKED with details (v8.68 protocol)", () => {
    expect(BUILDER_PROMPT).toMatch(/slice_merge_failures/);
    expect(BUILDER_PROMPT).toMatch(/BLOCKED/);
  });

  it("calls out the worktree lifecycle helper table referencing src/slice-worktree.ts", () => {
    expect(BUILDER_PROMPT).toContain("src/slice-worktree.ts");
    expect(BUILDER_PROMPT).toMatch(/createSliceWorktree[\s\S]*mergeSliceWorktree[\s\S]*cleanupSliceWorktree/);
  });
});

describe("v8.73 — plan-critic mentions zero-file-overlap as the independence proof", () => {
  it("declares zero-file-overlap as the only acceptable proof of independence", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/zero[-\s]file[-\s]overlap/i);
  });

  it("computes literal set-intersection of Surface columns across independent slices", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/set-intersection|set intersection|intersection of every pair|literal set/i);
    expect(PLAN_CRITIC_PROMPT).toContain("Surface");
  });

  it("flags an independence claim that fails zero-file-overlap as block-ship (class=independence-mismatch)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/independence-mismatch/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/block-ship/);
  });

  it("treats partial-path overlap (parent dir vs nested file) as the same block-ship finding", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/partial[-\s]path overlap/i);
  });

  it("links the gate to the v8.73 worktree-isolated dispatch + fast-forward merge protocol", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/worktree[-\s]isolated/i);
    expect(PLAN_CRITIC_PROMPT).toMatch(/v8\.73/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/fast-forward merge/i);
  });
});

describe("v8.73 — worktree cleanup on ship and cancel", () => {
  it("compound layer (ship) imports and invokes the worktree cleanup helper", async () => {
    const source = await fs.readFile(
      path.join(REPO_ROOT, "src/compound.ts"),
      "utf-8"
    );
    expect(source).toContain("cleanupSliceWorktreeAsync");
    expect(source).toContain("slice.worktreePath");
  });

  it("cancel layer imports and invokes the worktree cleanup helper", async () => {
    const source = await fs.readFile(
      path.join(REPO_ROOT, "src/cancel.ts"),
      "utf-8"
    );
    expect(source).toContain("cleanupSliceWorktreeAsync");
    expect(source).toContain("slice.worktreePath");
  });

  it("both hooks iterate over flow-state.slices to cover every stamped worktreePath", async () => {
    const compoundSource = await fs.readFile(
      path.join(REPO_ROOT, "src/compound.ts"),
      "utf-8"
    );
    const cancelSource = await fs.readFile(
      path.join(REPO_ROOT, "src/cancel.ts"),
      "utf-8"
    );
    expect(compoundSource).toMatch(/state\.slices/);
    expect(cancelSource).toMatch(/state\.slices/);
  });
});

describe("v8.73 — types carry worktreePath + slice_merge_failures", () => {
  it("SliceState declares optional worktreePath?: string", async () => {
    const typesSource = await fs.readFile(
      path.join(REPO_ROOT, "src/types.ts"),
      "utf-8"
    );
    expect(typesSource).toMatch(/worktreePath\?:\s*string/);
    expect(typesSource).toMatch(/v8\.73/);
  });

  it("FlowState declares optional slice_merge_failures?: SliceId[]", async () => {
    const fsSource = await fs.readFile(
      path.join(REPO_ROOT, "src/flow-state.ts"),
      "utf-8"
    );
    expect(fsSource).toMatch(/slice_merge_failures\?:\s*SliceId\[\]/);
  });

  it("flow-state validator accepts present worktreePath as a non-empty string", async () => {
    const fsSource = await fs.readFile(
      path.join(REPO_ROOT, "src/flow-state.ts"),
      "utf-8"
    );
    expect(fsSource).toContain("flow-state.slices.worktreePath");
  });

  it("flow-state validator accepts present slice_merge_failures as a string array", async () => {
    const fsSource = await fs.readFile(
      path.join(REPO_ROOT, "src/flow-state.ts"),
      "utf-8"
    );
    expect(fsSource).toContain("flow-state.slice_merge_failures");
  });
});

describe("v8.73 — version bump + CHANGELOG", () => {
  it("package.json declares >= 8.73.0", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(REPO_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map(Number) as [number, number, number];
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(73);
  });

  it("CHANGELOG mentions v8.73 with the worktree-isolated parallel slices heading", async () => {
    const changelog = await fs.readFile(
      path.join(REPO_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/8\.73\.0/);
    expect(changelog).toMatch(/Worktree-isolated parallel slices/i);
  });
});
