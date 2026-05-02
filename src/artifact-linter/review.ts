import {
  type StageLintContext,
  evaluateInvestigationTrace,
  markdownFieldRegex,
  sectionBodyByName
} from "./shared.js";
import { checkReviewTddNoCrossArtifactDuplication } from "./review-army.js";

export async function lintReviewStage(ctx: StageLintContext): Promise<void> {
  const {
    projectRoot,
    track,
    raw,
    absFile,
    sections,
    findings,
    parsedFrontmatter,
    brainstormShortCircuitBody,
    brainstormShortCircuitActivated,
    staleDiagramAuditEnabled,
    isTrivialOverride
  } = ctx;

    evaluateInvestigationTrace(ctx, "Changed-File Coverage");

    // Universal Layer 2.7 structural checks (superpowers requesting + receiving).
    const frameBody = sectionBodyByName(sections, "Pre-Critic Self-Review");
    if (frameBody !== null) {
      const required = [
        "Build/lint/type-check/tests passed locally",
        "Diff matches spec/plan (no scope creep)",
        "Evidence (commands + result):",
        "Goal:",
        "Approach:",
        "Risk areas:",
        "Verification done:",
        "Open questions"
      ];
      const missing = required.filter(
        (token) => {
          const escaped = token
            .replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")
            .replace(/\\:/gu, "\\s*:");
          return !new RegExp(escaped, "iu").test(frameBody);
        }
      );
      findings.push({
        section: "Pre-Critic Self-Review Coverage",
        required: true,
        rule: "Pre-Critic Self-Review must include key self-check lines plus Goal, Approach, Risk areas, Verification done, and Open questions.",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Pre-Critic Self-Review covers all required fields."
          : `Pre-Critic Self-Review is missing field(s): ${missing.join(", ")}.`
      });
    }

    const criticBody = sectionBodyByName(sections, "Critic Subagent Dispatch");
    if (criticBody !== null) {
      const required = [
        "Critic agent definition path",
        "Dispatch surface",
        "Frame sent",
        "Critic returned"
      ];
      const missing = required.filter((token) => !criticBody.includes(token));
      findings.push({
        section: "Critic Subagent Dispatch Shape",
        required: true,
        rule: "Critic Subagent Dispatch must declare agent definition path, dispatch surface, frame sent, and critic-returned summary.",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Critic dispatch metadata complete."
          : `Critic Subagent Dispatch is missing field(s): ${missing.join(", ")}.`
      });
    }

    const receivingBody = sectionBodyByName(sections, "Receiving Posture");
    if (receivingBody !== null) {
      const ack = /no performative agreement/iu.test(receivingBody);
      findings.push({
        section: "Receiving Posture Anti-Sycophancy",
        required: true,
        rule: "Receiving Posture must affirm `No performative agreement (forbidden openers acknowledged)`.",
        found: ack,
        details: ack
          ? "Receiving posture acknowledged anti-sycophancy."
          : "Receiving Posture is missing the anti-sycophancy acknowledgement line."
      });
    }

    const dupResult = await checkReviewTddNoCrossArtifactDuplication(projectRoot);
    findings.push({
      section: "review.no_cross_artifact_duplication",
      required: true,
      rule: "[P1] review.no_cross_artifact_duplication — when a finding ID appears in both `06-tdd.md > Per-Slice Review` and `07-review-army.json`, severity and disposition must match (review cites tdd; never re-classifies).",
      found: dupResult.ok,
      details: dupResult.ok
        ? dupResult.tddArtifactExists && dupResult.reviewArtifactExists
          ? "No cross-artifact severity/disposition conflicts between tdd Per-Slice Review and review-army findings."
          : "Skipped: tdd Per-Slice Review or review-army artifact not present."
        : dupResult.errors.join(" ")
    });

    const lensCoverageBody = sectionBodyByName(sections, "Lens Coverage");
    if (lensCoverageBody === null) {
      findings.push({
        section: "reviewer.lens_coverage_missing",
        required: true,
        rule: "[P1] reviewer.lens_coverage_missing — review artifact must include `## Lens Coverage` with Performance/Compatibility/Observability/Security lines.",
        found: false,
        details: "No ## heading matching required section \"Lens Coverage\"."
      });
    } else {
      const performance = markdownFieldRegex("Performance", "NO_IMPACT|FOUND_\\d+").test(lensCoverageBody);
      const compatibility = markdownFieldRegex("Compatibility", "NO_IMPACT|FOUND_\\d+").test(lensCoverageBody);
      const observability = markdownFieldRegex("Observability", "NO_IMPACT|FOUND_\\d+").test(lensCoverageBody);
      const security = markdownFieldRegex(
        "Security",
        "routed\\s+to\\s+security-reviewer"
      ).test(lensCoverageBody);
      const missing: string[] = [];
      if (!performance) missing.push("Performance");
      if (!compatibility) missing.push("Compatibility");
      if (!observability) missing.push("Observability");
      if (!security) missing.push("Security");
      findings.push({
        section: "reviewer.lens_coverage_missing",
        required: true,
        rule: "[P1] reviewer.lens_coverage_missing — `Lens Coverage` must include Performance/Compatibility/Observability (`NO_IMPACT` or `FOUND_<n>`) and Security routing line.",
        found: missing.length === 0,
        details: missing.length === 0
          ? "Lens Coverage includes all required reviewer lens lines."
          : `Lens Coverage missing or malformed line(s): ${missing.join(", ")}.`
      });
    }
}
