import { describe, expect, it } from "vitest";
import { RESEARCH_PLAYBOOKS } from "../../src/content/research-playbooks.js";
import { RECOVERY_PLAYBOOKS } from "../../src/content/recovery.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { DECISION_PROTOCOL } from "../../src/content/decision-protocol.js";
import { META_SKILL } from "../../src/content/meta-skill.js";

describe("research playbooks", () => {
  it("ships at least five research playbooks", () => {
    expect(RESEARCH_PLAYBOOKS.length).toBeGreaterThanOrEqual(5);
  });

  it("read-before-write playbook lists stop conditions", () => {
    const playbook = RESEARCH_PLAYBOOKS.find((entry) => entry.id === "read-before-write");
    expect(playbook?.body).toContain("Stop conditions");
  });

  it("time-boxing playbook gives concrete budgets", () => {
    const playbook = RESEARCH_PLAYBOOKS.find((entry) => entry.id === "time-boxing");
    expect(playbook?.body).toMatch(/15-30 minutes/u);
  });
});

describe("recovery playbooks", () => {
  it("covers AC break, review cap, parallel-build conflict, frontmatter corruption, schemaVersion mismatch", () => {
    const ids = RECOVERY_PLAYBOOKS.map((entry) => entry.id).sort();
    expect(ids).toEqual([
      "ac-traceability-break",
      "frontmatter-corruption",
      "parallel-build-conflict",
      "review-cap-reached",
      "schema-mismatch"
    ]);
  });

  it("each playbook describes symptoms and recovery steps", () => {
    for (const playbook of RECOVERY_PLAYBOOKS) {
      expect(playbook.body).toMatch(/Symptoms/iu);
      expect(playbook.body).toMatch(/Recovery (steps|options)/iu);
    }
  });

  it("ac-traceability-break recovery rejects deleting flow-state.json", () => {
    const playbook = RECOVERY_PLAYBOOKS.find((entry) => entry.id === "ac-traceability-break");
    expect(playbook?.body).toContain("Do not delete \`.cclaw/state/flow-state.json\`");
  });
});

describe("antipatterns", () => {
  it("contains at least 12 entries", () => {
    const matches = ANTIPATTERNS.match(/^## A-\d+/gmu) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(12);
  });

  it("references force-push and shipping-with-pending-AC anti-patterns", () => {
    expect(ANTIPATTERNS).toContain("Force-push during ship");
    expect(ANTIPATTERNS).toContain("Shipping with a pending AC");
  });
});

describe("decision protocol", () => {
  it("includes at least three worked examples", () => {
    const matches = DECISION_PROTOCOL.match(/^### D-\d+/gmu) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it("documents the seven required sections of a decision record", () => {
    for (const section of ["Title", "Context", "Considered options", "Selected", "Rationale", "Rejected because", "Consequences", "Refs"]) {
      expect(DECISION_PROTOCOL).toContain(section);
    }
  });
});

describe("meta skill", () => {
  it("declares trigger=always-on", () => {
    expect(META_SKILL).toContain("trigger: always-on");
  });

  it("references runbooks, patterns, recovery, examples, antipatterns", () => {
    for (const ref of [".cclaw/runbooks/", ".cclaw/patterns/", ".cclaw/recovery/", ".cclaw/examples/", ".cclaw/antipatterns.md"]) {
      expect(META_SKILL).toContain(ref);
    }
  });

  it("repeats the iron laws and Five Failure Modes for context", () => {
    expect(META_SKILL).toContain("Iron laws");
    expect(META_SKILL).toContain("Five failure modes");
  });
});
