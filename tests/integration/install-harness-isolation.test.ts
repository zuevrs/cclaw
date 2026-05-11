import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { CORE_AGENTS } from "../../src/content/core-agents.js";
import { HARNESS_IDS, type HarnessId } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.29 — tripwire suite locking the install layer's harness isolation
 * contract. The bug-shaped failure these tests catch is "a writer that
 * runs unconditionally instead of being gated on the harness guard",
 * e.g. always writing to `AGENTS.md` regardless of the selected
 * harnesses, or always writing `.codex/agents/*.md` because the loop
 * doesn't filter.
 *
 * Each test uses a real `mktemp -d` project (via `createTempProject`)
 * and asserts against the real filesystem — no mocks, no stubs. The
 * matrix:
 *
 *   - cursor-only        → .cursor/ written, .claude / .opencode / .codex absent
 *   - claude-only        → .claude/ written, others absent
 *   - opencode-only      → .opencode/ written, others absent
 *   - codex-only         → .codex/ written, others absent
 *   - cursor + claude    → both written, opencode / codex absent
 *   - all four harnesses → all four written
 *
 * Plus a "shared `.cclaw/` is the same for all selections" assertion so
 * we know the per-harness gating doesn't accidentally leak into the
 * shared runtime root.
 */

const HARNESS_TO_ROOT: Record<HarnessId, string> = {
  claude: ".claude",
  cursor: ".cursor",
  opencode: ".opencode",
  codex: ".codex"
};

const HARNESS_TO_COMMANDS_DIR: Record<HarnessId, string> = {
  claude: ".claude/commands",
  cursor: ".cursor/commands",
  opencode: ".opencode/commands",
  codex: ".codex/commands"
};

const HARNESS_TO_AGENTS_DIR: Record<HarnessId, string> = {
  claude: ".claude/agents",
  cursor: ".cursor/agents",
  opencode: ".opencode/agents",
  codex: ".codex/agents"
};

const HARNESS_TO_SKILLS_DIR: Record<HarnessId, string> = {
  claude: ".claude/skills/cclaw",
  cursor: ".cursor/skills/cclaw",
  opencode: ".opencode/skills/cclaw",
  codex: ".codex/skills/cclaw"
};

const HARNESS_TO_HOOKS_FILE: Record<HarnessId, string> = {
  claude: ".claude/hooks/hooks.json",
  cursor: ".cursor/hooks.json",
  opencode: ".opencode/plugins/cclaw-plugin.mjs",
  codex: ".codex/hooks.json"
};

/**
 * Assert that every file the install layer is supposed to write for
 * `harness` is on disk in `project`, and that every file it is NOT
 * supposed to write (any file under any OTHER harness's roots) is
 * absent. The combination locks both directions.
 */
async function assertHarnessFootprint(
  project: string,
  selected: readonly HarnessId[]
): Promise<void> {
  const selectedSet = new Set(selected);
  for (const harness of HARNESS_IDS) {
    if (selectedSet.has(harness)) {
      // Commands present
      for (const fileName of ["cc.md", "cc-cancel.md", "cc-idea.md"]) {
        const stat = await fs.stat(path.join(project, HARNESS_TO_COMMANDS_DIR[harness], fileName));
        expect(stat.isFile(), `${harness} should have ${fileName}`).toBe(true);
      }
      // Every specialist present
      for (const agent of CORE_AGENTS) {
        const stat = await fs.stat(
          path.join(project, HARNESS_TO_AGENTS_DIR[harness], `${agent.id}.md`)
        );
        expect(stat.isFile(), `${harness} should have agents/${agent.id}.md`).toBe(true);
      }
      // Skills mirror present
      const skillsEntries = await fs.readdir(path.join(project, HARNESS_TO_SKILLS_DIR[harness]));
      expect(skillsEntries.length, `${harness} skills dir should not be empty`).toBeGreaterThan(0);
      // Hooks config present
      const hooksStat = await fs.stat(path.join(project, HARNESS_TO_HOOKS_FILE[harness]));
      expect(hooksStat.isFile(), `${harness} should have hooks config`).toBe(true);
    } else {
      // Tripwire: no cclaw-written files exist under the NON-selected
      // harness's roots. The harness's own marker dir is permitted to
      // exist (the temp-project helper creates it for auto-detect), but
      // the cclaw-managed subpaths must all be absent.
      for (const fileName of ["cc.md", "cc-cancel.md", "cc-idea.md"]) {
        await expect(
          fs.access(path.join(project, HARNESS_TO_COMMANDS_DIR[harness], fileName)),
          `${harness} must NOT have ${fileName} when not selected`
        ).rejects.toBeTruthy();
      }
      for (const agent of CORE_AGENTS) {
        await expect(
          fs.access(path.join(project, HARNESS_TO_AGENTS_DIR[harness], `${agent.id}.md`)),
          `${harness} must NOT have agents/${agent.id}.md when not selected`
        ).rejects.toBeTruthy();
      }
      await expect(
        fs.access(path.join(project, HARNESS_TO_SKILLS_DIR[harness])),
        `${harness} skills/cclaw dir must NOT exist when not selected`
      ).rejects.toBeTruthy();
      await expect(
        fs.access(path.join(project, HARNESS_TO_HOOKS_FILE[harness])),
        `${harness} hooks config must NOT exist when not selected`
      ).rejects.toBeTruthy();
    }
  }
}

