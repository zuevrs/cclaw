import { describe, expect, it } from "vitest";

import {
  ON_DEMAND_RUNBOOKS,
  ON_DEMAND_RUNBOOKS_INDEX_SECTION
} from "../../src/content/runbooks-on-demand.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";

/**
 * v8.83 — Token compression: orchestrator runbook duplicates.
 *
 * Before v8.83, `src/content/start-command.ts` inlined the BODIES of
 * several runbooks even though `src/content/runbooks-on-demand.ts`
 * already defined the canonical procedure (or could). The duplication
 * was ~6-10k chars / ~1.8-3k tokens depending on harness tokenizer.
 *
 * v8.83 lifts four sections off start-command.ts into runbook refs +
 * short summaries:
 *
 *   - Detect — `/cc` invocation matrix → `runbooks/detect-matrix.md`
 *     (NEW; the matrix was inlined verbatim — extracted first, ref'd
 *     second; still mirrored in `skills/flow-resume.md` as the
 *     harness-level resume tooling reference).
 *   - Phase 1.5 Approaches Gate → `runbooks/approaches-gate.md` (NEW).
 *   - One-way Door Gate → `runbooks/one-way-door-gate.md` (NEW).
 *   - Debug-branch routing → `runbooks/debug-branch.md` (existing;
 *     v8.83 trims the routing matrix table, cap+stop-and-report block,
 *     envelope mutations table, and flow-state.json patches list down
 *     to bullets + a §-pointer back to the runbook).
 *
 * Tripwires below pin: (1) the four trimmed sections now reference
 * their canonical runbooks by file name; (2) the three new runbooks
 * exist + are non-trivial; (3) the inlined duplicate prose is gone
 * (assert against unique long phrases that lived in start-command but
 * were duplicates of the runbook's procedure); (4) start-command body
 * char count was reduced from the v8.82 baseline by ≥3% (a concrete
 * threshold based on measurement — the test pinning constraints from
 * v8.77 / v8.79 / v8.81 prevent further trimming without breaking
 * canonical-contract pin tests, so the achievable reduction is bounded
 * by the test pin surface).
 */

// The v8.82 main-branch baseline of the rendered START_COMMAND_BODY (after
// template-literal evaluation; ${TRIAGE_PERSIST_EXAMPLE} / ${SUMMARY_RETURN_EXAMPLE} /
// ${SPECIALIST_LIST} / ${ON_DEMAND_RUNBOOKS_INDEX_SECTION} all expanded). Measured
// on `main@HEAD` immediately before this slug branched. Do not edit casually —
// AC-7 is the regression gate that lights up if a future slug re-inlines a
// lifted runbook body.
const V882_BASELINE_CHARS = 141769;

describe("v8.83 — runbooks-on-demand.ts gains three new lift runbooks", () => {
  it("AC-1 — `detect-matrix` runbook is registered with the expected fileName + id", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "detect-matrix");
    expect(runbook).toBeDefined();
    expect(runbook?.fileName).toBe("detect-matrix.md");
    expect(runbook?.body.length).toBeGreaterThan(2000);
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
  });

  it("AC-1 — `approaches-gate` runbook is registered with the expected fileName + id", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "approaches-gate");
    expect(runbook).toBeDefined();
    expect(runbook?.fileName).toBe("approaches-gate.md");
    expect(runbook?.body.length).toBeGreaterThan(2000);
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
  });

  it("AC-1 — `one-way-door-gate` runbook is registered with the expected fileName + id", () => {
    const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "one-way-door-gate");
    expect(runbook).toBeDefined();
    expect(runbook?.fileName).toBe("one-way-door-gate.md");
    expect(runbook?.body.length).toBeGreaterThan(2000);
    expect(runbook?.body).toMatch(/^# On-demand runbook — /m);
  });

  it("AC-1 — every new runbook is surfaced in the index section", () => {
    for (const fileName of ["detect-matrix.md", "approaches-gate.md", "one-way-door-gate.md"]) {
      expect(ON_DEMAND_RUNBOOKS_INDEX_SECTION).toContain(fileName);
    }
  });
});

describe("v8.83 — start-command.ts references the lifted runbooks", () => {
  it("AC-2 — start-command body references `detect-matrix.md` by file name", () => {
    expect(START_COMMAND_BODY).toContain("detect-matrix.md");
  });

  it("AC-2 — start-command body references `approaches-gate.md` by file name", () => {
    expect(START_COMMAND_BODY).toContain("approaches-gate.md");
  });

  it("AC-2 — start-command body references `one-way-door-gate.md` by file name", () => {
    expect(START_COMMAND_BODY).toContain("one-way-door-gate.md");
  });

  it("AC-2 — Debug-branch routing section still references `debug-branch.md` (unchanged runbook)", () => {
    expect(START_COMMAND_BODY).toContain("debug-branch.md");
  });
});

