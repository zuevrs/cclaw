import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { createTempProject } from "../helpers/index.js";

async function readJson(filePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(filePath, "utf8")) as Record<string, unknown>;
}

describe("sync fail-fast integration", () => {
  it("fails when merged claude hook document becomes schema-invalid", async () => {
    const root = await createTempProject("sync-failfast-hook-schema");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    const hooksPath = path.join(root, ".claude/hooks/hooks.json");
    const doc = await readJson(hooksPath);
    const hooks = (doc.hooks ?? {}) as Record<string, unknown>;
    const firstEvent = Object.keys(hooks)[0]!;
    const existing = Array.isArray(hooks[firstEvent]) ? hooks[firstEvent] : [];
    hooks[firstEvent] = [
      ...existing,
      { matcher: "Write", hooks: [{ type: "noop" }] }
    ];
    await fs.writeFile(hooksPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

    await expect(syncCclaw(root)).rejects.toThrow("Hook document drift detected for claude");
  });

  it("fails when flow-state.json is corrupt", async () => {
    const root = await createTempProject("sync-failfast-flow-state");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await fs.writeFile(path.join(root, ".cclaw/state/flow-state.json"), "{ not-json", "utf8");

    await expect(syncCclaw(root)).rejects.toThrow("Corrupt flow-state.json");
  });

  it("fails when managed-resources manifest is corrupt JSON", async () => {
    const root = await createTempProject("sync-failfast-managed-manifest");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });
    await fs.writeFile(path.join(root, ".cclaw/state/managed-resources.json"), "{ broken-json", "utf8");

    await expect(syncCclaw(root)).rejects.toThrow("Managed resource manifest is corrupt JSON");
  });

  it("fails when disabling codex with unparseable codex hooks JSON", async () => {
    const root = await createTempProject("sync-failfast-disable-codex");
    await initCclaw({ projectRoot: root, harnesses: ["claude", "codex"] });
    await fs.writeFile(path.join(root, ".codex/hooks.json"), "{ unparseable", "utf8");

    await expect(syncCclaw(root, { harnesses: ["claude"] })).rejects.toThrow(
      "Cannot strip managed hook entries"
    );
  });

  it("preserves foreign RTK hook entries while syncing managed claude hooks", async () => {
    const root = await createTempProject("sync-rtk-coexistence");
    await initCclaw({ projectRoot: root, harnesses: ["claude"] });

    const hooksPath = path.join(root, ".claude/hooks/hooks.json");
    const doc = await readJson(hooksPath);
    const hooks = (doc.hooks ?? {}) as Record<string, unknown>;
    const firstEvent = Object.keys(hooks)[0]!;
    const existing = Array.isArray(hooks[firstEvent]) ? hooks[firstEvent] : [];
    hooks[firstEvent] = [
      ...existing,
      {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: "bash .rtk/hooks/rtk-rewrite.sh",
            timeout: 10
          }
        ]
      }
    ];
    await fs.writeFile(hooksPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

    await syncCclaw(root, { harnesses: ["claude"] });

    const updated = await readJson(hooksPath);
    const updatedHooks = (updated.hooks ?? {}) as Record<string, unknown>;
    const updatedEntries = Array.isArray(updatedHooks[firstEvent]) ? updatedHooks[firstEvent] as Array<Record<string, unknown>> : [];
    const hasRtkEntry = updatedEntries.some((entry) =>
      Array.isArray(entry.hooks) &&
      entry.hooks.some((hook) => {
        if (!hook || typeof hook !== "object" || Array.isArray(hook)) return false;
        const command = (hook as { command?: unknown }).command;
        return typeof command === "string" && command.includes("rtk-rewrite.sh");
      })
    );

    expect(hasRtkEntry).toBe(true);
  });
});
