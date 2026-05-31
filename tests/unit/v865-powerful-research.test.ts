import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { ARTIFACT_TEMPLATES, researchTemplateForSlug } from "../../src/content/artifact-templates.js";
import {
  RESEARCH_LENS_AGENTS,
  renderResearchLensMarkdown
} from "../../src/content/core-agents.js";
import { RESEARCH_LENS_PROMPTS } from "../../src/content/research-lenses/index.js";
import {
  renderStartCommand,
  START_COMMAND_BODY
} from "../../src/content/start-command.js";
import { initCclaw, syncCclaw } from "../../src/install.js";
import { RESEARCH_LENSES, SPECIALISTS } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.65 — Powerful research mode.
 *
 * Slimmed in v8.101 test-slim-down A4 from 31 atomized tests to 6 packed
 * tests (lens directory + registry, RESEARCH_LENS_AGENTS metadata,
 * RESEARCH_TEMPLATE shape, start-command research-mode contract,
 * architect/lens prompts, install wiring). The two install-layer
 * behaviour tests (init writes lens files; sync count == 6) are KEPT
 * (they exercise real install/sync code, not prompt-grep surface).
 */

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const LENS_DIR = path.join(SRC_ROOT, "content/research-lenses");

describe("v8.65 + v8.76 — lens directory + RESEARCH_LENSES registry", () => {
  it("WIRING — content/research-lenses/ holds the six lens .ts files + index.ts (v8.76 added research-design); RESEARCH_LENSES enumerates the six ids in canonical order; SPECIALISTS does NOT contain any lens id (lenses live in RESEARCH_LENSES, not SPECIALISTS); SPECIALISTS has length 8 (v8.104 — plan-design + plan-devex merged into plan-critic as rubric modes)", async () => {
    const entries = (await fs.readdir(LENS_DIR)).sort();
    expect(entries).toEqual([
      "index.ts",
      "research-architecture.ts",
      "research-design.ts",
      "research-engineer.ts",
      "research-history.ts",
      "research-product.ts",
      "research-skeptic.ts"
    ]);
    for (const id of RESEARCH_LENSES) {
      const file = path.join(LENS_DIR, `${id}.ts`);
      await expect(fs.access(file)).resolves.not.toThrow();
    }
    expect([...RESEARCH_LENSES]).toEqual([
      "research-engineer",
      "research-product",
      "research-architecture",
      "research-history",
      "research-skeptic",
      "research-design"
    ]);
    for (const id of RESEARCH_LENSES) {
      expect(SPECIALISTS as readonly string[]).not.toContain(id);
    }
    expect(SPECIALISTS).toHaveLength(8);
  });
});

describe("v8.65 — RESEARCH_LENS_AGENTS registry + renderResearchLensMarkdown contract", () => {
  it("WIRING — RESEARCH_LENS_AGENTS has one entry per lens id (canonical order), every entry is kind:'research-lens' with non-empty (>500 char) prompt body and unique body (no copy/paste collapse), and renderResearchLensMarkdown emits a contract that wraps the prompt with kind+name frontmatter", () => {
    expect(RESEARCH_LENS_AGENTS.map((a) => a.id)).toEqual([...RESEARCH_LENSES]);
    const bodies = Object.values(RESEARCH_LENS_PROMPTS);
    expect(new Set(bodies).size).toBe(bodies.length);
    expect(Object.keys(RESEARCH_LENS_PROMPTS).sort()).toEqual([...RESEARCH_LENSES].sort());
    for (const lens of RESEARCH_LENS_AGENTS) {
      expect(lens.kind).toBe("research-lens");
      expect(lens.prompt.length).toBeGreaterThan(500);
      const rendered = renderResearchLensMarkdown(lens);
      expect(rendered.length).toBeGreaterThan(lens.prompt.length);
      expect(rendered).toContain(lens.prompt);
      expect(rendered).toContain("kind: research-lens");
      expect(rendered).toContain(`name: ${lens.id}`);
    }
  });
});

