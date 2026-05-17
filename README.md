# cclaw

**A multi-stage planning + review harness for coding agents.**

cclaw drops a `/cc` slash command into Claude Code, Cursor, OpenCode, or Codex. It routes the task, picks the right amount of ceremony, and runs the work through a fixed pipeline: triage → plan → build → qa → review → critic → ship. Each stage emits a slim summary back to the harness and writes a tracked artifact under `.cclaw/flows/<slug>/`. Sub-agents are isolated; the orchestrator keeps the slug's history.

cclaw installs `/cc` and `/cc-cancel` into each harness. Inside `/cc`, three entry modes cover task work, research, and continuation flows.

## Why cclaw

- **One pipeline, depth scales.** Every task runs `triage → architect → builder → reviewer → critic → ship`. Plan-stage depth scales with `ceremonyMode` (lite for soft, rich for strict) instead of branching to a different specialist stack.
- **Always-auto, hard stops on failure.** The flow runs end-to-end without approval pickers at plan / review / critic gates. Hard failures stop and report with a plain-prose status block; resume with `/cc`, discard with `/cc-cancel`.
- **Two-model review.** A read-only reviewer walks ten axes; an adversarial critic falsifies what the reviewer cleared. They share no context and write to separate artifacts (`review.md`, `critic.md`). On high-stakes work (security_flag / irreversible D-N) or when invoked with `--critic-cross-model`, the critic optionally runs a **second adversarial pass via a different model** (Codex / Gemini via MCP) for an independent second opinion (v8.72).
- **Right-sized ceremony.** Trivial edits run inline (one commit, no plan). Small/medium tasks get a soft-mode plan + a single TDD cycle. Large-risky tasks get a per-slice build with a pre-implementation plan-critic gate.
- **Pre-build design audit on UI surfaces.** On any flow whose triage detects a UI / design / frontend / UX surface in soft or strict ceremony, the v8.75 **`plan-design`** specialist walks `plan.md` against a 7-dimension design-quality rubric (visual hierarchy / type system / color / spacing / interaction affordances / accessibility (WCAG AA) / responsive) **before** the build runs. Below-6 grades become `PD-N` findings appended to plan.md; severity ≥ medium blocks ship in strict mode. The same rubric the post-build reviewer applies to the rendered diff is applied here to the plan's design commitments — design bets are challenged once at plan-time and once after the diff lands, with the rubric pinned in a single shared TypeScript const so the two surfaces never drift.
- **Parallel by default.** Independent slices in a plan run in parallel — N independent slices finish in the time of the longest, not the sum.
- **Research as a separate entry point.** `/cc research <topic>` runs an open-ended discovery dialogue, surfaces an **Approaches Gate** (Phase 1.5; 2-3 candidate framings of the question, user picks one / many / `all` default), and dispatches research lenses in parallel (engineer / product / architecture / history / skeptic / **design** — six lenses on `standard+` depth when the topic touches UI/UX, `--lens=design` force-includes / `--lens=-design` force-excludes). Depth tiers (`--light` / `--standard` / `--deep-product`) gate the lens set; lenses dispatch first-class web search via MCP (`user-exa`, `user-context7`); synthesis runs a four-scan self-review before `research.md` lands. Optional handoff into a follow-up `/cc <task>` that consumes it as context.
- **Continuation flow.** `/cc extend <slug> <task>` loads a previously-shipped slug's `plan.md` / `build.md` / `learnings.md` (and `review.md` / `critic.md` / `qa.md` when present) as load-bearing context.
- **Same runtime, four harnesses.** Claude Code, Cursor, OpenCode, and Codex all read the same `.cclaw/` install. Each harness gets the same `/cc` body plus harness-namespaced ambient rules.
- **Compound learnings.** Non-trivial slugs emit a `learnings.md`. Future runs read prior shipped lessons through `knowledge.jsonl` before authoring a plan; outcome signals (`good` / `unknown` / `manual-fix` / `follow-up-bug` / `reverted`) down-weight priors that didn't hold up.

## When to use which command

| Intent | Command | What it does |
| --- | --- | --- |
| Execute a task end-to-end (code change) | `/cc <task>` | Full flow: triage → plan → build → review → critic → ship |
| Think / brainstorm / research a topic without committing to a task | `/cc research <topic>` | Open-ended discovery dialogue + Approaches Gate (2-3 framings) + up to 6 parallel research lenses (design lens fires on UI/UX topics at `standard+`) + synthesised `research.md`; optional handoff to `/cc <task>` |
| Extend a previously-shipped slug with related work | `/cc extend <slug> <task>` | New flow with parent's plan/build/learnings loaded as context |
| Cancel the active flow | `/cc-cancel` | Discards current `.cclaw/flows/<slug>/`, frees the orchestrator |

## Quickstart

```bash
cd /path/to/your/repo
npx cclaw-cli@latest

# Inside your harness:
/cc add caching to the search endpoint
ls .cclaw/flows/20260515-search-caching/
# plan.md  build.md  review.md  critic.md  ship.md
```

