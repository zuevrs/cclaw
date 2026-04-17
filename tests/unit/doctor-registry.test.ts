import { describe, expect, it } from "vitest";
import { doctorCheckMetadata } from "../../src/doctor-registry.js";
import { doctorSucceeded } from "../../src/doctor.js";

describe("doctor registry", () => {
  it("classifies warning-prefixed checks as warning severity", () => {
    const meta = doctorCheckMetadata("warning:capability:jq");
    expect(meta.severity).toBe("warning");
    expect(meta.fix.length).toBeGreaterThan(0);
  });

  it("classifies hook wiring checks as error severity", () => {
    const meta = doctorCheckMetadata("hook:wiring:claude");
    expect(meta.severity).toBe("error");
    expect(meta.docRef).toContain("hooks-and-lifecycle.md");
  });

  it("falls back to warning metadata for unknown checks", () => {
    const meta = doctorCheckMetadata("custom:unknown");
    expect(meta.severity).toBe("warning");
    expect(meta.summary).toContain("Unclassified doctor check");
  });

  it("doctorSucceeded fails only on error-severity failures", () => {
    const warningOnly = doctorSucceeded([{
      name: "warning:foo",
      ok: false,
      details: "warning",
      severity: "warning",
      summary: "warning",
      fix: "fix warning"
    }]);
    const withError = doctorSucceeded([{
      name: "error:foo",
      ok: false,
      details: "error",
      severity: "error",
      summary: "error",
      fix: "fix error"
    }]);
    expect(warningOnly).toBe(true);
    expect(withError).toBe(false);
  });
});

