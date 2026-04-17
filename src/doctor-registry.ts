import { DOCTOR_REFERENCE_DIR } from "./content/doctor-references.js";

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
  return `${DOCTOR_REFERENCE_DIR}/${fileName}`;
}

const RULES: DoctorRegistryRule[] = [
  {
    test: /^gates:reconcile:writeback$/,
    metadata: {
      severity: "info",
      summary: "Gate reconciliation status update.",
      fix: "No action required unless subsequent gate checks fail.",
      docRef: ref("state-and-gates.md")
    }
  },
  {
    test: /^warning:/,
    metadata: {
      severity: "warning",
      summary: "Advisory signal; runtime can continue with caution.",
      fix: "Address when possible to prevent future drift or degraded behavior.",
      docRef: ref("README.md")
    }
  },
  {
    test: /^skill:.*:(max_lines|min_lines|canonical_sections)$/,
    metadata: {
      severity: "warning",
      summary: "Stage skill quality guardrail check.",
      fix: "Tune generated stage skill content and re-run `cclaw sync`.",
      docRef: ref("runtime-layout.md")
    }
  },
  {
    test: /^capability:runtime:json_parser$/,
    metadata: {
      severity: "warning",
      summary: "Optional JSON fallback parser availability.",
      fix: "Install at least one of `python3` or `jq` for resilient fallback parsing.",
      docRef: ref("tooling-capabilities.md")
    }
  },
  {
    test: /^capability:required:/,
    metadata: {
      severity: "error",
      summary: "Required runtime tooling availability check.",
      fix: "Install the missing required tool and re-run `cclaw doctor`.",
      docRef: ref("tooling-capabilities.md")
    }
  },
  {
    test: /^(dir:|command:|utility_command:|skill:|utility_skill:|agent:|harness_tool_ref:|harness_ref:|stage_examples_ref:|doctor_ref:)/,
    metadata: {
      severity: "error",
      summary: "Generated runtime surface presence check.",
      fix: "Run `cclaw sync` to regenerate runtime files, then re-run doctor.",
      docRef: ref("runtime-layout.md")
    }
  },
  {
    test: /^(hook:|lifecycle:|git_hooks:)/,
    metadata: {
      severity: "error",
      summary: "Hook wiring and lifecycle integration check.",
      fix: "Repair hook/plugin wiring (usually via `cclaw sync`) and validate harness config.",
      docRef: ref("hooks-and-lifecycle.md")
    }
  },
  {
    test: /^(shim:|agents:cclaw_block|rules:cursor:workflow)/,
    metadata: {
      severity: "error",
      summary: "Harness shim and routing file consistency check.",
      fix: "Regenerate harness adapters via `cclaw sync`; confirm enabled harness list.",
      docRef: ref("harness-and-routing.md")
    }
  },
  {
    test: /^(flow_state:|state:|contexts:|gates:)/,
    metadata: {
      severity: "error",
      summary: "Flow state and gate evidence consistency check.",
      fix: "Repair flow-state artifacts and gate evidence, then run `cclaw doctor --reconcile-gates`.",
      docRef: ref("state-and-gates.md")
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
    severity: "warning",
    summary: "Unclassified doctor check.",
    fix: "Review the check details and add a matching rule in doctor-registry when this check should be severity-scoped.",
    docRef: ref("README.md")
  };
}