The flow runs end-to-end. cclaw stops only on a hard failure (build broken, reviewer can't converge in 3 fixes, critic block-ship, catastrophic git/dispatch failure). Resume with `/cc`; discard with `/cc-cancel`. See [Failure handling](#failure-handling) below.

For CI / scripted installs, use the non-interactive escape hatch:

```bash
npx cclaw-cli@latest --non-interactive install --harness=cursor
```

There is no `cclaw plan`, `cclaw build`, or `cclaw status`. Flow control lives inside `/cc`.

### `/cc` invocation matrix

| Invocation | Active flow? | Behaviour |
| --- | --- | --- |
| `/cc` (no args) | yes | Continue the active flow silently. No "resume?" picker. |
| `/cc` (no args) | no | Error: "No active flow. Start with `/cc <task>`, `/cc research <topic>`, or `/cc extend <slug> <task>`." |
| `/cc <task>` | yes | Error: "Active flow: `<slug>` (stage: `<stage>`). Continue with `/cc`. Cancel with `/cc-cancel`." cclaw does NOT auto-cancel or queue. |
| `/cc <task>` | no | Start a new flow (dispatch triage). |
| `/cc research <topic>` | yes / no | Same pattern — error when active, start when not. |
| `/cc extend <slug> <task>` | yes / no | Same pattern — error when active, start when not. |
| `/cc-cancel` | yes | Cancel active flow (move artifacts to `flows/cancelled/<slug>/`, reset state). |
| `/cc-cancel` | no | Error: "No active flow to cancel." |

## Modes

Three top-level entry points share the `/cc` slash-command surface. The orchestrator picks the mode from the first token after `/cc`.

### `/cc <task>` — task mode

Runs the full triage → plan → build → review → critic → ship pipeline. The `triage` sub-agent picks `complexity × ceremonyMode × path` from heuristics, announces the choice in one line, and dispatches the first specialist. No clarifying questions; no structured ask.

Pin a ceremony level explicitly with mutually-exclusive flags:

```bash
/cc --inline <task>    # forces inline edit (one commit, no plan)
/cc --soft <task>      # forces soft-mode plan → build → review → ship
/cc --strict <task>    # forces strict + architect's full Frame → Compose pass + per-slice commits + plan-critic gate
```

When the project has no `.git/`, the router auto-downgrades strict → soft even with `--strict` (per-slice commits need a SHA chain to be useful).

Classification work — surface detection, assumption capture, prior-learnings lookup, interpretation forks — lives inside the `architect`'s Bootstrap + Frame phases on strict + soft, nothing on inline.

**Debug-branch routing (v8.77; `triage.taskShape == "debug"`).** When the task is a bug report — bug-shape keyword (`regression` / `error` / `broken` / `failing` / `wrong` / `incorrect` / `slow` / `crash` / `bug` / `fix` paired with bug intent) PLUS repo-anchored evidence (file:line, commit SHA, log excerpt, stack trace, test name with failure verb) — the triage sub-agent emits `Task shape: debug` and the orchestrator inserts a new **`investigator` specialist hop BEFORE the architect**. The investigator is a **read-only diagnostic sub-agent** that fans out three parallel hypothesis lanes — `cause-code` (regression bisect / dependency analysis), `cause-config` (env / feature-flag / version drift), `cause-measurement` (instrumentation gap / flakiness / log gap) — collects evidence per lane (file:line / command output / log excerpt / commit SHA / config snippet — the five canonical evidence shapes), synthesises a single working root-cause hypothesis, and emits a slim summary whose `Next step:` line drives the post-investigator routing:

| `Next step:` | Action |
| --- | --- |
| `direct-fix` | Skip architect entirely. Dispatch `builder` with `priorInvestigation` envelope; builder reads `investigation.md` as plan-substitute; RED-before-GREEN against the cited symptom; `fix(<scope>):` commit prefix; bounded to the investigation's `## Fix scope` file:line refs. |
| `needs-plan` | Dispatch `architect` with `priorInvestigation` envelope; architect's Frame phase copies the cited root cause verbatim ("given root cause X, frame the fix at design level"). plan-critic / plan-design gates fire as normal afterwards; full plan → build → review → critic → ship path. |
| `more-investigation` | Re-dispatch investigator with iteration 1 (capped at 1; second `more-investigation` triggers stop-and-report). |
| `not-a-bug` | Stop-and-report. The investigator's `## Next step recommendation` paragraph (cited spec / docs / test that proves the symptom is intended behaviour) surfaces to the user verbatim. |

**Orthogonality.** `taskShape` is **independent of `complexity`** — a debug task can be any complexity tier. The investigator hop inserts BEFORE architect regardless of complexity / ceremonyMode (the existing complexity classifier is NOT modified). The investigator writes `investigation.md` to the same flow dir as `plan.md`; on `needs-plan` both artifacts coexist; on `direct-fix` only `investigation.md` exists. Pre-v8.77 flows lack the `taskShape` field; the validator accepts absent values as `build` (default), so legacy flows run the pre-v8.77 path verbatim. Full procedure (gate, dispatch envelope, verdict matrix, iteration cap, `priorInvestigation` propagation, builder direct-fix protocol, architect priorInvestigation read protocol, legacy migration, anti-rationalization) lives in `runbooks/debug-branch.md`. Reference patterns: obra-superpowers `deep-dive` (3 parallel trace lanes), everyinc-compound `ce-debug` (code-path / config / measurement partition with synthesis), gstack `/investigate` (hypothesis-before-probe + verdict-driven routing).

**Investigator v2 (v8.81; three conditional disciplines layered onto v8.77).** The v8.77 three-lane discipline is unchanged; v8.81 layers three additional sections onto `investigation.md` to harden the investigator's diagnostic reach:

- **Phase 0.5 — Assumption audit (ALWAYS runs; BEFORE the three lanes).** Investigator catalogues the "this must be true" beliefs the symptom rests on — framework behaves as expected here, function returns what its name implies, config loads before this runs, caller passes a non-null value, database is in the state the test implies, error message points at the actual failure, symptom description itself is correct. Each row marked `verified` (cited file:line / command output / commit SHA / config snippet) OR `assumed` (with a one-line probe command to run in Phase 1). When the audit's probe output **unambiguously** proves the symptom is misread (e.g. reported "endpoint returns 500" but actual response is 200), the investigator may short-circuit to `Next step: not-a-bug` with the audit row as the reframe evidence. The audit section is written even when short-circuiting — silent skips are forbidden. Borrowed from everyinc-compound `ce-debug` Phase 2 + obra-superpowers `systematic-debugging` Phase 1.
- **Phase 4 — Defense-in-depth tier (CONDITIONAL; fires on recurring or catastrophic patterns).** Fires when **either** signal is true: (a) the root-cause pattern appears in **≥3 OTHER files** (verified via a literal `rg` count probe — strict, not approximate), OR (b) the symptom is **catastrophic-if-prod** (data loss / security breach / payment failure / data integrity). When fired, the investigator writes a `## Defense-in-depth (4 layers)` section naming each layer's `What:` / `Where:` / `How it catches the class:`: **Layer 1 Entry validation** (reject obviously invalid input at the API boundary) / **Layer 2 Invariant check** (enforce that data makes sense for THIS operation) / **Layer 3 Environment guard** (refuse dangerous operations in contexts where they make no sense) / **Layer 4 Diagnostic breadcrumb** (capture forensic context before the risky operation; rarely truly n/a — the breadcrumb earns its keep for the NEXT bug). The slim summary gains a `Defense-in-depth: yes` line; the orchestrator copies it onto the builder dispatch envelope as `defense-in-depth: yes` (persisted on `flow-state.json > builderEnvelope.defenseInDepth`; absent defaults to `no`); when `yes` the builder implements all named (non-n/a) layers as part of the root-cause fix commit (NOT a follow-up commit). Borrowed from `everyinc-compound/ce-debug/references/defense-in-depth.md` + `obra-superpowers/systematic-debugging/defense-in-depth.md`.
- **Phase 5 — Post-mortem (CONDITIONAL; fires on prod-discovered symptoms).** Fires when the symptom source includes a **production / live / users-reported / incident keyword** in the original bug report — canonical vocabulary: `production` / `prod` / `live` / `shipped` / `deployed` / `users reported` / `customer reported` / `incident` / `outage` / `P0` / `P1` / `SEV-1` / `SEV-2` / `pager` / `paged` / `rollback` / `hotfix` / `emergency`. When fired, the investigator writes a `## Post-mortem` section covering four questions: **How was this introduced?** (commit SHA from `git log` / `git blame`, author, date — evidence-only, no motive speculation) / **How did this survive review?** (cite the introducing commit's `review.md` / `critic.md` paths + which axis flagged or missed it) / **What review axis would have caught it?** (exactly ONE axis from the reviewer's 11-axis surface + the specific finding text the axis should have produced) / **Prevent-recurrence** (one specific testable reviewer-axis check to add, framed as "the `<axis>` axis MUST scan for `<pattern>` when `<gate>`"). The post-mortem is **advisory** — it surfaces for human pattern-recognition and does NOT change the orchestrator's routing decision (the `Next step:` verdict is still chosen per the canonical v8.77 rubric).

The three v8.81 sections are **additive** — the v8.77 three-lane discipline, four-verdict vocabulary, slim-summary shape, and back-compat with pre-v8.77 state files are all preserved. Pre-v8.81 state files lack `builderEnvelope.defenseInDepth`; the validator defaults to `"no"` on absent. References: `everyinc-compound/plugins/compound-engineering/skills/ce-debug/SKILL.md` lines 104-130 (assumption audit + 4-layer defense-in-depth + conditional post-mortem) + `obra-superpowers/skills/systematic-debugging/SKILL.md` Phase 1 (assumption audit pattern) + `obra-superpowers/skills/systematic-debugging/defense-in-depth.md` (the four layers).

**One-way door gate (v8.79).** After the architect's slim summary returns AND before plan-critic dispatch, the orchestrator scans the freshly-written `plan.md > ## Decisions` block for any D-N marked `Reversibility: one-way` (v8.74 vocabulary — data migration / public-API removal / schema rewrite / destructive auth / payment-side commit). When ≥1 hit is found, the orchestrator surfaces a **structured user-facing pause** with three options: `confirm` (proceed to plan-critic + build), `edit` (open plan.md so you can soften reversibility or split the decision), `cancel` (abort the flow). The ask payload lists every one-way D-N's title + rationale + the User Sovereignty principle that motivates the pause. The gate fires ONLY when the scan returns ≥1 hit — two-way / mostly-two-way plans pass through silently (0 hits = no gate, no pause); soft-ceremony plans without a Decisions section silently pass too; inline (`lite`) ceremony skips the gate structurally (the path is just `["build"]`, no plan stage). Architect's slim-summary `Recommended next` field returns the new `awaiting-one-way-confirmation` value when one-way D-Ns are present (replacing `build` / `plan-critic`); the orchestrator's hard-gate logic routes that signal through the gate. Flow-state transition: `architect-complete` → `awaiting-one-way-confirmation` → (`plan-critic` | `architect-revision` | `aborted`); the user's choice + decision IDs + timestamp persist on `flow-state.json > oneWayDoorConfirmation`. Complementary to the v8.74 cross-model critic — both fire on the same condition (`Reversibility: one-way`), but the v8.79 gate is the **human-in-the-loop** counterpart firing **before** build burns context, and the v8.74 cross-model critic is the **model-in-the-loop** counterpart firing **after** build lands. Reference patterns: gstack `ETHOS.md > User Sovereignty` (the principle is already in cclaw's v8.74 ethos preamble; v8.79 wires the user-facing surface that puts the principle into practice); Bezos's one-way / two-way door framing (cited in `src/types.ts > Reversibility`).

