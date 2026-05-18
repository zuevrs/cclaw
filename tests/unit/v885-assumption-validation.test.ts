import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  buildAutoTriggerBlock,
  type GateEnvelope
} from "../../src/content/skills.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { PLAN_CRITIC_PROMPT } from "../../src/content/specialist-prompts/plan-critic.js";
import { START_COMMAND_BODY as START_COMMAND_PROMPT } from "../../src/content/start-command.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import {
  parseValidatesPayload,
  parseAssumptionRows,
  flipAssumptionRows,
  collectValidations,
  unvalidatedKaIds,
  type AssumptionRow
} from "../../src/assumption-validation.js";

/**
 * v8.85 — Assumption-validation lite.
 *
 * The reviewer gained its thirteenth axis, `assumption-coverage`. The
 * axis is gated: it fires when `walkAssumptionCoverageAxis: true` is
 * set on the dispatch envelope — the orchestrator stamps the flag
 * when `flows/<slug>/plan.md > ## Key assumptions to validate`
 * carries ≥1 `KA-N`-shaped bullet (i.e. a v8.85-shaped plan).
 *
 * Three additive moves close the v8.80 loop:
 *
 *   1. Stable `KA-N` ids on every `## Key assumptions to validate`
 *      bullet (in plan.md and research.md).
 *   2. Optional `validates: KA-N` payload on `verify(AC-N): passing`
 *      commits — flips matching rows to `Status: validated by <sha>`
 *      via the flow-state validator (`src/assumption-validation.ts`).
 *   3. New gated reviewer axis `assumption-coverage` + new ship.md
 *      `## Unvalidated assumptions` section.
 *
 * Tripwires below pin the v8.85 invariants so a future change that
 * silently drops the KA-N prefix, regresses the validator parser,
 * inlines the companion skill body back into reviewer.ts, or
 * regresses the slim-counter wiring lights up immediately.
 */

const PROJECT_ROOT = path.resolve(process.cwd());
const SKILLS_DIR = path.join(PROJECT_ROOT, "src/content/skills");
const ASSUMPTION_COVERAGE_SKILL_ID = "reviewer-axis-assumption-coverage";

describe("v8.85 — companion skill `reviewer-axis-assumption-coverage` is on disk", () => {
  it("AC-1 — `reviewer-axis-assumption-coverage.md` is present under src/content/skills/", async () => {
    const filePath = path.join(SKILLS_DIR, `${ASSUMPTION_COVERAGE_SKILL_ID}.md`);
    const stat = await fs.stat(filePath);
    expect(stat.isFile()).toBe(true);
  });

  it("AC-1 — body is a non-trivial rubric (≥3k chars) with the canonical frontmatter shape", async () => {
    const filePath = path.join(SKILLS_DIR, `${ASSUMPTION_COVERAGE_SKILL_ID}.md`);
    const body = await fs.readFile(filePath, "utf8");
    // Same length pin as the other reviewer-axis companion skills.
    expect(body.length).toBeGreaterThan(3000);
    expect(body.startsWith("---\n")).toBe(true);
    expect(body).toMatch(/^name:\s*reviewer-axis-assumption-coverage$/m);
    expect(body).toMatch(/^trigger:/m);
    expect(body).toContain(`# Skill: ${ASSUMPTION_COVERAGE_SKILL_ID}`);
  });
});

describe("v8.85 — AUTO_TRIGGER_SKILLS registers `reviewer-axis-assumption-coverage` with stage=review + gate predicate", () => {
  it("AC-2 — skill registered with `stages: [\"review\"]` and a gate predicate function", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ASSUMPTION_COVERAGE_SKILL_ID);
    expect(
      skill,
      "expected AUTO_TRIGGER_SKILLS to register `reviewer-axis-assumption-coverage`"
    ).toBeDefined();
    expect(skill!.stages).toEqual(["review"]);
    expect(typeof skill!.gate).toBe("function");
    expect(skill!.body.length).toBeGreaterThan(3000);
    expect(skill!.fileName).toBe(`${ASSUMPTION_COVERAGE_SKILL_ID}.md`);
  });

  it("AC-2 — gate predicate fires on `walkAssumptionCoverageAxis: true`, stays closed on empty / false envelope", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === ASSUMPTION_COVERAGE_SKILL_ID)!;
    const gate = skill.gate!;
    expect(gate({ walkAssumptionCoverageAxis: true })).toBe(true);
    expect(gate({})).toBe(false);
    expect(gate({ walkAssumptionCoverageAxis: false })).toBe(false);
    // Unrelated flags do not accidentally trigger the gate.
    expect(
      gate({
        walkQaEvidenceAxis: true,
        walkDesignQualityAxis: true,
        securityFlag: true,
        planHasNonFunctional: true,
        editDisciplineActive: true,
        walkScopeDriftAxis: true
      })
    ).toBe(false);
  });
});

