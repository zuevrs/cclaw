# plan.md worked-example templates

Two long-form worked-example transcripts for the architect's `plan.md` authoring: the soft-mode permission-tooltip excerpt and the strict-mode large-risky excerpt. Lifted out of `agents/architect.md` to free in-prompt budget; the in-prompt anchor is 4 lines pointing here.

## Worked example — small/medium, soft mode, intra-flow

Excerpt of an architect-authored plan.md on the soft path:

```markdown
## Frame

Approvers struggle to identify users when request rows show only display name — collisions with common names produce silent mis-routing. We add a permission-gated email tooltip so reviewers with `view-email` see the email on hover; reviewers without it see the existing display-name fallback. Out of scope: bulk approver lookup, exporting reviewer contact info.

## Spec

- **Objective**: Surface approver email in the request-row tooltip when the viewer has the `view-email` permission so reviewers can contact the approver without leaving the dashboard.
- **Success**: Reviewers with the permission see the email on hover; reviewers without it see the display-name fallback. No PII leaks to unauthorised viewers.
- **Out of scope**: bulk approver lookup, exporting reviewer contact info, request-history surface.
- **Boundaries**: do not touch the `/api/requests` response shape; reuse existing 250ms hover-delay token.

## Not Doing

- No new design-system primitive (use existing tooltip + 250ms delay token).
- No mobile breakpoints this round.
- No analytics tracking on hover (privacy bar).

## Plan

Add a permission-gated email tooltip to RequestCard.tsx; permission helper extracted to a shared lib for reusability.

## Testable conditions

- Tooltip shows approver email when the viewer has `view-email` permission.
- Tooltip falls back to display name when permission is missing.
- Hover delay matches the existing 250 ms token.

## Verification

- `tests/unit/RequestCard.test.tsx` — covers all three conditions in one test file.
- Manual: open `/dashboard`, hover the pill on a row you do and do not have permission for; confirm the two text variants.

## Touch surface

`src/components/dashboard/RequestCard.tsx`, `src/lib/permissions.ts`, `tests/unit/RequestCard.test.tsx`.

## Prior lessons applied

No prior shipped slugs apply to this task.

## Summary — architect

### Changes made
- Authored Frame + Spec + Not Doing + Plan + three testable conditions + verification + touch surface for the permission-gated tooltip task.
- Surfaces detected: `["ui"]`; qa stage inserted into triage.path.

### Things I noticed but didn't touch
- `src/components/dashboard/RequestCard.tsx:200` mixes inline styles with the design-token system; outside this slug's touch surface; flag for a follow-up.

### Potential concerns
- The 250ms hover-delay token is referenced from RequestCard.tsx:90 but its definition path needs confirming during build.
```

## Worked example — large-risky, strict mode, intra-flow

Excerpt — the architect adds the full design portion plus the dual Slices + AC tables:

```markdown
## Spec
(four bullets — Objective / Success / Out of scope / Boundaries)

## Frame

(2-5 sentences naming the user, the broken state, the verifiable success criterion, and the explicit out-of-scope.)

## Approaches
| Approach | What | Tradeoffs | Effort | Best when |
| ... |

## Selected Direction
(one paragraph naming the picked option + rationale + why the rejected alternatives lost)

## Decisions
Decision D-1: ...

## Pre-mortem
(3-7 failure modes; deep posture only)

## Not Doing
(3-5 concrete bullets)

## Plan / Slices
| Slice | Title | Surface | Depends-on | Independent | Posture |
| --- | --- | --- | --- | --- | --- |
| SL-1 | Extract permission helper | src/lib/permissions.ts | — | yes | test-first |
| SL-2 | Render email pill in RequestCard | src/components/dashboard/RequestCard.tsx | SL-1 | no | test-first |

## Acceptance Criteria (verification)
| AC | Description | Verifies | Severity | Rollback |
| --- | --- | --- | --- | --- |
| AC-1 | Reviewers with `view-email` see the email on hover; reviewers without it see the display-name fallback. | SL-1, SL-2 | required | Revert SL-2 commit; SL-1 helper is dead code but harmless. |
| AC-2 | Tooltip hover-delay matches the existing 250 ms token (no regression). | SL-2 | required | Same as AC-1. |

## Edge cases
(one bullet per slice — SL-1 / SL-2 / ...)

## Topology
- topology: inline  (or parallel-build when every slice has Independent: yes)

## Feasibility stamp
green | yellow | red — one-sentence rationale

## Prior lessons applied
(verbatim quotes, or "No prior shipped slugs apply to this task.")

## Summary — architect
(three-section block)
```

## Why these are templates, not contracts

The contracts that bind the architect's authoring live in the prompt body:
- the per-section shape (`## Frame` / `## Spec` / `## Plan / Slices` / `## Acceptance Criteria (verification)` etc.)
- the dual Slices + AC tables on strict mode
- the slice work-unit shape (`Slice | Title | Surface | Depends-on | Independent | Posture`)
- the AC verification-row shape (`AC | Description | Verifies | Severity | Rollback`)
- the Phase 10 self-review checklist (~10 grouped categories)

These transcripts are *instances* of those contracts — useful when the architect needs to see the literal markdown shape but redundant for a fresh agent that has already read the in-prompt rules. When in doubt, read the in-prompt Phase 7 (Compose plan body) section first; come here for the markdown-level shape.
