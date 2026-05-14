import { describe, expect, it } from "vitest";
import path from "node:path";
import { writeFileSafe } from "../../src/fs-utils.js";
import { findMatchingPlans } from "../../src/orchestrator-routing.js";
import { activeArtifactPath } from "../../src/artifact-paths.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { renderCancelCommand } from "../../src/content/cancel-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { DESIGN_PROMPT } from "../../src/content/specialist-prompts/design.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

const startBody = renderStartCommand();
const cancelBody = renderCancelCommand();

const skillBody = (id: string): string => {
  const found = AUTO_TRIGGER_SKILLS.find((skill) => skill.id === id);
  if (!found) throw new Error(`skill ${id} not found`);
  return found.body;
};

describe("v8.11+v8.14+v8.47 — discovery phases run inside design; v8.47 two-turn-max pacing", () => {
  it("start-command says design's Phase 1 + Phase 7 pauses fire regardless of runMode (v8.47 collapse)", () => {
    // v8.11 + v8.14 originally required "Discovery never auto-chains"
    // + "regardless of triage.runMode" because design paused at every
    // internal phase (Phase 1-7). v8.47 narrowed that contract: design
    // pauses at MOST twice (Phase 1 conditional + Phase 7 mandatory),
    // and those two pauses still fire regardless of runMode. The
    // start-command body must teach both halves of the new invariant.
    expect(startBody).toMatch(/v8\.47\+ pacing/);
    expect(startBody).toMatch(/at MOST twice/);
    expect(startBody).toMatch(/regardless of\s+\\?`?runMode\\?`?|fire regardless of runMode/i);
  });

  it("v8.14 + v8.47: design runs in main context with two-turn-max pacing (Phase 1 conditional + Phase 7 mandatory)", () => {
    // v8.14: the brainstormer -> architect -> ac-author three-step chain
    // collapsed to design (main context, multi-turn) -> ac-author. v8.47
    // tightened the user-facing pacing from 6-10 turns down to at most
    // two: Phase 1 (Clarify, conditional batched ask) and Phase 7
    // (Sign-off, mandatory). Phases 2-6 + 6.5 are silent. The
    // orchestrator does not auto-chain across design's Phase 7
    // sign-off even when runMode=auto (next /cc continues with
    // ac-author).
    expect(DESIGN_PROMPT).toMatch(/at MOST twice|two-turn-at-most|two-turn-max/i);
    expect(DESIGN_PROMPT).toMatch(/SILENT/);
    expect(startBody).toMatch(/next\s+\\?`?\/cc\\?`?\s+(?:invocation\s+)?(?:dispatches|continues with)\s+ac-author/i);
  });

  it("auto-mode rules carve out the discovery-internal pauses", () => {
    // v8.14: the carve-out language refers to design (a single specialist
    // that internally pauses between its own phases) rather than the old
    // brainstormer/architect pair.
    expect(startBody).toMatch(/discovery|design phase/i);
  });
});

