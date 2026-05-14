import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ANTIPATTERN_SUMMARIES,
  ANTI_RAT_CATEGORY_SUMMARIES,
  CCLAW_RULES_MARKDOWN,
  CCLAW_RULES_MDC,
  extractAntipatternHeadings,
  listAntipatternIds
} from "../../src/content/cclaw-rules.js";
import { IRON_LAWS } from "../../src/content/iron-laws.js";
import {
  SHARED_ANTI_RATIONALIZATIONS,
  type AntiRationalizationCategory
} from "../../src/content/anti-rationalizations.js";
import {
  HARNESS_LAYOUT_TABLE,
  initCclaw,
  renderHarnessRulesGuidance,
  uninstallCclaw
} from "../../src/install.js";
import { HARNESS_IDS, type HarnessId } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.55 — harness-embedded rules surface.
 *
 * Pins every contract the new feature ships:
 *
 *   - Content module shape: exports, sections, source-of-truth reuse.
 *   - MDC variant carries the Cursor frontmatter contract
 *     (`alwaysApply: true`, description, marker fences).
 *   - Per-harness install writes rules to the canonical namespaced
 *     path; `.cursor/rules/cclaw.mdc` ships the MDC body, the other
 *     three ship plain markdown at `.harness/cclaw-rules.md`.
 *   - Idempotent install (re-run does not append).
 *   - Uninstall removes every harness's rules file and tidies the
 *     `.cursor/rules/` parent if empty.
 *   - Negative: install NEVER touches project-root AGENTS.md /
 *     CLAUDE.md / GEMINI.md.
 *   - Activation guidance: `renderHarnessRulesGuidance` surfaces a
 *     per-harness line for each installed harness.
 *   - Cross-reference tripwires: antipattern IDs/titles agree with
 *     `ANTIPATTERNS` headings; anti-rat category keys agree with
 *     `SHARED_ANTI_RATIONALIZATIONS`; iron-law titles agree with
 *     `IRON_LAWS`.
 */

