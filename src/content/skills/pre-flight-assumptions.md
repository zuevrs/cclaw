---
name: pre-flight-assumptions
trigger: reference doc only — the assumption surface moved to design Phase 0 / planner Phase 0 in v8.21
---

# Skill: pre-flight-assumptions

**v8.21 fold notice — this skill is a reference doc, not a runtime hop.**

Triage answers "**how much** work is this?" and "**how should we run it?**". The assumption confirmation answers "**on what assumptions** are we doing it?". They are different questions, and the silently-defaulted-assumption problem is real: it is the most common reason a small/medium build ships the wrong feature.

Pre-v8.21, this skill ran as a standalone **Hop 2.5** between triage (Hop 2) and the first specialist dispatch (Hop 3). It surfaced a numbered list of assumptions through the harness's structured ask, captured the user's confirmation, and persisted the list to `flow-state.json > triage.assumptions`. v8.21 found that hop was producing a double-ask on large-risky flows (Hop 2.5 then design Phase 0 / Phase 1, both asking about assumptions in close succession) and a friction-only hop on small-medium flows (Hop 2.5 then planner draft, with no corresponding design phase to share the surface with).

## Where the surface lives now

- **`triage.complexity == "large-risky"`** → **design Phase 0 / Phase 1** owns the assumption surface. Design Phase 0 reads any pre-seeded `triage.assumptions` from the triage gate; design Phase 1 (Clarify) opens with the assumption-confirmation question when the field is empty / absent. See `agents/design.md` Phase 0 ("Assumption-surface ownership (v8.21 fold)") and Phase 1.
- **`triage.complexity == "small-medium"`** → **planner Phase 0** (`agents/planner.md`) owns it. Planner Phase 0 emits a single assumption-confirmation turn, waits one turn for user reply, persists to `triage.assumptions`, proceeds to Phase 1 (Bootstrap) in the next turn. The user sees one ask, not two.
- **`triage.path == ["build"]`** (inline / trivial) → no assumption surface. A single-file edit has no architectural assumptions worth surfacing. Folded into design Phase 0 on large-risky — the discovery specialist owns the assumption surface for design flows.

## Why the fold

- The user's original audit flagged the legacy double-ask as "дико переусложнено" — the design specialist's Phase 1 already opens with a clarifying question, and a separate Hop 2.5 right before it produced two back-to-back asks that asked overlapping things.
- On small-medium, Hop 2.5 was a friction hop without a corresponding design phase to amortise the ask. The planner now opens with the same content as the legacy Hop 2.5 would have produced, in the same single turn, but inside its own context (so a follow-up correction can flow into Phase 1 immediately).
- `triage.assumptions` stays a first-class field on `flow-state.json` (same wire format, same schema, same downstream readers). Only the *capture surface* moved.

## What still applies (from the legacy skill body)

The composition rules for an assumptions list are unchanged — design Phase 0 / planner Phase 0 use the same playbook:

- **Stack** — language version, framework, runtime target, test runner.
- **Conventions** — where tests live, filename pattern.
- **Architecture defaults** — CSS strategy, state strategy, auth strategy, persistence pattern (skip items not relevant).
- **Out-of-scope defaults** — what we will NOT do unless asked.
- **3-7 numbered items, one sentence each, citation when non-obvious.**

The interpretation-forks sub-step (when the prompt has multiple readings) also moved into design Phase 1 (Clarify) on large-risky and stays inside the design specialist's protocol; planner Phase 0 on small-medium can surface a fork inline ("I'm reading this as X — say so if you meant Y") and persist to `triage.interpretationForks`.

## Migration note (pre-v8.21 flows)

Flows started on v8.20 or earlier where the legacy Hop 2.5 already captured `triage.assumptions` continue to work unchanged. The first specialist that runs on resume reads the populated list as ground truth and **does not re-prompt**. The fold is purely about the capture surface for **fresh** v8.21 flows; resumed pre-v8.21 flows skip both the legacy Hop 2.5 (already gone) and the new specialist Phase 0 ask (the list is already on disk).
