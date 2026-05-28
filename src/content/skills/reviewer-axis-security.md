---
name: reviewer-axis-security
trigger: gated reviewer axis. Auto-loads on every reviewer dispatch when `triage.securityFlag == true` (or `plan.md` frontmatter `security_flag: true`). The reviewer still walks a lightweight five-item threat-model on non-flagged slugs; this skill carries the deep rubric + sensitive-change protocol absorbed from the retired `security-reviewer` specialist.
---

# Skill: reviewer-axis-security

Full threat-model checklist, sensitive-change protocol, hard rules, edge cases, and common pitfalls for the reviewer's `security` axis (absorbed from `security-reviewer`). Lifted out of `reviewer.ts` — the prompt now carries only a 5-line stub pointing here.

The dedicated `security-reviewer` specialist is retired; its threat-model + sensitive-change protocol absorbs into the reviewer's `security` axis. Run the threat-model checklist + sensitive-change rules below as part of the standard fourteen-axis pass on every iteration. When the dispatch envelope's slug carries `security_flag: true` in `plan.md` frontmatter (or the orchestrator flagged `security_flag: true` in the dispatch envelope) — typically because the diff touches authn / authz / secrets / supply chain / data exposure / sensitive compliance surfaces — give the security axis **extra emphasis**: walk every threat-model item even when the diff looks small, run the sensitive-change rules verbatim, and prefer `required` severity for genuinely unresolved threat-model gaps.

## When to use

Pinned to the reviewer's dispatch envelope when `triage.securityFlag == true` OR `plan.md` frontmatter carries `security_flag: true` OR the orchestrator's dispatch envelope sets `securityFlag: true`. The skill body carries the deep threat-model checklist plus the sensitive-change protocol (OAuth flows, external integrations, migrations on user data, runtime deps, logging / analytics changes). The reviewer's prompt still walks the lightweight five-item threat-model on every iteration regardless of the flag; this skill carries the **deeper** rubric that fires when the flag is set.

## When NOT to apply

- `security_flag` is unset AND `triage.securityFlag` is false AND the diff is purely UI / docs / infrastructure with no auth / secrets / supply-chain / PII surface — the reviewer's lightweight threat-model row (in the per-axis checklist) is sufficient; this skill is not pinned. Mark all five threat-model items as `n/a` with one-line justification in the iteration block.
- The diff was already shipped and re-reviewed in a prior slug — pre-existing threat paths are noted as severity=`fyi` and a separate hardening slug is recommended; do not re-litigate.
- A `text-review` mode reviewer dispatch (the diff is markdown only) — the security axis still fires structurally, but the threat-model checklist applies to the AC text rather than to code; the deeper protocol below is largely n/a.

## Process

**Threat-model checklist (mandatory every iteration; cite for each):**

1. **Authentication** — does the diff create a new principal type, new session token, new auth path? Are existing protections still applied?
2. **Authorization** — does the diff add a new resource or action? What policy decides access? Is it tested?
3. **Secrets** — any committed credentials, API keys, signing keys, env files? Any new secret material that lacks a rotation story?
4. **Supply chain** — new third-party dependencies? Pinned to a known version? Provenance (Sigstore / npm signing / similar) verified?
5. **Data exposure** — does the diff log, transmit, or store user data that previously was not? Are PII / PCI / HIPAA scopes respected?

For each item, write `ok` / `flag` / `n/a` with a one-line justification. On every iteration the iteration block contains a threat-model row in the per-axis checklist. On `security_flag: true` slugs, also append a dedicated `### Threat-model checklist` block (the table format below) under the iteration's per-axis pass section so the user sees the explicit per-surface attestation:

```markdown
### Threat-model checklist

| surface | result | note |
| --- | --- | --- |
| Authentication | ok | No new principal type; reuses cached claim from useCurrentUser. |
| Authorization | flag | The view-email permission is read from the cached claim with 60s TTL; permission revoke is delayed up to 60s. Acceptable per D-1. |
| Secrets | ok | No new secret material. |
| Supply chain | ok | No new dependencies. |
| Data exposure | flag | Tooltip exposes email to users with view-email; analytics events must not include the email. Verified at src/lib/analytics.ts:44. |
```

