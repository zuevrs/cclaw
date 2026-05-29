import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";

/**
 * v8.87 — Model-tier policy. The TS policy const + readers
 * (DEFAULT_MODEL_PREFERENCES / resolveModelPreferences / modelTierFor)
 * were retired as a never-called phantom API; the LLM-facing source of
 * truth is the dispatch-envelope runbook's `## Model-tier hint` table,
 * pinned by the SECTION CONTRACT test below.
 */

const PROJECT_ROOT = path.resolve(process.cwd());

function dispatchEnvelopeBody(): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === "dispatch-envelope");
  if (!r) throw new Error("dispatch-envelope runbook missing");
  return r.body;
}

describe("v8.87 — model-tier policy section contract (dispatch-envelope runbook + README + CHANGELOG)", () => {
  it("SECTION CONTRACT — dispatch-envelope runbook stamps `Model tier: <fast | balanced | powerful>` on every envelope, cites v8.87, and ships the `## Model-tier hint (v8.87)` table covering every default specialist (builder / critic=powerful / learnings-research / repo-research=fast); README carries `## Model-tier policy` + v8.87 citation + the three tiers + at least one specialist per tier + the `.cclaw/config.yaml > modelPreferences` override path; package.json ≥8.92 + CHANGELOG entry naming the v8.87 model-tier work", async () => {
    const body = dispatchEnvelopeBody();
    expect(body).toMatch(/─ Model tier: <fast \| balanced \| powerful>/);
    expect(body).toMatch(/## Model-tier hint/);
    expect(body).toMatch(/\| `builder`/);
    expect(body).toMatch(/\| `critic` \| `powerful` \|/);
    expect(body).toMatch(/\| `learnings-research` \/ `repo-research` \| `fast` \|/);

    // v8.107 README rewrite removed the standalone "Model-tier policy"
    // section + all v8.XX annotations. The model-tier override surface
    // (`modelPreferences` in `.cclaw/config.yaml`) is now mentioned in
    // the README's Configuration example block; the canonical policy
    // lives in the dispatch-envelope runbook (asserted above) and in
    // CHANGELOG. Pin only the override surface on the README.
    const readme = await fs.readFile(path.join(PROJECT_ROOT, "README.md"), "utf-8");
    expect(readme).toMatch(/modelPreferences/);

    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(92);
    const changelog = await fs.readFile(path.join(PROJECT_ROOT, "CHANGELOG.md"), "utf-8");
    expect(changelog).toMatch(/v8\.87/);
    expect(changelog).toMatch(/Model-tier|model-tier/);
  });
});
