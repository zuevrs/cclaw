import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  appendKnowledgeEntry,
  findNearKnowledge,
  knowledgeLogPath,
  readKnowledgeLog,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.34 — KnowledgeEntry `problemType` field wiring.
 *
 * Slimmed in v8.100: kept only the knowledge-store wiring tests
 * (append + read + findNearKnowledge round-trips). The
 * renderStartCommand prompt-grep tripwires for the v8.61-retired
 * mid-flight runMode toggle were removed.
 */
describe("v8.34 — KnowledgeEntry `problemType` field wiring", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("round-trips `problemType` through append + read", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const entry: KnowledgeEntry = {
      slug: "v8.34-bug",
      ship_commit: "abc1234",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 1, securityFlag: true, userRequestedCapture: false },
      problemType: "bug",
      tags: ["security"]
    };
    await appendKnowledgeEntry(project, entry);
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(1);
    expect(entries[0].problemType).toBe("bug");
  });

  it("rejects an entry whose `problemType` is not in the enum", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await expect(
      appendKnowledgeEntry(project, {
        slug: "v8.34-bad",
        ship_commit: "abc1234",
        shipped_at: "2026-05-11T00:00:00Z",
        signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
        // @ts-expect-error — runtime validation should reject this
        problemType: "invalid"
      })
    ).rejects.toThrow(/problemType/i);
  });

  it("`findNearKnowledge` returns ONLY entries whose `problemType` matches the filter", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await appendKnowledgeEntry(project, {
      slug: "20260510-bug-slug",
      ship_commit: "a",
      shipped_at: "2026-05-10T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 1, securityFlag: true, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "bug"
    });
    await appendKnowledgeEntry(project, {
      slug: "20260511-decision-slug",
      ship_commit: "b",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: true, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "decision"
    });
    await appendKnowledgeEntry(project, {
      slug: "20260512-perf-slug",
      ship_commit: "c",
      shipped_at: "2026-05-12T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "performance"
    });

    const onlyBugs = await findNearKnowledge("auth permissions", project, { problemType: "bug" });
    expect(onlyBugs.map((e) => e.slug)).toEqual(["20260510-bug-slug"]);

    const onlyDecisions = await findNearKnowledge("auth permissions", project, { problemType: "decision" });
    expect(onlyDecisions.map((e) => e.slug)).toEqual(["20260511-decision-slug"]);

    const noFilter = await findNearKnowledge("auth permissions", project);
    expect(noFilter.length, "without the filter, all 3 entries hit the threshold").toBeGreaterThanOrEqual(2);
  });

  it("back-compat: legacy entries (no problemType) still validate on read", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const legacyEntry = {
      slug: "20260101-legacy-no-type",
      ship_commit: "deadbeef",
      shipped_at: "2026-01-01T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["legacy"]
    };
    await fs.writeFile(target, `${JSON.stringify(legacyEntry)}\n`, "utf8");
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(1);
    expect(entries[0].problemType).toBeUndefined();
  });
});
