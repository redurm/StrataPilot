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
  let cliPath = process.env.PI_ON_STRATA_PI_CLI || (cli && cli.cliPath) || null;
  if (cliPath) cliPath = path.resolve(cliPath);

  let nodePath = process.env.PI_ON_STRATA_NODE || null;
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

module.exports = { resolvePiInvocation };
