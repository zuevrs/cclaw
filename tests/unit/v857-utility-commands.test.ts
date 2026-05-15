import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CCLAW_CRITIC_COMMAND,
  CCLAW_REVIEW_COMMAND,
  UTILITY_COMMAND_FILES,
  renderCclawCriticCommand,
  renderCclawReviewCommand
} from "../../src/content/utility-commands.js";
import { CRITIC_PROMPT } from "../../src/content/specialist-prompts/critic.js";
import { REVIEWER_PROMPT } from "../../src/content/specialist-prompts/reviewer.js";
import {
  HARNESS_LAYOUT_TABLE,
  initCclaw,
  uninstallCclaw
} from "../../src/install.js";
import { HARNESS_IDS, type HarnessId } from "../../src/types.js";
import { createTempProject, removeProject } from "../helpers/temp-project.js";

/**
 * v8.57 — utility slash commands.
 *
 * Pins every contract the new feature ships:
 *
 *   - `CCLAW_REVIEW_COMMAND` and `CCLAW_CRITIC_COMMAND` export the
 *     prompt bodies and `renderCclawReviewCommand` / `renderCclawCriticCommand`
 *     return them verbatim.
 *   - Both prompts reference the corresponding specialist contract
 *     (reviewer / critic) by canonical agent path so the harness body
 *     stays a shim, not a duplicate.
 *   - Both prompts document the default behaviour (review → staged
 *     diff; critic → required path) and the `--out <path>` flag.
 *   - Both prompts skip flow-state interaction explicitly (no
 *     `.cclaw/flows/`, no `flow-state.json`).
 *   - The size contract: each body stays in the shim window (~50-90
 *     lines), well below the orchestrator-prompt budget.
 *   - Install writes both utility command files to every enabled
 *     harness's commands directory; uninstall sweeps them.
 *   - Idempotent install (re-run does not append; bytes stay stable).
 *   - The specialist contracts (reviewer.ts / critic.ts) carry a v8.57
 *     informational note that they may be invoked in either full-flow
 *     OR utility-command context — the contract body itself is
 *     unchanged.
 *   - SummaryCounts.commands reflects the new utility commands.
 */

describe("v8.57 — utility-commands content module: exports + shape invariants", () => {
  it("exports `CCLAW_REVIEW_COMMAND` and `CCLAW_CRITIC_COMMAND` as non-empty strings", () => {
    expect(typeof CCLAW_REVIEW_COMMAND).toBe("string");
    expect(typeof CCLAW_CRITIC_COMMAND).toBe("string");
    expect(CCLAW_REVIEW_COMMAND.length).toBeGreaterThan(0);
    expect(CCLAW_CRITIC_COMMAND.length).toBeGreaterThan(0);
  });

  it("renderCclawReviewCommand / renderCclawCriticCommand return the exports verbatim", () => {
    expect(renderCclawReviewCommand()).toBe(CCLAW_REVIEW_COMMAND);
    expect(renderCclawCriticCommand()).toBe(CCLAW_CRITIC_COMMAND);
  });

  it("UTILITY_COMMAND_FILES carries exactly the two v8.57 utility files", () => {
    expect(UTILITY_COMMAND_FILES.map((u) => u.fileName).sort()).toEqual([
      "cclaw-critic.md",
      "cclaw-review.md"
    ]);
  });

  it("UTILITY_COMMAND_FILES render functions return the matching command body", () => {
    const byName = new Map(
      UTILITY_COMMAND_FILES.map((u) => [u.fileName, u.render()])
    );
    expect(byName.get("cclaw-review.md")).toBe(CCLAW_REVIEW_COMMAND);
    expect(byName.get("cclaw-critic.md")).toBe(CCLAW_CRITIC_COMMAND);
  });
});

