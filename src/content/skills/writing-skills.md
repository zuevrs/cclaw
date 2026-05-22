---
name: writing-skills
trigger: task:add-skill OR before:edit src/content/skills/ OR before:edit src/content/skills.ts; stages plan / build (always when an agent is about to author a new cclaw skill).
---

# Skill: writing-skills

A meta-skill teaching how to write, register, and validate a new cclaw skill. It fires when an agent — whether the user, the builder, or any downstream sub-agent — is about to add or edit content under `src/content/skills/` or `src/content/skills.ts`. Sourced from obra-superpowers' `writing-skills` namesake, adapted to cclaw's installer layout, skill schema, and test-tripwire culture.

Three iron rules govern this meta-skill:

1. **A new skill is justified only when the pattern recurs across ≥3 specialist surfaces OR ≥3 distinct dispatches.** Below that, the content belongs inline in the specialist prompt (one surface) or in a runbook (one operation, lifted on-demand). The taxonomy section below names the three lanes.
2. **Validate with the RED → GREEN → REFACTOR cycle.** RED: dispatch a baseline subagent on a relevant task and confirm it *fails* the discipline the skill would teach. GREEN: write the skill body, register it, and re-dispatch — confirm the subagent now passes. REFACTOR: re-read the body adversarially, plug the loopholes a rationalising subagent could find, and tighten the trigger / stages metadata so the skill auto-loads only when it should.
3. **No new skill ships without anchor tests.** Every cclaw skill has a corresponding `tests/unit/v<version>-*.test.ts` row that asserts (a) the file exists under `src/content/skills/`, (b) the id is registered in `AUTO_TRIGGER_SKILLS`, and (c) at least one specialist prompt collapses to a one-line anchor pointing at the skill. Skip the test row and the next refactor pass deletes the skill quietly.

## Taxonomy — when to write a skill vs a runbook vs an inline prompt block

These three lanes are mutually exclusive; pick exactly one before writing a single line of content.

| Lane | Use when | Lives at | Auto-load? |
| --- | --- | --- | --- |
| **Inline specialist prompt block** | The discipline applies to **one** specialist's contract and nowhere else (e.g. the architect's Frame-phase ambiguity tagging). | `src/content/specialist-prompts/<id>.ts` inside the body template literal. | Yes — always loaded when that specialist dispatches. |
| **Runbook** (on-demand or installed) | The discipline is a **multi-step procedure** the orchestrator OR a specialist opens on demand (e.g. `runbooks/patch-mode.md`, `runbooks/research-mode.md`). Length warrants a separate file but the content is *operational* (do step A, then B, then C). | `src/content/runbooks/<name>.md` + registration in `runbooks-on-demand.ts` (if on-demand) OR `runbooks/<name>.md` next to the install tree (always-shipped). | Opened by an explicit `Required-second-read:` line on a dispatch envelope OR by the orchestrator's on-demand-runbooks index. |
| **Skill** (this skill teaches this lane) | The discipline is a **cross-cutting rule** that ≥3 distinct specialist surfaces share OR ≥3 distinct dispatch surfaces share (e.g. `tdd-and-verification` fires for builder + reviewer + ship; `anti-slop` fires for every code-modifying step). | `src/content/skills/<id>.md` + registration in `src/content/skills.ts > AUTO_TRIGGER_SKILLS`. | Auto-applied via the `triggers` / `stages` metadata; rendered into every dispatch envelope whose stage matches. |

If the answer to "where does this live?" is uncertain after reading the taxonomy, **do not write a skill yet** — write the inline prompt block first; promote to a runbook when a second specialist needs the same content; promote to a skill only when the third specialist needs it. Premature promotion to a skill bloats every dispatch envelope on every stage in scope.

## Frontmatter schema (mandatory)

Every cclaw skill body MUST start with a YAML frontmatter block. The schema is intentionally minimal — registration in `skills.ts` carries the structured metadata; the frontmatter is human-readable provenance.

