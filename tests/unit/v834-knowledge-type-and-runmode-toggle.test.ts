import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { renderStartCommand } from "../../src/content/start-command.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import {
  PROBLEM_TYPES,
  appendKnowledgeEntry,
  findNearKnowledge,
  knowledgeLogPath,
  readKnowledgeLog,
  type KnowledgeEntry,
  type ProblemType
} from "../../src/knowledge-store.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.34 — knowledge problemType field + mid-flight runMode toggle.
 *
 * Two paired additions from the five-audit review.
 *
 * Item 5 (everyinc pattern): KnowledgeEntry gains optional
 * `problemType: "bug" | "knowledge" | "decision" | "performance" |
 * "refactor"`. `findNearKnowledge` accepts an optional `problemType`
 * filter. `cclaw knowledge` CLI gains a `--type <kind>` filter.
 * Backward compat: missing field reads as `undefined` and surfaces as
 * "knowledge" (the prior implicit default).
 *
 * Item 6 (flow-complexity audit): mid-flight runMode toggle. The user
 * invokes `/cc --mode=auto` or `/cc --mode=step` to flip
 * `triage.runMode` mid-flow. The toggle persists across `/cc`
 * invocations (the next `/cc` reads the patched runMode); the toggle is
 * allowed mid-flow (not just at resume); the inline path rejects the
 * toggle with the literal note "inline path has no runMode".
 *
 * The tripwire pins:
 *   AC-1 — `ProblemType` exports the canonical 5-element union and the
 *          shape is locked.
 *   AC-2 — KnowledgeEntry round-trips problemType (write → read).
 *   AC-3 — `findNearKnowledge` accepts a `problemType` filter and only
 *          returns entries whose `problemType` matches (case-sensitive).
 *   AC-4 — back-compat: entries without `problemType` still validate
 *          and `findNearKnowledge` returns them when the filter is
 *          absent.
 *   AC-5 — start-command.ts documents `/cc --mode=auto` and
 *          `/cc --mode=step`, describes the inline-path rejection
 *          message, and pins runMode as the only mutable triage field.
 *   AC-6 — flow-resume.md documents the toggle (the resume-time entry
 *          point for `/cc --mode=...`).
 */

const SKILLS = AUTO_TRIGGER_SKILLS;
// v8.61 — flow-resume.md mid-flight runMode tests retired; the v8.34 toggle is now
// a back-compat no-op (the orchestrator always runs auto).
void SKILLS;

