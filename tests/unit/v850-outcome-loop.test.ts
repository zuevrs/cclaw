import { describe, expect, it } from "vitest";

import {
  OUTCOME_SIGNALS,
  OUTCOME_SIGNAL_MULTIPLIERS,
  appendKnowledgeEntry,
  findNearKnowledge,
  readKnowledgeLog,
  setOutcomeSignal,
  type KnowledgeEntry,
  type OutcomeSignal
} from "../../src/knowledge-store.js";
import {
  BUG_KEYWORDS,
  applyFollowUpBugSignals,
  findFollowUpBugSlugs,
  looksLikeFixCommit,
  parseRevertCommits
} from "../../src/outcome-detection.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.50 — knowledge outcome loop. Slimmed in v8.99 test-slim-down A2 to
 * one WIRING + one BEHAVIOR + one SECTION CONTRACT test. The BEHAVIOR
 * test runs runCompoundAndShip end-to-end on a real fixture so revert
 * and manual-fix capture paths are still exercised together.
 */

const BASE_ENTRY: Omit<KnowledgeEntry, "slug"> = {
  ship_commit: "deadbeef",
  shipped_at: "2026-05-14T00:00:00Z",
  signals: {
    hasArchitectDecision: false,
    reviewIterations: 0,
    securityFlag: false,
    userRequestedCapture: false
  }
};
const entry = (slug: string, overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry => ({
  ...BASE_ENTRY,
  slug,
  ...overrides
});

describe("v8.50 — outcome loop wiring", () => {
  it("WIRING — OUTCOME_SIGNALS lists the 5 canonical values worst-to-best, OUTCOME_SIGNAL_MULTIPLIERS carries the documented numbers and is sorted reverted<follow-up-bug<manual-fix<good=unknown, appendKnowledgeEntry round-trips entries with/without outcome_signal, setOutcomeSignal stamps the slug, and outcome detection helpers are exported", async () => {
    expect(OUTCOME_SIGNALS).toEqual(["unknown", "good", "manual-fix", "follow-up-bug", "reverted"]);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.unknown).toBe(1.0);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.good).toBe(1.0);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["manual-fix"]).toBe(0.75);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["follow-up-bug"]).toBe(0.5);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.reverted).toBe(0.2);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.reverted).toBeLessThan(OUTCOME_SIGNAL_MULTIPLIERS["follow-up-bug"]);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["follow-up-bug"]).toBeLessThan(OUTCOME_SIGNAL_MULTIPLIERS["manual-fix"]);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["manual-fix"]).toBeLessThan(OUTCOME_SIGNAL_MULTIPLIERS.unknown);

    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("legacy"));
      await appendKnowledgeEntry(
        project,
        entry("with-signal", {
          outcome_signal: "manual-fix",
          outcome_signal_updated_at: "2026-05-14T12:00:00Z"
        })
      );
      const entries = await readKnowledgeLog(project);
      expect(entries.find((e) => e.slug === "legacy")?.outcome_signal).toBeUndefined();
      expect(entries.find((e) => e.slug === "with-signal")?.outcome_signal).toBe("manual-fix");

      await expect(
        appendKnowledgeEntry(project, entry("bad", { outcome_signal: "nope" as unknown as OutcomeSignal }))
      ).rejects.toThrow(/outcome_signal/);

      const ok = await setOutcomeSignal(project, "legacy", "reverted", "test", "2026-05-14T10:00:00Z");
      expect(ok).toBe(true);
      const noop = await setOutcomeSignal(project, "missing", "reverted", "test", "2026-05-14T10:00:00Z");
      expect(noop).toBe(false);

      await appendKnowledgeEntry(project, entry("good-slug", { tags: ["a"], outcome_signal: "good" }));
      await appendKnowledgeEntry(project, entry("rev-slug", { tags: ["a", "b"], outcome_signal: "reverted" }));
      const hits = await findNearKnowledge("a b", project, { threshold: 0.4 });
      expect(hits.map((h) => h.slug)).not.toContain("rev-slug");
    } finally {
      await removeProject(project);
    }

    expect(BUG_KEYWORDS).toContain("bug");
    expect(BUG_KEYWORDS).toContain("regression");
    expect(parseRevertCommits(`abc Revert "feat: 20260512-prior"\n`)).toHaveLength(1);
    expect(looksLikeFixCommit("fix(AC-1): x")).toBe(true);
    expect(looksLikeFixCommit("feat: x")).toBe(false);
    expect(
      findFollowUpBugSlugs("fix the bug from 20260512-x", ["20260512-x"])[0]?.targetSlug
    ).toBe("20260512-x");
  });
});

