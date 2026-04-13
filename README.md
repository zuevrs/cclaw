# cclaw

**A focused, installer-first workflow that turns AI coding sessions into predictable shipped outcomes.**

`cclaw` gives your agent one clear path:
**brainstorm -> scope -> design -> spec -> plan -> test -> build -> review -> ship**

No giant command jungle. No runtime daemon. No process theater.
Just a disciplined flow that stays lightweight and works across major coding harnesses.

## How It Works

```mermaid
flowchart LR
    A[Idea] --> B[Brainstorm]
    B --> C[Scope]
    C --> D[Design]
    D --> E[Spec]
    E --> F[Plan]
    F --> G[Test]
    G --> H[Build]
    H --> I[Review]
    I --> J[Ship]
```

```mermaid
sequenceDiagram
    participant U as User
    participant H as Harness
    participant V as cclaw Hooks + Skills
    participant S as State + Learnings
    U->>H: /cc-brainstorm
    H->>V: Load stage contract + HARD-GATE
    V->>S: Read context (state/learnings)
    V-->>H: Structured execution guidance
    H->>S: Write artifacts + checkpoint
    S-->>U: Next stage is explicit
```

## Why `cclaw` Wins In Practice

- **Low cognitive load:** one canonical stage flow instead of dozens of competing paths.
- **Installer-first architecture:** generates files and hooks; does not run a hidden control plane.
- **Hard-gated quality:** each stage has non-skippable constraints that reduce AI drift.
- **Cross-harness parity:** same behavior model across Claude Code, Cursor, Codex, OpenCode.
- **Compounding context:** flow state + learnings get rehydrated on new sessions automatically.
- **Run-scoped execution:** each flow works against an active run with explicit handoff state.

## Compared To Top References

| System | Strongest trait | Where `cclaw` is better |
|---|---|---|
| **Superpowers** | Rich skill ecosystem and mature workflows | Smaller operational surface, tighter stage discipline, faster onboarding for teams that want one default path |
| **G-Stack** | Deep multi-role orchestration (CEO/design/eng/release style) | Less overhead, fewer moving parts, easier to keep deterministic in day-to-day product delivery |
| **Everything Claude Code** | Broad command catalog and flexible patterns | Lower command entropy, clearer defaults, less decision fatigue for regular execution |

`cclaw` is intentionally opinionated: it optimizes for **signal over volume**.

## 60-Second Start

```bash
npx cclaw init
```

Then run in your harness:

```text
/cc-brainstorm
```

Core installer lifecycle:

```bash
npx cclaw sync
npx cclaw doctor
npx cclaw upgrade
npx cclaw uninstall
```

## What Gets Generated

```text
.cclaw/
├── skills/
├── commands/
├── hooks/
├── templates/
├── artifacts/                # active mirror for current run (fallback path)
├── state/
├── runs/
│   └── <activeRunId>/
│       ├── artifacts/        # canonical run artifacts
│       ├── run.json
│       └── 00-handoff.md
└── learnings.jsonl
```

## License

[MIT](./LICENSE)
