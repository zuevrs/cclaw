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
 * v8.87 — Model-tier policy defaults.
 *
 * The v8.13-era ModelPreferences scaffold (per-specialist tier hints in
 * `.cclaw/config.yaml`) shipped without a default mapping — every field
 * was optional and absent meant "harness default". v8.87 ships a default
 * policy keyed on the v8.62 live specialist roster + the two read-only
 * research helpers. Reference: obra's `subagent-driven-development`
 * model-selection block (fast/balanced/powerful split).
 *
 * Tripwires below pin:
 *
 *   1. The exact default tier per live specialist + research helper.
 *   2. The default map's coverage equals `SPECIALISTS` plus the two
 *      research helpers (no silent additions / removals).
 *   3. The `Model tier:` line is part of the on-demand dispatch-envelope
 *      runbook template so every dispatch announcement carries the hint.
 *   4. `resolveModelPreferences()` merges user overrides on top of the
 *      defaults field-by-field and rejects out-of-union typos.
 *   5. The tier union is exactly `"fast" | "balanced" | "powerful"`.
 *   6. README documents the policy under `## Model-tier policy`.
 *   7. package.json + CHANGELOG carry the v8.87 / 8.92.x bump.
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

describe("v8.87 — tier union is exactly fast / balanced / powerful", () => {
  it("AC-1 — MODEL_TIERS lists exactly the three canonical literals", () => {
    expect(MODEL_TIERS).toEqual(["fast", "balanced", "powerful"]);
    expect(MODEL_TIERS).toHaveLength(3);
  });

  it("AC-1 — every default tier value is a member of the canonical union", () => {
    for (const [key, tier] of Object.entries(DEFAULT_MODEL_PREFERENCES)) {
      expect(
        (MODEL_TIERS as readonly string[]).includes(tier),
        `${key} default ${tier} not in MODEL_TIERS`
      ).toBe(true);
    }
  });

  it("AC-1 — type-level: ModelTier literal triple matches the runtime const", () => {
    const fast: ModelTier = "fast";
    const balanced: ModelTier = "balanced";
    const powerful: ModelTier = "powerful";
    expect([fast, balanced, powerful]).toEqual([...MODEL_TIERS]);
  });
});

describe("v8.87 — DEFAULT_MODEL_PREFERENCES covers v8.62 live specialists + research helpers", () => {
  it("AC-2 — default map has exactly the expected key set (no silent drift)", () => {
    const expected = [
      ...SPECIALISTS,
      "learnings-research",
      "repo-research"
    ].sort();
    const actual = Object.keys(DEFAULT_MODEL_PREFERENCES).sort();
    expect(actual).toEqual(expected);
  });

  it("AC-2 — every live SPECIALISTS id has a default tier", () => {
    for (const id of SPECIALISTS) {
      expect(
        (DEFAULT_MODEL_PREFERENCES as Record<string, ModelTier | undefined>)[id],
        `${id} missing default tier`
      ).toBeDefined();
    }
  });

  it("AC-2 — research helpers (learnings-research / repo-research) have defaults", () => {
    expect(DEFAULT_MODEL_PREFERENCES["learnings-research"]).toBeDefined();
    expect(DEFAULT_MODEL_PREFERENCES["repo-research"]).toBeDefined();
  });
});

describe("v8.87 — default tier per specialist (the canonical mapping)", () => {
  // The exact tier assignments from the v8.87 spec. One assertion per
  // specialist so a future change that flips one tier lights up alone.

  it("AC-3 — `builder` defaults to fast (formerly slice-builder, pre-v8.62)", () => {
    expect(DEFAULT_MODEL_PREFERENCES.builder).toBe("fast");
  });

  it("AC-3 — `learnings-research` defaults to fast", () => {
    expect(DEFAULT_MODEL_PREFERENCES["learnings-research"]).toBe("fast");
  });

  it("AC-3 — `repo-research` defaults to fast", () => {
    expect(DEFAULT_MODEL_PREFERENCES["repo-research"]).toBe("fast");
  });

  it("AC-3 — `critic` defaults to powerful", () => {
    expect(DEFAULT_MODEL_PREFERENCES.critic).toBe("powerful");
  });

  it("AC-3 — `architect` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES.architect).toBe("balanced");
  });

  it("AC-3 — `reviewer` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES.reviewer).toBe("balanced");
  });

  it("AC-3 — `plan-critic` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES["plan-critic"]).toBe("balanced");
  });

  it("AC-3 — `plan-design` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES["plan-design"]).toBe("balanced");
  });

  it("AC-3 — `plan-devex` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES["plan-devex"]).toBe("balanced");
  });

  it("AC-3 — `triage` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES.triage).toBe("balanced");
  });

  it("AC-3 — `qa-runner` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES["qa-runner"]).toBe("balanced");
  });

  it("AC-3 — `investigator` defaults to balanced", () => {
    expect(DEFAULT_MODEL_PREFERENCES.investigator).toBe("balanced");
  });
});

describe("v8.87 — DEFAULT_MODEL_PREFERENCES is frozen (no in-place mutation)", () => {
  it("AC-4 — direct mutation throws in strict mode (Object.freeze)", () => {
    expect(Object.isFrozen(DEFAULT_MODEL_PREFERENCES)).toBe(true);
    expect(() => {
      (DEFAULT_MODEL_PREFERENCES as Record<string, ModelTier>).critic = "fast";
    }).toThrow();
  });
});

