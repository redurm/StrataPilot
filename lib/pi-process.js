'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const path = require('node:path');

const { resolvePiInvocation } = require('./pi-launch');

/**
 * One `pi --mode rpc` child process.
 *
 * Protocol: JSONL on stdin/stdout. One JSON object per line, records are split
 * on LF only (Node's readline also splits on U+2028/U+2029, which are legal
 * inside JSON strings, so it is deliberately not used here).
 */
class PiRpcProcess extends EventEmitter {
  constructor({ id, cwd, args = [], env = {} }) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.args = args;
    this.extraEnv = env;
    this.child = null;
    this.pending = new Map();
    this.lineBuf = Buffer.alloc(0);
    this.exited = false;
    this.exitCode = null;
    this.startedAt = 0;
    this.stderrTail = '';
  }

  get alive() {
    return !!this.child && !this.exited;
  }

  start() {
    const inv = resolvePiInvocation();
    if (!inv.cliPath) throw new Error('pi CLI not found; set PI_ON_STRATA_PI_CLI');
    if (!inv.nodePath) throw new Error('node runtime not found; set PI_ON_STRATA_NODE');

    const argv = [...inv.nodeArgPrefix, inv.cliPath, '--mode', 'rpc', ...this.args];
    const env = { ...process.env, ...this.extraEnv };
    if (inv.runAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    env.PI_ON_STRATA = '1';

    this.startedAt = Date.now();
    this.child = spawn(inv.nodePath, argv, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.on('error', (err) => {
      this.emit('log', `spawn error: ${err.message}`);
      this.emit('process_error', err);
    });

    this.child.on('exit', (code, signal) => {
      this.exited = true;
      this.exitCode = code;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(new Error(`pi process exited (code=${code} signal=${signal})`));
      }
      this.pending.clear();
      this.emit('exit', { code, signal, stderr: this.stderrTail });
    });

    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-20000);
      this.emit('stderr', text);
    });
    this.child.stdin.on('error', (err) => this.emit('log', `stdin error: ${err.message}`));

    return this;
  }

  onData(chunk) {
    this.lineBuf = Buffer.concat([this.lineBuf, chunk]);
    let idx;
    while ((idx = this.lineBuf.indexOf(0x0a)) !== -1) {
      let line = this.lineBuf.subarray(0, idx).toString('utf8');
      this.lineBuf = this.lineBuf.subarray(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        this.emit('log', `unparsable record: ${err.message}`);
        continue;
      }
      this.handleRecord(record);
    }
  }

  handleRecord(record) {
    if (record && record.type === 'response') {
      const entry = record.id ? this.pending.get(record.id) : null;
      if (entry) {
        clearTimeout(entry.timer);
        this.pending.delete(record.id);
        entry.resolve(record);
        return;
      }
      if (record.command === 'parse') {
        this.emit('log', `parse error: ${record.error}`);
        return;
      }
    }
    this.emit('record', record);
  }

  writeRaw(obj) {
    if (!this.alive) return false;
    const payload = JSON.stringify(obj) + '\n';
    this.child.stdin.write(payload, (err) => {
      if (err) this.emit('log', `write error: ${err.message}`);
    });
    return true;
  }

  /**
   * Send a command and wait for its matching response record.
   * Returns the raw response ({success, data|error}).
   */
  command(type, fields = {}, timeoutMs = 120000) {
    if (!this.alive) return Promise.resolve({ type: 'response', command: type, success: false, error: 'pi process is not running' });
    // Callers may bring their own id (bash streaming events repeat the command id, so the
    // renderer needs to know it up front to attach the output deltas to the right card).
    const { id: provided, ...rest } = fields;
    const id = typeof provided === 'string' && provided ? provided : crypto.randomUUID();
    const cmd = { id, type, ...rest };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ type: 'response', command: type, success: false, error: `timeout after ${timeoutMs}ms`, timeout: true });
      }, timeoutMs);
      this.pending.set(id, { resolve, reject: resolve, timer });
      this.writeRaw(cmd);
    });
  }

  respondUi(response) {
    this.writeRaw({ type: 'extension_ui_response', ...response });
  }

  dispose({ graceMs = 1500 } = {}) {
    if (!this.alive) return;
    try {
      this.child.stdin.end();
    } catch {}
    const killTimer = setTimeout(() => {
      try {
        this.child.kill();
      } catch {}
    }, graceMs);
    killTimer.unref?.();
    const prev = this.listeners('exit')[0];
    this.once('exit', () => clearTimeout(killTimer));
    void prev;
  }
}

module.exports = { PiRpcProcess, path };
