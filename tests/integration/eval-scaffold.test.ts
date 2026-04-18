import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { createTempProject, projectPathExists, readProjectFile } from "../helpers/index.js";

describe("cclaw init: eval scaffold", () => {
  it("materializes .cclaw/evals/ tree with config and READMEs", async () => {
    const root = await createTempProject("eval-scaffold-init");
    await initCclaw({ projectRoot: root });

    expect(await projectPathExists(root, ".cclaw/evals/config.yaml")).toBe(true);
    expect(await projectPathExists(root, ".cclaw/evals/corpus/README.md")).toBe(true);
    expect(await projectPathExists(root, ".cclaw/evals/rubrics/README.md")).toBe(true);
    expect(await projectPathExists(root, ".cclaw/evals/baselines/README.md")).toBe(true);
    expect(await projectPathExists(root, ".cclaw/evals/reports/README.md")).toBe(true);
  });

  it("seeds config.yaml with z.ai coding paas endpoint + glm-5.1 defaults", async () => {
    const root = await createTempProject("eval-scaffold-config");
    await initCclaw({ projectRoot: root });
    const config = await readProjectFile(root, ".cclaw/evals/config.yaml");
    expect(config).toContain("baseUrl: https://api.z.ai/api/coding/paas/v4");
    expect(config).toContain("model: glm-5.1");
    expect(config).toContain("defaultMode: fixture");
  });

  it("seeds a starter rubric for every FLOW_STAGE on init", async () => {
    const root = await createTempProject("eval-scaffold-rubrics");
    await initCclaw({ projectRoot: root });
    for (const stage of [
      "brainstorm",
      "scope",
      "design",
      "spec",
      "plan",
      "tdd",
      "review",
      "ship"
    ]) {
      expect(await projectPathExists(root, `.cclaw/evals/rubrics/${stage}.yaml`)).toBe(true);
      const body = await readProjectFile(root, `.cclaw/evals/rubrics/${stage}.yaml`);
      expect(body).toContain(`stage: ${stage}`);
      expect(body).toMatch(/- id: [a-z][a-z0-9-]*/);
    }
  });

  it("sync preserves a user-edited rubric", async () => {
    const root = await createTempProject("eval-scaffold-rubrics-preserve");
    await initCclaw({ projectRoot: root });
    const file = path.join(root, ".cclaw/evals/rubrics/plan.yaml");
    const customized = `stage: plan\nchecks:\n  - id: my-only-check\n    prompt: custom\n`;
    await fs.writeFile(file, customized, "utf8");
    await syncCclaw(root);
    const after = await fs.readFile(file, "utf8");
    expect(after).toBe(customized);
  });

  it("sync does not overwrite user-edited config.yaml", async () => {
    const root = await createTempProject("eval-scaffold-preserve");
    await initCclaw({ projectRoot: root });
    const configPath = path.join(root, ".cclaw/evals/config.yaml");
    const customized = `provider: openai\nbaseUrl: https://example.test/v1\nmodel: gpt-5\ndefaultTier: B\ntimeoutMs: 60000\nmaxRetries: 1\nregression:\n  failIfDeltaBelow: -0.1\n  failIfCriticalBelow: 2.5\n`;
    await fs.writeFile(configPath, customized, "utf8");
    await syncCclaw(root);
    const after = await fs.readFile(configPath, "utf8");
    expect(after).toBe(customized);
  });

  it("sync does not overwrite a user-authored corpus case", async () => {
    const root = await createTempProject("eval-scaffold-corpus-preserve");
    await initCclaw({ projectRoot: root });
    const casePath = path.join(root, ".cclaw/evals/corpus/brainstorm/demo.yaml");
    await fs.mkdir(path.dirname(casePath), { recursive: true });
    const original = `id: demo\nstage: brainstorm\ninput_prompt: preserve me\n`;
    await fs.writeFile(casePath, original, "utf8");
    await syncCclaw(root);
    const after = await fs.readFile(casePath, "utf8");
    expect(after).toBe(original);
  });

  it("gitignore carries eval re-include patterns so users can commit corpus", async () => {
    const root = await createTempProject("eval-scaffold-gitignore");
    await initCclaw({ projectRoot: root });
    const gi = await readProjectFile(root, ".gitignore");
    expect(gi).toContain("!.cclaw/evals/");
    expect(gi).toContain("!.cclaw/evals/corpus/**");
    expect(gi).toContain("!.cclaw/evals/rubrics/**");
    expect(gi).toContain("!.cclaw/evals/baselines/**");
    expect(gi).toContain("!.cclaw/evals/config.yaml");
    // reports/ is NOT re-included; still covered by the parent .cclaw/ ignore.
    expect(gi).not.toContain("!.cclaw/evals/reports/");
  });
});
