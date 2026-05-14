import { describe, expect, it } from "vitest";

import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.48 — discipline skills triad + edit-discipline reviewer axis +
 * per-AC verified flag in slim summary.
 *
 * Three new always-on / build-stage skills consolidate previously
 * distributed rules:
 *
 * 1. `completion-discipline` (always-on) — single Iron Law concentrating
 *    "no completion claim without fresh verification evidence". Replaces
 *    the diffused enforcement across iron-laws, anti-slop,
 *    tdd-and-verification, and summary-format.
 *
 * 2. `receiving-feedback` (build/review/ship) — anti-sycophancy on the
 *    receiving side of review.md / critic.md / security-reviewer
 *    findings; mandates a four-step response pattern (Restate /
 *    Classify / Plan / Evidence) over the bare-acknowledgement reflex.
 *
 * 3. `pre-edit-investigation` (build) — GateGuard-style fact-forcing
 *    gate before the FIRST Write/Edit/MultiEdit on any file. Three
 *    mandatory probes per file: git log, rg for usage sites, full-file
 *    read. Cited in build.md's Discovery column.
 *
 * Plus two integration touchpoints:
 *
 * - Reviewer adds an `edit-discipline` axis (axis #9 in the prompt; #8
 *   non-gated). The axis runs against the per-AC commit chain (git log
 *   --grep="^[a-z]+(AC-[0-9]+)" --name-only) and cross-references touched
 *   files with plan.md's Touch surface declarations. Skips on
 *   acMode=inline; lighter coverage in acMode=soft.
 *
 * - Slim summaries grow a per-AC `AC verified:` line (yes/no per AC; the
 *   single `feature=yes|no` token in soft mode; `n/a` in inline mode).
 *   The orchestrator's finalize step refuses to advance when any AC is
 *   verified=no outside acMode=inline.
 *
 * Each tripwire below pins one invariant so an accidental regression
 * lights up immediately. The format mirrors the v8.47 / v8.45 tripwires.
 */

const ALL_SKILLS = AUTO_TRIGGER_SKILLS.map((s) => ({
  id: s.id,
  fileName: s.fileName,
  body: s.body,
  triggers: s.triggers,
  stages: s.stages,
}));

describe("v8.48 — three new discipline skills registered in AUTO_TRIGGER_SKILLS", () => {
  it("AC-1 — `completion-discipline` is registered with stages=['always']", () => {
    const skill = ALL_SKILLS.find((s) => s.id === "completion-discipline");
    expect(
      skill,
      "`completion-discipline` must be registered as an auto-trigger skill — it is the v8.48 Iron Law concentration for verification-before-completion across every specialist and every stage.",
    ).toBeDefined();
    expect(skill!.fileName).toBe("completion-discipline.md");
    expect(skill!.stages).toEqual(["always"]);
  });

  it("AC-1 — `receiving-feedback` is registered with stages=['build', 'review', 'ship']", () => {
    const skill = ALL_SKILLS.find((s) => s.id === "receiving-feedback");
    expect(
      skill,
      "`receiving-feedback` must be registered as an auto-trigger skill — the v8.48 anti-sycophancy gate for handling review/critic/security findings.",
    ).toBeDefined();
    expect(skill!.fileName).toBe("receiving-feedback.md");
    expect(skill!.stages).toEqual(["build", "review", "ship"]);
  });

  it("AC-1 — `pre-edit-investigation` is registered with stages=['build']", () => {
    const skill = ALL_SKILLS.find((s) => s.id === "pre-edit-investigation");
    expect(
      skill,
      "`pre-edit-investigation` must be registered as an auto-trigger skill — the v8.48 GateGuard-style pre-edit fact-forcing gate.",
    ).toBeDefined();
    expect(skill!.fileName).toBe("pre-edit-investigation.md");
    expect(skill!.stages).toEqual(["build"]);
  });

  it("AC-1 — total skill count is exactly 20 (17 pre-v8.48 + 3 new)", () => {
    // v8.16 = 17; v8.27-v8.33 added 5 frontier-aesthetic; v8.44 retired
    // all 5 → back to 17. v8.48 adds 3 (completion-discipline,
    // receiving-feedback, pre-edit-investigation) → 20.
    expect(AUTO_TRIGGER_SKILLS.length).toBe(20);
  });

  it("AC-1 — total skill count stays within [15, 24] range (v8.16 cleanup tolerance)", () => {
    // Belt-and-braces — this is the same band v8.16 set; v8.48's
    // additions stay inside without forcing a band edit.
    expect(AUTO_TRIGGER_SKILLS.length).toBeGreaterThanOrEqual(15);
    expect(AUTO_TRIGGER_SKILLS.length).toBeLessThanOrEqual(24);
  });
});

