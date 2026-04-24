import { describe, expect, it } from "vitest";
import {
  diffCommandContract,
  diffCommandSkillMarkdown
} from "../../src/content/diff-command.js";
import {
  statusCommandContract,
  statusCommandSkillMarkdown
} from "../../src/content/status-command.js";
import {
  treeCommandContract,
  treeCommandSkillMarkdown
} from "../../src/content/tree-command.js";

describe("/cc-view status content", () => {
  const contract = statusCommandContract();
  const skill = statusCommandSkillMarkdown();

  it("renders delegations row with expectedMode and fulfillmentMode guidance", () => {
    expect(contract).toContain("delegations (<expectedMode>)");
    expect(contract).toContain("mode=<isolated|generic-dispatch|role-switch>");
    expect(skill).toContain("fulfillmentMode");
    expect(skill).toContain("harness-waiver");
  });

  it("flags completed-without-evidence on role-switch harnesses", () => {
    expect(contract).toContain("◎ missing-evidence");
    expect(skill).toContain("◎ missing-evidence");
    expect(skill).toContain("role-switch");
    expect(skill).toContain("evidenceRefs");
  });

  it("exposes the closeout substate row when ship is reached", () => {
    expect(contract).toContain("closeout: <shipSubstate>");
    expect(contract).toContain("retro=<drafted|accepted|skipped|—>");
    expect(contract).toContain("compound=<N promoted|skipped|—>");
    expect(skill).toContain("closeout.shipSubstate");
    expect(skill).toContain(`currentStage === "ship"`);
  });

  it("includes a harness parity row backed by capability metadata", () => {
    expect(contract).toContain("harness: <id>=<tier>/<fallback>");
    expect(contract).toContain("cclaw capability metadata");
    expect(skill).toContain("cclaw capability metadata");
    expect(skill).toContain("<tier>/<fallback>");
  });

  it("keeps the read-only hard-gate intact", () => {
    expect(contract).toMatch(/Do.*not.*mutate/u);
    expect(skill).toContain("read-only command");
  });
});

describe("/cc-view tree content", () => {
  const contract = treeCommandContract();
  const skill = treeCommandSkillMarkdown();

  it("renders delegation branch with fulfillmentMode labels", () => {
    expect(contract).toContain("mode=isolated");
    expect(skill).toContain("fulfillmentMode");
  });

  it("adds a closeout sub-tree under ship", () => {
    expect(contract).toContain("closeout (shipSubstate=retro_review)");
    expect(contract).toContain("retro:");
    expect(contract).toContain("compound:");
    expect(contract).toContain("archive:");
    expect(skill).toContain("closeout.shipSubstate");
    expect(skill).toContain(`ready_to_archive`);
  });

  it("adds a harnesses branch with tier/fallback metadata", () => {
    expect(contract).toContain("harnesses:");
    expect(contract).toContain("fallback=native");
    expect(contract).toContain("fallback=generic-dispatch");
    expect(contract).toContain("fallback=role-switch");
    expect(contract).toContain("cclaw doctor --explain");
    expect(skill).toContain("and fallback from cclaw capability metadata");
  });

  it("omits optional sub-trees only under documented conditions", () => {
    expect(contract).toContain("Closeout sub-tree is **omitted**");
    expect(contract).toContain(`shipSubstate === "idle"`);
    expect(contract).toContain("Delegations sub-branch is omitted");
  });
});

describe("/cc-view diff content", () => {
  const contract = diffCommandContract();
  const skill = diffCommandSkillMarkdown();

  it("diffs the ship closeout substate transitions", () => {
    expect(contract).toContain("closeout: idle -> retro_review");
    expect(skill).toContain("closeout.shipSubstate");
    expect(skill).toContain("ready_to_archive");
    expect(skill).toContain("archived");
  });

  it("tracks retro artifact appearance", () => {
    expect(contract).toContain("retro: +drafted (09-retro.md appeared)");
    expect(skill).toContain("09-retro.md");
  });

  it("captures per-agent fulfillmentMode transitions", () => {
    expect(contract).toContain("mode=generic-dispatch");
    expect(contract).toContain("mode=? -> role-switch");
    expect(skill).toContain("per-agent `fulfillmentMode` transitions");
    expect(skill).toContain("`delegations` projection");
  });

  it("embeds delegations projection in the new snapshot", () => {
    expect(skill).toContain("{ agent, status, fulfillmentMode }[]");
    expect(contract).toContain("{ agent, status, fulfillmentMode }[]");
  });

  it("preserves baseline-first rendering contract", () => {
    expect(contract).toContain("do not overwrite baseline before rendering");
    expect(skill).toContain("Never lose baseline visibility");
  });
});
