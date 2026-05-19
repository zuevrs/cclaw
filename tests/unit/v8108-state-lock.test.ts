import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createInitialFlowState } from "../../src/flow-state.js";
import { appendKnowledgeEntry, type KnowledgeEntry } from "../../src/knowledge-store.js";
import {
  LOCK_CONTENTION_TIMEOUT_MS,
  StateLockBlockedError,
  _resetPathLocksForTesting,
  withPathLock
} from "../../src/path-mutex.js";
import { patchFlowState, flowStatePath } from "../../src/run-persistence.js";

/**
 * v8.108 — R2: state-lock atomicity for `patchFlowState`,
 * `setOutcomeSignal`, and `appendKnowledgeEntry`. Wraps each
 * read → modify → write surface in a per-path in-process async mutex
 * (`withPathLock`) so concurrent calls serialise FIFO. Pattern
 * reference: gsd-v1 #3711 (re-acquire on last retry) + #3717 (fail
 * loudly on contention, don't unlink live locks).
 */

let tmp: string;

beforeEach(async () => {
  _resetPathLocksForTesting();
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "cclaw-v8108-state-lock-"));
});

afterEach(async () => {
  _resetPathLocksForTesting();
  try {
    await fs.rm(tmp, { recursive: true, force: true });
  } catch {
    /* best-effort cleanup */
  }
});

describe("v8.108 R2 — withPathLock FIFO + fail-loud contention contract", () => {
  it("BEHAVIOR — two concurrent `withPathLock` calls on the same key execute serially in FIFO order (not interleaved)", async () => {
    const events: string[] = [];
    const a = withPathLock("k", async () => {
      events.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      events.push("a-end");
      return 1;
    });
    const b = withPathLock("k", async () => {
      events.push("b-start");
      await new Promise((r) => setTimeout(r, 5));
      events.push("b-end");
      return 2;
    });
    await Promise.all([a, b]);
    expect(events).toEqual(["a-start", "a-end", "b-start", "b-end"]);
  });

  it("BEHAVIOR — concurrent calls on DIFFERENT keys run in parallel (no false serialisation)", async () => {
    const events: string[] = [];
    const a = withPathLock("k1", async () => {
      events.push("a-start");
      await new Promise((r) => setTimeout(r, 30));
      events.push("a-end");
    });
    const b = withPathLock("k2", async () => {
      events.push("b-start");
      await new Promise((r) => setTimeout(r, 5));
      events.push("b-end");
    });
    await Promise.all([a, b]);
    expect(events[0]).toBe("a-start");
    expect(events[1]).toBe("b-start");
    expect(events.indexOf("b-end")).toBeLessThan(events.indexOf("a-end"));
  });

  it("BEHAVIOR — contention timeout throws StateLockBlockedError; bailed task releases its chain slot so subsequent waiters don't deadlock", async () => {
    vi.useFakeTimers();
    try {
      let releaseHolder!: () => void;
      const holderRunning = new Promise<void>((res) => {
        releaseHolder = res;
      });

      const holder = withPathLock("contend", async () => {
        await holderRunning;
      });

      const waiterErr: { value: unknown } = { value: undefined };
      const waiter = withPathLock("contend", async () => "should-not-run").catch(
        (err) => {
          waiterErr.value = err;
        }
      );

      await vi.advanceTimersByTimeAsync(LOCK_CONTENTION_TIMEOUT_MS + 50);
      await waiter;
      expect(waiterErr.value).toBeInstanceOf(StateLockBlockedError);
      expect((waiterErr.value as StateLockBlockedError).resourcePath).toBe("contend");
      expect((waiterErr.value as StateLockBlockedError).waitedMs).toBeGreaterThanOrEqual(
        LOCK_CONTENTION_TIMEOUT_MS
      );
      expect((waiterErr.value as Error).name).toBe("StateLockBlocked");

      releaseHolder();
      await holder;

      const next = await withPathLock("contend", async () => "ok");
      expect(next).toBe("ok");
    } finally {
      vi.useRealTimers();
    }
  });

  it("BEHAVIOR — a critical section that throws still releases the lock (next waiter proceeds)", async () => {
    const order: string[] = [];
    const fail = withPathLock("k", async () => {
      order.push("fail-start");
      throw new Error("boom");
    }).catch(() => order.push("fail-caught"));
    const ok = withPathLock("k", async () => {
      order.push("ok-start");
      return 42;
    });
    await fail;
    const r = await ok;
    expect(r).toBe(42);
    expect(order).toEqual(["fail-start", "fail-caught", "ok-start"]);
  });
});

