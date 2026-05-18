import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  parseVerifyCommitLog,
  renderUnvalidatedAssumptionsBody,
  replaceUnvalidatedAssumptionsSection,
  unvalidatedHighStakesKaIds,
  parseAssumptionRows
} from "../../src/assumption-validation.js";
import { runCompoundAndShip } from "../../src/compound.js";
import { activeArtifactPath, shippedArtifactPath } from "../../src/artifact-paths.js";
import { writeFileSafe } from "../../src/fs-utils.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { templateBody } from "../../src/content/artifact-templates.js";
import type { GateEnvelope } from "../../src/content/skills.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.94 — wire `src/assumption-validation.ts` into the orchestrator
 * (Phase C G-1 fix).
 *
 * v8.85 declared the assumption-validation module but never imported
 * it from any runtime entry point. The prompt surfaces (builder /
 * reviewer / skills / templates) all advertised "post-build
 * validator MAY fire" — but no orchestrator code actually invoked
 * the module, so the closure loop was prose-only. v8.94 wires the
 * module end-to-end:
 *
 *   1. `runCompoundAndShip` scans `verify(AC-*): passing` commits
 *      for `validates: KA-N` payloads BEFORE artifact moves and
 *      flips matching plan.md rows via `flipAssumptionRows`.
 *   2. The ship.md `## Unvalidated assumptions` section is rewritten
 *      from the post-flip plan.md row list via
 *      `replaceUnvalidatedAssumptionsSection`.
 *   3. The reviewer dispatch envelope grew an
 *      `unvalidatedHighStakesKas: string[]` field so the
 *      `assumption-coverage` axis skill receives the high-stakes
 *      list directly (no re-parse).
 *
 * The tripwires + behaviour tests below pin all three wirings so a
 * future change that silently disconnects any of them lights up
 * immediately.
 */

const PROJECT_ROOT = path.resolve(process.cwd());