describe("v8.48 — completion-discipline forbidden phrases + mandatory evidence shapes", () => {
  const skill = ALL_SKILLS.find((s) => s.id === "completion-discipline");

  it("AC-2 — completion-discipline lists every brief-mandated forbidden phrase", () => {
    expect(skill).toBeDefined();
    for (const phrase of [
      '"should work"',
      '"should be fine"',
      '"probably works"',
      '"looks good"',
      '"I think this is done"',
    ]) {
      expect(
        skill!.body,
        `\`completion-discipline\` body must list the forbidden phrase ${phrase} verbatim — the phrase is the canonical sycophantic-completion-claim token the skill bans.`,
      ).toContain(phrase);
    }
  });

  it("AC-2 — completion-discipline names every mandatory evidence shape (command+exit code, test output, git log, file:line, closing-citation)", () => {
    expect(skill!.body).toMatch(/Command.*exit code|command \+ exit code/i);
    expect(skill!.body).toMatch(/Test output excerpt|test name.*assertion/i);
    expect(skill!.body).toMatch(/Git log proof|git log/i);
    expect(skill!.body).toMatch(/file:line citation/i);
    expect(skill!.body).toMatch(/Closing-citation|Findings row|status: closed/i);
  });

  it("AC-2 — completion-discipline is always-on (`always-on` trigger present)", () => {
    expect(skill!.triggers).toContain("always-on");
  });

  it("AC-2 — completion-discipline pairs with anti-slop and receiving-feedback (composition section)", () => {
    expect(skill!.body).toMatch(/anti-slop|receiving-feedback/);
    expect(skill!.body).toMatch(/Pairs with|composition/i);
  });
});

describe("v8.48 — receiving-feedback forbidden phrases + four-step pattern", () => {
  const skill = ALL_SKILLS.find((s) => s.id === "receiving-feedback");

  it("AC-3 — receiving-feedback lists every brief-mandated forbidden phrase", () => {
    expect(skill).toBeDefined();
    for (const phrase of [
      '"good point"',
      '"you\'re right"',
      '"I see your concern"',
      '"let me address that"',
    ]) {
      expect(
        skill!.body,
        `\`receiving-feedback\` body must list the forbidden phrase ${phrase} verbatim — the phrase is the canonical sycophantic-acknowledgement token the skill bans.`,
      ).toContain(phrase);
    }
  });

  it("AC-3 — receiving-feedback names the four-step response pattern (Restate / Classify / Plan / Evidence)", () => {
    for (const step of ["Restate", "Classify", "Plan", "Evidence"]) {
      expect(
        skill!.body,
        `\`receiving-feedback\` must teach the ${step} step of the four-step response pattern.`,
      ).toMatch(new RegExp(`(### Step \\d — )?${step}|${step}\\b`));
    }
  });

  it("AC-3 — receiving-feedback names the three classification values (block-ship / iterate / fyi)", () => {
    for (const cls of ["block-ship", "iterate", "fyi"]) {
      expect(skill!.body).toContain(cls);
    }
  });

  it("AC-3 — receiving-feedback names the three plan shapes (fix / push-back-with-evidence / accept-warning)", () => {
    for (const shape of ["fix", "push-back-with-evidence", "accept-warning"]) {
      expect(
        skill!.body,
        `\`receiving-feedback\` must name the ${shape} plan shape.`,
      ).toContain(shape);
    }
  });

  it("AC-3 — receiving-feedback fires on build, review, and ship stages", () => {
    expect(skill!.stages).toEqual(["build", "review", "ship"]);
  });
});

