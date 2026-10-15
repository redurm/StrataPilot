'use strict';

/**
 * Renderer crash reporting.
 *
 * Loaded before markdown.js/app.js on purpose: an uncaught exception thrown while
 * those parse or run is the usual cause of a "UI crash" (white window, or the window
 * closing), and until now nothing reported it — the main process log had no trace.
 * CSP is `script-src 'self'`, so this has to be a file rather than an inline script.
 */

window.addEventListener('error', (event) => {
  try {
    window.piGui.clientError({
      type: 'error',
      message: event.message || '(no message)',
      source: event.filename || '',
      line: event.lineno,
      column: event.colno,
      stack: (event.error && event.error.stack) || '',
    });
  } catch {
    /* preload missing or bridge broken: nothing to do */
  }
});

window.addEventListener('unhandledrejection', (event) => {
  try {
    const reason = event.reason;
    window.piGui.clientError({
      type: 'unhandledrejection',
      message: (reason && reason.message) || String(reason),
      stack: (reason && reason.stack) || '',
    });
  } catch {
    /* ignore */
  }
});
