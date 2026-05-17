import { describe, expect, it } from "vitest";

import {
  BUILDER_PROMPT,
  INVESTIGATOR_PROMPT
} from "../../src/content/specialist-prompts/index.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import {
  FLOW_STATE_SCHEMA_VERSION,
  LegacyFlowStateError,
  assertFlowStateV82,
  createInitialFlowState
} from "../../src/flow-state.js";
import type { BuilderEnvelope } from "../../src/types.js";

/**
 * v8.81 — Investigator v2: assumption audit + defense-in-depth + post-mortem.
 *
 * The v8.77 investigator (read-only diagnostic hop dispatched on
 * `triage.taskShape == "debug"`) ships three parallel hypothesis lanes
 * (`cause-code` / `cause-config` / `cause-measurement`) and emits one of
 * four verdicts (`direct-fix` / `needs-plan` / `more-investigation` /
 * `not-a-bug`). v8.81 layers three new conditional disciplines on top of
 * the existing three-lane discipline (none of them changes the existing
 * lane semantics; the v8.81 sections are additive):
 *
 *   1. **Phase 0.5 — Assumption audit.** ALWAYS runs, BEFORE the three
 *      lanes. The investigator writes a `## Assumption audit` section
 *      cataloguing the "this must be true" beliefs the symptom rests on
 *      and marking each `verified` (with cited evidence) or `assumed`
 *      (with a probe command). When the audit's probe output proves the
 *      symptom is misread, the investigator MAY short-circuit to
 *      `not-a-bug`.
 *   2. **Phase 4 — Defense-in-depth tier (CONDITIONAL).** Fires when
 *      either the root-cause pattern appears in ≥3 OTHER files
 *      (verified via a literal `rg` count probe) OR the symptom is
 *      catastrophic-if-prod (data loss / security breach / payment
 *      failure / data integrity). When fired, the investigator writes a
 *      `## Defense-in-depth (4 layers)` section: Entry validation /
 *      Invariant check / Environment guard / Diagnostic breadcrumb. The
 *      slim summary gains a `Defense-in-depth: yes` line; the
 *      orchestrator copies it onto the builder dispatch envelope.
 *   3. **Phase 5 — Post-mortem (CONDITIONAL).** Fires when the symptom
 *      source includes a production / live / users-reported / incident
 *      keyword. When fired, the investigator writes a `## Post-mortem`
 *      section: How was this introduced? / How did this survive review?
 *      / What review axis would have caught it? / Prevent-recurrence:
 *      what review check should be added? The post-mortem is advisory —
 *      it does NOT change orchestrator routing.
 *
 * Tripwires below pin the v8.81 invariants so a future change that
 * drops the audit discipline, weakens the defense-in-depth gate, or
 * silently un-wires the post-mortem trigger lights up immediately.
 */

