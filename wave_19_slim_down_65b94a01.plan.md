# Wave 19 — Slim-down (cclaw over-engineering cleanup)

> Цель: убрать накопившийся over-engineering, который не несёт реального
> профита. Это идёт ПАРАЛЛЕЛЬНО блупринту 14-18 (agents/skills overhaul),
> поскольку трогает разные подсистемы. Можно делать в любом порядке
> относительно 14-18 — рекомендую запускать ДО Wave 14, чтобы новые агенты
> добавлялись на чистом фундаменте.

## Принципы

1. **Validate before delete** — перед удалением system'ы проверить, что
   нет real consumer'а (linter rule, hook handler, downstream user)
2. **Pure deletion first, refactor last** — Pass A = чистые удаления без
   изменения поведения; Pass B = consolidation поведения; Pass C =
   архитектурные refactor'ы
3. **No behavior regression** — после каждого pass'а полный smoke + runtime
   integrity check
4. **Major bump only где нужно** — knowledge schema slim — major;
   trace-matrix drop — minor (артефакт удаляется, но нет breaking API);
   остальное — patch

## Контрольные метрики

| Метрика | До | Цель после |
|---|---|---|
| Suммарный LOC в src/ | ~36173 | ~32000 (-11%) |
| Knowledge schema поля | 12+ | 6-7 |
| Idea-* файлы | 3 | 1 |
| Examples LOC | 1045 | ~400 |
| Trace matrix LOC | 286 + 280 test | 0 |
| Closeout substates | 5 | 4 |
| Hook inline snippets parity tests | 2 | 0 (через bundle) |

---

# Pass A — Чистые удаления (zero behavior risk)

## 19A.1 — Trace Matrix Drop

### Validation step (обязателен перед удалением)

1. `grep -rn "trace-matrix\|TraceMatrix\|01-trace\|trace-matrix.json"` по
   всему репозиторию (вне `tests/` и `trace-matrix.ts` самого) — должно дать 0
2. Проверить, нет ли linter rule в `src/artifact-linter/*.ts` который читает
   trace-matrix
3. Проверить, нет ли hook handler в `node-hooks.ts` который читает
   trace-matrix
4. Проверить historical references в CHANGELOG / RELEASE-NOTES — был ли
   commit, который advertise'ит trace-matrix как public feature

Если все проверки чистые → переход к удалению.

### Скоуп

#### 19A.1.1 Удалить файлы

- `src/trace-matrix.ts`
- `tests/unit/trace-matrix.test.ts`

#### 19A.1.2 Удалить импорты и references

- `src/install.ts` — найти и удалить генерацию trace-matrix.json
- Любые re-exports из barrel files
- Stage schemas — если есть `crossStageTrace` ссылающийся на trace-matrix
- Если есть mention в `src/content/skills.ts` — удалить

#### 19A.1.3 Update tests

- Если `tests/unit/install.test.ts` или smoke tests проверяли существование
  `trace-matrix.json` — удалить эти проверки

### Definition of Done

- 1 commit: `chore(trace-matrix): drop unused trace matrix subsystem`
- Все тесты зелёные
- Smoke: `cclaw init` не создаёт `trace-matrix.json`
- `tests/unit/runs.test.ts` (если касается archive) — runs archive не
  включает trace-matrix.json
- ~570 LOC удалено

---

## 19A.2 — Examples Matrix Slim

### Цель

`src/content/examples.ts` (1045 LOC) слим до ~400 LOC через сокращение
4-domain × 8-stage matrix до 1-2 representative examples per stage.

### Скоуп

#### 19A.2.1 Audit

Прочитать `STAGE_DOMAIN_SAMPLES` per stage, выбрать на каждую стадию:

- 1 generic example (web или library — most common case)
- 1 domain-specific только если он показывает уникальный pattern,
  не покрытый generic

Стадии: brainstorm, scope, design, spec, plan, tdd, review, ship.

#### 19A.2.2 Restructure

```ts
const STAGE_EXAMPLES: Record<FlowStage, StageExample[]> = {
  brainstorm: [
    { label: "Direction", body: "..." },
    // optionally one more if truly distinct
  ],
  // ...
};
```

