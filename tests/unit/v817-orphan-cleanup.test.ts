import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import type { ProgressEvent } from "../../src/ui.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.17 orphan-skill cleanup. After v8.16 collapsed 24 skills into 17 via
 * 6 thematic merges, `cclaw sync` (and `upgrade` / `init`) on an existing
 * install left the 13 retired `.md` files orphaned in `.cclaw/lib/skills/`.
 *
 * v8.17 teaches the install layer to garbage-collect those orphans:
 * after the write loop, list `.cclaw/lib/skills/*.md`, diff against the
 * expected set (every `AUTO_TRIGGER_SKILLS[i].fileName` + `cclaw-meta.md`),
 * and `fs.rm` the unexpected ones. Loud (one progress event per removed
 * file + summary line if N > 0). Surgical (`.md` files only; subdirs,
 * non-`.md` siblings, and anything outside `.cclaw/lib/skills/` survive).
 *
 * Each tripwire test pins one invariant so a future install-layer change
 * (forgetting the scan, broadening the predicate, deleting under a
 * directory it shouldn't) lights up immediately.
 */

const SKILLS_DIR = path.join(".cclaw", "lib", "skills");
const TEMPLATES_DIR = path.join(".cclaw", "lib", "templates");

function captureProgress(): {
  events: ProgressEvent[];
  onProgress: (event: ProgressEvent) => void;
} {
  const events: ProgressEvent[] = [];
  return {
    events,
    onProgress: (event) => {
      events.push(event);
    },
  };
}

async function seedOrphan(projectRoot: string, fileName: string): Promise<void> {
  const target = path.join(projectRoot, SKILLS_DIR, fileName);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, `---\nname: ${fileName.replace(/\.md$/u, "")}\n---\nseed body\n`, "utf8");
}

const EXPECTED_FILE_NAMES = new Set<string>([
  "cclaw-meta.md",
  ...AUTO_TRIGGER_SKILLS.map((s) => s.fileName),
]);

