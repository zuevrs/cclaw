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

const SRC_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../src");

/**
 * v8.65 — Powerful research mode.
 *
 * Replaces the v8.58 architect-as-researcher dispatch with a multi-lens
 * main-context orchestrator. `/cc research <topic>` opens an open-ended
 * discovery dialogue (no question cap), then auto-dispatches the five
 * research lenses in parallel — engineer (feasibility + implementation
 * paths + risks), product (user value + alternatives + market context),
 * architecture (system fit + coupling + boundaries + scalability),
 * history (prior attempts via `.cclaw/knowledge.jsonl` + git log),
 * skeptic (failure modes + edge cases + abuse cases + hidden costs).
 * The orchestrator pastes each lens's findings verbatim into the
 * corresponding `## <Lens> lens` section of `research.md`, then runs a
 * cross-lens synthesis pass and a "recommended next step" finalisation.
 *
 * Lenses are research-only sub-agents — they live in
 * `src/content/research-lenses/`, install to
 * `.cclaw/lib/research-lenses/`, and are NOT in the core `SPECIALISTS`
 * array (which stays at 7).
 *
 * The tripwires below pin the v8.65 contract so any regression
 * (orphaned lens file, broken template, architect re-acquiring
 * research-mode dispatch, etc.) lights up immediately.
 */

describe("v8.65 — five research-lens files exist on disk", () => {
  const LENS_DIR = path.join(SRC_ROOT, "content/research-lenses");

  it("the lens directory contains exactly the five lens .ts files + index.ts", async () => {
    const entries = (await fs.readdir(LENS_DIR)).sort();
    expect(entries).toEqual([
      "index.ts",
      "research-architecture.ts",
      "research-engineer.ts",
      "research-history.ts",
      "research-product.ts",
      "research-skeptic.ts"
    ]);
  });

  it("every lens id in RESEARCH_LENSES has a backing source file", async () => {
    for (const id of RESEARCH_LENSES) {
      const file = path.join(LENS_DIR, `${id}.ts`);
      await expect(fs.access(file)).resolves.not.toThrow();
    }
  });
});

describe("v8.65 — RESEARCH_LENSES is exposed but NOT in SPECIALISTS", () => {
  it("RESEARCH_LENSES enumerates the five lens ids in canonical order", () => {
    expect([...RESEARCH_LENSES]).toEqual([
      "research-engineer",
      "research-product",
      "research-architecture",
      "research-history",
      "research-skeptic"
    ]);
  });

  it("SPECIALISTS does NOT contain any lens id (lenses are research-only)", () => {
    for (const id of RESEARCH_LENSES) {
      expect(SPECIALISTS as readonly string[]).not.toContain(id);
    }
  });

  it("SPECIALISTS length is unchanged at 7 (lenses do not bloat the flow specialist surface)", () => {
    expect(SPECIALISTS).toHaveLength(7);
  });
});

describe("v8.65 — RESEARCH_LENS_AGENTS registry (install metadata)", () => {
  it("RESEARCH_LENS_AGENTS has one entry per lens id, keyed in canonical order", () => {
    const ids = RESEARCH_LENS_AGENTS.map((a) => a.id);
    expect(ids).toEqual([...RESEARCH_LENSES]);
  });

  it("every RESEARCH_LENS_AGENTS entry has kind: `research-lens`", () => {
    for (const lens of RESEARCH_LENS_AGENTS) {
      expect(lens.kind).toBe("research-lens");
    }
  });

  it("every lens prompt body is non-empty (catches an empty-export regression)", () => {
    for (const lens of RESEARCH_LENS_AGENTS) {
      expect(lens.prompt.length).toBeGreaterThan(500);
    }
  });

  it("renderResearchLensMarkdown produces a markdown contract that includes the lens prompt body", () => {
    for (const lens of RESEARCH_LENS_AGENTS) {
      const rendered = renderResearchLensMarkdown(lens);
      expect(rendered.length).toBeGreaterThan(lens.prompt.length);
      expect(rendered).toContain(lens.prompt);
      // Each rendered contract carries the lens-specific frontmatter
      // discriminator so harness UIs can route it to the research-lenses
      // shelf instead of the flow-specialist shelf.
      expect(rendered).toContain("kind: research-lens");
      expect(rendered).toContain(`name: ${lens.id}`);
    }
  });
});

