import { describe, expect, it } from "vitest";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  appendKnowledgeEntry,
  findNearDuplicate,
  knowledgeLogPath,
  readKnowledgeLog,
  type KnowledgeEntry
} from "../../src/knowledge-store.js";
import { runCompoundAndShip } from "../../src/compound.js";
import { writeFlowState } from "../../src/run-persistence.js";
import { ensureDir } from "../../src/fs-utils.js";
import { activeArtifactDir, activeArtifactPath } from "../../src/artifact-paths.js";
import { createInitialFlowState } from "../../src/flow-state.js";
import { SLICE_BUILDER_PROMPT } from "../../src/content/specialist-prompts/slice-builder.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";

async function tempProject(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "cclaw-v89-"));
}

function baseEntry(over: Partial<KnowledgeEntry> = {}): KnowledgeEntry {
  return {
    slug: "demo-slug",
    ship_commit: "deadbeef",
    shipped_at: new Date().toISOString(),
    signals: {
      hasArchitectDecision: false,
      reviewIterations: 1,
      securityFlag: false,
      userRequestedCapture: false
    },
    refines: null,
    notes: undefined,
    tags: [],
    touchSurface: [],
    ...over
  };
}

describe("v8.9 cleanup", () => {
  describe("A3 — knowledge.jsonl near-duplicate detection", () => {
    it("findNearDuplicate returns null when candidate has no signature (no tags, no touchSurface)", async () => {
      const root = await tempProject();
      try {
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "older", touchSurface: ["src/auth.ts", "src/session.ts"] })
        );
        const candidate = baseEntry({ slug: "newer", touchSurface: [], tags: [] });
        const match = await findNearDuplicate(root, candidate);
        expect(match).toBeNull();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("findNearDuplicate returns null when no entry crosses the Jaccard threshold", async () => {
      const root = await tempProject();
      try {
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "older", touchSurface: ["src/auth.ts", "src/session.ts"] })
        );
        const candidate = baseEntry({ slug: "newer", touchSurface: ["src/payments.ts", "src/billing.ts"] });
        const match = await findNearDuplicate(root, candidate);
        expect(match).toBeNull();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("findNearDuplicate returns the highest-similarity match when threshold crossed", async () => {
      const root = await tempProject();
      try {
        await appendKnowledgeEntry(
          root,
          baseEntry({
            slug: "auth-rework",
            touchSurface: ["src/auth.ts", "src/session.ts", "src/middleware.ts"],
            tags: ["auth", "security"]
          })
        );
        await appendKnowledgeEntry(
          root,
          baseEntry({
            slug: "unrelated",
            touchSurface: ["src/billing.ts", "src/invoice.ts"],
            tags: ["payments"]
          })
        );
        const candidate = baseEntry({
          slug: "auth-followup",
          touchSurface: ["src/auth.ts", "src/session.ts", "src/middleware.ts"],
          tags: ["auth"]
        });
        const match = await findNearDuplicate(root, candidate);
        expect(match).not.toBeNull();
        expect(match!.entry.slug).toBe("auth-rework");
        expect(match!.similarity).toBeGreaterThanOrEqual(0.6);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("findNearDuplicate excludes the candidate's own slug from the window", async () => {
      const root = await tempProject();
      try {
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "same", touchSurface: ["src/a.ts", "src/b.ts"], tags: ["x"] })
        );
        const candidate = baseEntry({ slug: "same", touchSurface: ["src/a.ts", "src/b.ts"], tags: ["x"] });
        const match = await findNearDuplicate(root, candidate);
        expect(match).toBeNull();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("findNearDuplicate respects an overridden jaccardThreshold", async () => {
      const root = await tempProject();
      try {
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "older", touchSurface: ["src/auth.ts"], tags: [] })
        );
        const candidate = baseEntry({ slug: "newer", touchSurface: ["src/auth.ts", "src/session.ts"], tags: [] });
        // Jaccard = 1/2 = 0.5
        const noMatch = await findNearDuplicate(root, candidate, { jaccardThreshold: 0.6 });
        expect(noMatch).toBeNull();
        const match = await findNearDuplicate(root, candidate, { jaccardThreshold: 0.4 });
        expect(match).not.toBeNull();
        expect(match!.entry.slug).toBe("older");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("findNearDuplicate scans only the most recent windowSize entries", async () => {
      const root = await tempProject();
      try {
        // Old entry that *would* match
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "ancient", touchSurface: ["src/auth.ts", "src/session.ts"], tags: ["auth"] })
        );
        // Fill window with non-matches
        for (let i = 0; i < 10; i++) {
          await appendKnowledgeEntry(
            root,
            baseEntry({ slug: `noise-${i}`, touchSurface: [`src/noise${i}.ts`], tags: ["noise"] })
          );
        }
        const candidate = baseEntry({ slug: "newer", touchSurface: ["src/auth.ts", "src/session.ts"], tags: ["auth"] });
        const matchInLargeWindow = await findNearDuplicate(root, candidate, { windowSize: 50 });
        expect(matchInLargeWindow?.entry.slug).toBe("ancient");
        const matchInSmallWindow = await findNearDuplicate(root, candidate, { windowSize: 5 });
        expect(matchInSmallWindow).toBeNull();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("findNearDuplicate rejects invalid threshold values", async () => {
      const root = await tempProject();
      try {
        await expect(findNearDuplicate(root, baseEntry({ slug: "x" }), { jaccardThreshold: 0 })).rejects.toThrow();
        await expect(findNearDuplicate(root, baseEntry({ slug: "x" }), { jaccardThreshold: 1.5 })).rejects.toThrow();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("readKnowledgeLog round-trips touchSurface, tags, and dedupeOf", async () => {
      const root = await tempProject();
      try {
        const entry = baseEntry({
          slug: "round-trip",
          touchSurface: ["src/a.ts"],
          tags: ["x"],
          dedupeOf: "older-slug"
        });
        await appendKnowledgeEntry(root, entry);
        const all = await readKnowledgeLog(root);
        expect(all).toHaveLength(1);
        expect(all[0].touchSurface).toEqual(["src/a.ts"]);
        expect(all[0].tags).toEqual(["x"]);
        expect(all[0].dedupeOf).toBe("older-slug");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("appendKnowledgeEntry rejects malformed touchSurface / tags / dedupeOf", async () => {
      const root = await tempProject();
      try {
        await expect(
          appendKnowledgeEntry(root, { ...baseEntry(), touchSurface: ["ok", 42 as unknown as string] })
        ).rejects.toThrow(/touchSurface/);
        await expect(
          appendKnowledgeEntry(root, { ...baseEntry(), tags: [{ bad: true } as unknown as string] })
        ).rejects.toThrow(/tags/);
        await expect(
          appendKnowledgeEntry(root, { ...baseEntry(), dedupeOf: 123 as unknown as string })
        ).rejects.toThrow(/dedupeOf/);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("A3 — runCompoundAndShip wires dedup into appended entries", () => {
    async function setupShipReady(root: string, slug: string): Promise<void> {
      await ensureDir(activeArtifactDir(root, slug));
      const planPath = activeArtifactPath(root, "plan", slug);
      await writeFile(planPath, "# plan\n", "utf8");
      const base = createInitialFlowState();
      const state = {
        ...base,
        currentSlug: slug,
        currentStage: "ship" as const,
        ac: [{ id: "AC-1", text: "demo", status: "committed" as const }],
        triage: {
          complexity: "small-medium" as const,
          acMode: "soft" as const,
          path: ["plan", "build", "review", "ship"] as const,
          rationale: "test",
          decidedAt: new Date().toISOString(),
          userOverrode: false
        }
      };
      await writeFlowState(root, state as never);
    }

    it("attaches dedupeOf when a near-duplicate exists in knowledge.jsonl", async () => {
      const root = await tempProject();
      try {
        await mkdir(path.dirname(knowledgeLogPath(root)), { recursive: true });
        await appendKnowledgeEntry(
          root,
          baseEntry({
            slug: "earlier-auth",
            touchSurface: ["src/auth.ts", "src/session.ts", "src/middleware.ts"],
            tags: ["auth"]
          })
        );

        await setupShipReady(root, "later-auth");

        const result = await runCompoundAndShip(root, {
          shipCommit: "feedface",
          signals: {
            hasArchitectDecision: false,
            reviewIterations: 1,
            securityFlag: false,
            userRequestedCapture: true
          },
          touchSurface: ["src/auth.ts", "src/session.ts", "src/middleware.ts"],
          tags: ["auth"]
        });

        expect(result.dedupeMatch?.entry.slug).toBe("earlier-auth");
        expect(result.knowledgeEntry?.dedupeOf).toBe("earlier-auth");

        const onDisk = await readKnowledgeLog(root);
        const persisted = onDisk.find((entry) => entry.slug === "later-auth");
        expect(persisted?.dedupeOf).toBe("earlier-auth");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("does NOT attach dedupeOf when caller disables dedup", async () => {
      const root = await tempProject();
      try {
        await mkdir(path.dirname(knowledgeLogPath(root)), { recursive: true });
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "older", touchSurface: ["src/a.ts", "src/b.ts"], tags: ["x"] })
        );

        await setupShipReady(root, "newer");

        const result = await runCompoundAndShip(root, {
          shipCommit: "feedface",
          signals: {
            hasArchitectDecision: false,
            reviewIterations: 1,
            securityFlag: false,
            userRequestedCapture: true
          },
          touchSurface: ["src/a.ts", "src/b.ts"],
          tags: ["x"],
          dedupOptions: { disable: true }
        });

        expect(result.dedupeMatch).toBeNull();
        expect(result.knowledgeEntry?.dedupeOf).toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("does NOT attach dedupeOf when learning is not captured (signals below threshold)", async () => {
      const root = await tempProject();
      try {
        await mkdir(path.dirname(knowledgeLogPath(root)), { recursive: true });
        await appendKnowledgeEntry(
          root,
          baseEntry({ slug: "older", touchSurface: ["src/a.ts", "src/b.ts"], tags: ["x"] })
        );

        await setupShipReady(root, "newer-noncaptured");

        const result = await runCompoundAndShip(root, {
          shipCommit: "feedface",
          signals: {
            hasArchitectDecision: false,
            reviewIterations: 0,
            securityFlag: false,
            userRequestedCapture: false
          },
          touchSurface: ["src/a.ts", "src/b.ts"],
          tags: ["x"]
        });

        expect(result.learningCaptured).toBe(false);
        expect(result.knowledgeEntry).toBeUndefined();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("A5 — slice-builder coverage-assess beat", () => {
    it("slice-builder prompt declares hard rule 17 about Coverage between GREEN and REFACTOR", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/17\. \*\*Coverage assessment between GREEN and REFACTOR/);
    });

    it("slice-builder prompt enumerates the three verdicts (full / partial / refactor-only)", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/\*\*`full`\*\*/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/\*\*`partial`\*\*/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/\*\*`refactor-only`\*\*/);
    });

    it("slice-builder prompt declares the new self_review rule `coverage-assessed`", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/coverage-assessed/);
    });

    it("slice-builder self-review gate now declares five rules (was four)", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/\*\*five mandatory rules\*\*/);
      expect(SLICE_BUILDER_PROMPT).not.toMatch(/\*\*four mandatory rules\*\*/);
    });

    it("strict BUILD_TEMPLATE includes a `## Coverage assessment` section with the three-column table", () => {
      const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === "build");
      expect(template).toBeDefined();
      expect(template!.body).toMatch(/## Coverage assessment/);
      expect(template!.body).toMatch(/Verdict.*Branches covered.*Branches uncovered/);
    });

    it("soft BUILD_TEMPLATE_SOFT adds a Coverage bullet to the build log", () => {
      const template = ARTIFACT_TEMPLATES.find((entry) => entry.id === "build-soft");
      expect(template).toBeDefined();
      expect(template!.body).toMatch(/\*\*Coverage\*\*:/);
    });

    it("orchestrator self-review gate counts five rules, including coverage-assessed (v8.54: in handoff-gates runbook)", () => {
      const selfReview = ON_DEMAND_RUNBOOKS.find((r) => r.id === "handoff-gates")!.body;
      expect(selfReview).toMatch(/five rule attestations per AC/);
      expect(selfReview).toMatch(/coverage-assessed/);
      expect(START_COMMAND_BODY).toContain("handoff-gates.md");
    });
  });

  // B2 — session-start hook (retired entirely in v8.40 along with
  // commit-helper.mjs). The v8.9 pressure-advice work was already trimmed
  // to a one-line ping in v8.38; v8.40 retires the hook itself. The
  // tripwires that pinned the ping body now live in `v840-cleanup.test.ts`,
  // which asserts the hook file no longer ships at all.
});