describe("v8.81 — Phase 0.5 Assumption audit (always runs; verified vs assumed marking)", () => {
  it("AC-1 — investigator prompt declares Phase 0.5 Assumption audit BEFORE the Phase 1 three-lane fan-out", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/### Phase 0\.5 — Assumption audit/);
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const phase1Idx = INVESTIGATOR_PROMPT.indexOf("Phase 1 — Hypothesis lane fan-out");
    expect(auditIdx).toBeGreaterThan(0);
    expect(phase1Idx).toBeGreaterThan(0);
    expect(auditIdx).toBeLessThan(phase1Idx);
  });

  it("AC-1 — assumption audit phase names the verified / assumed dichotomy verbatim", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const section = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(section).toMatch(/`verified`/);
    expect(section).toMatch(/`assumed`/);
    expect(section).toMatch(/"this must be true"|this must be true/);
  });

  it("AC-1 — assumption audit phase names ALL canonical 'this must be true' belief classes (framework / function / config / caller / state / error message / symptom)", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const section = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(section).toMatch(/[Ff]ramework.*library/);
    expect(section).toMatch(/[Ff]unction returns what its name implies/);
    expect(section).toMatch(/[Cc]onfig loads/);
    expect(section).toMatch(/[Cc]aller passes/);
    expect(section).toMatch(/database.*file.*cache|state the test implies/);
    expect(section).toMatch(/[Ee]rror message/);
    expect(section).toMatch(/[Ss]ymptom description/);
  });

  it("AC-1 — assumption audit phase requires concrete evidence (file:line / command output / commit SHA / config snippet) for verified rows", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const section = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(section).toMatch(/file:line/);
    expect(section).toMatch(/command output/);
    expect(section).toMatch(/commit SHA/);
    expect(section).toMatch(/config snippet/);
  });

  it("AC-1 — assumption audit phase requires a one-line probe command for assumed rows", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const section = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(section).toMatch(/probe command|one-line probe|Probe/);
  });

  it("AC-1 — assumption audit phase declares the short-circuit to `not-a-bug` when the symptom is misread", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const section = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(section).toMatch(/short-circuit/i);
    expect(section).toMatch(/not-a-bug/);
    expect(section).toMatch(/symptom (description )?is misread|symptom is wrong/i);
  });

  it("AC-1 — assumption audit phase requires the section to be written even when short-circuiting (no silent skip)", () => {
    const auditIdx = INVESTIGATOR_PROMPT.indexOf("Phase 0.5 — Assumption audit");
    const section = INVESTIGATOR_PROMPT.slice(auditIdx, auditIdx + 6000);
    expect(section).toMatch(/still compose.*Assumption audit|compose the .*Assumption audit/);
  });

  it("AC-1 — body sections list places ## Assumption audit immediately after ## Symptom", () => {
    const bodyIdx = INVESTIGATOR_PROMPT.indexOf("Body sections (in order)");
    expect(bodyIdx).toBeGreaterThan(0);
    const list = INVESTIGATOR_PROMPT.slice(bodyIdx, bodyIdx + 3000);
    const symptomIdx = list.indexOf("`## Symptom`");
    const auditEntry = list.indexOf("`## Assumption audit`");
    expect(symptomIdx).toBeGreaterThan(0);
    expect(auditEntry).toBeGreaterThan(0);
    expect(auditEntry).toBeGreaterThan(symptomIdx);
  });
});

