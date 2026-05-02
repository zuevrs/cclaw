import { describe, expect, it } from "vitest";
import { parseStartFlowArgs } from "../../src/internal/advance-stage/parsers.js";

describe("parseStartFlowArgs", () => {
  it("normalizes --discovery-mode case-insensitively", () => {
    for (const raw of ["Deep", "DEEP", "Guided", "LEAN"]) {
      const args = parseStartFlowArgs(["--track=standard", `--discovery-mode=${raw}`]);
      expect(args.discoveryMode).toBe(raw.toLowerCase());
    }
  });
});
