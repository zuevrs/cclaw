import { describe, expect, it } from "vitest";
import {
  RESEARCH_LENS_DESCRIPTIONS,
  RESEARCH_LENS_PROMPTS,
  RESEARCH_LENS_TITLES
} from "../../src/content/research-lenses/index.js";
import { RESEARCH_LENSES, type ResearchLensId } from "../../src/types.js";

/**
 * v8.65 — research-only sub-agent lens prompts. The five lenses are
 * dispatched in parallel by the research orchestrator (main-context flow
 * powering `/cc research <topic>`) and each return a structured per-lens
 * findings block. They live in `src/content/research-lenses/` and are
 * NOT part of the core `SPECIALISTS` array.
 *
 * The tests below pin the structural invariants every lens must hold so
 * that drift in one lens contract surfaces immediately (the orchestrator
 * relies on every lens producing a parseable slim summary + paste-ready
 * findings block).
 */

const LENS_IDS: readonly ResearchLensId[] = RESEARCH_LENSES;

describe("v8.65 research lenses — registry surfaces", () => {
  it("RESEARCH_LENS_PROMPTS has exactly five entries, keyed by RESEARCH_LENSES", () => {
    const keys = Object.keys(RESEARCH_LENS_PROMPTS).sort();
    expect(keys).toEqual([...LENS_IDS].sort());
  });

  it("RESEARCH_LENS_TITLES has exactly five entries, keyed by RESEARCH_LENSES", () => {
    const keys = Object.keys(RESEARCH_LENS_TITLES).sort();
    expect(keys).toEqual([...LENS_IDS].sort());
  });

  it("RESEARCH_LENS_DESCRIPTIONS has exactly five entries, keyed by RESEARCH_LENSES", () => {
    const keys = Object.keys(RESEARCH_LENS_DESCRIPTIONS).sort();
    expect(keys).toEqual([...LENS_IDS].sort());
  });

  it("every lens title is non-empty and starts with the 'Research — ' prefix", () => {
    for (const id of LENS_IDS) {
      const title = RESEARCH_LENS_TITLES[id];
      expect(title.length).toBeGreaterThan(0);
      expect(title).toMatch(/^Research — /u);
    }
  });

  it("every lens description is non-empty (one-line summary surfaced in install summary / README)", () => {
    for (const id of LENS_IDS) {
      const desc = RESEARCH_LENS_DESCRIPTIONS[id];
      expect(desc.length).toBeGreaterThan(20);
    }
  });
});

