import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

/**
 * v8.80 — Not-doing and key assumptions to validate.
 *
 * Every plan that ships excludes something — and every plan rests on
 * bets. Pre-v8.80 cclaw plans had a `## Not Doing` section, but the
 * bullets named the exclusion without rationale; pre-v8.80 had
 * `## Assumptions (correct me now)` (v8.67), but that section is
 * surface-area inferences (which library / storage / approach) — not
 * bets-that-need-validation (latency budget, user behaviour, market
 * assumption).
 *
 * v8.80 promotes two new first-class sections in both plan.md and
 * research.md:
 *
 * - `## Not Doing (and why)` — 3-5 bullets, each pairing a scope
 *   exclusion with a one-sentence rationale.
 * - `## Key assumptions to validate` — 2-5 bullets, each pairing a bet
 *   with a validation method and a `unvalidated | validated |
 *   invalidated` status.
 *
 * The architect's new Phase 7.5 (Bets and exclusions) populates both
 * sections after Decisions land; the plan-critic's new §6.5 audit
 * gates that both are present and non-empty before build dispatches.
 * Research-mode synthesis populates both sections too.
 *
 * Reference patterns: addyosmani idea-refine lines 113-135 (Not Doing
 * + Key Assumptions to Validate); everyinc-compound ce-brainstorm
 * Phase 3 (Deferred for later / Outside identity / Not Doing).
 */

const planTemplate = ARTIFACT_TEMPLATES.find(t => t.id === "plan");
const researchTemplate = ARTIFACT_TEMPLATES.find(t => t.id === "research");

