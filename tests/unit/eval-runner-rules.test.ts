/**
 * Runner-level tests for Step 2: rule + traceability wiring in runEval.
 * Uses a small seeded corpus rather than the committed eval-demo snapshot
 * so we can mutate fixtures and config independently.
 */
import { describe, expect, it } from "vitest";
import { runEval } from "../../src/eval/runner.js";
import { EVALS_ROOT } from "../../src/constants.js";
import { createTempProject, writeProjectFile } from "../helpers/index.js";

const SCOPE_FIXTURE = [
  "---",
  "stage: scope",
  "---",
  "# Scope",
  "",
  "## Decisions",
  "",
  "- D-01: Cookie.",
  "- D-02: Tailwind class.",
  "- D-03: SSR hint.",
  ""
].join("\n");

const PLAN_FIXTURE_COMPLETE = [
  "---",
  "stage: plan",
  "---",
  "# Plan",
  "",
  "## Milestones",
  "",
  "- M1: implements D-01.",
  "- M2: implements D-02.",
  "- M3: implements D-03.",
  ""
].join("\n");

const PLAN_FIXTURE_PARTIAL = [
  "---",
  "stage: plan",
  "---",
  "# Plan",
  "",
  "## Milestones",
  "",
  "- M1: implements D-01 only.",
  ""
].join("\n");

async function seedRulesCase(root: string): Promise<void> {
  await writeProjectFile(
    root,
    `${EVALS_ROOT}/corpus/plan/plan-rules.yaml`,
    [
      "id: plan-rules",
      "stage: plan",
      "input_prompt: p",
      "fixture: ./plan-rules/fixture.md",
      "expected:",
      "  rules:",
      "    must_contain:",
      "      - Milestones",
      "    regex_required:",
      "      - pattern: 'M\\d+'",
      "        description: Milestone ids",
      "    min_occurrences:",
      "      'D-0': 2"
    ].join("\n")
  );
  await writeProjectFile(
    root,
    `${EVALS_ROOT}/corpus/plan/plan-rules/fixture.md`,
    PLAN_FIXTURE_COMPLETE
  );
}

async function seedTraceabilityCase(root: string, planBody: string): Promise<void> {
  await writeProjectFile(
    root,
    `${EVALS_ROOT}/corpus/plan/plan-trace.yaml`,
    [
      "id: plan-trace",
      "stage: plan",
      "input_prompt: p",
      "fixture: ./plan-trace/fixture.md",
      "extra_fixtures:",
      "  scope: ../scope/scope-trace/fixture.md",
      "expected:",
      "  traceability:",
      "    id_pattern: 'D-\\d+'",
      "    source: scope",
      "    require_in:",
      "      - self"
    ].join("\n")
  );
  await writeProjectFile(
    root,
    `${EVALS_ROOT}/corpus/plan/plan-trace/fixture.md`,
    planBody
  );
  await writeProjectFile(
    root,
    `${EVALS_ROOT}/corpus/scope/scope-trace/fixture.md`,
    SCOPE_FIXTURE
  );
}

describe("runEval - rules wiring", () => {
  it("skips rule checks by default (schema-only gate)", async () => {
    const root = await createTempProject("runner-rules-default");
    await seedRulesCase(root);
    const res = await runEval({ projectRoot: root, env: {} });
    if (!("kind" in res)) {
      const result = res.cases[0]!;
      expect(result.verifierResults.some((v) => v.kind === "rules")).toBe(false);
    }
  });

  it("runs rule verifiers when --rules is set", async () => {
    const root = await createTempProject("runner-rules-active");
    await seedRulesCase(root);
    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const result = res.cases[0]!;
      const rules = result.verifierResults.filter((v) => v.kind === "rules");
      expect(rules.length).toBeGreaterThanOrEqual(3);
      expect(rules.every((r) => r.ok)).toBe(true);
    }
  });

  it("--schema-only suppresses rules even when --rules is set", async () => {
    const root = await createTempProject("runner-rules-schema-only");
    await seedRulesCase(root);
    const res = await runEval({
      projectRoot: root,
      rules: true,
      schemaOnly: true,
      env: {}
    });
    if (!("kind" in res)) {
      const result = res.cases[0]!;
      expect(result.verifierResults.some((v) => v.kind === "rules")).toBe(false);
    }
  });

  it("reports rules=true in dry-run when --rules is set", async () => {
    const root = await createTempProject("runner-rules-dryrun");
    await seedRulesCase(root);
    const res = await runEval({
      projectRoot: root,
      rules: true,
      dryRun: true,
      env: {}
    });
    if ("kind" in res) {
      expect(res.verifiersAvailable.rules).toBe(true);
    }
  });
});

describe("runEval - traceability wiring", () => {
  it("passes when every source id appears in the primary fixture", async () => {
    const root = await createTempProject("runner-trace-pass");
    await seedTraceabilityCase(root, PLAN_FIXTURE_COMPLETE);
    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const traceResult = res.cases
        .flatMap((c) => c.verifierResults)
        .find((v) => v.id === "traceability:scope->self");
      expect(traceResult?.ok).toBe(true);
    }
  });

  it("fails with missing ids listed when traceability breaks", async () => {
    const root = await createTempProject("runner-trace-fail");
    await seedTraceabilityCase(root, PLAN_FIXTURE_PARTIAL);
    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const traceResult = res.cases
        .flatMap((c) => c.verifierResults)
        .find((v) => v.id === "traceability:scope->self");
      expect(traceResult?.ok).toBe(false);
      const missing = (traceResult?.details as { missing: string[] }).missing;
      expect(missing).toEqual(["D-02", "D-03"]);
    }
  });

  it("emits a structured error when an extra fixture is missing", async () => {
    const root = await createTempProject("runner-trace-missing-extra");
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/corpus/plan/plan-trace.yaml`,
      [
        "id: plan-trace",
        "stage: plan",
        "input_prompt: p",
        "fixture: ./plan-trace/fixture.md",
        "extra_fixtures:",
        "  scope: ../scope/missing/fixture.md",
        "expected:",
        "  traceability:",
        "    id_pattern: 'D-\\d+'",
        "    source: scope",
        "    require_in:",
        "      - self"
      ].join("\n")
    );
    await writeProjectFile(
      root,
      `${EVALS_ROOT}/corpus/plan/plan-trace/fixture.md`,
      PLAN_FIXTURE_COMPLETE
    );
    const res = await runEval({ projectRoot: root, rules: true, env: {} });
    if (!("kind" in res)) {
      const fail = res.cases[0]!.verifierResults.find(
        (v) => v.id === "traceability:fixture:missing"
      );
      expect(fail?.ok).toBe(false);
    }
  });
});
