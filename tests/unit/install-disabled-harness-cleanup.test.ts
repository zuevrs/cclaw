import { describe, expect, it } from "vitest";
import {
  createTempProject,
  projectPathExists,
  writeProjectFile
} from "../helpers/index.js";
import { initCclaw, syncCclaw } from "../../src/install.js";

describe("sync disabled harness cleanup", () => {
  it("removes codex/opencode managed agent folders when harnesses are disabled", async () => {
    const root = await createTempProject("sync-disabled-harness-agents");
    await initCclaw({ projectRoot: root, harnesses: ["codex", "opencode"] });

    expect(await projectPathExists(root, ".codex/agents")).toBe(true);
    expect(await projectPathExists(root, ".opencode/agents")).toBe(true);

    await syncCclaw(root, { harnesses: ["claude"] });

    expect(await projectPathExists(root, ".codex/agents")).toBe(false);
    expect(await projectPathExists(root, ".opencode/agents")).toBe(false);
  });

  it("fails sync when disabled harness hook JSON is unparseable", async () => {
    const root = await createTempProject("sync-disabled-harness-bad-hook");
    await initCclaw({ projectRoot: root, harnesses: ["claude", "codex"] });
    await writeProjectFile(root, ".codex/hooks.json", "{ this is not json");

    await expect(syncCclaw(root, { harnesses: ["claude"] })).rejects.toThrow(
      "Cannot strip managed hook entries"
    );
  });
});
