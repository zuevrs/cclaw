import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KnowledgeStoreError,
  appendKnowledgeEntry,
  findRefiningChain,
  knowledgeLogPath,
  readKnowledgeLog
} from "../../src/knowledge-store.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

describe("knowledge-store", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("appends entries one per line", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const entry = {
      slug: "alpha",
      ship_commit: "abc1234",
      shipped_at: "2026-05-07T00:00:00Z",
      signals: { hasArchitectDecision: true, reviewIterations: 1, securityFlag: false, userRequestedCapture: false }
    };
    await appendKnowledgeEntry(project, entry);
    await appendKnowledgeEntry(project, { ...entry, slug: "beta" });
    const raw = await fs.readFile(knowledgeLogPath(project), "utf8");
    expect(raw.split("\n").filter((line) => line.length > 0)).toHaveLength(2);
  });

  it("readKnowledgeLog round-trips entries", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await appendKnowledgeEntry(project, {
      slug: "alpha",
      ship_commit: "deadbeef",
      shipped_at: "2026-05-07T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 4, securityFlag: false, userRequestedCapture: false }
    });
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(1);
    expect(entries[0].signals.reviewIterations).toBe(4);
  });

  it("rejects entries missing required fields", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await expect(
      appendKnowledgeEntry(project, {
        slug: "",
        ship_commit: "x",
        shipped_at: "y",
        signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false }
      })
    ).rejects.toBeInstanceOf(KnowledgeStoreError);
  });

  it("rejects malformed JSON lines on read", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "not json\n", "utf8");
    await expect(readKnowledgeLog(project)).rejects.toBeInstanceOf(KnowledgeStoreError);
  });

  it("findRefiningChain follows refines pointers", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await appendKnowledgeEntry(project, {
      slug: "v3",
      ship_commit: "ccc",
      shipped_at: "2026-05-07T03:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: true },
      refines: "v2"
    });
    await appendKnowledgeEntry(project, {
      slug: "v2",
      ship_commit: "bbb",
      shipped_at: "2026-05-07T02:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: true },
      refines: "v1"
    });
    await appendKnowledgeEntry(project, {
      slug: "v1",
      ship_commit: "aaa",
      shipped_at: "2026-05-07T01:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: true }
    });

    const chain = await findRefiningChain(project, "v3");
    expect(chain.map((entry) => entry.slug)).toEqual(["v3", "v2", "v1"]);
  });
});