**Iterative-clarify per-dimension scoring (v8.78).** Both architect Phase −1 Clarify and research-mode Phase 1 discovery dialogue now re-score 4 orthogonal dimensions after every user answer: `goal` (weight 0.4), `constraints` (0.3), `criteria` (0.3), `context` (0.0 — informational, not gating). The scalar `ambiguity = 1 - (goal*0.4 + constraints*0.3 + criteria*0.3 + context*0.0)` drives a math-gated exit at `ambiguity < 0.25`; the weakest dimension targets the next question; the per-round table (Score / Weight / Why / Next target) surfaces to the user before each follow-up so the dialogue's progress is visible. Round caps: 5 (architect Clarify) / 8 (research-mode discovery). **Challenge-mode rotation**: round 4 = Contrarian ("what if the opposite were true?"); round 5 = Simplifier ("what's the simplest version that still ships value?"). Earlier exit (math-gated or in-prose "ready" signal or `/cc research go` force-exit) skips the rotation. Per-round audit trail lands on `flow-state.json > clarifyRounds[]` (append-only; pre-v8.78 state files lack the field and validate unchanged). Reference patterns: oh-my-claudecode `deep-interview` (mathematical scoring + challenge-mode rotation); everyinc-compound `ce-brainstorm` Phase 1.2 gap lenses (specificity / evidence / counterfactual / attachment — re-projected as the four canonical dimensions).

### `/cc research <topic>` — research mode

A separate entry point for pre-task uncertainty: brainstorming, scope exploration, architecture comparison. Runs as a main-context orchestrator in four phases. Output: `.cclaw/flows/<slug>/research.md`. No build / review / critic / ship.

```bash
/cc research storage strategy for shared agent memory
/cc --research auth library trade-offs                          # equivalent
/cc research --light is fastify still maintained                # 2 lenses, fast clarification
/cc research --deep-product should we replace our calendar     # 5-6 lenses + extra probes (design lens on UI topics)
/cc research --lens=design rework the settings modal           # force-include design lens
/cc research --lens=-design pure backend cache substrate         # force-exclude design lens
```

