import { describe, expect, it } from "vitest";
import { stageCompleteScript } from "../../src/content/hooks.js";

describe("stage-complete hook USAGE", () => {
  it("documents proactive waiver flags", () => {
    const script = stageCompleteScript();
    expect(script).toContain("--accept-proactive-waiver");
    expect(script).toContain("--accept-proactive-waiver-reason");
  });
});