describe("v8.48 — pre-edit-investigation three-probe gate", () => {
  const skill = ALL_SKILLS.find((s) => s.id === "pre-edit-investigation");

  it("AC-4 — pre-edit-investigation names the three mandatory probes (git log / rg / full-file-read)", () => {
    expect(skill).toBeDefined();
    expect(skill!.body).toMatch(/git log --oneline -10/);
    expect(skill!.body).toMatch(/rg ".*"/);
    expect(skill!.body).toMatch(/full file read|full-file read|Full read/i);
  });

  it("AC-4 — pre-edit-investigation names the fresh-file exception with verifiable predicate", () => {
    expect(skill!.body).toMatch(/fresh file|new file|no history/i);
    // The skill must explain how to verify a fresh-file claim
    expect(skill!.body).toMatch(/git log.*<path>|git log -- <path>|not in `git log/i);
  });

  it("AC-4 — pre-edit-investigation cites the Discovery column as the durable surface", () => {
    expect(skill!.body).toMatch(/Discovery column|Discovery cell|`Discovery`/);
  });

  it("AC-4 — pre-edit-investigation references the v8.48 edit-discipline reviewer axis as the ex-post enforcement", () => {
    expect(skill!.body).toMatch(/edit-discipline/);
    expect(skill!.body).toMatch(/axis|reviewer/i);
  });

  it("AC-4 — pre-edit-investigation fires only on build stage", () => {
    expect(skill!.stages).toEqual(["build"]);
  });
});

describe("v8.48 — slice-builder prompt references pre-edit-investigation", () => {
  it("AC-5 — slice-builder prompt cites `.cclaw/lib/skills/pre-edit-investigation.md` as a hard rule", () => {
    expect(
      SLICE_BUILDER_PROMPT,
      "slice-builder prompt must cite the pre-edit-investigation skill so the slice-builder knows the gate is mandatory.",
    ).toMatch(/\.cclaw\/lib\/skills\/pre-edit-investigation\.md/);
  });

  it("AC-5 — slice-builder names the three probes in its RED phase guidance", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/git log --oneline -10/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/rg ".*"|rg "<symbol>"/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/Full file read|full file read|FULL/i);
  });

  it("AC-5 — slice-builder names the `new-file` token for the fresh-file exception", () => {
    expect(
      SLICE_BUILDER_PROMPT,
      "slice-builder must teach the explicit `new-file` token used to skip the gate; without the token the reviewer assumes the gate was silently skipped.",
    ).toMatch(/new-file/);
  });
});

describe("v8.48 — reviewer prompt adds edit-discipline axis (9th axis)", () => {
  it("AC-6 — reviewer header reflects the bumped axis count (Nine-axis review)", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer prompt must declare the v8.48 axis bump (8 → 9 axes; edit-discipline added).",
    ).toMatch(/Nine-axis review|nine axes/i);
  });

  it("AC-6 — reviewer's axis table lists `edit-discipline` with brief examples", () => {
    expect(REVIEWER_PROMPT).toMatch(/\| `edit-discipline`/);
    // The examples cell must call out the two sub-checks (touch-surface drift + missing probes)
    expect(REVIEWER_PROMPT).toMatch(/Touch surface|touchSurface/);
    expect(REVIEWER_PROMPT).toMatch(/Discovery cell|Discovery column|Discovery row/);
  });

  it("AC-6 — reviewer's per-axis checklist includes an `[edit-discipline]` block", () => {
    expect(REVIEWER_PROMPT).toMatch(/\[edit-discipline\]/);
  });

  it("AC-6 — reviewer's axes counter format includes `ed=N` for edit-discipline", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer's slim-summary axes counter must include `ed=N` so the orchestrator and the user can read the edit-discipline finding count alongside the other axes.",
    ).toMatch(/ed=N/);
  });

  it("AC-6 — reviewer cites the per-AC git-log inspection command for the touch-surface sub-check", () => {
    expect(REVIEWER_PROMPT).toMatch(/git log --grep="\^\[a-z\]\+\(AC-\[0-9\]\+\)" --name-only/);
  });

  it("AC-6 — reviewer cites the skip rules for acMode=inline (and notes acMode=soft behaviour)", () => {
    expect(REVIEWER_PROMPT).toMatch(/acMode: inline|acMode=inline/);
    expect(REVIEWER_PROMPT).toMatch(/edit-discipline.*skipped|skipped \(acMode=inline\)/i);
    expect(REVIEWER_PROMPT).toMatch(/acMode: soft|acMode=soft/);
  });

  it("AC-6 — reviewer includes the two anti-rationalization rows from the v8.48 brief", () => {
    expect(
      REVIEWER_PROMPT,
      "reviewer's edit-discipline section must teach the 'new file was just a helper' rebuttal.",
    ).toMatch(/new file was just a helper|new helper files DO count/i);
    expect(
      REVIEWER_PROMPT,
      "reviewer's edit-discipline section must teach the 'touch the schema to fix a type error' rebuttal.",
    ).toMatch(/touch the schema|schema to fix a type error/i);
  });
});

describe("v8.48 — per-AC `verified` flag in slim summary", () => {
  it("AC-7 — start-command's SUMMARY_RETURN_EXAMPLE includes the `AC verified:` line", () => {
    expect(
      START_COMMAND_BODY,
      "the canonical slim-summary example in start-command must declare the `AC verified:` line; this is the v8.48 contract every specialist's slim summary follows.",
    ).toMatch(/AC verified: <strict:.*AC-\d=yes.*AC-\d=no/);
  });

  it("AC-7 — start-command teaches the soft-mode `feature=yes` token", () => {
    expect(START_COMMAND_BODY).toMatch(/feature=yes/);
  });

  it("AC-7 — start-command teaches the inline-mode `n/a` token", () => {
    expect(START_COMMAND_BODY).toMatch(/inline.*n\/a|"n\/a"/);
  });

  it("AC-7 — start-command's hard-gate logic mentions that any `=no` outside inline blocks finalize", () => {
    expect(
      START_COMMAND_BODY,
      "start-command must teach the v8.48 finalize gate: any AC with `=no` outside acMode=inline refuses finalize.",
    ).toMatch(/=no.*finalize|finalize.*=no|any.*=no.*outside.*inline/i);
  });

  it("AC-7 — slice-builder's slim summary template includes the `AC verified:` line", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/AC verified:/);
  });

  it("AC-7 — slice-builder teaches the three slim-summary AC-verified shapes (strict / soft / inline)", () => {
    expect(SLICE_BUILDER_PROMPT).toMatch(/AC-1=yes/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/feature=yes/);
    expect(SLICE_BUILDER_PROMPT).toMatch(/inline.*n\/a|"n\/a"/);
  });

  it("AC-7 — reviewer's slim summary template includes the `AC verified:` line", () => {
    expect(REVIEWER_PROMPT).toMatch(/AC verified:/);
  });
});

describe("v8.48 — orchestrator pre-finalize per-AC verified gate", () => {
  it("AC-8 — start-command declares a `Per-AC verified gate` section before Finalize", () => {
    expect(
      START_COMMAND_BODY,
      "start-command must declare the v8.48 pre-finalize gate as its own H2; the section is the precondition the runbook reads.",
    ).toMatch(/## Per-AC verified gate/);
  });

  it("AC-8 — the gate cites both slice-builder and reviewer slim summaries as the sources of truth", () => {
    expect(START_COMMAND_BODY).toMatch(/slice-builder.*reviewer|reviewer.*slice-builder/iu);
  });

  it("AC-8 — the gate skips on acMode=inline", () => {
    expect(START_COMMAND_BODY).toMatch(/acMode.*inline.*skip|acMode == "inline".*skip|gate.*skipped/iu);
  });

  it("AC-8 — the gate refuses finalize and surfaces a structured ask when any AC has `=no`", () => {
    expect(START_COMMAND_BODY).toMatch(/refuse.*finalize|refuses.*finalize|gate.*fails/i);
    expect(START_COMMAND_BODY).toMatch(/structured ask|Options:|Bounce to slice-builder/i);
  });

  it("AC-8 — the gate does NOT auto-rescue; no `accept-unverified-and-finalize` option", () => {
    expect(
      START_COMMAND_BODY,
      "v8.48 brief: the gate must refuse silent escape hatches; the user types /cc-cancel to discard if they truly want to abandon the unverified AC.",
    ).toMatch(/never.*auto-rescue|no.*accept-unverified-and-finalize|refuses.*silent/i);
  });

  it("AC-8 — the always-ask rules section notes the pre-finalize gate (v8.48+ wiring)", () => {
    expect(START_COMMAND_BODY).toMatch(/Per-AC verified gate.*finalize|v8\.48/);
  });
});

describe("v8.48 — three new skills pass the v8.26 skill anatomy rubric", () => {
  // Re-run the v8.26 rubric specifically on the three new skills so a
  // future maintainer who drops a section in one of the new skills
  // gets a targeted failure here instead of a generic v8.26 failure.

  const NEW_SKILL_IDS = [
    "completion-discipline",
    "receiving-feedback",
    "pre-edit-investigation",
  ];

  for (const id of NEW_SKILL_IDS) {
    const skill = ALL_SKILLS.find((s) => s.id === id);

    it(`AC-9 — \`${id}\` has frontmatter (---\\nname: / trigger:)`, () => {
      expect(skill).toBeDefined();
      expect(skill!.body.startsWith("---\n")).toBe(true);
      expect(skill!.body).toMatch(/name:/);
      expect(skill!.body).toMatch(/trigger:/);
    });

    it(`AC-9 — \`${id}\` has the \`# Skill: ${id}\` H1`, () => {
      expect(skill!.body).toMatch(new RegExp(`^# Skill: ${id}`, "m"));
    });

    it(`AC-9 — \`${id}\` has an Overview body (≥20 chars before first H2)`, () => {
      const firstH2Idx = skill!.body.search(/^##\s/m);
      const overviewWindow = firstH2Idx === -1 ? skill!.body : skill!.body.slice(0, firstH2Idx);
      const overviewContent = overviewWindow
        .replace(/^---[\s\S]*?\n---\n/m, "")
        .replace(/^#\s.*$/m, "")
        .trim();
      expect(overviewContent.length).toBeGreaterThanOrEqual(20);
    });

    it(`AC-9 — \`${id}\` has a When-to-use heading`, () => {
      expect(skill!.body).toMatch(/^##\s+(When |Applies\b|Triggers\b)/m);
    });

    it(`AC-9 — \`${id}\` has a When-NOT-to-apply heading with ≥30 chars of body`, () => {
      expect(skill!.body).toMatch(
        /^##\s+(When NOT to (use|apply|invoke|trigger|run)|When this skill does NOT apply)/m,
      );
      // Find the body slice between the When-NOT heading and the next H2
      const match = /^##\s+When NOT/m.exec(skill!.body);
      expect(match).not.toBeNull();
      const after = skill!.body.slice(match!.index + match![0].length);
      const nextH2 = after.search(/^##\s/m);
      const section = nextH2 === -1 ? after : after.slice(0, nextH2);
      expect(section.trim().length).toBeGreaterThanOrEqual(30);
    });

    it(`AC-9 — \`${id}\` has ≥2 depth sections (Process / Common Rationalizations / Red Flags / Verification)`, () => {
      const hasProcess = /^##\s+Process\b/m.test(skill!.body);
      const hasRationalizations = /^##\s+Common rationalizations|^##\s+Anti-rationalization/m.test(
        skill!.body,
      );
      const hasRedFlags = /^##\s+Red flags|^##\s+Common pitfalls|^##\s+Hard rules/m.test(skill!.body);
      const hasVerification = /^##\s+Verification|^##\s+Worked example/m.test(skill!.body);
      const depth =
        (hasProcess ? 1 : 0) +
        (hasRationalizations ? 1 : 0) +
        (hasRedFlags ? 1 : 0) +
        (hasVerification ? 1 : 0);
      expect(
        depth,
        `\`${id}\` has ${depth} depth sections; the rubric requires ≥2.`,
      ).toBeGreaterThanOrEqual(2);
    });
  }
});

describe("v8.48 — install-layer compatibility (skill file references resolve)", () => {
  it("AC-10 — every cited `lib/skills/<id>.md` in slice-builder / reviewer / start-command resolves to a live AUTO_TRIGGER_SKILLS entry", async () => {
    const fileNames = new Set(AUTO_TRIGGER_SKILLS.map((s) => s.fileName));
    const sources = await Promise.all([
      import("../../src/content/specialist-prompts/slice-builder.js"),
      import("../../src/content/specialist-prompts/reviewer.js"),
      import("../../src/content/start-command.js"),
    ]);
    const corpus = sources
      .map((mod) =>
        Object.values(mod)
          .filter((v): v is string => typeof v === "string")
          .join("\n"),
      )
      .join("\n");
    const cited = new Set<string>();
    const re = /\.cclaw\/lib\/skills\/([a-z-]+\.md)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(corpus)) !== null) {
      cited.add(m[1]!);
    }
    // The three new skills must be present in the corpus (slice-builder
    // cites pre-edit-investigation; reviewer cites edit-discipline axis
    // which references the gate; completion-discipline + receiving-feedback
    // are always-on / build-review-ship and are auto-injected via
    // buildAutoTriggerBlock, not cited by literal path).
    expect(cited).toContain("pre-edit-investigation.md");
    // Smoke: every cited file resolves to a real skill (except cclaw-meta).
    for (const fileName of cited) {
      if (fileName === "cclaw-meta.md") continue;
      expect(
        fileNames,
        `cited \`lib/skills/${fileName}\` must be a live AUTO_TRIGGER_SKILLS entry`,
      ).toContain(fileName);
    }
  });
});
