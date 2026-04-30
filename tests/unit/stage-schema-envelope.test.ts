import { describe, expect, it } from "vitest";
import {
  parseSkillEnvelope,
  validateSkillEnvelope
} from "../../src/content/stage-schema.js";

describe("skill envelope schema", () => {
  it("validates a correct envelope", () => {
    const envelope = {
      version: "1",
      kind: "stage-output",
      stage: "tdd",
      payload: { command: "/cc" },
      emittedAt: "2026-01-01T00:00:00Z",
      agent: "controller"
    };
    const validation = validateSkillEnvelope(envelope);
    expect(validation.ok).toBe(true);
    expect(validation.errors).toEqual([]);
  });

  it("allows non-flow envelopes for read-only/operator commands", () => {
    const validation = validateSkillEnvelope({
      version: "1",
      kind: "stage-output",
      stage: "non-flow",
      payload: { command: "/cc-view", subcommand: "status" },
      emittedAt: "2026-01-01T00:00:00Z"
    });
    expect(validation.ok).toBe(true);
  });

  it("rejects malformed envelope", () => {
    const validation = validateSkillEnvelope({
      version: "2",
      kind: "unknown",
      stage: "invalid",
      emittedAt: "yesterday"
    });
    expect(validation.ok).toBe(false);
    expect(validation.errors.join(" ")).toMatch(/version/);
    expect(validation.errors.join(" ")).toMatch(/kind/);
    expect(validation.errors.join(" ")).toMatch(/stage/);
    expect(validation.errors.join(" ")).toMatch(/payload/);
  });

  it("parses valid envelope JSON", () => {
    const parsed = parseSkillEnvelope(
      JSON.stringify({
        version: "1",
        kind: "gate-result",
        stage: "review",
        payload: { verdict: "APPROVED" },
        emittedAt: "2026-01-01T00:00:00Z"
      })
    );
    expect(parsed?.kind).toBe("gate-result");
    expect(parsed?.stage).toBe("review");
  });
});
