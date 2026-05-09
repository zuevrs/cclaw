import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { ANTIPATTERNS } from "../../src/content/antipatterns.js";
import { IRON_LAWS, ironLawsMarkdown } from "../../src/content/iron-laws.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";

function skillById(id: string) {
  const found = AUTO_TRIGGER_SKILLS.find((skill) => skill.id === id);
  if (!found) throw new Error(`skill not found: ${id}`);
  return found;
}

describe("v8.7 — A2: iron-law Think Before Coding deepened", () => {
  it("Think Before Coding includes stop/name/ask + propose-simpler + push-back", () => {
    const law = IRON_LAWS.find((l) => l.id === "think-before-coding");
    expect(law).toBeDefined();
    expect(law!.description).toMatch(/stop|name|ask/i);
    expect(law!.description).toMatch(/simpler|simplest/i);
    expect(law!.description).toMatch(/multiple interpretations|present them|do not pick silently/i);
  });

  it("Think Before still preserves the original 'read enough of the codebase' framing", () => {
    const law = IRON_LAWS.find((l) => l.id === "think-before-coding");
    expect(law!.description).toMatch(/read enough of the codebase/i);
  });

  it("ironLawsMarkdown surfaces the deepened text under the Karpathy heading", () => {
    const md = ironLawsMarkdown();
    expect(md).toContain("## Iron Laws (Karpathy)");
    expect(md).toContain("Think Before Coding");
    expect(md).toMatch(/stop, name the confusion, ask|stop, name|name the confusion/i);
  });
});

describe("v8.7 — A1: ambiguity forks in pre-flight", () => {
  const skill = skillById("pre-flight-assumptions");

  it("pre-flight skill describes interpretation forks as a NEW sub-step", () => {
    expect(skill.body).toMatch(/Interpretation forks/i);
    expect(skill.body).toMatch(/v8\.7\+/);
    expect(skill.body).toMatch(/2.{0,3}4 distinct interpretations|2.{0,3}4 numbered interpretations/i);
  });

  it("forks are mandated to run BEFORE assumptions composition", () => {
    expect(skill.body).toMatch(/Forks before assumptions, not after/);
    expect(skill.body).toMatch(/Composing assumptions before the fork is resolved/);
  });

  it("each fork carries 'what it does', 'tradeoff', 'effort' on three lines", () => {
    expect(skill.body).toMatch(/What it does/);
    expect(skill.body).toMatch(/Tradeoff/);
    expect(skill.body).toMatch(/Effort/);
    expect(skill.body).toMatch(/small|medium|large/);
  });

  it("forks are mutually exclusive AND collectively defensible", () => {
    expect(skill.body).toMatch(/mutually exclusive/);
    expect(skill.body).toMatch(/collectively defensible/);
  });

  it("when prompts are concrete and unambiguous, forks are skipped", () => {
    expect(skill.body).toMatch(/Do NOT run forks when the prompt names a concrete file\/AC\/behaviour/);
  });

  it("Cancel — re-think is always a valid fork choice", () => {
    expect(skill.body).toMatch(/Cancel.{0,3}re-think/);
    expect(skill.body).toMatch(/do NOT silently pick the first option/i);
  });

  it("chosen reading persists into triage.interpretationForks (verbatim, chosen-only)", () => {
    expect(skill.body).toMatch(/triage\.interpretationForks/);
    expect(skill.body).toMatch(/chosen.{0,30}verbatim|verbatim.{0,30}chosen/i);
    expect(skill.body).toMatch(/rejected readings are NOT persisted/i);
  });

  it("when prompt is unambiguous, triage.interpretationForks is null", () => {
    expect(skill.body).toMatch(/triage\.interpretationForks: null/);
  });

  it("hard rule: never silently pick", () => {
    expect(skill.body).toMatch(/Never silently pick/);
    expect(skill.body).toMatch(/the user picks/);
  });
});