Удалить `ExampleDomain` тип, `DOMAIN_LABELS`, `stageDomainExamples`.

#### 19A.2.3 Update consumers

- `stageExamples()` функция: упростить до single example block per stage
- `stageGoodBadExamples()` — оставить, это другая система
- `stageFullArtifactExampleMarkdown()` — оставить, это full template example

### Definition of Done

- 1 commit: `refactor(examples): drop 4-domain matrix, keep 1-2 representative examples per stage`
- Все snapshot tests обновлены
- Smoke: stage skill markdown содержит 1-2 examples per stage, generic пример читается
- ~600 LOC удалено

---

## 19A.3 — Knowledge Schema Slim

### Цель

Сократить `KnowledgeEntry` schema до core fields. Убрать speculative
dimensions, у которых нет real consumer.

### Validation step

1. `grep -rn "universality\|maturity\|supersedes\|superseded_by"` — найти
   все consumers
2. Если consumer = только validator + writer, и нет linter rule или
   skill секции которая читает эти поля — это speculative
3. Проверить, есть ли CLI команда или skill-doc, которая фильтрует/сортирует
   knowledge entries по этим полям
4. Проверить knowledge digest injection — какие поля реально попадают в
   контекст агенту

### Скоуп

#### 19A.3.1 Поля под удаление

- `universality: "project" | "personal" | "universal"` — speculative
  taxonomy. Проект вообще единственный context — `personal`/`universal`
  никогда не использовались. Удалить целиком.
- `maturity: "raw" | "lifted-to-rule" | "lifted-to-enforcement"` —
  theoretical pipeline. Lifting реально не происходит автоматически.
  Удалить.
- `supersedes[]` + `superseded_by` — append-only store с supersedes
  не имеет смысла; нет ни одного consumer'а supersedes chain'а.
  Удалить или заменить простым `replaces?: string` (single, не chain).
- `origin_run` — uniquely identifies run, но не используется в digest
  selection. Удалить если нет consumer'а.
- `domain` — почти всегда `null`. Удалить.

#### 19A.3.2 Поля сохраняем

```ts
interface KnowledgeEntry {
  type: "rule" | "pattern" | "lesson" | "compound";
  trigger: string;
  action: string;
  confidence: "high" | "medium" | "low";
  severity?: "critical" | "important" | "suggestion";
  stage: FlowStage | null;
  origin_stage: FlowStage | null;
  frequency: number;
  created: string;
  first_seen_ts: string;
  last_seen_ts: string;
  source?: "stage" | "retro" | "compound" | "idea" | "manual" | null;
}
```

#### 19A.3.3 Migration path

- JSONL — append-only, поэтому historical entries останутся в файле
- Validator должен принимать legacy entries (с removed полями) как valid,
  игнорировать removed поля
- При записи новых entries — не писать removed поля
- Нет migration script — JSONL не нужен schema-rewrite

#### 19A.3.4 Update consumers

- `compound-readiness.ts` — если использует `universality`, переделать на
  только `frequency`
- `knowledge-store.ts` — `appendKnowledge` validator упростить
- `learnings.ts` skill markdown — обновить descriptions удалённых полей
- `retro-gate.ts` — если использует `maturity`, переделать
- `tests/unit/knowledge-store.test.ts` — обновить fixtures

### Definition of Done

- 1 commit: `refactor(knowledge): drop universality/maturity/supersedes — keep core schema`
- Все тесты зелёные (включая legacy-entry compatibility)
- Smoke: append/read works for both legacy и new entries
- Knowledge digest selection не сломан
- Major version bump (breaking schema)
- CHANGELOG с migration notes
- ~250 LOC reduced + проще validators

---

## 19A.4 — Idea System Slim

### Цель

`/cc-idea` — опциональная команда вне основного flow. Сейчас 3 файла,
6 frames, scoring formula с rationale × counter-argument. Свести к простой,
читаемой системе.

### Скоуп

#### 19A.4.1 Объединить файлы

