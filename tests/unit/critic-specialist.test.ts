import { describe, expect, it } from "vitest";

import { CRITIC_PROMPT, SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { SPECIALISTS } from "../../src/types.js";

/**
 * v8.42 — adversarial critic specialist. Slimmed in v8.99 test-slim-down
 * A2 from 37 tests to 5 (cross-model gate, force-stance opening,
 * adversarial mode, anti-rationalization, wiring/template).
 */

const FORCE_STANCE_CLAUSE =
  "Adversarial stance: Assume the artifact under review is flawed until evidence proves otherwise. Your starting hypothesis: this work will not deliver the stated goal. Look for disqualifying evidence first, then balance with what works.";

describe("v8.42 critic wiring + artifact template", () => {
  it("WIRING — critic is registered in SPECIALISTS at the tail, SPECIALIST_PROMPTS.critic === CRITIC_PROMPT, SPECIALIST_AGENTS entry is on-demand specialist with modes ['gap','adversarial'], and the critic.md artifact template carries the canonical frontmatter + 8-section body + severity vocabulary", () => {
    expect((SPECIALISTS as readonly string[]).includes("critic")).toBe(true);
    expect(SPECIALISTS.indexOf("critic")).toBe(SPECIALISTS.length - 1);
    expect(CRITIC_PROMPT).toBe(SPECIALIST_PROMPTS.critic);
    expect(CRITIC_PROMPT.length).toBeGreaterThan(1000);

    const critic = SPECIALIST_AGENTS.find((a) => a.id === "critic");
    expect(critic).toBeDefined();
    expect(critic!.kind).toBe("specialist");
    expect(critic!.activation).toBe("on-demand");
    expect(critic!.modes).toEqual(["gap", "adversarial"]);
    expect(critic!.title).toBe("Critic");

    const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === "critic")!;
    expect(tpl).toBeDefined();
    expect(tpl.fileName).toBe("critic.md");
    expect(tpl.body.startsWith("---\n")).toBe(true);
    const frontmatter = tpl.body.split("\n---\n")[0]!;
    for (const field of [
      "slug:",
      "stage:",
      "generated_at:",
      "posture_inherited:",
      "ceremony_mode:",
      "mode:",
      "predictions_made:",
      "gaps_found:",
      "escalation_level:",
      "verdict:"
    ]) {
      expect(frontmatter).toContain(field);
    }
    for (const section of [
      "## 1. Pre-commitment predictions",
      "## 2. Gap analysis",
      "## 3. Adversarial findings",
      "## 4. Criterion check",
      "## 5. Goal-backward verification",
      "## 6. Realist check",
      "## 7. Verdict",
      "## 8. Summary"
    ]) {
      expect(tpl.body).toContain(section);
    }
    for (const sev of ["block-ship", "iterate", "fyi"]) {
      expect(tpl.body).toContain(sev);
    }
  });
});

describe("v8.42 critic — force-stance opening (adversarial posture forcing clause)", () => {
  it("BEHAVIOR — critic prompt opens with the verbatim adversarial-stance clause, BEFORE the `You are the cclaw critic` framing (v8.74 flipped the default cognitive posture from balanced-review to find-disqualifying-evidence-first)", () => {
    expect(CRITIC_PROMPT).toContain(FORCE_STANCE_CLAUSE);
    const stanceIdx = CRITIC_PROMPT.indexOf(FORCE_STANCE_CLAUSE);
    const framingIdx = CRITIC_PROMPT.indexOf("You are the cclaw");
    expect(stanceIdx).toBeGreaterThan(0);
    expect(framingIdx).toBeGreaterThan(0);
    expect(stanceIdx).toBeLessThan(framingIdx);
  });
});

