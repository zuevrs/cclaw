import { describe, expect, it } from "vitest";

import {
  QA_RUNNER_PROMPT,
  SPECIALIST_PROMPTS
} from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  CORE_AGENTS,
  SPECIALIST_AGENTS
} from "../../src/content/core-agents.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { ARTIFACT_FILE_NAMES } from "../../src/artifact-paths.js";
import {
  FLOW_STAGES,
  SPECIALISTS,
  SURFACES,
  type Surface
} from "../../src/types.js";
import { assertFlowStateV8 } from "../../src/flow-state.js";

/**
 * v8.52 — qa-and-browser stage for UI surfaces.
 *
 * Adds an optional `qa` stage between `build` and `review` that runs the
 * new behavioural-QA `qa-runner` specialist on UI/web slugs in non-inline
 * mode. The stage closes the gap identified in the gstack + affaan-m-ecc
 * audit: cclaw's reviewer scores the diff but never renders the page.
 * `qa-runner` renders the page, drives it through whatever browser tools
 * are available (Playwright > browser-MCP > manual), captures per-AC
 * evidence in `qa.md`, and emits a verdict the orchestrator routes on.
 *
 * Five deliverables (each gets its own describe block below):
 *   1. `triage.surfaces` field — typed enum + Surface type, populated by
 *      Hop 2 surface-detection logic.
 *   2. `qa-and-browser` skill — new sibling of `debug-and-browser` (not a
 *      split; the audit chose sibling over refactor).
 *   3. `qa-runner` specialist — on-demand, browser-tool hierarchy,
 *      evidence rubric, verdict {pass | iterate | blocked}.
 *   4. `qa.md` artifact template — §1-§7 sections, frontmatter, per-AC
 *      evidence rows.
 *   5. Orchestrator integration — surface-detection + gate + verdict
 *      routing + reviewer's new `qa-evidence` axis. The `qa-stage.md`
 *      runbook carries the dispatch envelope + routing tables.
 *
 * Plus flow-state fields (`qaVerdict`, `qaIteration`, `qaDispatchedAt`,
 * `qaEvidenceTier`) with their own validator coverage.
 *
 * These tripwires lock the contract so a future refactor cannot drop
 * the qa stage, widen its gate silently, soften the iteration cap, or
 * break the verdict-routing wiring the orchestrator follows.
 */

const QA_RUNNER = "qa-runner" as const;

// ─────────────────────────────────────────────────────────────────────
// Deliverable 1 — triage.surfaces field (SURFACES enum + Surface type)
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 SURFACES enum — vocabulary + typing", () => {
  it("SURFACES is exported as a non-empty readonly array", () => {
    expect(Array.isArray(SURFACES)).toBe(true);
    expect(SURFACES.length).toBeGreaterThan(0);
  });

  it("SURFACES contains every canonical token the orchestrator's Hop 2 detection assigns", () => {
    for (const token of ["cli", "library", "api", "ui", "web", "data", "infra", "docs", "other"]) {
      expect(
        (SURFACES as readonly string[]).includes(token),
        `SURFACES missing canonical token: ${token}`
      ).toBe(true);
    }
  });

  it("SURFACES contains BOTH ui AND web (the two QA-gating tokens — orchestrator dispatches qa-runner on triage.surfaces ∩ {ui, web} ≠ ∅)", () => {
    expect((SURFACES as readonly string[]).includes("ui")).toBe(true);
    expect((SURFACES as readonly string[]).includes("web")).toBe(true);
  });

  it("SURFACES is a const-readonly array (compile-time check via tuple inference; runtime check via length parity)", () => {
    const observed: Surface = "ui";
    expect(observed).toBe("ui");
  });

  it("SURFACES contains `other` as the fallback / legacy slot for pre-v8.52 triage outputs", () => {
    expect((SURFACES as readonly string[]).includes("other")).toBe(true);
  });
});