describe("v8.34 — KnowledgeEntry `problemType` field (item 5)", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("AC-1 — PROBLEM_TYPES exports the canonical 5-element union", () => {
    expect(PROBLEM_TYPES).toEqual([
      "bug",
      "knowledge",
      "decision",
      "performance",
      "refactor"
    ]);
  });

  it("AC-1 — `ProblemType` type is the union of PROBLEM_TYPES", () => {
    // Compile-time check: every PROBLEM_TYPES entry must be assignable to ProblemType.
    const samples: ProblemType[] = ["bug", "knowledge", "decision", "performance", "refactor"];
    expect(samples.length).toBe(PROBLEM_TYPES.length);
  });

  it("AC-2 — round-trips `problemType` through append + read", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const entry: KnowledgeEntry = {
      slug: "v8.34-bug",
      ship_commit: "abc1234",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 1, securityFlag: true, userRequestedCapture: false },
      problemType: "bug",
      tags: ["security"]
    };
    await appendKnowledgeEntry(project, entry);
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(1);
    expect(entries[0].problemType).toBe("bug");
  });

  it("AC-2 — rejects an entry whose `problemType` is not in the enum", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await expect(
      appendKnowledgeEntry(project, {
        slug: "v8.34-bad",
        ship_commit: "abc1234",
        shipped_at: "2026-05-11T00:00:00Z",
        signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
        // @ts-expect-error — runtime validation should reject this
        problemType: "invalid"
      })
    ).rejects.toThrow(/problemType/i);
  });

  it("AC-2 — accepts an entry whose `problemType` is `null` (forward-compat clear value)", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await appendKnowledgeEntry(project, {
      slug: "v8.34-null",
      ship_commit: "abc1234",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      problemType: null
    });
    const entries = await readKnowledgeLog(project);
    expect(entries[0].problemType).toBeNull();
  });

  it("AC-3 — `findNearKnowledge` returns ONLY entries whose `problemType` matches the filter", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await appendKnowledgeEntry(project, {
      slug: "20260510-bug-slug",
      ship_commit: "a",
      shipped_at: "2026-05-10T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 1, securityFlag: true, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "bug"
    });
    await appendKnowledgeEntry(project, {
      slug: "20260511-decision-slug",
      ship_commit: "b",
      shipped_at: "2026-05-11T00:00:00Z",
      signals: { hasArchitectDecision: true, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "decision"
    });
    await appendKnowledgeEntry(project, {
      slug: "20260512-perf-slug",
      ship_commit: "c",
      shipped_at: "2026-05-12T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["auth", "permissions"],
      problemType: "performance"
    });

    const onlyBugs = await findNearKnowledge("auth permissions", project, { problemType: "bug" });
    expect(onlyBugs.map((e) => e.slug)).toEqual(["20260510-bug-slug"]);

    const onlyDecisions = await findNearKnowledge("auth permissions", project, { problemType: "decision" });
    expect(onlyDecisions.map((e) => e.slug)).toEqual(["20260511-decision-slug"]);

    const noFilter = await findNearKnowledge("auth permissions", project);
    expect(noFilter.length, "without the filter, all 3 entries hit the threshold").toBeGreaterThanOrEqual(2);
  });

  it("AC-4 — back-compat: entries written before v8.34 (no problemType) still validate on read", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const legacyEntry = {
      slug: "20260101-legacy-no-type",
      ship_commit: "deadbeef",
      shipped_at: "2026-01-01T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["legacy"]
    };
    await fs.writeFile(target, `${JSON.stringify(legacyEntry)}\n`, "utf8");
    const entries = await readKnowledgeLog(project);
    expect(entries).toHaveLength(1);
    expect(entries[0].problemType, "absent field reads as undefined; never crashes").toBeUndefined();
  });

  it("AC-4 — back-compat: legacy entries (no problemType) match a filter of `knowledge` (the prior implicit default)", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    const target = knowledgeLogPath(project);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const legacyEntry = {
      slug: "20260101-legacy",
      ship_commit: "deadbeef",
      shipped_at: "2026-01-01T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 0, securityFlag: false, userRequestedCapture: false },
      tags: ["mempalace", "knowledge", "drawer"]
    };
    const newEntry = {
      slug: "20260201-explicit-bug",
      ship_commit: "feedface",
      shipped_at: "2026-02-01T00:00:00Z",
      signals: { hasArchitectDecision: false, reviewIterations: 2, securityFlag: false, userRequestedCapture: false },
      tags: ["mempalace", "drawer"],
      problemType: "bug"
    };
    await fs.writeFile(
      target,
      `${JSON.stringify(legacyEntry)}\n${JSON.stringify(newEntry)}\n`,
      "utf8"
    );

    const knowledgeHits = await findNearKnowledge("mempalace drawer", project, { problemType: "knowledge" });
    expect(
      knowledgeHits.map((e) => e.slug),
      "legacy entry (problemType absent) surfaces under the `knowledge` filter (implicit default)"
    ).toEqual(["20260101-legacy"]);
  });
});

describe("v8.34 — mid-flight runMode toggle (item 6; retired in v8.61 always-auto)", () => {
  const body = renderStartCommand();

  it("AC-5 — start-command body still documents `/cc --mode=auto` flag (accepted for back-compat in v8.61)", () => {
    expect(
      body,
      "the orchestrator body must still document the `/cc --mode=auto` toggle so the harness namespace router knows to forward the flag (v8.61 honours it as a no-op for back-compat)"
    ).toMatch(/\/cc\s+--mode=auto|--mode=auto/);
  });

  it("AC-5 — start-command body still documents `/cc --mode=step` flag (accepted for back-compat in v8.61)", () => {
    expect(body).toMatch(/--mode=step/);
  });

  it("v8.61 — start-command body declares the always-auto retirement of the step/auto toggle", () => {
    expect(
      body,
      "the body must spell out that v8.61 retired the step/auto choice and the flow always runs auto"
    ).toMatch(/always[- ]auto|v8\.61 always[- ]auto|step.+retired|step mode.+retired/iu);
  });

  it("v8.61 — start-command body names runMode as immutable (the v8.34 mid-flight toggle was retired with always-auto)", () => {
    // v8.61: the v8.34 mid-flight toggle is retired (--mode=step is now a no-op).
    // The triage decision is fully immutable (complexity / ceremonyMode / path / runMode / mode).
    expect(
      body,
      "the body must spell out that the triage decision is fully immutable in v8.61"
    ).toMatch(/triage decision is \*\*immutable\*\*/);
  });

  it("v8.61 — start-command body still references `triage.runMode` (so persistence + audit-log readers find the field name)", () => {
    expect(
      body,
      "the field name must survive so readers parsing flow-state.json find the canonical key"
    ).toMatch(/triage\.runMode|flow-state\.json[\s\S]{0,200}runMode/iu);
  });
});
