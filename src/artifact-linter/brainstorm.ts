import {
  type StageLintContext,
  sectionBodyByName,
  validateApproachesTaxonomy,
  headingLineIndex,
  meaningfulLineCount,
  parseShortCircuitStatus,
  validateCalibratedSelfReview,
  markdownFieldRegex
} from "./shared.js";

export async function lintBrainstormStage(ctx: StageLintContext): Promise<void> {
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

    // Brainstorm Iron Law: "NO ARTIFACT IS COMPLETE WITHOUT AN EXPLICITLY
    // APPROVED DIRECTION — SILENCE IS NOT APPROVAL." Previously this was
    // prose-only — nothing failed when the Selected Direction section
    // omitted an approval marker, or when the Approaches table collapsed
    // to a single row (defeating the "2-3 distinct approaches" gate).
    const tierBody = sectionBodyByName(sections, "Approach Tier");
    if (tierBody !== null) {
      // Token vocabulary covers `lite`, `Lightweight`, `Standard`, and
      // `Deep` (case-insensitive). A line that lists ≥2 distinct tokens is
      // the unfilled template placeholder (`Tier: lite | standard | deep`)
      // and must not silently pass; we look for at least one decision line
      // with exactly one token, while ignoring placeholder lines.
      const cleanedLines = tierBody
        .split("\n")
        .map((line) => line.replace(/[*_`]/gu, ""));
      const lineTokenCounts = cleanedLines.map((line) => {
        const tokens = line.match(/\b(?:lite|lightweight|light|standard|deep)\b/giu) ?? [];
        return new Set(tokens.map((token) => token.toLowerCase())).size;
      });
      const hasDecisionLine = lineTokenCounts.some((count) => count === 1);
      const hasPlaceholderLine = lineTokenCounts.some((count) => count >= 2);
      const ok = hasDecisionLine;
      findings.push({
        section: "Approach Tier Classification",
        required: true,
        rule: "Approach Tier must explicitly classify depth as one of `lite` (a.k.a. `Lightweight`), `Standard`, or `Deep`.",
        found: ok,
        details: ok
          ? "Approach Tier includes a single recognized depth token."
          : hasPlaceholderLine
            ? "Approach Tier still lists multiple tier tokens (template placeholder); pick exactly one of `lite`/`Lightweight`, `Standard`, or `Deep`."
            : "Approach Tier is missing a recognized depth token (`lite`/`Lightweight`, `Standard`, or `Deep`)."
      });
    }

    const approachesBody = sectionBodyByName(sections, "Approaches");
    if (approachesBody !== null) {
      const approachesTaxonomy = validateApproachesTaxonomy(approachesBody);
      findings.push({
        section: "Distinct Approaches Enforcement",
        required: true,
        rule: "Approaches section must document at least 2 distinct approaches so the Iron Law comparison is meaningful.",
        found: approachesTaxonomy.rowCount >= 2,
        details:
          approachesTaxonomy.rowCount >= 2
            ? `Detected ${approachesTaxonomy.rowCount} approach row(s).`
            : `Detected ${approachesTaxonomy.rowCount} approach row(s); at least 2 required.`
      });
      findings.push({
        section: "Approaches Role/Upside Taxonomy",
        required: true,
        rule: "Approaches table must use canonical Role and Upside enum values.",
        found: approachesTaxonomy.roleUpsideOk,
        details: approachesTaxonomy.details
      });
      findings.push({
        section: "Challenger Alternative Enforcement",
        required: true,
        rule: "Approaches must include one challenger option with explicit high/higher upside.",
        found: approachesTaxonomy.challengerOk,
        details: approachesTaxonomy.details
      });
    }

    const reactionIndex = headingLineIndex(raw, "Approach Reaction");
    const directionIndex = headingLineIndex(raw, "Selected Direction");
    if (directionIndex >= 0 && !brainstormShortCircuitActivated) {
      const orderOk = reactionIndex >= 0 && reactionIndex < directionIndex;
      findings.push({
        section: "Approach Reaction Ordering",
        required: true,
        rule: "Approach Reaction must appear before Selected Direction (propose -> react -> recommend).",
        found: orderOk,
        details: orderOk
          ? "Approach Reaction appears before Selected Direction."
          : "Approach Reaction must be present before Selected Direction."
      });
    }

    const directionBody = sectionBodyByName(sections, "Selected Direction");
    if (directionBody !== null) {
      const approvalMarker = /\bapprov(?:ed|al)\b/iu.test(directionBody);
      findings.push({
        section: "Direction Approval Marker",
        required: true,
        rule: "Selected Direction section must state an explicit approval marker (for example `Approval: approved` or `Approved by: user`).",
        found: approvalMarker,
        details: approvalMarker
          ? "Approval marker present in Selected Direction."
          : "No explicit `approved`/`approval` marker found in Selected Direction."
      });
      if (!brainstormShortCircuitActivated) {
        const reactionBody = sectionBodyByName(sections, "Approach Reaction");
        const reactionTrace =
          /\b(?:reaction|feedback|concern(?:s)?)\b/iu.test(directionBody) ||
          (reactionIndex >= 0 && reactionIndex < directionIndex && meaningfulLineCount(reactionBody ?? "") > 0);
        findings.push({
          section: "Direction Reaction Trace",
          required: true,
          rule: "Selected Direction must be traceable to a prior Approach Reaction section or explicitly reference user reaction/feedback/concerns.",
          found: reactionTrace,
          details: reactionTrace
            ? "Selected Direction is traceable to prior user reaction."
            : "Selected Direction is not traceable to user reaction. Add `## Approach Reaction` before it, or mention the user's reaction/concerns in the rationale."
        });

        // Track-aware handoff: standard track goes to `scope`; medium track
        // goes directly to `spec`; the quick track skips brainstorm entirely.
        // We accept either canonical successor token plus a generic
        // `next-stage` / `handoff` phrase to preserve i18n flexibility.
        const handoffTrace =
          /(?:`(?:scope|spec)`|\bscope\b|\bspec\b|next[-\s_]stage|next stage|\bhandoff\b|hand[-\s]off)/iu.test(
            directionBody
          );
        findings.push({
          section: "Direction Next-Stage Handoff",
          required: true,
          rule: "Selected Direction must record the track-aware next-stage handoff (mention `scope` for standard, `spec` for medium, or include a `Next-stage handoff:` line).",
          found: handoffTrace,
          details: handoffTrace
            ? "Selected Direction names the next-stage handoff."
            : "Selected Direction is missing a next-stage handoff token. Mention `scope` (standard) or `spec` (medium), or add a `Next-stage handoff:` line so downstream stages can trace the contract."
        });
      }
    }

    const shortCircuitBody = brainstormShortCircuitBody;
    if (shortCircuitBody !== null) {
      const statusValue = parseShortCircuitStatus(shortCircuitBody);
      const hasStatus = statusValue.length > 0;
      findings.push({
        section: "Short-Circuit Status",
        required: true,
        rule: "Short-Circuit Decision must include a `Status:` line (`activated` or `bypassed`).",
        found: hasStatus,
        details: hasStatus
          ? `Short-circuit status declared as "${statusValue}".`
          : "Short-Circuit Decision is missing a `Status:` line."
      });
      if (brainstormShortCircuitActivated) {
        const artifactLines = meaningfulLineCount(raw);
        const withinStubLimit = artifactLines <= 30;
        const hasScopeHandoff = /\bscope\b/iu.test(shortCircuitBody);
        findings.push({
          section: "Short-Circuit Stub Size",
          required: true,
          rule: "When short-circuit is activated, brainstorm artifact must remain a <=30 meaningful-line stub.",
          found: withinStubLimit,
          details: withinStubLimit
            ? `Short-circuit stub size within limit (${artifactLines} meaningful lines).`
            : `Short-circuit stub too large (${artifactLines} meaningful lines); expected <= 30.`
        });
        findings.push({
          section: "Short-Circuit Scope Handoff",
          required: true,
          rule: "When short-circuit is activated, the section must explicitly hand off to scope.",
          found: hasScopeHandoff,
          details: hasScopeHandoff
            ? "Short-circuit section includes explicit scope handoff."
            : "Short-circuit section is missing explicit scope handoff guidance."
        });
      }
    }

    const selfReviewBody = sectionBodyByName(sections, "Self-Review Notes");
    if (selfReviewBody !== null) {
      const selfReview = validateCalibratedSelfReview(selfReviewBody);
      findings.push({
        section: "Calibrated Self-Review Format",
        required: true,
        rule: "When Self-Review Notes are present, they must use the calibrated review prompt output shape.",
        found: selfReview.ok,
        details: selfReview.details
      });
    }

    // Universal structural checks (Layer 2.1). Each fires only when the
    // matching section is present so legacy fixtures keep their current
    // shape, while artifacts emitted from the v3 template have to satisfy
    // them. Content is never inspected — only the shape required by the
    // reference patterns (gstack mode, forcing questions, premise list,
    // approach detail cards, anti-sycophancy stamp).
    const modeBody = sectionBodyByName(sections, "Mode Block");
    if (modeBody !== null) {
      const modeTokens = ["STARTUP", "BUILDER", "ENGINEERING", "OPS", "RESEARCH"] as const;
      const modeRegex = markdownFieldRegex(
        "Mode",
        modeTokens.join("|"),
        "u"
      );
      const tokenMatches = new Set<string>();
      const lineRegex = new RegExp(modeRegex.source, "gu");
      for (const match of modeBody.matchAll(lineRegex)) {
        const token = (match[0].match(/STARTUP|BUILDER|ENGINEERING|OPS|RESEARCH/u) ?? [""])[0];
        if (token) tokenMatches.add(token);
      }
      const placeholderLine = modeBody
        .split("\n")
        .find((line) => /\bMode\b\s*[*_]{0,2}\s*:/iu.test(line) && (line.match(/STARTUP|BUILDER|ENGINEERING|OPS|RESEARCH/giu) ?? []).length >= 2);
      const isPlaceholder = Boolean(placeholderLine);
      const ok = tokenMatches.size === 1 && !isPlaceholder;
      findings.push({
        section: "Mode Block Token",
        required: true,
        rule: "Mode Block must declare exactly one mode token: STARTUP, BUILDER, ENGINEERING, OPS, or RESEARCH.",
        found: ok,
        details: ok
          ? `Recognized mode token detected: ${[...tokenMatches][0] ?? ""}.`
          : isPlaceholder
            ? "Mode Block still lists multiple mode tokens (template placeholder); pick exactly one of STARTUP/BUILDER/ENGINEERING/OPS/RESEARCH."
            : "Mode Block is missing a recognized mode token (STARTUP/BUILDER/ENGINEERING/OPS/RESEARCH)."
      });
    }

    // Approach Detail Cards: structural sub-section under Approaches, one
    // bullet block per approach with the canonical fields.
    const approachCardsRegex =
      /####\s+APPROACH\s+[A-Z]\b[\s\S]*?(?:^-\s*Summary:[\s\S]*?^-\s*Effort:[\s\S]*?^-\s*Risk:[\s\S]*?^-\s*Pros:[\s\S]*?^-\s*Cons:[\s\S]*?^-\s*Reuses:)/gimu;
    const matches = raw.match(approachCardsRegex);
    const cardCount = matches ? matches.length : 0;
    if (
      /####\s+APPROACH\s+[A-Z]\b/iu.test(raw) ||
      /^RECOMMENDATION:/imu.test(raw)
    ) {
      findings.push({
        section: "Approach Detail Cards",
        required: true,
        rule: "Approach Detail Cards must include ≥2 `#### APPROACH <letter>` blocks each with Summary/Effort/Risk/Pros/Cons/Reuses.",
        found: cardCount >= 2,
        details: cardCount >= 2
          ? `Detected ${cardCount} valid approach detail card(s).`
          : `Detected ${cardCount} valid approach detail card(s); at least 2 required with all fields present.`
      });
      const recommendationLine = raw.match(/^RECOMMENDATION:\s*(.+)$/imu);
      const hasRecommendation = recommendationLine !== null && recommendationLine[1] !== undefined && recommendationLine[1].trim().length > 0;
      findings.push({
        section: "Approach Recommendation Marker",
        required: true,
        rule: "Approach Detail Cards must conclude with a single `RECOMMENDATION:` line citing the chosen letter and rationale.",
        found: hasRecommendation,
        details: hasRecommendation
          ? "Recommendation marker present."
          : "Missing or empty `RECOMMENDATION:` line after approach detail cards."
      });
    }

    const outsideVoiceBody = sectionBodyByName(sections, "Outside Voice");
    if (outsideVoiceBody !== null) {
      const required = ["source:", "prompt:", "tension:", "resolution:"];
      const missing = required.filter(
        (key) => !new RegExp(`(?:^|\\n)\\s*-?\\s*${key.replace(":", "\\s*:")}`, "iu").test(outsideVoiceBody)
      );
      const optedOut = /\bnot used\b|\bn\/a\b|\bnone\b/iu.test(outsideVoiceBody);
      findings.push({
        section: "Outside Voice Slot Shape",
        required: true,
        rule: "Outside Voice section must either declare opt-out (`not used`/`none`) or include `source:`, `prompt:`, `tension:`, `resolution:`.",
        found: optedOut || missing.length === 0,
        details: optedOut || missing.length === 0
          ? "Outside Voice slot is well-formed."
          : `Outside Voice section is missing field(s): ${missing.join(", ")}.`
      });
    }
}
