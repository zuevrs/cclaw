import { describe, expect, it } from "vitest";

import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";
import { parseArtifact } from "../../src/artifact-frontmatter.js";

/**
 * Artifact templates are validated by the *code* schema, not just prose.
 *
 * `parseArtifact` (src/artifact-frontmatter.ts) is the single source of
 * truth for an artifact's frontmatter contract — required keys, the `ac`
 * array shape, and the posture enum (derived from `POSTURES`). Every shipped
 * template must satisfy that parser, so the prose template and the runtime
 * validator can never drift: a template that drops `slug`, uses an unknown
 * posture, or emits invalid YAML fails here instead of at install time in a
 * user's repo.
 *
 * This is the lightweight, dependency-free form of "schema as code": we reuse
 * the validator the runtime already trusts rather than adding a schema lib.
 */

/**
 * Bespoke artifacts that intentionally do NOT follow the standard
 * slug/stage/status contract and are never read through `parseArtifact`:
 *
 *  - `investigation` — debug-branch artifact authored by the investigator;
 *    its frontmatter is slug/stage/specialist/verdict/confidence (no
 *    `status`), and the orchestrator reads `verdict`/`confidence` directly.
 *
 * Add an id here only when the artifact genuinely has its own shape.
 */
const NON_STANDARD_ARTIFACTS = new Set(["investigation"]);

const templatesWithFrontmatter = ARTIFACT_TEMPLATES.filter(
  (t) => t.body.startsWith("---") && !NON_STANDARD_ARTIFACTS.has(t.id)
);

describe("artifact templates satisfy the parseArtifact code schema (SSOT)", () => {
  it("the corpus ships frontmatter templates to validate", () => {
    expect(templatesWithFrontmatter.length).toBeGreaterThan(0);
  });

  it.each(templatesWithFrontmatter.map((t) => t.id))(
    "template `%s` parses against parseArtifact without error",
    (id) => {
      const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === id)!;
      expect(() => parseArtifact(tpl.body, `template:${id}`)).not.toThrow();
    }
  );

  it.each(templatesWithFrontmatter.map((t) => t.id))(
    "template `%s` declares the required frontmatter keys (slug / stage / status)",
    (id) => {
      const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === id)!;
      const { frontmatter } = parseArtifact(tpl.body);
      expect(typeof frontmatter.slug, "slug must be a string").toBe("string");
      expect(frontmatter.slug.length, "slug must be non-empty").toBeGreaterThan(0);
      expect(typeof frontmatter.stage, "stage must be a string").toBe("string");
      expect(typeof frontmatter.status, "status must be a string").toBe("string");
    }
  );
});