describe("v8.7 — S1: surgical-edit-hygiene skill", () => {
  it("surgical-edit-hygiene skill is registered as always-on for slice-builder", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill).toBeDefined();
    expect(skill.fileName).toBe("surgical-edit-hygiene.md");
    expect(skill.triggers).toContain("always-on");
    expect(skill.triggers).toContain("specialist:slice-builder");
    expect(skill.triggers).toContain("before:git-commit");
  });

  it("the skill describes three hard rules", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/Rule 1.{0,30}drive-by edits to adjacent code/i);
    expect(skill.body).toMatch(/Rule 2.{0,30}orphans your changes created/i);
    expect(skill.body).toMatch(/Rule 3.{0,30}pre-existing dead code/i);
  });

  it("rule 1 enumerates concrete drive-by examples (comments, formatting, imports, renames, JSDoc)", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/improve.{0,5}comments/i);
    expect(skill.body).toMatch(/reformat/);
    expect(skill.body).toMatch(/reorder imports/i);
    expect(skill.body).toMatch(/rename a local variable/i);
    expect(skill.body).toMatch(/JSDoc|docstring/);
  });

  it("rule 2: removing pre-existing orphans is forbidden", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/must NOT.{0,10}remove orphans that.{0,40}pre-dated/is);
    expect(skill.body).toMatch(/A-17/);
  });

  it("rule 3: pre-existing dead code goes under Noticed but didn't touch", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/Noticed but didn't touch/);
    expect(skill.body).toMatch(/cite the file, the symbol/i);
  });

  it("provides verbatim reviewer finding template for A-16 (drive-by) and A-17 (deleted dead code)", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/A-16.{0,30}Drive-by edit/);
    expect(skill.body).toMatch(/A-17.{0,30}Pre-existing helper.{0,40}deleted/);
  });

  it("the diff scope test rule applies", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/diff scope test/i);
    expect(skill.body).toMatch(/AC verification line that justifies the change/i);
  });

  it("git add -A is forbidden (cross-cite to A-3)", () => {
    const skill = skillById("surgical-edit-hygiene");
    expect(skill.body).toMatch(/git add -A.{0,20}forbidden/i);
  });
});

describe("v8.7 — S1: slice-builder + reviewer wiring for surgical hygiene", () => {
  it("slice-builder hard rule 14 mandates surgical-edit-hygiene", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/14\.\s+\*\*Surgical-edit hygiene/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/surgical-edit-hygiene\.md/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/A-16/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/A-17/);
  });

  it("reviewer hard rules cite surgical-edit-hygiene templates", () => {
    expect(REVIEWER_PROMPT).toMatch(/Surgical-edit hygiene is on every iteration's checklist/);
    expect(REVIEWER_PROMPT).toMatch(/surgical-edit-hygiene\.md/);
    expect(REVIEWER_PROMPT).toMatch(/A-16/);
    expect(REVIEWER_PROMPT).toMatch(/A-17/);
  });
});