```yaml
---
name: <id matching the AutoTriggerSkill.id in skills.ts; lowercase + hyphens only>
trigger: <one-line plain-English summary of the auto-trigger conditions; mirrors the structured `triggers` array in skills.ts>
---
```

The frontmatter is **read-only at runtime** — the installer copies the body byte-for-byte into `.cclaw/lib/skills/<id>.md`. Drift between `name:` and the registered `id:` is a structural failure; the `v810-install-tui.test.ts` suite asserts file presence by `fileName`, and the `v819-skill-windowing.test.ts` suite asserts the registered id matches the bullet rendered in each specialist's auto-trigger block.

## Body section template

A canonical cclaw skill body carries these sections in order. Some are mandatory for every skill (M); some are conditional (C).

1. **`# Skill: <id>`** (M) — top-level heading; matches the frontmatter `name:` exactly.
2. **One-paragraph orientation** (M) — what discipline does this skill teach, and what's the single biggest failure mode it prevents? Cite the source pattern (obra / oh-my-claudecode / everyinc / addyosmani / cclaw-internal) so the next reader can trace the discipline back to its origin.
3. **`## When to use`** (M) — name the specialist(s), stage(s), and dispatch-surface(s) where the skill activates. Mirror the structured `triggers` + `stages` arrays in `skills.ts`. This section is the cite-back surface every test row reads.
4. **`## When NOT to apply`** (M) — the inverse of §3. Each bullet is a concrete carve-out ("you actually changed code between two runs of the same command"); never write "always apply" or "never skip". Skills without carve-outs over-trigger and bloat every envelope.
5. **`## Hard rules`** or **`## Two iron rules`** or named rule headers (M) — the rules the skill teaches, in declarative form. ≤7 rules per skill (use the **3-5 cap** as a default; lift to 7 only when the discipline structurally needs it — e.g. `tdd-and-verification` carries the full RED → GREEN → REFACTOR + verification-loop + refactor-safety triad). More than 7 rules means the skill is doing too much — split it.
6. **`## Mode-flavoured shape`** (C) — when the same skill applies to ≥2 specialists with slightly different framings (e.g. `pre-commitment-predictions` flavours predictions per critic / plan-critic / qa-runner mode), this section enumerates the per-mode shape. Skip when the skill is mode-uniform.
7. **`## Rationalization rebuttals`** or **`## Anti-rationalization`** (M) — a 2-column table mapping common rationalisations to truths. Adversarial readers ALWAYS find a way around a rule unless the rebuttal is pre-emptive. ≥5 rebuttals; one per failure mode the REFACTOR pass surfaced.
8. **`## Cross-references`** (C; recommended) — pointers to sibling skills / runbooks / specialist sections so the discipline composes with its neighbours. Useful when a reader is debugging *which* skill applies to a borderline case.

The exact section names are not load-bearing — `tdd-and-verification` uses `## RED → GREEN → REFACTOR`, `## Verification loop`, `## Refactor safety`; `anti-slop` uses `## Two iron rules`. What matters is that every skill carries at least: orientation paragraph, when-to-use, when-NOT-to-apply, rules, anti-rationalisation table.

## Registration in `skills.ts`

Every skill MUST be appended to the `AUTO_TRIGGER_SKILLS` array in `src/content/skills.ts`. The registration block is the source of truth for the structured metadata; the frontmatter is human-readable provenance.

```typescript
{
  id: "<lowercase + hyphens only>",
  fileName: "<id>.md",
  description:
    "<2-4 sentence description; first sentence names the discipline; subsequent sentences name the triggers / stages / why this skill exists separately from siblings>",
  triggers: [
    "task:<task-shape>",
    "specialist:<id>",
    "stage:<stage>",
    "before:<event>",
    "after:<event>",
    "<custom-pattern>:<value>"
  ],
  stages: ["<one or more of triage / plan / build / qa / review / ship / compound / always>"],
  body: readSkill("<id>.md")
}
```