describe("v8.85 — buildAutoTriggerBlock(\"review\", env) gate-filters assumption-coverage correctly", () => {
  it("AC-3 — `buildAutoTriggerBlock(\"review\", { walkAssumptionCoverageAxis: true })` emits the assumption-coverage pointer", () => {
    const block = buildAutoTriggerBlock("review", { walkAssumptionCoverageAxis: true });
    expect(block).toContain(ASSUMPTION_COVERAGE_SKILL_ID);
  });

  it("AC-3 — empty envelope filters assumption-coverage out", () => {
    const block = buildAutoTriggerBlock("review", {});
    expect(block).not.toContain(ASSUMPTION_COVERAGE_SKILL_ID);
  });

  it("AC-3 — envelope with only the OTHER axis flags set (no assumption-coverage) does NOT emit the pointer", () => {
    const env: GateEnvelope = {
      walkQaEvidenceAxis: true,
      walkDesignQualityAxis: true,
      securityFlag: true,
      planHasNonFunctional: true,
      editDisciplineActive: true,
      walkScopeDriftAxis: true
      // walkAssumptionCoverageAxis intentionally omitted
    };
    const block = buildAutoTriggerBlock("review", env);
    expect(block).not.toContain(ASSUMPTION_COVERAGE_SKILL_ID);
    // The other six reviewer-axis skills DO render under their gates.
    expect(block).toContain("reviewer-axis-qa-evidence");
    expect(block).toContain("reviewer-axis-design-quality");
    expect(block).toContain("reviewer-axis-security");
    expect(block).toContain("reviewer-axis-nfr-compliance");
    expect(block).toContain("reviewer-axis-edit-discipline");
    expect(block).toContain("reviewer-axis-scope-drift");
  });

  it("AC-3 — envelope with ONLY `walkAssumptionCoverageAxis: true` emits assumption-coverage and excludes the other six reviewer-axis pointers", () => {
    const block = buildAutoTriggerBlock("review", { walkAssumptionCoverageAxis: true });
    expect(block).toContain(ASSUMPTION_COVERAGE_SKILL_ID);
    expect(block).not.toContain("reviewer-axis-qa-evidence");
    expect(block).not.toContain("reviewer-axis-design-quality");
    expect(block).not.toContain("reviewer-axis-security");
    expect(block).not.toContain("reviewer-axis-nfr-compliance");
    expect(block).not.toContain("reviewer-axis-edit-discipline");
    expect(block).not.toContain("reviewer-axis-scope-drift");
  });
});