describe("v8.7 — S1: antipatterns A-16 (drive-by) and A-17 (dead code)", () => {
  it("antipatterns library carries A-16 with concrete symptoms + correction", () => {
    expect(ANTIPATTERNS).toMatch(/## A-16 — Drive-by edits/);
    expect(ANTIPATTERNS).toMatch(/While I'm here, let me improve/);
    expect(ANTIPATTERNS).toMatch(/Touch only what the AC requires/);
  });

  it("antipatterns library carries A-17 with concrete symptoms + correction", () => {
    expect(ANTIPATTERNS).toMatch(/## A-17 — Deletion of pre-existing dead code/);
    expect(ANTIPATTERNS).toMatch(/Pre-existing dead code is not the AC's scope/);
    expect(ANTIPATTERNS).toMatch(/Noticed but didn't touch/);
    expect(ANTIPATTERNS).toMatch(/Always.{0,5}required/i);
  });
});

describe("v8.7 — S2: debug-loop skill", () => {
  const skill = () => skillById("debug-loop");

  it("debug-loop skill is registered with stop-the-line + bug-fix triggers", () => {
    const s = skill();
    expect(s.fileName).toBe("debug-loop.md");
    expect(s.triggers).toContain("stop-the-line");
    expect(s.triggers).toContain("specialist:slice-builder:fix-only");
    expect(s.triggers).toContain("task:bug-fix");
    expect(s.triggers).toContain("test-failed-unclear-reason");
  });

  it("Phase 1 mandates 3-5 ranked hypotheses with three-part shape", () => {
    expect(skill().body).toMatch(/Phase 1.{0,30}Hypothesis ranking/i);
    expect(skill().body).toMatch(/3-5 hypotheses/);
    expect(skill().body).toMatch(/The hypothesis/);
    expect(skill().body).toMatch(/Test cost/);
    expect(skill().body).toMatch(/Likelihood/);
  });

  it("Phase 1 requires showing the ranked list to the user before probing", () => {
    expect(skill().body).toMatch(/Show the ranked list to the user/);
    expect(skill().body).toMatch(/before.{0,20}running any probes/i);
  });

  it("Phase 2 contains the ten-rung loop ladder, cheapest first", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 2.{0,30}loop ladder/i);
    expect(body).toMatch(/Failing test/);
    expect(body).toMatch(/Curl.{0,10}HTTP/);
    expect(body).toMatch(/CLI invocation/);
    expect(body).toMatch(/Headless browser/);
    expect(body).toMatch(/Trace replay/);
    expect(body).toMatch(/Throwaway harness/);
    expect(body).toMatch(/Property.{0,10}fuzz/);
    expect(body).toMatch(/Bisection harness|git bisect/);
    expect(body).toMatch(/Differential loop/);
    expect(body).toMatch(/HITL bash/);
  });

  it("hard rule: start at rung 1 unless rung 1 is provably impossible", () => {
    expect(skill().body).toMatch(/start at rung 1/i);
    expect(skill().body).toMatch(/provably impossible/i);
  });

  it("Phase 3 mandates tagged debug logs with [DEBUG-<hex>] prefix", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 3.{0,30}Tagged debug logs/i);
    expect(body).toMatch(/4-character hex prefix/);
    expect(body).toMatch(/\[DEBUG-a4f2\]/);
    expect(body).toMatch(/A-21.{0,20}Untagged debug logs/);
  });

  it("Phase 4 multi-run protocol: 20 / 100 iterations on observed flakiness", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 4.{0,30}Multi-run protocol/i);
    expect(body).toMatch(/run.{0,5}20 times/i);
    expect(body).toMatch(/run.{0,5}100 times/i);
    expect(body).toMatch(/A-22.{0,40}Single-run flakiness conclusion/);
  });

  it("Phase 4 fix must eliminate failure (not reduce its rate)", () => {
    expect(skill().body).toMatch(/eliminate the failure, not reduce its rate/);
  });

  it("Phase 5: no testable seam is itself a finding (architecture/required)", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 5.{0,30}no seam.{0,5}finding/i);
    expect(body).toMatch(/architecture.{0,20}required/);
    expect(body).toMatch(/no testable seam/i);
  });

  it("Phase 6: writes flows/<slug>/debug-N.md artifact with frontmatter", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 6.{0,30}Artifact/i);
    expect(body).toMatch(/flows\/<slug>\/debug-N\.md/);
    expect(body).toMatch(/debug_iteration:/);
    expect(body).toMatch(/loop_rung:/);
    expect(body).toMatch(/debug_prefix:/);
    expect(body).toMatch(/seam_finding:/);
  });
});

describe("v8.7 — S2: slice-builder + reviewer wiring for debug-loop", () => {
  it("slice-builder hard rule 16 mandates debug-loop on stop-the-line", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/16\.\s+\*\*Debug-loop discipline/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/debug-loop\.md/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/3-5 ranked hypotheses/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/\[DEBUG-/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/A-21/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/A-22/);
  });

  it("reviewer hard rules cite debug-loop discipline checks", () => {
    expect(REVIEWER_PROMPT).toMatch(/Debug-loop discipline/);
    expect(REVIEWER_PROMPT).toMatch(/debug-loop\.md/);
    expect(REVIEWER_PROMPT).toMatch(/A-21/);
    expect(REVIEWER_PROMPT).toMatch(/A-22/);
  });
});

