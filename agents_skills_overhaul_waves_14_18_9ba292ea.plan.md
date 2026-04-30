# cclaw — Agents & Skills Overhaul Blueprint (Waves 14–18)

> Цель: довести агенто-скилл слой cclaw до баланса best-of-all через комбинацию
> Tracks II (Critic & Document review uplift) + III (Skills-first redistribution)
> + IV (Persistence pattern БЕЗ нового CLI). Track I (concrete model routing
> с IDs/temperature/fallback chains) откладывается отдельным треком.

## Принципы синтеза

cclaw сохраняет свою уникальную силу как позвоночник:

- Machine-checkable `STAGE_AUTO_SUBAGENT_DISPATCH` matrix
- Calibrated findings format `[P1|P2|P3] (confidence: n/10)`
- Iron Law per stage с linter enforcement
- Strict return schemas (worker / review / advisory / doc) с JSON contracts
- Track-aware routing (lightweight / standard / deep)
- Material `.cclaw/agents/*.md` под нативные subagent surfaces разных harness'ов

Впитываем из референсов выборочно:

- **Multi-perspective critic** из oh-my-claudecode — решает «critic выдумывает» через pre-commitment + gap analysis
- **Document review lens** из compound + evanflow — реальный gap качества plan/spec/design
- **Cohesion contract + integration-overseer** из evanflow — fan-out гигиена
- **Skills-first redistribution** из Superpowers + addy — сжатие 19 → ~16 агентов через lens-bundles
- **Pre-planning consultant + architect-verification + executing-waves skill** из omo Metis + omx Ralph — persistence pattern без новых CLI команд

NB: НИКАКИХ новых CLI команд. Любая «persistence» / «continue» работает поверх
существующих `cclaw run resume`, `internal verify-current-state`,
`internal advance-stage`. Новизна — в skills, агентах, gates и артефактах.

---

## Wave 14 — Critic Uplift (multi-perspective)

### Цель

Перестроить `critic` агента так, чтобы он перестал «выдумывать» concerns и
давал evidence-anchored multi-perspective findings. Поднимаем качество ранних
стадий (brainstorm / scope / design) без увеличения числа агентов.

### Скоуп

#### 14.1 Расширить `critic` body в `src/content/core-agents.ts`

Структура нового body:

1. **Why this matters** — explicit framing про false-approval cost (10-100x)
2. **Pre-commitment predictions** — критик ОБЯЗАН перед deep dive озвучить
   гипотезы что найдёт. Включается в return schema как `predictions[]`.
3. **Multi-perspective angles** (выбираются по контексту):
   - Для plan/spec/scope: `executor` / `stakeholder` / `skeptic`
   - Для design/code: `security` / `operator` / `new-hire`
4. **Gap analysis** — explicit «что отсутствует», не только «что плохо»
5. **Self-audit** — low-confidence findings (≤4) → переносятся в `openQuestions[]`,
   не блокируют merge / stage transition
6. **Realist check** — Critical/Major findings прессуются: «реально ли это
   зашипит?» → если нет, downgrade severity или suppress
7. **ADVERSARIAL mode escalation** — триггер: 2 reviewer disagree, или
   confidence критика низкий, или security-impacted область

#### 14.2 Расширить `ADVISORY_RETURN_SCHEMA` для critic

Добавить опциональные поля:

- `predictions[]` (выдвинуты ДО расследования)
- `predictionsValidated[]` (подтверждены / disproven после)
- `openQuestions[]` (low-confidence findings)
- `realistCheckResults[]` (по каждому Critical/Major)

Schema остаётся advisory, но обогащённая.

#### 14.3 Обновить dispatch matrix

В `STAGE_AUTO_SUBAGENT_DISPATCH` для brainstorm/scope/design:

- Добавить в `purpose` упоминание pre-commitment predictions
- Добавить триггер ADVERSARIAL mode в `when` для design (security/auth/auth-z
  trust boundaries)

#### 14.4 Linter rule

В `src/artifact-linter/brainstorm.ts`, `scope.ts`, `design.ts`:

