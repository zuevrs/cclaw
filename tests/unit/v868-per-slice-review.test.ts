import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { BUILDER_PROMPT } from "../../src/content/specialist-prompts/builder.js";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { ON_DEMAND_RUNBOOKS } from "../../src/content/runbooks-on-demand.js";
import {
  START_COMMAND_BODY,
  renderStartCommand
} from "../../src/content/start-command.js";
import {
  BUILDER_STATUSES,
  type BuilderStatus
} from "../../src/types.js";

/**
 * v8.68 — Two-stage per-slice review + structured implementer status.
 *
 * Pins the contract end-to-end so any regression (dropped review stage,
 * missing status enum value, dropped orchestrator handler, missing
 * skill file) lights up immediately.
 */

const SRC_ROOT = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../src"
);

describe("v8.68 — BuilderStatus type + enum (types.ts)", () => {
  it("BUILDER_STATUSES carries exactly the four canonical statuses, in spec order", () => {
    expect([...BUILDER_STATUSES]).toEqual([
      "DONE",
      "DONE_WITH_CONCERNS",
      "NEEDS_CONTEXT",
      "BLOCKED"
    ]);
  });

  it("BuilderStatus type derives from the enum (compile-time round-trip)", () => {
    const s1: BuilderStatus = "DONE";
    const s2: BuilderStatus = "DONE_WITH_CONCERNS";
    const s3: BuilderStatus = "NEEDS_CONTEXT";
    const s4: BuilderStatus = "BLOCKED";
    expect([s1, s2, s3, s4]).toEqual([...BUILDER_STATUSES]);
  });

  it("types.ts source documents each of the four statuses with its orchestrator handler", async () => {
    const body = await fs.readFile(path.join(SRC_ROOT, "types.ts"), "utf8");
    expect(body).toMatch(/`DONE`.*proceed/s);
    expect(body).toMatch(/`DONE_WITH_CONCERNS`.*##\s*Concerns/s);
    expect(body).toMatch(/`NEEDS_CONTEXT`.*stop/s);
    expect(body).toMatch(/`BLOCKED`.*recommended resolution/s);
  });
});

describe("v8.68 — builder prompt mentions two-stage per-slice review on strict mode", () => {
  it("builder prompt declares a dedicated 'Per-slice review loop' section (strict mode only)", () => {
    expect(BUILDER_PROMPT).toMatch(/## Per-slice review loop \(strict mode/);
  });

  it("builder prompt names both stages — spec-compliance THEN code-quality, in that order", () => {
    const specIdx = BUILDER_PROMPT.indexOf("Stage 1 — **spec-compliance**");
    const qualityIdx = BUILDER_PROMPT.indexOf("Stage 2 — **code-quality**");
    expect(specIdx).toBeGreaterThan(0);
    expect(qualityIdx).toBeGreaterThan(specIdx);
  });

  it("builder prompt declares the gating rule: Stage 2 runs only when Stage 1 passes", () => {
    expect(BUILDER_PROMPT).toMatch(
      /Stage 2 runs \*\*only when Stage 1 returns `spec-pass`\*\*/
    );
  });

  it("builder prompt declares the 2-attempt cap per stage with BLOCKED escalation", () => {
    expect(BUILDER_PROMPT).toMatch(/2 fix attempts/);
    expect(BUILDER_PROMPT).toMatch(/Two-attempt cap \(per stage\)/);
    expect(BUILDER_PROMPT).toMatch(/After 2 failed attempts.*`BLOCKED`/s);
  });

  it("builder prompt declares the soft-mode opt-out (per-slice loop is strict-only)", () => {
    expect(BUILDER_PROMPT).toMatch(/Soft mode opt-out/);
    expect(BUILDER_PROMPT).toMatch(
      /soft mode the per-slice loop does NOT fire/
    );
  });

  it("builder prompt's `## Slice cycles` table grew to seven columns with a `Per-slice review` column", () => {
    expect(BUILDER_PROMPT).toMatch(/Per-slice review/);
    expect(BUILDER_PROMPT).toMatch(
      /\| Slice \| Discovery \| RED proof \| GREEN evidence \| REFACTOR notes \| Per-slice review \| commits \|/
    );
  });

  it("builder prompt names the axes scoped to the per-slice quality stage (and notes which axes are deferred)", () => {
    // The per-slice quality stage walks a subset of axes (the ones that
    // can be evaluated on a single-slice diff). qa-evidence and
    // nfr-compliance are intentionally deferred to the post-build reviewer.
    expect(BUILDER_PROMPT).toMatch(/correctness/);
    expect(BUILDER_PROMPT).toMatch(/test-quality/);
    expect(BUILDER_PROMPT).toMatch(/readability/);
    expect(BUILDER_PROMPT).toMatch(/complexity-budget/);
    expect(BUILDER_PROMPT).toMatch(/edit-discipline/);
    expect(BUILDER_PROMPT).toMatch(
      /qa-evidence.*nfr-compliance.*deferred to the post-build reviewer/s
    );
  });
});

describe("v8.68 — builder prompt declares all four statuses + per-status handler", () => {
  it("builder prompt has a dedicated 'Status protocol' section", () => {
    expect(BUILDER_PROMPT).toMatch(/## Status protocol/);
  });

  it("builder prompt names all four statuses in the status-handler table", () => {
    for (const status of BUILDER_STATUSES) {
      expect(BUILDER_PROMPT).toContain(`\`${status}\``);
    }
  });

  it("builder prompt names each status's orchestrator handler", () => {
    expect(BUILDER_PROMPT).toMatch(/`DONE`.*proceed/);
    expect(BUILDER_PROMPT).toMatch(/`DONE_WITH_CONCERNS`.*## Concerns.*proceed/s);
    expect(BUILDER_PROMPT).toMatch(/`NEEDS_CONTEXT`.*stop and report/s);
    expect(BUILDER_PROMPT).toMatch(/`BLOCKED`.*recommended resolution/s);
  });

  it("builder prompt declares the monotone aggregation rule (per-slice → dispatch-level)", () => {
    expect(BUILDER_PROMPT).toMatch(/monotone rule/);
  });

  it("builder prompt declares the `Notes:` line is mandatory when Status != DONE", () => {
    expect(BUILDER_PROMPT).toMatch(/`Notes:` line is mandatory when `Status != DONE`/);
  });

  it("builder slim-summary template gained a Status: line", () => {
    expect(BUILDER_PROMPT).toMatch(
      /Status: DONE \| DONE_WITH_CONCERNS \| NEEDS_CONTEXT \| BLOCKED/
    );
  });

  it("per-slice JSON self_review block carries a status field with the four-value enum", () => {
    expect(BUILDER_PROMPT).toMatch(
      /"status": "DONE \| DONE_WITH_CONCERNS \| NEEDS_CONTEXT \| BLOCKED"/
    );
  });

  it("per-slice JSON self_review block carries a per_slice_review with spec + quality + fix_attempts", () => {
    expect(BUILDER_PROMPT).toMatch(/"per_slice_review":/);
    expect(BUILDER_PROMPT).toMatch(/"spec": "pass \| fail/);
    expect(BUILDER_PROMPT).toMatch(/"quality": "pass \| fail/);
    expect(BUILDER_PROMPT).toMatch(/"fix_attempts":/);
  });
});

describe("v8.68 — structured-status skill exists and is wired into AUTO_TRIGGER_SKILLS", () => {
  it("structured-status.md exists in src/content/skills/", async () => {
    const skillPath = path.join(SRC_ROOT, "content", "skills", "structured-status.md");
    await expect(fs.access(skillPath)).resolves.toBeUndefined();
  });

  it("structured-status skill is wired into AUTO_TRIGGER_SKILLS with stage='build'", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "structured-status");
    expect(skill).toBeDefined();
    expect(skill?.fileName).toBe("structured-status.md");
    expect(skill?.stages).toContain("build");
  });

  it("structured-status skill body follows the cclaw skill anatomy (frontmatter + canonical headings)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "structured-status")!;
    expect(skill.body.startsWith("---\n")).toBe(true);
    expect(skill.body).toMatch(/^name: structured-status$/m);
    expect(skill.body).toMatch(/^# Skill: structured-status$/m);
    expect(skill.body).toMatch(/^## When to use$/m);
    expect(skill.body).toMatch(/^## When NOT to apply$/m);
  });

  it("structured-status skill body names all four statuses with their orchestrator handlers", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "structured-status")!;
    for (const status of BUILDER_STATUSES) {
      expect(skill.body).toContain(`### \`${status}\``);
    }
  });

  it("structured-status skill body documents the monotone aggregation rule", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "structured-status")!;
    expect(skill.body).toMatch(/## Aggregation rule/);
    expect(skill.body).toMatch(/monotone/);
  });

  it("structured-status skill body documents soft-mode behaviour (one status for the whole feature)", () => {
    const skill = AUTO_TRIGGER_SKILLS.find((s) => s.id === "structured-status")!;
    expect(skill.body).toMatch(/soft mode/i);
    // soft mode emits ONE dispatch-level status; no per-slice cascade.
    expect(skill.body).toMatch(
      /soft mode.*one status for the whole feature|soft mode emits ONE dispatch-level status/i
    );
  });
});

describe("v8.68 — orchestrator handles NEEDS_CONTEXT and BLOCKED deterministically", () => {
  it("start-command body's Always-auto failure handling paragraph names the structured statuses", () => {
    expect(START_COMMAND_BODY).toMatch(/NEEDS_CONTEXT/);
    expect(START_COMMAND_BODY).toMatch(/BLOCKED/);
    expect(START_COMMAND_BODY).toMatch(/DONE_WITH_CONCERNS/);
  });

  it("renderStartCommand emits the same body export", () => {
    expect(renderStartCommand()).toBe(START_COMMAND_BODY);
  });

  it("always-auto-failure-handling.md runbook has dedicated rows for each new status", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    );
    expect(rb).toBeDefined();
    expect(rb!.body).toMatch(/builder `Status: NEEDS_CONTEXT`/);
    expect(rb!.body).toMatch(/builder `Status: BLOCKED`/);
    expect(rb!.body).toMatch(/builder `Status: DONE_WITH_CONCERNS`/);
  });

  it("always-auto-failure-handling runbook declares NEEDS_CONTEXT is a stop-and-report (no auto-retry)", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    )!;
    // NEEDS_CONTEXT must stop and report; re-running on unchanged inputs
    // produces the same status — this is the canonical bug the protocol
    // prevents (silent infinite re-dispatch).
    expect(rb.body).toMatch(
      /NEEDS_CONTEXT.*Stop and report.*No auto-retry/s
    );
  });

  it("always-auto-failure-handling runbook declares BLOCKED is a stop-and-report with recommended resolution", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    )!;
    expect(rb.body).toMatch(/BLOCKED.*Stop and report/s);
    expect(rb.body).toMatch(/recommended resolution/);
    expect(rb.body).toMatch(/provide more context/);
    expect(rb.body).toMatch(/break the slice smaller/);
    expect(rb.body).toMatch(/escalate to architect/);
    expect(rb.body).toMatch(/accept and ship as-is/);
  });

  it("always-auto-failure-handling runbook declares DONE_WITH_CONCERNS proceeds AND logs to build.md `## Concerns`", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    )!;
    expect(rb.body).toMatch(
      /DONE_WITH_CONCERNS.*Proceed AND log.*## Concerns.*build\.md/s
    );
  });

  it("always-auto-failure-handling runbook documents per-slice vs dispatch-level status surface", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    )!;
    expect(rb.body).toMatch(/Per-slice vs dispatch-level Status/);
    expect(rb.body).toMatch(/monotone/);
  });

  it("always-auto-failure-handling runbook gains anti-rationalization rows for the new statuses", () => {
    const rb = ON_DEMAND_RUNBOOKS.find(
      (r) => r.id === "always-auto-failure-handling"
    )!;
    expect(rb.body).toMatch(/Builder NEEDS_CONTEXT/);
    expect(rb.body).toMatch(/Builder BLOCKED/);
    expect(rb.body).toMatch(/Builder DONE_WITH_CONCERNS/);
  });
});

describe("v8.68 — version bump landed in package.json + CHANGELOG", () => {
  it("package.json carries v8.68.0 or later (v8.68 features stay landed in subsequent releases)", async () => {
    const pkgRaw = await fs.readFile(path.join(SRC_ROOT, "..", "package.json"), "utf8");
    const pkg = JSON.parse(pkgRaw) as { version: string };
    const [major, minor] = pkg.version.split(".").map((n) => Number.parseInt(n, 10));
    expect(major).toBe(8);
    expect(minor).toBeGreaterThanOrEqual(68);
  });

  it("CHANGELOG has a top-level entry for v8.68 mentioning per-slice review + structured status", async () => {
    const changelog = await fs.readFile(
      path.join(SRC_ROOT, "..", "CHANGELOG.md"),
      "utf8"
    );
    expect(changelog).toMatch(/##\s+v?8\.68\.0/);
    const v868Slice = changelog.split(/##\s+v?8\.68\.0/)[1]?.split(/##\s+v?8\.6[0-7]/)[0] ?? "";
    expect(v868Slice).toMatch(/per-slice review|two-stage/i);
    expect(v868Slice).toMatch(/structured.*status|DONE_WITH_CONCERNS|NEEDS_CONTEXT|BLOCKED/i);
  });
});