describe("v8.94 — tripwire: src/compound.ts imports src/assumption-validation.ts", () => {
  it("AC-1 — `src/compound.ts` source file carries an import from `./assumption-validation.js`", async () => {
    const compoundPath = path.join(PROJECT_ROOT, "src/compound.ts");
    const body = await fs.readFile(compoundPath, "utf8");
    expect(body).toMatch(/import\s+\{[\s\S]*\}\s+from\s+["']\.\/assumption-validation\.js["']/u);
  });

  it("AC-1 — `src/compound.ts` imports the four core validator entry points", () => {
    return fs
      .readFile(path.join(PROJECT_ROOT, "src/compound.ts"), "utf8")
      .then((body) => {
        for (const symbol of [
          "collectValidations",
          "flipAssumptionRows",
          "parseAssumptionRows",
          "replaceUnvalidatedAssumptionsSection"
        ]) {
          expect(body).toContain(symbol);
        }
      });
  });
});

describe("v8.94 — parseVerifyCommitLog round-trips the git-log payload shape", () => {
  it("AC-2 — parses a single block", () => {
    const raw = "abc1234\nverify(AC-3): passing\n\nvalidates: KA-2\nbench: 142ms\n---END---";
    const parsed = parseVerifyCommitLog(raw);
    expect(parsed).toEqual([
      {
        sha: "abc1234",
        message: "verify(AC-3): passing\n\nvalidates: KA-2\nbench: 142ms"
      }
    ]);
  });

  it("AC-2 — parses multiple blocks separated by ---END---", () => {
    const raw = [
      "abc1234",
      "verify(AC-3): passing",
      "",
      "validates: KA-2",
      "---END---",
      "def5678",
      "verify(AC-1): passing",
      "",
      "validates: KA-1",
      "---END---"
    ].join("\n");
    const parsed = parseVerifyCommitLog(raw);
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({
      sha: "abc1234",
      message: "verify(AC-3): passing\n\nvalidates: KA-2"
    });
    expect(parsed[1]).toEqual({
      sha: "def5678",
      message: "verify(AC-1): passing\n\nvalidates: KA-1"
    });
  });

  it("AC-2 — tolerates CRLF line endings", () => {
    const raw = "abc1234\r\nverify(AC-3): passing\r\n\r\nvalidates: KA-2\r\n---END---";
    const parsed = parseVerifyCommitLog(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.sha).toBe("abc1234");
    expect(parsed[0]?.message).toContain("validates: KA-2");
  });

  it("AC-2 — pure / total on empty input", () => {
    expect(parseVerifyCommitLog("")).toEqual([]);
    // @ts-expect-error — runtime tolerance assertion.
    expect(parseVerifyCommitLog(undefined)).toEqual([]);
    // @ts-expect-error — runtime tolerance assertion.
    expect(parseVerifyCommitLog(null)).toEqual([]);
  });

  it("AC-2 — drops blocks without a SHA", () => {
    const raw = "\n---END---\nabc1234\nverify(AC-1): passing\n---END---";
    const parsed = parseVerifyCommitLog(raw);
    expect(parsed).toEqual([
      { sha: "abc1234", message: "verify(AC-1): passing" }
    ]);
  });
});

describe("v8.94 — renderUnvalidatedAssumptionsBody renders the ship.md section body", () => {
  const PLAN = [
    "# slug",
    "",
    "## Key assumptions to validate",
    "",
    "- **KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: unvalidated.",
    "- **KA-2** — users prefer inline preview. Validate by: A/B test. Status: validated by abc1234.",
    "- **KA-3** — Stripe API stays at v2024-09. Validate by: changelog check. Status: unvalidated.",
    ""
  ].join("\n");

  it("AC-3 — renders one bullet per unvalidated row", () => {
    const rows = parseAssumptionRows(PLAN);
    const body = renderUnvalidatedAssumptionsBody(rows);
    expect(body).toContain("**KA-1**");
    expect(body).toContain("**KA-3**");
    expect(body).not.toContain("**KA-2**");
    expect(body).toMatch(/Status: `unvalidated` at ship time\./);
  });

  it("AC-3 — falls back to literal `All key assumptions validated.` when no unvalidated rows", () => {
    const planAllValidated = PLAN.replace(/Status: unvalidated\./gu, "Status: validated by deadbeef.");
    const rows = parseAssumptionRows(planAllValidated);
    expect(renderUnvalidatedAssumptionsBody(rows)).toBe("All key assumptions validated.");
  });

  it("AC-3 — falls back to literal `All key assumptions validated.` on empty rows", () => {
    expect(renderUnvalidatedAssumptionsBody([])).toBe("All key assumptions validated.");
  });

  it("AC-3 — drops legacy rows without a KA-N id", () => {
    const legacyPlan = [
      "## Key assumptions to validate",
      "",
      "- **search p95 stays under 200ms** — Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const rows = parseAssumptionRows(legacyPlan);
    expect(renderUnvalidatedAssumptionsBody(rows)).toBe("All key assumptions validated.");
  });
});

describe("v8.94 — replaceUnvalidatedAssumptionsSection rewrites ship.md", () => {
  const SHIP_FIXTURE = [
    "---",
    "slug: demo",
    "stage: ship",
    "---",
    "",
    "# demo",
    "",
    "## Risks carried over",
    "",
    "_None._",
    "",
    "## Unvalidated assumptions",
    "",
    "_(template placeholder body — to be replaced.)_",
    "",
    "- **KA-N** — _`<assumption>`_. Validate by: _`<method>`_. Status: `unvalidated` at ship time.",
    "",
    "## Victory Detector",
    "",
    "ship gate body",
    ""
  ].join("\n");

  it("AC-4 — replaces the section body with the rendered bullets, preserving surrounding sections", () => {
    const PLAN = [
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet 1 (high-stakes). Validate by: bench. Status: unvalidated.",
      "- **KA-2** — bet 2. Validate by: A/B. Status: unvalidated.",
      ""
    ].join("\n");
    const rows = parseAssumptionRows(PLAN);
    const updated = replaceUnvalidatedAssumptionsSection(SHIP_FIXTURE, rows);
    expect(updated).toContain("## Unvalidated assumptions");
    expect(updated).toMatch(/- \*\*KA-1\*\* — bet 1 \(high-stakes\)\. Validate by: bench\. Status: `unvalidated` at ship time\./);
    expect(updated).toMatch(/- \*\*KA-2\*\* — bet 2\. Validate by: A\/B\. Status: `unvalidated` at ship time\./);
    expect(updated).not.toContain("template placeholder body");
    expect(updated).toContain("## Victory Detector");
    expect(updated).toContain("## Risks carried over");
  });

  it("AC-4 — collapses to `All key assumptions validated.` when no unvalidated rows", () => {
    const updated = replaceUnvalidatedAssumptionsSection(SHIP_FIXTURE, []);
    expect(updated).toContain("## Unvalidated assumptions");
    expect(updated).toContain("All key assumptions validated.");
    expect(updated).toContain("## Victory Detector");
  });

  it("AC-4 — appends the section at EOF when ship.md lacks it", () => {
    const shipWithoutSection = SHIP_FIXTURE
      .replace(/## Unvalidated assumptions[\s\S]*?(?=## Victory Detector)/u, "")
      .replace("## Victory Detector", "## Victory Detector");
    // Strip the section entirely:
    const stripped = SHIP_FIXTURE.replace(
      /## Unvalidated assumptions[\s\S]*?(?=\n## )/u,
      ""
    );
    expect(stripped).not.toContain("## Unvalidated assumptions");
    const PLAN = [
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet (high-stakes). Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const rows = parseAssumptionRows(PLAN);
    const updated = replaceUnvalidatedAssumptionsSection(stripped, rows);
    expect(updated).toContain("## Unvalidated assumptions");
    expect(updated).toMatch(/- \*\*KA-1\*\*/);
    // unused fixture-only var assertion (force linter not to drop import)
    expect(shipWithoutSection).toBeTruthy();
  });

  it("AC-4 — idempotent (re-applying with same rows yields the same body)", () => {
    const PLAN = [
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet 1 (high-stakes). Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const rows = parseAssumptionRows(PLAN);
    const once = replaceUnvalidatedAssumptionsSection(SHIP_FIXTURE, rows);
    const twice = replaceUnvalidatedAssumptionsSection(once, rows);
    expect(twice).toBe(once);
  });
});

describe("v8.94 — unvalidatedHighStakesKaIds filters by high-stakes label", () => {
  const PLAN = [
    "## Key assumptions to validate",
    "",
    "- **KA-1** — bet 1 (high-stakes). Validate by: bench. Status: unvalidated.",
    "- **KA-2** — bet 2. Validate by: A/B. Status: unvalidated.",
    "- **KA-3** — bet 3 (high-stakes). Validate by: log. Status: validated by deadbeef.",
    "- **KA-4** — bet 4 (high-stakes). Validate by: review. Status: unvalidated.",
    ""
  ].join("\n");

  it("AC-5 — returns only high-stakes + unvalidated rows", () => {
    expect(unvalidatedHighStakesKaIds(PLAN)).toEqual(["KA-1", "KA-4"]);
  });

  it("AC-5 — returns empty when every high-stakes row was validated", () => {
    const allValidated = PLAN.replace(/Status: unvalidated\./gu, "Status: validated by aaa1111.");
    expect(unvalidatedHighStakesKaIds(allValidated)).toEqual([]);
  });
});

describe("v8.94 — runCompoundAndShip wires the assumption-validation pass end-to-end", () => {
  let project: string | undefined;

  afterEach(async () => {
    if (project) await removeProject(project);
    project = undefined;
  });

  it("AC-6 — flips plan.md KA-N rows from unvalidated → validated by <sha> on synthetic verify commits", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
      lastSpecialist: null,
      startedAt: "2026-05-18T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    const planBody = [
      "# demo",
      "",
      "## Key assumptions to validate",
      "",
      "- **KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: unvalidated.",
      "- **KA-2** — users prefer inline preview. Validate by: A/B. Status: unvalidated.",
      "- **KA-3** — Stripe API stays at v2024-09. Validate by: changelog. Status: unvalidated.",
      "",
      "## Plan / Slices",
      "",
      "- SL-1"
    ].join("\n");
    const shipBody = templateBody("ship", { "SLUG-PLACEHOLDER": "demo" });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), planBody);
    await writeFileSafe(activeArtifactPath(project, "build", "demo"), "build body");
    await writeFileSafe(activeArtifactPath(project, "review", "demo"), "review body");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), shipBody);

    const result = await runCompoundAndShip(project, {
      shipCommit: "shipsha",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      outcomeProbes: { disable: true },
      assumptionProbe: {
        commits: [
          {
            sha: "ka1commit",
            message: "verify(AC-1): passing\n\nvalidates: KA-1\nbench: 142ms"
          },
          {
            sha: "ka2commit",
            message: "verify(AC-2): passing\n\nvalidates: KA-2"
          }
        ]
      }
    });

    expect(result.assumptionValidation).toBeDefined();
    expect(result.assumptionValidation?.validations).toEqual([
      { kaId: "KA-1", sha: "ka1commit" },
      { kaId: "KA-2", sha: "ka2commit" }
    ]);
    expect(result.assumptionValidation?.planUpdated).toBe(true);
    expect(result.assumptionValidation?.shipUpdated).toBe(true);
    expect(result.assumptionValidation?.unvalidatedKaIds).toEqual(["KA-3"]);
    expect(result.assumptionValidation?.unvalidatedHighStakesKaIds).toEqual([]);

    const shippedPlan = await fs.readFile(
      shippedArtifactPath(project, "demo", "plan"),
      "utf8"
    );
    expect(shippedPlan).toContain(
      "**KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: validated by ka1commit."
    );
    expect(shippedPlan).toContain(
      "**KA-2** — users prefer inline preview. Validate by: A/B. Status: validated by ka2commit."
    );
    expect(shippedPlan).toContain("**KA-3** — Stripe API stays at v2024-09. Validate by: changelog. Status: unvalidated.");
  });

  it("AC-7 — ship.md `## Unvalidated assumptions` section is populated with remaining unvalidated rows", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
      lastSpecialist: null,
      startedAt: "2026-05-18T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    const planBody = [
      "# demo",
      "",
      "## Key assumptions to validate",
      "",
      "- **KA-1** — search p95 stays under 200ms (high-stakes). Validate by: vitest bench. Status: unvalidated.",
      "- **KA-2** — users prefer inline preview. Validate by: A/B. Status: unvalidated.",
      ""
    ].join("\n");
    const shipBody = templateBody("ship", { "SLUG-PLACEHOLDER": "demo" });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), planBody);
    await writeFileSafe(activeArtifactPath(project, "build", "demo"), "build");
    await writeFileSafe(activeArtifactPath(project, "review", "demo"), "review");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), shipBody);

    const result = await runCompoundAndShip(project, {
      shipCommit: "shipsha",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      outcomeProbes: { disable: true },
      assumptionProbe: {
        commits: [
          {
            sha: "flipka2",
            message: "verify(AC-2): passing\n\nvalidates: KA-2"
          }
        ]
      }
    });

    expect(result.assumptionValidation?.unvalidatedKaIds).toEqual(["KA-1"]);
    expect(result.assumptionValidation?.unvalidatedHighStakesKaIds).toEqual(["KA-1"]);

    const shippedShip = await fs.readFile(
      shippedArtifactPath(project, "demo", "ship"),
      "utf8"
    );
    expect(shippedShip).toMatch(/## Unvalidated assumptions/);
    // KA-1 remains unvalidated; KA-2 was flipped above.
    expect(shippedShip).toMatch(
      /- \*\*KA-1\*\* — search p95 stays under 200ms \(high-stakes\)\. Validate by: vitest bench\. Status: `unvalidated` at ship time\./
    );
    expect(shippedShip).not.toMatch(/- \*\*KA-2\*\* — users prefer inline preview/);
    expect(shippedShip).not.toContain("template placeholder body");
  });

  it("AC-8 — when every KA-N row is validated, ship.md renders the literal `All key assumptions validated.` line", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
      lastSpecialist: null,
      startedAt: "2026-05-18T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    const planBody = [
      "# demo",
      "",
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet 1 (high-stakes). Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const shipBody = templateBody("ship", { "SLUG-PLACEHOLDER": "demo" });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), planBody);
    await writeFileSafe(activeArtifactPath(project, "build", "demo"), "build");
    await writeFileSafe(activeArtifactPath(project, "review", "demo"), "review");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), shipBody);

    const result = await runCompoundAndShip(project, {
      shipCommit: "shipsha",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      outcomeProbes: { disable: true },
      assumptionProbe: {
        commits: [
          {
            sha: "flipall",
            message: "verify(AC-1): passing\n\nvalidates: KA-1"
          }
        ]
      }
    });

    expect(result.assumptionValidation?.unvalidatedKaIds).toEqual([]);
    expect(result.assumptionValidation?.unvalidatedHighStakesKaIds).toEqual([]);

    const shippedShip = await fs.readFile(
      shippedArtifactPath(project, "demo", "ship"),
      "utf8"
    );
    expect(shippedShip).toContain("## Unvalidated assumptions");
    expect(shippedShip).toContain("All key assumptions validated.");
  });

  it("AC-9 — assumptionProbe.disable: true skips the entire pass (plan.md and ship.md untouched)", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
      lastSpecialist: null,
      startedAt: "2026-05-18T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    const planBody = [
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet (high-stakes). Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const shipBody = templateBody("ship", { "SLUG-PLACEHOLDER": "demo" });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), planBody);
    await writeFileSafe(activeArtifactPath(project, "build", "demo"), "build");
    await writeFileSafe(activeArtifactPath(project, "review", "demo"), "review");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), shipBody);

    const result = await runCompoundAndShip(project, {
      shipCommit: "shipsha",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      outcomeProbes: { disable: true },
      assumptionProbe: { disable: true }
    });

    expect(result.assumptionValidation?.validations).toEqual([]);
    expect(result.assumptionValidation?.planUpdated).toBe(false);
    expect(result.assumptionValidation?.shipUpdated).toBe(false);

    const shippedPlan = await fs.readFile(
      shippedArtifactPath(project, "demo", "plan"),
      "utf8"
    );
    expect(shippedPlan).toContain("Status: unvalidated.");
  });

  it("AC-10 — assumptionProbe accepts a raw git-log payload via the `gitLog` field", async () => {
    project = await createTempProject();
    await writeFlowState(project, {
      schemaVersion: 3,
      currentSlug: "demo",
      currentStage: "ship",
      ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
      lastSpecialist: null,
      startedAt: "2026-05-18T00:00:00Z",
      reviewIterations: 0,
      securityFlag: false,
      triage: null
    });
    const planBody = [
      "## Key assumptions to validate",
      "",
      "- **KA-1** — bet (high-stakes). Validate by: bench. Status: unvalidated.",
      ""
    ].join("\n");
    const shipBody = templateBody("ship", { "SLUG-PLACEHOLDER": "demo" });
    await writeFileSafe(activeArtifactPath(project, "plan", "demo"), planBody);
    await writeFileSafe(activeArtifactPath(project, "build", "demo"), "build");
    await writeFileSafe(activeArtifactPath(project, "review", "demo"), "review");
    await writeFileSafe(activeArtifactPath(project, "ship", "demo"), shipBody);

    const gitLogPayload =
      "fed1234\nverify(AC-1): passing\n\nvalidates: KA-1\n---END---";
    const result = await runCompoundAndShip(project, {
      shipCommit: "shipsha",
      signals: {
        hasArchitectDecision: false,
        reviewIterations: 0,
        securityFlag: false,
        userRequestedCapture: false
      },
      outcomeProbes: { disable: true },
      assumptionProbe: { gitLog: gitLogPayload }
    });

    expect(result.assumptionValidation?.validations).toEqual([
      { kaId: "KA-1", sha: "fed1234" }
    ]);
    const shippedPlan = await fs.readFile(
      shippedArtifactPath(project, "demo", "plan"),
      "utf8"
    );
    expect(shippedPlan).toContain("Status: validated by fed1234.");
  });
});

