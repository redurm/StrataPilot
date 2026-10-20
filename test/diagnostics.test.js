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

const { redact, redactText, scrubInline, isSecretKey, readConfig, tail, format, REDACTED } = require('../lib/diagnostics');

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

test('format(): the token ledger summary is part of the report (D9)', () => {
  const withUsage = {
    ...SAMPLE,
    usage: {
      all: { in: 1004395, out: 446453, cacheRead: 39674771, cacheWrite: 0, total: 41125619, answers: 560, compactions: 3, branches: 0 },
      entries: 6,
      gone: 1,
      truncated: 0,
      dedupeMissed: 1,
      dayCount: 9,
      ledgerFile: 'U:/token_usage.json',
    },
    usageRates: {
      unit: 'usd_per_million',
      default: { in: 1, out: 2, cacheRead: 0.1, cacheWrite: 0 },
      byModel: {
        'qwen3.8-flash-next-iq3_s': { in: 0.5, out: 1, cacheRead: 0.05, cacheWrite: 0 },
        untouched: { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 },
      },
    },
  };
  const flat = format(withUsage).replace(/ {2,}/g, ' ');
  assert.ok(flat.includes('token ledger 41,125,619 tokens'), 'total missing');
  assert.ok(flat.includes('in 1,004,395 / out 446,453 / cache read 39,674,771 / cache write 0'), 'the split is missing');
  assert.ok(flat.includes('from 6 session file(s) over 9 session-days'));
  assert.ok(flat.includes('560 model replies, 3 compaction summaries, 0 branch summaries'), 'compact spend must be visible');
  assert.ok(flat.includes('U:/token_usage.json'));
  assert.ok(flat.includes('1 session file(s) already deleted (history kept)'));
  assert.ok(flat.includes('1 fork(s) not deduplicated (parent session file gone)'));
  // the rates live in settings, not in the ledger, so the report has to carry them
  assert.ok(flat.includes('USD per 1,000,000 tokens - default: in 1 / out 2 / cache read 0.1 / cache write 0'), 'the default rate is missing');
  assert.ok(flat.includes('qwen3.8-flash-next-iq3_s: in 0.5 / out 1 / cache read 0.05 / cache write 0'), 'the model rate row is missing');
  assert.ok(!flat.includes('untouched:'), 'an all-empty model row must not be reported as a rate');
  // no ledger summary, no half-empty lines
  assert.ok(!format(SAMPLE).includes('token ledger'));
});

