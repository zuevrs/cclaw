import fs from "node:fs/promises";
import path from "node:path";

export interface StackReviewRouteProfile {
  stack: string;
  /**
   * Signals shown in review routing documentation/skills.
   * These are human-facing pointers, not strict parsers.
   */
  reviewSignals: string[];
  /** Root-level markers used by start-flow context discovery. */
  discoveryMarkers: string[];
  focus: string;
}

export const STACK_REVIEW_ROUTE_PROFILES: readonly StackReviewRouteProfile[] = [
  {
    stack: "TypeScript/JavaScript",
    reviewSignals: ["package.json", "tsconfig.json"],
    discoveryMarkers: ["package.json", "tsconfig.json", "jsconfig.json"],
    focus: "type safety, package scripts, build/test config, dependency boundaries"
  },
  {
    stack: "Python",
    reviewSignals: ["pyproject.toml", "requirements.txt"],
    discoveryMarkers: ["pyproject.toml", "requirements.txt", "requirements-dev.txt", ".python-version"],
    focus: "packaging, virtualenv assumptions, typing, pytest or unittest evidence"
  },
  {
    stack: "Ruby/Rails",
    reviewSignals: ["Gemfile", "config/"],
    discoveryMarkers: ["Gemfile"],
    focus: "Rails conventions, migrations, routes/controllers, RSpec or Minitest evidence"
  },
  {
    stack: "Go",
    reviewSignals: ["go.mod"],
    discoveryMarkers: ["go.mod"],
    focus: "interfaces, concurrency, error handling, go test coverage"
  },
  {
    stack: "Rust",
    reviewSignals: ["Cargo.toml"],
    discoveryMarkers: ["Cargo.toml"],
    focus: "ownership, error/result handling, feature flags, cargo test coverage"
  }
] as const;

const EXTRA_DISCOVERY_MARKERS = [
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Dockerfile",
  "docker-compose.yml",
  "docker-compose.yaml",
  ".gitlab-ci.yml"
] as const;

/**
 * Unified root-marker list used by start-flow context discovery.
 * Keep this in one place so stage skill routing and start-flow scanning
 * evolve together.
 */
export const STACK_DISCOVERY_MARKERS: readonly string[] = [
  ...new Set([
    ...STACK_REVIEW_ROUTE_PROFILES.flatMap((profile) => profile.discoveryMarkers),
    ...EXTRA_DISCOVERY_MARKERS
  ])
];

/**
 * Directory markers (checked with pathExists) for stack discovery.
 */
export const STACK_DISCOVERY_DIR_MARKERS: readonly string[] = [
  ".github/workflows"
];

// ---------------------------------------------------------------------------
// 7.6.0 — Universal stack-adapter contract.
//
// Lives alongside the review-route profiles so a single import surface
// (`import { ... } from "../stack-detection.js"`) covers both the human-facing
// routing data AND the structural adapter behavior used by hooks, linters,
// and slice-commit. Stack-specific hardcoding outside this module is a
// regression — route through `loadStackAdapter()` instead.
// ---------------------------------------------------------------------------

export type StackAdapterId =
  | "rust"
  | "node"
  | "python"
  | "go"
  | "ruby"
  | "php"
  | "swift"
  | "dotnet"
  | "elixir"
  | "java"
  | "unknown";

/** Twin describing manifest → lockfile coupling for a stack. */
export interface ManifestLockfileTwin {
  /** Manifest glob (path relative to repo root). */
  manifestGlob: string;
  /** Lockfile glob that the manifest's package manager regenerates. */
  lockfileGlob: string;
}

/**
 * Wiring-aggregator contract — describes whether a new file in a stack
 * needs an explicit aggregator/parent module update for the new module to
 * be reachable from the rest of the project.
 *
 * - `aggregatorPattern` is a human-facing description; consumers should
 *   call `resolveAggregatorFor(filePath, repoState?)` to compute the
 *   concrete aggregator path.
 * - `resolveAggregatorFor` returns the concrete repo-relative path of
 *   the aggregator file required to wire `filePath`, or `null` when no
 *   aggregator is required (e.g. file IS the aggregator, or the stack
 *   layout makes wiring implicit).
 * - `repoState.headFiles` lets the resolver check whether sibling
 *   aggregators already exist (so e.g. node-ts only requires
 *   `index.ts` updates when an `index.ts` already exists in that
 *   directory).
 */
