'use strict';

/**
 * How the app says goodbye to the pi children. (#8)
 *
 * pi appends to the session JSONL as it goes, and the documented orderly shutdown is "close the
 * child's stdin" (docs/rpc.md: "Close the child's stdin to request an orderly shutdown. Pi disposes
 * the active runtime before exiting") - there is no shutdown command to send. So the grace period IS
 * the shutdown: both quit paths used to pass `graceMs: 300`, which is shorter than a model round trip
 * and shorter than a session-file flush on a slow disk. Quitting mid-run could therefore leave the
 * last entry half-written in a session file the user expects to reopen intact.
 *
 * The other half of the bug is ordering: `usageLedger.flush()` used to run while the children were
 * still writing, so the rollup missed whatever landed after it. The ledger re-scans changed files on
 * the next start (its (mtimeMs, size) stamp), so nothing is written off either way - but the flush
 * belongs after the children are gone, and this makes that explicit instead of accidental.
 */

/** Longer than a model round trip and longer than a session flush on a slow disk. */
const QUIT_GRACE_MS = 5000;

/**
 * Dispose every child with `graceMs`, then call `onAllGone` exactly once when the last one is gone.
 * Returns { tabs, graceMs, finished } - `finished` is the failsafe main.js arms on a timer, because a
 * wedged child must never hold the app open.
 */
function disposeAll(processes, { graceMs = QUIT_GRACE_MS, onAllGone = () => {}, onLog = () => {} } = {}) {
  const list = [...(processes ? processes.values() : [])];
  if (!list.length) {
    onAllGone();
    return { tabs: 0, graceMs, finished: () => false };
  }
  let pending = list.length;
  let done = false;
  const finished = () => {
    if (done) return false;
    done = true;
    onAllGone();
    return true;
  };
  for (const proc of list) {
    onLog(`[pi quit tab=${proc.id}] grace=${graceMs}ms (closing stdin; pi flushes the session before it exits)`);
    proc.once('exit', () => {
      pending -= 1;
      if (pending <= 0) finished();
    });
    proc.dispose({ graceMs });
  }
  return { tabs: list.length, graceMs, finished };
}

module.exports = { disposeAll, QUIT_GRACE_MS };
