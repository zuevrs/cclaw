import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  OUTCOME_SIGNALS,
  OUTCOME_SIGNAL_MULTIPLIERS,
  appendKnowledgeEntry,
  findNearKnowledge,
  knowledgeLogPath,
  outcomeMultiplier,
  outcomeSignalOf,
  readKnowledgeLog,
  setOutcomeSignal,
  type KnowledgeEntry,
  type OutcomeSignal
} from "../../src/knowledge-store.js";
import {
  BUG_KEYWORDS,
  applyFollowUpBugSignals,
  findFollowUpBugSlugs,
  findManualFixCandidates,
  findRevertedSlugs,
  isSlugReference,
  looksLikeFixCommit,
  parseCommitLog,
  parseRevertCommits
} from "../../src/outcome-detection.js";
import { ensureRuntimeRoot } from "../../src/install.js";
import { renderStartCommand } from "../../src/content/start-command.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import { ARCHITECT_PROMPT } from "../../src/content/specialist-prompts/architect.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.50 — knowledge outcome loop.
 *
 * Closes the half-real loop in `knowledge.jsonl`: pre-v8.50 entries
 * were forward-only (captured at compound, read at triage, never
 * down-weighted when the slug they recorded turned out to be a bad
 * reference). v8.50 adds three automatic capture paths (revert
 * detection, follow-up-bug detection, manual-fix detection) and
 * routes the captured `outcome_signal` through `findNearKnowledge`
 * as a Jaccard-score multiplier.
 *
 * The tripwires below pin every v8.50 invariant so an accidental
 * regression lights up immediately. Format mirrors v8.49 / v8.48 /
 * v8.47 tripwires.
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

function entry(slug: string, overrides: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return { ...BASE_ENTRY, slug, ...overrides };
}

