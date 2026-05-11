---
name: anti-slop
trigger: always-on for any code-modifying step (slice-builder, fix-only, recovery)
---

# Skill: anti-slop

cclaw takes its lean ethos seriously: **no busywork, no fake fixes, no fake progress.** This skill applies whenever you are writing code, modifying tests, debugging a build/lint/test failure, or running verification commands.

## When NOT to apply

- **You actually changed code between two runs of the same command.** Running `npm test` after editing a source file is normal TDD-cycle behaviour, not redundant verification — the input changed.
- **You added a documented `// eslint-disable` / `# noqa` with a one-line justification AND a follow-up issue id.** The justification is what distinguishes "informed suppression" from slop.
- **You are mocking at the test boundary** (`vi.mock("./db")` inside a test file, not in production). The location matters — boundary mocks aren't shims.
- **You are running a different tool after the first one passed** (`tsc --noEmit` after `npm test`). That is a different gate, not a re-run of the same command.
- **The "fallback" really is the documented contract** (e.g. `value ?? defaultValue` where the default is in the spec). Fallbacks that hide unknown failure modes are slop; fallbacks that codify documented defaults are not.

## Two iron rules

### 1. No redundant verification

Do not re-run the same build, test, or lint command twice in a row without a code or input change in between. The result will not change. If a check failed, change something — or stop and report the failure as a finding.

**What counts as a "change":**

- modified production source
- modified test file
- modified config / fixture / lockfile
- different argument set passed to the same tool (`npm test` → `npm test -- --reporter=verbose --testNamePattern="AC-1"` is OK; the same `npm test` twice is not)

**Red flags (do NOT do these):**

- "let me try the test again" without any edit
- "let me re-build" without any edit
- "let me re-lint" without any edit
- "let me check if the issue is still there" without any edit

If a tool succeeded once, do not run it a second time to "make sure". If it failed once, the second identical run will fail too.

### 2. No environment shims, no fake fixes

When a build / test / lint fails, **fix the root cause** or **surface the failure as a finding**. The following are anti-patterns; reviewer flags them as `block`:

- wrapping a real failure in `try / catch` and ignoring the error
- skipping a test (`.skip`, `xit`, `@pytest.mark.skip`, `#[ignore]`) "until later" without a follow-up issue or AC
- adding `process.env.NODE_ENV === "test"` (or equivalent) branches just to make tests pass
- adding `// @ts-ignore`, `// eslint-disable`, `# noqa`, `# type: ignore` to silence the failure rather than fix it
- short-circuiting a function with a hardcoded fixture value when "in test"
- mocking a function inline inside production code "just to get past this"
- writing a fallback that hides a real error path (`return data ?? STUB_DATA` where STUB_DATA exists only to dodge an upstream failure)
- copy-pasting a stack-trace into a try/catch as the "fix"

If the real fix is out of scope for the current AC, **stop**. Surface the failure and let the orchestrator hand the slug back to ac-author. Do not "make it work" with a shim and commit. Reviewer will catch the shim, the slug will fail review, and you will redo the work properly. Save the round-trip.

## When you are tempted to add a fallback

Ask yourself: *"what real failure is this fallback hiding?"* If the answer is "I don't know" or "the test was flaky", the fallback is slop. Find the real failure first.

## Worked example — slop vs root-cause

❌ slop:

```ts
function getUser(id: string) {
  try {
    return db.users.find(id);
  } catch (e) {
    if (process.env.NODE_ENV === "test") return { id, name: "test-user" }; // makes the test pass
    throw e;
  }
}
```

✅ root-cause:

```ts
// (test fixture seeds a user before calling getUser; production code untouched)
beforeEach(async () => { await db.users.insert({ id: "u-1", name: "Anna" }); });
```

## What to surface as a finding (and stop)

- **Root cause is in someone else's slug.** Surface as `block`: "AC-N depends on `<file>` which is owned by `<other slug>`. Cannot complete without the other slug shipping first."
- **Test framework is broken.** Surface as `block`: "test runner exits with `<exact-error>` independent of the test under change."
- **Plan is wrong.** Surface as `info`: "AC-N as written cannot be implemented without touching `<file>`, but the plan rules out that file."
- **Dependency upgrade required.** Surface as `info`: "AC-N requires `<lib>@>=X`, current is `<Y>`. Recommend separate dep-bump slug."

In all four cases: stop, return the summary JSON, do **not** push code that "works around it".

## What this skill does NOT prevent

- Re-running a build / test after you actually changed code. That is normal TDD GREEN-cycle behaviour.
- Adding a real test fixture or mock library at the test boundary (`vi.mock("./db")` in the *test file*, not in production). The boundary matters.
- Documented `// eslint-disable` lines with a one-line justification AND a follow-up issue id. The justification is what makes it not slop.
- Running `tsc --noEmit` after `npm test` — that is a different tool, not a re-run of the same one.
