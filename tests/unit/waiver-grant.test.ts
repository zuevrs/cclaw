import fs from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import {
  consumeWaiverToken,
  formatWaiverToken,
  issueWaiverToken,
  parseWaiverGrantArgs,
  runWaiverGrant,
  WAIVER_REASON_PATTERN,
  WAIVER_TOKEN_DEFAULT_TTL_MINUTES
} from "../../src/internal/waiver-grant.js";
import { runInternalCommand } from "../../src/internal/advance-stage.js";
import { createTempProject } from "../helpers/index.js";

interface CapturedIo {
  io: { stdout: Writable; stderr: Writable };
  stdout: () => string;
  stderr: () => string;
}

function captureIo(): CapturedIo {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      stdoutChunks.push(chunk.toString());
      callback();
    }
  });
  const stderr = new Writable({
    write(chunk, _encoding, callback) {
      stderrChunks.push(chunk.toString());
      callback();
    }
  });
  return {
    io: { stdout, stderr },
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join("")
  };
}

describe("waiver-grant: issueWaiverToken + consumeWaiverToken", () => {
  it("issues a WV-<stage>-<sha8>-<expSlug> token with default TTL and persists the record", async () => {
    const root = await createTempProject("waiver-issue");
    const record = await issueWaiverToken(root, {
      stage: "brainstorm",
      reason: "architect_unavailable"
    });
    expect(record.token).toMatch(/^WV-brainstorm-[0-9a-f]{8}-\d{8}T\d{6}Z$/u);
    expect(record.stage).toBe("brainstorm");
    expect(record.reason).toBe("architect_unavailable");
    expect(record.consumedAt).toBeNull();
    const issuedMs = Date.parse(record.issuedAt);
    const expiresMs = Date.parse(record.expiresAt);
    expect(expiresMs - issuedMs).toBe(WAIVER_TOKEN_DEFAULT_TTL_MINUTES * 60 * 1000);

    const ledger = JSON.parse(
      await fs.readFile(path.join(root, ".cclaw", ".waivers.json"), "utf8")
    ) as { pending: unknown[]; consumed: unknown[] };
    expect(ledger.pending).toHaveLength(1);
    expect(ledger.consumed).toHaveLength(0);
  });

  it("rejects malformed --reason slugs via issueWaiverToken", async () => {
    const root = await createTempProject("waiver-bad-reason");
    await expect(
      issueWaiverToken(root, { stage: "brainstorm", reason: "Has Spaces" })
    ).rejects.toThrow(/short lowercase slug/u);
    await expect(
      issueWaiverToken(root, { stage: "brainstorm", reason: "ok" })
    ).rejects.toThrow(/short lowercase slug/u);
    expect(WAIVER_REASON_PATTERN.test("architect_unavailable")).toBe(true);
  });

  it("consumeWaiverToken succeeds once and refuses second consumption", async () => {
    const root = await createTempProject("waiver-consume");
    const record = await issueWaiverToken(root, {
      stage: "brainstorm",
      reason: "architect_unavailable"
    });
    const first = await consumeWaiverToken(root, {
      stage: "brainstorm",
      token: record.token,
      consumedBy: "advance-stage"
    });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.record.token).toBe(record.token);
      expect(first.record.consumedAt).toMatch(/Z$/u);
    }
    const second = await consumeWaiverToken(root, {
      stage: "brainstorm",
      token: record.token
    });
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe("already-consumed");
    }
  });

  it("consumeWaiverToken rejects wrong stage and expired tokens", async () => {
    const root = await createTempProject("waiver-wrong-stage");
    const record = await issueWaiverToken(root, {
      stage: "brainstorm",
      reason: "architect_unavailable"
    });
    const wrongStage = await consumeWaiverToken(root, {
      stage: "scope",
      token: record.token
    });
    expect(wrongStage.ok).toBe(false);
    if (!wrongStage.ok) {
      expect(wrongStage.reason).toBe("wrong-stage");
    }

    const expiredRoot = await createTempProject("waiver-expired");
    const issuedAt = new Date("2020-01-01T00:00:00Z");
    const expiredRecord = await issueWaiverToken(expiredRoot, {
      stage: "brainstorm",
      reason: "architect_unavailable",
      expiresInMinutes: 1,
      now: issuedAt
    });
    const expired = await consumeWaiverToken(expiredRoot, {
      stage: "brainstorm",
      token: expiredRecord.token
    });
    expect(expired.ok).toBe(false);
    if (!expired.ok) {
      expect(expired.reason).toBe("expired");
    }
  });

  it("formatWaiverToken composes the canonical WV-<stage>-<fp>-<slug> shape", () => {
    const token = formatWaiverToken(
      "brainstorm",
      "abcdef12",
      new Date("2026-05-02T22:05:00Z")
    );
    expect(token).toBe("WV-brainstorm-abcdef12-20260502T220500Z");
  });
});

