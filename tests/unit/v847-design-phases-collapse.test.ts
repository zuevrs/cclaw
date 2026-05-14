import { describe, expect, it } from "vitest";

import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { AC_AUTHOR_PROMPT } from "../../src/content/specialist-prompts/ac-author.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";

/**
 * v8.47 — design phases UX collapse (6-10 user turns → 1-2 turns).
 *
 * The pre-v8.47 design specialist paused for user input between every
 * phase that emitted output: Phase 1 (one question per turn, up to 3),
 * Phase 2 Frame, Phase 3 Approaches pick, Phase 4 each D-N record,
 * Phase 5 Pre-mortem review, Phase 7 Sign-off. A single large-risky
 * design ran 6-10 user-facing turns before ac-author could even start.
 *
 * v8.47 keeps all 7 phases of conceptual work but pauses the user at
 * MOST twice:
 *
 * - **Phase 1 (Clarify)** — single batched structured-ask call with
 *   0-3 questions. If 0 questions needed, skip entirely. Replaces the
 *   pre-v8.47 "ask ONE question per turn" pattern.
 * - **Phase 7 (Sign-off)** — single review of the full composed design
 *   with three options: `approve` / `request-changes` / `reject`.
 *   Revise loop capped at 3 iterations; on the 4th request the design
 *   prompt escalates explicitly.
 *
 * Phases 2-6 + 6.5 execute SILENTLY in the same orchestrator turn.
 * Depth is preserved: every plan.md section (Frame, Spec, Non-functional,
 * Approaches, Selected Direction, Decisions, Pre-mortem, Not Doing,
 * Open questions, Summary — design) is still written; Pre-mortem still
 * runs on deep posture; ADR triggers still fire; prior learnings are
 * still consulted.
 *
 * Each tripwire below pins one invariant of the v8.47 contract so an
 * accidental re-introduction of per-phase user pauses lights up
 * immediately.
 */

describe("v8.47 design phases collapse — user-facing pacing contract", () => {
  it("AC-1 — design.ts declares at-most-two user pauses per design flow", () => {
    expect(
      DESIGN_PROMPT,
      "design prompt MUST declare the two-turn-at-most pacing (Phase 1 conditional + Phase 7 mandatory). v8.47 collapsed 6-10 turns to 1-2; the prompt's run-mode + opening summary teaches this contract."
    ).toMatch(/at MOST twice|two-turn-at-most|two-turn-max/i);
  });

  it("AC-1 — design.ts explicitly says Phases 2-6 are SILENT (no user pause)", () => {
    expect(
      DESIGN_PROMPT,
      "Phases 2 (Frame), 3 (Approaches), 4 (Decisions), 5 (Pre-mortem), 6 (Compose), 6.5 (ADR) must be marked SILENT or equivalent — running silently in the same orchestrator turn with no askUserQuestion."
    ).toMatch(/SILENT/);
    // Each silent-phase header should carry the marker
    for (const phaseHeader of [
      /Phase 2 — Frame .*SILENT/,
      /Phase 3 — Approaches .*SILENT/,
      /Phase 4 — Decisions .*SILENT/,
      /Phase 6 — Compose .*SILENT/
    ]) {
      expect(
        DESIGN_PROMPT,
        `design prompt's phase header must carry the SILENT marker (regex ${phaseHeader})`
      ).toMatch(phaseHeader);
    }
  });

  it("AC-1 — design.ts marks Phase 1 + Phase 7 as the only ENDS-TURN phases", () => {
    expect(DESIGN_PROMPT).toMatch(/Phase 1 — Clarify .*ENDS TURN/);
    expect(DESIGN_PROMPT).toMatch(/Phase 7 — Sign-off .*ENDS TURN/);
  });

  it("AC-1 — design.ts removes the legacy 'one phase per turn' / 'ALWAYS step' framing", () => {
    expect(
      DESIGN_PROMPT,
      "v8.47 explicitly replaced the per-phase-pause framing. The phrase 'one phase per turn' must NOT appear (Phases 2-6 run silently in one turn)."
    ).not.toMatch(/one phase per turn/i);
    expect(
      DESIGN_PROMPT,
      "v8.47 explicitly replaced 'Design is ALWAYS step' with the two-turn-max pacing. The prompt must no longer claim 'ALWAYS step' as the run-mode rule."
    ).not.toMatch(/ALWAYS step/);
  });
});

