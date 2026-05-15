import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CCLAW_CRITIC_COMMAND,
  CCLAW_REVIEW_COMMAND
} from "../../src/content/utility-commands.js";
import {
  HARNESS_LAYOUT_TABLE,
  initCclaw,
  uninstallCclaw
} from "../../src/install.js";
import type { HarnessId } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.57 — integration test: end-to-end install + uninstall verifies the
 * utility commands sit alongside the flow commands at the per-harness
 * commands directory.
 *
 * Reuses the install layer (no CLI fork), so the test is fast and
 * mirrors the same code path that `cclaw install` exercises.
 */

const FLOW_COMMANDS = ["cc.md", "cc-cancel.md", "cc-idea.md"] as const;
const UTILITY_COMMANDS = ["cclaw-review.md", "cclaw-critic.md"] as const;
const ALL_COMMANDS = [...FLOW_COMMANDS, ...UTILITY_COMMANDS] as const;

describe("v8.57 integration — full install cycle: flow + utility commands present", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("init writes every flow + utility command to .claude/commands/ for the claude harness", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    const result = await initCclaw({ cwd: project });
    expect(result.installedHarnesses).toEqual(["claude"]);

    for (const file of ALL_COMMANDS) {
      const filePath = path.join(project, ".claude", "commands", file);
      await fs.access(filePath);
    }
  });

  it("the installed cclaw-review body equals the in-memory CCLAW_REVIEW_COMMAND export (byte-for-byte)", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    await initCclaw({ cwd: project });
    const body = await fs.readFile(
      path.join(project, ".claude", "commands", "cclaw-review.md"),
      "utf8"
    );
    expect(body).toBe(CCLAW_REVIEW_COMMAND);
  });

  it("the installed cclaw-critic body equals the in-memory CCLAW_CRITIC_COMMAND export (byte-for-byte)", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    await initCclaw({ cwd: project });
    const body = await fs.readFile(
      path.join(project, ".claude", "commands", "cclaw-critic.md"),
      "utf8"
    );
    expect(body).toBe(CCLAW_CRITIC_COMMAND);
  });

  it("install emits a Wired-harnesses event listing the harness", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    const events: { step: string; detail?: string }[] = [];
    await initCclaw({
      cwd: project,
      onProgress: (event) => events.push(event)
    });
    const wired = events.find((e) => e.step === "Wired harnesses");
    expect(wired).toBeDefined();
    expect(wired?.detail).toContain("claude");
    expect(wired?.detail).toContain("commands");
  });

  it("uninstall removes the utility commands and the (now-empty) commands directory", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    for (const file of ALL_COMMANDS) {
      await expect(
        fs.access(path.join(project, ".claude", "commands", file))
      ).rejects.toBeTruthy();
    }
    // No user-authored siblings remained, so the parent directory is removed too.
    await expect(
      fs.access(path.join(project, ".claude", "commands"))
    ).rejects.toBeTruthy();
  });

  it("a second install on the same project preserves every utility command (idempotent)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const firstSize = (
      await fs.stat(path.join(project, ".cursor", "commands", "cclaw-review.md"))
    ).size;
    await initCclaw({ cwd: project });
    const secondSize = (
      await fs.stat(path.join(project, ".cursor", "commands", "cclaw-review.md"))
    ).size;
    expect(secondSize).toBe(firstSize);
  });

  it("install writes the SAME utility command bodies across every supported harness", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    const bodies = new Map<string, string[]>();
    for (const harness of ["cursor", "claude", "codex", "opencode"] as HarnessId[]) {
      const dir = HARNESS_LAYOUT_TABLE[harness].commandsDir;
      for (const file of UTILITY_COMMANDS) {
        const body = await fs.readFile(path.join(project, dir, file), "utf8");
        const list = bodies.get(file) ?? [];
        list.push(body);
        bodies.set(file, list);
      }
    }
    // Every body for a given utility file must match across harnesses
    // (the install layer writes the same render output everywhere).
    for (const [file, list] of bodies.entries()) {
      const unique = new Set(list);
      expect(
        unique.size,
        `utility command '${file}' must be byte-identical across harnesses`
      ).toBe(1);
    }
  });
});
