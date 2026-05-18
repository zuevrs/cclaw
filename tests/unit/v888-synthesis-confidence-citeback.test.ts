import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  RESEARCH_LENS_PROMPTS
} from "../../src/content/research-lenses/index.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { RESEARCH_LENSES } from "../../src/types.js";

/**
 * v8.88 — Synthesis confidence + priorResearch cite-back.
 *
 * Two adjacent deliverables landed together:
 *
 * 1. **Numeric per-finding confidence at the lens layer.** Each of the
 *    six research lens prompts (engineer / product / architecture /
 *    history / skeptic / design) now requires the lens output to enumerate
 *    3-7 top-level findings, each tagged `#### F-N (confidence: 0.0-1.0)`.
 *    Reference: obra-style numeric confidence per finding from
 *    `gsd-research-synthesizer`.
 *
 * 2. **Synthesis confidence aggregation + cite-back contract.** The
 *    research orchestrator's Phase 3 synthesis pass now aggregates the
 *    per-lens findings into a mandatory `### Confidence summary`
 *    subsection of `## Synthesis`: weighted averages per
 *    finding-equivalent, confidence cliffs (≥0.5 spread between two
 *    lenses on the same claim), and a per-lens mean rollup. The
 *    follow-up `/cc <task>` flow's architect MUST cite the research
 *    sections that grounded each D-N via a `Cites: research.md
 *    §<section>` field on every Decision row when
 *    `flowState.priorResearch` is non-null; plan-critic §A blocks ship
 *    on missing citations in that mode.
 *
 * Tripwires below pin:
 *
 *   1. All six research lens prompts mention `confidence: 0.0-1.0`
 *      per-finding format with `F-N` numbering.
 *   2. The orchestrator's Phase 3 synthesis spec in start-command.ts
 *      names aggregation (weighted average), cliff detection (≥0.5
 *      threshold), and the `### Confidence summary` section.
 *   3. RESEARCH_TEMPLATE includes a `### Confidence summary` subsection
 *      under `## Synthesis` and per-lens `### Findings (with
 *      confidence)` sections under each `## <Lens> lens`.
 *   4. architect.ts Phase 0 + Phase 3 mention `priorResearch` AND the
 *      `Cites: research.md §<section>` field requirement on every D-N.
 *   5. PLAN_TEMPLATE D-N row includes the `Cites: research.md §<section>`
 *      field with conditional-on-priorResearch wording.
 *   6. plan-critic.ts §A checks for missing `Cites:` field when
 *      priorResearch was loaded (block-ship finding class
 *      `decision-missing-research-cite`).
 *   7. README documents the v8.88 work.
 *   8. package.json + CHANGELOG carry the v8.88 / 8.93.x bump.
 */

const PROJECT_ROOT = path.resolve(process.cwd());

function researchTemplateBody(): string {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "research");
  if (!tpl) throw new Error("research artifact template missing");
  return tpl.body;
}

function planTemplateBody(): string {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "plan");
  if (!tpl) throw new Error("plan artifact template missing");
  return tpl.body;
}