describe("v8.81 — Phase 4 Defense-in-depth tier (conditional; fires on ≥3 files OR catastrophic-if-prod)", () => {
  it("AC-2 — investigator prompt declares Phase 4 Defense-in-depth section as CONDITIONAL", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/### Phase 4 — Defense-in-depth tier/);
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 6000);
    expect(section).toMatch(/CONDITIONAL|conditional/);
  });

  it("AC-2 — defense-in-depth gate fires on ≥3 OTHER files (recurring pattern)", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 6000);
    expect(section).toMatch(/≥3 OTHER files|≥3 other files|3\+? other files|3\+? OTHER files/);
    expect(section).toMatch(/`rg`|rg /);
  });

  it("AC-2 — defense-in-depth gate fires on catastrophic-if-prod symptoms (data loss / security / payment / integrity)", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 6000);
    expect(section).toMatch(/[Cc]atastrophic-if-prod/);
    expect(section).toMatch(/[Dd]ata loss/);
    expect(section).toMatch(/[Ss]ecurity breach/);
    expect(section).toMatch(/[Pp]ayment failure/);
    expect(section).toMatch(/[Dd]ata integrity/);
  });

  it("AC-2 — defense-in-depth gate is independent OR (either signal fires; not AND)", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 6000);
    expect(section).toMatch(/either|OR/);
  });

  it("AC-2 — when neither signal fires, Phase 4 is skipped entirely (no speculative defense-in-depth)", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 6000);
    expect(section).toMatch(/skip Phase 4 entirely|skip the section|do NOT write/i);
    expect(section).toMatch(/[Ss]peculative defense-in-depth|generic code-hygiene/);
  });

  it("AC-3 — defense-in-depth names ALL FOUR canonical layers verbatim (Entry validation / Invariant check / Environment guard / Diagnostic breadcrumb)", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 8000);
    expect(section).toMatch(/Layer 1 — Entry validation/);
    expect(section).toMatch(/Layer 2 — Invariant check/);
    expect(section).toMatch(/Layer 3 — Environment guard/);
    expect(section).toMatch(/Layer 4 — Diagnostic breadcrumb/);
  });

  it("AC-3 — each layer is documented with what/where/how (what to add, where, how it catches the class)", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 8000);
    // Each layer has the trio "What:" / "Where:" / "How it catches the class:"
    expect((section.match(/- What:/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((section.match(/- Where:/g) ?? []).length).toBeGreaterThanOrEqual(4);
    expect((section.match(/- How it catches the class:/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("AC-3 — defense-in-depth section name in body is verbatim `## Defense-in-depth (4 layers)`", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/## Defense-in-depth \(4 layers\)/);
  });

  it("AC-4 — slim summary documents the conditional Defense-in-depth: yes|no line (required when Phase 4 fired)", () => {
    const slimIdx = INVESTIGATOR_PROMPT.indexOf("Output — slim summary");
    expect(slimIdx).toBeGreaterThan(0);
    const slim = INVESTIGATOR_PROMPT.slice(slimIdx, slimIdx + 4000);
    expect(slim).toMatch(/Defense-in-depth: <yes \| no>|Defense-in-depth:\s*<yes\s*\|\s*no>/);
  });

  it("AC-4 — builder envelope receives `defense-in-depth: <yes|no>` propagated from the slim summary", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/defense-in-depth:\s*<yes\s*\|\s*no>|defense-in-depth:\s*yes/);
    expect(INVESTIGATOR_PROMPT).toMatch(/builder dispatch envelope|builder envelope/);
  });

  it("AC-4 — when defense-in-depth: yes, builder implements all named (non-n/a) layers as part of the root-cause fix commit", () => {
    const phase4Idx = INVESTIGATOR_PROMPT.indexOf("Phase 4 — Defense-in-depth tier");
    const section = INVESTIGATOR_PROMPT.slice(phase4Idx, phase4Idx + 8000);
    expect(section).toMatch(/all named.*layers|implements.*layers/i);
    expect(section).toMatch(/part of the (root-cause )?fix commit|NOT as.*separate commits/);
  });
});

describe("v8.81 — Phase 5 Post-mortem (conditional; fires on prod-discovered symptoms)", () => {
  it("AC-5 — investigator prompt declares Phase 5 Post-mortem section as CONDITIONAL", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/### Phase 5 — Post-mortem/);
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 6000);
    expect(section).toMatch(/CONDITIONAL|conditional/);
  });

  it("AC-5 — post-mortem gate fires on prod / live / users-reported / incident keywords in the symptom", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 6000);
    for (const keyword of [
      "production",
      "live",
      "users reported",
      "incident"
    ]) {
      expect(section).toContain(keyword);
    }
  });

  it("AC-5 — post-mortem gate lists canonical incident-keyword vocabulary (P0/P1/SEV/outage/hotfix/rollback)", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 6000);
    for (const keyword of [
      "outage",
      "P0",
      "SEV-1",
      "hotfix",
      "rollback"
    ]) {
      expect(section).toContain(keyword);
    }
  });

  it("AC-5 — post-mortem section is advisory (does NOT block routing)", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 6000);
    expect(section).toMatch(/advisory/i);
    expect(section).toMatch(/does NOT block routing|does NOT change.*routing/i);
  });

  it("AC-5 — post-mortem covers ALL four canonical questions (introduced / survived review / which axis / prevent-recurrence)", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 8000);
    expect(section).toMatch(/How was this introduced\?/);
    expect(section).toMatch(/How did this survive review\?/);
    expect(section).toMatch(/What review axis would have caught it\?/);
    expect(section).toMatch(/Prevent-recurrence/);
  });

  it("AC-5 — post-mortem requires commit SHA / author / date evidence for 'how was this introduced'", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 8000);
    expect(section).toMatch(/commit SHA|Commit:.*SHA|SHA from `git log/i);
    expect(section).toMatch(/Who.*commit author|commit author name|author from .git log/);
    expect(section).toMatch(/When.*date|date from the commit/i);
  });

  it("AC-5 — post-mortem references review.md / critic.md for 'how did this survive review'", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 8000);
    expect(section).toMatch(/review\.md/);
    expect(section).toMatch(/critic\.md/);
  });

  it("AC-5 — post-mortem 'what review axis would have caught it' names exactly one axis + specific finding", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 8000);
    expect(section).toMatch(/exactly one axis|Name the \*\*one\*\* axis|the .one. axis/i);
    // Cite the 11-axis reviewer surface
    expect(section).toMatch(/11-axis|eleven-axis/);
    expect(section).toMatch(/security|error-discipline|design-quality/);
  });

  it("AC-5 — post-mortem 'prevent-recurrence' names a specific reviewer-axis check (not vague)", () => {
    const phase5Idx = INVESTIGATOR_PROMPT.indexOf("Phase 5 — Post-mortem");
    const section = INVESTIGATOR_PROMPT.slice(phase5Idx, phase5Idx + 8000);
    expect(section).toMatch(/specific (and )?testable|specific .check|one specific check/i);
    expect(section).toMatch(/MUST scan for/);
  });

  it("AC-5 — body sections list places ## Post-mortem after ## Defense-in-depth and before ## Summary", () => {
    const bodyIdx = INVESTIGATOR_PROMPT.indexOf("Body sections (in order)");
    expect(bodyIdx).toBeGreaterThan(0);
    const list = INVESTIGATOR_PROMPT.slice(bodyIdx, bodyIdx + 3000);
    const defIdx = list.indexOf("`## Defense-in-depth (4 layers)`");
    const postIdx = list.indexOf("`## Post-mortem`");
    const sumIdx = list.indexOf("`## Summary`");
    expect(defIdx).toBeGreaterThan(0);
    expect(postIdx).toBeGreaterThan(0);
    expect(sumIdx).toBeGreaterThan(0);
    expect(postIdx).toBeGreaterThan(defIdx);
    expect(sumIdx).toBeGreaterThan(postIdx);
  });
});