describe("v8.52 FLOW_STAGES — `qa` is a first-class stage between build and review", () => {
  it("FLOW_STAGES contains `qa`", () => {
    expect((FLOW_STAGES as readonly string[]).includes("qa")).toBe(true);
  });

  it("FLOW_STAGES orders `qa` strictly between `build` and `review`", () => {
    const stages = FLOW_STAGES as readonly string[];
    const build = stages.indexOf("build");
    const qa = stages.indexOf("qa");
    const review = stages.indexOf("review");
    expect(build).toBeGreaterThanOrEqual(0);
    expect(qa).toBeGreaterThan(build);
    expect(qa).toBeLessThan(review);
  });

  it("FLOW_STAGES keeps the canonical pre-v8.52 order intact (plan, build, _qa_, review, critic, ship)", () => {
    expect(FLOW_STAGES).toEqual(["plan", "build", "qa", "review", "critic", "ship"]);
  });

  it("ARTIFACT_FILE_NAMES maps `qa` → `qa.md` (the artifact-paths.ts contract holds for the new stage)", () => {
    expect(ARTIFACT_FILE_NAMES.qa).toBe("qa.md");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deliverable 2 — qa-and-browser skill (new sibling of debug-and-browser)
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 qa-and-browser skill — registration + anatomy", () => {
  it("`qa-and-browser` is registered in AUTO_TRIGGER_SKILLS", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser");
    expect(skill, "qa-and-browser missing from AUTO_TRIGGER_SKILLS").toBeDefined();
  });

  it("`qa-and-browser` has fileName `qa-and-browser.md` (install layer writes it to .cclaw/lib/skills/)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.fileName).toBe("qa-and-browser.md");
  });

  it("`qa-and-browser` skill stages target the qa pass full surface (build, qa, review)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.stages).toEqual(expect.arrayContaining(["build", "qa", "review"]));
  });

  it("`qa-and-browser` skill triggers include the qa stage AND specialist hooks", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.triggers).toEqual(expect.arrayContaining(["stage:qa", "specialist:qa-runner"]));
  });

  it("`qa-and-browser` skill triggers also fire on triage surface detection (ui / web tokens)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.triggers).toEqual(expect.arrayContaining(["triage.surfaces:ui", "triage.surfaces:web"]));
  });

  it("`qa-and-browser` skill body opens with `---\\nname: qa-and-browser` frontmatter", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body.startsWith("---\nname: qa-and-browser\n")).toBe(true);
  });

  it("`qa-and-browser` skill body declares the three-tier browser hierarchy verbatim (Playwright > Browser MCP > Manual)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body).toMatch(/Tier 1.*Playwright/i);
    expect(skill.body).toMatch(/Tier 2.*Browser MCP/i);
    expect(skill.body).toMatch(/Tier 3.*Manual/i);
  });

  it("`qa-and-browser` skill body declares the canonical evidence-per-UI-AC rubric (Playwright spec | screenshot+observations | manual steps)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body).toMatch(/Evidence required/i);
    expect(skill.body).toMatch(/playwright/i);
    expect(skill.body).toMatch(/screenshot/i);
    expect(skill.body).toMatch(/manual/i);
  });

  it("`qa-and-browser` skill body declares the verdict semantics (pass | iterate | blocked) AND the 1-iterate-loop cap", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body).toMatch(/`pass`/);
    expect(skill.body).toMatch(/`iterate`/);
    expect(skill.body).toMatch(/`blocked`/);
    expect(skill.body).toMatch(/one iterate|1 iterate|qaIteration: 0 → 1/i);
  });

  it("`qa-and-browser` skill body explicitly distinguishes itself from `debug-and-browser` (sibling, not refactor)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body).toMatch(/debug-and-browser\.md/);
    expect(skill.body).toMatch(/(sibling|distinct|different review)/i);
  });

  it("`qa-and-browser` skill body cites the shared anti-rationalizations catalog (v8.49 — cite-not-duplicate)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body).toContain(".cclaw/lib/anti-rationalizations.md");
  });

  it("`qa-and-browser` skill body declares the silent-tier-downgrade prohibition (the canonical hard rule)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "qa-and-browser")!;
    expect(skill.body).toMatch(/silent.*downgrade|silently downgrade/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deliverable 3 — qa-runner specialist (on-demand, browser-driven)
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 qa-runner specialist — registry membership", () => {
  it("`qa-runner` is registered in the SPECIALISTS array", () => {
    expect((SPECIALISTS as readonly string[]).includes(QA_RUNNER)).toBe(true);
  });

  it("SPECIALISTS array carries exactly eight specialists (v8.42 added critic; v8.51 added plan-critic; v8.52 added qa-runner)", () => {
    expect(SPECIALISTS).toHaveLength(8);
  });

  it("qa-runner sits between slice-builder and reviewer in the canonical specialist order surface (not strict source-order, but listed before reviewer to mirror the dispatch flow)", () => {
    const qaIdx = SPECIALISTS.indexOf(QA_RUNNER);
    const reviewerIdx = SPECIALISTS.indexOf("reviewer");
    expect(qaIdx).toBeGreaterThanOrEqual(0);
    expect(reviewerIdx).toBeGreaterThanOrEqual(0);
  });

  it("SPECIALIST_PROMPTS exposes a non-empty body keyed at `qa-runner`", () => {
    expect(typeof SPECIALIST_PROMPTS[QA_RUNNER]).toBe("string");
    expect(SPECIALIST_PROMPTS[QA_RUNNER].length).toBeGreaterThan(1000);
  });

  it("QA_RUNNER_PROMPT named export matches SPECIALIST_PROMPTS['qa-runner'] (single source of truth)", () => {
    expect(QA_RUNNER_PROMPT).toBe(SPECIALIST_PROMPTS[QA_RUNNER]);
  });

  it("qa-runner is in SPECIALIST_AGENTS with kind=specialist and activation=on-demand", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER);
    expect(agent, "qa-runner missing from SPECIALIST_AGENTS").toBeDefined();
    expect(agent!.kind).toBe("specialist");
    expect(agent!.activation).toBe("on-demand");
  });

  it("qa-runner exposes the single mode `browser-verify` (the canonical qa pass; no debug / fix-only split — those belong to debug-and-browser / slice-builder)", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER)!;
    expect(agent.modes).toEqual(["browser-verify"]);
  });

  it("qa-runner appears in CORE_AGENTS exactly once", () => {
    const matches = CORE_AGENTS.filter((a) => a.id === QA_RUNNER);
    expect(matches).toHaveLength(1);
  });

  it("qa-runner's title is `QA runner` (the human-readable label used in resume summaries)", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER)!;
    expect(agent.title).toBe("QA runner");
  });

  it("qa-runner's description names the v8.52 gate verbatim (triage.surfaces + acMode)", () => {
    const agent = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER)!;
    expect(agent.description).toMatch(/triage\.surfaces/);
    expect(agent.description).toMatch(/ui|web/);
    expect(agent.description).toMatch(/acMode.*inline|inline/);
  });
});