describe("v8.88 — all 6 research lens prompts mention `confidence: 0.0-1.0` per-finding format", () => {
  it("AC-1 — RESEARCH_LENSES enumerates exactly the six expected lens ids (no silent drift)", () => {
    expect([...RESEARCH_LENSES].sort()).toEqual(
      [
        "research-architecture",
        "research-design",
        "research-engineer",
        "research-history",
        "research-product",
        "research-skeptic"
      ].sort()
    );
  });

  for (const lensId of RESEARCH_LENSES) {
    it(`AC-1 — ${lensId} prompt declares a \`### Findings (with confidence)\` section`, () => {
      const body = RESEARCH_LENS_PROMPTS[lensId];
      expect(body).toContain("### Findings (with confidence)");
    });

    it(`AC-1 — ${lensId} prompt mentions the canonical \`confidence: 0.0-1.0\` per-finding format`, () => {
      const body = RESEARCH_LENS_PROMPTS[lensId];
      expect(body).toMatch(/confidence:\s*0\.0-1\.0/u);
    });

    it(`AC-1 — ${lensId} prompt enumerates \`F-N\` finding ids (at least F-1 / F-2 / F-3)`, () => {
      const body = RESEARCH_LENS_PROMPTS[lensId];
      expect(body).toMatch(/F-1\s*\(confidence:/u);
      expect(body).toMatch(/F-2\s*\(confidence:/u);
      expect(body).toMatch(/F-3\s*\(confidence:/u);
    });

    it(`AC-1 — ${lensId} prompt cites v8.88 work near the new Findings section`, () => {
      const body = RESEARCH_LENS_PROMPTS[lensId];
      const idx = body.indexOf("### Findings (with confidence)");
      const window = body.slice(idx, idx + 2000);
      expect(window).toMatch(/v8\.88/u);
    });
  }
});

describe("v8.88 — synthesis spec in start-command names aggregation + cliff detection + Confidence summary", () => {
  it("AC-2 — start-command mentions the `### Confidence summary` section in Phase 3 synthesis", () => {
    expect(START_COMMAND_BODY).toContain("### Confidence summary");
  });

  it("AC-2 — start-command names weighted averaging as the aggregation strategy", () => {
    expect(START_COMMAND_BODY).toMatch(/weighted\s+average/iu);
  });

  it("AC-2 — start-command names the 0.5 spread threshold for confidence cliffs", () => {
    expect(START_COMMAND_BODY).toMatch(/≥\s*0\.5|0\.5\s*spread/u);
  });

  it("AC-2 — start-command names `cliff` detection as a synthesis output", () => {
    expect(START_COMMAND_BODY).toMatch(/confidence\s+cliffs?/iu);
  });

  it("AC-2 — start-command cites the v8.88 work in the synthesis Phase 3 section", () => {
    const phase3Idx = START_COMMAND_BODY.indexOf("Phase 3 — synthesis");
    expect(phase3Idx).toBeGreaterThan(0);
    const phase3Block = START_COMMAND_BODY.slice(phase3Idx, phase3Idx + 4000);
    expect(phase3Block).toMatch(/v8\.88/u);
  });
});

describe("v8.88 — RESEARCH_TEMPLATE includes Confidence summary + per-lens Findings (with confidence) sections", () => {
  const tpl = researchTemplateBody();

  it("AC-3 — RESEARCH_TEMPLATE Synthesis section carries a `### Confidence summary` subsection", () => {
    expect(tpl).toContain("### Confidence summary");
    const synthesisIdx = tpl.indexOf("## Synthesis");
    const confSummaryIdx = tpl.indexOf("### Confidence summary");
    expect(synthesisIdx).toBeGreaterThan(0);
    expect(confSummaryIdx).toBeGreaterThan(synthesisIdx);
  });

  it("AC-3 — Confidence summary subsection names weighted averages, cliffs, and per-lens rollup", () => {
    const confIdx = tpl.indexOf("### Confidence summary");
    const block = tpl.slice(confIdx, confIdx + 4000);
    expect(block).toMatch(/[Ww]eighted\s+average/u);
    expect(block).toMatch(/[Cc]liff/u);
    expect(block).toMatch(/[Pp]er-lens\s+rollup/u);
  });

  it("AC-3 — Confidence summary subsection names the 0.5 cliff threshold", () => {
    const confIdx = tpl.indexOf("### Confidence summary");
    const block = tpl.slice(confIdx, confIdx + 4000);
    expect(block).toMatch(/≥\s*0\.5|0\.5\s*spread/u);
  });

  it("AC-3 — Confidence summary subsection cites the v8.88 work", () => {
    const confIdx = tpl.indexOf("### Confidence summary");
    const block = tpl.slice(confIdx, confIdx + 4000);
    expect(block).toMatch(/v8\.88/u);
  });

  // Per-lens `### Findings (with confidence)` sections in RESEARCH_TEMPLATE.
  const lensSectionHeaders: Array<[string, string]> = [
    ["engineer", "## Engineer lens"],
    ["product", "## Product lens"],
    ["architecture", "## Architecture lens"],
    ["history", "## History lens"],
    ["skeptic", "## Skeptic lens"],
    ["design", "## research-design — Design dimensions"]
  ];

  for (const [name, header] of lensSectionHeaders) {
    it(`AC-3 — RESEARCH_TEMPLATE \`${header}\` section carries a \`### Findings (with confidence)\` subsection`, () => {
      const headerIdx = tpl.indexOf(header);
      expect(headerIdx).toBeGreaterThan(0);
      // Search forward to next `## ` heading.
      const nextH2 = tpl.indexOf("\n## ", headerIdx + header.length);
      const lensBlock = tpl.slice(
        headerIdx,
        nextH2 > 0 ? nextH2 : headerIdx + 5000
      );
      expect(lensBlock, `${name} lens missing Findings (with confidence) subsection`).toContain(
        "### Findings (with confidence)"
      );
      expect(lensBlock).toMatch(/F-1\s*\(confidence:/u);
    });
  }
});

describe("v8.88 — architect.ts mentions priorResearch + Cites field requirement on D-N rows", () => {
  it("AC-4 — architect prompt continues to mention `priorResearch` (existing v8.65 wiring)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/priorResearch/u);
  });

  it("AC-4 — architect prompt names the `Cites: research.md §<section>` field requirement", () => {
    expect(ARCHITECT_PROMPT).toMatch(/Cites:\s*research\.md\s*§/u);
  });

  it("AC-4 — architect prompt scopes the Cites requirement to non-null priorResearch", () => {
    // Search the Phase 3 / Decisions area for the mandatory-when-priorResearch wording.
    const phase3Idx = ARCHITECT_PROMPT.indexOf("Phase 3");
    expect(phase3Idx).toBeGreaterThan(0);
    // Look anywhere in the architect prompt for the wording — the cite-back rule lands in Phase 3 + Phase 0 step 6.
    expect(ARCHITECT_PROMPT).toMatch(
      /priorResearch[^\n]*non-null|non-null[^\n]*priorResearch/iu
    );
  });

  it("AC-4 — architect prompt cites the v8.88 work for the cite-back contract", () => {
    expect(ARCHITECT_PROMPT).toMatch(/v8\.88/u);
  });

  it("AC-4 — architect prompt OMITS-Cites guidance when priorResearch is null (cold-start)", () => {
    expect(ARCHITECT_PROMPT).toMatch(/[Oo]mit|null/u);
  });
});

describe("v8.88 — PLAN_TEMPLATE D-N row includes the `Cites: research.md §<section>` field", () => {
  const tpl = planTemplateBody();

  it("AC-5 — PLAN_TEMPLATE D-N row template names the `Cites: research.md §<section>` field", () => {
    expect(tpl).toMatch(/Cites:\s*_?research\.md\s*§/u);
  });

  it("AC-5 — PLAN_TEMPLATE describes the field as conditional on priorResearch", () => {
    const decisionsIdx = tpl.indexOf("## Decisions");
    expect(decisionsIdx).toBeGreaterThan(0);
    const decisionsBlock = tpl.slice(decisionsIdx, decisionsIdx + 6000);
    expect(decisionsBlock).toMatch(/priorResearch/u);
    expect(decisionsBlock).toMatch(/v8\.88/u);
  });

  it("AC-5 — PLAN_TEMPLATE names the OMIT-when-null contract for cold-start flows", () => {
    const decisionsIdx = tpl.indexOf("## Decisions");
    const decisionsBlock = tpl.slice(decisionsIdx, decisionsIdx + 6000);
    expect(decisionsBlock).toMatch(/OMIT|omitted|null/u);
  });
});

describe("v8.88 — plan-critic §A checks for missing Cites when priorResearch loaded", () => {
  it("AC-6 — plan-critic §A names the `decision-missing-research-cite` finding class", () => {
    expect(PLAN_CRITIC_PROMPT).toContain("decision-missing-research-cite");
  });

  it("AC-6 — plan-critic §A scopes the check to non-null priorResearch", () => {
    // The §A section spans roughly 2-3k chars; just ensure both tokens land there.
    const sectionIdx = PLAN_CRITIC_PROMPT.indexOf("§A. Decision integrity");
    expect(sectionIdx).toBeGreaterThan(0);
    const block = PLAN_CRITIC_PROMPT.slice(sectionIdx, sectionIdx + 5000);
    expect(block).toMatch(/priorResearch/u);
    expect(block).toMatch(/non-null/u);
    expect(block).toContain("Cites:");
  });

  it("AC-6 — plan-critic §A names the malformed-cite class (decision-bad-research-cite)", () => {
    expect(PLAN_CRITIC_PROMPT).toContain("decision-bad-research-cite");
  });

  it("AC-6 — plan-critic §A names the orphan-cite class (decision-orphan-research-cite) for cold-start mis-authoring", () => {
    expect(PLAN_CRITIC_PROMPT).toContain("decision-orphan-research-cite");
  });

  it("AC-6 — plan-critic §A cites v8.88 alongside v8.74 in the section title", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/§A\.\s*Decision integrity.*v8\.88/u);
  });
});

describe("v8.88 — README documents the synthesis-confidence + cite-back work", () => {
  let readme: string;

  it("AC-7 — README mentions v8.88 explicitly", async () => {
    readme = await fs.readFile(path.join(PROJECT_ROOT, "README.md"), "utf-8");
    expect(readme).toMatch(/v8\.88/u);
  });

  it("AC-7 — README names the per-finding confidence + cite-back features", () => {
    expect(readme).toMatch(/confidence/iu);
    expect(readme).toMatch(/[Cc]ite[- ]?back|Cites:\s*research\.md/u);
  });
});

describe("v8.88 — version bump + CHANGELOG entry", () => {
  it("AC-8 — package.json bumps to at least 8.93.0", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(93);
  });

  it("AC-8 — CHANGELOG.md carries an entry naming the v8.88 work", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.88/u);
    expect(changelog).toMatch(/[Ss]ynthesis\s+confidence|[Cc]ite[- ]?back|priorResearch/u);
  });
});
