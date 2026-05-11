import { describe, expect, it } from "vitest";

import {
  AUTO_TRIGGER_SKILLS,
  type AutoTriggerStage
} from "../../src/content/skills.js";

/**
 * v8.33 — additive skills batch II.
 *
 * Following the v8.32 lift of `context-engineering` + `performance-
 * optimization`, the five-audit review identified two more addy-osmani
 * skill patterns that cclaw was missing on the UI / ship boundary:
 * `frontend-ui-engineering` (component architecture + design-system
 * adherence + AI-aesthetic anti-patterns + WCAG 2.1 AA baseline +
 * responsive design) and `ci-cd-and-automation` (8-stage quality gate +
 * GitHub Actions baseline template + caching / parallelism / path
 * filters + branch protection essentials).
 *
 * Both are additive, follow the same shape as the v8.32 lift, and
 * complement the existing skill set without re-targeting any existing
 * surface. The new tripwire pins:
 *   AC-1 — both new skills are registered in AUTO_TRIGGER_SKILLS with
 *          the v8.26-required anatomy (Overview + When + ≥2 depth +
 *          When NOT — the last one is the v8.30 invariant).
 *   AC-2 — stage windowing matches the spec (frontend-ui-engineering on
 *          `["build","review"]`; ci-cd-and-automation on `["ship"]`).
 *   AC-3 — content presence: each skill names the load-bearing
 *          primitives from the audit (component-architecture rules +
 *          AI-aesthetic table + WCAG baseline for frontend-ui; the
 *          8-stage quality-gate ordering + caching/parallelism/path-
 *          filter patterns + branch-protection essentials for ci-cd).
 *   AC-4 — total skill count went 20 → 22 and the descriptions stayed
 *          in sync with the body's identity.
 *
 * The v8.26 anatomy tripwire, the v8.30 anatomy-gaps tripwire, and the
 * v8.32 tripwire continue to fire over the full 22-skill set; v8.33
 * does not modify any of them.
 */

const SKILLS = AUTO_TRIGGER_SKILLS;
const FRONTEND = SKILLS.find((s) => s.id === "frontend-ui-engineering");
const CICD = SKILLS.find((s) => s.id === "ci-cd-and-automation");

describe("v8.33 additive skills batch II — registration", () => {
  it("AC-1 — `frontend-ui-engineering` is registered in AUTO_TRIGGER_SKILLS", () => {
    expect(FRONTEND, "frontend-ui-engineering must be registered").toBeDefined();
    expect(FRONTEND!.fileName).toBe("frontend-ui-engineering.md");
    expect(FRONTEND!.body.length, "skill body must be non-trivial").toBeGreaterThan(2000);
  });

  it("AC-1 — `ci-cd-and-automation` is registered in AUTO_TRIGGER_SKILLS", () => {
    expect(CICD, "ci-cd-and-automation must be registered").toBeDefined();
    expect(CICD!.fileName).toBe("ci-cd-and-automation.md");
    expect(CICD!.body.length, "skill body must be non-trivial").toBeGreaterThan(2000);
  });

  it("AC-1 — total skill count grew from 20 (v8.32) to 22 (v8.33)", () => {
    expect(
      SKILLS.length,
      `expected 22 skills total (v8.32 baseline 20 + 2 new in v8.33); found ${SKILLS.length}`
    ).toBe(22);
  });
});

describe("v8.33 additive skills batch II — stage windowing", () => {
  it("AC-2 — `frontend-ui-engineering` is stage-windowed on `[\"build\",\"review\"]`", () => {
    expect(FRONTEND!.stages).toBeDefined();
    const stages = FRONTEND!.stages as ReadonlyArray<AutoTriggerStage>;
    expect(stages).toContain("build");
    expect(stages).toContain("review");
    expect(
      stages,
      "frontend-ui is not relevant outside build/review — triage/plan/ship/compound should not see it"
    ).not.toContain("triage");
    expect(stages).not.toContain("ship");
    expect(stages).not.toContain("compound");
  });

  it("AC-2 — `frontend-ui-engineering` triggers include `touch-surface:ui` and the file-extension fan-out", () => {
    const triggers = FRONTEND!.triggers;
    expect(triggers).toContain("touch-surface:ui");
    expect(
      triggers.some((t) => /tsx|jsx|vue|svelte/.test(t)),
      "frontend-ui triggers must mention the front-end file extensions per the audit spec"
    ).toBe(true);
  });

  it("AC-2 — `ci-cd-and-automation` is stage-windowed on `[\"ship\"]`", () => {
    expect(CICD!.stages).toBeDefined();
    const stages = CICD!.stages as ReadonlyArray<AutoTriggerStage>;
    expect(
      stages,
      "ci-cd lives on the ship boundary; build/review should not see it"
    ).toEqual(["ship"]);
  });

  it("AC-2 — `ci-cd-and-automation` triggers include `.github/workflows` and ship-stage", () => {
    const triggers = CICD!.triggers;
    expect(triggers).toContain("stage:ship");
    expect(
      triggers.some((t) => /\.github\/workflows/.test(t)),
      "ci-cd triggers must mention the GitHub Actions workflow path per the audit spec"
    ).toBe(true);
  });
});