describe("v8.85 — reviewer.ts mentions the assumption-coverage axis + rubric stub", () => {
  it("AC-4 — reviewer.ts intro does NOT regress to `Twelve-axis` (v8.85 introduced `Thirteen-axis`; v8.86 bumped to `Fourteen-axis`)", () => {
    // Relaxed at v8.86: the exact axis-count word lives in the
    // current-release tripwire. v8.85's invariant is the
    // non-regression to the v8.84 wording.
    expect(REVIEWER_PROMPT).not.toMatch(/Twelve-axis review/);
    expect(REVIEWER_PROMPT).not.toMatch(/Twelve axes; five severities/);
  });

  it("AC-4 — reviewer.ts axis-table row names `assumption-coverage` as gated with the v8.85 marker", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /\|\s*`assumption-coverage`\s*\(\*\*gated\*\*\)\s*—\s*v8\.85/
    );
  });

  it("AC-4 — reviewer.ts carries a dedicated stub heading `### Assumption-coverage axis (gated; v8.85)`", () => {
    expect(REVIEWER_PROMPT).toMatch(
      /^###\s+Assumption-coverage axis \(gated;\s*v8\.85\)/m
    );
  });

  it("AC-4 — reviewer.ts stub names the companion skill `reviewer-axis-assumption-coverage`", () => {
    expect(REVIEWER_PROMPT).toContain(ASSUMPTION_COVERAGE_SKILL_ID);
    expect(REVIEWER_PROMPT).toContain(
      `.cclaw/lib/skills/${ASSUMPTION_COVERAGE_SKILL_ID}.md`
    );
  });

  it("AC-4 — reviewer.ts stub cites the KA-N finding shape", () => {
    expect(REVIEWER_PROMPT).toContain(
      "KA-N: not validated by any commit despite high-stakes label"
    );
  });

  it("AC-4 — reviewer.ts stub cites the v8.85 closure (validates: KA-N payload + flow-state validator)", () => {
    expect(REVIEWER_PROMPT).toMatch(/validates:\s*KA-N/);
    expect(REVIEWER_PROMPT).toMatch(/v8\.85/);
    expect(REVIEWER_PROMPT).toMatch(/assumption-validation\.ts/);
  });

  it("AC-4 — slim-summary axes counter includes `av=N` token (optional / gate-aware)", () => {
    expect(REVIEWER_PROMPT).toMatch(/av=N/);
    expect(REVIEWER_PROMPT).toMatch(
      /`av=N` is \*\*only\*\* present when the assumption-coverage gate fired/
    );
  });

  it("AC-4 — slim-summary worked example carries the optional `[av=N]` token in the axes counter", () => {
    expect(REVIEWER_PROMPT).toMatch(/\[av=N\]/);
  });

  it("AC-4 — finding-dedup axis enum lists `assumption-coverage` so findings dedupe correctly inside an iteration", () => {
    // v8.85's tripwire pinned `assumption-coverage` as the last item
    // in the enum (\s*\)\. matched close-paren + period). v8.86
    // appended `anti-slop`, so the close-paren no longer sits
    // directly after `assumption-coverage`. Relax to membership.
    expect(REVIEWER_PROMPT).toMatch(/\/\s*`assumption-coverage`\s*(?:\/|\))/u);
  });
});