describe("v8.7 — S2: antipatterns A-21 (untagged logs) and A-22 (single-run flakiness)", () => {
  it("antipatterns A-21 mandates [DEBUG-<hex>] tag protocol", () => {
    expect(ANTIPATTERNS).toMatch(/## A-21 — Untagged debug logs/);
    expect(ANTIPATTERNS).toMatch(/4-character hex prefix/);
    expect(ANTIPATTERNS).toMatch(/\[DEBUG-a4f2\]/);
  });

  it("antipatterns A-22 forbids single-run pass after observed failure", () => {
    expect(ANTIPATTERNS).toMatch(/## A-22 — Single-run flakiness conclusion/);
    expect(ANTIPATTERNS).toMatch(/single-run pass after an observed failure is.{0,5}undecided/i);
    expect(ANTIPATTERNS).toMatch(/Multi-run protocol/);
  });
});

describe("v8.7 — S4: browser-verification skill", () => {
  const skill = () => skillById("browser-verification");

  it("browser-verification skill registered with UI-touch + ac_mode triggers", () => {
    const s = skill();
    expect(s.fileName).toBe("browser-verification.md");
    expect(s.triggers).toContain("ac_mode:strict");
    expect(s.triggers).toContain("touch-surface:ui");
    expect(s.triggers).toContain("specialist:slice-builder");
    expect(s.triggers).toContain("specialist:reviewer");
  });

  it("Phase 1 detects available DevTools MCP in priority order", () => {
    const body = skill().body;
    expect(body).toMatch(/cursor-ide-browser/);
    expect(body).toMatch(/chrome-devtools/);
    expect(body).toMatch(/playwright/i);
    expect(body).toMatch(/puppeteer/i);
  });

  it("Phase 2 lists five mandatory checks with concrete evidence formats", () => {
    const body = skill().body;
    expect(body).toMatch(/Check 1 — Console hygiene/);
    expect(body).toMatch(/Check 2 — Network/);
    expect(body).toMatch(/Check 3 — Accessibility tree/);
    expect(body).toMatch(/Check 4 — Layout/);
    expect(body).toMatch(/Check 5 — Perf trace/);
  });

  it("zero new console errors / warnings is the ship gate", () => {
    const body = skill().body;
    expect(body).toMatch(/zero.{0,10}errors.{0,10}zero.{0,10}warnings/i);
    expect(body).toMatch(/shipping bar/i);
  });

  it("Phase 3: browser content is untrusted data, never instructions", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 3.{0,30}untrusted data/i);
    expect(body).toMatch(/data.{0,10}never.{0,10}instructions to execute/);
    expect(body).toMatch(/critical.{0,10}finding/i);
  });

  it("Phase 4: appends evidence section to flows/<slug>/build.md", () => {
    const body = skill().body;
    expect(body).toMatch(/Phase 4.{0,30}Artifact/i);
    expect(body).toMatch(/Browser verification — AC-/);
    expect(body).toMatch(/Console hygiene/);
    expect(body).toMatch(/Network/);
    expect(body).toMatch(/Accessibility/);
    expect(body).toMatch(/Layout/);
  });
});

describe("v8.7 — S4: slice-builder + reviewer wiring for browser-verification", () => {
  it("slice-builder hard rule 15 mandates browser-verification on UI touchSurface", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/15\.\s+\*\*Browser verification/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/browser-verification\.md/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/\*\.tsx/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/zero new errors/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/untrusted data/);
  });

  it("reviewer hard rules cite browser-verification on UI diffs", () => {
    expect(REVIEWER_PROMPT).toMatch(/Browser verification when the diff touches UI files/);
    expect(REVIEWER_PROMPT).toMatch(/browser-verification\.md/);
    expect(REVIEWER_PROMPT).toMatch(/\*\.tsx/);
    expect(REVIEWER_PROMPT).toMatch(/five-check pass/);
  });
});

