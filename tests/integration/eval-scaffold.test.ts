import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { createTempProject, projectPathExists, readProjectFile } from "../helpers/index.js";

describe("cclaw init: eval scaffold removal", () => {
  it("does not materialize .cclaw/evals/ on init", async () => {
    const root = await createTempProject("eval-scaffold-removed-init");
    await initCclaw({ projectRoot: root });
    expect(await projectPathExists(root, ".cclaw/evals")).toBe(false);
  });

  it("sync prunes legacy .cclaw/evals/ trees from old installs", async () => {
    const root = await createTempProject("eval-scaffold-removed-sync");
    await initCclaw({ projectRoot: root });
    const legacyEvalFile = path.join(root, ".cclaw/evals/corpus/brainstorm/legacy.yaml");
    await fs.mkdir(path.dirname(legacyEvalFile), { recursive: true });
    await fs.writeFile(legacyEvalFile, "id: legacy\nstage: brainstorm\n", "utf8");

    await syncCclaw(root);
    expect(await projectPathExists(root, ".cclaw/evals")).toBe(false);
  });

  it("gitignore no longer carries eval re-include patterns", async () => {
    const root = await createTempProject("eval-scaffold-removed-gitignore");
    await initCclaw({ projectRoot: root });
    const gi = await readProjectFile(root, ".gitignore");
    expect(gi).not.toContain("!.cclaw/evals/");
    expect(gi).not.toContain("!.cclaw/evals/corpus/**");
    expect(gi).not.toContain("!.cclaw/evals/rubrics/**");
    expect(gi).not.toContain("!.cclaw/evals/baselines/**");
    expect(gi).not.toContain("!.cclaw/evals/config.yaml");
  });
});
