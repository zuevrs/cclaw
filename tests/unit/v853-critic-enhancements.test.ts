import { describe, expect, it } from "vitest";

import {
  DEFAULT_AMBIGUITY_THRESHOLD,
  ambiguityThresholdOf,
  type CclawConfig
} from "../../src/config.js";

/**
 * v8.53 — critic enhancements anchors. Slimmed in v8.100.
 *
 * Kept only the `ambiguityThresholdOf` config-utility wiring tests. The
 * critic/architect prompt greps and template frontmatter greps were
 * removed — they're tripwires for surface prose, not for real wiring.
 */
describe("v8.53 — ambiguity threshold config util", () => {
  it("ambiguityThresholdOf returns the config-supplied value when set, else the default", () => {
    expect(ambiguityThresholdOf({} as CclawConfig)).toBe(DEFAULT_AMBIGUITY_THRESHOLD);
    expect(
      ambiguityThresholdOf({ design: { ambiguity_threshold: 0.5 } } as CclawConfig)
    ).toBe(0.5);
  });

  it("ambiguityThresholdOf rejects out-of-range values by falling back to the default", () => {
    expect(
      ambiguityThresholdOf({ design: { ambiguity_threshold: 1.5 } } as CclawConfig)
    ).toBe(DEFAULT_AMBIGUITY_THRESHOLD);
    expect(
      ambiguityThresholdOf({ design: { ambiguity_threshold: -0.1 } } as CclawConfig)
    ).toBe(DEFAULT_AMBIGUITY_THRESHOLD);
  });
});
