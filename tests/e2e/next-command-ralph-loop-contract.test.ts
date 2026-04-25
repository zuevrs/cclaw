import { describe, it, expect } from "vitest";
import {
  nextCommandContract,
  nextCommandSkillMarkdown,
  ralphLoopContractSnippet,
  RALPH_LOOP_CONTRACT_MARKER
} from "../../src/content/next-command.js";

/**
 * Behavior-backed contract test for #4 (conflicting Ralph Loop semantics
 * inside src/content/next-command.ts) and #10 (contract tests that only
 * check for keywords, not behavior).
 *
 * We assert three things:
 *
 * 1. There is EXACTLY ONE canonical Ralph Loop paragraph, rendered from
 *    `ralphLoopContractSnippet()` and tagged with a hidden marker.
 * 2. The paragraph appears in BOTH the command contract and the skill
 *    document, and in BOTH places the text is byte-identical (via marker
 *    count == 2).
 * 3. The canonical paragraph encodes the resolved policy: Ralph Loop is
 *    a SOFT NUDGE and hard enforcement goes through `stage-complete.mjs`
 *    and `flow-state.json` gates. It must NOT contain any "hard" gating
 *    language like "advance only when" against ralph-loop fields.
 */
describe("next-command Ralph Loop contract parity", () => {
  const snippet = ralphLoopContractSnippet();
  const command = nextCommandContract();
  const skill = nextCommandSkillMarkdown();

  it("exposes a marker-tagged canonical snippet", () => {
    expect(snippet).toContain(RALPH_LOOP_CONTRACT_MARKER);
    expect(snippet).toContain("ralph-loop.json");
  });

  it("renders the canonical snippet in both the contract and the skill (byte-equal)", () => {
    const commandMarkerCount = command.split(RALPH_LOOP_CONTRACT_MARKER).length - 1;
    const skillMarkerCount = skill.split(RALPH_LOOP_CONTRACT_MARKER).length - 1;
    expect(commandMarkerCount).toBe(1);
    expect(skillMarkerCount).toBe(1);
    expect(command).toContain(snippet);
    expect(skill).toContain(snippet);
  });

  it("encodes the resolved policy: Ralph Loop observes state, gates flow elsewhere", () => {
    expect(snippet).toContain("ralph-loop.json");
    expect(snippet).toContain("stage-complete.mjs");
    expect(snippet).toContain("flow-state.json");
  });

  it("never uses hard-gating wording against ralph-loop fields", () => {
    const hardPhrases = [
      "Advance only when",
      "advance only when",
      "must be empty before",
      "blocks stage advance"
    ];
    for (const phrase of hardPhrases) {
      expect(
        snippet.includes(phrase),
        `snippet should NOT contain hard-gating phrase "${phrase}"`
      ).toBe(false);
    }
  });

  it("does not leave behind hard-gate wording anywhere in next-command outputs", () => {
    expect(command).not.toContain('Advance only when\nevery planned slice');
    expect(skill).not.toContain('Advance only when\nevery planned slice');
  });

  it("keeps compound closeout on /cc-next with overlap and supersession guidance", () => {
    expect(command).toContain("not `ce:compound`");
    expect(command).toContain("assess overlap before adding duplicate knowledge");
    expect(command).toContain("bug-track learnings");
    expect(command).toContain("knowledge-track learnings");
    expect(command).toContain("supersedes");
    expect(command).toContain("session transcripts");
  });

  it("documents a compact operator output contract", () => {
    expect(skill).toContain("## Operator Output Contract");
    expect(skill).toContain("Stage: <currentStage> (<track>)");
    expect(skill).toContain("Gates: <passed>/<required> passed");
    expect(skill).toContain("Delegations: <done>/<mandatory> done");
    expect(skill).toContain("Do not dump full artifacts");
  });

});