describe("v8.81 — builder envelope `defense-in-depth` flag (orchestrator-side wiring)", () => {
  it("AC-6 — investigator prompt declares the slim-summary `Defense-in-depth: yes|no` line drives builder envelope `defense-in-depth: <yes|no>`", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/Defense-in-depth:\s*<yes\s*\|\s*no>/);
    expect(INVESTIGATOR_PROMPT).toMatch(/defense-in-depth:\s*<yes\s*\|\s*no>|defense-in-depth:\s*yes/);
  });

  it("AC-6 — envelope flag is persisted on flow-state.json > builderEnvelope.defenseInDepth (string yes|no)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/flow-state\.json.*builderEnvelope\.defenseInDepth|builderEnvelope\.defenseInDepth/);
  });

  it("AC-6 — default on absent envelope is `no` (back-compat with pre-v8.81 state files)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/default(s)? to .?no.?|absent.*reads as no|absent.*default.*no/i);
    expect(INVESTIGATOR_PROMPT).toMatch(/pre-v8\.81|back-compat/i);
  });

  it("AC-6 — defense-in-depth: yes triggers builder to implement all named layers as part of root-cause fix commit", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/defense-in-depth:\s*yes/);
    expect(INVESTIGATOR_PROMPT).toMatch(/all named.*layers|all four.*layers|all the.*layers/i);
  });

  it("AC-6 — defense-in-depth flag is named in lowercase-kebab in the builder envelope (matches existing envelope-field convention)", () => {
    const envelopeRefs = INVESTIGATOR_PROMPT.match(/defense-in-depth:/g) ?? [];
    expect(envelopeRefs.length).toBeGreaterThanOrEqual(2);
  });
});

describe("v8.81 — back-compat: v8.77 three-lane invariants preserved on every dispatch", () => {
  it("AC-7 — three canonical lanes (cause-code / cause-config / cause-measurement) still named", () => {
    for (const lane of ["cause-code", "cause-config", "cause-measurement"]) {
      expect(INVESTIGATOR_PROMPT).toContain(lane);
    }
  });

  it("AC-7 — four canonical verdicts (direct-fix / needs-plan / more-investigation / not-a-bug) still named", () => {
    for (const verdict of ["direct-fix", "needs-plan", "more-investigation", "not-a-bug"]) {
      expect(INVESTIGATOR_PROMPT).toContain(verdict);
    }
  });

  it("AC-7 — slim summary still carries the seven required lines from v8.77", () => {
    const slimIdx = INVESTIGATOR_PROMPT.indexOf("Output — slim summary");
    const slim = INVESTIGATOR_PROMPT.slice(slimIdx, slimIdx + 4000);
    for (const field of [
      "Stage:",
      "Artifact:",
      "Lanes:",
      "Root cause:",
      "Next step:",
      "Iteration:",
      "Confidence:"
    ]) {
      expect(slim).toContain(field);
    }
  });

  it("AC-7 — investigator prompt still declares read-only contract + iteration cap from v8.77", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/read-only/i);
    expect(INVESTIGATOR_PROMPT).toMatch(/iteration|cap.*1|2 investigator dispatches/i);
  });

  it("AC-7 — investigator prompt still declares the three-lane MECE discipline + Phase 1 PARALLEL fan-out", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/MECE/);
    expect(INVESTIGATOR_PROMPT).toMatch(/PARALLEL|parallel/);
    expect(INVESTIGATOR_PROMPT).toMatch(/three\s+(parallel\s+)?hypothesis\s+lanes/i);
  });
});

