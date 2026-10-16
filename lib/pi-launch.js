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

let cached = null;

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

function findSystemNode() {
  const probe = spawnSync('node', ['-p', 'process.versions.node'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  if (!probe.error && probe.status === 0 && probe.stdout && probe.stdout.trim()) {
    return 'node';
  }
  return null;
}

function resolvePiInvocation() {
  if (cached) return cached;

  const cli = findManagedCli();
  let cliPath = process.env.STRATAPILOT_PI_CLI || (cli && cli.cliPath) || null;
  if (cliPath) cliPath = path.resolve(cliPath);

  let nodePath = process.env.STRATAPILOT_NODE || null;
  let nodeArgPrefix = [];
  let runAsNode = false;
  if (!nodePath) {
    nodePath = findSystemNode();
    if (!nodePath && process.versions.electron) {
      nodePath = process.execPath;
      runAsNode = true;
    }
  }

  cached = {
    cliPath,
    nodePath,
    nodeArgPrefix,
    runAsNode,
    piVersion: cli && cli.version,
    installRoot: cli && cli.installRoot,
  };
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

module.exports = { resolvePiInvocation, TESTED_PI_VERSION, piVersionStatus };
