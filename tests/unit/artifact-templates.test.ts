import { describe, expect, it } from "vitest";
import {
  ARTIFACT_TEMPLATES,
  manifestTemplate,
  planTemplateForSlug,
  templateBody
} from "../../src/content/artifact-templates.js";
import { parseArtifact } from "../../src/artifact-frontmatter.js";

describe("artifact-templates", () => {
  it("ships templates for every artifact stage", () => {
    const ids = ARTIFACT_TEMPLATES.map((template) => template.id);
    for (const expected of ["plan", "build", "review", "ship", "decisions", "learnings", "manifest", "ideas"]) {
      expect(ids).toContain(expected);
    }
  });

  it("does NOT ship an agents-block template (cclaw v8 keeps project root clean)", () => {
    const ids = ARTIFACT_TEMPLATES.map((template) => template.id);
    expect(ids).not.toContain("agents-block");
  });

  it("plan template parses as valid frontmatter once slug is replaced", () => {
    const body = planTemplateForSlug("approval-page");
    const parsed = parseArtifact(body);
    expect(parsed.frontmatter.slug).toBe("approval-page");
    expect(parsed.frontmatter.stage).toBe("plan");
    expect(parsed.frontmatter.status).toBe("active");
    expect(Array.isArray(parsed.frontmatter.ac)).toBe(true);
    expect(parsed.body).toContain("Acceptance Criteria");
    expect(parsed.body).toContain("Traceability block");
  });

  it("manifest template substitutes ship_commit and shipped_at placeholders", () => {
    const body = manifestTemplate("alpha", "abc1234", "2026-05-07T00:00:00Z");
    const parsed = parseArtifact(body);
    expect(parsed.frontmatter.slug).toBe("alpha");
    expect(parsed.frontmatter.ship_commit).toBe("abc1234");
    expect(parsed.frontmatter.shipped_at).toBe("2026-05-07T00:00:00Z");
  });

  it("review template includes Five Failure Modes block and Concern Ledger", () => {
    const body = templateBody("review", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).toContain("Five Failure Modes");
    expect(body).toContain("Hallucinated actions");
    expect(body).toContain("Tool misuse");
    expect(body).toContain("Concern Ledger");
    expect(body).toContain("Convergence detector");
  });

  it("ship template includes AC ↔ commit map", () => {
    const body = templateBody("ship", { "SLUG-PLACEHOLDER": "alpha" });
    expect(body).toContain("AC ↔ commit map");
    expect(body).toContain("push: _pending");
    expect(body).toContain("PR: _pending");
  });

});