Schema notes:

- `id` MUST match the frontmatter `name:` field; the file MUST be at `src/content/skills/<id>.md`.
- `description` is read by the `learnings-research` helper + the `.cclaw/lib/skills-index.md` install artifact + the specialist anti-slop / completeness audit; write it as if it were a one-paragraph essay explaining when the skill fires and what failure mode it prevents.
- `triggers` is a string array; entries are pattern strings the orchestrator and specialists scan against the active dispatch context. Use the same vocabulary as siblings (`specialist:<id>`, `stage:<stage>`, `before:<event>`, `diff:<file-pattern>`, `task:<shape>`).
- `stages` is the load-bearing render filter — `buildAutoTriggerBlock(stage)` skips skills whose stages don't include the rendering stage OR `"always"`. Pick the minimum set; over-broad stages bloat every envelope.
- `gate` (optional) is a predicate `(env: GateEnvelope) => boolean` for skills that should only render when a specific dispatch-envelope flag is set (e.g. `walkDesignQualityAxis: true`). Default-on gates use `(env) => env.<flag> !== false`; default-off gates use `(env) => env.<flag> === true`.

## RED → GREEN → REFACTOR validation cycle

This cycle is the contract for shipping a new cclaw skill. Adapted from obra-superpowers' RED/GREEN/REFACTOR shape; mapped to cclaw's subagent-driven dispatch model.

### RED — confirm the baseline fails the discipline

Before writing the skill body, dispatch a subagent on a representative task **without** the skill registered. The subagent should hit the failure mode the skill is designed to prevent. If the baseline subagent already passes the discipline without the skill, the skill is unnecessary — either the discipline is already taught elsewhere (inline prompt block, sibling skill, runbook) OR the failure mode is theoretical (no evidence it actually fires).

Capture the RED evidence verbatim: the subagent's slim summary, the diff it produced, the specific line(s) that violate the discipline. This evidence is the cite-back surface for the §"When to use" section AND for the test row's RED anchor.

### GREEN — write the skill body, register it, and re-dispatch

Write the skill body (frontmatter + sections per the template above), register the skill in `AUTO_TRIGGER_SKILLS`, then re-dispatch the same subagent on the same representative task. The subagent should now pass the discipline. If it doesn't, the skill body is too vague OR the trigger/stages metadata doesn't load the skill into that dispatch's envelope — fix one or the other and re-run GREEN.

Capture the GREEN evidence verbatim: the subagent's slim summary, the diff it produced, the specific line(s) that now honour the discipline. This evidence is the cite-back surface for the test row's GREEN anchor.

### REFACTOR — close the loopholes

Once GREEN holds on the representative task, **adversarially** re-read the skill body looking for loopholes a rationalising subagent could exploit. Examples of canonical loopholes:

- "The skill says 'always do X' but doesn't name the carve-outs — I'll claim my case is the unlisted carve-out."
- "The skill's §When-to-use cites stage `plan` but my dispatch is `qa` — I'll claim the skill doesn't apply to me."
- "The skill's rule 3 says 'verify' but doesn't say HOW — I'll claim my eye-balled scan is verification."
- "The skill's anti-rationalisation table has 4 entries but my excuse isn't one of them — I'll claim my excuse is allowed."

For each loophole found, tighten the skill body — add the carve-out, broaden the stages array, name the verification path, append the rebuttal to the anti-rationalisation table. Re-dispatch the subagent with the *rationalising* prompt (one that explicitly attempts the loophole) and confirm the subagent still passes. Repeat until the subagent cannot find a loophole on three consecutive rationalising dispatches.

REFACTOR closes when (a) every found loophole is plugged, (b) the anti-rationalisation table has ≥5 entries, (c) the §When-NOT-to-apply section names ≥3 carve-outs.

## Reference patterns (2-3 existing cclaw skills to study)