export interface WiringAggregatorContract {
  aggregatorPattern: string;
  /**
   * Resolve the aggregator path required to wire `filePath` into its
   * parent module, given a snapshot of repo state. Return `null` when
   * no aggregator update is required.
   */
  resolveAggregatorFor(
    filePath: string,
    repoState?: { headFiles?: ReadonlySet<string> }
  ): string | null;
}

/**
 * Universal stack-adapter contract used by hooks (slice-commit lockfile
 * twins), linters (`plan_module_introducing_slice_wires_root`), and
 * future stack-specific evidence validators.
 *
 * Each stack returns:
 * - `id` — short stable identifier; routes used elsewhere should match.
 * - `displayName` — used in user-facing prose so error messages stay
 *   stack-agnostic at the surface ("Rust workspace" vs "Node project"
 *   are forbidden in generic code; use `adapter.displayName` instead).
 * - `manifestGlobs` — repo-relative manifest paths the stack uses.
 * - `lockfileTwins` — manifest→lockfile twin entries; auto-detected
 *   from disk at adapter init so node projects with yarn.lock get
 *   `yarn.lock`, pnpm gets `pnpm-lock.yaml`, etc.
 * - `testCommandHints` — example test command lines for prompts and
 *   evidence validators (advisory; not authoritative).
 * - `wiringAggregator` — see contract above. `undefined` when the
 *   stack has no aggregator pattern (Go, Java, Ruby, Swift, .NET,
 *   Elixir use implicit/automatic wiring).
 */
export interface StackAdapter {
  id: StackAdapterId;
  displayName: string;
  manifestGlobs: string[];
  lockfileTwins: ManifestLockfileTwin[];
  testCommandHints: string[];
  wiringAggregator?: WiringAggregatorContract;
}

interface StackAdapterFactoryInput {
  fileExists: (relPath: string) => Promise<boolean>;
}

interface StackAdapterFactory {
  id: StackAdapterId;
  displayName: string;
  /**
   * Marker check — adapters stack the first match wins. Implementors
   * keep this cheap (single file probe in most cases) so a repo scan
   * stays linear.
   */
  detect(input: StackAdapterFactoryInput): Promise<boolean>;
  /** Build the adapter once detection succeeded. */
  build(input: StackAdapterFactoryInput): Promise<StackAdapter>;
}

