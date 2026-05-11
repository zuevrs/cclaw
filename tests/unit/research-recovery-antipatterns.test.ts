import { describe, expect, it } from "vitest";
import { RESEARCH_PLAYBOOKS, RESEARCH_PLAYBOOKS_INDEX } from "../../src/content/research-playbooks.js";
import { RECOVERY_PLAYBOOKS, RECOVERY_INDEX } from "../../src/content/recovery.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { DECISION_PROTOCOL } from "../../src/content/decision-protocol.js";
import { META_SKILL } from "../../src/content/meta-skill.js";

describe("research playbooks (v8.12 — orphan content removed)", () => {
  it("ships no playbooks by default; legacy-artifacts opt-in restores the old set", () => {
    expect(RESEARCH_PLAYBOOKS).toEqual([]);
  });

  it("RESEARCH_PLAYBOOKS_INDEX explains the v8.12 cleanup", () => {
    expect(RESEARCH_PLAYBOOKS_INDEX).toMatch(/v8\.12/u);
    expect(RESEARCH_PLAYBOOKS_INDEX).toMatch(/legacy-artifacts/u);
  });
});

describe("recovery playbooks (v8.12 — orphan content removed)", () => {
  it("ships no playbooks by default; orchestrator handles recovery inline", () => {
    expect(RECOVERY_PLAYBOOKS).toEqual([]);
  });

  it("RECOVERY_INDEX explains the v8.12 cleanup", () => {
    expect(RECOVERY_INDEX).toMatch(/v8\.12/u);
    expect(RECOVERY_INDEX).toMatch(/legacy-artifacts/u);
  });
});

describe("antipatterns (v8.12 — renumbered to A-1 .. A-7)", () => {
  it("ships exactly 7 wired antipatterns", () => {
    const matches = ANTIPATTERNS.match(/^## A-\d+/gmu) ?? [];
    expect(matches.length).toBe(7);
    expect(matches).toEqual(["## A-1", "## A-2", "## A-3", "## A-4", "## A-5", "## A-6", "## A-7"]);
  });

  it("retains the canonical TDD-phase + work-outside-the-AC entries", () => {
    expect(ANTIPATTERNS).toContain("TDD phase integrity broken");
    expect(ANTIPATTERNS).toContain("Work outside the AC");
  });

  it("documents the v8.11→v8.12 renumber mapping for back-compat", () => {
    expect(ANTIPATTERNS).toMatch(/old A-2.*new A-1/u);
    expect(ANTIPATTERNS).toMatch(/old A-22.*new A-7/u);
  });
});

describe("decision protocol (v8.12 — worked-examples ref removed)", () => {
  it("is a short principles digest, not a full schema", () => {
    expect(DECISION_PROTOCOL.length).toBeLessThan(2000);
    expect(DECISION_PROTOCOL).toContain("short form");
  });

  it("delegates the full schema to design.md (architect was retired in v8.14)", () => {
    expect(DECISION_PROTOCOL).toContain("design.md");
    expect(DECISION_PROTOCOL).not.toContain("architect.md");
  });

  it("no longer references the deleted worked-examples library", () => {
    expect(DECISION_PROTOCOL).not.toContain("decision-permission-cache");
    expect(DECISION_PROTOCOL).not.toContain("Worked examples");
  });

  it("lists the seven mandatory D-N fields by name", () => {
    for (const field of ["Context", "Considered options", "Selected", "Rationale", "Rejected because", "Consequences", "Refs"]) {
      expect(DECISION_PROTOCOL).toContain(field);
    }
  });

  it("flags 'this is not a decision' patterns to suppress D-N noise", () => {
    expect(DECISION_PROTOCOL).toContain("not a decision");
  });
});

describe("meta skill", () => {
  it("declares trigger=always-on", () => {
    expect(META_SKILL).toContain("trigger: always-on");
  });

  it("references runbooks, patterns, and antipatterns (recovery/examples now opt-in)", () => {
    for (const ref of [".cclaw/lib/runbooks/", ".cclaw/lib/patterns/", ".cclaw/lib/antipatterns.md"]) {
      expect(META_SKILL).toContain(ref);
    }
  });

  it("repeats the iron laws and Five Failure Modes for context", () => {
    expect(META_SKILL).toContain("Iron laws");
    expect(META_SKILL).toContain("Five failure modes");
  });
});