describe("v8.47 design phases collapse — Phase 1 batched ask contract", () => {
  it("AC-2 — Phase 1 instructions say to batch 0-3 questions in ONE structured-ask call", () => {
    expect(
      DESIGN_PROMPT,
      "Phase 1 must declare the batched-ask shape: 0-3 questions in a single structured-ask call, NOT one question per turn."
    ).toMatch(/batched.*structured.ask|ONE batched|single batched/i);
    expect(DESIGN_PROMPT).toMatch(/0-3 questions/i);
  });

  it("AC-2 — Phase 1 ends the orchestrator turn exactly once (no iteration)", () => {
    // Phase 1 explicitly forbids follow-up asks; the batched ask is the
    // only Phase 1 surface.
    expect(DESIGN_PROMPT).toMatch(/ends the orchestrator turn exactly once/i);
    expect(DESIGN_PROMPT).toMatch(/Do NOT iterate/i);
  });

  it("AC-2 — Phase 1 is conditional (skip entirely when 0 questions needed)", () => {
    expect(DESIGN_PROMPT).toMatch(/Skip Phase 1 entirely/);
    expect(DESIGN_PROMPT).toMatch(/0 questions needed/i);
  });

  it("AC-2 — Phase 1 still respects the 3-question cap (no more than 3 questions per batch)", () => {
    // Cap is unchanged from v8.46; we just batch the questions instead of
    // serializing them across turns.
    expect(DESIGN_PROMPT).toMatch(/at most three/i);
  });
});