const STACK_ADAPTER_FACTORIES: readonly StackAdapterFactory[] = [
  {
    id: "rust",
    displayName: "Rust",
    async detect({ fileExists }) {
      return await fileExists("Cargo.toml");
    },
    async build() {
      return {
        id: "rust",
        displayName: "Rust",
        manifestGlobs: ["Cargo.toml", "**/Cargo.toml"],
        lockfileTwins: [
          { manifestGlob: "Cargo.toml", lockfileGlob: "Cargo.lock" }
        ],
        testCommandHints: ["cargo test", "cargo nextest run"],
        wiringAggregator: rustWiringAggregator()
      } satisfies StackAdapter;
    }
  },
  {
    id: "node",
    displayName: "Node/TypeScript",
    async detect({ fileExists }) {
      return await fileExists("package.json");
    },
    async build({ fileExists }) {
      const lockfileTwins: ManifestLockfileTwin[] = [];
      const candidates: ManifestLockfileTwin[] = [
        { manifestGlob: "package.json", lockfileGlob: "package-lock.json" },
        { manifestGlob: "package.json", lockfileGlob: "yarn.lock" },
        { manifestGlob: "package.json", lockfileGlob: "pnpm-lock.yaml" }
      ];
      let detectedAny = false;
      for (const candidate of candidates) {
        if (await fileExists(candidate.lockfileGlob)) {
          lockfileTwins.push(candidate);
          detectedAny = true;
        }
      }
      // Conservative default when no lockfile is on disk: assume npm.
      // Slice-commit uses lockfileTwins to know which file to auto-include
      // when the manifest is in claim and the lockfile drifted; a stale
      // npm-style guess is harmless on a yarn project because we only
      // act on actual on-disk drift.
      if (!detectedAny) {
        lockfileTwins.push({
          manifestGlob: "package.json",
          lockfileGlob: "package-lock.json"
        });
      }
      return {
        id: "node",
        displayName: "Node/TypeScript",
        manifestGlobs: ["package.json", "**/package.json"],
        lockfileTwins,
        testCommandHints: [
          "npm test",
          "pnpm test",
          "yarn test",
          "npx vitest run",
          "npx jest"
        ],
        wiringAggregator: nodeTsWiringAggregator()
      } satisfies StackAdapter;
    }
  },
  {
    id: "python",
    displayName: "Python",
    async detect({ fileExists }) {
      return (
        (await fileExists("pyproject.toml")) ||
        (await fileExists("requirements.txt")) ||
        (await fileExists("Pipfile")) ||
        (await fileExists("setup.py"))
      );
    },
    async build({ fileExists }) {
      const lockfileTwins: ManifestLockfileTwin[] = [];
      const pyprojectCandidates: ManifestLockfileTwin[] = [
        { manifestGlob: "pyproject.toml", lockfileGlob: "poetry.lock" },
        { manifestGlob: "pyproject.toml", lockfileGlob: "uv.lock" },
        { manifestGlob: "pyproject.toml", lockfileGlob: "pdm.lock" }
      ];
      let pyprojectAny = false;
      if (await fileExists("pyproject.toml")) {
        for (const candidate of pyprojectCandidates) {
          if (await fileExists(candidate.lockfileGlob)) {
            lockfileTwins.push(candidate);
            pyprojectAny = true;
          }
        }
        if (!pyprojectAny) {
          // Default guess for projects that don't yet have a lockfile.
          lockfileTwins.push({
            manifestGlob: "pyproject.toml",
            lockfileGlob: "poetry.lock"
          });
        }
      }
      if (await fileExists("Pipfile")) {
        lockfileTwins.push({ manifestGlob: "Pipfile", lockfileGlob: "Pipfile.lock" });
      }
      return {
        id: "python",
        displayName: "Python",
        manifestGlobs: [
          "pyproject.toml",
          "Pipfile",
          "requirements.txt",
          "requirements-dev.txt",
          "setup.py",
          "setup.cfg"
        ],
        lockfileTwins,
        testCommandHints: ["pytest", "python -m pytest", "python -m unittest"],
        wiringAggregator: pythonWiringAggregator()
      } satisfies StackAdapter;
    }
  },
  {
    id: "go",
    displayName: "Go",
    async detect({ fileExists }) {
      return await fileExists("go.mod");
    },
    async build() {
      return {
        id: "go",
        displayName: "Go",
        manifestGlobs: ["go.mod", "**/go.mod"],
        lockfileTwins: [
          { manifestGlob: "go.mod", lockfileGlob: "go.sum" }
        ],
        testCommandHints: ["go test ./...", "go test"]
      } satisfies StackAdapter;
    }
  },
  {
    id: "ruby",
    displayName: "Ruby",
    async detect({ fileExists }) {
      return await fileExists("Gemfile");
    },
    async build() {
      return {
        id: "ruby",
        displayName: "Ruby",
        manifestGlobs: ["Gemfile", "**/Gemfile"],
        lockfileTwins: [
          { manifestGlob: "Gemfile", lockfileGlob: "Gemfile.lock" }
        ],
        testCommandHints: ["bundle exec rspec", "bundle exec rake test"]
      } satisfies StackAdapter;
    }
  },
  {
    id: "php",
    displayName: "PHP",
    async detect({ fileExists }) {
      return await fileExists("composer.json");
    },
    async build() {
      return {
        id: "php",
        displayName: "PHP",
        manifestGlobs: ["composer.json", "**/composer.json"],
        lockfileTwins: [
          { manifestGlob: "composer.json", lockfileGlob: "composer.lock" }
        ],
        testCommandHints: ["composer test", "vendor/bin/phpunit"]
      } satisfies StackAdapter;
    }
  },
  {
    id: "swift",
    displayName: "Swift",
    async detect({ fileExists }) {
      return await fileExists("Package.swift");
    },
    async build() {
      return {
        id: "swift",
        displayName: "Swift",
        manifestGlobs: ["Package.swift", "**/Package.swift"],
        lockfileTwins: [
          { manifestGlob: "Package.swift", lockfileGlob: "Package.resolved" }
        ],
        testCommandHints: ["swift test"]
      } satisfies StackAdapter;
    }
  },
  {
    id: "dotnet",
    displayName: ".NET",
    async detect({ fileExists }) {
      return (
        (await fileExists("global.json")) ||
        (await fileExists("Directory.Build.props"))
      );
    },
    async build() {
      return {
        id: "dotnet",
        displayName: ".NET",
        manifestGlobs: ["**/*.csproj", "**/*.fsproj", "**/*.vbproj"],
        lockfileTwins: [
          { manifestGlob: "**/*.csproj", lockfileGlob: "**/packages.lock.json" }
        ],
        testCommandHints: ["dotnet test"]
      } satisfies StackAdapter;
    }
  },
  {
    id: "elixir",
    displayName: "Elixir",
    async detect({ fileExists }) {
      return await fileExists("mix.exs");
    },
    async build() {
      return {
        id: "elixir",
        displayName: "Elixir",
        manifestGlobs: ["mix.exs", "**/mix.exs"],
        lockfileTwins: [
          { manifestGlob: "mix.exs", lockfileGlob: "mix.lock" }
        ],
        testCommandHints: ["mix test"]
      } satisfies StackAdapter;
    }
  },
  {
    id: "java",
    displayName: "Java/JVM",
    async detect({ fileExists }) {
      return (
        (await fileExists("pom.xml")) ||
        (await fileExists("build.gradle")) ||
        (await fileExists("build.gradle.kts"))
      );
    },
    async build({ fileExists }) {
      const manifestGlobs: string[] = [];
      if (await fileExists("pom.xml")) manifestGlobs.push("pom.xml");
      if (await fileExists("build.gradle")) manifestGlobs.push("build.gradle");
      if (await fileExists("build.gradle.kts")) manifestGlobs.push("build.gradle.kts");
      // Java/Gradle/Maven do not have a single canonical lockfile in
      // common usage. Leave lockfileTwins empty (no-op for slice-commit
      // auto-include). Projects that want lockfiles wire them via the
      // local config or wrapper rather than at the adapter layer.
      return {
        id: "java",
        displayName: "Java/JVM",
        manifestGlobs: manifestGlobs.length > 0 ? manifestGlobs : ["pom.xml"],
        lockfileTwins: [],
        testCommandHints: ["mvn test", "gradle test", "./gradlew test"]
      } satisfies StackAdapter;
    }
  }
];

