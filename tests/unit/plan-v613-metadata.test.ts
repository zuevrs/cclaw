import { describe, expect, it } from "vitest";
import {
  parseImplementationUnitParallelFields,
  planArtifactLacksV613ParallelMetadata
} from "../../src/internal/plan-split-waves.js";

describe("plan v6.13 parallel metadata helpers", () => {
  it("planArtifactLacksV613ParallelMetadata is false when no implementation units", () => {
    expect(planArtifactLacksV613ParallelMetadata("# No units\n")).toBe(false);
  });

  it("accepts plans where every unit has v6.13 bullets", () => {
    const raw = `
## Implementation Units
### Implementation Unit U-1
- **Goal:** x
- **dependsOn:** none
- **claimedPaths:** a
- **parallelizable:** true
- **riskTier:** low
`;
    expect(planArtifactLacksV613ParallelMetadata(raw)).toBe(false);
  });

  it("flags when dependsOn is absent", () => {
    const raw = `
## Implementation Units
### Implementation Unit U-1
- **Goal:** x
- **claimedPaths:** a
- **parallelizable:** true
- **riskTier:** low
`;
    expect(planArtifactLacksV613ParallelMetadata(raw)).toBe(true);
  });

  it("legacyParallelDefaultSerial forces parallelizable false when bullet omitted", () => {
    const unit = {
      id: "U-1",
      body:
        "### Implementation Unit U-1\n- **dependsOn:** none\n- **claimedPaths:** a.ts\n- **riskTier:** low\n",
      paths: ["a.ts"]
    };
    const normal = parseImplementationUnitParallelFields(unit);
    expect(normal.parallelizable).toBe(true);
    const legacy = parseImplementationUnitParallelFields(unit, { legacyParallelDefaultSerial: true });
    expect(legacy.parallelizable).toBe(false);
  });
});