**Depth tiers (v8.69).** The orchestrator picks one of three tiers at the Detect-hop research-mode fork — either explicitly via `--light` / `--standard` / `--deep-product` or auto-classified from topic wording (clarification → `light`; technical exploration → `standard`; greenfield / pivot wording → `deep-product`). Mutually-exclusive flags collapse last-wins.

| Depth | Lenses | Extra probes | When to use |
| --- | --- | --- | --- |
| `--light` | `research-engineer` + `research-skeptic` (2) | none | Clarification — "is X still maintained?", "which library does Y?", "what does the team currently use?" |
| `--standard` (default) | all 5 lenses + `research-design` when topic touches UI/UX (6 lenses total) | none | Technical exploration — "evaluate Redis vs in-memory cache", "should we move auth to JWT?" |
| `--deep-product` | all 5 lenses + `research-design` when topic touches UI/UX | `Thesis` + `Adjacent product` (product), `Durability` (skeptic), `Adjacent design surfaces` (design), **Founder mode** — premise challenge (right problem? actual outcome? what if we did nothing? inversion) + strategic consequences (trajectory / identity / adoption / opportunity cost / compounding) + 10-star reframing (product) | Greenfield / pivot — "should we build...", "what if we replace...", "evaluate switching from..." |

**Phase 1 — open-ended discovery dialogue.** The orchestrator opens with `"Hi. What are you researching? Tell me what you know and what you don't."` and runs an **uncapped** dialogue (no fixed question budget; no auto-advance). You refine the topic, name constraints, surface prior attempts, name stakeholders, mark scope edges. The orchestrator proceeds only when you signal `ready` / `go ahead` / `finalize`.

**Phase 1.5 — Approaches Gate (v8.76).** Between the discovery dialogue and lens dispatch, the orchestrator distils 2-3 candidate **framings** of the research question (NOT 2-3 implementation candidates — each framing changes WHICH dimensions every lens emphasises). You pick a single framing (`A`), multiple (`A B`), substring-match a framing title, or accept `all` / `every` / silent default (every framing flows to every lens — the canonical broad-coverage case). Selected framings carry forward into every lens envelope as a new `Framing:` field. Reframings mid-research route through the existing `/cc research push-back` machinery. Reference patterns: obra-superpowers brainstorming Phase 2-3, addyosmani idea-refine Phase 1.3 Cluster + Stress-test.

**Phase 2 — parallel lens dispatch.** The orchestrator distils the dialogue into a 5-15 bullet summary, stamps the selected framings, and dispatches the depth-determined lens subset in parallel:

| Lens | What it covers |
| --- | --- |
| `research-engineer` | Technical feasibility, stack fit, blockers, implementation paths, risks, effort estimate |
| `research-product` | User / product value, who benefits, alternatives (always including "do nothing"), market context. **Deep-product** depth folds in `Thesis` + `Adjacent product` probes plus **Founder mode** — premise challenge + strategic consequences + 10-star reframing |
| `research-architecture` | System fit, surface impact, coupling, boundaries, scalability, in-repo precedents |
| `research-history` | Prior attempts via `.cclaw/knowledge.jsonl` + git log; lessons; outcome signals |
| `research-skeptic` | Failure modes, edge cases, abuse cases, hidden costs, don't-proceed triggers. **Deep-product** depth folds in `Durability` probe |
| `research-design` (v8.76; `standard+` only) | Seven-dimension design-quality rubric (shared with v8.75 plan-design + v8.70 reviewer.design-quality): grades each dimension for **relevance** (load-bearing / relevant / tangential / out-of-scope), surfaces existing patterns to study, anti-patterns to avoid, open design questions for the follow-up architect. Fires when the topic touches UI / UX / design / frontend / accessibility / a11y (or the user passes `--lens=design`); suppressed by `--lens=-design`; never on `--light` depth. **Deep-product** depth folds in `Adjacent design surfaces` probe |

Engineer + architecture lenses may dispatch the `repo-research` helper for brownfield context. Engineer / product / architecture / skeptic / design lenses dispatch **first-class web search via MCP** (v8.69 for the first four; v8.76 for design) — `user-exa` for general web search, `user-context7` for library / framework / API docs — and cite hits inline in their `### Sources` block. The design lens treats web search as default-on (the design space — shadcn, Radix, Material 3 — is high-churn). When no MCP tool is wired, lenses fall back to training knowledge with a `Notes:` tag stamping the fallback. History lens is memory-only (web search is out of scope). **Lenses run independently** — no lens cites or chains into another.

**Phase 3 — synthesis + self-review.** The orchestrator pastes each lens's findings verbatim into the matching `## <Lens> lens` section of `research.md`, then runs a cross-lens synthesis covering convergence (where 2+ lenses agree), divergence, the trade-off space, and confidence + coverage gaps. **Before `research.md` is written to disk**, the orchestrator walks the draft through a four-scan self-review (placeholder / contradiction / scope drift / ambiguity) and fixes findings inline; cleanups land in `## Synthesis > ### Self-review notes`. It then writes a recommended next step: exactly one of `plan with /cc <task>`, `more research needed (specific area)`, or `don't proceed (skeptic blocked: <reason>)`.

**Phase 3.5 — awaiting user review (v8.71).** After Phase 3 lands `research.md`, the orchestrator stamps `flow-state.json > researchState: "awaiting-user-review"` and surfaces three follow-ups in plain prose. The user picks one:

- `/cc research revise <area>` — re-dispatches the lens(es) covering `<area>` (`engineer` / `product` / `architecture` / `history` / `skeptic` / `design` / `synthesis` / `all`), re-runs synthesis + self-review, rewrites `research.md`. Cycles back to `awaiting-user-review` so the user can iterate again.
- `/cc research push-back <claim>` — re-dispatches `research-skeptic` plus the lens that authored the cited claim. The skeptic surfaces counter-arguments under `### Counter-arguments to <claim>`; the authoring lens reaffirms / qualifies / retracts. Synthesis re-runs focused on the divergence paragraph. Same cycle-back.
- `/cc research accept` — terminal. Appends an `accept` row to `## Revision history`, runs Phase 4 finalize, emits the handoff.