describe("v8.42 critic — cross-model second-opinion gate (v8.74 promoted to Reversibility:one-way)", () => {
  it("BEHAVIOR — critic prompt declares the crossModelCritic envelope flag with v8.74 Reversibility:one-way primary trigger + keyword fallback, names the --critic-cross-model user override, declares the mandatory `Cross-model unavailable: skipped.` graceful fallback line, and rolls cross-model findings under X-F-N numbering into §7 verdict", () => {
    expect(CRITIC_PROMPT).toMatch(/crossModelCritic/);
    expect(CRITIC_PROMPT).toMatch(/Reversibility:\s*one-way/);
    expect(CRITIC_PROMPT).toMatch(/keyword fallback/i);
    expect(CRITIC_PROMPT).toMatch(/--critic-cross-model/);
    expect(CRITIC_PROMPT).toMatch(/Cross-model unavailable: skipped/);
    expect(CRITIC_PROMPT).toMatch(/X-F-N/);
    expect(CRITIC_PROMPT).toMatch(/## Cross-model second opinion/);
  });
});

describe("v8.42 critic — adversarial mode + ceremonyMode gating", () => {
  it("BEHAVIOR — critic prompt declares the 6-section investigation protocol (§1-§6 + §7 verdict + §8 summary), names the verdict enum (pass|iterate|block-ship), enumerates ceremonyMode gating (inline skips, soft → gap, strict → gap|adversarial), and cites the §8 escalation triggers (architectural-tier change / test-first+zero-RED / large-surface / security_flag / reviewIterations≥4)", () => {
    expect(CRITIC_PROMPT).toMatch(/§1.*Pre-?commitment predictions/i);
    expect(CRITIC_PROMPT).toMatch(/§2.*Gap analysis/i);
    expect(CRITIC_PROMPT).toMatch(/§3.*Adversarial findings/i);
    expect(CRITIC_PROMPT).toMatch(/§4.*Criterion check/i);
    expect(CRITIC_PROMPT).toMatch(/§5.*Goal-?backward verification/i);
    expect(CRITIC_PROMPT).toMatch(/§6.*Realist check/i);
    expect(CRITIC_PROMPT).toMatch(/§7.*Verdict/i);
    expect(CRITIC_PROMPT).toMatch(/§8.*Summary/i);
    for (const verdict of ["pass", "iterate", "block-ship"]) {
      expect(CRITIC_PROMPT).toMatch(new RegExp(`\\b${verdict}\\b`));
    }

    // ceremonyMode gating
    expect(CRITIC_PROMPT).toMatch(/`inline`/);
    expect(CRITIC_PROMPT).toMatch(/`soft`/);
    expect(CRITIC_PROMPT).toMatch(/`strict`/);
    expect(CRITIC_PROMPT).toMatch(/inline[^a-z]*(skip|no|n\/a)/i);
    expect(CRITIC_PROMPT).toMatch(/`soft`[\s\S]{0,200}`gap`/);
    expect(CRITIC_PROMPT).toMatch(/`strict`[\s\S]{0,300}(`gap`|`adversarial`)/);

    // escalation triggers
    expect(CRITIC_PROMPT).toMatch(/architectural[ -]tier/i);
    expect(CRITIC_PROMPT).toMatch(/test-first[\s\S]{0,200}(zero failing|zero RED|no.*RED)/i);
    expect(CRITIC_PROMPT).toMatch(/security_flag|security axis|security-axis/i);
    expect(CRITIC_PROMPT).toMatch(/reviewIterations\s*(>=|≥)\s*4/);
  });
});

describe("v8.42 critic — anti-rationalization + read-only contract", () => {
  it("BEHAVIOR — critic prompt cites the shared anti-rationalizations catalog (.cclaw/lib/anti-rationalizations.md) for cross-cutting rationalizations, enforces the read-only contract (no edits to src/tests/plan/build/review, no dispatching other specialists, writes only flows/<slug>/critic.md, no exceeding 20k cap), and declares the slim summary block + Confidence enum", () => {
    expect(CRITIC_PROMPT).toMatch(/\.cclaw\/lib\/anti-rationalizations\.md/);
    expect(CRITIC_PROMPT).toMatch(/Cross-cutting rationalizations/);

    // read-only contract
    expect(CRITIC_PROMPT).toMatch(/(NOT|never|forbid).*edit.*(src\/|tests\/|plan\.md|build\.md|review\.md)/i);
    expect(CRITIC_PROMPT).toMatch(/(NOT|never).*exceed.*20k|20k.*(NOT|never).*exceed/i);
    expect(CRITIC_PROMPT).toMatch(/(NOT|never|forbid).*(dispatch|spawn).*(specialist|sub-?agent)/i);
    expect(CRITIC_PROMPT).toMatch(/flows\/<slug>\/critic\.md/);

    // slim summary + Confidence
    expect(CRITIC_PROMPT).toMatch(/slim summary|Slim summary/);
    expect(CRITIC_PROMPT).toMatch(/Confidence/);
    expect(CRITIC_PROMPT).toMatch(/high.*medium.*low|low.*medium.*high/i);
  });
});