Создать новый `src/content/idea.ts` объединяющий:

- `idea-frames.ts` (197 LOC)
- `idea-ranking.ts` (107 LOC)
- `idea-command.ts` (339 LOC)

→ единый файл ~250 LOC.

#### 19A.4.2 Сократить frames с 6 до 3

Оставить:

- `pain-friction` — самый используемый
- `assumption-break` — adversarial lens
- `cross-domain-analogy` — generative lens

Удалить:

- `inversion`
- `leverage`
- `constraint-flip`

(Эти три — variants `assumption-break` по сути.)

#### 19A.4.3 Упростить ranking

Удалить:

- Формула `(IMPACT_POINTS / EFFORT_COST) * CONFIDENCE_MULTIPLIER`
- `rationaleStrength` × `counterArgumentStrength` clamping

Заменить на:

```ts
type IdeaDisposition = "survivor" | "rejected";

function classifyIdea(idea: IdeaInput): IdeaDisposition {
  // Простая логика: rejected if (effort=l && impact=low) || confidence=low
  // или explicit user reject
}
```

Sorting survivors — по `impact` enum (high>medium>low), при равенстве — по
`effort` (s>m>l).

#### 19A.4.4 Update tests

- `tests/unit/idea-frames.test.ts` — обновить frame list
- `tests/unit/idea-ranking.test.ts` — обновить scoring expectations
- `tests/unit/idea-command.test.ts` — обновить command contract output

#### 19A.4.5 Update skill markdown

- В новом `idea.ts` — `flow-idea` skill markdown упростить, убрать упоминания
  rationale strength formula
- `decision-protocol.ts` — `ideaStructuredAskToolsWithFallback` остаётся

### Definition of Done

- 1 commit: `refactor(idea): consolidate 3 files into one, slim frames/ranking`
- Все тесты зелёные
- Smoke: `cclaw init` создаёт `flow-idea` skill markdown с 3 frames, простой
  ranking
- ~300 LOC уменьшено

---

# Pass B — Consolidation поведения (low-medium risk)

## 19B.1 — Closeout Substate Merge

### Validation step

1. `grep -rn 'retro_review\|compound_review\|shipSubstate'` — найти все
   места, которые читают/пишут substate
2. Проверить, есть ли user-visible difference между retro_review и
   compound_review (отдельные questions, отдельные UI states, etc.)
3. Если оба substates просто linear pass-through, merge безопасен

### Скоуп

#### 19B.1.1 Substate machine update

В `src/content/closeout-guidance.ts` и `src/run-archive.ts`:

```ts
// Было:
type ShipSubstate = "idle" | "retro_review" | "compound_review" | "ready_to_archive" | "archived";

// Станет:
type ShipSubstate = "idle" | "post_ship_review" | "ready_to_archive" | "archived";
```

`post_ship_review` объединяет:

- Retro draft + accept/edit/skip
- Compound learning scan + apply/skip per cluster

#### 19B.1.2 Closeout flow

Один substate `post_ship_review` имеет структурированный multi-question flow:

1. Q1: Retro draft accept / edit / skip
2. Q2: Compound learning scan apply / skip per cluster
3. After all answered → advance to `ready_to_archive`

#### 19B.1.3 Retro-gate simplification

`src/retro-gate.ts` (160 LOC) упростить:

- Убрать mtime fallback ±7 days window
- Убрать complex retroSkipped + retroSkipReason + compoundSkipped flags
- Свести к: `retroComplete = (retroAccepted || retroSkipped) && (compoundReviewed || compoundSkipped)`

#### 19B.1.4 Migration

- Existing `flowState.closeout.shipSubstate === "retro_review"` →
  treat as `"post_ship_review"`
- `flowState.closeout.shipSubstate === "compound_review"` →
  treat as `"post_ship_review"` + flag `retro_done: true`

#### 19B.1.5 Update tests

- `tests/unit/runs.test.ts` (37K) — обновить substate transitions
- `tests/unit/internal-advance-stage.test.ts` (54K) — обновить ship advance scenarios

### Definition of Done