describe("v8.55 — content module: cclaw-rules.ts shape + section invariants", () => {
  it("exports `CCLAW_RULES_MARKDOWN` and `CCLAW_RULES_MDC` as non-empty strings", () => {
    expect(typeof CCLAW_RULES_MARKDOWN).toBe("string");
    expect(typeof CCLAW_RULES_MDC).toBe("string");
    expect(CCLAW_RULES_MARKDOWN.length).toBeGreaterThan(0);
    expect(CCLAW_RULES_MDC.length).toBeGreaterThan(CCLAW_RULES_MARKDOWN.length);
  });

  it("body contains the v8.55 ambient-rules heading", () => {
    expect(CCLAW_RULES_MARKDOWN).toMatch(/^# cclaw ambient rules$/m);
  });

  it("body carries an orientation paragraph that names `/cc` activation", () => {
    expect(CCLAW_RULES_MARKDOWN).toMatch(/`\/cc`/);
    expect(CCLAW_RULES_MARKDOWN).toMatch(/full multi-stage workflow/i);
  });

  it("body lists every Iron Law title from IRON_LAWS verbatim", () => {
    for (const law of IRON_LAWS) {
      expect(
        CCLAW_RULES_MARKDOWN,
        `Iron Law '${law.title}' must appear in the ambient rules body`
      ).toContain(law.title);
    }
  });

  it("body carries the Iron Laws heading (Karpathy)", () => {
    expect(CCLAW_RULES_MARKDOWN).toMatch(/^## Iron Laws \(Karpathy\)$/m);
  });

  it("body lists every shared anti-rationalization category key", () => {
    const expectedCategories = Object.keys(
      SHARED_ANTI_RATIONALIZATIONS
    ) as AntiRationalizationCategory[];
    for (const category of expectedCategories) {
      expect(
        CCLAW_RULES_MARKDOWN,
        `anti-rationalization category '${category}' must appear in ambient body`
      ).toContain(`\`${category}\``);
    }
  });

  it("ANTI_RAT_CATEGORY_SUMMARIES covers exactly the 5 SHARED_ANTI_RATIONALIZATIONS category keys", () => {
    const summaryKeys = ANTI_RAT_CATEGORY_SUMMARIES.map((s) => s.key).sort();
    const catalogKeys = Object.keys(SHARED_ANTI_RATIONALIZATIONS).sort();
    expect(summaryKeys).toEqual(catalogKeys);
  });

  it("body carries the antipatterns section heading", () => {
    expect(CCLAW_RULES_MARKDOWN).toMatch(/^## Top antipatterns/m);
  });

  it("body lists antipatterns A-1 through A-5 by ID", () => {
    for (const id of ["A-1", "A-2", "A-3", "A-4", "A-5"]) {
      expect(
        CCLAW_RULES_MARKDOWN,
        `antipattern ${id} must appear in ambient body`
      ).toContain(id);
    }
  });

  it("body does NOT advertise A-6 or A-7 as bullet items (those stay /cc-only)", () => {
    // The footer paragraph names the full catalog range "A-1..A-7" so
    // the user knows where to read for more; that range mention is
    // expected. What MUST NOT appear is a per-id bullet item for A-6
    // or A-7 (the compact-content contract is exactly A-1..A-5).
    expect(CCLAW_RULES_MARKDOWN).not.toMatch(/^- \*\*A-6\b/m);
    expect(CCLAW_RULES_MARKDOWN).not.toMatch(/^- \*\*A-7\b/m);
  });

  it("body names the full `/cc`-only catalogs (anti-rationalizations.md + antipatterns.md)", () => {
    expect(CCLAW_RULES_MARKDOWN).toContain(".cclaw/lib/anti-rationalizations.md");
    expect(CCLAW_RULES_MARKDOWN).toContain(".cclaw/lib/antipatterns.md");
  });

  it("body carries the 'How to activate' footer with `/cc <task description>` invocation", () => {
    expect(CCLAW_RULES_MARKDOWN).toMatch(/How to activate the full flow/i);
    expect(CCLAW_RULES_MARKDOWN).toMatch(/`\/cc <task description>`/);
  });

  it("body size stays within the compact contract (~80-160 lines)", () => {
    const lines = CCLAW_RULES_MARKDOWN.split("\n").length;
    expect(lines).toBeGreaterThan(20);
    expect(lines).toBeLessThanOrEqual(160);
  });
});

describe("v8.55 — MDC variant: Cursor frontmatter contract", () => {
  it("MDC variant starts with a `---` fence", () => {
    expect(CCLAW_RULES_MDC.startsWith("---\n")).toBe(true);
  });

  it("MDC frontmatter carries `description:` and `alwaysApply: true`", () => {
    const fenceEnd = CCLAW_RULES_MDC.indexOf("\n---", 4);
    expect(fenceEnd).toBeGreaterThan(0);
    const frontmatter = CCLAW_RULES_MDC.slice(4, fenceEnd);
    expect(frontmatter).toMatch(/^description:\s*.+/m);
    expect(frontmatter).toMatch(/^alwaysApply:\s*true\s*$/m);
  });

  it("MDC body (post-frontmatter) is the plain-markdown variant verbatim", () => {
    const fenceCloseIndex = CCLAW_RULES_MDC.indexOf("\n---\n");
    const bodyStart = fenceCloseIndex + "\n---\n".length;
    const body = CCLAW_RULES_MDC.slice(bodyStart).trimStart();
    expect(body).toBe(CCLAW_RULES_MARKDOWN.trimStart());
  });

  it("MDC variant does NOT inline `globs:` (rules are repo-wide, not per-glob)", () => {
    const fenceEnd = CCLAW_RULES_MDC.indexOf("\n---", 4);
    const frontmatter = CCLAW_RULES_MDC.slice(4, fenceEnd);
    expect(frontmatter).not.toMatch(/^globs:/m);
  });
});

describe("v8.55 — antipattern + anti-rat cross-reference (no drift)", () => {
  it("ANTIPATTERN_SUMMARIES carries exactly the IDs A-1..A-5", () => {
    expect(listAntipatternIds()).toEqual(["A-1", "A-2", "A-3", "A-4", "A-5"]);
  });

  it("each ANTIPATTERN_SUMMARIES title agrees with the verbatim heading in ANTIPATTERNS", () => {
    const headings = extractAntipatternHeadings();
    const headingMap = new Map(headings.map((h) => [h.id, h.title]));
    for (const ap of ANTIPATTERN_SUMMARIES) {
      expect(
        headingMap.get(ap.id),
        `summary for ${ap.id} ('${ap.title}') must match ANTIPATTERNS heading`
      ).toBe(ap.title);
    }
  });

  it("rendered body includes each antipattern title verbatim", () => {
    for (const ap of ANTIPATTERN_SUMMARIES) {
      expect(CCLAW_RULES_MARKDOWN).toContain(ap.title);
    }
  });
});

describe("v8.55 — per-harness install writes ambient rules to harness-namespaced paths", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("HARNESS_LAYOUT_TABLE carries a `rules` field for every supported harness", () => {
    for (const harness of HARNESS_IDS) {
      const layout = HARNESS_LAYOUT_TABLE[harness];
      expect(layout.rules.path).toMatch(/^\.[a-z]+\//);
      expect(["mdc", "markdown"]).toContain(layout.rules.format);
      expect(typeof layout.rules.autoLoad).toBe("boolean");
      expect(layout.rules.activationHint.length).toBeGreaterThan(0);
    }
  });

  it("Cursor layout uses MDC format with auto-load at `.cursor/rules/cclaw.mdc`", () => {
    const layout = HARNESS_LAYOUT_TABLE.cursor;
    expect(layout.rules.path).toBe(".cursor/rules/cclaw.mdc");
    expect(layout.rules.format).toBe("mdc");
    expect(layout.rules.autoLoad).toBe(true);
  });

  it("Claude Code / Codex / OpenCode layouts use plain markdown at `.harness/cclaw-rules.md` with manual @-ref activation", () => {
    for (const harness of ["claude", "codex", "opencode"] as const) {
      const layout = HARNESS_LAYOUT_TABLE[harness];
      expect(layout.rules.path).toMatch(/^\.[a-z]+\/cclaw-rules\.md$/);
      expect(layout.rules.format).toBe("markdown");
      expect(layout.rules.autoLoad).toBe(false);
    }
  });

  it("install writes `.cursor/rules/cclaw.mdc` with MDC frontmatter when Cursor is enabled", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const body = await fs.readFile(
      path.join(project, ".cursor", "rules", "cclaw.mdc"),
      "utf8"
    );
    expect(body).toBe(CCLAW_RULES_MDC);
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toMatch(/^alwaysApply:\s*true\s*$/m);
  });

  it("install writes `.claude/cclaw-rules.md` as plain markdown when Claude is enabled", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    await initCclaw({ cwd: project });
    const body = await fs.readFile(
      path.join(project, ".claude", "cclaw-rules.md"),
      "utf8"
    );
    expect(body).toBe(CCLAW_RULES_MARKDOWN);
    expect(body.startsWith("---\n")).toBe(false);
  });

  it("install writes `.codex/cclaw-rules.md` and `.opencode/cclaw-rules.md` as plain markdown", async () => {
    project = await createTempProject({
      harnessMarkers: [".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    for (const harness of ["codex", "opencode"] as const) {
      const body = await fs.readFile(
        path.join(project, `.${harness}`, "cclaw-rules.md"),
        "utf8"
      );
      expect(body).toBe(CCLAW_RULES_MARKDOWN);
    }
  });

  it("multi-harness install writes the rules file at every harness's namespaced path", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    await fs.access(path.join(project, ".cursor", "rules", "cclaw.mdc"));
    for (const harness of ["claude", "codex", "opencode"] as const) {
      await fs.access(path.join(project, `.${harness}`, "cclaw-rules.md"));
    }
  });

  it("install is idempotent — re-running overwrites the same file (no append)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const first = await fs.readFile(
      path.join(project, ".cursor", "rules", "cclaw.mdc"),
      "utf8"
    );
    await initCclaw({ cwd: project });
    const second = await fs.readFile(
      path.join(project, ".cursor", "rules", "cclaw.mdc"),
      "utf8"
    );
    expect(second).toBe(first);
    expect(second.length).toBe(first.length);
  });

  it("install does NOT create project-root AGENTS.md / CLAUDE.md / GEMINI.md", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    for (const forbidden of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
      await expect(
        fs.access(path.join(project, forbidden))
      ).rejects.toBeTruthy();
    }
  });

  it("install emits one progress event per harness rules file", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude"]
    });
    const events: { step: string; detail?: string }[] = [];
    await initCclaw({
      cwd: project,
      onProgress: (event) => events.push(event)
    });
    const rulesEvents = events.filter(
      (event) => event.step === "Wrote harness rules"
    );
    expect(rulesEvents.length).toBe(2);
    const details = rulesEvents.map((event) => event.detail ?? "");
    expect(details.some((d) => d.includes(".cursor/rules/cclaw.mdc"))).toBe(true);
    expect(details.some((d) => d.includes("auto-load"))).toBe(true);
    expect(details.some((d) => d.includes(".claude/cclaw-rules.md"))).toBe(true);
    expect(details.some((d) => d.includes("manual @-ref"))).toBe(true);
  });
});

