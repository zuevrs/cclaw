import { describe, expect, it } from "vitest";
import path from "node:path";
import { afterEach } from "vitest";
import { writeFileSafe } from "../../src/fs-utils.js";
import { findMatchingPlans } from "../../src/orchestrator-routing.js";
import { activeArtifactPath } from "../../src/artifact-paths.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { renderCancelCommand } from "../../src/content/cancel-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { BRAINSTORMER_PROMPT } from "../../src/content/specialist-prompts/brainstormer.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

const startBody = renderStartCommand();
const cancelBody = renderCancelCommand();

const skillBody = (id: string): string => {
  const found = AUTO_TRIGGER_SKILLS.find((skill) => skill.id === id);
  if (!found) throw new Error(`skill ${id} not found`);
  return found.body;
};

describe("v8.11 — discovery always pauses regardless of runMode (#1)", () => {
  it("start-command says discovery sub-phase pauses regardless of runMode", () => {
    expect(startBody).toMatch(/discovery never auto-chains/i);
    expect(startBody).toMatch(/regardless of\s+\\?`?triage\.runMode\\?`?/i);
  });

  it("each large-risky discovery step explicitly ends the turn", () => {
    expect(startBody).toMatch(/renders the slim summary and ends the turn/i);
    expect(startBody).toMatch(/next\s+\\?`?\/cc\\?`?\s+invocation continues with architect/i);
    expect(startBody).toMatch(/next\s+\\?`?\/cc\\?`?\s+continues with planner/i);
  });

  it("auto-mode rules carve out the discovery-internal pauses", () => {
    expect(startBody).toMatch(/UNLESS the dispatch you just received was the brainstormer or architect inside the discovery sub-phase/i);
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
    expect(preFlight).toMatch(/Cancel\\?`?\s+is not an option/i);
  });

  it("interpretation forks no longer force a Cancel — re-think option", () => {
    const preFlight = skillBody("pre-flight-assumptions");
    expect(preFlight).not.toMatch(/always include "Cancel — re-think" as a valid choice/);
    expect(preFlight).toMatch(/Cancel\\?`?\s+is\s+\*\*not\*\*\s+offered/i);
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

  it("brainstormer prompt explicitly tells the specialist to render checkpoint_question in user's language", () => {
    expect(BRAINSTORMER_PROMPT).toMatch(/checkpoint_question.{0,80}prose the user will read/i);
    expect(BRAINSTORMER_PROMPT).toMatch(/render it in the user's conversation language/i);
  });

  it("architect prompt explicitly tells the specialist to render checkpoint_question + slim-summary prose in user's language", () => {
    expect(ARCHITECT_PROMPT).toMatch(/checkpoint_question.{0,200}user's conversation language/i);
    expect(ARCHITECT_PROMPT).toMatch(/conversation-language\.md/);
  });
});