describe("v8.11 — pause options drop Cancel; /cc-cancel is explicit only (#3)", () => {
  it("flow-resume picker no longer offers [c] Cancel", () => {
    const flowResume = skillBody("flow-resume");
    expect(flowResume).not.toMatch(/\[c\]\s+Cancel/);
    expect(flowResume).toMatch(/Cancel\\?`?\s+is\s+\*\*not\*\*\s+an option/i);
  });

  it("pre-flight assumptions no longer offers Cancel — re-think", () => {
    const preFlight = skillBody("pre-flight-assumptions");
    expect(preFlight).not.toMatch(/Cancel — re-think the request/);
    expect(preFlight).not.toMatch(/\[4\]\s+Cancel/);
    // v8.21 folded the pre-flight ask into design Phase 0 / ac-author
    // Phase 0; the skill body is now a thin reference doc and no
    // longer carries any Cancel-option discussion (the original
    // assertion "Cancel is not an option" was specific to the legacy
    // Hop 2.5 ask, which no longer exists). The v8.21 fold notice
    // points readers at the new surfaces.
    expect(preFlight).toMatch(/v8\.21 fold|reference doc/iu);
  });

  it("interpretation forks no longer force a Cancel — re-think option", () => {
    const preFlight = skillBody("pre-flight-assumptions");
    expect(preFlight).not.toMatch(/always include "Cancel — re-think" as a valid choice/);
    // v8.21 fold: interpretation forks now surface inside design
    // Phase 1 (Clarify) on large-risky or inline in ac-author Phase 0
    // on small-medium. The skill body documents the fold; no Cancel
    // option discussion remains because there is no separate ask.
    expect(preFlight).toMatch(/design Phase 1|ac-author Phase 0|interpretation-forks/iu);
  });

  it("start-command always-ask rules call out that /cc-cancel is never a clickable option", () => {
    expect(startBody).toMatch(/\\?`?\/cc-cancel\\?`?\s+is\s+never\s+a\s+clickable\s+option/i);
  });

  it("cancel-command marks /cc-cancel as the explicit nuke command (recovery prose only)", () => {
    expect(cancelBody).toMatch(/Stop the current flow without finishing it/);
    expect(cancelBody).toMatch(/never deletes artifacts/);
  });
});

describe("v8.11 — step mode = end-of-turn; /cc is the only resume verb (#4)", () => {
  it("start-command's seven-hop summary describes Pause as end-of-turn / chain", () => {
    expect(startBody).toMatch(/\\?`?\/cc\\?`?\s+is the single resume verb/i);
  });

  it("step-mode block tells the agent to end the turn, not to wait for a magic word", () => {
    expect(startBody).toMatch(/End your turn/);
    expect(startBody).toMatch(/single resume mechanism/i);
    expect(startBody).not.toMatch(/I type "continue" to advance/);
    expect(startBody).not.toMatch(/The user types\s+\\?`?continue\\?`?,/);
  });

  it("triage-gate Question 2 no longer instructs the user to type the word continue", () => {
    const triage = skillBody("triage-gate");
    expect(triage).not.toMatch(/I type "continue" to advance/);
    expect(triage).toMatch(/next\s+\\?`?\/cc\\?`?\s+advances/i);
  });

  it("flow-resume describes /cc as the canonical resume command", () => {
    const flowResume = skillBody("flow-resume");
    expect(flowResume).toMatch(/canonical resume command/i);
    expect(flowResume).not.toMatch(/canonical "continue" command/);
  });
});

describe("v8.11 — slug naming format YYYYMMDD-<semantic-kebab> (#5)", () => {
  it("start-command's Triage hop spells out the mandatory date-prefix slug format", () => {
    expect(startBody).toMatch(/Slug naming \(mandatory format\)/);
    expect(startBody).toMatch(/\\?`?YYYYMMDD-<semantic-kebab>\\?`?/);
    expect(startBody).toMatch(/date prefix is\s+\*\*mandatory\*\*/i);
  });

  it("start-command names the same-day collision fallback (-2, -3, ...)", () => {
    expect(startBody).toMatch(/append\s+\\?`?-2\\?`?,\s*\\?`?-3\\?`?/);
  });

  it("orchestrator-routing finds shipped plans whose slug carries a YYYYMMDD- prefix", async () => {
    const project = await createTempProject();
    try {
      const shippedPlan = path.join(
        project,
        ".cclaw",
        "flows",
        "shipped",
        "20260510-billing-rewrite",
        "plan.md"
      );
      await writeFileSafe(
        shippedPlan,
        "---\nslug: 20260510-billing-rewrite\nstage: shipped\nstatus: shipped\nac: []\n---\n\n# billing rewrite\n\nMigrate billing rewrite to the new ledger module across services.\n"
      );
      const matches = await findMatchingPlans(project, "Refine billing rewrite ledger");
      const shippedMatch = matches.find((entry) => entry.origin === "shipped");
      expect(shippedMatch?.slug).toBe("20260510-billing-rewrite");
    } finally {
      await removeProject(project);
    }
  });

  it("orchestrator-routing excludes the date prefix tokens from slug-token matching", async () => {
    const project = await createTempProject();
    try {
      const taskTitledByDate = "20260510 task";
      await writeFileSafe(
        activeArtifactPath(project, "plan", "20260510-approval-page"),
        "---\nslug: 20260510-approval-page\nstage: plan\nstatus: active\nac: []\n---\n\n# approval page\n"
      );
      const matches = await findMatchingPlans(project, taskTitledByDate);
      expect(matches).toEqual([]);
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.11 — option labels + slim-summary prose in user's language (#2)", () => {
  it("conversation-language lists option labels and slim-summary text fields explicitly", () => {
    const lang = skillBody("conversation-language");
    expect(lang).toMatch(/Option labels in structured asks/);
    expect(lang).toMatch(/Slim-summary text fields/);
    expect(lang).toMatch(/checkpoint_question/);
  });

  it("conversation-language uses placeholder schema (no anchored language) in worked examples", () => {
    const lang = skillBody("conversation-language");
    expect(lang).toMatch(/Worked schema — language-neutral/);
    expect(lang).toMatch(/<one sentence in the user's language stating the question>/);
    expect(lang).toMatch(/<option label in the user's language conveying intent A>/);
    expect(lang).not.toMatch(/Запустить fix-only — slice-builder/);
    expect(lang).not.toMatch(/Идём с архитектором подтвердить vitest/);
  });

  it("conversation-language warns against copying example strings verbatim", () => {
    const lang = skillBody("conversation-language");
    expect(lang).toMatch(/Copying example strings verbatim/);
  });

  it("start-command TRIAGE_ASK_EXAMPLE uses intent-descriptor placeholders, not literal option strings", () => {
    expect(startBody).toMatch(/<option label conveying: proceed with the recommended path>/);
    expect(startBody).toMatch(/<option label conveying: switch to trivial/);
    expect(startBody).toMatch(/<option label conveying: escalate to large-risky/);
    expect(startBody).not.toMatch(/"Proceed as recommended"/);
    expect(startBody).not.toMatch(/"Switch to trivial \(inline edit \+ commit/);
  });

  it("flow-resume picker uses intent-descriptor placeholders for resume / show / new", () => {
    const flowResume = skillBody("flow-resume");
    expect(flowResume).toMatch(/<option text conveying: resume — dispatch the next specialist/);
    expect(flowResume).toMatch(/<option text conveying: show — open the artifact/);
    expect(flowResume).toMatch(/<option text conveying: new — shelve this flow/);
  });

  it("design prompt tells the specialist to render user-facing prose in the user's conversation language", () => {
    // v8.14: design owns the discovery dialog entirely. checkpoint_question
    // is gone; the equivalent is the picker labels emitted by askUserQuestion
    // in each phase, plus the Frame / Approach / D-N prose itself.
    expect(DESIGN_PROMPT).toMatch(/conversation-language\.md/);
    expect(DESIGN_PROMPT).toMatch(/user's conversation language/i);
    expect(DESIGN_PROMPT).toMatch(/Mechanical tokens.{0,200}stay English/i);
  });
});
