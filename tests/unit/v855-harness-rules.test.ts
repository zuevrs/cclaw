import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ANTIPATTERN_SUMMARIES,
  ANTI_RAT_CATEGORY_SUMMARIES,
  CCLAW_RULES_MARKDOWN,
  CCLAW_RULES_MDC,
  listAntipatternIds
} from "../../src/content/cclaw-rules.js";
import { IRON_LAWS } from "../../src/content/iron-laws.js";
import { SHARED_ANTI_RATIONALIZATIONS } from "../../src/content/anti-rationalizations.js";
import {
  HARNESS_LAYOUT_TABLE,
  initCclaw,
  renderHarnessRulesGuidance,
  uninstallCclaw
} from "../../src/install.js";
import { HARNESS_IDS, type HarnessId } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.55 — harness-embedded rules surface. Slimmed in v8.99 test-slim-down
 * A2 to one WIRING + one BEHAVIOR + one SECTION CONTRACT test.
 */

describe("v8.55 — harness rules wiring (content module + MDC frontmatter + HARNESS_LAYOUT_TABLE)", () => {
  it("WIRING — CCLAW_RULES_MARKDOWN + CCLAW_RULES_MDC export non-empty body (MDC strictly larger), MDC frontmatter declares alwaysApply:true + description without globs, MDC body post-frontmatter equals MARKDOWN trimmed, HARNESS_LAYOUT_TABLE has rules field per harness with Cursor=mdc+autoLoad / others=markdown+manual, ANTIPATTERN_SUMMARIES covers A-1..A-5, ANTI_RAT_CATEGORY_SUMMARIES matches SHARED_ANTI_RATIONALIZATIONS keys", () => {
    expect(CCLAW_RULES_MARKDOWN.length).toBeGreaterThan(0);
    expect(CCLAW_RULES_MDC.length).toBeGreaterThan(CCLAW_RULES_MARKDOWN.length);
    expect(CCLAW_RULES_MDC.startsWith("---\n")).toBe(true);
    const fenceEnd = CCLAW_RULES_MDC.indexOf("\n---", 4);
    expect(fenceEnd).toBeGreaterThan(0);
    const frontmatter = CCLAW_RULES_MDC.slice(4, fenceEnd);
    expect(frontmatter).toMatch(/^description:\s*.+/m);
    expect(frontmatter).toMatch(/^alwaysApply:\s*true\s*$/m);
    expect(frontmatter).not.toMatch(/^globs:/m);
    const bodyStart = CCLAW_RULES_MDC.indexOf("\n---\n") + "\n---\n".length;
    expect(CCLAW_RULES_MDC.slice(bodyStart).trimStart()).toBe(CCLAW_RULES_MARKDOWN.trimStart());

    for (const harness of HARNESS_IDS) {
      const layout = HARNESS_LAYOUT_TABLE[harness];
      expect(layout.rules.path).toMatch(/^\.[a-z]+\//);
      expect(["mdc", "markdown"]).toContain(layout.rules.format);
      expect(layout.rules.activationHint.length).toBeGreaterThan(0);
    }
    expect(HARNESS_LAYOUT_TABLE.cursor.rules.path).toBe(".cursor/rules/cclaw.mdc");
    expect(HARNESS_LAYOUT_TABLE.cursor.rules.format).toBe("mdc");
    expect(HARNESS_LAYOUT_TABLE.cursor.rules.autoLoad).toBe(true);
    for (const harness of ["claude", "codex", "opencode"] as const) {
      expect(HARNESS_LAYOUT_TABLE[harness].rules.path).toMatch(/^\.[a-z]+\/cclaw-rules\.md$/);
      expect(HARNESS_LAYOUT_TABLE[harness].rules.format).toBe("markdown");
      expect(HARNESS_LAYOUT_TABLE[harness].rules.autoLoad).toBe(false);
    }

    expect(listAntipatternIds()).toEqual(["A-1", "A-2", "A-3", "A-4", "A-5"]);
    for (const ap of ANTIPATTERN_SUMMARIES) {
      expect(CCLAW_RULES_MARKDOWN).toContain(ap.title);
    }
    expect(ANTI_RAT_CATEGORY_SUMMARIES.map((s) => s.key).sort()).toEqual(
      Object.keys(SHARED_ANTI_RATIONALIZATIONS).sort()
    );
  });
});

describe("v8.55 — harness rules install behavior (per-harness write + idempotent + negative-space + uninstall)", () => {
  let project: string | undefined;
  afterEach(async () => {
    if (project) {
      await removeProject(project);
      project = undefined;
    }
  });

  it("BEHAVIOR — initCclaw writes the MDC variant to .cursor/rules/cclaw.mdc and the plain markdown variant to .claude/.codex/.opencode/cclaw-rules.md, is idempotent (re-run is a stable overwrite, not append), NEVER touches project-root AGENTS.md/CLAUDE.md/GEMINI.md, emits one progress event per harness rules file, and uninstallCclaw removes every harness's rules file + tidies empty .cursor/rules parent but preserves sibling user files", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude", ".codex", ".opencode"]
    });
    const events: { step: string; detail?: string }[] = [];
    await initCclaw({ cwd: project, onProgress: (event) => events.push(event) });

    const mdc = await fs.readFile(path.join(project, ".cursor", "rules", "cclaw.mdc"), "utf8");
    expect(mdc).toBe(CCLAW_RULES_MDC);
    expect(mdc).toMatch(/^alwaysApply:\s*true\s*$/m);
    for (const harness of ["claude", "codex", "opencode"] as const) {
      const body = await fs.readFile(path.join(project, `.${harness}`, "cclaw-rules.md"), "utf8");
      expect(body).toBe(CCLAW_RULES_MARKDOWN);
    }

    // idempotent
    await initCclaw({ cwd: project });
    const mdc2 = await fs.readFile(path.join(project, ".cursor", "rules", "cclaw.mdc"), "utf8");
    expect(mdc2).toBe(mdc);
    expect(mdc2.length).toBe(mdc.length);

    // negative space — never write project-root agent files
    for (const forbidden of ["AGENTS.md", "CLAUDE.md", "GEMINI.md"]) {
      await expect(fs.access(path.join(project!, forbidden))).rejects.toBeTruthy();
    }

    // one progress event per harness rules file (4 harnesses)
    const rulesEvents = events.filter((e) => e.step === "Wrote harness rules");
    expect(rulesEvents.length).toBe(4);
    const details = rulesEvents.map((e) => e.detail ?? "");
    expect(details.some((d) => d.includes(".cursor/rules/cclaw.mdc"))).toBe(true);
    expect(details.some((d) => d.includes("auto-load"))).toBe(true);
    expect(details.some((d) => d.includes("manual @-ref"))).toBe(true);

    // uninstall preserves user-authored siblings then removes cclaw entries
    const siblingPath = path.join(project, ".cursor", "rules", "user.mdc");
    await fs.writeFile(siblingPath, "user owned rule\n", "utf8");
    await uninstallCclaw({ cwd: project });
    await expect(
      fs.access(path.join(project, ".cursor", "rules", "cclaw.mdc"))
    ).rejects.toBeTruthy();
    expect(await fs.readFile(siblingPath, "utf8")).toBe("user owned rule\n");
    for (const harness of ["claude", "codex", "opencode"] as const) {
      await expect(
        fs.access(path.join(project!, `.${harness}`, "cclaw-rules.md"))
      ).rejects.toBeTruthy();
    }
  });
});

