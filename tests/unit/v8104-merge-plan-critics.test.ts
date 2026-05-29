import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_PLAN_CRITIC_RUBRIC_MODE,
  LEGACY_SPECIALIST_IDS,
  PLAN_CRITIC_RUBRIC_MODES,
  SPECIALISTS
} from "../../src/types.js";
import {
  PLAN_CRITIC_PROMPT,
  SPECIALIST_PROMPTS
} from "../../src/content/specialist-prompts/index.js";
import {
  CORE_AGENTS,
  SPECIALIST_AGENTS
} from "../../src/content/core-agents.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);

/**
 * v8.104 — Merge `plan-critic` + `plan-design` + `plan-devex` (10 → 8
 * specialists). The three pre-build specialists shared the same scaffold
 * (§1 pre-commitment / §2 N-dim rubric / §3 AI-slop / §4 findings ledger
 * / §5 verdict) and collapse into ONE `plan-critic` specialist with a
 * `rubricMode: "generic" | "design" | "devex"` envelope fan-out.
 *
 * Five guarantees:
 *
 *   1. SPECIALISTS count drops 10 → 8.
 *   2. plan-design.ts and plan-devex.ts no longer exist on disk; the
 *      finding-id namespaces (PD-N / DX-N) remain.
 *   3. plan-critic.ts exports the rubricMode envelope vocabulary
 *      ("generic" / "design" / "devex") and renders distinct findings
 *      formats per mode.
 *   4. CORE_AGENTS' plan-critic description names the three rubric modes.
 *   5. The orchestrator (start-command.ts) gates each mode independently:
 *      generic (strict + AC≥2), design (triage.designSurface), devex
 *      (triage.devexSurface). Sequential dispatches (generic → design →
 *      devex) up to three times per slug.
 */

describe("v8.104 — SPECIALISTS roster collapses 10 → 8 (plan-design + plan-devex absorbed into plan-critic)", () => {
  it("SPECIALISTS has length 8 and contains plan-critic but NOT plan-design / plan-devex", () => {
    expect(SPECIALISTS).toHaveLength(8);
    expect(SPECIALISTS).toContain("plan-critic");
    expect(SPECIALISTS as readonly string[]).not.toContain("plan-design");
    expect(SPECIALISTS as readonly string[]).not.toContain("plan-devex");
  });

  it("SPECIALIST_AGENTS shape matches SPECIALISTS one-for-one (no orphan ids)", () => {
    expect(SPECIALIST_AGENTS.map((a) => a.id).sort()).toEqual(
      [...SPECIALISTS].sort()
    );
  });

  it("LEGACY_SPECIALIST_IDS includes plan-design + plan-devex so pre-v8.104 state files validate on read", () => {
    expect(LEGACY_SPECIALIST_IDS as readonly string[]).toContain("plan-design");
    expect(LEGACY_SPECIALIST_IDS as readonly string[]).toContain("plan-devex");
  });

  it("plan-design.ts and plan-devex.ts have been deleted from src/content/specialist-prompts/", () => {
    expect(
      existsSync(
        path.join(REPO_ROOT, "src/content/specialist-prompts/plan-design.ts")
      )
    ).toBe(false);
    expect(
      existsSync(
        path.join(REPO_ROOT, "src/content/specialist-prompts/plan-devex.ts")
      )
    ).toBe(false);
  });
});