describe("v8.50 AC-1 — OUTCOME_SIGNALS type + KnowledgeEntry fields", () => {
  it("OUTCOME_SIGNALS exports exactly the five expected values in worst-to-best order", () => {
    expect(OUTCOME_SIGNALS).toEqual(["unknown", "good", "manual-fix", "follow-up-bug", "reverted"]);
    expect(OUTCOME_SIGNALS).toHaveLength(5);
  });

  it("OUTCOME_SIGNAL_MULTIPLIERS carries one entry per signal with the documented numbers", () => {
    expect(OUTCOME_SIGNAL_MULTIPLIERS.unknown).toBe(1.0);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.good).toBe(1.0);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["manual-fix"]).toBe(0.75);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["follow-up-bug"]).toBe(0.5);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.reverted).toBe(0.2);
    expect(Object.keys(OUTCOME_SIGNAL_MULTIPLIERS).sort()).toEqual([...OUTCOME_SIGNALS].sort());
  });

  it("outcomeSignalOf defaults absent / undefined `outcome_signal` to `unknown`", () => {
    expect(outcomeSignalOf(entry("a"))).toBe("unknown");
    expect(outcomeSignalOf(entry("b", { outcome_signal: "good" }))).toBe("good");
    expect(outcomeSignalOf(entry("c", { outcome_signal: "reverted" }))).toBe("reverted");
  });

  it("outcomeMultiplier reads the multiplier through the outcomeSignalOf default", () => {
    expect(outcomeMultiplier(entry("a"))).toBe(1.0);
    expect(outcomeMultiplier(entry("b", { outcome_signal: "manual-fix" }))).toBe(0.75);
    expect(outcomeMultiplier(entry("c", { outcome_signal: "reverted" }))).toBe(0.2);
  });

  it("appendKnowledgeEntry accepts entries with the three new optional fields", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(
        project,
        entry("with-signal", {
          outcome_signal: "manual-fix",
          outcome_signal_updated_at: "2026-05-14T12:00:00Z",
          outcome_signal_source: "post-ship fix detected"
        })
      );
      const entries = await readKnowledgeLog(project);
      expect(entries[0]?.outcome_signal).toBe("manual-fix");
      expect(entries[0]?.outcome_signal_updated_at).toBe("2026-05-14T12:00:00Z");
      expect(entries[0]?.outcome_signal_source).toBe("post-ship fix detected");
    } finally {
      await removeProject(project);
    }
  });

  it("appendKnowledgeEntry round-trips entries with the field absent (back-compat)", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("legacy"));
      const entries = await readKnowledgeLog(project);
      expect(entries[0]?.outcome_signal).toBeUndefined();
      expect(outcomeSignalOf(entries[0]!)).toBe("unknown");
    } finally {
      await removeProject(project);
    }
  });

  it("appendKnowledgeEntry rejects unknown outcome_signal values", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await expect(
        appendKnowledgeEntry(
          project,
          entry("bad", { outcome_signal: "nope" as unknown as OutcomeSignal })
        )
      ).rejects.toThrow(/outcome_signal/);
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.50 AC-2 — findNearKnowledge down-weights by outcome_signal", () => {
  it("a `good` / unknown entry surfaces normally above threshold", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(
        project,
        entry("good-slug", { tags: ["auth", "oauth"], outcome_signal: "good" })
      );
      const hits = await findNearKnowledge("auth oauth bug", project, { threshold: 0.4 });
      expect(hits.map((h) => h.slug)).toContain("good-slug");
    } finally {
      await removeProject(project);
    }
  });

  it("a `reverted` entry with raw similarity 1.0 falls below a 0.4 threshold after the 0.2 multiplier", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      // The entry's tags + taskSummary tokens share `auth` and `oauth`
      // (raw Jaccard ~1.0); the 0.2 reverted multiplier drops adjusted
      // score to 0.2 which is well below the 0.4 threshold.
      await appendKnowledgeEntry(
        project,
        entry("reverted-slug", { tags: ["auth", "oauth"], outcome_signal: "reverted" })
      );
      const hits = await findNearKnowledge("auth oauth", project, { threshold: 0.4 });
      expect(hits.map((h) => h.slug)).not.toContain("reverted-slug");
    } finally {
      await removeProject(project);
    }
  });

  it("a `follow-up-bug` entry falls below threshold when adjusted score drops below it", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      // Tags share one of two task tokens; raw Jaccard around 0.5 (split
      // by the design of the entryTokensForSummaryMatch tokeniser).
      // The 0.5 follow-up-bug multiplier pushes it to ~0.25, below 0.4.
      await appendKnowledgeEntry(
        project,
        entry("followup-slug", { tags: ["auth"], outcome_signal: "follow-up-bug" })
      );
      const hits = await findNearKnowledge("auth oauth tokens", project, { threshold: 0.4 });
      expect(hits.map((h) => h.slug)).not.toContain("followup-slug");
    } finally {
      await removeProject(project);
    }
  });

  it("ranks a `good` entry above a `reverted` entry even when the reverted one has higher raw similarity", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      // good-slug shares 1 of 2 task tokens — raw similarity ~0.5; with
      // `good` multiplier of 1.0, adjusted = 0.5.
      // reverted-slug shares both task tokens — raw similarity ~1.0;
      // with `reverted` multiplier of 0.2, adjusted = 0.2. Adjusted
      // score must drive ordering, so good-slug comes first AND
      // reverted-slug drops below the threshold.
      await appendKnowledgeEntry(
        project,
        entry("good-slug", { tags: ["auth"], outcome_signal: "good" })
      );
      await appendKnowledgeEntry(
        project,
        entry("reverted-slug", { tags: ["auth", "oauth"], outcome_signal: "reverted" })
      );
      const hits = await findNearKnowledge("auth oauth", project, { threshold: 0.4 });
      expect(hits[0]?.slug).toBe("good-slug");
      expect(hits.map((h) => h.slug)).not.toContain("reverted-slug");
    } finally {
      await removeProject(project);
    }
  });

  it("an entry with absent `outcome_signal` is treated as `unknown` (neutral; pre-v8.50 ranking)", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("legacy-slug", { tags: ["auth", "oauth"] }));
      const hits = await findNearKnowledge("auth oauth", project, { threshold: 0.4 });
      expect(hits.map((h) => h.slug)).toContain("legacy-slug");
    } finally {
      await removeProject(project);
    }
  });

  it("returned `priorLearnings`-shape KnowledgeEntry objects carry the outcome_signal field for the orchestrator to surface", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(
        project,
        entry("manual-fix-slug", {
          tags: ["auth"],
          outcome_signal: "manual-fix",
          outcome_signal_source: "fix(AC-2) at sha abc"
        })
      );
      const hits = await findNearKnowledge("auth", project, { threshold: 0.4 });
      const hit = hits.find((h) => h.slug === "manual-fix-slug");
      expect(hit?.outcome_signal).toBe("manual-fix");
      expect(hit?.outcome_signal_source).toBe("fix(AC-2) at sha abc");
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.50 AC-2 — setOutcomeSignal write-back", () => {
  it("stamps the three outcome fields on a matched slug", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("target", { tags: ["auth"] }));
      const ok = await setOutcomeSignal(
        project,
        "target",
        "reverted",
        "revert detected on abc1234",
        "2026-05-14T10:00:00Z"
      );
      expect(ok).toBe(true);
      const entries = await readKnowledgeLog(project);
      expect(entries[0]?.outcome_signal).toBe("reverted");
      expect(entries[0]?.outcome_signal_source).toBe("revert detected on abc1234");
      expect(entries[0]?.outcome_signal_updated_at).toBe("2026-05-14T10:00:00Z");
    } finally {
      await removeProject(project);
    }
  });

  it("returns false when the slug does not exist (no-op, no throw)", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("alpha"));
      const ok = await setOutcomeSignal(
        project,
        "does-not-exist",
        "reverted",
        "n/a",
        "2026-05-14T10:00:00Z"
      );
      expect(ok).toBe(false);
    } finally {
      await removeProject(project);
    }
  });

  it("returns false when knowledge.jsonl is missing", async () => {
    const project = await createTempProject();
    try {
      const ok = await setOutcomeSignal(
        project,
        "anything",
        "reverted",
        "n/a",
        "2026-05-14T10:00:00Z"
      );
      expect(ok).toBe(false);
    } finally {
      await removeProject(project);
    }
  });

  it("rejects unknown signal values", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("target"));
      await expect(
        setOutcomeSignal(
          project,
          "target",
          "nope" as OutcomeSignal,
          "n/a",
          "2026-05-14T10:00:00Z"
        )
      ).rejects.toThrow();
    } finally {
      await removeProject(project);
    }
  });

  it("preserves other entries in the jsonl during the write-back", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("alpha"));
      await appendKnowledgeEntry(project, entry("beta"));
      await appendKnowledgeEntry(project, entry("gamma"));
      await setOutcomeSignal(project, "beta", "manual-fix", "post-ship fix", "2026-05-14T11:00:00Z");
      const entries = await readKnowledgeLog(project);
      expect(entries.map((e) => e.slug)).toEqual(["alpha", "beta", "gamma"]);
      expect(entries[0]?.outcome_signal).toBeUndefined();
      expect(entries[1]?.outcome_signal).toBe("manual-fix");
      expect(entries[2]?.outcome_signal).toBeUndefined();
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.50 AC-3a — revert detection (parseRevertCommits + findRevertedSlugs)", () => {
  it("parses conventional `Revert \"<original>\"` shape and extracts the quoted reference", () => {
    const log = `abc1234 Revert "feat(v8.42): critic stage"
def5678 unrelated commit
9999aaa Revert "fix(AC-2): auth oauth flow"
`;
    const reverts = parseRevertCommits(log);
    expect(reverts).toHaveLength(2);
    expect(reverts[0]?.sha).toBe("abc1234");
    expect(reverts[0]?.revertedSubject).toBe("feat(v8.42): critic stage");
    expect(reverts[1]?.revertedSubject).toBe("fix(AC-2): auth oauth flow");
  });

  it("accepts lowercase `revert:` prefix without a quoted reference", () => {
    const log = `abc1234 revert: clean up a bad merge\n`;
    const reverts = parseRevertCommits(log);
    expect(reverts).toHaveLength(1);
    expect(reverts[0]?.revertedSubject).toBeUndefined();
  });

  it("drops commits whose subject does not start with revert/Revert", () => {
    const log = `abc1234 feat: hand-written reverted change\ndef5678 fix: code review\n`;
    expect(parseRevertCommits(log)).toEqual([]);
  });

  it("returns [] on empty / non-string input", () => {
    expect(parseRevertCommits("")).toEqual([]);
    expect(parseRevertCommits(undefined as unknown as string)).toEqual([]);
  });

  it("findRevertedSlugs matches a revert quote that names a shipped slug as a slug-cased token", () => {
    const reverts = parseRevertCommits(
      `abc1234 Revert "feat(v8.42): 20260514-knowledge-outcome-loop"\n`
    );
    const matches = findRevertedSlugs(reverts, [
      "20260514-knowledge-outcome-loop",
      "20260512-other-slug"
    ]);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.slug).toBe("20260514-knowledge-outcome-loop");
    expect(matches[0]?.source).toBe("revert detected on abc1234");
  });

  it("findRevertedSlugs does NOT match a substring (slug-cased token only)", () => {
    const reverts = parseRevertCommits(`abc1234 Revert "feat: authentication"\n`);
    expect(findRevertedSlugs(reverts, ["auth"])).toHaveLength(0);
  });

  it("findRevertedSlugs returns [] when shippedSlugs is empty", () => {
    const reverts = parseRevertCommits(`abc1234 Revert "feat: x"\n`);
    expect(findRevertedSlugs(reverts, [])).toEqual([]);
  });

  it("isSlugReference accepts slug-cased tokens at boundaries", () => {
    expect(isSlugReference("revert 20260514-foo because", "20260514-foo")).toBe(true);
    expect(isSlugReference("20260514-foo at start", "20260514-foo")).toBe(true);
    expect(isSlugReference("at end 20260514-foo", "20260514-foo")).toBe(true);
  });

  it("isSlugReference rejects substring matches", () => {
    expect(isSlugReference("the foobar slug", "foo")).toBe(false);
    expect(isSlugReference("authentication", "auth")).toBe(false);
  });
});

