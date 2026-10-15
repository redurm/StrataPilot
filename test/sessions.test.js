'use strict';

/*
 * Unit tests for lib/sessions.js.
 *
 * Safety: PI_CODING_AGENT_SESSION_DIR is pointed at a throwaway temp dir before
 * anything in lib/sessions.js can run, so the real ~/.pi/agent/sessions is
 * never read, written or deleted by this test.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// point the sessions root at a temp dir BEFORE requiring the module under test
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-on-strata-sessions-'));
process.env.PI_CODING_AGENT_SESSION_DIR = tmpRoot;

const { sessionsRoot, listSessions, readSessionMeta, deleteSession, renameSession } = require('../lib/sessions');

const FIXTURE_ROOT = path.join(__dirname, 'fixtures', 'sessions');
const MAX_SCAN_BYTES = 12 * 1024 * 1024;

function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else fs.copyFileSync(from, to);
  }
}

function fixture(name) {
  return path.join(FIXTURE_ROOT, name);
}

test.after(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

/* ---- sessionsRoot ---- */

test('sessionsRoot honours PI_CODING_AGENT_SESSION_DIR (the temp dir, never ~/.pi)', () => {
  assert.equal(sessionsRoot(), tmpRoot);
  assert.notEqual(sessionsRoot(), path.join(os.homedir(), '.pi', 'agent', 'sessions'));
});

/* ---- readSessionMeta: entry types ---- */

test('readSessionMeta parses session / session_info / model_change / usage / message / toolResult', () => {
  const meta = readSessionMeta(fixture(path.join('g1', 'full.jsonl')));
  assert.equal(meta.id, 's-1');
  assert.equal(meta.cwd, 'C:/work/demo');
  assert.equal(meta.groupDir, 'g1');
  assert.equal(meta.fileName, 'full.jsonl');
  assert.equal(meta.createdAt, '2024-01-01T00:00:00.000Z');
  assert.equal(meta.version, 1);
  assert.equal(meta.name, 'My Named Session');
  assert.equal(meta.model, 'claude-opus-4-1');
  assert.equal(meta.thinkingLevel, 'high');
  assert.equal(meta.messageCount, 3);
  assert.equal(meta.userCount, 1);
  assert.equal(meta.assistantCount, 1);
  assert.equal(meta.toolCallCount, 1);
  assert.equal(meta.totalTokens, 420); // 120 from the assistant message + 300 from the usage entry
  assert.ok(Math.abs(meta.cost - 0.17) < 1e-9, `cost: ${meta.cost}`);
  assert.equal(meta.firstUserText, 'first user question [image]');
  assert.equal(meta.lastAssistantText, 'assistant answer');
  // last message-entry timestamp wins; note the `usage` case does not touch updatedAt
  assert.equal(meta.updatedAt, '2024-01-01T00:05:00.000Z');
  assert.equal(meta.truncatedScan, false);
  assert.ok(meta.sizeBytes > 0);
});

test('title fallback chain: session_info name > first user text > file name', () => {
  assert.equal(readSessionMeta(fixture(path.join('g1', 'full.jsonl'))).title, 'My Named Session');
  assert.equal(readSessionMeta(fixture(path.join('g1', 'unnamed.jsonl'))).title, 'how do I resize a partition');
  assert.equal(readSessionMeta(fixture(path.join('g1', 'no_text.jsonl'))).title, 'no_text');
});

/* ---- textOfContent limits (exercised through readSessionMeta) ---- */

test('textOfContent: user text capped at 400 chars, assistant text at 300', () => {
  const meta = readSessionMeta(fixture(path.join('g1', 'long.jsonl')));
  assert.equal(meta.firstUserText.length, 400);
  assert.equal(meta.lastAssistantText.length, 300);
});

test('textOfContent: string content and whitespace collapsing', () => {
  const meta = readSessionMeta(fixture(path.join('g2', 'other_group.jsonl')));
  assert.equal(meta.firstUserText, 'plain string content');
  // "first   user question" collapses to single spaces
  const full = readSessionMeta(fixture(path.join('g1', 'full.jsonl')));
  assert.equal(full.firstUserText, 'first user question [image]');
});

/* ---- truncatedScan for files over MAX_SCAN_BYTES ---- */

test('files bigger than MAX_SCAN_BYTES set truncatedScan and stop scanning early', () => {
  const dir = path.join(tmpRoot, 'big_group');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'huge.jsonl');
  const lines = [JSON.stringify({ type: 'session', id: 's-big', timestamp: '2024-02-01T00:00:00.000Z', cwd: 'C:/big', version: 1 })];
  // pre-build one ~1KB message line and repeat it, tracking bytes incrementally
  // (re-joining the whole array every iteration would be quadratic)
  const padLine = JSON.stringify({ type: 'message', id: 'm-pad', timestamp: '2024-02-01T00:00:01.000Z', message: { role: 'user', content: 'x'.repeat(1000) } });
  const padBytes = Buffer.byteLength(padLine) + 1;
  let bytes = Buffer.byteLength(lines[0]) + 1;
  while (bytes < MAX_SCAN_BYTES + 2 * 1024 * 1024) {
    lines.push(padLine);
    bytes += padBytes;
  }
  // a name placed after the scan cap must never be seen
  lines.push(JSON.stringify({ type: 'session_info', id: 'late', timestamp: '2024-02-01T00:00:02.000Z', name: 'DEEP-NAME' }));
  fs.writeFileSync(file, lines.join('\n') + '\n');

  const meta = readSessionMeta(file);
  assert.ok(meta.sizeBytes > MAX_SCAN_BYTES, `sizeBytes: ${meta.sizeBytes}`);
  assert.equal(meta.truncatedScan, true);
  assert.notEqual(meta.name, 'DEEP-NAME');
  assert.equal(meta.name, '', 'the deep session_info must not be picked up');
  assert.notEqual(meta.title, 'DEEP-NAME');
  assert.ok(meta.userCount > 0, 'the head of the file must still be scanned');
});

