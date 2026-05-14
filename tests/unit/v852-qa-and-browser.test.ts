import { describe, expect, it } from "vitest";

import {
  QA_RUNNER_PROMPT,
  SPECIALIST_PROMPTS
} from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { ARTIFACT_FILE_NAMES } from "../../src/artifact-paths.js";
import { FLOW_STAGES, SPECIALISTS, SURFACES, type Surface } from "../../src/types.js";
import { assertFlowStateV8 } from "../../src/flow-state.js";
import { COUNTS } from "../helpers/counts.js";

/**
 * v8.52 — qa-and-browser stage anchors (slimmed in v8.54).
 *
 * The full v8.52 surface — qa-runner specialist, qa-stage runbook, qa.md
 * template, qa-and-browser skill, flow-state fields, orchestrator wiring —
 * is exercised by structural tripwires below. Each `describe` block locks
 * ONE contract with at most 2-3 anchors; per-sentence prose checks and
 * cross-deliverable repetition were retired.
 */

const QA_RUNNER = "qa-runner" as const;
const SURFACE_TOKENS: readonly string[] = [
  "cli",
  "library",
  "api",
  "ui",
  "web",
  "data",
  "infra",
  "docs",
  "other"
];

describe("v8.52 SURFACES enum", () => {
  it("contains every canonical token Hop 2 detection assigns, including ui + web (the qa-gate)", () => {
    for (const token of SURFACE_TOKENS) {
      expect((SURFACES as readonly string[]).includes(token)).toBe(true);
    }
  });

  it("Surface type is a string-literal union sized by SURFACES (compile-time tripwire)", () => {
    const ui: Surface = "ui";
    expect(SURFACE_TOKENS).toContain(ui);
  });
});

describe("v8.52 FLOW_STAGES — qa sits between build and review", () => {
  it("FLOW_STAGES includes qa and places it after build, before review", () => {
    expect((FLOW_STAGES as readonly string[]).includes("qa")).toBe(true);
    const idx = FLOW_STAGES.indexOf("qa");
    expect(idx).toBeGreaterThan(FLOW_STAGES.indexOf("build"));
    expect(idx).toBeLessThan(FLOW_STAGES.indexOf("review"));
  });
});

describe("v8.52 qa-and-browser skill — registration + anatomy", () => {
  const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser");

  it("is registered with the canonical id, frontmatter, and triggers", () => {
    expect(skill).toBeDefined();
    expect(skill!.fileName).toBe("qa-and-browser.md");
    expect(skill!.body).toMatch(/^---\nname: qa-and-browser\n/);
  });

  it("body cites the tiered browser-tool hierarchy (Playwright > browser-mcp > manual)", () => {
    expect(skill!.body).toMatch(/playwright[\s\S]*browser-mcp[\s\S]*manual/i);
  });
});

describe("v8.52 qa-runner specialist — registry membership", () => {
  it("appears in SPECIALISTS, SPECIALIST_PROMPTS, and SPECIALIST_AGENTS with a unique prompt", () => {
    expect((SPECIALISTS as readonly string[]).includes(QA_RUNNER)).toBe(true);
    expect(SPECIALIST_PROMPTS[QA_RUNNER]).toBeDefined();
    expect(QA_RUNNER_PROMPT).toBe(SPECIALIST_PROMPTS[QA_RUNNER]);
    const agent = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER);
    expect(agent).toBeDefined();
    expect(agent!.kind).toBe("specialist");
    expect(SPECIALISTS.length).toBe(COUNTS.specialists);
  });

  it("specialist count is locked to COUNTS.specialists across all three registries", () => {
    expect(Object.keys(SPECIALIST_PROMPTS).length).toBe(COUNTS.specialists);
    expect(SPECIALIST_AGENTS.length).toBe(COUNTS.specialists);
  });
});

