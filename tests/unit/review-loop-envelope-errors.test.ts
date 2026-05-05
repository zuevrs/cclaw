import { describe, expect, it } from "vitest";
import {
  reviewLoopEnvelopeExample,
  validateReviewLoopGateEvidence
} from "../../src/internal/advance-stage/review-loop.js";

/**
 * — review-loop envelope error consistency.
 *
 * The user's quick-tier test reported `gate evidence format check
 * failed: design_architecture_locked: must be JSON containing a
 * review-loop envelope (type: "review-loop") in top-level, payload,
 * or reviewLoop` and the agent had to guess the envelope shape four
 * times before passing — first putting `stage` inside `payload`,
 * then omitting it for auto-hydrate, etc. promises the
 * error message ALWAYS includes a complete, copy-pasteable JSON
 * shape so the agent never has to guess.
 */

describe("— reviewLoopEnvelopeExample shape", () => {
  it("returns a parseable JSON envelope for design", () => {
    const example = reviewLoopEnvelopeExample("design");
    const parsed = JSON.parse(example);
    expect(parsed.type).toBe("review-loop");
    expect(parsed.stage).toBe("design");
    expect(typeof parsed.targetScore).toBe("number");
    expect(typeof parsed.maxIterations).toBe("number");
    expect(typeof parsed.stopReason).toBe("string");
    expect(Array.isArray(parsed.iterations)).toBe(true);
    expect(parsed.iterations.length).toBeGreaterThan(0);
  });

  it("returns a parseable JSON envelope for scope", () => {
    const parsed = JSON.parse(reviewLoopEnvelopeExample("scope"));
    expect(parsed.stage).toBe("scope");
  });

  it("places `stage` at the TOP level of the envelope, not inside payload", () => {
    const parsed = JSON.parse(reviewLoopEnvelopeExample("design"));
    expect(parsed.stage).toBeDefined();
    expect(parsed.payload).toBeUndefined();
    // The user's agent kept guessing `payload.stage` — make sure the
    // canonical example never carries a stray `payload` envelope.
    expect(Object.keys(parsed)).not.toContain("payload");
  });
});

describe("— validateReviewLoopGateEvidence error messages", () => {
  it("includes a copy-pasteable envelope example when JSON is invalid", () => {
    const error = validateReviewLoopGateEvidence("design", "not valid json {");
    expect(error).not.toBeNull();
    expect(error).toMatch(/Expected envelope:/u);
    expect(error).toMatch(/"type":"review-loop"/u);
    expect(error).toMatch(/"stage":"design"/u);
  });

  it("includes the envelope example when envelope is missing entirely", () => {
    const error = validateReviewLoopGateEvidence("design", JSON.stringify({ foo: "bar" }));
    expect(error).not.toBeNull();
    expect(error).toMatch(/Expected envelope:/u);
    expect(error).toMatch(/"type":"review-loop"/u);
  });

  it("explicitly tells the agent that `stage` MUST be at the top level (not inside payload)", () => {
    const error = validateReviewLoopGateEvidence(
      "design",
      JSON.stringify({ type: "review-loop", payload: { stage: "design" } })
    );
    expect(error).not.toBeNull();
    expect(error).toMatch(/stage MUST be at the top level/iu);
    // Also includes the example so a copy-paste recovery is possible.
    expect(error).toMatch(/"stage":"design"/u);
  });

  it("returns null for a properly shaped design envelope", () => {
    const envelope = {
      type: "review-loop",
      stage: "design",
      targetScore: 0.8,
      maxIterations: 3,
      stopReason: "quality_threshold_met",
      iterations: [{ iteration: 1, qualityScore: 0.85, findingsCount: 0 }]
    };
    expect(validateReviewLoopGateEvidence("design", JSON.stringify(envelope))).toBeNull();
  });

  it("returns null for a properly shaped scope envelope", () => {
    const envelope = {
      type: "review-loop",
      stage: "scope",
      targetScore: 0.8,
      maxIterations: 3,
      stopReason: "max_iterations_reached",
      iterations: [
        { iteration: 1, qualityScore: 0.6, findingsCount: 2 },
        { iteration: 2, qualityScore: 0.7, findingsCount: 1 },
        { iteration: 3, qualityScore: 0.75, findingsCount: 0 }
      ]
    };
    expect(validateReviewLoopGateEvidence("scope", JSON.stringify(envelope))).toBeNull();
  });
});