describe("v8.81 — anti-rationalization table grew to cover the three new disciplines", () => {
  it("AC-8 — anti-rationalization table names the v8.81 audit-skip rationalization", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/v8\.81.*[Aa]ssumption audit|[Aa]ssumption audit.*v8\.81|skip Phase 0\.5/);
  });

  it("AC-8 — anti-rationalization table names the v8.81 lazy-short-circuit rationalization", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/short-circuit.*[Ll]azy|[Ll]azy.*short-circuit|short-circuit.*save the team|short-circuit.*not-a-bug/);
  });

  it("AC-8 — anti-rationalization table names the v8.81 strict-≥3-files defense-in-depth rationalization", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/strict.*≥3|2 other files.*close enough|3 other files.*strict/i);
  });

  it("AC-8 — anti-rationalization table names the v8.81 post-mortem-blame rationalization (evidence-only)", () => {
    expect(INVESTIGATOR_PROMPT).toMatch(/[Ee]vidence-only|read-only on attribution|[Bb]oil the [Ll]ake|process gaps.*not person gaps/);
  });

  it("AC-8 — anti-rationalization table grew by at least 8 rows over the v8.77 envelope (audit + DiD + post-mortem disciplines)", () => {
    const tableIdx = INVESTIGATOR_PROMPT.indexOf("## Anti-rationalization table");
    expect(tableIdx).toBeGreaterThan(0);
    const tableEnd = INVESTIGATOR_PROMPT.indexOf("## Composition", tableIdx);
    const tableSection = INVESTIGATOR_PROMPT.slice(tableIdx, tableEnd);
    const rowCount = (tableSection.match(/\(v8\.81\)/g) ?? []).length;
    expect(rowCount).toBeGreaterThanOrEqual(8);
  });
});

/**
 * v8.81 — Defense-in-depth envelope propagation (fix; v8.85.1).
 *
 * v8.81 declared the `defense-in-depth: yes/no` contract on the
 * investigator slim summary but never wired the downstream propagation:
 *
 *   - The orchestrator prompt (`start-command.ts`) never instructed the
 *     orchestrator to copy the flag from the slim summary onto the
 *     builder envelope or persist it on `flow-state.json`.
 *   - The builder prompt (`builder.ts`) never named the envelope field,
 *     so even if the orchestrator stamped it the builder wouldn't read
 *     it (and the "implement all named layers as part of the root-cause
 *     fix commit" rule lived only in the investigator's prompt).
 *   - The flow-state validator (`flow-state.ts`) had no clause for the
 *     persisted field, so a state file with the new field would either
 *     round-trip silently (no enforcement) or fail with a generic error.
 *
 * The v8.81 AC test suite passed because AC-4 + AC-6 only greppped the
 * investigator prompt for the contract strings; downstream propagation
 * was never verified.
 *
 * The tripwires below pin the four downstream surfaces so the gap
 * cannot reopen: the orchestrator paragraph that names the copy
 * protocol, the builder paragraph that names the read-then-implement
 * protocol, the validator's accept-yes-no / reject-bad-value behaviour,
 * and the `BuilderEnvelope` type export.
 */
