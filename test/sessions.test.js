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
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-sessions-'));
process.env.PI_CODING_AGENT_SESSION_DIR = tmpRoot;

const { sessionsRoot, listSessions, readSessionMeta, deleteSession, renameSession, clearSessionCache, cacheSize } = require('../lib/sessions');

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
  // in/out are tracked apart from the total: the chip in the session list shows them separately
  assert.equal(meta.inputTokens, 350);
  assert.equal(meta.outputTokens, 70);
  assert.equal(meta.cacheReadTokens, 1500);
  assert.equal(meta.cacheWriteTokens, 0);
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
  const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-outside-'));
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

/* ---- listSessions metadata cache (B3) ---- */

// iterSessionFiles() only walks <root>/<group>/<file>.jsonl, so the probe file needs to sit
// directly in its own group folder
const cacheDir = path.join(tmpRoot, '_cache_probe');
fs.mkdirSync(cacheDir, { recursive: true });
const cacheFile = path.join(cacheDir, 'cached.jsonl');

function sessionWith(name, firstText) {
  return [
    { type: 'session', id: 'cache-1', cwd: 'C:/work', timestamp: '2024-05-05T00:00:00.000Z', version: 1 },
    { type: 'session_info', id: 'cache-2', parentId: 'cache-1', timestamp: '2024-05-05T00:00:01.000Z', name },
    { type: 'message', id: 'cache-3', parentId: 'cache-2', timestamp: '2024-05-05T00:00:02.000Z', message: { role: 'user', content: [{ type: 'text', text: firstText }] } },
  ]
    .map((entry) => JSON.stringify(entry))
    .join('\n') + '\n';
}

function findIn(list, name) {
  return list.sessions.find((s) => s.fileName === name);
}

/** Count how often lib/sessions.js opens a given file (readSessionMeta is the only reader). */
function countOpensOf(needle, run) {
  const realOpen = fs.openSync;
  let opens = 0;
  fs.openSync = function patched(...args) {
    if (String(args[0]).includes(needle)) opens++;
    return realOpen.apply(fs, args);
  };
  try {
    run();
  } finally {
    fs.openSync = realOpen;
  }
  return opens;
}

test('cache: the first list reads the file, the second one does not', () => {
  clearSessionCache();
  fs.writeFileSync(cacheFile, sessionWith('Cache Title One', 'hello cache'), 'utf8');
  const first = countOpensOf('cached.jsonl', () => {
    var found = findIn(listSessions(), 'cached.jsonl');
    assert.equal(found.title, 'Cache Title One');
  });
  assert.ok(first >= 1, `the first list must read the file (opens=${first})`);

  // the case that matters: the sidebar refreshes after almost every message, while most session
  // files did not change at all
  const second = countOpensOf('cached.jsonl', () => {
    var found = findIn(listSessions(), 'cached.jsonl');
    assert.equal(found.title, 'Cache Title One');
  });
  assert.equal(second, 0, 'an unchanged (mtimeMs, size) file must not be opened again');
});

test('cache: clearing it makes the same file read again', () => {
  clearSessionCache();
  const opens = countOpensOf('cached.jsonl', () => {
    var found = findIn(listSessions(), 'cached.jsonl');
    assert.equal(found.title, 'Cache Title One');
  });
  assert.ok(opens >= 1, `after clearSessionCache() the file must be read again (opens=${opens})`);
});

test('cache: an appended line changes the size, so the file is re-read', () => {
  fs.appendFileSync(cacheFile, JSON.stringify({ type: 'session_info', id: 'cache-9', name: 'Renamed By Append' }) + '\n', 'utf8');
  const opens = countOpensOf('cached.jsonl', () => {
    var found = findIn(listSessions(), 'cached.jsonl');
    assert.equal(found.title, 'Renamed By Append');
  });
  assert.ok(opens >= 1, `a size change must force a re-read (opens=${opens})`);
});

test('cache: renameSession and deleteSession drop the entry instead of returning stale data', () => {
  renameSession(cacheFile, 'Named Through RPC');
  assert.equal(findIn(listSessions(), 'cached.jsonl').title, 'Named Through RPC');
  deleteSession(cacheFile);
  assert.equal(findIn(listSessions(), 'cached.jsonl'), undefined);
  assert.ok(!fs.existsSync(cacheFile));
  assert.throws(() => readSessionMeta(cacheFile), /ENOENT/);
});

test('cache: a file that disappears between lists is dropped from the cache', () => {
  const ghost = path.join(cacheDir, 'ghost.jsonl');
  fs.writeFileSync(ghost, sessionWith('Ghost', 'boo'), 'utf8');
  listSessions();
  const withGhost = cacheSize();
  assert.ok(findIn(listSessions(), 'ghost.jsonl'));
  fs.rmSync(ghost);
  listSessions();
  assert.equal(cacheSize(), withGhost - 1, 'the vanished file must leave the cache');
  assert.equal(findIn(listSessions(), 'ghost.jsonl'), undefined);
});

/* ---- D7: storage stats, cleanup plan, bulk delete ---- */

const { storageStats, cleanupPlan, deleteSessions } = require('../lib/sessions');

/** Point sessionsRoot() somewhere else for one test (it reads the env var on every call). */
function withRoot(dir, run) {
  const previous = process.env.PI_CODING_AGENT_SESSION_DIR;
  process.env.PI_CODING_AGENT_SESSION_DIR = dir;
  try {
    return run();
  } finally {
    process.env.PI_CODING_AGENT_SESSION_DIR = previous;
  }
}