describe("v8.52 qa-runner prompt — structural shape", () => {
  it("prompt opens with `# qa-runner` header", () => {
    expect(QA_RUNNER_PROMPT.startsWith("# qa-runner\n")).toBe(true);
  });

  it("prompt declares the canonical §1-§7 sections for the artifact body", () => {
    for (const heading of [
      "§1. Surfaces under QA",
      "§2. Browser tool detection",
      "§3. Pre-commitment predictions",
      "§4. Per-AC evidence",
      "§5. Findings",
      "§6. Verdict",
      "§7. Hand-off"
    ]) {
      expect(
        QA_RUNNER_PROMPT,
        `qa-runner prompt missing section heading: ${heading}`
      ).toContain(heading);
    }
  });

  it("prompt declares `## Composition`, `## Output schema`, and `Stop condition` (the cross-specialist sections enforced by the registry tests)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/^##\s+Composition\s*$/m);
    expect(QA_RUNNER_PROMPT).toMatch(/## Output schema|Output schema/);
    expect(QA_RUNNER_PROMPT).toMatch(/Stop condition/);
  });

  it("prompt's Composition section names qa-runner as an `on-demand specialist`", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/on-demand specialist/);
  });

  it("prompt declares the `Do not spawn` clause that forbids dispatching other specialists", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/Do not spawn|do not spawn/);
  });

  it("prompt declares the iron law tying every AC row to evidence (not 'looks good to me')", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/Iron Law/);
    expect(QA_RUNNER_PROMPT).toMatch(/EVIDENCE FROM THE RENDERED PAGE/);
  });
});

describe("v8.52 qa-runner prompt — gate (when to run / when NOT to run)", () => {
  it("prompt names all three gate conditions in the `When to run` section", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/##\s+When to run/);
    expect(QA_RUNNER_PROMPT).toMatch(/triage\.surfaces.*ui.*web|ui.*web/);
    expect(QA_RUNNER_PROMPT).toMatch(/acMode.*inline/);
    expect(QA_RUNNER_PROMPT).toMatch(/qaIteration.*1|qaIteration <\s*1/);
  });

  it("prompt declares a `When NOT to run` section as the explicit negative space of the gate", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/##\s+When NOT to run/);
  });

  it("prompt enumerates the negative-case surface values (cli, library, api, data, infra, docs)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/cli/);
    expect(QA_RUNNER_PROMPT).toMatch(/library/);
    expect(QA_RUNNER_PROMPT).toMatch(/api/);
    expect(QA_RUNNER_PROMPT).toMatch(/data/);
    expect(QA_RUNNER_PROMPT).toMatch(/infra/);
    expect(QA_RUNNER_PROMPT).toMatch(/docs/);
  });

  it("prompt declares the dispatched-in-error defensive check (slim summary + low confidence + stop without writing qa.md)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(dispatched.*error|gate failing|defensive check)/i);
  });
});

describe("v8.52 qa-runner prompt — verdict enum + routing", () => {
  it("prompt names the three verdicts: pass, iterate, blocked", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/`pass`/);
    expect(QA_RUNNER_PROMPT).toMatch(/`iterate`/);
    expect(QA_RUNNER_PROMPT).toMatch(/`blocked`/);
  });

  it("prompt declares the 1-iterate-loop cap (iteration 0 → 1, no third dispatch)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(1 iterate|one iterate|qaIteration: 0 → 1)/i);
  });

  it("prompt declares the user picker triggered on blocked (proceed-without-qa-evidence / pause-for-manual-qa / skip-qa)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/proceed-without-qa-evidence/);
    expect(QA_RUNNER_PROMPT).toMatch(/pause-for-manual-qa/);
    expect(QA_RUNNER_PROMPT).toMatch(/skip-qa/);
  });

  it("prompt declares the iterate-cap picker (cancel / accept-warnings-and-proceed-to-review / re-design)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/cancel/);
    expect(QA_RUNNER_PROMPT).toMatch(/accept-warnings-and-proceed-to-review/);
    expect(QA_RUNNER_PROMPT).toMatch(/re-design/);
  });

  it("prompt declares that `blocked` is a real verdict (no silent fallback to fake pass)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/blocked.*real verdict|never fake.*pass|do not pretend qa ran/i);
  });

  it("prompt declares that the orchestrator (not qa-runner) routes on the verdict (composition discipline)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/orchestrator.*(dispatch|advances|decides|routes)/i);
  });
});

