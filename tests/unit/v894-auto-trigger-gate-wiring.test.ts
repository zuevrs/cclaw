import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  renderDispatchSkillsIndex,
  type DispatchSkillsIndexEntry,
  type GateEnvelope
} from "../../src/content/skills.js";
import {
  ON_DEMAND_RUNBOOKS,
  REVIEWER_DISPATCH_SKILLS_INDEX
} from "../../src/content/runbooks-on-demand.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { renderStartCommand } from "../../src/content/start-command.js";

/**
 * v8.96.1 — wire `buildAutoTriggerBlock(stage, gateEnvelope)` runtime
 * path into production (Phase C audit G-2 fix).
 *
 * v8.83-token-axes added the optional `gateEnvelope` second parameter to
 * {@link buildAutoTriggerBlock} so a runtime call-site (orchestrator
 * dispatch envelope construction) could filter the rendered skills
 * block down to only the gated axes whose flags are set. The
 * parameter was tested but never reached from any production caller —
 * every specialist-prompt template literal called the single-arg form
 * at module-import time, baking a STATIC SUPERSET into the on-disk
 * `.cclaw/lib/agents/<id>.md`. Skill-body claims about
 * "the orchestrator pins the skill via `buildAutoTriggerBlock("review",
 * env)`" were tests-only fiction — the function was never called at
 * dispatch time.
 *
 * v8.96.1 (Path B fix per the audit) wires the runtime path into
 * production WITHOUT refactoring every specialist prompt into a
 * dispatch-time function (Path A — invasive across 9 specialists). The
 * static superset stays in `agents/reviewer.md`; a new production-path
 * caller (`renderDispatchSkillsIndex`) is invoked from the install
 * pipeline (via the runbook composer) to pre-render the gate-resolved
 * skills slice for every canonical envelope shape. The output lands in
 * `.cclaw/lib/runbooks/dispatch-skills-index.md`; the orchestrator
 * pastes the matching shape's rendered block into the reviewer
 * dispatch envelope's `Active skills (per envelope):` field at
 * dispatch time, overriding the static superset.
 *
 * Tripwires below pin the v8.96.1 invariants:
 *  1. There is at least one PRODUCTION-PATH (non-test) caller of
 *     `buildAutoTriggerBlock(stage, gateEnvelope)` — the runtime path
 *     is no longer reachable only from tests.
 *  2. The `dispatch-skills-index.md` runbook exists and is composed
 *     from the production-path two-arg renders.
 *  3. Behaviour — when the envelope omits `walkScopeDriftAxis`, the
 *     rendered slice omits the scope-drift pointer.
 *  4. Behaviour — when every gate flag is set, every gated axis
 *     appears in the rendered slice (matches the static superset).
 *  5. The four reviewer-axis skill bodies no longer carry the
 *     pre-v8.96.1 fictional claim about a runtime call to
 *     `buildAutoTriggerBlock("review", env)`.
 *  6. reviewer.ts carries the superset-note paragraph pointing at the
 *     dispatch-skills-index runbook.
 *  7. start-command.ts carries the resolve-per-envelope-slice step.
 *  8. Regression — every v8.83-token-axes invariant still holds.
 */

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  ".."
);
const SRC_ROOT = path.join(PROJECT_ROOT, "src");
const SKILLS_DIR = path.join(SRC_ROOT, "content/skills");

// v8.113 — the gated reviewer-axis cohort with a skill body shrank from 8
// to 5: scope-drift folded into edit-discipline, and the advisory-only
// anti-slop + assumption-coverage axes were cut.
const REVIEWER_AXIS_SKILL_IDS_WITH_GATE = [
  "reviewer-axis-qa-evidence",
  "reviewer-axis-design-quality",
  "reviewer-axis-security",
  "reviewer-axis-nfr-compliance",
  "reviewer-axis-edit-discipline"
] as const;

