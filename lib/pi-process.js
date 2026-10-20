'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

/**
 * Cap on the buffered-but-incomplete stdout line. stderrTail is capped (20 KB) and the renderer's
 * pi:stderr payload is capped (4 KB), so stdout is the one channel between the process pair that
 * would otherwise grow without bound: a child that writes bytes without ever writing a newline (a
 * crashed pi, an extension printing binary, a tool dumping one huge line) keeps lineBuf growing for
 * as long as it lives. (#11)
 */
const MAX_LINE_BYTES = 8 * 1024 * 1024;

const { resolvePiInvocation } = require('./pi-launch');

/**
 * One `pi --mode rpc` child process.
 *
 * Protocol: JSONL on stdin/stdout. One JSON object per line, records are split
 * on LF only (Node's readline also splits on U+2028/U+2029, which are legal
 * inside JSON strings, so it is deliberately not used here).
 */
class PiRpcProcess extends EventEmitter {
  constructor({ id, cwd, args = [], env = {}, invocation = null }) {
    super();
    this.id = id;
    this.cwd = cwd;
    this.args = args;
    this.extraEnv = env;
    // tests inject a stub invocation (node + a stub script) instead of the real pi
    this.invocation = invocation;
    this.child = null;
    this.pending = new Map();
    this.lineBuf = Buffer.alloc(0);
    this.exited = false;
    this.exitCode = null;
    this.startedAt = 0;
    this.stderrTail = '';
    this.exitEmitted = false;
    this.spawnError = '';
    this.droppedBytes = 0;
    this.droppedRecords = 0;
  }

  get alive() {
    return !!this.child && !this.exited;
  }

  start() {
    const inv = this.invocation || resolvePiInvocation();
    if (!inv.cliPath) throw new Error('pi CLI not found; set STRATAPILOT_PI_CLI');
    if (!inv.nodePath) throw new Error('node runtime not found; set STRATAPILOT_NODE');

    const argv = [inv.cliPath, '--mode', 'rpc', ...this.args];
    const env = { ...process.env, ...this.extraEnv };
    if (inv.runAsNode) env.ELECTRON_RUN_AS_NODE = '1';
    env.STRATAPILOT = '1';

    this.startedAt = Date.now();
    this.child = spawn(inv.nodePath, argv, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    this.child.on('error', (err) => {
      // A spawn failure (ENOENT, EACCES, ...) fires 'error' and NOT 'exit'. If this handler only
      // logs, `exited` stays false: `alive` keeps answering true for a process that never started,
      // so every command waits its full timeout (the UI looks frozen rather than broken), the tab
      // stays in main.js's `processes` map (a storage cleanup then refuses to delete a session file
      // nothing is writing to), and the renderer's Restart button never appears because it only
      // shows while the tab's process is known to be dead. (#3)
      this.exited = true;
      this.spawnError = err.message;
      this.emit('log', `spawn error: ${err.message}`);
      this.emit('process_error', err);
      this.settlePending(`pi process failed to start: ${err.message}`);
      this.emitExit({ code: null, signal: null, error: err.message });
    });

    this.child.on('exit', (code, signal) => {
      this.exited = true;
      this.exitCode = code;
      this.settlePending(`pi process exited (code=${code} signal=${signal})`);
      this.emitExit({ code, signal });
    });

    this.child.stdout.on('data', (chunk) => this.onData(chunk));
    this.child.stderr.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      this.stderrTail = (this.stderrTail + text).slice(-20000);
      this.emit('stderr', text);
    });
    // an stdio stream error must not become an uncaught exception; the child's own 'error'/'exit'
    // events are what decide whether the process is gone
    this.child.stdout.on('error', (err) => this.emit('log', `stdout error: ${err.message}`));
    this.child.stderr.on('error', (err) => this.emit('log', `stderr error: ${err.message}`));
    this.child.stdin.on('error', (err) => this.emit('log', `stdin error: ${err.message}`));

