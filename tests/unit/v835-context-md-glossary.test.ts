import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONTEXT_MD_FILE_NAME,
  CONTEXT_MD_TEMPLATE,
  readContextGlossary
} from "../../src/context-glossary.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.35 — CONTEXT.md project domain glossary, slimmed in v8.100.
 *
 * Kept the `readContextGlossary` + `initCclaw --with-context` wiring
 * tests. The template-body greps and specialist prompt-greps for
 * "reads CONTEXT.md" were removed.
 */
describe("v8.35 — readContextGlossary helper", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("returns null when CONTEXT.md is absent (no-op contract)", async () => {
    project = await createTempProject();
    const body = await readContextGlossary(project);
    expect(body, "missing CONTEXT.md must be a no-op — specialists silently skip").toBeNull();
  });

  it("returns the file body when CONTEXT.md is present at project root", async () => {
    project = await createTempProject();
    const content = "# Project Context\n\n## Slug\n\nA `YYYYMMDD-<semantic-kebab>` flow id.\n";
    await fs.writeFile(path.join(project, "CONTEXT.md"), content, "utf8");
    const body = await readContextGlossary(project);
    expect(body).toBe(content);
  });

  it("never throws on a malformed CONTEXT.md (graceful — content is opaque markdown)", async () => {
    project = await createTempProject();
    const garbage = "not real markdown\u0000\u0001\u0002 binary-ish\n";
    await fs.writeFile(path.join(project, "CONTEXT.md"), garbage, "utf8");
    await expect(readContextGlossary(project)).resolves.toBe(garbage);
  });
});

describe("v8.35 — install layer respects --with-context opt-in", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("default install (no --with-context) does NOT create CONTEXT.md", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project, harnesses: ["cursor"], interactive: false });
    const stillMissing = await readContextGlossary(project);
    expect(stillMissing).toBeNull();
  });

  it("`withContext: true` install writes the canonical stub", async () => {
    project = await createTempProject();
    await initCclaw({
      cwd: project,
      harnesses: ["cursor"],
      interactive: false,
      withContext: true
    });
    const body = await readContextGlossary(project);
    expect(body).toBe(CONTEXT_MD_TEMPLATE);
  });

  it("`withContext: true` preserves an existing CONTEXT.md verbatim", async () => {
    project = await createTempProject();
    const userAuthored = "# My Custom Glossary\n\n## Frobnicate\n\nProject-specific term, do not touch.\n";
    await fs.writeFile(path.join(project, CONTEXT_MD_FILE_NAME), userAuthored, "utf8");
    await initCclaw({
      cwd: project,
      harnesses: ["cursor"],
      interactive: false,
      withContext: true
    });
    const body = await readContextGlossary(project);
    expect(body, "install must not overwrite an existing CONTEXT.md authored by the user").toBe(userAuthored);
  });
});