- Если в артефакте есть `## Critic Findings` секция (или Layered review block с
  critic как источник), проверить наличие:
  - подсекции `Pre-commitment predictions` с ≥1 пунктом
  - подсекции `Validated / Disproven` (mapping предсказаний к реальности)
  - подсекции `Open Questions` (low-confidence — допустим пустой, но секция нужна)
- Иначе — `[P2] critic.predictions_missing — pre-commitment predictions block missing or empty`

#### 14.5 Skill

Создать `src/content/subagent-context-skills.ts` запись `critic-multi-perspective`
с описанием процедуры (predict → investigate → multi-angle → gap-analysis →
self-audit → realist-check → optional ADVERSARIAL). Привязать к dispatch row
critic в design (через `skill: "critic-multi-perspective"`).

### Тесты

- Unit: рендер `critic` agent body содержит все 7 секций
- Unit: linter ловит отсутствие predictions/validated/openQuestions блоков
- Unit: ADVISORY_RETURN_SCHEMA включает новые поля
- Smoke: `cclaw init` в fresh project — `.cclaw/agents/critic.md` содержит
  multi-perspective body
- Snapshot: brainstorm/scope/design SKILL.md содержит ссылку на новый
  critic-multi-perspective skill

### Не делаем

- Не превращаем critic в Opus-only (как у ohmcc) — оставляем `model: balanced`
- Не убираем существующие конкретные dispatch rows
- Не добавляем CLI

### Definition of Done

- 1 коммит: `feat(critic): multi-perspective body, pre-commitment, gap analysis, ADVERSARIAL mode`
- Все тесты зелёные
- Smoke: critic.md в fresh project имеет 7 секций
- Linter ловит отсутствие predictions block
- CHANGELOG обновлён

---

## Wave 15 — Document Review Lens

### Цель

Закрыть реальный gap качества plan/spec/design через 3 узких документ-ревьюера,
которые сейчас в cclaw отсутствуют (compound и evanflow имеют их явно).

### Скоуп

#### 15.1 Три новых агента в `src/content/core-agents.ts`

**A. `coherence-reviewer`**
- `relatedStages: ["spec", "plan", "design"]`
- `activation: "proactive"`
- `model: balanced`
- `returnSchema: REVIEW_RETURN_SCHEMA`
- Body: ловит contradictions between sections, terminology drift, structural issues,
  forward references, broken internal refs, dependency contradictions. Не оценивает
  качество — только consistency.

**B. `scope-guardian-reviewer`**
- `relatedStages: ["scope", "plan", "design"]`
- `activation: "proactive"`
- `model: balanced`
- `returnSchema: REVIEW_RETURN_SCHEMA`
- Body: spotlights "what already exists" (existing solutions / minimum change set /
  complexity smell test), scope-goal alignment, complexity challenge (new abstractions /
  custom vs existing / framework-ahead-of-need), priority dependency analysis.

**C. `feasibility-reviewer`**
- `relatedStages: ["plan", "design"]`
- `activation: "proactive"`
- `model: balanced`
- `returnSchema: REVIEW_RETURN_SCHEMA`
- Body: реалистичность ресурсов, времени, runtime conditions, environment
  assumptions, external dependencies availability, rollout risks.

#### 15.2 Расширить `StageSubagentName` union в `src/content/stages/schema-types.ts`

```ts
| "coherence-reviewer"
| "scope-guardian-reviewer"
| "feasibility-reviewer"
```

#### 15.3 Dispatch matrix

В `STAGE_AUTO_SUBAGENT_DISPATCH`:

- **scope**: `scope-guardian-reviewer` proactive (when: "When scope mode is SCOPE EXPANSION or SELECTIVE EXPANSION, or scope contract has many accepted ideas")
- **plan**: `coherence-reviewer` proactive (when: "When plan packets reference >1 subsystem or have >5 dependency edges"), `scope-guardian-reviewer` proactive (when: "When plan introduces new abstractions or generic utilities"), `feasibility-reviewer` proactive (when: "When plan has runtime/environment/resource assumptions")
- **design**: `coherence-reviewer` proactive (when: "When design touches multiple subsystems or has multiple alternatives sections"), `feasibility-reviewer` proactive (when: "When design assumes runtime conditions, scaling assumptions, or external service availability")
- **spec**: `coherence-reviewer` proactive (when: "When spec has >5 acceptance criteria or multiple assumption sections")