describe("v8.55 — uninstall removes per-harness rules files cleanly", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("uninstall removes `.cursor/rules/cclaw.mdc`", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    await expect(
      fs.access(path.join(project, ".cursor", "rules", "cclaw.mdc"))
    ).rejects.toBeTruthy();
  });

  it("uninstall removes empty `.cursor/rules/` parent dir if cclaw was the sole inhabitant", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    await expect(
      fs.access(path.join(project, ".cursor", "rules"))
    ).rejects.toBeTruthy();
  });

  it("uninstall preserves a user-authored `.cursor/rules/other.mdc` (does NOT touch sibling rules)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const siblingPath = path.join(project, ".cursor", "rules", "user.mdc");
    await fs.writeFile(siblingPath, "user owned rule\n", "utf8");
    await uninstallCclaw({ cwd: project });
    await expect(
      fs.access(path.join(project, ".cursor", "rules", "cclaw.mdc"))
    ).rejects.toBeTruthy();
    const body = await fs.readFile(siblingPath, "utf8");
    expect(body).toBe("user owned rule\n");
  });

  it("uninstall removes `.harness/cclaw-rules.md` for every enabled harness", async () => {
    project = await createTempProject({
      harnessMarkers: [".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    for (const harness of ["claude", "codex", "opencode"] as const) {
      await expect(
        fs.access(path.join(project, `.${harness}`, "cclaw-rules.md"))
      ).rejects.toBeTruthy();
    }
  });
});

