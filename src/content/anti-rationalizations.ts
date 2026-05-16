/**
 * Shared cross-cutting anti-rationalization catalog.
 *
 * Before v8.49, cross-cutting rationalizations (e.g. "I'll claim complete now,
 * the reviewer will catch any gaps", "while I'm here I'll fix the adjacent
 * thing") drifted across specialist prompts and skill `.md` files - each
 * skill carried its own phrasing of the same canonical excuse, and the
 * phrasings diverged over time as the surface grew.
 *
 * This module is the single source of truth for those cross-cutting rows. It
 * exposes:
 *
 * - {@link SHARED_ANTI_RATIONALIZATIONS} - structured catalog keyed by
 *   category (`completion`, `verification`, `edit-discipline`,
 *   `commit-discipline`, `posture-bypass`). Each entry has a quoted excuse
 *   + rebuttal.
 * - {@link renderAntiRationalizationsCatalog} - renders the catalog as a
 *   Markdown body (one H2 per category, two-column table per H2). The
 *   {@link ANTI_RATIONALIZATIONS_BODY} constant is the pre-rendered string;
 *   `install.ts` writes it to `.cclaw/lib/anti-rationalizations.md` so
 *   specialists and skills can reference rows by category instead of
 *   inlining the prose.
 *
 * Specialist-specific rationalizations (e.g. critic's pre-commitment row,
 * design's pause-mid-flow row, reviewer's three edit-discipline rows) stay
 * in their respective specialist prompts - they are the prompt's reason for
 * existing, not cross-cutting prose. The catalog only covers rationalizations
 * that appear in two or more cclaw surfaces with the same conceptual rebuttal.
 *
 * Tripwires: keep this list stable. Removing a row may break a downstream
 * pointer (`v849-overcomplexity-sweep.test.ts` asserts category presence and
 * row counts).
 */

export type AntiRationalizationCategory =
  | "completion"
  | "verification"
  | "edit-discipline"
  | "commit-discipline"
  | "posture-bypass";

export interface AntiRationalization {
  rationalization: string;
  truth: string;
}

export const SHARED_ANTI_RATIONALIZATIONS: Record<
  AntiRationalizationCategory,
  AntiRationalization[]
