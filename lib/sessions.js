'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MAX_SCAN_BYTES = 12 * 1024 * 1024; // skip deep scanning huge sessions

/** path -> { stamp: "mtimeMs:size", meta } - see listSessions() */
const metaCache = new Map();
const CACHE_MAX = 4000;

function sessionsRoot() {
  const envDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  if (envDir) return path.resolve(envDir);
  return path.join(os.homedir(), '.pi', 'agent', 'sessions');
}

function iterSessionFiles(root) {
  const out = [];
  let groups;
  try {
    groups = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const group of groups) {
    if (!group.isDirectory()) continue;
    const dir = path.join(root, group.name);
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

/**
 * Stream a JSONL file line by line, splitting on LF only.
 *
 * A 256 KB read boundary can land in the middle of a multi-byte UTF-8 character. Decoding each
 * chunk on its own (`buf.toString('utf8')`) turns that character into U+FFFD and throws the tail
 * bytes away before the next chunk is decoded - `carry` carries the leftover *string*, never the
 * leftover bytes. The decoder is therefore kept across reads, so it only ever sees complete code
 * points. Same rule as `splitRecords()` in lib/pi-process.js, which buffers bytes until the LF
 * arrives; a session title with CJK in it must not arrive garbled, and lib/usage-ledger.js scans
 * through this same helper, where a corrupted line fails JSON.parse and the tokens in it are never
 * banked.
 */
function forEachLine(filePath, onLine) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return;
  }
  try {
    const chunkSize = 256 * 1024;
    const buf = Buffer.alloc(chunkSize);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let carry = '';
    let total = 0;
    for (;;) {
      const read = fs.readSync(fd, buf, 0, chunkSize, null);
      if (read <= 0) break;
      total += read;
      const text = carry + decoder.decode(buf.subarray(0, read), { stream: true });
      const parts = text.split('\n');
      carry = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.endsWith('\r') ? part.slice(0, -1) : part;
        if (line.trim()) onLine(line);
      }
      if (total > MAX_SCAN_BYTES) break;
    }
    carry += decoder.decode(); // flush a trailing incomplete sequence instead of dropping it
    if (carry.trim()) onLine(carry.endsWith('\r') ? carry.slice(0, -1) : carry);
  } finally {
    fs.closeSync(fd);
  }
}

function textOfContent(content, limit = 400) {
  if (typeof content === 'string') return content.slice(0, limit);
  if (!Array.isArray(content)) return '';
  const parts = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text' && block.text) parts.push(block.text);
    else if (block.type === 'image') parts.push('[image]');
    if (parts.join(' ').length > limit) break;
  }
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, limit);
}

/**
 * Accumulate one usage record. in/out are kept apart on purpose: `total` hides where the
 * tokens went, and "a huge prompt read" is a different problem from "a huge answer".
 * `input` is the *uncached* prompt read; `cacheRead` is counted separately.
 */
function addUsage(meta, usage) {
  if (!usage) return;
  meta.totalTokens += usage.totalTokens || 0;
  meta.inputTokens += usage.input || 0;
  meta.outputTokens += usage.output || 0;
  meta.cacheReadTokens += usage.cacheRead || 0;
  meta.cacheWriteTokens += usage.cacheWrite || 0;
  meta.cost += (usage.cost && usage.cost.total) || 0;
}

function readSessionMeta(filePath) {
  const stat = fs.statSync(filePath);
  const meta = {
    path: filePath,
    fileName: path.basename(filePath),
    id: '',
    cwd: '',
    groupDir: path.basename(path.dirname(filePath)),
    createdAt: '',
    updatedAt: new Date(stat.mtimeMs).toISOString(),
    version: 0,
    parentSession: null,
    name: '',
    title: '',
    firstUserText: '',
    lastUserText: '',
    lastAssistantText: '',
    model: '',
    thinkingLevel: '',
    messageCount: 0,
    userCount: 0,
    assistantCount: 0,
    toolCallCount: 0,
    totalTokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    sizeBytes: stat.size,
    truncatedScan: stat.size > MAX_SCAN_BYTES,
  };

  forEachLine(filePath, (line) => {
    if (line[0] !== '{') return;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      return;
    }
    switch (entry.type) {
      case 'session':
        meta.id = entry.id || '';
        meta.cwd = entry.cwd || '';
        meta.createdAt = entry.timestamp || '';
        meta.version = entry.version || 1;
        meta.parentSession = entry.parentSession || null;
        break;
      case 'session_info':
        if (entry.name) meta.name = entry.name;
        break;
      case 'model_change':
        meta.model = entry.modelId || meta.model;
        break;
      case 'thinking_level_change':
        meta.thinkingLevel = entry.thinkingLevel || meta.thinkingLevel;
        break;
      case 'usage':
        addUsage(meta, entry.usage);
        break;
      case 'message': {
        const msg = entry.message;
        if (!msg) break;
        meta.messageCount += 1;
        if (msg.role === 'user') {
          meta.userCount += 1;
          const text = textOfContent(msg.content);
          if (!meta.firstUserText) meta.firstUserText = text;
          meta.lastUserText = text;
        } else if (msg.role === 'assistant') {
          meta.assistantCount += 1;
          if (msg.model) meta.model = msg.model;
          if (msg.thinkingLevel) meta.thinkingLevel = msg.thinkingLevel;
          meta.lastAssistantText = textOfContent(msg.content, 300);
          addUsage(meta, msg.usage);
        } else if (msg.role === 'toolResult') {
          meta.toolCallCount += 1;
        }
        if (entry.timestamp) meta.updatedAt = entry.timestamp;
        break;
      }
      default:
        if (entry.timestamp) meta.updatedAt = entry.timestamp;
        break;
    }
  });

  meta.title = meta.name || meta.firstUserText || meta.fileName.replace(/\.jsonl$/, '');
  return meta;
}