#### 15.4 Subagent context skills

Добавить в `src/content/subagent-context-skills.ts`:

- `document-coherence-pass`
- `document-scope-guard`
- `document-feasibility-pass`

Привязать к соответствующим dispatch rows через `skill: "..."`.

#### 15.5 Linter rule

В `src/artifact-linter/{plan,spec,design}.ts`:

- Если в `## Layered review` блоке упоминается, что был запущен один из новых
  ревьюеров, проверить наличие structured findings с calibrated formats
- Если ревьюер дал FAIL/PARTIAL — `[P1]` finding в линтере, требующий fix или
  explicit waiver

### Тесты

- Unit: рендер каждого нового агента содержит required sections
- Unit: dispatch matrix содержит все 4 новые строки
- Unit: linter ловит missing layered review для триггерных условий
- Smoke: `cclaw init` создаёт `.cclaw/agents/coherence-reviewer.md`,
  `scope-guardian-reviewer.md`, `feasibility-reviewer.md`

### Не делаем

- Не делаем `feasibility-reviewer` mandatory — только proactive
- Не дублируем функционал `spec-document-reviewer` — он остаётся, но фокус
  смещается на final plan-readiness pass; coherence-reviewer фокусируется на
  inter-section consistency

### Definition of Done

- 1 коммит: `feat(agents): add coherence/scope-guardian/feasibility document reviewers`
- Все тесты зелёные
- Smoke: 3 новых .md в `.cclaw/agents/`
- Linter ловит triggered-but-missing reviewer cases
- CHANGELOG обновлён

---

## Wave 16 — Skills-first Redistribution

### Цель

Сжать roster с 22 агентов (после Wave 15) до ~16 за счёт сворачивания
lens-роли в skill bundles. Каждое слияние сохраняет coverage через обязательные
секции в return / artifact, не теряя isolated dispatch там, где он реально нужен.

### Скоуп

#### 16.1 Слить `performance-reviewer + compatibility-reviewer + observability-reviewer` в `reviewer`

В `src/content/core-agents.ts`:

- Удалить три отдельных агента
- В `reviewer` body добавить обязательную секцию `## Lens Coverage`:
  ```
  Performance: NO_IMPACT / FOUND_<n>
  Compatibility: NO_IMPACT / FOUND_<n>
  Observability: NO_IMPACT / FOUND_<n>
  Security: routed to security-reviewer (always separate)
  ```
- В `STAGE_AUTO_SUBAGENT_DISPATCH` для review:
  - Удалить 3 dispatch rows для perf/compat/obs
  - В `reviewer` row добавить уточнение: "MUST cover all lenses (performance,
    compatibility, observability) inline; only escalate to dedicated lens skill
    when scope is large enough to justify"
- Добавить в `subagent-context-skills`:
  - `review-perf-lens`
  - `review-compat-lens`
  - `review-observability-lens`
- В dispatch row reviewer: `skill: "review-spec-pass"` остаётся, но добавляются
  conditional skills через triggers (через новый паттерн `additionalSkills?: [{when, skill}]`)

NB: Сохраняем возможность fan-out через **explicit user override**: если diff
очень большой, controller может всё равно дёрнуть отдельный perf/compat lens
parallel — но это становится exception, не default.

#### 16.2 Удалить `implementer`, оставить `slice-implementer`

`slice-implementer` получает дополнительный режим в body:

```
**Mode: TDD-bound** (default) — requires RED evidence, file boundaries from slice
**Mode: Generic** — when withTDD=false, only when explicitly invoked from quick-track
```

В quick/medium track skills упомянуть, что TDD пропускается, но
`slice-implementer` всё равно используется с режимом Generic.

В `STAGE_AUTO_SUBAGENT_DISPATCH` ничего не меняется (slice-implementer уже там).
В core-agents.ts удалить запись `implementer`.

#### 16.3 Слить `product-manager + product-strategist` в `product-discovery`

В `src/content/core-agents.ts`:

- Заменить два агента одним `product-discovery`
- Body содержит обязательные mode-секции:
  ```
  **Mode: discovery** (default) — persona / JTBD / value / metric / why-now
  **Mode: strategist** (triggered: scope mode = SCOPE EXPANSION or SELECTIVE EXPANSION)
    — 10x vision, expansion proposals, trajectory impact
  ```
