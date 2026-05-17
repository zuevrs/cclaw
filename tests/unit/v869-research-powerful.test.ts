import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { RESEARCH_LENS_PROMPTS } from "../../src/content/research-lenses/index.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { TRIAGE_PROMPT } from "../../src/content/specialist-prompts/triage.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import {
  DEFAULT_RESEARCH_DEPTH,
  RESEARCH_DEPTHS,
  type ResearchDepth,
  type TriageDecision
} from "../../src/types.js";

/**
 * v8.69 — Powerful research: web search + multi-tier depth + synthesis
 * self-review.
 *
 * Tripwires:
 *   1. Each lens prompt declares first-class web-search dispatch
 *      (engineer / product / architecture / skeptic) OR the explicit
 *      memory-only opt-out (history).
 *   2. Research depth tiers are typed (`light` / `standard` /
 *      `deep-product`) and `TriageDecision` carries `research_depth?`.
 *   3. Orchestrator's research-mode fork stamps `research_depth` from
 *      the explicit flag or auto-classifies it from topic wording, with
 *      details lifted into the new `research-depth-and-self-review.md`
 *      runbook.
 *   4. Phase 2 dispatch uses depth to gate the lens set
 *      (light = 2 lenses; standard = 5; deep-product = 5 + extra
 *      probes).
 *   5. Phase 3 synthesis runs a self-review pass before `research.md`
 *      is written.
 *   6. `RESEARCH_TEMPLATE` carries `### Sources` per lens, `### Self-review notes`
 *      under Synthesis, and `research_depth:` in the frontmatter.
 *   7. Install layer writes the new runbook on `init` (covered by the
 *      v8.22 install layer test that walks `ON_DEMAND_RUNBOOKS`; here we
 *      just confirm the runbook is present in that array).
 */

const SRC_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src"
);

const RESEARCH_TEMPLATE_BODY = ARTIFACT_TEMPLATES.find((t) => t.id === "research")!.body;

describe("v8.69 — ResearchDepth type + DEFAULT_RESEARCH_DEPTH", () => {
  it("RESEARCH_DEPTHS carries exactly the three canonical tiers, in spec order", () => {
    expect([...RESEARCH_DEPTHS]).toEqual(["light", "standard", "deep-product"]);
  });

  it("DEFAULT_RESEARCH_DEPTH is 'standard' (pre-v8.69 5-lens behaviour)", () => {
    expect(DEFAULT_RESEARCH_DEPTH).toBe("standard");
  });

  it("ResearchDepth type derives from the enum (compile-time round-trip)", () => {
    const a: ResearchDepth = "light";
    const b: ResearchDepth = "standard";
    const c: ResearchDepth = "deep-product";
    expect([a, b, c]).toEqual([...RESEARCH_DEPTHS]);
  });

  it("TriageDecision interface accepts `research_depth?` (compile-time check)", () => {
    const t: TriageDecision = {
      complexity: "large-risky",
      ceremonyMode: "strict",
      path: ["plan"],
      runMode: null,
      mode: "research",
      research_depth: "deep-product"
    };
    expect(t.research_depth).toBe("deep-product");
  });

  it("types.ts source documents each of the three depth tiers", async () => {
    const body = await fs.readFile(path.join(SRC_ROOT, "types.ts"), "utf8");
    expect(body).toMatch(/`light`/u);
    expect(body).toMatch(/`standard`/u);
    expect(body).toMatch(/`deep-product`/u);
    expect(body).toMatch(/RESEARCH_DEPTHS/u);
    expect(body).toMatch(/research_depth\?: ResearchDepth/u);
  });
});