describe("v8.104 — plan-critic envelope: rubricMode = generic | design | devex", () => {
  it("PLAN_CRITIC_RUBRIC_MODES enumerates the three canonical modes; DEFAULT is `generic`", () => {
    expect(PLAN_CRITIC_RUBRIC_MODES).toEqual(["generic", "design", "devex"]);
    expect(DEFAULT_PLAN_CRITIC_RUBRIC_MODE).toBe("generic");
  });

  it("plan-critic prompt body declares the rubricMode envelope contract + the three-mode dispatch table", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/`rubricMode`/);
    // The mode-routing table in §Modes names all three vocab values with
    // backticked rendering and a per-mode gate.
    expect(PLAN_CRITIC_PROMPT).toMatch(/`generic`/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/`design`/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/`devex`/);
    // Default-on-absent contract is stated verbatim so legacy v8.103
    // envelopes default to `generic`.
    expect(PLAN_CRITIC_PROMPT).toMatch(/Default\s*=\s*`generic` on absent/iu);
  });

  it("plan-critic prompt embeds the three mode-specific rubric scaffolds (5 generic dimensions / 7 design / 6 devex)", () => {
    // generic: structural plan-shape audit
    expect(PLAN_CRITIC_PROMPT).toMatch(/§2\.a Goal coverage/u);
    expect(PLAN_CRITIC_PROMPT).toMatch(/§2\.b Granularity/u);
    expect(PLAN_CRITIC_PROMPT).toMatch(/§2\.c Dependency accuracy/u);
    // design (former v8.75 plan-design): seven design dimensions
    expect(PLAN_CRITIC_PROMPT).toMatch(/§2 — `rubricMode: design`/u);
    expect(PLAN_CRITIC_PROMPT).toMatch(/visual hierarchy/iu);
    expect(PLAN_CRITIC_PROMPT).toMatch(/accessibility/iu);
    // devex (former v8.82 plan-devex): six DevEx dimensions
    expect(PLAN_CRITIC_PROMPT).toMatch(/§2 — `rubricMode: devex`/u);
    expect(PLAN_CRITIC_PROMPT).toMatch(/getting.started/iu);
    expect(PLAN_CRITIC_PROMPT).toMatch(/upgrade.path/iu);
  });

  it("plan-critic emits distinct findings-id namespaces per mode (G-N for generic / PD-N for design / DX-N for devex)", () => {
    // generic findings carry G-N + AC-id-cited rows
    expect(PLAN_CRITIC_PROMPT).toMatch(/\bG-N\b/);
    // design rubric mode appends PD-N rows to plan.md's "## Plan-design findings"
    expect(PLAN_CRITIC_PROMPT).toMatch(/\bPD-N\b/);
    expect(PLAN_CRITIC_PROMPT).toContain("## Plan-design findings");
    // devex rubric mode appends DX-N rows to plan.md's "## Plan-devex findings"
    expect(PLAN_CRITIC_PROMPT).toMatch(/\bDX-N\b/);
    expect(PLAN_CRITIC_PROMPT).toContain("## Plan-devex findings");
  });

  it("plan-critic verdict block carries mode-specific verdict vocabularies (generic: pass/revise/cancel; design + devex: pass/revise/block)", () => {
    // Each §5 section header pairs the rubricMode with its allowed
    // verdict vocab so a reader on `rubricMode: generic` immediately
    // sees the cancel branch and design / devex sees the block branch.
    expect(PLAN_CRITIC_PROMPT).toMatch(
      /`rubricMode: generic`\s*\(verdict:\s*`pass`\s*\|\s*`revise`\s*\|\s*`cancel`\)/u
    );
    expect(PLAN_CRITIC_PROMPT).toMatch(
      /`rubricMode: design`\s*\(verdict:\s*`pass`\s*\|\s*`revise`\s*\|\s*`block`\)/u
    );
    expect(PLAN_CRITIC_PROMPT).toMatch(
      /`rubricMode: devex`\s*\(verdict:\s*`pass`\s*\|\s*`revise`\s*\|\s*`block`\)/u
    );
  });
});

