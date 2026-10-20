'use strict';

/**
 * Path policy for the two filesystem channels the renderer can use. (#6)
 *
 * `fs:read-text` used to read ANY absolute path the renderer named, with the byte cap supplied by
 * the caller - `~/.pi/agent/settings.json` and `~/.pi/agent/models.json` (which hold the Strata key)
 * were one call away. `fs:stat-paths` had no bounds either.
 *
 * - reading is confined to roots the app owns (the sessions folder, userData) plus folders the user
 *   picked in a dialog, which main.js records as they are chosen;
 * - statting stays open, because drag & drop stats files from anywhere the user drops them from, and
 *   it returns metadata only (name / size / isDirectory / ext) - but the pi config folder and the
 *   app's own settings and ledger files are denied, so the "read the config, then ship the key out"
 *   chain has no first step.
 *
 * Pure helpers so the decision can be tested without Electron.
 */

const path = require('node:path');

function isInside(root, target) {
  if (!root) return false;
  const rel = path.relative(path.resolve(root), target);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/** fs:read-text: only inside a root the app owns, or a folder chosen in a dialog. */
function readAllowed(filePath, { roots = [] } = {}) {
  const resolved = path.resolve(String(filePath || ''));
  for (const root of roots) {
    if (root && isInside(root, resolved)) return { ok: true, path: resolved };
  }
  return {
    ok: false,
    path: resolved,
    error: 'path is outside the sessions folder, the app data folder and any folder you picked in a dialog',
  };
}

/** fs:stat-paths: open, except the folders and files that hold credentials. */
function statAllowed(filePath, { denied = [] } = {}) {
  const resolved = path.resolve(String(filePath || ''));
  for (const dir of denied) {
    if (!dir) continue;
    const base = path.resolve(dir);
    if (resolved === base || isInside(base, resolved)) {
      return { ok: false, path: resolved, error: 'this path is off limits' };
    }
  }
  return { ok: true, path: resolved };
}

module.exports = { isInside, readAllowed, statAllowed };