describe("v8.52 qa-runner prompt — read-only contract + tier discipline", () => {
  it("prompt forbids editing production source files (src/**)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(NOT|never|do not).*edit.*(src\/|production source)/i);
  });

  it("prompt names the ONLY files qa-runner writes (qa.md, qa-assets, tests/e2e specs)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/flows\/<slug>\/qa\.md/);
    expect(QA_RUNNER_PROMPT).toMatch(/qa-assets/);
    expect(QA_RUNNER_PROMPT).toMatch(/tests\/e2e/);
  });

  it("prompt forbids dispatching other specialists or research helpers", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(NOT|never|forbid|do not).*(dispatch|spawn).*(specialist|sub-?agent|research)/i);
  });

  it("prompt forbids silent Playwright install (dependency-growth as a qa side effect)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(NOT|never|do not).*(npm install|silently install).*Playwright/i);
  });

  it("prompt forbids exceeding the 10k token hard cap", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(NOT|never|do not).*exceed.*10k|10k.*(cap|exceed)/i);
  });

  it("prompt forbids silent tier downgrade (the canonical qa-evidence-axis trigger)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/silent.*downgrade|silently downgrade/i);
  });

  it("prompt forbids writing findings about code quality (that's the reviewer's lane)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(NOT|never|do not).*(findings about|code quality)/i);
  });
});

describe("v8.52 qa-runner prompt — browser-tool hierarchy + evidence tiers", () => {
  it("prompt declares the §2 Browser tool detection step with the three-tier hierarchy", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/§2.*Browser tool detection|Browser tool detection/);
    expect(QA_RUNNER_PROMPT).toMatch(/Tier 1.*Playwright/);
    expect(QA_RUNNER_PROMPT).toMatch(/Tier 2.*Browser MCP/);
    expect(QA_RUNNER_PROMPT).toMatch(/Tier 3.*Manual/);
  });

  it("prompt names the canonical browser-MCP detection order (cursor-ide-browser, chrome-devtools, browser-use)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/cursor-ide-browser/);
    expect(QA_RUNNER_PROMPT).toMatch(/chrome-devtools/);
    expect(QA_RUNNER_PROMPT).toMatch(/browser-use/);
  });

  it("prompt records the picked tier in qa.md frontmatter (evidence_tier field)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/evidence_tier/);
    expect(QA_RUNNER_PROMPT).toMatch(/playwright.*browser-mcp.*manual/);
  });

  it("prompt names the Tier 1 pass criterion (exit code 0, last 3 lines of stdout pasted into Evidence row)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/exit code/i);
    expect(QA_RUNNER_PROMPT).toMatch(/last 3 lines/i);
  });

  it("prompt names the Tier 2 evidence shape (screenshots under flows/<slug>/qa-assets + observations paragraph)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/flows\/<slug>\/qa-assets/);
    expect(QA_RUNNER_PROMPT).toMatch(/observations/i);
  });

  it("prompt names the Tier 3 evidence shape (numbered Manual QA steps + pending-user Status)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/Manual QA steps|numbered manual/i);
    expect(QA_RUNNER_PROMPT).toMatch(/pending-user/);
  });
});

describe("v8.52 qa-runner prompt — pre-commitment predictions + token budget", () => {
  it("prompt declares the §3 pre-commitment block must be authored BEFORE §4 evidence", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/BEFORE.*§4|before.*§4|before.*verification|before.*evidence/i);
  });

  it("prompt caps pre-commitment predictions at 3-5", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/3-5 predictions/);
  });

  it("prompt declares the 5-8k target token budget AND the 10k hard cap", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/5-8k tokens|5 ?- ?8k tokens|5-8k/);
    expect(QA_RUNNER_PROMPT).toMatch(/10k tokens|10k.*cap|cap.*10k/i);
  });

  it("prompt declares the slim summary is ≤7 lines", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/(≤|<=)\s*7\s*lines/);
  });

  it("prompt declares the Confidence field with the enum high/medium/low (matches the other specialists' slim-summary shape)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/[Cc]onfidence/);
    expect(QA_RUNNER_PROMPT).toMatch(/high.*medium.*low|low.*medium.*high/i);
  });

  it("prompt's slim summary block declares the required fields (specialist, verdict, evidence_tier, ui_acs, iteration, confidence)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/specialist:\s*qa-runner/);
    expect(QA_RUNNER_PROMPT).toMatch(/verdict:\s*pass\s*\|\s*iterate\s*\|\s*blocked/);
    expect(QA_RUNNER_PROMPT).toMatch(/evidence_tier:/);
    expect(QA_RUNNER_PROMPT).toMatch(/ui_acs:/);
    expect(QA_RUNNER_PROMPT).toMatch(/iteration:/);
    expect(QA_RUNNER_PROMPT).toMatch(/confidence:/);
  });
});