describe("v8.81 defense-in-depth envelope propagation (fix)", () => {
  it("start-command.ts orchestrator prompt names the `defense-in-depth` envelope field", () => {
    expect(START_COMMAND_BODY).toMatch(/defense-in-depth/);
  });

  it("start-command.ts orchestrator prompt names the persisted `builderEnvelope.defenseInDepth` flow-state path", () => {
    expect(START_COMMAND_BODY).toMatch(/builderEnvelope\.defenseInDepth/);
  });

  it("start-command.ts orchestrator prompt instructs the orchestrator to COPY the flag from the investigator slim summary", () => {
    expect(START_COMMAND_BODY).toMatch(/Defense-in-depth:\s*<?\s*yes/i);
    expect(START_COMMAND_BODY).toMatch(/slim[-\s]summary/i);
    expect(START_COMMAND_BODY).toMatch(
      /(copies?|copy|stamp(s|ed)?|reads?) .*(Defense-in-depth|defense-in-depth|builderEnvelope)/i
    );
  });

  it("start-command.ts orchestrator prompt declares the back-compat default (absent → no) for pre-v8.81 state files", () => {
    const idx = START_COMMAND_BODY.indexOf("Defense-in-depth envelope propagation");
    expect(idx).toBeGreaterThan(0);
    const section = START_COMMAND_BODY.slice(idx, idx + 4000);
    expect(section).toMatch(/pre-v8\.81/);
    expect(section).toMatch(/default(s)? to (`?no`?|absent)/i);
  });

  it("builder.ts builder prompt names the `defense-in-depth` envelope field it reads", () => {
    expect(BUILDER_PROMPT).toMatch(/defense-in-depth/);
  });

  it("builder.ts builder prompt declares the read-then-implement protocol against `## Defense-in-depth (4 layers)`", () => {
    expect(BUILDER_PROMPT).toMatch(/## Defense-in-depth \(4 layers\)/);
    expect(BUILDER_PROMPT).toMatch(/read[-\s].*investigation\.md|reads? .*investigation\.md/i);
  });

  it("builder.ts builder prompt declares the 'implement ALL named (non-n/a) layers' rule when the flag is `yes`", () => {
    expect(BUILDER_PROMPT).toMatch(/all (named )?\(?non-n\/a\)? layers|every (named )?\(?non-n\/a\)? layer/i);
  });

  it("builder.ts builder prompt declares layers ship in the root-cause fix commit (NOT as a follow-up)", () => {
    expect(BUILDER_PROMPT).toMatch(/root-cause fix commit/i);
    expect(BUILDER_PROMPT).toMatch(/NOT as a follow-up|not a follow-up|part of (the )?root-cause fix/i);
  });

  it("types.ts exports a `BuilderEnvelope` interface with `defenseInDepth?: 'yes' | 'no'`", () => {
    // Compile-time witness: if BuilderEnvelope or the field shape regresses,
    // tsc --noEmit on this test file fails. Runtime check confirms the shape
    // accepts both literal values + absent without losing type-narrowing.
    const yes: BuilderEnvelope = { defenseInDepth: "yes" };
    const no: BuilderEnvelope = { defenseInDepth: "no" };
    const absent: BuilderEnvelope = {};
    expect(yes.defenseInDepth).toBe("yes");
    expect(no.defenseInDepth).toBe("no");
    expect(absent.defenseInDepth).toBeUndefined();
  });

  it("flow-state.ts assertFlowStateV82 ACCEPTS builderEnvelope.defenseInDepth = 'yes'", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const withYes = { ...state, builderEnvelope: { defenseInDepth: "yes" as const } };
    expect(() => assertFlowStateV82(withYes)).not.toThrow();
  });

  it("flow-state.ts assertFlowStateV82 ACCEPTS builderEnvelope.defenseInDepth = 'no'", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const withNo = { ...state, builderEnvelope: { defenseInDepth: "no" as const } };
    expect(() => assertFlowStateV82(withNo)).not.toThrow();
  });

  it("flow-state.ts assertFlowStateV82 ACCEPTS absent builderEnvelope (back-compat with pre-v8.81 state)", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    expect(() => assertFlowStateV82(state)).not.toThrow();
    expect((state as { builderEnvelope?: BuilderEnvelope }).builderEnvelope).toBeUndefined();
  });

  it("flow-state.ts assertFlowStateV82 ACCEPTS builderEnvelope = {} (field absent on the envelope itself)", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const withEmpty = { ...state, builderEnvelope: {} };
    expect(() => assertFlowStateV82(withEmpty)).not.toThrow();
  });

  it("flow-state.ts assertFlowStateV82 REJECTS invalid builderEnvelope.defenseInDepth ('maybe')", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    const bogus = { ...state, builderEnvelope: { defenseInDepth: "maybe" } };
    expect(() => assertFlowStateV82(bogus)).toThrow(/builderEnvelope\.defenseInDepth/);
  });

  it("flow-state.ts assertFlowStateV82 REJECTS non-object builderEnvelope (string, array, null)", () => {
    const state = createInitialFlowState("2026-05-18T00:00:00Z");
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: "yes" })).toThrow(/builderEnvelope/);
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: ["yes"] })).toThrow(/builderEnvelope/);
    expect(() => assertFlowStateV82({ ...state, builderEnvelope: null })).toThrow(/builderEnvelope/);
  });

  it("flow-state.ts schema version is unchanged (the envelope addition is additive + back-compat)", () => {
    // The fix lands without a schema bump because the new field is optional;
    // pre-v8.81 state files validate untouched. A future schema rev should
    // bump FLOW_STATE_SCHEMA_VERSION and surface a LegacyFlowStateError on
    // older shapes, but THIS fix is additive only.
    expect(FLOW_STATE_SCHEMA_VERSION).toBe(3);
    expect(LegacyFlowStateError).toBeDefined();
  });
});