/* ---- renameSession: append-only ---- */

test('renameSession appends one session_info entry and never rewrites existing lines', () => {
  const dir = path.join(tmpRoot, 'g1');
  copyTree(FIXTURE_ROOT, tmpRoot); // both groups, so listSessions sees them too
  const file = path.join(dir, 'full.jsonl');
  const before = fs.readFileSync(file, 'utf8');

  const meta = renameSession(file, '  Renamed Title  ');
  const after = fs.readFileSync(file, 'utf8');

  assert.ok(after.startsWith(before), 'rename must be append-only: original bytes kept verbatim');
  const appended = after.slice(before.length).trim().split('\n');
  assert.equal(appended.length, 1, 'exactly one new line');
  const entry = JSON.parse(appended[0]);
  assert.equal(entry.type, 'session_info');
  assert.equal(entry.name, 'Renamed Title', 'name is trimmed');
  assert.equal(entry.parentId, 'g1', 'parentId chains to the previous leaf id');
  assert.ok(entry.id);
  assert.ok(!Number.isNaN(Date.parse(entry.timestamp)));

  assert.equal(meta.title, 'Renamed Title');
  assert.equal(meta.name, 'Renamed Title');

  // a second rename appends again; the last session_info wins
  renameSession(file, 'Second Name');
  const again = fs.readFileSync(file, 'utf8');
  assert.ok(again.startsWith(after));
  assert.equal(readSessionMeta(file).title, 'Second Name');
});

test('renameSession rejects an empty name', () => {
  const file = path.join(tmpRoot, 'g1', 'unnamed.jsonl');
  assert.throws(() => renameSession(file, '   '), /name is required/);
});

/* ---- assertInsideRoot guard (through renameSession / deleteSession) ---- */

test('guard: rejects .. traversal out of the sessions root', () => {
  const escape = path.join(tmpRoot, '..', 'evil.jsonl');
  assert.throws(() => renameSession(escape, 'x'), /refusing to touch path outside the sessions dir/);
  assert.throws(() => deleteSession(escape), /refusing to touch path outside the sessions dir/);
});

test('guard: rejects non-.jsonl files inside the root', () => {
  const txt = path.join(tmpRoot, 'g1', 'notes.txt');
  fs.copyFileSync(fixture(path.join('g1', 'full.jsonl')), txt);
  assert.throws(() => renameSession(txt, 'x'), /only \.jsonl session files can be modified/);
  assert.throws(() => deleteSession(txt), /only \.jsonl session files can be modified/);
  assert.ok(fs.existsSync(txt), 'the guard must reject before touching the file');
});

test('guard: rejects absolute paths outside the root (even if they exist)', () => {
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-on-strata-outside-'));
  try {
    const victim = path.join(elsewhere, 'full.jsonl');
    fs.copyFileSync(fixture(path.join('g1', 'full.jsonl')), victim);
    assert.throws(() => deleteSession(victim), /refusing to touch path outside the sessions dir/);
    assert.throws(() => renameSession(victim, 'x'), /refusing to touch path outside the sessions dir/);
    assert.ok(fs.existsSync(victim), 'file outside the root must survive the rejected call');
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

test('guard: the sessions root itself is not a valid target', () => {
  assert.throws(() => deleteSession(tmpRoot), /refusing to touch path outside the sessions dir/);
});

test('deleteSession removes a .jsonl inside the root', () => {
  const file = path.join(tmpRoot, 'g1', 'no_text.jsonl');
  assert.ok(fs.existsSync(file));
  assert.equal(deleteSession(file), true);
  assert.ok(!fs.existsSync(file));
  assert.equal(deleteSession(file), true, 'force: true makes a second delete a no-op');
});

/* ---- listSessions ---- */

test('listSessions scans groups, sorts by updatedAt desc, filters and limits', () => {
  const res = listSessions();
  assert.equal(res.root, tmpRoot);
  const names = res.sessions.map((s) => s.fileName);
  assert.ok(names.includes('full.jsonl'));
  assert.ok(names.includes('other_group.jsonl'));
  assert.ok(!names.includes('no_text.jsonl'), 'deleted in the previous test');
  const huge = res.sessions.find((s) => s.fileName === 'huge.jsonl');
  assert.ok(huge && huge.truncatedScan, 'the big file under the root is listed with truncatedScan');

  const updated = res.sessions.map((s) => s.updatedAt);
  const sorted = [...updated].sort((a, b) => b.localeCompare(a));
  assert.deepEqual(updated, sorted, 'must be sorted by updatedAt descending');

  const hit = listSessions({ query: 'PARTITION' });
  assert.equal(hit.sessions.length, 1);
  assert.equal(hit.sessions[0].fileName, 'unnamed.jsonl');

  const byModel = listSessions({ query: 'gpt-5' });
  const modelFiles = byModel.sessions.map((s) => s.fileName);
  assert.ok(modelFiles.includes('unnamed.jsonl'), `gpt-5 matches the assistant model: ${modelFiles}`);
  assert.ok(modelFiles.includes('long.jsonl'), `gpt-5 matches the assistant model: ${modelFiles}`);

  const limited = listSessions({ limit: 1 });
  assert.equal(limited.sessions.length, 1);
  assert.ok(limited.total >= 3, `total: ${limited.total}`);
});
