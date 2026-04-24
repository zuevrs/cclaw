export type DoctorSeverity = "error" | "warning" | "info";

export interface DoctorCheckMetadata {
  severity: DoctorSeverity;
  summary: string;
  fix: string;
  docRef?: string;
}

interface DoctorRegistryRule {
  test: RegExp;
  metadata: DoctorCheckMetadata;
}

function ref(fileName: string): string {
  return `docs/${fileName}`;
}

const RULES: DoctorRegistryRule[] = [
  {
    test: /^gates:reconcile:writeback$/,
    metadata: {
      severity: "info",
      summary: "Gate reconciliation status update.",
      fix: "No action required unless subsequent gate checks fail.",
      docRef: ref("config.md")
    }
  },
  {
    test: /^warning:/,
    metadata: {
      severity: "warning",
      summary: "Advisory signal; runtime can continue with caution.",
      fix: "Address when possible to prevent future drift or degraded behavior.",
      docRef: "README.md"
    }
  },
  {
    test: /^skill:.*:(max_lines|min_lines|canonical_sections)$/,
    metadata: {
      severity: "warning",
      summary: "Stage skill quality guardrail check.",
      fix: "Tune generated stage skill content and re-run `cclaw sync`.",
      docRef: "README.md"
    }
  },
  {
    test: /^capability:required:/,
    metadata: {
      severity: "error",
      summary: "Required runtime tooling availability check.",
      fix: "Install the missing required tool and re-run `cclaw doctor`.",
      docRef: "README.md"
    }
  },
  {
    test: /^(dir:|command:|utility_command:|skill:|utility_skill:|agent:|harness_tool_ref:|harness_ref:|stage_examples_ref:|doctor_ref:)/,
    metadata: {
      severity: "error",
      summary: "Generated runtime surface presence check.",
      fix: "Run `cclaw sync` to regenerate runtime files, then re-run doctor.",
      docRef: "README.md"
    }
  },
  {
    test: /^(hook:|hooks:|lifecycle:|git_hooks:)/,
    metadata: {
      severity: "error",
      summary: "Hook wiring and lifecycle integration check.",
      fix: "Repair hook/plugin wiring (usually via `cclaw sync`) and validate harness config.",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^(shim:|agents:cclaw_block|rules:cursor:)/,
    metadata: {
      severity: "error",
      summary: "Harness shim and routing file consistency check.",
      fix: "Regenerate harness adapters via `cclaw sync`; confirm enabled harness list.",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^(flow_state:|state:|contexts:|gates:)/,
    metadata: {
      severity: "error",
      summary: "Flow state and gate evidence consistency check.",
      fix: "Repair flow-state artifacts and gate evidence, then run `cclaw doctor --reconcile-gates`.",
      docRef: ref("config.md")
    }
  },
  {
    test: /^(knowledge:|artifacts:|runs:)/,
    metadata: {
      severity: "error",
      summary: "Knowledge and artifact runtime integrity check.",
      fix: "Restore missing runtime files under `.cclaw/` or re-run `cclaw sync`.",
      docRef: "README.md"
    }
  },
  {
    test: /^(meta_skill:|protocol:|stage_skill:|context_mode:)/,
    metadata: {
      severity: "error",
      summary: "Routing skill and protocol integrity check.",
      fix: "Regenerate runtime references and skills via `cclaw sync`, then re-run doctor.",
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
      fix: "Run `cclaw sync` to regenerate the reference doc from the canonical source.",
      docRef: ref("harnesses.md")
    }
  },
  {
    test: /^delegation:/,
    metadata: {
      severity: "error",
      summary: "Mandatory delegation completion check.",
      fix: "Complete or explicitly waive missing mandatory delegations in delegation log.",
      docRef: ref("delegation-and-preamble.md")
    }
  },
  {
    test: /^trace:/,
    metadata: {
      severity: "error",
      summary: "Cross-artifact traceability integrity check.",
      fix: "Restore criterion/task/test ID mappings across spec, plan, and tdd artifacts.",
      docRef: ref("traceability.md")
    }
  },
  {
    test: /^(config:|rules:policy_schema|language_rule_pack:|gitignore:|git:)/,
    metadata: {
      severity: "error",
      summary: "Config or policy schema consistency check.",
      fix: "Fix config/rules drift, then run `cclaw sync` and re-run doctor.",
      docRef: ref("config-and-policy.md")
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
    severity: "error",
    summary: "Unclassified doctor check.",
    fix: "Report this check name to cclaw maintainers so doctor-registry can classify it explicitly.",
    docRef: "README.md"
  };
}

