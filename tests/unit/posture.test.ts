import { describe, expect, it } from "vitest";
import {
  FrontmatterError,
  parseArtifact
} from "../../src/artifact-frontmatter.js";
import {
  POSTURES,
  DEFAULT_POSTURE,
  isPosture,
  type Posture
} from "../../src/types.js";
import { ARTIFACT_TEMPLATES } from "../../src/content/artifact-templates.js";

/**
 * v8.36 — `posture` field on Acceptance Criteria frontmatter.
 *
 * Lightweight per-AC annotation (everyinc-compound pattern) that
 * captures WHY the AC needs a different commit cadence than the
 * default test-first cycle. The enum carries 6 values:
 *
 *   test-first              (default — RED → GREEN → REFACTOR)
 *   characterization-first  (legacy code: pin existing behaviour first)
 *   tests-as-deliverable    (contract / integration tests; tests ARE the AC)
 *   refactor-only           (pure rename / extract / inline; no new behaviour)
 *   docs-only               (README / CHANGELOG / docs/** edits)
 *   bootstrap               (test framework setup; GREEN-only for AC-1)
 *
 * Posture is the **annotation**; the `is_behavior_adding` predicate is
 * the **gate**. Posture lives in `plan.md` AC frontmatter; the
 * predicate lives in `src/posture-validation.ts` (v8.40+; previously
 * inlined in the retired `commit-helper.mjs`) and double-checks that
 * the declared posture is consistent with the AC's `touchSurface` at
 * reviewer time.
 */

const PLAN_TEMPLATE = ARTIFACT_TEMPLATES.find((t) => t.id === "plan")!;

describe("v8.36 — posture enum + types", () => {
  it("AC-2 — POSTURES export carries exactly the six canonical values", () => {
    expect(POSTURES).toEqual([
      "test-first",
      "characterization-first",
      "tests-as-deliverable",
      "refactor-only",
      "docs-only",
      "bootstrap"
    ]);
  });

  it("AC-2 — DEFAULT_POSTURE is `test-first` (preserves current behaviour for legacy plans)", () => {
    expect(DEFAULT_POSTURE).toBe("test-first");
  });

  it("AC-2 — isPosture narrows to a known value", () => {
    for (const value of POSTURES) {
      expect(isPosture(value)).toBe(true);
    }
    expect(isPosture("unknown")).toBe(false);
    expect(isPosture("")).toBe(false);
    expect(isPosture(null)).toBe(false);
    expect(isPosture(undefined)).toBe(false);
    expect(isPosture(42)).toBe(false);
  });

  it("AC-2 — every posture value is a non-empty kebab-case string", () => {
    for (const posture of POSTURES) {
      expect(posture).toMatch(/^[a-z]+(-[a-z]+)*$/u);
    }
  });
});

describe("v8.36 — AC frontmatter parser accepts the posture field", () => {
  it("AC-2 — parseArtifact accepts an AC stanza with a known posture value", () => {
    const raw = `---
slug: alpha
stage: plan
status: active
ac:
  - id: AC-1
    text: "Add foo"
    status: pending
    posture: tests-as-deliverable
    touchSurface: [tests/unit/foo.test.ts]
---

body
`;
    const parsed = parseArtifact(raw);
    const ac0 = (parsed.frontmatter.ac as Array<{ posture?: Posture }>)[0];
    expect(ac0.posture).toBe("tests-as-deliverable");
  });

  it("AC-2 — parseArtifact accepts AC without a posture field (defaults are applied downstream)", () => {
    const raw = `---
slug: alpha
stage: plan
status: active
ac:
  - id: AC-1
    text: "Add foo"
    status: pending
    touchSurface: [src/foo.ts]
---

body
`;
    const parsed = parseArtifact(raw);
    const ac0 = (parsed.frontmatter.ac as Array<{ posture?: Posture }>)[0];
    expect(ac0.posture).toBeUndefined();
  });

  it("AC-2 — parseArtifact REJECTS an AC stanza with an unknown posture value", () => {
    const raw = `---
slug: alpha
stage: plan
status: active
ac:
  - id: AC-1
    text: "Add foo"
    status: pending
    posture: yolo-mode
---

body
`;
    expect(() => parseArtifact(raw)).toThrow(FrontmatterError);
    expect(() => parseArtifact(raw)).toThrow(/posture/);
    expect(() => parseArtifact(raw)).toThrow(/yolo-mode/);
    expect(() => parseArtifact(raw)).toThrow(/AC-1/);
  });

  it("AC-2 — parseArtifact rejects an AC stanza whose posture is a non-string (e.g. boolean)", () => {
    const raw = `---
slug: alpha
stage: plan
status: active
ac:
  - id: AC-1
    text: "Add foo"
    status: pending
    posture: true
---

body
`;
    expect(() => parseArtifact(raw)).toThrow(FrontmatterError);
    expect(() => parseArtifact(raw)).toThrow(/posture/);
  });

  it("AC-2 — every known posture value round-trips through parseArtifact", () => {
    for (const posture of POSTURES) {
      const raw = `---
slug: round-trip
stage: plan
status: active
ac:
  - id: AC-1
    text: "Round-trip"
    status: pending
    posture: ${posture}
---

body
`;
      const parsed = parseArtifact(raw);
      const ac0 = (parsed.frontmatter.ac as Array<{ posture?: Posture }>)[0];
      expect(ac0.posture).toBe(posture);
    }
  });
});

describe("v8.36 — plan.md template carries the posture field", () => {
  it("AC-2 — strict-mode plan template's AC stanza includes `posture:` with the default", () => {
    expect(PLAN_TEMPLATE.body).toContain("posture:");
    // Default is documented as test-first so a new plan inherits the
    // standard ceremony unless the ac-author overrides.
    expect(PLAN_TEMPLATE.body).toMatch(/posture:\s*test-first/);
  });

  it("AC-2 — strict-mode plan template documents the six allowed values", () => {
    for (const posture of POSTURES) {
      expect(
        PLAN_TEMPLATE.body,
        `template must mention "${posture}" so the ac-author knows it is a valid value`
      ).toContain(posture);
    }
  });

  it("AC-2 — strict-mode plan template's Acceptance Criteria documents posture as a column or attribute", () => {
    // Either inline in the AC frontmatter section OR as a column in
    // the AC table. The exact placement is the ac-author's call; the
    // tripwire just enforces that posture is documented in plan.md
    // so the ac-author cannot forget it exists.
    expect(PLAN_TEMPLATE.body).toMatch(/posture/i);
  });
});