const UNKNOWN_STACK_ADAPTER: StackAdapter = {
  id: "unknown",
  displayName: "current stack",
  manifestGlobs: [],
  lockfileTwins: [],
  testCommandHints: []
};

interface LoadStackAdapterOptions {
  /**
   * Override the project root for tests. Defaults to the supplied
   * argument; primarily here so callers can inject a synthesized
   * directory in fixtures.
   */
  projectRoot?: string;
}

/**
 * Load the stack-adapter for a project. Walks the registered factories
 * in order; the first detector that returns true wins. Returns the
 * `unknown` adapter (no-op) when no detector matches.
 *
 * Adapter init reads the filesystem to auto-detect lockfile twins
 * (e.g. yarn.lock vs package-lock.json). Callers should cache the
 * adapter for the lifetime of the operation rather than calling this
 * per-row.
 */
export async function loadStackAdapter(
  projectRoot: string,
  options: LoadStackAdapterOptions = {}
): Promise<StackAdapter> {
  const root = options.projectRoot ?? projectRoot;
  const fileExists = async (relPath: string): Promise<boolean> => {
    if (relPath.includes("*")) {
      // We never glob in the detection path; concrete probes only.
      return false;
    }
    try {
      await fs.access(path.join(root, relPath));
      return true;
    } catch {
      return false;
    }
  };
  const factoryInput: StackAdapterFactoryInput = { fileExists };
  for (const factory of STACK_ADAPTER_FACTORIES) {
    if (await factory.detect(factoryInput)) {
      return factory.build(factoryInput);
    }
  }
  return UNKNOWN_STACK_ADAPTER;
}

/**
 * Synthesize a stack adapter from explicit lockfile-twin overrides.
 * Useful in tests that want to pin twins without a real filesystem
 * scan, and for the linter test suite.
 */
export function buildStackAdapterForTests(
  partial: Partial<StackAdapter> & { id: StackAdapterId; displayName: string }
): StackAdapter {
  return {
    manifestGlobs: [],
    lockfileTwins: [],
    testCommandHints: [],
    ...partial
  };
}

export const UNKNOWN_STACK = UNKNOWN_STACK_ADAPTER;

// ---------------------------------------------------------------------------
// Wiring aggregator helpers (per stack).
// ---------------------------------------------------------------------------

