import { describe, expect, it } from "vitest";
import type { IdeateFrameId } from "../../src/content/ideate-frames.js";
import {
  DEFAULT_IDEATE_FRAME_IDS,
  IDEATE_FRAMES,
  buildIdeateFrameDispatchPlan,
  dedupeIdeateCandidates,
  resolveIdeateFrames
} from "../../src/content/ideate-frames.js";

describe("ideate frame registry", () => {
  it("ships six default frames with prompt and example patterns", () => {
    expect(DEFAULT_IDEATE_FRAME_IDS).toHaveLength(6);
    expect(IDEATE_FRAMES).toHaveLength(6);
    for (const frame of IDEATE_FRAMES) {
      expect(frame.id.trim().length).toBeGreaterThan(0);
      expect(frame.label.trim().length).toBeGreaterThan(0);
      expect(frame.prompt.trim().length).toBeGreaterThan(20);
      expect(frame.examplePatterns.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("resolves a deduped subset in caller order", () => {
    const selected = resolveIdeateFrames([
      "leverage",
      "pain-friction",
      "leverage",
      "constraint-flip"
    ]);
    expect(selected.map((frame) => frame.id)).toEqual([
      "leverage",
      "pain-friction",
      "constraint-flip"
    ]);
  });

  it("throws on unknown frame ids", () => {
    expect(() =>
      resolveIdeateFrames(["not-a-frame" as IdeateFrameId])
    ).toThrow(/unknown ideate frame id/i);
  });

  it("builds parallel dispatch prompts with frame context", () => {
    const plan = buildIdeateFrameDispatchPlan(
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
    const merged = dedupeIdeateCandidates([
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
        title: "Tighten doctor trace check output",
        evidencePath: "src/doctor.ts",
        summary: "Improve visibility of missing links.",
        frameId: "leverage"
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