Each revise / push-back / accept appends a row to `research.md > ## Revision history` (and a matching entry to `flow-state.json > revisions[]`). The table is the append-only audit trail — five columns: timestamp, kind, area-or-claim, lenses re-dispatched, change. Lifecycle states stamped at every Phase boundary: `discovery` → `lens-dispatch` → `synthesis` → `awaiting-user-review` ⇄ `revising` → `accepted`. Reference patterns: obra-superpowers brainstorming User Review Gate, addyosmani idea-refine divergent-then-converge, everyinc-compound `ce-brainstorm` Phase 2.5 confirmation gate. Full procedure in `runbooks/research-revision.md`.

**Phase 4 — finalize.** Fires only after `/cc research accept`. `git mv` the artifact into `.cclaw/flows/shipped/<slug>/research.md` and emit a plain-prose handoff. The next `/cc <task>` invocation on the same project reads `flow-state.json > priorResearch` and consumes the most-recent shipped research (including the `## Revision history` block) as input to its plan stage. The handoff is optional — if research finalises and you never run a follow-up `/cc`, nothing else fires.

Research mode skips the router entirely — no triage gate, no `complexity` / `ceremonyMode` heuristic. The six lenses live in `src/content/research-lenses/`, install to `.cclaw/lib/research-lenses/<lens>.md`, and are NOT in the core `SPECIALISTS` array.

### `/cc extend <slug> <task>` — continuation mode

Initialises a new flow that explicitly extends a previously-shipped slug. The orchestrator loads the parent's `plan.md`, `build.md`, `learnings.md`, and (when present) `review.md` / `critic.md` / `qa.md` as `flowState.parentContext` and surfaces them to `architect` / `reviewer` / `critic` as load-bearing context. Things already settled by the parent are not re-decided.

```bash
/cc extend 20260514-auth-flow add SAML login                   # canonical
/cc extend 20260514-auth-flow --strict refactor session store  # ceremony override wins over inheritance
/cc extend 20260514-cli-help fix typo in --help                # inheritance
```

The orchestrator runs the same pipeline as `/cc <task>`; the only difference is at init:

- **Parent validation.** `loadParentContext` confirms the slug is shipped + has a non-empty `plan.md`. Four failure modes are explicit: `in-flight`, `cancelled`, `corrupted`, `missing`. Each surfaces a one-line error and ends the turn.
- **State stamp.** `flow-state.json > parentContext` carries the parent's slug + status + shippedAt + structured artifact paths. Plan.md frontmatter carries `parent_slug: <parent>` and `refines: <parent>`.
- **Triage inheritance.** `ceremonyMode` / `surfaces` default to the parent's values. Explicit `--strict` / `--soft` / `--inline` flags override. A security-keyword heuristic (`security` / `auth` / `migration` / `schema` / `payment` / `gdpr` / `pci`) auto-escalates a soft/inline parent → strict for the new flow.
- **Specialist consumption.** The architect's Bootstrap reads the parent's `## Spec` / `## Decisions` / `## Selected Direction` and authors a mandatory `## Extends` section at the top of `plan.md`. The reviewer runs a parent-contradictions cross-check (silent reversals of a parent decision are `required` findings). The critic adds a skeptic question on parent decision contradictions.
- **Knowledge-store integration.** When `parentContext` is set, `findNearKnowledge` prepends the parent's `knowledge.jsonl` entry to the top of the prior-learnings result (load-bearing context overrides Jaccard ranking).

Only the **immediate** parent is auto-loaded. Specialists may use `findRefiningChain` on demand when transitive context is needed.

```mermaid
flowchart LR
    A[/cc input/] -->|"research <topic>" or --research| R[Research mode]
    A -->|"extend <slug> <task>"| E[Extend mode]
    A -->|"<task>"| T[Task mode]

    R --> RD[Open-ended discovery dialogue]
    RD --> RA[Approaches Gate: pick framings]
    RA --> RL[Dispatch up to 6 lenses in parallel]
    RL --> RM["research.md (synthesis + recommendation)"]
    RM --> H{Handoff?}
    H -->|"accept research"| END[Finalize]
    H -->|next /cc| T

    E --> LC[loadParentContext<br/>shipped + plan.md required]
    LC -->|ok| EI[Stamp parentContext<br/>+ refines + parent_slug]
    EI --> EHE[Triage inheritance<br/>ceremonyMode/surfaces]
    EHE --> T
    LC -->|in-flight/cancelled<br/>/missing/corrupted| EERR[Surface error<br/>end turn]

    T --> RT[Triage sub-agent<br/>complexity × ceremonyMode × path]
    RT -->|inline| INL[Build inline]
    RT -->|soft| PL[architect Bootstrap+Frame]
    RT -->|strict| DS[architect full ceremony]
    PL --> BD[plan → build → review → critic → ship]
    DS --> BD
```

## Worked example

You type:

```text
/cc add caching to the search endpoint
```

The orchestrator runs through these stages, chaining automatically. Slim-summary blocks land under `## Triage`, `## Plan`, `## Build`, `## QA`, `## Review`, `## Critic`, `## Ship` headers in chat. Artifacts land on disk.

