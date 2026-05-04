import { describe, expect, it } from "vitest";
import {
  WavePlanDuplicateSliceError,
  WavePlanMergeConflictError,
  extractParallelExecutionManagedBody,
  mergeParallelWaveDefinitions,
  parseParallelExecutionPlanWaves,
  parseTableRowMember,
  parseWavePlanFileBody
} from "../../src/internal/plan-split-waves.js";

const MANAGED_BLOCK = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave 02
- **Members:** S-13, S-14, U-15, U-16

### Wave 03
- **Members:** S-20, S-21
<!-- parallel-exec-managed-end -->`;

describe("parseParallelExecutionPlanWaves (v6.13.1)", () => {
  it("returns empty when managed markers are absent", () => {
    expect(parseParallelExecutionPlanWaves("# no markers\n")).toEqual([]);
  });

  it("parses waves and normalizes U-* to shared S-N / U-N pairs", () => {
    const plan = `# Plan\n\n${MANAGED_BLOCK}\n`;
    const waves = parseParallelExecutionPlanWaves(plan);
    expect(waves.map((w) => w.waveId)).toEqual(["W-02", "W-03"]);
    expect(waves[0]!.members.map((m) => m.sliceId)).toEqual(["S-13", "S-14", "S-15", "S-16"]);
    expect(waves[0]!.members.map((m) => m.unitId)).toEqual(["U-13", "U-14", "U-15", "U-16"]);
  });

  it("extractParallelExecutionManagedBody returns inner markdown", () => {
    const inner = extractParallelExecutionManagedBody(`x\n${MANAGED_BLOCK}\ny`);
    expect(inner).toContain("## Parallel Execution Plan");
    expect(inner).not.toContain("parallel-exec-managed-start");
  });

  it("throws on duplicate slice ids", () => {
    const bad = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1, S-1
<!-- parallel-exec-managed-end -->`;
    expect(() => parseParallelExecutionPlanWaves(bad)).toThrow(WavePlanDuplicateSliceError);
  });
});

describe("parseWavePlanFileBody", () => {
  it("prefers Members line over free-text S-* scan", () => {
    const body = `# Wave
Members: S-2, S-3
Also mentions S-9 in prose.
`;
    const w = parseWavePlanFileBody(body, "W-01");
    expect(w.members.map((m) => m.sliceId)).toEqual(["S-2", "S-3"]);
  });
});

describe("mergeParallelWaveDefinitions", () => {
  it("merges disjoint slices from secondary source", () => {
    const a = parseParallelExecutionPlanWaves(`<!-- parallel-exec-managed-start -->
## Parallel Execution Plan
### Wave 01
- **Members:** S-1
<!-- parallel-exec-managed-end -->`);
    const merged = mergeParallelWaveDefinitions(a, [
      { waveId: "W-01", members: [{ sliceId: "S-2", unitId: "U-2" }] }
    ]);
    const w1 = merged.find((w) => w.waveId === "W-01");
    expect(w1?.members.map((m) => m.sliceId).sort()).toEqual(["S-1", "S-2"]);
  });

  it("errors when the same slice appears in conflicting waves", () => {
    const primary = [
      { waveId: "W-01", members: [{ sliceId: "S-1", unitId: "U-1" }] }
    ];
    const secondary = [
      { waveId: "W-02", members: [{ sliceId: "S-1", unitId: "U-1" }] }
    ];
    expect(() => mergeParallelWaveDefinitions(primary, secondary)).toThrow(WavePlanMergeConflictError);
  });
});

// ---------------------------------------------------------------------------
// v6.14.4 — markdown-table-format wave members
// ---------------------------------------------------------------------------

// Literal copy of hox `.cclaw/artifacts/05-plan.md` lines 1363-1423 (W-02..W-05).
// Do NOT prettify: any deviation defeats the regression-against-real-fixture
// promise of this test file.
const HOX_W02_W05_MANAGED_BLOCK = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

- **Cap:** 5 parallel units per wave (conflict-aware via \`claimedPaths\`).
- **Active mode:** \`worktree-first\` + \`legacyContinuation: true\` (S-1..S-11 закрыты в legacy формате; S-12 закрыт post-cutover; новые слайсы S-13+ идут в worktree lanes с deterministic fan-in).

### Wave W-02 — следующий \`/cc\` запуск (4 lanes, все disjoint)

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-13 | T-008a | [] | crates/sidecar-build/src/manifest.rs, crates/sidecar-build/Cargo.toml, crates/sidecar-build/src/main.rs, crates/hermes-types/tests/sidecar_build_manifest.rs, Cargo.lock | true | low | sidecar-manifest |
| S-14 | T-008b | [] | crates/hermes-types/tests/release_yml_lint.rs | true | low | release-lint |
| S-15 | T-008c | [] | .github/workflows/release.yml, crates/hermes-types/tests/release_yml_job_a_sha.rs | true | standard | release-yml |
| S-16 | T-014a | [] | crates/app/src-tauri/src/lib.rs, crates/hermes-types/tests/app_hello_smoke.rs | true | low | app-shell |

- Path union: 18 файлов. Pairwise overlap: 0. Expected cap usage: 4/5 (резерв на conflict-resolver).
- Все 4 lanes стартуют одновременно после общего RED checkpoint.

### Wave W-03 — после успешного fan-in W-02

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-17 | T-008d | [S-15] | .github/workflows/release.yml, crates/hermes-types/tests/release_yml_job_b_embed.rs, crates/release/manifest/.gitkeep | false | standard | release-yml |

- S-17 sequential, потому что overlap с S-15 на \`release.yml\`. Запускается одиночным lane.

### Wave W-04 — после успешного fan-in W-03 (5 lanes, все disjoint)

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-18 | T-010 | [] | .gitignore | true | low | gitignore |
| S-19 | T-011 | [] | rustfmt.toml, .cargo/config.toml | true | low | rustfmt |
| S-20 | T-012 | [] | crates/app/.eslintrc.cjs, crates/app/tsconfig.json | true | low | app-eslint |
| S-21 | T-013 | [] | .github/workflows/ci.yml | true | standard | ci-scaffold |
| S-22 | T-015 | [] | crates/hermes-types/src/redacted.rs, crates/hermes-types/src/lib.rs | true | low | redacted-newtype |

- Path union: 8 файлов. Pairwise overlap: 0. Expected cap usage: 5/5.
- Все 5 lanes стартуют одновременно после общего fan-in W-03.
- **T-009 исключён из W-04**: задача DROPPED по канон-пивоту.

### Wave W-05 — продолжение для overlap-tasks (после fan-in W-04)

| sliceId | unit | dependsOn | claimedPaths | parallelizable | riskTier | lane |
|---|---|---|---|---|---|---|
| S-23 | T-014b | [S-21] | .github/workflows/ci.yml | false | standard | tauri-toolchain-smoke |
| S-24 | T-014c | [S-23] | .github/workflows/ci.yml | false | standard | tauri-launch-smoke |
| S-25 | T-016 | [S-22] | crates/hermes-types/src/distro_name.rs, crates/hermes-types/src/lib.rs | false | low | distro-name |
| S-26 | T-017 | [S-25] | crates/hermes-types/src/snapshot_path.rs, crates/hermes-types/src/lib.rs | false | low | snapshot-path |

- Внутри W-05 две независимые serial-цепочки.

<!-- parallel-exec-managed-end -->`;

describe("parseTableRowMember (v6.14.4)", () => {
  it("extracts S-NN sliceId and verbatim col-2 unitId from a hox-shape table row", () => {
    const row = "| S-18 | T-010 | [] | .gitignore | true | low | gitignore |";
    expect(parseTableRowMember(row)).toEqual({ sliceId: "S-18", unitId: "T-010" });
  });

  it("derives U-NN when the unit column is empty", () => {
    expect(parseTableRowMember("| S-7 |  | [] |")).toEqual({
      sliceId: "S-7",
      unitId: "U-7"
    });
  });

  it("normalizes a U-NN unit column into the canonical pair", () => {
    expect(parseTableRowMember("| S-9 | U-9 | [] |")).toEqual({
      sliceId: "S-9",
      unitId: "U-9"
    });
  });

  it("returns null for header rows", () => {
    expect(parseTableRowMember("| sliceId | unit | dependsOn |")).toBeNull();
  });

  it("returns null for separator rows", () => {
    expect(parseTableRowMember("|---|---|---|")).toBeNull();
  });

  it("returns null for non-table lines", () => {
    expect(parseTableRowMember("- Path union: 8 файлов.")).toBeNull();
  });

  it("returns null for rows whose first column is not S-NN", () => {
    expect(parseTableRowMember("| not-a-slice | foo |")).toBeNull();
  });
});

describe("parseParallelExecutionPlanWaves — markdown-table format (v6.14.4)", () => {
  it("parses the literal hox W-02..W-05 managed block (4 waves)", () => {
    const waves = parseParallelExecutionPlanWaves(HOX_W02_W05_MANAGED_BLOCK);
    expect(waves.map((w) => w.waveId)).toEqual(["W-02", "W-03", "W-04", "W-05"]);

    const w02 = waves.find((w) => w.waveId === "W-02")!;
    expect(w02.members.map((m) => m.sliceId)).toEqual([
      "S-13",
      "S-14",
      "S-15",
      "S-16"
    ]);
    expect(w02.members.map((m) => m.unitId)).toEqual([
      "T-008a",
      "T-008b",
      "T-008c",
      "T-014a"
    ]);

    const w03 = waves.find((w) => w.waveId === "W-03")!;
    expect(w03.members.map((m) => m.sliceId)).toEqual(["S-17"]);

    const w04 = waves.find((w) => w.waveId === "W-04")!;
    expect(w04.members.map((m) => m.sliceId)).toEqual([
      "S-18",
      "S-19",
      "S-20",
      "S-21",
      "S-22"
    ]);

    const w05 = waves.find((w) => w.waveId === "W-05")!;
    expect(w05.members.map((m) => m.sliceId)).toEqual([
      "S-23",
      "S-24",
      "S-25",
      "S-26"
    ]);
  });

  it("ignores `dependsOn: [S-21]` brackets in the table when extracting members", () => {
    // W-05 S-23 has `[S-21]` in the dependsOn column — that token must NOT be
    // treated as a member of W-05.
    const waves = parseParallelExecutionPlanWaves(HOX_W02_W05_MANAGED_BLOCK);
    const w05 = waves.find((w) => w.waveId === "W-05")!;
    expect(w05.members.map((m) => m.sliceId)).not.toContain("S-21");
  });

  it("accepts a mixed-format managed block (Wave 01 = Members line, Wave 02 = table)", () => {
    const mixed = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01 — Members-line shape
- **Members:** S-1, S-2

### Wave W-02 — table shape

| sliceId | unit | dependsOn | claimedPaths |
|---|---|---|---|
| S-3 | T-3 | [] | foo.rs |
| S-4 | T-4 | [] | bar.rs |
<!-- parallel-exec-managed-end -->`;
    const waves = parseParallelExecutionPlanWaves(mixed);
    expect(waves.map((w) => w.waveId)).toEqual(["W-01", "W-02"]);
    const w01 = waves.find((w) => w.waveId === "W-01")!;
    expect(w01.members.map((m) => m.sliceId)).toEqual(["S-1", "S-2"]);
    expect(w01.members.map((m) => m.unitId)).toEqual(["U-1", "U-2"]);
    const w02 = waves.find((w) => w.waveId === "W-02")!;
    expect(w02.members.map((m) => m.sliceId)).toEqual(["S-3", "S-4"]);
    expect(w02.members.map((m) => m.unitId)).toEqual(["T-3", "T-4"]);
  });

  it("dedupes inside one wave when Members and table list the same slice", () => {
    const dup = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01
- **Members:** S-1, S-2

| sliceId | unit |
|---|---|
| S-1 | T-1 |
| S-3 | T-3 |
<!-- parallel-exec-managed-end -->`;
    const waves = parseParallelExecutionPlanWaves(dup);
    expect(waves).toHaveLength(1);
    expect(waves[0]!.members.map((m) => m.sliceId)).toEqual(["S-1", "S-2", "S-3"]);
    // S-1 was first declared via **Members:** so unitId is the legacy
    // S-NN → U-NN derivation, NOT the table's `T-1`.
    const s1 = waves[0]!.members.find((m) => m.sliceId === "S-1");
    expect(s1?.unitId).toBe("U-1");
  });

  it("skips bad table rows without throwing", () => {
    const bad = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01

| sliceId | unit |
|---|---|
| not-a-slice | foo |
| S-7 | T-7 |
<!-- parallel-exec-managed-end -->`;
    const waves = parseParallelExecutionPlanWaves(bad);
    expect(waves).toHaveLength(1);
    expect(waves[0]!.members.map((m) => m.sliceId)).toEqual(["S-7"]);
  });

  it("returns the wave with empty members[] when a table has only header rows", () => {
    const empty = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-09 — empty table

| sliceId | unit |
|---|---|

<!-- parallel-exec-managed-end -->`;
    const waves = parseParallelExecutionPlanWaves(empty);
    const w09 = waves.find((w) => w.waveId === "W-09");
    expect(w09).toBeDefined();
    expect(w09!.members).toEqual([]);
  });

  it("still throws on cross-wave duplicate slice ids in tables", () => {
    const dupAcross = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-01

| sliceId | unit |
|---|---|
| S-5 | T-5 |

### Wave W-02

| sliceId | unit |
|---|---|
| S-5 | T-5 |
<!-- parallel-exec-managed-end -->`;
    expect(() => parseParallelExecutionPlanWaves(dupAcross)).toThrow(
      WavePlanDuplicateSliceError
    );
  });

  it("accepts `### Wave W-NN — trailing text` heading shape", () => {
    const block = `<!-- parallel-exec-managed-start -->
## Parallel Execution Plan

### Wave W-04 — после успешного fan-in W-03 (5 lanes, все disjoint)

| sliceId | unit |
|---|---|
| S-18 | T-010 |
<!-- parallel-exec-managed-end -->`;
    const waves = parseParallelExecutionPlanWaves(block);
    expect(waves.map((w) => w.waveId)).toEqual(["W-04"]);
    expect(waves[0]!.members.map((m) => m.sliceId)).toEqual(["S-18"]);
  });
});
