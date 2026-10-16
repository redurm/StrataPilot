'use strict';

/*
 * Unit tests for lib/diagnostics.js — the "Copy diagnostics" report.
 *
 * No Electron, no pi, no Strata: the report is built from a plain data object plus a couple
 * of files in a temp folder, so the redaction rules (the part that must never leak a key)
 * and the log tail are fully testable here.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { redact, redactText, scrubInline, readConfig, tail, format, REDACTED } = require('../lib/diagnostics');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-diag-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

function write(name, content) {
  const target = path.join(tmp, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, 'utf8');
  return target;
}

/* -- redaction -------------------------------------------------------- */

test('redact(): api keys and bearer tokens never survive, at any depth', () => {
  const input = {
    apiKey: 'sk-secret',
    providers: {
      strata: {
        baseUrl: 'http://127.0.0.1:8081/v1',
        apiKey: 'hunter2',
        nested: [{ STRATA_API_KEY: 'a', authorization: 'Bearer xyz', token_type: 'bearer' }],
      },
    },
    models: [{ id: 'qwen', cost: { input: 0 } }],
  };
  const out = redact(input);
  const text = JSON.stringify(out);
  assert.ok(!text.includes('sk-secret'));
  assert.ok(!text.includes('hunter2'));
  assert.ok(!text.includes('xyz'));
  assert.equal(out.apiKey, REDACTED);
  assert.equal(out.providers.strata.apiKey, REDACTED);
  assert.equal(out.providers.strata.nested[0].STRATA_API_KEY, REDACTED);
  assert.equal(out.providers.strata.nested[0].authorization, REDACTED);
  // non-secret values are kept verbatim: the report is useless if it redacts everything
  assert.equal(out.providers.strata.baseUrl, 'http://127.0.0.1:8081/v1');
  assert.equal(out.providers.strata.nested[0].token_type, 'bearer');
  assert.deepEqual(out.models[0], { id: 'qwen', cost: { input: 0 } });
});

test('redactText(): invalid JSON falls back to dropping secret-looking lines', () => {
  const text = redactText('port 8081\n--api-key supersecret\nmodel_name qwen');
  assert.ok(text.includes('port 8081'));
  assert.ok(text.includes('model_name qwen'));
  assert.ok(!text.includes('supersecret'));
});

/* -- config files ----------------------------------------------------- */

test('readConfig(): reads and redacts a models.json-style file', () => {
  const file = write('models.json', JSON.stringify({ providers: { strata: { apiKey: 'k', baseUrl: 'http://x/v1' } } }));
  const res = readConfig(file);
  assert.equal(res.ok, true);
  assert.equal(res.data.providers.strata.apiKey, REDACTED);
  assert.equal(res.data.providers.strata.baseUrl, 'http://x/v1');
});

test('readConfig(): missing, empty and directory targets report an error instead of throwing', () => {
  assert.equal(readConfig(path.join(tmp, 'nope.json')).ok, false);
  assert.equal(readConfig('').ok, false);
  assert.match(readConfig(tmp).error, /directory/);
  const broken = write('broken.json', '{ not json');
  const res = readConfig(broken);
  assert.equal(res.ok, false);
  assert.ok(res.error);
});

/* -- log tail --------------------------------------------------------- */