describe("v8.55 — harness rules section contract (ambient body discipline + cross-ref + per-harness activation hints)", () => {
  it("SECTION CONTRACT — CCLAW_RULES_MARKDOWN ambient body opens with `# cclaw ambient rules`, names /cc activation, lists every Iron Law title + every anti-rat category + A-1..A-5 antipattern ids + the full catalog file paths, body size in 20-160 lines compact contract; renderHarnessRulesGuidance produces one hint per harness with auto-load mention for Cursor + @-ref for others and never instructs users to edit project-root files", () => {
    expect(CCLAW_RULES_MARKDOWN).toMatch(/^# cclaw ambient rules$/m);
    expect(CCLAW_RULES_MARKDOWN).toMatch(/`\/cc`/);
    expect(CCLAW_RULES_MARKDOWN).toMatch(/full multi-stage workflow/i);
    expect(CCLAW_RULES_MARKDOWN).toMatch(/^## Iron Laws \(Karpathy\)$/m);
    for (const law of IRON_LAWS) {
      expect(CCLAW_RULES_MARKDOWN).toContain(law.title);
    }
    for (const category of Object.keys(SHARED_ANTI_RATIONALIZATIONS)) {
      expect(CCLAW_RULES_MARKDOWN).toContain(`\`${category}\``);
    }
    expect(CCLAW_RULES_MARKDOWN).toMatch(/^## Top antipatterns/m);
    for (const id of ["A-1", "A-2", "A-3", "A-4", "A-5"]) {
      expect(CCLAW_RULES_MARKDOWN).toContain(id);
    }
    expect(CCLAW_RULES_MARKDOWN).not.toMatch(/^- \*\*A-6\b/m);
    expect(CCLAW_RULES_MARKDOWN).not.toMatch(/^- \*\*A-7\b/m);
    expect(CCLAW_RULES_MARKDOWN).toContain(".cclaw/lib/anti-rationalizations.md");
    expect(CCLAW_RULES_MARKDOWN).toContain(".cclaw/lib/antipatterns.md");
    expect(CCLAW_RULES_MARKDOWN).toMatch(/`\/cc <task description>`/);
    const lines = CCLAW_RULES_MARKDOWN.split("\n").length;
    expect(lines).toBeGreaterThan(20);
    expect(lines).toBeLessThanOrEqual(160);

    expect(renderHarnessRulesGuidance([])).toBe("");
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
    expect(out).toMatch(/auto-load.*\.cursor\/rules\/cclaw\.mdc/i);
    expect(out).toMatch(/@\.claude\/cclaw-rules\.md/);
    expect(out).toMatch(/@\.codex\/cclaw-rules\.md/);
    expect(out).toMatch(/@\.opencode\/cclaw-rules\.md/);
    const allGuidance = renderHarnessRulesGuidance(HARNESS_IDS as readonly HarnessId[]);
    expect(allGuidance).toMatch(/cclaw never writes CLAUDE\.md/);
    expect(allGuidance).toMatch(/cclaw never writes AGENTS\.md/);
  });
});
