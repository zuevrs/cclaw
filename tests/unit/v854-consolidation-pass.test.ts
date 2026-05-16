import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import { STAGE_PLAYBOOKS } from "../../src/content/stage-playbooks.js";
import {
  RETIRED_LIB_DIRS,
  RETIRED_RUNBOOK_FILES
} from "../../src/install.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";

/**
 * v8.54 consolidation-pass tripwires.
 *
 * Pins every contract changed by v8.54:
 *
 *   - Runbook merges: critic-steps.md, handoff-gates.md (PLAN_PLAYBOOK
 *     absorbs discovery + plan-small-medium).
 *   - Retired-content cleanup: research-playbooks.ts / recovery.ts gone;
 *     RETIRED_LIB_DIRS adds research + recovery; RETIRED_RUNBOOK_FILES
 *     covers the 6 merged-or-lifted runbook filenames so orphan cleanup
 *     handles legacy `.cclaw/` directories.
 *   - decisions.md template install gated on `config.legacyArtifacts`.
 *   - plan-critic gate widened (drop large-risky requirement).
 *   - Test infra: tests/unit/retired-tokens.test.ts + tests/helpers/counts.ts
 *     exist and carry their expected shape.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SRC_ROOT = path.join(REPO_ROOT, "src");

describe("v8.54 — content consolidation: 4 runbook merges → 15 on-demand runbooks", () => {
  it("on-demand runbooks list is consolidated (no retired filenames)", () => {
    const fileNames = ON_DEMAND_RUNBOOKS.map((r) => r.fileName);
    for (const retired of [
      "critic-stage.md",
      "plan-critic-stage.md",
      "self-review-gate.md",
      "ship-gate.md",
      "discovery.md",
      "plan-small-medium.md"
    ]) {
      expect(
        fileNames,
        `on-demand runbook ${retired} must be retired in v8.54 (merged or lifted to PLAN_PLAYBOOK)`
      ).not.toContain(retired);
    }
  });

  it("merged runbooks are registered: critic-steps.md and handoff-gates.md", () => {
    const fileNames = ON_DEMAND_RUNBOOKS.map((r) => r.fileName);
    expect(fileNames).toContain("critic-steps.md");
    expect(fileNames).toContain("handoff-gates.md");
  });

  it("critic-steps.md carries BOTH the plan-critic and post-impl critic sections", () => {
    const rb = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "critic-steps.md")!;
    expect(rb.body).toMatch(/Pre-implementation pass.*plan-critic/i);
    expect(rb.body).toMatch(/Post-implementation pass.*critic/i);
  });

  it("handoff-gates.md carries BOTH the self-review and ship-gate sections", () => {
    const rb = ON_DEMAND_RUNBOOKS.find((r) => r.fileName === "handoff-gates.md")!;
    expect(rb.body).toMatch(/Pre-reviewer dispatch gate.*self-review/i);
    expect(rb.body).toMatch(/Pre-ship dispatch gate.*ship-gate/i);
  });

  it("PLAN_PLAYBOOK absorbed discovery + plan-small-medium (two path sections)", () => {
    const plan = STAGE_PLAYBOOKS.find((p) => p.id === "plan")!;
    expect(plan.body).toMatch(/## Path: small\/medium/);
    expect(plan.body).toMatch(/## Path: large-risky/);
  });

  it("ON_DEMAND_RUNBOOKS arity is reduced by v8.54 consolidation (4 merged pairs → -3 net + 1 lift)", () => {
    // v8.54 consolidation removed `critic-stage`, `plan-critic-stage`,
    // `self-review-gate`, `ship-gate`, `discovery`, `plan-small-medium`
    // (6 retired) and added `critic-steps`, `handoff-gates` (2 added).
    // Discovery + plan-small-medium were lifted to PLAN_PLAYBOOK. Net: -4.
    expect(ON_DEMAND_RUNBOOKS.length).toBeGreaterThanOrEqual(8);
    expect(ON_DEMAND_RUNBOOKS.length).toBeLessThanOrEqual(18);
  });
});

describe("v8.54 — retired source files: research-playbooks.ts + recovery.ts deleted", () => {
  it("src/content/research-playbooks.ts does NOT exist", () => {
    expect(existsSync(path.join(SRC_ROOT, "content", "research-playbooks.ts"))).toBe(false);
  });

  it("src/content/recovery.ts does NOT exist", () => {
    expect(existsSync(path.join(SRC_ROOT, "content", "recovery.ts"))).toBe(false);
  });
});

describe("v8.54 — install pipeline: retired dirs + retired runbooks tracked for cleanup", () => {
  it("RETIRED_LIB_DIRS includes both `research` and `recovery` (so orphan cleanup removes legacy dirs)", () => {
    expect(RETIRED_LIB_DIRS).toContain("research");
    expect(RETIRED_LIB_DIRS).toContain("recovery");
  });

  it("RETIRED_RUNBOOK_FILES covers every retired runbook filename so install upgrade cleans .cclaw/", () => {
    for (const retired of [
      "critic-stage.md",
      "plan-critic-stage.md",
      "self-review-gate.md",
      "ship-gate.md",
      "discovery.md",
      "plan-small-medium.md"
    ]) {
      expect(RETIRED_RUNBOOK_FILES).toContain(retired);
    }
  });

  it("install.ts no longer ensures lib/research or lib/recovery directories", async () => {
    const body = await fs.readFile(path.join(SRC_ROOT, "install.ts"), "utf8");
    expect(body).not.toMatch(/ensureDir\(.*lib.*research/);
    expect(body).not.toMatch(/ensureDir\(.*lib.*recovery/);
  });
});

describe("v8.54 — `decisions.md` template install is gated on `config.legacyArtifacts`", () => {
  it("install.ts writes decisions.md only when config.legacyArtifacts is true", async () => {
    const body = await fs.readFile(path.join(SRC_ROOT, "install.ts"), "utf8");
    expect(body).toMatch(/legacyArtifacts/);
    expect(body).toMatch(/decisions\.md/);
    // The decisions.md line must live inside a legacyArtifacts gate, not
    // unconditional at the top level of writeTemplates.
    expect(body).toMatch(/legacyArtifacts[\s\S]{0,400}decisions/);
  });
});

describe("v8.54 — plan-critic gate widening", () => {
  it("start-command names the widened plan-critic gate (strict + non-trivial + non-refines + AC ≥ 2)", () => {
    expect(START_COMMAND_BODY).toMatch(/plan-critic/);
    expect(START_COMMAND_BODY).toMatch(/triage\.complexity\s*!=\s*"trivial"/);
    expect(START_COMMAND_BODY).toMatch(/triage\.problemType\s*!=\s*"refines"/);
    expect(START_COMMAND_BODY).toMatch(/AC count\s*≥\s*2|≥\s*2\s*AC/);
  });

  it("start-command documents the v8.54 rationale for widening (chachamaru / gsd-v1 references)", () => {
    expect(START_COMMAND_BODY).toMatch(/v8\.54/);
    expect(START_COMMAND_BODY).toMatch(/chachamaru|gsd-v1|reference cohort|reference pattern/i);
  });

  it("plan-critic prompt body reflects the widened gate (complexity != trivial is the LIVE condition)", () => {
    expect(PLAN_CRITIC_PROMPT).toMatch(/triage\.complexity\s*!=\s*"trivial"/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/widening/i);
  });
});

describe("v8.54 — test infrastructure: retired-tokens sweep + counts helper", () => {
  it("tests/unit/retired-tokens.test.ts exists (consolidated sweep replaces ~20 duplicate assertions)", () => {
    expect(existsSync(path.join(REPO_ROOT, "tests", "unit", "retired-tokens.test.ts"))).toBe(true);
  });

  it("tests/helpers/counts.ts exists (lifts hardcoded counts behind a single COUNTS export)", () => {
    expect(existsSync(path.join(REPO_ROOT, "tests", "helpers", "counts.ts"))).toBe(true);
  });

  it("tests/unit/h4-content-depth.test.ts is deleted (v8.54 zombie sweep)", () => {
    expect(existsSync(path.join(REPO_ROOT, "tests", "unit", "h4-content-depth.test.ts"))).toBe(false);
  });
});

describe("v8.54 — CI matrix simplification (Linux + Windows × Node 20 only)", () => {
  it(".github/workflows/ci.yml no longer references macOS or Node 22.x", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(body).not.toMatch(/macos-latest/);
    expect(body).not.toMatch(/22\.x/);
  });

  it(".github/workflows/ci.yml still runs ubuntu-latest + windows-latest jobs", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(body).toMatch(/ubuntu-latest/);
    expect(body).toMatch(/windows-latest/);
  });

  it(".github/workflows/ci.yml documents the v8.54 simplification rationale", async () => {
    const body = await fs.readFile(path.join(REPO_ROOT, ".github", "workflows", "ci.yml"), "utf8");
    expect(body).toMatch(/v8\.54/);
  });
});