describe("v8.80 — PLAN_TEMPLATE carries both new first-class sections", () => {
  it("PLAN_TEMPLATE is defined", () => {
    expect(planTemplate).toBeDefined();
    expect(planTemplate?.body).toBeDefined();
  });

  it("PLAN_TEMPLATE contains the exact heading `## Not Doing (and why)`", () => {
    expect(planTemplate?.body).toMatch(/^## Not Doing \(and why\)$/m);
  });

  it("PLAN_TEMPLATE contains the exact heading `## Key assumptions to validate`", () => {
    expect(planTemplate?.body).toMatch(/^## Key assumptions to validate$/m);
  });

  it("PLAN_TEMPLATE's `## Not Doing (and why)` includes the rationale format placeholder", () => {
    const body = planTemplate?.body ?? "";
    const idx = body.indexOf("## Not Doing (and why)");
    expect(idx).toBeGreaterThan(0);
    const block = body.slice(idx, idx + 2000);
    // Bullets pair a scope item with a one-sentence rationale.
    expect(block).toMatch(/scope item/);
    expect(block).toMatch(/reason|rationale|excluding/i);
  });

  it("PLAN_TEMPLATE's `## Key assumptions to validate` includes Validate by + Status placeholders", () => {
    const body = planTemplate?.body ?? "";
    const idx = body.indexOf("## Key assumptions to validate");
    expect(idx).toBeGreaterThan(0);
    const block = body.slice(idx, idx + 2000);
    expect(block).toMatch(/Validate by:/);
    expect(block).toMatch(/Status:/);
    expect(block).toMatch(/unvalidated/);
    expect(block).toMatch(/validated/);
    expect(block).toMatch(/invalidated/);
  });

  it("PLAN_TEMPLATE positions `## Key assumptions to validate` after `## Assumptions (correct me now)` and before `## Decisions`", () => {
    const body = planTemplate?.body ?? "";
    const assumptionsIdx = body.indexOf("## Assumptions (correct me now)");
    const keyAssumptionsIdx = body.indexOf("## Key assumptions to validate");
    const decisionsIdx = body.indexOf("## Decisions");
    expect(assumptionsIdx).toBeGreaterThan(0);
    expect(keyAssumptionsIdx).toBeGreaterThan(assumptionsIdx);
    expect(decisionsIdx).toBeGreaterThan(keyAssumptionsIdx);
  });

  it("PLAN_TEMPLATE positions `## Not Doing (and why)` before `## Plan / Slices`", () => {
    const body = planTemplate?.body ?? "";
    const notDoingIdx = body.indexOf("## Not Doing (and why)");
    const slicesIdx = body.indexOf("## Plan / Slices");
    expect(notDoingIdx).toBeGreaterThan(0);
    expect(slicesIdx).toBeGreaterThan(notDoingIdx);
  });

  it("PLAN_TEMPLATE no longer carries the bare pre-v8.80 `## Not Doing` heading (renamed to `## Not Doing (and why)`)", () => {
    const body = planTemplate?.body ?? "";
    expect(body).not.toMatch(/^## Not Doing$/m);
  });
});

describe("v8.80 — RESEARCH_TEMPLATE carries both new first-class sections", () => {
  it("RESEARCH_TEMPLATE is defined", () => {
    expect(researchTemplate).toBeDefined();
    expect(researchTemplate?.body).toBeDefined();
  });

  it("RESEARCH_TEMPLATE contains the exact heading `## Not Doing (and why)`", () => {
    expect(researchTemplate?.body).toMatch(/^## Not Doing \(and why\)$/m);
  });

  it("RESEARCH_TEMPLATE contains the exact heading `## Key assumptions to validate`", () => {
    expect(researchTemplate?.body).toMatch(/^## Key assumptions to validate$/m);
  });

  it("RESEARCH_TEMPLATE positions `## Key assumptions to validate` near the top — after `## Framings considered`", () => {
    const body = researchTemplate?.body ?? "";
    const framingsIdx = body.indexOf("## Framings considered");
    const keyAssumptionsIdx = body.indexOf("## Key assumptions to validate");
    const engineerIdx = body.indexOf("## Engineer lens");
    expect(framingsIdx).toBeGreaterThan(0);
    expect(keyAssumptionsIdx).toBeGreaterThan(framingsIdx);
    expect(engineerIdx).toBeGreaterThan(keyAssumptionsIdx);
  });

  it("RESEARCH_TEMPLATE positions `## Not Doing (and why)` after Synthesis, before `## Recommended next step`", () => {
    const body = researchTemplate?.body ?? "";
    const synthesisIdx = body.indexOf("## Synthesis");
    const notDoingIdx = body.indexOf("## Not Doing (and why)");
    const recommendedIdx = body.indexOf("## Recommended next step");
    expect(synthesisIdx).toBeGreaterThan(0);
    expect(notDoingIdx).toBeGreaterThan(synthesisIdx);
    expect(recommendedIdx).toBeGreaterThan(notDoingIdx);
  });

  it("RESEARCH_TEMPLATE's `## Key assumptions to validate` includes Validate by + Status placeholders", () => {
    const body = researchTemplate?.body ?? "";
    const idx = body.indexOf("## Key assumptions to validate");
    const block = body.slice(idx, idx + 2000);
    expect(block).toMatch(/Validate by:/);
    expect(block).toMatch(/Status:/);
    expect(block).toMatch(/unvalidated/);
  });
});

describe("v8.80 — Architect Phase 7.5 (Bets and exclusions) is documented in architect prompt", () => {
  it("architect prompt mentions Phase 7.5 explicitly", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Phase 7\.5/);
  });

  it("architect prompt names the phase 'Bets and exclusions'", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Bets and exclusions/i);
  });

  it("architect Phase 7.5 references the `## Not Doing (and why)` section by name", () => {
    expect(ARCHITECT_PROMPT).toMatch(/## Not Doing \(and why\)/);
  });

  it("architect Phase 7.5 references the `## Key assumptions to validate` section by name", () => {
    expect(ARCHITECT_PROMPT).toMatch(/## Key assumptions to validate/);
  });

  it("architect prompt carries the v8.80 contract phrase: 'every plan that ships excludes something'", () => {
    expect(ARCHITECT_PROMPT).toMatch(/every plan that ships excludes something/i);
  });

  it("architect prompt carries the v8.80 contract phrase: 'every plan rests on bets'", () => {
    expect(ARCHITECT_PROMPT).toMatch(/[Ee]very plan rests on bets/);
  });

  it("architect Phase 7.5 cites v8.80 as the introducing version", () => {
    const phaseIdx = ARCHITECT_PROMPT.indexOf("Phase 7.5 — Bets and exclusions");
    expect(phaseIdx).toBeGreaterThan(0);
    const block = ARCHITECT_PROMPT.slice(phaseIdx, phaseIdx + 6000);
    expect(block).toMatch(/v8\.80/);
  });

  it("architect Phase 7.5 distinguishes itself from v8.67's Assumptions (correct me now)", () => {
    const phaseIdx = ARCHITECT_PROMPT.indexOf("Phase 7.5 — Bets and exclusions");
    const block = ARCHITECT_PROMPT.slice(phaseIdx, phaseIdx + 6000);
    expect(block).toMatch(/Assumptions \(correct me now\)/);
    expect(block).toMatch(/v8\.67/);
    expect(block).toMatch(/distinct|surface-area/i);
  });

  it("architect Phase 7.5 references both addyosmani idea-refine and everyinc-compound ce-brainstorm patterns", () => {
    const phaseIdx = ARCHITECT_PROMPT.indexOf("Phase 7.5 — Bets and exclusions");
    const block = ARCHITECT_PROMPT.slice(phaseIdx, phaseIdx + 6000);
    expect(block).toMatch(/idea-refine/);
    expect(block).toMatch(/ce-brainstorm/);
  });

  it("existing v8.67 Phase 7.5 (Assumptions correct me now) was renumbered to Phase 7.4 — heading still references the v8.67 contract", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Phase 7\.4 — Compose .*Assumptions \(correct me now\)/);
  });
});

describe("v8.80 — Plan-critic §6.5 (Bets and exclusions audit) is documented in plan-critic prompt", () => {
  it("plan-critic prompt declares the §6.5 section by name", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/§6\.5/);
  });

  it("plan-critic §6.5 references both `## Not Doing (and why)` and `## Key assumptions to validate` sections", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/## Not Doing \(and why\)/);
    expect(block).toMatch(/## Key assumptions to validate/);
  });

  it("plan-critic §6.5 declares the missing-section findings as block-ship", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/missing-not-doing/);
    expect(block).toMatch(/missing-key-assumptions/);
    expect(block).toMatch(/block-ship/);
  });

  it("plan-critic §6.5 declares the empty-section findings as block-ship", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/empty-not-doing/);
    expect(block).toMatch(/empty-key-assumptions/);
  });

  it("plan-critic §6.5 declares per-bullet iterate findings (no-rationale / no-method / no-status / bad-status)", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/not-doing-no-rationale/);
    expect(block).toMatch(/key-assumptions-no-method/);
    expect(block).toMatch(/key-assumptions-no-status/);
    expect(block).toMatch(/key-assumptions-bad-status/);
  });

  it("plan-critic §6.5 cites v8.80 as the introducing version", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/v8\.80/);
  });

  it("plan-critic §6.5 distinguishes itself from v8.67's Assumptions (correct me now) section", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/Assumptions \(correct me now\)/);
    expect(block).toMatch(/v8\.67/);
  });

  it("plan-critic §6.5 names the inline-skip + legacy-pre-v8.80 back-compat rule", () => {
    const idx = PLAN_CRITIC_PROMPT.indexOf("§6.5");
    const block = PLAN_CRITIC_PROMPT.slice(idx, idx + 6000);
    expect(block).toMatch(/inline/i);
    expect(block).toMatch(/legacy|back-compat|pre-v8\.80/i);
  });

  it("plan-critic §7 Verdict block surfaces a Bets and exclusions findings line", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/Bets and exclusions findings.*§6\.5/);
  });
});

