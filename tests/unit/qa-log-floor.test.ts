import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ELICITATION_STAGES,
  evaluateQaLogFloor,
  extractForcingQuestions,
  parseForcingQuestionsRow,
  type ForcingQuestionTopic
} from "../../src/artifact-linter/shared.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { verifyCurrentStageGateEvidence } from "../../src/gate-evidence.js";
import { createTempProject } from "../helpers/index.js";

/**
 * Wave 24 (v6.0.0) unit fixtures for `evaluateQaLogFloor`. These pin the
 * mandatory `[topic:<id>]` tag contract that replaces Wave 23's English
 * keyword fallback. The user explicitly REJECTED a backward-compat
 * fallback because keyword matching gave false-pass results on RU/UA
 * Q&A logs.
 *
 * Convergence sources (machine contract — align with
 * `adaptiveElicitationSkillMarkdown` / `skills-elicitation.ts`):
 *   - Every forcing-question topic id is tagged `[topic:<id>]` on at
 *     least one Q&A Log row (cells joined; tag may live in any column).
 *   - Ralph-Loop path: last 2 substantive rows are no-new-decisions and
 *     count ≥ max(2, questionBudgetHint.min), except guided/deep with
 *     pending forcing topics blocks this shortcut.
 *   - Q&A Log contains an explicit user stop-signal row.
 *   - `--skip-questions` flag was persisted (downgrades to advisory).
 *   - Stage exposes no forcing-questions row (e.g. spec/plan/tdd/review/
 *     ship) AND artifact has at least one substantive row.
 *
 * Wave 24 removed:
 *   - The English keyword fallback (`topicKeywords` + `STOP_WORDS`).
 *   - Multi-token substring scoring.
 */

const FORCING_COVERAGE_QA_LOG_RU = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Какую боль мы решаем для пользователей? | Регистрация занимает 30 минут. | scope-shaping [topic:pain] |
| 2 | Какой самый прямой путь это починить? | Чек-лист самообслуживания. | architecture-shaping [topic:direct-path] |
| 3 | Кто первый оператор/пользователь? | Соло-фаундер во время онбординга. | persona-shaping [topic:operator] |
| 4 | Какие no-go границы? | Нет нового инфра в v1. | scope-shaping [topic:no-go] |
`;

const FORCING_COVERAGE_QA_LOG_EN = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | What pain are we solving for users today? | Onboarding takes 30 min. | scope-shaping [topic:pain] |
| 2 | What is the direct path to fix it? | Self-serve checklist. | architecture-shaping [topic:direct-path] |
| 3 | Who is the first operator/user affected? | Solo founder onboarding alone. | persona-shaping [topic:operator] |
| 4 | What no-go boundaries are non-negotiable? | No new infra in v1. | scope-shaping [topic:no-go] |
`;

const PARTIAL_TAG_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | What pain are we solving? | Onboarding takes 30 min. | scope-shaping [topic:pain] |
| 2 | What is the direct path to fix it? | Self-serve checklist. | architecture-shaping |
| 3 | Who is the first operator/user affected? | Solo founder onboarding alone. | persona-shaping [topic:operator] |
`;

const UNTAGGED_FULL_PROSE_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | What pain are we solving? | Onboarding takes 30 min. | scope-shaping |
| 2 | What is the direct path to fix it? | Self-serve checklist. | architecture-shaping |
| 3 | Who is the first operator/user affected? | Solo founder onboarding alone. | persona-shaping |
| 4 | What no-go boundaries are non-negotiable? | No new infra in v1. | scope-shaping |
`;

const NO_NEW_DECISIONS_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Are we OK with markdown only? | Yes | locks-format |
| 2 | Any persistence beyond filesystem? | No | locks-storage |
| 3 | Anything else to add? | no-change | continue |
| 4 | Any final concern? | nothing more | continue |
`;

const STOP_SIGNAL_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | (stop-signal) | "достаточно, давай драфт" | stop-and-draft |
`;

