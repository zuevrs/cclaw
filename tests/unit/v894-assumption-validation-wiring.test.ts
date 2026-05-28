import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  parseVerifyCommitLog,
  renderUnvalidatedAssumptionsBody,
  replaceUnvalidatedAssumptionsSection,
  unvalidatedHighStakesKaIds,
  parseAssumptionRows
} from "../../src/assumption-validation.js";
import type { GateEnvelope } from "../../src/content/skills.js";

/**
 * v8.94 — assumption-validation lite module surface.
 *
 * v8.85 declared the assumption-validation module; v8.94 documented
 * the post-build flow that consumes its pure helpers (the LLM parses
 * `verify(AC-N): passing` commit messages for `validates: KA-N`
 * payloads and flips matching plan.md rows via the helpers below).
 *
 * v8.109 honesty sweep — dropped the `runCompoundAndShip` end-to-end
 * tripwires (the TS runtime helper was deleted as dead code; cclaw
 * is a prompt toolkit, the LLM performs the flow via the helpers
 * cited above). The pure-function module tests below remain the
 * canonical contract for the assumption-validation surface.
 */

const PROJECT_ROOT = path.resolve(process.cwd());

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
    expect(body).toContain("**KA-1** — search p95 stays under 200ms (high-stakes)");
    expect(body).toContain("`unvalidated` at ship time");
    expect(body).toContain("**KA-3** — Stripe API stays at v2024-09");
    expect(body).not.toContain("**KA-2**");
  });

  it("AC-3 — renders `All key assumptions validated.` when no unvalidated rows", () => {
    const allValidated = PLAN.replace(/Status: unvalidated\./gu, "Status: validated by aaa1111.");
    const rows = parseAssumptionRows(allValidated);
    expect(renderUnvalidatedAssumptionsBody(rows)).toBe("All key assumptions validated.");
  });

  it("AC-3 — renders `All key assumptions validated.` when no rows at all (legacy plan)", () => {
    const legacyPlan = [
      "# slug",
      "",
      "## Plan / Slices",
      "",
      "- SL-1",
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
