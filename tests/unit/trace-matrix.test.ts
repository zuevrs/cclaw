import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildTraceMatrix } from "../../src/trace-matrix.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

async function ensureArtifactsDir(root: string): Promise<void> {
  await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
}

describe("trace-matrix", () => {
  it("returns empty matrix when no artifacts are present", async () => {
    const root = await createTempProject("trace-empty");
    await ensureArtifactsDir(root);

    const matrix = await buildTraceMatrix(root);

    expect(matrix.entries).toEqual([]);
    expect(matrix.orphanedCriteria).toEqual([]);
    expect(matrix.orphanedTasks).toEqual([]);
    expect(matrix.orphanedTests).toEqual([]);
  });

  it("traces AC-1 through tasks, slices, and Layer 1 review findings", async () => {
    const root = await createTempProject("trace-happy-path");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1: Login accepts valid credentials.\n- AC-2: Login rejects invalid credentials.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n| Task | Criteria |\n|---|---|\n| T-1 | AC-1 |\n| T-2 | AC-2 |\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/06-tdd.md",
      `# TDD\n\n- S-1 covers T-1 (RED→GREEN).\n- S-2 covers T-2.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/07-review.md",
      `# Review\n\n## Layer 1 Spec Compliance\n\n- AC-1: PASS at src/auth.ts:12 with evidence from tests.\n- AC-2: PASS at src/auth.ts:24.\n\n## Layer 2\n\n- unrelated findings.\n`
    );

    const matrix = await buildTraceMatrix(root);

    expect(matrix.entries).toHaveLength(2);
    const ac1 = matrix.entries.find((entry) => entry.criterionId === "AC-1");
    expect(ac1?.taskIds).toEqual(["T-1"]);
    expect(ac1?.testSlices).toEqual(["S-1"]);
    expect(ac1?.reviewFindings.length).toBeGreaterThan(0);
    expect(ac1?.reviewFindings[0]).toContain("AC-1");

    expect(matrix.orphanedCriteria).toEqual([]);
    expect(matrix.orphanedTasks).toEqual([]);
    expect(matrix.orphanedTests).toEqual([]);
  });

  it("detects criteria with no linked tasks as orphans", async () => {
    const root = await createTempProject("trace-orphan-ac");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1 first.\n- AC-2 never referenced in plan.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n- T-1 implements AC-1.\n`
    );

    const matrix = await buildTraceMatrix(root);

    expect(matrix.orphanedCriteria).toEqual(["AC-2"]);
  });

  it("detects tasks that are never covered by any test slice", async () => {
    const root = await createTempProject("trace-orphan-task");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1 covers login.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n- T-1 implements AC-1.\n- T-2 helper utility for AC-1.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/06-tdd.md",
      `# TDD\n\n- S-1 covers T-1.\n`
    );

    const matrix = await buildTraceMatrix(root);

    expect(matrix.orphanedTasks).toEqual(["T-2"]);
  });

  it("detects test slices with no underlying AC as orphans", async () => {
    const root = await createTempProject("trace-orphan-test");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1 covers login.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n- T-1 implements AC-1.\n- T-9 refactor without AC link.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/06-tdd.md",
      `# TDD\n\n- S-1 covers T-1.\n- S-9 covers T-9.\n`
    );

    const matrix = await buildTraceMatrix(root);

    expect(matrix.orphanedTests).toContain("S-9");
    expect(matrix.orphanedTests).not.toContain("S-1");
  });

  it("dedups repeated task references in plan and keeps insertion order", async () => {
    const root = await createTempProject("trace-dedup");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1 and AC-2 coverage.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n- T-1 implements AC-1.\n- T-1 again AC-2 (re-referenced).\n- T-2 later for AC-2.\n`
    );

    const matrix = await buildTraceMatrix(root);

    const ac1 = matrix.entries.find((entry) => entry.criterionId === "AC-1");
    const ac2 = matrix.entries.find((entry) => entry.criterionId === "AC-2");

    expect(ac1?.taskIds).toEqual(["T-1"]);
    expect(ac2?.taskIds).toEqual(["T-1", "T-2"]);
  });

  it("handles Layer 1 section that does not exist yet", async () => {
    const root = await createTempProject("trace-no-layer1");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1 initial criterion.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n- T-1 implements AC-1.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/06-tdd.md",
      `# TDD\n\n- S-1 covers T-1.\n`
    );

    const matrix = await buildTraceMatrix(root);

    const ac1 = matrix.entries.find((entry) => entry.criterionId === "AC-1");
    expect(ac1?.reviewFindings).toEqual([]);
  });

  it("does not double-count the same AC repeated on the same plan line", async () => {
    const root = await createTempProject("trace-same-line-dup");
    await ensureArtifactsDir(root);

    await writeProjectFile(
      root,
      ".cclaw/artifacts/04-spec.md",
      `# Spec\n\n- AC-1 login criterion.\n`
    );
    await writeProjectFile(
      root,
      ".cclaw/artifacts/05-plan.md",
      `# Plan\n\n- T-1 implements AC-1 and verifies AC-1 again.\n`
    );

    const matrix = await buildTraceMatrix(root);

    const ac1 = matrix.entries.find((entry) => entry.criterionId === "AC-1");
    expect(ac1?.taskIds).toEqual(["T-1"]);
  });
});