    return this;
  }

  /**
   * Emit 'exit' at most once. A spawn failure fires 'error' and may or may not fire 'exit' after
   * it, and main.js tears the tab down on the first one - a second one would log a phantom exit
   * and re-send `pi:exit` for a tab that is already gone.
   */
  emitExit(info) {
    if (this.exitEmitted) return;
    this.exitEmitted = true;
    // a discarded record has to be visible somewhere: main.js logs the counters on the exit line,
    // and the log tail is part of the diagnostics report
    this.emit('exit', { ...info, stderr: this.stderrTail, droppedBytes: this.droppedBytes, droppedRecords: this.droppedRecords });
  }

  /**
   * Settle every in-flight command with the same failure envelope every other failure in this file
   * returns ({ success:false, error }). The pending entry used to alias `reject` to `resolve`, so
   * the exit path "rejected" by resolving with an Error instance: main.js forwards that value
   * straight to the renderer, where it carries no `error` field, so all 30+ `res.error || '...'`
   * call sites printed `unknown error` for the single most common real failure - the pi process
   * dying mid-session - while the log line right above said exactly why. (#4)
   */
  settlePending(message) {
    for (const { resolve, timer, command } of this.pending.values()) {
      clearTimeout(timer);
      resolve({ type: 'response', command, success: false, error: message, exited: true });
    }
    this.pending.clear();
  }

  onData(chunk) {
    const { records, rest } = splitRecords(this.lineBuf, chunk);
    for (const line of records) {
      let record;
      try {
        record = JSON.parse(line);
      } catch (err) {
        this.emit('log', `unparsable record: ${err.message}`);
        continue;
      }
      this.handleRecord(record);
    }
    if (rest.length > MAX_LINE_BYTES) {
      // report it, do not swallow it: a silently discarded record is worse than a loud one, and the
      // next record still frames correctly because the buffer restarts empty
      const dropped = rest.length;
      this.droppedBytes += dropped;
      this.droppedRecords += 1;
      this.lineBuf = Buffer.alloc(0);
      const detail = `stdout line buffer over ${MAX_LINE_BYTES} bytes: dropped ${dropped} bytes of an unterminated line, total ${this.droppedBytes} bytes in ${this.droppedRecords} drop(s) - a record was discarded, not saved`;
      this.emit('log', detail);
      return;
    }
    this.lineBuf = rest;
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
      this.pending.set(id, { resolve, timer, command: type });
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
    // the old code read `this.listeners('exit')[0]` into a `prev` variable and threw it away with
    // `void prev` - either it meant to re-register something or it was a leftover; either way it did
    // nothing, and a line that looks intentional but is inert is a trap for the next reader (#13)
    this.once('exit', () => clearTimeout(killTimer));
  }
}

/**
 * Pure JSONL framing helper: append `chunk` to the buffered bytes `buf` and
 * return { records, rest }. Splitting is byte-level on a Buffer and on LF
 * (0x0a) only, so U+2028/U+2029 inside JSON strings never split a record and a
 * multi-byte UTF-8 character split across chunk boundaries stays intact (the
 * incomplete bytes remain in `rest` and are decoded only once the LF arrives).
 * Trailing CR is stripped (CRLF tolerant); blank/whitespace-only lines are
 * dropped. `records` are decoded strings, `rest` is the trailing partial line.
 */
function splitRecords(buf, chunk) {
  let rest = chunk && chunk.length ? Buffer.concat([buf, chunk]) : buf;
  const records = [];
  let idx;
  while ((idx = rest.indexOf(0x0a)) !== -1) {
    let line = rest.subarray(0, idx).toString('utf8');
    rest = rest.subarray(idx + 1);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (line.trim()) records.push(line);
  }
  return { records, rest };
}

module.exports = { PiRpcProcess, splitRecords, MAX_LINE_BYTES };
