'use strict';

/*
 * Unit tests for lib/smoke-shot.js (#5).
 *
 * The handler itself lives behind ipcMain and needs Electron, but the bug was in the pure part:
 * which window to capture when the window that asked is gone. That is exactly the situation a smoke
 * scenario is already in when it fails, and the old fallback threw
 * `ReferenceError: Cannot access 'win' before initialization` because a local `const win` shadowed
 * the module-level `let win` - so the code meant to report a broken scenario was itself the failure.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { resolveCaptureTarget } = require('../lib/smoke-shot');

const live = (label) => ({ label, isDestroyed: () => false, getContentBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) });
const destroyed = (label) => ({ label, isDestroyed: () => true });

test('the window that asked is captured when it is still there', () => {
  const sender = live('sender');
  assert.equal(resolveCaptureTarget(sender, live('app')), sender);
});

test('the app window is used when the asking window is gone (#5: this used to throw)', () => {
  const appWindow = live('app');
  // BrowserWindow.fromWebContents() returns null for destroyed web contents
  assert.equal(resolveCaptureTarget(null, appWindow), appWindow);
  assert.equal(resolveCaptureTarget(undefined, appWindow), appWindow);
});

test('a destroyed sender falls through to a live app window', () => {
  const appWindow = live('app');
  assert.equal(resolveCaptureTarget(destroyed('sender'), appWindow), appWindow);
});

test('there is nothing to capture when both windows are gone - report it, do not throw', () => {
  assert.equal(resolveCaptureTarget(destroyed('sender'), destroyed('app')), null);
  assert.equal(resolveCaptureTarget(destroyed('sender'), null), null);
  assert.equal(resolveCaptureTarget(null, null), null);
  assert.equal(resolveCaptureTarget(null, destroyed('app')), null);
});
