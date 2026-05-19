/**
 * Per-path in-process async mutex (v8.108 — R2).
 *
 * Serialises read-modify-write critical sections against a logical
 * resource keyed by an arbitrary string (typically an absolute file
 * path). Used by {@link patchFlowState}, {@link setOutcomeSignal}, and
 * {@link appendKnowledgeEntry} to close the race window between
 * read → patch → write that v8.66 parallel slices / v8.73 worktree
 * parallel / v8.102 patch mode are pushing toward.
 *
 * ## What this gives you
 *
 * - **Per-path queueing.** Two concurrent `withPathLock("/a", fn)` calls
 *   on the same path execute fn serially; calls on different paths run
 *   concurrently. The queue is unbounded but fail-loud (see below).
 * - **Fail-loud on contention timeout.** If a queued task waits longer
 *   than {@link LOCK_CONTENTION_TIMEOUT_MS} for its turn at the head of
 *   the queue, it throws {@link StateLockBlockedError} — gstack-style
 *   "throw BLOCKED, don't retry-then-corrupt" rather than the gsd-v1
 *   #3711 unlink-on-retry-exhaustion bug that PR #3717 had to undo.
 *   Callers can catch and decide whether to retry at a higher layer.
 * - **Re-acquire on last retry semantics for free.** Because the
 *   critical section runs inside `fn`, every retry naturally re-reads
 *   state from disk after the prior holder releases — there is no
 *   "stale snapshot from before the lock fired" failure mode that the
 *   gsd-v1 #3711 specific lesson called out.
 * - **Crash-safe.** A task that throws still releases the lock via the
 *   `finally` branch; the next queued waiter resumes on the next tick.
 *   `writeFileSafe`'s temp + rename is POSIX-atomic for the on-disk
 *   write itself, so a hard crash mid-rename leaves either the old or
 *   the new state, never a partial file.
 *
 * ## What this deliberately does NOT give you
 *
 * - **No cross-process protection.** Two `cclaw` CLI processes touching
 *   the same `flow-state.json` simultaneously still race. cclaw is
 *   single-CLI in practice (one orchestrator per worktree); the
 *   future-proofing pressure named in the v8.108 R2 brief is in-process
 *   parallel writers (v8.66 / v8.73 / v8.102 slices). Cross-process
 *   would need `proper-lockfile` or equivalent; the v8.108 brief
 *   explicitly defers that decision (audit + dep cost outweigh the
 *   theoretical race today).
 * - **No deadlock detection.** Callers MUST NOT take the same path
 *   recursively (no re-entrant locking); doing so would deadlock the
 *   queue. The three call sites (`patchFlowState`, `setOutcomeSignal`,
 *   `appendKnowledgeEntry`) are leaves on the state-write graph —
 *   none of them call each other under lock — so re-entrance is not a
 *   live concern as of v8.108.
 * - **No priority / fairness.** First-come-first-served per path. The
 *   queue can be unbounded; in pathological pile-up the fail-loud
 *   timeout kicks in.
 *
 * Pattern reference: gsd-v1 #3711 (last-retry re-acquire) + #3717
 * (don't unlink live locks — fail loud, don't paper over contention).
 */

/**
 * How long a queued task waits for its turn at the head of the
 * per-path queue before throwing {@link StateLockBlockedError}.
 *
 * Sized at 30 seconds because:
 * - The longest legitimate critical section under lock is the
 *   `setOutcomeSignal` re-serialisation of `knowledge.jsonl` (entries
 *   in the low hundreds is typical; sub-100ms per write on real
 *   hardware). Even 30 queued waiters at 100ms each fit inside 3s of
 *   total wall time, an order of magnitude under 30s.
 * - 30s is comfortably under any orchestrator turn budget; a
 *   contention-induced 30s wait is itself diagnostic evidence the
 *   caller should surface to the user, not paper over with a retry.
 * - Mirrors the gsd-v1 #3717 patch's 30s `maxWaitMs` upper bound for
 *   live-but-slow holders, so the timeout shape is consistent across
 *   the two projects' state-lock disciplines.
 */
export const LOCK_CONTENTION_TIMEOUT_MS = 30_000;

