import { describe, expect, it } from "vitest";
import { createDefaultConfig, validateHarnesses } from "../../src/config.js";

describe("config", () => {
  it("default config locks v8 flow + minimal hooks", () => {
    const config = createDefaultConfig();
    expect(config.flowVersion).toBe("8");
    expect(config.hooks.profile).toBe("minimal");
    expect(config.harnesses).toEqual(["cursor"]);
  });

  it("validateHarnesses accepts known ids", () => {
    expect(validateHarnesses(["cursor", "claude"]).sort()).toEqual(["claude", "cursor"]);
  });

  it("validateHarnesses rejects unknown ids", () => {
    expect(() => validateHarnesses(["bogus"])).toThrow();
  });

  it("validateHarnesses rejects empty list", () => {
    expect(() => validateHarnesses([])).toThrow();
  });
});