- Dispatch matrix обновить:
  - brainstorm: `product-discovery` mandatory standard tier (mode=discovery)
  - scope: `product-discovery` proactive в обоих режимах с conditional `when`

#### 16.4 Удалить overlap в `enhancedAgentBody` (subagents.ts)

Перенести Task delegation templates прямо в `core-agents.ts` body каждого агента.
Удалить switch-case `enhancedAgentBody` из `subagents.ts`. Это убирает дрейф
между двумя точками правды.

#### 16.5 Обновить тесты, snapshots, linter

- Все unit-тесты на удалённых агентов — удалить или обновить
- Snapshot тесты `cclaw init` — обновить (меньше материализованных файлов)
- Linter rule: если в review артефакте отсутствует `## Lens Coverage` секция —
  `[P1] reviewer.lens_coverage_missing`

### Тесты

- Unit: только 1 reviewer + 1 security-reviewer + 1 release-reviewer
- Unit: только 1 slice-implementer (без implementer)
- Unit: только 1 product-discovery (без product-manager / product-strategist)
- Unit: enhancedAgentBody больше не существует
- Unit: linter ловит отсутствие Lens Coverage секции
- Smoke: `.cclaw/agents/` содержит 16 файлов (было 22 после Wave 15)

### Breaking changes

Это major version bump:

- Removed agent names: `performance-reviewer`, `compatibility-reviewer`,
  `observability-reviewer`, `implementer`, `product-manager`, `product-strategist`
- Migration guidance: existing artifacts с упоминанием этих агентов остаются
  валидными (их evidence сохраняется), но новые artifacts должны использовать
  `reviewer` с Lens Coverage и `product-discovery` с mode

### Definition of Done

- 2 коммита:
  1. `refactor(agents): consolidate review lenses into reviewer Lens Coverage`
  2. `refactor(agents): consolidate worker/discovery roles, drop enhancedAgentBody`
- Все тесты зелёные
- Smoke: 16 .md в `.cclaw/agents/`
- Major version bump
- CHANGELOG с migration notes
- Mempalace diary entry

### Не делаем

- НЕ удаляем `security-reviewer` (security всегда mandatory + isolated)
- НЕ удаляем `release-reviewer` (release readiness — отдельный domain)
- НЕ удаляем `fixer` (нужен fresh worker после review FAIL)
- НЕ меняем return schemas

---

## Wave 17 — Cohesion Contract + Integration Overseer

### Цель

Добавить артефакт-контракт перед параллельным fan-out и интегральную проверку
после, по образцу evanflow. Сейчас в cclaw нет writable cohesion contract,
только prose checklist в `dispatching-parallel-agents` skill.

### Скоуп

#### 17.1 Новый артефакт `cohesion-contract.md`

Path: `.cclaw/artifacts/cohesion-contract.md`. Опциональный (только когда
случается fan-out >2 параллельных subagents).

Шаблон:

```markdown
# Cohesion Contract — <wave / stage / topic>

## Shared Types & Interfaces
| Symbol | Path | Signature | Owner slice |
|---|---|---|---|

## Naming Conventions
- ...

## Invariants
- ...

## Integration Touchpoints
| From slice | To slice | Surface | Integration test name |
|---|---|---|---|

## Behavior Specifications per Slice
### Slice <n>: <description>
- test: <name>
  assert: <one-line assertion>
  surface: <public interface>

## Status
| Slice | Implemented | Tests pass | Cohesion verified |
|---|---|---|---|
```

#### 17.2 Новый агент `integration-overseer`

В `src/content/core-agents.ts`:

- `relatedStages: ["tdd", "review"]`
- `activation: "on-demand"`
- `model: balanced`
- `returnSchema: REVIEW_RETURN_SCHEMA`
- Body: dispatched после fan-out coder slices. Проверяет:
  - Все integration tests из contract passing
  - Naming conventions держатся across slices
  - Invariants не нарушены
  - Boundary types на touchpoints совпадают
  - Интеграция между slices работает
- Возвращает PASS / PASS_WITH_GAPS / FAIL / BLOCKED

