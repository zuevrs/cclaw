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

describe("v8.87 — model-tier defaults wiring", () => {
  it("WIRING — MODEL_TIERS exports exactly [fast,balanced,powerful], ModelTier literal triple round-trips, DEFAULT_MODEL_PREFERENCES is frozen (Object.freeze), every default value is a tier-union member, and the default-map keys equal SPECIALISTS + learnings-research + repo-research (no silent drift)", () => {
    expect(MODEL_TIERS).toEqual(["fast", "balanced", "powerful"]);
    const fast: ModelTier = "fast";
    const balanced: ModelTier = "balanced";
    const powerful: ModelTier = "powerful";
    expect([fast, balanced, powerful]).toEqual([...MODEL_TIERS]);

    expect(Object.isFrozen(DEFAULT_MODEL_PREFERENCES)).toBe(true);
    expect(() => {
      (DEFAULT_MODEL_PREFERENCES as Record<string, ModelTier>).critic = "fast";
    }).toThrow();

    for (const [key, tier] of Object.entries(DEFAULT_MODEL_PREFERENCES)) {
      expect((MODEL_TIERS as readonly string[]).includes(tier), `${key}=${tier} not in MODEL_TIERS`).toBe(true);
    }
    const expected = [...SPECIALISTS, "learnings-research", "repo-research"].sort();
    expect(Object.keys(DEFAULT_MODEL_PREFERENCES).sort()).toEqual(expected);
  });
});

describe("v8.87 — model-tier defaults behavior (canonical mapping + resolveModelPreferences merge + legacy slice-builder alias)", () => {
  it("BEHAVIOR — canonical per-specialist defaults: builder/learnings-research/repo-research=fast, critic=powerful, rest=balanced; resolveModelPreferences returns defaults for null/undefined config + merges overrides field-by-field + silently drops invalid tier values; modelTierFor honors the legacy slice-builder alias mapping onto builder", () => {
    // canonical default tiers per specialist
    expect(DEFAULT_MODEL_PREFERENCES.builder).toBe("fast");
    expect(DEFAULT_MODEL_PREFERENCES["learnings-research"]).toBe("fast");
    expect(DEFAULT_MODEL_PREFERENCES["repo-research"]).toBe("fast");
    expect(DEFAULT_MODEL_PREFERENCES.critic).toBe("powerful");
    expect(DEFAULT_MODEL_PREFERENCES.architect).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES.reviewer).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES["plan-critic"]).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES["plan-design"]).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES["plan-devex"]).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES.triage).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES["qa-runner"]).toBe("balanced");
    expect(DEFAULT_MODEL_PREFERENCES.investigator).toBe("balanced");

    // resolveModelPreferences — null / undefined / config-without-modelPreferences returns the defaults
    expect(resolveModelPreferences(null)).toEqual({ ...DEFAULT_MODEL_PREFERENCES });
    expect(resolveModelPreferences(undefined)).toEqual({ ...DEFAULT_MODEL_PREFERENCES });
    expect(resolveModelPreferences({
      version: "8.92.0",
      flowVersion: "8",
      harnesses: ["cursor"]
    })).toEqual({ ...DEFAULT_MODEL_PREFERENCES });

    const merged = resolveModelPreferences(
      makeConfig({ builder: "powerful", critic: "balanced", reviewer: "fast" })
    );
    expect(merged.builder).toBe("powerful");
    expect(merged.critic).toBe("balanced");
    expect(merged.reviewer).toBe("fast");
    expect(merged.architect).toBe("balanced");
    expect(merged["repo-research"]).toBe("fast");
    for (const key of Object.keys(DEFAULT_MODEL_PREFERENCES) as ModelPreferenceKey[]) {
      expect(merged[key], `${key} missing`).toBeDefined();
    }

    // invalid values silently drop
    expect(
      resolveModelPreferences(makeConfig({ critic: "ultra" as unknown as ModelTier })).critic
    ).toBe("powerful");
    expect(
      resolveModelPreferences(makeConfig({ critic: 42 as unknown as ModelTier })).critic
    ).toBe("powerful");

    // legacy slice-builder alias
    expect(modelTierFor("slice-builder", makeConfig({ "slice-builder": "powerful" }))).toBe("powerful");
    expect(modelTierFor("slice-builder", makeConfig({ builder: "balanced", "slice-builder": "powerful" }))).toBe(
      "balanced"
    );
    expect(modelTierFor("builder", makeConfig({ builder: "balanced", "slice-builder": "powerful" }))).toBe(
      "balanced"
    );
    expect(modelTierFor("slice-builder", null)).toBe("fast");
  });
});

describe("v8.87 — model-tier section contract (dispatch-envelope runbook stamps Model tier: + per-tier table)", () => {
  it("SECTION CONTRACT — dispatch-envelope runbook stamps the canonical `Model tier: <fast | balanced | powerful>` line + v8.87 wiring marker, ships the `## Model-tier hint (v8.87)` table covering builder/critic/research helpers", () => {
    const body = dispatchEnvelopeBody();
    expect(body).toMatch(/─ Model tier: <fast \| balanced \| powerful>/);
    expect(body).toMatch(/Model tier:[^\n]*v8\.87/);
    expect(body).toMatch(/## Model-tier hint \(v8\.87\)/);
    expect(body).toMatch(/\| `builder`/);
    expect(body).toMatch(/\| `critic` \| `powerful` \|/);
    expect(body).toMatch(/\| `learnings-research` \/ `repo-research` \| `fast` \|/);
  });
});
