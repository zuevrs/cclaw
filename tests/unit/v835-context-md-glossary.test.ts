import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CONTEXT_MD_FILE_NAME,
  CONTEXT_MD_TEMPLATE,
  contextGlossaryPath,
  readContextGlossary
} from "../../src/context-glossary.js";
import {
  ARCHITECT_PROMPT,
  BUILDER_PROMPT,
  REVIEWER_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { initCclaw } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.35 — Project domain glossary (`CONTEXT.md`).
 *
 * Adapted from mattpocock's pattern: optional file at project root that
 * cclaw specialists read at the start of every dispatch. Carries
 * project-specific definitions for domain terms ("AC", "slug",
 * "compound capture", and project-specific vocabulary) so the LLM does
 * not have to reverse-engineer them from source.
 *
 * The contract:
 *   - **Missing CONTEXT.md is a no-op.** Specialists silently skip it.
 *   - **Present CONTEXT.md is read once per dispatch.** Each specialist
 *     (`architect`, `builder`, `reviewer` — v8.62 unified flow roster;
 *     `architect` absorbs the v8.62-retired `design`'s reads, `builder`
 *     is the v8.62 rename of `slice-builder`) carries a "Phase 0: read
 *     CONTEXT.md if it exists" line at the top of its input list.
 *   - **The template is a stub.** When the user opts in (via
 *     `cclaw install --with-context` or by manually creating the file),
 *     the stub seeds H2 sections + 1-2 line definitions for the
 *     canonical cclaw vocabulary; the user fills in project-specific
 *     terms.
 *
 * Tripwires:
 *   AC-1 — `CONTEXT_MD_TEMPLATE` exports a non-empty stub with H2
 *          sections covering the canonical cclaw vocabulary.
 *   AC-2 — `readContextGlossary` returns the file body when present;
 *          returns null when absent (no-op).
 *   AC-3 — Every flow-stage specialist (`architect`, `builder`,
 *          `reviewer` — v8.62 unified flow roster) carries the
 *          CONTEXT.md read in its inputs / Phase 0 section.
 *   AC-4 — `contextGlossaryPath` joins the projectRoot + canonical
 *          file name; the file name is `CONTEXT.md` (uppercase, at
 *          project root, mirroring the mattpocock convention).
 *   AC-5 — The template carries the canonical H2 sections so it is
 *          recognisable as the cclaw stub (and a future "is this our
 *          template?" check has a stable anchor).
 */

describe("v8.35 — CONTEXT.md template (item 8)", () => {
  it("AC-1 — CONTEXT_MD_TEMPLATE exports a non-empty markdown stub", () => {
    expect(CONTEXT_MD_TEMPLATE.length, "the template body must be non-trivial").toBeGreaterThan(400);
  });

  it("AC-5 — template opens with a top-level H1 that names the project domain glossary", () => {
    expect(CONTEXT_MD_TEMPLATE).toMatch(/^#\s+.{0,80}(Project (Context|Domain|Glossary)|CONTEXT|Domain Glossary)/m);
  });

  it("AC-5 — template carries the canonical H2 sections for cclaw vocabulary", () => {
    // The stub seeds the cclaw vocabulary so a fresh project that opts
    // into CONTEXT.md gets all the load-bearing terms documented out
    // of the box; the user customises with project-specific terms.
    const REQUIRED_SECTIONS = ["Slug", "Acceptance Criterion", "Compound capture"];
    for (const section of REQUIRED_SECTIONS) {
      const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      expect(
        CONTEXT_MD_TEMPLATE,
        `template must carry an H2 for "${section}" so fresh projects get the cclaw vocabulary documented out of the box`
      ).toMatch(new RegExp(`^##\\s+${escaped}\\b`, "m"));
    }
  });

  it("AC-5 — template includes a `<!-- cclaw-context: stub -->` marker so future tooling can identify untouched stubs", () => {
    expect(
      CONTEXT_MD_TEMPLATE,
      "the marker comment is the anchor for 'is this our untouched stub?' checks (deferred to v8.36+ tooling)"
    ).toMatch(/<!--\s*cclaw-context:\s*stub\s*-->/);
  });

  it("AC-5 — template instructs the user to add project-specific terms after the seed sections", () => {
    expect(CONTEXT_MD_TEMPLATE).toMatch(/project-specific|your project|add.{0,40}terms/iu);
  });

  it("AC-4 — `CONTEXT_MD_FILE_NAME` is the literal `CONTEXT.md` (uppercase, at project root)", () => {
    expect(CONTEXT_MD_FILE_NAME).toBe("CONTEXT.md");
  });

  it("AC-4 — `contextGlossaryPath(projectRoot)` returns `<projectRoot>/CONTEXT.md`", () => {
    expect(contextGlossaryPath("/tmp/sample")).toBe(path.join("/tmp/sample", "CONTEXT.md"));
  });
});

describe("v8.35 — readContextGlossary helper (item 8)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-2 — returns null when CONTEXT.md is absent (no-op contract)", async () => {
    project = await createTempProject();
    const body = await readContextGlossary(project);
    expect(body, "missing CONTEXT.md must be a no-op — specialists silently skip").toBeNull();
  });

  it("AC-2 — returns the file body when CONTEXT.md is present at project root", async () => {
    project = await createTempProject();
    const content = "# Project Context\n\n## Slug\n\nA `YYYYMMDD-<semantic-kebab>` flow id.\n";
    await fs.writeFile(path.join(project, "CONTEXT.md"), content, "utf8");
    const body = await readContextGlossary(project);
    expect(body).toBe(content);
  });

  it("AC-2 — never throws on a malformed CONTEXT.md (graceful — content is opaque markdown)", async () => {
    project = await createTempProject();
    // Even bogus content should round-trip — the helper does not parse, only reads.
    const garbage = "not real markdown\u0000\u0001\u0002 binary-ish\n";
    await fs.writeFile(path.join(project, "CONTEXT.md"), garbage, "utf8");
    await expect(readContextGlossary(project)).resolves.toBe(garbage);
  });
});

describe("v8.35 — specialist prompts read CONTEXT.md (item 8)", () => {
  // Each flow-stage specialist that runs in a sub-agent context should
  // read CONTEXT.md at the start of its dispatch. This catches the case
  // where the file is silently dropped from a single specialist's
  // input list and the LLM loses access to the project vocabulary.
  //
  // The pattern names the file (`CONTEXT.md`) AND the read-if-exists
  // semantics so the regex catches both reads with one match.
  const READ_LINE_RE = /CONTEXT\.md/;
  const READ_IF_EXISTS_RE = /CONTEXT\.md.{0,80}(if it exists|when present|when it exists|when the file exists|optional|may exist)|optional.{0,60}CONTEXT\.md|read.{0,80}CONTEXT\.md/iu;

  it("AC-3 — architect prompt reads CONTEXT.md (v8.62 — `architect` is the v8.62 rename of `ac-author` and absorbs the dead `design` specialist's CONTEXT.md read)", () => {
    expect(ARCHITECT_PROMPT, "architect specialist must reference CONTEXT.md").toMatch(READ_LINE_RE);
    expect(
      ARCHITECT_PROMPT,
      "architect must declare the read-if-exists semantics so it never errors when the file is absent"
    ).toMatch(READ_IF_EXISTS_RE);
  });

  it("AC-3 — builder prompt reads CONTEXT.md (v8.62 — `builder` is the v8.62 rename of `slice-builder`; CONTEXT.md read contract unchanged)", () => {
    expect(BUILDER_PROMPT).toMatch(READ_LINE_RE);
    expect(BUILDER_PROMPT).toMatch(READ_IF_EXISTS_RE);
  });

  it("AC-3 — reviewer prompt reads CONTEXT.md", () => {
    expect(REVIEWER_PROMPT).toMatch(READ_LINE_RE);
    expect(REVIEWER_PROMPT).toMatch(READ_IF_EXISTS_RE);
  });

  it("AC-3 — the read instruction does not change observable dispatch behaviour when CONTEXT.md is absent", () => {
    // The phrase MUST be guarded so a specialist never erroneously
    // hard-requires the file. Both "if it exists" and "when present"
    // are acceptable guard phrases; the test checks both ways.
    for (const [name, body] of [
      ["architect", ARCHITECT_PROMPT],
      ["builder", BUILDER_PROMPT],
      ["reviewer", REVIEWER_PROMPT]
    ] as const) {
      expect(
        body,
        `${name} must guard the CONTEXT.md read with "if it exists" / "when present" so a missing file is not a dispatch failure`
      ).toMatch(/CONTEXT\.md[\s\S]{0,200}(if it exists|when present|when it exists|when the file exists|optional|may exist|if the file exists|skip silently)/iu);
    }
  });
});

describe("v8.35 — install layer respects --with-context opt-in (item 8)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  /**
   * The default install path MUST NOT create a CONTEXT.md. The file is
   * opt-in vocabulary the user authors — surprising them with a
   * project-root markdown stub on a plain `cclaw install` would be
   * loud, hard to revert (git tracks it), and would tarpit users who
   * never asked for it.
   */
  it("AC-6 — default install (no --with-context) does NOT create CONTEXT.md", async () => {
    project = await createTempProject();
    await initCclaw({ cwd: project, harnesses: ["cursor"], interactive: false });
    const stillMissing = await readContextGlossary(project);
    expect(stillMissing).toBeNull();
  });

  /**
   * With `--with-context`, the install layer writes the cclaw-shipped
   * stub at project root (when missing). Tripwire: the body MUST match
   * `CONTEXT_MD_TEMPLATE` exactly so a re-run after a content bump
   * gives a deterministic diff.
   */
  it("AC-6 — `withContext: true` install writes the canonical stub", async () => {
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

  /**
   * The install layer NEVER overwrites an existing CONTEXT.md.
   * Whether the user authored it manually, used a non-cclaw template,
   * or ran `--with-context` once and then edited it — re-running with
   * `--with-context` MUST preserve the existing body verbatim.
   */
  it("AC-6 — `withContext: true` preserves an existing CONTEXT.md verbatim", async () => {
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