describe("v8.83 — detect-matrix runbook covers the canonical /cc dispatch matrix", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "detect-matrix");

  it("AC-3 — detect-matrix runbook enumerates every canonical invocation × active-flow shape", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/Continue silently/);
    expect(body).toMatch(/No active flow\. Start with/);
    expect(body).toMatch(/Active flow: <slug>/);
    expect(body).toMatch(/No active flow to cancel/);
    expect(body).toMatch(/\/cc <task>/);
    expect(body).toMatch(/\/cc research <topic>/);
    expect(body).toMatch(/\/cc extend <slug> <task>/);
    expect(body).toMatch(/\/cc-cancel/);
  });

  it("AC-3 — detect-matrix runbook documents the v8.78 / v8.71 research-state sub-commands", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/\/cc research go/);
    expect(body).toMatch(/\/cc research revise/);
    // push-back and accept appear in the same matrix row collapsed onto the
    // revise prefix (`revise <area>` / `push-back <claim>` / `accept`); the
    // tokens are runbook-level enums, not literal `/cc research ` prefixes.
    expect(body).toMatch(/push-back/);
    expect(body).toMatch(/v8\.71/);
    expect(body).toMatch(/v8\.78/);
    expect(body).toMatch(/researchState/);
  });

  it("AC-3 — detect-matrix runbook names the v8.61 retirement of the resume picker", () => {
    const body = runbook?.body ?? "";
    // The picker tokens may be cited as "retired" prose for the v8.61 cutover
    // anchor, but the runbook MUST NOT carry the live `[r] resume / [s] save /
    // [n] new` picker as an instruction.
    expect(body).toMatch(/v8\.61 retired|retired it|Resume picker prose.*gone/i);
  });
});

describe("v8.83 — approaches-gate runbook covers the canonical Phase 1.5 procedure", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "approaches-gate");

  it("AC-4 — approaches-gate runbook names the 2-3 framing cap + worked example anchors", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/2-3/);
    expect(body).toMatch(/framing/i);
    // worked example anchor: caching / search
    expect(body).toMatch(/caching/i);
    expect(body).toMatch(/search/i);
  });

  it("AC-4 — approaches-gate runbook documents the picker grammar + 'all' default", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/Pick one/);
    expect(body).toMatch(/"all"|all[\s\S]{0,40}every framing/i);
    expect(body).toMatch(/default/);
  });

  it("AC-4 — approaches-gate runbook references obra-superpowers + addyosmani / idea-refine reference patterns", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/obra/i);
    expect(body).toMatch(/idea-refine|addyosmani/i);
  });

  it("AC-4 — approaches-gate runbook documents flow-state.json > approaches + selectedApproaches stamping", () => {
    const body = runbook?.body ?? "";
    expect(body).toContain("approaches");
    expect(body).toContain("selectedApproaches");
    expect(body).toContain("ResearchApproach");
  });

  it("AC-4 — approaches-gate runbook wires push-back as the mid-research re-framing path (v8.71)", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/push-back/);
    expect(body).toMatch(/v8\.71/);
  });
});

describe("v8.83 — one-way-door-gate runbook covers the canonical v8.79 state machine", () => {
  const runbook = ON_DEMAND_RUNBOOKS.find((r) => r.id === "one-way-door-gate");

  it("AC-5 — one-way-door-gate runbook names the three structured-ask options", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/Choose:\s*confirm\s*\|\s*edit\s*\|\s*cancel/);
  });

  it("AC-5 — one-way-door-gate runbook documents the gate-scan trigger (Reversibility: one-way)", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/Reversibility:\s*one-way/);
    expect(body).toMatch(/plan\.md/);
  });

  it("AC-5 — one-way-door-gate runbook documents the three flow-state transitions", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/architect-complete/);
    expect(body).toMatch(/awaiting-one-way-confirmation/);
    expect(body).toMatch(/architect-revision/);
    expect(body).toMatch(/aborted/);
  });

  it("AC-5 — one-way-door-gate runbook anchors the User Sovereignty rationale (v8.74 ethos preamble link)", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/User Sovereignty/);
    expect(body).toMatch(/v8\.74/);
    expect(body).toMatch(/cross-model/i);
  });

  it("AC-5 — one-way-door-gate runbook documents the lite-ceremony exemption", () => {
    const body = runbook?.body ?? "";
    expect(body).toMatch(/triage\.ceremonyMode\s*==\s*"inline"/);
    expect(body).toMatch(/(skip|skipped)/i);
  });
});