describe("v8.50 — outcome loop behavior (runCompoundAndShip stamps revert + manual-fix)", () => {
  it("BEHAVIOR — runCompoundAndShip on real on-disk fixtures (a) stamps `reverted` on a prior shipped slug when the revert message names it and (b) stamps `manual-fix` on the slug currently being shipped when a fix commit touches its surface; probes.disable skips both", async () => {
    const { runCompoundAndShip } = await import("../../src/compound.js");
    const { writeFileSafe } = await import("../../src/fs-utils.js");
    const { writeFlowState } = await import("../../src/run-persistence.js");
    const { activeArtifactPath } = await import("../../src/artifact-paths.js");

    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("20260512-prior-slug", { tags: ["auth"] }));
      await writeFlowState(project, {
        schemaVersion: 3,
        currentSlug: "20260514-current",
        currentStage: "ship",
        ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
        lastSpecialist: "design",
        startedAt: "2026-05-14T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null
      });
      await writeFileSafe(activeArtifactPath(project, "plan", "20260514-current"), "plan");
      await writeFileSafe(activeArtifactPath(project, "ship", "20260514-current"), "ship");

      const result = await runCompoundAndShip(project, {
        shipCommit: "abc",
        signals: {
          hasArchitectDecision: true,
          reviewIterations: 0,
          securityFlag: false,
          userRequestedCapture: false
        },
        touchSurface: ["src/auth/"],
        outcomeProbes: {
          revertGitLog: `dddd1234 Revert "feat(v8.49): 20260512-prior-slug"\n`,
          manualFixGitLog: `xxxxx1 fix(AC-2): tweak oauth flow\n`,
          manualFixFiles: new Map([["xxxxx1", ["src/auth/oauth.ts"]]])
        }
      });

      expect(result.revertedSlugMatches?.[0]?.slug).toBe("20260512-prior-slug");
      expect(result.manualFixMatches?.[0]?.matchedSurface).toBe("src/auth");

      const entries = await readKnowledgeLog(project);
      const prior = entries.find((e) => e.slug === "20260512-prior-slug");
      expect(prior?.outcome_signal).toBe("reverted");
      const current = entries.find((e) => e.slug === "20260514-current");
      expect(current?.outcome_signal).toBe("manual-fix");

      await appendKnowledgeEntry(project, entry("20260513-other", { tags: ["x"] }));
      const stamped = await applyFollowUpBugSignals(
        project,
        "/cc fix the auth bug from 20260513-other",
        "2026-05-14T13:00:00Z"
      );
      expect(stamped.map((s) => s.targetSlug)).toContain("20260513-other");
      const refetched = await readKnowledgeLog(project);
      expect(refetched.find((e) => e.slug === "20260513-other")?.outcome_signal).toBe("follow-up-bug");

      await writeFlowState(project, {
        schemaVersion: 3,
        currentSlug: "20260515-disabled",
        currentStage: "ship",
        ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
        lastSpecialist: null,
        startedAt: "2026-05-15T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null
      });
      await writeFileSafe(activeArtifactPath(project, "plan", "20260515-disabled"), "plan");
      await writeFileSafe(activeArtifactPath(project, "ship", "20260515-disabled"), "ship");
      const disabled = await runCompoundAndShip(project, {
        shipCommit: "abc",
        signals: {
          hasArchitectDecision: false,
          reviewIterations: 0,
          securityFlag: false,
          userRequestedCapture: false
        },
        outcomeProbes: { disable: true }
      });
      expect(disabled.revertedSlugMatches).toEqual([]);
      expect(disabled.manualFixMatches).toEqual([]);
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.50 — outcome loop section contract (start-command + reviewer/critic prompts surface outcome_signal)", () => {
  it("SECTION CONTRACT — start-command body documents the v8.50 outcome-signal down-weight + capture paths (revert + manual-fix + follow-up-bug); reviewer + critic prompts cite outcome_signal; architect routes via learnings-research helper", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/OUTCOME_SIGNAL_MULTIPLIERS/);
    expect(body).toMatch(/outcome_signal/);
    expect(body).toMatch(/applyFollowUpBugSignals/);
    expect(body).toMatch(/follow-up-bug/);
    expect(body).toMatch(/revert/i);
    expect(body).toMatch(/manual-fix/);
    expect(body).toMatch(/runCompoundAndShip/);

    for (const [name, prompt] of [
      ["reviewer", REVIEWER_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const) {
      expect(prompt, `${name} prompt should cite outcome_signal`).toMatch(/outcome_signal/);
    }
    expect(ARCHITECT_PROMPT).toMatch(/learnings-research/);
  });
});
