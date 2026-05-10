import { describe, expect, it } from "vitest";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { DECISION_PROTOCOL } from "../../src/content/decision-protocol.js";
import { EXAMPLES } from "../../src/content/examples.js";
import { META_SKILL } from "../../src/content/meta-skill.js";
import { RECOVERY_PLAYBOOKS } from "../../src/content/recovery.js";
import { REFERENCE_PATTERNS } from "../../src/content/reference-patterns.js";
import { RESEARCH_PLAYBOOKS } from "../../src/content/research-playbooks.js";
import { LEARNINGS_RESEARCH_PROMPT } from "../../src/content/research-prompts/learnings-research.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { createDefaultConfig } from "../../src/config.js";

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

    it("brainstormer ships the discovery-subset enum (continue | cancel)", () => {
      expect(SPECIALIST_PROMPTS["brainstormer"]).toMatch(
        /Recommended next:\s*<continue \| cancel>/u
      );
    });

    it("architect ships the discovery-subset enum (continue | cancel)", () => {
      expect(SPECIALIST_PROMPTS["architect"]).toMatch(
        /Recommended next:\s*<continue \| cancel>/u
      );
    });

    it("reviewer ships the full canonical enum", () => {
      expect(SPECIALIST_PROMPTS["reviewer"]).toMatch(
        /Recommended next:\s*<continue \| review-pause \| fix-only \| cancel \| accept-warns-and-ship>/u
      );
    });

    it("security-reviewer ships the no-warn-accept subset (continue | fix-only | cancel)", () => {
      expect(SPECIALIST_PROMPTS["security-reviewer"]).toMatch(
        /Recommended next:\s*<continue \| fix-only \| cancel>/u
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

    it("recovery playbooks empty by default", () => {
      expect(RECOVERY_PLAYBOOKS).toEqual([]);
    });

    it("research playbooks empty by default", () => {
      expect(RESEARCH_PLAYBOOKS).toEqual([]);
    });

    it("worked examples empty by default", () => {
      expect(EXAMPLES).toEqual([]);
    });

    it("decision protocol no longer cites deleted worked examples", () => {
      expect(DECISION_PROTOCOL).not.toContain("decision-permission-cache");
      expect(DECISION_PROTOCOL).not.toContain("Worked examples");
    });
  });

  describe("Tier 1-D — artefact collapse instructions present", () => {
    it("orchestrator describes ship.md as the manifest replacement", () => {
      expect(START_COMMAND_BODY).toMatch(
        /manifest\.md is collapsed into `ship\.md`'s frontmatter/u
      );
    });

    it("orchestrator describes pre-mortem as a review.md section", () => {
      expect(START_COMMAND_BODY).toMatch(
        /adversarial reviewer's pre-mortem section is appended to `review\.md`/u
      );
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

    it("orchestrator documents the flag for users who want the old layout", () => {
      expect(START_COMMAND_BODY).toMatch(/legacy-artifacts: true/u);
    });

    it("meta-skill explains that recovery / research / examples are empty by default", () => {
      expect(META_SKILL).toMatch(/empty.{0,40}v8\.12/u);
      expect(META_SKILL).toMatch(/legacy-artifacts/u);
    });
  });
});