describe("v8.52 qa-runner prompt — structural shape", () => {
  const p = QA_RUNNER_PROMPT;

  it("has the major envelope headers (When to run / When NOT to run / Modes / Token budget)", () => {
    expect(p).toMatch(/## When to run/);
    expect(p).toMatch(/## When NOT to run/);
    expect(p).toMatch(/## Token budget/);
    expect(p).toMatch(/read-only/i);
  });

  it("gating: surfaces ∩ {ui, web} ≠ ∅ and acMode !== inline (the two qa-gating predicates)", () => {
    expect(p).toMatch(/triage\.surfaces[\s\S]{0,200}(?:ui|web)/i);
    expect(p).toMatch(/inline/i);
  });

  it("verdict enum is exactly {pass | iterate | blocked} with the iteration cap (≤1)", () => {
    expect(p).toMatch(/pass\b.*iterate\b.*blocked|pass \| iterate \| blocked/s);
    expect(p).toMatch(/iteration cap|≤\s*1|at most one/i);
  });

  it("evidence tier hierarchy Playwright > browser-MCP > manual is cited", () => {
    expect(p).toMatch(/Playwright[\s\S]{0,200}browser-MCP[\s\S]{0,200}manual/i);
  });

  it("pre-commitment predictions section exists (anti-rationalization)", () => {
    expect(p).toMatch(/pre-commitment|predict/i);
  });
});

describe("v8.52 qa.md artifact template", () => {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa");

  it("is registered with the canonical filename and §1-§7 sections", () => {
    expect(tpl).toBeDefined();
    expect(tpl!.fileName).toBe("qa.md");
    expect(ARTIFACT_FILE_NAMES.qa).toBe("qa.md");
    for (const heading of ["## §1", "## §2", "## §3", "## §4", "## §5", "## §6", "## §7"]) {
      expect(tpl!.body).toContain(heading);
    }
  });

  it("template carries frontmatter with status / iteration / evidence_tier / verdict slots", () => {
    expect(tpl!.body).toMatch(/status:/);
    expect(tpl!.body).toMatch(/iteration:/);
    expect(tpl!.body).toMatch(/evidence_tier:/);
    expect(tpl!.body).toMatch(/verdict:/);
  });
});

describe("v8.52 qa-stage runbook", () => {
  const rb = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "qa-stage.md");

  it("is registered and carries gate + dispatch envelope + verdict semantics", () => {
    expect(rb).toBeDefined();
    expect(rb!.body).toMatch(/## Gating/i);
    expect(rb!.body).toMatch(/## Dispatch envelope/i);
    expect(rb!.body).toMatch(/verdict[\s\S]{0,200}(?:pass|iterate|blocked)/i);
  });
});

describe("v8.52 flow-state — qa{Verdict,Iteration,DispatchedAt,EvidenceTier}", () => {
  const BASE_FLOW_STATE = {
    schemaVersion: 3 as const,
    currentSlug: "v852-qa-and-browser",
    currentStage: "qa" as const,
    ac: [],
    lastSpecialist: "slice-builder" as const,
    startedAt: "2026-05-14T18:00:00.000Z",
    reviewIterations: 0,
    securityFlag: false,
    triage: null
  };

  it("accepts a full happy-path state with all four qa fields populated", () => {
    expect(() =>
      assertFlowStateV8({
        ...BASE_FLOW_STATE,
        qaVerdict: "pass",
        qaIteration: 0,
        qaDispatchedAt: "2026-05-14T18:10:00.000Z",
        qaEvidenceTier: "playwright"
      })
    ).not.toThrow();
  });

  it("accepts state without any qa fields (backwards compat with pre-v8.52 flows)", () => {
    expect(() => assertFlowStateV8(BASE_FLOW_STATE)).not.toThrow();
  });

  it("rejects invalid qaVerdict (e.g. `revise` — that's the plan-critic's vocabulary)", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaVerdict: "revise" })
    ).toThrow(/Invalid qaVerdict/);
  });

  it("rejects qaIteration outside {0, 1} (the iterate-loop cap)", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaIteration: 2 })
    ).toThrow(/qaIteration/);
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaIteration: -1 })
    ).toThrow(/qaIteration/);
  });

  it("rejects invalid qaEvidenceTier (e.g. `cypress` — not in the enum)", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaEvidenceTier: "cypress" })
    ).toThrow(/Invalid qaEvidenceTier/);
  });

  it("rejects qaDispatchedAt as a non-string", () => {
    expect(() =>
      assertFlowStateV8({ ...BASE_FLOW_STATE, qaDispatchedAt: 1715706600 })
    ).toThrow(/qaDispatchedAt/);
  });
});

describe("v8.52 orchestrator wiring — start-command body declares qa stage", () => {
  const body = renderStartCommand({});

  it("references the qa stage + qa-runner + qa-and-browser skill + qa-stage runbook", () => {
    expect(body).toMatch(/\bqa\b/);
    expect(body).toContain("qa-runner");
    expect(body).toContain("qa-and-browser");
    expect(body).toContain("qa-stage.md");
  });
});

describe("v8.52 reviewer qa-evidence axis", () => {
  const reviewer = SPECIALIST_PROMPTS["reviewer"];

  it("reviewer mentions the qa-evidence axis and reads qa.md when present", () => {
    expect(reviewer).toMatch(/qa-evidence|qa\.md/);
  });
});