describe("v8.47 design phases collapse — Phase 7 sign-off semantics", () => {
  it("AC-3 — Phase 7 emits a three-option picker: approve / request-changes / reject", () => {
    expect(DESIGN_PROMPT).toMatch(/\bapprove\b/);
    expect(DESIGN_PROMPT).toMatch(/request-changes/);
    expect(DESIGN_PROMPT).toMatch(/\breject\b/);
  });

  it("AC-3 — Phase 7 declares the revise iteration cap (3 iterations)", () => {
    expect(
      DESIGN_PROMPT,
      "Phase 7's request-changes loop is capped at 3 iterations. On the 4th request the prompt escalates explicitly. The 3-iteration cap is the v8.47 brief's explicit guard rail."
    ).toMatch(/Revise iteration cap: 3|3-iteration cap|revise.*cap.*3|cap.*3.*revise/i);
  });

  it("AC-3 — Phase 7 escalates explicitly on the 4th revise request (not silent loop)", () => {
    expect(
      DESIGN_PROMPT,
      "On the 4th revise request, design must NOT silently keep revising; it surfaces an explicit picker (approve as-is / reject / revise one more time)."
    ).toMatch(/escalate|escalation|4th revise|fourth revise/i);
  });

  it("AC-3 — Phase 7 'reject' verdict writes a Design rejected note to plan.md", () => {
    expect(DESIGN_PROMPT).toMatch(/## Design rejected/);
  });

  it("AC-3 — Phase 7 'approve' verdict advances to ac-author dispatch", () => {
    expect(DESIGN_PROMPT).toMatch(/ac-author/);
    expect(DESIGN_PROMPT).toMatch(/approve.*ac-author|ac-author.*approve/iu);
  });

  it("AC-3 — Phase 7 'request-changes' loops back internally (not a new user-facing turn per phase)", () => {
    // The revise loop re-runs the affected silent phase(s) internally and
    // re-emits Phase 7. It does NOT pause between revisions.
    expect(DESIGN_PROMPT).toMatch(/loop back|re-enter Phase|re-runs the affected/i);
    expect(DESIGN_PROMPT).toMatch(/re-emit Phase 7/i);
  });
});

describe("v8.47 design phases collapse — depth preserved (all 7 phases still exist)", () => {
  it("AC-4 — all 7 phases (Bootstrap, Clarify, Frame, Approaches, Decisions, Pre-mortem, Compose) + Phase 6.5 (ADR) + Phase 7 (Sign-off) still appear in the prompt", () => {
    for (const phaseHeader of [
      "Phase 0 — Bootstrap",
      "Phase 1 — Clarify",
      "Phase 2 — Frame",
      "Phase 3 — Approaches",
      "Phase 4 — Decisions",
      "Phase 5 — Pre-mortem",
      "Phase 6 — Compose",
      "Phase 6.5 — Propose ADR",
      "Phase 7 — Sign-off"
    ]) {
      expect(
        DESIGN_PROMPT,
        `design prompt MUST still declare ${phaseHeader} — v8.47 collapsed the user-facing PACING, not the conceptual phase structure. Removing a phase reduces depth and breaks the contract.`
      ).toContain(phaseHeader);
    }
  });

  it("AC-4 — plan.md sections list still includes every authored section (Frame / Spec / Approaches / Selected Direction / Decisions / Pre-mortem / Not Doing / Summary)", () => {
    for (const section of [
      "## Frame",
      "## Spec",
      "## Approaches",
      "## Selected Direction",
      "## Decisions",
      "## Pre-mortem",
      "## Not Doing",
      "## Summary"
    ]) {
      expect(
        DESIGN_PROMPT,
        `design must still author ${section} — Phases 2-6 are silent but they still write plan.md.`
      ).toContain(section);
    }
  });

  it("AC-4 — posture detection (guided vs deep) is preserved", () => {
    expect(DESIGN_PROMPT).toContain("guided");
    expect(DESIGN_PROMPT).toContain("deep");
    expect(DESIGN_PROMPT).toMatch(/Posture \(two values\)/);
    // Pre-mortem still runs on deep posture only
    expect(DESIGN_PROMPT).toMatch(/Pre-mortem.*deep posture/i);
  });

  it("AC-4 — Phase 6.5 ADR proposal logic still runs when triggers fire (deep + ADR trigger table)", () => {
    expect(DESIGN_PROMPT).toContain("Phase 6.5");
    expect(DESIGN_PROMPT).toMatch(/ADR-NNNN/);
    expect(DESIGN_PROMPT).toMatch(/PROPOSED/);
    expect(DESIGN_PROMPT).toMatch(/documentation-and-adrs/);
  });

  it("AC-4 — prior learnings (triage.priorLearnings) are still consulted in Phase 1 / Frame", () => {
    expect(DESIGN_PROMPT).toMatch(/triage\.priorLearnings/);
    expect(DESIGN_PROMPT).toMatch(/KnowledgeEntry|prior shipped slug/);
  });

  it("AC-4 — repo-research dispatch (parallel in Phase 0) still works", () => {
    expect(DESIGN_PROMPT).toMatch(/repo-research/);
    expect(DESIGN_PROMPT).toMatch(/parallel/i);
  });

  it("AC-4 — self-review checklist (9 rules) still gates Phase 7", () => {
    expect(DESIGN_PROMPT).toMatch(/self-review checklist/i);
    expect(DESIGN_PROMPT).toMatch(/9 rules/i);
    // The 9-rule checklist still includes the Spec gate (rule 9, v8.46)
    expect(DESIGN_PROMPT).toMatch(/## Spec/);
  });
});

describe("v8.47 design phases collapse — Iron rule warns against silent-phase pauses", () => {
  it("AC-5 — Iron rule explicitly warns against pausing between Phases 2-6", () => {
    expect(
      DESIGN_PROMPT,
      "The Iron rule must teach the new contract: if you find yourself wanting to pause mid-silent-phase, STOP. This is the v8.47 brief's required guard rail in the prompt's most prominent section."
    ).toMatch(/pause mid-flight between Phases 2 and 6|silent in v8\.47|Phases 2-6.*silent/i);
  });

  it("AC-5 — Iron rule names the structured-ask facility as the violation surface", () => {
    // The guard rail must mention the structured-ask facility — that is
    // the concrete API the agent reaches for when it wants to pause.
    expect(DESIGN_PROMPT).toMatch(/structured.ask facility|askUserQuestion/);
  });

  it("AC-5 — anti-rationalization table includes the 'pause mid-design' temptation", () => {
    expect(
      DESIGN_PROMPT,
      "The anti-rationalization table must include the 'I should pause and confirm the Frame before composing Approaches' temptation row."
    ).toMatch(/pause.*confirm the Frame|confirm.*Frame.*before|Approaches.*before/i);
  });

  it("AC-5 — anti-rationalization table includes the 'ask user mid-flight about D-2 pick' temptation", () => {
    expect(DESIGN_PROMPT).toMatch(/disagree.*D-2|D-2.*mid-flight|let me ask them mid-flight/i);
  });
});

describe("v8.47 design phases collapse — orchestrator dispatch envelope reflects new turn semantics", () => {
  it("AC-6 — start-command's large-risky plan section mentions the v8.47+ pacing (at most two pauses)", () => {
    expect(START_COMMAND_BODY).toMatch(/v8\.47/);
    expect(START_COMMAND_BODY).toMatch(/pauses at MOST twice|at most two|two-turn-max/i);
  });

  it("AC-6 — start-command's auto-mode hard-gate list mentions Phase 1 + Phase 7 (NOT 'per-phase pauses')", () => {
    // The pre-v8.47 prose said "per-phase pauses fire regardless of
    // runMode". v8.47 narrows that to Phase 1 + Phase 7 specifically.
    expect(START_COMMAND_BODY).toMatch(/Phase 1.*Phase 7|Phase 7.*Phase 1|v8\.47/iu);
  });

  it("AC-6 — plan playbook (v8.54: lifted from discovery.md) describes the v8.47 two-turn-max pacing", () => {
    const planPlaybook = STAGE_PLAYBOOKS.find((p) => p.id === "plan");
    expect(planPlaybook).toBeDefined();
    expect(planPlaybook!.body).toMatch(/v8\.47/);
    expect(planPlaybook!.body).toMatch(/Phase 1.*Phase 7|two-turn-max|at MOST twice/i);
  });

  it("AC-6 — plan playbook describes the request-changes revise loop with cap", () => {
    const planPlaybook = STAGE_PLAYBOOKS.find((p) => p.id === "plan")!;
    expect(planPlaybook.body).toMatch(/request-changes/);
    expect(planPlaybook.body).toMatch(/Revise cap = 3|3 iterations|revise.*cap.*3/i);
  });

  it("AC-6 — plan playbook describes the reject verdict path", () => {
    const planPlaybook = STAGE_PLAYBOOKS.find((p) => p.id === "plan")!;
    expect(planPlaybook.body).toMatch(/reject/);
    expect(planPlaybook.body).toMatch(/Design rejected|## Design rejected/);
  });
});

describe("v8.47 design phases collapse — ac-author untouched (runs after design Phase 7 approve)", () => {
  it("AC-7 — ac-author still names design Phase 7 as the upstream sign-off gate", () => {
    expect(AC_AUTHOR_PROMPT).toMatch(/Phase 7/);
  });

  it("AC-7 — ac-author's plan.md input list still mentions design's authored sections", () => {
    // ac-author reads design's Frame / Approaches / Selected Direction /
    // Decisions / Pre-mortem / Not Doing from plan.md. v8.47 didn't
    // change what design writes; only when it pauses.
    expect(AC_AUTHOR_PROMPT).toMatch(/Frame.*Approaches.*Selected Direction/);
    expect(AC_AUTHOR_PROMPT).toMatch(/D-N/);
  });
});