function makeSession(dir, name, bytes, mtimeMs) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'x'.repeat(bytes), 'utf8');
  if (mtimeMs != null) {
    const when = new Date(mtimeMs);
    fs.utimesSync(file, when, when);
  }
  return file;
}

const DAY = 86400000;

test('storageStats: one group per folder-group directory, sized from stat without parsing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-d7-'));
  try {
    const g1 = path.join(root, 'g1');
    const g2 = path.join(root, 'g2');
    const big = makeSession(g1, 'big.jsonl', 5000);
    // an explicit older mtime: written back-to-back, both files used to land in the same clock
    // tick, so the "newest first" sort below had nothing to order by and the assertion flipped
    // about one run in fifteen
    makeSession(g1, 'small.jsonl', 100, Date.now() - DAY);
    makeSession(g2, 'other.jsonl', 1000);
    fs.writeFileSync(path.join(g1, 'not-a-session.txt'), 'ignore me', 'utf8');
    fs.mkdirSync(path.join(root, 'loose'), { recursive: true });
    fs.writeFileSync(path.join(root, 'loose.jsonl'), 'not in a group dir', 'utf8');

    withRoot(root, () => {
      const stats = storageStats();
      assert.equal(stats.root, root);
      assert.equal(stats.totalFiles, 3, 'only .jsonl inside a group directory counts (the loose one at the root does not)');
      assert.equal(stats.totalBytes, 6100);
      assert.deepEqual(stats.groups.map((group) => group.group), ['g1', 'g2'], 'biggest first');
      assert.equal(stats.groups[0].files, 2);
      assert.equal(stats.groups[0].bytes, 5100);
      assert.deepEqual(stats.groups[0].entries.map((entry) => path.basename(entry.path)), ['big.jsonl', 'small.jsonl'], 'newest first');
      assert.ok(stats.groups[0].newestMs >= stats.groups[0].oldestMs);
      assert.equal(stats.groups[0].dir, g1);
      assert.ok(fs.existsSync(big));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('cleanupPlan: age rule and per-folder cap, and neither rule deletes anything by itself', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-d7-'));
  try {
    const g1 = path.join(root, 'g1');
    const now = Date.now();
    makeSession(g1, 'old-a.jsonl', 400, now - 90 * DAY);
    makeSession(g1, 'old-b.jsonl', 600, now - 40 * DAY);
    makeSession(g1, 'new-a.jsonl', 100, now - 1 * DAY);
    makeSession(g1, 'new-b.jsonl', 50, now - 2 * DAY);
    makeSession(path.join(root, 'g2'), 'solo.jsonl', 700, now - 90 * DAY);

    withRoot(root, () => {
      const byAge = cleanupPlan({ olderThanDays: 30 });
      assert.equal(byAge.candidates.length, 3, 'the two 40+ day old files in g1 plus the 90 day one in g2');
      assert.equal(byAge.bytes, 1700);
      assert.ok(byAge.candidates.every((entry) => /older than 30 days/.test(entry.reason)));
      assert.ok(byAge.candidates.every((entry) => entry.group === 'g1' || entry.group === 'g2'));

      const byCount = cleanupPlan({ keepNewestPerGroup: 2 });
      assert.deepEqual(byCount.candidates.map((entry) => path.basename(entry.path)).sort(), ['old-a.jsonl', 'old-b.jsonl'], 'the two oldest of g1, g2 keeps its only file');
      assert.equal(byCount.bytes, 1000);
      assert.ok(byCount.candidates.every((entry) => /beyond the 2 newest/.test(entry.reason)));

      const none = cleanupPlan({});
      assert.equal(none.candidates.length, 0);
      assert.equal(none.scannedFiles, 5);
      assert.equal(fs.readdirSync(g1).length, 4, 'planning must not delete');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deleteSessions: bulk delete, skips files an open tab is using, reports paths outside the root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-d7-'));
  try {
    const g1 = path.join(root, 'g1');
    const doomed = makeSession(g1, 'doomed.jsonl', 300);
    const open = makeSession(g1, 'open.jsonl', 400);
    const kept = makeSession(g1, 'kept.jsonl', 500);

    withRoot(root, () => {
      const result = deleteSessions([doomed, open, path.join(os.tmpdir(), 'outside-should-be-refused.jsonl')], { skip: new Set([open]) });
      assert.equal(result.deleted, 1);
      assert.equal(result.bytes, 300);
      assert.deepEqual(result.skipped.map((entry) => path.basename(entry)), ['open.jsonl']);
      assert.equal(result.failed.length, 1);
      assert.match(result.failed[0].error, /refusing to touch path outside the sessions dir/);
      assert.ok(!fs.existsSync(doomed));
      assert.ok(fs.existsSync(open));
      assert.ok(fs.existsSync(kept));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('deleteSessions: the sidebar stops listing deleted sessions (cache dropped once, not per file)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stratapilot-d7-'));
  try {
    const g1 = path.join(root, 'g1');
    fs.mkdirSync(g1, { recursive: true });
    const first = path.join(g1, 'first.jsonl');
    const second = path.join(g1, 'second.jsonl');
    fs.writeFileSync(first, sessionWith('First', 'one'), 'utf8');
    fs.writeFileSync(second, sessionWith('Second', 'two'), 'utf8');
    withRoot(root, () => {
      assert.equal(listSessions().total, 2);
      const before = cacheSize();
      assert.ok(before > 0, 'listSessions should have warmed the cache');
      const result = deleteSessions([first, second]);
      assert.equal(result.deleted, 2);
      assert.equal(listSessions().total, 0);
      assert.equal(cacheSize(), 0, 'a bulk delete must not leave 4000 stale entries behind');
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
