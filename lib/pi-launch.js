'use strict';

/**
 * Resolve how to launch the installed pi CLI in RPC mode.
 *
 * Mirrors ~/.pi/agent/bin/pi-launcher.js: the managed install keeps the
 * active release under <installRoot>/releases/<version>/node_modules/
 * @earendil-works/pi-coding-agent, whose package.json bin points at the CLI.
 *
 * Inside Electron process.execPath is electron.exe, so we either use a real
 * node from PATH or re-use electron.exe with ELECTRON_RUN_AS_NODE=1.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

/**
 * The pi release this GUI was last verified against. pi is resolved through
 * `current-version`, so an automatic pi upgrade silently changes what the RPC
 * contract looks like; the env bar and the diagnostics report both compare against
 * this constant (see "pi version compatibility guard" in docs/TODO.md).
 */
const TESTED_PI_VERSION = '1.2.0';

/**
 * The Node floor this app declares in package.json `engines` and calls a hard requirement in the
 * docs. A Node 18 on PATH used to be accepted, and the failure then surfaced as an incomprehensible
 * pi crash - so the probed version is compared against this and reported.
 */
const MIN_NODE_VERSION = '22.19';

/**
 * pi is resolved through `current-version`, which the pi installer rewrites under us. The cache used
 * to be permanent, so after an automatic pi upgrade the app kept spawning the OLD cliPath until it
 * was restarted. A TTL bounds that window; `invalidatePiInvocationCache()` clears it on demand.
 */
const INVOCATION_TTL_MS = 5 * 60 * 1000;

let cached = null;
let cachedAt = 0;

function invalidatePiInvocationCache() {
  cached = null;
  cachedAt = 0;
}

/** Compare dotted versions; returns <0, 0 or >0 like a comparator. */
function compareVersions(a, b) {
  const parts = (value) => String(value || '').trim().split('.').map((part) => Number.parseInt(part, 10) || 0);
  const left = parts(a);
  const right = parts(b);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function readCurrentVersion(installRoot) {
  try {
    const raw = fs.readFileSync(path.join(installRoot, 'current-version'), 'utf8').trim();
    if (raw && /^[0-9A-Za-z._+-]+$/.test(raw)) return raw;
  } catch {}
  return null;
}

function findManagedCli() {
  const roots = [];
  if (process.env.PI_MANAGED_INSTALL_ROOT) roots.push(process.env.PI_MANAGED_INSTALL_ROOT);
  roots.push(path.join(os.homedir(), '.pi', 'agent', 'install'));

  for (const installRoot of roots) {
    if (!installRoot || !fs.existsSync(installRoot)) continue;
    const version = readCurrentVersion(installRoot);
    if (!version) continue;
    const packageDir = path.join(
      installRoot,
      'releases',
      version,
      'node_modules',
      ...'@earendil-works/pi-coding-agent'.split('/'),
    );
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(packageDir, 'package.json'), 'utf8'));
      const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin && pkg.bin.pi;
      if (!bin) continue;
      const cliPath = path.resolve(packageDir, bin);
      const rel = path.relative(packageDir, cliPath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) continue;
      if (!fs.statSync(cliPath).isFile()) continue;
      return { cliPath, installRoot, version };
    } catch {}
  }
  return null;
}

/**
 * Find a node on PATH that is new enough to run pi.
 *
 * Two things this fixes: `spawnSync` used to run with a 5 s timeout on the startup path (inside
 * `app.whenReady()`), which could hold the main process for five seconds before a window existed -
 * the probe is now 1.5 s; and only `status === 0` was checked, so a Node 18 was accepted even though
 * package.json declares `engines.node >= 22.19`, and the failure then showed up as an
 * incomprehensible pi crash with no hint about the runtime.
 */
function findSystemNode() {
  const probe = spawnSync('node', ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 1500,
  });
  if (probe.error || probe.status !== 0 || !probe.stdout || !probe.stdout.trim()) return { nodePath: null, nodeVersion: '', nodeTooOld: false };
  const nodeVersion = probe.stdout.trim();
  return { nodePath: 'node', nodeVersion, nodeTooOld: compareVersions(nodeVersion, MIN_NODE_VERSION) < 0 };
}

function resolvePiInvocation() {
  if (cached && Date.now() - cachedAt < INVOCATION_TTL_MS) return cached;

  const cli = findManagedCli();
  let cliPath = process.env.STRATAPILOT_PI_CLI || (cli && cli.cliPath) || null;
  if (cliPath) cliPath = path.resolve(cliPath);

  let nodePath = process.env.STRATAPILOT_NODE || null;
  let nodeVersion = '';
  let nodeTooOld = false;
  let runAsNode = false;
  if (!nodePath) {
    const found = findSystemNode();
    nodePath = found.nodePath;
    nodeVersion = found.nodeVersion;
    nodeTooOld = found.nodeTooOld;
    if (nodeTooOld) {
      // reported, not swallowed: the env bar and the diagnostics report both carry this, and the
      // alternative is a pi crash the user cannot explain
      console.log(`[pi-launch] node ${nodeVersion} on PATH is older than the required ${MIN_NODE_VERSION} - pi may fail to start`);
    }
    if (!nodePath && process.versions.electron) {
      nodePath = process.execPath;
      runAsNode = true;
    }
  }

  cached = {
    cliPath,
    nodePath,
    nodeVersion,
    nodeTooOld,
    minNodeVersion: MIN_NODE_VERSION,
    runAsNode,
    piVersion: cli && cli.version,
    installRoot: cli && cli.installRoot,
  };
  cachedAt = Date.now();
  return cached;
}

/**
 * Compare an installed pi version with TESTED_PI_VERSION.
 *
 * pi is resolved through `current-version`, so an automatic pi upgrade changes the RPC contract
 * under the GUI without anyone touching this repo. Levels:
 *   ok      same major.minor (patch releases are safe in practice)
 *   warn    different minor, same major (new RPC commands appear, none are usually removed)
 *   differ  different major, or one side unknown (the RPC framing may genuinely have changed)
 */
function piVersionStatus(installedVersion, testedVersion = TESTED_PI_VERSION) {
  const parse = (value) => {
    const match = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(value || '').trim());
    return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3] || 0) } : null;
  };
  const installed = parse(installedVersion);
  const tested = parse(testedVersion);
  if (!installed || !tested) return { level: 'differ', installed: installedVersion || '', tested: testedVersion || '', same: false };
  if (installed.major === tested.major && installed.minor === tested.minor) return { level: 'ok', installed: installedVersion, tested: testedVersion, same: true };
  return {
    level: installed.major === tested.major ? 'warn' : 'differ',
    installed: installedVersion,
    tested: testedVersion,
    same: false,
  };
}

module.exports = {
  resolvePiInvocation,
  invalidatePiInvocationCache,
  INVOCATION_TTL_MS,
  MIN_NODE_VERSION,
  compareVersions,
  TESTED_PI_VERSION,
  piVersionStatus,
};