function rustWiringAggregator(): WiringAggregatorContract {
  return {
    aggregatorPattern: "src/lib.rs | src/main.rs | mod.rs (parent module)",
    resolveAggregatorFor(filePath: string): string | null {
      const normalized = normalizeRel(filePath);
      if (!/\.rs$/u.test(normalized)) return null;
      // The file IS itself an aggregator: nothing to do.
      const basename = baseName(normalized);
      if (basename === "lib.rs" || basename === "main.rs" || basename === "mod.rs") {
        return null;
      }
      // Find the nearest `src/` ancestor and target its `lib.rs` (or main).
      // We default to lib.rs because most workspaces expose a library
      // crate; binaries can override by carrying main.rs in the claim
      // alongside lib.rs.
      const segments = normalized.split("/");
      const srcIdx = segments.lastIndexOf("src");
      if (srcIdx < 0) {
        // No conventional layout — fall back to parent dir mod.rs.
        const parent = segments.slice(0, -1).join("/");
        if (parent.length === 0) return null;
        return `${parent}/mod.rs`;
      }
      const srcRoot = segments.slice(0, srcIdx + 1).join("/");
      // If file lives directly under src/ (e.g. src/foo.rs), it must be
      // declared in src/lib.rs (or src/main.rs).
      if (srcIdx === segments.length - 2) {
        return `${srcRoot}/lib.rs`;
      }
      // Otherwise, the parent module's mod.rs is the wiring point.
      const parentSegments = segments.slice(0, -1);
      return `${parentSegments.join("/")}/mod.rs`;
    }
  };
}

function nodeTsWiringAggregator(): WiringAggregatorContract {
  const candidateBasenames = ["index.ts", "index.tsx", "index.js", "index.jsx"];
  return {
    aggregatorPattern:
      "parent-dir index.{ts,tsx,js,jsx} (only when an index.* already exists in the parent dir)",
    resolveAggregatorFor(filePath: string, repoState): string | null {
      const normalized = normalizeRel(filePath);
      if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/u.test(normalized)) return null;
      const basename = baseName(normalized);
      if (candidateBasenames.includes(basename)) return null;
      const segments = normalized.split("/");
      if (segments.length < 2) return null;
      const parentDir = segments.slice(0, -1).join("/");
      const headFiles = repoState?.headFiles;
      // node-ts wiring is opt-in: if the parent dir already has an
      // index.* file at HEAD, the project uses barrel exports and the
      // new file must be added to the barrel. Without an index.* file,
      // we treat the project as not using barrels and emit no
      // requirement.
      if (!headFiles) return null;
      for (const candidate of candidateBasenames) {
        const indexPath = `${parentDir}/${candidate}`;
        if (headFiles.has(indexPath)) {
          return indexPath;
        }
      }
      return null;
    }
  };
}

function pythonWiringAggregator(): WiringAggregatorContract {
  return {
    aggregatorPattern: "parent-dir __init__.py (skipped when sibling __init__.py absent — PEP 420 namespace package)",
    resolveAggregatorFor(filePath: string, repoState): string | null {
      const normalized = normalizeRel(filePath);
      if (!/\.py$/u.test(normalized)) return null;
      const basename = baseName(normalized);
      if (basename === "__init__.py") return null;
      const segments = normalized.split("/");
      if (segments.length < 2) return null;
      const parentDir = segments.slice(0, -1).join("/");
      const candidate = `${parentDir}/__init__.py`;
      // PEP 420 namespace packages skip __init__.py entirely. We detect
      // the layout by checking whether the parent dir already has an
      // __init__.py at HEAD; if it doesn't, treat the dir as namespace
      // and skip the requirement.
      const headFiles = repoState?.headFiles;
      if (!headFiles) {
        // No state: be conservative and emit the requirement so authors
        // either include the aggregator or migrate to PEP 420 with a
        // claimedPaths note.
        return candidate;
      }
      if (headFiles.has(candidate)) {
        return candidate;
      }
      // Sibling __init__.py absent — namespace package layout. No-op.
      return null;
    }
  };
}

// ---------------------------------------------------------------------------
// Path helpers shared by aggregator resolvers.
// ---------------------------------------------------------------------------

function normalizeRel(value: string): string {
  return value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+$/u, "");
}

function baseName(rel: string): string {
  const idx = rel.lastIndexOf("/");
  return idx >= 0 ? rel.slice(idx + 1) : rel;
}
