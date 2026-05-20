import { describe, expect, test } from "vitest";
import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";

describe("v8.109 — builder cites shared anti-rationalizations catalog (B.9)", () => {
  test("builder prompt contains the .cclaw/lib/anti-rationalizations.md pointer", () => {
    expect(BUILDER_PROMPT).toContain(".cclaw/lib/anti-rationalizations.md");
  });

  test("builder prompt names the four relevant categories", () => {
    expect(BUILDER_PROMPT).toMatch(/commit-discipline/);
    expect(BUILDER_PROMPT).toMatch(/posture-bypass/);
    expect(BUILDER_PROMPT).toMatch(/edit-discipline/);
    expect(BUILDER_PROMPT).toMatch(/\bverification\b/);
  });
});