#### 17.3 Расширить `StageSubagentName`

```ts
| "integration-overseer"
```

#### 17.4 Dispatch matrix + linter

В `STAGE_AUTO_SUBAGENT_DISPATCH` для tdd:

- `integration-overseer` proactive: `when: "When TDD fan-out used 2+ parallel slice-implementers, or when slices touch shared interfaces"`

Linter в `src/artifact-linter/tdd.ts`:

- Если в delegation ledger >1 `slice-implementer` за один stage → требовать
  существование `cohesion-contract.md` И запись `integration-overseer` с
  status PASS / PASS_WITH_GAPS
- Иначе — `[P1] tdd.cohesion_contract_missing` или `tdd.integration_overseer_missing`

#### 17.5 Template materialization

В `src/install.ts` или templates section — добавить генерацию
`templates/cohesion-contract.md` (бланк) только когда `cclaw init` создаёт его
вместе с другими шаблонами.

#### 17.6 Skill update

Обновить `dispatching-parallel-agents` skill (в `subagents.ts`): добавить
обязательный шаг "Author cohesion contract" перед fan-out, "Run integration
overseer" после fan-out.

### Тесты

- Unit: integration-overseer body, return schema
- Unit: linter ловит отсутствие cohesion-contract при >1 slice-implementer
- Unit: linter ловит отсутствие integration-overseer при fan-out
- Smoke: `.cclaw/agents/integration-overseer.md` существует
- Smoke: `.cclaw/templates/cohesion-contract.md` материализован

### Definition of Done

- 1 коммит: `feat(orchestration): cohesion contract artifact + integration-overseer`
- Все тесты зелёные
- Smoke: контракт template + новый агент
- Linter активен для fan-out cases
- CHANGELOG обновлён

### Не делаем

- НЕ делаем cohesion-contract обязательным для всех stages (только при fan-out)
- НЕ делаем integration-overseer mandatory — только on-demand при fan-out

---

## Wave 18 — Pre-planning Consultant + Architect Verification + Executing Waves Skill

### Цель

Закрыть три patterns из omo Metis + omx Ralph + evanflow без введения нового CLI:

1. Creative divergence перед сходимостью в brainstorm/scope (Metis-like)
2. Cross-stage cohesion gate в ship (architect-verification)
3. Documented persistence procedure для multi-wave работы (executing-waves skill)

### Скоуп

#### 18.1 Новый агент `divergent-thinker`

В `src/content/core-agents.ts`:

- `relatedStages: ["brainstorm", "scope"]`
- `activation: "proactive"`
- `model: balanced`
- `returnSchema: ADVISORY_RETURN_SCHEMA`
- Body:
  ```
  You are a creative divergent-thinker dispatched BEFORE planner/critic
  converge on a solution.

  Your job:
  1. Generate 3-5 alternative framings of the problem
  2. Generate 3-5 alternative solution approaches per framing (where reasonable)
  3. For each, give one-line pro/con + reversibility flag
  4. Highlight any framing/approach the user might not have considered
  5. Return concise structured output for planner/critic to consume

  Role boundary: divergence only. Do NOT recommend a single approach;
  do NOT validate feasibility (feasibility-reviewer does that);
  do NOT critique premise (critic does that).

  You are a deliberate amplifier of option-space; convergence happens after you.
  ```
