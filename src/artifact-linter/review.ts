// @ts-nocheck
import type { StageLintContext } from "./shared.js";

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
    isTrivialOverride,
    shared
  } = ctx;
  const {
    sectionBodyByName
  } = shared as Record<string, any>;

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
}