test('tail(): keeps the last N lines and drops the partial line the read window starts in', () => {
  const file = write('stratapilot.log', Array.from({ length: 400 }, (_, i) => `[2026-01-01T00:00:00.000Z] [INFO] line-${i}`).join('\n') + '\n');
  const res = tail(file, { maxBytes: 500, maxLines: 5 });
  assert.equal(res.lines.length, 5);
  assert.equal(res.lines[4], '[2026-01-01T00:00:00.000Z] [INFO] line-399');
  // the first kept line must be a complete record, never a fragment of one
  assert.match(res.lines[0], /^\[/);
  assert.ok(res.note.includes('showing last'));
});

test('tail(): a small file is returned whole, CRLF tolerated, blanks dropped', () => {
  const file = write('small.log', 'one\r\n\r\ntwo\r\nthree');
  const res = tail(file, { maxBytes: 4096, maxLines: 10 });
  assert.deepEqual(res.lines, ['one', 'two', 'three']);
  assert.equal(res.note, '');
});

test('tail(): a missing log file is a note, not an exception', () => {
  const res = tail(path.join(tmp, 'missing.log'));
  assert.deepEqual(res.lines, []);
  assert.match(res.note, /could not read log/);
});

/* -- report layout ---------------------------------------------------- */

const SAMPLE = {
  app: { appVersion: '0.1.0', electronVersion: '40.10.2', nodeVersion: '22.19.0', platform: 'win32/x64', logPath: 'L:/log', settingsPath: 'S:/settings', sessionsRoot: 'R:/sessions', defaultCwd: 'C:/app' },
  pi: { cliPath: 'C:/pi/cli.js', nodePath: 'node', runAsNode: false, piVersion: '1.2.0', testedVersion: '1.2.0', sessionsRoot: 'R:/sessions', settingsFile: 'C:/pi/settings.json', defaultModel: { path: 'C:/pi/settings.json', ok: true, data: { defaultModel: 'qwen' } }, modelsJson: { path: 'C:/pi/models.json', ok: true, data: { providers: { strata: { apiKey: REDACTED } } } } },
  strata: { baseUrl: 'http://127.0.0.1:8081', healthText: '{"max_context":262144}', modelsText: '{"data":[{"id":"qwen"}]}', metricsUrl: 'http://127.0.0.1:8081/metrics', engineConfig: { path: '', ok: false, error: 'settings.strataConfigPath is not set' } },
  queue: { serial: true, active: 'tab 1', rows: [{ label: 'tab 1', state: 'idle', cwd: 'C:/repo', sessionPath: 'R:/sessions/a.jsonl', outbox: 2, model: 'strata/qwen' }] },
  log: { path: 'L:/log', lines: ['[INFO] line 1', '[ERROR] [crash] renderer gone'], note: '' },
};

test('format(): covers the five items docs/TROUBLESHOOTING.md asks reporters for', () => {
  const flat = format(SAMPLE).replace(/ {2,}/g, ' ');
  for (const needle of [
    'app version 0.1.0',
    'electron 40.10.2',
    'cli C:/pi/cli.js',
    'pi version 1.2.0',
    'tested against 1.2.0',
    'sessions root R:/sessions',
    'base url http://127.0.0.1:8081',
    'health {"max_context":262144}',
    'serial queue true',
    'tab 1 [idle] cwd=C:/repo session=R:/sessions/a.jsonl outbox=2 model=strata/qwen',
    '[ERROR] [crash] renderer gone',
    'symptom / reproduction steps',
  ]) {
    assert.ok(flat.includes(needle), `missing: ${needle}`);
  }
});

test('format(): a key never survives, even when the caller forgot to redact', () => {
  const leaky = {
    ...SAMPLE,
    pi: { ...SAMPLE.pi, modelsJson: { path: 'M', ok: true, data: { providers: { strata: { apiKey: 'oops' } } } } },
    strata: { ...SAMPLE.strata, healthText: '{"api_key": "inline-secret", "max_context": 1}' },
    log: { path: 'L:/log', lines: ['[pi stderr] models.json apiKey: stderr-secret', 'Authorization: Bearer header-secret'], note: '' },
  };
  const text = format(leaky);
  for (const secret of ['oops', 'inline-secret', 'stderr-secret', 'header-secret']) {
    assert.ok(!text.includes(secret), `leaked: ${secret}`);
  }
  // the surrounding context stays readable, which is the whole point of the report
  assert.ok(text.includes('max_context'));
  assert.ok(text.includes('[pi stderr] models.json apiKey:'));
  assert.ok(text.includes('Authorization: Bearer'));
});

test('scrubInline(): bearer headers, JSON keys and key: value pairs are all masked', () => {
  assert.equal(scrubInline('Authorization: Bearer abc.def-123/x='), 'Authorization: Bearer ***');
  assert.equal(scrubInline('{"apiKey":"k1","model":"qwen"}'), '{"apiKey":"***","model":"qwen"}');
  assert.equal(scrubInline('--api-key topsecret --port 8081'), '--api-key *** --port 8081');
  assert.equal(scrubInline('nothing sensitive here'), 'nothing sensitive here');
});

test('format(): empty data still produces a usable report', () => {
  const text = format({});
  assert.ok(text.includes('StrataPilot — diagnostics'));
  assert.ok(text.includes('(not reported)'));
  assert.ok(text.includes('(no open tabs reported)'));
  assert.ok(text.includes('log file not initialised') || text.includes('[7] log tail'));
});