describe("v8.50 AC-3b — follow-up-bug detection (findFollowUpBugSlugs + applyFollowUpBugSignals)", () => {
  it("BUG_KEYWORDS list carries the documented bug-related tokens", () => {
    for (const expected of ["bug", "fix", "broken", "regression", "crash"]) {
      expect(BUG_KEYWORDS).toContain(expected);
    }
  });

  it("matches a slug-cased reference paired with a bug keyword", () => {
    const matches = findFollowUpBugSlugs(
      "/cc fix the auth bug from 20260512-oauth-bypass",
      ["20260512-oauth-bypass", "20260501-other"]
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches[0]?.targetSlug).toBe("20260512-oauth-bypass");
    expect(matches[0]?.source).toContain("20260512-oauth-bypass");
  });

  it("does NOT match a slug reference WITHOUT a bug keyword (refinement / rephrase task)", () => {
    expect(
      findFollowUpBugSlugs(
        "extend 20260512-oauth-bypass to handle new providers",
        ["20260512-oauth-bypass"]
      )
    ).toEqual([]);
  });

  it("does NOT match a bug keyword WITHOUT a slug reference (no prior to down-weight)", () => {
    expect(findFollowUpBugSlugs("fix the auth bug", ["20260512-oauth-bypass"])).toEqual([]);
  });

  it("matches `regression` / `broken` / `hotfix` / `revert` as bug keywords", () => {
    for (const keyword of ["regression", "broken", "hotfix", "revert"]) {
      const matches = findFollowUpBugSlugs(
        `there is a ${keyword} in 20260512-oauth-bypass we need to address`,
        ["20260512-oauth-bypass"]
      );
      expect(matches.length, `keyword ${keyword} should fire`).toBeGreaterThanOrEqual(1);
    }
  });

  it("does NOT match substring slug names (slug-cased token boundary)", () => {
    expect(
      findFollowUpBugSlugs("fix the bug in authentication module", ["auth"])
    ).toEqual([]);
  });

  it("returns [] on empty task description / empty shipped-slug list", () => {
    expect(findFollowUpBugSlugs("", ["a"])).toEqual([]);
    expect(findFollowUpBugSlugs("fix bug in a", [])).toEqual([]);
  });

  it("applyFollowUpBugSignals stamps follow-up-bug on a matched prior", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("20260512-oauth-bypass", { tags: ["auth"] }));
      await appendKnowledgeEntry(project, entry("20260501-other", { tags: ["other"] }));
      const stamped = await applyFollowUpBugSignals(
        project,
        "/cc fix the auth bug from 20260512-oauth-bypass",
        "2026-05-14T13:00:00Z"
      );
      expect(stamped).toHaveLength(1);
      expect(stamped[0]?.targetSlug).toBe("20260512-oauth-bypass");
      const entries = await readKnowledgeLog(project);
      const target = entries.find((e) => e.slug === "20260512-oauth-bypass");
      expect(target?.outcome_signal).toBe("follow-up-bug");
      expect(target?.outcome_signal_updated_at).toBe("2026-05-14T13:00:00Z");
      const other = entries.find((e) => e.slug === "20260501-other");
      expect(other?.outcome_signal).toBeUndefined();
    } finally {
      await removeProject(project);
    }
  });

  it("applyFollowUpBugSignals is a no-op when knowledge.jsonl is missing or empty", async () => {
    const project = await createTempProject();
    try {
      const stamped = await applyFollowUpBugSignals(
        project,
        "/cc fix bug in something",
        "2026-05-14T13:00:00Z"
      );
      expect(stamped).toEqual([]);
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.50 AC-3c — manual-fix detection (findManualFixCandidates + parseCommitLog)", () => {
  it("looksLikeFixCommit accepts the four documented prefix shapes", () => {
    expect(looksLikeFixCommit("fix(AC-1): something")).toBe(true);
    expect(looksLikeFixCommit("fix: plain fix")).toBe(true);
    expect(looksLikeFixCommit("hotfix: deploy break")).toBe(true);
    expect(looksLikeFixCommit("hot-fix: deploy break")).toBe(true);
    expect(looksLikeFixCommit("fixup! squash me")).toBe(true);
    expect(looksLikeFixCommit("Fix(AC-2): mixed case")).toBe(true);
  });

  it("looksLikeFixCommit rejects non-fix shapes", () => {
    expect(looksLikeFixCommit("feat: new feature")).toBe(false);
    expect(looksLikeFixCommit("refactor: cleanup")).toBe(false);
    expect(looksLikeFixCommit("prefix: tricky")).toBe(false);
    expect(looksLikeFixCommit("")).toBe(false);
  });

  it("parseCommitLog parses git --oneline output into {sha, subject} rows", () => {
    const log = `abc1234 fix(AC-1): post-ship fix\ndef5678 feat: new\n9999aaa hotfix: emergency\n`;
    const commits = parseCommitLog(log);
    expect(commits).toHaveLength(3);
    expect(commits[0]).toEqual({ sha: "abc1234", subject: "fix(AC-1): post-ship fix" });
  });

  it("findManualFixCandidates fires when a fix commit touches the slug's surface", () => {
    const commits = parseCommitLog(`abc1234 fix(AC-1): tweak oauth flow\n`);
    const filesByCommit = new Map([["abc1234", ["src/auth/oauth.ts"]]]);
    const matches = findManualFixCandidates(commits, ["src/auth/"], filesByCommit);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.sha).toBe("abc1234");
    expect(matches[0]?.matchedSurface).toBe("src/auth");
    expect(matches[0]?.source).toContain("manual-fix detected");
  });

  it("findManualFixCandidates skips a fix commit that misses the surface", () => {
    const commits = parseCommitLog(`abc1234 fix(AC-1): tweak\n`);
    const filesByCommit = new Map([["abc1234", ["src/unrelated/x.ts"]]]);
    expect(findManualFixCandidates(commits, ["src/auth/"], filesByCommit)).toEqual([]);
  });

  it("findManualFixCandidates skips non-fix commits even when they touch the surface", () => {
    const commits = parseCommitLog(`abc1234 feat: new oauth flow\n`);
    const filesByCommit = new Map([["abc1234", ["src/auth/oauth.ts"]]]);
    expect(findManualFixCandidates(commits, ["src/auth/"], filesByCommit)).toEqual([]);
  });

  it("findManualFixCandidates returns [] for empty inputs", () => {
    expect(findManualFixCandidates([], ["src/x"], new Map())).toEqual([]);
    expect(
      findManualFixCandidates(parseCommitLog("a fix: x"), [], new Map())
    ).toEqual([]);
  });

  it("findManualFixCandidates accepts both `src/auth/` and `src/auth` surface declarations (trailing-slash optional)", () => {
    const commits = parseCommitLog(`abc1234 fix(AC-1): oauth\n`);
    const filesByCommit = new Map([["abc1234", ["src/auth/oauth.ts"]]]);
    expect(findManualFixCandidates(commits, ["src/auth"], filesByCommit)).toHaveLength(1);
    expect(findManualFixCandidates(commits, ["src/auth/"], filesByCommit)).toHaveLength(1);
  });
});