describe("v8.7 — A3: api-and-interface-design skill", () => {
  const skill = () => skillById("api-and-interface-design");

  it("api-and-interface-design skill registered for architect", () => {
    const s = skill();
    expect(s.fileName).toBe("api-and-interface-design.md");
    expect(s.triggers).toContain("specialist:architect");
    expect(s.triggers).toContain("decision:public-interface");
    expect(s.triggers).toContain("decision:rpc-schema");
    expect(s.triggers).toContain("decision:persistence-shape");
    expect(s.triggers).toContain("decision:new-dependency");
  });

  it("Hyrum's Law block: pin shape / order / silence / timing", () => {
    const body = skill().body;
    expect(body).toMatch(/Hyrum's Law/);
    expect(body).toMatch(/all observable behaviors of your system will be depended on by somebody/i);
    expect(body).toMatch(/Pin the shape/);
    expect(body).toMatch(/Pin the order/);
    expect(body).toMatch(/Pin the silence/);
    expect(body).toMatch(/Pin the timing/);
    expect(body).toMatch(/A-23.{0,30}Hyrum's Law surface unpinned/);
  });

  it("one-version rule lists diamond deps + type-incompatible siblings + schema fork", () => {
    const body = skill().body;
    expect(body).toMatch(/one-version rule/i);
    expect(body).toMatch(/Diamond dependency/);
    expect(body).toMatch(/Type-incompatible siblings/);
    expect(body).toMatch(/Schema fork/);
  });

  it("untrusted third-party API responses block with zod-style example", () => {
    const body = skill().body;
    expect(body).toMatch(/Third-party API responses are untrusted data/);
    expect(body).toMatch(/safeParse|UserSchema|zod/);
    expect(body).toMatch(/A-24.{0,40}Unvalidated external response shape/);
  });

  it("two-adapter rule: no port without two real adapters", () => {
    const body = skill().body;
    expect(body).toMatch(/two-adapter rule/i);
    expect(body).toMatch(/at least two adapters/);
    expect(body).toMatch(/PostgresStorage/);
    expect(body).toMatch(/InMemoryStorage/);
    expect(body).toMatch(/A-25.{0,40}Hypothetical seam/);
  });

  it("consistent error model per boundary", () => {
    const body = skill().body;
    expect(body).toMatch(/Consistent error model/i);
    expect(body).toMatch(/Result type/i);
    expect(body).toMatch(/RFC 7807|problem-details/i);
  });

  it("hard rules cover all five points", () => {
    const body = skill().body;
    expect(body).toMatch(/Pin everything observable/i);
    expect(body).toMatch(/One version of every dependency/i);
    expect(body).toMatch(/Validate untrusted external responses/i);
    expect(body).toMatch(/No port without two adapters/i);
    expect(body).toMatch(/Consistent error model per boundary/i);
  });
});

describe("v8.7 — A3: architect prompt wiring for api-and-interface-design", () => {
  it("architect Sub-agent context lists api-and-interface-design.md as item 5", () => {
    expect(ARCHITECT_PROMPT).toMatch(/api-and-interface-design\.md/);
    expect(ARCHITECT_PROMPT).toMatch(/Hyrum's Law/);
    expect(ARCHITECT_PROMPT).toMatch(/two-adapter seam/);
  });

  it("architect Phase 1 reads api-and-interface-design when D-N introduces public interface", () => {
    expect(ARCHITECT_PROMPT).toMatch(/api-and-interface-design\.md.{0,200}public interface|public interface.{0,200}api-and-interface-design\.md/s);
  });

  it("architect Composition footer mentions the skill", () => {
    expect(ARCHITECT_PROMPT).toMatch(/api-and-interface-design\.md.{0,80}public interface/s);
  });
});

describe("v8.7 — A3: antipatterns A-23 / A-24 / A-25 land in catalogue", () => {
  it("A-23 Hyrum's Law surface unpinned", () => {
    expect(ANTIPATTERNS).toMatch(/## A-23 — Hyrum's Law surface unpinned/);
    expect(ANTIPATTERNS).toMatch(/follows existing conventions.{0,30}is not a contract/i);
  });

  it("A-24 Unvalidated external response shape", () => {
    expect(ANTIPATTERNS).toMatch(/## A-24 — Unvalidated external response shape/);
    expect(ANTIPATTERNS).toMatch(/zod, valibot, ajv, yup|schema library/i);
  });

  it("A-25 Hypothetical seam (one-adapter port)", () => {
    expect(ANTIPATTERNS).toMatch(/## A-25 — Hypothetical seam/);
    expect(ANTIPATTERNS).toMatch(/two-adapter rule/i);
  });
});

describe("v8.7 — B1: code-simplification catalog in refactor-safety", () => {
  const skill = () => skillById("refactor-safety");

  it("Chesterton's Fence section with four-step protocol", () => {
    const body = skill().body;
    expect(body).toMatch(/Chesterton's Fence/);
    expect(body).toMatch(/If you see a fence across a road and don't understand why it's there, don't tear it down/);
    expect(body).toMatch(/git log -L|git blame/);
    expect(body).toMatch(/Search for related tests/);
    expect(body).toMatch(/Search for callers/);
    expect(body).toMatch(/A-26.{0,30}Chesterton's Fence violation/);
  });

  it("Rule of 500 invests in automation past the threshold", () => {
    const body = skill().body;
    expect(body).toMatch(/Rule of 500/);
    expect(body).toMatch(/more than 500 lines/i);
    expect(body).toMatch(/jscodeshift|ts-morph|libcst/);
    expect(body).toMatch(/A-27.{0,30}Rule of 500 violation/);
  });

  it("structural simplification patterns table includes guards / options object / etc.", () => {
    const body = skill().body;
    expect(body).toMatch(/Guard clauses/);
    expect(body).toMatch(/Options object/);
    expect(body).toMatch(/Parameter object/);
    expect(body).toMatch(/Null object/);
    expect(body).toMatch(/Polymorphism/);
    expect(body).toMatch(/Extract class/);
    expect(body).toMatch(/Extract variable/);
    expect(body).toMatch(/Extract function/);
  });
});

describe("v8.7 — B1: antipatterns A-26 / A-27", () => {
  it("A-26 Chesterton's Fence violation", () => {
    expect(ANTIPATTERNS).toMatch(/## A-26 — Chesterton's Fence violation/);
    expect(ANTIPATTERNS).toMatch(/four-step protocol/);
  });

  it("A-27 Rule of 500 violation", () => {
    expect(ANTIPATTERNS).toMatch(/## A-27 — Rule of 500 violation/);
    expect(ANTIPATTERNS).toMatch(/codemod|AST transform/i);
  });
});

describe("v8.7 — B2: test-design checklist in tdd-cycle", () => {
  const skill = () => skillById("tdd-cycle");

  it("one logical assertion per test rule with WRONG vs RIGHT example", () => {
    const body = skill().body;
    expect(body).toMatch(/One logical assertion per test/);
    expect(body).toMatch(/multiple.{0,5}expect/i);
    expect(body).toMatch(/two unrelated outcomes/);
  });

  it("SDK-style boundary APIs over generic fetcher mocks", () => {
    const body = skill().body;
    expect(body).toMatch(/SDK-style boundary APIs/);
    expect(body).toMatch(/generic fetcher/i);
    expect(body).toMatch(/A-28.{0,30}Generic-fetcher mock with switch-on-URL/);
  });

  it("primitive obsession (A-29) and feature envy (A-30) named smells", () => {
    const body = skill().body;
    expect(body).toMatch(/A-29.{0,30}Primitive obsession/);
    expect(body).toMatch(/A-30.{0,30}Feature envy/);
    expect(body).toMatch(/typed value object|UserId|AccountId/);
  });
});

describe("v8.7 — B2: antipatterns A-28 / A-29 / A-30", () => {
  it("A-28 Generic-fetcher mock with switch-on-URL logic", () => {
    expect(ANTIPATTERNS).toMatch(/## A-28 — Generic-fetcher mock with switch-on-URL logic/);
    expect(ANTIPATTERNS).toMatch(/SDK-style/);
  });

  it("A-29 Primitive obsession masquerading as type safety", () => {
    expect(ANTIPATTERNS).toMatch(/## A-29 — Primitive obsession/);
    expect(ANTIPATTERNS).toMatch(/typed value object/i);
  });

  it("A-30 Feature envy", () => {
    expect(ANTIPATTERNS).toMatch(/## A-30 — Feature envy/);
    expect(ANTIPATTERNS).toMatch(/envious/i);
  });
});

describe("v8.7 — B3: deprecation & migration in breaking-changes", () => {
  const skill = () => skillById("breaking-changes");

  it("Churn Rule: deprecator owns migration", () => {
    const body = skill().body;
    expect(body).toMatch(/Churn Rule/);
    expect(body).toMatch(/responsible for migrating your users/i);
    expect(body).toMatch(/A-31.{0,30}Churn Rule violation/);
  });

  it("Strangler Pattern with five phases", () => {
    const body = skill().body;
    expect(body).toMatch(/Strangler Pattern/);
    expect(body).toMatch(/phase 0|phase 1|phase 2|phase 3|phase 4/);
    expect(body).toMatch(/canary|1%.{0,5}traffic/i);
    expect(body).toMatch(/A-32.{0,30}Big-bang migration/);
  });

  it("Zombie Code lifecycle: assign owner OR deprecate with concrete plan", () => {
    const body = skill().body;
    expect(body).toMatch(/Zombie Code/);
    expect(body).toMatch(/code nobody owns but everybody depends on/i);
    expect(body).toMatch(/assign an owner|deprecate it with a concrete migration plan/i);
    expect(body).toMatch(/A-33.{0,30}Zombie code reliance/);
  });
});

describe("v8.7 — B3: antipatterns A-31 / A-32 / A-33", () => {
  it("A-31 Churn Rule violation", () => {
    expect(ANTIPATTERNS).toMatch(/## A-31 — Churn Rule violation/);
    expect(ANTIPATTERNS).toMatch(/deprecator/i);
  });

  it("A-32 Big-bang migration", () => {
    expect(ANTIPATTERNS).toMatch(/## A-32 — Big-bang migration/);
    expect(ANTIPATTERNS).toMatch(/canary phase/i);
  });

  it("A-33 Zombie code reliance", () => {
    expect(ANTIPATTERNS).toMatch(/## A-33 — Zombie code reliance/);
    expect(ANTIPATTERNS).toMatch(/security-sensitive path/);
  });
});

describe("v8.7 — overall regression / counts", () => {
  it("AUTO_TRIGGER_SKILLS gains four new entries: surgical-edit-hygiene, debug-loop, browser-verification, api-and-interface-design", () => {
    const ids = AUTO_TRIGGER_SKILLS.map((s) => s.id);
    expect(ids).toContain("surgical-edit-hygiene");
    expect(ids).toContain("debug-loop");
    expect(ids).toContain("browser-verification");
    expect(ids).toContain("api-and-interface-design");
  });

  it("antipatterns library gains entries A-16 through A-33 (excluding pre-existing A-18..A-20 already present in tdd-cycle text)", () => {
    expect(ANTIPATTERNS).toMatch(/## A-16/);
    expect(ANTIPATTERNS).toMatch(/## A-17/);
    expect(ANTIPATTERNS).toMatch(/## A-21/);
    expect(ANTIPATTERNS).toMatch(/## A-22/);
    expect(ANTIPATTERNS).toMatch(/## A-23/);
    expect(ANTIPATTERNS).toMatch(/## A-24/);
    expect(ANTIPATTERNS).toMatch(/## A-25/);
    expect(ANTIPATTERNS).toMatch(/## A-26/);
    expect(ANTIPATTERNS).toMatch(/## A-27/);
    expect(ANTIPATTERNS).toMatch(/## A-28/);
    expect(ANTIPATTERNS).toMatch(/## A-29/);
    expect(ANTIPATTERNS).toMatch(/## A-30/);
    expect(ANTIPATTERNS).toMatch(/## A-31/);
    expect(ANTIPATTERNS).toMatch(/## A-32/);
    expect(ANTIPATTERNS).toMatch(/## A-33/);
  });
});