Cite these as canonical models when authoring a new skill. Each was written to one or more of the RED → GREEN → REFACTOR phases and ships with its tripwire row.

- **`src/content/skills/tdd-and-verification.md`** — gold standard for **cross-specialist disciplines**. Three sibling rules (TDD cycle / verification loop / refactor safety) collapsed into one skill because all three apply at builder + reviewer + ship stages; ceremony-mode-aware (granularity scales with `triage.ceremonyMode`); anti-rationalisation table covers ≥10 excuses. Study the §"When NOT to apply" section: explicit carve-outs for `triage.ceremonyMode == "inline"` AND specific test-naming patterns.
- **`src/content/skills/anti-slop.md`** — gold standard for **rule-density vs scope balance**. Two iron rules (no redundant verification; no environment shims) carry the entire skill; the §"When NOT to apply" enumerates 5 concrete carve-outs (mocks at test boundary; documented `eslint-disable`; different tool after first passed; etc.). Study the structure: short rule body, long carve-outs, deep anti-rationalisation table.
- **`src/content/skills/pre-commitment-predictions.md`** — gold standard for **mode-flavoured cross-specialist disciplines**. Same core discipline (write 3-5 predictions before reading) applies to three specialists (critic / plan-critic / qa-runner); §"Mode-flavoured prediction shape" enumerates the per-mode framing. Study the §"Hard rules" section: numeric caps (3-5, not 2 or 6) with rationale in the anti-rationalisation table.

## Loophole-checking patterns (REFACTOR-phase guide)

Run these adversarial probes after the GREEN dispatch passes. Each probe attempts a canonical loophole; the skill body should close it.

- **"My case is the unlisted carve-out" probe.** Dispatch a rationalising subagent with: *"The skill's §When-NOT-to-apply lists 5 carve-outs; my case is similar to carve-out 3 but technically distinct. Should I apply the skill?"* — the skill body must answer this unambiguously (e.g. "If carve-out 3 doesn't match verbatim, apply the skill; carve-outs are exact-match only").
- **"The trigger doesn't match my dispatch" probe.** Dispatch with: *"The skill's triggers array names `specialist:critic` but I'm a `plan-critic` — should I apply it?"* — the skill body must clarify whether sibling specialists ride the skill OR whether the trigger is exact-match.
- **"The rule is vague on HOW" probe.** Dispatch with: *"The skill says 'verify each prediction's outcome'. My eye-ball scan is verification. Right?"* — the skill body must name the verification path concretely (e.g. "verification = §2-§N detailed walk MUST cite §1 prediction id and outcome enum").
- **"My excuse isn't in the rebuttal table" probe.** Dispatch with: *"The anti-rationalisation table has 7 entries. My excuse is a new one. Does it pass?"* — the rebuttal table's existence is itself the rebuttal ("If your excuse isn't listed, default to applying the skill; the table grows as new excuses appear, not as a permissive whitelist").

A skill body that closes all four probes on its first adversarial pass is REFACTOR-clean. Skills that close ≤2 probes get re-written.

## Anti-rationalization