function listSessions({ query = '', limit = 300 } = {}) {
  const root = sessionsRoot();
  const files = iterSessionFiles(root);
  const sessions = [];
  // A stat per file is cheap; parsing a session JSONL is not (the README's worst case is an 86 MB
  // session, and the sidebar refreshes after almost every message). The cache is keyed on
  // (mtimeMs, size): a session file is append-only, so either both change or nothing did.
  // A file that is written and re-read within the same mtime granularity can stay stale for one
  // refresh - the sidebar is a list of titles, not the transcript, so that is acceptable.
  const seen = new Set();
  for (const file of files) {
    seen.add(file);
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      metaCache.delete(file);
      continue;
    }
    const stamp = `${stat.mtimeMs}:${stat.size}`;
    const cached = metaCache.get(file);
    if (cached && cached.stamp === stamp) {
      sessions.push(cached.meta);
      continue;
    }
    try {
      const meta = readSessionMeta(file);
      metaCache.set(file, { stamp, meta });
      sessions.push(meta);
    } catch {
      metaCache.delete(file);
    }
  }
  for (const known of [...metaCache.keys()]) if (!seen.has(known)) metaCache.delete(known);
  if (metaCache.size > CACHE_MAX) {
    // Map iterates in insertion order, so this drops the oldest entries
    for (const key of metaCache.keys()) {
      metaCache.delete(key);
      if (metaCache.size <= CACHE_MAX) break;
    }
  }
  const q = query.trim().toLowerCase();
  const filtered = q
    ? sessions.filter((s) =>
        [s.title, s.name, s.firstUserText, s.lastUserText, s.lastAssistantText, s.model, s.cwd, s.fileName]
          .join(' ')
          .toLowerCase()
          .includes(q),
      )
    : sessions;
  filtered.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  return { root, total: sessions.length, sessions: filtered.slice(0, limit) };
}

/**
 * Resolve a path through symlinks / junctions as far as the filesystem lets us.
 *
 * `path.resolve()` is purely lexical, so a path that reaches the sessions root THROUGH a link passes
 * the containment check while pointing at a real file somewhere else. Deleting or renaming a session
 * is a write outside the sessions dir. So the deepest existing ancestor is realpath'd and the
 * remainder re-joined; a path whose real form escapes the root is refused.
 */
function realOfDeepestExisting(resolved) {
  let current = resolved;
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync(current), ...tail.reverse());
    } catch (err) {
      if (err && err.code !== 'ENOENT' && err.code !== 'ENOTDIR' && err.code !== 'EPERM') return resolved;
    }
    const parent = path.dirname(current);
    if (parent === current) return resolved;
    tail.push(path.basename(current));
    current = parent;
  }
}

function assertInsideRoot(filePath) {
  const root = sessionsRoot();
  const resolved = path.resolve(filePath);
  // lexical pair against the lexical root, real pair against the real root - never mixed. On macOS
  // os.tmpdir() is /var/folders/..., which is itself a symlink to /private/var/folders/..., so a
  // check that compared the realpath of the file against the unresolved root rejected every session
  // file in the folder (macos-latest caught it in test/sessions.test.js).
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    realRoot = path.resolve(root); // the root does not exist yet: nothing can be inside it anyway
  }
  const real = realOfDeepestExisting(resolved);
  const checks = [
    [resolved, path.resolve(root), ''],
    [real, realRoot, ' (it resolves through a link to ' + real + ')'],
  ];
  for (const check of checks) {
    const rel = path.relative(check[1], check[0]);
    if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`refusing to touch path outside the sessions dir${check[2]}: ${filePath}`);
    }
  }
  if (!real.endsWith('.jsonl') || !resolved.endsWith('.jsonl')) throw new Error('only .jsonl session files can be modified');
  // callers keep getting the path they passed in (lexical), so cache keys and log lines stay stable;
  // the realpath is only ever used to decide whether the path is really inside the root
  return resolved;
}

function deleteSession(filePath) {
  const target = assertInsideRoot(filePath);
  fs.rmSync(target, { force: true });
  metaCache.delete(target);
  return true;
}

