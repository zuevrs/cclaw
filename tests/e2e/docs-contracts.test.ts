import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeoutChainInline, CLOSEOUT_SUBSTATE_KEY } from "../../src/content/closeout-guidance.js";
import { REFERENCE_PATTERNS } from "../../src/content/reference-patterns.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { startCommandSkillMarkdown } from "../../src/content/start-command.js";
import { statusSubcommandMarkdown } from "../../src/content/status-command.js";
import { FLOW_STAGES, TRACK_STAGES } from "../../src/types.js";

const repoRoot = process.cwd();

async function readRepoFile(relativePath: string): Promise<string> {
  return (await fs.readFile(path.join(repoRoot, relativePath), "utf8")).replace(/\r\n/g, "\n");
}

function mermaidBlockCount(markdown: string): number {
  return markdown.match(/```mermaid/g)?.length ?? 0;
}

describe("docs flow contract", () => {
  it("keeps README onboarding-first and linked to deeper docs", async () => {
    const readme = await readRepoFile("README.md");
    const lead = readme.slice(0, 2200);

    expect(lead).toContain("file-backed flow runtime for coding agents");
    expect(lead).toContain("## First 5 Minutes");
    expect(lead).toContain("/cc <idea>");
    expect(lead).toContain("/cc-idea");
    expect(lead).toContain("/cc-cancel");
    expect(lead).not.toMatch(/\bcc-next\b/u);
    expect(lead).not.toContain("/cc-view status");
    expect(readme).toContain("./docs/scheme-of-work.md");
    expect(readme).toContain("./docs/config.md");
    expect(readme).toContain("./docs/harnesses.md");
    expect(readme).toContain("./docs/agents-block.example.md");
  });

  it("documents canonical stages, tracks, and closeout chain", async () => {
    const readme = await readRepoFile("README.md");
    const scheme = await readRepoFile("docs/scheme-of-work.md");

    for (const stage of FLOW_STAGES) {
      expect(readme, `README mentions ${stage}`).toContain(stage);
      expect(scheme, `scheme mentions ${stage}`).toContain(stage);
    }

    for (const [track, stages] of Object.entries(TRACK_STAGES)) {
      expect(readme).toContain(`\`${track}\``);
      expect(scheme).toContain(`\`${track}\``);
      for (const stage of stages) {
        expect(scheme, `${track} includes ${stage}`).toContain(stage);
      }
    }

    expect(readme).toContain("post_ship_review -> archive");
    expect(scheme).toContain("post_ship_review -> archive");
    expect(readme).toContain(CLOSEOUT_SUBSTATE_KEY);
    expect(scheme).toContain(CLOSEOUT_SUBSTATE_KEY);
    expect(closeoutChainInline()).toContain("post_ship_review -> archive");
  });

  it("keeps scheme-of-work as the human-readable flow contract", async () => {
    const scheme = await readRepoFile("docs/scheme-of-work.md");

    for (const required of [
      "canonical human-readable flow contract",
      "Entry And Resume",
      "Stage Flow",
      "Closeout Flow",
      "Gates And Blockers",
      "Recovery Decision Tree",
      "Track Routing Authority",
      "Delegation And Subagents",
      "Archive Lifecycle",
      ".cclaw/state/flow-state.json",
      ".cclaw/state/delegation-log.json",
      ".cclaw/artifacts/",
      ".cclaw/knowledge.jsonl",
      ".cclaw/archive/<YYYY-MM-DD-slug>/"
    ]) {
      expect(scheme).toContain(required);
    }
  });

  it("documents sync fail-fast, quick-track, blocker-matrix, hook layering, and lifecycle preservation contracts", async () => {
    const scheme = await readRepoFile("docs/scheme-of-work.md");
    const harnesses = await readRepoFile("docs/harnesses.md");
    const config = await readRepoFile("docs/config.md");

    for (const required of [
      "## Sync Fail-Fast Contract",
      "npx cclaw-cli sync",
      "Hook document drift",
      "Shim drift",
      "Flow-state corruption",
      "Managed resource manifest",
      "## Quick-Track Gate Delta",
      "tdd_traceable_to_plan",
      "## /cc Blocker Matrix",
      "Ralph loop open slices",
      "Ship closeout incomplete"
    ]) {
      expect(scheme).toContain(required);
    }

    for (const required of [
      "## Hook layering",
      "src/content/hook-manifest.ts",
      "src/hook-schemas/*.json",
      "src/hook-schema.ts",
      "validateHookDocument"
    ]) {
      expect(harnesses).toContain(required);
    }

    for (const required of [
      "## What users can set",
      "`harnesses`",
      "## What cclaw manages automatically",
      "`version`",
      "`flowVersion`",
      "## Removed in 3.0.0",
      "key X is no longer supported in cclaw 3.0.0; see CHANGELOG.md",
      "npx cclaw-cli sync"
    ]) {
      expect(config).toContain(required);
    }
  });

  it("covers recovery routes users need when blocked", async () => {
    const docs = `${await readRepoFile("README.md")}
${await readRepoFile("docs/scheme-of-work.md")}`;

    for (const required of [
      "Missing gates",
      "Mandatory delegation missing evidence",
      "NO_SOURCE_CONTEXT",
      "NO_TEST_SURFACE",
      "NO_IMPLEMENTABLE_SLICE",
      "RED_NOT_EXPRESSIBLE",
      "NO_VCS_MODE",
      "review_blocked_by_critical",
      "staleStages",
      "cclaw internal rewind --ack",
      "npx cclaw-cli sync",
      "/cc"
    ]) {
      expect(docs).toContain(required);
    }
  });

  it("keeps README visual and lightweight while scheme carries detailed diagrams", async () => {
    const readme = await readRepoFile("README.md");
    const scheme = await readRepoFile("docs/scheme-of-work.md");

    expect(readme).toContain("```text\n        idea");
    expect(readme).toContain("post_ship_review -> archive");
    expect(readme).toContain("NO_SOURCE_CONTEXT");
    expect(readme).toContain("delegation-log.json");
    expect(readme).toContain("The README is the front door");
    expect(readme.length).toBeLessThan(9000);
    expect(mermaidBlockCount(scheme)).toBeGreaterThanOrEqual(3);
    expect(scheme).toContain("quick: spec -> tdd -> review -> ship");
    expect(scheme).toContain("NO_TEST_SURFACE");
    expect(scheme).toContain("Controller");
  });

  it("clarifies track routing authority and confidence", async () => {
    const docs = `${await readRepoFile("README.md")}
${await readRepoFile("docs/scheme-of-work.md")}`;
    const startSkill = startCommandSkillMarkdown();

    expect(docs).toContain("model-guided and advisory");
    expect(docs).toContain("not a Node-level router");
    expect(docs).toContain("Runtime enforcement");
    expect(docs).toContain("--reclassify");
    expect(startSkill).toContain("track selection confidence");
    expect(startSkill).toContain("heuristic is advisory");
  });

  it("keeps status and next-action generated guidance plain-English", () => {
    const status = statusSubcommandMarkdown();
    for (const content of [status]) {
      expect(content).toContain("Current");
      expect(content).toContain("Blocked by");
      expect(content).toContain("Next");
      expect(content).toContain("Evidence needed");
    }

    expect(status).toContain("NO_SOURCE_CONTEXT");
    expect(status).toContain("review_blocked_by_critical");
  });

  it("surfaces reference pattern registry in docs without prompt bloat", async () => {
    const scheme = await readRepoFile("docs/scheme-of-work.md");
    const tddSkill = stageSkillMarkdown("tdd");

    for (const pattern of REFERENCE_PATTERNS) {
      expect(scheme, `scheme documents ${pattern.title}`).toContain(pattern.title);
    }

    expect(tddSkill).toContain("## Reference Patterns");
    expect(tddSkill).toContain("internal registry");
    for (const pattern of REFERENCE_PATTERNS) {
      expect(tddSkill, `prompt should not inline intent for ${pattern.id}`).not.toContain(pattern.intent);
    }
  });
});