A threat-model `flag` is a **documented trade-off**, not automatically a finding — it surfaces the surface and notes the rationale. A `flag` becomes a `required`-severity finding (axis=security) when there is no covering D-N decision (inline in `plan.md`'s `## Decisions`) accepting the risk. A `flag` that the architect already addressed via a D-N is fine; do NOT raise it twice. Conflating a `flag` (documented trade-off) with a `critical`/`required`-severity finding (which blocks ship) is the most common security-axis miscoding — read the related D-N before scoring.

**Sensitive-change rules (when the diff touches the named surface):**

- **Authentication / OAuth flows** — check redirect URIs, state parameter handling, PKCE where applicable, session fixation. A new OAuth flow without state parameter handling is `critical` (axis=security); session fixation potential is `required`.
- **New external integrations** — check TLS verification, response validation, retry/backoff so the integration cannot be used to amplify abuse. Missing TLS verification is `critical`; missing retry/backoff is `required`.
- **Database migrations on user data** — check that the migration is rollback-safe and that no dropped column held secrets. A non-rollback-safe migration on user data is `required` (axis=correctness + security); a dropped column that held secrets is `critical` (axis=security).
- **New runtime dependencies** — every new dependency requires a one-line provenance justification in plan.md's D-N or the diff's commit body. Unjustified additions are `required` (axis=security); known-CVE dependencies are `critical`.
- **Logging / analytics changes** — verify the payload does not include rendered user content that may contain PII (tooltip text, form input, query strings). A logging change that leaks email / phone / SSN is `critical`; one that leaks usernames or display names is `required` (depends on tenant model).

**`security_flag` field — compound learnings hook:**

If you raise any `security`-severity finding (`critical` or `required`), set `plan.md` frontmatter `security_flag: true`. The compound quality gate uses this field to capture the slug as a security-flagged shipped learning even if other signals are absent. Keep the field for back-compat; the dispatch behaviour (separate sub-agent) is gone but the audit signal stays.

## Hard rules

- Never claim "no security impact" without actually checking the five threat-model items.
- Findings must reference real files in the diff. Do not generate generic OWASP Top-10 lectures.
- If you find an active credential, secret, or PII leak in the diff: severity is `critical` (axis=security); the change must not ship until it is resolved.
- Do not modify the code yourself. Hand fix-only work back to builder.
- **Iteration cap.** The same hard cap of 5 reviews applies (no separate cap for security work; a single reviewer iteration counter).

## Common rationalizations

Cross-cutting rows live in `.cclaw/lib/anti-rationalizations.md`; the rows below are security-axis-specific:

| rationalization | rebuttal |
| --- | --- |
| "But the diff is purely UI — there's no security impact." | Mark all five threat-model items as `n/a` with one-line justification each. Do NOT skip the row. UI diffs that render user content into the DOM can still leak via XSS; UI diffs that read from cached claims can still expose data they shouldn't. The five-row attestation is mandatory regardless of "feels-small" framing. |
| "But the architect's D-N already covers this risk — I'm raising a duplicate finding." | If the D-N covers the risk, the threat-model row is a `flag` with the D-N citation — not a finding. Conflating the two is the most common security-axis miscoding. Re-read the D-N before scoring; the F-N column should be empty when the trade-off is documented. |
| "But the dependency I added is well-known — no provenance check needed." | Every new dependency requires a one-line provenance justification in plan.md's D-N or the diff's commit body. "Well-known" is not provenance. Cite the npm package's signed releases, Sigstore attestation, or pin the version with a hash. Unjustified additions are severity=required (axis=security). |

## Common pitfalls

- Generic OWASP-Top-10 commentary without a concrete file:line. Refuse to ship the finding.
- Marking everything `ok` because the diff "feels small". The five threat-model items are mandatory.
- Skipping the supply-chain check on TS / JS projects with package.json changes.
- Conflating a threat-model `flag` (documented trade-off) with a `critical`/`required`-severity finding (which blocks ship).
- Letting the lightweight five-item attestation (in the per-axis checklist) substitute for the deeper sensitive-change protocol on a `security_flag: true` slug — the deeper protocol is mandatory when the flag is set.

## Edge cases

- **Diff is purely UI / docs.** Mark all five threat-model items as `n/a` with one-line justification each; do not skip the row.
- **You disagree with architect's D-N on the auth model** (inline in `plan.md`). Raise it as a security-severity finding; do not silently accept.
- **The diff has a credential in cleartext.** Severity `critical` immediately (axis=security); surface the credential rotation requirement in the finding.
- **The threat path is in production already (pre-existing).** Note it as severity `fyi` and recommend a separate hardening slug. Do not block the current ship for pre-existing issues unless they are introduced or exposed by the diff.
