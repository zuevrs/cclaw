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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function validateCursorEvent(
  eventName: string,
  eventEntries: unknown[],
  errors: string[]
): void {
  for (let index = 0; index < eventEntries.length; index += 1) {
    const rawEntry = eventEntries[index];
    const entry = toObject(rawEntry);
    if (!entry) {
      errors.push(`hooks.${eventName}[${index}] must be an object`);
      continue;
    }
    if (!isNonEmptyString(entry.command)) {
      errors.push(`hooks.${eventName}[${index}].command must be a non-empty string`);
    }
    if (entry.matcher !== undefined && typeof entry.matcher !== "string") {
      errors.push(`hooks.${eventName}[${index}].matcher must be a string when present`);
    }
    if (entry.timeout !== undefined && !isPositiveNumber(entry.timeout)) {
      errors.push(`hooks.${eventName}[${index}].timeout must be a positive number when present`);
    }
  }
}

function validateClaudeLikeEvent(
  eventName: string,
  eventEntries: unknown[],
  errors: string[]
): void {
  for (let index = 0; index < eventEntries.length; index += 1) {
    const rawEntry = eventEntries[index];
    const entry = toObject(rawEntry);
    if (!entry) {
      errors.push(`hooks.${eventName}[${index}] must be an object`);
      continue;
    }
    if (entry.matcher !== undefined && typeof entry.matcher !== "string") {
      errors.push(`hooks.${eventName}[${index}].matcher must be a string when present`);
    }
    if (!Array.isArray(entry.hooks) || entry.hooks.length === 0) {
      errors.push(`hooks.${eventName}[${index}].hooks must be a non-empty array`);
      continue;
    }
    for (let hookIndex = 0; hookIndex < entry.hooks.length; hookIndex += 1) {
      const rawHook = entry.hooks[hookIndex];
      const hook = toObject(rawHook);
      if (!hook) {
        errors.push(`hooks.${eventName}[${index}].hooks[${hookIndex}] must be an object`);
        continue;
      }
      if (hook.type !== "command") {
        errors.push(`hooks.${eventName}[${index}].hooks[${hookIndex}].type must be "command"`);
      }
      if (!isNonEmptyString(hook.command)) {
        errors.push(`hooks.${eventName}[${index}].hooks[${hookIndex}].command must be a non-empty string`);
      }
      if (hook.timeout !== undefined && !isPositiveNumber(hook.timeout)) {
        errors.push(
          `hooks.${eventName}[${index}].hooks[${hookIndex}].timeout must be a positive number when present`
        );
      }
    }
  }
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
        continue;
      }
      if (harness === "cursor") {
        validateCursorEvent(eventName, eventValue, errors);
      } else {
        validateClaudeLikeEvent(eventName, eventValue, errors);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors
  };
}
