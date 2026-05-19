import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  RETIRED_COMMAND_FILES,
  syncCclaw
} from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.60 — command retirement wiring.
 *
 * Slimmed in v8.100: kept only the two `syncCclaw` integration tests
 * that exercise the retire-and-sweep wiring. The prompt/content-grep
 * tripwires (constants enumerations, README surface, version-annotation
 * scrub) were removed — they don't catch real regressions.
 */
describe("v8.60 — command retirement", () => {
  it("install writes only cc.md and cc-cancel.md (retired commands swept)", async () => {
    const project = await createTempProject();
    try {
      const staleDir = path.join(project, ".cursor", "commands");
      await fs.mkdir(staleDir, { recursive: true });
      for (const file of RETIRED_COMMAND_FILES) {
        await fs.writeFile(path.join(staleDir, file), "# stale\n", "utf8");
      }

      await syncCclaw({ cwd: project, harnesses: ["cursor"] });

      const dir = path.join(project, ".cursor", "commands");
      const installed = (await fs.readdir(dir)).sort();
      expect(installed).toEqual(["cc-cancel.md", "cc.md"]);
      for (const retired of RETIRED_COMMAND_FILES) {
        await expect(fs.access(path.join(dir, retired))).rejects.toBeTruthy();
      }

      await expect(fs.access(path.join(project, ".cclaw", "lib", "templates", "ideas.md"))).rejects.toBeTruthy();
    } finally {
      await removeProject(project);
    }
  });

  it("SyncResult.counts.commands is 2", async () => {
    const project = await createTempProject();
    try {
      const result = await syncCclaw({ cwd: project, harnesses: ["cursor"] });
      expect(result.counts.commands).toBe(2);
    } finally {
      await removeProject(project);
    }
  });
});