describe("v8.83 — start-command body no longer carries the lifted duplicate prose", () => {
  // Each phrase below was inlined verbatim in start-command on the v8.82
  // baseline AND in the corresponding runbook (or could be inferred to
  // belong canonically in the runbook). v8.83 lifts the prose: the
  // runbook keeps it; start-command trims to a short summary + ref.
  //
  // The phrases are picked to be (a) long enough to be ungame-able
  // (matching them would mean re-inlining the lifted block) and (b)
  // unique to the runbook body — not test-pinned for start-command.

  it("AC-6 — start-command body no longer inlines the Approaches Gate per-step procedure", () => {
    // The numbered "Procedure:" list (steps 1-6 with sub-bullets) was a
    // 30+ line block in start-command pre-v8.83. v8.83 collapses to a
    // single-paragraph summary; the full numbered list lives in the
    // runbook §3.
    const body = START_COMMAND_BODY;
    // The discovery-Phase distillation paragraph anchor (long, unique).
    const longApproachesPhrase =
      "Stamp `flow-state.json > approaches`** as a {@link ResearchApproach}";
    expect(body).not.toContain(longApproachesPhrase);
  });

  it("AC-6 — start-command body no longer inlines the four sub-cases block from Approaches Gate", () => {
    // The "**Sub-cases:**" bullet list with `Only one obvious framing emerges from the dialogue` lead was inlined; lifted to runbook §4.
    expect(START_COMMAND_BODY).not.toContain("**Only one obvious framing emerges from the dialogue**");
  });

  it("AC-6 — start-command body no longer inlines the Debug-branch routing-matrix table", () => {
    // The four-row markdown table (`| direct-fix | ... | priorInvestigation envelope field |`)
    // was a major char sink. Trimmed to one-line bullets + §-pointer.
    expect(START_COMMAND_BODY).not.toMatch(
      /\|\s*`direct-fix`\s*\|\s*Skip architect entirely\.\s*Dispatch/u
    );
  });

  it("AC-6 — start-command body no longer inlines the Debug-branch cap-stop status block (code fence)", () => {
    // The verbatim `Investigator cap reached` text-fenced block lived in
    // start-command; lifted to the canonical debug-branch.md §5.
    expect(START_COMMAND_BODY).not.toMatch(
      /Investigator cap reached\n- Slug: <slug>\n- Iterations: 2 \(max\)/u
    );
  });

  it("AC-6 — start-command body no longer inlines the Debug-branch flow-state-patches bullet list", () => {
    // The dedicated `### flow-state.json patches (v8.77)` heading was
    // removed (the patch fields are now inline-summarised in the cap
    // section); the same patch list lives in debug-branch.md §3.
    expect(START_COMMAND_BODY).not.toMatch(/^### flow-state\.json patches \(v8\.77\)$/m);
  });

  it("AC-6 — start-command body no longer inlines the long /cc invocation matrix table (10-row markdown)", () => {
    // The 10-row matrix table (lines pre-v8.83 ~147-164) was the
    // canonical-contract anchor inlined and ALSO mirrored verbatim in
    // skills/flow-resume.md. v8.83 trims to the 4 canonical shapes +
    // a research-state-gated sub-command pointer + the runbook ref.
    // The unique anchor: the `## On-demand runbooks` table style row
    // referencing `/cc research go` lived ONLY in the inlined matrix
    // table on start-command (not in `flow-resume.md`'s table).
    const tableRowAnchor =
      "| `/cc research go` (v8.78) | yes (research-mode + `researchState == \"discovery\"`)";
    expect(START_COMMAND_BODY).not.toContain(tableRowAnchor);
  });
});

describe("v8.83 — start-command body shrinks measurably vs the v8.82 baseline", () => {
  it("AC-7 — start-command body char count is reduced from the v8.82 baseline by ≥3% (concrete threshold based on measurement)", () => {
    // The slug originally proposed a ≥30% reduction target but allowed
    // "set a concrete threshold based on measurement". The four lifted
    // sections are bounded by canonical-contract pin tests from
    // v8.77 / v8.79 / v8.81 / v8.76 / v8.61 that require specific
    // tokens / state-machine transitions / structured-ask payloads to
    // stay in the orchestrator body — these pins cap the achievable
    // trim. Measured savings on the four lift sections: ~5-7k chars
    // (~3-5% of the 135k-char v8.82 baseline). The threshold below
    // pins the measured win so a future re-inline regression lights up.
    const reduction = (V882_BASELINE_CHARS - START_COMMAND_BODY.length) / V882_BASELINE_CHARS;
    expect(
      reduction,
      `start-command body went from ${V882_BASELINE_CHARS} → ${START_COMMAND_BODY.length} chars (saved ${
        V882_BASELINE_CHARS - START_COMMAND_BODY.length
      } chars, ${(reduction * 100).toFixed(2)}%). Threshold: ≥3%. Re-inlining a lifted section will dip below the threshold.`
    ).toBeGreaterThanOrEqual(0.03);
  });

  it("AC-7 — body alone stays under the v8.82 baseline (no net char growth from v8.83 work)", () => {
    expect(START_COMMAND_BODY.length).toBeLessThan(V882_BASELINE_CHARS);
  });
});

describe("v8.83 — version + cross-cutting checks", () => {
  it("CHANGELOG.md contains a v8.83 entry naming the token-compression work", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const changelog = await fs.readFile(path.join(here, "../../CHANGELOG.md"), "utf8");
    expect(changelog).toMatch(/v8\.83/);
    expect(changelog).toMatch(/token[\s-]compress|token[\s-]runbooks/i);
  });

  it("package.json version is 8.88.x or later (the floor after this slug lands on top of v8.83-docs-fix @ 8.86.0 and v8.83-token-axes @ 8.87.0)", async () => {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await fs.readFile(path.join(here, "../../package.json"), "utf8"));
    const parts = String(pkg.version).split(".");
    expect(parts).toHaveLength(3);
    const major = Number(parts[0]);
    const minor = Number(parts[1]);
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(88);
  });
});
