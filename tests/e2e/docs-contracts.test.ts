import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeoutChainInline, closeoutSubstateProtocolBullets, CLOSEOUT_SUBSTATE_KEY } from "../../src/content/closeout-guidance.js";
import { REFERENCE_PATTERNS } from "../../src/content/reference-patterns.js";
import { stageSkillMarkdown } from "../../src/content/skills.js";
import { adaptiveElicitationSkillMarkdown } from "../../src/content/skills-elicitation.js";
import { startCommandSkillMarkdown } from "../../src/content/start-command.js";
import { statusSubcommandMarkdown } from "../../src/content/status-command.js";
import { CURSOR_WORKFLOW_RULE_MDC } from "../../src/content/templates.js";
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
    expect(startSkill).toContain("Lean / Guided / Deep");
    expect(docs).toContain("discovery mode");
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

  it("disambiguates elicitation skip vs closeout no-changes labels", () => {
    const closeoutBullets = closeoutSubstateProtocolBullets();
    expect(closeoutBullets.toLowerCase()).toContain("no changes");
    expect(closeoutBullets).not.toContain("accept/edit/skip");
    expect(CURSOR_WORKFLOW_RULE_MDC).toContain("Protocol label hygiene");
    const elicit = adaptiveElicitationSkillMarkdown();
    expect(elicit).toContain("Label disambiguation");
    expect(elicit.toLowerCase()).toContain("no changes");
  });

  it("documents canonical delegation-record CLI flags in the shared Harness Dispatch Contract", () => {
    const skillMd = stageSkillMarkdown("scope");
    expect(skillMd).toContain("### Harness Dispatch Contract");
    expect(skillMd).toContain("--stage=<stage>");
    expect(skillMd).toContain("--agent=<agent>");
    expect(skillMd).toContain("--mode=<mandatory|proactive>");
    expect(skillMd).toContain("--dispatch-id=<id>");
    expect(skillMd).toContain("--dispatch-surface=<surface>");
    expect(skillMd).toContain("--agent-definition-path=<path>");
    expect(skillMd).toContain("scheduled → launched → acknowledged → completed");
    expect(skillMd).not.toContain("delegation-record.mjs --status=<status> --span-id=<spanId>");
  });

  it("requires stage-complete exit 0 before completion claims in templates and every stage skill", async () => {
    const templates = await readRepoFile("src/content/templates.ts");
    const headline = "Stage completion claim requires";
    expect(templates).toContain(headline);
    expect(templates).toContain("single-line success JSON");
    expect(templates).toContain("do not infer success from empty stdout");

    for (const stage of FLOW_STAGES) {
      const skillMd = stageSkillMarkdown(stage);
      expect(skillMd, `stage ${stage}`).toContain(headline);
      expect(skillMd, `stage ${stage}`).toContain("exit 0");
      expect(skillMd, `stage ${stage}`).toContain("single-line success JSON");
    }
  });

  it("renders the Round 5 Investigation Discipline block exactly once per investigation-stage skill", () => {
    const investigationStages: Array<typeof FLOW_STAGES[number]> = [
      "brainstorm",
      "scope",
      "design",
      "spec",
      "plan",
      "tdd",
      "review"
    ];
    const ladderSnippet = "Use this ladder before drafting or delegating";
    for (const stage of investigationStages) {
      const skillMd = stageSkillMarkdown(stage);
      const occurrences = skillMd.split(ladderSnippet).length - 1;
      expect(occurrences, `${stage} skill should render the investigation block exactly once`).toBe(
        1
      );
      expect(skillMd, `${stage} skill should declare the path-passing rule`).toContain(
        "Path-passing in delegations"
      );
    }
    const shipMd = stageSkillMarkdown("ship");
    expect(shipMd.includes(ladderSnippet)).toBe(false);
  });

  it("renders the Round 5 Behavior anchor block exactly once per stage skill with Bad/Good markers", () => {
    for (const stage of FLOW_STAGES) {
      const skillMd = stageSkillMarkdown(stage);
      const headerOccurrences = skillMd.split("## Behavior anchor").length - 1;
      expect(headerOccurrences, `${stage} skill should render '## Behavior anchor' once`).toBe(1);
      expect(skillMd, `${stage} skill should mark Bad`).toMatch(/- Bad:/u);
      expect(skillMd, `${stage} skill should mark Good`).toMatch(/- Good:/u);
    }
  });
});
