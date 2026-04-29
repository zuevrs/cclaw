import { describe, expect, it } from "vitest";
import { diffSubcommandMarkdown } from "../../src/content/diff-command.js";
import { statusSubcommandMarkdown } from "../../src/content/status-command.js";
import { treeSubcommandMarkdown } from "../../src/content/tree-command.js";
import { viewCommandContract, viewCommandSkillMarkdown } from "../../src/content/view-command.js";

describe("/cc-view status content", () => {
  const skill = statusSubcommandMarkdown();

  it("renders delegations row with fulfillmentMode and waived status guidance", () => {
    expect(skill).toContain("fulfillmentMode");
    expect(skill).toContain("role-switch");
    expect(skill).toContain("waived");
  });

  it("flags completed-without-evidence on role-switch harnesses", () => {
    expect(skill).toContain("◎ missing-evidence");
    expect(skill).toContain("role-switch");
    expect(skill).toContain("evidenceRefs");
  });

  it("exposes the closeout substate row when ship is reached", () => {
    expect(skill).toContain("closeout.shipSubstate");
    expect(skill).toContain(`currentStage === "ship"`);
  });

  it("includes a harness parity row backed by capability metadata", () => {
    expect(skill).toContain("cclaw capability metadata");
    expect(skill).toContain("tier + fallback");
  });

  it("keeps the read-only hard-gate intact", () => {
    expect(skill).toContain("read-only command");
  });

  it("aligns with the compact operator output rows", () => {
    expect(skill).toContain("Stage");
    expect(skill).toContain("Gates");
    expect(skill).toContain("Delegations");
    expect(skill).toContain("Blocked by");
    expect(skill).toContain("Evidence needed");
    expect(skill).toContain("Next");
    expect(skill).toContain("operator note, not a JSON dump");
    expect(skill).toContain("Progress");
    expect(skill).toContain("Risks");
    expect(skill).toContain("delegation proof: reviewer evidenceRefs");
  });
});

describe("/cc-view tree content", () => {
  const skill = treeSubcommandMarkdown();

  it("renders delegation branch with fulfillmentMode labels", () => {
    expect(skill).toContain("fulfillmentMode");
  });

  it("adds a closeout sub-tree under ship", () => {
    expect(skill).toContain("closeout.shipSubstate");
    expect(skill).toContain("retro:");
    expect(skill).toContain("compound:");
    expect(skill).toContain("archive:");
    expect(skill).toContain(`ready_to_archive`);
  });

  it("adds a harnesses branch with tier/fallback metadata", () => {
    expect(skill).toContain("and fallback from cclaw capability metadata");
    expect(skill).toContain("npx cclaw-cli sync");
  });

  it("omits optional sub-trees only under documented conditions", () => {
    expect(skill).toContain("closeout sub-tree");
    expect(skill).toContain(`shipSubstate !== "idle"`);
  });
});

describe("/cc-view diff content", () => {
  const skill = diffSubcommandMarkdown();

  it("diffs the ship closeout substate transitions", () => {
    expect(skill).toContain("closeout.shipSubstate");
    expect(skill).toContain("ready_to_archive");
    expect(skill).toContain("archived");
  });

  it("tracks retro artifact appearance", () => {
    expect(skill).toContain("09-retro.md");
  });

  it("captures visible per-agent fulfillmentMode changes", () => {
    expect(skill).toContain("per-agent `fulfillmentMode` changes");
    expect(skill).toContain("delegation diffs");
  });

  it("does not create a derived snapshot file", () => {
    expect(skill).toContain("must not create or update");
  });

  it("uses git evidence instead of a saved baseline", () => {
    expect(skill).toContain("Inspect git diff");
  });
});

describe("/cc-view unified skill", () => {
  const skill = viewCommandSkillMarkdown();

  it("embeds all read-only subcommands in one generated skill", () => {
    expect(skill).toContain("## Status Subcommand");
    expect(skill).toContain("## Tree Subcommand");
    expect(skill).toContain("## Diff Subcommand");
    expect(skill).toContain("Flow Status Snapshot");
    expect(skill).toContain("# /cc-view tree");
    expect(skill).toContain("# /cc-view diff");
  });
});


describe("/cc-view command contract", () => {
  const contract = viewCommandContract();

  it("requires headless envelopes to preserve the actual parsed subcommand", () => {
    expect(contract).toContain('"subcommand":"<status|tree|diff>"');
    expect(contract).toContain('"command":"/cc-view <status|tree|diff>"');
    expect(contract).toContain("do not collapse `tree` or `diff` responses to `status`");
  });
});
