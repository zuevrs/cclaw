import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  KnowledgeStoreError,
  PROBLEM_TYPES,
  knowledgeLogPath,
  matchesProblemType,
  readKnowledgeLog,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

const baseEntry = (overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  slug: "alpha",
  ship_commit: "abc1234",
  shipped_at: "2026-05-07T00:00:00Z",
  signals: { hasArchitectDecision: true, reviewIterations: 1, securityFlag: false, userRequestedCapture: false },
  ...overrides
});

async function writeLog(project: string, entries: KnowledgeEntry[]): Promise<void> {
  const target = knowledgeLogPath(project);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, entries.map((e) => JSON.stringify(e)).join("\n") + (entries.length ? "\n" : ""), "utf8");
}

describe("knowledge-store — read-side helpers consumed by cli.ts", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("readKnowledgeLog returns [] when the log is missing", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const entries = await readKnowledgeLog(project);
    expect(entries).toEqual([]);
  });

  it("readKnowledgeLog round-trips well-formed entries", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const a = baseEntry({ slug: "alpha", signals: { hasArchitectDecision: false, reviewIterations: 4, securityFlag: false, userRequestedCapture: false } });
    const b = baseEntry({ slug: "beta" });
    await writeLog(project, [a, b]);
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.slug).toBe("alpha");
    expect(entries[0]!.signals.reviewIterations).toBe(4);
    expect(entries[1]!.slug).toBe("beta");
  });

  it("readKnowledgeLog rejects malformed JSON lines", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "not json\n", "utf8");
    await expect(readKnowledgeLog(project)).rejects.toBeInstanceOf(KnowledgeStoreError);
  });

  it("readKnowledgeLog rejects entries missing required fields", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(
      target,
      `${JSON.stringify({ slug: "", ship_commit: "x", shipped_at: "y", signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false } })}\n`,
      "utf8"
    );
    await expect(readKnowledgeLog(project)).rejects.toBeInstanceOf(KnowledgeStoreError);
  });

  it("matchesProblemType surfaces absent / null problemType only under the `knowledge` filter", () => {
    const absent = baseEntry();
    const nulled = baseEntry({ problemType: null });
    const bug = baseEntry({ problemType: "bug" });
    expect(matchesProblemType(absent, "knowledge")).toBe(true);
    expect(matchesProblemType(absent, "bug")).toBe(false);
    expect(matchesProblemType(nulled, "knowledge")).toBe(true);
    expect(matchesProblemType(nulled, "bug")).toBe(false);
    expect(matchesProblemType(bug, "bug")).toBe(true);
    expect(matchesProblemType(bug, "knowledge")).toBe(false);
  });

  it("PROBLEM_TYPES lists the five canonical values", () => {
    expect(PROBLEM_TYPES).toEqual(["bug", "knowledge", "decision", "performance", "refactor"]);
  });
});