describe("v8.69 — every research lens declares first-class web-search dispatch (or explicit opt-out)", () => {
  for (const lensId of ["research-engineer", "research-product", "research-architecture", "research-skeptic"] as const) {
    describe(lensId, () => {
      const prompt = RESEARCH_LENS_PROMPTS[lensId];

      it("declares a `## Knowledge sourcing` section (first-class web search dispatch)", () => {
        expect(prompt).toMatch(/^## Knowledge sourcing/mu);
      });

      it("names the MCP tools (`user-exa` for web search, `user-context7` for library docs)", () => {
        expect(prompt).toMatch(/user-exa/u);
        expect(prompt).toMatch(/user-context7/u);
      });

      it("declares graceful fallback to training knowledge when MCP is unavailable", () => {
        expect(prompt).toMatch(/fall back|fallback|training knowledge/iu);
      });

      it("declares inline citation discipline (web findings are cited, not paraphrased silently)", () => {
        expect(prompt).toMatch(/cite|citation|source/iu);
      });

      it("envelope context surfaces `Research depth` (so the lens can branch on light / standard / deep-product)", () => {
        expect(prompt).toMatch(/Research depth/u);
      });

      it("Findings block carries a `### Sources` subsection (citations the lens used)", () => {
        expect(prompt).toMatch(/^### Sources/mu);
      });
    });
  }

  it("research-history declares web search is OUT of scope (memory-only lens reads `.cclaw/knowledge.jsonl` + git log)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-history"];
    expect(prompt).toMatch(/^## Knowledge sourcing/mu);
    expect(prompt).toMatch(/out of scope|no web search|memory-only|does not (use|dispatch) web/iu);
    expect(prompt).toMatch(/knowledge\.jsonl/u);
  });

  it("research-history's Findings block carries a `### Sources` subsection citing project-local memory only", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-history"];
    expect(prompt).toMatch(/^### Sources/mu);
    expect(prompt).toMatch(/knowledge\.jsonl|learnings\.md|git/u);
  });
});

describe("v8.69 — deep-product probes folded into product + skeptic lenses", () => {
  it("research-product declares the `Thesis` probe (deep-product depth only)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-product"];
    expect(prompt).toMatch(/Thesis|product thesis|implicit thesis/iu);
    expect(prompt).toMatch(/deep-product/u);
  });

  it("research-product declares the `Adjacent product` probe (deep-product depth only)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-product"];
    expect(prompt).toMatch(/Adjacent[- ]product|adjacent product/iu);
    expect(prompt).toMatch(/deep-product/u);
  });

  it("research-skeptic declares the `Durability` probe (deep-product depth only)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-skeptic"];
    expect(prompt).toMatch(/Durability/iu);
    expect(prompt).toMatch(/deep-product/u);
  });
});

describe("v8.69 — research-mode fork in start-command stamps research_depth", () => {
  it("orchestrator body parses `--light` / `--standard` / `--deep-product` flags (last-wins on collision)", () => {
    expect(START_COMMAND_BODY).toMatch(/--light/u);
    expect(START_COMMAND_BODY).toMatch(/--standard/u);
    expect(START_COMMAND_BODY).toMatch(/--deep-product/u);
  });

  it("orchestrator body stamps `research_depth` into the sentinel triage block on the research-mode fork", () => {
    expect(START_COMMAND_BODY).toMatch(/research_depth:/u);
  });

  it("orchestrator body points at the new runbook for the depth-tier table + auto-classification heuristic", () => {
    expect(START_COMMAND_BODY).toMatch(/runbooks\/research-depth-and-self-review\.md/u);
  });

  it("orchestrator body declares the depth-flag last-wins sub-case", () => {
    expect(START_COMMAND_BODY).toMatch(/multiple depth flags|mutually exclusive depth flags/iu);
  });
});

describe("v8.69 — Phase 2 dispatch uses depth to gate the lens set", () => {
  it("orchestrator body declares the light-depth lens set (engineer + skeptic; the other three are skipped)", () => {
    expect(START_COMMAND_BODY).toMatch(/light/u);
    // The body must surface the exact lens-set decision somewhere in
    // Phase 2 (engineer + skeptic on light, all 5 on standard).
    expect(START_COMMAND_BODY).toMatch(/engineer.*skeptic|skeptic.*engineer/u);
  });

  it("orchestrator body declares the deep-product extra-probes routing (product + skeptic fold extra probes)", () => {
    expect(START_COMMAND_BODY).toMatch(/deep-product/u);
    // The dispatch envelope must surface `Research depth:` so the lens
    // can branch on it.
    expect(START_COMMAND_BODY).toMatch(/Research depth:/u);
  });
});

describe("v8.69 — Phase 3 synthesis self-review pass", () => {
  it("orchestrator body declares the self-review pass step in Phase 3", () => {
    expect(START_COMMAND_BODY).toMatch(/self-review/iu);
  });

  it("orchestrator body lists the four scans (placeholder / contradiction / scope / ambiguity) at the high level", () => {
    expect(START_COMMAND_BODY).toMatch(/placeholder/iu);
    expect(START_COMMAND_BODY).toMatch(/contradiction/iu);
    expect(START_COMMAND_BODY).toMatch(/scope drift|scope-drift/iu);
    expect(START_COMMAND_BODY).toMatch(/ambiguity/iu);
  });

  it("orchestrator body points at the runbook for the full self-review procedure", () => {
    expect(START_COMMAND_BODY).toMatch(/runbooks\/research-depth-and-self-review\.md/u);
  });
});

