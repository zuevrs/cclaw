import { describe, expect, it } from "vitest";
import {
  CORE_AGENTS,
  RESEARCH_AGENTS,
  SPECIALIST_AGENTS,
  renderAgentMarkdown
} from "../../src/content/core-agents.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { LEARNINGS_RESEARCH_PROMPT } from "../../src/content/research-prompts/learnings-research.js";
import { REPO_RESEARCH_PROMPT } from "../../src/content/research-prompts/repo-research.js";
import {
  ARTIFACT_FILE_NAMES,
  activeArtifactPath,
  shippedArtifactPath
} from "../../src/artifact-paths.js";
import {
  FLOW_STATE_SCHEMA_VERSION,
  assertFlowStateV82,
  createInitialFlowState,
  isSpecialist
} from "../../src/flow-state.js";
import { RESEARCH_AGENT_IDS, SPECIALISTS } from "../../src/types.js";

const PLANNER_PROMPT = SPECIALIST_PROMPTS["planner"];
const BRAINSTORMER_PROMPT = SPECIALIST_PROMPTS["brainstormer"];
const ARCHITECT_PROMPT = SPECIALIST_PROMPTS["architect"];

describe("v8.5 — finalize / research / contracts / discovery / lastSpecialist", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1 — Hop 6 — finalize: git mv, no copy, post-condition empty
  // ─────────────────────────────────────────────────────────────────────────
  describe("Hop 6 — finalize uses git mv (or mv) and leaves the active dir empty", () => {
    it("orchestrator declares Hop 6 with explicit move semantics", () => {
      expect(START_COMMAND_BODY).toMatch(/## Hop 6 — Finalize/);
      expect(START_COMMAND_BODY).toMatch(/git mv/);
      expect(START_COMMAND_BODY).toMatch(/Move \(do NOT copy\)/);
      expect(START_COMMAND_BODY).toMatch(/active directory must end up empty/);
    });

    it("orchestrator forbids the word 'copy' in dispatch envelopes for finalize", () => {
      expect(START_COMMAND_BODY).toMatch(/No "copy" anywhere/);
      expect(START_COMMAND_BODY).toMatch(/never delegated to a sub-agent/);
    });

    it("orchestrator handles re-entrant finalize idempotently on resume", () => {
      expect(START_COMMAND_BODY).toMatch(/No re-entrant finalize on resume/);
      expect(START_COMMAND_BODY).toMatch(/already finalised in <iso>/);
    });

    it("orchestrator post-condition checks the active dir before resetting flow-state", () => {
      expect(START_COMMAND_BODY).toMatch(/Post-condition check \(mandatory\)/);
      expect(START_COMMAND_BODY).toMatch(/rmdir flows\/<slug>/);
    });

    it("orchestrator hop count bumped to seven", () => {
      expect(START_COMMAND_BODY).toMatch(/seven hops, in order/);
      expect(START_COMMAND_BODY).toMatch(/7\. \*\*Finalize\*\*/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2 — Mandatory contract reads in dispatch envelopes
  // ─────────────────────────────────────────────────────────────────────────
  describe("dispatch envelopes mandate two reads before sub-agent acts", () => {
    it("dispatch envelope lists agents/<name>.md as the Required first read", () => {
      expect(START_COMMAND_BODY).toMatch(/Required first read: \.cclaw\/lib\/agents\/<specialist>\.md/);
    });

    it("dispatch envelope lists wrapper skill as the Required second read", () => {
      expect(START_COMMAND_BODY).toMatch(/Required second read: \.cclaw\/lib\/skills\/<wrapper>\.md/);
    });

    it("orchestrator says first two reads are non-negotiable", () => {
      expect(START_COMMAND_BODY).toMatch(/non-negotiable/);
      expect(START_COMMAND_BODY).toMatch(/skips its contract file will hallucinate/);
    });

    it("brainstormer prompt opens with a Phase 1 bootstrap that reads the contract first", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 1 — Bootstrap/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Read .\.cclaw\/lib\/agents\/brainstormer\.md/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Read .\.cclaw\/lib\/skills\/plan-authoring\.md/);
    });

    it("planner prompt opens with a Phase 1 bootstrap that reads the contract first", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 1 — Bootstrap/);
      expect(PLANNER_PROMPT).toMatch(/Read .\.cclaw\/lib\/agents\/planner\.md/);
      expect(PLANNER_PROMPT).toMatch(/Read .\.cclaw\/lib\/skills\/plan-authoring\.md/);
    });

    it("architect prompt opens with a Phase 1 bootstrap that reads the contract first", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Phase 1 — Bootstrap/);
      expect(ARCHITECT_PROMPT).toMatch(/Read .\.cclaw\/lib\/agents\/architect\.md/);
      expect(ARCHITECT_PROMPT).toMatch(/Read .\.cclaw\/lib\/decision-protocol\.md/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3 — Brainstormer multi-phase workflow
  // ─────────────────────────────────────────────────────────────────────────
  describe("brainstormer is a multi-phase workflow, not a single-shot prompt", () => {
    it("declares all eight phases", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 1 — Bootstrap/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 2 — Posture pick/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 3 — Repo signals scan/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 4 — repo-research dispatch/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 5 — Clarifying questions/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 6 — Author Frame/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 7 — Self-review checklist/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 8 — Return slim summary/);
    });

    it("Phase 5 mandates one question at a time, max 3", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/at most three.*clarifying questions/i);
      expect(BRAINSTORMER_PROMPT).toMatch(/Ask one at a time/i);
      expect(BRAINSTORMER_PROMPT).toMatch(/No batches/);
    });

    it("Phase 7 self-review enumerates concrete checks", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/Frame names a user/);
      expect(BRAINSTORMER_PROMPT).toMatch(/verifiable success criterion/);
      expect(BRAINSTORMER_PROMPT).toMatch(/Approaches rows are defensible/);
    });

    it("deep posture dispatches repo-research", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 4.*deep posture only.*skipped on lean\/guided/i);
      expect(BRAINSTORMER_PROMPT).toMatch(/Dispatch .repo-research/);
    });

    it("brainstormer lists `repo-research` as its only optional dispatch", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/You may dispatch.{0,40}repo-research/i);
      expect(BRAINSTORMER_PROMPT).toMatch(/no other research helpers/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4 — Research helpers (repo-research + learnings-research)
  // ─────────────────────────────────────────────────────────────────────────
  describe("research helpers are first-class on-demand read-only sub-agents", () => {
    it("RESEARCH_AGENT_IDS lists the two helpers", () => {
      expect(RESEARCH_AGENT_IDS).toEqual(["repo-research", "learnings-research"]);
    });

    it("RESEARCH_AGENTS ship a non-empty prompt body", () => {
      expect(RESEARCH_AGENTS).toHaveLength(2);
      for (const agent of RESEARCH_AGENTS) {
        expect(agent.prompt.length).toBeGreaterThan(800);
        expect(agent.kind).toBe("research");
      }
    });

    it("repo-research prompt is read-only and writes a single artifact", () => {
      expect(REPO_RESEARCH_PROMPT).toMatch(/read-only/i);
      expect(REPO_RESEARCH_PROMPT).toMatch(/research-repo\.md/);
      expect(REPO_RESEARCH_PROMPT).toMatch(/Composition/);
      expect(REPO_RESEARCH_PROMPT).toMatch(/never invoke any other specialist/i);
    });

    it("learnings-research prompt scans knowledge.jsonl and writes a single artifact", () => {
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(/read-only/i);
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(/research-learnings\.md/);
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(/knowledge\.jsonl/);
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(/Composition/);
      expect(LEARNINGS_RESEARCH_PROMPT).toMatch(/Maximum 3 prior lessons/);
    });

    it("planner Phase 3 dispatches learnings-research as a sub-agent", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 3 — learnings-research dispatch/);
      expect(PLANNER_PROMPT).toMatch(/Dispatch the .learnings-research. helper/i);
      expect(PLANNER_PROMPT).toMatch(/wait for the slim summary/i);
    });

    it("planner Phase 4 dispatches repo-research only on brownfield", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 4 — repo-research dispatch \(conditional, brownfield only\)/);
      expect(PLANNER_PROMPT).toMatch(/Greenfield.*skips this phase/);
    });

    it("architect Phase 3 may dispatch repo-research conditionally", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Phase 3 — repo-research dispatch \(conditional\)/);
      expect(ARCHITECT_PROMPT).toMatch(/Dispatch .repo-research/);
    });

    it("architect prompt forbids dispatching learnings-research (planner's job)", () => {
      expect(ARCHITECT_PROMPT).toMatch(/learnings-research[^\n]*planner['’]s/i);
    });

    it("orchestrator lists research helpers in a dedicated section", () => {
      expect(START_COMMAND_BODY).toMatch(/## Available research helpers/);
      expect(START_COMMAND_BODY).toMatch(/repo-research/);
      expect(START_COMMAND_BODY).toMatch(/learnings-research/);
      expect(START_COMMAND_BODY).toMatch(/never become .lastSpecialist/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5 — discovery is a sub-phase of plan, never a stage entry
  // ─────────────────────────────────────────────────────────────────────────
  describe("discovery is a sub-phase of plan on large-risky, never a path entry", () => {
    it("orchestrator declares discovery is never a stage in triage.path", () => {
      expect(START_COMMAND_BODY).toMatch(/discovery. is never a stage in the path/i);
      expect(START_COMMAND_BODY).toMatch(/triage\.path. only ever holds the four canonical stages/);
    });

    it("orchestrator describes the plan stage expanding on large-risky", () => {
      expect(START_COMMAND_BODY).toMatch(/Plan stage on large-risky \(discovery sub-phase\)/);
      expect(START_COMMAND_BODY).toMatch(/brainstormer.*architect.*planner/i);
    });

    it("orchestrator explicitly clarifies discovery is not a separate path entry", () => {
      expect(START_COMMAND_BODY).toMatch(/Discovery \(sub-phase of plan on large-risky\)/);
      expect(START_COMMAND_BODY).toMatch(/not a stage in.{0,5}triage\.path/);
    });

    it("triage gate skill removes discovery from path examples", () => {
      // triage-gate.md is interpolated through skills.ts; the orchestrator's body must reflect the new wording
      expect(START_COMMAND_BODY).not.toMatch(/path.*discovery.*plan.*build.*review.*ship/i);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6 — pre-mortem in artifact stage list
  // ─────────────────────────────────────────────────────────────────────────
  describe("pre-mortem.md is a first-class artifact stage", () => {
    it("ARTIFACT_FILE_NAMES includes pre-mortem", () => {
      expect(ARTIFACT_FILE_NAMES["pre-mortem"]).toBe("pre-mortem.md");
    });

    it("activeArtifactPath/shippedArtifactPath both resolve pre-mortem", () => {
      expect(activeArtifactPath("/p", "pre-mortem", "demo")).toMatch(/flows\/demo\/pre-mortem\.md$/);
      expect(shippedArtifactPath("/p", "demo", "pre-mortem")).toMatch(/shipped\/demo\/pre-mortem\.md$/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7 — lastSpecialist widened to every SpecialistId, updated after every dispatch
  // ─────────────────────────────────────────────────────────────────────────
  describe("flow-state.lastSpecialist supports every specialist id", () => {
    it("createInitialFlowState starts with lastSpecialist=null", () => {
      const initial = createInitialFlowState("2026-05-09T00:00:00Z");
      expect(initial.lastSpecialist).toBeNull();
      expect(initial.schemaVersion).toBe(FLOW_STATE_SCHEMA_VERSION);
    });

    it("isSpecialist accepts every id in SPECIALISTS", () => {
      for (const id of SPECIALISTS) {
        expect(isSpecialist(id)).toBe(true);
      }
    });

    it("isSpecialist rejects research helper ids and bogus values", () => {
      expect(isSpecialist("repo-research")).toBe(false);
      expect(isSpecialist("learnings-research")).toBe(false);
      expect(isSpecialist("not-a-specialist")).toBe(false);
      expect(isSpecialist(null)).toBe(false);
    });

    it.each([
      ["brainstormer"],
      ["architect"],
      ["planner"],
      ["reviewer"],
      ["security-reviewer"],
      ["slice-builder"]
    ] as const)("lastSpecialist accepts %s as a valid id", (id) => {
      const state = {
        ...createInitialFlowState("2026-05-09T00:00:00Z"),
        currentSlug: "demo",
        currentStage: "plan",
        lastSpecialist: id
      } as const;
      expect(() => assertFlowStateV82(state)).not.toThrow();
    });

    it("orchestrator dispatch loop patches lastSpecialist after every dispatch", () => {
      expect(START_COMMAND_BODY).toMatch(/Patch .flow-state\.json. \*\*after every dispatch\*\*/);
      expect(START_COMMAND_BODY).toMatch(/the id of the specialist that just returned/);
    });

    it("orchestrator currentStage stays 'plan' during discovery sub-phase", () => {
      expect(START_COMMAND_BODY).toContain("`currentStage` stays `\"plan\"` for all three");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8 — Specialist / research separation in install registry
  // ─────────────────────────────────────────────────────────────────────────
  describe("CORE_AGENTS combines specialists and research helpers without conflating them", () => {
    it("SPECIALIST_AGENTS has 6 entries; RESEARCH_AGENTS has 2", () => {
      expect(SPECIALIST_AGENTS).toHaveLength(6);
      expect(RESEARCH_AGENTS).toHaveLength(2);
      expect(CORE_AGENTS).toHaveLength(8);
    });

    it("renderAgentMarkdown emits 'kind: research-helper' only for research entries", () => {
      const specialist = renderAgentMarkdown(SPECIALIST_AGENTS[0]);
      expect(specialist).not.toContain("kind: research-helper");

      const research = renderAgentMarkdown(RESEARCH_AGENTS[0]);
      expect(research).toContain("kind: research-helper");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9 — Stage → wrapper mapping is clear
  // ─────────────────────────────────────────────────────────────────────────
  describe("Stage → specialist mapping declares wrapper skills explicitly", () => {
    it("orchestrator lists wrapper skills per stage", () => {
      expect(START_COMMAND_BODY).toMatch(/Wrapper skill/);
      expect(START_COMMAND_BODY).toMatch(/plan-authoring \(planner\)/);
      expect(START_COMMAND_BODY).toMatch(/brainstorming-discovery \(brainstormer\)/);
      expect(START_COMMAND_BODY).toMatch(/architectural-decision \(architect\)/);
      expect(START_COMMAND_BODY).toMatch(/tdd-cycle/);
      expect(START_COMMAND_BODY).toMatch(/review-loop, anti-slop/);
    });

    it("orchestrator does NOT include 'discovery' as a stage in the mapping table", () => {
      const tableMatch = START_COMMAND_BODY.match(
        /### Stage → specialist mapping[\s\S]*?(?=###|## )/
      );
      expect(tableMatch).not.toBeNull();
      const tableBody = tableMatch![0];
      // The table must NOT have a `\`discovery\`` row entry as a stage
      expect(tableBody).not.toMatch(/^\| .discovery. \|/m);
    });
  });
});