> = {
  completion: [
    {
      rationalization:
        '"I just ran the tests, they should pass on this kind of change."',
      truth:
        '"Should" is not evidence; "did" with the exit code is. Run the suite and paste the command + result line. 30 seconds saves a review iteration. See `completion-discipline.md` for the full claim-vs-evidence rule.'
    },
    {
      rationalization: '"Looks good to me."',
      truth:
        "Sycophancy. Replace with the verified line (`AC-N verified: <command> -> <result>`) or drop the claim's confidence to `medium`. The next agent cannot reconstruct your intuition; they read evidence or they don't."
    },
    {
      rationalization:
        '"I\'ll claim complete now; the reviewer will catch any gaps."',
      truth:
        "The reviewer reads your slim summary as ground truth before re-running ex-post. A false complete-marker poisons their `Verification story` - they cite \"Tests run: yes\" based on your claim and miss the regression. Verify before you claim."
    },
    {
      rationalization:
        '"The previous turn\'s test output is enough - no edits happened since."',
      truth:
        "Stale evidence is forbidden (`anti-slop.md`). If the working tree could have moved (any code edit), re-run. If it provably could not have moved, cite the prior run by command + timestamp instead of re-pasting."
    },
    {
      rationalization:
        '"I\'m confident; I don\'t need to write the evidence down."',
      truth:
        "Evidence is for the next reader, not for you. Slim summaries propagate as ground truth; absent evidence makes the next agent's downstream claim a second-order rationalization."
    }
  ],
  verification: [
    {
      rationalization:
        '"The full suite is slow; I\'ll just run the test for this AC."',
      truth:
        "A regression in another module makes the diff non-shippable regardless of whether your AC's test passes. Run the project's relevant suite, not the single AC test. See `tdd-and-verification.md > verification-loop`."
    },
    {
      rationalization:
        '"Tests passed once but the next run flaked - moving on, probably flaky."',
      truth:
        '"Probably flaky" is not a diagnosis. The multi-run protocol is 20 iterations on first failure, 100 if 1+ failures observed. Single-run flake conclusions are `A-7 required` (axis=correctness). See `debug-and-browser.md > multi-run protocol`.'
    },
    {
      rationalization:
        '"`npm run build` works in CI, no need to run it locally before commit."',
      truth:
        'The cheapest gate (build/typecheck) catches type errors that escape the editor LSP. Skipping it because "CI will catch it" pushes the failure into a slower loop and burns a review iteration. Run the gate in order. See `tdd-and-verification.md > Gates`.'
    },
    {
      rationalization:
        '"I can skip the security gate - the diff has no auth code."',
      truth:
        "Dependency adds, new exec calls, new IO sinks, and any diff matching the security-sensitive heuristic trigger the gate regardless of the `security_flag`. Cite the gate output or cite the explicit skip reason; silence is `required`."
    }
  ],
  "edit-discipline": [
    {
      rationalization: '"I read this file last week; I remember its structure."',
      truth:
        "Last week's read is stale evidence. Re-read; the cost is 30 seconds, the cost of editing on a stale memory is one fix-only iteration. See `pre-edit-investigation.md`."
    },
    {
      rationalization:
        '"The AC names the exact line I should edit; reading the rest is overhead."',
      truth:
        "The AC says WHAT to edit; pre-edit-investigation tells you whether the WHAT is safe. The line the AC names sits inside a file whose invariants the AC author may not have known. Run Probe 1/2/3 before the edit."
    },
    {
      rationalization:
        '"While I\'m here, I\'ll just fix this adjacent comment / format / import."',
      truth:
        "That is the canonical A-4 drive-by. Open a separate slug (or inline-flow) for the cleanup; the reviewer flags every drive-by and the commit chain stays clean. See `commit-hygiene.md`."
    },
    {
      rationalization:
        '"The plan already lists touchSurface; I don\'t need to investigate the listed files."',
      truth:
        "touchSurface is a permission list, not an investigation report. The plan author did not run Probe 1/2/3 against your build-state diff; their list may be stale by the time you edit."
    }
  ],
  "commit-discipline": [
    {
      rationalization:
        '"I\'ll skip the `red(AC-N): ...` / `green(AC-N): ...` / `refactor(AC-N): ...` prefix this once."',
      truth:
        "The reviewer's git-log scan keys off the prefix (`git log --grep=\"(AC-N):\" --oneline`). Without it the commit is invisible to the chain check and the AC reads as missing. Amend the message or write a fixup commit; do not leave the chain broken."
    },
    {
      rationalization: '"`git add -A` is fine, I know what changed."',
      truth:
        "Forbidden. Stage explicitly (`git add <path>` per file, or `git add -p` for hunks). Shell history with `-A` is itself an A-2 finding (axis=commit-hygiene)."
    },
    {
      rationalization:
        '"The message will say `WIP` for now; I\'ll fix it in review."',
      truth:
        "Reviewer rejects `WIP` / `fixes` / `stuff` as F-1 `block`. Cost to write a real subject is 30 seconds; cost to fix later is a review iteration."
    },
    {
      rationalization:
        '"I\'ll bundle the rename and the bug fix into one commit; they\'re related."',
      truth:
        "They are not. The rename is `refactor(AC-N):`; the bug fix is `red(AC-N):` + `green(AC-N):`. Mixing them defeats the audit trail and makes the diff unreviewable."
    },
    {
      rationalization: '"I\'ll amend the last commit since I already pushed."',
      truth:
        "Once pushed, do not amend - the orchestrator's ship stage owns force-push. Write a fixup commit (`git commit --allow-empty -m \"<prefix>(AC-N): re-record subject for <orig-SHA>\"`) and surface the mis-record in your slim summary."
    }
  ],
  "posture-bypass": [
    {
      rationalization: '"This is a 5-line change, RED isn\'t worth the time."',
      truth:
        "RED takes 60-90 seconds and produces an audit trail. Without it, you are trusting a 5-line read against a 500-line context. The cost was always paid by the next agent who had to verify it. See `tdd-and-verification.md`."
    },
    {
      rationalization:
        '"I already know this works because I tested it manually."',
      truth:
        "Manual tests don't ship; the watched-RED proof does. The next agent who reads the build log cannot repeat your manual test."
    },
    {
      rationalization:
        '"REFACTOR is unnecessary here; the GREEN code is already clean."',
      truth:
        "Then say so explicitly. default: write `Refactor: skipped - <reason>` in the AC's `build.md` row REFACTOR notes column - no empty commit needed; the reviewer reads the row token. Legacy path `git commit --allow-empty -m \"refactor(AC-N) skipped: <reason>\"` is still accepted. Silence on REFACTOR (neither row token nor commit) fails the gate."
    },
    {
      rationalization:
        '"The mechanical TDD hook is gone; I can write production code without a test first."',
      truth:
        "The Iron Law is a discipline, not a hook. Skipping RED breaks the audit trail the reviewer reads at handoff. A `green(AC-N)` without a prior `red(AC-N)` is an A-1 finding, severity=required, axis=correctness."
    },
    {
      rationalization:
        '"I added a try/catch around the failing path so the test passes."',
      truth:
        "The RED test was supposed to fail because the production code was wrong; suppressing the error does not fix it. Restore the failure, then fix the production code."
    }
  ]
};