/**
 * Thrown when a queued task waits longer than
 * {@link LOCK_CONTENTION_TIMEOUT_MS} for its turn at the head of the
 * per-path queue. The exception name (`StateLockBlocked`) is the
 * gstack-style fail-loud signal — callers MAY retry at a higher layer,
 * but they MUST NOT swallow the throw silently.
 *
 * The message includes the contended path and the waited duration so
 * the orchestrator's logger / triage-audit surface can pinpoint the
 * contention without instrumenting deeper.
 */
export class StateLockBlockedError extends Error {
  override readonly name = "StateLockBlocked";
  constructor(public readonly resourcePath: string, public readonly waitedMs: number) {
    super(
      `StateLockBlocked: ${resourcePath} held for ${waitedMs}ms (exceeded ${LOCK_CONTENTION_TIMEOUT_MS}ms contention budget)`
    );
  }
}

/**
 * Per-path mutex registry. Each entry is the tail of a FIFO chain of
 * task-completion promises for that path. New callers chain their own
 * task onto the tail (`prior.then(() => held)`) and await `prior`'s
 * settle before running the critical section. The chain is FIFO; the
 * map entry self-cleans when its tail settles AND no newer task
 * replaced it.
 */
const _pathLocks = new Map<string, Promise<void>>();

/**
 * Run `fn` under the per-path mutex for `resourcePath`. Concurrent
 * `withPathLock` calls on the same path execute serially in FIFO
 * order; calls on different paths run concurrently.
 *
 * Fail-loud contract: a task that waits longer than
 * {@link LOCK_CONTENTION_TIMEOUT_MS} for its turn throws
 * {@link StateLockBlockedError}. The throw is the diagnostic signal —
 * callers MAY catch and retry at a higher layer, but MUST NOT swallow
 * the exception silently. When the throw fires, the bailed task
 * resolves its own chain slot immediately so the next waiter is not
 * deadlocked behind a vacant holder (gsd-v1 #3717's "don't paper over
 * contention by holding a phantom lock" lesson, in async-promise form).
 *
 * Re-acquire-on-last-retry contract (gsd-v1 #3711 lesson): the
 * critical section runs INSIDE `fn`, which re-reads state on every
 * invocation. There is no "stale snapshot from before the lock fired"
 * shape — the disk read happens AFTER the wait completes, every time.
 *
 * Rejection-tolerant: a prior task's rejection is the prior task's
 * concern; we still acquire after its settle. We never re-throw a
 * predecessor's failure on a different caller's behalf.
 *
 * @param resourcePath logical resource key (typically an absolute file path).
 * @param fn the critical-section body to run under lock.
 * @returns whatever `fn` returns.
 * @throws {@link StateLockBlockedError} when contention exceeds the budget.
 */
export async function withPathLock<T>(
  resourcePath: string,
  fn: () => Promise<T>
): Promise<T> {
  const prior = _pathLocks.get(resourcePath) ?? Promise.resolve();

  let release!: () => void;
  const held = new Promise<void>((res) => {
    release = res;
  });

  const newTail: Promise<void> = prior.then(
    () => held,
    () => held
  );
  _pathLocks.set(resourcePath, newTail);

  void newTail.finally(() => {
    if (_pathLocks.get(resourcePath) === newTail) {
      _pathLocks.delete(resourcePath);
    }
  });

  const startedAt = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const timeoutId = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new StateLockBlockedError(resourcePath, Date.now() - startedAt));
      }, LOCK_CONTENTION_TIMEOUT_MS);
      if (typeof timeoutId.unref === "function") timeoutId.unref();

      prior.then(
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve();
        },
        () => {
          if (settled) return;
          settled = true;
          clearTimeout(timeoutId);
          resolve();
        }
      );
    });
  } catch (err) {
    release();
    throw err;
  }

  try {
    return await fn();
  } finally {
    release();
  }
}

/**
 * Test-only helper: clear every per-path lock. Vitest test files that
 * exercise contention paths use this in `beforeEach` to prevent
 * cross-test leakage when a deliberate StateLockBlocked test leaves
 * a held lock in the map. Never call this from production code — the
 * fail-loud contract depends on lock state surviving across awaits.
 */
export function _resetPathLocksForTesting(): void {
  _pathLocks.clear();
}
