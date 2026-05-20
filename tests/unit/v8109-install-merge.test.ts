import { afterEach, describe, expect, it } from "vitest";
import { syncCclaw } from "../../src/install.js";
import { readConfig } from "../../src/config.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.109 — multi-harness install MERGES instead of REPLACES.
 *
 * Pre-v8.109, `install --harness=cursor` after a prior
 * `install --harness=claude` overwrote the config harness list,
 * dropping `claude`. The fix in `resolveHarnesses` unions the two
 * sources (existing config + requested options), deduped, with the
 * existing config taking precedence in ordering.
 */
describe("v8.109 — multi-harness install merges the harness list", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("install --harness=cursor after install --harness=claude preserves both harnesses", async () => {
    project = await createTempProject({ harnessMarkers: [".claude", ".cursor"] });
    await syncCclaw({ cwd: project, harnesses: ["claude"], interactive: false });
    const afterFirst = await readConfig(project);
    expect(afterFirst?.harnesses).toEqual(["claude"]);

    await syncCclaw({ cwd: project, harnesses: ["cursor"], interactive: false });
    const afterSecond = await readConfig(project);
    expect(afterSecond?.harnesses).toEqual(["claude", "cursor"]);
  });

  it("re-installing with the same harness is a no-op for the config list (idempotent dedup)", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    await syncCclaw({ cwd: project, harnesses: ["claude"], interactive: false });
    await syncCclaw({ cwd: project, harnesses: ["claude"], interactive: false });
    const config = await readConfig(project);
    expect(config?.harnesses).toEqual(["claude"]);
  });

  it("install with multiple --harness flags after existing config dedupes the union", async () => {
    project = await createTempProject({ harnessMarkers: [".claude", ".cursor", ".codex"] });
    await syncCclaw({ cwd: project, harnesses: ["claude", "cursor"], interactive: false });
    await syncCclaw({ cwd: project, harnesses: ["cursor", "codex"], interactive: false });
    const config = await readConfig(project);
    expect(config?.harnesses).toEqual(["claude", "cursor", "codex"]);
  });

  it("install with no --harness flag and existing config leaves the harness list unchanged (fromConfig wins)", async () => {
    project = await createTempProject({ harnessMarkers: [".claude"] });
    await syncCclaw({ cwd: project, harnesses: ["claude"], interactive: false });
    await syncCclaw({ cwd: project, interactive: false });
    const config = await readConfig(project);
    expect(config?.harnesses).toEqual(["claude"]);
  });
});