describe("v8.94 — GateEnvelope carries the unvalidatedHighStakesKas field", () => {
  it("AC-11 — `unvalidatedHighStakesKas: string[]` is accepted as a GateEnvelope field", () => {
    const env: GateEnvelope = {
      walkAssumptionCoverageAxis: true,
      unvalidatedHighStakesKas: ["KA-3", "KA-5"]
    };
    expect(env.unvalidatedHighStakesKas).toEqual(["KA-3", "KA-5"]);
  });

  it("AC-11 — the field is optional (legacy envelopes still validate)", () => {
    const env: GateEnvelope = { walkAssumptionCoverageAxis: true };
    expect(env.unvalidatedHighStakesKas).toBeUndefined();
  });
});

describe("v8.94 — reviewer-axis-assumption-coverage skill body cites the new envelope field", () => {
  it("AC-12 — the on-disk skill body names `unvalidatedHighStakesKas` (the v8.96 envelope field)", async () => {
    const skillPath = path.join(
      PROJECT_ROOT,
      "src/content/skills/reviewer-axis-assumption-coverage.md"
    );
    const body = await fs.readFile(skillPath, "utf8");
    expect(body).toContain("unvalidatedHighStakesKas");
    expect(body).toMatch(/v8\.96/);
  });
});

describe("v8.94 — package.json + CHANGELOG bumps", () => {
  it("AC-13 — package.json carries version 8.96.0 (or higher; parallel wave claimed v8.94/v8.95)", async () => {
    const pkg = JSON.parse(
      await fs.readFile(path.join(PROJECT_ROOT, "package.json"), "utf-8")
    ) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(96);
  });

  it("AC-13 — CHANGELOG.md carries the G-1 fix entry at v8.96+ naming the Phase C G-1 fix", async () => {
    const changelog = await fs.readFile(
      path.join(PROJECT_ROOT, "CHANGELOG.md"),
      "utf-8"
    );
    expect(changelog).toMatch(/## 8\.96\.0.*assumption-validation/i);
    expect(changelog).toMatch(/G-1|Phase C/);
  });
});
