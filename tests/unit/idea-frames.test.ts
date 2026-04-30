import { describe, expect, it } from "vitest";
import type { IdeaFrameId } from "../../src/content/idea.js";
import {
  DEFAULT_IDEA_FRAME_IDS,
  IDEA_FRAMES,
  buildIdeaFrameDispatchPlan,
  dedupeIdeaCandidates,
  resolveIdeaFrames
} from "../../src/content/idea.js";

describe("idea frame registry", () => {
  it("ships three default frames with prompt and example patterns", () => {
    expect(DEFAULT_IDEA_FRAME_IDS).toHaveLength(3);
    expect(IDEA_FRAMES).toHaveLength(3);
    for (const frame of IDEA_FRAMES) {
      expect(frame.id.trim().length).toBeGreaterThan(0);
      expect(frame.label.trim().length).toBeGreaterThan(0);
      expect(frame.prompt.trim().length).toBeGreaterThan(20);
      expect(frame.examplePatterns.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("resolves a deduped subset in caller order", () => {
    const selected = resolveIdeaFrames([
      "assumption-break",
      "pain-friction",
      "assumption-break",
      "cross-domain-analogy"
    ]);
    expect(selected.map((frame) => frame.id)).toEqual([
      "assumption-break",
      "pain-friction",
      "cross-domain-analogy"
    ]);
  });

  it("throws on unknown frame ids", () => {
    expect(() =>
      resolveIdeaFrames(["not-a-frame" as IdeaFrameId])
    ).toThrow(/unknown idea frame id/i);
  });

  it("builds parallel dispatch prompts with frame context", () => {
    const plan = buildIdeaFrameDispatchPlan(
      {
        focus: "reduce flaky tests in flow-state runtime",
        mode: "repo-grounded",
        signalSummary: [
          "tests/unit/runs.test.ts reports occasional timeout windows",
          "TODO markers around state reset logic"
        ]
      },
      ["pain-friction", "assumption-break"]
    );

    expect(plan).toHaveLength(2);
    expect(plan[0]?.frameId).toBe("pain-friction");
    expect(plan[0]?.prompt).toContain("Mode: repo-grounded");
    expect(plan[0]?.prompt).toContain("Focus: reduce flaky tests in flow-state runtime");
    expect(plan[1]?.frameId).toBe("assumption-break");
    expect(plan[1]?.prompt).toContain("Generate 3-5 concrete candidates");
  });

  it("dedupes equivalent candidates across multiple frames", () => {
    const merged = dedupeIdeaCandidates([
      {
        title: "Stabilize flow-state reset cleanup",
        evidencePath: "tests/unit/runs.test.ts",
        summary: "Address timeout-prone cleanup branch.",
        frameId: "pain-friction"
      },
      {
        title: "stabilize flow-state   reset cleanup",
        evidencePath: "tests/unit/runs.test.ts",
        summary: "Same proposal from an assumption-break angle with deeper rationale.",
        frameId: "assumption-break"
      },
      {
        title: "Tighten sync trace check output",
        evidencePath: "src/sync.ts",
        summary: "Improve visibility of missing links.",
        frameId: "assumption-break"
      }
    ]);

    expect(merged).toHaveLength(2);
    const stabilized = merged.find((entry) =>
      entry.title.toLowerCase().includes("stabilize flow-state")
    );
    expect(stabilized?.frameIds).toEqual(["pain-friction", "assumption-break"]);
    expect(stabilized?.summary).toContain("deeper rationale");
  });
});