describe("v8.87 — resolveModelPreferences merges user overrides onto defaults", () => {
  it("AC-5 — null / undefined config returns the defaults verbatim", () => {
    expect(resolveModelPreferences(null)).toEqual({ ...DEFAULT_MODEL_PREFERENCES });
    expect(resolveModelPreferences(undefined)).toEqual({
      ...DEFAULT_MODEL_PREFERENCES
    });
  });

  it("AC-5 — config without modelPreferences returns the defaults verbatim", () => {
    const config: CclawConfig = {
      version: "8.92.0",
      flowVersion: "8",
      harnesses: ["cursor"]
    };
    expect(resolveModelPreferences(config)).toEqual({
      ...DEFAULT_MODEL_PREFERENCES
    });
  });

  it("AC-5 — user override flips one tier and the rest stay at defaults", () => {
    const merged = resolveModelPreferences(makeConfig({ critic: "balanced" }));
    expect(merged.critic).toBe("balanced");
    expect(merged.builder).toBe("fast");
    expect(merged.architect).toBe("balanced");
    expect(merged.reviewer).toBe("balanced");
    expect(merged["learnings-research"]).toBe("fast");
  });

  it("AC-5 — user override flips multiple tiers in one merge", () => {
    const merged = resolveModelPreferences(
      makeConfig({
        builder: "powerful",
        critic: "balanced",
        reviewer: "fast"
      })
    );
    expect(merged.builder).toBe("powerful");
    expect(merged.critic).toBe("balanced");
    expect(merged.reviewer).toBe("fast");
    // Unflipped tiers stay at default.
    expect(merged.architect).toBe("balanced");
    expect(merged["repo-research"]).toBe("fast");
  });

  it("AC-5 — out-of-union tier value is silently dropped (default survives)", () => {
    const merged = resolveModelPreferences(
      makeConfig({ critic: "ultra" as unknown as ModelTier })
    );
    expect(merged.critic).toBe("powerful");
  });

  it("AC-5 — non-string tier value is silently dropped (default survives)", () => {
    const merged = resolveModelPreferences(
      makeConfig({ critic: 42 as unknown as ModelTier })
    );
    expect(merged.critic).toBe("powerful");
  });

  it("AC-5 — merge result covers every default key (Required map)", () => {
    const merged = resolveModelPreferences(makeConfig({ builder: "powerful" }));
    for (const key of Object.keys(DEFAULT_MODEL_PREFERENCES) as ModelPreferenceKey[]) {
      expect(merged[key], `${key} missing in merged map`).toBeDefined();
    }
  });
});

describe("v8.87 — legacy `slice-builder` key collapses onto `builder`", () => {
  it("AC-6 — `slice-builder: powerful` (no explicit builder) reads as builder=powerful", () => {
    const config = makeConfig({ "slice-builder": "powerful" });
    expect(modelTierFor("slice-builder", config)).toBe("powerful");
  });

  it("AC-6 — explicit `builder` wins over legacy `slice-builder`", () => {
    const config = makeConfig({
      builder: "balanced",
      "slice-builder": "powerful"
    });
    expect(modelTierFor("slice-builder", config)).toBe("balanced");
    expect(modelTierFor("builder", config)).toBe("balanced");
  });

  it("AC-6 — neither set: legacy alias resolves to the v8.87 default (fast)", () => {
    expect(modelTierFor("slice-builder", null)).toBe("fast");
  });
});

describe("v8.87 — dispatch-envelope runbook stamps `Model tier:` on every envelope", () => {
  it("AC-7 — envelope template carries the canonical `Model tier:` line", () => {
    const body = dispatchEnvelopeBody();
    expect(body).toMatch(
      /─ Model tier: <fast \| balanced \| powerful>/
    );
  });

  it("AC-7 — envelope cites the v8.87 wiring on the same line", () => {
    const body = dispatchEnvelopeBody();
    expect(body).toMatch(/Model tier:[^\n]*v8\.87/);
  });

  it("AC-7 — runbook ships the `## Model-tier hint` table covering every default specialist", () => {
    const body = dispatchEnvelopeBody();
    expect(body).toMatch(/## Model-tier hint \(v8\.87\)/);
    expect(body).toMatch(/\| `builder`/);
    expect(body).toMatch(/\| `critic` \| `powerful` \|/);
    expect(body).toMatch(/\| `learnings-research` \/ `repo-research` \| `fast` \|/);
  });
});

describe("v8.87 — README documents the policy under `## Model-tier policy`", () => {
  let readme: string;

  it("AC-8 — README carries a `## Model-tier policy` heading", async () => {
    readme = await fs.readFile(path.join(PROJECT_ROOT, "README.md"), "utf-8");
    expect(readme).toMatch(/^##\s+Model-tier policy/m);
  });

  it("AC-8 — README cites the v8.87 work explicitly", () => {
    expect(readme).toMatch(/v8\.87/);
  });

  it("AC-8 — README names the three tiers and at least one specialist per tier", () => {
    expect(readme).toMatch(/`fast`/);
    expect(readme).toMatch(/`balanced`/);
    expect(readme).toMatch(/`powerful`/);
    expect(readme).toMatch(/`builder`/);
    expect(readme).toMatch(/`critic`/);
  });

  it("AC-8 — README documents the `.cclaw/config.yaml > modelPreferences` override path", () => {
    expect(readme).toMatch(/modelPreferences/);
  });
});

describe("v8.87 — version bump + CHANGELOG entry", () => {
  it("AC-9 — package.json bumps to at least 8.92.0", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(92);
  });

  it("AC-9 — CHANGELOG.md carries an entry naming the v8.87 model-tier work", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.87/);
    expect(changelog).toMatch(/Model-tier|model-tier/);
  });
});
