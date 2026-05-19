import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  DEFAULT_MODEL_PREFERENCES,
  MODEL_TIERS,
  modelTierFor,
  resolveModelPreferences,
  type CclawConfig,
  type ModelPreferenceKey,
  type ModelPreferences,
  type ModelTier
} from "../../src/config.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { SPECIALISTS } from "../../src/types.js";

/**
 * v8.87 — Model-tier policy defaults. Slimmed in v8.99 test-slim-down A2
 * to one WIRING + one BEHAVIOR + one SECTION CONTRACT test.
 */

const PROJECT_ROOT = path.resolve(process.cwd());

function dispatchEnvelopeBody(): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === "dispatch-envelope");
  if (!r) throw new Error("dispatch-envelope runbook missing");
  return r.body;
}

function makeConfig(overrides: ModelPreferences): CclawConfig {
  return {
    version: "8.92.0",
    flowVersion: "8",
    harnesses: ["cursor"],
    modelPreferences: overrides
  };
}

describe("v8.87 — model-tier policy wiring", () => {
  it("WIRING — MODEL_TIERS = [fast, balanced, powerful]; ModelTier literal triple matches the runtime const; DEFAULT_MODEL_PREFERENCES is Object.freeze'd and carries exactly the SPECIALISTS ∪ {learnings-research, repo-research} key set with each tier in the canonical union — canonical per-specialist mapping (builder=fast, learnings-research=fast, repo-research=fast, critic=powerful, rest=balanced)", () => {
    expect(MODEL_TIERS).toEqual(["fast", "balanced", "powerful"]);
    expect(MODEL_TIERS).toHaveLength(3);
    const fast: ModelTier = "fast";
    const balanced: ModelTier = "balanced";
    const powerful: ModelTier = "powerful";
    expect([fast, balanced, powerful]).toEqual([...MODEL_TIERS]);

    expect(Object.isFrozen(DEFAULT_MODEL_PREFERENCES)).toBe(true);
    expect(() => {
      (DEFAULT_MODEL_PREFERENCES as Record<string, ModelTier>).critic = "fast";
    }).toThrow();

    const expectedKeys = [...SPECIALISTS, "learnings-research", "repo-research"].sort();
    const actualKeys = Object.keys(DEFAULT_MODEL_PREFERENCES).sort();
    expect(actualKeys).toEqual(expectedKeys);
    for (const [key, tier] of Object.entries(DEFAULT_MODEL_PREFERENCES)) {
      expect(
        (MODEL_TIERS as readonly string[]).includes(tier),
        `${key} default ${tier} not in MODEL_TIERS`
      ).toBe(true);
    }

    // Canonical mapping (one assertion bundle per spec table)
    expect(DEFAULT_MODEL_PREFERENCES.builder).toBe("fast");
    expect(DEFAULT_MODEL_PREFERENCES["learnings-research"]).toBe("fast");
    expect(DEFAULT_MODEL_PREFERENCES["repo-research"]).toBe("fast");
    expect(DEFAULT_MODEL_PREFERENCES.critic).toBe("powerful");
    for (const balancedId of [
      "architect",
      "reviewer",
      "plan-critic",
      "plan-design",
      "plan-devex",
      "triage",
      "qa-runner",
      "investigator"
    ] as const) {
      expect(DEFAULT_MODEL_PREFERENCES[balancedId]).toBe("balanced");
    }
  });
});