describe("v8.85 — plan template + research template carry KA-N format", () => {
  function templateBody(id: string): string {
    const entry = ARTIFACT_TEMPLATES.find((t) => t.id === id);
    expect(entry, `expected artifact template id=${id}`).toBeDefined();
    return entry!.body;
  }
  function planTemplate(): string {
    return templateBody("plan");
  }
  function researchTemplate(): string {
    return templateBody("research");
  }
  function shipTemplate(): string {
    return templateBody("ship");
  }

  it("AC-5 — plan.md template's Key assumptions to validate section uses `KA-N` leading bold token", () => {
    const body = planTemplate();
    expect(body).toMatch(/## Key assumptions to validate/);
    // The two example bullets carry KA-1 and KA-2 ids.
    expect(body).toMatch(/-\s+\*\*KA-1\*\*\s+—/);
    expect(body).toMatch(/-\s+\*\*KA-2\*\*\s+—/);
    // The v8.85 explainer paragraph names the closure loop.
    expect(body).toMatch(/v8\.85/);
    expect(body).toMatch(/validates:\s*KA-N/);
  });

  it("AC-5 — research.md template's Key assumptions to validate section uses `KA-N` leading bold token", () => {
    const body = researchTemplate();
    expect(body).toMatch(/## Key assumptions to validate/);
    expect(body).toMatch(/-\s+\*\*KA-1\*\*\s+—/);
    expect(body).toMatch(/-\s+\*\*KA-2\*\*\s+—/);
  });

  it("AC-5 — ship.md template carries the new `## Unvalidated assumptions` section", () => {
    const body = shipTemplate();
    expect(body).toMatch(/## Unvalidated assumptions/);
    // The section explains the closure loop verbatim.
    expect(body).toMatch(/v8\.85/);
    expect(body).toMatch(/validates:\s*KA-N/);
    // Empty-case literal — when every row was validated.
    expect(body).toContain("All key assumptions validated.");
  });
});

describe("v8.85 — architect Phase 7.5 + plan-critic §6.5 + builder verify-pass + research synthesis instruct KA-N format", () => {
  it("AC-6 — architect.ts Phase 7.5 names the `KA-N` format verbatim", () => {
    expect(ARCHITECT_PROMPT).toMatch(/v8\.85/);
    expect(ARCHITECT_PROMPT).toMatch(/`KA-N`/);
    expect(ARCHITECT_PROMPT).toMatch(/validates:\s*KA-N/);
    // The (high-stakes) label is documented in the architect's authoring rules.
    expect(ARCHITECT_PROMPT).toMatch(/\(high-stakes\)/);
  });

  it("AC-6 — plan-critic.ts §6.5 carries the new `key-assumptions-no-id` finding class", () => {
    expect(PLAN_CRITIC_PROMPT).toContain("key-assumptions-no-id");
    expect(PLAN_CRITIC_PROMPT).toMatch(/v8\.85/);
    expect(PLAN_CRITIC_PROMPT).toMatch(/KA-N/);
  });

  it("AC-6 — builder.ts verify pass mentions the `validates: KA-N` payload", () => {
    expect(BUILDER_PROMPT).toMatch(/validates:\s*KA-N/);
    expect(BUILDER_PROMPT).toMatch(/v8\.85/);
    expect(BUILDER_PROMPT).toMatch(/assumption-validation\.ts/);
  });

  it("AC-6 — start-command research-mode authoring instruction names the `KA-N` format", () => {
    expect(START_COMMAND_PROMPT).toMatch(/KA-N/);
    // The v8.85 marker appears in the research-mode section.
    expect(START_COMMAND_PROMPT).toMatch(/v8\.85/);
  });
});

describe("v8.85 — parseValidatesPayload extracts KA-N ids from verify commit messages", () => {
  it("AC-7 — extracts a single KA-N id from a canonical verify commit", () => {
    const msg = "verify(AC-3): passing\n\nvalidates: KA-2\nbench: 142ms";
    expect(parseValidatesPayload(msg)).toEqual(["KA-2"]);
  });

  it("AC-7 — extracts multiple KA-N ids (space- AND comma-separated)", () => {
    expect(
      parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-2 KA-4")
    ).toEqual(["KA-2", "KA-4"]);
    expect(
      parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-2, KA-4")
    ).toEqual(["KA-2", "KA-4"]);
    expect(
      parseValidatesPayload("verify(AC-3): passing\n\nvalidates: KA-2,KA-4")
    ).toEqual(["KA-2", "KA-4"]);
  });

  it("AC-7 — case-insensitive on the `validates:` marker", () => {
    expect(
      parseValidatesPayload("verify(AC-3): passing\n\nValidates: KA-1")
    ).toEqual(["KA-1"]);
    expect(
      parseValidatesPayload("verify(AC-3): passing\n\nVALIDATES: KA-1")
    ).toEqual(["KA-1"]);
  });

  it("AC-7 — returns empty array when the subject is not a verify(AC-N): passing line", () => {
    expect(
      parseValidatesPayload("green(SL-2): tooltip\n\nvalidates: KA-1")
    ).toEqual([]);
    expect(parseValidatesPayload("feat: add cache\n\nvalidates: KA-1")).toEqual([]);
    expect(parseValidatesPayload("verify(AC-3) passing\n\nvalidates: KA-1")).toEqual([]);
  });

  it("AC-7 — returns empty array when the body has no `validates:` line", () => {
    expect(parseValidatesPayload("verify(AC-3): passing")).toEqual([]);
    expect(
      parseValidatesPayload(
        "verify(AC-3): passing\n\nbench: 142ms\nfull suite green"
      )
    ).toEqual([]);
  });

  it("AC-7 — silently drops garbage tokens but keeps the valid ones", () => {
    expect(
      parseValidatesPayload(
        "verify(AC-3): passing\n\nvalidates: SL-2 KA-1 garbage KA-2"
      )
    ).toEqual(["KA-1", "KA-2"]);
  });

  it("AC-7 — deduplicates repeated ids", () => {
    expect(
      parseValidatesPayload(
        "verify(AC-3): passing\n\nvalidates: KA-1 KA-2 KA-1"
      )
    ).toEqual(["KA-1", "KA-2"]);
  });

  it("AC-7 — tolerates CRLF line endings", () => {
    expect(
      parseValidatesPayload("verify(AC-3): passing\r\n\r\nvalidates: KA-2\r\n")
    ).toEqual(["KA-2"]);
  });

  it("AC-7 — total / pure on empty + bogus input", () => {
    expect(parseValidatesPayload("")).toEqual([]);
    // @ts-expect-error — runtime tolerance assertion.
    expect(parseValidatesPayload(undefined)).toEqual([]);
    // @ts-expect-error — runtime tolerance assertion.
    expect(parseValidatesPayload(null)).toEqual([]);
  });
});

describe("v8.85 — parseAssumptionRows reads canonical v8.85 + legacy rows out of plan.md", () => {
  const PLAN_V885 = [
    "# slug",
    "",
    "## Key assumptions to validate",
    "",
    "- **KA-1** — search p95 stays under 200ms under realistic load (high-stakes). Validate by: vitest bench at 100 RPS against tests/fixtures/search-load.json. Status: unvalidated.",
    "- **KA-2** — users prefer the inline preview over the modal preview. Validate by: A/B test for 1 week. Status: validated by abc1234.",
    "- **KA-3** — Stripe API stays at v2024-09. Validate by: changelog check. Status: invalidated.",
    "",
    "## Spec",
    ""
  ].join("\n");
  const PLAN_LEGACY = [
    "# slug",
    "",
    "## Key assumptions to validate",
    "",
    "- **search p95 stays under 200ms** — Validate by: bench. Status: unvalidated.",
    "",
    "## Spec",
    ""
  ].join("\n");
  const PLAN_NO_SECTION = "# slug\n\n## Frame\n\nfoo\n";

  it("AC-8 — parses canonical v8.85 rows with KA-N ids + status + sha citation", () => {
    const rows = parseAssumptionRows(PLAN_V885);
    expect(rows).toHaveLength(3);
    const [r1, r2, r3] = rows as [AssumptionRow, AssumptionRow, AssumptionRow];
    expect(r1.id).toBe("KA-1");
    expect(r1.status).toBe("unvalidated");
    expect(r1.sha).toBeNull();
    expect(r1.highStakes).toBe(true);
    expect(r1.validateMethod.toLowerCase()).toContain("vitest");

    expect(r2.id).toBe("KA-2");
    expect(r2.status).toBe("validated");
    expect(r2.sha).toBe("abc1234");
    expect(r2.highStakes).toBe(false);

    expect(r3.id).toBe("KA-3");
    expect(r3.status).toBe("invalidated");
    expect(r3.sha).toBeNull();
  });

  it("AC-8 — parses legacy pre-v8.85 rows with `id: null`", () => {
    const rows = parseAssumptionRows(PLAN_LEGACY);
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBeNull();
    expect(rows[0].status).toBe("unvalidated");
    expect(rows[0].assumption.toLowerCase()).toContain("search");
  });

  it("AC-8 — returns empty array when the section is absent", () => {
    expect(parseAssumptionRows(PLAN_NO_SECTION)).toEqual([]);
  });

  it("AC-8 — total / pure on empty + bogus input", () => {
    expect(parseAssumptionRows("")).toEqual([]);
    // @ts-expect-error — runtime tolerance assertion.
    expect(parseAssumptionRows(undefined)).toEqual([]);
  });
});

describe("v8.85 — flipAssumptionRows rewrites unvalidated rows to `Status: validated by <sha>` (idempotent)", () => {
  const PLAN = [
    "# slug",
    "",
    "## Key assumptions to validate",
    "",
    "- **KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: unvalidated.",
    "- **KA-2** — users prefer inline preview. Validate by: A/B test. Status: unvalidated.",
    "- **KA-3** — Stripe API stays at v2024-09. Validate by: changelog check. Status: invalidated.",
    "",
    "## Spec",
    ""
  ].join("\n");

  it("AC-9 — flips a single matching KA-N row to validated by <sha>", () => {
    const updated = flipAssumptionRows(PLAN, [{ kaId: "KA-1", sha: "abc1234" }]);
    expect(updated).toContain("**KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: validated by abc1234.");
    // KA-2 stays unvalidated; KA-3 stays invalidated.
    expect(updated).toContain("**KA-2** — users prefer inline preview. Validate by: A/B test. Status: unvalidated.");
    expect(updated).toContain("Status: invalidated.");
  });

  it("AC-9 — never overrides existing validated / invalidated rows", () => {
    const PLAN_WITH_VALIDATED = PLAN.replace(
      "**KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: unvalidated.",
      "**KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: validated by deadbeef."
    );
    const updated = flipAssumptionRows(PLAN_WITH_VALIDATED, [{ kaId: "KA-1", sha: "abc1234" }]);
    // Original SHA is preserved (first validation wins; first manual flip wins).
    expect(updated).toContain("Status: validated by deadbeef.");
    expect(updated).not.toContain("Status: validated by abc1234.");
  });

  it("AC-9 — silently drops unknown KA-N ids", () => {
    const updated = flipAssumptionRows(PLAN, [{ kaId: "KA-99", sha: "abc1234" }]);
    expect(updated).toBe(PLAN);
  });

  it("AC-9 — is idempotent (re-running on its own output is a no-op)", () => {
    const once = flipAssumptionRows(PLAN, [{ kaId: "KA-1", sha: "abc1234" }]);
    const twice = flipAssumptionRows(once, [{ kaId: "KA-1", sha: "abc1234" }]);
    expect(twice).toBe(once);
  });

  it("AC-9 — first validation wins on duplicate kaId entries", () => {
    const updated = flipAssumptionRows(PLAN, [
      { kaId: "KA-1", sha: "first123" },
      { kaId: "KA-1", sha: "second456" }
    ]);
    expect(updated).toContain("Status: validated by first123.");
    expect(updated).not.toContain("Status: validated by second456.");
  });

  it("AC-9 — flips multiple rows in one pass", () => {
    const updated = flipAssumptionRows(PLAN, [
      { kaId: "KA-1", sha: "aaa1111" },
      { kaId: "KA-2", sha: "bbb2222" }
    ]);
    expect(updated).toContain("KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: validated by aaa1111.");
    expect(updated).toContain("KA-2** — users prefer inline preview. Validate by: A/B test. Status: validated by bbb2222.");
  });
});

describe("v8.85 — collectValidations + unvalidatedKaIds helpers", () => {
  const PLAN = [
    "## Key assumptions to validate",
    "",
    "- **KA-1** — bet 1. Validate by: bench. Status: unvalidated.",
    "- **KA-2** — bet 2. Validate by: A/B. Status: unvalidated.",
    "- **KA-3** — bet 3. Validate by: log query. Status: validated by deadbeef.",
    ""
  ].join("\n");

  it("AC-10 — collectValidations dedups (kaId, sha) pairs across commits", () => {
    const commits = [
      { sha: "abc1234", message: "verify(AC-1): passing\n\nvalidates: KA-1" },
      { sha: "abc1234", message: "verify(AC-1): passing\n\nvalidates: KA-1" },
      { sha: "def5678", message: "verify(AC-2): passing\n\nvalidates: KA-2 KA-1" },
      { sha: "no-payload", message: "verify(AC-3): passing" }
    ];
    const result = collectValidations(commits);
    expect(result).toEqual([
      { kaId: "KA-1", sha: "abc1234" },
      { kaId: "KA-2", sha: "def5678" },
      { kaId: "KA-1", sha: "def5678" }
    ]);
  });

  it("AC-10 — unvalidatedKaIds returns ids whose status is still `unvalidated`", () => {
    expect(unvalidatedKaIds(PLAN)).toEqual(["KA-1", "KA-2"]);
  });

  it("AC-10 — unvalidatedKaIds returns [] when every row is validated / invalidated", () => {
    const allValidated = PLAN.replace(/Status: unvalidated\./g, "Status: validated by aaa1111.");
    expect(unvalidatedKaIds(allValidated)).toEqual([]);
  });
});

describe("v8.85 — GateEnvelope type carries the `walkAssumptionCoverageAxis` field", () => {
  it("AC-11 — `walkAssumptionCoverageAxis: true` is accepted as a GateEnvelope field", () => {
    const env: GateEnvelope = { walkAssumptionCoverageAxis: true };
    const skill = AUTO_TRIGGER_SKILLS.find(
      (s) => s.id === ASSUMPTION_COVERAGE_SKILL_ID
    )!;
    expect(skill.gate!(env)).toBe(true);
  });
});

describe("v8.85 — README updates", () => {
  let readme: string;

  it("AC-12 — README references an axis count >= 13 (live tripwire defers exact integer to v8.86+; v8.85 baseline = 13)", async () => {
    readme = await fs.readFile(
      path.join(PROJECT_ROOT, "README.md"),
      "utf-8"
    );
    // v8.85 introduced "13 axes"; v8.86 bumped to "14 axes". This
    // tripwire was relaxed to "not stale at v8.84 baseline" — the
    // exact current count lives in the v8.86 test file.
    expect(readme).not.toContain("12 axes");
  });

  it("AC-12 — README's gated-axis list names `assumption-coverage` alongside qa-evidence / nfr-compliance / design-quality / scope-drift", () => {
    expect(readme).toMatch(/`assumption-coverage`/);
    expect(readme).toMatch(/`qa-evidence`/);
    expect(readme).toMatch(/`nfr-compliance`/);
    expect(readme).toMatch(/`design-quality`/);
    expect(readme).toMatch(/`scope-drift`/);
  });

  it("AC-12 — README references a skills count ≥34 (live tripwire defers exact integer to v8.86+; v8.85 baseline = 34)", () => {
    // v8.85 introduced "34 skills"; v8.86 bumped to "35 skills".
    // Relaxed to "not stale at v8.84 baseline".
    expect(readme).not.toContain("33 skills");
  });

  it("AC-12 — README's reviewer-axis cohort line names `reviewer-axis-assumption-coverage`", () => {
    expect(readme).toContain("reviewer-axis-assumption-coverage");
  });

  it("AC-12 — README cites the v8.85 work + the validates: KA-N closure loop", () => {
    expect(readme).toMatch(/v8\.85/);
    expect(readme).toMatch(/validates:\s*KA-N/);
    expect(readme).toMatch(/assumption-validation lite/i);
  });
});

describe("v8.85 — version bump + CHANGELOG entry", () => {
  it("AC-13 — package.json bumps to at least 8.90.0", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(90);
  });

  it("AC-13 — CHANGELOG.md carries an entry naming the v8.85 work (Assumption-validation lite)", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/v8\.85/);
    expect(changelog).toMatch(/Assumption-validation\s+lite/i);
  });
});

