import { describe, expect, it } from "vitest";

import { CRITIC_PROMPT, SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { CORE_AGENTS, SPECIALIST_AGENTS } from "../../src/content/core-agents.js";
import { SPECIALISTS } from "../../src/types.js";

/**
 * v8.42 — adversarial critic specialist (Hop 4.5).
 *
 * The critic is an on-demand specialist that runs between the reviewer's
 * final `clear` (or `warn` with the architecture-severity gate satisfied)
 * and the ship gate. It walks what is MISSING (gap analysis +
 * pre-commitment predictions + goal-backward verification + AC self-audit
 * + realist check), and in `adversarial` mode also runs the four-technique
 * scaffold (assumption violation, composition failures, cascade
 * construction, abuse cases).
 *
 * These tripwires lock the contract so a future refactor cannot
 * accidentally drop the critic, weaken its acMode gating, soften its
 * token-budget caps, or break the artifact-template shape that the
 * orchestrator and downstream consumers (ship.md > Risks carried over,
 * learnings.md compound capture) rely on.
 *
 * Spec: `.cclaw/flows/v842-critic-design/design.md` (1090 lines).
 */

describe("v8.42 critic specialist — registry membership", () => {
  it("critic is registered in the SPECIALISTS array", () => {
    expect((SPECIALISTS as readonly string[]).includes("critic")).toBe(true);
  });

  it("SPECIALISTS array carries exactly eight specialists (v8.42 added critic; v8.51 added plan-critic; v8.52 added qa-runner)", () => {
    expect(SPECIALISTS).toHaveLength(8);
  });

  it("critic sits between security-reviewer and slice-builder in the canonical specialist order", () => {
    const criticIdx = SPECIALISTS.indexOf("critic");
    const securityIdx = SPECIALISTS.indexOf("security-reviewer");
    const sliceIdx = SPECIALISTS.indexOf("slice-builder");
    expect(criticIdx).toBeGreaterThan(securityIdx);
    expect(criticIdx).toBeLessThan(sliceIdx);
  });

  it("SPECIALIST_PROMPTS exposes a non-empty body keyed at `critic`", () => {
    expect(typeof SPECIALIST_PROMPTS.critic).toBe("string");
    expect(SPECIALIST_PROMPTS.critic.length).toBeGreaterThan(1000);
  });

  it("CRITIC_PROMPT named export matches SPECIALIST_PROMPTS.critic (single source of truth)", () => {
    expect(CRITIC_PROMPT).toBe(SPECIALIST_PROMPTS.critic);
  });
});

describe("v8.42 critic specialist — agent registration (on-demand)", () => {
  it("critic is in SPECIALIST_AGENTS with kind=specialist and activation=on-demand", () => {
    const critic = SPECIALIST_AGENTS.find((agent) => agent.id === "critic");
    expect(critic, "critic missing from SPECIALIST_AGENTS").toBeDefined();
    expect(critic!.kind).toBe("specialist");
    expect(critic!.activation).toBe("on-demand");
  });

  it("critic exposes exactly two modes: gap and adversarial", () => {
    const critic = SPECIALIST_AGENTS.find((agent) => agent.id === "critic")!;
    expect(critic.modes).toEqual(["gap", "adversarial"]);
  });

  it("critic appears in CORE_AGENTS exactly once", () => {
    const critics = CORE_AGENTS.filter((agent) => agent.id === "critic");
    expect(critics).toHaveLength(1);
  });

  it("critic's title is `Critic` (the human-readable label used in resume summaries)", () => {
    const critic = SPECIALIST_AGENTS.find((agent) => agent.id === "critic")!;
    expect(critic.title).toBe("Critic");
  });
});

describe("v8.42 critic prompt — investigation protocol sections", () => {
  it("prompt is bounded between 200 and 700 LOC (spec target 450-600)", () => {
    const lineCount = CRITIC_PROMPT.split("\n").length;
    expect(
      lineCount,
      `critic.ts body is ${lineCount} lines (target 450-600, hard ceiling 700). Verbose critic prompts are a red flag — lift detail to runbooks if you need more space.`
    ).toBeGreaterThanOrEqual(200);
    expect(lineCount).toBeLessThanOrEqual(700);
  });

  it("prompt declares all six investigation protocol sections from spec §3", () => {
    expect(CRITIC_PROMPT, "§1 pre-commitment predictions").toMatch(/§1.*Pre-?commitment predictions/i);
    expect(CRITIC_PROMPT, "§2 gap analysis").toMatch(/§2.*Gap analysis/i);
    expect(CRITIC_PROMPT, "§3 adversarial findings").toMatch(/§3.*Adversarial findings/i);
    expect(CRITIC_PROMPT, "§4 AC self-audit").toMatch(/§4.*Self-?audit on AC quality/i);
    expect(CRITIC_PROMPT, "§5 goal-backward verification").toMatch(/§5.*Goal-?backward verification/i);
    expect(CRITIC_PROMPT, "§6 realist check").toMatch(/§6.*Realist check/i);
  });

  it("prompt declares both §7 (verdict) and §8 (slim summary block)", () => {
    expect(CRITIC_PROMPT).toMatch(/§7.*Verdict/i);
    expect(CRITIC_PROMPT).toMatch(/§8.*Summary/i);
  });

  it("prompt names the verdict enum (pass | iterate | block-ship)", () => {
    expect(CRITIC_PROMPT).toMatch(/\bpass\b/);
    expect(CRITIC_PROMPT).toMatch(/\biterate\b/);
    expect(CRITIC_PROMPT).toMatch(/\bblock-ship\b/);
  });
});

describe("v8.42 critic prompt — posture awareness", () => {
  it("prompt enumerates the canonical v8.36 postures (test-first, characterization-first, tests-as-deliverable, refactor-only, docs-only, bootstrap)", () => {
    // The canonical posture list lives in `src/types.ts > POSTURES`. The
    // critic must cite every value because the per-posture critic
    // behaviour (focus / token budget / escalation eligibility) ladders
    // off that enum.
    for (const posture of [
      "test-first",
      "characterization-first",
      "tests-as-deliverable",
      "refactor-only",
      "docs-only",
      "bootstrap"
    ]) {
      expect(
        CRITIC_PROMPT,
        `posture ${posture} missing from critic prompt's posture-awareness section`
      ).toContain(posture);
    }
  });

  it("prompt names the per-AC posture source (`plan.md frontmatter`)", () => {
    expect(CRITIC_PROMPT).toMatch(/plan\.md.*frontmatter|frontmatter.*plan\.md/i);
  });
});

describe("v8.42 critic prompt — acMode gating (spec Q1)", () => {
  it("prompt names all three acMode values explicitly: inline, soft, strict", () => {
    expect(CRITIC_PROMPT).toMatch(/`inline`/);
    expect(CRITIC_PROMPT).toMatch(/`soft`/);
    expect(CRITIC_PROMPT).toMatch(/`strict`/);
  });

  it("prompt states that critic SKIPS on acMode: inline", () => {
    expect(
      CRITIC_PROMPT,
      "Q1: critic must skip on acMode: inline (no flag exposed)"
    ).toMatch(/inline[^a-z]*(skip|no|n\/a)/i);
  });

  it("prompt states that critic runs gap mode on acMode: soft", () => {
    expect(CRITIC_PROMPT).toMatch(/`soft`[\s\S]{0,200}`gap`/);
  });

  it("prompt states that critic runs gap-or-adversarial on acMode: strict", () => {
    expect(CRITIC_PROMPT).toMatch(/`strict`[\s\S]{0,300}(`gap`|`adversarial`)/);
  });
});

describe("v8.42 critic prompt — escalation triggers (spec §8)", () => {
  it("prompt names all five §8 escalation triggers", () => {
    expect(CRITIC_PROMPT, "trigger 1: architectural-tier change").toMatch(/architectural[ -]tier/i);
    expect(CRITIC_PROMPT, "trigger 2: test-first + zero failing tests in build.md").toMatch(
      /test-first[\s\S]{0,200}(zero failing|zero RED|no.*RED)/i
    );
    // Trigger 3 (large surface size) — fires on >10 files OR a large line
    // count delta. The prompt uses `>10 files` / `>300 lines` (the design
    // spec mentioned ≥500 LOC; the implementation tightened the
    // line-count thresholds to >300 inserted OR >300 deleted to catch
    // refactors split across many files where each file is small).
    expect(CRITIC_PROMPT, "trigger 3: large surface size (>10 files OR large line delta)").toMatch(
      />\s*10 files|>\s*(300|500)\s*(inserted|deleted|lines)/i
    );
    expect(CRITIC_PROMPT, "trigger 4: security_flag OR security-reviewer ran").toMatch(
      /security_flag|security-reviewer/i
    );
    expect(CRITIC_PROMPT, "trigger 5: reviewIterations >= 4").toMatch(
      /reviewIterations\s*(>=|≥)\s*4/
    );
  });

  it("Q5 — escalation trigger #2 stays narrow (test-first + zero failing tests; design exclusion of 'missing RED excerpt' is documented in-line)", () => {
    // Q5 sanctioned the narrow trigger ("test-first + zero failing tests
    // in build.md") and explicitly ruled out widening to "missing RED
    // excerpt". The prompt body anchors that decision by:
    // (a) phrasing trigger #2 narrowly with "test-first" + zero/no-RED
    //     OR exit-0 (passing) — i.e. the fake-RED case;
    // (b) calling out the "do NOT widen to 'missing RED excerpt'"
    //     guidance in line, so a future tightener cannot accidentally
    //     re-introduce the wider trigger.
    expect(CRITIC_PROMPT).toMatch(/test-first/i);
    expect(
      CRITIC_PROMPT,
      "trigger 2 narrow phrasing: test-first + zero failing/RED + exit-0 (passing) fake-RED branch"
    ).toMatch(/(zero failing|zero RED|zero entries)[\s\S]{0,200}exit-?0/i);
    expect(
      CRITIC_PROMPT,
      "Q5 anchor: prompt explicitly cites 'do NOT widen to \"missing RED excerpt\"' so a future tightener cannot re-introduce the wider trigger"
    ).toMatch(/do NOT widen to .missing RED excerpt/i);
  });
});

describe("v8.42 critic prompt — token budgets (spec §2)", () => {
  it("prompt cites the gap-mode token target (5-7k for soft, 10-15k for strict)", () => {
    expect(CRITIC_PROMPT).toMatch(/5-7k|5 ?- ?7k/);
    expect(CRITIC_PROMPT).toMatch(/10-15k|10 ?- ?15k/);
  });

  it("prompt cites the adversarial-mode token target (12-18k)", () => {
    expect(CRITIC_PROMPT).toMatch(/12-18k|12 ?- ?18k/);
  });

  it("prompt cites the 20k hard cap and says exceeding it is itself a finding", () => {
    expect(CRITIC_PROMPT).toMatch(/20k/);
    expect(CRITIC_PROMPT).toMatch(/hard cap|hard 20k|cap.*20k/i);
  });
});

describe("v8.42 critic prompt — read-only contract", () => {
  it("prompt forbids editing source / test / plan / build / review files", () => {
    expect(CRITIC_PROMPT).toMatch(/(NOT|never|forbid).*edit.*(src\/|tests\/|plan\.md|build\.md|review\.md)/i);
  });

  it("prompt forbids exceeding the 20k token cap", () => {
    expect(CRITIC_PROMPT).toMatch(/(NOT|never).*exceed.*20k|20k.*(NOT|never).*exceed/i);
  });

  it("prompt forbids dispatching other specialists (composition is the orchestrator's job)", () => {
    expect(CRITIC_PROMPT).toMatch(/(NOT|never|forbid).*(dispatch|spawn).*(specialist|sub-?agent)/i);
  });

  it("prompt names the ONLY file the critic writes (`flows/<slug>/critic.md`)", () => {
    expect(CRITIC_PROMPT).toMatch(/flows\/<slug>\/critic\.md/);
  });
});

describe("v8.42 critic prompt — Q2: single-shot artifact, NOT append-only", () => {
  it("prompt states that re-dispatch overwrites critic.md (not append)", () => {
    expect(
      CRITIC_PROMPT,
      "Q2: critic.md is single-shot per dispatch; re-dispatch overwrites. NOT an append-only ledger."
    ).toMatch(/overwrit|overwrite|single-?shot/i);
  });

  it("prompt's re-dispatch trigger is the block-ship picker's `fix and re-review` option", () => {
    expect(CRITIC_PROMPT).toMatch(/fix and re-?review/i);
  });
});

describe("v8.42 critic prompt — slim summary contract", () => {
  it("prompt declares a slim summary block bounded at ≤7 lines (consistent with the orchestrator's six-field shape)", () => {
    expect(CRITIC_PROMPT).toMatch(/slim summary|Slim summary/);
    expect(CRITIC_PROMPT).toMatch(/(≤|<=)\s*[567]\s*lines/);
  });

  it("prompt declares the Confidence field with the enum high/medium/low (matching other specialists)", () => {
    expect(CRITIC_PROMPT).toMatch(/Confidence/);
    expect(CRITIC_PROMPT).toMatch(/high.*medium.*low|low.*medium.*high/i);
  });
});

describe("v8.42 critic.md artifact template — registered with required frontmatter fields", () => {
  it("CRITIC template is registered in ARTIFACT_TEMPLATES with id=`critic`, fileName=`critic.md`", () => {
    const critic = ARTIFACT_TEMPLATES.find((tpl) => tpl.id === "critic");
    expect(critic, "critic template must exist in ARTIFACT_TEMPLATES").toBeDefined();
    expect(critic!.fileName).toBe("critic.md");
    expect(critic!.description).toMatch(/v8\.42|Hop 4\.5|falsificationist/i);
  });

  it("CRITIC template body opens with frontmatter delimited by --- ... ---", () => {
    const critic = ARTIFACT_TEMPLATES.find((tpl) => tpl.id === "critic")!;
    expect(critic.body.startsWith("---\n")).toBe(true);
    // Match the second --- as the closing frontmatter delimiter.
    expect(critic.body).toMatch(/^---\n[\s\S]+?\n---\n/);
  });

  it("CRITIC template frontmatter carries every required field from spec §3", () => {
    const critic = ARTIFACT_TEMPLATES.find((tpl) => tpl.id === "critic")!;
    const frontmatter = critic.body.split("\n---\n")[0]!;
    for (const field of [
      "slug:",
      "stage:",
      "generated_at:",
      "posture_inherited:",
      "ac_mode:",
      "mode:",
      "predictions_made:",
      "gaps_found:",
      "escalation_level:",
      "verdict:"
    ]) {
      expect(
        frontmatter,
        `critic.md frontmatter missing required field: ${field}`
      ).toContain(field);
    }
  });

  it("CRITIC template body contains the five investigation sections + verdict + summary", () => {
    const critic = ARTIFACT_TEMPLATES.find((tpl) => tpl.id === "critic")!;
    for (const section of [
      "## 1. Pre-commitment predictions",
      "## 2. Gap analysis",
      "## 3. Adversarial findings",
      "## 4. Self-audit on AC quality",
      "## 5. Goal-backward verification",
      "## 6. Realist check",
      "## 7. Verdict",
      "## 8. Summary"
    ]) {
      expect(
        critic.body,
        `critic.md template missing required section: ${section}`
      ).toContain(section);
    }
  });

  it("CRITIC template names the severity vocabulary (block-ship / iterate / fyi)", () => {
    const critic = ARTIFACT_TEMPLATES.find((tpl) => tpl.id === "critic")!;
    expect(critic.body).toContain("block-ship");
    expect(critic.body).toContain("iterate");
    expect(critic.body).toContain("fyi");
  });
});