/**
 * Rename an inactive session by appending a session_info entry.
 * Safe append-only edit; active sessions should use the RPC set_session_name.
 */
function renameSession(filePath, name) {
  const target = assertInsideRoot(filePath);
  const trimmed = String(name || '').trim();
  if (!trimmed) throw new Error('name is required');
  let leafId = null;
  forEachLine(target, (line) => {
    try {
      const entry = JSON.parse(line);
      if (entry && entry.id) leafId = entry.id;
    } catch {}
  });
  const id = Math.random().toString(16).slice(2, 10);
  const entry = {
    type: 'session_info',
    id,
    parentId: leafId,
    timestamp: new Date().toISOString(),
    name: trimmed,
  };
  fs.appendFileSync(target, JSON.stringify(entry) + '\n');
  metaCache.delete(target); // the next list must see the new name
  return readSessionMeta(target);
}

/**
 * D7: what the sessions folder costs. Grouped by the folder-group directory pi creates per working
 * folder, so the biggest offender is at the top. Only stat() is used - no parsing, so an 86 MB session
 * costs the same as a small one.
 */
function storageStats() {
  const root = sessionsRoot();
  const groups = new Map();
  let totalBytes = 0;
  let totalFiles = 0;
  for (const filePath of iterSessionFiles(root)) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue; // deleted between the scan and the stat
    }
    const dir = path.dirname(filePath);
    const groupName = path.basename(dir);
    let group = groups.get(groupName);
    if (!group) {
      group = { group: groupName, dir, files: 0, bytes: 0, newestMs: 0, oldestMs: stat.mtimeMs, entries: [] };
      groups.set(groupName, group);
    }
    group.files += 1;
    group.bytes += stat.size;
    group.newestMs = Math.max(group.newestMs, stat.mtimeMs);
    group.oldestMs = Math.min(group.oldestMs, stat.mtimeMs);
    group.entries.push({ path: filePath, bytes: stat.size, mtimeMs: stat.mtimeMs });
    totalBytes += stat.size;
    totalFiles += 1;
  }
  const list = [...groups.values()].sort((a, b) => b.bytes - a.bytes);
  for (const group of list) group.entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { root, totalBytes, totalFiles, groups: list };
}

/**
 * D7: which files a cleanup would remove, without removing anything. Two rules, either of which can
 * be left out: age (`olderThanDays`) and a per-folder cap (`keepNewestPerGroup`). The caller shows the
 * list before anything is deleted, and main.js refuses files that are open in a tab.
 */
function cleanupPlan({ olderThanDays = null, keepNewestPerGroup = null } = {}) {
  const stats = storageStats();
  const now = Date.now();
  const candidates = [];
  for (const group of stats.groups) {
    group.entries.forEach((entry, index) => {
      const byAge = olderThanDays != null && olderThanDays >= 0 && entry.mtimeMs < now - olderThanDays * 86400000;
      const byCount = keepNewestPerGroup != null && keepNewestPerGroup >= 0 && index >= keepNewestPerGroup;
      if (!byAge && !byCount) return;
      candidates.push({
        ...entry,
        group: path.basename(path.dirname(entry.path)),
        reason: byAge ? `older than ${olderThanDays} days` : `beyond the ${keepNewestPerGroup} newest in its folder`,
      });
    });
  }
  return {
    root: stats.root,
    scannedFiles: stats.totalFiles,
    candidates,
    bytes: candidates.reduce((sum, entry) => sum + entry.bytes, 0),
  };
}

/**
 * D7: bulk delete. `skip` is the set of files an open tab is using - they are reported, not deleted.
 * The metadata cache is dropped at the end so the sidebar re-reads instead of showing ghosts.
 */
function deleteSessions(filePaths, { skip = new Set() } = {}) {
  const result = { deleted: 0, bytes: 0, skipped: [], failed: [] };
  const skipped = new Set([...skip].map((entry) => path.resolve(entry)));
  for (const filePath of filePaths) {
    try {
      const target = assertInsideRoot(filePath);
      if (skipped.has(target)) {
        result.skipped.push(target);
        continue;
      }
      const size = fs.existsSync(target) ? fs.statSync(target).size : 0;
      deleteSession(target);
      result.deleted += 1;
      result.bytes += size;
    } catch (err) {
      result.failed.push({ path: filePath, error: err.message });
    }
  }
  if (result.deleted) clearSessionCache();
  return result;
}

module.exports = {
  sessionsRoot,
  iterSessionFiles,
  forEachLine,
  MAX_SCAN_BYTES,
  listSessions,
  readSessionMeta,
  deleteSession,
  renameSession,
  clearSessionCache,
  cacheSize,
  storageStats,
  cleanupPlan,
  deleteSessions,
};

/** Drop the metadata cache (tests, and after a bulk delete). */
function clearSessionCache() {
  metaCache.clear();
}

function cacheSize() {
  return metaCache.size;
}
