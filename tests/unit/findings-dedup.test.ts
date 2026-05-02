import fs from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildDedupHeader,
  classifyAndPersistFindings,
  fingerprintFinding,
  findingsDedupCachePathFor,
  formatFindingStatusTag,
  normalizeFindingDetail
} from "../../src/artifact-linter/findings-dedup.js";
import type { LintFinding } from "../../src/artifact-linter/shared.js";
import { createTempProject } from "../helpers/index.js";

function finding(overrides: Partial<LintFinding> = {}): LintFinding {
  return {
    section: "section-a",
    required: false,
    rule: "rule-x",
    found: false,
    details: "details go here",
    ...overrides
  };
}

describe("findings-dedup: fingerprint + normalization", () => {
  it("produces identical fingerprints for functionally identical findings across runs", () => {
    const one = finding({ details: "found 3 approach detail card(s) for run-abc123 at 2026-05-02T12:34:56Z" });
    const two = finding({ details: "found 5 approach detail card(s) for run-xyz987 at 2026-05-03T09:10:11Z" });
    const fp1 = fingerprintFinding("brainstorm", one);
    const fp2 = fingerprintFinding("brainstorm", two);
    expect(fp1).toBe(fp2);
  });

  it("normalizeFindingDetail collapses whitespace and lowercases the string", () => {
    const raw = "  Found  3   Approach   cards!\n";
    const normalized = normalizeFindingDetail(raw);
    expect(normalized).toBe("found <n> approach cards!");
  });

  it("formatFindingStatusTag renders each status as a short tag", () => {
    expect(formatFindingStatusTag({ kind: "new" })).toBe("[new]");
    expect(formatFindingStatusTag({ kind: "resolved" })).toBe("[resolved]");
    expect(formatFindingStatusTag({ kind: "repeat", count: 4 })).toBe("[repeat:4]");
  });
});

describe("findings-dedup: classifyAndPersistFindings", () => {
  it("marks first run findings as new and persists a sidecar", async () => {
    const root = await createTempProject("findings-dedup-first-run");
    const now = new Date("2026-05-02T22:00:00Z");
    const result = await classifyAndPersistFindings(
      root,
      "brainstorm",
      [finding({ rule: "rule-a", details: "detail 1" }), finding({ rule: "rule-b", details: "detail 2" })],
      { now }
    );
    expect(result.summary.newCount).toBe(2);
    expect(result.summary.repeatCount).toBe(0);
    expect(result.summary.resolvedCount).toBe(0);
    expect(result.header).toContain("2 new");
    expect(result.classified.every((c) => c.status.kind === "new")).toBe(true);

    const cachePath = findingsDedupCachePathFor(root);
    const raw = await fs.readFile(cachePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed.schemaVersion).toBe(1);
  });

  it("marks repeats as repeat:N and resolved findings as resolved on the next run", async () => {
    const root = await createTempProject("findings-dedup-repeat-resolved");
    const findingsFirst = [
      finding({ rule: "rule-a", details: "detail 1" }),
      finding({ rule: "rule-b", details: "detail 2" })
    ];
    await classifyAndPersistFindings(root, "brainstorm", findingsFirst, {
      now: new Date("2026-05-02T22:00:00Z")
    });
    const findingsSecond = [
      finding({ rule: "rule-a", details: "detail 1" }),
      finding({ rule: "rule-c", details: "detail 3" })
    ];
    const second = await classifyAndPersistFindings(root, "brainstorm", findingsSecond, {
      now: new Date("2026-05-02T22:05:00Z")
    });
    expect(second.summary.newCount).toBe(1);
    expect(second.summary.repeatCount).toBe(1);
    expect(second.summary.resolvedCount).toBe(1);
    const [firstStatus, secondStatus] = second.classified.map((c) => c.status);
    expect(firstStatus).toEqual({ kind: "repeat", count: 2 });
    expect(secondStatus).toEqual({ kind: "new" });
    expect(second.summary.resolved.map((r) => r.rule)).toContain("rule-b");
  });

  it("segregates findings by stage and does not cross-pollinate", async () => {
    const root = await createTempProject("findings-dedup-by-stage");
    await classifyAndPersistFindings(
      root,
      "brainstorm",
      [finding({ rule: "brainstorm-rule", details: "detail" })],
      { now: new Date("2026-05-02T22:00:00Z") }
    );
    const scope = await classifyAndPersistFindings(
      root,
      "scope",
      [finding({ rule: "brainstorm-rule", details: "detail" })],
      { now: new Date("2026-05-02T22:05:00Z") }
    );
    expect(scope.summary.newCount).toBe(1);
    expect(scope.summary.repeatCount).toBe(0);
    expect(scope.summary.resolvedCount).toBe(0);
  });
});

describe("findings-dedup: header builder", () => {
  it("returns '' when there is nothing to report", () => {
    expect(
      buildDedupHeader("brainstorm", {
        newCount: 0,
        repeatCount: 0,
        resolvedCount: 0,
        resolved: []
      })
    ).toBe("");
  });

  it("enumerates non-zero counters in canonical order", () => {
    const header = buildDedupHeader("scope", {
      newCount: 1,
      repeatCount: 2,
      resolvedCount: 3,
      resolved: []
    });
    expect(header).toBe("linter findings (stage=scope): 1 new, 2 repeat, 3 resolved.");
  });
});