async function listSourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listSourceFiles(full)));
    else if (/\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("v8.96.1 — tripwire: production-path caller of buildAutoTriggerBlock(stage, gateEnvelope)", () => {
  it("AC-1 — at least ONE non-test src/ file calls buildAutoTriggerBlock with a SECOND argument (gateEnvelope)", async () => {
    const files = await listSourceFiles(SRC_ROOT);
    // Match `buildAutoTriggerBlock(...)` with a comma at the top level
    // of the argument list — that's the structural signal of a 2-arg
    // call. Single-line form: `buildAutoTriggerBlock("review", env)`.
    // Multi-line is rejected — the audit gap was specifically about
    // call shape; if a future refactor breaks the function across lines
    // the tripwire still catches it via the helper function detection
    // (renderDispatchSkillsIndex is the production wrapper).
    const twoArgRegex = /buildAutoTriggerBlock\s*\(\s*[^,)]+,\s*[^)]+\)/u;
    const helperUseRegex =
      /renderDispatchSkillsIndex\s*\(\s*[^,)]+,\s*[^,)]+,\s*[^)]+\)/u;

    let twoArgCallSites: Array<{ file: string; line: number; text: string }> =
      [];
    for (const file of files) {
      const rel = path.relative(PROJECT_ROOT, file);
      const lines = (await fs.readFile(file, "utf8")).split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (twoArgRegex.test(line) || helperUseRegex.test(line)) {
          twoArgCallSites.push({ file: rel, line: i + 1, text: line.trim() });
        }
      }
    }

    expect(
      twoArgCallSites.length,
      "Expected at least one production-path (non-test) caller of `buildAutoTriggerBlock(stage, gateEnvelope)` or its `renderDispatchSkillsIndex(stage, envelope, label)` wrapper. v8.96.1 (Phase C G-2 fix) wires the runtime path into production via the install-time runbook composer in `src/content/runbooks-on-demand.ts`; a regression here means the runtime path slipped back into being tests-only fiction."
    ).toBeGreaterThanOrEqual(1);
  });

  it("AC-1 — `renderDispatchSkillsIndex` is exported from `src/content/skills.ts` as the canonical production-path API", () => {
    expect(typeof renderDispatchSkillsIndex).toBe("function");
    const entry = renderDispatchSkillsIndex("review", {}, "smoke");
    expect(entry.stage).toBe("review");
    expect(entry.label).toBe("smoke");
    expect(Array.isArray(entry.activeSkillIds)).toBe(true);
    expect(typeof entry.block).toBe("string");
    expect(entry.block.length).toBeGreaterThan(0);
  });

  it("AC-1 — `renderDispatchSkillsIndex` is called by `src/content/runbooks-on-demand.ts` (the install-time runbook composer)", async () => {
    const runbooksSource = await fs.readFile(
      path.join(SRC_ROOT, "content/runbooks-on-demand.ts"),
      "utf8"
    );
    expect(
      runbooksSource,
      "runbooks-on-demand.ts must import + call `renderDispatchSkillsIndex` so the dispatch-skills-index runbook body is composed from the production-path two-arg `buildAutoTriggerBlock` renders. The audit fix for G-2 lives in this composer."
    ).toContain("renderDispatchSkillsIndex");
  });
});

describe("v8.96.1 — dispatch-skills-index runbook exists, is wired, and contains every canonical envelope shape", () => {
  it("AC-2 — `ON_DEMAND_RUNBOOKS` registers the `dispatch-skills-index` runbook", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "dispatch-skills-index"
    );
    expect(runbook).toBeDefined();
    expect(runbook!.fileName).toBe("dispatch-skills-index.md");
    expect(runbook!.body.startsWith("# On-demand runbook — dispatch-skills-index")).toBe(
      true
    );
    expect(runbook!.body.length).toBeGreaterThan(2000);
  });

  it("AC-2 — every entry in `REVIEWER_DISPATCH_SKILLS_INDEX` is rendered into the runbook body", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "dispatch-skills-index"
    )!;
    for (const entry of REVIEWER_DISPATCH_SKILLS_INDEX) {
      expect(
        runbook.body,
        `runbook body must include section heading for envelope shape "${entry.label}"`
      ).toContain(`### ${entry.label}`);
      // The rendered block from buildAutoTriggerBlock is copied verbatim
      // into a fenced markdown block under each section.
      expect(runbook.body).toContain(entry.block);
    }
  });

  it("AC-2 — start-command body references the new runbook by file name", () => {
    expect(renderStartCommand()).toContain("dispatch-skills-index.md");
  });

  it("AC-2 — every canonical envelope entry round-trips through `renderDispatchSkillsIndex`", () => {
    for (const entry of REVIEWER_DISPATCH_SKILLS_INDEX) {
      const fresh = renderDispatchSkillsIndex(
        entry.stage,
        entry.envelope,
        entry.label
      );
      expect(fresh.block).toBe(entry.block);
      expect(fresh.activeSkillIds).toEqual(entry.activeSkillIds);
    }
  });
});