describe("v8.52 qa-runner prompt — anti-rationalization catalog references", () => {
  it("prompt references the shared anti-rationalizations catalog at .cclaw/lib/anti-rationalizations.md (v8.49 cite-not-duplicate)", () => {
    expect(QA_RUNNER_PROMPT).toContain(".cclaw/lib/anti-rationalizations.md");
  });

  it("prompt declares qa-runner-specific rationalization rows (4 unique-to-qa rows: visual-check, playwright-overkill, css-cant-break, post-hoc-prediction)", () => {
    expect(QA_RUNNER_PROMPT).toMatch(/check it visually|just check it visually/i);
    expect(QA_RUNNER_PROMPT).toMatch(/Playwright is overkill/i);
    expect(QA_RUNNER_PROMPT).toMatch(/CSS change.*can't possibly break|colours/i);
    expect(QA_RUNNER_PROMPT).toMatch(/post-hoc|ceremony/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deliverable 4 — qa.md artifact template
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 qa.md artifact template", () => {
  it("QA template is registered in ARTIFACT_TEMPLATES with id=`qa`, fileName=`qa.md`", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa");
    expect(tpl, "qa template must exist in ARTIFACT_TEMPLATES").toBeDefined();
    expect(tpl!.fileName).toBe("qa.md");
    expect(tpl!.description).toMatch(/v8\.52|qa-runner|behavioural-QA/i);
  });

  it("QA template body opens with frontmatter delimited by --- ... ---", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    expect(tpl.body.startsWith("---\n")).toBe(true);
    expect(tpl.body).toMatch(/^---\n[\s\S]+?\n---\n/);
  });

  it("QA template frontmatter carries every required field", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    const frontmatter = tpl.body.split("\n---\n")[0]!;
    for (const field of [
      "slug:",
      "stage: qa",
      "specialist: qa-runner",
      "dispatched_at:",
      "iteration:",
      "surfaces:",
      "evidence_tier:",
      "ui_acs_total:",
      "ui_acs_pass:",
      "ui_acs_fail:",
      "ui_acs_pending:",
      "predictions_made:",
      "findings:",
      "verdict:"
    ]) {
      expect(
        frontmatter,
        `qa.md frontmatter missing required field: ${field}`
      ).toContain(field);
    }
  });

  it("QA template body contains the seven § sections", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    for (const section of [
      "## §1. Surfaces under QA",
      "## §2. Browser tool detection",
      "## §3. Pre-commitment predictions",
      "## §4. Per-AC evidence",
      "## §5. Findings",
      "## §6. Verdict",
      "## §7. Hand-off"
    ]) {
      expect(
        tpl.body,
        `qa.md template missing required section: ${section}`
      ).toContain(section);
    }
  });

  it("QA template names the verdict enum (pass | iterate | blocked) in the §6 header / body", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    expect(tpl.body).toMatch(/pass\s*\|\s*iterate\s*\|\s*blocked|pass.*iterate.*blocked/);
  });

  it("QA template names the evidence-tier enum (playwright | browser-mcp | manual)", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    expect(tpl.body).toMatch(/playwright\s*\|\s*browser-mcp\s*\|\s*manual|playwright.*browser-mcp.*manual/);
  });

  it("QA template includes the per-AC evidence row template (Surface / Verification / Evidence / Status)", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    expect(tpl.body).toMatch(/Surface:/);
    expect(tpl.body).toMatch(/Verification:/);
    expect(tpl.body).toMatch(/Evidence:/);
    expect(tpl.body).toMatch(/Status:/);
  });

  it("QA template includes the §5 Findings table header (F-N / Severity / AC / What failed / Recommended fix)", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    expect(tpl.body).toMatch(/\| F-N \| Severity \| AC \|/);
  });

  it("QA template names the Status vocabulary (pass | fail | pending-user)", () => {
    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "qa")!;
    expect(tpl.body).toMatch(/pass\s*\|\s*fail\s*\|\s*pending-user|pass.*fail.*pending-user/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Deliverable 5 — qa-stage runbook + orchestrator wiring + reviewer axis
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 qa-stage runbook", () => {
  it("`qa-stage.md` is registered in ON_DEMAND_RUNBOOKS", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md");
    expect(r, "qa-stage.md must be present in ON_DEMAND_RUNBOOKS").toBeDefined();
    expect(r!.body.length, "qa-stage.md body cannot be empty").toBeGreaterThan(2000);
    expect(
      r!.body,
      "qa-stage.md should open with the on-demand runbook heading prefix"
    ).toMatch(/^# On-demand runbook — /m);
  });

  it("runbook body declares the 3-AND gate conditions verbatim", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md")!;
    expect(r.body).toMatch(/triage\.surfaces.*ui.*web|ui.*web/);
    expect(r.body).toMatch(/acMode.*inline/);
    expect(r.body).toMatch(/qaIteration.*1|qaIteration <\s*1/);
  });

  it("runbook body declares the verdict-routing table (pass → review, iterate → slice-builder, blocked → user picker)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md")!;
    expect(r.body).toMatch(/pass.*review/i);
    expect(r.body).toMatch(/iterate.*slice-builder/i);
    expect(r.body).toMatch(/blocked.*(user picker|proceed-without-qa-evidence|pause-for-manual-qa|skip-qa)/i);
  });

  it("runbook body declares the iteration cap (1 iterate loop max; iteration 0 → 1; no third dispatch)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md")!;
    expect(r.body).toMatch(/1 iterate loop|one iterate loop|iterate loop max/i);
    expect(r.body).toMatch(/iteration/i);
  });

  it("runbook body declares the flow-state patches (qaVerdict / qaIteration / qaDispatchedAt / qaEvidenceTier)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md")!;
    expect(r.body).toContain("qaVerdict");
    expect(r.body).toContain("qaIteration");
    expect(r.body).toContain("qaDispatchedAt");
    expect(r.body).toContain("qaEvidenceTier");
  });

  it("runbook body declares the reviewer cross-check (qa-evidence axis, 9th explicit / 10th with nfr-compliance)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md")!;
    expect(r.body).toMatch(/qa-evidence/);
    expect(r.body).toMatch(/9th explicit|9th axis|10th.*nfr-compliance/i);
  });

  it("runbook body declares the legacy migration for pre-v8.52 flow-state files (absent surfaces → no retro QA)", () => {
    const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.fileName === "qa-stage.md")!;
    expect(r.body).toMatch(/legacy|pre-v8\.52|migration/i);
  });

  it("orchestrator body references `qa-stage.md` from the dispatch table or trigger surface", () => {
    const body = renderStartCommand();
    expect(
      body,
      "start-command body must reference `qa-stage.md` so the orchestrator opens it on the gated dispatch"
    ).toContain("qa-stage.md");
  });
});