- 1 commit: `refactor(closeout): merge retro_review + compound_review into post_ship_review`
- Все тесты зелёные
- Smoke: post-ship flow correctly progresses через retro + compound в одном
  substate
- Backward compat для existing flow-state.json
- ~120 LOC reduced

---

## 19B.2 — Reconciliation Notices Drop (validation-gated)

### Validation step

**Критический шаг**: проверить, использовалась ли система в production.

1. `grep -rn "ReconciliationNotice\|reconciliation-notices.json"` для
   inventory
2. Проверить, есть ли test suite, который simulates real edge case
3. Проверить, есть ли в CHANGELOG mention о фиксе bug, который relied on
   reconciliation system
4. Спросить пользователя: были ли real-world hits в production
   (`gate_demotion` или `closeout_substate_demotion` notices created)?

**Если real-world hits были** → не удалять, оставить как есть
**Если real-world hits не было** → удалять

### Скоуп (если удаляем)

#### 19B.2.1 Удалить из gate-evidence.ts

- `ReconciliationNotice` interface
- `ReconciliationNoticesPayload`
- `ReconciliationNoticeBuckets`
- `classifyReconciliationNotices` function
- `RECONCILIATION_NOTICES_FILE` constant

#### 19B.2.2 Удалить writer

- `src/run-archive.ts` — `RECONCILIATION_NOTICES_FILE` removal из snapshot exclusion list
- Любой места, который writes `reconciliation-notices.json`

#### 19B.2.3 Cleanup state

- На `cclaw init` cleanup в `src/install.ts` — убрать создание/проверку
  файла
- `internal verify-current-state` — убрать чтение

### Definition of Done

- 1 commit (conditional): `chore(reconciliation): drop unused reconciliation notices subsystem`
- Все тесты зелёные
- Smoke: post-init состояние не содержит `reconciliation-notices.json`
- ~200 LOC reduced

### Альтернатива (если real hits были)

Документировать use case явно в коде, добавить test case покрывающий
реальный hit, оставить subsystem.

---

## 19B.3 — Language Rule Packs Simplify

### Validation step

1. Проверить config: какие пользователи opt-in'ятся в `languageRulePacks`?
2. Если usage низкий — упростить
3. Если usage высокий — оставить как есть

### Скоуп (если упрощаем)

#### 19B.3.1 Свести `utility-skills.ts` (295 LOC) до stub

```ts
export function languageTypescriptSkill(): string {
  return `---
name: language-typescript
description: "TypeScript review lens. Activate during tdd or review for .ts/.tsx/.mts/.cts/.js files."
---

# TypeScript Review Lens