- **Triage.** The orchestrator dispatches `triage` with the raw `/cc` argument. Triage returns a 5-field decision in one slim summary — complexity: small-medium · ceremony mode: soft · path: plan → build → review → critic → ship · runMode: auto · mode: task — plus an `ambiguity_score: <0-100>` line computed from four signals (vague verbs, missing AC, multiple interpretations, no concrete names). Slug: `20260515-search-caching`. Zero clarifying asks at the triage Hop itself. Persisted to `flow-state.json > triage`; immutable for the slug.
- **Plan.** The `architect` opens a **Clarify phase** (v8.67) when `triage.ambiguityScore` crosses `config.clarify.ambiguity_threshold` (default 60) AND `ceremonyMode != "inline"` — one question per turn, max 5, early-exit on `go` / `ready` / `proceed`. Below threshold or on inline path: skipped silently. Either way, the architect writes `plan.md` opening with a mandatory `## Assumptions (correct me now)` block — Clarify answers are bare bullets, architect-silent inferences carry the `(architect inference)` tag. After plan.md lands, the orchestrator emits a one-line ack-window prose pointing the user at that section by name (`/cc` to continue with assumptions as-is, `/cc-cancel` to discard, or edit the plan in place). The rest of the plan body — Spec, Frame, **Plan / Slices** (SL-N work units — how we build), **Acceptance Criteria** (AC-N verification rows back-referencing slices), Edge cases, Topology, Feasibility, Traceability — is unchanged from pre-v8.67. 4 slices, 3 AC, 2 prior lessons surfaced via `learnings-research`. Confidence: high.
- **Build.** `builder` runs one TDD cycle per slice: RED → GREEN → REFACTOR. Each work commit carries an `SL-N` prefix (`red(SL-1):` / `green(SL-1):` / `refactor(SL-1):`) the reviewer reads via `git log --grep="(SL-N):"`. Slices are dispatched in topological layers with independent slices running in parallel by default; a task with N independent slices finishes in the time of the longest slice, not Σ. Single-slice layers run inline (zero overhead); plan-critic verifies independence claims against surface overlap so parallel sub-builders never race. On strict mode the builder runs a **two-stage per-slice review** (spec-compliance first, then code-quality) inside its own context after each slice — issues surface where the diff is one slice wide, not where the chain has compounded. Two-attempt cap per stage; on persistent failure the slice's status is `BLOCKED`. The builder emits a structured `Status:` (`DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED`) the orchestrator routes deterministically — `DONE_WITH_CONCERNS` logs to `build.md > ## Concerns`; `NEEDS_CONTEXT` / `BLOCKED` stop and report. After all slices land, `builder` writes one `verify(AC-N): passing` commit per AC (empty diff when slice tests already cover the AC; test-files-only diff when the AC needs broader verification — perf budget, integration, contract). Tests: 14 passing (was 11). Coverage delta: +2.3%. Build failures trigger an auto-fix loop (up to 3 iterations); failure after 3 stops and reports.
- **Review.** Ten-axis reviewer opens 2 findings on the first iteration: cache-key collision on case-sensitive queries (`correctness`, `required`) and missing TTL refresh on stale entries (`architecture`, `consider`). Reviewer `critical` / `required-no-fix` triggers an auto-dispatch fix-only loop (up to 3 iterations); failure after 3 stops and reports. On `security_flag: true` slugs the reviewer walks the threat-model checklist verbatim in the `security` axis.
- **Critic.** Adversarial falsificationist pass — predictions, gap analysis, Criterion check across AC + Edge cases + NFR rows, goal-backward verification, realist check. Verdict: pass. `block-ship` stops immediately (no auto-iteration — re-running on unchanged code returns the same verdict).
- **Ship.** All 3 AC committed. `ship.md` carries the release-notes draft and the AC↔commit map. Chains automatically to push.

After ship, the orchestrator moves the artifacts to `.cclaw/flows/shipped/<slug>/` and (when the slug earned capture) appends one row to `.cclaw/state/knowledge.jsonl`.

## Failure handling

cclaw stops at hard failures per a fixed matrix. The recovery loop is always the same: read the status block, decide, type `/cc` (continue) or `/cc-cancel` (discard). No in-chat picker, no `[y/n]` ask, no "approve this?" gate.

| Failure | Behaviour |
| --- | --- |
| Build failure | Auto-fix loop, up to 3 iterations. After 3 unresolved → stop and report. |
| Reviewer `critical` / `required-no-fix` | Auto-dispatch fix-only loop, up to 3 iterations. After 3 unresolved → stop and report. |
| Critic `block-ship` | Stop immediately and report. No auto-iteration. |
| Catastrophic (git op fail, dispatch fail, missing tool) | Stop and report. |
| `Confidence: low` from any specialist | Stop and report. The specialist's `Notes:` line is surfaced verbatim. |

The status block names the stage, the reason, and the recovery options. Example:

```
Stopped at review (iteration 3). Reason: reviewer returned 2 critical findings after fix-only loop hit the 3-iteration cap.
To proceed: /cc to continue (continues from the saved state), or /cc-cancel to discard the slug.
```

## What you get

cclaw ships a single-source-of-truth **ethos preamble** at `.cclaw/lib/cclaw-ethos.md` — five cross-cutting principles (**Boil the Lake**: gather evidence before deciding; **Search Before Building**: check existing patterns first; **Surgical Edits**: smallest diff that delivers; **User Sovereignty**: user decisions overrule defaults; **Three knowledge layers**: Layer 1 tried-and-true, Layer 2 popular, Layer 3 first-principles — question Layer 1/2 when stakes warrant). The preamble is auto-prepended to every specialist dispatch envelope as the **Required ethos read**, one position above the agent contract. Specialist contracts refine HOW each principle applies to their stage; they do not restate the principles themselves. When a specialist's local rule appears to contradict an ethos principle, the ethos wins and the local rule is the bug.

Strict-mode plans classify every `D-N` decision by **reversibility** — one of `one-way` (irreversible-or-effectively-so: data migration, public-API removal, schema rewrite, destructive auth/cryptography, payment commit), `two-way` (cheaply reversible: feature flag, internal-API behind compat shim, behaviour tweak behind kill switch), or `mostly-two-way` (the middle ground: schema column add, new dependency, UI surface shipped to users). The classification is borrowed from Bezos's one-way/two-way door framing. plan-critic §A blocks ship on a missing field; the cross-model critic's §3.5 second opinion auto-fires on any `one-way` decision regardless of `triage.securityFlag` (keyword detection on Blast-radius prose is preserved as a fallback for plans with no `## Decisions` section). Both `critic` (adversarial mode) and `plan-critic` open with an explicit force-stance clause that flips the default cognitive posture from balanced review to "find disqualifying evidence first".