describe("v8.57 — /cclaw-review command body invariants", () => {
  it("opens with the `/cclaw-review` heading and a one-line purpose", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(
      /^# \/cclaw-review — utility reviewer pass \(no flow\)/m
    );
  });

  it("references the reviewer specialist contract by canonical agent path", () => {
    expect(CCLAW_REVIEW_COMMAND).toContain(".cclaw/lib/agents/reviewer.md");
  });

  it("does NOT inline the full reviewer prompt (shim, not duplicate)", () => {
    // The reviewer prompt is ~67KB. The shim should be a tiny fraction.
    expect(CCLAW_REVIEW_COMMAND.length).toBeLessThan(REVIEWER_PROMPT.length / 4);
    // The shim must not start with the reviewer prompt's opening line.
    expect(CCLAW_REVIEW_COMMAND).not.toContain(
      "You are the cclaw reviewer. You are multi-mode"
    );
  });

  it("documents the default behaviour: empty args → `git diff --cached`, fallback `git diff HEAD`", () => {
    expect(CCLAW_REVIEW_COMMAND).toContain("git diff --cached");
    expect(CCLAW_REVIEW_COMMAND).toContain("git diff HEAD");
  });

  it("documents the `<git-ref>` / paths argument shapes", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(/<git-ref>/);
    expect(CCLAW_REVIEW_COMMAND).toMatch(/<path>/);
    expect(CCLAW_REVIEW_COMMAND).toMatch(/HEAD~3\.\.HEAD/);
  });

  it("documents the `--out <path>` flag for writing findings to a markdown file", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(/--out <path>/);
    expect(CCLAW_REVIEW_COMMAND).toMatch(/<out-path>|--out <path>/);
  });

  it("names the 10-axis pass and explicitly skips qa-evidence (no QA artifact)", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(/10-axis/i);
    // All ten canonical axis names must appear so a reader can verify the contract.
    for (const axis of [
      "correctness",
      "test-quality",
      "readability",
      "architecture",
      "complexity-budget",
      "security",
      "perf",
      "edit-discipline",
      "qa-evidence",
      "nfr-compliance"
    ]) {
      expect(
        CCLAW_REVIEW_COMMAND,
        `reviewer axis '${axis}' must appear in /cclaw-review command body`
      ).toContain(axis);
    }
    // qa-evidence is explicitly called out as skipped in utility mode.
    expect(CCLAW_REVIEW_COMMAND).toMatch(/qa-evidence[^\n]*skip/i);
  });

  it("explicitly disallows flow-state / artifact-tree interaction", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(/flow-state\.json/);
    expect(CCLAW_REVIEW_COMMAND).toMatch(/\.cclaw\/flows\//);
    expect(CCLAW_REVIEW_COMMAND).toMatch(/Do not.*flow-state|Never write to/i);
  });

  it("prescribes a single Findings table as output (no review.md write)", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(/Findings/);
    expect(CCLAW_REVIEW_COMMAND).toContain("severity");
    expect(CCLAW_REVIEW_COMMAND).toContain("location");
    expect(CCLAW_REVIEW_COMMAND).toContain("suggested fix");
  });

  it("points the user at /cc <task> for the full ceremony (cross-reference)", () => {
    expect(CCLAW_REVIEW_COMMAND).toMatch(/\/cc <task>/);
  });

  it("body size stays within the shim contract (~50-90 lines)", () => {
    const lines = CCLAW_REVIEW_COMMAND.split("\n").length;
    expect(lines).toBeGreaterThan(20);
    expect(lines).toBeLessThanOrEqual(90);
  });
});