describe("v8.85 — reviewer-axis skill cohort grew from 6 to 7 (companion-skill pattern preserved; v8.86 grows the cohort to 8)", () => {
  it("AC-14 — reviewer-axis cohort includes the v8.83 five + v8.84 scope-drift + v8.85 assumption-coverage (exact-length pin relaxed; current count lives in v8.86+ tripwire)", () => {
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) =>
      s.id.startsWith("reviewer-axis-")
    );
    expect(reviewerAxisSkills.length).toBeGreaterThanOrEqual(7);
    const ids = reviewerAxisSkills.map((s) => s.id);
    for (const required of [
      "reviewer-axis-assumption-coverage",
      "reviewer-axis-design-quality",
      "reviewer-axis-edit-discipline",
      "reviewer-axis-nfr-compliance",
      "reviewer-axis-qa-evidence",
      "reviewer-axis-scope-drift",
      "reviewer-axis-security"
    ]) {
      expect(ids, `reviewer-axis cohort missing ${required}`).toContain(required);
    }
  });

  it("AC-14 — every reviewer-axis skill follows the v8.83 contract: stages = [\"review\"], gate predicate defined, body ≥3k chars, fileName matches id", () => {
    const reviewerAxisSkills = AUTO_TRIGGER_SKILLS.filter((s) =>
      s.id.startsWith("reviewer-axis-")
    );
    for (const skill of reviewerAxisSkills) {
      expect(skill.stages, `${skill.id} stages`).toEqual(["review"]);
      expect(typeof skill.gate, `${skill.id} gate`).toBe("function");
      expect(skill.body.length, `${skill.id} body length`).toBeGreaterThan(3000);
      expect(skill.fileName, `${skill.id} fileName`).toBe(`${skill.id}.md`);
    }
  });
});