| Surface | Count + detail |
| --- | --- |
| **Specialists** | 8 sub-agents: `triage` (routing dispatch at Hop 2 of every fresh `/cc <task>`; emits a 5-field slim summary the orchestrator parses; detects design surface from ui/design/frontend/ux keywords for the reviewer's design-quality gate AND the v8.75 plan-design pre-build gate), `architect` (the only plan-stage authoring specialist; runs as a single on-demand dispatch on every non-inline path, covers Bootstrap → Frame → Approaches → Decisions → Pre-mortem → Compose silently; absorbs classification work — assumption capture, surface detection, prior-learnings dispatch, interpretation forks; authors both `## Plan / Slices` and `## Acceptance Criteria` tables), `builder` (per-slice RED → GREEN → REFACTOR cycles on strict with `<type>(SL-N):` prefixes plus one `verify(AC-N): passing` commit per AC after slices land; single-cycle on soft), `plan-critic` (pre-implementation gate on strict + complexity≠trivial + AC≥2; checks slice-AC separation, slice quality, AC verifiability, coverage gaps), `plan-design` (**v8.75 — pre-implementation design-coherence pass** on UI / design / frontend / UX surfaces in soft + strict ceremony; walks plan.md against the same 7-dimension rubric the reviewer's design-quality axis applies post-build; below-6 grades become `PD-N` findings appended to plan.md's `## Plan-design findings` section; severity ≥ medium blocks ship in strict mode — design bets are challenged before the build runs, not after), `qa-runner` (UI/web surfaces, ceremonyMode≠inline), `reviewer` (eleven-axis review with both slice + AC traceability chains on strict; walks the threat-model checklist verbatim in the `security` axis on `security_flag: true`; activates the gated `design-quality` axis on UI / design / frontend / ux surfaces — grades the same 7 design dimensions 0-10 against the rendered diff with explicit "what a 10 looks like" references and runs the AI-slop check; cross-references plan.md's open PD-N rows when plan-design ran), `critic` (post-implementation adversarial pass with slice + AC coverage check). Each runs in isolation with a mandatory contract read. The seven-dimension design-quality rubric lives in `src/content/design-quality-rubric.ts` as a single source of truth — both `plan-design` (pre-build) and `reviewer.design-quality` (post-build) embed the same rendered markdown so the two surfaces never drift. |
| **Research helpers** | `repo-research` (brownfield scan) and `learnings-research` (prior shipped lessons) dispatched in parallel before every plan. |
| **Research lenses** | 6 research-only sub-agents dispatched in parallel by the main-context research orchestrator on `/cc research <topic>` after the open-ended discovery dialogue + Approaches Gate (v8.76) complete: `research-engineer` (feasibility + paths + risks), `research-product` (user value + alternatives + market context), `research-architecture` (system fit + coupling + boundaries + scalability), `research-history` (prior attempts via `knowledge.jsonl` + git log; outcome signals), `research-skeptic` (failure modes + edge cases + abuse cases + hidden costs), `research-design` (**v8.76** — seven-dimension design-quality rubric shared with `plan-design` + `reviewer.design-quality`; activates on `standard+` depth when the topic touches UI/UX, force-toggle via `--lens=design` / `--lens=-design`). NOT in `SPECIALISTS`; install to `.cclaw/lib/research-lenses/<lens>.md`. |
| **Ceremony modes** | `strict` (per-slice RED → GREEN → REFACTOR with `<type>(SL-N):` prefixes + per-AC `verify(AC-N): passing` commits — dual-chain reviewer cross-check), `soft` (single feature-level TDD cycle, plain commit), `inline` (one commit, no plan). Triage picks the mode. |
| **Plan template** | 15 sections strict (`Frame`, `Non-functional`, `Approaches`, `Selected Direction`, `Decisions`, `Pre-mortem`, `Not Doing`, `Plan`, `Spec`, `Plan / Slices`, `Acceptance Criteria (verification)`, `Feasibility stamp`, `Edge cases`, `Topology`, `Traceability block`); 6 sections soft (`Plan`, `Spec`, `Testable conditions`, `Verification`, `Touch surface`, `Notes`). Work-units (slices) are separate from verification (AC). |
| **Postures** | 6 per-criterion postures (`test-first`, `characterization-first`, `tests-as-deliverable`, `refactor-only`, `docs-only`, `bootstrap`). Each maps to a fixed commit-shape recipe the reviewer enforces ex-post. |
| **Review** | 10 reviewer axes — 8 base (`correctness`, `readability`, `architecture`, `security`, `perf`, `test-quality`, `complexity-budget`, `edit-discipline`) plus 2 gated (`qa-evidence` when qa-runner ran, `nfr-compliance` when `## Non-functional` is non-empty). Append-only findings table, convergence detector, severity-aware ship gate. |
| **Critic step** | Falsificationist pass after review clears: §1 predictions, §2 gap analysis, §3 four adversarial techniques + 6 human-perspective lenses (executor / stakeholder / skeptic for plan-stage, security / new-hire / ops for code-stage), §4 Criterion check (AC + Edge cases + NFR), §5 goal-backward, §6 realist check, §7 verdict, §8 summary. |
| **Auto-trigger skills** | 25 skills (`triage-gate`, `plan-authoring`, `tdd-and-verification`, `review-discipline`, `design-quality-discipline`, `commit-hygiene`, `completion-discipline`, `pre-edit-investigation`, `qa-and-browser`, `debug-and-browser`, `ac-discipline`, `source-driven`, `summary-format`, `documentation-and-adrs`, `parallel-build`, `refinement`, `flow-resume`, `receiving-feedback`, `anti-slop`, `conversation-language`, `api-evolution`, `pre-flight-assumptions`, `slice-discipline`, `ambiguity-discipline`, `structured-status`). Auto-applied per stage. `design-quality-discipline` (v8.75) is shared by `plan-design` (plan stage) and `reviewer.design-quality` (review stage). |
| **On-demand runbooks** | 13 runbooks loaded by trigger (`dispatch-envelope`, `parallel-build`, `finalize`, `cap-reached-recovery`, `adversarial-rerun`, `handoff-gates`, `handoff-artifacts`, `compound-refresh`, `pause-resume`, `critic-steps`, `qa-stage`, `extend-mode`, `always-auto-failure-handling`). Kept out of the orchestrator body to hold the prompt budget. |
| **Anti-rationalization catalog** | `.cclaw/lib/anti-rationalizations.md` carries the cross-cutting rebuttal table (posture-bypass, completion-discipline, edit-discipline, verification rows). Each specialist's prompt cites the catalog and adds specialist-specific rows. |
| **Outcome signals** | 5-value enum (`good`, `unknown`, `manual-fix`, `follow-up-bug`, `reverted`) recorded on `knowledge.jsonl` rows. Three capture paths (orchestrator scans on every `/cc` for follow-up-bug references; compound time scans for revert commits and same-touch-surface manual-fix commits). Prior-learnings lookup multiplies similarity by signal weight before threshold filtering. |
| **Discipline skills** | `completion-discipline` (no `✅ complete` without paired fresh evidence), `pre-edit-investigation` (three-probe gate before any edit), `receiving-feedback` (builder fix-only response protocol), `structured-status` (builder emits one of four canonical statuses — `DONE` / `DONE_WITH_CONCERNS` / `NEEDS_CONTEXT` / `BLOCKED` — orchestrator routes deterministically), plus `edit-discipline` as a reviewer axis. |
| **Harness-embedded rules** | Every supported harness installs cclaw's Iron Laws + anti-rationalizations + antipatterns into its own ambient surface (`.cursor/rules/`, `.claude/`, `.codex/`, `.opencode/`). cclaw never touches root `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`. |
| **Parallel build** | Independent slices run in parallel by default, each in its own sibling git worktree (`../<projectName>-<slug>-<sliceId>` on disposable branch `cclaw/<slug>-<sliceId>`). Sub-builders TDD + commit in isolation; the parent fast-forward merges each slice back in topological-layer order with a typecheck + test CI gate between merges. Refused fast-forwards land in `flow-state.slice_merge_failures[]` and contaminate the dispatch-level status to `BLOCKED`. Triggered automatically when a layer has ≥2 slices with `independent: true`; single-slice layers run inline. `ceremonyMode: strict` required. Plan-critic blocks-ship any independence claim that fails literal zero-file-overlap across `Surface` columns. |
| **Multi-harness install** | Claude Code, Cursor, OpenCode, Codex — same `.cclaw/` runtime, different harness adapters. |