describe("v8.104 — CORE_AGENTS describes plan-critic with three rubric modes", () => {
  it("plan-critic agent description names the three rubric-mode dispatch surfaces", () => {
    const agent = CORE_AGENTS.find((a) => a.id === "plan-critic");
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("specialist");
    expect(agent!.activation).toBe("on-demand");
    const desc = agent!.description;
    expect(desc).toMatch(/rubricMode/);
    expect(desc).toContain('"generic"');
    expect(desc).toContain('"design"');
    expect(desc).toContain('"devex"');
    // Each mode's distinct surface is acknowledged.
    expect(desc).toMatch(/PD-N/);
    expect(desc).toMatch(/DX-N/);
  });

  it("plan-design / plan-devex are NOT registered as CORE_AGENTS", () => {
    expect(CORE_AGENTS.find((a) => a.id === ("plan-design" as never))).toBeUndefined();
    expect(CORE_AGENTS.find((a) => a.id === ("plan-devex" as never))).toBeUndefined();
  });

  it("SPECIALIST_PROMPTS roster keys collapse to the eight-specialist set (no PLAN_DESIGN_PROMPT / PLAN_DEVEX_PROMPT)", () => {
    expect(Object.keys(SPECIALIST_PROMPTS).sort()).toEqual(
      [...SPECIALISTS].sort()
    );
    expect(SPECIALIST_PROMPTS as Record<string, string>).not.toHaveProperty(
      "plan-design"
    );
    expect(SPECIALIST_PROMPTS as Record<string, string>).not.toHaveProperty(
      "plan-devex"
    );
  });
});

describe("orchestrator dispatches plan-critic ONCE per slug (single dispatch, active rubrics set — no sequential 3× fan-out)", () => {
  it("start-command's stage→specialist table carries a single plan-critic row keyed on the `rubrics` envelope set", () => {
    // The collapsed dispatch carries the active rubric subset inline as a
    // `rubrics: [...]` envelope — not one row per rubricMode.
    expect(START_COMMAND_BODY).toMatch(/rubrics: \[/u);
    // All three rubric scaffolds are still named (none were dropped).
    expect(START_COMMAND_BODY).toMatch(/\bgeneric\b/u);
    expect(START_COMMAND_BODY).toMatch(/\bdesign\b/u);
    expect(START_COMMAND_BODY).toMatch(/\bdevex\b/u);
    // The retired per-dispatch fan-out literal is gone.
    expect(START_COMMAND_BODY).not.toMatch(/rubricMode: "(generic|design|devex)"/u);
  });

  it("orchestrator's plan-critic block (#### plan-critic) describes a single dispatch returning ONE merged verdict (no sequential 3× fan-out)", () => {
    const idx = START_COMMAND_BODY.indexOf("#### plan-critic");
    expect(idx).toBeGreaterThan(0);
    const block = START_COMMAND_BODY.slice(idx, idx + 8000);
    // One dispatch covering the active rubric set.
    expect(block).toMatch(/single dispatch|one dispatch|ONCE/iu);
    expect(block).toMatch(/merged verdict|worst-of/iu);
    // The three rubrics are still individually described inside the block.
    expect(block).toMatch(/`generic`/u);
    expect(block).toMatch(/`design`/u);
    expect(block).toMatch(/`devex`/u);
    // The retired sequential fan-out language is gone.
    expect(block).not.toMatch(/up to three times/iu);
  });

  it("orchestrator's design + devex rubric gates fire on the surface flags (triage.designSurface / triage.devexSurface) in soft + strict ceremony", () => {
    // designSurface gate
    expect(START_COMMAND_BODY).toContain("triage.designSurface");
    expect(START_COMMAND_BODY).toMatch(
      /triage\.designSurface.{0,200}ceremonyMode\s*∈\s*\{soft, strict\}/u
    );
    // devexSurface gate
    expect(START_COMMAND_BODY).toContain("triage.devexSurface");
    expect(START_COMMAND_BODY).toMatch(
      /triage\.devexSurface.{0,200}ceremonyMode\s*∈\s*\{soft, strict\}/u
    );
  });

  it("orchestrator stamps ONE plan-critic flow-state triple (per-rubric verdict fields collapsed away)", () => {
    // The single dispatch carries one verdict triple regardless of how
    // many rubrics ran.
    expect(START_COMMAND_BODY).toContain("planCriticVerdict");
    expect(START_COMMAND_BODY).toContain("planCriticIteration");
    expect(START_COMMAND_BODY).toContain("planCriticDispatchedAt");
    // The retired per-rubric verdict fields are no longer stamped.
    expect(START_COMMAND_BODY).not.toContain("planDesignVerdict");
    expect(START_COMMAND_BODY).not.toContain("planDevexVerdict");
  });
});
