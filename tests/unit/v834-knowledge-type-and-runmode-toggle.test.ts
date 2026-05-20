import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  KnowledgeStoreError,
  knowledgeLogPath,
  matchesProblemType,
  readKnowledgeLog,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.34 — KnowledgeEntry `problemType` field wiring.
 *
 * Slimmed in v8.100: kept only the knowledge-store wiring tests.
 * v8.109 honesty sweep — rewrote to test the read-side validator
 * (`readKnowledgeLog` / `matchesProblemType`) on file-written
 * fixtures. The write helpers (`appendKnowledgeEntry`,
 * `findNearKnowledge`) were deleted as dead code; the LLM writes
 * `knowledge.jsonl` directly via `Write` / `Bash`, so the field
 * contract surface is the entry validator (`assertEntry`) and the
 * filter helper (`matchesProblemType`).
 */
describe("v8.34 — KnowledgeEntry `problemType` field wiring", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  async function writeLog(entries: KnowledgeEntry[]): Promise<void> {
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""), "utf8");
  }

  it("round-trips `problemType` through read", async () => {
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
    await writeLog([entry]);
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.problemType).toBe("bug");
  });

  it("rejects an entry whose `problemType` is not in the enum", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const bad = {
      slug: "v8.34-bad",
      ship_commit: "abc1234",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      problemType: "invalid"
    };
    await fs.writeFile(target, `${JSON.stringify(bad)}\n`, "utf8");
    await expect(readKnowledgeLog(project)).rejects.toThrow(/problemType/iu);
  });

  it("`matchesProblemType` filters entries by problemType (with back-compat for absent/null)", async () => {
    const bug: KnowledgeEntry = {
      slug: "20260510-bug-slug",
      ship_commit: "a",
      shipped_at: "2026-05-10T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 1, securityFlag: true, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "bug"
    };
    const decision: KnowledgeEntry = {
      slug: "20260511-decision-slug",
      ship_commit: "b",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: true, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "decision"
    };
    const legacy: KnowledgeEntry = {
      slug: "20260101-legacy",
      ship_commit: "c",
      shipped_at: "2026-01-01T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["legacy"]
    };
    const entries = [bug, decision, legacy];
    expect(entries.filter((e) => matchesProblemType(e, "bug")).map((e) => e.slug)).toEqual(["20260510-bug-slug"]);
    expect(entries.filter((e) => matchesProblemType(e, "decision")).map((e) => e.slug)).toEqual(["20260511-decision-slug"]);
    expect(entries.filter((e) => matchesProblemType(e, "knowledge")).map((e) => e.slug)).toEqual(["20260101-legacy"]);
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
    expect(entries[0]!.problemType).toBeUndefined();
  });

  it("KnowledgeStoreError is the canonical error type surfaced on malformed entries", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "not json\n", "utf8");
    await expect(readKnowledgeLog(project)).rejects.toBeInstanceOf(KnowledgeStoreError);
  });
});