See [TypeScript handbook](https://www.typescriptlang.org/docs/) for canonical
guidance. Stage skills (review, tdd) embed core TypeScript discipline:

- No silent \`any\` — narrow \`unknown\` first
- Runtime validate trust boundaries (zod / valibot / io-ts)
- Exhaustive switches on discriminated unions
- Promise hygiene (no floating)
- Null-safety at boundaries

Use this skill name in delegation context when reviewer focuses on
TypeScript-specific patterns.
`;
}
```

Аналогично `languagePythonSkill` — link на PEP 484, краткий core list.

#### 19B.3.2 Альтернатива: убрать целиком

Если language packs используются <5% — вообще удалить, оставить только
`stack-aware-review` skill в reviewer'е (который уже есть).

### Definition of Done

- 1 commit: `refactor(language-packs): simplify TS/Python rule packs to stub`
- ~250 LOC reduced
- Existing opt-in users получают slimmer pack без regression

---

# Pass C — Архитектурные refactor'ы (medium risk)

## 19C.1 — OpenCode Plugin Shared Extraction

### Цель

`src/content/opencode-plugin.ts` (728 LOC) дублирует много logic из
`src/content/node-hooks.ts` (1853 LOC): readFlowState, knowledge digest read,
review prompt logic. Extract в shared modules, чтобы единый source of truth.

### Скоуп

#### 19C.1.1 Identify duplicated logic

Compare `opencode-plugin.ts` и `node-hooks.ts` — найти overlap'ы:

- Flow state reading
- Knowledge entries iteration
- Review prompt file path resolution
- Logging helper (file-based, not console)
- Active artifact path discovery

#### 19C.1.2 Extract в shared module

Создать `src/content/runtime-shared-snippets.ts`:

```ts
export const SHARED_FLOW_STATE_READER = `function readFlowState(filePath) {...}`;
export const SHARED_KNOWLEDGE_ITERATOR = `function iterateKnowledge(filePath, predicate) {...}`;
export const SHARED_REVIEW_PROMPT_RESOLVER = `function resolveReviewPromptPath(...) {...}`;
```

И в `node-hooks.ts` + `opencode-plugin.ts` — interpolate эти constants.

#### 19C.1.3 Update parity

Если есть parity tests между `opencode-plugin.ts` и `node-hooks.ts`,
обновить — или их можно удалить, потому что shared snippets
устраняют необходимость parity check.

### Definition of Done

- 1 commit: `refactor(runtime): extract shared snippets between OpenCode plugin and node hooks`
- Все тесты зелёные
- Smoke: OpenCode hook + Claude/Cursor/Codex hooks все работают
- ~150 LOC дедупликация (не reduction)

---

## 19C.2 — Hook Inline Snippets via esbuild Bundle

### Цель

Убрать `src/content/hook-inline-snippets.ts` (520 LOC) дублирование
TS canonical (compound-readiness, ralph-loop, early-loop) через bundle
`run-hook.mjs` с реальными импортами cclaw-cli.

### Validation step

Подтвердить, что run-hook.mjs всегда исполняется в контексте, где cclaw-cli
installed (т.е. `node_modules/cclaw-cli` доступен). Если есть use case standalone
(без node_modules) — bundle решит, но нужно правильно сгенерить bundle.

### Скоуп

#### 19C.2.1 Setup bundling

Добавить в `package.json`:

```json
"scripts": {
  "build:hook-bundle": "esbuild src/runtime/run-hook.entry.ts --bundle --platform=node --format=esm --outfile=dist/runtime/run-hook.mjs"
}
```

(или аналогичный config через rollup/tsup, в зависимости от существующего build setup)

#### 19C.2.2 Создать source файл

Создать `src/runtime/run-hook.entry.ts` импортирующий canonical:

```ts
import { computeCompoundReadiness } from "../knowledge-store.js";
import { computeRalphLoopStatus } from "../tdd-cycle.js";
import { computeEarlyLoopStatus } from "../early-loop.js";