describe("v8.87 — model-tier policy behavior (resolveModelPreferences + slice-builder alias)", () => {
  it("BEHAVIOR — resolveModelPreferences returns defaults verbatim on null/undefined/no-modelPreferences; merges user override flips per-field; silently drops out-of-union and non-string tier values; merged map covers every default key; legacy `slice-builder` alias collapses onto `builder` (explicit `builder` wins, neither set → fast default)", () => {
    expect(resolveModelPreferences(null)).toEqual({ ...DEFAULT_MODEL_PREFERENCES });
    expect(resolveModelPreferences(undefined)).toEqual({ ...DEFAULT_MODEL_PREFERENCES });
    expect(
      resolveModelPreferences({
        version: "8.92.0",
        flowVersion: "8",
        harnesses: ["cursor"]
      })
    ).toEqual({ ...DEFAULT_MODEL_PREFERENCES });

    const oneFlip = resolveModelPreferences(makeConfig({ critic: "balanced" }));
    expect(oneFlip.critic).toBe("balanced");
    expect(oneFlip.builder).toBe("fast");
    expect(oneFlip.architect).toBe("balanced");
    expect(oneFlip.reviewer).toBe("balanced");
    expect(oneFlip["learnings-research"]).toBe("fast");

    const multi = resolveModelPreferences(
      makeConfig({ builder: "powerful", critic: "balanced", reviewer: "fast" })
    );
    expect(multi.builder).toBe("powerful");
    expect(multi.critic).toBe("balanced");
    expect(multi.reviewer).toBe("fast");
    expect(multi.architect).toBe("balanced");
    expect(multi["repo-research"]).toBe("fast");

    // Out-of-union + non-string dropped → defaults survive
    expect(
      resolveModelPreferences(makeConfig({ critic: "ultra" as unknown as ModelTier })).critic
    ).toBe("powerful");
    expect(
      resolveModelPreferences(makeConfig({ critic: 42 as unknown as ModelTier })).critic
    ).toBe("powerful");

    // Required map coverage
    const merged = resolveModelPreferences(makeConfig({ builder: "powerful" }));
    for (const key of Object.keys(DEFAULT_MODEL_PREFERENCES) as ModelPreferenceKey[]) {
      expect(merged[key]).toBeDefined();
    }

    // Legacy `slice-builder` alias
    expect(modelTierFor("slice-builder", makeConfig({ "slice-builder": "powerful" }))).toBe(
      "powerful"
    );
    const explicitWins = makeConfig({ builder: "balanced", "slice-builder": "powerful" });
    expect(modelTierFor("slice-builder", explicitWins)).toBe("balanced");
    expect(modelTierFor("builder", explicitWins)).toBe("balanced");
    expect(modelTierFor("slice-builder", null)).toBe("fast");
  });
});

describe("v8.87 — model-tier policy section contract (dispatch-envelope runbook + README + CHANGELOG)", () => {
  it("SECTION CONTRACT — dispatch-envelope runbook stamps `Model tier: <fast | balanced | powerful>` on every envelope, cites v8.87, and ships the `## Model-tier hint (v8.87)` table covering every default specialist (builder / critic=powerful / learnings-research / repo-research=fast); README carries `## Model-tier policy` + v8.87 citation + the three tiers + at least one specialist per tier + the `.cclaw/config.yaml > modelPreferences` override path; package.json ≥8.92 + CHANGELOG entry naming the v8.87 model-tier work", async () => {
    const body = dispatchEnvelopeBody();
    expect(body).toMatch(/─ Model tier: <fast \| balanced \| powerful>/);
    expect(body).toMatch(/Model tier:[^\n]*v8\.87/);
    expect(body).toMatch(/## Model-tier hint \(v8\.87\)/);
    expect(body).toMatch(/\| `builder`/);
    expect(body).toMatch(/\| `critic` \| `powerful` \|/);
    expect(body).toMatch(/\| `learnings-research` \/ `repo-research` \| `fast` \|/);

    const readme = await fs.readFile(path.join(PROJECT_ROOT, "README.md"), "utf-8");
    expect(readme).toMatch(/^##\s+Model-tier policy/m);
    expect(readme).toMatch(/v8\.87/);
    expect(readme).toMatch(/`fast`/);
    expect(readme).toMatch(/`balanced`/);
    expect(readme).toMatch(/`powerful`/);
    expect(readme).toMatch(/`builder`/);
    expect(readme).toMatch(/`critic`/);
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