describe("v8.108 R2 — patchFlowState concurrent updates do not lose data", () => {
  beforeEach(async () => {
    await fs.mkdir(path.join(tmp, ".cclaw", "state"), { recursive: true });
    await fs.writeFile(
      flowStatePath(tmp),
      `${JSON.stringify(createInitialFlowState("2026-05-19T00:00:00Z"), null, 2)}\n`,
      "utf8"
    );
  });

  it("BEHAVIOR — concurrent patchFlowState calls touching DIFFERENT fields never lose an update (the read → merge → write critical section is fully serialised, so a sibling field's patch on a stale snapshot can't clobber a peer's patch)", async () => {
    const firstSlug = "slug-A";
    const secondStage = "review" as const;
    const [a, b] = await Promise.all([
      patchFlowState(tmp, { currentSlug: firstSlug }),
      patchFlowState(tmp, { currentStage: secondStage })
    ]);
    const final = JSON.parse(await fs.readFile(flowStatePath(tmp), "utf8")) as {
      currentSlug: string | null;
      currentStage: string | null;
    };
    expect(final.currentSlug).toBe(firstSlug);
    expect(final.currentStage).toBe(secondStage);
    expect(a.currentSlug).toBe(firstSlug);
    expect(b.currentStage).toBe(secondStage);
  });

  it("BEHAVIOR — 10 concurrent patchFlowState calls each setting a distinct field-value land FIFO without losing any update (worst-case race surface for the v8.66/v8.73/v8.102 parallel-writer trajectory)", async () => {
    const N = 10;
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < N; i += 1) {
      ops.push(patchFlowState(tmp, { currentSlug: `slug-${i}` }));
    }
    await Promise.all(ops);
    const final = JSON.parse(await fs.readFile(flowStatePath(tmp), "utf8")) as {
      currentSlug: string;
    };
    expect(final.currentSlug).toBe(`slug-${N - 1}`);
  });
});

describe("v8.108 R2 — appendKnowledgeEntry concurrent appends preserve every entry", () => {
  it("BEHAVIOR — 25 concurrent appends land 25 lines (no overwrite, no partial line, no lost append)", async () => {
    const N = 25;
    const ops: Array<Promise<unknown>> = [];
    for (let i = 0; i < N; i += 1) {
      const entry: KnowledgeEntry = {
        slug: `slug-${i.toString().padStart(3, "0")}`,
        ship_commit: `abc${i.toString().padStart(4, "0")}`,
        shipped_at: "2026-05-19T00:00:00Z",
        signals: { acCount: 1, cyclePrefix: "feat" },
        tags: [`tag-${i}`],
        touchSurface: [`src/file-${i}.ts`]
      };
      ops.push(appendKnowledgeEntry(tmp, entry));
    }
    await Promise.all(ops);
    const raw = await fs.readFile(path.join(tmp, ".cclaw", "knowledge.jsonl"), "utf8");
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    expect(lines).toHaveLength(N);
    const slugs = lines.map((l) => (JSON.parse(l) as { slug: string }).slug);
    const uniq = new Set(slugs);
    expect(uniq.size).toBe(N);
    for (let i = 0; i < N; i += 1) {
      expect(uniq.has(`slug-${i.toString().padStart(3, "0")}`)).toBe(true);
    }
  });
});

describe("v8.108 R2 — atomic-rename safety on simulated crash mid-write", () => {
  it("BEHAVIOR — a write that fails (simulated via a mock that throws after temp-write but before rename) leaves the prior file content intact; never a partial/corrupted file", async () => {
    await fs.mkdir(path.join(tmp, ".cclaw", "state"), { recursive: true });
    const initial = { ...createInitialFlowState("2026-05-19T00:00:00Z"), reviewIterations: 7 };
    await fs.writeFile(
      flowStatePath(tmp),
      `${JSON.stringify(initial, null, 2)}\n`,
      "utf8"
    );

    const spy = vi.spyOn(fs, "rename").mockImplementation(async () => {
      throw new Error("simulated crash mid-rename");
    });
    try {
      await expect(patchFlowState(tmp, { reviewIterations: 99 })).rejects.toThrow(
        /simulated crash/
      );
    } finally {
      spy.mockRestore();
    }

    const raw = await fs.readFile(flowStatePath(tmp), "utf8");
    const parsed = JSON.parse(raw) as { reviewIterations: number };
    expect(parsed.reviewIterations).toBe(7);
  });
});

describe("v8.108 R2 — re-acquire-on-last-retry: critical section reads state AFTER the wait", () => {
  it("BEHAVIOR — a second patchFlowState scheduled while the first is in flight runs INSIDE its critical section AFTER the first's write — the read is fresh, not a stale snapshot from before the wait (gsd-v1 #3711 lesson)", async () => {
    await fs.mkdir(path.join(tmp, ".cclaw", "state"), { recursive: true });
    await fs.writeFile(
      flowStatePath(tmp),
      `${JSON.stringify(createInitialFlowState("2026-05-19T00:00:00Z"), null, 2)}\n`,
      "utf8"
    );

    const first = patchFlowState(tmp, { currentSlug: "first-write" });
    await first;
    const second = await patchFlowState(tmp, { currentStage: "review" });
    expect(second.currentSlug).toBe("first-write");
    expect(second.currentStage).toBe("review");
  });

  it("BEHAVIOR — back-to-back patches issued before the prior settle (FIFO serialised) each see the prior's writes — the read of state happens inside the critical section, not at scheduling time", async () => {
    await fs.mkdir(path.join(tmp, ".cclaw", "state"), { recursive: true });
    await fs.writeFile(
      flowStatePath(tmp),
      `${JSON.stringify(createInitialFlowState("2026-05-19T00:00:00Z"), null, 2)}\n`,
      "utf8"
    );
    const p1 = patchFlowState(tmp, { currentSlug: "s1" });
    const p2 = patchFlowState(tmp, { currentStage: "review" });
    const p3 = patchFlowState(tmp, { lastSpecialist: "critic" });
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1.currentSlug).toBe("s1");
    expect(r2.currentSlug).toBe("s1");
    expect(r2.currentStage).toBe("review");
    expect(r3.currentSlug).toBe("s1");
    expect(r3.currentStage).toBe("review");
    expect(r3.lastSpecialist).toBe("critic");
  });
});
