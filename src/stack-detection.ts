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