const UNCONVERGED_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Casual ping | hi | greeting |
`;

const ALL_SKIPPED_QA_LOG = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | Q1 | A1 | skipped |
| 2 | Q2 | A2 | waived |
`;

describe("evaluateQaLogFloor (Wave 24 / v6.0.0 mandatory [topic:<id>] contract)", () => {
  it("fails standard/brainstorm with empty Q&A Log (no convergence sources)", () => {
    const result = evaluateQaLogFloor(null, "standard", "brainstorm");
    expect(result.ok).toBe(false);
    expect(result.count).toBe(0);
    expect(result.min).toBe(0);
    expect(result.liteShortCircuit).toBe(false);
    expect(result.hasStopSignal).toBe(false);
    expect(result.noNewDecisions).toBe(false);
    expect(result.skipQuestionsAdvisory).toBe(false);
    expect(result.details).toMatch(/unconverged/iu);
    expect(result.details).toMatch(/\[pain, direct-path, operator, no-go\]/u);
  });

  it("passes RU Q&A when every forcing topic id is tagged [topic:<id>] (i18n fix)", () => {
    const result = evaluateQaLogFloor(FORCING_COVERAGE_QA_LOG_RU, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.forcingPending).toEqual([]);
    expect(result.forcingCovered.sort()).toEqual(
      ["direct-path", "no-go", "operator", "pain"]
    );
    expect(result.details).toMatch(/converged/iu);
  });

  it("passes EN Q&A with the same [topic:<id>] tags", () => {
    const result = evaluateQaLogFloor(FORCING_COVERAGE_QA_LOG_EN, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.forcingPending).toEqual([]);
  });

  it("fails when forcing topics are answered in prose but NOT tagged (no keyword fallback)", () => {
    // Wave 23 would have substring-matched these English answers. Wave 24
    // requires the explicit [topic:<id>] tag — no fallback, no rescue.
    const result = evaluateQaLogFloor(UNTAGGED_FULL_PROSE_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(false);
    expect(result.forcingCovered).toEqual([]);
    expect(result.forcingPending.sort()).toEqual(
      ["direct-path", "no-go", "operator", "pain"]
    );
    expect(result.details).toMatch(/\[pain, direct-path, operator, no-go\]/u);
    expect(result.details).toMatch(/\[topic:<id>\]/u);
  });

  it("partial tagging fails for the un-tagged topic ids only", () => {
    const result = evaluateQaLogFloor(PARTIAL_TAG_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(false);
    expect(result.forcingCovered.sort()).toEqual(["operator", "pain"]);
    expect(result.forcingPending.sort()).toEqual(["direct-path", "no-go"]);
    expect(result.details).toMatch(/\[direct-path, no-go\]/u);
  });

  it("does not let guided brainstorm converge via Ralph-Loop before the minimum discovery pass", () => {
    const result = evaluateQaLogFloor(NO_NEW_DECISIONS_QA_LOG, "standard", "brainstorm", { discoveryMode: "guided" });
    expect(result.noNewDecisions).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.details).toMatch(/minimum 5-row guided discovery pass/iu);
  });

  it("allows lean brainstorm to converge via Ralph-Loop after the minimum discovery pass", () => {
    const leanLog = `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | What pain are we solving? | Small paper-cut in release docs. | scope-shaping [topic:pain] |
| 2 | What is the direct path? | Fix the existing docs page. | direct-path [topic:direct-path] |
| 3 | Anything else? | no-change | continue |
| 4 | Final concern? | none | continue |
`;
    const result = evaluateQaLogFloor(leanLog, "quick", "brainstorm", { discoveryMode: "lean" });
    expect(result.noNewDecisions).toBe(true);
    expect(result.ok).toBe(true);
    expect(result.details).toMatch(/no-new-decisions|Ralph/iu);
  });

  it("passes via stop-signal escape hatch even with only 1 row", () => {
    const result = evaluateQaLogFloor(STOP_SIGNAL_QA_LOG, "standard", "brainstorm");
    expect(result.ok).toBe(true);
    expect(result.hasStopSignal).toBe(true);
    expect(result.details).toMatch(/stop-signal/iu);
  });

  it("downgrades unconverged Q&A to advisory under --skip-questions, surfacing pending IDs", () => {
    const result = evaluateQaLogFloor(UNCONVERGED_QA_LOG, "standard", "brainstorm", {
      skipQuestions: true
    });
    expect(result.ok).toBe(false);
    expect(result.skipQuestionsAdvisory).toBe(true);
    expect(result.details).toMatch(/--skip-questions/iu);
    expect(result.details).toMatch(/advisory/iu);
    expect(result.details).toMatch(/\[pain, direct-path, operator, no-go\]/u);
  });

  it("excludes skipped/waived rows from the substantive count", () => {
    const result = evaluateQaLogFloor(ALL_SKIPPED_QA_LOG, "standard", "brainstorm");
    expect(result.count).toBe(0);
    expect(result.ok).toBe(false);
    expect(result.hasStopSignal).toBe(false);
  });

  it("returns ok=false for non-elicitation stages with empty body (needs >= 1 substantive row)", () => {
    const result = evaluateQaLogFloor(null, "standard", "spec");
    expect(result.min).toBe(0);
    expect(result.ok).toBe(false);
  });

  it("non-elicitation stage with at least one substantive row converges", () => {
    const result = evaluateQaLogFloor(
      `## Q&A Log\n| Turn | Question | Answer | Decision impact |\n|---|---|---|---|\n| 1 | sample | yes | locks-something |\n`,
      "standard",
      "spec"
    );
    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
  });

  it("recognizes RU stop-signal phrases (хватит, достаточно, давай драфт)", () => {
    const ruStopSignal = `## Q&A Log
| Turn | Question | Answer | Disposition |
|---|---|---|---|
| 1 | sample | хватит | stop |
`;
    const result = evaluateQaLogFloor(ruStopSignal, "standard", "scope");
    expect(result.ok).toBe(true);
    expect(result.hasStopSignal).toBe(true);
  });

  it("recognizes UA stop-signal phrases (досить, вистачить, рухаємось далі)", () => {
    const uaStopSignal = `## Q&A Log
| Turn | Question | Answer | Disposition |
|---|---|---|---|
| 1 | sample | досить | stop |
`;
    const result = evaluateQaLogFloor(uaStopSignal, "standard", "design");
    expect(result.ok).toBe(true);
    expect(result.hasStopSignal).toBe(true);
  });

  it("ELICITATION_STAGES is exactly brainstorm/scope/design", () => {
    expect(Array.from(ELICITATION_STAGES).sort()).toEqual(["brainstorm", "design", "scope"]);
  });
});

describe("extractForcingQuestions (Wave 24 / v6.0.0 mandatory id: topic syntax)", () => {
  it("brainstorm returns the canonical forcing-question topic descriptors", () => {
    const topics = extractForcingQuestions("brainstorm");
    expect(topics.length).toBeGreaterThanOrEqual(4);
    const ids = topics.map((t: ForcingQuestionTopic) => t.id);
    expect(ids).toEqual(["pain", "direct-path", "operator", "no-go"]);
    expect(topics[0]).toMatchObject({ id: "pain", topic: expect.stringMatching(/pain/iu) });
  });

  it("scope returns the canonical scope topic descriptors", () => {
    const topics = extractForcingQuestions("scope");
    const ids = topics.map((t) => t.id);
    expect(ids).toEqual(["in-out", "locked-upstream"]);
  });

  it("design returns the canonical design topic descriptors", () => {
    const topics = extractForcingQuestions("design");
    const ids = topics.map((t) => t.id);
    expect(ids).toEqual(["data-flow", "seams", "invariants", "not-refactor"]);
  });

  it("returns [] for stages without a forcing-questions row", () => {
    expect(extractForcingQuestions("plan")).toEqual([]);
    expect(extractForcingQuestions("ship")).toEqual([]);
  });

  it("parser accepts the new `id: topic; id: topic; ...` syntax", () => {
    const row =
      "**Brainstorm forcing questions (must be covered or explicitly waived)** — `pain: what pain are we solving`; `direct-path: what is the direct path`. Tag the matching row.";
    const topics = parseForcingQuestionsRow(row, "test-row");
    expect(topics).toEqual([
      { id: "pain", topic: "what pain are we solving" },
      { id: "direct-path", topic: "what is the direct path" }
    ]);
  });

  it("parser throws on the legacy prose syntax (no `id:` prefixes)", () => {
    const legacyRow =
      "**Brainstorm forcing questions (must be covered or explicitly waived)** — what pain are we solving, what is the direct path, what happens if we do nothing.";
    expect(() => parseForcingQuestionsRow(legacyRow, "legacy-row")).toThrow(
      /id: topic/iu
    );
  });

  it("parser throws on a malformed id (uppercase / spaces)", () => {
    const badRow =
      "**Scope forcing questions (must be covered or explicitly waived)** — `Bad Id: a topic`; `another: another topic`.";
    expect(() => parseForcingQuestionsRow(badRow, "bad-row")).toThrow();
  });

  it("returns null for non-forcing-question checklist rows", () => {
    expect(parseForcingQuestionsRow("**Some other rule** — body", "row")).toBeNull();
  });

  it("convergence helper accepts string ids supplied as forcingQuestions option", () => {
    // Wave 24 contract: callers must pass ForcingQuestionTopic descriptors
    // (or string ids). Old keyword arrays produce predictable failures.
    const result = evaluateQaLogFloor(
      `## Q&A Log
| Turn | Question | User answer (1-line) | Decision impact |
|---|---|---|---|
| 1 | sample | yes | locks-x [topic:custom-id] |
`,
      "standard",
      "brainstorm",
      { forcingQuestions: ["custom-id"] }
    );
    expect(result.ok).toBe(true);
    expect(result.forcingCovered).toEqual(["custom-id"]);
  });
});

describe("qa log floor blocking surfaces in gate evidence (v6.9.0)", () => {
  it("pushes a structured qa_log_unconverged issue into gates.issues when blocking", async () => {
    const root = await createTempProject("qa-log-blocking-issue");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    // Brainstorm artifact with NO Q&A Log section -> floor evaluation must
    // block (no entries, no skip-questions hint, no stop signal).
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      "# Brainstorm\n\n## Context\n- placeholder\n",
      "utf8"
    );
    const state = createInitialFlowState("run-qa-block");
    state.currentStage = "brainstorm";
    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.qaLogFloor?.blocking).toBe(true);
    expect(result.issues.join("\n")).toContain("qa_log_unconverged");
    expect(result.issues.join("\n")).toContain("qa log floor blocked");
  });

  it("does not push a qa_log_unconverged issue when --skip-questions converts it to advisory", async () => {
    const root = await createTempProject("qa-log-skip-questions");
    await fs.mkdir(path.join(root, ".cclaw/state"), { recursive: true });
    await fs.mkdir(path.join(root, ".cclaw/artifacts"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".cclaw/artifacts/01-brainstorm.md"),
      "# Brainstorm\n\n## Context\n- placeholder\n",
      "utf8"
    );
    const state = createInitialFlowState("run-qa-skip");
    state.currentStage = "brainstorm";
    state.interactionHints = {
      brainstorm: {
        skipQuestions: true,
        sourceStage: "brainstorm",
        recordedAt: "2026-04-29T12:00:00.000Z"
      }
    };
    const result = await verifyCurrentStageGateEvidence(root, state);
    expect(result.qaLogFloor?.blocking).toBe(false);
    expect(result.issues.join("\n")).not.toContain("qa log floor blocked");
  });
});
