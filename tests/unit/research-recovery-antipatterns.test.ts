import { describe, expect, it } from "vitest";
import { RESEARCH_PLAYBOOKS } from "../../src/content/research-playbooks.js";
import { RECOVERY_PLAYBOOKS } from "../../src/content/recovery.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { DECISION_PROTOCOL } from "../../src/content/decision-protocol.js";
import { META_SKILL } from "../../src/content/meta-skill.js";

describe("research playbooks", () => {
  it("ships exactly three research playbooks (codebase reading, time-boxing, prior slugs)", () => {
    expect(RESEARCH_PLAYBOOKS.length).toBe(3);
    const ids = RESEARCH_PLAYBOOKS.map((entry) => entry.id).sort();
    expect(ids).toEqual(["prior-slugs", "reading-codebase", "time-boxing"]);
  });

  it("reading-codebase playbook lists stop conditions", () => {
    const playbook = RESEARCH_PLAYBOOKS.find((entry) => entry.id === "reading-codebase");
    expect(playbook?.body).toContain("Stop conditions");
  });

  it("reading-codebase playbook covers test-reading and integration-boundary guidance", () => {
    const playbook = RESEARCH_PLAYBOOKS.find((entry) => entry.id === "reading-codebase");
    expect(playbook?.body).toMatch(/Reading existing tests/iu);
    expect(playbook?.body).toMatch(/integration boundaries/iu);
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
  it("is a short principles digest, not a full schema", () => {
    expect(DECISION_PROTOCOL.length).toBeLessThan(2000);
    expect(DECISION_PROTOCOL).toContain("short form");
  });

  it("delegates the full schema to architect.md and the worked examples", () => {
    expect(DECISION_PROTOCOL).toContain("architect.md");
    expect(DECISION_PROTOCOL).toContain("decision-permission-cache");
  });

  it("lists the seven mandatory D-N fields by name", () => {
    for (const field of ["Context", "Considered options", "Selected", "Rationale", "Rejected because", "Consequences", "Refs"]) {
      expect(DECISION_PROTOCOL).toContain(field);
    }
  });

  it("flags 'this is not a decision' patterns to suppress D-N noise", () => {
    expect(DECISION_PROTOCOL).toContain("not a decision");
    expect(DECISION_PROTOCOL).toContain("Use the library that is already in the project");
  });
});

describe("meta skill", () => {
  it("declares trigger=always-on", () => {
    expect(META_SKILL).toContain("trigger: always-on");
  });

  it("references runbooks, patterns, recovery, examples, antipatterns", () => {
    for (const ref of [".cclaw/lib/runbooks/", ".cclaw/lib/patterns/", ".cclaw/lib/recovery/", ".cclaw/lib/examples/", ".cclaw/lib/antipatterns.md"]) {
      expect(META_SKILL).toContain(ref);
    }
  });

  it("repeats the iron laws and Five Failure Modes for context", () => {
    expect(META_SKILL).toContain("Iron laws");
    expect(META_SKILL).toContain("Five failure modes");
  });
});
