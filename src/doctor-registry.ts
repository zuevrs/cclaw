export type DoctorSeverity = "error" | "warning" | "info";
export type DoctorActionGroup = "sync" | "user-action" | "stage-work" | "informational";

export interface DoctorCheckMetadata {
  severity: DoctorSeverity;
  summary: string;
  fix: string;
  actionGroup: DoctorActionGroup;
  docRef?: string;
}

interface DoctorRegistryRule {
  test: RegExp;
  metadata: DoctorCheckMetadata;
}

function ref(fileName: string): string {
  const anchor = fileName.replace(/\.md$/u, "").replace(/[^a-z0-9]+/giu, "-").toLowerCase();
  return `README.md#${anchor}`;
}

const RULES: DoctorRegistryRule[] = [
  {
    test: /^gates:reconcile:writeback$/,
    metadata: {
      severity: "info",
      summary: "Gate reconciliation status update.",
      fix: "No action required unless subsequent gate checks fail.",
      actionGroup: "informational",
      docRef: ref("config.md")
    }
  },
  {
    test: /^warning:/,
    metadata: {
      severity: "warning",
      summary: "Advisory signal; runtime can continue with caution.",
      fix: "Address when possible to prevent future drift or degraded behavior.",
      actionGroup: "informational",
      docRef: "README.md"
    }
  },
  {
    test: /^skill:.*:(max_lines|min_lines|canonical_sections)$/,
    metadata: {
      severity: "warning",
      summary: "Stage skill quality guardrail check.",
      fix: "Tune generated stage skill content and re-run `cclaw sync`.",
      actionGroup: "sync",
      docRef: "README.md"
    }
  },
  {
    test: /^capability:required:/,
    metadata: {
      severity: "error",
      summary: "Required runtime tooling availability check.",
      fix: "Install the missing required tool and re-run `cclaw doctor`.",
      actionGroup: "user-action",
      docRef: "README.md"
    }
  },
  {
    test: /^(dir:|command:|utility_command:|stage_command:|skill:|utility_skill:|agent:|harness_tool_ref:|harness_ref:|stage_examples_ref:|doctor_ref:)/,
    metadata: {
      severity: "error",
      summary: "Generated runtime surface presence check.",
      fix: "Run `cclaw sync` to safely regenerate generated runtime files, then re-run doctor.",
      actionGroup: "sync",
      docRef: "README.md"
    }
  },
  {
    test: /^(hook:|hooks:|lifecycle:|git_hooks:)/,
    metadata: {
      severity: "error",
      summary: "Hook wiring and lifecycle integration check.",
      fix: "Run `cclaw sync` to regenerate hook/plugin wiring; if the check still fails, validate harness config and permissions.",
      actionGroup: "sync",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^(shim:|agents:cclaw_block|rules:cursor:)/,
    metadata: {
      severity: "error",
      summary: "Harness shim and routing file consistency check.",
      fix: "Run `cclaw sync` to regenerate harness adapters; confirm enabled harness list if it remains failing.",
      actionGroup: "sync",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^(flow_state:|state:|gates:)/,
    metadata: {
      severity: "error",
      summary: "Flow state and gate evidence consistency check.",
      fix: "Repair the named stage artifacts/gate evidence, then run `cclaw doctor --reconcile-gates --explain` to refresh derived gate status only.",
      actionGroup: "stage-work",
      docRef: ref("config.md")
    }
  },
  {
    test: /^(knowledge:|artifacts:|runs:)/,
    metadata: {
      severity: "error",
      summary: "Knowledge and artifact runtime integrity check.",
      fix: "Restore the missing `.cclaw/` runtime file or run `cclaw sync` when it is generated surface drift.",
      actionGroup: "sync",
      docRef: "README.md"
    }
  },
  {
    test: /^(meta_skill:|protocol:|stage_skill:)/,
    metadata: {
      severity: "error",
      summary: "Routing skill and protocol integrity check.",
      fix: "Run `cclaw sync` to regenerate runtime skills, then re-run doctor.",
      actionGroup: "sync",
      docRef: ref("harnesses.md")
    }
  },
  {
    // `reference:*` checks (flow-map.md and similar overview documents)
    // are useful to detect drift from the generated baseline, but they
    // document the surface rather than gate it. A missing section here
    // means the map is out of date, not that a runtime contract is
    // broken — so they report as a warning instead of hard-failing
    // doctor / CI. `cclaw sync` rewrites the file.
    test: /^reference:/,
    metadata: {
      severity: "warning",
      summary: "Reference/overview doc integrity (non-blocking).",
      fix: "Run `cclaw sync` to regenerate the reference surface from the canonical source.",
      actionGroup: "sync",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^harness:reality:/,
    metadata: {
      severity: "info",
      summary: "Harness reality label for dispatch/proof support.",
      fix: "No action required; use this label to interpret native/generic/role-switch proof requirements.",
      actionGroup: "informational",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^delegation:/,
    metadata: {
      severity: "error",
      summary: "Mandatory delegation completion check.",
      fix: "Run the named mandatory agent, record dispatch proof/evidenceRefs, or explicitly waive it with a user-visible rationale.",
      actionGroup: "user-action",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^trace:/,
    metadata: {
      severity: "error",
      summary: "Cross-artifact traceability integrity check.",
      fix: "Repair criterion/task/test ID mappings across spec, plan, and TDD artifacts, then re-run doctor.",
      actionGroup: "stage-work",
      docRef: "README.md"
    }
  },
  {
    test: /^(config:|rules:policy_schema|language_rule_pack:|gitignore:|git:)/,
    metadata: {
      severity: "error",
      summary: "Config or policy schema consistency check.",
      fix: "Fix config/rules drift, then run `cclaw sync` and re-run doctor.",
      actionGroup: "user-action",
      docRef: ref("config.md")
    }
  }
];

export function doctorCheckMetadata(checkName: string): DoctorCheckMetadata {
  for (const rule of RULES) {
    if (rule.test.test(checkName)) {
      return { ...rule.metadata };
    }
  }
  return {
    severity: "warning",
    summary: "Unclassified doctor check.",
    fix: "Report this check name to cclaw maintainers so doctor-registry can classify it explicitly.",
    actionGroup: "informational",
    docRef: "README.md"
  };
}