describe("v8.57 — /cclaw-critic command body invariants", () => {
  it("opens with the `/cclaw-critic` heading and a one-line purpose", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(
      /^# \/cclaw-critic — utility critic pass on any document \(no flow\)/m
    );
  });

  it("references the critic specialist contract by canonical agent path", () => {
    expect(CCLAW_CRITIC_COMMAND).toContain(".cclaw/lib/agents/critic.md");
  });

  it("does NOT inline the full critic prompt (shim, not duplicate)", () => {
    expect(CCLAW_CRITIC_COMMAND.length).toBeLessThan(CRITIC_PROMPT.length / 4);
    expect(CCLAW_CRITIC_COMMAND).not.toContain(
      "You are the cclaw **critic**. You are a **separate specialist**"
    );
  });

  it("documents the required `<path>` argument (no default, must exist)", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(/<path>/);
    expect(CCLAW_CRITIC_COMMAND).toMatch(/Required.*Path to the document/i);
    expect(CCLAW_CRITIC_COMMAND).toMatch(/must exist|does not exist/i);
  });

  it("documents the `--out <path>` flag for writing findings to a markdown file", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(/--out <out-path>/);
  });

  it("specifies adversarial mode as the default for utility context", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(/adversarial/i);
  });

  it("references all four adversarial techniques", () => {
    for (const technique of [
      "assumption violation",
      "composition failures",
      "cascade construction",
      "abuse cases"
    ]) {
      expect(
        CCLAW_CRITIC_COMMAND,
        `adversarial technique '${technique}' must appear in /cclaw-critic body`
      ).toMatch(new RegExp(technique, "i"));
    }
  });

  it("references both lens sets (plan-stage and code-stage), 3 lenses each", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(/plan-stage lenses/i);
    expect(CCLAW_CRITIC_COMMAND).toMatch(/code-stage lenses/i);
    for (const lens of ["executor", "stakeholder", "skeptic", "security", "new-hire", "ops"]) {
      expect(
        CCLAW_CRITIC_COMMAND,
        `lens '${lens}' must appear in /cclaw-critic body`
      ).toContain(lens);
    }
  });

  it("names all 8 critic sections (predictions, gaps, adversarial, criterion, goal-backward, realist, verdict, summary)", () => {
    for (const section of [
      "§1",
      "§2",
      "§3",
      "§4",
      "§5",
      "§6",
      "§7",
      "§8"
    ]) {
      expect(
        CCLAW_CRITIC_COMMAND,
        `section heading '${section}' must appear in /cclaw-critic body`
      ).toContain(section);
    }
  });

  it("explicitly disallows flow-state / artifact-tree / critic.md writes", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(/flow-state\.json/);
    expect(CCLAW_CRITIC_COMMAND).toMatch(/\.cclaw\/flows\//);
    expect(CCLAW_CRITIC_COMMAND).toMatch(/Do not.*critic\.md|Do not.*write/i);
  });

  it("points the user at /cc <task> for the full slug-scope critic (cross-reference)", () => {
    expect(CCLAW_CRITIC_COMMAND).toMatch(/\/cc <task>/);
  });

  it("body size stays within the shim contract (~50-90 lines)", () => {
    const lines = CCLAW_CRITIC_COMMAND.split("\n").length;
    expect(lines).toBeGreaterThan(20);
    expect(lines).toBeLessThanOrEqual(90);
  });
});

describe("v8.57 — specialist contracts carry the v8.57 invocation-contexts note", () => {
  it("reviewer.ts mentions both full-flow and utility-command contexts", () => {
    expect(REVIEWER_PROMPT).toMatch(/full-flow context/i);
    expect(REVIEWER_PROMPT).toMatch(/utility-command context/i);
    expect(REVIEWER_PROMPT).toMatch(/\/cclaw-review/);
  });

  it("critic.ts mentions both full-flow and utility-command contexts", () => {
    expect(CRITIC_PROMPT).toMatch(/full-flow context/i);
    expect(CRITIC_PROMPT).toMatch(/utility-command context/i);
    expect(CRITIC_PROMPT).toMatch(/\/cclaw-critic/);
  });
});