| Excuse | Reality |
| --- | --- |
| "This is a one-shot pattern; I'll write a skill so the discipline is reusable." | NO. One-shot patterns belong inline in the specialist prompt. The taxonomy gate (≥3 specialist surfaces OR ≥3 distinct dispatches) exists because every registered skill bloats every dispatch envelope on every stage in scope. Wait for the third surface; if it never materialises, the inline block was the right home. |
| "The discipline is obvious; I don't need RED evidence." | NO. RED is the falsifiability anchor. If the baseline subagent already passes without the skill, the discipline is already taught elsewhere — either in a sibling skill, in the specialist prompt, or in the ethos preamble. Skipping RED ships a redundant skill that never auto-triggers because the dispatching code path already handles the case. |
| "I'll skip REFACTOR — the GREEN dispatch passed, so the skill works." | NO. GREEN passed on a representative task; REFACTOR confirms the skill survives **adversarial** rationalising. Subagents in production aren't sympathetic readers; they look for loopholes. A skill that ships without REFACTOR closes loopholes the first 2-3 dispatches that exploit them — the cost is the slug those dispatches mis-ship, not the cost of REFACTOR you skipped. |
| "I'll write the skill in 200 lines so I cover every edge case." | NO. ≤7 rules per skill; ≥5 anti-rationalisation entries; ≥3 carve-outs. Past those caps the skill is doing too much — split it. The `tdd-and-verification` skill earns its length because it composes three sibling disciplines that genuinely apply together; most new skills don't. |
| "I'll register the skill but skip the test row — tests are formalities." | NO. The test row is the tripwire that prevents silent deletion. Skills without tripwires get removed on the next overcomplexity-sweep refactor because the audit can't tell the skill is load-bearing. Add the row in the same PR — `tests/unit/v<version>-*.test.ts` carrying at minimum: file-presence assertion, registration-presence assertion, anchor-collapse assertion on the specialist(s) the skill replaces inline content from. |
| "The frontmatter `name:` and the registered `id:` can differ — the file id is the source of truth." | NO. They MUST match verbatim. The installer copies the body into `.cclaw/lib/skills/<fileName>.md`; the rendered specialist prompt cites `<id>`; the human-readable provenance is `name:`. Drift between any two breaks one of: the install path, the specialist bullet, the human audit trail. |
| "I'll set `stages: ['always']` to be safe — the skill auto-loads everywhere." | NO. `'always'` is for skills that genuinely apply at every dispatch stage (rare). Default to the narrowest stages array that covers your §When-to-use bullets. The reviewer's prompt budget is a finite resource; `'always'` skills compete with stage-specific skills for that budget. |
| "The skill body has 7 rules but I want to add an 8th — it's a small one." | NO. The 7-rule cap is the readability ceiling. Past 7 the reader's working memory drops cite-back accuracy; the 8th rule gets lost. If the 8th rule is genuinely necessary, split the skill into two complementary skills — each ≤7 rules. |
| "I'll cite the source pattern in a comment instead of the orientation paragraph." | NO. The orientation paragraph is the cite-back surface every reviewer / critic / audit reads. Comments inside the markdown body are invisible to the rendered specialist prompt. Put the source citation in the orientation paragraph alongside the discipline statement. |
| "The skill duplicates content from a runbook — I'll just point at the runbook in the body." | NO. Skills and runbooks have different load semantics. A skill that points at a runbook still bloats every dispatch envelope; the runbook still has to be opened on demand. If the content is operational (do step A, then B), keep it in the runbook and DON'T write a skill. If the content is a cross-cutting rule, lift it OUT of the runbook into the skill (the runbook then points at the skill). |

## Cross-references

- The taxonomy lane chart above is the canonical "skill vs runbook vs inline" decision tree; consult it before authoring any new discipline content.
- `src/content/skills/anti-slop.md`, `src/content/skills/tdd-and-verification.md`, `src/content/skills/pre-commitment-predictions.md` — the three canonical reference patterns; each one ships with its tripwire and demonstrates a different shape (cross-specialist; rule-density-vs-scope; mode-flavoured).
- `tests/unit/v810-install-tui.test.ts` — file-presence test pattern; copy the assertion shape into your new skill's tripwire row.
- `tests/unit/v819-skill-windowing.test.ts` — render-block assertion pattern; tests the auto-trigger block emitted into specialist prompts at each stage carries the new skill's id.
- `tests/unit/v8110-skill-contract.test.ts` — skill-contract assertion pattern; tests the registration-vs-file integrity, the description's first-sentence shape, the trigger / stages metadata coverage.
- `src/content/runbooks/builder-tdd-walkthrough.md` — example of the runbook lane (operational procedure); read alongside `tdd-and-verification.md` to see how the same discipline splits across a skill (rules) and a runbook (worked example).