describe("v8.50 — start-command body + specialist prompts surface outcome_signal in priorLearnings", () => {
  it("start-command body documents the follow-up-bug detection at Hop 1", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/applyFollowUpBugSignals/);
    expect(body).toMatch(/follow-up-bug/);
  });

  it("start-command body documents the outcome-signal down-weight in the prior-learnings lookup", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/OUTCOME_SIGNAL_MULTIPLIERS/);
    expect(body).toMatch(/outcome_signal/);
  });

  it("start-command body documents the revert + manual-fix capture paths at compound time", () => {
    const body = renderStartCommand();
    expect(body).toMatch(/revert/i);
    expect(body).toMatch(/manual-fix/);
    expect(body).toMatch(/runCompoundAndShip/);
  });

  it("reviewer / critic prompts mention outcome_signal as a v8.50 weighting consideration; v8.62 — the architect surfaces priors via the read-only `learnings-research` helper which itself owns outcome_signal down-weighting (see `src/content/specialist-prompts/learnings-research.ts`), so the architect prompt does not duplicate the contract", () => {
    for (const [name, prompt] of [
      ["reviewer", REVIEWER_PROMPT],
      ["critic", CRITIC_PROMPT]
    ] as const) {
      expect(
        prompt,
        `${name} prompt should cite outcome_signal so down-weighted priors are treated as cautionary precedent`
      ).toMatch(/outcome_signal/);
    }
    // The architect is intentionally allowed to omit outcome_signal:
    // it dispatches `learnings-research` (the read-only helper) and
    // consumes the lessons inline in the slim summary; outcome_signal
    // down-weighting happens inside `findNearKnowledge` before the
    // helper returns. Re-stating it in the architect prompt would
    // be redundant. The architect MUST still mention `learnings-research`.
    expect(ARCHITECT_PROMPT).toMatch(/learnings-research/);
  });
});