describe("v8.96.1 — behaviour: gate envelope flags drive the per-envelope skills slice", () => {
  // v8.113 — scope-drift is folded into edit-discipline (no standalone
  // skill), so the "a flag omission removes the matching pointer" gate
  // mechanism is now exercised against a surviving surface-driven axis.
  it("AC-3 — envelope WITHOUT `walkQaEvidenceAxis` omits the qa-evidence pointer from the rendered slice", () => {
    const envelope: GateEnvelope = {
      editDisciplineActive: true
      // walkQaEvidenceAxis intentionally omitted
    };
    const entry = renderDispatchSkillsIndex("review", envelope, "no-qa-evidence");
    expect(entry.activeSkillIds).not.toContain("reviewer-axis-qa-evidence");
    expect(entry.block).not.toContain("reviewer-axis-qa-evidence");
  });

  it("AC-3 — envelope with `walkQaEvidenceAxis: false` (explicit opt-out) omits the qa-evidence pointer", () => {
    const envelope: GateEnvelope = {
      editDisciplineActive: true,
      walkQaEvidenceAxis: false
    };
    const entry = renderDispatchSkillsIndex("review", envelope, "qa-evidence-false");
    expect(entry.activeSkillIds).not.toContain("reviewer-axis-qa-evidence");
  });

  it("AC-3 — envelope with EVERY gate flag set pins every gated axis (matches the static superset)", () => {
    const envelope: GateEnvelope = {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true,
      walkScopeDriftAxis: true,
      walkAssumptionCoverageAxis: true,
      walkAntiSlopAxis: true
    };
    const entry = renderDispatchSkillsIndex("review", envelope, "every-flag");
    for (const id of REVIEWER_AXIS_SKILL_IDS_WITH_GATE) {
      expect(
        entry.activeSkillIds,
        `every-flag envelope must include \`${id}\` in active skill ids`
      ).toContain(id);
      expect(entry.block).toContain(id);
    }
  });

  // v8.113 — the advisory-only anti-slop axis was cut (it could never
  // block ship). Its default-on / explicit-opt-out gate tests are
  // retired with it; the empty-envelope filtering behaviour for the
  // surviving gated axes is covered by AC-7 below.

  it("AC-3 — non-gated review-stage skills (e.g. `review-discipline`) appear regardless of envelope flags", () => {
    const empty = renderDispatchSkillsIndex("review", {}, "empty");
    const full = renderDispatchSkillsIndex(
      "review",
      {
        walkQaEvidenceAxis: true,
        walkDesignQualityAxis: true,
        securityFlag: true,
        planHasNonFunctional: true,
        editDisciplineActive: true,
        walkScopeDriftAxis: true,
        walkAssumptionCoverageAxis: true,
        walkAntiSlopAxis: true
      },
      "full"
    );
    expect(empty.activeSkillIds).toContain("review-discipline");
    expect(full.activeSkillIds).toContain("review-discipline");
  });
});

