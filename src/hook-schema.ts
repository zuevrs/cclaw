import claudeHooksSchema from "./hook-schemas/claude-hooks.v1.json" with { type: "json" };
import codexHooksSchema from "./hook-schemas/codex-hooks.v1.json" with { type: "json" };
import cursorHooksSchema from "./hook-schemas/cursor-hooks.v1.json" with { type: "json" };

export type HookSchemaHarness = "claude" | "cursor" | "codex";

interface HookSchemaDescriptor {
  harness: HookSchemaHarness;
  schemaVersion: number;
  requiredEvents: string[];
}

export interface HookSchemaValidationResult {
  ok: boolean;
  errors: string[];
}

const SCHEMA_MAP: Record<HookSchemaHarness, HookSchemaDescriptor> = {
  claude: claudeHooksSchema as HookSchemaDescriptor,
  cursor: cursorHooksSchema as HookSchemaDescriptor,
  codex: codexHooksSchema as HookSchemaDescriptor
};

function toObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function validateHookDocument(
  harness: HookSchemaHarness,
  document: unknown
): HookSchemaValidationResult {
  const descriptor = SCHEMA_MAP[harness];
  const root = toObject(document);
  if (!root) {
    return { ok: false, errors: ["hook document must be a JSON object"] };
  }

  const errors: string[] = [];
  const version = root.cclawHookSchemaVersion;
  if (version !== descriptor.schemaVersion) {
    errors.push(
      `expected cclawHookSchemaVersion=${descriptor.schemaVersion}, got ${JSON.stringify(version)}`
    );
  }

  if (harness === "cursor" && root.version !== 1) {
    errors.push(`cursor hooks require version=1, got ${JSON.stringify(root.version)}`);
  }

  const hooks = toObject(root.hooks);
  if (!hooks) {
    errors.push("missing hooks object");
  } else {
    for (const eventName of descriptor.requiredEvents) {
      const eventValue = hooks[eventName];
      if (!Array.isArray(eventValue) || eventValue.length === 0) {
        errors.push(`missing required event array "${eventName}"`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