describe("v8.80 — Research synthesis instructions cover both sections", () => {
  it("start-command body documents populating `## Key assumptions to validate` during research synthesis", () => {
    expect(START_COMMAND_BODY).toMatch(/## Key assumptions to validate/);
  });

  it("start-command body documents populating `## Not Doing (and why)` during research synthesis", () => {
    expect(START_COMMAND_BODY).toMatch(/## Not Doing \(and why\)/);
  });

  it("start-command research-mode synthesis carries the v8.80 contract", () => {
    expect(START_COMMAND_BODY).toMatch(
      /every research that ships excludes something|Every research that ships excludes something/
    );
  });

  it("start-command research synthesis cites the validation-method + status format", () => {
    expect(START_COMMAND_BODY).toMatch(/Validate by:/);
    expect(START_COMMAND_BODY).toMatch(/unvalidated/);
  });

  it("renderStartCommand stays identical to the exported body string (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });
});

describe("v8.80 — version + CHANGELOG cross-references", () => {
  it("CHANGELOG.md contains a v8.80 entry naming Not-doing and key assumptions to validate", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const changelog = await fs.readFile(path.join(here, "../../CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/v8\.80/);
    expect(changelog).toMatch(/Not-doing|Not Doing/);
    expect(changelog).toMatch(/Key assumptions to validate/);
  });

  it("CHANGELOG.md's v8.80 entry uses the canonical `## 8.84.0 — ... (v8.80 work)` header (slug-identity discipline)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const changelog = await fs.readFile(path.join(here, "../../CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/## 8\.84\.0 — Not-doing and key assumptions to validate \(v8\.80 work\)/);
  });

  it("package.json version is 8.80.x or later (the major/minor floor for the v8.80 work; package.json may be ahead due to v8.78/v8.81 race)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await fs.readFile(path.join(here, "../../package.json"), "utf8"));
    const parts = String(pkg.version).split(".");
    expect(parts).toHaveLength(3);
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(80);
  });

  it("README.md mentions v8.80 and both new sections by name", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const readme = await fs.readFile(path.join(here, "../../README.md"), "utf8");
    expect(readme).toMatch(/v8\.80/);
    expect(readme).toMatch(/## Not Doing \(and why\)/);
    expect(readme).toMatch(/## Key assumptions to validate/);
  });
});
