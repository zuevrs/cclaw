import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { listShippedSlugs } from "../../src/parent-context.js";
import { ARTIFACT_FILE_NAMES, shippedArtifactDir } from "../../src/artifact-paths.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.109 — `listShippedSlugs` returns newest-first (reverse-
 * chronological for YYYYMMDD- slugs). Pre-v8.109 the function
 * sorted ascending, surfacing the OLDEST 10 slugs in the
 * "showing 10 of N" sample inside the unknown-slug error message —
 * the opposite of what a user reaching for `/cc extend` actually
 * wants.
 */
describe("v8.109 — listShippedSlugs is newest-first", () => {
  let project: string;
  beforeEach(async () => {
    project = await createTempProject({ prefix: "cclaw-v8109-list-shipped-" });
  });
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  async function seed(slug: string): Promise<void> {
    const dir = shippedArtifactDir(project, slug);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, ARTIFACT_FILE_NAMES.plan),
      `---\nslug: ${slug}\nstage: plan\nstatus: shipped\n---\n\n# ${slug}\n`,
      "utf8"
    );
  }

  it("returns slugs in reverse-chronological order (newest first)", async () => {
    await seed("20260101-old");
    await seed("20260520-newest");
    await seed("20260315-middle");
    const slugs = await listShippedSlugs(project);
    expect(slugs).toEqual(["20260520-newest", "20260315-middle", "20260101-old"]);
  });

  it("breaks same-day ties reverse-lexicographically (stable on topic suffix)", async () => {
    await seed("20260101-alpha");
    await seed("20260101-gamma");
    await seed("20260101-beta");
    const slugs = await listShippedSlugs(project);
    expect(slugs).toEqual(["20260101-gamma", "20260101-beta", "20260101-alpha"]);
  });

  it("returns empty array when no shipped flows exist", async () => {
    const slugs = await listShippedSlugs(project);
    expect(slugs).toEqual([]);
  });
});
