import { describe, expect, it } from "vitest";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { DECISION_PROTOCOL } from "../../src/content/decision-protocol.js";
import { META_SKILL } from "../../src/content/meta-skill.js";
import { REFERENCE_PATTERNS } from "../../src/content/reference-patterns.js";
import { LEARNINGS_RESEARCH_PROMPT } from "../../src/content/research-prompts/learnings-research.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { createDefaultConfig } from "../../src/config.js";

function runbookBody(id: string): string {
  const r = ON_DEMAND_RUNBOOKS.find((rb) => rb.id === id);
  if (!r) throw new Error(`No on-demand runbook with id=${id}`);
  return r.body;
}

/**
 * v8.12 cleanup release locks. If a future change reintroduces the deleted
 * orphan content, drifts the renumbered antipatterns, breaks the
 * shipped-frontmatter contract, or drops the legacy-artifacts opt-in flag,
 * this suite breaks loudly.
 */
describe("v8.12 cleanup", () => {
  describe("Tier 0 — enum normalisation across orchestrator + specialists", () => {
    it("orchestrator declares the canonical Recommended next enum", () => {
      expect(START_COMMAND_BODY).toMatch(
        /Recommended next:\s*<continue \| review-pause \| fix-only \| cancel \| accept-warns-and-ship>/u
      );
    });

    it("v8.62 — `architect` is on-demand and emits a slim summary like every other specialist (no Phase 7 sign-off picker, no main-context coordinator role; mid-plan dialogue is gone)", () => {
      const architect = SPECIALIST_PROMPTS["architect"];
      // v8.62: the dead `design` specialist's main-context coordinator
      // contract is gone — architect runs as an on-demand sub-agent and
      // returns a slim summary. The Recommended next enum is therefore
      // optional (the architect's primary handoff is the plan.md artifact
      // plus the architect-flavoured slim summary), but the prompt must
      // NOT reinstate the dead "main orchestrator context" / "Phase 7"
      // language.
      expect(architect).not.toMatch(/main orchestrator context/u);
      expect(architect).not.toMatch(/Phase 7 — Sign-off/u);
      expect(architect).toMatch(/on-demand specialist/u);
    });

    it("reviewer ships the full canonical enum", () => {
      expect(SPECIALIST_PROMPTS["reviewer"]).toMatch(
        /Recommended next:\s*<continue \| review-pause \| fix-only \| cancel \| accept-warns-and-ship>/u
      );
    });
  });

  describe("Tier 0 — security_flag canonical (snake_case)", () => {
    it("learnings template frontmatter uses security_flag, not securityFlag", () => {
      const learnings = ARTIFACT_TEMPLATES.find((entry) => entry.id === "learnings");
      expect(learnings).toBeDefined();
      // Match either top-level (`security_flag: …`) or nested under signals
      // (`  security_flag: …`).
      expect(learnings!.body).toMatch(/security_flag:/);
      expect(learnings!.body).not.toMatch(/securityFlag:/);
    });

    it("templates that carry security_flag use snake_case (not camelCase)", () => {
      for (const tpl of ARTIFACT_TEMPLATES) {
        if (tpl.body.includes("security_flag") || tpl.body.toLowerCase().includes("securityflag")) {
          expect(tpl.body).not.toMatch(/securityFlag:/);
        }
      }
    });
  });

  describe("Tier 0 — pre-mortem is a section, not a separate file", () => {
    it("reviewer adversarial mode appends to review.md by default", () => {
      const reviewer = SPECIALIST_PROMPTS["reviewer"];
      expect(reviewer).toMatch(
        /adversarial pre-mortem is \*\*a section appended to `flows\/<slug>\/review\.md`\*\*/u
      );
    });

    it("reviewer Pre-mortem section template has the scenario-exercise opener (no literal future date)", () => {
      const reviewer = SPECIALIST_PROMPTS["reviewer"];
      expect(reviewer).toMatch(/## Pre-mortem \(adversarial\)/u);
      expect(reviewer).toMatch(/Scenario exercise/u);
      expect(reviewer).toMatch(/Do \*\*not\*\* write a literal future date/u);
    });
  });

  describe("Tier 0 — finalization_mode frontmatter is the source of truth", () => {
    it("ship runbook teaches updating ship.md frontmatter on mode select", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship");
      expect(ship).toBeDefined();
      expect(ship!.body).toMatch(/update the `finalization_mode` frontmatter field on `ship\.md`/u);
    });

    it("ship runbook teaches idempotent re-author on late iterations", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship");
      expect(ship!.body).toMatch(/Re-write ship\.md if late iterations land/u);
    });
  });

  describe("Tier 1-A — antipatterns renumbered to A-1..A-7", () => {
    it("ships exactly 7 antipatterns", () => {
      const matches = ANTIPATTERNS.match(/^## A-\d+/gmu) ?? [];
      expect(matches.length).toBe(7);
    });

    it("antipatterns 8+ are gone", () => {
      expect(ANTIPATTERNS).not.toMatch(/^## A-(8|9|1\d|2\d|3\d)/m);
    });

    it("documents the renumber mapping for back-compat", () => {
      expect(ANTIPATTERNS).toMatch(/old A-2.{0,30}new A-1/u);
      expect(ANTIPATTERNS).toMatch(/old A-22.{0,30}new A-7/u);
    });

    it("citations across skills/specialists reference only A-1..A-7", () => {
      const everything = [
        Object.values(SPECIALIST_PROMPTS).join("\n"),
        STAGE_PLAYBOOKS.map((p) => p.body).join("\n"),
        START_COMMAND_BODY
      ].join("\n");
      const referenced = new Set<string>();
      const re = /\bA-(\d+)\b/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(everything)) !== null) {
        referenced.add(m[1]!);
      }
      const outOfRange = [...referenced].filter((n) => Number(n) > 7);
      expect(outOfRange).toEqual([]);
    });
  });

  describe("Tier 1-B/C — orphan content libraries deleted by default", () => {
    it("reference-patterns ships only auth-flow + security-hardening", () => {
      const ids = REFERENCE_PATTERNS.map((p) => p.id).sort();
      expect(ids).toEqual(["auth-flow", "security-hardening"]);
    });

    it("decision protocol no longer cites deleted worked examples", () => {
      expect(DECISION_PROTOCOL).not.toContain("decision-permission-cache");
      expect(DECISION_PROTOCOL).not.toContain("Worked examples");
    });
  });

  describe("Tier 1-D — artefact collapse instructions present", () => {
    it("orchestrator describes ship.md as the manifest replacement (v8.22: in finalize runbook)", () => {
      const finalize = runbookBody("finalize");
      expect(finalize).toMatch(
        /manifest\.md is collapsed into `ship\.md`'s frontmatter/u
      );
      expect(START_COMMAND_BODY).toContain("finalize.md");
    });

    it("orchestrator describes pre-mortem as a review.md section (v8.54: merged into handoff-gates runbook)", () => {
      const handoffGates = runbookBody("handoff-gates");
      expect(handoffGates).toMatch(
        /adversarial reviewer's pre-mortem section is appended to `review\.md`/u
      );
      expect(START_COMMAND_BODY).toContain("handoff-gates.md");
    });

    it("learnings-research returns lessons inline by default", () => {
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(
        /Default path:.{0,200}return the \*\*structured payload below directly to the dispatcher\*\*/su
      );
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(/Do not write a separate `research-learnings\.md` file/u);
    });

    it("ship runbook teaches stamping shipped frontmatter on ship.md", () => {
      const ship = STAGE_PLAYBOOKS.find((p) => p.id === "ship");
      expect(ship!.body).toMatch(/stamps the shipped frontmatter onto `ship\.md`/u);
    });
  });

  describe("legacy-artifacts opt-in flag", () => {
    it("config default has legacyArtifacts: false", () => {
      const config = createDefaultConfig();
      expect(config.legacyArtifacts).toBe(false);
    });

    it("orchestrator no longer documents the legacy-artifacts flag verbatim (v8.62 unified-flow start-command rewrite trimmed the legacy-artifacts callout from the prose; the flag lives in config.ts + meta-skill + on-demand runbooks)", () => {
      // v8.62 — the start-command body was rewritten to remove the legacy
      // dispatch matrix (design → ac-author chain, security-reviewer
      // envelope, etc). The legacy-artifacts opt-in flag is no longer
      // documented inline in the orchestrator body; it persists in
      // `config.ts > createDefaultConfig().legacyArtifacts`, in
      // `meta-skill.md`'s opt-in catalog, and in the runbooks that
      // actually branch on the flag (artifact-templates, finalize). This
      // tripwire confirms the legacy-artifacts plumbing still ships even
      // though the start-command no longer mentions it.
      expect(START_COMMAND_BODY).not.toMatch(/legacy-?artifacts/iu);
      expect(META_SKILL).toMatch(/legacy-?artifacts/iu);
    });

    it("meta-skill documents the legacy-artifacts opt-in", () => {
      expect(META_SKILL).toMatch(/legacy-artifacts/u);
    });
  });
});