describe("v8.17 orphan-skill cleanup in .cclaw/lib/skills/", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("baseline sync with no orphans is a silent no-op (no removal events, no errors)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const before = (await fs.readdir(path.join(project, SKILLS_DIR))).sort();
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    const after = (await fs.readdir(path.join(project, SKILLS_DIR))).sort();
    expect(after).toEqual(before);
    expect(events.find((e) => e.step === "Removed orphan skill")).toBeUndefined();
    expect(events.find((e) => e.step === "Cleaned orphan skills")).toBeUndefined();
  });

  it("sync with 1 v8.16-era orphan removes it and emits one Removed event + summary", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedOrphan(project, "ac-quality.md");
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    await expect(fs.access(path.join(project, SKILLS_DIR, "ac-quality.md"))).rejects.toBeTruthy();
    const removed = events.filter((e) => e.step === "Removed orphan skill");
    expect(removed.length).toBe(1);
    expect(removed[0]!.detail).toBe("ac-quality.md");
    const summary = events.find((e) => e.step === "Cleaned orphan skills");
    expect(summary).toBeDefined();
    expect(summary!.detail).toMatch(/^1 orphan skill file /u);
  });

  it("sync with 3 v8.16-era orphans removes all 3 and prints summary `3 orphan skill files`", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const name of ["ac-quality.md", "tdd-cycle.md", "debug-loop.md"]) {
      await seedOrphan(project, name);
    }
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    for (const name of ["ac-quality.md", "tdd-cycle.md", "debug-loop.md"]) {
      await expect(fs.access(path.join(project, SKILLS_DIR, name))).rejects.toBeTruthy();
    }
    const removed = events.filter((e) => e.step === "Removed orphan skill").map((e) => e.detail);
    expect(removed.sort()).toEqual(["ac-quality.md", "debug-loop.md", "tdd-cycle.md"]);
    const summary = events.find((e) => e.step === "Cleaned orphan skills");
    expect(summary).toBeDefined();
    expect(summary!.detail).toMatch(/^3 orphan skill files /u);
  });

  it("sync preserves non-`.md` files in .cclaw/lib/skills/ (e.g. a stray .txt)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const strayPath = path.join(project, SKILLS_DIR, "something.txt");
    await fs.writeFile(strayPath, "user-owned note\n", "utf8");
    await syncCclaw({ cwd: project });
    const body = await fs.readFile(strayPath, "utf8");
    expect(body).toBe("user-owned note\n");
  });

  it("sync does not touch subdirectories under .cclaw/lib/skills/", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const subdir = path.join(project, SKILLS_DIR, "user-subdir");
    await fs.mkdir(subdir, { recursive: true });
    await fs.writeFile(path.join(subdir, "inside.md"), "nested\n", "utf8");
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    expect((await fs.stat(subdir)).isDirectory()).toBe(true);
    const body = await fs.readFile(path.join(subdir, "inside.md"), "utf8");
    expect(body).toBe("nested\n");
    expect(events.find((e) => e.step === "Removed orphan skill")).toBeUndefined();
  });

  it("skipOrphanCleanup: true preserves orphans and emits a single warning event", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedOrphan(project, "ac-quality.md");
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, skipOrphanCleanup: true, onProgress });
    const stat = await fs.stat(path.join(project, SKILLS_DIR, "ac-quality.md"));
    expect(stat.isFile()).toBe(true);
    expect(events.find((e) => e.step === "Removed orphan skill")).toBeUndefined();
    expect(events.find((e) => e.step === "Cleaned orphan skills")).toBeUndefined();
    const skipped = events.find((e) => e.step === "Skipped orphan cleanup");
    expect(skipped).toBeDefined();
    expect(skipped!.detail).toMatch(/--skip-orphan-cleanup/u);
  });

  it("init then plant orphan then init again removes the orphan (init runs the same scan as sync)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedOrphan(project, "review-loop.md");
    const stat1 = await fs.stat(path.join(project, SKILLS_DIR, "review-loop.md"));
    expect(stat1.isFile()).toBe(true);
    await initCclaw({ cwd: project });
    await expect(fs.access(path.join(project, SKILLS_DIR, "review-loop.md"))).rejects.toBeTruthy();
  });

  it("sync does NOT touch stray `.md` files outside .cclaw/lib/skills/ (e.g. a stray plan.md in lib/templates/)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const strayPath = path.join(project, TEMPLATES_DIR, "user-note.md");
    await fs.writeFile(strayPath, "user-owned template note\n", "utf8");
    await syncCclaw({ cwd: project });
    const body = await fs.readFile(strayPath, "utf8");
    expect(body).toBe("user-owned template note\n");
  });

  it("sync is idempotent — running sync twice in a row produces zero orphan events on the second pass", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    await seedOrphan(project, "verification-loop.md");
    await seedOrphan(project, "refactor-safety.md");
    const first = captureProgress();
    await syncCclaw({ cwd: project, onProgress: first.onProgress });
    const second = captureProgress();
    await syncCclaw({ cwd: project, onProgress: second.onProgress });
    expect(first.events.filter((e) => e.step === "Removed orphan skill").length).toBe(2);
    expect(second.events.find((e) => e.step === "Removed orphan skill")).toBeUndefined();
    expect(second.events.find((e) => e.step === "Cleaned orphan skills")).toBeUndefined();
  });

  it("after sync the .cclaw/lib/skills/ directory contains EXACTLY the expected set (AUTO_TRIGGER_SKILLS + cclaw-meta.md)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    for (const name of ["ac-quality.md", "ac-traceability.md", "commit-message-quality.md"]) {
      await seedOrphan(project, name);
    }
    await syncCclaw({ cwd: project });
    const after = await fs.readdir(path.join(project, SKILLS_DIR));
    const filesOnDisk = after.filter((name) => name.endsWith(".md"));
    expect(new Set(filesOnDisk)).toEqual(EXPECTED_FILE_NAMES);
    expect(filesOnDisk.length).toBe(AUTO_TRIGGER_SKILLS.length + 1);
  });

  it("all 13 v8.16-retired skill files are cleaned in one pass (the v8.15 → v8.17 migration story)", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project });
    const v816Retired = [
      "ac-quality.md",
      "ac-traceability.md",
      "commit-message-quality.md",
      "surgical-edit-hygiene.md",
      "tdd-cycle.md",
      "verification-loop.md",
      "refactor-safety.md",
      "api-and-interface-design.md",
      "breaking-changes.md",
      "review-loop.md",
      "security-review.md",
      "debug-loop.md",
      "browser-verification.md",
    ];
    for (const name of v816Retired) await seedOrphan(project, name);
    const { events, onProgress } = captureProgress();
    await syncCclaw({ cwd: project, onProgress });
    for (const name of v816Retired) {
      await expect(fs.access(path.join(project, SKILLS_DIR, name))).rejects.toBeTruthy();
    }
    const removedNames = events
      .filter((e) => e.step === "Removed orphan skill")
      .map((e) => e.detail);
    expect(removedNames.sort()).toEqual([...v816Retired].sort());
    const summary = events.find((e) => e.step === "Cleaned orphan skills");
    expect(summary).toBeDefined();
    expect(summary!.detail).toMatch(/^13 orphan skill files /u);
  });
});