describe("v8.69 — research-depth-and-self-review.md runbook", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "research-depth-and-self-review.md");

  it("runbook is registered in ON_DEMAND_RUNBOOKS", () => {
    expect(runbook).toBeTruthy();
  });

  it("runbook opens with the canonical `# On-demand runbook —` heading", () => {
    expect(runbook!.body).toMatch(/^# On-demand runbook — /u);
  });

  it("runbook documents all three depth tiers and the lens-set mapping", () => {
    const body = runbook!.body;
    expect(body).toMatch(/light/u);
    expect(body).toMatch(/standard/u);
    expect(body).toMatch(/deep-product/u);
    expect(body).toMatch(/research-engineer/u);
    expect(body).toMatch(/research-skeptic/u);
  });

  it("runbook declares the auto-classification heuristic for the no-flag path", () => {
    const body = runbook!.body;
    expect(body).toMatch(/auto[- ]classif/iu);
    expect(body).toMatch(/should we build|what if we replace|evaluate switching/u);
  });

  it("runbook documents the four self-review scans + Self-review notes capture", () => {
    const body = runbook!.body;
    expect(body).toMatch(/Placeholder scan/u);
    expect(body).toMatch(/contradiction scan/iu);
    expect(body).toMatch(/scope drift|scope-drift/iu);
    expect(body).toMatch(/Ambiguity scan/u);
    expect(body).toMatch(/Self-review notes/u);
  });

  it("runbook declares the clean-state literal `No self-review issues found.`", () => {
    expect(runbook!.body).toContain("No self-review issues found.");
  });
});

describe("v8.69 — RESEARCH_TEMPLATE update (Sources / Self-review / depth)", () => {
  it("RESEARCH_TEMPLATE frontmatter declares `research_depth:` (default `standard`)", () => {
    expect(RESEARCH_TEMPLATE_BODY).toMatch(/^research_depth: standard/mu);
  });

  it("RESEARCH_TEMPLATE has `### Sources` subsections in EVERY per-lens section (5 default lenses + v8.76 design lens = 6 total when the design section ships in the template)", () => {
    const sources = RESEARCH_TEMPLATE_BODY.match(/^### Sources\b/gmu);
    expect(sources, "expected one `### Sources` subsection per lens (5+ total)").toBeTruthy();
    expect(sources!.length).toBeGreaterThanOrEqual(5);
  });

  it("RESEARCH_TEMPLATE Synthesis section carries a `### Self-review notes` subsection", () => {
    expect(RESEARCH_TEMPLATE_BODY).toMatch(/^### Self-review notes$/mu);
    expect(RESEARCH_TEMPLATE_BODY).toContain("No self-review issues found.");
  });

  it("RESEARCH_TEMPLATE deep-product subsections (Product thesis / Adjacent product / Durability probe) are tagged 'deep-product depth only'", () => {
    expect(RESEARCH_TEMPLATE_BODY).toMatch(/Product thesis.*deep-product depth only/u);
    expect(RESEARCH_TEMPLATE_BODY).toMatch(/Adjacent product.*deep-product depth only/u);
    expect(RESEARCH_TEMPLATE_BODY).toMatch(/Durability probe.*deep-product depth only/u);
  });

  it("RESEARCH_TEMPLATE Sources hint mentions both MCP tools (`user-exa`, `user-context7`) for the four web-using lenses", () => {
    // Engineer / Product / Architecture / Skeptic Sources blocks all
    // mention both MCP tool ids; History's Sources block does not (it's
    // memory-only).
    const exaCount = (RESEARCH_TEMPLATE_BODY.match(/user-exa/g) ?? []).length;
    const ctx7Count = (RESEARCH_TEMPLATE_BODY.match(/user-context7/g) ?? []).length;
    expect(exaCount).toBeGreaterThanOrEqual(4);
    expect(ctx7Count).toBeGreaterThanOrEqual(4);
  });
});

describe("v8.69 — render parity (rendered start-command equals exported body)", () => {
  it("renderStartCommand() output is identical to START_COMMAND_BODY (no drift)", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });
});