describe("v8.65 + v8.76 — RESEARCH_TEMPLATE has the multi-lens shape", () => {
  it("BEHAVIOR — research artifact template frontmatter declares mode:research + 6-lens roster, body carries six lens headings + Discovery dialogue summary + Synthesis + Recommended next step (with the three permitted recommendations), does NOT carry the v8.58 design-portion sections, and researchTemplateForSlug stamps placeholders without leaving PLACEHOLDER tokens", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;
    expect(tpl).toMatch(/^---\n/u);
    expect(tpl).toContain("mode: research");
    expect(tpl).toMatch(/lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic,\s*design\]/u);
    for (const heading of [
      /^## Discovery dialogue summary$/mu,
      /^## Engineer lens$/mu,
      /^## Product lens$/mu,
      /^## Architecture lens$/mu,
      /^## History lens$/mu,
      /^## Skeptic lens$/mu,
      /^## research-design — Design dimensions$/mu,
      /^## Synthesis$/mu,
      /^## Recommended next step$/mu
    ]) {
      expect(tpl).toMatch(heading);
    }
    expect(tpl).toMatch(/plan with `\/cc <task>`/u);
    expect(tpl).toMatch(/more research needed/iu);
    expect(tpl).toMatch(/don't proceed/iu);
    for (const ghost of [
      /^## Frame$/mu,
      /^## Spec$/mu,
      /^## Approaches$/mu,
      /^## Selected Direction$/mu,
      /^## Summary — architect/mu
    ]) {
      expect(tpl).not.toMatch(ghost);
    }
    const out = researchTemplateForSlug(
      "20260516-research-redis-cache",
      "redis caching strategy for the search endpoint",
      "2026-05-16T17:00:00Z"
    );
    expect(out).toContain("slug: 20260516-research-redis-cache");
    expect(out).toContain("topic: redis caching strategy for the search endpoint");
    expect(out).toContain("generated_at: 2026-05-16T17:00:00Z");
    expect(out).not.toContain("PLACEHOLDER");
    expect(out).toMatch(/^## Engineer lens$/mu);
    expect(out).toMatch(/^## Skeptic lens$/mu);
    expect(out).toMatch(/^## Synthesis$/mu);
  });
});

describe("v8.65 — start-command research-mode fork + architect divestment", () => {
  it("BEHAVIOR — start-command body documents research-mode trigger + four-phase orchestrator (dialogue / parallel lens dispatch / synthesis / discovery summary), names all six lenses by id, does NOT actively dispatch architect for research-mode, declares priorResearch handoff + research-mode skip-triage; START_COMMAND_BODY === renderStartCommand(); architect prompt declares `task` is the only post-v8.65 mode and no longer carries the v8.58 two-mode Activation modes section but still consumes priorResearch", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/research[\s-]mode|`\/cc research <topic>`/u);
    expect(body).toMatch(/open-ended (discovery )?dialogue/iu);
    expect(body).toMatch(/parallel|in parallel/iu);
    expect(body).toMatch(/synthesis/iu);
    expect(body).toMatch(/discovery dialogue summary/iu);
    for (const lens of RESEARCH_LENSES) {
      expect(body, `start-command body must reference lens ${lens}`).toContain(lens);
    }
    expect(body).not.toMatch(/dispatch[\s\S]{0,80}`?architect`?[\s\S]{0,80}mode:\s*"?research/iu);
    expect(body).not.toMatch(/dispatch the architect specialist[\s\S]{0,80}research/iu);
    expect(body).toMatch(/architect is no longer dispatched for research|architect is not dispatched for research/iu);
    expect(body).toMatch(/Ready to plan/u);
    expect(body).toMatch(/priorResearch/u);
    expect(body).toMatch(/skip triage|bypass(es)? triage|sentinel triage|no triage/iu);
    expect(START_COMMAND_BODY).toBe(body);

    expect(ARCHITECT_PROMPT).toMatch(/intra-flow `mode: "task"` is the only mode you handle/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Standalone research \(`triage\.mode == "research"`/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/finalises the research flow immediately/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7-research/u);
    expect(ARCHITECT_PROMPT).toContain("priorResearch");
  });
});

describe("v8.65 — install layer writes lens contracts (real install/sync wiring)", () => {
  it("init writes one .md per lens to .cclaw/lib/research-lenses/, syncCclaw is idempotent on the directory, and SyncResult.counts.researchLenses === 6 (v8.76+)", async () => {
    const project = await createTempProject();
    try {
      await initCclaw({ cwd: project, harnesses: ["cursor"] });
      const lensesDir = path.join(project, ".cclaw", "lib", "research-lenses");
      const before = (await fs.readdir(lensesDir)).sort();
      expect(before).toEqual(RESEARCH_LENSES.map((id) => `${id}.md`).sort());

      const result = await syncCclaw({ cwd: project, harnesses: ["cursor"] });
      const after = (await fs.readdir(lensesDir)).sort();
      expect(after).toEqual(before);
      expect(result.counts.researchLenses).toBe(6);

      // Harness mirror: cursor agent dir exists after init.
      const cursorRoot = path.join(project, ".cursor");
      const exists = await fs.access(cursorRoot).then(
        () => true,
        () => false
      );
      expect(exists).toBe(true);
    } finally {
      await removeProject(project);
    }
  });
});