// Hook event router that calls these functions directly
async function main() {
  const event = JSON.parse(process.env.HOOK_EVENT_JSON || "{}");
  // ... handle event with imported functions
}
main();
```

#### 19C.2.3 Update install.ts

- При `cclaw init` копировать bundled `dist/runtime/run-hook.mjs` в
  `<project>/.cclaw/hooks/run-hook.mjs`
- Удалить interpolation из `node-hooks.ts` (interpolation остаётся для
  parts, которые не bundled — например, harness-specific event mapping)

#### 19C.2.4 Удалить hook-inline-snippets.ts

- `src/content/hook-inline-snippets.ts` (520 LOC) — удалить
- `tests/unit/ralph-loop-parity.test.ts` (13.6K) — удалить
- `tests/unit/early-loop-parity.test.ts` (6.7K) — удалить
- `compound-readiness-parity.test.ts` (если существует) — удалить

### Definition of Done

- 1 commit: `refactor(hooks): bundle run-hook.mjs with esbuild, drop inline snippets parity`
- Все тесты зелёные
- Smoke: `cclaw init` → `.cclaw/hooks/run-hook.mjs` работает на Claude /
  Cursor / Codex / OpenCode (если применимо)
- bundle size sanity check (run-hook.mjs не должен быть огромным)
- ~520 LOC + ~20K test LOC removed

### Risks

- **Compatibility**: если в каких-то edge cases run-hook.mjs запускается
  без cclaw-cli установлен (e.g. в shared CI runner), bundle снимает эту
  зависимость
- **Bundle size**: если зацепится много transient deps, проверить tree-shake
- **node_modules path**: убедиться, что bundle самодостаточен

---

## Сводная таблица итога после Wave 19

| Pass | Sub-wave | LOC reduced | Risk | Commit |
|---|---|---|---|---|
| A | 19A.1 trace-matrix | -570 | Zero | chore |
| A | 19A.2 examples slim | -600 | Zero | refactor |
| A | 19A.3 knowledge slim | -250 + lighter validators | Low | refactor (major) |
| A | 19A.4 idea slim | -300 | Low | refactor |
| B | 19B.1 closeout merge | -120 | Medium | refactor |
| B | 19B.2 reconciliation drop | -200 (conditional) | Low (after validation) | chore |
| B | 19B.3 language packs slim | -250 | Low | refactor |
| C | 19C.1 OpenCode extract | dedup ~150 | Medium | refactor |
| C | 19C.2 hook bundle | -520 + 20K test | Medium | refactor |

**Итог:** ~2810 LOC source + ~20K LOC test reduction. Major bump на 19A.3.

## Зависимости

- 19A.1, 19A.2, 19A.4 — независимые, можно делать параллельно
- 19A.3 — независимая, но major bump → отдельный PR
- 19B.1 → требует 19A.3 быть merged (knowledge schema используется в retro-gate)
- 19B.2 → независимая, validation-gated
- 19B.3 → независимая
- 19C.1 → независимая
- 19C.2 → требует bundle infrastructure setup, независим от других

## Порядок PR (рекомендуемый)

1. PR 19a: trace-matrix drop (lowest risk)
2. PR 19b: examples slim
3. PR 19c: idea system slim
4. PR 19d: knowledge schema slim (major bump)
5. PR 19e: closeout substate merge
6. PR 19f: reconciliation drop (после validation)
7. PR 19g: language packs simplify
8. PR 19h: OpenCode shared extraction
9. PR 19i: hook bundle (largest impact, validate carefully)

Каждый PR — атомарный commit (или 1-2 атомарных коммита).

## Что НЕ делаем в Wave 19

- **Stage tracks (lightweight/standard/deep) simplification** — это
  отдельная stage-level decision, не slim-down
- **Stage schema v2 nested grouping** — recent intentional design, оставляем
- **Hook events 3 harness × 7 handlers** — necessary integration cost
- **Iron Laws strict mode** — core feature, оставляем
- **Workflow-guard hook** — Iron Law enforcement, оставляем

## Definition of Done для всего Wave 19

- 9 PR (можно сгруппировать в 3 batch'а по pass'ам)
- Все тесты зелёные на каждом PR
- `cclaw runtime-integrity` clean
- `graphify update .` applied
- Mempalace diary entry per pass (3 шт)
- CHANGELOG.md sections per sub-wave
- Major version bump на 19A.3 (knowledge schema slim)
- Validation steps выполнены ДО удалений (19B.2, 19C.2)

## Open Questions

1. **19A.3 knowledge schema slim — backward compat strategy**: legacy entries
   (с `universality`, `maturity`, `supersedes`) остаются в JSONL, новые без них.
   Validator должен accept'ить оба варианта. Подтвердить, что digest selection
   не сломается на mixed-schema entries.

2. **19B.2 reconciliation notices — real-world hits**: пользователь должен
   подтвердить, были ли когда-нибудь созданы `reconciliation-notices.json`
   с непустым notices array в production. Если да — pivot на validation
   coverage instead of drop.

3. **19C.2 hook bundle — esbuild setup**: проверить existing build pipeline.
   Если там tsup или rollup, использовать тот же tool. Если только tsc — нужно
   добавить esbuild как dev dependency.

4. **Combined 14-19 ordering**: блупринт 14-18 добавляет агентов и skills.
   Если делать 19 ДО 14, новые агенты добавятся уже на slim foundation.
   Если делать 14-18 первым, slim-down будет резать также те части (например,
   `enhancedAgentBody`), которые уже трогались в Wave 16. Рекомендация:
   **19A → 14 → 19B → 15-18 → 19C** для минимального merge conflict'а.
