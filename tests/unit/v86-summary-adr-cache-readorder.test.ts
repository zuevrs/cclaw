import { describe, expect, it } from "vitest";
import { AUTO_TRIGGER_SKILLS } from "../../src/content/skills.js";
import { START_COMMAND_BODY } from "../../src/content/start-command.js";
import { CANCEL_COMMAND_BODY } from "../../src/content/cancel-command.js";
import { SPECIALIST_PROMPTS } from "../../src/content/specialist-prompts/index.js";
import { REQUIRED_GITIGNORE_PATTERNS } from "../../src/gitignore.js";

const ARCHITECT_PROMPT = SPECIALIST_PROMPTS["architect"];
const PLANNER_PROMPT = SPECIALIST_PROMPTS["planner"];
const BRAINSTORMER_PROMPT = SPECIALIST_PROMPTS["brainstormer"];
const SLICE_BUILDER_PROMPT = SPECIALIST_PROMPTS["slice-builder"];
const REVIEWER_PROMPT = SPECIALIST_PROMPTS["reviewer"];

const skill = (id: string) => {
  const found = AUTO_TRIGGER_SKILLS.find((s) => s.id === id);
  if (!found) throw new Error(`skill ${id} not registered`);
  return found;
};

describe("v8.6 — summary block / reviewer attestation / self-review gate / ADR catalogue / SDD cache / pre-task read order", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // A2 — Three-section Summary block
  // ─────────────────────────────────────────────────────────────────────────
  describe("A2 — three-section ## Summary block", () => {
    it("registers the summary-format skill as always-on", () => {
      const s = skill("summary-format");
      expect(s.fileName).toBe("summary-format.md");
      expect(s.triggers).toContain("always-on");
      expect(s.body).toMatch(/Changes made/);
      expect(s.body).toMatch(/Things I noticed but didn't touch/);
      expect(s.body).toMatch(/Potential concerns/);
    });

    it("summary-format skill mandates all three subheadings, including empty ones", () => {
      const body = skill("summary-format").body;
      expect(body).toMatch(/Skipping a subheading is a finding/);
      expect(body).toMatch(/None\./);
      expect(body).toMatch(/anti-scope-creep section/);
    });

    it("summary-format skill names per-author headings for multi-author plan.md", () => {
      const body = skill("summary-format").body;
      expect(body).toMatch(/## Summary — brainstormer/);
      expect(body).toMatch(/## Summary — architect/);
      expect(body).toMatch(/## Summary — planner/);
    });

    it("brainstormer prompt has a Phase 6.5 that appends ## Summary — brainstormer", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/Phase 6\.5 — Append `## Summary — brainstormer`/);
      expect(BRAINSTORMER_PROMPT).toMatch(/anti-scope-creep section/);
    });

    it("architect prompt has Phase 6.75 that appends ## Summary to decisions.md", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Phase 6\.75 — Append `## Summary` block to decisions\.md/);
      expect(ARCHITECT_PROMPT).toMatch(/Things I noticed but didn't touch/);
    });

    it("planner prompt has Phase 6.5 that appends ## Summary to plan.md (per-author on large-risky)", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 6\.5 — Append `## Summary` block to plan\.md/);
      expect(PLANNER_PROMPT).toMatch(/Summary — planner/);
    });

    it("slice-builder prompt mandates the Summary block at the bottom of build.md", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/Summary block — required at the bottom of `build\.md`/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/Mandatory in every mode \(soft, strict, fix-only\)/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/Summary — slice-N/);
    });

    it("reviewer iteration block names ## Summary — iteration N", () => {
      expect(REVIEWER_PROMPT).toMatch(/Summary — iteration N/);
      expect(REVIEWER_PROMPT).toMatch(/three-section block/);
    });

    it("reviewer hard rules forbid skipping the Summary block per iteration", () => {
      expect(REVIEWER_PROMPT).toMatch(/Skipping any of these sections is itself a finding/);
    });

    it("brainstormer self-review checklist references the Summary block", () => {
      expect(BRAINSTORMER_PROMPT).toMatch(/Summary — brainstormer.*block is present/);
    });

    it("planner self-review checklist references the Summary block", () => {
      expect(PLANNER_PROMPT).toMatch(/`## Summary\[ — planner\]` block is present/);
    });

    it("architect self-review checklist references the Summary block", () => {
      expect(ARCHITECT_PROMPT).toMatch(/`## Summary` block is present.*at the bottom of `decisions\.md`/);
    });

    it("slice-builder hard rules require the Summary block in every mode", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/`## Summary` block at the bottom of `build\.md`/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/Mandatory in every mode \(soft, strict, fix-only\)/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A3 — Reviewer 'What's done well' + 'Verification story'
  // ─────────────────────────────────────────────────────────────────────────
  describe("A3 — reviewer mandates anti-sycophancy + verification attestation", () => {
    it("reviewer iteration block lists What's done well as step 6", () => {
      expect(REVIEWER_PROMPT).toMatch(/6\. \*\*What's done well\*\*/);
      expect(REVIEWER_PROMPT).toMatch(/at least one concrete, evidence-backed positive observation/);
    });

    it("reviewer iteration block lists Verification story as step 7", () => {
      expect(REVIEWER_PROMPT).toMatch(/7\. \*\*Verification story\*\*/);
      expect(REVIEWER_PROMPT).toMatch(/three explicit yes\/no rows: tests run, build run, security checked/);
    });

    it("reviewer's What's done well section bans empty acknowledgements", () => {
      expect(REVIEWER_PROMPT).toMatch(/Anti-sycophancy: `What's done well`/);
      expect(REVIEWER_PROMPT).toMatch(/At least 1, at most 5/);
      expect(REVIEWER_PROMPT).toMatch(/cites `file:line`/);
      expect(REVIEWER_PROMPT).toMatch(/No empty acknowledgements/);
    });

    it("reviewer's What's done well section allows the empty case explicitly", () => {
      expect(REVIEWER_PROMPT).toMatch(/Empty case is allowed/);
      expect(REVIEWER_PROMPT).toMatch(/Met the AC; nothing else stood out/);
    });

    it("reviewer Verification story has three named dimensions with evidence requirements", () => {
      expect(REVIEWER_PROMPT).toMatch(/Tests run \| yes \/ no \/ n\/a/);
      expect(REVIEWER_PROMPT).toMatch(/Build \/ typecheck run/);
      expect(REVIEWER_PROMPT).toMatch(/Security pre-screen/);
      expect(REVIEWER_PROMPT).toMatch(/Evidence column is mandatory/);
    });

    it("reviewer Verification story attests with citation, not bare yes/no", () => {
      expect(REVIEWER_PROMPT).toMatch(/`yes` requires a citation/);
      expect(REVIEWER_PROMPT).toMatch(/Yes\/no without evidence is decoration/);
    });

    it("reviewer iteration-1 worked example includes the new sections", () => {
      expect(REVIEWER_PROMPT).toMatch(/### What's done well/);
      expect(REVIEWER_PROMPT).toMatch(/### Verification story/);
    });

    it("reviewer hard rules require all the new mandatory sections per iteration", () => {
      expect(REVIEWER_PROMPT).toMatch(/Every iteration block includes/);
      expect(REVIEWER_PROMPT).toMatch(/`What's done well`.*≥1 evidence-backed item/);
      expect(REVIEWER_PROMPT).toMatch(/`Verification story`.*three rows/);
    });

    it("orchestrator review hop documents What's done well + Verification story", () => {
      expect(START_COMMAND_BODY).toMatch(/What's done well.*Verification story/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // A4 — Worker self-review evidence gate
  // ─────────────────────────────────────────────────────────────────────────
  describe("A4 — slice-builder self_review[] evidence gate", () => {
    it("slice-builder JSON schema declares self_review[] with verified+evidence per AC", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/"self_review":/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/"rule": "tests-fail-then-pass"/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/"rule": "build-clean"/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/"rule": "no-shims"/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/"rule": "touch-surface-respected"/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/"verified": true/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/"evidence":/);
    });

    it("slice-builder declares the self-review gate as mandatory before reviewer", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/Self-review gate \(mandatory before reviewer\)/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/Reviewer cycles are expensive; this gate saves one/);
    });

    it("slice-builder defines the four self-review rules with evidence requirements", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/`tests-fail-then-pass`.*RED.*GREEN/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/`build-clean`.*typecheck/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/`no-shims`/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/`touch-surface-respected`/);
    });

    it("slice-builder requires honest false attestation — not bypassing the gate", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/Empty evidence is a failure/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/You honestly attest/);
      expect(SLICE_BUILDER_PROMPT).toMatch(/Do not skip the gate/);
    });

    it("slice-builder hard rules include self_review attestation as rule 13", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/13\. \*\*`self_review\[\]` is mandatory/);
    });

    it("slice-builder Composition footer mentions the orchestrator inspecting self_review", () => {
      expect(SLICE_BUILDER_PROMPT).toMatch(/Self-review gate.*orchestrator inspects `self_review\[\]`/);
    });

    it("orchestrator review hop declares the self-review gate before dispatching reviewer", () => {
      expect(START_COMMAND_BODY).toMatch(/Self-review gate \(mandatory before reviewer dispatch\)/);
      expect(START_COMMAND_BODY).toMatch(/bounce the slice straight back to slice-builder/);
      expect(START_COMMAND_BODY).toMatch(/Do NOT dispatch reviewer/);
    });

    it("orchestrator declares the self-review fix-only envelope shape", () => {
      expect(START_COMMAND_BODY).toMatch(/Stage: build \(self-review fix-only\)/);
      expect(START_COMMAND_BODY).toMatch(/Failed rules:/);
      expect(START_COMMAND_BODY).toMatch(/re-emit the strict-mode JSON summary with self_review\[\] re-attested/);
    });

    it("orchestrator parallel-build self-review gate runs per-slice (no bottlenecking)", () => {
      expect(START_COMMAND_BODY).toMatch(
        /In parallel-build the gate runs \*\*per slice\*\*: a slice whose self-review fails bounces back; \*\*healthy slices proceed\*\*/
      );
    });

    it("orchestrator escalates repeated self-review failures to the user", () => {
      expect(START_COMMAND_BODY).toMatch(/third bounce.*escalate to user/);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B2 — ADR catalogue (docs/decisions/ADR-NNNN-<slug>.md)
  // ─────────────────────────────────────────────────────────────────────────
  describe("B2 — repo-wide ADR catalogue with PROPOSED → ACCEPTED → SUPERSEDED lifecycle", () => {
    it("registers the documentation-and-adrs skill", () => {
      const s = skill("documentation-and-adrs");
      expect(s.fileName).toBe("documentation-and-adrs.md");
      expect(s.triggers).toContain("specialist:architect");
      expect(s.triggers).toContain("tier:product-grade");
      expect(s.triggers).toContain("tier:ideal");
    });

    it("documentation-and-adrs skill defines the file convention", () => {
      const body = skill("documentation-and-adrs").body;
      expect(body).toMatch(/docs\/decisions\/ADR-NNNN-<slug>\.md/);
      expect(body).toMatch(/zero-padded to 4 digits/);
      expect(body).toMatch(/Numbers are never reused/);
    });

    it("documentation-and-adrs skill enumerates the four lifecycle states", () => {
      const body = skill("documentation-and-adrs").body;
      expect(body).toMatch(/PROPOSED.*ACCEPTED.*SUPERSEDED/);
      expect(body).toMatch(/REJECTED/);
    });

    it("documentation-and-adrs skill defines the trigger table for when to write an ADR", () => {
      const body = skill("documentation-and-adrs").body;
      expect(body).toMatch(/New public interface/);
      expect(body).toMatch(/Persistence shape change/);
      expect(body).toMatch(/Security boundary/);
      expect(body).toMatch(/New runtime dependency/);
      expect(body).toMatch(/Architectural pattern/);
    });

    it("documentation-and-adrs skill states architect proposes (never ACCEPTED)", () => {
      const body = skill("documentation-and-adrs").body;
      expect(body).toMatch(/Architect does \*\*not\*\* mark the ADR `ACCEPTED` themselves/);
      expect(body).toMatch(/Architect always proposes/);
    });

    it("documentation-and-adrs skill states orchestrator promotes at Hop 6", () => {
      const body = skill("documentation-and-adrs").body;
      expect(body).toMatch(/Orchestrator's contract — promotion at Hop 6/);
      expect(body).toMatch(/`status: PROPOSED` → `status: ACCEPTED`/);
      expect(body).toMatch(/accepted_at_commit/);
    });

    it("documentation-and-adrs skill describes supersession (in-place, history kept)", () => {
      const body = skill("documentation-and-adrs").body;
      expect(body).toMatch(/Supersession/);
      expect(body).toMatch(/`status: ACCEPTED` → `status: SUPERSEDED`/);
      expect(body).toMatch(/superseded_by/);
    });

    it("architect prompt has Phase 6.5 that proposes ADR(s) when triggers fire", () => {
      expect(ARCHITECT_PROMPT).toMatch(
        /Phase 6\.5 — Propose ADR\(s\) for the durable subset \(when triggered\)/
      );
      expect(ARCHITECT_PROMPT).toMatch(/Status is \*\*always\*\* `PROPOSED`/);
      expect(ARCHITECT_PROMPT).toMatch(/Promotion to `ACCEPTED` is the orchestrator's job/);
    });

    it("architect prompt skips Phase 6.5 on minimum-viable tier", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Skip Phase 6\.5 entirely on `minimum-viable` tier/);
    });

    it("architect self-review checklist requires ADR-when-triggered", () => {
      expect(ARCHITECT_PROMPT).toMatch(
        /\*\*ADRs proposed where required\.\*\*.*tier=product-grade or ideal/
      );
    });

    it("architect Composition footer adds documentation-and-adrs as a wrapper skill", () => {
      expect(ARCHITECT_PROMPT).toMatch(/`documentation-and-adrs\.md`.*tier=product-grade or ideal/);
    });

    it("architect side-effects allow docs/decisions/ADR-NNNN-<slug>.md (PROPOSED only)", () => {
      expect(ARCHITECT_PROMPT).toMatch(
        /docs\/decisions\/ADR-NNNN-<slug>\.md.*status `PROPOSED` only — never `ACCEPTED`/
      );
    });

    it("orchestrator Hop 6 promotes ADRs PROPOSED → ACCEPTED at step 6", () => {
      expect(START_COMMAND_BODY).toMatch(/6\. \*\*Promote ADRs \(PROPOSED → ACCEPTED\)\.\*\*/);
      expect(START_COMMAND_BODY).toMatch(/`status: PROPOSED` → `status: ACCEPTED`/);
      expect(START_COMMAND_BODY).toMatch(
        /docs\(adr-NNNN\): promote to ACCEPTED via <slug>/
      );
    });

    it("orchestrator final summary cites promoted ADRs", () => {
      expect(START_COMMAND_BODY).toMatch(/any ADR ids promoted to `ACCEPTED` in step 6/);
    });

    it("cancel command marks PROPOSED ADRs as REJECTED (kept, never deleted)", () => {
      expect(CANCEL_COMMAND_BODY).toMatch(/Reject any PROPOSED ADR\(s\)/);
      expect(CANCEL_COMMAND_BODY).toMatch(/`status: PROPOSED` → `status: REJECTED`/);
      expect(CANCEL_COMMAND_BODY).toMatch(/rejected_because: cancelled \(no ship\)/);
      expect(CANCEL_COMMAND_BODY).toMatch(/The ADR file is \*\*kept\*\*/);
    });

    it("orchestrator Skills attached section documents documentation-and-adrs", () => {
      expect(START_COMMAND_BODY).toMatch(
        /\*\*documentation-and-adrs\*\*.*ADR.*`PROPOSED`.*`ACCEPTED`.*Hop 6/
      );
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B5 — SDD doc cache (.cclaw/cache/sdd/)
  // ─────────────────────────────────────────────────────────────────────────
  describe("B5 — source-driven doc fetch cache", () => {
    it("source-driven skill teaches cache lookup before fetch", () => {
      const body = skill("source-driven").body;
      expect(body).toMatch(/Cache lookup before fetch \(mandatory\)/);
      expect(body).toMatch(/\.cclaw\/cache\/sdd\/<host>\/<url-path>/);
    });

    it("source-driven skill describes fresh / revalidated / miss / stale cache states", () => {
      const body = skill("source-driven").body;
      expect(body).toMatch(/hit-fresh/);
      expect(body).toMatch(/hit-revalidated/);
      expect(body).toMatch(/miss-fetched/);
      expect(body).toMatch(/stale-cache/);
    });

    it("source-driven skill uses 24h freshness and conditional GET", () => {
      const body = skill("source-driven").body;
      expect(body).toMatch(/< 24h old/);
      expect(body).toMatch(/If-None-Match/);
      expect(body).toMatch(/If-Modified-Since/);
      expect(body).toMatch(/304 Not Modified/);
    });

    it("source-driven skill drops only tracking query parameters", () => {
      const body = skill("source-driven").body;
      expect(body).toMatch(/utm_\*, gclid, fbclid/);
      expect(body).toMatch(/anchors are part of the URL but never affect cache key/);
    });

    it("source-driven sources block carries cache_path + cache_status fields", () => {
      const body = skill("source-driven").body;
      expect(body).toMatch(/cache_path: \.cclaw\/cache\/sdd\//);
      expect(body).toMatch(/cache_status:/);
    });

    it("source-driven skill flags stale-cache as a reviewer finding", () => {
      const body = skill("source-driven").body;
      expect(body).toMatch(/cache_status: stale-cache/);
      expect(body).toMatch(/reviewer treats `cache_status: stale-cache` as a finding/);
      expect(body).toMatch(/severity=consider/);
    });

    it("gitignore patterns include .cclaw/cache/", () => {
      expect(REQUIRED_GITIGNORE_PATTERNS).toContain(".cclaw/cache/");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // B6 — Phase 1.5 / 2.5 mandatory pre-task read order
  // ─────────────────────────────────────────────────────────────────────────
  describe("B6 — mandatory pre-task read order in architect & planner", () => {
    it("architect has Phase 2.5 — Pre-task read order with the fixed ordering", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Phase 2\.5 — Pre-task read order \(brownfield only/);
      expect(ARCHITECT_PROMPT).toMatch(/1\. \*\*Target file\(s\)\*\*/);
      expect(ARCHITECT_PROMPT).toMatch(/2\. \*\*Their tests\*\*/);
      expect(ARCHITECT_PROMPT).toMatch(/3\. \*\*One neighbouring pattern\*\*/);
      expect(ARCHITECT_PROMPT).toMatch(/4\. \*\*Relevant types \/ interfaces\*\*/);
    });

    it("architect Phase 2.5 skips on greenfield repos and on directories with no siblings", () => {
      expect(ARCHITECT_PROMPT).toMatch(/Skip Phase 2\.5 entirely on \*\*greenfield\*\*/);
      expect(ARCHITECT_PROMPT).toMatch(/Skip step 3 \(neighbouring pattern\) when the touched directory has no sibling files/);
    });

    it("architect Phase 2.5 reuses research-repo.md citations when available", () => {
      expect(ARCHITECT_PROMPT).toMatch(/treat the cited paths there as your focus surface\. Do not re-derive/);
    });

    it("architect self-review checklist requires Phase 2.5 citations on each D-N", () => {
      expect(ARCHITECT_PROMPT).toMatch(
        /Every D-N's Refs line cites at least one file:line you read in Phase 2\.5/
      );
    });

    it("planner has Phase 2.5 — Pre-task read order with the same fixed ordering", () => {
      expect(PLANNER_PROMPT).toMatch(/Phase 2\.5 — Pre-task read order \(brownfield only/);
      expect(PLANNER_PROMPT).toMatch(/1\. \*\*Target file\(s\)\*\*/);
      expect(PLANNER_PROMPT).toMatch(/2\. \*\*Their tests\*\*/);
      expect(PLANNER_PROMPT).toMatch(/3\. \*\*One neighbouring pattern\*\*/);
      expect(PLANNER_PROMPT).toMatch(/4\. \*\*Relevant types \/ interfaces\*\*/);
    });

    it("planner Phase 2.5 lets greenfield surfaces mark new files explicitly", () => {
      expect(PLANNER_PROMPT).toMatch(/AC's verification line as `new file: <path>`/);
    });

    it("planner self-review checklist gates AC against Phase 2.5 reads", () => {
      expect(PLANNER_PROMPT).toMatch(
        /Every `touchSurface` path was read in Phase 2\.5.*or is explicitly marked `new file: <path>`/
      );
    });
  });
});