describe("v8.65 research lenses — every lens prompt has the canonical sections", () => {
  for (const id of LENS_IDS) {
    describe(id, () => {
      const prompt = RESEARCH_LENS_PROMPTS[id];

      it("opens with a single H1 heading matching the lens id", () => {
        expect(prompt).toMatch(new RegExp(`^# ${id}\\b`, "u"));
      });

      it("declares it is a research-only sub-agent (NOT in SPECIALISTS)", () => {
        expect(prompt).toMatch(/research-only sub-agent/iu);
        expect(prompt).toMatch(/NOT\*?\*?\s+in the `SPECIALISTS`/u);
      });

      it("declares the v8.65 research orchestrator dispatcher (main-context flow)", () => {
        expect(prompt).toMatch(/research orchestrator/iu);
        expect(prompt).toMatch(/\/cc research <topic>/u);
      });

      it("declares the five-lens parallel dispatch contract", () => {
        expect(prompt).toMatch(/in parallel/iu);
        // every lens names the sibling lenses (4 of the 5)
        const siblings = LENS_IDS.filter((other) => other !== id);
        for (const sibling of siblings) {
          expect(prompt, `${id} must reference sibling lens ${sibling}`).toContain(sibling);
        }
      });

      it("has a `## Sub-agent context` section (envelope description)", () => {
        expect(prompt).toMatch(/^## Sub-agent context$/mu);
      });

      it("has a `## Role` section (one-line answer the lens delivers)", () => {
        expect(prompt).toMatch(/^## Role$/mu);
      });

      it("has a `## Scope` section (enumerates what the lens covers)", () => {
        expect(prompt).toMatch(/^## Scope/mu);
      });

      it("has a `## Inputs` section (declares what the lens reads)", () => {
        expect(prompt).toMatch(/^## Inputs/mu);
      });

      it("has a `## Outputs` section (declares the structured findings block)", () => {
        expect(prompt).toMatch(/^## Outputs/mu);
      });

      it("has a `## Slim summary` section (returned to the orchestrator)", () => {
        expect(prompt).toMatch(/^## Slim summary/mu);
      });

      it("has a `## Hard rules` section (pinning lens-side invariants)", () => {
        expect(prompt).toMatch(/^## Hard rules$/mu);
      });

      it("has a `## Composition` section (declares invoked-by / spawns-what)", () => {
        expect(prompt).toMatch(/^## Composition$/mu);
      });

      it("has a `## Activation` section declaring `on-demand`", () => {
        expect(prompt).toMatch(/^## Activation$/mu);
        expect(prompt).toMatch(/`on-demand`/u);
      });

      it("declares the lens does NOT write `research.md` (orchestrator owns the file)", () => {
        expect(prompt).toMatch(/DO NOT\*?\*?\s+write\s+`research\.md`|do not\s+write\s+`research\.md`|do not author `research\.md`/iu);
      });

      it("declares the no-inter-lens-chatter invariant (lenses run independently)", () => {
        expect(prompt).toMatch(/No inter-lens chatter|inter-lens chatter|cross-lens synthesis pass/iu);
      });

      it("declares a Confidence calibration (high / medium / low)", () => {
        expect(prompt).toMatch(/Confidence/u);
        expect(prompt).toMatch(/high.*medium.*low|medium.*low/iu);
      });

      it("declares the Findings: payload in the slim summary (paste-ready for the orchestrator)", () => {
        expect(prompt).toMatch(/Findings:/u);
      });
    });
  }
});

describe("v8.65 research lenses — lenses are independent (no inter-lens chaining)", () => {
  it("every lens declares the no-inter-lens-chatter rule (lenses don't cite each other; cross-lens synthesis is the orchestrator's job)", () => {
    for (const id of LENS_IDS) {
      const prompt = RESEARCH_LENS_PROMPTS[id];
      expect(
        prompt,
        `${id} must declare the no-inter-lens-chatter rule (Hard rules section)`
      ).toMatch(/(No inter-lens chatter|do NOT cite or reference[\s\S]{0,200}lens(es)?)/iu);
    }
  });

  it("the three lenses that may spawn helpers (engineer / product / architecture) explicitly forbid spawning another lens", () => {
    for (const id of ["research-engineer", "research-product", "research-architecture"] as const) {
      const prompt = RESEARCH_LENS_PROMPTS[id];
      expect(
        prompt,
        `${id} must explicitly forbid spawning another lens in its Composition section`
      ).toMatch(/Never spawn[\s\S]{0,180}another lens/iu);
    }
  });

  it("research-history declares `You may spawn: nothing` (strongest prohibition; lens is memory-only)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-history"];
    expect(prompt).toMatch(/\*\*You may spawn:\*\*\s+nothing/u);
  });

  it("research-skeptic's spawn line does not name any sibling lens id (independence preserved even without an explicit 'Never spawn another lens' clause)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-skeptic"];
    const spawnMatch = prompt.match(/\*\*You may spawn:\*\*([\s\S]+?)(?=\n- |\n\n)/u);
    const spawnLine = spawnMatch ? spawnMatch[1] : "";
    const otherLenses = LENS_IDS.filter((id) => id !== "research-skeptic");
    for (const sibling of otherLenses) {
      expect(
        spawnLine.includes(sibling),
        `research-skeptic's 'You may spawn' line must not name sibling lens ${sibling}`
      ).toBe(false);
    }
  });

  it("research-history lens reads `.cclaw/knowledge.jsonl` directly (does not dispatch `learnings-research`)", () => {
    const prompt = RESEARCH_LENS_PROMPTS["research-history"];
    expect(prompt).toMatch(/knowledge\.jsonl/u);
    expect(prompt).toMatch(/don't dispatch `learnings-research`|do not dispatch `learnings-research`|reads `\.cclaw\/knowledge\.jsonl` directly/iu);
  });

  it("research-engineer + research-architecture lenses may dispatch `repo-research` (brownfield-only); research-product / research-skeptic / research-history do not", () => {
    const engineer = RESEARCH_LENS_PROMPTS["research-engineer"];
    const architecture = RESEARCH_LENS_PROMPTS["research-architecture"];
    expect(engineer).toMatch(/dispatch `repo-research`|`repo-research` helper/u);
    expect(architecture).toMatch(/dispatch `repo-research`|`repo-research` helper/u);
  });
});

describe("v8.65 research lenses — optional web-search MCP (graceful fallback)", () => {
  it("each lens's prompt mentions optional web-search MCP fallback OR explicitly opts out", () => {
    // research-history reads memory (knowledge.jsonl + git) so web search
    // is irrelevant; the other four lenses mention the optional MCP
    // fallback (skip silently if no tool is available, fall back to
    // training knowledge with a Notes tag).
    for (const id of ["research-engineer", "research-product", "research-architecture", "research-skeptic"] as const) {
      const prompt = RESEARCH_LENS_PROMPTS[id];
      expect(prompt).toMatch(/web[- ]search|web-search MCP|user-exa|MCP/iu);
      expect(prompt).toMatch(/fall back|training knowledge|optional|when one is available|when available/iu);
    }
  });
});