describe("v8.50 — cross-item invariants", () => {
  it("OUTCOME_SIGNAL_MULTIPLIERS values are sorted worst-to-best (reverted < follow-up-bug < manual-fix < neutral)", () => {
    expect(OUTCOME_SIGNAL_MULTIPLIERS.reverted).toBeLessThan(OUTCOME_SIGNAL_MULTIPLIERS["follow-up-bug"]);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["follow-up-bug"]).toBeLessThan(OUTCOME_SIGNAL_MULTIPLIERS["manual-fix"]);
    expect(OUTCOME_SIGNAL_MULTIPLIERS["manual-fix"]).toBeLessThan(OUTCOME_SIGNAL_MULTIPLIERS.unknown);
    expect(OUTCOME_SIGNAL_MULTIPLIERS.unknown).toBe(OUTCOME_SIGNAL_MULTIPLIERS.good);
  });

  it("findNearKnowledge sort order respects the multiplier (tied raw similarity, different signals)", async () => {
    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      // Both entries share the same tag set so raw similarity is
      // identical. The multiplier MUST tilt the sort.
      await appendKnowledgeEntry(
        project,
        entry("downweighted", { tags: ["auth", "oauth"], outcome_signal: "manual-fix" })
      );
      await appendKnowledgeEntry(
        project,
        entry("neutral", { tags: ["auth", "oauth"], outcome_signal: "good" })
      );
      const hits = await findNearKnowledge("auth oauth", project, { threshold: 0.3 });
      expect(hits[0]?.slug).toBe("neutral");
    } finally {
      await removeProject(project);
    }
  });
});