describe("v8.57 — per-harness install writes utility commands to the commands directory", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("install writes `cclaw-review.md` and `cclaw-critic.md` to the Cursor commands dir", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const reviewBody = await fs.readFile(
      path.join(project, ".cursor", "commands", "cclaw-review.md"),
      "utf8"
    );
    const criticBody = await fs.readFile(
      path.join(project, ".cursor", "commands", "cclaw-critic.md"),
      "utf8"
    );
    expect(reviewBody).toBe(CCLAW_REVIEW_COMMAND);
    expect(criticBody).toBe(CCLAW_CRITIC_COMMAND);
  });

  it("install writes both utility command files for Claude / Codex / OpenCode harnesses too", async () => {
    project = await createTempProject({
      harnessMarkers: [".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    for (const harness of ["claude", "codex", "opencode"] as const) {
      for (const file of ["cclaw-review.md", "cclaw-critic.md"]) {
        const filePath = path.join(
          project,
          HARNESS_LAYOUT_TABLE[harness].commandsDir,
          file
        );
        await fs.access(filePath);
      }
    }
  });

  it("install is idempotent — re-running overwrites the same file (no append)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const firstReview = await fs.readFile(
      path.join(project, ".cursor", "commands", "cclaw-review.md"),
      "utf8"
    );
    const firstCritic = await fs.readFile(
      path.join(project, ".cursor", "commands", "cclaw-critic.md"),
      "utf8"
    );
    await initCclaw({ cwd: project });
    const secondReview = await fs.readFile(
      path.join(project, ".cursor", "commands", "cclaw-review.md"),
      "utf8"
    );
    const secondCritic = await fs.readFile(
      path.join(project, ".cursor", "commands", "cclaw-critic.md"),
      "utf8"
    );
    expect(secondReview).toBe(firstReview);
    expect(secondCritic).toBe(firstCritic);
    expect(secondReview.length).toBe(firstReview.length);
  });

  it("install writes utility commands alongside the existing flow commands (cc / cc-cancel / cc-idea)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const dir = path.join(project, ".cursor", "commands");
    for (const file of [
      "cc.md",
      "cc-cancel.md",
      "cc-idea.md",
      "cclaw-review.md",
      "cclaw-critic.md"
    ]) {
      await fs.access(path.join(dir, file));
    }
  });

  it("multi-harness install writes utility commands at every enabled harness's commands directory", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    for (const harness of HARNESS_IDS as readonly HarnessId[]) {
      for (const file of ["cclaw-review.md", "cclaw-critic.md"]) {
        const filePath = path.join(
          project,
          HARNESS_LAYOUT_TABLE[harness].commandsDir,
          file
        );
        await fs.access(filePath);
      }
    }
  });
});

describe("v8.57 — uninstall removes utility commands cleanly", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("uninstall removes both utility command files from the Cursor commands dir", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    for (const file of ["cclaw-review.md", "cclaw-critic.md"]) {
      await expect(
        fs.access(path.join(project, ".cursor", "commands", file))
      ).rejects.toBeTruthy();
    }
  });

  it("uninstall removes utility command files from every harness's commands dir", async () => {
    project = await createTempProject({
      harnessMarkers: [".cursor", ".claude", ".codex", ".opencode"]
    });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    for (const harness of HARNESS_IDS as readonly HarnessId[]) {
      for (const file of ["cclaw-review.md", "cclaw-critic.md"]) {
        await expect(
          fs.access(
            path.join(project, HARNESS_LAYOUT_TABLE[harness].commandsDir, file)
          )
        ).rejects.toBeTruthy();
      }
    }
  });

  it("uninstall preserves a user-authored sibling command file (does NOT touch siblings)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    const siblingPath = path.join(project, ".cursor", "commands", "my-command.md");
    await fs.writeFile(siblingPath, "user-owned command\n", "utf8");
    await uninstallCclaw({ cwd: project });
    await expect(
      fs.access(path.join(project, ".cursor", "commands", "cclaw-review.md"))
    ).rejects.toBeTruthy();
    await expect(
      fs.access(path.join(project, ".cursor", "commands", "cclaw-critic.md"))
    ).rejects.toBeTruthy();
    const body = await fs.readFile(siblingPath, "utf8");
    expect(body).toBe("user-owned command\n");
  });

  it("uninstall removes empty commands directory only when cclaw was the sole inhabitant", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    await initCclaw({ cwd: project });
    await uninstallCclaw({ cwd: project });
    // Directory is now empty (cclaw owned every file) → cleaned up.
    await expect(
      fs.access(path.join(project, ".cursor", "commands"))
    ).rejects.toBeTruthy();
  });
});

describe("v8.57 — install summary commands count reflects utility commands", () => {
  let project: string;
  afterEach(async () => {
    if (project) await removeProject(project);
  });

  it("SyncResult.counts.commands == 5 (3 flow + 2 utility)", async () => {
    project = await createTempProject({ harnessMarkers: [".cursor"] });
    const result = await initCclaw({ cwd: project });
    expect(result.counts.commands).toBe(5);
    expect(result.counts.commands).toBe(3 + UTILITY_COMMAND_FILES.length);
  });
});
