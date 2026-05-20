import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const repoRoot = join(__dirname, "..", "..");

/**
 * v8.109 — completed the v8.63 slice/AC migration in three lagging
 * surfaces. BUILD_TEMPLATE strict + SHIP_TEMPLATE + anti-
 * rationalizations.ts now consistently key TDD work on SL-N (slice)
 * and AC verification on the separate `verify(AC-N): passing` commit
 * shape. Reviewer-grep is dual: `(SL-N):` for slice work,
 * `verify(AC-N):` for AC verification.
 */
describe("v8.109 slice/AC migration completion", () => {
  test("artifact-templates.ts BUILD_TEMPLATE references SL-N (not red/green/refactor AC-N) for TDD cycle log", () => {
    const templates = readFileSync(join(repoRoot, "src/content/artifact-templates.ts"), "utf-8");
    const buildIdx = templates.indexOf("const BUILD_TEMPLATE = `");
    const buildEnd = templates.indexOf("\nconst BUILD_TEMPLATE_SOFT");
    expect(buildIdx).toBeGreaterThan(0);
    expect(buildEnd).toBeGreaterThan(buildIdx);
    const buildBody = templates.slice(buildIdx, buildEnd);
    expect(buildBody).toContain("(SL-N)");
    expect(buildBody).toContain("verify(AC-N): passing");
    expect(buildBody).not.toMatch(/red\(AC-N\)|green\(AC-N\)|refactor\(AC-N\)/u);
    expect(buildBody).toMatch(/git log --grep="\(SL-N\):"/u);
    expect(buildBody).toMatch(/git log --grep="verify\(AC-N\):"/u);
  });

  test("BUILD_TEMPLATE has both a slice TDD cycle log and a separate AC verification section", () => {
    const templates = readFileSync(join(repoRoot, "src/content/artifact-templates.ts"), "utf-8");
    const buildIdx = templates.indexOf("const BUILD_TEMPLATE = `");
    const buildEnd = templates.indexOf("\nconst BUILD_TEMPLATE_SOFT");
    const buildBody = templates.slice(buildIdx, buildEnd);
    expect(buildBody).toContain("## TDD cycle log");
    expect(buildBody).toContain("## AC verification");
    expect(buildBody).toMatch(/\|\s*slice\s*\|/u);
    expect(buildBody).toMatch(/\|\s*verify SHA\s*\|/u);
  });

  test("anti-rationalizations.ts commit-discipline cites SL-N + verify(AC-N), not red/green/refactor(AC-N)", () => {
    const antiRat = readFileSync(join(repoRoot, "src/content/anti-rationalizations.ts"), "utf-8");
    expect(antiRat).toContain("(SL-N)");
    expect(antiRat).toContain("verify(AC-N)");
    expect(antiRat).not.toMatch(/red\(AC-N\)|green\(AC-N\)|refactor\(AC-N\)/u);
    expect(antiRat).toMatch(/git log --grep=[\\"']*\(SL-N\):/u);
    expect(antiRat).toMatch(/git log --grep=[\\"']*verify\(AC-N\):/u);
  });

  test("SHIP_TEMPLATE has both AC verification map and Slice ↔ commit map", () => {
    const templates = readFileSync(join(repoRoot, "src/content/artifact-templates.ts"), "utf-8");
    const shipIdx = templates.indexOf("const SHIP_TEMPLATE = `");
    const shipEnd = templates.indexOf("\nconst DECISIONS_TEMPLATE");
    expect(shipIdx).toBeGreaterThan(0);
    expect(shipEnd).toBeGreaterThan(shipIdx);
    const shipBody = templates.slice(shipIdx, shipEnd);
    expect(shipBody).toContain("## AC ↔ commit map");
    expect(shipBody).toContain("Slice ↔ commit map");
    expect(shipBody).toContain("verify SHA");
    expect(shipBody).toMatch(/git log --grep="verify\(AC-N\):"/u);
    expect(shipBody).toMatch(/git log --grep="\(SL-N\):"/u);
  });

  test("zero references to red(AC-N) / green(AC-N) / refactor(AC-N) in artifact-templates.ts and anti-rationalizations.ts", () => {
    const files = [
      "src/content/artifact-templates.ts",
      "src/content/anti-rationalizations.ts"
    ];
    for (const f of files) {
      const content = readFileSync(join(repoRoot, f), "utf-8");
      expect(content, `${f} should not cite red(AC-N) / green(AC-N) / refactor(AC-N)`).not.toMatch(
        /red\(AC-N\)|green\(AC-N\)|refactor\(AC-N\)/u
      );
    }
  });
});