describe("waiver-grant: CLI parser + runner", () => {
  it("parseWaiverGrantArgs requires --stage and --reason and accepts --ttl", () => {
    expect(() => parseWaiverGrantArgs([])).toThrow(/--stage/u);
    expect(() => parseWaiverGrantArgs(["--stage=brainstorm"])).toThrow(/--reason/u);
    expect(() =>
      parseWaiverGrantArgs(["--stage=invalid", "--reason=architect_unavailable"])
    ).toThrow(/--stage must be one of/u);
    const ok = parseWaiverGrantArgs([
      "--stage=brainstorm",
      "--reason=architect_unavailable",
      "--ttl=60",
      "--json"
    ]);
    expect(ok.stage).toBe("brainstorm");
    expect(ok.reason).toBe("architect_unavailable");
    expect(ok.ttlMinutes).toBe(60);
    expect(ok.json).toBe(true);
  });

  it("runWaiverGrant prints token + consumption hint in text mode and JSON in --json mode", async () => {
    const root = await createTempProject("waiver-cli");
    const textIo = captureIo();
    const textCode = await runWaiverGrant(
      root,
      {
        stage: "brainstorm",
        reason: "architect_unavailable",
        ttlMinutes: WAIVER_TOKEN_DEFAULT_TTL_MINUTES,
        json: false,
        quiet: false
      },
      textIo.io
    );
    expect(textCode, textIo.stderr()).toBe(0);
    const textOut = textIo.stdout();
    expect(textOut).toMatch(/^WV-brainstorm-[0-9a-f]{8}-\d{8}T\d{6}Z/u);
    expect(textOut).toContain("Consume with:");
    expect(textOut).toContain("--accept-proactive-waiver=");

    const jsonIo = captureIo();
    const jsonCode = await runWaiverGrant(
      root,
      {
        stage: "brainstorm",
        reason: "architect_unavailable",
        ttlMinutes: WAIVER_TOKEN_DEFAULT_TTL_MINUTES,
        json: true,
        quiet: false
      },
      jsonIo.io
    );
    expect(jsonCode, jsonIo.stderr()).toBe(0);
    const parsed = JSON.parse(jsonIo.stdout().trim()) as {
      ok: boolean;
      token: string;
      stage: string;
      reason: string;
      consumption: string;
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.token).toMatch(/^WV-brainstorm-/u);
    expect(parsed.consumption).toContain(`--accept-proactive-waiver=${parsed.token}`);
  });

  it("runInternalCommand exposes waiver-grant as an internal subcommand", async () => {
    const root = await createTempProject("waiver-cli-dispatch");
    const io = captureIo();
    const code = await runInternalCommand(
      root,
      [
        "waiver-grant",
        "--stage=brainstorm",
        "--reason=architect_unavailable",
        "--json"
      ],
      io.io
    );
    expect(code, io.stderr()).toBe(0);
    const parsed = JSON.parse(io.stdout().trim()) as { ok: boolean; token: string };
    expect(parsed.ok).toBe(true);
    expect(parsed.token).toMatch(/^WV-brainstorm-/u);
  });
});