## Harnesses supported

| Harness | Detection | Status |
| --- | --- | --- |
| Claude Code | `CLAUDE.md` or `.claude/` | Supported |
| Cursor | `.cursor/` | Supported |
| OpenCode | `opencode.json[c]` or `.opencode/` | Supported |
| Codex | `.codex/` or `.agents/skills/` | Supported |

Run `npx cclaw-cli@latest` and the TUI auto-detects whatever you have. For CI / scripted installs, pass `--non-interactive install --harness=<id>[,<id>]` (comma-separated; supported ids: `claude`, `cursor`, `opencode`, `codex`).

## Configuration

`.cclaw/config.yaml` is optional. Defaults are good. Common knobs:

```yaml
harnesses: [claude, cursor]
reviewerTwoPass: false              # opt-in: spec-review + code-quality-review split
compoundRefreshEvery: 5             # how often to dedup knowledge.jsonl
compoundRefreshFloor: 10            # minimum entries before refresh kicks in
captureLearningsBypass: false       # true = silent skip on non-trivial slugs
legacy-artifacts: false             # true brings back legacy extra artifacts
architect:
  ambiguity_threshold: 0.2          # ambiguity soft-warning threshold
critic:
  cross_model: false                # opt-in (v8.72): second adversarial pass via a
                                    # different model through MCP on high-stakes
                                    # slugs. Always available on demand via the
                                    # `/cc --critic-cross-model` flag regardless
                                    # of this knob. Graceful fallback when no
                                    # MCP cross-model tool is wired.
```

## Architecture deep dive

The runtime is under 1 KLOC. The prompt content is where the work lives. To understand how `/cc` actually works, read the source under `src/content/`:

- [`src/content/start-command.ts`](src/content/start-command.ts) — orchestrator body (detect, dispatch, always-auto chain, critic step, ship, compound, finalize).
- [`src/content/specialist-prompts/`](src/content/specialist-prompts/) — 8 specialist contracts.
- [`src/content/skills/`](src/content/skills/) — 25 auto-trigger skill bodies.
- [`src/content/runbooks-on-demand.ts`](src/content/runbooks-on-demand.ts) — 13 on-demand runbooks loaded by trigger.
- [`src/content/artifact-templates.ts`](src/content/artifact-templates.ts) — plan / build / qa / review / critic / plan-critic / ship / learnings templates.
- [`src/content/anti-rationalizations.ts`](src/content/anti-rationalizations.ts) — cross-cutting rebuttal catalog.
- [`CHANGELOG.md`](CHANGELOG.md) — release history.

## Artifact tree (after install)

```
.cclaw/
  config.yaml               flow defaults
  state/
    flow-state.json         active flow state (~500 bytes)
    knowledge.jsonl         compound learnings index
    triage-audit.jsonl      routing audit log
  flows/
    <slug>/                 one folder per active task
      plan.md
      build.md
      qa.md                 (UI/web slugs only)
      review.md
      critic.md
      plan-critic.md        (strict + complexity≠trivial + AC≥2)
      ship.md
      research.md           (/cc research <topic> only)
                            (plan-design findings appear inline in plan.md
                             under `## Plan-design findings` when the v8.75
                             design-surface gate fires; no separate file)
    shipped/<slug>/         finalized tasks (including research-mode flows)
    cancelled/<slug>/       /cc-cancel destination
  lib/
    agents/                 8 specialist contracts + 2 read-only research helpers (learnings-research / repo-research)
    research-lenses/        5 research-only lens contracts
    skills/                 25 auto-trigger skill bodies
    templates/              artifact templates
    runbooks/               13 on-demand runbooks
    patterns/               reference patterns
    anti-rationalizations.md
    antipatterns.md
```

## CLI surface

Two invocations cover every use case. There is no `cclaw plan` / `cclaw status` / `cclaw build` / `cclaw ship` — flow control lives inside `/cc`.

```bash
# Interactive (humans): opens a TUI menu — Install / Uninstall / Quit
npx cclaw-cli@latest

# Non-interactive (CI / scripts): explicit command, no TUI
npx cclaw-cli@latest --non-interactive install [--harness=<id>[,<id>]]
npx cclaw-cli@latest --non-interactive uninstall
npx cclaw-cli@latest --non-interactive knowledge [--tag=<tag>] [--surface=<sub>] [--type=<kind>] [--all] [--json]
npx cclaw-cli@latest --version
npx cclaw-cli@latest --help
```

`install` is idempotent and runs orphan cleanup, so it handles first-time setup, re-sync after a package upgrade, and stale-file cleanup in one command. The TUI menu and the `--non-interactive install` path share the same installer code — they are byte-for-byte identical in write behaviour.

## Contributing

cclaw is dogfooded — every release is shipped via `/cc` against itself. To contribute:

1. Fork and clone.
2. `npm install && npm run build && npm test` (the test suite is the spec; PRs without test updates are rare).
3. Run `/cc <your change>` inside a cclaw-installed harness, or write tests + code directly.
4. Open a PR. CI runs lint, typecheck, unit tests, integration tests, and a smoke runtime test.

The runtime stays under 1 KLOC; new behaviour usually means new prompt content under `src/content/`, not new code under `src/`.

## License

MIT. See [LICENSE](LICENSE).
