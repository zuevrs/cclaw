import { describe, expect, test } from "vitest";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

function bodyOf(id: string): string {
  const tpl = ARTIFACT_TEMPLATES.find((t) => t.id === id);
  if (!tpl) throw new Error(`unknown template id: ${id}`);
  return tpl.body;
}

const TEMPLATE_IDS = [
  "plan",
  "plan-soft",
  "build",
  "build-soft",
  "review",
  "critic",
  "ship",
  "learnings",
] as const;

describe("v8.109 — Summary block scaffolding (B.7)", () => {
  // Accept either canonical `## Summary` or numbered `## N. Summary` heading
  // (CRITIC_TEMPLATE uses `## 8. Summary — critic` because the body is
  // section-numbered 1..8; the spirit of the skill is the three-section
  // sub-headings, not the heading-prefix shape).
  const SUMMARY_HEADING = /^##\s+(?:\d+\.\s+)?Summary\b/m;

  for (const id of TEMPLATE_IDS) {
    test(`${id} template contains the three-section Summary block`, () => {
      const body = bodyOf(id);
      expect(body).toMatch(SUMMARY_HEADING);
      expect(body).toMatch(/### Changes made/);
      expect(body).toMatch(/### Things I noticed but didn't touch/);
      expect(body).toMatch(/### Potential concerns/);
    });
  }

  test("Summary block sits at the END of each template body", () => {
    for (const id of TEMPLATE_IDS) {
      const body = bodyOf(id);
      const match = SUMMARY_HEADING.exec(body);
      expect(match).not.toBeNull();
      const tail = body.slice(match!.index);
      expect(tail).toMatch(/### Changes made/);
      expect(tail).toMatch(/### Things I noticed but didn't touch/);
      expect(tail).toMatch(/### Potential concerns/);
    }
  });
});