- В `ADVISORY_RETURN_SCHEMA` использовать `recommendations[]` для альтернатив
- В dispatch matrix:
  - brainstorm: `divergent-thinker` proactive (when: "When brainstorm has >1
    candidate direction or user signals openness to alternatives")
  - scope: `divergent-thinker` proactive (when: "When scope mode is SCOPE
    EXPANSION or scope contract has <3 alternatives considered")

NB: Не temperature 0.3 (Track I не делается сейчас) — но в body явно прописываем
"быть expansive, не сходиться". Это работает на уровне prompt, не модели.

#### 18.2 Architect verification gate в ship

В `src/content/stage-schema.ts` для ship добавить proactive dispatch row:

```ts
{
  agent: "architect",
  mode: "proactive",
  when: "Always before final release — verify cross-stage cohesion: scope -> design -> spec -> plan -> code consistency",
  purpose: "Final cross-stage cohesion gate: catches drift between locked artifacts and shipped code before ship is committed",
  requiresUserGate: false,
  skill: "architect-cross-stage-verification"
}
```

Новый skill `architect-cross-stage-verification` в `subagent-context-skills.ts`:

- Architect читает scope/design/spec/plan/review артефакты
- Проверяет, что shipped code соответствует locked decisions
- Возвращает CROSS_STAGE_VERIFIED / DRIFT_DETECTED / BLOCKED
- Drift-detected → ship blocks до или waiver, или patch

В `src/artifact-linter/ship.ts`:

- Если артефакт ship не содержит ссылку на architect cross-stage verification →
  `[P2] ship.cross_stage_cohesion_missing`

#### 18.3 Executing-waves skill

Создать новый top-level skill в `src/content/skills.ts` (генератор) и
`src/install.ts` (материализация):

Path: `.cclaw/skills/executing-waves/SKILL.md`

Контент:

```markdown
---
name: executing-waves
description: "Execute multi-wave work using existing cclaw run resume + verify-current-state — no new CLI needed."
---

# Executing Waves (Persistent Multi-Wave Work)

## Overview

Long-form work (large refactors, multi-stage uplifts) often spans many waves.
This skill documents how the controller persists work across waves WITHOUT new
CLI commands, using existing `cclaw run resume` and `internal verify-current-state`.

## When to Use

- Work spans 2+ commits / waves with cohesion concerns between waves
- Each wave has its own stage cycle (brainstorm -> ... -> ship)
- User wants explicit per-wave verification before next wave starts
- Risk of cross-wave drift exists

## Anti-Pattern

- Running 5 waves linearly without verification between them — accumulates drift
- Treating "wave" as just a commit boundary without re-verification of upstream
  decisions still holding

## Process

1. **Wave Start**: Author wave plan as `.cclaw/wave-plans/<wave-n>.md`
   referencing previous wave's ship artifact
2. **Carry-forward Audit**: At brainstorm of next wave, controller MUST re-read
   previous wave's ship artifact and explicitly state:
   - Carrying forward: <list of locked decisions still valid>
   - Drift detected: <list of decisions no longer valid + reason>
   - Re-scope needed: <yes/no>
3. **Resume Path**: If wave was interrupted mid-stage, `cclaw run resume`
   restores state. Controller MUST run `internal verify-current-state` before
   continuing — confirms all stage gates / evidence still valid.
4. **Wave End**: At ship, architect cross-stage verification runs (auto from
   dispatch matrix). If DRIFT_DETECTED, fix before ship.
5. **Next Wave Trigger**: New `/cc <topic>` for next wave. Controller MUST
   reference previous wave's ship artifact in upstream-handoff.

## Status Markers

- `wave-status: in-progress` — current stage incomplete
- `wave-status: blocked-by-prev` — waiting on previous wave's verification
- `wave-status: shipped` — wave shipped, next wave can start
- `wave-status: rolled-back` — previous wave invalidated, current wave needs rebase

## Linter Hooks

- If multi-wave work detected (>1 wave-plan files in `.cclaw/wave-plans/`),
  current wave artifact MUST contain `## Wave Carry-forward` section with
  drift audit
- If carry-forward references locked decision that subsequent wave changed,
  `[P1] wave.drift_unaddressed`
```

Соответствующий linter rule в `src/artifact-linter/brainstorm.ts` (или новый
shared module): если детектируется multi-wave context (через переменную окружения
или наличие `.cclaw/wave-plans/`), требуется wave carry-forward block.

#### 18.4 Обновить existing materialization

В `src/install.ts`:

- Создать `.cclaw/wave-plans/` директорию (опциональная, без файлов по умолчанию)
- Материализовать `executing-waves` skill в `.cclaw/skills/executing-waves/SKILL.md`

В `src/content/subagents.ts` — добавить ссылку на executing-waves skill в
`Anti-Drift Team Defaults` секцию.

### Тесты

- Unit: divergent-thinker body, return schema
- Unit: architect dispatch row для ship добавлен
- Unit: linter ловит отсутствие cross-stage verification в ship
- Unit: executing-waves skill генерируется
- Smoke: 3 новых файла появляются в `.cclaw/`
- Smoke: при наличии 2+ wave-plans, brainstorm artifact требует carry-forward

### Definition of Done

- 1 коммит: `feat(orchestration): divergent-thinker, architect verification gate, executing-waves skill`
- Все тесты зелёные
- Smoke: новый агент + новый gate + новый skill
- Никаких новых CLI команд
- CHANGELOG обновлён

### Не делаем

- НЕ добавляем `/cc continue`, `cclaw run continue`, или подобные команды
- НЕ ставим temperature: 0.3 для divergent-thinker (это Track I)
- НЕ делаем architect verification mandatory если track == quick (только standard/deep)

---

## Сводная таблица итога после Wave 18

| Слой | До | После |
|---|---|---|
| Агенты в core-agents | 19 | 16 |
|   - reviewer family | 6 (reviewer + perf + compat + obs + security + release) | 3 (reviewer with Lens Coverage + security-reviewer + release-reviewer) |
|   - workers | 3 (slice + implementer + fixer) | 2 (slice + fixer) |
|   - product | 2 (manager + strategist) | 1 (product-discovery with modes) |
|   - document review | 1 (spec-document-reviewer) | 4 (+ coherence + scope-guardian + feasibility) |
|   - new | 0 | 2 (divergent-thinker + integration-overseer) |
| Subagent context skills | 6 | ~12 (+ critic-multi-perspective + 3 lens skills + 3 doc-review skills + architect-cross-stage-verification) |
| Top-level skills | ~10 stages + 5 cross-cutting | + executing-waves |
| Артефакты | 8 stages | + cohesion-contract.md (опциональный) |
| Гейты | per-stage | + ship architect-verification gate |
| CLI | unchanged | unchanged (Track IV без CLI) |

## Что НЕ делаем в этом блупринте

- Track I (concrete model IDs / temperature / fallback chains / tool denylist) —
  отдельный track, требует решения по конфигу моделей
- Stack-specialist architects (kieran-rails, dhh-rails) — слишком специфично, у нас
  есть `stack-aware-review` skill, который покрывает базу
- Business-panel из 9 thinker персон (superclaude) — слишком тяжело для default flow;
  можно добавить позже как опциональный skill для high-stakes scope decisions
- Persistence loop как CLI (`/cc continue`) — пользователь явно сказал no
- Code graph / Qdrant infra (socraticode) — другая парадигма, не наш домен

## Зависимости между waves

- **Wave 14 → 15**: критик расширяется ДО добавления других reviewer'ов —
  иначе его роль непонятна на фоне 3 новых
- **Wave 15 → 16**: новые агенты добавляются ДО консолидации — иначе
  скриптовая часть консолидации была бы сложнее (новые dispatch rows
  смешивались бы с удаляемыми)
- **Wave 16 → 17**: redistribution ДО integration-overseer — иначе integration-
  overseer был бы добавлен на фоне «лишних» reviewer'ов
- **Wave 17 → 18**: cohesion contract ДО executing-waves — wave carry-forward
  использует те же patterns

## Definition of Done для всего блупринта

- 5 PR-ов, по одному на wave (Wave 16 = 2 коммита внутри одного PR)
- Все тесты зелёные на каждом PR
- Smoke-test'ы проходят на fresh project init
- `cclaw runtime-integrity` — clean
- `graphify update .` — applied
- Mempalace diary entries — по одному на wave
- CHANGELOG.md — section per wave
- Major version bump на Wave 16 PR (breaking agent removals)

## Open Questions (на рассмотрение перед стартом)

1. **Wave 16 major bump**: создаст ли это проблемы для downstream проектов с
   pinned `cclaw-cli` версиями? — обычно `cclaw` — dev tool, не runtime dep,
   так что low impact, но стоит подтвердить.
2. **Wave 17 cohesion contract — формат**: markdown с таблицами достаточно, или
   нужен JSON для machine-checking? Вероятно markdown с linter-парсингом
   таблиц (как сейчас в plan/spec).
3. **Wave 18 architect-verification — стоимость**: добавляет ещё один deep-tier
   запуск к ship. Если ship часто запускается на trivial fixes, может быть
   избыточно. Решение: добавить track-aware dispatch (только standard/deep).