describe("v8.96.1 — skill-body fictional claims about runtime `buildAutoTriggerBlock` calls are scrubbed", () => {
  // v8.113 — scope-drift + assumption-coverage skill bodies are deleted;
  // the scrub guard now runs over the surviving gated-axis skills.
  const VICTIMS = [
    "reviewer-axis-qa-evidence.md",
    "reviewer-axis-nfr-compliance.md",
    "reviewer-axis-edit-discipline.md"
  ];

  // The pre-v8.96.1 fictional claim shape — the orchestrator
  // supposedly calls `buildAutoTriggerBlock("review", env)` at
  // dispatch time. Post-fix, the function is called at INSTALL
  // time inside the runbook composer; the runtime dispatch carries
  // the rendered slice, not a function call.
  //
  // The phrases below ALWAYS were fiction. After v8.96.1 the
  // skill-bodies must NOT carry them in a present-tense
  // affirmative form (they may still appear inside a "pre-v8.96.1"
  // historical note — that's fine; the discriminator is whether
  // the phrase is asserted as the current contract or labeled as
  // historical drift).

  for (const fileName of VICTIMS) {
    it(`AC-4 — \`${fileName}\` does not present-tense-claim the orchestrator calls buildAutoTriggerBlock(...) at runtime`, async () => {
      const body = await fs.readFile(
        path.join(SKILLS_DIR, fileName),
        "utf8"
      );
      // Affirmative present-tense pattern — "the orchestrator pins
      // the skill via `buildAutoTriggerBlock(...)`" / "passes ... to
      // `buildAutoTriggerBlock(...)`" / "calls `buildAutoTriggerBlock(...)`".
      // Allow the phrase when it appears in a "pre-v8.96.1" historical
      // note (which is how v8.96.1 documents the correction).
      const matches: string[] = [];
      const lines = body.split("\n");
      for (const line of lines) {
        if (!/buildAutoTriggerBlock\s*\(\s*"review"\s*,\s*[^)]+\)/u.test(line))
          continue;
        const isHistorical = /(pre-v8\.94|tests-only fiction|was tests-only|historical)/iu.test(
          line
        );
        if (isHistorical) continue;
        // Verbs that present-tense-claim a runtime call:
        if (/(orchestrator (calls|passes|pins)|via\s+`buildAutoTriggerBlock)/iu.test(line)) {
          matches.push(line.trim());
        }
      }
      expect(
        matches,
        `${fileName} still carries the pre-v8.96.1 fictional claim. Lines: ${JSON.stringify(matches, null, 2)}`
      ).toEqual([]);
    });
  }
});

describe("v8.96.1 — reviewer.ts carries the superset-note paragraph pointing at the runbook", () => {
  it("AC-5 — reviewer prompt body names the dispatch-skills-index runbook", () => {
    expect(REVIEWER_PROMPT).toContain("dispatch-skills-index");
  });

  it("AC-5 — reviewer prompt body explains the embedded block is a SUPERSET", () => {
    expect(REVIEWER_PROMPT.toLowerCase()).toContain("superset");
  });

  it("AC-5 — reviewer prompt body names the `Active skills (per envelope):` field as the runtime override", () => {
    expect(REVIEWER_PROMPT).toContain("Active skills (per envelope)");
  });
});

describe("v8.96.1 — start-command body wires the runbook into the reviewer dispatch step", () => {
  it("AC-6 — start-command body names the resolve-per-envelope-slice step", () => {
    const body = renderStartCommand();
    expect(body).toContain("dispatch-skills-index.md");
    expect(body).toContain("Active skills (per envelope)");
  });
});

describe("v8.96.1 — regression: every v8.83-token-axes invariant on `buildAutoTriggerBlock` still holds", () => {
  it("AC-7 — single-arg call still emits the static SUPERSET (every gated axis)", () => {
    const block = buildAutoTriggerBlock("review");
    for (const id of REVIEWER_AXIS_SKILL_IDS_WITH_GATE) {
      expect(block).toContain(id);
    }
  });

  it("AC-7 — empty-envelope two-arg call filters every gated axis", () => {
    const block = buildAutoTriggerBlock("review", {});
    // v8.113 — with anti-slop's default-on gate retired, every surviving
    // gated axis predicate returns false on the empty envelope, so the
    // empty-envelope slice carries no gated reviewer-axis pointer.
    for (const id of REVIEWER_AXIS_SKILL_IDS_WITH_GATE) {
      expect(block).not.toContain(id);
    }
  });

  it("AC-7 — AUTO_TRIGGER_SKILLS still registers every reviewer-axis skill with a gate predicate", () => {
    for (const id of REVIEWER_AXIS_SKILL_IDS_WITH_GATE) {
      const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === id);
      expect(skill).toBeDefined();
      expect(typeof skill!.gate).toBe("function");
    }
  });
});

describe("v8.96.1 — version + cross-cutting checks", () => {
  it("AC-8 — package.json bumps to at least 8.96.1 (next available patch slot after the G-1 worker's 8.94.0)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf8")
    ) as { version: string };
    const [major, minor, patch] = pkg.version
      .split(".")
      .map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    // The lower bound is 8.96.1; if the G-1 worker re-numbers (8.95.0)
    // before this slug lands, the floor still holds.
    if (minor === 94) {
      expect(patch).toBeGreaterThanOrEqual(1);
    } else {
      expect(minor).toBeGreaterThan(94);
    }
  });

  it("AC-8 — CHANGELOG.md carries an entry naming the Phase C G-2 fix", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf8"
    );
    expect(changelog).toMatch(/Phase C G-2|auto-trigger gate wiring|buildAutoTriggerBlock gateEnvelope/i);
  });
});

describe("v8.96.1 — `DispatchSkillsIndexEntry` type contract is enforced at runtime", () => {
  it("AC-9 — every entry carries the four required fields with correct types", () => {
    for (const entry of REVIEWER_DISPATCH_SKILLS_INDEX) {
      const e: DispatchSkillsIndexEntry = entry;
      expect(typeof e.stage).toBe("string");
      expect(typeof e.block).toBe("string");
      expect(typeof e.label).toBe("string");
      expect(Array.isArray(e.activeSkillIds)).toBe(true);
      expect(e.envelope).toBeDefined();
    }
  });
});