describe("v8.33 additive skills batch II — content presence (frontend-ui-engineering)", () => {
  it("AC-3 — body names the two component-architecture rules (composition over configuration, controlled vs uncontrolled)", () => {
    const body = FRONTEND!.body;
    expect(body).toMatch(/composition over configuration/i);
    expect(body).toMatch(/controlled vs uncontrolled|controlled.*uncontrolled/i);
  });

  it("AC-3 — body carries an AI-aesthetic anti-pattern table with at least 5 entries", () => {
    const body = FRONTEND!.body;
    expect(body).toMatch(/AI[- ]aesthetic/i);
    const aiSection = body.match(/##\s+AI[- ]aesthetic anti[- ]pattern table/i);
    expect(aiSection, "AI-aesthetic anti-pattern table section must exist").not.toBeNull();
    const slice = body.slice(aiSection!.index!);
    const rowMatches = slice.match(/^\| \*\*[^|]+\*\* /gm);
    expect(
      rowMatches?.length ?? 0,
      "AI-aesthetic anti-pattern table should enumerate at least 5 patterns with bolded names"
    ).toBeGreaterThanOrEqual(5);
  });

  it("AC-3 — body names the canonical AI-aesthetic anti-patterns (purple gradient / rounded-2xl / oversized padding / center-everything)", () => {
    const body = FRONTEND!.body;
    expect(body).toMatch(/purple.*gradient/i);
    expect(body).toMatch(/rounded-2xl/);
    expect(body).toMatch(/oversized padding/i);
    expect(body).toMatch(/center[- ]everything/i);
  });

  it("AC-3 — body declares WCAG 2.1 AA as the accessibility baseline", () => {
    const body = FRONTEND!.body;
    expect(body).toMatch(/WCAG 2\.1 AA/);
    expect(body).toMatch(/focus indicator/i);
    expect(body, "the body must name semantic HTML as the default before ARIA").toMatch(/semantic HTML/i);
    expect(body).toMatch(/ARIA/);
  });

  it("AC-3 — body names the contrast thresholds (4.5:1 text, 3:1 non-text)", () => {
    const body = FRONTEND!.body;
    expect(body).toMatch(/4\.5:1/);
    expect(body).toMatch(/3:1/);
  });

  it("AC-3 — body covers responsive design with mobile-first + ≥44×44px touch targets", () => {
    const body = FRONTEND!.body;
    expect(body).toMatch(/mobile[- ]first/i);
    expect(body).toMatch(/44[×x]44/i);
  });
});

describe("v8.33 additive skills batch II — content presence (ci-cd-and-automation)", () => {
  it("AC-3 — body declares the 8-stage quality-gate ordering (lint → typecheck → test → coverage → security-audit → bundle-check)", () => {
    const body = CICD!.body;
    expect(body).toMatch(/lint/i);
    expect(body).toMatch(/typecheck/i);
    expect(body).toMatch(/\btest\b/i);
    expect(body).toMatch(/coverage/i);
    expect(body).toMatch(/security[- ]audit|security audit/i);
    expect(body).toMatch(/bundle[- ]check|bundle check|bundle size/i);
    expect(
      body,
      "the ordering should be cited explicitly so the reviewer can pin gate completeness"
    ).toMatch(/lint[\s\S]{0,80}typecheck[\s\S]{0,80}test[\s\S]{0,80}coverage[\s\S]{0,120}security/i);
  });

  it("AC-3 — body carries a GitHub Actions baseline template (real YAML the user can drop in)", () => {
    const body = CICD!.body;
    expect(body).toMatch(/```yaml/);
    expect(body).toMatch(/name:\s*CI/);
    expect(body).toMatch(/runs-on:\s*ubuntu-latest/);
    expect(body, "the template should cite a pinned action (e.g. actions/checkout@v4)").toMatch(/actions\/checkout@v\d/);
  });

  it("AC-3 — body names the three optimisation patterns (caching / parallelism / path filters)", () => {
    const body = CICD!.body;
    expect(body).toMatch(/^###?\s+(Pattern 1\b.*?cach|.*Cach)/im);
    expect(body).toMatch(/parallel/i);
    expect(body).toMatch(/path filter/i);
  });

  it("AC-3 — body carries branch-protection essentials with at least 5 settings", () => {
    const body = CICD!.body;
    expect(body).toMatch(/##\s+Branch protection/i);
    expect(body).toMatch(/Require pull request reviews/i);
    expect(body).toMatch(/Require status checks/i);
    expect(body).toMatch(/Restrict who can push/i);
    expect(body).toMatch(/Disallow force pushes/i);
    expect(body).toMatch(/Require signed commits|Require branches to be up to date/i);
  });

  it("AC-3 — body warns against `continue-on-error: true` and other CI-bypass patterns (red flags)", () => {
    const body = CICD!.body;
    expect(body).toMatch(/continue-on-error/);
    expect(body, "red-flags section should flag bypass patterns").toMatch(/##\s+Red flags/i);
  });
});

describe("v8.33 additive skills batch II — descriptions stay in sync with bodies", () => {
  it("AC-4 — `frontend-ui-engineering` description names addy + component architecture + AI-aesthetic + WCAG 2.1 AA", () => {
    const desc = FRONTEND!.description;
    expect(desc).toMatch(/addy/i);
    expect(desc).toMatch(/component architecture/i);
    expect(desc).toMatch(/AI[- ]aesthetic/i);
    expect(desc).toMatch(/WCAG 2\.1 AA/);
  });

  it("AC-4 — `ci-cd-and-automation` description names addy + quality gate + GitHub Actions + optimisation patterns + branch protection", () => {
    const desc = CICD!.description;
    expect(desc).toMatch(/addy/i);
    expect(desc).toMatch(/quality[- ]gate/i);
    expect(desc).toMatch(/GitHub Actions/i);
    expect(desc).toMatch(/cach|parallel|path filter/i);
    expect(desc).toMatch(/branch[- ]protection/i);
  });

  it("AC-4 — both new skills declare their stages explicitly (not falling back to default `[\"always\"]`)", () => {
    expect(FRONTEND!.stages).toBeDefined();
    expect(CICD!.stages).toBeDefined();
  });
});

describe("v8.33 additive skills batch II — v8.26 + v8.30 invariants preserved on new skills", () => {
  it("AC-5 — both new skills carry `## When NOT to apply` (v8.30 invariant)", () => {
    for (const skill of [FRONTEND!, CICD!]) {
      expect(
        skill.body,
        `${skill.fileName} must have a \`## When NOT to apply\` H2 (v8.30 invariant from skill-anatomy-gaps slug)`
      ).toMatch(/^##\s+When NOT to apply\b/m);
    }
  });

  it("AC-5 — both new skills carry `## When to use` (v8.26 anatomy invariant)", () => {
    for (const skill of [FRONTEND!, CICD!]) {
      expect(skill.body).toMatch(/^##\s+When (to use|to apply|to invoke|to detect)\b/m);
    }
  });

  it("AC-5 — both new skills open with `# Skill: <id>` H1 (v8.26 anatomy invariant)", () => {
    expect(FRONTEND!.body).toMatch(/^# Skill: frontend-ui-engineering\b/m);
    expect(CICD!.body).toMatch(/^# Skill: ci-cd-and-automation\b/m);
  });

  it("AC-5 — both new skills carry at least two depth sections (Process / Rationalizations / Red Flags / Verification — v8.26 invariant)", () => {
    const RATIONALIZATIONS_HEADING =
      /^##\s+(Anti-rationalization|Common rationalizations|Anti-patterns\b|What to refuse|Rationalizations\b|Smell check\b)/m;
    const RED_FLAGS_HEADING =
      /^##\s+(Red flags\b|Common pitfalls\b|Hard rules\b|Forbidden\b|Iron rule\b|Two iron rules\b|Stop-the-line\b|Anti-patterns\b|Smell check\b|Hyrum's Law\b)/m;
    const VERIFICATION_HEADING =
      /^##\s+(Verification\b|Worked example|Gates\b|.*checklist|Verification log|How .*verifies|Test-design checklist|Outcome\b)/m;

    for (const skill of [FRONTEND!, CICD!]) {
      const depthCount =
        (RATIONALIZATIONS_HEADING.test(skill.body) ? 1 : 0) +
        (RED_FLAGS_HEADING.test(skill.body) ? 1 : 0) +
        (VERIFICATION_HEADING.test(skill.body) ? 1 : 0);

      expect(
        depthCount,
        `${skill.fileName} has only ${depthCount} of {Rationalizations, Red Flags, Verification} (v8.26 invariant requires ≥ 2)`
      ).toBeGreaterThanOrEqual(2);
    }
  });

  it("AC-5 — both new skills carry a Common rationalizations table with at least 4 rows (v8.30 top-8 pattern, extended to new skills)", () => {
    for (const skill of [FRONTEND!, CICD!]) {
      const rationMatch = skill.body.match(/^##\s+Common rationalizations\b/m);
      expect(
        rationMatch,
        `${skill.fileName} must have a \`## Common rationalizations\` H2 (v8.30 top-8 pattern adopted for all new addy skills)`
      ).not.toBeNull();
      const slice = skill.body.slice(rationMatch!.index!);
      const headerStop = slice.match(/^\| rationalization \| truth \|/m);
      expect(headerStop, `${skill.fileName} rationalizations should carry the two-column header`).not.toBeNull();
      const rows = slice.match(/^\| "[^"]+"/gm);
      expect(
        rows?.length ?? 0,
        `${skill.fileName} rationalizations table should enumerate at least 4 excuse/rebuttal rows`
      ).toBeGreaterThanOrEqual(4);
    }
  });
});