test('format(): with a ledger but no rates it says the money side reads $0', () => {
  const flat = format({
    ...SAMPLE,
    usage: { all: { in: 10, out: 5, cacheRead: 0, cacheWrite: 0, total: 15, answers: 2, compactions: 0, branches: 0 }, entries: 1, gone: 0, truncated: 0, dedupeMissed: 0, dayCount: 1, ledgerFile: 'U:/token_usage.json' },
  }).replace(/ {2,}/g, ' ');
  assert.ok(flat.includes('no rates entered'), 'the report must not leave the reader guessing why there is no money');
  assert.ok(!flat.includes('rate rows'));
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

test('isSecretKey(): a key that merely ENDS in a metadata word is still a secret (#7)', () => {
  // the old order let METADATA_KEY_RE win first, and its list ended in `…|name|…|header|headers|$`,
  // so every one of these was treated as metadata and pasted into the report verbatim
  for (const key of ['authorization', 'authorization_header', 'api_key_name', 'token', 'access_token', 'x-api-key', 'cookie', 'password_name', 'secret_key']) {
    assert.equal(isSecretKey(key), true, `isSecretKey(${JSON.stringify(key)}) must be true`);
  }
  // metadata ABOUT such a field stays, or the report stops being usable
  for (const key of ['token_type', 'key_type', 'auth_kind', 'api_key_count', 'secret_supported', 'password_enabled']) {
    assert.equal(isSecretKey(key), false, `isSecretKey(${JSON.stringify(key)}) must stay false`);
  }
  // and an ordinary name is untouched
  for (const key of ['model_name', 'baseUrl', 'max_context', 'name']) {
    assert.equal(isSecretKey(key), false, `isSecretKey(${JSON.stringify(key)}) must stay false`);
  }
});

test('redact(): authorization_header and friends no longer survive as a literal credential (#7)', () => {
  const out = redact({ headers: { authorization_header: `Bearer sk-${'b'.repeat(24)}` }, token_type: 'Bearer' });
  assert.equal(out.headers.authorization_header, REDACTED);
  assert.equal(out.token_type, 'Bearer', 'metadata about the field is not the credential');
  assert.ok(!JSON.stringify(out).includes(`sk-${'b'.repeat(24)}`));
});

test('redact(): a credential-shaped value under a harmless-looking key is scrubbed too (#7)', () => {
  const sk = `sk-${'b'.repeat(24)}`;
  const out = redact({ note: `loaded with key ${sk}`, model: 'qwen' });
  assert.ok(!JSON.stringify(out).includes(sk));
  assert.equal(out.model, 'qwen', 'ordinary values are kept verbatim');
});

test('scrubInline(): bare tokens in free text are scrubbed, not just "Bearer …" and "key = value" (#7)', () => {
  // built from parts on purpose: a literal token in the source trips GitHub's push protection, and
  // these are shapes, not credentials
  const shapes = [
    [`model loaded with key sk-${'b'.repeat(24)}`, `sk-${'b'.repeat(24)}`],
    [`jwt eyJ${'c'.repeat(20)}.eyJ${'d'.repeat(12)}.eee`, `eyJ${'c'.repeat(20)}.eyJ${'d'.repeat(12)}.eee`],
    [`pushed with ghp_${'a'.repeat(24)}`, `ghp_${'a'.repeat(24)}`],
    [`slack xoxb-${'1'.repeat(12)}-${'2'.repeat(12)}-${'f'.repeat(16)}`, `xoxb-${'1'.repeat(12)}-${'2'.repeat(12)}-${'f'.repeat(16)}`],
    [`google AIza${'e'.repeat(35)}`, `AIza${'e'.repeat(35)}`],
    [`aws AKIA${'F'.repeat(16)}`, `AKIA${'F'.repeat(16)}`],
  ];
  for (const [input, secret] of shapes) {
    const out = scrubInline(input);
    assert.ok(!out.includes(secret), `not scrubbed: ${input} -> ${out}`);
    assert.ok(out.includes(REDACTED), `no marker left in: ${out}`);
  }
});

test('format(): no credential shape survives the whole report (#7)', () => {
  const jwt = `eyJ${'c'.repeat(20)}.eyJ${'d'.repeat(12)}.eee`;
  const sk = `sk-${'b'.repeat(24)}`;
  const ghp = `ghp_${'a'.repeat(24)}`;
  const leaky = {
    ...SAMPLE,
    strata: {
      ...SAMPLE.strata,
      healthText: `{"max_context":262144,"auth":"${jwt}"}`,
      modelsText: `default key ${sk}`,
      engineConfig: { path: 'E', ok: true, data: { headers: { authorization_header: `Bearer ${sk}` } } },
    },
    pi: { ...SAMPLE.pi, modelsJson: { path: 'M', ok: true, data: { providers: { strata: { note: ghp } } } } },
    log: { path: 'L:/log', lines: [`[pi stderr] using ${sk} for the run`], note: '' },
  };
  const text = format(leaky);
  for (const secret of [jwt, sk, ghp]) {
    assert.ok(!text.includes(secret), `leaked into the report: ${secret}`);
  }
  // the report still says what it needs to say
  assert.ok(text.includes('max_context'));
  assert.ok(text.includes('[pi stderr] using'));
});

test('redactText(): a bare token on a line that names no key still goes (#7)', () => {
  const sk = `sk-${'b'.repeat(24)}`;
  const out = redactText(`port 8081\nusing ${sk} now\nmodel_name qwen`);
  assert.ok(out.includes('port 8081'));
  assert.ok(out.includes('model_name qwen'));
  assert.ok(!out.includes(sk));
});

test('format(): empty data still produces a usable report', () => {
  const text = format({});
  assert.ok(text.includes('StrataPilot — diagnostics'));
  assert.ok(text.includes('(not reported)'));
  assert.ok(text.includes('(no open tabs reported)'));
  assert.ok(text.includes('log file not initialised') || text.includes('[7] log tail'));
});
