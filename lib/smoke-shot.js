'use strict';

/**
 * Which window a smoke scenario captures.
 *
 * `app:smoke-shot` (main.js) is registered only while STRATAPILOT_SMOKE is set, and it needs the
 * window that asked for the shot. The window that asked is usually gone in exactly the situations a
 * scenario is already failing - a reload in flight, a crash recovery, a closed window - so the
 * handler has a fallback to the app's own window. That fallback used to read `win()`: `win` is a
 * module-level `let`, not a function, and the local `const win` shadowed it, so the fallback threw
 * `ReferenceError: Cannot access 'win' before initialization` instead of capturing anything.
 *
 * Kept as a pure helper so the fallback can be tested without Electron.
 */
function resolveCaptureTarget(senderWindow, appWindow) {
  for (const candidate of [senderWindow, appWindow]) {
    if (!candidate || typeof candidate.isDestroyed !== 'function') continue;
    if (candidate.isDestroyed()) continue;
    return candidate;
  }
  return null;
}

module.exports = { resolveCaptureTarget };