describe("v8.50 — runCompoundAndShip wires outcome-loop probes", () => {
  it("revert probe stamps `reverted` on a prior shipped slug when the revert message names it", async () => {
    const { runCompoundAndShip } = await import("../../src/compound.js");
    const { writeFileSafe } = await import("../../src/fs-utils.js");
    const { writeFlowState } = await import("../../src/run-persistence.js");
    const { activeArtifactPath } = await import("../../src/artifact-paths.js");

    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      // Pre-seed a prior shipped slug whose name appears in the
      // synthetic revert log.
      await appendKnowledgeEntry(
        project,
        entry("20260512-prior-slug", { tags: ["auth"] })
      );

      // Set up the active flow with the slug we are shipping now.
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
        outcomeProbes: {
          revertGitLog: `dddd1234 Revert "feat(v8.49): 20260512-prior-slug"\n`,
          manualFixGitLog: ""
        }
      });

      expect(result.revertedSlugMatches?.length).toBe(1);
      expect(result.revertedSlugMatches?.[0]?.slug).toBe("20260512-prior-slug");

      const entries = await readKnowledgeLog(project);
      const prior = entries.find((e) => e.slug === "20260512-prior-slug");
      expect(prior?.outcome_signal).toBe("reverted");
      expect(prior?.outcome_signal_source).toContain("revert detected on dddd1234");
    } finally {
      await removeProject(project);
    }
  });

  it("manual-fix probe stamps `manual-fix` on the slug currently being shipped", async () => {
    const { runCompoundAndShip } = await import("../../src/compound.js");
    const { writeFileSafe } = await import("../../src/fs-utils.js");
    const { writeFlowState } = await import("../../src/run-persistence.js");
    const { activeArtifactPath } = await import("../../src/artifact-paths.js");

    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
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
          revertGitLog: "",
          manualFixGitLog: `xxxxx1 fix(AC-2): tweak oauth flow\n`,
          manualFixFiles: new Map([["xxxxx1", ["src/auth/oauth.ts"]]])
        }
      });

      expect(result.manualFixMatches?.length).toBe(1);
      expect(result.manualFixMatches?.[0]?.matchedSurface).toBe("src/auth");

      const entries = await readKnowledgeLog(project);
      const current = entries.find((e) => e.slug === "20260514-current");
      expect(current?.outcome_signal).toBe("manual-fix");
      expect(current?.outcome_signal_source).toContain("manual-fix detected");
    } finally {
      await removeProject(project);
    }
  });

  it("probes.disable: true skips both capture paths", async () => {
    const { runCompoundAndShip } = await import("../../src/compound.js");
    const { writeFileSafe } = await import("../../src/fs-utils.js");
    const { writeFlowState } = await import("../../src/run-persistence.js");
    const { activeArtifactPath } = await import("../../src/artifact-paths.js");

    const project = await createTempProject();
    try {
      await ensureRuntimeRoot(project);
      await appendKnowledgeEntry(project, entry("20260512-prior"));
      await writeFlowState(project, {
        schemaVersion: 3,
        currentSlug: "20260514-now",
        currentStage: "ship",
        ac: [{ id: "AC-1", text: "outcome", status: "committed", commit: "abc" }],
        lastSpecialist: null,
        startedAt: "2026-05-14T00:00:00Z",
        reviewIterations: 0,
        securityFlag: false,
        triage: null
      });
      await writeFileSafe(activeArtifactPath(project, "plan", "20260514-now"), "plan");
      await writeFileSafe(activeArtifactPath(project, "ship", "20260514-now"), "ship");

      const result = await runCompoundAndShip(project, {
        shipCommit: "abc",
        signals: {
          hasArchitectDecision: true,
          reviewIterations: 0,
          securityFlag: false,
          userRequestedCapture: false
        },
        outcomeProbes: { disable: true }
      });

      expect(result.revertedSlugMatches).toEqual([]);
      expect(result.manualFixMatches).toEqual([]);
    } finally {
      await removeProject(project);
    }
  });
});

// (Reserved) basic sanity check that the helper file existed before
// this test runs - otherwise the early failure cascades into a wall
// of confusing assertion errors.
describe("v8.50 — environment sanity", () => {
  let project: string | undefined;
  afterEach(async () => {
    if (project) await removeProject(project);
    project = undefined;
  });

  it("knowledgeLogPath points at .cclaw/knowledge.jsonl under projectRoot", async () => {
    project = await createTempProject();
    expect(knowledgeLogPath(project)).toContain(".cclaw");
    expect(knowledgeLogPath(project).endsWith(path.join(".cclaw", "knowledge.jsonl"))).toBe(true);
  });

  it("readKnowledgeLog returns [] for a project that never wrote one", async () => {
    project = await createTempProject();
    expect(await readKnowledgeLog(project)).toEqual([]);
  });

  it("appending and reading a real file round-trips through fs", async () => {
    project = await createTempProject();
    await ensureRuntimeRoot(project);
    await appendKnowledgeEntry(project, entry("roundtrip"));
    const raw = await fs.readFile(knowledgeLogPath(project), "utf8");
    expect(raw).toContain("roundtrip");
  });
});