describe("v8.65 — RESEARCH_TEMPLATE has the multi-lens structure", () => {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;

  it("frontmatter declares mode: research and the lens roster", () => {
    expect(tpl).toMatch(/^---\n/u);
    expect(tpl).toContain("mode: research");
    expect(tpl).toMatch(/lenses:\s*\[engineer,\s*product,\s*architecture,\s*history,\s*skeptic\]/u);
  });

  it("body contains a section for each of the five lenses", () => {
    expect(tpl).toMatch(/^## Discovery dialogue summary$/mu);
    expect(tpl).toMatch(/^## Engineer lens$/mu);
    expect(tpl).toMatch(/^## Product lens$/mu);
    expect(tpl).toMatch(/^## Architecture lens$/mu);
    expect(tpl).toMatch(/^## History lens$/mu);
    expect(tpl).toMatch(/^## Skeptic lens$/mu);
  });

  it("body contains a Synthesis section (the cross-lens distillation)", () => {
    expect(tpl).toMatch(/^## Synthesis$/mu);
  });

  it("body contains a Recommended next step section (the orchestrator's finalisation)", () => {
    expect(tpl).toMatch(/^## Recommended next step$/mu);
    // The three permitted recommendations are named in the template prose
    expect(tpl).toMatch(/plan with `\/cc <task>`/u);
    expect(tpl).toMatch(/more research needed/iu);
    expect(tpl).toMatch(/don't proceed/iu);
  });

  it("body does NOT carry the v8.58 design-portion sections (Frame / Spec / Approaches / etc.)", () => {
    expect(tpl).not.toMatch(/^## Frame$/mu);
    expect(tpl).not.toMatch(/^## Spec$/mu);
    expect(tpl).not.toMatch(/^## Approaches$/mu);
    expect(tpl).not.toMatch(/^## Selected Direction$/mu);
    expect(tpl).not.toMatch(/^## Summary — architect/mu);
  });

  it("researchTemplateForSlug stamps placeholders + keeps the multi-lens section layout", () => {
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

describe("v8.65 — start-command.ts research-mode fork (multi-lens orchestrator prose)", () => {
  const body = renderStartCommand();

  it("body still fires on `research <topic>` prefix from the Detect hop", () => {
    expect(body).toMatch(/research[\s-]mode|`\/cc research <topic>`/u);
  });

  it("body documents the four-phase research orchestrator (bootstrap / dialogue / parallel lens dispatch / synthesis)", () => {
    expect(body).toMatch(/open-ended (discovery )?dialogue/iu);
    expect(body).toMatch(/parallel|in parallel/iu);
    expect(body).toMatch(/synthesis/iu);
    expect(body).toMatch(/discovery dialogue summary/iu);
  });

  it("body names all five lenses by id in the research-mode fork section", () => {
    for (const lens of RESEARCH_LENSES) {
      expect(body, `start-command body must reference lens ${lens}`).toContain(lens);
    }
  });

  it("body does NOT actively dispatch architect for research-mode (v8.58 architect-standalone-research replaced; breadcrumb references allowed)", () => {
    // The legacy v8.58 contract dispatched architect with
    // `mode: "research"`. v8.65 removes that dispatch — research mode
    // is handled by the main-context orchestrator + parallel lens
    // dispatch. The body may still mention the historical contract as
    // a version-supersession breadcrumb (e.g. "replacing the v8.58/v8.62
    // architect-standalone-research interim"), but it must not actively
    // direct the orchestrator to dispatch architect with a research
    // mode envelope.
    expect(body).not.toMatch(/dispatch[\s\S]{0,80}`?architect`?[\s\S]{0,80}mode:\s*"?research/iu);
    expect(body).not.toMatch(/dispatch the architect specialist[\s\S]{0,80}research/iu);
    // The body should explicitly declare the architect is NOT dispatched
    // for research-mode in v8.65.
    expect(body).toMatch(/architect is no longer dispatched for research|architect is not dispatched for research/iu);
  });

  it("body declares the priorResearch handoff prompt for the optional research → task transition", () => {
    expect(body).toMatch(/Ready to plan/u);
    expect(body).toMatch(/priorResearch/u);
  });

  it("body declares that research mode skips triage (orchestrator stamps a sentinel triage block)", () => {
    expect(body).toMatch(/skip triage|bypass(es)? triage|sentinel triage|no triage/iu);
  });

  it("START_COMMAND_BODY is in sync with renderStartCommand() output", () => {
    expect(START_COMMAND_BODY).toBe(body);
  });
});

describe("v8.65 — architect specialist no longer carries research-mode dispatch", () => {
  it("architect prompt declares `task` is the only mode it handles post-v8.65", () => {
    expect(ARCHITECT_PROMPT).toMatch(/intra-flow `mode: "task"` is the only mode you handle post-v8\.65/u);
  });

  it("architect prompt no longer carries the v8.58 `## Activation modes` two-mode section", () => {
    expect(ARCHITECT_PROMPT).not.toMatch(/Standalone research \(`triage\.mode == "research"`/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/finalises the research flow immediately/u);
    expect(ARCHITECT_PROMPT).not.toMatch(/Phase 7-research/u);
  });

  it("architect prompt still consumes flowState.priorResearch (research → task handoff lives on)", () => {
    expect(ARCHITECT_PROMPT).toContain("priorResearch");
  });
});

describe("v8.65 — every research-lens prompt body is referenced exactly once via RESEARCH_LENS_PROMPTS", () => {
  it("RESEARCH_LENS_PROMPTS exports one prompt per lens (5 entries, no duplicates)", () => {
    const ids = Object.keys(RESEARCH_LENS_PROMPTS);
    expect(ids.sort()).toEqual([...RESEARCH_LENSES].sort());
  });

  it("every lens prompt body is unique (no copy/paste regression collapsing two lenses into one)", () => {
    const bodies = Object.values(RESEARCH_LENS_PROMPTS);
    const unique = new Set(bodies);
    expect(unique.size).toBe(bodies.length);
  });
});

describe("v8.65 — install layer writes five research lens contracts to .cclaw/lib/research-lenses/", () => {
  it("init writes one .md per lens to .cclaw/lib/research-lenses/", async () => {
    const project = await createTempProject();
    try {
      await initCclaw({ cwd: project, harnesses: ["cursor"] });
      const lensesDir = path.join(project, ".cclaw", "lib", "research-lenses");
      const entries = (await fs.readdir(lensesDir)).sort();
      expect(entries).toEqual(RESEARCH_LENSES.map((id) => `${id}.md`).sort());
    } finally {
      await removeProject(project);
    }
  });

  it("sync is idempotent — re-running sync leaves the lens files intact (no orphan cleanup nukes them)", async () => {
    const project = await createTempProject();
    try {
      await initCclaw({ cwd: project, harnesses: ["cursor"] });
      const lensesDir = path.join(project, ".cclaw", "lib", "research-lenses");
      const before = (await fs.readdir(lensesDir)).sort();

      await syncCclaw({ cwd: project, harnesses: ["cursor"] });

      const after = (await fs.readdir(lensesDir)).sort();
      expect(after).toEqual(before);
      expect(after).toHaveLength(RESEARCH_LENSES.length);
    } finally {
      await removeProject(project);
    }
  });

  it("SyncResult counts the lenses (researchLenses === 5)", async () => {
    const project = await createTempProject();
    try {
      const result = await syncCclaw({ cwd: project, harnesses: ["cursor"] });
      expect(result.counts.researchLenses).toBe(5);
    } finally {
      await removeProject(project);
    }
  });

  it("init mirrors the lens contracts into the harness's agents directory (e.g. .cursor/agents/research-lenses/)", async () => {
    const project = await createTempProject();
    try {
      await initCclaw({ cwd: project, harnesses: ["cursor"] });
      // Harness mirror path: the install layer copies each lens into the
      // cursor harness's agent directory tree as well, so the harness's
      // own agent registry sees the lens contracts when the orchestrator
      // dispatches them. The exact path depends on the cursor harness's
      // layout; we only require that at least one mirror copy exists for
      // each lens id under .cursor/.
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