describe("v8.55 — install summary includes per-harness activation guidance", () => {
  it("renders an empty string when no harnesses are installed (defensive)", () => {
    expect(renderHarnessRulesGuidance([])).toBe("");
  });

  it("renders one activation hint per installed harness", () => {
    const out = renderHarnessRulesGuidance([
      "cursor",
      "claude",
      "codex",
      "opencode"
    ] as HarnessId[]);
    expect(out).toMatch(/Cursor/);
    expect(out).toMatch(/Claude Code/);
    expect(out).toMatch(/Codex/);
    expect(out).toMatch(/OpenCode/);
  });

  it("Cursor hint names auto-load + the .mdc path; the other three hints name the @-reference target file", () => {
    const out = renderHarnessRulesGuidance([
      "cursor",
      "claude",
      "codex",
      "opencode"
    ] as HarnessId[]);
    expect(out).toMatch(/auto-load.*\.cursor\/rules\/cclaw\.mdc/i);
    expect(out).toMatch(/@\.claude\/cclaw-rules\.md/);
    expect(out).toMatch(/@\.codex\/cclaw-rules\.md/);
    expect(out).toMatch(/@\.opencode\/cclaw-rules\.md/);
  });

  it("guidance never instructs the user to edit project-root AGENTS.md / CLAUDE.md outside their own file (cclaw never writes them)", () => {
    const out = renderHarnessRulesGuidance(HARNESS_IDS as readonly HarnessId[]);
    expect(out).toMatch(/cclaw never writes CLAUDE\.md/);
    expect(out).toMatch(/cclaw never writes AGENTS\.md/);
  });
});