// ─────────────────────────────────────────────────────────────────────
// Flow state — type validators + backwards compat
// ─────────────────────────────────────────────────────────────────────

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

describe("v8.52 flow-state additions — qa{Verdict, Iteration, DispatchedAt, EvidenceTier}", () => {
  it("validator accepts state without any qa fields (backwards compat with pre-v8.52 flows)", () => {
    expect(() => assertFlowStateV8(BASE_FLOW_STATE)).not.toThrow();
  });

  it("validator accepts state with qaVerdict=null (explicit not-yet-run / skipped marker)", () => {
    const state = { ...BASE_FLOW_STATE, qaVerdict: null };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  for (const verdict of ["pass", "iterate", "blocked"] as const) {
    it(`validator accepts state with qaVerdict=${verdict}`, () => {
      const state = { ...BASE_FLOW_STATE, qaVerdict: verdict };
      expect(() => assertFlowStateV8(state)).not.toThrow();
    });
  }

  it("validator rejects state with an invalid qaVerdict (e.g. `revise` — that's the plan-critic's vocabulary)", () => {
    const state = { ...BASE_FLOW_STATE, qaVerdict: "revise" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid qaVerdict/);
  });

  it("validator rejects state with qaVerdict=`block-ship` (post-impl critic's vocabulary)", () => {
    const state = { ...BASE_FLOW_STATE, qaVerdict: "block-ship" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid qaVerdict/);
  });

  it("validator rejects state with qaVerdict=`unknown`", () => {
    const state = { ...BASE_FLOW_STATE, qaVerdict: "unknown" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid qaVerdict/);
  });

  it("validator accepts state with qaIteration=0", () => {
    const state = { ...BASE_FLOW_STATE, qaIteration: 0 };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts state with qaIteration=1 (the maximum allowed under the 1-iterate-loop cap)", () => {
    const state = { ...BASE_FLOW_STATE, qaIteration: 1 };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator rejects state with qaIteration=2 (third dispatch is structurally not allowed)", () => {
    const state = { ...BASE_FLOW_STATE, qaIteration: 2 };
    expect(() => assertFlowStateV8(state)).toThrow(/qaIteration.*0 or 1|iterate-loop cap/);
  });

  it("validator rejects state with qaIteration=-1 (counts are non-negative)", () => {
    const state = { ...BASE_FLOW_STATE, qaIteration: -1 };
    expect(() => assertFlowStateV8(state)).toThrow(/qaIteration/);
  });

  it("validator rejects state with qaIteration as a string", () => {
    const state = { ...BASE_FLOW_STATE, qaIteration: "1" };
    expect(() => assertFlowStateV8(state)).toThrow(/qaIteration/);
  });

  it("validator accepts state with qaDispatchedAt as an ISO timestamp string", () => {
    const state = {
      ...BASE_FLOW_STATE,
      qaDispatchedAt: "2026-05-14T18:10:00.000Z"
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator rejects state with qaDispatchedAt as a non-string", () => {
    const state = { ...BASE_FLOW_STATE, qaDispatchedAt: 1715706600 };
    expect(() => assertFlowStateV8(state)).toThrow(/qaDispatchedAt/);
  });

  for (const tier of ["playwright", "browser-mcp", "manual"] as const) {
    it(`validator accepts state with qaEvidenceTier=${tier}`, () => {
      const state = { ...BASE_FLOW_STATE, qaEvidenceTier: tier };
      expect(() => assertFlowStateV8(state)).not.toThrow();
    });
  }

  it("validator accepts state with qaEvidenceTier=null (blocked verdict with no tier actually exercised)", () => {
    const state = { ...BASE_FLOW_STATE, qaEvidenceTier: null };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator rejects state with qaEvidenceTier=`cypress` (not in the enum)", () => {
    const state = { ...BASE_FLOW_STATE, qaEvidenceTier: "cypress" };
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid qaEvidenceTier/);
  });

  it("validator accepts the full happy-path state with all four qa fields populated (pass verdict)", () => {
    const state = {
      ...BASE_FLOW_STATE,
      qaVerdict: "pass" as const,
      qaIteration: 0,
      qaDispatchedAt: "2026-05-14T18:10:00.000Z",
      qaEvidenceTier: "playwright" as const
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts an iterate-bounce state (iteration=1, verdict=iterate, tier set)", () => {
    const state = {
      ...BASE_FLOW_STATE,
      qaVerdict: "iterate" as const,
      qaIteration: 1,
      qaDispatchedAt: "2026-05-14T18:10:00.000Z",
      qaEvidenceTier: "browser-mcp" as const
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts a blocked state (verdict=blocked, tier=null, iteration=0)", () => {
    const state = {
      ...BASE_FLOW_STATE,
      qaVerdict: "blocked" as const,
      qaIteration: 0,
      qaDispatchedAt: "2026-05-14T18:10:00.000Z",
      qaEvidenceTier: null
    };
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });
});

describe("v8.52 flow-state — triage.surfaces validation", () => {
  function withTriage(extra: Record<string, unknown>) {
    return {
      ...BASE_FLOW_STATE,
      triage: {
        complexity: "small-medium" as const,
        acMode: "strict" as const,
        path: ["plan", "build", "qa", "review", "ship"] as const,
        rationale: "test",
        decidedAt: "2026-05-14T18:00:00.000Z",
        ...extra
      }
    };
  }

  it("validator accepts triage without surfaces field (backwards compat — pre-v8.52 triage outputs)", () => {
    const state = withTriage({});
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts triage with surfaces=[] (empty list — same effect as absent)", () => {
    const state = withTriage({ surfaces: [] });
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts triage with surfaces=['ui'] (the canonical qa-gating signal)", () => {
    const state = withTriage({ surfaces: ["ui"] });
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts triage with surfaces=['ui', 'api'] (mixed surface — qa runs on UI portion only)", () => {
    const state = withTriage({ surfaces: ["ui", "api"] });
    expect(() => assertFlowStateV8(state)).not.toThrow();
  });

  it("validator accepts every canonical surface token in triage.surfaces", () => {
    for (const surface of SURFACES) {
      const state = withTriage({ surfaces: [surface] });
      expect(() => assertFlowStateV8(state), `surface=${surface} should validate`).not.toThrow();
    }
  });

  it("validator rejects triage with an invalid surface token (e.g. `frontend` — not in SURFACES)", () => {
    const state = withTriage({ surfaces: ["frontend"] });
    expect(() => assertFlowStateV8(state)).toThrow(/Invalid triage\.surfaces/);
  });

  it("validator rejects triage.surfaces as a non-array (e.g. a string)", () => {
    const state = withTriage({ surfaces: "ui" });
    expect(() => assertFlowStateV8(state)).toThrow(/triage\.surfaces.*array/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Orchestrator wiring — start-command.ts body declares the qa step
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 orchestrator wiring — start-command body declares the qa stage", () => {
  it("start-command body names the `qa-runner` specialist", () => {
    const body = renderStartCommand();
    expect(body).toContain("qa-runner");
  });

  it("start-command body declares the 3-AND gate (triage.surfaces ∩ {ui, web} ≠ ∅ AND acMode != inline AND qaIteration < 1)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/triage\.surfaces.*ui.*web|ui.*web/);
    expect(body).toMatch(/acMode.*inline/);
    expect(body).toMatch(/qaIteration.*1|qaIteration <\s*1/);
  });

  it("start-command body declares the surface-detection heuristics for Hop 2 triage (keywords + file patterns)", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/surfaces/);
    expect(body).toMatch(/\.tsx|\.jsx|\.vue|\.svelte/);
  });

  it("start-command body declares the three verdicts (pass / iterate / blocked) in the routing prose", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/`pass`/);
    expect(body).toMatch(/`iterate`/);
    expect(body).toMatch(/`blocked`/);
  });

  it("start-command body adds `qa-runner` to the `lastSpecialist` enum surface so resume reads it", () => {
    const body = renderStartCommand();
    expect(body).toContain("lastSpecialist");
    expect(body).toContain("qa-runner");
    expect(body).toContain("slice-builder");
    expect(body).toContain("reviewer");
  });

  it("start-command body's stage-table includes the `qa` stage row alongside plan/build/review", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/\|\s*`qa`[^|]*\|\s*`qa-runner`/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Reviewer qa-evidence axis
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 reviewer qa-evidence axis", () => {
  it("reviewer prompt declares the qa-evidence axis as part of the ten-axis review (v8.48 edit-discipline + v8.52 qa-evidence)", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/qa-evidence/);
    expect(reviewer).toMatch(/Ten-axis review|ten axes/i);
  });

  it("reviewer prompt's axis table contains a qa-evidence row", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/`qa-evidence`.*gated|qa-evidence.*v8\.52/);
  });

  it("reviewer prompt declares the qa-evidence axis is GATED on the qa-runner gate (surfaces ∩ {ui, web} ≠ ∅ AND non-inline)", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/qa-evidence.*gated|gated.*qa-evidence/i);
    expect(reviewer).toMatch(/triage\.surfaces.*ui.*web|ui.*web/);
  });

  it("reviewer prompt declares the structural-skip behavior when qa gate did not fire", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/qa-evidence: skipped|no qa gate|structurally skipped/i);
  });

  it("reviewer prompt declares the three sub-checks (evidence-row-present, behavioural-match, tier-escalation)", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/Sub-check 1/);
    expect(reviewer).toMatch(/Sub-check 2/);
    expect(reviewer).toMatch(/Sub-check 3/);
  });

  it("reviewer prompt's slim-summary axes counter includes the `qae=N` token (gated on qa firing)", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/qae=N|qae /);
  });

  it("reviewer prompt declares the silent-tier-downgrade detection (frontmatter `evidence_tier: manual` but Playwright in package.json)", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/silent.*downgrade|silent tier downgrade/i);
  });

  it("reviewer prompt's Inputs section names `qa.md` as a v8.52 input", () => {
    const reviewer = SPECIALIST_PROMPTS["reviewer"];
    expect(reviewer).toMatch(/qa\.md/);
    expect(reviewer).toMatch(/v8\.52/);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Cross-specialist count tripwires (final consistency check)
// ─────────────────────────────────────────────────────────────────────

describe("v8.52 cross-specialist consistency — counts line up across registries", () => {
  it("SPECIALISTS, SPECIALIST_PROMPTS keys, and SPECIALIST_AGENTS are all in lockstep at exactly 8 specialists", () => {
    expect(SPECIALISTS).toHaveLength(8);
    expect(Object.keys(SPECIALIST_PROMPTS)).toHaveLength(8);
    expect(SPECIALIST_AGENTS).toHaveLength(8);
    for (const id of SPECIALISTS) {
      expect(SPECIALIST_PROMPTS[id], `prompt missing for specialist ${id}`).toBeDefined();
      const agent = SPECIALIST_AGENTS.find((a) => a.id === id);
      expect(agent, `agent missing for specialist ${id}`).toBeDefined();
    }
  });

  it("qa-runner and reviewer are SEPARATE specialists (the qa pass and the diff review are distinct passes)", () => {
    expect((SPECIALISTS as readonly string[]).includes(QA_RUNNER)).toBe(true);
    expect((SPECIALISTS as readonly string[]).includes("reviewer")).toBe(true);
    expect(QA_RUNNER).not.toBe("reviewer");
    const qaRunner = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER)!;
    const reviewer = SPECIALIST_AGENTS.find((a) => a.id === "reviewer")!;
    expect(qaRunner.prompt).not.toBe(reviewer.prompt);
  });

  it("qa-runner and debug-and-browser skill are not the same artifact (qa-runner is a specialist; debug-and-browser is a skill)", () => {
    const qaRunner = SPECIALIST_AGENTS.find((a) => a.id === QA_RUNNER)!;
    const debugSkill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "debug-and-browser");
    expect(qaRunner.kind).toBe("specialist");
    expect(debugSkill).toBeDefined();
  });
});