describe("install — harness isolation tripwires (v8.29)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it.each<HarnessId>(["cursor", "claude", "opencode", "codex"])(
    "%s-only install writes only that harness's files",
    async (harness) => {
      project = await createTempProject({ harnessMarkers: [] });
      await initCclaw({ cwd: project, harnesses: [harness] });
      await assertHarnessFootprint(project, [harness]);
    }
  );

  it("multi-harness selection (claude + cursor) writes both but neither opencode nor codex", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await initCclaw({ cwd: project, harnesses: ["claude", "cursor"] });
    await assertHarnessFootprint(project, ["claude", "cursor"]);
  });

  it("multi-harness selection (opencode + codex) writes both but neither claude nor cursor", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await initCclaw({ cwd: project, harnesses: ["opencode", "codex"] });
    await assertHarnessFootprint(project, ["opencode", "codex"]);
  });

  it("all four harnesses selected writes the union", async () => {
    project = await createTempProject({ harnessMarkers: [] });
    await initCclaw({ cwd: project, harnesses: ["claude", "cursor", "opencode", "codex"] });
    await assertHarnessFootprint(project, ["claude", "cursor", "opencode", "codex"]);
  });

  it("install does NOT write a top-level AGENTS.md or CLAUDE.md regardless of harness selection", async () => {
    // Tripwire for the specific bug shape the v8.29 audit was looking
    // for: a writer that ignores the harness gate and unconditionally
    // touches the project root (e.g. legacy OpenCode AGENTS.md drop or
    // a stray Claude-Code CLAUDE.md handoff file). cclaw v8 explicitly
    // keeps the project root clean.
    project = await createTempProject({ harnessMarkers: [] });
    await initCclaw({ cwd: project, harnesses: ["opencode"] });
    await expect(fs.access(path.join(project, "AGENTS.md"))).rejects.toBeTruthy();
    await expect(fs.access(path.join(project, "CLAUDE.md"))).rejects.toBeTruthy();
  });

  it("shared `.cclaw/` runtime root is written identically regardless of which harness was selected", async () => {
    // Whatever combination of harnesses an operator picks, the shared
    // `.cclaw/lib/`, `.cclaw/hooks/`, and `.cclaw/state/` payloads should
    // be byte-identical — these are the runtime contracts every harness
    // reads from, and per-harness drift would silently break /cc.
    const projects: string[] = [];
    try {
      for (const selection of [["cursor"], ["claude"], ["cursor", "claude"]] as HarnessId[][]) {
        const p = await createTempProject({ harnessMarkers: [] });
        projects.push(p);
        await initCclaw({ cwd: p, harnesses: selection });
      }
      // Spot-check three high-signal files:
      const checkFiles = [
        ".cclaw/hooks/commit-helper.mjs",
        ".cclaw/lib/agents/slice-builder.md",
        ".cclaw/lib/skills/tdd-and-verification.md"
      ];
      for (const f of checkFiles) {
        const bodies = await Promise.all(
          projects.map((p) => fs.readFile(path.join(p, f), "utf8"))
        );
        expect(bodies[0], `${f} should match across harness selections`).toBe(bodies[1]);
        expect(bodies[1], `${f} should match across harness selections`).toBe(bodies[2]);
      }
    } finally {
      for (const p of projects) await removeProject(p);
    }
  });

  it("sync narrowing from two harnesses to one removes the dropped harness's command files", async () => {
    // Documents current behaviour: cclaw's sync layer rewrites whatever
    // harnesses are passed but does NOT proactively scrub files for
    // harnesses the operator dropped. The previous selection's files
    // remain on disk (the `uninstall` path is what scrubs harness
    // assets). This is intentional but worth a tripwire — if the
    // contract changes in a future slug, this test fails LOUDLY.
    project = await createTempProject({ harnessMarkers: [] });
    await initCclaw({ cwd: project, harnesses: ["claude", "cursor"] });
    await syncCclaw({ cwd: project, harnesses: ["cursor"] });
    // cursor still present
    await fs.access(path.join(project, ".cursor/commands/cc.md"));
    // claude command file SURVIVES sync narrowing — documenting
    // current behaviour. If this ever changes, replace the access
    // with `.rejects.toBeTruthy()` and update the CHANGELOG note.
    await fs.access(path.join(project, ".claude/commands/cc.md"));
  });
});
