export interface ReferencePattern {
  id: string;
  fileName: string;
  title: string;
  triggers: string[];
  body: string;
}

const AUTH_FLOW = `# Pattern — authentication flow change

## When to use

The user asks for "login", "OAuth", "passkeys", "MFA", "SSO", "session lifetime", or anything that touches \`req.user\` derivation.

## Pre-flight checklist

1. Read the existing auth entry points (route handlers, middleware, session store).
2. Identify which trust boundary changes (browser ↔ edge, edge ↔ service, service ↔ identity provider).
3. Identify whether the change is additive (new flow) or replacing (rewriting an existing flow). Replacement is always large/risky.
4. Pull threat-model assumptions from prior shipped slugs (\`grep refines: …\` on auth-related plans).

## AC shape

- AC-1: happy path — user successfully authenticates and \`req.user\` carries the expected claims.
- AC-2: rejection paths — invalid credentials / expired tokens / replay attempts each return the documented error and do not leak information.
- AC-3: session lifetime — sessions expire on the documented schedule and refresh tokens behave correctly.
- AC-4: telemetry — auth events emit the configured audit logs with the correct fields.

## Specialists to invoke

- \`design\` (Phase 4 — Decisions, Phase 5 — Pre-mortem) — always, even if the change feels additive. Record auth/secrets/wire-format decisions as inline D-N rows in \`plan.md\`.
- \`security-reviewer\` mode=\`threat-model\` — always.
- \`security-reviewer\` mode=\`sensitive-change\` — at code-review time on the diff.
- \`reviewer\` mode=\`adversarial\` — at least once, looking for the case the author is biased to miss.

## Common pitfalls

- Implementing OAuth without state / PKCE.
- Treating "user is logged in" as a single boolean — actual auth has tiers (anonymous / authenticated / MFA-verified / device-trusted).
- Forgetting the migration path for users who are mid-session when the flow changes.
`;

const SECURITY_HARDENING = `# Pattern — security hardening

## When to use

The user asks to "harden", "fix CVE", "rotate keys", "tighten CSP", "patch SSRF", "fix prototype pollution", or follows an incident.

## Pre-flight checklist

1. Identify the threat the hardening prevents. Citing the CVE / advisory / incident note is mandatory.
2. Identify whether the change is reactive (close an open finding) or proactive (defence in depth). Tag the plan accordingly.
3. Confirm the rollout cannot itself break the system: a hardening that fails closed in production is worse than a slower fix.

## AC shape

- AC-1: the threat path is blocked; verified by a regression test that exercises the threat.
- AC-2: the regression guard runs in CI on every push.
- AC-3: documentation / runbook updated to reflect the new posture.

## Specialists to invoke

- \`security-reviewer\` mode=\`threat-model\` always.
- \`security-reviewer\` mode=\`sensitive-change\` on the diff.
- \`reviewer\` mode=\`adversarial\` — second pair of eyes on the regression test (does it actually exercise the threat?).

## Common pitfalls

- Closing the finding without the regression guard. Without the guard, the next refactor reopens it.
- Adding a deny-list when an allow-list would do.
- Using a string-matching guard for a structural problem (e.g. blocking SSRF by checking the URL string instead of resolving DNS first).
`;

export const REFERENCE_PATTERNS: ReferencePattern[] = [
  { id: "auth-flow", fileName: "auth-flow.md", title: "Authentication flow", triggers: ["login", "OAuth", "SSO", "MFA", "passkey", "auth"], body: AUTH_FLOW },
  { id: "security-hardening", fileName: "security-hardening.md", title: "Security hardening", triggers: ["CVE", "security", "harden", "patch", "SSRF", "XSS"], body: SECURITY_HARDENING }
];

export const REFERENCE_PATTERNS_INDEX = `# .cclaw/lib/patterns/

Two reference patterns the orchestrator pulls from before authoring a plan when the task touches a sensitive surface. Each pattern declares its trigger keywords, the pre-flight checklist, the AC shape, the specialists to invoke, and the common pitfalls.

> **v8.12 cleanup.** Earlier versions shipped 8 patterns (api-endpoint, ui-component, schema-migration, perf-fix, refactor, doc-rewrite, plus the two below). The 6 deleted patterns had **zero explicit citations** in the orchestrator / specialist contracts — they were "browse if relevant" optional reading that the spec never directed agents to consult by name. They are gone in v8.12; specialists rely on the ac-author's own pre-flight read of the touch surface instead. Users who want the deleted patterns back can opt into \`legacy-artifacts: true\` in \`.cclaw/config.yaml\`.

| pattern | triggers |
| --- | --- |
${REFERENCE_PATTERNS.map((p) => `| [\`${p.fileName}\`](./${p.fileName}) | ${p.triggers.join(", ")} |`).join("\n")}

When a task hits both patterns (auth + hardening), the orchestrator opens both files and merges their AC shape sections. Auth-flow is cited from \`security-reviewer.md\` Phase 2; security-hardening is cited from \`security-reviewer.md\` Phase 3.
`;