const CATEGORY_TITLES: Record<AntiRationalizationCategory, string> = {
  completion: "Completion - claim vs evidence",
  verification: "Verification - gates + suites",
  "edit-discipline": "Edit discipline - investigate before edit",
  "commit-discipline": "Commit discipline - prefixes, hygiene, no drive-bys",
  "posture-bypass": "Posture bypass - TDD skipping + REFACTOR silence"
};

const CATEGORY_ORDER: AntiRationalizationCategory[] = [
  "completion",
  "verification",
  "edit-discipline",
  "commit-discipline",
  "posture-bypass"
];

/**
 * Render the full anti-rationalization catalog as a Markdown body.
 *
 * Each category becomes a `## <title>` H2 with a two-column rationalization /
 * truth table. The body is written to `.cclaw/lib/anti-rationalizations.md`
 * by `install.ts > syncCclaw`. Specialists and skills reference rows by
 * category (e.g. "see `.cclaw/lib/anti-rationalizations.md` - category
 * `commit-discipline`"); the full rebuttals stay in this file, not duplicated
 * across every prompt.
 */
export function renderAntiRationalizationsCatalog(): string {
  const header = `# cclaw shared anti-rationalization catalog`;
  const preface = [
    "Auto-generated by `cclaw install` from `src/content/anti-rationalizations.ts > SHARED_ANTI_RATIONALIZATIONS`. consolidated cross-cutting rationalization rows that previously drifted across multiple specialist prompts and skill `.md` files into this single catalog.",
    "",
    "Specialists and skill bodies still carry rationalizations **unique to their own discipline** (e.g. design's pause-mid-flow rows, critic's pre-commitment row, the reviewer's three edit-discipline rows). When the rationalization is cross-cutting - the same canonical excuse with the same conceptual rebuttal - the row lives here and the originating prompt cites the category instead of re-emitting the prose.",
    "",
    "Layout: one H2 per category, two-column markdown table per H2. Categories: `completion`, `verification`, `edit-discipline`, `commit-discipline`, `posture-bypass`."
  ].join("\n");
  const sections = CATEGORY_ORDER.map((category) => {
    const title = CATEGORY_TITLES[category];
    const rows = SHARED_ANTI_RATIONALIZATIONS[category];
    const tableRows = rows
      .map((row) => `| ${row.rationalization} | ${row.truth} |`)
      .join("\n");
    return [
      `## \`${category}\` - ${title}`,
      "",
      "| rationalization | truth |",
      "| --- | --- |",
      tableRows
    ].join("\n");
  });
  return [header, "", preface, "", ...sections, ""].join("\n");
}

export const ANTI_RATIONALIZATIONS_BODY: string =
  renderAntiRationalizationsCatalog();
