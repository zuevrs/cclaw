import type { FlowStage, FlowTrack } from "../types.js";

export interface LintFinding {
  section: string;
  required: boolean;
  rule: string;
  found: boolean;
  details: string;
}

export type H2SectionMap = Map<string, string>;

export interface ParsedFrontmatterLike {
  hasFrontmatter: boolean;
  values: Record<string, string>;
}

export interface StageLintContext {
  projectRoot: string;
  stage: FlowStage;
  track: FlowTrack;
  raw: string;
  absFile: string;
  sections: H2SectionMap;
  findings: LintFinding[];
  parsedFrontmatter: ParsedFrontmatterLike;
  brainstormShortCircuitBody: string | null;
  brainstormShortCircuitActivated: boolean;
  scopePreAuditEnabled: boolean;
  staleDiagramAuditEnabled: boolean;
  isTrivialOverride: boolean;
  overrideSet: Set<string> | null;
  shared: Record<string, unknown>;
}
